/**
 * Contrat de T55 — jumeau 3D : traitements et délai avant récolte (DAR) visibles
 * (docs/backlog/T55-3d-traitements.md). Types et constantes seulement : les tests chargent les
 * modules par import dynamique (chemin tenu dans une variable).
 *
 * Budget : le morceau 3D (`jsVue3dGzKio`) n'a presque plus de marge. Tout le code de T55 vit hors
 * de lui, dans le morceau des vannes chargé à la demande (T57, ./vannes-differees.ts) et dans celui
 * des travaux (./travaux.ts) ; la vue 3D ne fait que passer la semaine du curseur et lire un drapeau.
 * Le calcul du DAR est celui du cœur (`interdictionRecolte`, `texteInterdiction`, T52), jamais
 * recopié ; les traitements se lisent par ../aujourdhui/dar.ts (même requête que l'écran Aujourd'hui).
 *
 * ── Module pur `../dar3d.ts` (ni React, ni three, ni horloge) ───────────────────────────────
 *
 *   dateAffichee(lundi, aujourdhui): string
 *     La date que la 3D montre : le curseur de la 3D choisit une SEMAINE (son lundi, 'AAAA-MM-JJ').
 *     Si `aujourdhui` est dans cette semaine (du lundi compris au lundi + 7 exclu) : `aujourdhui` ;
 *     sinon le lundi ; lundi absent (undefined, plan vide) : `aujourdhui`.
 *
 *   reperesDar(traitements, volumes, date): RepereDar[]
 *     Un repère par volume PLACÉ (`placee`) dont l'emplacement est sous DAR le `date` d'après
 *     `interdictionRecolte` du cœur (du jour du traitement compris à la récolte autorisée exclue ;
 *     plusieurs traitements : la date la plus tardive ; annulé : rien ; corrigé : la correction),
 *     dans l'ordre des volumes. `texte` = `texteInterdiction` du cœur, avec le nom du produit lu
 *     (`traitements.noms`), « produit inconnu » à défaut :
 *     « Récolte interdite jusqu’au 13/05 (Bouillie bordelaise, traité le 10/05) ».
 *
 *   marquerDar(filtree, planches): SceneFiltree
 *     Les volumes dont l'id est dans `planches` gagnent `dar: true` ; rien d'autre ne change (même
 *     ordre, mêmes couleurs, même `estompe`). `planches` vide : `filtree` rendu tel quel (même objet).
 *
 * ── Règle 2 (`../recolte.ts`) : le DAR l'emporte sur « à récolter » ──────────────────────────
 *
 *   aBalise(p, filtre) est faux quand `filtre.dar` est vrai : pas de balise « à récolter » sur une
 *   planche sous DAR (`RenduPlants.poser` n'en pose pas). `planchesARecolter(plants, filtree)` ne
 *   la compte pas (le résumé « N planches à récolter » suit les balises dessinées).
 *
 * ── Composant `../Vannes3d.tsx` (morceau chargé à part) ─────────────────────────────────────
 *
 *   Nouvelle propriété `jour?: string` : le lundi de la semaine du curseur de la 3D (la vue la
 *   passe ; absente : aujourd'hui). La date montrée est `dateAffichee(jour, aujourdhui())`.
 *   - Dans la couche des vannes (`data-testid="vannes-3d"`), APRÈS les repères des vannes, un
 *     bouton par repère DAR : `data-testid="repere-dar-3d"`, `data-planche` = id de l'emplacement,
 *     nommé « Ne pas récolter, P3 » (code de la planche), texte visible TEXTE_REPERE_DAR. Couleur
 *     dédiée : fond `var(--couleur-conflit)`, texte `var(--couleur-surface)` (jetons existants,
 *     lisibles en clair comme en sombre), distincte de l'orange de la balise « à récolter ».
 *   - `surEtat` : `reperes` = repères des vannes PUIS repères DAR (même ordre que les boutons de
 *     la couche, pour `placerPastilles`) ; `colorer` marque les planches sous DAR (`marquerDar`)
 *     en plus de la coloration des vannes ; `actif` est vrai dès qu'il faut appliquer `colorer`
 *     (filtre « Irrigation », vanne choisie, ou au moins une planche sous DAR).
 *   - Tap sur un repère DAR : fiche `data-testid="fiche-dar-3d"` (role="dialog") qui dit le
 *     `texte` du repère, avec « Fermer ».
 *   - Le curseur (propriété `jour`) fait apparaître et disparaître les repères selon la date.
 *
 * ── Règle 3 (`../travaux.ts`) : les traitements du jour dans les travaux numérotés ──────────
 *
 *   `lireTravaux` lit aussi les traitements EN VIGUEUR datés d'aujourd'hui (même lecture que
 *   l'écran Aujourd'hui, ../aujourdhui/dar.ts). `tachesVisibles` les ajoute APRÈS les cartes
 *   dessinées par l'écran (la carte n° i reste le travail n° i). `travauxDuJour3d` les numérote :
 *   texte « <rang>. Traitement fait : <produit> — <codes des planches> » (« 10. Traitement fait : Bouillie
 *   bordelaise — T2-P07 »), `cle` « traitement:<id> », `planche` = premier emplacement placé, et
 *   la pastille de la planche porte son rang. `lireTachesDuJour` reste les seules cartes de l'écran.
 */
import type { TraitementLu } from '@planif/core';
import type { SceneFiltree, VolumeScene } from '../scene.ts';
import type { EtatVannes3d as EtatVannes3dT57, ProprietesVannes3d as ProprietesVannes3dT57 } from './contrat-vannes.ts';

export const CHEMIN_DAR_3D = './dar3d.ts';

export const TESTID_DAR_3D = {
  repere: 'repere-dar-3d',
  fiche: 'fiche-dar-3d',
} as const;

export const TEXTE_REPERE_DAR = 'Ne pas récolter';

export interface TraitementsDar {
  readonly traitements: readonly TraitementLu[];
  readonly noms: ReadonlyMap<string, string>;
}

export interface RepereDar {
  readonly planche: string;
  readonly code: string;
  readonly x: number;
  readonly z: number;
  readonly texte: string;
  readonly recolteAutoriseeLe: string;
}

export type VolumeFiltreDar = SceneFiltree['volumes'][number] & { readonly dar?: boolean };

export interface ModuleDar3d {
  dateAffichee(lundi: string | undefined, aujourdhui: string): string;
  reperesDar(traitements: TraitementsDar, volumes: readonly Pick<VolumeScene, 'id' | 'code' | 'x' | 'z' | 'placee'>[], date: string): RepereDar[];
  marquerDar(filtree: SceneFiltree, planches: ReadonlySet<string>): SceneFiltree;
  readonly TEXTE_REPERE_DAR: string;
}

export interface EtatVannes3d extends EtatVannes3dT57 {
  /** Vrai : la vue applique `colorer` (filtre « Irrigation », vanne choisie ou planche sous DAR). */
  readonly actif: boolean;
}

export interface ProprietesVannes3d extends Omit<ProprietesVannes3dT57, 'surEtat'> {
  readonly surEtat: (etat: EtatVannes3d) => void;
  /** Lundi de la semaine du curseur de la 3D. */
  readonly jour?: string | undefined;
}
