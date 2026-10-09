/**
 * Parcours guidé de l'éditeur de placement (T28j, Q36) : quatre étapes déduites de l'état de
 * l'éditeur (origine, bâtiments, pose), rien de stocké. Un tap sur une étape faite ne change que
 * la consigne affichée, jamais la ferme.
 */
import { useId, type ReactElement } from 'react';

export type NumeroEtape = 1 | 2 | 3 | 4;

const ETAPES: readonly { readonly n: NumeroEtape; readonly titre: string; readonly consigne: string }[] = [
  { n: 1, titre: 'Trouver la ferme', consigne: 'Cherchez l’adresse, ou déplacez la carte, jusqu’à voir la ferme sur la photo.' },
  { n: 2, titre: 'Poser le point de départ', consigne: 'Touchez la photo au centre de la ferme, ou « Utiliser la position de la ferme ».' },
  { n: 3, titre: 'Ajouter une serre ou un bâtiment', consigne: 'Touchez « Nouveau bâtiment », remplissez la fiche, puis touchez la photo à son emplacement.' },
  { n: 4, titre: 'Ajuster et tracer les zones', consigne: 'Déplacez, tournez, « Tracer le contour » d’une zone, puis touchez « Enregistrer ».' },
];

export const MESSAGES_ETAPES = {
  sansOrigine: 'Posez d’abord le point de départ (étape 2)',
  poseEnCours: 'Finissez d’abord de poser le bâtiment en cours',
  traceEnCours: 'Finissez d’abord le tracé du contour',
  rienAEnregistrer: 'Rien à enregistrer : aucun changement',
  contourInvalide: 'Corrigez d’abord le contour refusé',
  occupe: 'Enregistrement en cours',
  fiche: 'Donnez un nom et des dimensions positives',
  zoomMax: 'Zoom maximal atteint',
  zoomMin: 'Zoom minimal atteint',
} as const;

/** L'étape où en est la ferme : 1 sans point de départ, 3 sans bâtiment ou pendant la pose, sinon 4. */
export function etapeCourante(origine: boolean, enPose: boolean, batiments: number): NumeroEtape {
  if (!origine) return 1;
  return enPose || batiments === 0 ? 3 : 4;
}

export interface ProprietesBandeau {
  readonly courante: NumeroEtape;
  /** L'étape montrée (une étape faite à laquelle on est revenu, sinon la courante). */
  readonly vue: NumeroEtape;
  readonly surChoix: (n: NumeroEtape) => void;
}

/** Pourquoi une étape à venir n'est pas encore ouverte : le point de départ d'abord, puis l'étape en cours. */
function raisonAVenir(courante: NumeroEtape): string {
  return courante === 1 ? MESSAGES_ETAPES.sansOrigine : `Finissez d’abord l’étape ${String(courante)} : ${ETAPES[courante - 1]?.titre.toLowerCase() ?? ''}`;
}

export function BandeauEtapes({ courante, vue, surChoix }: ProprietesBandeau): ReactElement {
  const idRaison = useId();
  const montree = ETAPES[vue - 1];
  const suivante = ETAPES[vue];
  return (
    <div className="pl-etapes-zone">
      <ol data-testid="etapes-placement" className="pl-etapes" aria-label="Étapes du placement">
        {ETAPES.map(({ n, titre }) => {
          const etat = n < courante ? 'faite' : n === courante ? 'en-cours' : 'a-venir';
          return (
            <li key={n}>
              <button
                type="button"
                data-testid="etape-placement"
                data-etape={n}
                data-etat={etat}
                aria-current={n === vue ? 'step' : undefined}
                aria-disabled={etat === 'a-venir' ? true : undefined}
                aria-describedby={etat === 'a-venir' ? idRaison : undefined}
                className="pl-etape"
                onClick={() => {
                  surChoix(n);
                }}
              >
                <span className="pl-etape-num" aria-hidden="true">
                  {etat === 'faite' ? '✓' : n}
                </span>
                <span>{titre}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p id={idRaison} hidden>
        {raisonAVenir(courante)}
      </p>
      <p data-testid="aide-etape" role="status" className="pl-aide">
        <strong>
          Étape {vue} : {montree?.titre}.
        </strong>{' '}
        {montree?.consigne}
        {suivante !== undefined && ` Ensuite : ${suivante.titre.toLowerCase()}.`}
      </p>
    </div>
  );
}
