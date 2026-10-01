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
import { etatSerieValide } from '../../donnees/etat-serie.ts';
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

/** Condition SQL ajoutée au WHERE d'un UPDATE (fragment « AND … ») et ses paramètres. */
interface Condition {
  readonly sql: string;
  readonly parametres: readonly Valeur[];
}

const et = (...cs: readonly Condition[]): Condition => ({ sql: cs.map((c) => c.sql).join(''), parametres: cs.flatMap((c) => c.parametres) });

/** Chaque colonne vaut encore ce que nous avions écrit, et `supprime_le` ce qu'il valait après (T24c N3). */
function conditionIntacte(l: LigneEcrite): Condition {
  const cles = Object.keys(l.apres).filter((c) => c !== 'supprime_le');
  // Une occupation passée dans une autre série entre-temps n'est pas touchée (T24c B1).
  const serie = l.table === 'occupation' ? { sql: ' AND serie_id IS ?', parametres: [l.serieId] } : et();
  return et(
    {
      sql: [...cles, 'supprime_le'].map((c) => ` AND ${c} IS ?`).join(''),
      parametres: [...cles.map((c) => l.apres[c] ?? null), l.supprimeLe],
    },
    serie,
  );
}

/** Couples (catégorie, libellé) cités par les travaux prévus d'un texte de paramètres. */
function typesCites(parametres: Valeur): { categorie: string; type: string }[] {
  let p: unknown;
  try {
    p = JSON.parse(String(parametres));
  } catch {
    return [];
  }
  const travaux = typeof p === 'object' && p !== null && 'travauxPrevus' in p ? p.travauxPrevus : null;
  if (!Array.isArray(travaux)) return [];
  const r: { categorie: string; type: string }[] = [];
  for (const t of travaux as unknown[]) {
    if (typeof t === 'object' && t !== null && 'categorie' in t && 'type' in t && typeof t.categorie === 'string' && typeof t.type === 'string') r.push({ categorie: t.categorie, type: t.type });
  }
  return r;
}

/** Chaque type cité existe encore, non supprimé (verifierTypes du serveur). */
function conditionTypesVivants(fermeId: string, cites: readonly { categorie: string; type: string }[]): Condition {
  return et(
    ...cites.map((t) => ({
      sql: ' AND EXISTS (SELECT 1 FROM type_intervention t WHERE t.supprime_le IS NULL AND (t.ferme_id = ? OR t.ferme_id IS NULL) AND t.categorie = ? AND t.libelle = ?)',
      parametres: [fermeId, t.categorie, t.type],
    })),
  );
}

/** Le couple n'est cité par aucun itinéraire actif de la ferme (« un type utilisé ne se renomme pas »). */
function conditionNonUtilise(fermeId: string, categorie: Valeur, libelle: Valeur): Condition {
  return {
    sql:
      " AND NOT EXISTS (SELECT 1 FROM itineraire i, json_each(i.parametres, '$.travauxPrevus') t WHERE i.ferme_id = ? AND i.supprime_le IS NULL" +
      " AND json_extract(t.value, '$.categorie') = ? AND json_extract(t.value, '$.type') = ?)",
    parametres: [fermeId, categorie, libelle],
  };
}

/** Les types vivants de la catégorie (hors `id`) sont exactement ceux lus (`lus` : id et libellé). */
function conditionCategorieInchangee(fermeId: string, id: string, categorie: Valeur, lus: readonly Ligne[]): Condition {
  const cles = lus.map((l) => `${String(l.id)}\u001f${String(l.libelle)}`);
  return {
    sql:
      ' AND NOT EXISTS (SELECT 1 FROM type_intervention t WHERE t.supprime_le IS NULL AND (t.ferme_id = ? OR t.ferme_id IS NULL) AND t.categorie = ? AND t.id <> ?' +
      (cles.length === 0 ? ')' : ` AND (t.id || char(31) || t.libelle) NOT IN (${cles.map(() => '?').join(', ')}))`),
    parametres: [fermeId, categorie, id, ...cles],
  };
}

/** Condition vraie si elle tient maintenant (même SQL que celle portée par l'UPDATE). */
async function tient(porte: PorteDonnees, c: Condition): Promise<boolean> {
  return (await porte.lire<Ligne>(`SELECT 1 AS ok WHERE 1 = 1${c.sql}`, c.parametres)).length > 0;
}

/** La série et toutes ses occupations n'ont pas changé depuis leur lecture (sauf par nous, horodatées `iso`). */
function conditionSerieInchangee(serie: Ligne, occupations: readonly Ligne[], iso: string): Condition {
  return {
    sql:
      ' AND EXISTS (SELECT 1 FROM serie s WHERE s.id = ? AND (s.modifie_le IS ? OR s.modifie_le IS ?))' +
      ` AND NOT EXISTS (SELECT 1 FROM occupation o WHERE o.serie_id = ? AND o.modifie_le IS NOT ?${occupations.map(() => ' AND NOT (o.id = ? AND o.modifie_le IS ?)').join('')})`,
    parametres: [serie.id ?? null, serie.modifie_le ?? null, iso, serie.id ?? null, iso, ...occupations.flatMap((o) => [o.id ?? null, o.modifie_le ?? null])],
  };
}

/**
 * Défait une écriture, en UNE transaction, colonne par colonne et ligne par ligne (décision 9) :
 * une ligne n'est ramenée que si chaque colonne que nous avions changée vaut encore ce que nous
 * avions écrit, et que personne ne l'a supprimée ; ramenée, seules ces colonnes reprennent leur
 * valeur d'avant (ce qu'un autre téléphone a changé ailleurs reste). Une ligne que notre écriture
 * n'a finalement pas touchée (elle vaut déjà l'avant, revérification, décision 11) est ignorée.
 *
 * Chaque série touchée (par sa ligne ou par une de ses occupations) est vérifiée APRÈS
 * l'annulation, même si sa ligne n'est pas ramenée (T24b ; T12b décision 10) : série et toutes
 * ses occupations (écrites ailleurs, laissées, ramenées) passent `etatSerieValide`, comme en fin
 * de lot au serveur. Sinon, ou si la ligne série est laissée, la série et ses occupations
 * restent telles quelles.
 *
 * T24c : les types d'intervention sont relus en base (N1) ; un renommage n'est défait que si le
 * serveur l'accepterait (nouveau libellé non utilisé, ancien libellé sans doublon, N2). Les
 * lectures précèdent la transaction d'écriture : chaque UPDATE porte donc dans son WHERE les
 * conditions vérifiées (valeurs encore celles écrites, types vivants, série inchangée, règles
 * des types), et ne touche rien si une synchro reçue entre-temps les a changées (N3). Rend le
 * message à montrer si des lignes ont été laissées, sinon null.
 */
export async function ramener(ctx: ContexteEcriture, etat: EtatAvant): Promise<string | null> {
  const iso = ctx.maintenant().toISOString();
  const vaut = (c: Ligne, valeurs: Readonly<Record<string, Valeur>>) => Object.keys(valeurs).every((k) => (c[k] ?? null) === (valeurs[k] ?? null));
  const serieDe = (l: LigneEcrite): string | null => (l.table === 'serie' ? l.id : l.table === 'occupation' ? l.serieId : null);

  // Séries touchées : leur ligne et TOUTES leurs occupations (supprimées comprises), lues ensemble.
  const seriesIds = [...new Set(etat.lignes.map(serieDe).filter((x): x is string => x !== null))];
  const marques = seriesIds.map(() => '?').join(', ');
  const [seriesLues, occupationsLues, autres, typesLus] = await Promise.all([
    seriesIds.length === 0 ? [] : ctx.porte.lire<Ligne>(`SELECT * FROM serie WHERE id IN (${marques})`, seriesIds),
    seriesIds.length === 0 ? [] : ctx.porte.lire<Ligne>(`SELECT * FROM occupation WHERE serie_id IN (${marques}) ORDER BY id`, seriesIds),
    Promise.all(etat.lignes.map((l) => (l.table === 'serie' || l.table === 'occupation' ? Promise.resolve(null) : lireLigne(ctx.porte, l.table, l.id)))),
    // N1 : les types tels qu'ils sont en base maintenant, pas ceux connus à l'enregistrement.
    ctx.porte.lire<Ligne>('SELECT id, categorie, libelle FROM type_intervention WHERE supprime_le IS NULL AND (ferme_id = ? OR ferme_id IS NULL)', [ctx.fermeId]),
  ]);
  const permis = typesLus.map((t) => ({ categorie: String(t.categorie), type: String(t.libelle) }));
  const courante = (l: LigneEcrite, i: number): Ligne | null =>
    l.table === 'serie'
      ? (seriesLues.find((x) => x.id === l.id) ?? null)
      : l.table === 'occupation'
        ? (occupationsLues.find((x) => x.id === l.id) ?? null)
        : (autres[i] ?? null);

  /** Conditions propres à une ligne (en plus de « intacte ») ; null si la ligne doit être laissée. */
  async function conditionsPropres(l: LigneEcrite, c: Ligne): Promise<Condition | null> {
    const cible = { ...c, ...l.avant };
    if (l.table === 'itineraire') {
      if (!validerItineraire(cible, { typesIntervention: permis }).ok) return null;
      return (cible.supprime_le ?? null) === null ? conditionTypesVivants(ctx.fermeId, typesCites(cible.parametres ?? null)) : et();
    }
    if (l.table !== 'type_intervention') return et();
    if (!validerTypeIntervention(cible).ok) return null;
    const conditions: Condition[] = [];
    const renomme = (cible.categorie ?? null) !== (c.categorie ?? null) || (cible.libelle ?? null) !== (c.libelle ?? null);
    const supprime = (c.supprime_le ?? null) === null && (cible.supprime_le ?? null) !== null;
    if (renomme || supprime) conditions.push(conditionNonUtilise(ctx.fermeId, c.categorie ?? null, c.libelle ?? null));
    if ((cible.supprime_le ?? null) === null) {
      // Unicité sans casse, vérifiée ici ; l'UPDATE exige en plus que la catégorie n'ait pas bougé depuis.
      const memeCategorie = typesLus.filter((t) => t.id !== l.id && t.categorie === cible.categorie);
      const libelle = String(cible.libelle).toLowerCase();
      if (memeCategorie.some((t) => String(t.libelle).toLowerCase() === libelle)) return null;
      conditions.push(conditionCategorieInchangee(ctx.fermeId, l.id, cible.categorie ?? null, memeCategorie));
    }
    const r = et(...conditions);
    return (await tient(ctx.porte, r)) ? r : null;
  }

  // Ce que chaque ligne deviendrait : null = ignorée (déjà comme avant), 'laissee', ou les valeurs à remettre et la condition.
  type Decision = { readonly valeurs: Readonly<Record<string, Valeur>>; readonly condition: Condition } | 'laissee' | null;
  const decisions = await Promise.all(
    etat.lignes.map(async (l, i): Promise<Decision> => {
      const c = courante(l, i);
      if (c === null) return 'laissee';
      if (vaut(c, l.avant)) return null;
      const intacte = vaut(c, l.apres) && (c.supprime_le ?? null) === l.supprimeLe;
      if (!intacte) return 'laissee';
      const propres = await conditionsPropres(l, c);
      return propres === null ? 'laissee' : { valeurs: l.avant, condition: et(conditionIntacte(l), propres) };
    }),
  );
  const aRemettre = (d: Decision | undefined): Readonly<Record<string, Valeur>> => (d === null || d === undefined || d === 'laissee' ? {} : d.valeurs);

  // Chaque série touchée, telle qu'elle serait après l'annulation, vérifiée comme la fin de lot du serveur.
  const seriesLaissees = new Set<string>();
  const gardesSerie = new Map<string, Condition>();
  await Promise.all(
    seriesIds.map(async (id) => {
      const serie = seriesLues.find((x) => x.id === id);
      const indexSerie = etat.lignes.findIndex((l) => l.table === 'serie' && l.id === id);
      const decisionSerie = indexSerie < 0 ? null : decisions[indexSerie];
      if (serie === undefined || decisionSerie === 'laissee') {
        seriesLaissees.add(id);
        return;
      }
      const occupations = occupationsLues.filter((o) => o.serie_id === id);
      gardesSerie.set(id, conditionSerieInchangee(serie, occupations, iso));
      const apres = {
        serie: { ...serie, ...aRemettre(decisionSerie) },
        occupations: occupations.map((o) => {
          const i = etat.lignes.findIndex((l) => l.table === 'occupation' && l.id === o.id);
          return i < 0 ? o : { ...o, ...aRemettre(decisions[i]) };
        }),
      };
      if (!(await etatSerieValide(ctx.porte, { serie, occupations }, apres))) seriesLaissees.add(id);
    }),
  );

  const ordres: OrdreEcriture[] = [];
  let laissees = 0;
  const ordreTables: readonly Table[] = ['itineraire', 'serie', 'occupation', 'type_intervention'];
  for (const table of ordreTables) {
    etat.lignes.forEach((l, i) => {
      if (l.table !== table) return;
      const d = decisions[i];
      if (d === null || d === undefined) return;
      const serieId = serieDe(l);
      if (d === 'laissee' || (serieId !== null && seriesLaissees.has(serieId))) {
        laissees++;
        return;
      }
      const garde = serieId === null ? undefined : gardesSerie.get(serieId);
      const c = garde === undefined ? d.condition : et(d.condition, garde);
      ordres.push(ordreDe({ ...l, apres: d.valeurs }, iso, c.sql, c.parametres));
    });
  }
  await ctx.porte.ecrireEnsemble(ordres);
  return laissees === 0 ? null : messageModifieAilleurs(laissees);
}
