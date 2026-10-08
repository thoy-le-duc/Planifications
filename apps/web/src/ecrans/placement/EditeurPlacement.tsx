/**
 * Éditeur de placement sur la photo aérienne IGN (T28b, Q30, Q31) : poser, déplacer, faire pivoter
 * et redimensionner les bâtiments (serres, hangar, magasin) et déplacer les planches, à la souris
 * ou au clavier, sur l'orthophoto de la Géoplateforme. Chargé à la demande depuis l'onglet Ferme ;
 * il reçoit la porte (ni PowerSync, ni src/donnees) et n'écrit QUE par `porte.placer`. Contrat du
 * DOM : ./test/contrat.ts.
 *
 * Rien n'est écrit pendant un geste : le brouillon vit dans l'écran, « Enregistrer » le donne à la
 * porte en un seul appel, qui rend l'annulation (bouton « Annuler » quelques secondes, Ctrl+Z
 * pendant la session). Gérant seulement, sur ordinateur : sinon lecture seule, sans poignées. Sans
 * réseau, le fond est un quadrillage de 10 m et tout le reste marche.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type RefObject } from 'react';
import { creerGenerateurId, type GenerateurId } from '@planif/core/identifiants';
import type { ChangementPlacement, PorteDonnees } from '@planif/sync';
import './placement.css';
import { repereZone, TYPES_BATIMENT, versGeographique, versLocal, type TypeBatiment } from './coeur.ts';
import { changementsDuBrouillon, contourChange, ECRITURES_MAX_PAR_LOT } from './brouillon.ts';
import { Champ, garderLeFocus, Modale } from './composants.tsx';
import { deplacerSommet, insererMilieu, poserPoint, replacerPlanches, retirerSommet, toucheSommet, TOLERANCE_FERMETURE_PX, verifierContour } from './contours.ts';
import {
  lireTout,
  requeteBatiments,
  requeteFerme,
  requetePlanches,
  requeteEmplacementsPlaces,
  requeteRoles,
  requeteZones,
  sansNull,
  TYPES,
  type Batiment,
  type EmplacementPlace,
  type FermeLue,
  type Planche,
  type Zone,
} from './donnees.ts';
import {
  appliquerTouche,
  depuisPlacementPlanche,
  glisser,
  normaliserCap,
  pivoter,
  redimensionner,
  DIMENSION_MIN_M,
  versPlacementPlanche,
  type Cote,
  type Repere,
  type RectanglePlace,
} from './gestes.ts';
import { DELAI_RELANCE_TUILE_MS, depuisEcran, ESSAIS_TUILE_MAX, MENTION_IGN, metresParPixel, tuilesVisibles, versEcran, ZOOM_DEPART_SANS_POSITION, ZOOM_INITIAL, ZOOM_TUILES_MAX, type Point, type Position, type VueCarte } from './tuiles.ts';

export const MESSAGES_PLACEMENT = {
  seulGerant: 'Seul le gérant peut placer les éléments de la ferme',
  horsLigne: 'Photo aérienne indisponible hors ligne',
  indisponible: 'Photo aérienne indisponible pour le moment',
  enregistreSansRelecture: 'Enregistré',
  ordinateur: 'à faire sur ordinateur',
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

/** « Annuler » reste affiché quelques secondes après un enregistrement. */
export const DELAI_ANNULATION_MS = 8_000;

export interface ProprietesEditeurPlacement {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Utilisateur de la session : son rôle se lit dans la table locale `membre`. */
  readonly utilisateurId: string;
  readonly surFermer: () => void;
  /** Écran assez grand pour éditer. Défaut : matchMedia('(min-width: 1024px)'). */
  readonly ordinateur?: boolean;
  /** Réseau. Défaut : navigator.onLine, suivi par les événements online / offline. */
  readonly enLigne?: boolean;
  /** Durée d'affichage du bouton « Annuler » après un enregistrement. */
  readonly delaiAnnulationMs?: number;
  /** Identifiant d'un nouveau bâtiment (UUID v7). */
  readonly nouvelId?: () => string;
}

const ZOOM_MIN = 14;
const ZOOM_MAX = 22;
/** Un clic bouge de moins que ça ; au-delà, c'est un glissement. */
const SEUIL_GLISSEMENT_PX = 4;
const DECALAGE_POIGNEE_PX = 28;
const TAILLE_SOMMET_PX = 24;
const CARREAU_M = 10;
/** Position de repli d'une ferme sans position : le centre de la France. */
const POSITION_DE_REPLI: Position = { latitude: 46.6, longitude: 2.4 };
const TAILLE_PAR_DEFAUT = { w: 1280, h: 800 } as const;

const LIBELLE_TYPE: Readonly<Record<TypeBatiment, string>> = Object.fromEntries(TYPES.map((t) => [t.valeur, t.libelle])) as Record<TypeBatiment, string>;

/** Un élément dessiné : bâtiment, ou planche ramenée dans le repère de la ferme. */
interface Objet {
  readonly sorte: 'batiment' | 'planche';
  readonly id: string;
  readonly libelle: string;
  readonly rect: RectanglePlace;
  /** Planche : repère dans lequel son placement est gardé au brouillon (celui de sa zone, avant tout changement de contour). */
  readonly repere: Repere | null;
}

/** Une zone, avec son contour tel qu'affiché et ce qu'en dit le cœur. */
interface ZoneAffichee {
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
  | { readonly type: 'fond'; readonly pixel0: Point; readonly centre0: Point; readonly vue: VueCarte; deplace: boolean }
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
  | { readonly type: 'milieu'; readonly zoneId: string; readonly index: number; readonly pixel0: Point; demarre: boolean };

interface Trace {
  readonly zoneId: string;
  readonly sommets: readonly Point[];
}

type Confirmation =
  | { readonly type: 'origine'; readonly position: Position }
  | { readonly type: 'zone'; readonly batimentId: string; readonly zoneId: string }
  | { readonly type: 'fermer' };

interface NouveauBatiment {
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
function styleRectangle(vue: VueCarte, r: RectanglePlace): { left: number; top: number; width: number; height: number; transform: string } {
  const mpp = metresParPixel(vue.origine.latitude, vue.zoom);
  const c = versEcran(vue, r.centre);
  const w = r.largeurM / mpp;
  const h = r.longueurM / mpp;
  return { left: c.x - w / 2, top: c.y - h / 2, width: w, height: h, transform: `rotate(${String(r.orientationDeg)}deg)` };
}

/** Poignées d'un rectangle, en pixels de l'écran : rotation (au-delà du bout avant) et quatre côtés. */
function positionsPoignees(vue: VueCarte, r: RectanglePlace): { rotation: Point; cotes: readonly { cote: Cote; p: Point }[] } {
  const mpp = metresParPixel(vue.origine.latitude, vue.zoom);
  const c = versEcran(vue, r.centre);
  const t = (r.orientationDeg * Math.PI) / 180;
  const avant = { x: Math.sin(t), y: -Math.cos(t) };
  const droite = { x: Math.cos(t), y: Math.sin(t) };
  const demiL = r.longueurM / mpp / 2;
  const demiW = r.largeurM / mpp / 2;
  const sur = (axe: Point, d: number): Point => ({ x: c.x + axe.x * d, y: c.y + axe.y * d });
  return {
    rotation: sur(avant, demiL + DECALAGE_POIGNEE_PX),
    cotes: [
      { cote: 'avant', p: sur(avant, demiL) },
      { cote: 'arriere', p: sur(avant, -demiL) },
      { cote: 'droite', p: sur(droite, demiW) },
      { cote: 'gauche', p: sur(droite, -demiW) },
    ],
  };
}

function capturer(e: PointerEvent<HTMLElement>): void {
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

function EditeurFerme({ porte, fermeId, utilisateurId, surFermer, ordinateur, enLigne, delaiAnnulationMs = DELAI_ANNULATION_MS, nouvelId, brouillonAbandonne, surBrouillon }: ProprietesEditeurFerme): ReactElement {
  const idTitre = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const geste = useRef<Geste | null>(null);
  const generateur = useRef<GenerateurId | null>(null);
  const pile = useRef<Enregistrement[]>([]);

  const grandEcran = usePreference(ordinateur === undefined ? '(min-width: 1024px)' : null, ordinateur ?? true);
  const reseau = useEnLigne();
  const surOrdinateur = ordinateur ?? grandEcran;
  const enLigneEffectif = enLigne ?? reseau;

  // ── Lectures (surveillées : l'écran suit ses écritures et celles de la synchro) ──────────────
  const [ferme, setFerme] = useState<{ readonly valeur: FermeLue | null } | null>(null);
  const [roles, setRoles] = useState<readonly string[] | null>(null);
  const [lusB, setLusB] = useState<readonly Batiment[] | null>(null);
  const [zones, setZones] = useState<readonly Zone[] | null>(null);
  const [lusP, setLusP] = useState<readonly Planche[] | null>(null);
  const [lusE, setLusE] = useState<readonly EmplacementPlace[] | null>(null);
  useEffect(() => porte.surveiller(requeteFerme(fermeId), (l) => { setFerme({ valeur: l[0] ?? null }); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteRoles(fermeId, utilisateurId), setRoles), [porte, fermeId, utilisateurId]);
  useEffect(() => porte.surveiller(requeteBatiments(fermeId), (l) => { setLusB(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteZones(fermeId), (l) => { setZones(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requetePlanches(fermeId), (l) => { setLusP(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteEmplacementsPlaces(fermeId), (l) => { setLusE(sansNull(l)); }), [porte, fermeId]);

  const pret = ferme !== null && roles !== null && lusB !== null && zones !== null && lusP !== null && lusE !== null;
  const gerant = roles?.includes('gerant') === true;
  const mode = !pret ? undefined : gerant && surOrdinateur ? 'edition' : 'lecture';
  const edition = mode === 'edition';

  // ── État de l'écran ───────────────────────────────────────────────────────────────────────────
  const [brouillonB, setBrouillonB] = useState<ReadonlyMap<string, Batiment>>(() => new Map());
  const [brouillonP, setBrouillonP] = useState<ReadonlyMap<string, Planche>>(() => new Map());
  const [brouillonZ, setBrouillonZ] = useState<ReadonlyMap<string, readonly Point[]>>(() => new Map());
  const [selection, setSelection] = useState<string | null>(null);
  const [zoneSel, setZoneSel] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [sommetSel, setSommetSel] = useState<number | null>(null);
  const [messageContour, setMessageContour] = useState<string | null>(null);
  const focusSommet = useRef<number | null>(null);
  const focusTracer = useRef(false);
  const conteneurContour = useRef<HTMLDivElement | null>(null);
  const clicDejaTraite = useRef<number | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [formulaire, setFormulaire] = useState(false);
  const [pose, setPose] = useState<NouveauBatiment | null>(null);
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

  const batimentsAff = useMemo(() => {
    const lus = lusB ?? [];
    const connus = new Set(lus.map((b) => b.id));
    return [...lus.map((b) => brouillonB.get(b.id) ?? b), ...[...brouillonB.values()].filter((b) => !connus.has(b.id))];
  }, [lusB, brouillonB]);

  const zonesInfo = useMemo(() => {
    const m = new Map<string, ZoneAffichee>();
    for (const z of zones ?? []) {
      const abritee = batimentsAff.some((b) => b.zoneId === z.id);
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
  }, [zones, batimentsAff, brouillonZ]);

  /** Repère d'affichage de chaque zone (contour du brouillon s'il est valide), et repère où les planches gardent leur placement au brouillon (contour de la base). */
  const reperes = useMemo(() => {
    const m = new Map<string, { readonly affichage: Repere | null; readonly base: Repere | null }>();
    for (const i of zonesInfo.values()) {
      const abri = batimentsAff.find((b) => b.zoneId === i.zone.id);
      const abritee = abri === undefined ? null : { centre: abri.centre, orientationDeg: abri.orientationDeg };
      const affichage = repereZone({ contour: abri === undefined ? i.effectif : null }, abritee);
      m.set(i.zone.id, { affichage, base: abri === undefined ? repereZone({ contour: i.zone.contour }) : affichage });
    }
    return m;
  }, [zonesInfo, batimentsAff]);

  // Un contour changé ne déplace pas les planches de la zone sur le terrain (décision du chef).
  const planchesAff = useMemo(
    () =>
      (lusP ?? []).map((p) => {
        const base = brouillonP.get(p.id) ?? p;
        const info = zonesInfo.get(p.zoneId);
        if (info === undefined || info.abritee || !info.change || info.zone.contour === null || info.effectif === null) return base;
        const [replacee] = replacerPlanches(info.zone.contour, info.effectif, [{ id: p.id, placement: base.placement }]);
        return replacee === undefined ? base : { ...base, placement: replacee.placement };
      }),
    [lusP, brouillonP, zonesInfo],
  );

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
    return { batiments: liste, planches };
  }, [batimentsAff, planchesAff, reperes]);

  const choisi = selection === null ? undefined : [...elements.batiments, ...elements.planches].find((e) => e.id === selection);
  const batimentChoisi = choisi?.sorte === 'batiment' ? batimentsAff.find((b) => b.id === choisi.id) : undefined;

  const changements = useMemo(
    () =>
      pret
        ? changementsDuBrouillon({
            batiments: lusB,
            brouillonBatiments: brouillonB,
            zones,
            planches: lusP,
            emplacements: lusE,
            brouillonPlanches: brouillonP,
            brouillonZones: brouillonZ,
            zonesAbritees: new Set([...zonesInfo.values()].filter((i) => i.abritee).map((i) => i.zone.id)),
          })
        : [],
    [pret, lusB, brouillonB, zones, lusP, lusE, brouillonP, brouillonZ, zonesInfo],
  );
  const modifie = changements.length > 0;
  const contoursModifies = [...zonesInfo.values()].filter((i) => i.change);
  const contoursInvalides = contoursModifies.filter((i) => i.verdict?.ok === false);
  /** Quelque chose à perdre en fermant : changements à écrire, contour refusé, tracé commencé. */
  const brouillonOuvert = modifie || contoursModifies.length > 0 || (trace?.sommets.length ?? 0) > 0;
  const tropDeChangements = changements.length > ECRITURES_MAX_PAR_LOT;
  useEffect(() => {
    surBrouillon(brouillonOuvert);
  }, [surBrouillon, brouillonOuvert]);
  // Le message d'abandon disparaît au premier geste (ou à la pose suivante) dans la nouvelle ferme.
  const [abandonAffiche, setAbandonAffiche] = useState(brouillonAbandonne);
  if (brouillonOuvert && abandonAffiche) setAbandonAffiche(false);
  const peutEnregistrer = modifie && !occupe && contoursInvalides.length === 0 && trace === null && !tropDeChangements;

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
    if (e.sorte === 'batiment') {
      majBatiment(e.id, { centre: r.centre, orientationDeg: r.orientationDeg, longueurM: r.longueurM, largeurM: r.largeurM });
      return;
    }
    const lue = lusP?.find((p) => p.id === e.id);
    if (lue === undefined || e.repere === null) return;
    const placement = versPlacementPlanche(e.repere, r);
    setBrouillonP((prev) => new Map(prev).set(e.id, { ...(prev.get(e.id) ?? lue), placement }));
  }

  function abandonner(): void {
    setBrouillonB(new Map());
    setBrouillonP(new Map());
    setBrouillonZ(new Map());
    setTrace(null);
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

  function retirer(zoneId: string, index: number): void {
    const contour = zonesInfo.get(zoneId)?.affiche;
    if (contour == null) return;
    const reste = retirerSommet(contour, index);
    if (reste === null) {
      setMessageContour(`Un contour garde au moins 3 sommets.`);
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

  /** Clavier d'un sommet : flèches 0,1 m (Maj : 1 m), Inser (ajoute après), Suppr (retire). */
  function surToucheSommet(e: KeyboardEvent<HTMLElement>, zoneId: string, index: number): void {
    if (!edition || trace !== null || e.metaKey || (e.ctrlKey && !e.altKey)) return;
    const contour = zonesInfo.get(zoneId)?.affiche;
    if (contour == null) return;
    const r = toucheSommet(contour, index, { key: e.key, shiftKey: e.shiftKey });
    if (r === null) return;
    e.preventDefault();
    if (r.refuse) {
      setMessageContour(`Un contour garde au moins 3 sommets.`);
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
    geste.current = { type: 'milieu', zoneId, index, pixel0: pixelDe(e), demarre: false };
  }

  // ── Écriture : toujours par porte.placer ─────────────────────────────────────────────────────
  async function recharger(): Promise<void> {
    const l = await lireTout(porte, fermeId, utilisateurId);
    setFerme({ valeur: l.ferme });
    setRoles(l.roles);
    setLusB(l.batiments);
    setZones(l.zones);
    setLusP(l.planches);
    setLusE(l.emplacements);
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

  async function enregistrer(): Promise<void> {
    if (!peutEnregistrer) return;
    const [ecritsB, ecritsP, ecritsZ] = [brouillonB, brouillonP, brouillonZ];
    const entree = await ecrire(changements);
    if (entree === null) return;
    // Seul ce qui vient d'être écrit sort du brouillon : un geste fait pendant l'écriture reste.
    const sans = <T,>(prev: ReadonlyMap<string, T>, ecrits: ReadonlyMap<string, T>): Map<string, T> => {
      const reste = new Map(prev);
      for (const [id, v] of ecrits) if (reste.get(id) === v) reste.delete(id);
      return reste;
    };
    setBrouillonB((prev) => sans(prev, ecritsB));
    setBrouillonP((prev) => sans(prev, ecritsP));
    setBrouillonZ((prev) => sans(prev, ecritsZ));
    setDernier(entree);
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

  function commencer(e: PointerEvent<HTMLElement>, element: Objet, type: 'deplacer' | 'pivoter' | 'cote', cote: Cote | null): void {
    e.stopPropagation();
    selectionner(element.id);
    if (!edition || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pixel0 = pixelDe(e);
    geste.current = { type, element, pixel0, depart: depuisEcran(vue, pixel0), vue, cote, demarre: type !== 'deplacer' };
    capturer(e);
  }

  function surBouge(e: PointerEvent<HTMLElement>): void {
    const g = geste.current;
    if (g === null) return;
    const pixel = pixelDe(e);
    if (g.type === 'fond') {
      if (!g.deplace && Math.hypot(pixel.x - g.pixel0.x, pixel.y - g.pixel0.y) < SEUIL_GLISSEMENT_PX) return;
      g.deplace = true;
      const m = metresParPixel(g.vue.origine.latitude, g.vue.zoom);
      setCentreGeo(versGeographique(g.vue.origine, { x: g.centre0.x - (pixel.x - g.pixel0.x) * m, y: g.centre0.y + (pixel.y - g.pixel0.y) * m }));
      return;
    }
    if (g.type === 'milieu' || g.type === 'sommet') {
      if (!g.demarre) {
        if (Math.hypot(pixel.x - g.pixel0.x, pixel.y - g.pixel0.y) < SEUIL_GLISSEMENT_PX) return;
        g.demarre = true;
      }
      if (g.type === 'milieu' || g.fige) return;
      const p = depuisEcran(g.vue, pixel);
      const sommet = g.contour0[g.index];
      if (sommet !== undefined) majContour(g.zoneId, deplacerSommet(g.contour0, g.index, { x: arrondi(sommet.x + p.x - g.depart.x), y: arrondi(sommet.y + p.y - g.depart.y) }));
      return;
    }
    if (!g.demarre) {
      if (Math.hypot(pixel.x - g.pixel0.x, pixel.y - g.pixel0.y) < SEUIL_GLISSEMENT_PX) return;
      g.demarre = true;
    }
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
      if (!g.deplace) surClic(g.pixel0, g.vue);
    } else if (g.type === 'sommet') {
      // Un simple clic sur le premier sommet d'un tracé le ferme.
      if (!g.demarre && g.fige && g.index === 0) fermerTrace();
    } else if (g.type === 'milieu' && !g.demarre) {
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

  /** Pose le nouveau bâtiment au point donné (repère de la ferme) : au brouillon, sélectionné. */
  function poserEn(local: Point): void {
    if (pose === null) return;
    const id = nouvelId?.() ?? identifiantNeuf();
    setBrouillonB((prev) =>
      new Map(prev).set(id, {
        id,
        nom: pose.nom,
        type: pose.type,
        centre: { x: arrondi(local.x), y: arrondi(local.y) },
        orientationDeg: 0,
        longueurM: pose.longueurM,
        largeurM: pose.largeurM,
        hauteurM: pose.hauteurM,
        zoneId: null,
        nouveau: true,
      }),
    );
    selectionner(id);
    setPose(null);
  }

  function identifiantNeuf(): string {
    generateur.current ??= creerGenerateurId({ horloge: () => Date.now(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
    return generateur.current<'Batiment'>();
  }

  function changerZoom(delta: number): void {
    setZoomChoisi(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta)));
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
  const poignees = edition && choisi !== undefined ? positionsPoignees(vue, choisi.rect) : null;
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
  // Pendant une écriture, l'annulation précédente disparaît : « Annuler » dit toujours le dernier enregistrement, une fois écrit.
  const annulable = occupe ? undefined : (dernier ?? undefined);

  function dessiner(e: Objet): ReactElement {
    const selectionne = selection === e.id;
    const batiment = e.sorte === 'batiment';
    return (
      <div
        key={e.id}
        role="button"
        tabIndex={0}
        aria-pressed={selectionne}
        aria-label={e.libelle}
        data-testid={batiment ? 'batiment' : 'planche'}
        data-id={e.id}
        data-x={arrondi(e.rect.centre.x)}
        data-y={arrondi(e.rect.centre.y)}
        data-orientation={arrondi(e.rect.orientationDeg)}
        data-longueur={arrondi(e.rect.longueurM)}
        data-largeur={arrondi(e.rect.largeurM)}
        className={`pl-forme ${batiment ? 'pl-batiment' : 'pl-planche'}${selectionne ? ' pl-choisi' : ''}${edition ? ' pl-mobile' : ''}`}
        style={styleRectangle(vue, e.rect)}
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
      </div>
    );
  }

  return (
    <div className="pl-voile">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-testid="editeur-placement"
        data-mode={mode}
        data-fond={fondPhoto ? 'photo' : 'neutre'}
        data-zoom={Math.min(zoom, ZOOM_TUILES_MAX)}
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

        <div className="pl-corps">
          <div className="pl-carte">
            <div
              ref={planRef}
              data-testid="plan-placement"
              className={`pl-plan${enTrace ? ' pl-trace' : ''}`}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                geste.current = { type: 'fond', pixel0: pixelDe(e), centre0: vue.centre, vue, deplace: false };
                capturer(e);
              }}
              onPointerMove={surBouge}
              onPointerUp={surRelache}
              onPointerCancel={() => {
                geste.current = null;
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

              {pret && elements.planches.map(dessiner)}
              {pret && elements.batiments.map(dessiner)}

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
                        style={{ left: e.x - TAILLE_SOMMET_PX / 2, top: e.y - TAILLE_SOMMET_PX / 2 }}
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
                disabled={zoom <= ZOOM_MIN}
                onClick={() => {
                  changerZoom(-1);
                }}
              >
                −
              </button>
            </div>
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
            {pret && gerant && !surOrdinateur && (
              <p role="status" className="pl-message pl-message-info">
                Placement : {MESSAGES_PLACEMENT.ordinateur}. Ici, vous pouvez seulement consulter le plan.
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
              <p role="status" className="pl-message">
                Touchez la photo pour poser « {pose.nom} ».{' '}
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
            {erreur !== null && (
              <p role="alert" className="pl-message pl-erreur">
                {erreur}
              </p>
            )}

            {edition && (
              <div className="pl-actions">
                <button
                  type="button"
                  className="pl-bouton"
                  disabled={origine === null || pose !== null || trace !== null}
                  onClick={() => {
                    setFormulaire(true);
                  }}
                >
                  Nouveau bâtiment
                </button>
                <button type="button" className="pl-bouton pl-principal" disabled={!peutEnregistrer} onClick={() => void enregistrer()}>
                  Enregistrer
                </button>
                {brouillonOuvert && (
                  <button type="button" className="pl-bouton" disabled={occupe} onClick={abandonner}>
                    Abandonner les changements
                  </button>
                )}
                {annulable !== undefined && (
                  <button
                    type="button"
                    data-testid="annuler-placement"
                    className="pl-bouton"
                    disabled={occupe}
                    onClick={() => void defaire(annulable)}
                  >
                    Annuler l’enregistrement
                  </button>
                )}
              </div>
            )}

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
              {choisi === undefined && zoneChoisie !== undefined ? (
                <PanneauZone
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
                  surSommet={(index, point) => {
                    const contour = zoneChoisie.affiche;
                    if (contour !== null) majContour(zoneChoisie.zone.id, deplacerSommet(contour, index, point));
                  }}
                />
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

        {formulaire && (
          <FormulaireBatiment
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
        {confirmation?.type === 'zone' && (
          <Modale
            role="alertdialog"
            titre="Abriter cette zone ?"
            surEchap={() => {
              setConfirmation(null);
            }}
          >
            <p>
              {MESSAGES_PLACEMENT.contourRemplace}. {MESSAGES_CONTOURS.planchesSuivent}
            </p>
            <div className="pl-modale-actions">
              <button
                type="button"
                className="pl-bouton pl-principal"
                onClick={() => {
                  majBatiment(confirmation.batimentId, { zoneId: confirmation.zoneId });
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

// ── Panneau d'une zone : contour ────────────────────────────────────────────────────────────────

interface ProprietesPanneauZone {
  readonly info: ZoneAffichee;
  readonly edition: boolean;
  /** Le point de départ du plan est posé et aucun bâtiment n'est en cours de pose. */
  readonly origineSouhaitee: boolean;
  readonly trace: Trace | null;
  readonly message: string | null;
  readonly conteneur: RefObject<HTMLDivElement | null>;
  readonly surTracer: () => void;
  readonly surRenoncer: () => void;
  readonly surSommet: (index: number, point: Point) => void;
}

function PanneauZone({ info, edition, origineSouhaitee, trace, message, conteneur, surTracer, surRenoncer, surSommet }: ProprietesPanneauZone): ReactElement {
  const contour = info.affiche;
  const verdict = info.verdict ?? (contour === null ? null : verifierContour(contour));
  return (
    <>
      <h3>{info.zone.nom}</h3>
      {info.abritee && (
        <p role="status" data-testid="zone-abritee" className="pl-aide">
          Cette zone est abritée par un bâtiment : {MESSAGES_CONTOURS.zoneAbritee}, il n’y a pas de contour à tracer.
        </p>
      )}
      {!info.abritee && !edition && (
        <p className="pl-aide">{contour === null ? 'Aucun contour tracé pour cette zone.' : `Contour de ${String(contour.length)} sommets.`}</p>
      )}
      {!info.abritee && edition && trace === null && contour === null && (
        <>
          <button type="button" className="pl-bouton" data-action="tracer" disabled={!origineSouhaitee} onClick={surTracer}>
            Tracer le contour
          </button>
          <p className="pl-aide">
            {origineSouhaitee ? 'Posez les sommets un à un sur la photo, puis fermez le tracé.' : 'Posez d’abord le point de départ du plan, et finissez de poser le bâtiment en cours.'}
          </p>
        </>
      )}
      {!info.abritee && edition && trace !== null && (
        <div ref={conteneur} tabIndex={-1} className="pl-contour-edition" data-testid="contour-edition" data-id={info.zone.id} data-etat="trace" data-sommets={trace.sommets.length}>
          <p className="pl-aide">
            Touchez la photo pour poser chaque sommet ({String(trace.sommets.length)} posé{trace.sommets.length > 1 ? 's' : ''}). Pour fermer : touchez le premier sommet, ou Entrée (3 sommets au moins). Échap abandonne.
          </p>
          <button type="button" className="pl-bouton" onClick={surRenoncer}>
            Renoncer au tracé
          </button>
        </div>
      )}
      {!info.abritee && edition && trace === null && contour !== null && (
        <div
          ref={conteneur}
          tabIndex={-1}
          className="pl-contour-edition"
          data-testid="contour-edition"
          data-id={info.zone.id}
          data-etat={verdict?.ok === false ? 'invalide' : 'valide'}
          data-sommets={contour.length}
        >
          {verdict?.ok === false && (
            <p role="alert" data-testid="contour-erreur" className="pl-message pl-erreur">
              {verdict.message}
            </p>
          )}
          {message !== null && (
            <p role="status" className="pl-message">
              {message}
            </p>
          )}
          <p className="pl-aide">
            Glissez un sommet ; touchez un côté pour ajouter un sommet au milieu ; clic droit ou Suppr retire un sommet. Au clavier : Tab passe d’un sommet à l’autre, flèches 0,1 m (Maj : 1 m), Inser ajoute après.
          </p>
          {contour.map((p, k) => (
            <div key={k} className="pl-sommet-champs">
              <Champ
                etiquette={`Sommet ${String(k + 1)} x (m)`}
                valeur={p.x}
                desactive={false}
                surChange={(x) => {
                  surSommet(k, { x, y: p.y });
                }}
              />
              <Champ
                etiquette={`Sommet ${String(k + 1)} y (m)`}
                valeur={p.y}
                desactive={false}
                surChange={(y) => {
                  surSommet(k, { x: p.x, y });
                }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Nouveau bâtiment ────────────────────────────────────────────────────────────────────────────

function FormulaireBatiment({ surPoser, surFermer }: { readonly surPoser: (n: NouveauBatiment) => void; readonly surFermer: () => void }): ReactElement {
  const idType = useId();
  const idNom = useId();
  const [type, setType] = useState<TypeBatiment>('serre_tunnel');
  const [nom, setNom] = useState('');
  const [longueur, setLongueur] = useState('30');
  const [largeur, setLargeur] = useState('8');
  const [hauteur, setHauteur] = useState('3.5');
  const nombre = (t: string): number => (t.trim() === '' ? Number.NaN : Number(t));
  const valide = nom.trim() !== '' && [longueur, largeur, hauteur].every((t) => nombre(t) > 0);
  const champ = (etiquette: string, valeur: string, maj: (v: string) => void): ReactElement => (
    <ChampTexte etiquette={etiquette} valeur={valeur} surChange={maj} />
  );
  return (
    <Modale role="dialog" titre="Nouveau bâtiment" surEchap={surFermer}>
      <div className="pl-champ">
        <label htmlFor={idType}>Type</label>
        <select
          id={idType}
          value={type}
          onChange={(e) => {
            const v = e.target.value;
            const trouve = TYPES_BATIMENT.find((t) => t === v);
            if (trouve !== undefined) setType(trouve);
          }}
        >
          {TYPES.map((t) => (
            <option key={t.valeur} value={t.valeur}>
              {t.libelle}
            </option>
          ))}
        </select>
      </div>
      <div className="pl-champ">
        <label htmlFor={idNom}>Nom</label>
        <input
          id={idNom}
          type="text"
          autoComplete="off"
          value={nom}
          onChange={(e) => {
            setNom(e.target.value);
          }}
        />
      </div>
      {champ('Longueur (m)', longueur, setLongueur)}
      {champ('Largeur (m)', largeur, setLargeur)}
      {champ('Hauteur (m)', hauteur, setHauteur)}
      <div className="pl-modale-actions">
        <button
          type="button"
          className="pl-bouton pl-principal"
          disabled={!valide}
          onClick={() => {
            surPoser({ nom: nom.trim(), type, longueurM: nombre(longueur), largeurM: nombre(largeur), hauteurM: nombre(hauteur) });
          }}
        >
          Poser
        </button>
        <button type="button" className="pl-bouton" onClick={surFermer}>
          Annuler
        </button>
      </div>
    </Modale>
  );
}

/** Champ numérique dont le texte est gardé tel quel (le formulaire valide à « Poser »). */
function ChampTexte({ etiquette, valeur, surChange }: { readonly etiquette: string; readonly valeur: string; readonly surChange: (v: string) => void }): ReactElement {
  const id = useId();
  return (
    <div className="pl-champ">
      <label htmlFor={id}>{etiquette}</label>
      <input
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        value={valeur}
        onChange={(e) => {
          surChange(e.target.value);
        }}
      />
    </div>
  );
}
