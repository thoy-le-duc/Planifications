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
 *
 * T55 : la même couche porte, après les vannes, les repères « Ne pas récolter » des planches sous
 * délai avant récolte à la date du curseur de la 3D (./Dar3d.tsx) ; `colorer` les marque, pour que
 * la vue n'y pose pas la balise « à récolter ». Contrat : ./test/contrat-dar3d.ts.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement, type RefObject } from 'react';
import { derniereIrrigationDe, dernieresIrrigations, type Irrigation, type LienVanne } from '@planif/core/irrigation';
import type { PorteDonnees } from '@planif/sync';
import { enVigueur } from '../aujourdhui/index.ts';
import { SaisieIrrigation } from '../aujourdhui/SaisieIrrigation.tsx';
import type { SceneFiltree, VolumeScene } from './scene.ts';
import { classesIrrigation, colorer, COULEURS_IRRIGATION, phraseVanne, reperesVannes, type VanneLue } from './vannes.ts';
import { COULEURS_REPERE_VANNE } from '../../ui/jetons.ts';
import { BoutonDar, FicheDar, useReperesDar } from './Dar3d.tsx';
import { dateAffichee, marquerDar } from './dar3d.ts';
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
  /** La vue doit appliquer `colorer` : filtre « Irrigation », vanne choisie, ou planche sous délai avant récolte (T55). */
  readonly actif: boolean;
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
  /** T55 : lundi de la semaine choisie au curseur de la 3D (absent : aujourd'hui). */
  readonly jour?: string | undefined;
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

/** Au-delà de ce déplacement (px), un geste parti d'un repère n'est plus un tap : il fait tourner la vue (comme la toile). */
const SEUIL_GESTE_PX = 4;

const STYLE_REPERE = { background: COULEURS_REPERE_VANNE.fond, color: COULEURS_REPERE_VANNE.texte } as const;

const LEGENDE: readonly (readonly [keyof typeof COULEURS_IRRIGATION, string])[] = [
  ['aujourdhui', 'Aujourd’hui'],
  ['hier', 'Hier'],
  ['ancienne', 'Plus ancienne'],
  ['jamais', 'Jamais'],
];

export function Vannes3d({ porte, fermeId, volumes, couche, surEtat, aujourdhui = jourDuTelephone, jour: lundi }: ProprietesVannes3d): ReactElement {
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
  // Les irrigations (tout le journal d'irrigation de la ferme) ne se lisent que si on en a besoin : filtre
  // « Irrigation » ou fiche ouverte. Les lire à l'ouverture de la 3D retardait ses images sur une grande ferme.
  const besoinIrrigations = filtre || choisie !== null;
  useEffect(() => {
    if (!besoinIrrigations) return undefined;
    return porte.surveiller<IrrigationLue>(
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
      );
  }, [porte, fermeId, besoinIrrigations]);

  const reperes = useMemo(() => reperesVannes(vannes, liens, volumes, jour), [vannes, liens, volumes, jour]);
  const enVigueurs = useMemo(() => enVigueur(irrigations), [irrigations]);
  const dernieres = useMemo(() => dernieresIrrigations(enVigueurs, liens), [enVigueurs, liens]);
  const classes = useMemo(() => (filtre ? classesIrrigation(volumes, dernieres, jour) : null), [filtre, volumes, dernieres, jour]);
  const repereChoisi = choisie === null ? undefined : reperes.find((r) => r.id === choisie);
  const evidence = useMemo(() => (repereChoisi === undefined ? null : new Set(repereChoisi.planches)), [repereChoisi]);

  // T55 : planches sous délai avant récolte à la date montrée par le curseur.
  const reperesDar = useReperesDar(porte, fermeId, volumes, dateAffichee(lundi, jour), jour);
  const planchesDar = useMemo(() => new Set(reperesDar.map((r) => r.planche)), [reperesDar]);
  const [darChoisi, setDarChoisi] = useState<string | null>(null);
  const ficheDar = darChoisi === null ? undefined : reperesDar.find((r) => r.planche === darChoisi);

  // Un repère est petit, mais il y en a 60 : un doigt qui glisse depuis un repère fait tourner la vue
  // (le geste est rendu à la toile au-delà de quelques pixels), seul un tap choisit la vanne.
  const geste = useRef<{ readonly id: number; readonly x: number; readonly y: number } | null>(null);
  function commencerGeste(e: PointerEvent<HTMLButtonElement>): void {
    geste.current = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  }
  function suivreGeste(e: PointerEvent<HTMLButtonElement>): void {
    const g = geste.current;
    if (g?.id !== e.pointerId || Math.hypot(e.clientX - g.x, e.clientY - g.y) <= SEUIL_GESTE_PX) return;
    geste.current = null;
    const toile = couche.current?.parentElement?.querySelector('canvas');
    if (toile === null || toile === undefined) return;
    const commun = { pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: true, button: 0, buttons: e.buttons, bubbles: true, cancelable: true };
    toile.dispatchEvent(new window.PointerEvent('pointerdown', { ...commun, clientX: g.x, clientY: g.y }));
    toile.dispatchEvent(new window.PointerEvent('pointermove', { ...commun, clientX: e.clientX, clientY: e.clientY }));
  }
  function finirGeste(): void {
    geste.current = null;
  }

  // Pendant un glissé sur la toile, les repères se retirent (comme pendant le vol, ./vannes3d.css) :
  // soixante boutons replacés à chaque image saccadaient la rotation ; ils reviennent au lâcher.
  useEffect(() => {
    const c = couche.current;
    const toile = c?.parentElement?.querySelector('canvas');
    if (c === null || toile === null || toile === undefined) return undefined;
    const retirer = (): void => {
      c.dataset.glisse = 'oui';
    };
    const remettre = (): void => {
      delete c.dataset.glisse;
    };
    toile.addEventListener('pointerdown', retirer);
    toile.addEventListener('pointerup', remettre);
    toile.addEventListener('pointercancel', remettre);
    return () => {
      toile.removeEventListener('pointerdown', retirer);
      toile.removeEventListener('pointerup', remettre);
      toile.removeEventListener('pointercancel', remettre);
    };
  }, [couche]);

  useEffect(() => {
    surEtat({
      reperes: [...reperes, ...reperesDar].map((r) => ({ pastille: { x: r.x, z: r.z } })),
      colorer: (f) => marquerDar(colorer(f, { irrigation: classes, evidence }), planchesDar),
      evidence,
      irrigation: filtre,
      actif: filtre || evidence !== null || planchesDar.size > 0,
    });
  }, [surEtat, reperes, reperesDar, planchesDar, classes, evidence, filtre]);
  const gesteRepere = { onPointerDown: commencerGeste, onPointerMove: suivreGeste, onPointerUp: finirGeste, onPointerCancel: finirGeste };

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
              setDarChoisi(null);
              setChoisie((c) => (c === r.id ? null : r.id));
            }}
            onPointerDown={commencerGeste}
            onPointerMove={suivreGeste}
            onPointerUp={finirGeste}
            onPointerCancel={finirGeste}
          >
            {r.nom}
          </button>
        ))}
        {reperesDar.map((r) => (
          <BoutonDar
            key={`dar-${r.planche}`}
            repere={r}
            choisi={darChoisi === r.planche}
            surChoisir={(planche) => {
              setChoisie(null);
              setDarChoisi((c) => (c === planche ? null : planche));
            }}
            geste={gesteRepere}
          />
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
      {ficheDar !== undefined && (
        <FicheDar
          repere={ficheDar}
          surFermer={() => {
            setDarChoisi(null);
          }}
        />
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
