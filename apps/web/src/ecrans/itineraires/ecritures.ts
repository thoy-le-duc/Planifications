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

function extraire(l: Ligne, colonnes: readonly string[]): Record<string, Valeur> {
  const r: Record<string, Valeur> = {};
  for (const c of colonnes) r[c] = l[c] ?? null;
  return r;
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

const COLONNES_ITINERAIRE = ['nom', 'mode', 'parametres', 'supprime_le'] as const;
const COLONNES_SERIE = ['parametres', 'prevu_semis_pepiniere', 'prevu_mise_en_place', 'prevu_debut_recolte', 'prevu_fin_recolte'] as const;
const COLONNES_OCCUPATION = ['prevu_du', 'prevu_au'] as const;

/** Ce qu'une écriture a changé, pour la défaire (lignes d'avant, telles quelles). */
export interface EtatAvant {
  readonly itineraires: readonly Ligne[];
  readonly series: readonly Ligne[];
  readonly occupations: readonly Ligne[];
  readonly types: readonly Ligne[];
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
 * transaction. Rend l'état d'avant (pour « Annuler »).
 */
export async function modifierItineraire(
  ctx: ContexteEcriture,
  id: string,
  valeurs: { readonly nom: string; readonly mode: string; readonly parametres: string },
  seriesIds: readonly string[],
  types: readonly TypeLu[],
): Promise<EtatAvant> {
  const avant = await lireLigne(ctx.porte, 'itineraire', id);
  if (avant?.supprime_le !== null) throw new EcritureRefusee('cet itinéraire n’existe plus sur ce téléphone');
  if (avant.ferme_id !== ctx.fermeId) throw new EcritureRefusee('un itinéraire de la bibliothèque ne se modifie pas : adaptez-le');
  const iso = ctx.maintenant().toISOString();
  itineraireValide({ ...avant, ...valeurs, modifie_le: iso }, types);
  const ordres: OrdreEcriture[] = [];
  const ordre = mettreAJour('itineraire', avant, valeurs, iso);
  if (ordre !== null) ordres.push(ordre);

  const series: Ligne[] = [];
  const occupations: Ligne[] = [];
  if (seriesIds.length > 0) {
    const marques = seriesIds.map(() => '?').join(', ');
    const [lues, occ] = await Promise.all([
      ctx.porte.lire<Ligne>(`SELECT * FROM serie WHERE id IN (${marques}) ORDER BY id`, seriesIds),
      ctx.porte.lire<Ligne>(`SELECT * FROM occupation WHERE serie_id IN (${marques}) AND supprime_le IS NULL ORDER BY id`, seriesIds),
    ]);
    const parametres = JSON.parse(valeurs.parametres) as ParametresDatesSerie;
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
      series.push(s);
      const o = mettreAJour('serie', s, nouvelles, iso);
      if (o !== null) ordres.push(o);
      for (const x of occ.filter((y) => y.serie_id === s.id)) {
        const dates = { prevu_du: d.miseEnPlace, prevu_au: d.finRecolte };
        occupationValide({ ...x, ...dates, modifie_le: iso }, lue);
        occupations.push(x);
        const u = mettreAJour('occupation', x, dates, iso);
        if (u !== null) ordres.push(u);
      }
    }
  }
  await ctx.porte.ecrireEnsemble(ordres);
  return { itineraires: [avant], series, occupations, types: [] };
}

/** Annuler une création d'itinéraire : suppression douce. */
export async function supprimerItineraire(ctx: ContexteEcriture, id: string, types: readonly TypeLu[]): Promise<void> {
  const courant = await lireLigne(ctx.porte, 'itineraire', id);
  if (courant?.supprime_le !== null) return;
  const iso = ctx.maintenant().toISOString();
  itineraireValide({ ...courant, supprime_le: iso, modifie_le: iso }, types);
  const o = mettreAJour('itineraire', courant, { supprime_le: iso }, iso);
  if (o !== null) await ctx.porte.ecrireEnsemble([o]);
}

// ── Types d'intervention ─────────────────────────────────────────────────────────────────────

const COLONNES_TYPE = ['libelle', 'masque', 'supprime_le'] as const;

/** Ajout : un INSERT ; `libelle` déjà normalisé. Rend l'id. */
export async function ajouterType(ctx: ContexteEcriture, categorie: string, libelle: string): Promise<string> {
  const iso = ctx.maintenant().toISOString();
  const ligne: Ligne = { id: nouvelId(ctx.maintenant), ferme_id: ctx.fermeId, categorie, libelle, masque: 0, cree_le: iso, modifie_le: iso, supprime_le: null };
  const r = validerTypeIntervention({ ...ligne });
  if (!r.ok) throw new EcritureRefusee(r.erreur.message);
  await ctx.porte.ecrireEnsemble([inserer('type_intervention', ligne)]);
  return String(ligne.id);
}

/** Renommer ou masquer / afficher un type de la ferme : un UPDATE. Rend l'état d'avant. */
export async function modifierType(ctx: ContexteEcriture, id: string, valeurs: { readonly libelle?: string; readonly masque?: 0 | 1 }): Promise<EtatAvant> {
  const avant = await lireLigne(ctx.porte, 'type_intervention', id);
  if (avant?.supprime_le !== null) throw new EcritureRefusee('ce type n’existe plus sur ce téléphone');
  if (avant.ferme_id !== ctx.fermeId) throw new EcritureRefusee('la liste de départ ne se modifie pas');
  const iso = ctx.maintenant().toISOString();
  const r = validerTypeIntervention({ ...avant, ...valeurs, modifie_le: iso });
  if (!r.ok) throw new EcritureRefusee(r.erreur.message);
  const o = mettreAJour('type_intervention', avant, valeurs, iso);
  if (o !== null) await ctx.porte.ecrireEnsemble([o]);
  return { itineraires: [], series: [], occupations: [], types: [avant] };
}

/** Annuler un ajout de type : suppression douce. */
export async function supprimerType(ctx: ContexteEcriture, id: string): Promise<void> {
  const courant = await lireLigne(ctx.porte, 'type_intervention', id);
  if (courant?.supprime_le !== null) return;
  const iso = ctx.maintenant().toISOString();
  const o = mettreAJour('type_intervention', courant, { supprime_le: iso }, iso);
  if (o !== null) await ctx.porte.ecrireEnsemble([o]);
}

// ── Annuler ──────────────────────────────────────────────────────────────────────────────────

/**
 * Ramène chaque ligne de `avant` à ses valeurs (hors horodatages), en UNE transaction. Chaque
 * ligne ramenée est d'abord validée comme à l'écriture.
 */
export async function ramener(ctx: ContexteEcriture, avant: EtatAvant, types: readonly TypeLu[]): Promise<void> {
  const iso = ctx.maintenant().toISOString();
  const ordres: OrdreEcriture[] = [];
  const lire = async (table: Table, lignes: readonly Ligne[]) => {
    const courantes = await Promise.all(lignes.map((l) => lireLigne(ctx.porte, table, String(l.id))));
    return lignes.flatMap((l, i) => {
      const c = courantes[i];
      return c === null || c === undefined ? [] : [{ cible: l, courante: c }];
    });
  };
  for (const { cible, courante } of await lire('itineraire', avant.itineraires)) {
    const valeurs = extraire(cible, COLONNES_ITINERAIRE);
    itineraireValide({ ...courante, ...valeurs }, types);
    const o = mettreAJour('itineraire', courante, valeurs, iso);
    if (o !== null) ordres.push(o);
  }
  const seriesRamenees = new Map<string, Serie>();
  for (const { cible, courante } of await lire('serie', avant.series)) {
    const valeurs = extraire(cible, COLONNES_SERIE);
    seriesRamenees.set(String(courante.id), serieValide({ ...courante, ...valeurs }));
    const o = mettreAJour('serie', courante, valeurs, iso);
    if (o !== null) ordres.push(o);
  }
  for (const { cible, courante } of await lire('occupation', avant.occupations)) {
    const valeurs = extraire(cible, COLONNES_OCCUPATION);
    const serie = seriesRamenees.get(String(courante.serie_id));
    if (serie !== undefined && courante.supprime_le === null) occupationValide({ ...courante, ...valeurs }, serie);
    const o = mettreAJour('occupation', courante, valeurs, iso);
    if (o !== null) ordres.push(o);
  }
  for (const { cible, courante } of await lire('type_intervention', avant.types)) {
    const valeurs = extraire(cible, COLONNES_TYPE);
    const r = validerTypeIntervention({ ...courante, ...valeurs });
    if (!r.ok) throw new EcritureRefusee(r.erreur.message);
    const o = mettreAJour('type_intervention', courante, valeurs, iso);
    if (o !== null) ordres.push(o);
  }
  await ctx.porte.ecrireEnsemble(ordres);
}
