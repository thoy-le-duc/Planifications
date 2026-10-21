/**
 * Vue 3D (T61, règles 3 et 4) — « Grelinette — hangar, mur nord » touché dans la fiche du jour :
 * deux repères surlignés sur le jumeau, le lieu de rangement de l'outil et la planche de la tâche
 * (petits boutons HTML posés sur la toile, replacés à chaque image par la vue avec
 * `placerPastilles`, comme les vannes). Aucun calcul de chemin : on montre les deux points.
 * Lecture seule, ferme de la porte seulement, sans réseau. Chargé à la demande par la vue, à part
 * du morceau 3D (ni three, ni fiber ici). Contrat : ./test/contrat-rangement.ts.
 */
import { useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { libelleRangement } from '@planif/core/placement';
import type { PorteDonnees } from '@planif/sync';
import { pointsRangement, type PointScene } from './rangement.ts';
import type { SceneFiltree, VolumeScene } from './scene.ts';
import { colorer } from './vannes.ts';
import './vannes3d.css';

export interface EtatRangement3d {
  /** Points des repères, dans l'ordre des boutons de la couche (pour `placerPastilles`). */
  readonly points: readonly { readonly pastille: PointScene }[];
  /** La planche de la tâche mise en évidence, ou nul. */
  readonly evidence: ReadonlySet<string> | null;
  readonly colorer: (filtree: SceneFiltree) => SceneFiltree;
}

export interface ProprietesRangement3d {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly volumes: readonly VolumeScene[];
  readonly couche: RefObject<HTMLDivElement | null>;
  /** L'outil de la consigne et la planche de la tâche ; null : rien à montrer. */
  readonly cible: { readonly outilId: string; readonly plancheId: string | null } | null;
  readonly surEtat: (etat: EtatRangement3d) => void;
  readonly surFermer?: () => void;
}

type L = Readonly<Record<string, unknown>>;
const txt = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nb = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** L'outil, son lieu (bâtiment ou point du plan) et sa place, lus dans la ferme de la porte, lignes non supprimées. */
interface OutilLu {
  readonly outilId: string;
  readonly nom: string;
  readonly place: string | null;
  readonly batiment: { readonly id: string; readonly nom: string; readonly centre_x_m: number; readonly centre_y_m: number } | null;
  readonly point: { readonly id: string; readonly nom: string; readonly x_m: number; readonly y_m: number } | null;
}

const SQL = `SELECT o.id, o.nom, pr.nom AS place,
    b.id AS b_id, b.nom AS b_nom, b.centre_x_m, b.centre_y_m,
    pp.id AS p_id, pp.nom AS p_nom, pp.x_m, pp.y_m
  FROM outil o
  JOIN lieu_rangement l ON l.id = o.lieu_rangement_id AND l.ferme_id = o.ferme_id AND l.supprime_le IS NULL
  LEFT JOIN batiment b ON b.id = l.batiment_id AND b.ferme_id = o.ferme_id AND b.supprime_le IS NULL
  LEFT JOIN point_plan pp ON pp.id = l.point_plan_id AND pp.ferme_id = o.ferme_id AND pp.supprime_le IS NULL
  LEFT JOIN place_rangement pr ON pr.id = o.place_rangement_id AND pr.ferme_id = o.ferme_id AND pr.supprime_le IS NULL AND pr.lieu_rangement_id = o.lieu_rangement_id
  WHERE o.id = ? AND o.ferme_id = ? AND o.supprime_le IS NULL`;

function outilLu(l: L): OutilLu | null {
  const id = txt(l.id);
  const nom = txt(l.nom);
  if (id === null || nom === null) return null;
  const bId = txt(l.b_id);
  const bNom = txt(l.b_nom);
  const [cx, cy, px, py] = [l.centre_x_m, l.centre_y_m, l.x_m, l.y_m].map(nb);
  const pId = txt(l.p_id);
  const pNom = txt(l.p_nom);
  return {
    outilId: id,
    nom,
    place: txt(l.place),
    batiment: bId !== null && bNom !== null && cx != null && cy != null ? { id: bId, nom: bNom, centre_x_m: cx, centre_y_m: cy } : null,
    point: pId !== null && pNom !== null && px != null && py != null ? { id: pId, nom: pNom, x_m: px, y_m: py } : null,
  };
}

const ETAT_VIDE: EtatRangement3d = { points: [], evidence: null, colorer: (f) => f };

export function Rangement3d({ porte, fermeId, volumes, couche, cible, surEtat, surFermer }: ProprietesRangement3d): ReactElement {
  const outilId = cible?.outilId ?? null;
  const [lu, setLu] = useState<{ readonly outilId: string; readonly outil: OutilLu | null } | null>(null);
  useEffect(() => {
    if (outilId === null) return undefined;
    return porte.surveiller<OutilLu | null>(
      { sql: SQL, parametres: [outilId, fermeId], tables: ['outil', 'lieu_rangement', 'place_rangement', 'batiment', 'point_plan'], convertir: outilLu },
      (lignes) => {
        setLu({ outilId, outil: lignes[0] ?? null });
      },
    );
  }, [porte, fermeId, outilId]);

  const outil = cible !== null && lu?.outilId === cible.outilId ? lu.outil : null;
  const points = useMemo(() => {
    if (cible === null || outil === null) return null;
    const b = outil.batiment;
    const p = outil.point;
    return pointsRangement({
      lieu: { batiment_id: b?.id ?? null, point_plan_id: b === null ? (p?.id ?? null) : null },
      batiments: b === null ? [] : [b],
      pointsPlan: p === null ? [] : [p],
      volumes,
      plancheId: cible.plancheId,
    });
  }, [cible, outil, volumes]);

  const evidence = useMemo(() => (points?.planche == null ? null : new Set([points.planche.id])), [points]);
  useEffect(() => {
    if (points === null) {
      surEtat(ETAT_VIDE);
      return;
    }
    const pastilles = [{ pastille: { x: points.lieu.x, z: points.lieu.z } }];
    if (points.planche !== null) pastilles.push({ pastille: { x: points.planche.x, z: points.planche.z } });
    surEtat({ points: pastilles, evidence, colorer: (f) => colorer(f, { irrigation: null, evidence }) });
  }, [surEtat, points, evidence]);

  // « Grelinette : hangar, mur nord » (libellé du cœur, deux-points plutôt que tiret dans la 3D).
  const nomLieu = points === null || outil === null ? '' : libelleRangement(outil.nom, points.lieu.nom, outil.place).replace(' — ', ' : ');
  const plancheAbsente = points !== null && points.planche === null && cible?.plancheId != null;
  return (
    <>
      <div ref={couche} data-testid="rangement-3d" className="plan3d-vannes">
        {points !== null && (
          <button type="button" data-testid="repere-rangement-3d" data-sorte="lieu" data-surligne="oui" data-x={points.lieu.x} data-z={points.lieu.z} aria-label={nomLieu} className="plan3d-repere-vanne plan3d-repere-vanne-choisi">
            {nomLieu}
          </button>
        )}
        {points?.planche != null && (
          <button
            type="button"
            data-testid="repere-rangement-3d"
            data-sorte="planche"
            data-surligne="oui"
            data-x={points.planche.x}
            data-z={points.planche.z}
            aria-label={`Planche ${points.planche.code}`}
            className="plan3d-repere-vanne plan3d-repere-vanne-choisi"
          >
            {points.planche.code}
          </button>
        )}
      </div>
      {points !== null && (
        <div className="plan3d-vannes-outils">
          {plancheAbsente && (
            <p role="status" className="plan3d-fiche-vanne">
              La planche de ce travail n’est pas placée sur le plan : seul le lieu de rangement est montré.
            </p>
          )}
          <button type="button" data-testid="fermer-rangement-3d" className="plan3d-bouton" onClick={() => surFermer?.()}>
            Fermer
          </button>
        </div>
      )}
    </>
  );
}

export default Rangement3d;
