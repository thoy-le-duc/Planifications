/**
 * Vue 3D (T57) — les vannes d'irrigation sur le jumeau : un repère numéroté par vanne (petit
 * bouton HTML posé sur la toile, replacé à chaque image par la vue avec `placerPastilles` : aucun
 * appel de dessin de plus), un tap met en évidence ses planches et ouvre sa fiche (« V12 — arrose
 * P3, P4, P5 — dernière irrigation : aujourd’hui 7 h, 20 min »), le filtre « Irrigation » colore les
 * planches selon leur dernière irrigation, et « Irrigation » depuis la fiche note une irrigation
 * hors ligne. Chargé à la demande par la vue, à part du morceau 3D (ni three, ni fiber ici).
 * Contrat : ./test/contrat-vannes.ts.
 *
 * Lecture seule de la base, sauf la saisie d'irrigation (../aujourdhui/SaisieIrrigation.tsx).
 * L'état ouvert ou fermé en direct des vannes (Modbus) n'est pas ici : c'est la phase 3.
 */
import { useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { derniereIrrigationDe, dernieresIrrigations, type Irrigation, type LienVanne } from '@planif/core/irrigation';
import type { PorteDonnees } from '@planif/sync';
import { enVigueur } from '../aujourdhui/index.ts';
import { SaisieIrrigation } from '../aujourdhui/SaisieIrrigation.tsx';
import type { SceneFiltree, VolumeScene } from './scene.ts';
import { classesIrrigation, colorer, COULEURS_IRRIGATION, phraseVanne, reperesVannes, type VanneLue } from './vannes.ts';
import { COULEURS_REPERE_VANNE } from '../../ui/jetons.ts';
import './vannes3d.css';

export interface EtatVannes3d {
  /** Points des repères, dans l'ordre des boutons de la couche (pour `placerPastilles`). */
  readonly reperes: readonly { readonly pastille: { readonly x: number; readonly z: number } }[];
  /** Coloration des planches : filtre « Irrigation » et planches de la vanne choisie. */
  readonly colorer: (filtree: SceneFiltree) => SceneFiltree;
  /** Planches mises en évidence (vanne choisie), ou nul. */
  readonly evidence: ReadonlySet<string> | null;
  /** Filtre « Irrigation » actif. */
  readonly irrigation: boolean;
}

export interface ProprietesVannes3d {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Volumes de la scène (géométrie de la vue). */
  readonly volumes: readonly VolumeScene[];
  readonly couche: RefObject<HTMLDivElement | null>;
  readonly surEtat: (etat: EtatVannes3d) => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

type L = Readonly<Record<string, unknown>>;
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const nbOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const deux = (n: number) => String(n).padStart(2, '0');
function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

interface IrrigationLue extends Irrigation {
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
}

const STYLE_REPERE = { background: COULEURS_REPERE_VANNE.fond, color: COULEURS_REPERE_VANNE.texte } as const;

const LEGENDE: readonly (readonly [keyof typeof COULEURS_IRRIGATION, string])[] = [
  ['aujourdhui', 'Aujourd’hui'],
  ['hier', 'Hier'],
  ['ancienne', 'Plus ancienne'],
  ['jamais', 'Jamais'],
];

export function Vannes3d({ porte, fermeId, volumes, couche, surEtat, aujourdhui = jourDuTelephone }: ProprietesVannes3d): ReactElement {
  const [jour] = useState(aujourdhui);
  const [vannes, setVannes] = useState<readonly VanneLue[]>([]);
  const [liens, setLiens] = useState<readonly LienVanne[]>([]);
  const [irrigations, setIrrigations] = useState<readonly IrrigationLue[]>([]);
  const [choisie, setChoisie] = useState<string | null>(null);
  const [filtre, setFiltre] = useState(false);
  const [saisie, setSaisie] = useState<string | null>(null);

  useEffect(
    () =>
      porte.surveiller<VanneLue>(
        {
          sql: 'SELECT id, numero_vanne, nom, placement_x_m, placement_y_m FROM secteur_irrigation WHERE ferme_id = ? AND supprime_le IS NULL',
          parametres: [fermeId],
          tables: ['secteur_irrigation'],
          convertir: (l: L) => ({ id: txt(l.id), numero: nbOuNul(l.numero_vanne) ?? 0, nom: txt(l.nom), x: nbOuNul(l.placement_x_m), y: nbOuNul(l.placement_y_m) }),
        },
        setVannes,
      ),
    [porte, fermeId],
  );
  useEffect(
    () =>
      porte.surveiller<LienVanne>(
        {
          sql: 'SELECT id, secteur_irrigation_id, emplacement_id, du, au FROM secteur_emplacement WHERE ferme_id = ? AND supprime_le IS NULL',
          parametres: [fermeId],
          tables: ['secteur_emplacement'],
          convertir: (l: L) => ({ id: txt(l.id), secteurId: txt(l.secteur_irrigation_id), emplacementId: txt(l.emplacement_id), du: txt(l.du), au: typeof l.au === 'string' ? l.au : null }),
        },
        setLiens,
      ),
    [porte, fermeId],
  );
  useEffect(
    () =>
      porte.surveiller<IrrigationLue>(
        {
          // Seuls la vanne et la durée sont lus du détail ; les chaînes (corrections, annulations) sont jugées par `enVigueur`.
          sql: `SELECT id, date, horodatage, remplace_sorte, remplace_evenement_id,
                       json_extract(detail, '$.secteurIrrigationId') AS secteur, json_extract(detail, '$.dureeMinutes') AS duree
                FROM evenement WHERE ferme_id = ? AND type = 'irrigation' AND json_valid(detail)`,
          parametres: [fermeId],
          tables: ['evenement'],
          convertir: (l: L) => {
            const sorte = l.remplace_sorte;
            return {
              id: txt(l.id),
              secteurId: txt(l.secteur).toLowerCase(),
              date: txt(l.date),
              horodatage: txt(l.horodatage),
              dureeMinutes: nbOuNul(l.duree) ?? 0,
              remplaceSorte: sorte === 'correction' || sorte === 'annulation' ? sorte : null,
              remplaceEvenementId: typeof l.remplace_evenement_id === 'string' ? l.remplace_evenement_id : null,
            };
          },
        },
        setIrrigations,
      ),
    [porte, fermeId],
  );

  const reperes = useMemo(() => reperesVannes(vannes, liens, volumes, jour), [vannes, liens, volumes, jour]);
  const enVigueurs = useMemo(() => enVigueur(irrigations), [irrigations]);
  const dernieres = useMemo(() => dernieresIrrigations(enVigueurs, liens), [enVigueurs, liens]);
  const classes = useMemo(() => (filtre ? classesIrrigation(volumes, dernieres, jour) : null), [filtre, volumes, dernieres, jour]);
  const repereChoisi = choisie === null ? undefined : reperes.find((r) => r.id === choisie);
  const evidence = useMemo(() => (repereChoisi === undefined ? null : new Set(repereChoisi.planches)), [repereChoisi]);

  useEffect(() => {
    surEtat({
      reperes: reperes.map((r) => ({ pastille: { x: r.x, z: r.z } })),
      colorer: (f) => colorer(f, { irrigation: classes, evidence }),
      evidence,
      irrigation: filtre,
    });
  }, [surEtat, reperes, classes, evidence, filtre]);

  return (
    <>
      <div ref={couche} data-testid="vannes-3d" className="plan3d-vannes">
        {reperes.map((r) => (
          <button
            key={r.id}
            type="button"
            data-testid="repere-vanne-3d"
            data-vanne={r.id}
            aria-label={`Vanne ${r.nom}`}
            aria-pressed={choisie === r.id}
            className={choisie === r.id ? 'plan3d-repere-vanne plan3d-repere-vanne-choisi' : 'plan3d-repere-vanne'}
            style={STYLE_REPERE}
            onClick={() => {
              setChoisie((c) => (c === r.id ? null : r.id));
            }}
          >
            {r.nom}
          </button>
        ))}
      </div>
      <div className="plan3d-vannes-outils">
        <button
          type="button"
          data-testid="filtre-irrigation-3d"
          aria-pressed={filtre}
          className="plan3d-bouton"
          onClick={() => {
            setFiltre((f) => !f);
          }}
        >
          Irrigation
        </button>
        {filtre && (
          <ul data-testid="legende-irrigation-3d" role="list" aria-label="Dernière irrigation" className="plan3d-legende-irrigation">
            {LEGENDE.map(([cle, libelle]) => (
              <li key={cle}>
                <i aria-hidden="true" style={{ background: COULEURS_IRRIGATION[cle] }} />
                {libelle}
              </li>
            ))}
          </ul>
        )}
      </div>
      {repereChoisi !== undefined && (
        <div role="dialog" aria-label={repereChoisi.nom} data-testid="fiche-vanne-3d" className="plan3d-fiche-vanne">
          <p>{phraseVanne(repereChoisi, derniereIrrigationDe(enVigueurs, repereChoisi.id), jour)}</p>
          <div className="plan3d-fiche-vanne-actions">
            <button
              type="button"
              data-testid="irriguer-3d"
              className="plan3d-bouton plan3d-bouton-principal"
              onClick={() => {
                setSaisie(repereChoisi.id);
              }}
            >
              Irrigation
            </button>
            <button
              type="button"
              className="plan3d-bouton"
              onClick={() => {
                setChoisie(null);
              }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
      {saisie !== null && (
        <SaisieIrrigation
          porte={porte}
          fermeId={fermeId}
          vanneId={saisie}
          aujourdhui={() => jour}
          surFermer={() => {
            setSaisie(null);
          }}
        />
      )}
    </>
  );
}

export default Vannes3d;
