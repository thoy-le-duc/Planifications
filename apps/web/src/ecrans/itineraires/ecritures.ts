/**
 * Écritures de l'écran des itinéraires (T24), toutes par la porte. Une saisie = UNE transaction
 * (`porte.ecrireEnsemble`). Règles du serveur (apps/api/src/sync/itineraire.ts, T23 ; séries :
 * serie.ts, T10e) rejouées avant d'écrire : validerItineraire, validerTypeIntervention,
 * validerSerie, validerOccupation. Une ligne que le serveur refuserait n'entre jamais dans la
 * file d'envoi.
 *
 * Jamais d'écriture dans `modification` (le serveur seul l'écrit), jamais de DELETE ni de
 * REPLACE : une suppression pose `supprime_le`. Jamais d'écriture sur une ligne de la
 * bibliothèque (ferme_id nul), jamais de changement d'espèce ni de ferme d'un itinéraire.
 */
import {
  calculerDatesSerie,
  creerGenerateurId,
  ECRITURES_MAX_PAR_LOT,
  validerItineraire,
  validerOccupation,
  validerSerie,
  validerTypeIntervention,
  type AncreSerie,
  type ParametresDatesSerie,
  type Serie,
} from '@planif/core';
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';
import { typesPermis, type Ligne, type TypeLu, type Valeur } from './calculs.ts';
import { conditionAVenir, parametresAVenir } from './donnees.ts';

/** Écriture refusée avant l'envoi (règle du serveur), avec un message clair. */
export class EcritureRefusee extends Error {}

export interface ContexteEcriture {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant: () => Date;
}

/** Générateur d'UUID v7 sur l'horloge de l'écran. */
export function nouvelId(maintenant: () => Date): string {
  const generer = creerGenerateurId({ horloge: () => maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  return generer<'Itineraire'>();
}

type Table = 'itineraire' | 'type_intervention' | 'serie' | 'occupation';

function inserer(table: Table, l: Ligne): OrdreEcriture {
  const colonnes = Object.keys(l);
  return { sql: `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, parametres: colonnes.map((c) => l[c] ?? null) };
}

/** UPDATE des seules colonnes de `valeurs` qui changent (et modifie_le) ; null si rien ne change. */
function mettreAJour(table: Table, avant: Ligne, valeurs: Readonly<Record<string, Valeur>>, iso: string): OrdreEcriture | null {
  const changees = Object.keys(valeurs).filter((c) => (valeurs[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return null;
  return {
    sql: `UPDATE ${table} SET ${changees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`,
    parametres: [...changees.map((c) => valeurs[c] ?? null), iso, avant.id ?? null],
  };
}

async function lireLigne(porte: PorteDonnees, table: Table, id: string): Promise<Ligne | null> {
  const l = await porte.lire<Ligne>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return l[0] ?? null;
}

function itineraireValide(l: Ligne, types: readonly TypeLu[]): void {
  const r = validerItineraire({ ...l }, { typesIntervention: typesPermis(types) });
  if (!r.ok) throw new EcritureRefusee(r.erreur.message);
}

function serieValide(l: Ligne): Serie {
  const r = validerSerie({ ...l });
  if (!r.ok) throw new EcritureRefusee(`série : ${r.erreur.message}`);
  return r.valeur;
}

function occupationValide(l: Ligne, serie: Serie): void {
  const r = validerOccupation({ ...l }, serie, { datesDeLaSerie: true });
  if (!r.ok) throw new EcritureRefusee(`planche : ${r.erreur.message}`);
}

// ── Itinéraires ──────────────────────────────────────────────────────────────────────────────

/**
 * Une ligne écrite : les colonnes changées, leurs valeurs d'avant et celles que nous avons
 * écrites, et `supprime_le` après notre écriture. « Annuler » ne ramène que cela (décision 9).
 */
export interface LigneEcrite {
  readonly table: Table;
  readonly id: string;
  readonly avant: Readonly<Record<string, Valeur>>;
  readonly apres: Readonly<Record<string, Valeur>>;
  readonly supprimeLe: Valeur;
  /** Série de l'occupation (pour la valider contre la série ramenée). */
  readonly serieId: string | null;
}

/** Ce qu'une écriture a changé, pour la défaire. */
export interface EtatAvant {
  readonly lignes: readonly LigneEcrite[];
}

/** Trace d'un UPDATE : les seules colonnes qui changent. */
function trace(table: Table, avant: Ligne, valeurs: Readonly<Record<string, Valeur>>): LigneEcrite | null {
  const changees = Object.keys(valeurs).filter((c) => (valeurs[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return null;
  const a: Record<string, Valeur> = {};
  const b: Record<string, Valeur> = {};
  for (const c of changees) {
    a[c] = avant[c] ?? null;
    b[c] = valeurs[c] ?? null;
  }
  const supprimeLe = 'supprime_le' in b ? (b.supprime_le ?? null) : (avant.supprime_le ?? null);
  return { table, id: String(avant.id), avant: a, apres: b, supprimeLe, serieId: typeof avant.serie_id === 'string' ? avant.serie_id : null };
}

/** UPDATE des colonnes de la trace, avec une condition SQL de plus (revérification à l'écriture). */
function ordreDe(t: LigneEcrite, iso: string, condition = '', parametres: readonly unknown[] = []): OrdreEcriture {
  const cles = Object.keys(t.apres);
  return {
    sql: `UPDATE ${t.table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?${condition}`,
    parametres: [...cles.map((c) => t.apres[c] ?? null), iso, t.id, ...parametres],
  };
}

/** Création (« Nouvel itinéraire » ou adaptation) : un INSERT. `ligne` : colonnes validées, sans horodatages. */
export async function creerItineraire(ctx: ContexteEcriture, ligne: Ligne, types: readonly TypeLu[]): Promise<string> {
  const iso = ctx.maintenant().toISOString();
  const complete: Ligne = { ...ligne, ferme_id: ctx.fermeId, cree_le: iso, modifie_le: iso, supprime_le: null };
  itineraireValide(complete, types);
  await ctx.porte.ecrireEnsemble([inserer('itineraire', complete)]);
  return String(complete.id);
}

/**
 * Modification : UPDATE de l'itinéraire (nom, mode, parametres), et, pour chaque série de
 * `seriesIds` (les séries à venir), l'instantané fidèle (le texte même de l'itinéraire), ses
 * dates recalculées par le cœur depuis son ancre inchangée, et ses occupations actives. Une seule
 * transaction, où le caractère « à venir » de chaque série est revérifié (décision 11) : une série
 * commencée entre-temps n'est pas touchée, ni ses occupations. Rend ce qui a été écrit.
 */
export async function modifierItineraire(
  ctx: ContexteEcriture,
  id: string,
  valeurs: { readonly nom: string; readonly mode: string; readonly parametres: string },
  seriesIds: readonly string[],
  types: readonly TypeLu[],
  aujourdhui: string,
): Promise<EtatAvant> {
  const avant = await lireLigne(ctx.porte, 'itineraire', id);
  if (avant?.supprime_le !== null) throw new EcritureRefusee('cet itinéraire n’existe plus sur ce téléphone');
  if (avant.ferme_id !== ctx.fermeId) throw new EcritureRefusee('un itinéraire de la bibliothèque ne se modifie pas : adaptez-le');
  const iso = ctx.maintenant().toISOString();
  itineraireValide({ ...avant, ...valeurs, modifie_le: iso }, types);
  const ordres: OrdreEcriture[] = [];
  const lignes: LigneEcrite[] = [];
  const t = trace('itineraire', avant, valeurs);
  if (t !== null) {
    ordres.push(ordreDe(t, iso));
    lignes.push(t);
  }

  if (seriesIds.length > 0) {
    const marques = seriesIds.map(() => '?').join(', ');
    const [lues, occ] = await Promise.all([
      ctx.porte.lire<Ligne>(`SELECT * FROM serie WHERE id IN (${marques}) ORDER BY id`, seriesIds),
      ctx.porte.lire<Ligne>(`SELECT * FROM occupation WHERE serie_id IN (${marques}) AND supprime_le IS NULL ORDER BY id`, seriesIds),
    ]);
    const parametres = JSON.parse(valeurs.parametres) as ParametresDatesSerie;
    const aVenir = parametresAVenir(ctx.fermeId, aujourdhui);
    for (const s of lues) {
      if (s.itineraire_id !== id || s.supprime_le !== null) continue;
      const ancre = { type: s.ancre_type, date: s.ancre_date } as AncreSerie;
      let d;
      try {
        d = calculerDatesSerie(parametres, ancre);
      } catch {
        throw new EcritureRefusee('une série à venir est ancrée sur le semis, impossible dans ce mode : choisissez « Itinéraire seul »');
      }
      const nouvelles: Record<string, Valeur> = {
        parametres: valeurs.parametres,
        prevu_semis_pepiniere: d.semisPepiniere ?? null,
        prevu_mise_en_place: d.miseEnPlace,
        prevu_debut_recolte: d.debutRecolte,
        prevu_fin_recolte: d.finRecolte,
      };
      const lue = serieValide({ ...s, ...nouvelles, modifie_le: iso });
      // Occupations d'abord : la condition « à venir » se lit sur la série encore inchangée.
      for (const x of occ.filter((y) => y.serie_id === s.id)) {
        const dates = { prevu_du: d.miseEnPlace, prevu_au: d.finRecolte };
        occupationValide({ ...x, ...dates, modifie_le: iso }, lue);
        const to = trace('occupation', x, dates);
        if (to === null) continue;
        ordres.push(ordreDe(to, iso, ` AND serie_id IN (SELECT s.id FROM serie s WHERE s.id = ? AND s.itineraire_id = ? AND ${conditionAVenir('s')})`, [s.id, id, ...aVenir]));
        lignes.push(to);
      }
      const ts = trace('serie', s, nouvelles);
      if (ts === null) continue;
      ordres.push(ordreDe(ts, iso, ` AND id IN (SELECT s.id FROM serie s WHERE s.id = ? AND s.itineraire_id = ? AND ${conditionAVenir('s')})`, [s.id, id, ...aVenir]));
      lignes.push(ts);
    }
  }
  if (ordres.length > ECRITURES_MAX_PAR_LOT) throw new EcritureRefusee('trop de séries en une fois : utilisez « Itinéraire seul »');
  await ctx.porte.ecrireEnsemble(ordres);
  return { lignes };
}

/** Annuler une création d'itinéraire : suppression douce. */
export async function supprimerItineraire(ctx: ContexteEcriture, id: string, types: readonly TypeLu[]): Promise<null> {
  const courant = await lireLigne(ctx.porte, 'itineraire', id);
  if (courant?.supprime_le !== null) return null;
  const iso = ctx.maintenant().toISOString();
  itineraireValide({ ...courant, supprime_le: iso, modifie_le: iso }, types);
  const o = mettreAJour('itineraire', courant, { supprime_le: iso }, iso);
  if (o !== null) await ctx.porte.ecrireEnsemble([o]);
  return null;
}

// ── Types d'intervention ─────────────────────────────────────────────────────────────────────

/** Ajout : un INSERT ; `libelle` déjà normalisé. Rend l'id. */
export async function ajouterType(ctx: ContexteEcriture, categorie: string, libelle: string): Promise<string> {
  const iso = ctx.maintenant().toISOString();
  const ligne: Ligne = { id: nouvelId(ctx.maintenant), ferme_id: ctx.fermeId, categorie, libelle, masque: 0, cree_le: iso, modifie_le: iso, supprime_le: null };
  const r = validerTypeIntervention({ ...ligne });
  if (!r.ok) throw new EcritureRefusee(r.erreur.message);
  await ctx.porte.ecrireEnsemble([inserer('type_intervention', ligne)]);
  return String(ligne.id);
}

/** Renommer ou masquer / afficher un type de la ferme : un UPDATE. Rend ce qui a été écrit. */
export async function modifierType(ctx: ContexteEcriture, id: string, valeurs: { readonly libelle?: string; readonly masque?: 0 | 1 }): Promise<EtatAvant> {
  const avant = await lireLigne(ctx.porte, 'type_intervention', id);
  if (avant?.supprime_le !== null) throw new EcritureRefusee('ce type n’existe plus sur ce téléphone');
  if (avant.ferme_id !== ctx.fermeId) throw new EcritureRefusee('la liste de départ ne se modifie pas');
  const iso = ctx.maintenant().toISOString();
  const r = validerTypeIntervention({ ...avant, ...valeurs, modifie_le: iso });
  if (!r.ok) throw new EcritureRefusee(r.erreur.message);
  const t = trace('type_intervention', avant, valeurs);
  if (t !== null) await ctx.porte.ecrireEnsemble([ordreDe(t, iso)]);
  return { lignes: t === null ? [] : [t] };
}

/** Annuler un ajout de type : suppression douce. */
export async function supprimerType(ctx: ContexteEcriture, id: string): Promise<null> {
  const courant = await lireLigne(ctx.porte, 'type_intervention', id);
  if (courant?.supprime_le !== null) return null;
  const iso = ctx.maintenant().toISOString();
  const o = mettreAJour('type_intervention', courant, { supprime_le: iso }, iso);
  if (o !== null) await ctx.porte.ecrireEnsemble([o]);
  return null;
}

// ── Annuler ──────────────────────────────────────────────────────────────────────────────────

/** Message d'une annulation incomplète (décision 9). */
export function messageModifieAilleurs(n: number): string {
  return `ce qui a été modifié entre-temps sur un autre téléphone est gardé tel quel (${String(n)} ${n > 1 ? 'lignes' : 'ligne'})`;
}

/**
 * Défait une écriture, en UNE transaction, colonne par colonne et ligne par ligne (décision 9) :
 * une ligne n'est ramenée que si chaque colonne que nous avions changée vaut encore ce que nous
 * avions écrit, et que personne ne l'a supprimée ; ramenée, seules ces colonnes reprennent leur
 * valeur d'avant (ce qu'un autre téléphone a changé ailleurs reste). Sinon la ligne est laissée
 * telle quelle (et les occupations d’une série laissée aussi) ; une série n’est pas ramenée non
 * plus si une planche ajoutée ailleurs ne collerait plus à ses dates. Une ligne que notre écriture n’a
 * finalement pas touchée (revérification, décision 11) est ignorée. Rend le message à montrer
 * si des lignes ont été laissées, sinon null.
 */
export async function ramener(ctx: ContexteEcriture, etat: EtatAvant, types: readonly TypeLu[]): Promise<string | null> {
  const iso = ctx.maintenant().toISOString();
  const ordres: OrdreEcriture[] = [];
  const courantes = await Promise.all(etat.lignes.map((l) => lireLigne(ctx.porte, l.table, l.id)));
  const laissees = new Set<string>();
  const seriesRamenees = new Map<string, Serie>();
  let refusees = 0;
  // Occupations actives des séries écrites : une planche ajoutée ailleurs doit rester cohérente
  // avec la série ramenée, sinon la série n'est pas ramenée.
  const ecrites = new Set(etat.lignes.map((l) => l.id));
  const seriesIds = etat.lignes.filter((l) => l.table === 'serie').map((l) => l.id);
  const autresOccupations =
    seriesIds.length === 0
      ? []
      : (
          await ctx.porte.lire<Ligne>(
            `SELECT * FROM occupation WHERE serie_id IN (${seriesIds.map(() => '?').join(', ')}) AND supprime_le IS NULL`,
            seriesIds,
          )
        ).filter((o) => !ecrites.has(String(o.id)));
  const vaut = (c: Ligne, valeurs: Readonly<Record<string, Valeur>>) => Object.keys(valeurs).every((k) => (c[k] ?? null) === (valeurs[k] ?? null));
  const ordreTables: readonly Table[] = ['itineraire', 'serie', 'occupation', 'type_intervention'];
  for (const table of ordreTables) {
    etat.lignes.forEach((l, i) => {
      if (l.table !== table) return;
      const c = courantes[i] ?? null;
      if (c !== null && vaut(c, l.avant)) return; // pas touchée par nous
      const intacte = c !== null && vaut(c, l.apres) && (c.supprime_le ?? null) === l.supprimeLe && !(l.serieId !== null && laissees.has(l.serieId));
      let valide = intacte;
      if (c !== null && intacte) {
        const ramenee = { ...c, ...l.avant };
        if (table === 'itineraire') valide = validerItineraire({ ...ramenee }, { typesIntervention: typesPermis(types) }).ok;
        else if (table === 'type_intervention') valide = validerTypeIntervention({ ...ramenee }).ok;
        else if (table === 'serie') {
          const r = validerSerie({ ...ramenee });
          const serie = r.ok ? r.valeur : null;
          valide = serie !== null && autresOccupations.every((o) => o.serie_id !== l.id || validerOccupation({ ...o }, serie, { datesDeLaSerie: true }).ok);
          if (serie !== null && valide) seriesRamenees.set(l.id, serie);
        } else {
          const serie = l.serieId === null ? undefined : seriesRamenees.get(l.serieId);
          valide = serie === undefined || ramenee.supprime_le !== null || validerOccupation({ ...ramenee }, serie, { datesDeLaSerie: true }).ok;
        }
      }
      if (c === null || !valide) {
        refusees++;
        laissees.add(l.id);
        return;
      }
      ordres.push(ordreDe({ ...l, apres: l.avant }, iso));
    });
  }
  await ctx.porte.ecrireEnsemble(ordres);
  return refusees === 0 ? null : messageModifieAilleurs(refusees);
}
