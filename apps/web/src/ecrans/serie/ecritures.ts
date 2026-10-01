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
import { entreeAnnulable, lireEtatSerie, lireModificationsOccupations, type EtatSerie, type Modification } from './donnees.ts';

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

// ── Ce qu'une écriture a changé (pour « Annuler », N5) ───────────────────────────────────────

/**
 * Une ligne écrite : les colonnes changées, leurs valeurs d'avant et celles que nous avons
 * écrites, et `supprime_le` après notre écriture. « Annuler » ne ramène que cela (règle de T24,
 * décision 9 : apps/web/src/ecrans/itineraires/ecritures.ts, `ramener`).
 */
export interface LigneEcrite {
  readonly table: 'serie' | 'occupation';
  readonly id: string;
  readonly avant: Readonly<Record<string, Valeur>>;
  readonly apres: Readonly<Record<string, Valeur>>;
  readonly supprimeLe: Valeur;
  /** Occupation insérée par nous : « Annuler » la supprime doucement. */
  readonly creee: boolean;
}

/** Ce qu'une saisie a écrit sur une série et ses occupations. */
export interface EcritureSerie {
  readonly serieId: string;
  readonly lignes: readonly LigneEcrite[];
}

/** Trace d'un UPDATE : les seules colonnes qui changent ; null si rien ne change. */
function trace(table: 'serie' | 'occupation', avant: Ligne, valeurs: Readonly<Record<string, Valeur>>): LigneEcrite | null {
  const changees = Object.keys(valeurs).filter((c) => (valeurs[c] ?? null) !== (avant[c] ?? null));
  if (changees.length === 0) return null;
  const a: Record<string, Valeur> = {};
  const b: Record<string, Valeur> = {};
  for (const c of changees) {
    a[c] = avant[c] ?? null;
    b[c] = valeurs[c] ?? null;
  }
  const supprimeLe = 'supprime_le' in b ? (b.supprime_le ?? null) : (avant.supprime_le ?? null);
  return { table, id: String(avant.id), avant: a, apres: b, supprimeLe, creee: false };
}

/** Trace d'une occupation insérée : ce qui compte pour la reconnaître intacte. */
function traceInsertion(o: Ligne): LigneEcrite {
  const apres = extraire(o, ['emplacement_id', 'longueur_m', 'prevu_du', 'prevu_au', 'supprime_le']);
  return { table: 'occupation', id: String(o.id), avant: {}, apres, supprimeLe: null, creee: true };
}

/** UPDATE des colonnes `valeurs` d'une ligne tracée. */
function ordreTrace(t: Pick<LigneEcrite, 'table' | 'id'>, valeurs: Readonly<Record<string, Valeur>>, iso: string): OrdreEcriture {
  const cles = Object.keys(valeurs);
  return { sql: `UPDATE ${t.table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, parametres: [...cles.map((c) => valeurs[c] ?? null), iso, t.id] };
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
export async function modifierSerie(ctx: ContexteEcriture, serieId: string, s: SerieAEcrire): Promise<EcritureSerie> {
  const avant = await lireEtatSerie(ctx.porte, serieId);
  if (avant === null) throw new SerieRefusee('série introuvable');
  const iso = ctx.maintenant().toISOString();
  const nouvelId = generateur(ctx.maintenant);
  const apresSerie: Ligne = { ...avant.serie, ...colonnesSerie(s), rotation_acceptee: s.rotationAcceptee, modifie_le: iso };
  const lue = serieValide(apresSerie);
  const ordres: OrdreEcriture[] = [];
  const lignes: LigneEcrite[] = [];
  const noter = (t: LigneEcrite | null) => {
    if (t === null) return;
    ordres.push(ordreTrace(t, t.apres, iso));
    lignes.push(t);
  };
  noter(trace('serie', avant.serie, extraire(apresSerie, COLONNES_SERIE)));

  const actives = avant.occupations.filter((o) => o.supprime_le === null);
  const gardees = new Set<string>();
  for (const e of s.emplacements) {
    const existante = actives.find((o) => o.emplacement_id === e.id && !gardees.has(String(o.id)));
    if (existante === undefined) {
      const o = nouvelleOccupation(ctx, nouvelId(), serieId, e, s.dates, iso);
      occupationValide(o, lue, true);
      ordres.push(inserer('occupation', o));
      lignes.push(traceInsertion(o));
      continue;
    }
    gardees.add(String(existante.id));
    const apres: Ligne = { ...existante, longueur_m: e.longueurM, prevu_du: s.dates.miseEnPlace, prevu_au: s.dates.finRecolte };
    occupationValide(apres, lue, true);
    noter(trace('occupation', existante, extraire(apres, COLONNES_OCCUPATION)));
  }
  for (const o of actives) {
    if (gardees.has(String(o.id))) continue;
    noter(trace('occupation', o, { supprime_le: iso }));
  }
  await ctx.porte.ecrireEnsemble(ordres);
  return { serieId, lignes };
}

// ── Annuler ──────────────────────────────────────────────────────────────────────────────────

/**
 * Annuler une création, dans les 10 s du bandeau : la série et ses occupations sont supprimées
 * doucement, même modifiées ailleurs entre-temps (c'est notre propre saisie ; décision 4 de T12b,
 * comme T24). Rien si elle est déjà supprimée.
 */
export async function supprimerSerieCreee(ctx: ContexteEcriture, serieId: string): Promise<null> {
  const courant = await lireEtatSerie(ctx.porte, serieId);
  if (courant === null) return null;
  const iso = ctx.maintenant().toISOString();
  const ordres: OrdreEcriture[] = [];
  const o = mettreAJour('serie', courant.serie, { supprime_le: courant.serie.supprime_le ?? iso }, iso);
  if (o !== null) ordres.push(o);
  for (const occ of courant.occupations) {
    const x = mettreAJour('occupation', occ, { supprime_le: occ.supprime_le ?? iso }, iso);
    if (x !== null) ordres.push(x);
  }
  if (ordres.length > 0) await ctx.porte.ecrireEnsemble(ordres);
  return null;
}

/**
 * Ramène la série à `cible`, en une transaction. Une occupation absente de `cible` est supprimée
 * doucement. Rend ce qui a été écrit (pour « Annuler » l'annulation).
 */
export async function ramenerSerie(ctx: ContexteEcriture, serieId: string, cible: EtatSerie): Promise<EcritureSerie> {
  const courant = await lireEtatSerie(ctx.porte, serieId);
  if (courant === null) return { serieId, lignes: [] };
  const iso = ctx.maintenant().toISOString();
  const lignes: LigneEcrite[] = [];
  const serie = serieValide({ ...courant.serie, ...extraire(cible.serie, COLONNES_SERIE) });
  const ts = trace('serie', courant.serie, extraire(cible.serie, COLONNES_SERIE));
  if (ts !== null) lignes.push(ts);
  const serieSupprimee = serie.supprimeLe !== null;
  for (const occ of courant.occupations) {
    const avant = cible.occupations.find((x) => x.id === occ.id);
    let valeurs: Record<string, Valeur>;
    if (avant === undefined) valeurs = { supprime_le: occ.supprime_le ?? iso };
    else {
      valeurs = extraire(avant, COLONNES_OCCUPATION);
      if (serieSupprimee && valeurs.supprime_le === null) valeurs.supprime_le = iso;
      if (valeurs.supprime_le === null) occupationValide({ ...occ, ...valeurs }, serie, true);
    }
    const t = trace('occupation', occ, valeurs);
    if (t !== null) lignes.push(t);
  }
  if (lignes.length > 0) await ctx.porte.ecrireEnsemble(lignes.map((t) => ordreTrace(t, t.apres, iso)));
  return { serieId, lignes };
}

/** Références d'une série, revérifiées par le serveur quand l'une d'elles change. */
const REFERENCES_SERIE = [
  { colonne: 'espece_id', table: 'espece' },
  { colonne: 'variete_id', table: 'variete' },
  { colonne: 'itineraire_id', table: 'itineraire' },
  { colonne: 'saison_id', table: 'saison' },
] as const;

/**
 * L'état d'une série après une écriture, vérifié comme la fin de lot du serveur
 * (apps/api/src/sync/serie.ts ; décision 10 de T12b) :
 *   - la série passe validerSerie ;
 *   - si l'espèce, la variété, l'itinéraire ou la saison change par rapport à `avant`, chacune de
 *     ces références existe et n'est pas supprimée sur ce téléphone (le serveur les revérifie
 *     alors toutes ; inchangées, une variété supprimée depuis reste acceptée, N2) ;
 *   - aucune occupation active sous une série supprimée ;
 *   - chaque occupation active passe validerOccupation avec la série d'après.
 */
export async function etatSerieValide(porte: PorteDonnees, avant: Ligne, serie: Ligne, occupations: readonly Ligne[]): Promise<boolean> {
  const r = validerSerie({ ...serie });
  if (!r.ok) return false;
  const actives = occupations.filter((o) => o.supprime_le === null);
  if (r.valeur.supprimeLe !== null) return actives.length === 0;
  if (!actives.every((o) => validerOccupation({ ...o }, r.valeur, { datesDeLaSerie: true }).ok)) return false;
  if (REFERENCES_SERIE.every(({ colonne }) => (serie[colonne] ?? null) === (avant[colonne] ?? null))) return true;
  const presentes = await Promise.all(
    REFERENCES_SERIE.map(async ({ colonne, table }) => {
      const id = serie[colonne] ?? null;
      if (id === null) return colonne === 'variete_id';
      const l = await porte.lire<Ligne>(`SELECT id FROM ${table} WHERE id = ? AND supprime_le IS NULL`, [id]);
      return l.length > 0;
    }),
  );
  return presentes.every(Boolean);
}

/** Message d'une annulation incomplète (N5, règle de T24) : contient « modifié entre-temps ». */
export function messageModifieAilleurs(n: number): string {
  return `ce qui a été modifié entre-temps sur un autre téléphone est gardé tel quel (${String(n)} ${n > 1 ? 'lignes' : 'ligne'})`;
}

/**
 * « Annuler » du bandeau (N5, règle de T24, décision 9), en UNE transaction, colonne par colonne :
 *   - une ligne n'est ramenée que si chaque colonne que nous avions changée vaut encore ce que
 *     nous avions écrit et que personne ne l'a supprimée (ni ressuscitée) ; ramenée, seules ces
 *     colonnes reprennent leur valeur d'avant (ce qu'un autre téléphone a changé ailleurs reste) ;
 *   - une ligne que notre écriture n'a finalement pas changée (elle vaut déjà l'avant) est ignorée ;
 *   - l'état d'après l'annulation (série et toutes ses occupations : écrites ailleurs, laissées,
 *     ramenées) doit passer `etatSerieValide`, comme en fin de lot au serveur ; sinon la série
 *     reste telle quelle, et ses occupations aussi (décisions 3, 7 et 10).
 * Rend le message à montrer si des lignes ont été laissées, sinon null.
 */
export async function defaireSerie(ctx: ContexteEcriture, ecriture: EcritureSerie): Promise<string | null> {
  if (ecriture.lignes.length === 0) return null;
  const courant = await lireEtatSerie(ctx.porte, ecriture.serieId);
  if (courant === null) return messageModifieAilleurs(ecriture.lignes.length);
  const iso = ctx.maintenant().toISOString();
  const vaut = (c: Ligne, valeurs: Readonly<Record<string, Valeur>>) => Object.keys(valeurs).every((k) => (c[k] ?? null) === (valeurs[k] ?? null));
  const ligneCourante = (l: LigneEcrite): Ligne | null => (l.table === 'serie' ? courant.serie : (courant.occupations.find((o) => o.id === l.id) ?? null));

  // Ce que chaque ligne deviendrait : null = ignorée (déjà comme avant), 'laissee', ou les valeurs à remettre.
  type Decision = Readonly<Record<string, Valeur>> | 'laissee' | null;
  const aRemettre = (d: Decision | undefined): Readonly<Record<string, Valeur>> => (d === null || d === undefined || d === 'laissee' ? {} : d);
  const decisions = ecriture.lignes.map((l): Decision => {
    const c = ligneCourante(l);
    if (c === null) return 'laissee';
    if (!l.creee && vaut(c, l.avant)) return null;
    const intacte = vaut(c, l.apres) && (c.supprime_le ?? null) === l.supprimeLe;
    if (!intacte) return 'laissee';
    return l.creee ? { supprime_le: iso } : l.avant;
  });

  const indexSerie = ecriture.lignes.findIndex((l) => l.table === 'serie');
  const decisionSerie = indexSerie < 0 ? null : decisions[indexSerie];
  // La série et ses occupations telles qu'elles seraient après l'annulation, vérifiées comme la
  // fin de lot du serveur (décision 10) ; sinon tout reste tel quel.
  const serieApres = { ...courant.serie, ...aRemettre(decisionSerie) };
  const occupationsApres = courant.occupations.map((o) => {
    const i = ecriture.lignes.findIndex((l) => l.table === 'occupation' && l.id === o.id);
    return i < 0 ? o : { ...o, ...aRemettre(decisions[i]) };
  });
  const serieLaissee = decisionSerie === 'laissee' || !(await etatSerieValide(ctx.porte, courant.serie, serieApres, occupationsApres));

  const ordres: OrdreEcriture[] = [];
  let laissees = 0;
  ecriture.lignes.forEach((l, i) => {
    const d = decisions[i];
    if (d === null || d === undefined) return;
    if (d === 'laissee' || serieLaissee) {
      laissees++;
      return;
    }
    ordres.push(ordreTrace(l, d, iso));
  });
  if (ordres.length > 0) await ctx.porte.ecrireEnsemble(ordres);
  return laissees === 0 ? null : messageModifieAilleurs(laissees);
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
 * Rend ce qui a été écrit (pour annuler l'annulation).
 */
export async function annulerEntree(ctx: ContexteEcriture, serieId: string, entree: Modification): Promise<EcritureSerie> {
  // Seule une création mène à la suppression douce ; un `avant` illisible ne s'annule pas.
  if (!entreeAnnulable(entree)) throw new SerieRefusee('cette ligne de l’historique est illisible');
  const courant = await lireEtatSerie(ctx.porte, serieId);
  if (courant === null) throw new SerieRefusee('série introuvable');
  const modifications = await lireModificationsOccupations(ctx.porte, serieId);
  const serie =
    entree.operation === 'creation'
      ? { ...courant.serie, supprime_le: courant.serie.supprime_le ?? ctx.maintenant().toISOString() }
      : depuisPostgres(entree.avant ?? {}, COLONNES_SERIE, courant.serie);
  const occupations = courant.occupations.map((occ) => {
    // La plus ancienne ligne de cette occupation depuis l'horodatage de l'entrée.
    const premiere = modifications.find((m) => m.ligneId === occ.id && m.instant >= entree.instant);
    if (premiere === undefined) return occ;
    if (premiere.operation === 'creation') return { ...occ, supprime_le: occ.supprime_le ?? ctx.maintenant().toISOString() };
    if (premiere.avant === null) throw new SerieRefusee('une ligne de l’historique d’une planche est illisible');
    return depuisPostgres(premiere.avant, COLONNES_OCCUPATION, occ);
  });
  return ramenerSerie(ctx, serieId, { serie, occupations });
}
