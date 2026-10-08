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
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { creerGenerateurId, type GenerateurId } from '@planif/core/identifiants';
import type { ChangementPlacement, PorteDonnees } from '@planif/sync';
import './placement.css';
import { repereZone, TYPES_BATIMENT, versGeographique, versLocal, type TypeBatiment } from './coeur.ts';
import { changementsDuBrouillon } from './brouillon.ts';
import { Champ, garderLeFocus, Modale } from './composants.tsx';
import {
  lireTout,
  requeteBatiments,
  requeteFerme,
  requetePlanches,
  requeteRoles,
  requeteZones,
  sansNull,
  TYPES,
  type Batiment,
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
  versPlacementPlanche,
  type Cote,
  type Repere,
  type RectanglePlace,
} from './gestes.ts';
import { depuisEcran, MENTION_IGN, metresParPixel, tuilesVisibles, versEcran, ZOOM_INITIAL, ZOOM_TUILES_MAX, type Point, type Position, type VueCarte } from './tuiles.ts';

export const MESSAGES_PLACEMENT = {
  seulGerant: 'Seul le gérant peut placer les éléments de la ferme',
  horsLigne: 'Photo aérienne indisponible hors ligne',
  ordinateur: 'à faire sur ordinateur',
  contourRemplace: 'Le contour de la zone sera remplacé par la serre',
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
  /** Planche : repère de sa zone. */
  readonly repere: Repere | null;
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
    };

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

export function EditeurPlacement({ porte, fermeId, utilisateurId, surFermer, ordinateur, enLigne, delaiAnnulationMs = DELAI_ANNULATION_MS, nouvelId }: ProprietesEditeurPlacement): ReactElement {
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
  useEffect(() => porte.surveiller(requeteFerme(fermeId), (l) => { setFerme({ valeur: l[0] ?? null }); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteRoles(fermeId, utilisateurId), setRoles), [porte, fermeId, utilisateurId]);
  useEffect(() => porte.surveiller(requeteBatiments(fermeId), (l) => { setLusB(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteZones(fermeId), (l) => { setZones(sansNull(l)); }), [porte, fermeId]);
  useEffect(() => porte.surveiller(requetePlanches(fermeId), (l) => { setLusP(sansNull(l)); }), [porte, fermeId]);

  const pret = ferme !== null && roles !== null && lusB !== null && zones !== null && lusP !== null;
  const gerant = roles?.includes('gerant') === true;
  const mode = !pret ? undefined : gerant && surOrdinateur ? 'edition' : 'lecture';
  const edition = mode === 'edition';

  // ── État de l'écran ───────────────────────────────────────────────────────────────────────────
  const [brouillonB, setBrouillonB] = useState<ReadonlyMap<string, Batiment>>(() => new Map());
  const [brouillonP, setBrouillonP] = useState<ReadonlyMap<string, Planche>>(() => new Map());
  const [selection, setSelection] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [formulaire, setFormulaire] = useState(false);
  const [pose, setPose] = useState<NouveauBatiment | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [dernier, setDernier] = useState<Enregistrement | null>(null);
  const [tuilesEnErreur, setTuilesEnErreur] = useState(false);
  const [taille, setTaille] = useState<{ readonly w: number; readonly h: number }>(TAILLE_PAR_DEFAUT);
  const [centreGeo, setCentreGeo] = useState<Position | null>(null);
  const [zoom, setZoom] = useState(ZOOM_INITIAL);

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
      setTuilesEnErreur(false);
    };
    addEventListener('online', retour);
    return () => {
      removeEventListener('online', retour);
    };
  }, []);

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

  // ── Ce qui est affiché : la base, recouverte par le brouillon ────────────────────────────────
  const origine = ferme?.valeur?.origine ?? null;
  const origineVue = origine ?? ferme?.valeur?.position ?? POSITION_DE_REPLI;
  const centreEffectif = centreGeo ?? origineVue;
  const vue: VueCarte = useMemo(
    () => ({ origine: origineVue, centre: versLocal(origineVue, centreEffectif), zoom, largeurPx: taille.w, hauteurPx: taille.h }),
    [origineVue, centreEffectif, zoom, taille],
  );

  const batimentsAff = useMemo(() => {
    const lus = lusB ?? [];
    const connus = new Set(lus.map((b) => b.id));
    return [...lus.map((b) => brouillonB.get(b.id) ?? b), ...[...brouillonB.values()].filter((b) => !connus.has(b.id))];
  }, [lusB, brouillonB]);

  const reperes = useMemo(() => {
    const m = new Map<string, Repere | null>();
    for (const z of zones ?? []) {
      const abri = batimentsAff.find((b) => b.zoneId === z.id);
      m.set(z.id, repereZone({ contour: abri === undefined ? z.contour : null }, abri === undefined ? null : { centre: abri.centre, orientationDeg: abri.orientationDeg }));
    }
    return m;
  }, [zones, batimentsAff]);

  const planchesAff = useMemo(() => (lusP ?? []).map((p) => brouillonP.get(p.id) ?? p), [lusP, brouillonP]);

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
      const repere = reperes.get(p.zoneId) ?? null;
      if (repere === null) continue;
      const place = depuisPlacementPlanche(repere, p.placement);
      planches.push({ sorte: 'planche', id: p.id, libelle: `Planche ${p.code}`, rect: { centre: place.centre, orientationDeg: place.orientationDeg, longueurM: p.longueurM, largeurM: p.largeurM }, repere });
    }
    return { batiments: liste, planches };
  }, [batimentsAff, planchesAff, reperes]);

  const choisi = selection === null ? undefined : [...elements.batiments, ...elements.planches].find((e) => e.id === selection);
  const batimentChoisi = choisi?.sorte === 'batiment' ? batimentsAff.find((b) => b.id === choisi.id) : undefined;

  const changements = useMemo(
    () =>
      pret
        ? changementsDuBrouillon({ batiments: lusB, brouillonBatiments: brouillonB, zones, planches: lusP, brouillonPlanches: brouillonP })
        : [],
    [pret, lusB, brouillonB, zones, lusP, brouillonP],
  );
  const modifie = changements.length > 0;

  const fondPhoto = enLigneEffectif && !tuilesEnErreur;
  const tuiles = useMemo(() => (fondPhoto ? tuilesVisibles(vue) : []), [fondPhoto, vue]);
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
    setErreur(null);
  }

  // ── Écriture : toujours par porte.placer ─────────────────────────────────────────────────────
  async function recharger(): Promise<void> {
    const l = await lireTout(porte, fermeId, utilisateurId);
    setFerme({ valeur: l.ferme });
    setRoles(l.roles);
    setLusB(l.batiments);
    setZones(l.zones);
    setLusP(l.planches);
  }

  /** Écrit par la porte ; rend l'enregistrement (de quoi l'annuler), ou null si la porte a refusé. */
  async function ecrire(liste: readonly ChangementPlacement[]): Promise<Enregistrement | null> {
    setOccupe(true);
    setErreur(null);
    try {
      const entree: Enregistrement = { annulation: await porte.placer(liste) };
      pile.current.push(entree);
      await recharger();
      return entree;
    } catch (e) {
      console.error('Placement refusé', e);
      setErreur(messageDe(e));
      return null;
    } finally {
      setOccupe(false);
    }
  }

  async function enregistrer(): Promise<void> {
    if (occupe || !modifie) return;
    const [ecritsB, ecritsP] = [brouillonB, brouillonP];
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
    setDernier(entree);
  }

  async function defaire(entree: Enregistrement | undefined): Promise<void> {
    if (entree === undefined || occupe) return;
    pile.current = pile.current.filter((x) => x !== entree);
    setDernier((n) => (n === entree ? null : n));
    setOccupe(true);
    setErreur(null);
    try {
      await porte.placer(entree.annulation);
      await recharger();
    } catch (e) {
      console.error('Annulation impossible', e);
      setErreur(`Rien n’a été annulé : ${messageDe(e)}`);
    } finally {
      setOccupe(false);
    }
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
    setSelection(element.id);
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
    if (g?.type === 'fond' && !g.deplace) surClic(g.pixel0, g.vue);
  }

  function surClic(pixel: Point, v: VueCarte): void {
    if (!pret || !edition) {
      setSelection(null);
      return;
    }
    const local = depuisEcran(v, pixel);
    if (pose !== null) {
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
      setSelection(id);
      setPose(null);
      return;
    }
    if (origine === null) {
      setConfirmation({ type: 'origine', position: versGeographique(v.origine, local) });
      return;
    }
    setSelection(null);
  }

  function identifiantNeuf(): string {
    generateur.current ??= creerGenerateurId({ horloge: () => Date.now(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
    return generateur.current<'Batiment'>();
  }

  function changerZoom(delta: number): void {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)));
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
    if (edition && !enSaisie && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void defaire(pile.current.at(-1));
    }
  }

  function demanderFermeture(): void {
    if (modifie) setConfirmation({ type: 'fermer' });
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
          setSelection(e.id);
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
          <button type="button" className="pl-bouton pl-fermer" onClick={demanderFermeture}>
            Fermer
          </button>
        </header>

        <div className="pl-corps">
          <div className="pl-carte">
            <div
              ref={planRef}
              data-testid="plan-placement"
              className="pl-plan"
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
                  {tuiles.map((t) => (
                    <img
                      key={`${String(t.zoom)}/${String(t.colonne)}/${String(t.ligne)}`}
                      data-testid="tuile"
                      src={t.url}
                      alt=""
                      draggable={false}
                      referrerPolicy="no-referrer"
                      className="pl-tuile"
                      style={{ left: t.x, top: t.y, width: t.largeur + 0.5, height: t.hauteur + 0.5 }}
                      onError={() => {
                        setTuilesEnErreur(true);
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
                    {MESSAGES_PLACEMENT.horsLigne}
                    <span> · carreaux de {String(CARREAU_M)} m</span>
                  </p>
                </div>
              )}

              {pret && (
                <svg className="pl-svg" width={taille.w} height={taille.h} aria-hidden="true">
                  {zones.map((z) =>
                    z.contour === null || batimentsAff.some((b) => b.zoneId === z.id) ? null : (
                      <polygon
                        key={z.id}
                        data-testid="zone-contour"
                        data-id={z.id}
                        className="pl-contour"
                        points={z.contour
                          .map((p) => {
                            const s = versEcran(vue, p);
                            return `${String(s.x)},${String(s.y)}`;
                          })
                          .join(' ')}
                      />
                    ),
                  )}
                  {origine !== null && <circle className="pl-depart" cx={depart.x} cy={depart.y} r={5} />}
                </svg>
              )}

              {pret && elements.planches.map(dessiner)}
              {pret && elements.batiments.map(dessiner)}

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
            {pose !== null && (
              <p role="status" className="pl-message">
                Touchez la photo pour poser « {pose.nom} ».{' '}
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
                  disabled={origine === null || pose !== null}
                  onClick={() => {
                    setFormulaire(true);
                  }}
                >
                  Nouveau bâtiment
                </button>
                <button type="button" className="pl-bouton pl-principal" disabled={!modifie || occupe} onClick={() => void enregistrer()}>
                  Enregistrer
                </button>
                {modifie && (
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

            <section data-testid="panneau-placement" aria-label="Réglages de l’élément" className="pl-panneau">
              {choisi === undefined ? (
                <p className="pl-aide">Touchez un bâtiment ou une planche pour le régler. Flèches : 0,1 m (Maj : 1 m) ; [ et ] : 1°.</p>
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
            <p>{MESSAGES_PLACEMENT.contourRemplace}.</p>
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
      <Champ etiquette="Longueur (m)" valeur={r.longueurM} desactive={lecture || planche} surChange={(longueurM) => { surRectangle({ ...r, longueurM }); }} />
      <Champ etiquette="Largeur (m)" valeur={r.largeurM} desactive={lecture || planche} surChange={(largeurM) => { surRectangle({ ...r, largeurM }); }} />
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
