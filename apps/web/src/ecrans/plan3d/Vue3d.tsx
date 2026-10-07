/**
 * Vue 3D (T27, Q29) : les zones en socles, les planches en volumes colorés par la culture de la
 * semaine, un curseur pour faire défiler la saison. Pour l'ordinateur (préparer la saison) ; au
 * téléphone, l'écran reste en 2D. Contrat : ./test/contrat.ts (section « Vue 3D (DOM) »).
 *
 * Seul morceau qui importe three et @react-three/fiber, chargé par import dynamique depuis
 * l'écran Planches. Robuste avant spectaculaire :
 *   - deux InstancedMesh (socles, planches) : deux appels de dessin, quelle que soit la ferme ;
 *   - rendu à la demande (frameloop « demand ») : aucune image quand rien ne bouge ;
 *   - changer de semaine ne recolore que les instances, la géométrie ne bouge pas ;
 *   - WebGL perdu, erreur, ou images trop lentes : retour à la 2D avec un message ;
 *   - une liste texte des planches et cultures de la semaine, toujours présente (accessibilité).
 *
 * Aucun calcul agronomique : tout vient de `versScene`, qui ne fait que placer le plan de la 2D.
 */
import { createRoot, extend, useFrame, useThree, type ReconcilerRoot, type RootState } from '@react-three/fiber';
import { Component, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { AmbientLight, BoxGeometry, Color, DirectionalLight, InstancedMesh, MeshLambertMaterial, Object3D } from 'three';
import type { Plan } from '../plan/calculs.ts';
import { COULEURS, FAMILLES, type CleFamille } from '../../ui/jetons.ts';
import { COULEUR_NEUTRE, versScene, type Scene } from './scene.ts';
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

const MESSAGE_TROP_LENTE = 'La vue 3D est trop lente sur cet appareil : retour au plan en 2D.';
const MESSAGE_ERREUR = 'La vue 3D s’est arrêtée (carte graphique indisponible) : retour au plan en 2D.';

/**
 * Seuls objets three déclarés à fiber : pas de `<Canvas>`, qui déclare tout l'espace de noms
 * THREE (morceau plus lourd). La toile est la nôtre, fiber y monte sa racine (`createRoot`).
 */
extend({ AmbientLight, BoxGeometry, DirectionalLight, InstancedMesh, MeshLambertMaterial });

const LEGENDE: readonly (readonly [CleFamille, string])[] = [
  ['salades', 'Salades'],
  ['solanacees', 'Solanacées'],
  ['cruciferes', 'Crucifères et feuilles'],
  ['racines', 'Racines'],
];

/** Suivi des images dessinées, hors de React (rien ne se redessine pour un compteur). */
interface Suivi {
  rendus: number;
  premiere: boolean;
  /** Semaine dont les couleurs viennent d'être posées : marquée à l'image suivante. */
  semaineEnAttente: number | null;
  glisse: boolean;
  dernier: number;
  intervalles: number[];
}

// ── Scène three (fiber) ──────────────────────────────────────────────────────────────────────

/** Dessine l'image (priorité 1 : fiber nous laisse le rendu), puis compte. */
function Rendu({ surImage }: { readonly surImage: (gl: RootState['gl']) => void }) {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera);
    surImage(gl);
  }, 1);
  return null;
}

const temporaire = new Object3D();

/** Les socles : un seul InstancedMesh, posé une fois. */
function Socles({ scene }: { readonly scene: Scene }) {
  const maillage = useRef<InstancedMesh>(null);
  const invalider = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = maillage.current;
    if (m === null) return;
    scene.socles.forEach((s, i) => {
      temporaire.position.set(s.x, -EPAISSEUR_SOCLE / 2, s.z);
      temporaire.scale.set(s.largeur, EPAISSEUR_SOCLE, s.profondeur);
      temporaire.updateMatrix();
      m.setMatrixAt(i, temporaire.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    invalider();
  }, [scene, invalider]);
  return (
    <instancedMesh ref={maillage} args={[undefined, undefined, scene.socles.length]} frustumCulled={false}>
      <boxGeometry />
      <meshLambertMaterial color={COULEURS.secondaire} />
    </instancedMesh>
  );
}

/**
 * Les planches : un seul InstancedMesh. La géométrie se pose quand le plan change ; les couleurs
 * seules changent avec la semaine.
 */
function Volumes({ geometrie, scene, surCouleurs }: { readonly geometrie: Scene; readonly scene: Scene; readonly surCouleurs: (semaine: number) => void }) {
  const maillage = useRef<InstancedMesh>(null);
  const invalider = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const m = maillage.current;
    if (m === null) return;
    geometrie.volumes.forEach((v, i) => {
      temporaire.position.set(v.x, v.hauteur / 2, v.z);
      temporaire.scale.set(v.longueur, v.hauteur, v.largeur);
      temporaire.updateMatrix();
      m.setMatrixAt(i, temporaire.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    invalider();
  }, [geometrie, invalider]);
  useLayoutEffect(() => {
    const m = maillage.current;
    if (m === null) return;
    const couleur = new Color();
    scene.volumes.forEach((v, i) => {
      m.setColorAt(i, couleur.set(v.couleur));
    });
    if (m.instanceColor !== null) m.instanceColor.needsUpdate = true;
    surCouleurs(scene.semaine);
    invalider();
  }, [scene, surCouleurs, invalider]);
  return (
    <instancedMesh ref={maillage} args={[undefined, undefined, geometrie.volumes.length]} frustumCulled={false}>
      <boxGeometry />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

interface Orbite {
  azimut: number;
  elevation: number;
  distance: number;
}

/**
 * Caméra en orbite autour de la ferme : glissé du pointeur (bouton principal) pour tourner,
 * molette pour s'approcher, flèches du clavier (toile focalisée) aussi. Une image par geste.
 */
function Camera({ rayon, surGlisse }: { readonly rayon: number; readonly surGlisse: (enCours: boolean) => void }) {
  const lireEtat = useThree((s) => s.get);
  const toile = useThree((s) => s.gl.domElement);
  const invalider = useThree((s) => s.invalidate);
  const orbite = useRef<Orbite | null>(null);

  useEffect(() => {
    const champ = (CHAMP_DEGRES * Math.PI) / 180;
    // Le rayon englobe large (diagonale) : la ferme vue de biais remplit la toile à ce recul.
    const distanceDepart = (rayon / Math.tan(champ / 2)) * 0.72;
    const o: Orbite = orbite.current ?? { azimut: AZIMUT_DEPART, elevation: ELEVATION_DEPART, distance: distanceDepart };
    orbite.current = o;
    const placer = () => {
      const { camera } = lireEtat();
      const horizontal = o.distance * Math.cos(o.elevation);
      camera.position.set(horizontal * Math.sin(o.azimut), o.distance * Math.sin(o.elevation), horizontal * Math.cos(o.azimut));
      camera.lookAt(0, 0, 0);
      camera.near = Math.max(0.1, o.distance / 100);
      camera.far = o.distance * 4 + rayon * 2;
      camera.updateProjectionMatrix();
      invalider();
    };
    placer();

    let pointeur: { id: number; x: number; y: number } | null = null;
    const bas = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      pointeur = { id: e.pointerId, x: e.clientX, y: e.clientY };
      toile.setPointerCapture(e.pointerId);
      surGlisse(true);
    };
    const bouge = (e: PointerEvent) => {
      if (pointeur?.id !== e.pointerId) return;
      o.azimut -= (e.clientX - pointeur.x) * RADIANS_PAR_PX;
      o.elevation = Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, o.elevation + (e.clientY - pointeur.y) * RADIANS_PAR_PX));
      pointeur = { id: e.pointerId, x: e.clientX, y: e.clientY };
      placer();
    };
    const haut = (e: PointerEvent) => {
      if (pointeur?.id !== e.pointerId) return;
      pointeur = null;
      surGlisse(false);
    };
    const molette = (e: WheelEvent) => {
      e.preventDefault();
      o.distance = Math.min(distanceDepart * 3, Math.max(distanceDepart * 0.15, o.distance * Math.exp(e.deltaY * 0.001)));
      placer();
    };
    const touche = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          o.azimut += PAS_CLAVIER;
          break;
        case 'ArrowRight':
          o.azimut -= PAS_CLAVIER;
          break;
        case 'ArrowUp':
          o.elevation = Math.min(ELEVATION_MAX, o.elevation + PAS_CLAVIER);
          break;
        case 'ArrowDown':
          o.elevation = Math.max(ELEVATION_MIN, o.elevation - PAS_CLAVIER);
          break;
        case '+':
          o.distance = Math.max(distanceDepart * 0.15, o.distance * 0.85);
          break;
        case '-':
          o.distance = Math.min(distanceDepart * 3, o.distance / 0.85);
          break;
        default:
          return;
      }
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
      toile.removeEventListener('pointerdown', bas);
      toile.removeEventListener('pointermove', bouge);
      toile.removeEventListener('pointerup', haut);
      toile.removeEventListener('pointercancel', haut);
      toile.removeEventListener('wheel', molette);
      toile.removeEventListener('keydown', touche);
    };
  }, [lireEtat, toile, invalider, rayon, surGlisse]);
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

const ElementListe = memo(function ElementListe({ id, code, culture, couleur }: { readonly id: string; readonly code: string; readonly culture: string | null; readonly couleur: string }) {
  return (
    <li data-testid="element-liste-3d" data-id={id} data-culture={culture ?? ''} className={culture === null ? 'plan3d-vide' : undefined}>
      <i aria-hidden="true" style={{ background: couleur }} />
      <span className="plan3d-code">{code}</span>
      <span className="plan3d-culture">{culture ?? 'vide'}</span>
    </li>
  );
});

// ── Vue ──────────────────────────────────────────────────────────────────────────────────────

/** Rayon de la ferme (m de scène) : la moitié de la diagonale de l'ensemble des socles. */
function rayonDe(scene: Scene): number {
  let r = 1;
  for (const s of scene.socles) {
    r = Math.max(r, Math.hypot(Math.abs(s.x) + s.largeur / 2, Math.abs(s.z) + s.profondeur / 2));
  }
  return r;
}

export function Vue3d({ plan, surRetour, surEchec }: ProprietesVue3d) {
  const nbSemaines = plan.semaines.length;
  const [semaine, setSemaine] = useState(() => Math.min(Math.max(0, nbSemaines - 1), plan.semaineCourante ?? 0));
  const [prete, setPrete] = useState(false);
  const idCurseur = useId();
  const idListe = useId();

  // Géométrie : posée par le plan seul (la semaine ne change que les couleurs).
  const geometrie = useMemo(() => (nbSemaines === 0 ? null : versScene(plan, 0)), [plan, nbSemaines]);
  const semaineBornee = Math.min(semaine, Math.max(0, nbSemaines - 1));
  const scene = useMemo(() => (nbSemaines === 0 ? null : versScene(plan, semaineBornee)), [plan, semaineBornee, nbSemaines]);
  const rayon = useMemo(() => (geometrie === null ? 1 : rayonDe(geometrie)), [geometrie]);

  const suivi = useRef<Suivi>({ rendus: 0, premiere: false, semaineEnAttente: null, glisse: false, dernier: -1, intervalles: [] });
  const surEchecRef = useRef(surEchec);
  useLayoutEffect(() => {
    surEchecRef.current = surEchec;
  }, [surEchec]);

  const surImage = useCallback((gl: RootState['gl']) => {
    const s = suivi.current;
    s.rendus += 1;
    gl.domElement.dataset.rendus = String(s.rendus);
    if (!s.premiere) {
      s.premiere = true;
      performance.mark(MARQUE_AFFICHEE);
      setPrete(true);
    }
    if (s.semaineEnAttente !== null) {
      performance.mark(MARQUE_SEMAINE, { detail: { semaine: s.semaineEnAttente } });
      s.semaineEnAttente = null;
    }
    if (s.glisse) {
      const t = performance.now();
      if (s.dernier >= 0) s.intervalles.push(t - s.dernier);
      s.dernier = t;
    }
  }, []);

  // Couleurs de la semaine posées : la marque « semaine » suit à l'image suivante (pas la première).
  const couleursPosees = useRef(false);
  const surCouleurs = useCallback((s: number) => {
    if (couleursPosees.current) suivi.current.semaineEnAttente = s;
    couleursPosees.current = true;
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
  const toileRef = useRef<HTMLCanvasElement>(null);
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

  const nbVolumes = geometrie?.volumes.length ?? 0;
  const libelleCourant = plan.semaines[semaineBornee]?.libelle ?? '';
  const description = `Vue 3D des planches, semaine ${libelleCourant}. Glisser pour tourner, molette pour s’approcher ; au clavier, flèches et + ou -.`;

  // La scène, rendue dans la racine fiber à chaque rendu de la vue (comme le fait <Canvas>).
  useLayoutEffect(() => {
    if (!configuree || geometrie === null || scene === null) return;
    racine.current?.render(
      <GardeErreur surErreur={surErreur}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[rayon * 0.3, rayon, rayon * 0.5]} intensity={1.8} />
        <Socles scene={geometrie} />
        <Volumes key={nbVolumes} geometrie={geometrie} scene={scene} surCouleurs={surCouleurs} />
        <Camera rayon={rayon} surGlisse={surGlisse} />
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
      </div>
      <div className="plan3d-corps">
        <div className="plan3d-scene">
          <canvas ref={toileRef} data-testid="toile-3d" data-volumes={nbVolumes} data-rendus={0} role="img" aria-label={description} tabIndex={0} className="plan3d-toile" />
          <ul className="plan-legende plan3d-legende" aria-label="Légende de la vue 3D">
            {LEGENDE.map(([cle, nom]) => (
              <li key={cle}>
                <i style={{ background: FAMILLES[cle].bande }} />
                {nom}
              </li>
            ))}
            <li>
              <i style={{ background: COULEUR_NEUTRE }} />
              Vide ou autre
            </li>
          </ul>
        </div>
        <aside className="plan3d-cote">
          <h2 id={idListe} className="plan3d-titre-liste">
            Planches et cultures, {libelle}
          </h2>
          <ul data-testid="liste-3d" role="list" aria-labelledby={idListe} className="plan3d-liste">
            {scene?.volumes.map((v) => <ElementListe key={v.id} id={v.id} code={v.code} culture={v.culture} couleur={v.couleur} />)}
          </ul>
        </aside>
      </div>
    </section>
  );
}
