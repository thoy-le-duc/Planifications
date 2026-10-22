/**
 * Vue 3D (T58, règle 3) — les serres et tunnels sur le jumeau : un repère par abri (petit bouton
 * HTML posé sur la toile, replacé à chaque image par la vue avec `placerPastilles`), qui dit s'il
 * est ouvert et porte la pastille du chauffage et du voile ; un tap ouvre sa fiche, où chaque
 * équipement se change en un tap (mêmes boutons, mêmes événements et même « Annuler » que le
 * panneau d'Aujourd'hui) ; le filtre « Serres » montre en couleur vive tout ce qui est ouvert.
 * La vue reçoit, par `surEtat`, de quoi dessiner les ouvrants relevés et la porte ouverte
 * (`poser`) et colorer le filtre (`colorer`). Chargé à la demande par la vue, par le relais
 * ./abris-differees.ts, à part du morceau 3D (ni three, ni fiber ici). Contrat :
 * ./test/contrat-abris.ts.
 *
 * Lecture seule de la base, sauf le tap d'un équipement (un événement `etat_abri`, hors ligne).
 */
import { useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { comparerAbris, etatsDesZones } from '@planif/core/abris';
import type { PorteDonnees } from '@planif/sync';
import { BoutonEquipement, jourDuTelephone, StatutEtat, useAbris, useChangerEtat } from '../aujourdhui/serres-commun.tsx';
import { COULEURS_SERRES_3D } from '../../ui/jetons.ts';
import { colorerSerres, etatsBatiments, poserOuvertures, type EtatBatiment } from './abris.ts';
import type { BatimentScene, Scene, SceneFiltree } from './scene.ts';
import '../aujourdhui/serres.css';
import './abris3d.css';

export interface EtatAbris3d {
  /** Points des repères, dans l'ordre des boutons de la couche (pour `placerPastilles`). */
  readonly reperes: readonly { readonly pastille: { readonly x: number; readonly z: number } }[];
  readonly etats: ReadonlyMap<string, EtatBatiment>;
  /** Filtre « Serres » actif. */
  readonly filtre: boolean;
  /** Pose les ouvertures des abris sur la scène (ouvrants relevés, porte ouverte). */
  readonly poser: (scene: Scene) => Scene;
  /** Filtre « Serres » sur la scène filtrée ; filtre éteint : la scène reçue elle-même. */
  readonly colorer: (filtree: SceneFiltree) => SceneFiltree;
}

export interface ProprietesAbris3d {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly batiments: readonly BatimentScene[];
  readonly couche: RefObject<HTMLDivElement | null>;
  readonly surEtat: (etat: EtatAbris3d) => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

const horloge = (): Date => new Date();

const STYLE_OUVERT = { background: COULEURS_SERRES_3D.ouverte, color: COULEURS_SERRES_3D.texte, minHeight: 44, minWidth: 44 } as const;
const STYLE_FERME = { background: COULEURS_SERRES_3D.fermee, color: COULEURS_SERRES_3D.texte, minHeight: 44, minWidth: 44 } as const;

export function Abris3d({ porte, fermeId, batiments, couche, surEtat, aujourdhui = jourDuTelephone, maintenant = horloge }: ProprietesAbris3d): ReactElement {
  const { zones, evenements } = useAbris(porte, fermeId);
  const { enregistre, occupe, erreur, changer, annuler } = useChangerEtat(porte, aujourdhui);
  const [filtre, setFiltre] = useState(false);
  const [choisi, setChoisi] = useState<string | null>(null);

  // L'instant est relu à chaque changement du journal : un tap écrit maintenant est déjà passé.
  const { instant, etats } = useMemo(() => {
    const i = maintenant().toISOString();
    return { instant: i, etats: etatsBatiments(batiments, zones ?? [], evenements ?? [], i) };
  }, [batiments, zones, evenements, maintenant]);
  /** Repères dans l'ordre des noms de zone (ordre naturel), puis du bâtiment. */
  const reperes = useMemo(
    () =>
      batiments
        .flatMap((b) => {
          const e = etats.get(b.id);
          return e === undefined ? [] : [{ b, e }];
        })
        .sort((a, c) => comparerAbris({ nom: a.e.nom, id: a.e.zoneId }, { nom: c.e.nom, id: c.e.zoneId }) || (a.b.id < c.b.id ? -1 : a.b.id > c.b.id ? 1 : 0)),
    [batiments, etats],
  );

  useEffect(() => {
    surEtat({
      reperes: reperes.map(({ b }) => ({ pastille: { x: b.x, z: b.z } })),
      etats,
      filtre,
      poser: (scene) => poserOuvertures(scene, etats),
      colorer: (f) => colorerSerres(f, etats, filtre),
    });
  }, [surEtat, reperes, etats, filtre]);

  const repereChoisi = choisi === null ? undefined : reperes.find(({ b }) => b.id === choisi);
  const zoneChoisie = repereChoisi === undefined ? undefined : zones?.find((z) => z.id === repereChoisi.e.zoneId);
  const equipements = useMemo(
    () => (zoneChoisie === undefined || evenements === null ? [] : (etatsDesZones(evenements, [zoneChoisie], instant).get(zoneChoisie.id) ?? [])),
    [zoneChoisie, evenements, instant],
  );

  return (
    <>
      <div ref={couche} data-testid="abris-3d" className="plan3d-abris">
        {reperes.map(({ b, e }) => (
          <button
            key={b.id}
            type="button"
            data-testid="repere-abri-3d"
            data-batiment={b.id}
            data-zone={e.zoneId}
            data-ouvert={e.ouvert ? 'oui' : 'non'}
            data-ouverts={e.ouverts.join(',')}
            data-chauffage={e.ouvertures.chauffage ? 'oui' : 'non'}
            data-voile={e.ouvertures.voile ? 'oui' : 'non'}
            aria-label={`${e.nom} : ${e.ouvert ? 'ouverte' : 'fermée'}`}
            aria-expanded={choisi === b.id}
            className={choisi === b.id ? 'plan3d-repere-abri plan3d-repere-abri-choisi' : 'plan3d-repere-abri'}
            style={e.ouvert ? STYLE_OUVERT : STYLE_FERME}
            onClick={() => {
              setChoisi((c) => (c === b.id ? null : b.id));
            }}
          >
            {e.nom}
            {e.ouvertures.chauffage && <i aria-hidden="true" className="plan3d-pastille-chauffage" style={{ background: COULEURS_SERRES_3D.chauffage }} />}
            {e.ouvertures.voile && <i aria-hidden="true" className="plan3d-pastille-voile" style={{ background: COULEURS_SERRES_3D.voile }} />}
          </button>
        ))}
      </div>
      <div className="plan3d-abris-outils">
        <button
          type="button"
          data-testid="filtre-serres-3d"
          aria-pressed={filtre}
          className="plan3d-bouton"
          onClick={() => {
            setFiltre((f) => !f);
          }}
        >
          Serres
        </button>
        {filtre && (
          <ul data-testid="legende-serres-3d" role="list" aria-label="État des serres" className="plan3d-legende-serres">
            <li>
              <i aria-hidden="true" style={{ background: COULEURS_SERRES_3D.ouverte }} />
              Ouverte
            </li>
            <li>
              <i aria-hidden="true" style={{ background: COULEURS_SERRES_3D.fermee }} />
              Fermée
            </li>
          </ul>
        )}
      </div>
      {repereChoisi !== undefined && zoneChoisie !== undefined && (
        <div role="dialog" aria-label={zoneChoisie.nom} data-testid="fiche-abri-3d" className="plan3d-fiche-abri">
          <h3 className="serres-nom">{zoneChoisie.nom}</h3>
          <div className="serres-equipements">
            {equipements.map(({ equipement, etat }) => (
              <BoutonEquipement key={equipement} zone={zoneChoisie} equipement={equipement} etat={etat} occupe={occupe} surTap={(z, eq, et) => void changer(z, eq, et)} />
            ))}
          </div>
          <button
            type="button"
            className="plan3d-bouton"
            onClick={() => {
              setChoisi(null);
            }}
          >
            Fermer
          </button>
        </div>
      )}
      <div className="plan3d-abris-statut">
        <StatutEtat enregistre={enregistre} erreur={erreur} occupe={occupe} surAnnuler={() => void annuler()} />
      </div>
    </>
  );
}

export default Abris3d;
