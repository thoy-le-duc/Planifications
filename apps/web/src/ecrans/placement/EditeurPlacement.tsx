/**
 * Éditeur de placement sur la photo aérienne IGN (T28b, Q30, Q31) : poser, déplacer, faire pivoter
 * et redimensionner les bâtiments (serres, hangar, magasin) et déplacer les planches, à la souris
 * à la souris, au doigt ou au clavier, sur l'orthophoto de la Géoplateforme. Chargé à la demande depuis l'onglet Ferme ;
 * il reçoit la porte (ni PowerSync, ni src/donnees) et n'écrit QUE par `porte.placer`. Contrat du
 * DOM : ./test/contrat.ts.
 *
 * Rien n'est écrit pendant un geste : le brouillon vit dans l'écran, « Enregistrer » le donne à la
 * porte en un seul appel, qui rend l'annulation (bouton « Annuler » quelques secondes, Ctrl+Z
 * pendant la session). Gérant seulement, sur ordinateur comme sur téléphone (T28k, Q36) : sinon lecture
 * seule, sans poignées. Au doigt : un doigt sur l'élément choisi le déplace, ailleurs il déplace la
 * carte ; deux doigts zooment, et tournent l'élément choisi ; barre du bas « Tourner ±5° ». Sans
 * réseau, le fond est un quadrillage de 10 m et tout le reste marche.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { creerGenerateurId, type GenerateurId } from '@planif/core/identifiants';
import type { ChangementPlacement, PorteDonnees } from '@planif/sync';
import './placement.css';
import { repereZone, versGeographique, versLocal, type RepereZone, type TypeBatiment } from './coeur.ts';
import { changementsDuBrouillon, contourChange, ECRITURES_MAX_PAR_LOT } from './brouillon.ts';
import type { PropositionAdresse } from './adresse.ts';
import { Champ, garderLeFocus, Modale } from './composants.tsx';
import { RechercheAdresse } from './RechercheAdresse.tsx';
import { BandeauEtapes, etapeCourante, MESSAGES_ETAPES, type NumeroEtape } from './etapes.tsx';
import { TEXTE_INVITATION } from '../../demo/invitation.ts';
import { empriseDeContours, vueSurEmprise, type Emprise } from './sites.ts';
import { deplacerSommet, insererMilieu, poserPoint, replacerEntreReperes, retirerSommet, toucheSommet, TOLERANCE_FERMETURE_PX, verifierContour } from './contours.ts';
import type { MouvementBloc } from './bloc.ts';
import {
  lireTout,
  requeteBatiments,
  requeteChemins,
  requeteFerme,
  requetePlanches,
  requeteEmplacementsPlaces,
  requeteRoles,
  requeteVannes,
  requeteZones,
  sansNull,
  TYPES,
  type Batiment,
  type Chemin,
  type EmplacementEnService,
  type EmplacementPlace,
  type FermeLue,
  type Planche,
  type Vanne,
  type Zone,
} from './donnees.ts';
import {
  appliquerTouche,
  depuisPlacementPlanche,
  glisser,
  normaliserCap,
  pivoter,
  redimensionner,
  tournerDe,
  DIMENSION_MIN_M,
  versPlacementPlanche,
  type Cote,
  type Repere,
  type RectanglePlace,
} from './gestes.ts';
import type * as ModuleChemins from './chemins.tsx';
import type * as ModuleZone from './zone-ecran.tsx';
import type { InfoBande } from './bandes-serre.ts';
import type { RectangleEnglobant } from '@planif/core/placement';
import { DELAI_RELANCE_TUILE_MS, depuisEcran, ESSAIS_TUILE_MAX, MENTION_IGN, metresParPixel, tuilesVisibles, versEcran, ZOOM_DEPART_SANS_POSITION, ZOOM_INITIAL, ZOOM_MIN_VUE, ZOOM_TUILES_MAX, type Point, type Position, type VueCarte } from './tuiles.ts';

export const MESSAGES_PLACEMENT = {
  seulGerant: 'Seul le gérant peut placer les éléments de la ferme',
  horsLigne: 'Photo aérienne indisponible hors ligne',
  indisponible: 'Photo aérienne indisponible pour le moment',
  enregistreSansRelecture: 'Enregistré',
  contourRemplace: 'Le contour de la zone sera remplacé par la serre',
} as const;

/** Contours de zones (T28d). */
export const MESSAGES_CONTOURS = {
  zoneAbritee: 'sa forme est celle de la serre',
  sommetsMin: 'au moins 3 sommets',
  tropDeChangements: 'Trop de changements à enregistrer en une fois',
  planchesSuivent: 'Les planches de la zone suivront la serre.',
  brouillonAbandonne: 'Le brouillon en cours a été abandonné : la ferme active a changé.',
} as const;

/** Ce que le morceau « zone » (./zone-ecran.tsx) emprunte à l'éditeur. */
const OUTILS: ModuleZone.Outils = { Champ, Modale, verifierContour, types: TYPES, zoneAbritee: MESSAGES_CONTOURS.zoneAbritee, fiche: MESSAGES_ETAPES.fiche };

const MESSAGE_SOMMETS_MIN = `Un contour garde ${MESSAGES_CONTOURS.sommetsMin}.`;

/** « Annuler » reste affiché quelques secondes après un enregistrement. */
export const DELAI_ANNULATION_MS = 8_000;

/**
 * T28i : l'invitation de la démo n'existe que dans les builds de la démo (et de test) : la condition
 * est fixée au build, le texte n'entre donc pas dans le build de production (scripts/demo.test.ts).
 */
function invitation(voulue: boolean): ReactNode {
  if (import.meta.env.MODE === 'demo' || import.meta.env.MODE === 'test') {
    return voulue ? (
      <p data-testid="invitation-demo" className="demo-invitation">
        {TEXTE_INVITATION}
      </p>
    ) : null;
  }
  return null;
}

export interface ProprietesEditeurPlacement {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Utilisateur de la session : son rôle se lit dans la table locale `membre`. */
  readonly utilisateurId: string;
  readonly surFermer: () => void;
  /** Taille de l'écran (T28k : le gérant édite sur téléphone aussi). Défaut : matchMedia('(min-width: 1024px)'). */
  readonly ordinateur?: boolean;
  /** Réseau. Défaut : navigator.onLine, suivi par les événements online / offline. */
  readonly enLigne?: boolean;
  /** Durée d'affichage du bouton « Annuler » après un enregistrement. */
  readonly delaiAnnulationMs?: number;
  /** Identifiant d'un nouveau bâtiment (UUID v7). */
  readonly nouvelId?: () => string;
  /** T28i : build de la démo, l'éditeur invite à essayer (« Essayez : ajoutez une serre… »). Défaut : faux, rien n'est rendu. */
  readonly invitationDemo?: boolean;
}

const ZOOM_MAX = 22;
/** Un clic bouge de moins que ça ; au-delà, c'est un glissement. */
const SEUIL_GLISSEMENT_PX = 4;
const DECALAGE_POIGNEE_PX = 28;
const DECALAGE_POIGNEE_COTE_DOIGT_PX = 11;
/** Zone tactile d'un sommet au doigt ; le point dessiné reste de 24 px à l'intérieur. */
const TAILLE_SOMMET_SOURIS_PX = 24;
const TAILLE_SOMMET_DOIGT_PX = 44;
/** Appui long du doigt sur un côté de contour : ajoute un sommet. */
const DELAI_APPUI_LONG_MS = 500;
/** Rayon d'une vanne à toucher, en pixels (marqueur de 44 px). */
const TAILLE_VANNE_PX = 22;
/** Pas des boutons « Tourner −5° / +5° » (degrés). */
const PAS_ROTATION_DEG = 5;
const CARREAU_M = 10;
/** Position de repli d'une ferme sans position : le centre de la France. */
const POSITION_DE_REPLI: Position = { latitude: 46.6, longitude: 2.4 };
const TAILLE_PAR_DEFAUT = { w: 1280, h: 800 } as const;
/** T85 : passe-pied de départ de « Dessiner depuis les planches » (cm). */
const PASSE_PIED_DEPART_CM = '45';

const LIBELLE_TYPE: Readonly<Record<TypeBatiment, string>> = Object.fromEntries(TYPES.map((t) => [t.valeur, t.libelle])) as Record<TypeBatiment, string>;

/** Un élément dessiné : bâtiment, planche ramenée dans le repère de la ferme, ou vanne (T57 : un point, carré de 1 m, jamais tourné). */
interface Objet {
  readonly sorte: 'batiment' | 'planche' | 'vanne';
  readonly id: string;
  readonly libelle: string;
  readonly rect: RectanglePlace;
  /** Planche : repère dans lequel son placement est gardé au brouillon (celui de sa zone, avant tout changement de contour). */
  readonly repere: Repere | null;
}

/** Une zone, avec son contour tel qu'affiché et ce qu'en dit le cœur. */
export interface ZoneAffichee {
  readonly zone: Zone;
  readonly abritee: boolean;
  /** Contour affiché : celui du brouillon, sinon celui de la base. */
  readonly affiche: readonly Point[] | null;
  /** Contour qui donne le repère : celui du brouillon s'il est valide et change, sinon celui de la base (même objet). */
  readonly effectif: readonly Point[] | null;
  /** Le brouillon change le contour de la zone. */
  readonly change: boolean;
  /** Verdict du cœur sur le contour du brouillon (null : pas de brouillon). */
  readonly verdict: ReturnType<typeof verifierContour> | null;
}

type Geste =
  | {
      readonly type: 'fond';
      readonly pixel0: Point;
      readonly centre0: Point;
      readonly vue: VueCarte;
      /** Au doigt, un élément non choisi : un tap le choisit, un glissement déplace la carte. */
      readonly cible: string | null;
      deplace: boolean;
    }
  | {
      readonly type: 'deplacer' | 'pivoter' | 'cote';
      readonly element: Objet;
      readonly pixel0: Point;
      readonly depart: Point;
      readonly vue: VueCarte;
      readonly cote: Cote | null;
      demarre: boolean;
    }
  | {
      /** Sommet d'un contour : glisser le déplace, un simple clic le choisit (ou ferme le tracé). */
      readonly type: 'sommet';
      readonly zoneId: string;
      readonly index: number;
      readonly contour0: readonly Point[];
      readonly pixel0: Point;
      readonly depart: Point;
      readonly vue: VueCarte;
      readonly fige: boolean;
      demarre: boolean;
    }
  | { readonly type: 'milieu'; readonly zoneId: string; readonly index: number; readonly pixel0: Point; readonly tactile: boolean; demarre: boolean }
  | {
      /** T85, bloc d'une zone : glisser son intérieur la déplace avec ses planches, sa poignée la tourne autour de son centre. */
      readonly type: 'bloc';
      readonly mode: 'deplacer' | 'pivoter';
      readonly zoneId: string;
      readonly contour0: readonly Point[];
      readonly calage0: RepereZone;
      readonly centre0: Point;
      readonly orientation0: number;
      readonly pixel0: Point;
      readonly depart: Point;
      readonly vue: VueCarte;
      demarre: boolean;
    };

/** Le geste au doigt en cours (attribut data-geste). */
type GesteDoigt = 'aucun' | 'carte' | 'element' | 'sommet' | 'deux-doigts';

/** Deux doigts posés : zoom (écart) et rotation de l'élément choisi (angle de la droite qui les joint). */
interface DeuxDoigts {
  readonly ids: readonly [number, number];
  readonly distance0: number;
  readonly zoom0: number;
  readonly element: Objet | null;
  angle: number;
  /** Angle total parcouru, en degrés (sens horaire à l'écran = positif). */
  tourne: number;
  /** La rotation ne s'engage qu'au-delà de SEUIL_ROTATION_DOIGTS_DEG : un pincement qui dérive un peu ne tourne rien. */
  tournant: boolean;
}

/** Angle cumulé à deux doigts au-delà duquel l'élément choisi se met à tourner (relecture T28k). */
const SEUIL_ROTATION_DOIGTS_DEG = 8;

export interface Trace {
  readonly zoneId: string;
  readonly sommets: readonly Point[];
}

type Confirmation =
  | { readonly type: 'origine'; readonly position: Position }
  | { readonly type: 'zone'; readonly batimentId: string; readonly zoneId: string }
  | { readonly type: 'remplacer'; readonly zoneId: string; readonly englobant: RectangleEnglobant | null; readonly avis: string | null; readonly converties: readonly (readonly [string, Planche])[] }
  | { readonly type: 'fermer' }
  | { readonly type: 'terminer' };

export interface NouveauBatiment {
  readonly nom: string;
  readonly type: TypeBatiment;
  readonly longueurM: number;
  readonly largeurM: number;
  readonly hauteurM: number;
}

interface Enregistrement {
  readonly annulation: readonly ChangementPlacement[];
}

const arrondi = (v: number, pas = 1000): number => Math.round(v * pas) / pas;

function messageDe(e: unknown): string {
  return e instanceof Error && e.message !== '' ? e.message : 'La base du téléphone a refusé l’écriture.';
}

function usePreference(requete: string | null, parDefaut: boolean): boolean {
  const [valeur, setValeur] = useState(() => (requete === null || typeof matchMedia !== 'function' ? parDefaut : matchMedia(requete).matches));
  useEffect(() => {
    if (requete === null || typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(requete);
    const suivre = () => {
      setValeur(m.matches);
    };
    m.addEventListener('change', suivre);
    return () => {
      m.removeEventListener('change', suivre);
    };
  }, [requete]);
  return valeur;
}

function useEnLigne(): boolean {
  const [enLigne, setEnLigne] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const maj = () => {
      setEnLigne(navigator.onLine);
    };
    addEventListener('online', maj);
    addEventListener('offline', maj);
    return () => {
      removeEventListener('online', maj);
      removeEventListener('offline', maj);
    };
  }, []);
  return enLigne;
}

/** Position et taille à l'écran d'un rectangle placé (le haut de l'écran est le nord). */
function styleRectangle(vue: VueCarte, r: RectanglePlace): { left: number; top: number; width: number; height: number; transform: string; touchAction: 'none' } {
  const mpp = metresParPixel(vue.origine.latitude, vue.zoom);
  const c = versEcran(vue, r.centre);
  const w = r.largeurM / mpp;
  const h = r.longueurM / mpp;
  return { left: c.x - w / 2, top: c.y - h / 2, width: w, height: h, transform: `rotate(${String(r.orientationDeg)}deg)`, touchAction: 'none' };
}

/** Poignées d'un rectangle, en pixels de l'écran : rotation (au-delà du bout avant) et quatre côtés. */
function positionsPoignees(vue: VueCarte, r: RectanglePlace, decalageCote: number): { rotation: Point; cotes: readonly { cote: Cote; p: Point }[] } {
  const mpp = metresParPixel(vue.origine.latitude, vue.zoom);
  const c = versEcran(vue, r.centre);
  const t = (r.orientationDeg * Math.PI) / 180;
  const avant = { x: Math.sin(t), y: -Math.cos(t) };
  const droite = { x: Math.cos(t), y: Math.sin(t) };
  const demiL = r.longueurM / mpp / 2;
  const demiW = r.largeurM / mpp / 2;
  const sur = (axe: Point, d: number): Point => ({ x: c.x + axe.x * d, y: c.y + axe.y * d });
  // Au doigt, les poignées de côté sont décalées vers l'extérieur : leur zone à toucher (44 px) ne couvre pas le milieu d'un bâtiment étroit.
  const dehors = (axe: Point, signe: 1 | -1, demi: number): Point => sur(axe, signe * (demi + decalageCote));
  return {
    rotation: sur(avant, demiL + DECALAGE_POIGNEE_PX),
    cotes: [
      { cote: 'avant', p: dehors(avant, 1, demiL) },
      { cote: 'arriere', p: dehors(avant, -1, demiL) },
      { cote: 'droite', p: dehors(droite, 1, demiW) },
      { cote: 'gauche', p: dehors(droite, -1, demiW) },
    ],
  };
}

/** Angle de la droite qui joint deux doigts, en degrés (le sens horaire à l'écran compte positivement). */
function angleEntre(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Ramène un écart d'angle dans ]−180, 180] : un doigt qui passe de 179° à −179° a tourné de 2°, pas de −358°. */
function ecartAngle(degres: number): number {
  const e = ((((degres + 180) % 360) + 360) % 360) - 180;
  return e === -180 ? 180 : e;
}

function capturer(e: PointerEvent): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Pas de capture (pointeur simulé) : les événements arrivent quand même par la surface.
  }
}

/** Identité d'une porte, pour repartir de zéro quand la ferme active change sans démontage. */
const identitesPortes = new WeakMap<object, number>();
let dernièreIdentité = 0;
function identiteDe(porte: PorteDonnees): number {
  const connue = identitesPortes.get(porte);
  if (connue !== undefined) return connue;
  dernièreIdentité += 1;
  identitesPortes.set(porte, dernièreIdentité);
  return dernièreIdentité;
}

/**
 * Une autre porte ou une autre ferme (la ferme active change à la synchro) : l'éditeur repart de
 * zéro — brouillon, pile Ctrl+Z, « Annuler », vue, lectures. Rien de la ferme A n'est écrit dans B.
 */
export function EditeurPlacement(p: ProprietesEditeurPlacement): ReactElement {
  const cle = `${p.fermeId}/${String(identiteDe(p.porte))}/${p.utilisateurId}`;
  // Le brouillon de l'éditeur sortant, lu au moment où la clé change : le nouveau le dit à l'écran.
  const [brouillonEnCours, setBrouillonEnCours] = useState(false);
  const [suivi, setSuivi] = useState({ cle, abandonne: false });
  if (suivi.cle !== cle) setSuivi({ cle, abandonne: brouillonEnCours });
  return (
    <EditeurFerme
      key={cle}
      {...p}
      brouillonAbandonne={suivi.cle === cle && suivi.abandonne}
      surBrouillon={setBrouillonEnCours}
    />
  );
}

interface ProprietesEditeurFerme extends ProprietesEditeurPlacement {
  /** Un brouillon était ouvert dans l'éditeur de la ferme précédente. */
  readonly brouillonAbandonne: boolean;
  /** Dit à l'enveloppe si un brouillon est ouvert (lu au changement de ferme). */
  readonly surBrouillon: (ouvert: boolean) => void;
}

function EditeurFerme({ porte, fermeId, utilisateurId, surFermer, ordinateur, enLigne, delaiAnnulationMs = DELAI_ANNULATION_MS, nouvelId, invitationDemo = false, brouillonAbandonne, surBrouillon }: ProprietesEditeurFerme): ReactElement {
  const idTitre = useId();
  const idRaisonZoom = useId();
  const idRaisonNouveau = useId();
  const idRaisonEnregistrer = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const geste = useRef<Geste | null>(null);
  const generateur = useRef<GenerateurId | null>(null);
  const pile = useRef<Enregistrement[]>([]);
  /** Doigts posés sur la carte (position dans la carte, par identifiant de pointeur). */
  const doigts = useRef(new Map<number, Point>());
  const deuxDoigts = useRef<DeuxDoigts | null>(null);
  /** Après un geste à deux doigts, le doigt resté ne déplace plus rien avant d'être levé. */
  const doigtResteIgnore = useRef(false);
  const appuiLong = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insererRef = useRef<(zoneId: string, cote: number) => void>(() => undefined);

  const grandEcran = usePreference(ordinateur === undefined ? '(min-width: 1024px)' : null, ordinateur ?? true);
  const reseau = useEnLigne();
  const surOrdinateur = ordinateur ?? grandEcran;
  const ecranTactile = usePreference('(pointer: coarse)', false);
  const enLigneEffectif = enLigne ?? reseau;

  // ── Lectures (surveillées : l'écran suit ses écritures et celles de la synchro) ──────────────
  const [ferme, setFerme] = useState<{ readonly valeur: FermeLue | null } | null>(null);
  const [roles, setRoles] = useState<readonly string[] | null>(null);
  const [lusB, setLusB] = useState<readonly Batiment[] | null>(null);
  const [zones, setZones] = useState<readonly Zone[] | null>(null);
  const [lusP, setLusP] = useState<readonly Planche[] | null>(null);
  const [lusE, setLusE] = useState<readonly EmplacementPlace[] | null>(null);
  // T85 : les emplacements en service (placés ou non), pour « Dessiner depuis les planches ».
  const [lusS, setLusS] = useState<readonly EmplacementEnService[] | null>(null);
  // Le morceau de T85 (chargé à part, en parallèle des lectures) : l'éditeur n'est prêt, en édition, qu'une fois lui et ses lectures arrivés.
  const [mZone, setMZone] = useState<typeof ModuleZone | null>(null);
  const [echecZone, setEchecZone] = useState(false);
  const [jour] = useState(() => new Date().toLocaleDateString('sv'));
  const [lusV, setLusV] = useState<readonly Vanne[]>([]);
  // T61 : chemins posés ; le tracé d'un nouveau (./chemins.tsx) se charge au premier « Tracer un chemin ».
  const [lusC, setLusC] = useState<readonly Chemin[]>([]);
  const [mChemin, setMChemin] = useState<typeof ModuleChemins | null>(null);
  const [chemin, setChemin] = useState<ModuleChemins.BrouillonChemin | null>(null);
  useEffect(() => porte.surveiller(requeteFerme(fermeId), (l) => { setFerme({ valeur: l[0] ?? null }); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteRoles(fermeId, utilisateurId), setRoles), [porte, fermeId, utilisateurId]);
  useEffect(() => porte.surveiller(requeteBatiments(fermeId), (l) => { setLusB(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteZones(fermeId), (l) => { setZones(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requetePlanches(fermeId), (l) => { setLusP(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteEmplacementsPlaces(fermeId), (l) => { setLusE(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => {
    let vivant = true;
    import('./zone-ecran.tsx').then(
      (m) => {
        if (vivant) setMZone(m);
      },
      () => {
        if (vivant) setEchecZone(true);
      },
    );
    return () => {
      vivant = false;
    };
  }, []);
  useEffect(() => (mZone === null ? undefined : porte.surveiller(mZone.requeteEmplacementsEnService(fermeId), (l) => { setLusS(sansNull(l)); })), [mZone, porte, fermeId]);
  useEffect(() => porte.surveiller(requeteVannes(fermeId, jour), (l) => { setLusV(sansNull(l)); }), [porte, fermeId, jour]);
  useEffect(() => porte.surveiller(requeteChemins(fermeId), (l) => { setLusC(sansNull(l)); }), [porte, fermeId]);
  const cheminEnCours = chemin !== null && mChemin !== null ? { b: chemin, m: mChemin } : null;

  const gerant = roles?.includes('gerant') === true;
  const pret = ferme !== null && roles !== null && lusB !== null && zones !== null && lusP !== null && lusE !== null && (echecZone || (mZone !== null && lusS !== null));
  /** T87 : l'éditeur s'ouvre verrouillé, même pour le gérant ; « Modifier le plan » déverrouille, « Terminer » reverrouille. */
  const [modification, setModification] = useState(false);
  const mode = !pret ? undefined : gerant && modification ? 'edition' : 'lecture';
  const edition = mode === 'edition';

  // ── État de l'écran ───────────────────────────────────────────────────────────────────────────
  const [brouillonB, setBrouillonB] = useState<ReadonlyMap<string, Batiment>>(() => new Map());
  const [brouillonP, setBrouillonP] = useState<ReadonlyMap<string, Planche>>(() => new Map());
  const [brouillonZ, setBrouillonZ] = useState<ReadonlyMap<string, readonly Point[]>>(() => new Map());
  const [brouillonV, setBrouillonV] = useState<ReadonlyMap<string, Point>>(() => new Map());
  // T85 : le repère où les planches d'une zone gardent leur placement au brouillon, quand ce n'est plus celui de son contour lu.
  const [calages, setCalages] = useState<ReadonlyMap<string, RepereZone>>(() => new Map());
  const [passePied, setPassePied] = useState(PASSE_PIED_DEPART_CM);
  const [selection, setSelection] = useState<string | null>(null);
  const [zoneSel, setZoneSel] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [sommetSel, setSommetSel] = useState<number | null>(null);
  const [messageContour, setMessageContour] = useState<string | null>(null);
  const focusSommet = useRef<number | null>(null);
  const focusTracer = useRef(false);
  const conteneurContour = useRef<HTMLDivElement | null>(null);
  const clicDejaTraite = useRef<number | null>(null);
  const [gesteDoigt, setGesteDoigt] = useState<GesteDoigt>('aucun');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [formulaire, setFormulaire] = useState(false);
  const [pose, setPose] = useState<NouveauBatiment | null>(null);
  const [retour, setRetour] = useState<NumeroEtape | null>(null);
  const champAdresse = useRef<HTMLInputElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [dernier, setDernier] = useState<Enregistrement | null>(null);
  const [tuilesEnErreur, setTuilesEnErreur] = useState<ReadonlySet<string>>(() => new Set());
  const [taille, setTaille] = useState<{ readonly w: number; readonly h: number }>(TAILLE_PAR_DEFAUT);
  const [centreGeo, setCentreGeo] = useState<Position | null>(null);
  /** Zoom choisi par le geste ou les boutons ; null tant qu'on garde le zoom de départ. */
  const [zoomChoisi, setZoomChoisi] = useState<number | null>(null);
  const relances = useRef(new Map<string, { essais: number; minuterie: ReturnType<typeof setTimeout> | null }>());

  useEffect(() => {
    titre.current?.focus();
    return () => {
      if (appuiLong.current !== null) clearTimeout(appuiLong.current);
    };
  }, []);

  // La vue suit la taille de la surface de dessin.
  useEffect(() => {
    const plan = planRef.current;
    if (plan === null) return undefined;
    const mesurer = () => {
      const r = plan.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setTaille((t) => (t.w === r.width && t.h === r.height ? t : { w: r.width, h: r.height }));
    };
    mesurer();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const o = new ResizeObserver(mesurer);
    o.observe(plan);
    return () => {
      o.disconnect();
    };
  }, []);

  // Une tuile en échec ne condamne pas la session : le réseau qui revient redonne la photo.
  useEffect(() => {
    const retour = () => {
      for (const r of relances.current.values()) if (r.minuterie !== null) clearTimeout(r.minuterie);
      relances.current.clear();
      setTuilesEnErreur(new Set());
    };
    addEventListener('online', retour);
    const suivies = relances.current;
    return () => {
      removeEventListener('online', retour);
      for (const r of suivies.values()) if (r.minuterie !== null) clearTimeout(r.minuterie);
      suivies.clear();
    };
  }, []);

  // Une tuile en erreur est redemandée après DELAI_RELANCE_TUILE_MS, sans attendre le réseau : une relance à la fois, ESSAIS_TUILE_MAX au plus.
  function tuileEnErreur(cle: string): void {
    setTuilesEnErreur((prev) => (prev.has(cle) ? prev : new Set(prev).add(cle)));
    const suivie = relances.current.get(cle) ?? { essais: 0, minuterie: null };
    relances.current.set(cle, suivie);
    if (suivie.minuterie !== null || suivie.essais >= ESSAIS_TUILE_MAX) return;
    suivie.essais += 1;
    suivie.minuterie = setTimeout(() => {
      suivie.minuterie = null;
      setTuilesEnErreur((prev) => {
        const reste = new Set(prev);
        reste.delete(cle);
        return reste;
      });
    }, DELAI_RELANCE_TUILE_MS);
  }

  // « Annuler » ne reste que delaiAnnulationMs.
  useEffect(() => {
    if (dernier === null) return undefined;
    const minuterie = setTimeout(() => {
      setDernier((n) => (n === dernier ? null : n));
    }, delaiAnnulationMs);
    return () => {
      clearTimeout(minuterie);
    };
  }, [dernier, delaiAnnulationMs]);

  // Le focus suit le sommet choisi au clavier (Inser, Suppr), et va au tracé quand il s'ouvre (Entrée le ferme).
  useEffect(() => {
    if (focusTracer.current) {
      const b = document.querySelector<HTMLElement>('[data-action="tracer"]');
      if (b !== null) {
        focusTracer.current = false;
        b.focus();
      }
    }
    const i = focusSommet.current;
    if (i === null) return;
    focusSommet.current = null;
    document.querySelector<HTMLElement>(`[data-testid="sommet"][data-index="${String(i)}"]`)?.focus();
  });
  const traceOuvert = trace !== null;
  useEffect(() => {
    if (traceOuvert) conteneurContour.current?.focus();
  }, [traceOuvert]);

  // ── Ce qui est affiché : la base, recouverte par le brouillon ────────────────────────────────
  const origine = ferme?.valeur?.origine ?? null;
  const origineVue = origine ?? ferme?.valeur?.position ?? POSITION_DE_REPLI;
  const centreEffectif = centreGeo ?? origineVue;
  // Sans point de départ ni position de ferme, la vue s'ouvre large pour retrouver la ferme.
  const zoom = zoomChoisi ?? (origine === null && ferme?.valeur?.position == null ? ZOOM_DEPART_SANS_POSITION : ZOOM_INITIAL);
  const vue: VueCarte = useMemo(
    () => ({ origine: origineVue, centre: versLocal(origineVue, centreEffectif), zoom, largeurPx: taille.w, hauteurPx: taille.h }),
    [origineVue, centreEffectif, zoom, taille],
  );

  // Sites : les zones de premier niveau déjà placées (chacune peut être un site à part).
  const zonesPlacees = useMemo(
    () => (origine === null ? [] : (zones ?? []).flatMap((z) => (z.parenteId == null && z.contour !== null ? [{ id: z.id, nom: z.nom, contour: z.contour }] : []))),
    [origine, zones],
  );

  const batimentsAff = useMemo(() => {
    const lus = lusB ?? [];
    const connus = new Set(lus.map((b) => b.id));
    return [...lus.map((b) => brouillonB.get(b.id) ?? b), ...[...brouillonB.values()].filter((b) => !connus.has(b.id))];
  }, [lusB, brouillonB]);

  // T86 : les sous-zones d'une zone abritée par une serre sont des bandes de la serre (leur contour tracé est ignoré).
  const bandes = useMemo(() => mZone?.bandesDesSerres(zones ?? [], batimentsAff) ?? new Map<string, InfoBande>(), [mZone, zones, batimentsAff]);

  const zonesInfo = useMemo(() => {
    const m = new Map<string, ZoneAffichee>();
    for (const z of zones ?? []) {
      const abritee = bandes.has(z.id) || batimentsAff.some((b) => b.zoneId === z.id);
      const b = brouillonZ.get(z.id);
      const verdict = b === undefined ? null : verifierContour(b.map((p) => ({ x: arrondi(p.x), y: arrondi(p.y) })));
      const change = b !== undefined && !abritee && contourChange(z.contour, b);
      m.set(z.id, {
        zone: z,
        abritee,
        affiche: abritee ? null : (b ?? z.contour),
        effectif: change && verdict?.ok === true ? verdict.contour : z.contour,
        change,
        verdict,
      });
    }
    return m;
  }, [zones, batimentsAff, brouillonZ, bandes]);

  /** Repère d'affichage de chaque zone (contour du brouillon s'il est valide), et repère où les planches gardent leur placement au brouillon (contour de la base). */
  const reperes = useMemo(() => {
    const m = new Map<string, { readonly affichage: Repere | null; readonly base: Repere | null }>();
    for (const i of zonesInfo.values()) {
      const abri = batimentsAff.find((b) => b.zoneId === (bandes.get(i.zone.id)?.racineId ?? i.zone.id));
      const abritee = abri === undefined ? null : { centre: abri.centre, orientationDeg: abri.orientationDeg };
      const affichage = repereZone({ contour: abri === undefined ? i.effectif : null }, abritee);
      m.set(i.zone.id, { affichage, base: abri === undefined ? (calages.get(i.zone.id) ?? repereZone({ contour: i.zone.contour })) : affichage });
    }
    return m;
  }, [zonesInfo, batimentsAff, calages, bandes]);

  // Un contour changé ne déplace pas les planches de la zone sur le terrain (décision du chef) ; un bloc déplacé ou tourné
  // (T85) les emmène : leur placement est gardé dans le repère `base`, qui a suivi le bloc. Celles que le brouillon vient de ranger
  // (parcelle dessinée depuis les planches) ne sont pas encore dans la base.
  const planchesAff = useMemo(() => {
    const lues = lusP ?? [];
    const connues = new Set(lues.map((p) => p.id));
    return [...lues, ...[...brouillonP.values()].filter((p) => !connues.has(p.id))].map((p) => {
      const info = zonesInfo.get(p.zoneId);
      const base = brouillonP.get(p.id) ?? p;
      const r = reperes.get(p.zoneId);
      if (info === undefined || info.abritee || r?.base == null || r.affichage == null || !(info.change || calages.has(p.zoneId))) return base;
      const [replacee] = replacerEntreReperes(r.base, r.affichage, [{ id: p.id, placement: base.placement }]);
      return replacee === undefined ? base : { ...base, placement: replacee.placement };
    });
  }, [lusP, brouillonP, zonesInfo, reperes, calages]);

  const elements = useMemo(() => {
    const liste: Objet[] = batimentsAff.map((b) => ({
      sorte: 'batiment',
      id: b.id,
      libelle: `${b.nom}, ${LIBELLE_TYPE[b.type].toLocaleLowerCase('fr')}`,
      rect: { centre: b.centre, orientationDeg: b.orientationDeg, longueurM: b.longueurM, largeurM: b.largeurM },
      repere: null,
    }));
    const planches: Objet[] = [];
    for (const p of planchesAff) {
      const repere = reperes.get(p.zoneId);
      if (repere?.affichage == null) continue;
      const place = depuisPlacementPlanche(repere.affichage, p.placement);
      planches.push({
        sorte: 'planche',
        id: p.id,
        libelle: `Planche ${p.code}`,
        rect: { centre: place.centre, orientationDeg: place.orientationDeg, longueurM: p.longueurM, largeurM: p.largeurM },
        repere: repere.base ?? repere.affichage,
      });
    }
    // T57 : une vanne à sa place, sinon en tête de sa première planche affichée (plus petit code), au bout opposé à son cap.
    const vannes: Objet[] = [];
    for (const v of lusV) {
      let centre = brouillonV.get(v.id) ?? v.position;
      if (centre === null) {
        const premiere = planches.filter((p) => v.planches.includes(p.id)).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr', { numeric: true }))[0];
        if (premiere === undefined) continue;
        const t = (premiere.rect.orientationDeg * Math.PI) / 180;
        const d = premiere.rect.longueurM / 2;
        centre = { x: premiere.rect.centre.x - Math.sin(t) * d, y: premiere.rect.centre.y - Math.cos(t) * d };
      }
      vannes.push({ sorte: 'vanne', id: v.id, libelle: `Vanne ${v.nom}`, rect: { centre, orientationDeg: 0, longueurM: 1, largeurM: 1 }, repere: null });
    }
    return { batiments: liste, planches, vannes };
  }, [batimentsAff, planchesAff, reperes, lusV, brouillonV]);

  const choisi = selection === null ? undefined : [...elements.batiments, ...elements.planches, ...elements.vannes].find((e) => e.id === selection);
  const batimentChoisi = choisi?.sorte === 'batiment' ? batimentsAff.find((b) => b.id === choisi.id) : undefined;

  const changements = useMemo(
    () =>
      pret
        ? changementsDuBrouillon({
            batiments: lusB,
            // Ce qui est écrit respecte la borne même si le champ n'a pas été quitté.
            brouillonBatiments: new Map([...brouillonB].map(([id, b]) => [id, { ...b, longueurM: Math.max(DIMENSION_MIN_M, b.longueurM), largeurM: Math.max(DIMENSION_MIN_M, b.largeurM) }])),
            zones,
            planches: lusP,
            emplacements: lusE,
            brouillonPlanches: brouillonP,
            brouillonZones: brouillonZ,
            zonesAbritees: new Set([...zonesInfo.values()].filter((i) => i.abritee).map((i) => i.zone.id)),
            calages,
          }).concat(
            // T57 : les vannes déplacées (repère de la ferme, au millimètre).
            [...brouillonV].flatMap(([id, p]): ChangementPlacement[] => {
              const avant = lusV.find((v) => v.id === id);
              const position = { x: arrondi(p.x), y: arrondi(p.y) };
              return avant === undefined || (avant.position?.x === position.x && avant.position.y === position.y) ? [] : [{ sorte: 'vanne', id, position }];
            }),
            chemin !== null && mChemin !== null ? mChemin.changements(chemin) : [],
            mZone?.changementsDesBandes(zones, lusP, brouillonP, brouillonZ, bandes) ?? [],
          )
        : [],
    [pret, lusB, brouillonB, zones, lusP, lusE, brouillonP, brouillonZ, zonesInfo, calages, brouillonV, lusV, chemin, mChemin, mZone, bandes],
  );
  const modifie = changements.length > 0;
  const contoursModifies = [...zonesInfo.values()].filter((i) => i.change);
  const contoursInvalides = contoursModifies.filter((i) => i.verdict?.ok === false);
  /** Quelque chose à perdre en fermant : changements à écrire, contour refusé, tracé commencé. */
  const brouillonOuvert = modifie || contoursModifies.length > 0 || (trace?.sommets.length ?? 0) > 0 || chemin !== null;
  const tropDeChangements = changements.length > ECRITURES_MAX_PAR_LOT;
  useEffect(() => {
    surBrouillon(brouillonOuvert);
  }, [surBrouillon, brouillonOuvert]);
  // Le message d'abandon disparaît au premier geste (ou à la pose suivante) dans la nouvelle ferme.
  const [abandonAffiche, setAbandonAffiche] = useState(brouillonAbandonne);
  if (brouillonOuvert && abandonAffiche) setAbandonAffiche(false);
  const courante = etapeCourante(origine !== null, pose !== null, batimentsAff.length);
  // Le parcours guidé déverrouille de lui-même : à l'ouverture d'une ferme qui n'a pas fini ses étapes
  // (point de départ, premier bâtiment), puis à chaque changement d'étape.
  const [derniereEtape, setDerniereEtape] = useState<NumeroEtape | null>(null);
  if (pret && gerant && derniereEtape !== courante) {
    setDerniereEtape(courante);
    if (derniereEtape !== null || courante < 4) setModification(true);
  }
  const etapeVue = retour !== null && retour < courante ? retour : courante;
  // Un seul calcul : « Enregistrer » est possible quand rien ne l'empêche, sinon la raison s'affiche.
  const raisonEnregistrer = occupe
    ? MESSAGES_ETAPES.occupe
    : trace !== null
      ? MESSAGES_ETAPES.traceEnCours
      : cheminEnCours?.m.raison(cheminEnCours.b) != null
        ? cheminEnCours.m.raison(cheminEnCours.b)
      : contoursInvalides.length > 0
        ? MESSAGES_ETAPES.contourInvalide
        : tropDeChangements
          ? MESSAGES_CONTOURS.tropDeChangements
          : modifie
            ? null
            : MESSAGES_ETAPES.rienAEnregistrer;
  /** « Nouveau bâtiment » et « Tracer un chemin » attendent l'origine, et la fin d'une pose ou d'un tracé. */
  const nouveauBloque = origine === null || pose !== null || trace !== null;
  const raisonNouveau = origine === null ? MESSAGES_ETAPES.sansOrigine : pose !== null ? MESSAGES_ETAPES.poseEnCours : MESSAGES_ETAPES.traceEnCours;
  const peutEnregistrer = raisonEnregistrer === null;

  // Les tuiles ne sont demandées qu'une fois les données de la ferme lues (la vue est alors la bonne).
  const tuiles = useMemo(() => (pret && enLigneEffectif ? tuilesVisibles(vue) : []), [pret, enLigneEffectif, vue]);
  const cleTuile = (t: { zoom: number; colonne: number; ligne: number }): string => `${String(t.zoom)}/${String(t.colonne)}/${String(t.ligne)}`;
  const toutesEnErreur = tuiles.length > 0 && tuiles.every((t) => tuilesEnErreur.has(cleTuile(t)));
  const fondPhoto = enLigneEffectif && !toutesEnErreur;
  const mpp = metresParPixel(vue.origine.latitude, vue.zoom);

  // ── Brouillon ─────────────────────────────────────────────────────────────────────────────────
  function majBatiment(id: string, patch: Partial<Batiment>): void {
    const base = brouillonB.get(id) ?? lusB?.find((b) => b.id === id);
    if (base === undefined) return;
    setBrouillonB((prev) => new Map(prev).set(id, { ...(prev.get(id) ?? base), ...patch }));
  }

  /** Applique un rectangle (repère de la ferme) à l'élément : bâtiment tel quel, planche dans le repère de sa zone. */
  function majRectangle(e: Objet, r: RectanglePlace): void {
    if (e.sorte === 'vanne') {
      setBrouillonV((prev) => new Map(prev).set(e.id, r.centre));
      return;
    }
    if (e.sorte === 'batiment') {
      majBatiment(e.id, { centre: r.centre, orientationDeg: r.orientationDeg, longueurM: r.longueurM, largeurM: r.largeurM });
      return;
    }
    const lue = lusP?.find((p) => p.id === e.id) ?? brouillonP.get(e.id);
    if (lue === undefined || e.repere === null) return;
    const placement = versPlacementPlanche(e.repere, r);
    setBrouillonP((prev) => new Map(prev).set(e.id, { ...(prev.get(e.id) ?? lue), placement }));
  }

  function abandonner(): void {
    setBrouillonB(new Map());
    setBrouillonP(new Map());
    setBrouillonZ(new Map());
    setBrouillonV(new Map());
    setCalages(new Map());
    setTrace(null);
    setChemin(null);
    setMessageContour(null);
    setErreur(null);
  }

  /** Choisit un bâtiment ou une planche (ou rien) : la zone choisie est laissée, un tracé en cours est abandonné. */
  function selectionner(id: string | null): void {
    setSelection(id);
    setZoneSel(null);
    setSommetSel(null);
    setMessageContour(null);
    focusTracer.current = false;
    if (id !== null) setTrace(null);
  }

  function choisirZoneListe(id: string): void {
    setSelection(null);
    setZoneSel(id);
    setSommetSel(null);
    setMessageContour(null);
    focusTracer.current = false;
    if (trace?.zoneId !== id) setTrace(null);
  }

  // ── Contours de zones ─────────────────────────────────────────────────────────────────────────
  function majContour(zoneId: string, contour: readonly Point[]): void {
    setBrouillonZ((prev) => new Map(prev).set(zoneId, contour));
    setMessageContour(null);
  }

  function demarrerTrace(zoneId: string): void {
    setTrace({ zoneId, sommets: [] });
    setSommetSel(null);
    setMessageContour(null);
  }

  function abandonnerTrace(): void {
    // Le focus ne revient sur « Tracer le contour » que si la zone du tracé est affichée.
    focusTracer.current = trace !== null && trace.zoneId === zoneSel && zonesInfo.has(trace.zoneId);
    setTrace(null);
  }

  function fermerTrace(): void {
    if (trace === null || trace.sommets.length < 3) return;
    majContour(trace.zoneId, trace.sommets);
    setTrace(null);
    setSommetSel(0);
    focusSommet.current = 0;
  }

  // ── Bloc d'une zone (T85) ─────────────────────────────────────────────────────────────────────
  /** Le contour et le repère de ses planches bougent ensemble, à partir de l'état `contour0` / `calage0` donné. */
  function bougerBloc(zoneId: string, contour0: readonly Point[], calage0: RepereZone, mouvement: MouvementBloc): void {
    const r = mZone?.mouvoirBloc(contour0, calage0, mouvement);
    if (r == null) return;
    setCalages((prev) => new Map(prev).set(zoneId, r.calage));
    majContour(zoneId, r.contour);
  }

  /** Le champ « Orientation (°) » : le bloc tourne autour de son centre (le mouvement vient du panneau). */
  function orienterBloc(zoneId: string, mouvement: MouvementBloc): void {
    const contour = zonesInfo.get(zoneId)?.affiche;
    const base = reperes.get(zoneId)?.base;
    if (contour != null && base != null) bougerBloc(zoneId, contour, base, mouvement);
  }

  function commencerBloc(e: PointerEvent, zoneId: string, mode: 'deplacer' | 'pivoter'): void {
    e.stopPropagation();
    const contour = zonesInfo.get(zoneId)?.affiche;
    const r = reperes.get(zoneId);
    if (!edition || (e.pointerType === 'mouse' && e.button !== 0) || contour == null || r?.base == null || r.affichage == null) return;
    const pixel0 = pixelDe(e);
    geste.current = {
      type: 'bloc',
      mode,
      zoneId,
      contour0: contour,
      calage0: r.base,
      centre0: r.affichage.centre,
      orientation0: r.affichage.orientationDeg,
      pixel0,
      depart: depuisEcran(vue, pixel0),
      vue,
      demarre: mode === 'pivoter',
    };
    capturer(e);
  }

  /** « Dessiner depuis les planches » : le contour et le placement de chaque emplacement de la zone vont au brouillon. */
  function dessinerDepuisPlanches(zoneId: string): void {
    if (mZone === null || lusS === null) return;
    const r = mZone.preparerParcelle(zoneId, lusS.filter((x) => x.zoneId === zoneId), Number(passePied), { x: vue.centre.x, y: vue.centre.y });
    if (!r.ok) {
      setMessageContour(r.message);
      return;
    }
    poserRangement({ planches: r.planches, zones: [[zoneId, r.contour]], message: null });
    setCalages((prev) => new Map(prev).set(zoneId, r.calage));
  }

  /** Les planches rangées vont au brouillon, avec les contours qui changent avec elles (T86 : un contour vide est un contour à effacer). */
  function poserRangement(r: ModuleZone.RangementBandes): void {
    setBrouillonP((prev) => new Map([...prev, ...r.planches.map((p): [string, Planche] => [p.id, p])]));
    setBrouillonZ((prev) => new Map([...prev, ...r.zones]));
    setMessageContour(r.message);
    setSommetSel(null);
  }

  function retirer(zoneId: string, index: number): void {
    const contour = zonesInfo.get(zoneId)?.affiche;
    if (contour == null) return;
    const reste = retirerSommet(contour, index);
    if (reste === null) {
      setMessageContour(MESSAGE_SOMMETS_MIN);
      return;
    }
    majContour(zoneId, reste);
    setSommetSel(Math.min(index, reste.length - 1));
  }

  function insererSurCote(zoneId: string, cote: number): void {
    const contour = zonesInfo.get(zoneId)?.affiche;
    if (contour == null) return;
    majContour(zoneId, insererMilieu(contour, cote));
    setSommetSel(cote + 1);
  }
  useEffect(() => {
    insererRef.current = insererSurCote;
  });

  /** Clavier d'un sommet : flèches 0,1 m (Maj : 1 m), Inser (ajoute après), Suppr (retire). */
  function surToucheSommet(e: KeyboardEvent<HTMLElement>, zoneId: string, index: number): void {
    if (!edition || trace !== null || e.metaKey || (e.ctrlKey && !e.altKey)) return;
    const contour = zonesInfo.get(zoneId)?.affiche;
    if (contour == null) return;
    const r = toucheSommet(contour, index, { key: e.key, shiftKey: e.shiftKey });
    if (r === null) return;
    e.preventDefault();
    if (r.refuse) {
      setMessageContour(MESSAGE_SOMMETS_MIN);
      return;
    }
    majContour(zoneId, r.contour);
    setSommetSel(r.index);
    if (r.index !== index || r.contour.length !== contour.length) focusSommet.current = r.index;
  }

  function commencerSommet(e: PointerEvent<HTMLElement>, zoneId: string, index: number, contour: readonly Point[]): void {
    e.stopPropagation();
    setSommetSel(index);
    if (!edition || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pixel0 = pixelDe(e);
    geste.current = { type: 'sommet', zoneId, index, contour0: contour, pixel0, depart: depuisEcran(vue, pixel0), vue, fige: trace !== null, demarre: false };
    capturer(e);
  }


  function commencerCote(e: PointerEvent<SVGElement>, zoneId: string, index: number): void {
    e.stopPropagation();
    clicDejaTraite.current = null;
    if (!edition || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const tactile = e.pointerType === 'touch';
    geste.current = { type: 'milieu', zoneId, index, pixel0: pixelDe(e), tactile, demarre: false };
    if (!tactile) return;
    // Au doigt, seul l'appui long ajoute un sommet : le clic qui suit un tap est ignoré.
    clicDejaTraite.current = index;
    arreterAppuiLong();
    appuiLong.current = setTimeout(() => {
      appuiLong.current = null;
      const g = geste.current;
      if (g?.type !== 'milieu' || g.demarre) return;
      geste.current = null;
      insererRef.current(zoneId, index);
    }, DELAI_APPUI_LONG_MS);
  }

  function arreterAppuiLong(): void {
    if (appuiLong.current === null) return;
    clearTimeout(appuiLong.current);
    appuiLong.current = null;
  }

  // ── Écriture : toujours par porte.placer ─────────────────────────────────────────────────────
  async function recharger(): Promise<void> {
    const l = await lireTout(porte, fermeId, utilisateurId, jour);
    setFerme({ valeur: l.ferme });
    setRoles(l.roles);
    setLusB(l.batiments);
    setZones(l.zones);
    setLusP(l.planches);
    setLusE(l.emplacements);
    setLusV(l.vannes);
    setLusC(l.chemins);
  }

  /** Relit la base après une écriture réussie ; un échec ne défait rien : il est dit à part d'un refus. */
  async function relireApresEcriture(): Promise<void> {
    try {
      await recharger();
    } catch (e) {
      console.error('Relecture après écriture impossible', e);
      setErreur(`${MESSAGES_PLACEMENT.enregistreSansRelecture} : l’affichage n’a pas pu être mis à jour. Fermez puis rouvrez le placement.`);
    }
  }

  /** Écrit par la porte ; rend l'enregistrement (de quoi l'annuler), ou null si la porte a refusé. */
  async function ecrire(liste: readonly ChangementPlacement[]): Promise<Enregistrement | null> {
    setOccupe(true);
    setErreur(null);
    let entree: Enregistrement;
    try {
      entree = { annulation: await porte.placer(liste) };
    } catch (e) {
      console.error('Placement refusé', e);
      setErreur(messageDe(e));
      setOccupe(false);
      return null;
    }
    pile.current.push(entree);
    await relireApresEcriture();
    setOccupe(false);
    return entree;
  }

  async function enregistrer(): Promise<boolean> {
    if (!peutEnregistrer) return false;
    const [ecritsB, ecritsP, ecritsZ, ecritsV, ecritC, ecritsCal] = [brouillonB, brouillonP, brouillonZ, brouillonV, chemin, calages];
    const entree = await ecrire(changements);
    if (entree === null) return false;
    // Seul ce qui vient d'être écrit sort du brouillon : un geste fait pendant l'écriture reste.
    const sans = <T,>(prev: ReadonlyMap<string, T>, ecrits: ReadonlyMap<string, T>): Map<string, T> => {
      const reste = new Map(prev);
      for (const [id, v] of ecrits) if (reste.get(id) === v) reste.delete(id);
      return reste;
    };
    setBrouillonB((prev) => sans(prev, ecritsB));
    setBrouillonP((prev) => sans(prev, ecritsP));
    setBrouillonZ((prev) => sans(prev, ecritsZ));
    setBrouillonV((prev) => sans(prev, ecritsV));
    setCalages((prev) => sans(prev, ecritsCal));
    setChemin((c) => (c === ecritC ? null : c));
    setDernier(entree);
    return true;
  }

  /** T87 : reverrouille ; ce qui était en cours de pose ou de tracé n'a plus lieu d'être. */
  function verrouiller(): void {
    setModification(false);
    setPose(null);
    setFormulaire(false);
    setTrace(null);
    setChemin(null);
    setSommetSel(null);
    setMessageContour(null);
  }

  /** « Terminer » : sans rien à perdre, reverrouille aussitôt ; sinon demande d'enregistrer ou d'abandonner. */
  function terminer(): void {
    if (brouillonOuvert) setConfirmation({ type: 'terminer' });
    else verrouiller();
  }

  async function defaire(entree: Enregistrement | undefined): Promise<void> {
    if (entree === undefined || occupe) return;
    setOccupe(true);
    setErreur(null);
    try {
      await porte.placer(entree.annulation);
    } catch (e) {
      // Refusée : l'enregistrement reste dans la pile, « Annuler » et Ctrl+Z réessaient.
      console.error('Annulation impossible', e);
      setErreur(`Rien n’a été annulé : ${messageDe(e)}`);
      setOccupe(false);
      return;
    }
    pile.current = pile.current.filter((x) => x !== entree);
    setDernier((n) => (n === entree ? null : n));
    await relireApresEcriture();
    setOccupe(false);
  }

  async function poserOrigine(position: Position): Promise<void> {
    // La photo ne bouge pas quand l'origine change de la position météo au lieu cliqué.
    setCentreGeo(centreEffectif);
    const entree = await ecrire([{ sorte: 'origine', origine: { latitude: position.latitude, longitude: position.longitude } }]);
    if (entree !== null) setDernier(entree);
  }

  // ── Gestes ────────────────────────────────────────────────────────────────────────────────────
  const pixelDe = (e: { clientX: number; clientY: number }): Point => {
    const r = planRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  /** Un doigt (ou la souris) pose sur la carte : le geste du fond, qui déplace la vue ; `cible` : l'élément qu'un simple tap choisira. */
  function commencerFond(e: PointerEvent<HTMLElement>, cible: string | null): void {
    geste.current = { type: 'fond', pixel0: pixelDe(e), centre0: vue.centre, vue, cible, deplace: false };
    capturer(e);
  }

  function commencer(e: PointerEvent<HTMLElement>, element: Objet, type: 'deplacer' | 'pivoter' | 'cote', cote: Cote | null): void {
    e.stopPropagation();
    // T87, souris comme doigt : seul l'élément déjà choisi se déplace (en modification) ; sur un autre, ou plan verrouillé,
    // le glisser déplace la carte et un tap le choisit.
    if (type === 'deplacer' && (!edition || selection !== element.id)) {
      if (e.pointerType === 'mouse' && e.button !== 0) selectionner(element.id);
      else commencerFond(e, element.id);
      return;
    }
    selectionner(element.id);
    if (!edition || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pixel0 = pixelDe(e);
    geste.current = { type, element, pixel0, depart: depuisEcran(vue, pixel0), vue, cote, demarre: type !== 'deplacer' };
    capturer(e);
  }

  // ── Doigts ────────────────────────────────────────────────────────────────────────────────────
  /** Un doigt se pose (phase de capture : même quand l'élément touché arrête l'événement). Le deuxième lance le geste à deux doigts. */
  function doigtPose(e: PointerEvent<HTMLElement>): void {
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) {
      // Premier doigt d'un nouveau contact : on repart de zéro (un doigt perdu ne reste pas posé).
      doigts.current.clear();
      deuxDoigts.current = null;
      doigtResteIgnore.current = false;
    }
    doigts.current.set(e.pointerId, pixelDe(e));
    if (doigts.current.size < 2) return;
    // Deuxième doigt et suivants : jamais pour l'élément touché.
    e.stopPropagation();
    if (deuxDoigts.current !== null || doigts.current.size > 2) return;
    const [a, b] = [...doigts.current.keys()];
    const pa = doigts.current.get(a ?? -1);
    const pb = doigts.current.get(b ?? -1);
    if (a === undefined || b === undefined || pa === undefined || pb === undefined) return;
    geste.current = null;
    arreterAppuiLong();
    doigtResteIgnore.current = false;
    deuxDoigts.current = {
      ids: [a, b],
      distance0: Math.hypot(pb.x - pa.x, pb.y - pa.y),
      zoom0: zoom,
      element: edition ? (choisi ?? null) : null,
      angle: angleEntre(pa, pb),
      tourne: 0,
      tournant: false,
    };
    setGesteDoigt('deux-doigts');
  }

  /** Les deux doigts bougent : le zoom suit l'écart (un niveau par doublement), l'élément choisi suit l'angle. */
  function bougerDeuxDoigts(d: DeuxDoigts): void {
    const pa = doigts.current.get(d.ids[0]);
    const pb = doigts.current.get(d.ids[1]);
    if (pa === undefined || pb === undefined) return;
    const distance = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (d.distance0 >= 1 && distance >= 1) {
      const niveau = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_VUE, d.zoom0 + Math.round(Math.log2(distance / d.distance0))));
      if (niveau !== zoom) setZoomChoisi(niveau);
    }
    const angle = angleEntre(pa, pb);
    d.tourne += ecartAngle(angle - d.angle);
    d.angle = angle;
    if (!d.tournant && Math.abs(d.tourne) >= SEUIL_ROTATION_DOIGTS_DEG) d.tournant = true;
    if (d.element !== null && d.tournant) majRectangle(d.element, tournerDe(d.element.rect, Math.round(d.tourne)));
  }

  /** Un doigt se lève ou est interrompu : fin du geste à deux doigts, ou fin du geste à un doigt. */
  function doigtLeve(e: PointerEvent<HTMLElement>, annule: boolean): void {
    if (e.pointerType !== 'touch') {
      if (annule) geste.current = null;
      else surRelache();
      return;
    }
    doigts.current.delete(e.pointerId);
    const d = deuxDoigts.current;
    if (d !== null) {
      if (d.ids.includes(e.pointerId)) {
        deuxDoigts.current = null;
        doigtResteIgnore.current = doigts.current.size > 0;
        setGesteDoigt('aucun');
      }
      return;
    }
    if (doigtResteIgnore.current) {
      if (doigts.current.size === 0) doigtResteIgnore.current = false;
      return;
    }
    setGesteDoigt('aucun');
    arreterAppuiLong();
    if (annule) geste.current = null;
    else surRelache();
  }

  function surBouge(e: PointerEvent<HTMLElement>): void {
    if (e.pointerType === 'touch') {
      if (doigts.current.has(e.pointerId)) doigts.current.set(e.pointerId, pixelDe(e));
      if (deuxDoigts.current !== null) {
        if (deuxDoigts.current.ids.includes(e.pointerId)) bougerDeuxDoigts(deuxDoigts.current);
        return;
      }
      if (doigtResteIgnore.current) return;
    }
    const g = geste.current;
    if (g === null) return;
    const pixel = pixelDe(e);
    const tactile = e.pointerType === 'touch';
    if (g.type === 'fond') {
      if (!g.deplace && Math.hypot(pixel.x - g.pixel0.x, pixel.y - g.pixel0.y) < SEUIL_GLISSEMENT_PX) return;
      if (tactile && !g.deplace) setGesteDoigt('carte');
      g.deplace = true;
      const m = metresParPixel(g.vue.origine.latitude, g.vue.zoom);
      setCentreGeo(versGeographique(g.vue.origine, { x: g.centre0.x - (pixel.x - g.pixel0.x) * m, y: g.centre0.y + (pixel.y - g.pixel0.y) * m }));
      return;
    }
    if (g.type === 'milieu' || g.type === 'sommet') {
      if (!g.demarre) {
        if (Math.hypot(pixel.x - g.pixel0.x, pixel.y - g.pixel0.y) < SEUIL_GLISSEMENT_PX) return;
        g.demarre = true;
        arreterAppuiLong();
        if (tactile && g.type === 'sommet') setGesteDoigt('sommet');
      }
      if (g.type === 'milieu' || g.fige) return;
      const p = depuisEcran(g.vue, pixel);
      const sommet = g.contour0[g.index];
      if (sommet !== undefined) majContour(g.zoneId, deplacerSommet(g.contour0, g.index, { x: arrondi(sommet.x + p.x - g.depart.x), y: arrondi(sommet.y + p.y - g.depart.y) }));
      return;
    }
    if (g.type === 'bloc') {
      if (!g.demarre) {
        if (Math.hypot(pixel.x - g.pixel0.x, pixel.y - g.pixel0.y) < SEUIL_GLISSEMENT_PX) return;
        g.demarre = true;
      }
      if (tactile) setGesteDoigt('element');
      if (mZone !== null) bougerBloc(g.zoneId, g.contour0, g.calage0, mZone.mouvementDuGeste(g, depuisEcran(g.vue, pixel), e.shiftKey));
      return;
    }
    if (!g.demarre) {
      if (Math.hypot(pixel.x - g.pixel0.x, pixel.y - g.pixel0.y) < SEUIL_GLISSEMENT_PX) return;
      g.demarre = true;
    }
    if (tactile && g.type === 'deplacer') setGesteDoigt('element');
    const p = depuisEcran(g.vue, pixel);
    const r = g.element.rect;
    if (g.type === 'deplacer') majRectangle(g.element, glisser(r, g.depart, p));
    else if (g.type === 'pivoter') majRectangle(g.element, pivoter(r, p, e.shiftKey));
    else if (g.cote !== null) majRectangle(g.element, redimensionner(r, g.cote, p));
  }

  function surRelache(): void {
    const g = geste.current;
    geste.current = null;
    if (g === null) return;
    if (g.type === 'fond') {
      if (g.deplace) return;
      if (g.cible !== null) selectionner(g.cible);
      else surClic(g.pixel0, g.vue);
    } else if (g.type === 'sommet') {
      // Un simple clic sur le premier sommet d'un tracé le ferme.
      if (!g.demarre && g.fige && g.index === 0) fermerTrace();
    } else if (g.type === 'bloc') {
      // Un simple toucher dans la zone choisit ce qui est dessous (planche, bâtiment, vanne), s'il y a quelque chose.
      if (!g.demarre) {
        const dessous = mZone?.elementSous(g.depart, elements, TAILLE_VANNE_PX * metresParPixel(g.vue.origine.latitude, g.vue.zoom));
        if (dessous !== undefined) selectionner(dessous);
      }
    } else if (g.type === 'milieu' && !g.demarre && !g.tactile) {
      clicDejaTraite.current = g.index;
      insererSurCote(g.zoneId, g.index);
    }
  }

  function surClic(pixel: Point, v: VueCarte): void {
    if (!pret || !edition) {
      selectionner(null);
      return;
    }
    const local = depuisEcran(v, pixel);
    if (cheminEnCours !== null) {
      setChemin(cheminEnCours.m.poser(cheminEnCours.b, local));
      return;
    }
    if (trace !== null) {
      const toleranceM = TOLERANCE_FERMETURE_PX * metresParPixel(v.origine.latitude, v.zoom);
      const r = poserPoint(trace.sommets, { x: arrondi(local.x), y: arrondi(local.y) }, toleranceM);
      if (r.ferme) fermerTrace();
      else setTrace({ zoneId: trace.zoneId, sommets: r.sommets });
      return;
    }
    if (pose !== null) {
      poserEn(local);
      return;
    }
    if (origine === null) {
      setConfirmation({ type: 'origine', position: versGeographique(v.origine, local) });
      return;
    }
    selectionner(null);
  }

  /** Ajoute un bâtiment au brouillon, sélectionné (centre et mesures arrondies au millimètre). */
  function ajouterBatiment(b: Omit<Batiment, 'id' | 'nouveau' | 'hauteurM'> & { readonly hauteurM?: number }): void {
    const id = nouvelId?.() ?? identifiantNeuf();
    setBrouillonB((prev) =>
      new Map(prev).set(id, {
        hauteurM: 3.5,
        ...b,
        id,
        nouveau: true,
      }),
    );
    selectionner(id);
  }

  /** Pose le nouveau bâtiment au point donné (repère de la ferme) : au brouillon, sélectionné. */
  function poserEn(local: Point): void {
    if (pose === null) return;
    ajouterBatiment({ ...pose, centre: { x: arrondi(local.x), y: arrondi(local.y) }, orientationDeg: 0, zoneId: null });
    setPose(null);
  }

  /**
   * T81 : pose une serre pour la zone, au brouillon, rattachée à elle (un seul « Enregistrer » crée
   * le bâtiment et efface le contour). Sans rectangle : au centre de la vue ; avec : sur le
   * rectangle de surface minimale du contour tracé.
   */
  function placerSerre(zoneId: string, englobant: RectangleEnglobant | null): void {
    const info = zonesInfo.get(zoneId);
    const type = mZone?.typeDeSerrePourZone(info?.zone.typeAbri);
    if (mZone === null || info === undefined || type == null) return;
    ajouterBatiment({ ...(englobant ?? { ...mZone.dimensionsParDefaut(batimentsAff, type), centre: { x: arrondi(vue.centre.x), y: arrondi(vue.centre.y) }, orientationDeg: 0 }), nom: info.zone.nom, type, zoneId });
  }

  /** Charge le calcul du rectangle englobant (à la demande), puis demande confirmation, avec ce qu'il faut savoir. */
  function remplacerParSerre(zoneId: string): void {
    void import('./serre-englobante.ts').then(
      (m) => {
        setConfirmation({ type: 'remplacer', zoneId, ...m.preparerRemplacement(zonesInfo.get(zoneId)?.affiche, planchesAff.filter((p) => p.zoneId === zoneId), reperes.get(zoneId)?.affichage) });
      },
      (e: unknown) => {
        setErreur(messageDe(e));
      },
    );
  }

  function identifiantNeuf(): string {
    generateur.current ??= creerGenerateurId({ horloge: () => Date.now(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
    return generateur.current<'Batiment'>();
  }

  /** Recherche d'adresse : la vue seule se déplace, l'origine du plan et la base ne bougent pas. */
  function allerAuLieu(p: PropositionAdresse): void {
    setCentreGeo({ latitude: p.latitude, longitude: p.longitude });
    setZoomChoisi(p.zoom);
  }

  /** « Aller à » et « Toute la ferme » : cadre l'emprise (repère local de la ferme) sur l'écran. */
  function cadrer(emprise: Emprise): void {
    const v = vueSurEmprise(emprise, { largeurPx: taille.w, hauteurPx: taille.h }, origineVue.latitude);
    setCentreGeo(versGeographique(origineVue, v.centre));
    setZoomChoisi(v.zoom);
  }

  function changerZoom(delta: number): void {
    setZoomChoisi(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN_VUE, zoom + delta)));
  }

  /** Boutons « Tourner −5° / +5° » : l'élément choisi tourne au brouillon (cap ramené dans [0, 360[). */
  function tournerSelection(delta: number): void {
    if (!edition || choisi === undefined) return;
    majRectangle(choisi, tournerDe(choisi.rect, delta));
  }

  // Clavier d'un élément : flèches 0,1 m (Maj : 1 m), [ ] 1°. AltGr (Ctrl+Alt sous Windows) donne [ et ] au clavier français.
  function surTouche(e: KeyboardEvent<HTMLElement>, element: Objet): void {
    if (!edition || e.metaKey || (e.ctrlKey && !e.altKey)) return;
    const r = appliquerTouche(element.rect, { key: e.key, shiftKey: e.shiftKey });
    if (r === null) return;
    e.preventDefault();
    majRectangle(element, r);
  }

  function surToucheEditeur(e: KeyboardEvent<HTMLElement>): void {
    garderLeFocus(e);
    const cible = e.target;
    const enSaisie = cible instanceof HTMLInputElement || cible instanceof HTMLSelectElement || cible instanceof HTMLTextAreaElement;
    // T61 : tracé d'un chemin : Entrée le termine, Échap l'abandonne.
    const r = cheminEnCours !== null && !enSaisie && !(cible instanceof HTMLButtonElement) ? cheminEnCours.m.touche(cheminEnCours.b, e.key) : undefined;
    if (r !== undefined) {
      e.preventDefault();
      setChemin(r);
      return;
    }
    if (edition && trace !== null && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Tracé en cours : Entrée le ferme (3 sommets au moins), Échap l'abandonne.
      if (e.key === 'Escape') {
        e.preventDefault();
        abandonnerTrace();
        return;
      }
      if (e.key === 'Enter' && !enSaisie && !(cible instanceof HTMLButtonElement)) {
        e.preventDefault();
        fermerTrace();
        return;
      }
    }
    if (edition && trace === null && pose !== null && e.key === 'Enter' && !enSaisie && !(cible instanceof HTMLButtonElement) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      poserEn(vue.centre);
      return;
    }
    if (edition && !enSaisie && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void defaire(pile.current.at(-1));
    }
  }

  function demanderFermeture(): void {
    if (brouillonOuvert) setConfirmation({ type: 'fermer' });
    else surFermer();
  }

  function choisirZone(b: Batiment, zoneId: string): void {
    if (zoneId === '') {
      majBatiment(b.id, { zoneId: null });
      return;
    }
    const aUnContour = zones?.some((z) => z.id === zoneId && z.contour !== null) === true;
    if (aUnContour && zoneId !== (lusB?.find((x) => x.id === b.id)?.zoneId ?? null)) setConfirmation({ type: 'zone', batimentId: b.id, zoneId });
    else majBatiment(b.id, { zoneId });
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────────────────────────
  // Au doigt (écran de téléphone ou de tablette, ou écran tactile), les zones à toucher font 44 px au moins.
  const auDoigt = !surOrdinateur || ecranTactile;
  const poignees = edition && choisi !== undefined && choisi.sorte !== 'vanne' ? positionsPoignees(vue, choisi.rect, auDoigt ? DECALAGE_POIGNEE_COTE_DOIGT_PX : 0) : null;
  const tailleSommet = auDoigt ? TAILLE_SOMMET_DOIGT_PX : TAILLE_SOMMET_SOURIS_PX;
  const carreau = CARREAU_M / mpp;
  const depart = versEcran(vue, { x: 0, y: 0 });
  const enPoints = (c: readonly Point[]): string =>
    c
      .map((p) => {
        const e = versEcran(vue, p);
        return `${String(e.x)},${String(e.y)}`;
      })
      .join(' ');
  const zoneChoisie = zoneSel === null ? undefined : zonesInfo.get(zoneSel);
  const traceZone = trace !== null && trace.zoneId === zoneChoisie?.zone.id ? trace : null;
  const enTrace = traceZone !== null;
  /** Sommets dessinés et éditables : le tracé en cours, sinon le contour affiché de la zone choisie (gérant, zone non abritée). */
  const sommetsAff: readonly Point[] = !edition || zoneChoisie === undefined || zoneChoisie.abritee ? [] : traceZone !== null ? traceZone.sommets : (zoneChoisie.affiche ?? []);
  // T85 : le bloc de la zone choisie (contour valide, hors tracé, pose ou chemin) se déplace par son intérieur et tourne par sa poignée.
  const reperesZoneChoisie = zoneChoisie === undefined ? undefined : reperes.get(zoneChoisie.zone.id);
  const blocZone =
    edition && zoneChoisie !== undefined && !zoneChoisie.abritee && !enTrace && pose === null && cheminEnCours === null && zoneChoisie.affiche !== null && zoneChoisie.verdict?.ok !== false && reperesZoneChoisie?.base != null && reperesZoneChoisie.affichage != null
      ? { id: zoneChoisie.zone.id, contour: zoneChoisie.affiche, repere: reperesZoneChoisie.affichage }
      : null;
  const poigneeBloc = blocZone === null || mZone === null ? null : mZone.poigneeDuBloc((p) => versEcran(vue, p), mpp, blocZone.contour, blocZone.repere);
  // Pendant une écriture, l'annulation précédente disparaît : « Annuler » dit toujours le dernier enregistrement, une fois écrit.
  const annulable = occupe ? undefined : (dernier ?? undefined);

  function dessiner(e: Objet): ReactElement {
    const selectionne = selection === e.id;
    const batiment = e.sorte === 'batiment';
    const vanne = e.sorte === 'vanne';
    // T57 : une vanne est un repère de 44 px (au doigt, avec des gants), quel que soit le zoom.
    const c = versEcran(vue, e.rect.centre);
    return (
      <div
        key={e.id}
        role="button"
        tabIndex={0}
        aria-pressed={selectionne}
        aria-label={e.libelle}
        data-testid={e.sorte}
        data-id={e.id}
        data-placee={vanne ? (lusV.find((v) => v.id === e.id)?.position != null || brouillonV.has(e.id) ? 'oui' : 'non') : undefined}
        data-x={arrondi(e.rect.centre.x)}
        data-y={arrondi(e.rect.centre.y)}
        data-orientation={arrondi(e.rect.orientationDeg)}
        data-longueur={arrondi(e.rect.longueurM)}
        data-largeur={arrondi(e.rect.largeurM)}
        className={`pl-forme pl-${e.sorte}${selectionne ? ' pl-choisi' : ''}${edition ? ' pl-mobile' : ''}`}
        style={vanne ? { left: c.x - 22, top: c.y - 22, touchAction: 'none' } : styleRectangle(vue, e.rect)}
        onPointerDown={(ev) => {
          commencer(ev, e, 'deplacer', null);
        }}
        onFocus={() => {
          if (selection !== e.id) selectionner(e.id);
        }}
        onKeyDown={(ev) => {
          surTouche(ev, e);
        }}
      >
        {batiment && <span className="pl-nom">{e.libelle.split(',')[0]}</span>}
        {vanne && e.libelle.slice(6)}
      </div>
    );
  }

  /** Barre de boutons : en bas de l'écran sur téléphone et tablette (boutons larges), dans la colonne de droite sur ordinateur. */
  const boutonAnnuler =
    annulable !== undefined ? (
      <button
        type="button"
        data-testid="annuler-placement"
        className="pl-bouton"
        disabled={occupe}
        aria-describedby={occupe ? idRaisonEnregistrer : undefined}
        onClick={() => void defaire(annulable)}
      >
        Annuler l’enregistrement
      </button>
    ) : null;
  const barre = edition ? (
    <div data-testid="barre-doigt" className={`pl-barre${surOrdinateur ? ' pl-barre-colonne' : ''}`}>
      <button type="button" data-testid="verrouiller-plan" className="pl-bouton" disabled={occupe} onClick={terminer}>
        Terminer
      </button>
      {choisi !== undefined && choisi.sorte !== 'vanne' && (
        <>
          <button
            type="button"
            data-testid="tourner-moins"
            className="pl-bouton pl-tourner"
            onClick={() => {
              tournerSelection(-PAS_ROTATION_DEG);
            }}
          >
            Tourner −5°
          </button>
          <button
            type="button"
            data-testid="tourner-plus"
            className="pl-bouton pl-tourner"
            onClick={() => {
              tournerSelection(PAS_ROTATION_DEG);
            }}
          >
            Tourner +5°
          </button>
        </>
      )}
      <button
        type="button"
        className="pl-bouton"
        disabled={nouveauBloque}
        aria-describedby={nouveauBloque ? idRaisonNouveau : undefined}
        onClick={() => {
          setFormulaire(true);
        }}
      >
        Nouveau bâtiment
      </button>
      {nouveauBloque && (
        <p id={idRaisonNouveau} className="pl-aide">
          {raisonNouveau}
        </p>
      )}
      {surOrdinateur && (
        <button
          type="button"
          className="pl-bouton"
          disabled={nouveauBloque || chemin !== null}
          aria-describedby={nouveauBloque ? idRaisonNouveau : undefined}
          onClick={() => {
            const id = nouvelId?.() ?? identifiantNeuf();
            void import('./chemins.tsx').then((m) => {
              selectionner(null);
              setTrace(null);
              setMChemin(m);
              setChemin(m.nouveau(id));
            }, (e: unknown) => {
              setErreur(messageDe(e));
            });
          }}
        >
          Tracer un chemin
        </button>
      )}
      <button
        type="button"
        className="pl-bouton pl-principal"
        disabled={raisonEnregistrer !== null}
        aria-describedby={raisonEnregistrer === null ? undefined : idRaisonEnregistrer}
        onClick={() => void enregistrer()}
      >
        Enregistrer
      </button>
      {raisonEnregistrer !== null && (
        <p id={idRaisonEnregistrer} className="pl-aide">
          {raisonEnregistrer}
        </p>
      )}
      {brouillonOuvert && (
        <button type="button" className="pl-bouton" disabled={occupe} aria-describedby={occupe ? idRaisonEnregistrer : undefined} onClick={abandonner}>
          Abandonner les changements
        </button>
      )}
      {boutonAnnuler}
    </div>
  ) : pret && gerant ? (
    <div data-testid="barre-doigt" className={`pl-barre${surOrdinateur ? ' pl-barre-colonne' : ''}`}>
      <button
        type="button"
        data-testid="deverrouiller-plan"
        className="pl-bouton pl-principal"
        onClick={() => {
          setModification(true);
        }}
      >
        Modifier le plan
      </button>
      {boutonAnnuler}
    </div>
  ) : null;

  return (
    <div className="pl-voile">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-testid="editeur-placement"
        data-mode={mode}
        data-ecran={surOrdinateur ? 'ordinateur' : 'telephone'}
        data-geste={gesteDoigt}
        data-fond={fondPhoto ? 'photo' : 'neutre'}
        data-zoom={Math.min(zoom, ZOOM_TUILES_MAX)}
        data-centre={pret ? `${centreEffectif.latitude.toFixed(5)},${centreEffectif.longitude.toFixed(5)}` : undefined}
        data-origine={pret ? (origine === null ? '' : `${String(origine.latitude)},${String(origine.longitude)}`) : undefined}
        className="pl-feuille"
        onKeyDown={surToucheEditeur}
      >
        <header className="pl-tete">
          <h2 id={idTitre} ref={titre} tabIndex={-1}>
            Placement sur la photo aérienne
          </h2>
          <button type="button" className="pl-bouton pl-fermer" disabled={occupe} onClick={demanderFermeture}>
            Fermer
          </button>
        </header>

        {invitation(invitationDemo)}

        {edition && (
          <p role="status" data-testid="bandeau-modification" className="pl-message pl-message-info">
            Modification du plan
          </p>
        )}

        {pret && (
          <BandeauEtapes
            courante={courante}
            vue={etapeVue}
            surChoix={(n) => {
              if (n > courante) return;
              setRetour(n === courante ? null : n);
              if (n === 1) champAdresse.current?.focus();
            }}
          />
        )}

        <div className="pl-recherches">
          <RechercheAdresse champ={champAdresse} enLigne={enLigneEffectif} misEnAvant={pret && origine === null && ferme.valeur?.position == null} surChoix={allerAuLieu} />
          {pret && zonesPlacees.length > 0 && (
            <div className="pl-sites">
              <select
                data-testid="aller-a"
                aria-label="Aller à"
                className="pl-aller-a"
                value=""
                onChange={(e) => {
                  const zone = zonesPlacees.find((z) => z.id === e.target.value);
                  const emprise = zone === undefined ? null : empriseDeContours([zone.contour]);
                  if (emprise !== null) cadrer(emprise);
                }}
              >
                <option value="">Aller à…</option>
                {zonesPlacees.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nom}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="toute-la-ferme"
                className="pl-bouton"
                onClick={() => {
                  const emprise = empriseDeContours(zonesPlacees.map((z) => z.contour));
                  if (emprise !== null) cadrer(emprise);
                }}
              >
                Toute la ferme
              </button>
            </div>
          )}
        </div>

        <div className="pl-corps">
          <div className="pl-carte">
            <div
              ref={planRef}
              data-testid="plan-placement"
              className={`pl-plan${enTrace ? ' pl-trace' : ''}`}
              style={{ touchAction: 'none' }}
              onPointerDownCapture={doigtPose}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                commencerFond(e, null);
              }}
              onPointerMove={surBouge}
              onPointerUp={(e) => {
                doigtLeve(e, false);
              }}
              onPointerCancel={(e) => {
                doigtLeve(e, true);
              }}
              onWheel={(e) => {
                changerZoom(e.deltaY < 0 ? 1 : -1);
              }}
            >
              {fondPhoto ? (
                <div data-testid="fond-photo" className="pl-fond">
                  {tuiles.filter((t) => !tuilesEnErreur.has(cleTuile(t))).map((t) => (
                    <img
                      key={cleTuile(t)}
                      data-testid="tuile"
                      src={t.url}
                      alt=""
                      draggable={false}
                      referrerPolicy="no-referrer"
                      className="pl-tuile"
                      style={{ left: t.x, top: t.y, width: t.largeur + 0.5, height: t.hauteur + 0.5 }}
                      onError={() => {
                        tuileEnErreur(cleTuile(t));
                      }}
                      onLoad={() => {
                        const suivie = relances.current.get(cleTuile(t));
                        if (suivie !== undefined) suivie.essais = 0;
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div
                  data-testid="fond-neutre"
                  className="pl-fond pl-neutre"
                  style={carreau >= 6 ? { backgroundSize: `${String(carreau)}px ${String(carreau)}px`, backgroundPosition: `${String(depart.x)}px ${String(depart.y)}px` } : undefined}
                >
                  <p className="pl-hors-ligne">
                    {enLigneEffectif ? MESSAGES_PLACEMENT.indisponible : MESSAGES_PLACEMENT.horsLigne}
                    <span> · carreaux de {String(CARREAU_M)} m</span>
                  </p>
                </div>
              )}

              {pret && (
                <svg className="pl-svg" width={taille.w} height={taille.h} aria-hidden="true">
                  {[...zonesInfo.values()].map((i) =>
                    i.affiche === null ? null : (
                      <polygon
                        key={i.zone.id}
                        data-testid="zone-contour"
                        data-id={i.zone.id}
                        className={`pl-contour${zoneSel === i.zone.id ? ' pl-contour-choisi' : ''}${i.change && i.verdict?.ok === false ? ' pl-contour-invalide' : ''}`}
                        points={enPoints(i.affiche)}
                      />
                    ),
                  )}
                  {origine !== null && <circle className="pl-depart" cx={depart.x} cy={depart.y} r={5} />}
                </svg>
              )}
              {pret && (
                <svg className="pl-svg" width={taille.w} height={taille.h}>
                  {lusC.map((c) => (
                    <polyline key={c.id} role="img" data-testid="chemin" data-id={c.id} data-points={c.points.length} data-largeur={c.largeurM} aria-label={c.nom ?? 'Chemin'} className="pl-chemin" strokeWidth={Math.max(2, c.largeurM / mpp)} points={enPoints(c.points)} />
                  ))}
                </svg>
              )}
              {cheminEnCours !== null && <cheminEnCours.m.TraceSurPlan b={cheminEnCours.b} versEcran={(p) => versEcran(vue, p)} taille={taille} />}

              {pret && elements.planches.map(dessiner)}
              {pret && elements.batiments.map(dessiner)}
              {pret && elements.vannes.map(dessiner)}
              {pret && mZone !== null && (
                <mZone.CoucheBandes bandes={bandes} versEcran={(p) => versEcran(vue, p)} choisie={zoneSel} surChoisir={choisirZoneListe} />
              )}

              {pret && mZone !== null && blocZone !== null && poigneeBloc !== null && (
                <mZone.CoucheBloc
                  zoneId={blocZone.id}
                  largeurPx={taille.w}
                  hauteurPx={taille.h}
                  points={enPoints(blocZone.contour)}
                  centre={versEcran(vue, blocZone.repere.centre)}
                  poignee={poigneeBloc}
                  surGlisser={(ev, id) => {
                    commencerBloc(ev, id, 'deplacer');
                  }}
                  surTourner={(ev, id) => {
                    commencerBloc(ev, id, 'pivoter');
                  }}
                />
              )}

              {pret && zoneChoisie !== undefined && sommetsAff.length > 0 && (
                <>
                  <svg className="pl-svg pl-svg-edition" width={taille.w} height={taille.h} aria-hidden="true">
                    {enTrace ? (
                      <polyline className="pl-trace-ligne" points={enPoints(sommetsAff)} />
                    ) : (
                      sommetsAff.map((p, i) => {
                        const a = versEcran(vue, p);
                        const b = versEcran(vue, sommetsAff[(i + 1) % sommetsAff.length] ?? p);
                        return (
                          <line
                            key={i}
                            data-testid="cote-contour"
                            data-index={i}
                            className="pl-cote"
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            onPointerDown={(ev) => {
                              commencerCote(ev, zoneChoisie.zone.id, i);
                            }}
                            onClick={() => {
                              if (clicDejaTraite.current === i) clicDejaTraite.current = null;
                              else insererSurCote(zoneChoisie.zone.id, i);
                            }}
                          />
                        );
                      })
                    )}
                  </svg>
                  {sommetsAff.map((p, i) => {
                    const e = versEcran(vue, p);
                    return (
                      <div
                        key={i}
                        role="button"
                        tabIndex={0}
                        aria-pressed={sommetSel === i}
                        aria-label={`Sommet ${String(i + 1)}`}
                        data-testid="sommet"
                        data-index={i}
                        data-x={arrondi(p.x)}
                        data-y={arrondi(p.y)}
                        className={`pl-sommet${sommetSel === i ? ' pl-sommet-choisi' : ''}${enTrace && i === 0 ? ' pl-sommet-premier' : ''}`}
                        style={{ left: e.x - tailleSommet / 2, top: e.y - tailleSommet / 2, width: tailleSommet, height: tailleSommet, touchAction: 'none' }}
                        onPointerDown={(ev) => {
                          commencerSommet(ev, zoneChoisie.zone.id, i, sommetsAff);
                        }}
                        onFocus={() => {
                          setSommetSel(i);
                        }}
                        onKeyDown={(ev) => {
                          surToucheSommet(ev, zoneChoisie.zone.id, i);
                        }}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          if (!enTrace) retirer(zoneChoisie.zone.id, i);
                        }}
                      />
                    );
                  })}
                </>
              )}

              {poignees !== null && choisi !== undefined && (
                <>
                  <div
                    data-testid="poignee-rotation"
                    className="pl-poignee pl-poignee-rotation"
                    aria-hidden="true"
                    style={{ left: poignees.rotation.x - 14, top: poignees.rotation.y - 14 }}
                    onPointerDown={(ev) => {
                      commencer(ev, choisi, 'pivoter', null);
                    }}
                  />
                  {choisi.sorte === 'batiment' &&
                    poignees.cotes.map(({ cote, p }) => (
                      <div
                        key={cote}
                        data-testid="poignee-cote"
                        data-cote={cote}
                        className="pl-poignee pl-poignee-cote"
                        aria-hidden="true"
                        style={{ left: p.x - 11, top: p.y - 11 }}
                        onPointerDown={(ev) => {
                          commencer(ev, choisi, 'cote', cote);
                        }}
                      />
                    ))}
                </>
              )}
            </div>

            <div className="pl-zoom" role="group" aria-label="Zoom">
              <button
                type="button"
                className="pl-bouton"
                aria-label="Zoom avant"
                disabled={zoom >= ZOOM_MAX}
                aria-describedby={zoom >= ZOOM_MAX ? idRaisonZoom : undefined}
                onClick={() => {
                  changerZoom(1);
                }}
              >
                +
              </button>
              <button
                type="button"
                className="pl-bouton"
                aria-label="Zoom arrière"
                disabled={zoom <= ZOOM_MIN_VUE}
                aria-describedby={zoom <= ZOOM_MIN_VUE ? idRaisonZoom : undefined}
                onClick={() => {
                  changerZoom(-1);
                }}
              >
                −
              </button>
            </div>
            {(zoom >= ZOOM_MAX || zoom <= ZOOM_MIN_VUE) && (
              <p id={idRaisonZoom} className="pl-aide pl-raison-zoom">
                {zoom >= ZOOM_MAX ? MESSAGES_ETAPES.zoomMax : MESSAGES_ETAPES.zoomMin}
              </p>
            )}
            {fondPhoto && (
              <p data-testid="mention-ign" className="pl-mention">
                {MENTION_IGN}
              </p>
            )}
          </div>

          <aside className="pl-lateral">
            {pret && !gerant && (
              <p role="status" className="pl-message pl-message-info">
                {MESSAGES_PLACEMENT.seulGerant}. Vous pouvez consulter le plan.
              </p>
            )}
            {pret && origine === null && (
              <>
                <p role="status" data-testid="origine-absente" className="pl-message">
                  {edition
                    ? 'Posez d’abord le point de départ du plan : touchez la photo à l’endroit voulu, ou utilisez la position de la ferme.'
                    : 'Le point de départ du plan n’est pas encore posé.'}
                </p>
                {edition && ferme.valeur?.position != null && (
                  <button
                    type="button"
                    className="pl-bouton"
                    onClick={() => {
                      if (ferme.valeur?.position != null) setConfirmation({ type: 'origine', position: ferme.valeur.position });
                    }}
                  >
                    Utiliser la position de la ferme
                  </button>
                )}
              </>
            )}
            {abandonAffiche && (
              <p role="status" className="pl-message">
                {MESSAGES_CONTOURS.brouillonAbandonne}
              </p>
            )}
            {pose !== null && (
              <p role="status" data-testid="message-pose" className="pl-message">
                Touchez la photo où se trouve {pose.type.startsWith('serre') ? 'la serre' : 'le bâtiment'} « {pose.nom} ».{' '}
                <button
                  type="button"
                  className="pl-bouton"
                  onClick={() => {
                    poserEn(vue.centre);
                  }}
                >
                  Poser au centre de la vue
                </button>{' '}
                <button
                  type="button"
                  className="pl-lien"
                  onClick={() => {
                    setPose(null);
                  }}
                >
                  Renoncer
                </button>
              </p>
            )}
            {tropDeChangements && (
              <p role="status" className="pl-message">
                {MESSAGES_CONTOURS.tropDeChangements} ({String(changements.length)} sur {String(ECRITURES_MAX_PAR_LOT)} au plus). Abandonnez une partie des changements, puis enregistrez en plusieurs fois.
              </p>
            )}
            {(erreur ?? (echecZone ? 'Une partie de l’éditeur n’a pas pu se charger : rechargez la page.' : null)) !== null && (
              <p role="alert" className="pl-message pl-erreur">
                {erreur ?? 'Une partie de l’éditeur n’a pas pu se charger : rechargez la page.'}
              </p>
            )}

            {surOrdinateur && barre}

            {pret && (
              <section data-testid="liste-zones" aria-label="Zones" className="pl-zones">
                <h3>Zones</h3>
                <ul>
                  {[...zonesInfo.values()].map((i) => (
                    <li key={i.zone.id}>
                      <button
                        type="button"
                        data-testid="zone-choix"
                        data-id={i.zone.id}
                        aria-pressed={zoneSel === i.zone.id}
                        className={`pl-bouton pl-zone-choix`}
                        onClick={() => {
                          choisirZoneListe(i.zone.id);
                        }}
                      >
                        {i.zone.nom}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section data-testid="panneau-placement" aria-label="Réglages de l’élément" className="pl-panneau">
              {cheminEnCours !== null ? (
                <cheminEnCours.m.PanneauChemin b={cheminEnCours.b} surChange={setChemin} />
              ) : choisi === undefined && zoneChoisie !== undefined ? (
                mZone !== null && (
                <mZone.PanneauZone
                  outils={OUTILS}
                  info={zoneChoisie}
                  edition={edition}
                  origineSouhaitee={origine !== null && pose === null}
                  trace={traceZone}
                  message={messageContour}
                  conteneur={conteneurContour}
                  surTracer={() => {
                    demarrerTrace(zoneChoisie.zone.id);
                  }}
                  surRenoncer={abandonnerTrace}
                  surSerre={() => {
                    if (zoneChoisie.affiche === null) placerSerre(zoneChoisie.zone.id, null);
                    else remplacerParSerre(zoneChoisie.zone.id);
                  }}
                  passePied={passePied}
                  surPassePied={setPassePied}
                  surDessiner={() => {
                    dessinerDepuisPlanches(zoneChoisie.zone.id);
                  }}
                  orientation={blocZone === null ? null : blocZone.repere.orientationDeg}
                  surOrientation={(m) => {
                    orienterBloc(zoneChoisie.zone.id, m);
                  }}
                  bandes={bandes}
                  emplacements={lusS}
                  surRanger={poserRangement}
                  surSommet={(index, point) => {
                    const contour = zoneChoisie.affiche;
                    if (contour !== null) majContour(zoneChoisie.zone.id, deplacerSommet(contour, index, point));
                  }}
                />
                )
              ) : choisi === undefined ? (
                <p className="pl-aide">
                  Touchez un bâtiment, une planche ou une zone pour la régler. Flèches : 0,1 m (Maj : 1 m) ; [ et ] : 1°.
                </p>
              ) : (
                <ChampsElement
                  key={choisi.id}
                  element={choisi}
                  batiment={batimentChoisi}
                  lecture={!edition}
                  zones={(zones ?? []).filter((z) => !batimentsAff.some((b) => b.zoneId === z.id && b.id !== choisi.id))}
                  surRectangle={(r) => {
                    majRectangle(choisi, r);
                  }}
                  surBatiment={(patch) => {
                    majBatiment(choisi.id, patch);
                  }}
                  surZone={(zoneId) => {
                    if (batimentChoisi !== undefined) choisirZone(batimentChoisi, zoneId);
                  }}
                />
              )}
            </section>
          </aside>
        </div>

        {!surOrdinateur && barre}

        {formulaire && mZone !== null && (
          <mZone.FormulaireBatiment
            outils={OUTILS}
            surPoser={(n) => {
              setFormulaire(false);
              setPose(n);
            }}
            surFermer={() => {
              setFormulaire(false);
            }}
          />
        )}
        {confirmation?.type === 'origine' && (
          <Modale
            role="alertdialog"
            titre="Poser le point de départ du plan ?"
            surEchap={() => {
              setConfirmation(null);
            }}
          >
            <p>
              Le point de départ sert d’origine à tout le plan de la ferme. Il ne pourra plus être déplacé dès que des éléments seront placés.
            </p>
            <div className="pl-modale-actions">
              <button
                type="button"
                className="pl-bouton pl-principal"
                onClick={() => {
                  setConfirmation(null);
                  void poserOrigine(confirmation.position);
                }}
              >
                Confirmer
              </button>
              <button
                type="button"
                className="pl-bouton"
                onClick={() => {
                  setConfirmation(null);
                }}
              >
                Annuler
              </button>
            </div>
          </Modale>
        )}
        {(confirmation?.type === 'zone' || confirmation?.type === 'remplacer') && (
          <Modale
            role="alertdialog"
            titre="Abriter cette zone ?"
            surEchap={() => {
              setConfirmation(null);
            }}
          >
            <p>
              {MESSAGES_PLACEMENT.contourRemplace}. {confirmation.type === 'remplacer' ? confirmation.avis : MESSAGES_CONTOURS.planchesSuivent}
            </p>
            <div className="pl-modale-actions">
              <button
                type="button"
                className="pl-bouton pl-principal"
                onClick={() => {
                  if (confirmation.type === 'zone') majBatiment(confirmation.batimentId, { zoneId: confirmation.zoneId });
                  else {
                    placerSerre(confirmation.zoneId, confirmation.englobant);
                    setBrouillonP((prev) => new Map([...prev, ...confirmation.converties]));
                  }
                  setConfirmation(null);
                }}
              >
                Confirmer
              </button>
              <button
                type="button"
                className="pl-bouton"
                onClick={() => {
                  setConfirmation(null);
                }}
              >
                Annuler
              </button>
            </div>
          </Modale>
        )}
        {confirmation?.type === 'terminer' && (
          <Modale
            role="alertdialog"
            titre="Terminer la modification du plan ?"
            surEchap={() => {
              setConfirmation(null);
            }}
          >
            <p>Des changements ne sont pas enregistrés.</p>
            {raisonEnregistrer !== null && <p className="pl-aide">{raisonEnregistrer}</p>}
            <div className="pl-modale-actions">
              <button
                type="button"
                className="pl-bouton pl-principal"
                disabled={raisonEnregistrer !== null}
                onClick={() => {
                  setConfirmation(null);
                  void enregistrer().then((ok) => {
                    if (ok) verrouiller();
                  });
                }}
              >
                Enregistrer
              </button>
              <button
                type="button"
                className="pl-bouton"
                disabled={occupe}
                onClick={() => {
                  setConfirmation(null);
                  abandonner();
                  verrouiller();
                }}
              >
                Abandonner les changements
              </button>
              <button
                type="button"
                className="pl-bouton"
                onClick={() => {
                  setConfirmation(null);
                }}
              >
                Continuer la modification
              </button>
            </div>
          </Modale>
        )}
        {confirmation?.type === 'fermer' && (
          <Modale
            role="alertdialog"
            titre="Fermer sans enregistrer ?"
            surEchap={() => {
              setConfirmation(null);
            }}
          >
            <p>Les changements non enregistrés seront perdus.</p>
            <div className="pl-modale-actions">
              <button type="button" className="pl-bouton pl-principal" onClick={surFermer}>
                Fermer quand même
              </button>
              <button
                type="button"
                className="pl-bouton"
                onClick={() => {
                  setConfirmation(null);
                }}
              >
                Continuer
              </button>
            </div>
          </Modale>
        )}
      </div>
    </div>
  );
}

// ── Panneau de réglages ─────────────────────────────────────────────────────────────────────────

interface ProprietesChamps {
  readonly element: Objet;
  readonly batiment: Batiment | undefined;
  readonly lecture: boolean;
  readonly zones: readonly Zone[];
  readonly surRectangle: (r: RectanglePlace) => void;
  readonly surBatiment: (patch: Partial<Batiment>) => void;
  readonly surZone: (zoneId: string) => void;
}

function ChampsElement({ element, batiment, lecture, zones, surRectangle, surBatiment, surZone }: ProprietesChamps): ReactElement {
  const idZone = useId();
  const r = element.rect;
  const planche = element.sorte === 'planche';
  return (
    <>
      <h3>{element.libelle.split(',')[0]}</h3>
      <Champ etiquette="x (m)" valeur={r.centre.x} desactive={lecture} surChange={(x) => { surRectangle({ ...r, centre: { x, y: r.centre.y } }); }} />
      <Champ etiquette="y (m)" valeur={r.centre.y} desactive={lecture} surChange={(y) => { surRectangle({ ...r, centre: { x: r.centre.x, y } }); }} />
      <Champ etiquette="Orientation (°)" valeur={r.orientationDeg} desactive={lecture} surChange={(o) => { surRectangle({ ...r, orientationDeg: normaliserCap(o) }); }} />
      <Champ etiquette="Longueur (m)" valeur={r.longueurM} desactive={lecture || planche} minimum={DIMENSION_MIN_M} surChange={(longueurM) => { surRectangle({ ...r, longueurM }); }} />
      <Champ etiquette="Largeur (m)" valeur={r.largeurM} desactive={lecture || planche} minimum={DIMENSION_MIN_M} surChange={(largeurM) => { surRectangle({ ...r, largeurM }); }} />
      {batiment !== undefined && (
        <>
          <Champ etiquette="Hauteur (m)" valeur={batiment.hauteurM} desactive={lecture} surChange={(hauteurM) => { surBatiment({ hauteurM }); }} />
          <div className="pl-champ">
            <label htmlFor={idZone}>Zone abritée</label>
            <select
              id={idZone}
              value={batiment.zoneId ?? ''}
              disabled={lecture}
              onChange={(e) => {
                surZone(e.target.value);
              }}
            >
              <option value="">Aucune</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nom}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}
