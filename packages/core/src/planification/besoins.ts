/**
 * T05 — Besoins en semences et en plants (docs/backlog/T05-besoins-semences.md).
 *
 * Tout se calcule en entiers : longueurs en cm, pourcentages entiers, poids de mille graines en
 * mg, doses en mg/m², poids de semences en dixièmes de gramme. Les produits passent par `bigint`
 * et chaque grandeur ne subit qu'une division entière, arrondie au-dessus (ou au-dessous pour
 * les places sur le rang). Aucun flottant n'apparaît : 100 plants + 10 % donnent 110, pas 111.
 *
 * Le type d'entrée est local : l'appelant (T12) assemble l'itinéraire figé de la série et la
 * variété, et convertit grammes et mètres en entiers au bord.
 */
import { semaineIso } from '../dates/index.ts';
import type { DateCalendaire, SemaineIso } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type {
  Centimetres,
  DensiteEcartement,
  DensiteMetreLineaire,
  Id,
  Pourcentage,
} from '../domaine/index.ts';

// ---------------------------------------------------------------------------------------------
// Types d'entrée
// ---------------------------------------------------------------------------------------------

/** Semis à la volée, dose en milligrammes par m² (15 g/m² → 15 000). */
export interface DensiteVoleeBesoins {
  readonly facon: 'volee';
  readonly largeurSemeeCm: Centimetres;
  readonly doseMgParM2: number;
}

export interface SemisDirectEcartement {
  readonly mode: 'semis_direct';
  readonly facon: 'ecartement';
  readonly densite: DensiteEcartement;
  readonly grainesParPoquet: number;
  readonly germination: Pourcentage;
  readonly margeSecurite: Pourcentage;
  /** Poids de mille graines en milligrammes (1,2 g → 1200), `null` si inconnu. */
  readonly pmgMg: number | null;
}

/** La densité au mètre linéaire compte déjà la germination. */
export interface SemisDirectMetreLineaire {
  readonly mode: 'semis_direct';
  readonly facon: 'metre_lineaire';
  readonly densite: DensiteMetreLineaire;
  readonly margeSecurite: Pourcentage;
  readonly pmgMg: number | null;
}

export interface SemisDirectVolee {
  readonly mode: 'semis_direct';
  readonly facon: 'volee';
  readonly densite: DensiteVoleeBesoins;
  readonly margeSecurite: Pourcentage;
}

export interface PlantMaisonBesoins {
  readonly mode: 'plant_maison';
  readonly densite: DensiteEcartement;
  readonly grainesParMotte: number;
  readonly plantsParMotte: number;
  readonly germination: Pourcentage;
  readonly pertePepiniere: Pourcentage;
  readonly alveolesParPlaque: number | null;
  readonly margeSecurite: Pourcentage;
  readonly pmgMg: number | null;
}

export interface PlantAcheteBesoins {
  readonly mode: 'plant_achete';
  readonly densite: DensiteEcartement;
  readonly margeSecurite: Pourcentage;
}

/**
 * Itinéraire d'une série vu du calcul des besoins : chaque combinaison ne porte que ses paramètres.
 * Le semis direct répète `facon` au premier niveau : TypeScript ne discrimine une union (et ne
 * signale les propriétés en trop) que sur un discriminant de premier niveau.
 */
export type ItineraireBesoins =
  | SemisDirectEcartement
  | SemisDirectMetreLineaire
  | SemisDirectVolee
  | PlantMaisonBesoins
  | PlantAcheteBesoins;

// ---------------------------------------------------------------------------------------------
// Types de sortie
// ---------------------------------------------------------------------------------------------

/** Poids de semences en dixièmes de gramme (6,6 g → 66) : absent si le PMG est inconnu. */
interface PoidsFacultatif {
  readonly poidsDg?: number;
}

export interface BesoinsSemisEcartement extends PoidsFacultatif {
  readonly mode: 'semis_direct';
  readonly facon: 'ecartement';
  readonly plants: number;
  readonly graines: number;
}

export interface BesoinsSemisMetreLineaire extends PoidsFacultatif {
  readonly mode: 'semis_direct';
  readonly facon: 'metre_lineaire';
  readonly graines: number;
}

export interface BesoinsSemisVolee {
  readonly mode: 'semis_direct';
  readonly facon: 'volee';
  readonly poidsDg: number;
}

export interface BesoinsPlantMaison extends PoidsFacultatif {
  readonly mode: 'plant_maison';
  readonly mottesEnPlace: number;
  readonly plants: number;
  readonly mottesAPlanter: number;
  readonly mottesASemer: number;
  readonly graines: number;
  /** Absent sans nombre d'alvéoles par plaque. */
  readonly plaques?: number;
}

export interface BesoinsPlantAchete {
  readonly mode: 'plant_achete';
  readonly plants: number;
  readonly plantsACommander: number;
}

export type BesoinsSerie =
  | BesoinsSemisEcartement
  | BesoinsSemisMetreLineaire
  | BesoinsSemisVolee
  | BesoinsPlantMaison
  | BesoinsPlantAchete;

// ---------------------------------------------------------------------------------------------
// Arithmétique entière
// ---------------------------------------------------------------------------------------------

/** Produit exact d'entiers, en bigint. */
function produit(...facteurs: readonly number[]): bigint {
  return facteurs.reduce((acc, f) => acc * BigInt(f), 1n);
}

function versNombre(n: bigint): number {
  const resultat = Number(n);
  if (!Number.isSafeInteger(resultat)) {
    throw new RangeError(`quantité hors des entiers sûrs : ${n.toString()}`);
  }
  return resultat;
}

/** ⌈a ÷ b⌉ pour a ≥ 0 et b > 0. */
function diviserArrondiHaut(a: bigint, b: bigint): number {
  return versNombre((a + b - 1n) / b);
}

/** ⌊a ÷ b⌋ pour a ≥ 0 et b > 0. */
function diviserArrondiBas(a: bigint, b: bigint): number {
  return versNombre(a / b);
}

/** Ajoute la marge de sécurité : ⌈n × (100 + marge) ÷ 100⌉. */
function avecMarge(n: number, marge: Pourcentage): number {
  return diviserArrondiHaut(produit(n, 100 + marge), 100n);
}

// ---------------------------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------------------------

function exigerEntier(valeur: number, nom: string, min: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(valeur) || valeur < min || valeur > max) {
    throw new RangeError(`${nom} doit être un entier entre ${String(min)} et ${String(max)} : ${String(valeur)}`);
  }
}

function exigerPourcentage(valeur: Pourcentage, nom: string, min: number, max: number): void {
  exigerEntier(valeur, `${nom} (%)`, min, max);
}

function controlerCommun(itineraire: ItineraireBesoins, longueurCm: number): void {
  exigerEntier(longueurCm, 'longueur (cm)', 0);
  exigerEntier(itineraire.margeSecurite, 'marge de sécurité (%)', 0);
}

function controlerPmg(pmgMg: number | null): void {
  if (pmgMg !== null) exigerEntier(pmgMg, 'poids de mille graines (mg)', 0);
}

// ---------------------------------------------------------------------------------------------
// Façons de compter
// ---------------------------------------------------------------------------------------------

/** Plants (ou mottes) en place : ⌊longueur ÷ écartement⌋ × rangs. */
function placesEnPlace(densite: DensiteEcartement, longueurCm: number): number {
  exigerEntier(densite.ecartementSurRangCm, 'écartement sur le rang (cm)', 1);
  exigerEntier(densite.rangsParPlanche, 'rangs par planche', 1);
  const placesParRang = diviserArrondiBas(BigInt(longueurCm), BigInt(densite.ecartementSurRangCm));
  return versNombre(produit(placesParRang, densite.rangsParPlanche));
}

/** Poids en dixièmes de gramme : ⌈graines × mg pour mille ÷ 100 000⌉. */
function poidsSemencesDg(graines: number, pmgMg: number): number {
  return diviserArrondiHaut(produit(graines, pmgMg), 100_000n);
}

function avecPoids(graines: number, pmgMg: number | null): PoidsFacultatif {
  return pmgMg === null ? {} : { poidsDg: poidsSemencesDg(graines, pmgMg) };
}

// ---------------------------------------------------------------------------------------------
// Calcul par mode
// ---------------------------------------------------------------------------------------------

function besoinsSemisEcartement(it: SemisDirectEcartement, longueurCm: number): BesoinsSemisEcartement {
  exigerEntier(it.grainesParPoquet, 'graines par poquet', 1);
  exigerPourcentage(it.germination, 'germination', 1, 100);
  controlerPmg(it.pmgMg);
  const plants = placesEnPlace(it.densite, longueurCm);
  const graines = diviserArrondiHaut(
    produit(plants, it.grainesParPoquet, 100, 100 + it.margeSecurite),
    produit(it.germination, 100),
  );
  return { mode: 'semis_direct', facon: 'ecartement', plants, graines, ...avecPoids(graines, it.pmgMg) };
}

function besoinsSemisMetreLineaire(it: SemisDirectMetreLineaire, longueurCm: number): BesoinsSemisMetreLineaire {
  exigerEntier(it.densite.rangsParPlanche, 'rangs par planche', 1);
  exigerEntier(it.densite.grainesParMetre, 'graines par mètre', 0);
  controlerPmg(it.pmgMg);
  const graines = diviserArrondiHaut(
    produit(longueurCm, it.densite.rangsParPlanche, it.densite.grainesParMetre, 100 + it.margeSecurite),
    produit(100, 100),
  );
  return { mode: 'semis_direct', facon: 'metre_lineaire', graines, ...avecPoids(graines, it.pmgMg) };
}

/** cm² → m² : ÷ 10⁴ ; mg → dg : ÷ 100 ; marge : ÷ 100. */
function besoinsSemisVolee(it: SemisDirectVolee, longueurCm: number): BesoinsSemisVolee {
  exigerEntier(it.densite.largeurSemeeCm, 'largeur semée (cm)', 0);
  exigerEntier(it.densite.doseMgParM2, 'dose (mg/m²)', 0);
  const poidsDg = diviserArrondiHaut(
    produit(longueurCm, it.densite.largeurSemeeCm, it.densite.doseMgParM2, 100 + it.margeSecurite),
    100_000_000n,
  );
  return { mode: 'semis_direct', facon: 'volee', poidsDg };
}

function nombrePlaques(mottesASemer: number, alveolesParPlaque: number | null): { readonly plaques?: number } {
  if (alveolesParPlaque === null) return {};
  exigerEntier(alveolesParPlaque, 'alvéoles par plaque', 1);
  return { plaques: diviserArrondiHaut(BigInt(mottesASemer), BigInt(alveolesParPlaque)) };
}

function besoinsPlantMaison(it: PlantMaisonBesoins, longueurCm: number): BesoinsPlantMaison {
  exigerEntier(it.grainesParMotte, 'graines par motte', 1);
  exigerEntier(it.plantsParMotte, 'plants par motte', 1);
  exigerPourcentage(it.germination, 'germination', 1, 100);
  exigerPourcentage(it.pertePepiniere, 'perte en pépinière', 0, 99);
  controlerPmg(it.pmgMg);
  const mottesEnPlace = placesEnPlace(it.densite, longueurCm);
  const mottesAPlanter = avecMarge(mottesEnPlace, it.margeSecurite);
  const mottesASemer = diviserArrondiHaut(produit(mottesAPlanter, 100), BigInt(100 - it.pertePepiniere));
  const graines = diviserArrondiHaut(produit(mottesASemer, it.grainesParMotte, 100), BigInt(it.germination));
  return {
    mode: 'plant_maison',
    mottesEnPlace,
    plants: versNombre(produit(mottesEnPlace, it.plantsParMotte)),
    mottesAPlanter,
    mottesASemer,
    graines,
    ...nombrePlaques(mottesASemer, it.alveolesParPlaque),
    ...avecPoids(graines, it.pmgMg),
  };
}

function besoinsPlantAchete(it: PlantAcheteBesoins, longueurCm: number): BesoinsPlantAchete {
  const plants = placesEnPlace(it.densite, longueurCm);
  return { mode: 'plant_achete', plants, plantsACommander: avecMarge(plants, it.margeSecurite) };
}

type SemisDirectBesoins = SemisDirectEcartement | SemisDirectMetreLineaire | SemisDirectVolee;
type BesoinsSemisDirect = BesoinsSemisEcartement | BesoinsSemisMetreLineaire | BesoinsSemisVolee;

function besoinsSemisDirect(it: SemisDirectBesoins, longueurCm: number): BesoinsSemisDirect {
  switch (it.facon) {
    case 'ecartement':
      return besoinsSemisEcartement(it, longueurCm);
    case 'metre_lineaire':
      return besoinsSemisMetreLineaire(it, longueurCm);
    case 'volee':
      return besoinsSemisVolee(it, longueurCm);
    default:
      return verifierExhaustif(it);
  }
}

/** Besoins d'une série de `longueurCm` centimètres conduite selon `itineraire`. */
export function besoinsSerie(itineraire: ItineraireBesoins, longueurCm: number): BesoinsSerie {
  controlerCommun(itineraire, longueurCm);
  switch (itineraire.mode) {
    case 'semis_direct':
      return besoinsSemisDirect(itineraire, longueurCm);
    case 'plant_maison':
      return besoinsPlantMaison(itineraire, longueurCm);
    case 'plant_achete':
      return besoinsPlantAchete(itineraire, longueurCm);
    default:
      return verifierExhaustif(itineraire);
  }
}

// ---------------------------------------------------------------------------------------------
// Agrégation de la saison
// ---------------------------------------------------------------------------------------------

/** Série à semer (semis direct, ou semis en pépinière pour le plant maison). */
export interface SerieSemee {
  readonly varieteId: Id<'Variete'>;
  readonly itineraire: Exclude<ItineraireBesoins, PlantAcheteBesoins>;
  readonly longueurCm: number;
  readonly dateSemis: DateCalendaire;
}

/** Série de plants achetés : s'agrège à sa date de plantation. */
export interface SeriePlantee {
  readonly varieteId: Id<'Variete'>;
  readonly itineraire: PlantAcheteBesoins;
  readonly longueurCm: number;
  readonly datePlantation: DateCalendaire;
}

export type SerieBesoins = SerieSemee | SeriePlantee;


/** Plaques d'un même format (nombre d'alvéoles). */
export interface PlaquesFormat {
  readonly alveoles: number;
  readonly nombre: number;
}

export interface LigneBesoinsSaison {
  readonly varieteId: Id<'Variete'>;
  readonly semaine: SemaineIso;
  readonly graines?: number;
  readonly poidsDg?: number;
  readonly mottesASemer?: number;
  readonly plantsACommander?: number;
  /** Une entrée par format, triée par alvéoles ; absent si une série a des mottes sans format. */
  readonly plaques?: readonly PlaquesFormat[];
}

type ChampSomme = 'graines' | 'poidsDg' | 'mottesASemer' | 'plantsACommander';
const CHAMPS_SOMMES: readonly ChampSomme[] = ['graines', 'poidsDg', 'mottesASemer', 'plantsACommander'];

/** Ce qu'une série apporte à sa ligne de saison. */
interface Apport {
  readonly graines?: number;
  readonly poidsDg?: number;
  readonly mottesASemer?: number;
  readonly plantsACommander?: number;
  readonly plaques?: PlaquesFormat;
}

function poidsDe(b: PoidsFacultatif): Apport {
  return b.poidsDg === undefined ? {} : { poidsDg: b.poidsDg };
}

function apportSemisDirect(b: BesoinsSemisDirect): Apport {
  switch (b.facon) {
    case 'ecartement':
    case 'metre_lineaire':
      return { graines: b.graines, ...poidsDe(b) };
    case 'volee':
      return { poidsDg: b.poidsDg };
    default:
      return verifierExhaustif(b);
  }
}

function apportPlantMaison(it: PlantMaisonBesoins, b: BesoinsPlantMaison): Apport {
  const plaques =
    it.alveolesParPlaque === null || b.plaques === undefined
      ? {}
      : { plaques: { alveoles: it.alveolesParPlaque, nombre: b.plaques } };
  return { mottesASemer: b.mottesASemer, graines: b.graines, ...plaques, ...poidsDe(b) };
}

function apportSerie(serie: SerieBesoins): Apport {
  const it = serie.itineraire;
  controlerCommun(it, serie.longueurCm);
  switch (it.mode) {
    case 'semis_direct':
      return apportSemisDirect(besoinsSemisDirect(it, serie.longueurCm));
    case 'plant_maison':
      return apportPlantMaison(it, besoinsPlantMaison(it, serie.longueurCm));
    case 'plant_achete':
      return { plantsACommander: besoinsPlantAchete(it, serie.longueurCm).plantsACommander };
    default:
      return verifierExhaustif(it);
  }
}

interface Accumulateur {
  readonly varieteId: Id<'Variete'>;
  readonly semaine: SemaineIso;
  readonly totaux: Map<ChampSomme, number>;
  /** Nombre de plaques par format d'alvéoles. */
  readonly plaques: Map<number, number>;
  /** Une série a des graines sans poids connu : le poids total serait sous-estimé. */
  poidsIncomplet: boolean;
  /** Une série a des mottes sans format de plaque : la liste ferait commander trop peu. */
  plaquesIncompletes: boolean;
}

function somme(a: number | undefined, b: number): number {
  return versNombre(BigInt(a ?? 0) + BigInt(b));
}

function ajouter(acc: Accumulateur, apport: Apport): void {
  for (const champ of CHAMPS_SOMMES) {
    const valeur = apport[champ];
    if (valeur !== undefined) acc.totaux.set(champ, somme(acc.totaux.get(champ), valeur));
  }
  if (apport.plaques !== undefined) {
    const { alveoles, nombre } = apport.plaques;
    acc.plaques.set(alveoles, somme(acc.plaques.get(alveoles), nombre));
  }
  if (apport.graines !== undefined && apport.poidsDg === undefined) acc.poidsIncomplet = true;
  if (apport.mottesASemer !== undefined && apport.plaques === undefined) acc.plaquesIncompletes = true;
}

function listePlaques(acc: Accumulateur): { readonly plaques?: readonly PlaquesFormat[] } {
  if (acc.plaquesIncompletes || acc.plaques.size === 0) return {};
  const plaques = [...acc.plaques].map(([alveoles, nombre]) => ({ alveoles, nombre }));
  return { plaques: plaques.sort((a, b) => a.alveoles - b.alveoles) };
}

function versLigne(acc: Accumulateur): LigneBesoinsSaison {
  let ligne: LigneBesoinsSaison = { varieteId: acc.varieteId, semaine: acc.semaine, ...listePlaques(acc) };
  for (const [champ, total] of acc.totaux) {
    if (champ === 'poidsDg' && acc.poidsIncomplet) continue;
    ligne = { ...ligne, [champ]: total };
  }
  return ligne;
}

function semaineDeSerie(serie: SerieBesoins): SemaineIso {
  return semaineIso('dateSemis' in serie ? serie.dateSemis : serie.datePlantation);
}

function comparerLignes(a: LigneBesoinsSaison, b: LigneBesoinsSaison): number {
  if (a.varieteId !== b.varieteId) return a.varieteId < b.varieteId ? -1 : 1;
  if (a.semaine.annee !== b.semaine.annee) return a.semaine.annee - b.semaine.annee;
  return a.semaine.semaine - b.semaine.semaine;
}

/**
 * Besoins de la saison, une ligne par variété et par semaine ISO de semis (ou de plantation).
 * Le poids d'une ligne additionne les poids déjà arrondis de chaque série : il ne descend
 * jamais sous le poids exact.
 */
export function besoinsSaison(series: readonly SerieBesoins[]): LigneBesoinsSaison[] {
  const lignes = new Map<string, Accumulateur>();
  for (const serie of series) {
    const semaine = semaineDeSerie(serie);
    const cle = `${serie.varieteId}|${String(semaine.annee)}|${String(semaine.semaine)}`;
    let acc = lignes.get(cle);
    if (acc === undefined) {
      acc = {
        varieteId: serie.varieteId,
        semaine,
        totaux: new Map(),
        plaques: new Map(),
        poidsIncomplet: false,
        plaquesIncompletes: false,
      };
      lignes.set(cle, acc);
    }
    ajouter(acc, apportSerie(serie));
  }
  return [...lignes.values()].map(versLigne).sort(comparerLignes);
}
