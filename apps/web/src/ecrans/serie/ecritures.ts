/**
 * Écritures du formulaire d'une série (T12), toutes par la porte. Une saisie = UNE transaction
 * (`porte.ecrireEnsemble`) : la série PUIS ses occupations. Règles du serveur :
 * apps/api/src/sync/serie.ts (T10e), rejouées ici avant d'écrire (`validerSerie`,
 * `validerOccupation`) : une ligne que le serveur refuserait n'entre jamais dans la file d'envoi.
 *
 * Jamais d'écriture dans `modification` (le serveur seul l'écrit), jamais de DELETE ni de
 * REPLACE : une suppression pose `supprime_le`. Jamais d'écriture sur une occupation qui n'est pas
 * celle de la série (plantation, couverture). Identifiants : UUID v7.
 */
import { creerGenerateurId, validerOccupation, validerSerie, type DatesSerie, type Serie, type TypeAncreSerie } from '@planif/core';
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';
import { lireEtatSerie, lireModificationsOccupations, type EtatSerie, type Modification } from './donnees.ts';

/** Une ligne refusée par les règles du serveur : jamais écrite. */
export class SerieRefusee extends Error {}

type Valeur = string | number | null;
type Ligne = Readonly<Record<string, Valeur>>;

/** Colonnes d'une série écrites par le téléphone (hors id, ferme et horodatages). */
const COLONNES_SERIE = [
  'saison_id',
  'espece_id',
  'variete_id',
  'itineraire_id',
  'parametres',
  'ancre_type',
  'ancre_date',
  'prevu_semis_pepiniere',
  'prevu_mise_en_place',
  'prevu_debut_recolte',
  'prevu_fin_recolte',
  'longueur_m',
  'nombre_plants',
  'statut',
  'rotation_acceptee',
  'supprime_le',
] as const;

const COLONNES_OCCUPATION = [
  'emplacement_id',
  'serie_id',
  'plantation_id',
  'evenement_id',
  'longueur_m',
  'nombre_places',
  'position_m',
  'prevu_du',
  'prevu_au',
  'reel_du',
  'reel_au',
  'supprime_le',
] as const;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface ContexteEcriture {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant: () => Date;
}

/** Générateur d'UUID v7 sur l'horloge du formulaire. */
export function generateur(maintenant: () => Date): () => string {
  const nouvel = creerGenerateurId({ horloge: () => maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  return () => nouvel<'Serie'>();
}

function serieValide(l: Ligne): Serie {
  const r = validerSerie({ ...l });
  if (!r.ok) throw new SerieRefusee(r.erreur.message);
  return r.valeur;
}

function occupationValide(l: Ligne, serie: Serie, datesDeLaSerie: boolean): void {
  const r = validerOccupation({ ...l }, serie, { datesDeLaSerie });
  if (!r.ok) throw new SerieRefusee(r.erreur.message);
}

function inserer(table: 'serie' | 'occupation', l: Ligne): OrdreEcriture {
  const colonnes = Object.keys(l);
  return { sql: `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, parametres: colonnes.map((c) => l[c] ?? null) };
}

/** UPDATE des seules colonnes changées (et modifie_le) ; null si rien ne change. */
function mettreAJour(table: 'serie' | 'occupation', avant: Ligne, apres: Ligne, horodatage: string): OrdreEcriture | null {
  const changees = Object.keys(apres).filter((c) => (apres[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return null;
  return {
    sql: `UPDATE ${table} SET ${changees.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`,
    parametres: [...changees.map((c) => apres[c] ?? null), horodatage, avant.id ?? null],
  };
}

function extraire(l: Ligne, colonnes: readonly string[]): Record<string, Valeur> {
  const r: Record<string, Valeur> = {};
  for (const c of colonnes) r[c] = l[c] ?? null;
  return r;
}

// ── Enregistrer ──────────────────────────────────────────────────────────────────────────────

export interface SerieAEcrire {
  readonly saisonId: string;
  readonly especeId: string;
  readonly varieteId: string | null;
  readonly itineraireId: string;
  /** Instantané fidèle (texte JSON de l'itinéraire, jamais retouché). */
  readonly parametresTexte: string;
  readonly ancre: TypeAncreSerie;
  readonly ancreDate: string;
  readonly dates: DatesSerie;
  /** Planches et longueurs (m). */
  readonly emplacements: readonly { readonly id: string; readonly longueurM: number }[];
  readonly longueurTotale: number;
  /** Texte JSON de la décision de rotation, ou null. */
  readonly rotationAcceptee: string | null;
}

function colonnesSerie(s: SerieAEcrire): Record<string, Valeur> {
  return {
    saison_id: s.saisonId,
    espece_id: s.especeId,
    variete_id: s.varieteId,
    itineraire_id: s.itineraireId,
    parametres: s.parametresTexte,
    ancre_type: s.ancre,
    ancre_date: s.ancreDate,
    prevu_semis_pepiniere: s.dates.semisPepiniere ?? null,
    prevu_mise_en_place: s.dates.miseEnPlace,
    prevu_debut_recolte: s.dates.debutRecolte,
    prevu_fin_recolte: s.dates.finRecolte,
    longueur_m: s.longueurTotale,
    nombre_plants: null,
  };
}

function nouvelleOccupation(ctx: ContexteEcriture, id: string, serieId: string, e: { readonly id: string; readonly longueurM: number }, d: DatesSerie, iso: string): Ligne {
  return {
    id,
    ferme_id: ctx.fermeId,
    emplacement_id: e.id,
    serie_id: serieId,
    plantation_id: null,
    evenement_id: null,
    longueur_m: e.longueurM,
    nombre_places: null,
    position_m: null,
    prevu_du: d.miseEnPlace,
    prevu_au: d.finRecolte,
    reel_du: null,
    reel_au: null,
    cree_le: iso,
    modifie_le: iso,
    supprime_le: null,
  };
}

/** Création : INSERT serie puis une INSERT occupation par planche. Rend l'id de la série. */
export async function creerSerie(ctx: ContexteEcriture, s: SerieAEcrire): Promise<string> {
  const iso = ctx.maintenant().toISOString();
  const nouvelId = generateur(ctx.maintenant);
  const id = nouvelId();
  const serie: Ligne = {
    id,
    ferme_id: ctx.fermeId,
    ...colonnesSerie(s),
    statut: 'prevue',
    rotation_acceptee: s.rotationAcceptee,
    cree_le: iso,
    modifie_le: iso,
    supprime_le: null,
  };
  const lue = serieValide(serie);
  const ordres: OrdreEcriture[] = [inserer('serie', serie)];
  for (const e of s.emplacements) {
    const o = nouvelleOccupation(ctx, nouvelId(), id, e, s.dates, iso);
    occupationValide(o, lue, true);
    ordres.push(inserer('occupation', o));
  }
  await ctx.porte.ecrireEnsemble(ordres);
  return id;
}

/**
 * Modification : UPDATE serie (colonnes changées) puis les occupations : UPDATE de celles des
 * planches gardées, INSERT pour une planche ajoutée, suppression douce pour une planche retirée.
 * Rend l'état d'avant (pour « Annuler »).
 */
export async function modifierSerie(ctx: ContexteEcriture, serieId: string, s: SerieAEcrire): Promise<EtatSerie> {
  const avant = await lireEtatSerie(ctx.porte, serieId);
  if (avant === null) throw new SerieRefusee('série introuvable');
  const iso = ctx.maintenant().toISOString();
  const nouvelId = generateur(ctx.maintenant);
  const apresSerie: Ligne = { ...avant.serie, ...colonnesSerie(s), rotation_acceptee: s.rotationAcceptee, modifie_le: iso };
  const lue = serieValide(apresSerie);
  const ordres: OrdreEcriture[] = [];
  const ordreSerie = mettreAJour('serie', avant.serie, extraire(apresSerie, COLONNES_SERIE), iso);
  if (ordreSerie !== null) ordres.push(ordreSerie);

  const actives = avant.occupations.filter((o) => o.supprime_le === null);
  const gardees = new Set<string>();
  for (const e of s.emplacements) {
    const existante = actives.find((o) => o.emplacement_id === e.id && !gardees.has(String(o.id)));
    if (existante === undefined) {
      const o = nouvelleOccupation(ctx, nouvelId(), serieId, e, s.dates, iso);
      occupationValide(o, lue, true);
      ordres.push(inserer('occupation', o));
      continue;
    }
    gardees.add(String(existante.id));
    const apres: Ligne = { ...existante, longueur_m: e.longueurM, prevu_du: s.dates.miseEnPlace, prevu_au: s.dates.finRecolte };
    occupationValide(apres, lue, true);
    const ordre = mettreAJour('occupation', existante, extraire(apres, COLONNES_OCCUPATION), iso);
    if (ordre !== null) ordres.push(ordre);
  }
  for (const o of actives) {
    if (gardees.has(String(o.id))) continue;
    const ordre = mettreAJour('occupation', o, { supprime_le: iso }, iso);
    if (ordre !== null) ordres.push(ordre);
  }
  await ctx.porte.ecrireEnsemble(ordres);
  return avant;
}

// ── Annuler ──────────────────────────────────────────────────────────────────────────────────

/**
 * Ramène la série à `cible` (null : elle n'existait pas → suppression douce de la série et de ses
 * occupations), en une transaction. Une occupation absente de `cible` est supprimée doucement.
 */
export async function ramenerSerie(ctx: ContexteEcriture, serieId: string, cible: EtatSerie | null): Promise<void> {
  const courant = await lireEtatSerie(ctx.porte, serieId);
  if (courant === null) return;
  const iso = ctx.maintenant().toISOString();
  const ordres: OrdreEcriture[] = [];
  if (cible === null) {
    const o = mettreAJour('serie', courant.serie, { supprime_le: courant.serie.supprime_le ?? iso }, iso);
    if (o !== null) ordres.push(o);
    for (const occ of courant.occupations) {
      const x = mettreAJour('occupation', occ, { supprime_le: occ.supprime_le ?? iso }, iso);
      if (x !== null) ordres.push(x);
    }
  } else {
    const serie = serieValide({ ...courant.serie, ...extraire(cible.serie, COLONNES_SERIE) });
    const o = mettreAJour('serie', courant.serie, extraire(cible.serie, COLONNES_SERIE), iso);
    if (o !== null) ordres.push(o);
    const seriesSupprimee = serie.supprimeLe !== null;
    for (const occ of courant.occupations) {
      const avant = cible.occupations.find((x) => x.id === occ.id);
      let valeurs: Record<string, Valeur>;
      if (avant === undefined) valeurs = { supprime_le: occ.supprime_le ?? iso };
      else {
        valeurs = extraire(avant, COLONNES_OCCUPATION);
        if (seriesSupprimee && valeurs.supprime_le === null) valeurs.supprime_le = iso;
        if (valeurs.supprime_le === null) occupationValide({ ...occ, ...valeurs }, serie, true);
      }
      const x = mettreAJour('occupation', occ, valeurs, iso);
      if (x !== null) ordres.push(x);
    }
  }
  await ctx.porte.ecrireEnsemble(ordres);
}

/** Valeur d'un `avant` de Postgres (to_jsonb) au format local : jsonb en texte, instants en toISOString. */
function valeurLocale(colonne: string, v: unknown): Valeur {
  if (v === null || v === undefined) return null;
  if (colonne === 'parametres' || colonne === 'rotation_acceptee') return typeof v === 'string' ? v : JSON.stringify(v);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (INSTANT.test(v)) {
      const t = Date.parse(v.replace(/(\.\d{3})\d+/, '$1'));
      return Number.isNaN(t) ? v : new Date(t).toISOString();
    }
    return v;
  }
  return JSON.stringify(v);
}

function depuisPostgres(avant: Readonly<Record<string, unknown>>, colonnes: readonly string[], base: Ligne): Ligne {
  const r: Record<string, Valeur> = { ...base };
  for (const c of colonnes) if (c in avant) r[c] = valeurLocale(c, avant[c]);
  return r;
}

/**
 * Annuler l'entrée `entree` de l'historique : la série et ses occupations reviennent à leur état
 * juste avant son horodatage (ce qui défait aussi les entrées plus récentes), en une transaction.
 * Rend l'état d'avant l'annulation (pour annuler l'annulation).
 */
export async function annulerEntree(ctx: ContexteEcriture, serieId: string, entree: Modification): Promise<EtatSerie | null> {
  const courant = await lireEtatSerie(ctx.porte, serieId);
  if (courant === null) throw new SerieRefusee('série introuvable');
  const modifications = await lireModificationsOccupations(ctx.porte, serieId);
  const serie =
    entree.operation === 'creation' || entree.avant === null
      ? { ...courant.serie, supprime_le: courant.serie.supprime_le ?? ctx.maintenant().toISOString() }
      : depuisPostgres(entree.avant, COLONNES_SERIE, courant.serie);
  const occupations = courant.occupations.map((occ) => {
    // La plus ancienne ligne de cette occupation depuis l'horodatage de l'entrée.
    const premiere = modifications.find((m) => m.ligneId === occ.id && m.instant >= entree.instant);
    if (premiere === undefined) return occ;
    if (premiere.operation === 'creation' || premiere.avant === null) return { ...occ, supprime_le: occ.supprime_le ?? ctx.maintenant().toISOString() };
    return depuisPostgres(premiere.avant, COLONNES_OCCUPATION, occ);
  });
  await ramenerSerie(ctx, serieId, { serie, occupations });
  return courant;
}
