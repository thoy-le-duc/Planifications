/**
 * Vue 3D (T27, Q29) : les zones en socles, les planches en volumes colorés par la culture de la
 * semaine, un curseur pour faire défiler la saison. T28c : le jumeau de la ferme, avec ses serres
 * en tunnels translucides, ses bâtiments et ses zones à leur place et à leur orientation réelles. Pour l'ordinateur (préparer la saison) ; au
 * téléphone, l'écran reste en 2D. Contrat : ./test/contrat.ts (section « Vue 3D (DOM) »).
 *
 * Seul morceau qui importe three et @react-three/fiber, chargé par import dynamique depuis
 * l'écran Planches. Robuste avant spectaculaire :
 *   - le sol de toutes les zones en UNE géométrie (polygones triangulés, ./formes.ts), les planches
 *     en un InstancedMesh, et les serres instanciées (arceaux, bâches, bouts) avec des géométries
 *     partagées : une dizaine d'appels de dessin, quelle que soit la ferme ;
 *   - la bâche est peu opaque, sans écriture de profondeur, sur un seul objet par forme : aucun tri
 *     coûteux, et la couleur d'une planche (filtrée ou non) se voit à travers ;
 *   - rendu à la demande (frameloop « demand ») : aucune image quand rien ne bouge ;
 *   - changer de semaine ne recolore que les instances, la géométrie ne bouge pas ;
 *   - les filtres (T27b : famille, culture, zone) estompent des planches sans les retirer : seules
 *     les couleurs des instances changent, l'état est local à la vue et n'est jamais stocké ;
 *   - WebGL perdu, erreur, ou images trop lentes : retour à la 2D avec un message ;
 *   - une liste texte des planches et cultures de la semaine, toujours présente (accessibilité).
 *
 * Aucun calcul agronomique : tout vient de `versScene`, qui ne fait que placer le plan de la 2D.
 */
import { createRoot, extend, useFrame, useThree, type ReconcilerRoot, type RootState } from '@react-three/fiber';
import { Component, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type RefObject, type ReactNode } from 'react';
import { AmbientLight, Color, DirectionalLight, DoubleSide, InstancedMesh, Mesh, MeshLambertMaterial, Object3D, Vector2 } from 'three';
import type { Plan } from '../plan/calculs.ts';
import { COULEURS, FAMILLES, type CleFamille } from '../../ui/jetons.ts';
import { boiteDe, cadrage, demarrerVol, empriseDe, meilleureVueDeFerme, poseAu, pointsDeFerme, type CibleVol, type Point3, type Pose, type Vol } from './cadrage.ts';
import { empreinteDe, geometrieArceau, geometrieBache, geometrieBout, geometrieMurs, geometriePlanche, geometrieSol, geometrieToit } from './formes.ts';
import { boiteSousRayon, type BoiteZone } from './pointage.ts';
import {
  appliquerFiltres,
  basculerFiltre,
  cocherRien,
  cocherTout,
  COULEUR_ESTOMPEE,
  COULEUR_NEUTRE,
  FILTRES_TOUT,
  hauteurRendue,
  optionsFiltres,
  versScene,
  type BatimentScene,
  type DimensionFiltre,
  type FiltresScene,
  type Scene,
  type SceneFiltree,

} from './scene.ts';
import './vue3d.css';

export interface ProprietesVue3d {
  readonly plan: Plan;
  /** « Retour au plan » : l'écran revient à la 2D. */
  readonly surRetour: () => void;
  /** La 3D ne peut pas tourner ici (erreur, contexte perdu, trop lente) : message pour la 2D. */
  readonly surEchec: (message: string) => void;
}

/** Marques de performance (e2e/vue-3d.e2e.ts) ; celle du module est posée par l'écran Planches (./entree.ts). */
const MARQUE_AFFICHEE = 'planif:vue-3d-affichee';
const MARQUE_SEMAINE = 'planif:vue-3d-semaine';
const MARQUE_FILTRE = 'planif:vue-3d-filtre';
const MARQUE_VOL_FIN = 'planif:vue-3d-vol-fin';

/** Épaisseur des socles (m de scène), posés sous le sol. */
const EPAISSEUR_SOCLE = 0.2;
/** Au-delà, la première image est jugée trop lente : retour à la 2D. */
const DELAI_PREMIERE_IMAGE_MS = 5_000;
/** Navigation : au moins tant d'images mesurées, et un intervalle médian au-delà duquel on renonce. */
const IMAGES_JUGEES = 20;
const INTERVALLE_TROP_LENT_MS = 100;
/** Caméra : angles de départ et bornes (radians), sensibilité du glissé (radians par pixel). */
const AZIMUT_DEPART = Math.PI / 4;
const ELEVATION_DEPART = 0.85;
const ELEVATION_MIN = 0.15;
const ELEVATION_MAX = 1.5;
const RADIANS_PAR_PX = 0.008;
const PAS_CLAVIER = 0.12;
const CHAMP_DEGRES = 40;
/** Un clic est un appui relâché sans avoir glissé de plus de tant de pixels (T29). */
const SEUIL_CLIC_PX = 4;

const MESSAGE_TROP_LENTE = 'La vue 3D est trop lente sur cet appareil : retour au plan en 2D.';
const MESSAGE_ERREUR = 'La vue 3D s’est arrêtée (carte graphique indisponible) : retour au plan en 2D.';

/**
 * Seuls objets three déclarés à fiber : pas de `<Canvas>`, qui déclare tout l'espace de noms
 * THREE (morceau plus lourd). La toile est la nôtre, fiber y monte sa racine (`createRoot`).
 */
extend({ AmbientLight, DirectionalLight, InstancedMesh, Mesh, MeshLambertMaterial });

/** Nom affiché de chaque famille (légende et cases), dans l'ordre des clés. */
const NOMS_FAMILLES: Readonly<Record<CleFamille, string>> = {
  salades: 'Astéracées (salades)',
  solanacees: 'Solanacées',
  cruciferes: 'Brassicacées (crucifères)',
  racines: 'Apiacées (racines)',
  alliacees: 'Alliacées',
  amaranthacees: 'Amaranthacées',
  asparagacees: 'Asparagacées',
  convolvulacees: 'Convolvulacées',
  cucurbitacees: 'Cucurbitacées',
  fabacees: 'Fabacées',
  lamiacees: 'Lamiacées',
  paeoniacees: 'Paeoniacées',
  poacees: 'Poacées',
  polygonacees: 'Polygonacées',
  rosacees: 'Rosacées',
  valerianacees: 'Valérianacées',
  autre: 'Autre famille',
};

function nomFamille(cle: string): string {
  return cle in NOMS_FAMILLES ? NOMS_FAMILLES[cle as CleFamille] : cle;
}

/** Suivi des images dessinées, hors de React (rien ne se redessine pour un compteur). */
interface Suivi {
  rendus: number;
  premiere: boolean;
  /** Semaine dont les couleurs viennent d'être posées : marquée à l'image suivante. */
  semaineEnAttente: number | null;
  /** Filtres dont les couleurs viennent d'être posées (nombre de planches estompées) : marqués à l'image suivante. */
  filtreEnAttente: number | null;
  /** Fois que les matrices des planches ont été posées depuis l'ouverture (jamais pour un filtre). */
  geometries: number;
  glisse: boolean;
  dernier: number;
  intervalles: number[];
  /** Caméra (T29) : ce que regarde la caméra, un vol est en cours, vols lancés depuis l'ouverture, cible du vol arrivé (marque à l'image suivante). */
  cible: Point3;
  vol: boolean;
  /** Valeur de `data-vol` déjà écrite. */
  volEcrit: boolean;
  /** La caméra a bougé depuis la dernière écriture de `data-camera`. */
  cameraAEcrire: boolean;
  vols: number;
  volFinEnAttente: string | null;
}

// ── Scène three (fiber) ──────────────────────────────────────────────────────────────────────

/** Dessine l'image (priorité 1 : fiber nous laisse le rendu), puis compte. */
function Rendu({ surImage }: { readonly surImage: (etat: RootState) => void }) {
  useFrame((etat) => {
    etat.gl.render(etat.scene, etat.camera);
    surImage(etat);
  }, 1);
  return null;
}

const temporaire = new Object3D();

/** Le sol de toutes les zones : une seule géométrie, posée une fois (un contour reste un contour, une serre son rectangle tourné). */
function Sol({ scene }: { readonly scene: Scene }) {
  const invalider = useThree((s) => s.invalidate);
  const geometrie = useMemo(() => geometrieSol(scene.socles.map(empreinteDe), EPAISSEUR_SOCLE), [scene.socles]);
  useLayoutEffect(() => {
    invalider();
    return () => {
      geometrie.dispose();
    };
  }, [geometrie, invalider]);
  return (
    <mesh geometry={geometrie} frustumCulled={false}>
      <meshLambertMaterial color={COULEURS.secondaire} side={DoubleSide} />
    </mesh>
  );
}

/** Part de la hauteur d'un volume simple occupée par les murs ; le reste est le toit. */
const PART_MURS = 0.72;
/** Pointe de l'arceau : le tube ne s'épaissit pas avec la serre (échelle z de l'instance). */
const arceauEpais = (largeurNef: number, hauteurArc: number): number => Math.sqrt(largeurNef * hauteurArc);

/**
 * Les bâtiments. Serres : une bâche par chapelle (demi-cylindre translucide), un bout à chaque
 * extrémité et un arceau tous les 2 m environ, chacun en UN InstancedMesh ; volumes simples (hangar,
 * magasin…) : murs et toit, chacun en un InstancedMesh. Les géométries sont uniques ; seule l'échelle
 * de l'instance change d'un bâtiment à l'autre. Les matrices se posent quand le plan change.
 */
function Batiments({ scene }: { readonly scene: Scene }) {
  const invalider = useThree((s) => s.invalidate);
  const serres = useMemo(() => scene.batiments.filter((b) => b.forme !== 'volume'), [scene.batiments]);
  const volumes = useMemo(() => scene.batiments.filter((b) => b.forme === 'volume'), [scene.batiments]);
  const nefs = serres.reduce((n, b) => n + b.nefs, 0);
  const arceaux = serres.reduce((n, b) => n + b.arceaux.length * b.nefs, 0);
  const formes = useMemo(() => ({ arceau: geometrieArceau(), bache: geometrieBache(), bout: geometrieBout(), murs: geometrieMurs(), toit: geometrieToit() }), []);
  useEffect(
    () => () => {
      for (const g of Object.values(formes)) g.dispose();
    },
    [formes],
  );
  const opacite = serres[0]?.opacite ?? 0.2;
  const couleurBache = serres[0]?.couleur ?? COULEURS.surface;
  const mArceaux = useRef<InstancedMesh>(null);
  const mBaches = useRef<InstancedMesh>(null);
  const mBouts = useRef<InstancedMesh>(null);
  const mMurs = useRef<InstancedMesh>(null);
  const mToits = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const poser = (m: InstancedMesh | null, i: number, x: number, y: number, z: number, angle: number, ex: number, ey: number, ez: number): void => {
      if (m === null) return;
      temporaire.position.set(x, y, z);
      temporaire.rotation.set(0, angle, 0);
      temporaire.scale.set(ex, ey, ez);
      temporaire.updateMatrix();
      m.setMatrixAt(i, temporaire.matrix);
    };
    let iArceau = 0;
    let iBache = 0;
    let iBout = 0;
    for (const b of serres) {
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const largeurNef = b.largeur / b.nefs;
      const hauteurArc = 2 * b.hauteur;
      // Repère de la serre → scène : x local = largeur, z local = longueur.
      const lx = (j: number): number => -b.largeur / 2 + (j + 0.5) * largeurNef;
      for (let j = 0; j < b.nefs; j += 1) {
        poser(mBaches.current, iBache, b.x + lx(j) * cos, 0, b.z - lx(j) * sin, b.angle, largeurNef, hauteurArc, b.profondeur);
        iBache += 1;
        for (const sens of [1, -1]) {
          const lz = (sens * b.profondeur) / 2;
          poser(mBouts.current, iBout, b.x + lx(j) * cos + lz * sin, 0, b.z - lx(j) * sin + lz * cos, sens === 1 ? b.angle : b.angle + Math.PI, largeurNef, hauteurArc, 1);
          iBout += 1;
        }
        for (const lz of b.arceaux) {
          poser(mArceaux.current, iArceau, b.x + lx(j) * cos + lz * sin, 0, b.z - lx(j) * sin + lz * cos, b.angle, largeurNef, hauteurArc, arceauEpais(largeurNef, hauteurArc));
          iArceau += 1;
        }
      }
    }
    const couleur = new Color();
    volumes.forEach((b, i) => {
      const murs = b.hauteur * PART_MURS;
      poser(mMurs.current, i, b.x, murs / 2, b.z, b.angle, b.largeur, murs, b.profondeur);
      mMurs.current?.setColorAt(i, couleur.set(b.couleur));
      poser(mToits.current, i, b.x, murs, b.z, b.angle, b.largeur * 1.04, b.hauteur - murs, b.profondeur * 1.02);
    });
    for (const m of [mArceaux.current, mBaches.current, mBouts.current, mMurs.current, mToits.current]) {
      if (m === null) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor !== null) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    invalider();
  }, [serres, volumes, invalider]);

  return (
    <>
      {arceaux > 0 && (
        <instancedMesh key={`a${String(arceaux)}`} ref={mArceaux} args={[formes.arceau, undefined, arceaux]} frustumCulled={false}>
          <meshLambertMaterial color={COULEURS.trait} />
        </instancedMesh>
      )}
      {nefs > 0 && (
        <>
          <instancedMesh key={`b${String(nefs)}`} ref={mBaches} args={[formes.bache, undefined, nefs]} frustumCulled={false} renderOrder={1}>
            <meshLambertMaterial color={couleurBache} transparent opacity={opacite} depthWrite={false} />
          </instancedMesh>
          <instancedMesh key={`e${String(nefs)}`} ref={mBouts} args={[formes.bout, undefined, 2 * nefs]} frustumCulled={false} renderOrder={1}>
            <meshLambertMaterial color={couleurBache} transparent opacity={opacite} depthWrite={false} />
          </instancedMesh>
        </>
      )}
      {volumes.length > 0 && (
        <>
          <instancedMesh key={`m${String(volumes.length)}`} ref={mMurs} args={[formes.murs, undefined, volumes.length]} frustumCulled={false}>
            <meshLambertMaterial />
          </instancedMesh>
          <instancedMesh key={`t${String(volumes.length)}`} ref={mToits} args={[formes.toit, undefined, volumes.length]} frustumCulled={false}>
            <meshLambertMaterial color={COULEURS.tertiaire} side={DoubleSide} />
          </instancedMesh>
        </>
      )}
    </>
  );
}

/** Ce qu'un changement de couleurs des planches a de nouveau, pour les marques de performance. */
interface Recoloration {
  readonly semaine: number;
  readonly semaineChangee: boolean;
  readonly filtresChanges: boolean;
  readonly estompes: number;
}

/**
 * Les planches : un seul InstancedMesh. Les matrices se posent quand le plan ou la semaine change
 * (une planche vide est à plat) ; les couleurs seules changent avec un filtre.
 */
function Volumes({
  scene,
  filtres,
  filtree,
  surGeometrie,
  surCouleurs,
}: {
  readonly scene: Scene;
  readonly filtres: FiltresScene;
  readonly filtree: SceneFiltree;
  readonly surGeometrie: () => void;
  readonly surCouleurs: (r: Recoloration) => void;
}) {
  const maillage = useRef<InstancedMesh>(null);
  const planche = useMemo(() => geometriePlanche(), []);
  useEffect(
    () => () => {
      planche.dispose();
    },
    [planche],
  );
  const invalider = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = maillage.current;
    if (m === null) return;
    scene.volumes.forEach((v, i) => {
      const h = hauteurRendue(v);
      temporaire.position.set(v.x, h / 2, v.z);
      temporaire.rotation.set(0, v.angle, 0);
      temporaire.scale.set(v.longueur, h, v.largeur);
      temporaire.updateMatrix();
      m.setMatrixAt(i, temporaire.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    surGeometrie();
    invalider();
  }, [scene, surGeometrie, invalider]);
  const precedent = useRef<{ readonly scene: Scene; readonly filtres: FiltresScene } | null>(null);
  useLayoutEffect(() => {
    const m = maillage.current;
    if (m === null) return;
    const couleur = new Color();
    let estompes = 0;
    filtree.volumes.forEach((v, i) => {
      if (v.estompe) estompes += 1;
      m.setColorAt(i, couleur.set(v.couleur));
    });
    if (m.instanceColor !== null) m.instanceColor.needsUpdate = true;
    const avant = precedent.current;
    precedent.current = { scene, filtres };
    surCouleurs({ semaine: scene.semaine, semaineChangee: avant?.scene !== scene, filtresChanges: avant?.filtres !== filtres, estompes });
    invalider();
  }, [scene, filtres, filtree, surCouleurs, invalider]);
  return (
    <instancedMesh ref={maillage} args={[planche, undefined, scene.volumes.length]} frustumCulled={false}>
      <meshLambertMaterial />
    </instancedMesh>
  );
}

interface Orbite {
  azimut: number;
  elevation: number;
  distance: number;
  /** Le point regardé : l'origine au départ, le centre de la zone après un vol. */
  cible: Point3;
}

/** Un vol en cours : son interpolation, l'heure de départ, et ce que la marque de fin nommera. */
interface VolEnCours {
  readonly vol: Vol;
  readonly debut: number;
  readonly cible: string;
}

/** Les pilotes de la caméra, donnés à la vue pour ses boutons : voler vers une cible. */
type Pilote = (cible: CibleVol) => void;

/** `prefers-reduced-motion: reduce`, relu à chaque vol (le réglage peut changer sans recharger). */
function mouvementReduit(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Caméra en orbite autour d'un point (la ferme au départ) : glissé du pointeur (bouton principal)
 * pour tourner, molette pour s'approcher, flèches du clavier (toile focalisée) aussi. Une image
 * par geste. Un clic sur une zone ou une planche (T29) lance un vol vers la zone ; les boutons de
 * la liste font de même par `pilote`. La boucle d'images ne tourne que pendant le vol.
 */
function Camera({
  rayon,
  centre,
  scene,
  boites,
  suiviRef,
  piloteRef,
  surGlisse,
}: {
  readonly rayon: number;
  /** Le point regardé au départ : le centre de la ferme (au sol). */
  readonly centre: Point3;
  readonly scene: Scene;
  readonly boites: readonly BoiteZone[];
  readonly suiviRef: RefObject<Suivi>;
  readonly piloteRef: RefObject<Pilote | null>;
  readonly surGlisse: (enCours: boolean) => void;
}) {
  const lireEtat = useThree((s) => s.get);
  const toile = useThree((s) => s.gl.domElement);
  const invalider = useThree((s) => s.invalidate);
  const orbite = useRef<Orbite | null>(null);
  const enVol = useRef<VolEnCours | null>(null);
  const imageDuVol = useRef<(() => void) | null>(null);
  const sceneRef = useRef(scene);
  const boitesRef = useRef(boites);
  useLayoutEffect(() => {
    sceneRef.current = scene;
    boitesRef.current = boites;
  }, [scene, boites]);

  // Priorité 0 : avant l'image (priorité 1, ./Rendu), la pose du vol est posée sur la caméra.
  useFrame(() => {
    imageDuVol.current?.();
  }, 0);

  useEffect(() => {
    // Vue de départ : celle de « Vue d'ensemble » (toute la ferme cadrée, marge de 10 %), vue de biais du côté de l'azimut de départ.
    const cadre = toile.getBoundingClientRect();
    const rapport = cadre.width > 0 && cadre.height > 0 ? cadre.width / cadre.height : 1;
    const vueDepart = meilleureVueDeFerme(pointsDeFerme(sceneRef.current), CHAMP_DEGRES, rapport, AZIMUT_DEPART);
    const poseDepart = vueDepart?.pose ?? null;
    const distanceDepart = poseDepart === null ? rayon * 3 : Math.hypot(poseDepart.position.x - poseDepart.cible.x, poseDepart.position.y - poseDepart.cible.y, poseDepart.position.z - poseDepart.cible.z);
    const o: Orbite = orbite.current ?? {
      azimut: vueDepart?.azimut ?? AZIMUT_DEPART,
      elevation: poseDepart === null ? ELEVATION_DEPART : Math.asin((poseDepart.position.y - poseDepart.cible.y) / distanceDepart),
      distance: distanceDepart,
      cible: poseDepart?.cible ?? centre,
    };
    orbite.current = o;

    const poseDeOrbite = (): Pose => {
      const horizontal = o.distance * Math.cos(o.elevation);
      return {
        position: { x: o.cible.x + horizontal * Math.sin(o.azimut), y: o.cible.y + o.distance * Math.sin(o.elevation), z: o.cible.z + horizontal * Math.cos(o.azimut) },
        cible: o.cible,
      };
    };
    const orbiteDepuis = (pose: Pose): void => {
      const dx = pose.position.x - pose.cible.x;
      const dy = pose.position.y - pose.cible.y;
      const dz = pose.position.z - pose.cible.z;
      const d = Math.hypot(dx, dy, dz);
      o.cible = pose.cible;
      if (d <= 0) return;
      o.distance = d;
      o.elevation = Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, Math.asin(dy / d)));
      if (Math.hypot(dx, dz) > 1e-9) o.azimut = Math.atan2(dx, dz);
    };
    const appliquer = (pose: Pose): void => {
      const { camera } = lireEtat();
      const d = Math.hypot(pose.position.x - pose.cible.x, pose.position.y - pose.cible.y, pose.position.z - pose.cible.z);
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      camera.lookAt(pose.cible.x, pose.cible.y, pose.cible.z);
      camera.near = Math.max(0.1, d / 100);
      camera.far = d * 4 + rayon * 2 + Math.hypot(pose.cible.x, pose.cible.z);
      camera.updateProjectionMatrix();
      suiviRef.current.cible = pose.cible;
      suiviRef.current.cameraAEcrire = true;
    };
    const placer = () => {
      appliquer(poseDeOrbite());
      invalider();
    };
    placer();

    const poseCourante = (): Pose => {
      const v = enVol.current;
      return v === null ? poseDeOrbite() : poseAu(v.vol, performance.now() - v.debut);
    };
    /** Le geste de l'utilisateur reprend la main : le vol s'arrête là où il en est. */
    const arreterVol = () => {
      if (enVol.current === null) return;
      const pose = poseCourante();
      enVol.current = null;
      suiviRef.current.vol = false;
      orbiteDepuis(pose);
      placer();
    };

    const aller: Pilote = (cible) => {
      // Toute la ferme : exactement la vue d'ouverture (meilleur azimut, cadrage sur les vrais coins) ; le reste, la boîte de la cible.
      const boite = cible.sorte === 'ferme' ? null : boiteDe(sceneRef.current, cible);
      if (cible.sorte !== 'ferme' && boite === null) return;
      const depart = poseCourante();
      const dx = depart.position.x - depart.cible.x;
      const dz = depart.position.z - depart.cible.z;
      const direction = Math.hypot(dx, dz) > 1e-9 ? { x: dx, z: dz } : { x: Math.sin(o.azimut), z: Math.cos(o.azimut) };
      const cadre = toile.getBoundingClientRect();
      const rapport = cadre.width > 0 && cadre.height > 0 ? cadre.width / cadre.height : 1;
      const arrivee = boite === null ? (meilleureVueDeFerme(pointsDeFerme(sceneRef.current), CHAMP_DEGRES, rapport, AZIMUT_DEPART)?.pose ?? null) : cadrage(boite, CHAMP_DEGRES, rapport, direction);
      if (arrivee === null) return;
      const vol = demarrerVol(depart, arrivee, mouvementReduit());
      enVol.current = { vol, debut: performance.now(), cible: cible.sorte === 'ferme' ? 'ferme' : cible.id };
      suiviRef.current.vol = vol.dureeMs > 0;
      suiviRef.current.vols += 1;
      toile.dataset.vols = String(suiviRef.current.vols);
      // Le vol est annoncé tout de suite (pas à la prochaine image) : qui lit `data-vol` après le clic ne voit pas « non » par erreur.
      if (vol.dureeMs > 0) {
        toile.dataset.vol = 'oui';
        suiviRef.current.volEcrit = true;
      }
      invalider();
    };
    piloteRef.current = aller;

    imageDuVol.current = () => {
      const v = enVol.current;
      if (v === null) return;
      const ecoule = performance.now() - v.debut;
      const pose = poseAu(v.vol, ecoule);
      appliquer(pose);
      if (ecoule >= v.vol.dureeMs) {
        enVol.current = null;
        suiviRef.current.vol = false;
        suiviRef.current.volFinEnAttente = v.cible;
          orbiteDepuis(pose);
      } else {
        invalider();
      }
    };

    /** Clic sur la scène : la zone touchée par le rayon du pointeur (socle, planche ou serre), ou le bâtiment. */
    const cliquer = (e: PointerEvent) => {
      const cadre = toile.getBoundingClientRect();
      if (cadre.width <= 0 || cadre.height <= 0) return;
      const { raycaster, camera } = lireEtat();
      camera.updateMatrixWorld();
      raycaster.setFromCamera(new Vector2(((e.clientX - cadre.left) / cadre.width) * 2 - 1, -(((e.clientY - cadre.top) / cadre.height) * 2 - 1)), camera);
      const touchee = boiteSousRayon(raycaster.ray.origin, raycaster.ray.direction, boitesRef.current);
      if (touchee === null) return;
      // Une serre répond par sa zone ; un bâtiment qui n'abrite aucune zone vole vers lui-même.
      if (touchee.zoneId === '' && touchee.batimentId !== undefined) aller({ sorte: 'batiment', id: touchee.batimentId });
      else aller({ sorte: 'zone', id: touchee.zoneId });
    };

    let pointeur: { id: number; x: number; y: number; x0: number; y0: number; glisse: boolean } | null = null;
    const bas = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      pointeur = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, glisse: false };
      toile.setPointerCapture(e.pointerId);
      surGlisse(true);
    };
    const bouge = (e: PointerEvent) => {
      if (pointeur?.id !== e.pointerId) return;
      if (!pointeur.glisse) {
        // Sous le seuil, c'est encore un clic : la vue ne bouge pas.
        if (Math.hypot(e.clientX - pointeur.x0, e.clientY - pointeur.y0) <= SEUIL_CLIC_PX) return;
        pointeur.glisse = true;
        arreterVol();
      }
      o.azimut -= (e.clientX - pointeur.x) * RADIANS_PAR_PX;
      o.elevation = Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, o.elevation + (e.clientY - pointeur.y) * RADIANS_PAR_PX));
      pointeur = { ...pointeur, x: e.clientX, y: e.clientY };
      placer();
    };
    const haut = (e: PointerEvent) => {
      if (pointeur?.id !== e.pointerId) return;
      const clic = !pointeur.glisse;
      pointeur = null;
      surGlisse(false);
      if (clic) cliquer(e);
    };
    const molette = (e: WheelEvent) => {
      e.preventDefault();
      arreterVol();
      o.distance = Math.min(Math.max(distanceDepart * 3, o.distance), Math.max(Math.min(distanceDepart * 0.15, o.distance), o.distance * Math.exp(e.deltaY * 0.001)));
      placer();
    };
    const actions: Readonly<Record<string, () => void>> = {
      ArrowLeft: () => {
        o.azimut += PAS_CLAVIER;
      },
      ArrowRight: () => {
        o.azimut -= PAS_CLAVIER;
      },
      ArrowUp: () => {
        o.elevation = Math.min(ELEVATION_MAX, o.elevation + PAS_CLAVIER);
      },
      ArrowDown: () => {
        o.elevation = Math.max(ELEVATION_MIN, o.elevation - PAS_CLAVIER);
      },
      '+': () => {
        o.distance = Math.max(Math.min(distanceDepart * 0.15, o.distance), o.distance * 0.85);
      },
      '-': () => {
        o.distance = Math.min(Math.max(distanceDepart * 3, o.distance), o.distance / 0.85);
      },
    };
    const touche = (e: KeyboardEvent) => {
      const action = Object.hasOwn(actions, e.key) ? actions[e.key] : undefined;
      if (action === undefined) return;
      arreterVol();
      action();
      e.preventDefault();
      placer();
    };
    toile.addEventListener('pointerdown', bas);
    toile.addEventListener('pointermove', bouge);
    toile.addEventListener('pointerup', haut);
    toile.addEventListener('pointercancel', haut);
    toile.addEventListener('wheel', molette, { passive: false });
    toile.addEventListener('keydown', touche);
    return () => {
      piloteRef.current = null;
      imageDuVol.current = null;
      toile.removeEventListener('pointerdown', bas);
      toile.removeEventListener('pointermove', bouge);
      toile.removeEventListener('pointerup', haut);
      toile.removeEventListener('pointercancel', haut);
      toile.removeEventListener('wheel', molette);
      toile.removeEventListener('keydown', touche);
    };
  }, [lireEtat, toile, invalider, rayon, centre, suiviRef, piloteRef, surGlisse]);
  return null;
}

/** Une erreur dans la 3D (shader, contexte) ne casse pas l'écran : retour à la 2D. */
class GardeErreur extends Component<{ readonly surErreur: () => void; readonly children: ReactNode }, { readonly erreur: boolean }> {
  override state = { erreur: false };
  static getDerivedStateFromError(): { erreur: boolean } {
    return { erreur: true };
  }
  override componentDidCatch(erreur: Error, info: ErrorInfo): void {
    console.error('Vue 3D arrêtée', erreur, info.componentStack);
    this.props.surErreur();
  }
  override render(): ReactNode {
    return this.state.erreur ? null : this.props.children;
  }
}

// ── Liste texte (alternative accessible) ─────────────────────────────────────────────────────

const ElementListe = memo(function ElementListe({ id, code, culture, couleur, estompe }: { readonly id: string; readonly code: string; readonly culture: string | null; readonly couleur: string; readonly estompe: boolean }) {
  const classes = [culture === null ? 'plan3d-vide' : '', estompe ? 'plan3d-estompe' : ''].filter((c) => c !== '').join(' ');
  return (
    <li data-testid="element-liste-3d" data-id={id} data-culture={culture ?? ''} data-estompe={estompe ? 'oui' : 'non'} className={classes === '' ? undefined : classes}>
      <i aria-hidden="true" style={{ background: couleur }} />
      <span className="plan3d-code">{code}</span>
      <span className="plan3d-culture">{culture ?? 'vide'}</span>
    </li>
  );
});

/** Une case à cocher de filtre : le nom accessible est le libellé, la valeur est lue par les tests. */
const CaseFiltre = memo(function CaseFiltre({
  testid,
  dimension,
  valeur,
  libelle,
  coche,
  couleur,
  surBascule,
}: {
  readonly testid: string;
  readonly dimension: DimensionFiltre;
  readonly valeur: string;
  readonly libelle: string;
  readonly coche: boolean;
  readonly couleur?: string;
  readonly surBascule: (dimension: DimensionFiltre, valeur: string) => void;
}) {
  return (
    <li>
      <label className="plan3d-case">
        <input
          type="checkbox"
          data-testid={testid}
          data-valeur={valeur}
          checked={coche}
          onChange={() => {
            surBascule(dimension, valeur);
          }}
        />
        {couleur !== undefined && <i aria-hidden="true" style={{ background: couleur }} />}
        <span>{libelle}</span>
      </label>
    </li>
  );
});

/** « Tout » et « Rien » d'une dimension de filtre. */
function BoutonsToutRien({ dimension, surTout, surRien }: { readonly dimension: DimensionFiltre; readonly surTout: (d: DimensionFiltre) => void; readonly surRien: (d: DimensionFiltre) => void }) {
  return (
    <span className="plan3d-toutrien">
      <button
        type="button"
        data-testid="filtre-tout-3d"
        data-dimension={dimension}
        onClick={() => {
          surTout(dimension);
        }}
      >
        Tout
      </button>
      <button
        type="button"
        data-testid="filtre-rien-3d"
        data-dimension={dimension}
        onClick={() => {
          surRien(dimension);
        }}
      >
        Rien
      </button>
    </span>
  );
}

// ── Vue ──────────────────────────────────────────────────────────────────────────────────────

/** Nom lu du type d'un bâtiment (liste texte). */
const NOMS_TYPES: Readonly<Record<BatimentScene['type'], string>> = {
  serre_tunnel: 'serre tunnel',
  serre_chapelle: 'serre à chapelles',
  hangar: 'hangar',
  magasin: 'magasin',
  autre: 'bâtiment',
};

const ElementBatiment = memo(function ElementBatiment({ batiment, surAller }: { readonly batiment: BatimentScene; readonly surAller: (cible: CibleVol) => void }) {
  return (
    <li data-testid="element-batiment-3d" data-id={batiment.id} data-forme={batiment.forme}>
      <span className="plan3d-code">{batiment.nom}</span>
      <span className="plan3d-culture">{NOMS_TYPES[batiment.type]}</span>
      {batiment.zoneId === null && (
        <button
          type="button"
          data-testid="aller-batiment-3d"
          data-id={batiment.id}
          className="plan3d-bouton"
          onClick={() => {
            surAller({ sorte: 'batiment', id: batiment.id });
          }}
        >
          Aller à {batiment.nom}
        </button>
      )}
    </li>
  );
});

export function Vue3d({ plan, surRetour, surEchec }: ProprietesVue3d) {
  const nbSemaines = plan.semaines.length;
  const [semaine, setSemaine] = useState(() => Math.min(Math.max(0, nbSemaines - 1), plan.semaineCourante ?? 0));
  const [prete, setPrete] = useState(false);
  const idCurseur = useId();
  const idListe = useId();
  const idBatiments = useId();

  // Géométrie : posée par le plan seul (la semaine ne change que les couleurs).
  const geometrie = useMemo(() => (nbSemaines === 0 ? null : versScene(plan, 0)), [plan, nbSemaines]);
  const semaineBornee = Math.min(semaine, Math.max(0, nbSemaines - 1));
  const scene = useMemo(() => (nbSemaines === 0 ? null : versScene(plan, semaineBornee)), [plan, semaineBornee, nbSemaines]);
  const { centre, rayon } = useMemo(() => (geometrie === null ? { centre: { x: 0, y: 0, z: 0 }, rayon: 1 } : empriseDe(geometrie)), [geometrie]);

  // Filtres (T27b) : état local à la vue, jamais écrit ni stocké ; tout est coché à chaque ouverture.
  const [filtres, setFiltres] = useState<FiltresScene>(FILTRES_TOUT);
  const options = useMemo(() => (scene === null ? { familles: [], cultures: [], zones: [] } : optionsFiltres(scene)), [scene]);
  const filtree = useMemo(() => (scene === null ? null : appliquerFiltres(scene, filtres)), [scene, filtres]);
  const univers = useCallback(
    (dimension: DimensionFiltre): readonly string[] => (dimension === 'zones' ? options.zones.map((z) => z.id) : options[dimension]),
    [options],
  );
  const basculer = useCallback(
    (dimension: DimensionFiltre, valeur: string) => {
      setFiltres((f) => basculerFiltre(f, dimension, valeur, univers(dimension)));
    },
    [univers],
  );
  const toutCocher = useCallback((dimension: DimensionFiltre) => {
    setFiltres((f) => cocherTout(f, dimension));
  }, []);
  const toutDecocher = useCallback((dimension: DimensionFiltre) => {
    setFiltres((f) => cocherRien(f, dimension));
  }, []);
  const estCoche = (dimension: DimensionFiltre, valeur: string): boolean => filtres[dimension]?.has(valeur) ?? true;

  const suivi = useRef<Suivi>({ rendus: 0, premiere: false, semaineEnAttente: null, filtreEnAttente: null, geometries: 0, glisse: false, dernier: -1, intervalles: [], cible: { x: 0, y: 0, z: 0 }, vol: false, volEcrit: false, cameraAEcrire: true, vols: 0, volFinEnAttente: null });
  const surEchecRef = useRef(surEchec);
  useLayoutEffect(() => {
    surEchecRef.current = surEchec;
  }, [surEchec]);

  const surImage = useCallback(({ gl, camera }: RootState) => {
    const s = suivi.current;
    s.rendus += 1;
    const ds = gl.domElement.dataset;
    ds.rendus = String(s.rendus);
    // La caméra (T29), lue par les tests et, plus tard, par la voix : réécrite seulement quand elle a bougé, par gabarit.
    if (s.cameraAEcrire) {
      const { x, y, z } = camera.position;
      const c = s.cible;
      ds.camera = `{"position":{"x":${String(x)},"y":${String(y)},"z":${String(z)}},"cible":{"x":${String(c.x)},"y":${String(c.y)},"z":${String(c.z)}}}`;
      s.cameraAEcrire = false;
    }
    if (s.volEcrit !== s.vol) {
      ds.vol = s.vol ? 'oui' : 'non';
      s.volEcrit = s.vol;
    }
    if (s.volFinEnAttente !== null) {
      performance.mark(MARQUE_VOL_FIN, { detail: { cible: s.volFinEnAttente } });
      s.volFinEnAttente = null;
    }
    if (!s.premiere) {
      s.premiere = true;
      performance.mark(MARQUE_AFFICHEE);
      setPrete(true);
    }
    if (s.semaineEnAttente !== null) {
      performance.mark(MARQUE_SEMAINE, { detail: { semaine: s.semaineEnAttente } });
      s.semaineEnAttente = null;
    }
    if (s.filtreEnAttente !== null) {
      performance.mark(MARQUE_FILTRE, { detail: { estompes: s.filtreEnAttente } });
      s.filtreEnAttente = null;
    }
    if (s.glisse) {
      const t = performance.now();
      if (s.dernier >= 0) s.intervalles.push(t - s.dernier);
      s.dernier = t;
    }
  }, []);

  const toileRef = useRef<HTMLCanvasElement>(null);
  /** Donné par la caméra : les boutons de la liste s'en servent pour voler vers une zone (T29). */
  const pilote = useRef<Pilote | null>(null);
  const aller = useCallback((cible: CibleVol) => {
    pilote.current?.(cible);
  }, []);

  // Couleurs posées : la marque « semaine » ou « filtre » suit à l'image suivante (pas la première).
  const couleursPosees = useRef(false);
  const surCouleurs = useCallback((r: Recoloration) => {
    if (toileRef.current !== null) toileRef.current.dataset.estompes = String(r.estompes);
    if (couleursPosees.current) {
      if (r.semaineChangee) suivi.current.semaineEnAttente = r.semaine;
      else if (r.filtresChanges) suivi.current.filtreEnAttente = r.estompes;
    }
    couleursPosees.current = true;
  }, []);

  // Matrices des planches posées (plan ou semaine, jamais un filtre) : compteur lu par les tests.
  const surGeometrie = useCallback(() => {
    suivi.current.geometries += 1;
    if (toileRef.current !== null) toileRef.current.dataset.geometries = String(suivi.current.geometries);
  }, []);

  // Navigation trop lente (médiane des intervalles d'un glissé) : retour à la 2D.
  const surGlisse = useCallback((enCours: boolean) => {
    const s = suivi.current;
    s.glisse = enCours;
    s.dernier = -1;
    if (enCours) {
      s.intervalles = [];
      return;
    }
    const tries = [...s.intervalles].sort((a, b) => a - b);
    const mediane = tries[Math.floor(tries.length / 2)] ?? 0;
    if (tries.length >= IMAGES_JUGEES && mediane > INTERVALLE_TROP_LENT_MS) surEchecRef.current(MESSAGE_TROP_LENTE);
  }, []);

  // Première image trop lente à venir : retour à la 2D.
  useEffect(() => {
    const minuterie = setTimeout(() => {
      if (!suivi.current.premiere) surEchecRef.current(MESSAGE_TROP_LENTE);
    }, DELAI_PREMIERE_IMAGE_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, []);

  const surErreur = useCallback(() => {
    surEchecRef.current(MESSAGE_ERREUR);
  }, []);

  // La toile et sa racine fiber : créées une fois, à la taille du cadre (suivie au redimensionnement).
  const racine = useRef<ReconcilerRoot<HTMLCanvasElement> | null>(null);
  const [configuree, setConfiguree] = useState(false);
  useLayoutEffect(() => {
    const toile = toileRef.current;
    const cadre = toile?.parentElement;
    if (toile === null || cadre === null || cadre === undefined) return undefined;
    const r = createRoot(toile);
    racine.current = r;
    let actif = true;
    const perdu = (e: Event) => {
      e.preventDefault();
      surEchecRef.current(MESSAGE_ERREUR);
    };
    toile.addEventListener('webglcontextlost', perdu);
    const configurer = () => {
      r.configure({
        frameloop: 'demand',
        flat: true,
        dpr: [1, 2],
        gl: { antialias: false, alpha: true, powerPreference: 'high-performance' },
        camera: { fov: CHAMP_DEGRES },
        size: { width: Math.max(1, cadre.clientWidth), height: Math.max(1, cadre.clientHeight), top: 0, left: 0 },
      }).then(
        () => {
          if (actif) setConfiguree(true);
        },
        (erreur: unknown) => {
          console.error('Vue 3D : WebGL indisponible', erreur);
          if (actif) surEchecRef.current(MESSAGE_ERREUR);
        },
      );
    };
    const observateur = new ResizeObserver(configurer);
    observateur.observe(cadre);
    return () => {
      actif = false;
      observateur.disconnect();
      // Le démontage libère le contexte WebGL : ce n'est pas une perte à signaler.
      toile.removeEventListener('webglcontextlost', perdu);
      r.unmount();
      racine.current = null;
    };
  }, []);

  // Ce que le pointeur peut toucher : les socles (au ras du sol) et les planches telles que dessinées.
  const boites = useMemo<readonly BoiteZone[]>(() => {
    if (filtree === null) return [];
    const zones = new Set(filtree.socles.map((s) => s.id));
    return [
      ...filtree.socles.map((s) => ({ zoneId: s.id, min: { x: s.x - s.largeur / 2, y: -EPAISSEUR_SOCLE, z: s.z - s.profondeur / 2 }, max: { x: s.x + s.largeur / 2, y: 0, z: s.z + s.profondeur / 2 }, angle: s.angle })),
      ...filtree.volumes.map((v) => ({ zoneId: v.zoneId, min: { x: v.x - v.longueur / 2, y: 0, z: v.z - v.largeur / 2 }, max: { x: v.x + v.longueur / 2, y: v.hauteurRendue, z: v.z + v.largeur / 2 }, angle: v.angle })),
      // Une serre se touche par sa zone ; un bâtiment qui n'abrite aucune zone de la scène, par lui-même.
      ...filtree.batiments.map((b) => ({
        zoneId: b.zoneId !== null && zones.has(b.zoneId) ? b.zoneId : '',
        batimentId: b.id,
        min: { x: b.x - b.largeur / 2, y: 0, z: b.z - b.profondeur / 2 },
        max: { x: b.x + b.largeur / 2, y: b.hauteur, z: b.z + b.profondeur / 2 },
        angle: b.angle,
      })),
    ];
  }, [filtree]);

  const nbVolumes = geometrie?.volumes.length ?? 0;
  // Ce que le jumeau dessine, lu par les tests : bâtiments, arceaux (tous bâtiments), planches placées. La géométrie ne dépend pas de la semaine.
  const nbBatiments = geometrie?.batiments.length ?? 0;
  const nbArceaux = geometrie?.batiments.reduce((n, b) => n + b.arceaux.length, 0) ?? 0;
  const nbPlacees = geometrie?.volumes.filter((v) => v.placee).length ?? 0;
  const libelleCourant = plan.semaines[semaineBornee]?.libelle ?? '';
  const description = `Vue 3D des planches, semaine ${libelleCourant}. Glisser pour tourner, molette pour s’approcher ; au clavier, flèches et + ou -.`;

  // La scène, rendue dans la racine fiber à chaque rendu de la vue (comme le fait <Canvas>).
  useLayoutEffect(() => {
    if (!configuree || geometrie === null || scene === null || filtree === null) return;
    racine.current?.render(
      <GardeErreur surErreur={surErreur}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[rayon * 0.3, rayon, rayon * 0.5]} intensity={1.8} />
        <Sol scene={geometrie} />
        <Batiments scene={geometrie} />
        <Volumes key={nbVolumes} scene={scene} filtres={filtres} filtree={filtree} surGeometrie={surGeometrie} surCouleurs={surCouleurs} />
        <Camera rayon={rayon} centre={centre} scene={scene} boites={boites} suiviRef={suivi} piloteRef={pilote} surGlisse={surGlisse} />
        <Rendu surImage={surImage} />
      </GardeErreur>,
    );
  });

  const libelle = libelleCourant;

  return (
    <section data-testid="vue-3d" data-etat={prete ? 'pret' : 'chargement'} data-semaine={semaineBornee} className="plan3d" aria-label="Vue 3D">
      <div className="plan3d-outils">
        <button type="button" data-testid="retour-2d" className="plan3d-retour" onClick={surRetour}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Retour au plan
        </button>
        <label htmlFor={idCurseur} className="plan3d-etiquette">
          Semaine
        </label>
        <input
          id={idCurseur}
          data-testid="curseur-semaine"
          type="range"
          className="plan3d-curseur"
          min={0}
          max={Math.max(0, nbSemaines - 1)}
          step={1}
          value={semaineBornee}
          aria-valuetext={libelle}
          disabled={nbSemaines === 0}
          onChange={(e) => {
            setSemaine(Number(e.target.value));
          }}
        />
        <output data-testid="semaine-3d" htmlFor={idCurseur} className="plan3d-semaine">
          {libelle}
        </output>
        <button
          type="button"
          data-testid="vue-ensemble-3d"
          className="plan3d-bouton"
          disabled={nbSemaines === 0}
          onClick={() => {
            aller({ sorte: 'ferme' });
          }}
        >
          Vue d’ensemble
        </button>
      </div>
      <div className="plan3d-corps">
        <div className="plan3d-scene">
          <canvas ref={toileRef} data-testid="toile-3d" data-volumes={nbVolumes} data-batiments={nbBatiments} data-arceaux={nbArceaux} data-placees={nbPlacees} data-rendus={0} data-geometries={0} data-estompes={0} data-vols={0} data-vol="non" data-champ={CHAMP_DEGRES} role="img" aria-label={description} tabIndex={0} className="plan3d-toile" />
        </div>
        <aside data-testid="panneau-3d" className="plan3d-cote" aria-label="Légende, filtres et liste des planches">
          <div className="plan3d-filtres">
            <details open data-testid="legende-3d" className="plan3d-groupe">
              <summary>
                Familles <span className="plan3d-nombre">({options.familles.length})</span>
              </summary>
              <BoutonsToutRien dimension="familles" surTout={toutCocher} surRien={toutDecocher} />
              <ul role="list" className="plan3d-cases">
                {options.familles.map((cle) => (
                  <CaseFiltre key={cle} testid="filtre-famille-3d" dimension="familles" valeur={cle} libelle={nomFamille(cle)} coche={estCoche('familles', cle)} couleur={FAMILLES[cle as CleFamille].bande} surBascule={basculer} />
                ))}
              </ul>
              <p className="plan3d-vide-legende">
                <i aria-hidden="true" style={{ background: COULEUR_NEUTRE }} />
                Planche vide, à plat
                <i aria-hidden="true" style={{ background: COULEUR_ESTOMPEE }} />
                Estompée
              </p>
            </details>
            <details open className="plan3d-groupe">
              <summary>
                Zones <span className="plan3d-nombre">({options.zones.length})</span>
              </summary>
              <ul role="list" className="plan3d-cases plan3d-cases-defilantes">
                {scene?.socles.map((z) => (
                  <li key={z.id}>
                    <button
                      type="button"
                      data-testid="aller-zone-3d"
                      data-id={z.id}
                      className="plan3d-bouton"
                      onClick={() => {
                        aller({ sorte: 'zone', id: z.id });
                      }}
                    >
                      Aller à {z.nom}
                    </button>
                  </li>
                ))}
              </ul>
              <BoutonsToutRien dimension="zones" surTout={toutCocher} surRien={toutDecocher} />
              <ul role="list" className="plan3d-cases plan3d-cases-defilantes">
                {options.zones.map((z) => (
                  <CaseFiltre key={z.id} testid="filtre-zone-3d" dimension="zones" valeur={z.id} libelle={z.nom} coche={estCoche('zones', z.id)} surBascule={basculer} />
                ))}
              </ul>
            </details>
            <details open className="plan3d-groupe">
              <summary>
                Cultures <span className="plan3d-nombre">({options.cultures.length})</span>
              </summary>
              <BoutonsToutRien dimension="cultures" surTout={toutCocher} surRien={toutDecocher} />
              <ul role="list" className="plan3d-cases plan3d-cases-defilantes">
                {options.cultures.map((c) => (
                  <CaseFiltre key={c} testid="filtre-culture-3d" dimension="cultures" valeur={c} libelle={c} coche={estCoche('cultures', c)} surBascule={basculer} />
                ))}
              </ul>
            </details>
          </div>
          {geometrie !== null && geometrie.batiments.length > 0 && (
            <>
              <h2 id={idBatiments} className="plan3d-titre-liste">
                Bâtiments
              </h2>
              <ul data-testid="liste-batiments-3d" role="list" aria-labelledby={idBatiments} className="plan3d-liste plan3d-liste-batiments">
                {geometrie.batiments.map((b) => (
                  <ElementBatiment key={b.id} batiment={b} surAller={aller} />
                ))}
              </ul>
            </>
          )}
          <h2 id={idListe} className="plan3d-titre-liste">
            Planches et cultures, {libelle}
          </h2>
          <ul data-testid="liste-3d" role="list" aria-labelledby={idListe} className="plan3d-liste">
            {filtree?.volumes.map((v) => <ElementListe key={v.id} id={v.id} code={v.code} culture={v.culture} couleur={v.couleur} estompe={v.estompe} />)}
          </ul>
        </aside>
      </div>
    </section>
  );
}
