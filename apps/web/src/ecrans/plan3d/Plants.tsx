/**
 * Vue 3D (T32b) — les plants stylisés, côté fiber : UN InstancedMesh par forme présente (7 au plus,
 * géométries partagées de ./geometries-plants.ts), plus UN seul pour les tuteurs, les poteaux (pergola du
 * kiwi, pieds de la gouttière hors-sol, T37b), les fruits et les balises « à récolter » (T32e : la même
 * double pyramide de 1 m, étirée et teintée par instance ; un seul appel de dessin pour les quatre, les
 * garde-fous de T29b sont tenus au téléphone). Ce que dessine chaque plant (forme, hauteur du jour, positions) vient de
 * ./plants.ts, qui lit la croissance de T32a : aucun calcul de croissance ici. Le travail impératif (niveau
 * de détail, pose des instances) est dans ./plants-rendu.ts.
 *
 * Niveau de détail : avant chaque image, la caméra décide planche par planche si ses plants se voient ;
 * sinon leurs instances sont RETIRÉES (le compte de l'InstancedMesh baisse) et la planche entière
 * devient un volume à la hauteur du feuillage, à la couleur du filtre. Rendu à la demande : rien ne
 * tourne hors des images que la vue demande.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import type { InstancedMesh } from 'three';
import type { FormePlant } from '@planif/core/croissance';
import { seRecolte } from './recolte.ts';
import { capacite, type BilanPlants, type RenduPlants } from './plants-rendu.ts';
import { FORMES, FRUITS_MAX_TOTAL, instancesParForme, piedsDeGouttiere, PLANTS_MAX_TOTAL, type PlantsPlanche } from './plants.ts';
import type { Scene, SceneFiltree } from './scene.ts';

export function Plants({
  scene,
  filtree,
  plants,
  rendu,
  surBilan,
  appelsHorsPlants = 0,
}: {
  readonly scene: Scene;
  readonly filtree: SceneFiltree;
  /** Une entrée par volume de la scène, dans le même ordre. */
  readonly plants: readonly (PlantsPlanche | null)[];
  readonly rendu: RenduPlants;
  readonly surBilan: (b: BilanPlants) => void;
  /** Appels de dessin de la ferme sans ses plants (T37b) : au téléphone, les formes en détail tiennent dans le reste. */
  readonly appelsHorsPlants?: number;
}) {
  const invalider = useThree((s) => s.invalidate);
  const lireEtat = useThree((s) => s.get);
  const besoin = useMemo(() => {
    const parForme = new Map<FormePlant, number>();
    for (const g of instancesParForme(plants)) parForme.set(g.forme, Math.min(PLANTS_MAX_TOTAL, g.nombreDePlants));
    return parForme;
  }, [plants]);
  // Poteaux : un par plant de kiwi, des pieds tous les 3 m environ par planche hors-sol.
  const nbPoteaux = useMemo(() => plants.reduce((n, p, i) => n + (p === null ? 0 : (p.structureM > 0 ? Math.min(p.nombre, PLANTS_MAX_TOTAL) : 0) + (p.surelevationM > 0 ? piedsDeGouttiere(scene.volumes[i]?.longueur ?? 0) : 0)), 0), [plants, scene]);
  const nbTuteurs = useMemo(() => plants.reduce((n, p) => n + (p !== null && p.forme === 'erige-tuteure' && p.echelleVerticale > 0 ? p.nombre : 0), 0), [plants]);
  // Tuteurs, poteaux (T37b), fruits et balises (T32e) : un seul maillage (une seule double pyramide), de la taille de ce qui peut s'y poser.
  const nbAccessoires = useMemo(() => {
    const fruits = Math.min(FRUITS_MAX_TOTAL, plants.reduce((n, p) => n + (p === null ? 0 : p.nombre * p.fruitsParPlant), 0));
    return Math.min(nbTuteurs, PLANTS_MAX_TOTAL) + nbPoteaux + fruits + plants.reduce((n, p) => n + (p !== null && seRecolte(p) ? 1 : 0), 0);
  }, [plants, nbTuteurs, nbPoteaux]);
  useEffect(
    () => () => {
      rendu.liberer();
    },
    [rendu],
  );

  // La semaine, le plan, un filtre ou les plants ont changé : le détail est refait, tous les plants visibles sont reposés.
  useLayoutEffect(() => {
    rendu.fixerAppelsHorsPlants(appelsHorsPlants);
    const { camera, size } = lireEtat();
    rendu.choisirDetail(scene, plants, camera.position.x, camera.position.y, camera.position.z, size.height, size.width);
    surBilan(rendu.poser(scene, filtree, plants));
    invalider();
  }, [rendu, scene, filtree, plants, besoin, nbAccessoires, appelsHorsPlants, lireEtat, invalider, surBilan]);

  // Avant chaque image (après le vol de la caméra, avant le dessin) : le détail change-t-il ?
  useFrame(({ camera, size }) => {
    if (rendu.choisirDetail(scene, plants, camera.position.x, camera.position.y, camera.position.z, size.height, size.width)) surBilan(rendu.poser(scene, filtree, plants));
    // Les balises grandissent de loin pour rester lisibles : reposées seulement quand un cran est franchi.
    else rendu.ajusterBalises();
  }, 0.5);

  return (
    <>
      {FORMES.map((forme) => {
        const n = besoin.get(forme);
        if (n === undefined) return null;
        return (
          <instancedMesh
            key={`${forme}${String(capacite(n))}`}
            ref={(m: InstancedMesh | null) => {
              rendu.lierMaillage(forme, m);
            }}
            args={[rendu.geometrie(forme), undefined, capacite(n)]}
            frustumCulled={false}
            count={0}
          >
            <meshLambertMaterial vertexColors />
          </instancedMesh>
        );
      })}
      {nbAccessoires > 0 && (
        <instancedMesh
          key={`accessoires${String(capacite(nbAccessoires))}`}
          ref={(m: InstancedMesh | null) => {
            rendu.lierTuteurs(m);
            rendu.lierPoteaux(m);
            rendu.lierFruits(m);
            rendu.lierBalises(m);
          }}
          args={[rendu.geometrieFruit(), undefined, capacite(nbAccessoires)]}
          frustumCulled={false}
          count={0}
        >
          <meshLambertMaterial vertexColors />
        </instancedMesh>
      )}
    </>
  );
}
