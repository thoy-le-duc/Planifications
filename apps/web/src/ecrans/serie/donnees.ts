/**
 * Lectures du formulaire d'une série (T12), toutes par la porte : la bibliothèque de la ferme
 * (et la commune, ferme_id nul), le parcellaire, les occupations et l'assolement passé pour les
 * conflits et la rotation, la série modifiée et son historique (lignes `modification` écrites
 * par le serveur).
 */
import type { DateCalendaire, Emplacement, HierarchieParcellaire, Id, Instant, OccupationHistorique } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import { versEmplacement, versOccupation } from '../plan/calculs.ts';
import { comparerNoms, libelleCulture, versAssolement, type Bibliotheque, type EspeceLue, type FamilleLue, type OccupationLue, type PlancheLue } from './calculs.ts';

export type LigneLocale = Readonly<Record<string, string | number | null>>;

const texte = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const texteOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nombreOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Tables lues par la bibliothèque (le formulaire ne les surveille pas : il se lit à l'ouverture). */
const SQL = {
  famille: 'SELECT id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans FROM famille WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL',
  espece:
    'SELECT id, nom, famille_id, delai_retour_minimal_ans, delai_retour_conseille_ans FROM espece WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL',
  variete: 'SELECT id, espece_id, nom, poids_mille_graines_g, taux_germination FROM variete WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL',
  itineraire: 'SELECT id, espece_id, variete_id, nom, parametres FROM itineraire WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL',
  zone: 'SELECT id, nom, zone_parente_id FROM zone WHERE ferme_id = ? AND supprime_le IS NULL',
  emplacement: 'SELECT * FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL',
  saison: 'SELECT id, debut, fin FROM saison WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY debut, id',
  occupation: `SELECT o.*, COALESCE(s.espece_id, p.espece_id) AS espece_id_occupant, COALESCE(s.variete_id, p.variete_id) AS variete_id_occupant
    FROM occupation o
    LEFT JOIN serie s ON s.id = o.serie_id
    LEFT JOIN plantation p ON p.id = o.plantation_id
    WHERE o.ferme_id = ? AND o.supprime_le IS NULL`,
  assolement: 'SELECT * FROM assolement WHERE ferme_id = ? AND supprime_le IS NULL',
} as const;

function delais(l: LigneLocale): { readonly minimalAns: number; readonly conseilleAns: number } | null {
  const min = nombreOuNul(l.delai_retour_minimal_ans);
  const cons = nombreOuNul(l.delai_retour_conseille_ans);
  return min === null || cons === null ? null : { minimalAns: min, conseilleAns: cons };
}

function remplaces(v: unknown): Id<'Emplacement'>[] {
  if (typeof v !== 'string') return [];
  try {
    const r = JSON.parse(v) as unknown;
    return Array.isArray(r) ? r.filter((x): x is Id<'Emplacement'> => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Planche proposée : de sorte « planche », active aujourd'hui ou plus tard. */
const proposee = (l: LigneLocale, aujourdhui: string): boolean => l.sorte === 'planche' && (l.actif_au === null || texte(l.actif_au) > aujourdhui);

/** Toute la bibliothèque du formulaire, lue en une fois (requêtes en parallèle). */
export async function lireBibliotheque(porte: PorteDonnees, fermeId: string, aujourdhui: string): Promise<Bibliotheque> {
  const lire = (sql: string) => porte.lire<LigneLocale>(sql, [fermeId]);
  const [familles, especes, varietes, itineraires, zones, emplacements, saisons, occupations, assolements] = await Promise.all([
    lire(SQL.famille),
    lire(SQL.espece),
    lire(SQL.variete),
    lire(SQL.itineraire),
    lire(SQL.zone),
    lire(SQL.emplacement),
    lire(SQL.saison),
    lire(SQL.occupation),
    lire(SQL.assolement),
  ]);

  const parFamille = new Map<string, FamilleLue>();
  for (const f of familles) {
    const d = delais(f);
    parFamille.set(texte(f.id), { id: texte(f.id), nom: texte(f.nom), minimalAns: d?.minimalAns ?? 0, conseilleAns: d?.conseilleAns ?? 0 });
  }
  const especesLues: EspeceLue[] = especes.map((e) => ({ id: texte(e.id), nom: texte(e.nom), familleId: texte(e.famille_id), delais: delais(e) }));
  const especesParId = new Map(especesLues.map((e) => [e.id, e]));
  const varietesLues = varietes
    .filter((v) => especesParId.has(texte(v.espece_id)))
    .map((v) => ({
      id: texte(v.id),
      especeId: texte(v.espece_id),
      nom: texte(v.nom),
      pmgG: nombreOuNul(v.poids_mille_graines_g),
      germination: nombreOuNul(v.taux_germination),
    }));
  const varietesParId = new Map(varietesLues.map((v) => [v.id, v]));
  const nomsZones = new Map(zones.map((z) => [texte(z.id), texte(z.nom)]));

  const parEmplacement = new Map<string, Emplacement>();
  const planches: PlancheLue[] = [];
  for (const l of emplacements) {
    const e = versEmplacement(l);
    parEmplacement.set(e.id, e);
    if (l.sorte !== 'planche') continue;
    planches.push({ id: e.id, code: e.code, zoneId: e.zoneId, nomZone: nomsZones.get(e.zoneId) ?? '', longueurM: e.longueurM, proposee: proposee(l, aujourdhui), emplacement: e });
  }
  planches.sort((a, b) => comparerNoms(a.code, b.code) || (a.id < b.id ? -1 : 1));

  const occupationsPar = new Map<string, OccupationLue[]>();
  const historique: OccupationHistorique[] = [];
  for (const l of occupations) {
    const emplacement = parEmplacement.get(texte(l.emplacement_id));
    if (emplacement === undefined) continue;
    const occupation = versOccupation(l, emplacement);
    const especeId = texteOuNul(l.espece_id_occupant);
    const espece = especeId === null ? undefined : especesParId.get(especeId);
    const varieteId = texteOuNul(l.variete_id_occupant);
    const variete = varieteId === null ? undefined : varietesParId.get(varieteId);
    const libelle = espece === undefined ? (l.evenement_id === null ? 'Culture' : 'Couverture') : libelleCulture({ nomEspece: espece.nom, nomVariete: variete?.nom ?? null });
    const lue: OccupationLue = { occupation, serieId: texteOuNul(l.serie_id), libelle };
    const liste = occupationsPar.get(emplacement.id);
    if (liste === undefined) occupationsPar.set(emplacement.id, [lue]);
    else liste.push(lue);
    if (espece !== undefined) historique.push({ occupation, especeId: espece.id as Id<'Espece'>, familleId: espece.familleId as Id<'Famille'> });
  }

  const hierarchie: HierarchieParcellaire = {
    zones: zones.map((z) => ({ id: texte(z.id) as Id<'Zone'>, zoneParenteId: texteOuNul(z.zone_parente_id) as Id<'Zone'> | null })),
    emplacements: emplacements.map((l) => ({ id: texte(l.id) as Id<'Emplacement'>, zoneId: texte(l.zone_id) as Id<'Zone'>, remplace: remplaces(l.remplace) })),
  };
  const saisonsLues = saisons.map((s) => ({ id: texte(s.id), debut: texte(s.debut), fin: texte(s.fin) }));

  return {
    especes: especesLues,
    varietes: varietesLues,
    familles: parFamille,
    itineraires: itineraires
      .filter((i) => especesParId.has(texte(i.espece_id)))
      .map((i) => ({ id: texte(i.id), especeId: texte(i.espece_id), varieteId: texteOuNul(i.variete_id), nom: texte(i.nom), parametresTexte: texte(i.parametres) })),
    planches,
    zones: nomsZones,
    saisons: saisonsLues,
    occupationsPar,
    historique: {
      occupations: historique,
      assolements: assolements.flatMap((a) => {
        const lu = versAssolement(a);
        return lu === null ? [] : [lu];
      }),
      saisons: saisonsLues.map((s) => ({ id: s.id as Id<'Saison'>, fin: s.fin as DateCalendaire })),
    },
    hierarchie,
  };
}

// ── Série modifiée ───────────────────────────────────────────────────────────────────────────

/** Une série et ses occupations (toutes, supprimées comprises), lignes locales. */
export interface EtatSerie {
  readonly serie: LigneLocale;
  readonly occupations: readonly LigneLocale[];
}

export async function lireEtatSerie(porte: PorteDonnees, serieId: string): Promise<EtatSerie | null> {
  const [series, occupations] = await Promise.all([
    porte.lire<LigneLocale>('SELECT * FROM serie WHERE id = ?', [serieId]),
    porte.lire<LigneLocale>('SELECT * FROM occupation WHERE serie_id = ? ORDER BY id', [serieId]),
  ]);
  const serie = series[0];
  return serie === undefined ? null : { serie, occupations };
}

// ── Historique (lignes `modification`, écrites par le serveur) ───────────────────────────────

export type OperationModification = 'creation' | 'modification' | 'suppression';

export interface Modification {
  readonly id: string;
  readonly nomTable: string;
  readonly ligneId: string;
  readonly operation: OperationModification;
  /** Horodatage du serveur, en millisecondes. */
  readonly instant: Instant;
  readonly horodatage: string;
  readonly avant: Readonly<Record<string, unknown>> | null;
  readonly apres: Readonly<Record<string, unknown>> | null;
}

function jsonObjet(v: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof v !== 'string') return null;
  try {
    const r = JSON.parse(v) as unknown;
    return typeof r === 'object' && r !== null && !Array.isArray(r) ? (r as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Instant d'un horodatage de Postgres (« …+00:00 », microsecondes comprises), en ms. */
export function instantDe(horodatage: string): number {
  const ramene = horodatage.replace(/(\.\d{3})\d+/, '$1');
  return Date.parse(ramene);
}

export function versModification(l: Readonly<Record<string, unknown>>): Modification {
  const op = l.operation;
  const horodatage = texte(l.horodatage);
  return {
    id: texte(l.id),
    nomTable: texte(l.nom_table),
    ligneId: texte(l.ligne_id),
    operation: op === 'creation' || op === 'suppression' ? op : 'modification',
    instant: instantDe(horodatage),
    horodatage,
    avant: jsonObjet(l.avant),
    apres: jsonObjet(l.apres),
  };
}

/** Historique de la série, le plus récent d'abord (requête surveillée par le formulaire). */
export const requeteHistorique = (serieId: string) => ({
  sql: `SELECT * FROM modification WHERE nom_table = 'Serie' AND ligne_id = ? AND supprime_le IS NULL ORDER BY horodatage DESC, id DESC`,
  parametres: [serieId],
  tables: ['modification'],
  convertir: versModification,
});

/** Lignes `modification` des occupations de la série. */
export async function lireModificationsOccupations(porte: PorteDonnees, serieId: string): Promise<Modification[]> {
  const lignes = await porte.lire<Readonly<Record<string, unknown>>>(
    `SELECT * FROM modification WHERE nom_table = 'Occupation' AND supprime_le IS NULL
       AND ligne_id IN (SELECT id FROM occupation WHERE serie_id = ?)
     ORDER BY horodatage, id`,
    [serieId],
  );
  return lignes.map(versModification);
}
