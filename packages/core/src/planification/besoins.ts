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
  readonly densite: DensiteMetreLineaire;
  readonly margeSecurite: Pourcentage;
  readonly pmgMg: number | null;
}

export interface SemisDirectVolee {
  readonly mode: 'semis_direct';
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

/** Itinéraire d'une série vu du calcul des besoins : chaque combinaison ne porte que ses paramètres. */
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
  exigerEntier(densite.rangsParPlanche, 'rangs par planche', 0);
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
  exigerEntier(it.grainesParPoquet, 'graines par poquet', 0);
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
  exigerEntier(it.densite.rangsParPlanche, 'rangs par planche', 0);
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
  exigerEntier(it.grainesParMotte, 'graines par motte', 0);
  exigerEntier(it.plantsParMotte, 'plants par motte', 0);
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

function besoinsSemisDirect(
  it: SemisDirectEcartement | SemisDirectMetreLineaire | SemisDirectVolee,
  longueurCm: number,
): BesoinsSerie {
  // Le discriminant est imbriqué dans la densité : TypeScript resserre `it.densite` mais pas
  // `it`. Les assertions sont sûres, chaque variante n'admettant qu'une façon de compter.
  switch (it.densite.facon) {
    case 'ecartement':
      return besoinsSemisEcartement(it as SemisDirectEcartement, longueurCm);
    case 'metre_lineaire':
      return besoinsSemisMetreLineaire(it as SemisDirectMetreLineaire, longueurCm);
    case 'volee':
      return besoinsSemisVolee(it as SemisDirectVolee, longueurCm);
    default:
      return verifierExhaustif(it.densite);
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

interface Quantites {
  readonly graines?: number;
  readonly poidsDg?: number;
  readonly mottesASemer?: number;
  readonly plaques?: number;
  readonly plantsACommander?: number;
}

export interface LigneBesoinsSaison extends Quantites {
  readonly varieteId: Id<'Variete'>;
  readonly semaine: SemaineIso;
}

type Champ = keyof Quantites;
const CHAMPS: readonly Champ[] = ['graines', 'poidsDg', 'mottesASemer', 'plaques', 'plantsACommander'];

/** Ce qu'une série apporte à sa ligne de saison. */
function quantitesSerie(b: BesoinsSerie): Quantites {
  switch (b.mode) {
    case 'semis_direct':
      if (b.facon === 'volee') return { poidsDg: b.poidsDg };
      return { graines: b.graines, ...(b.poidsDg === undefined ? {} : { poidsDg: b.poidsDg }) };
    case 'plant_maison': {
      const { mottesASemer, graines, plaques, poidsDg } = b;
      return {
        mottesASemer,
        graines,
        ...(plaques === undefined ? {} : { plaques }),
        ...(poidsDg === undefined ? {} : { poidsDg }),
      };
    }
    case 'plant_achete':
      return { plantsACommander: b.plantsACommander };
    default:
      return verifierExhaustif(b);
  }
}

interface Accumulateur {
  readonly varieteId: Id<'Variete'>;
  readonly semaine: SemaineIso;
  readonly totaux: Map<Champ, number>;
  /** Une série de la ligne a des graines sans poids connu : le poids total serait sous-estimé. */
  poidsIncomplet: boolean;
}

function semaineDeSerie(serie: SerieBesoins): SemaineIso {
  return semaineIso('dateSemis' in serie ? serie.dateSemis : serie.datePlantation);
}

function ajouter(acc: Accumulateur, q: Quantites): void {
  for (const champ of CHAMPS) {
    const valeur = q[champ];
    if (valeur !== undefined) acc.totaux.set(champ, versNombre(BigInt(acc.totaux.get(champ) ?? 0) + BigInt(valeur)));
  }
  if (q.graines !== undefined && q.poidsDg === undefined) acc.poidsIncomplet = true;
}

function versLigne(acc: Accumulateur): LigneBesoinsSaison {
  let ligne: LigneBesoinsSaison = { varieteId: acc.varieteId, semaine: acc.semaine };
  for (const [champ, total] of acc.totaux) {
    if (champ === 'poidsDg' && acc.poidsIncomplet) continue;
    ligne = { ...ligne, [champ]: total };
  }
  return ligne;
}

function comparerLignes(a: LigneBesoinsSaison, b: LigneBesoinsSaison): number {
  if (a.varieteId !== b.varieteId) return a.varieteId < b.varieteId ? -1 : 1;
  if (a.semaine.annee !== b.semaine.annee) return a.semaine.annee - b.semaine.annee;
  return a.semaine.semaine - b.semaine.semaine;
}

/** Besoins de la saison, une ligne par variété et par semaine ISO de semis (ou de plantation). */
export function besoinsSaison(series: readonly SerieBesoins[]): LigneBesoinsSaison[] {
  const lignes = new Map<string, Accumulateur>();
  for (const serie of series) {
    const semaine = semaineDeSerie(serie);
    const cle = `${serie.varieteId}|${String(semaine.annee)}|${String(semaine.semaine)}`;
    let acc = lignes.get(cle);
    if (acc === undefined) {
      acc = { varieteId: serie.varieteId, semaine, totaux: new Map(), poidsIncomplet: false };
      lignes.set(cle, acc);
    }
    ajouter(acc, quantitesSerie(besoinsSerie(serie.itineraire, serie.longueurCm)));
  }
  return [...lignes.values()].map(versLigne).sort(comparerLignes);
}
