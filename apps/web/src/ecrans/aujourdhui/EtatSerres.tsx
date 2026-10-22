/**
 * T58 — panneau « État des serres » (docs/backlog/T58-etat-serres.md, règle 2) : serre par serre,
 * un bouton par équipement déclaré (ouvrants, portes, chauffage, voile) qui dit son état courant ;
 * un tap le change (un événement `etat_abri` du journal, hors ligne), « Annuler » le défait. Pas
 * d'écran de confirmation : saisie manuelle d'un geste, comme l'irrigation. Chargé au premier tap
 * de « Serres » (ou de « Voir les serres »), à part du morceau de l'écran Aujourd'hui. Contrat :
 * ./test/contrat-etat-serres.ts.
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { etatsDesZones } from '@planif/core/abris';
import type { PorteDonnees } from '@planif/sync';
import { abrisDeclares, BoutonEquipement, jourDuTelephone, StatutEtat, useAbris, useChangerEtat } from './serres-commun.tsx';
import './serres.css';

export interface ProprietesEtatSerres {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

const horloge = (): Date => new Date();

export function EtatSerres({ porte, fermeId, surFermer, aujourdhui = jourDuTelephone, maintenant = horloge }: ProprietesEtatSerres): ReactElement {
  const { zones, evenements } = useAbris(porte, fermeId);
  const { enregistre, occupe, erreur, changer, annuler } = useChangerEtat(porte, aujourdhui);
  const abris = useMemo(() => (zones === null ? [] : abrisDeclares(zones)), [zones]);
  // L'instant est relu à chaque changement du journal : un tap écrit maintenant est déjà passé.
  const etats = useMemo(() => etatsDesZones(evenements ?? [], abris, maintenant().toISOString()), [evenements, abris, maintenant]);
  const titre = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titre.current?.focus();
  }, []);

  return (
    <div
      className="serres-voile"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          surFermer();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="État des serres" data-testid="etat-serres" className="serres-feuille">
        <h2 ref={titre} tabIndex={-1} className="serres-titre">
          État des serres
        </h2>
        {zones !== null && abris.length === 0 && <p>Aucune serre ni tunnel avec des équipements : déclarez vos abris dans Ferme, « Saisons, zones et planches ».</p>}
        {abris.map((zone) => (
          <section key={zone.id} data-testid="serre-etat" data-zone={zone.id} aria-label={zone.nom} className="serres-zone">
            <h3 className="serres-nom">{zone.nom}</h3>
            <div className="serres-equipements">
              {(etats.get(zone.id) ?? []).map(({ equipement, etat }) => (
                <BoutonEquipement key={equipement} zone={zone} equipement={equipement} etat={etat} occupe={occupe} surTap={(z, eq, et) => void changer(z, eq, et)} />
              ))}
            </div>
          </section>
        ))}
        <StatutEtat enregistre={enregistre} erreur={erreur} occupe={occupe} surAnnuler={() => void annuler()} />
        <button type="button" className="serres-fermer" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </div>
  );
}
