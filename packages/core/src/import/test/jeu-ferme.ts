/**
 * Ferme complète pour la mesure de T14, au volume de T07 (30 zones, 400 emplacements, 5 saisons,
 * 3 000 séries), au format des lignes de la base locale (`LigneLocale`) : c'est l'export T15
 * (`preparerExport`, déjà dans le cœur) qui en fait les CSV que le moteur d'import relit.
 *
 * Écrit ici plutôt que repris de packages/sync/src/test/jeu-t07.ts : le cœur ne dépend pas de
 * @planif/sync. Déterministe (mulberry32 amorcé), sans objet Date.
 */
import type { Reference } from './contrat.ts';

type Valeur = string | number | null;
type Ligne = Record<string, Valeur>;

export const VOLUMES = { zones: 30, emplacements: 400, saisons: 5, series: 3_000 } as const;

function creerAlea(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const deux = (n: number) => String(n).padStart(2, '0');

/** 'AAAA-MM-JJ' d'un rang de jour dans une année non bissextile (0..364), sans Date. */
function jourDe(annee: number, rang: number): string {
  const mois = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let r = rang;
  for (let m = 0; m < 12; m++) {
    const n = mois[m] ?? 30;
    if (r < n) return `${String(annee)}-${deux(m + 1)}-${deux(r + 1)}`;
    r -= n;
  }
  return `${String(annee)}-12-31`;
}

const NOMS_ESPECES = [
  'Tomate', 'Aubergine', 'Poivron', 'Courgette', 'Concombre', 'Melon', 'Courge butternut', 'Potimarron',
  'Laitue', 'Batavia', 'Chicorée frisée', 'Scarole', 'Épinard', 'Blette', 'Betterave', 'Carotte',
  'Panais', 'Céleri-rave', 'Persil', 'Fenouil', 'Poireau', 'Oignon', 'Ail', 'Échalote',
  'Chou pommé', 'Chou-fleur', 'Brocoli', 'Chou kale', 'Radis', 'Navet', 'Roquette', 'Mâche',
  'Haricot vert', 'Pois', 'Fève', 'Basilic', 'Fraisier', 'Pivoine', 'Asperge', 'Maïs doux',
];

export interface FermeComplete {
  readonly fermeId: string;
  /** Lignes de chaque table, comme la base locale les rend (entrée de preparerExport). */
  readonly tables: Readonly<Record<string, readonly Ligne[]>>;
  /** Bibliothèque des espèces (identifiant et nom), pour rapprocher les cultures. */
  readonly especes: readonly Reference[];
}

export function fermeComplete(graine = 7): FermeComplete {
  const alea = creerAlea(graine);
  let compteur = 0;
  const uuid = (espace: string) => `0192f0c1-7a6e-7cc3-${espace}-${(++compteur).toString(16).padStart(12, '0')}`;
  const entier = (min: number, max: number) => min + Math.floor(alea() * (max - min + 1));
  const choisir = <T>(liste: readonly T[]): T => {
    const v = liste[Math.floor(alea() * liste.length)];
    if (v === undefined) throw new Error('liste vide');
    return v;
  };
  const fermeId = uuid('a000');
  const horo = { cree_le: '2026-09-01T06:00:00.000Z', modifie_le: '2026-09-01T06:00:00.000Z', supprime_le: null };

  const espece: Ligne[] = NOMS_ESPECES.map((nom) => ({
    id: uuid('c000'),
    ferme_id: null,
    famille_id: null,
    nom,
    categorie: 'legume',
    perenne: 0,
    unite_recolte: 'kg',
    delai_retour_minimal_ans: null,
    delai_retour_conseille_ans: null,
    ...horo,
  }));

  const zone: Ligne[] = [];
  for (let z = 0; z < VOLUMES.zones; z++) {
    zone.push({ id: uuid('a001'), ferme_id: fermeId, nom: `Zone ${deux(z + 1)}`, zone_parente_id: null, type_abri: choisir(['plein_champ', 'tunnel', 'serre']), surface_m2: entier(100, 2000), ...horo });
  }

  const emplacement: Ligne[] = [];
  for (let e = 0; e < VOLUMES.emplacements; e++) {
    const z = zone[e % VOLUMES.zones];
    const gouttiere = e % 25 === 0;
    emplacement.push({
      id: uuid('a002'),
      ferme_id: fermeId,
      zone_id: z?.id ?? null,
      code: `Z${deux((e % VOLUMES.zones) + 1)}-P${String(e + 1).padStart(3, '0')}`,
      sorte: gouttiere ? 'gouttiere' : 'planche',
      longueur_m: entier(100, 500) / 10,
      largeur_m: gouttiere ? null : choisir([0.8, 1.2]),
      nombre_places: gouttiere ? entier(40, 120) : null,
      actif_du: '2023-01-01',
      actif_au: null,
      remplace: '[]',
      ...horo,
    });
  }

  const saison: Ligne[] = [];
  for (let s = 0; s < VOLUMES.saisons; s++) {
    const annee = 2023 + s;
    saison.push({ id: uuid('a003'), ferme_id: fermeId, nom: String(annee), debut: `${String(annee)}-01-01`, fin: `${String(annee)}-12-31`, ...horo });
  }

  const serie: Ligne[] = [];
  for (let i = 0; i < VOLUMES.series; i++) {
    const s = i % VOLUMES.saisons;
    const annee = 2023 + s;
    const miseEnPlace = entier(60, 240);
    const semis = alea() < 0.5 ? jourDe(annee, miseEnPlace - 30) : null;
    const parLongueur = alea() < 0.8;
    serie.push({
      id: uuid('a004'),
      ferme_id: fermeId,
      saison_id: saison[s]?.id ?? null,
      espece_id: choisir(espece).id ?? null,
      variete_id: null,
      itineraire_id: uuid('c001'),
      parametres: '{"mode":"plant_maison"}',
      ancre_type: 'plantation',
      ancre_date: jourDe(annee, miseEnPlace),
      prevu_semis_pepiniere: semis,
      prevu_mise_en_place: jourDe(annee, miseEnPlace),
      prevu_debut_recolte: jourDe(annee, miseEnPlace + 60),
      prevu_fin_recolte: jourDe(annee, miseEnPlace + 90),
      longueur_m: parLongueur ? entier(20, 600) / 20 : null,
      nombre_plants: parLongueur ? null : entier(10, 2000),
      statut: 'prevue',
      ...horo,
    });
  }

  const especes: Reference[] = espece.map((e) => ({ id: String(e.id), nom: String(e.nom) }));
  return { fermeId, tables: { espece, zone, emplacement, saison, serie }, especes };
}
