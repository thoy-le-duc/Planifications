/**
 * Ce que l'éditeur n'affiche que sur demande (une zone choisie, un nouveau bâtiment), chargé à part dès son
 * ouverture, en parallèle de ses lectures, pour ne pas alourdir le morceau de l'éditeur (budget.json) : le
 * panneau de la zone (contour à tracer, sommets, serre ; T28d, T81), le formulaire du nouveau bâtiment, et pour
 * T85 « Dessiner depuis les planches », le champ « Orientation (°) », la couche de l'intérieur et de la poignée
 * du bloc, la lecture des emplacements en service et le calcul de la parcelle. L'éditeur n'est prêt qu'une fois
 * ce morceau arrivé.
 *
 * Aucun import du morceau de l'éditeur (scripts/placement.test.ts) : ce module ne prend que des types, le cœur
 * et React. Ce qu'il emprunte à l'éditeur (champ, fenêtre, messages…) lui est donné dans `Outils`.
 */
import { useId, useMemo, useState, type PointerEvent, type ReactElement, type RefObject } from 'react';
import type { RequeteSurveillee } from '@planif/sync';
import type { TypeBatiment } from '@planif/core';
import { TYPES_BATIMENT, versRepereZone, type RepereZone } from '@planif/core/placement';
import { bandesDeLaZone, decouperSerres, type InfoBande, type RangementBandes, rangerDansBandes } from './bandes-serre.ts';
import type { MouvementBloc } from './bloc.ts';
import type { ProprietesChamp, ProprietesModale } from './composants.tsx';
import type { Batiment, EmplacementEnService, Zone } from './donnees.ts';
import type { NouveauBatiment, Trace, ZoneAffichee } from './EditeurPlacement.tsx';
import type { RectanglePlace } from './gestes.ts';
import { typeDeSerrePourZone } from './serre-zone.ts';
import type { Point } from './tuiles.ts';

/** Ce que l'éditeur donne à ce module : ses composants et messages, qu'il ne peut pas importer. */
export interface Outils {
  readonly Champ: (p: ProprietesChamp) => ReactElement;
  readonly Modale: (p: ProprietesModale) => ReactElement;
  readonly verifierContour: (contour: readonly Point[]) => { readonly ok: true } | { readonly ok: false; readonly message: string };
  readonly types: readonly { readonly valeur: TypeBatiment; readonly libelle: string }[];
  /** Message d'une zone abritée (« sa forme est celle de la serre »). */
  readonly zoneAbritee: string;
  /** Message d'un formulaire de bâtiment incomplet. */
  readonly fiche: string;
}

export { mouvoirBloc } from './bloc.ts';
export { dimensionsParDefaut, typeDeSerrePourZone } from './serre-zone.ts';
export { preparerParcelle } from './parcelle-planches.ts';
export { bandesDesSerres, changementsDesBandes, type InfoBande, type RangementBandes } from './bandes-serre.ts';

const PASSE_PIED_MAX_CM = 500;
/** Un passe-pied valide : un entier de 0 à 500 cm. */
const passePiedValide = (texte: string): boolean => /^\d{1,3}$/.test(texte.trim()) && Number(texte) <= PASSE_PIED_MAX_CM;

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Les emplacements en service de la ferme (non supprimés, `actif_au` nul, longueur connue), placés ou non. */
export const requeteEmplacementsEnService = (fermeId: string): RequeteSurveillee<EmplacementEnService | null> => ({
  sql: 'SELECT id, zone_id, code, longueur_m, largeur_m, placement_x_m, placement_y_m, orientation_deg FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL AND actif_au IS NULL AND longueur_m > 0 ORDER BY id',
  parametres: [fermeId],
  tables: ['emplacement'],
  convertir: (l: Readonly<Record<string, unknown>>) => {
    const id = texte(l.id);
    const zoneId = texte(l.zone_id);
    const longueurM = nombre(l.longueur_m);
    const [x, y, o] = [l.placement_x_m, l.placement_y_m, l.orientation_deg].map(nombre);
    if (id === null || zoneId === null || longueurM === null || longueurM <= 0) return null;
    return { id, zoneId, code: texte(l.code) ?? '', longueurM, largeurM: nombre(l.largeur_m), placement: x == null || y == null || o == null ? null : { x, y, orientation_deg: o } };
  },
});

interface ElementDuPlan {
  readonly id: string;
  readonly rect: RectanglePlace;
}

/** L'élément du plan sous ce point (repère de la ferme) : vanne (marqueur de `rayonVanneM`), puis bâtiment, puis planche. */
export function elementSous(p: Point, elements: { readonly vannes: readonly ElementDuPlan[]; readonly batiments: readonly ElementDuPlan[]; readonly planches: readonly ElementDuPlan[] }, rayonVanneM: number): string | undefined {
  const dedans = (o: ElementDuPlan): boolean => {
    const r = o.rect;
    const t = (r.orientationDeg * Math.PI) / 180;
    const dx = p.x - r.centre.x;
    const dy = p.y - r.centre.y;
    return Math.abs(dx * Math.sin(t) + dy * Math.cos(t)) <= r.longueurM / 2 && Math.abs(dx * Math.cos(t) - dy * Math.sin(t)) <= r.largeurM / 2;
  };
  return (
    elements.vannes.find((o) => Math.hypot(p.x - o.rect.centre.x, p.y - o.rect.centre.y) <= Math.max(0.5, rayonVanneM))?.id ??
    elements.batiments.find(dedans)?.id ??
    elements.planches.find(dedans)?.id
  );
}

/** Ramène un écart d'angle dans ]−180, 180]. */
const ecartAngle = (degres: number): number => {
  const e = ((((degres + 180) % 360) + 360) % 360) - 180;
  return e === -180 ? 180 : e;
};

/** Le mouvement du bloc au pointeur `p` (repère de la ferme), depuis le départ du geste : déplacé du même vecteur, ou tourné vers le pointeur (Maj : par 15°). */
export function mouvementDuGeste(g: { readonly mode: 'deplacer' | 'pivoter'; readonly depart: Point; readonly centre0: Point; readonly orientation0: number }, p: Point, maj: boolean): MouvementBloc {
  if (g.mode === 'deplacer') return { dx: Math.round((p.x - g.depart.x) * 1000) / 1000, dy: Math.round((p.y - g.depart.y) * 1000) / 1000, rotationDeg: 0 };
  const dx = p.x - g.centre0.x;
  const dy = p.y - g.centre0.y;
  if (Math.hypot(dx, dy) < 1e-9) return { dx: 0, dy: 0, rotationDeg: 0 };
  // L'axe de la zone pointe vers le pointeur, au degré (Maj : aux 15°).
  const cran = maj ? 15 : 1;
  const cap = Math.round(((Math.atan2(dx, dy) * 180) / Math.PI) / cran) * cran;
  return { dx: 0, dy: 0, rotationDeg: ecartAngle(cap - g.orientation0) };
}

/** La poignée de rotation du bloc, à l'écran (`versEcran` : repère de la ferme → écran ; `mParPixel` : échelle) : au-delà du bout de la zone, sur son axe. */
export function poigneeDuBloc(versEcran: (p: Point) => Point, mParPixel: number, contour: readonly Point[], repere: RepereZone): Point {
  const demiM = Math.max(...contour.map((p) => Math.abs(versRepereZone(repere, p).y)));
  const c = versEcran(repere.centre);
  const t = (repere.orientationDeg * Math.PI) / 180;
  const d = demiM / mParPixel + 28;
  return { x: c.x + Math.sin(t) * d, y: c.y - Math.cos(t) * d };
}

export interface ProprietesPanneauDessin {
  /** Emplacements en service de la zone, dont ceux déjà placés. */
  readonly dessin: { readonly nombre: number; readonly dejaPlaces: number };
  readonly passePied: string;
  readonly surPassePied: (texte: string) => void;
  readonly surDessiner: () => void;
  /** Le point de départ du plan est posé et aucun bâtiment n'est en cours de pose. */
  readonly origineSouhaitee: boolean;
  readonly message: string | null;
}

/** « Dessiner depuis les planches », avec son passe-pied et l'annonce des planches déjà placées. */
export function PanneauDessin({ dessin, passePied, surPassePied, surDessiner, origineSouhaitee, message }: ProprietesPanneauDessin): ReactElement {
  const idRaison = useId();
  const idPassePied = useId();
  const passePiedOk = passePiedValide(passePied);
  const raison = !origineSouhaitee
    ? 'Posez d’abord le point de départ du plan.'
    : !passePiedOk
      ? 'Le passe-pied est un nombre entier de centimètres, de 0 à 500.'
      : `Range les ${String(dessin.nombre)} planche${dessin.nombre > 1 ? 's' : ''} côte à côte au centre de la vue ; vous la déplacez ensuite.`;
  return (
    <div className="pl-parcelle">
      {dessin.dejaPlaces > 0 && (
        <p role="status" data-testid="parcelle-annonce" className="pl-aide">
          {dessin.dejaPlaces === 1 ? '1 planche déjà placée sera rangée' : `${String(dessin.dejaPlaces)} planches déjà placées seront rangées`}.
        </p>
      )}
      <div className="pl-champ">
        <label htmlFor={idPassePied}>Passe-pied (cm)</label>
        <input
          id={idPassePied}
          type="number"
          step={1}
          min={0}
          max={PASSE_PIED_MAX_CM}
          inputMode="numeric"
          value={passePied}
          onChange={(e) => {
            surPassePied(e.target.value);
          }}
        />
      </div>
      <button type="button" className="pl-bouton" disabled={!origineSouhaitee || !passePiedOk} aria-describedby={origineSouhaitee && passePiedOk ? undefined : idRaison} onClick={surDessiner}>
        Dessiner depuis les planches
      </button>
      <p id={idRaison} className="pl-aide">
        {raison}
      </p>
      {message !== null && (
        <p role="status" className="pl-message">
          {message}
        </p>
      )}
    </div>
  );
}

/** Le champ « Orientation (°) » d'une zone avec contour, et comment déplacer et tourner son bloc. */
export function PanneauBloc({ outils, orientation, surOrientation }: { readonly outils: Outils; readonly orientation: number; readonly surOrientation: (m: MouvementBloc) => void }): ReactElement {
  return (
    <>
      <outils.Champ etiquette="Orientation (°)" valeur={orientation} desactive={false} surChange={(cap) => {
          surOrientation({ dx: 0, dy: 0, rotationDeg: ecartAngle(cap - orientation) });
        }}
      />
      <p className="pl-aide">Glissez l’intérieur de la zone pour la déplacer avec ses planches, sa poignée orange pour la tourner. Touchez une planche pour la régler seule.</p>
    </>
  );
}

export interface ProprietesCoucheBloc {
  readonly zoneId: string;
  readonly largeurPx: number;
  readonly hauteurPx: number;
  /** Sommets du contour à l'écran, au format d'un attribut `points` de SVG. */
  readonly points: string;
  /** Centre de la zone, à l'écran : sa poignée de déplacement (l'intérieur d'une parcelle étroite est couvert par ses côtés). */
  readonly centre: Point;
  /** Poignée de rotation, à l'écran. */
  readonly poignee: Point;
  readonly surGlisser: (e: PointerEvent, zoneId: string) => void;
  readonly surTourner: (e: PointerEvent, zoneId: string) => void;
}

/** L'intérieur de la zone (on le glisse, ou par sa poignée du centre) et sa poignée de rotation. */
export function CoucheBloc({ zoneId, largeurPx, hauteurPx, points, centre, poignee, surGlisser, surTourner }: ProprietesCoucheBloc): ReactElement {
  return (
    <>
      <svg className="pl-svg pl-svg-interieur" width={largeurPx} height={hauteurPx}>
        <polygon
          data-testid="zone-interieur"
          data-id={zoneId}
          className="pl-interieur"
          points={points}
          onPointerDown={(ev) => {
            surGlisser(ev, zoneId);
          }}
        />
      </svg>
      <div
        data-testid="poignee-deplacement-zone"
        className="pl-poignee pl-poignee-rotation pl-poignee-zone pl-poignee-deplacer"
        aria-hidden="true"
        style={{ left: centre.x - 14, top: centre.y - 14 }}
        onPointerDown={(ev) => {
          surGlisser(ev, zoneId);
        }}
      />
      <div
        data-testid="poignee-rotation-zone"
        className="pl-poignee pl-poignee-rotation pl-poignee-zone"
        aria-hidden="true"
        style={{ left: poignee.x - 14, top: poignee.y - 14 }}
        onPointerDown={(ev) => {
          surTourner(ev, zoneId);
        }}
      />
    </>
  );
}

// ── Les bandes d'une serre (T86) ────────────────────────────────────────────────────────────────

export interface ProprietesCoucheBandes {
  readonly bandes: ReadonlyMap<string, InfoBande>;
  /** T88 : zones et bâtiments affichés, pour les cases vides et l'avertissement d'une serre en grille. */
  readonly zones?: readonly Zone[] | null;
  readonly batiments?: readonly Batiment[];
  /** Repère de la ferme → écran. */
  readonly versEcran: (p: Point) => Point;
  readonly choisie: string | null;
  readonly surChoisir: (zoneId: string) => void;
}

/**
 * Les bandes d'une serre (T86), ou ses cases quand elle a une grille (T88) : leur contour, comme celui d'une zone, et leur nom ;
 * le toucher choisit la sous-zone. Une case vide est dessinée vide ; des sous-zones sans case donnent un avertissement.
 */
export function CoucheBandes({ bandes, zones, batiments, versEcran, choisie, surChoisir }: ProprietesCoucheBandes): ReactElement {
  const { vides, avertissements } = useMemo(() => decouperSerres(zones ?? [], batiments ?? []), [zones, batiments]);
  const enPoints = (contour: readonly Point[]): string =>
    contour
      .map(versEcran)
      .map((p) => `${String(p.x)},${String(p.y)}`)
      .join(' ');
  return (
    <>
      <svg className="pl-svg pl-svg-bandes" aria-hidden="true">
        {[...bandes.values()].map((b) => (
          <polygon
            key={b.zoneId}
            data-testid="zone-contour"
            data-id={b.zoneId}
            className={`pl-contour${choisie === b.zoneId ? ' pl-contour-choisi' : ''}`}
            points={enPoints(b.contour)}
          />
        ))}
        {vides.map((v) => (
          <polygon key={`${v.racineId}-${String(v.case.chapelle)}-${String(v.case.troncon)}`} className="pl-contour pl-case-vide" points={enPoints(v.contour)} />
        ))}
      </svg>
      {[...bandes.values()].map((b) => {
        const p = versEcran(b.etiquette);
        const c = b.case;
        const attributs =
          c === null
            ? { 'data-testid': 'bande-serre', 'data-rang': b.bande.rang, 'data-total': b.bande.total }
            : { 'data-testid': 'case-serre', 'data-chapelle': c.chapelle, 'data-troncon': c.troncon, 'data-vide': 'false' };
        return (
          <button
            key={b.zoneId}
            type="button"
            {...attributs}
            data-id={b.zoneId}
            data-x={b.centre.x}
            data-y={b.centre.y}
            data-longueur={b.bande.longueurM}
            data-largeur={b.bande.largeurM}
            aria-pressed={choisie === b.zoneId}
            className={`pl-bande${choisie === b.zoneId ? ' pl-bande-choisie' : ''}`}
            style={{ left: p.x, top: p.y }}
            onPointerDown={(ev) => {
              ev.stopPropagation();
            }}
            onClick={() => {
              surChoisir(b.zoneId);
            }}
          >
            {b.zone.nom}
          </button>
        );
      })}
      {vides.map((v) => (
        <span
          key={`${v.racineId}-${String(v.case.chapelle)}-${String(v.case.troncon)}`}
          aria-hidden="true"
          data-testid="case-serre"
          data-id=""
          data-chapelle={v.case.chapelle}
          data-troncon={v.case.troncon}
          data-x={v.centre.x}
          data-y={v.centre.y}
          data-longueur={v.case.longueurM}
          data-largeur={v.case.largeurM}
          data-vide="true"
          className="pl-case-vide-repere"
          style={{ left: versEcran(v.centre).x, top: versEcran(v.centre).y }}
        />
      ))}
      {avertissements.map((a) => {
        const p = versEcran(a.position);
        return (
          <p key={a.racineId} role="status" data-testid="serre-avertissement" className="pl-serre-avertissement" style={{ left: p.x, top: p.y }}>
            {`${a.serre} : ${a.message}`}
          </p>
        );
      })}
    </>
  );
}

export interface ProprietesPanneauRangement {
  readonly bandes: readonly InfoBande[];
  readonly emplacements: readonly EmplacementEnService[];
  readonly passePied: string;
  readonly surPassePied: (texte: string) => void;
  readonly surRanger: (r: RangementBandes) => void;
  /** Avertissement du dernier rangement (planches qui dépassent), ou null. */
  readonly message: string | null;
}

/** « Ranger les planches dans les bandes », avec son passe-pied ; un contour tracé à la main se propose à l'effacement. */
export function PanneauRangement({ bandes, emplacements, passePied, surPassePied, surRanger, message }: ProprietesPanneauRangement): ReactElement {
  const idRaison = useId();
  const idPassePied = useId();
  const [confirmer, setConfirmer] = useState(false);
  const passePiedOk = passePiedValide(passePied);
  const nombre = bandes.reduce((n, b) => n + emplacements.filter((e) => e.zoneId === b.zoneId).length, 0);
  const tracees = bandes.filter((b) => b.zone.contour !== null);
  if (nombre === 0) return <p className="pl-aide">Les sous-zones de cette serre n’ont aucune planche en service à ranger.</p>;
  const ranger = (effacer: boolean): void => {
    setConfirmer(false);
    const r = rangerDansBandes(bandes, emplacements, Number(passePied), effacer);
    if (r !== null) surRanger(r);
  };
  return (
    <div className="pl-parcelle">
      <div className="pl-champ">
        <label htmlFor={idPassePied}>Passe-pied (cm)</label>
        <input
          id={idPassePied}
          type="number"
          step={1}
          min={0}
          max={PASSE_PIED_MAX_CM}
          inputMode="numeric"
          value={passePied}
          onChange={(e) => {
            surPassePied(e.target.value);
          }}
        />
      </div>
      {confirmer ? (
        <div role="group" aria-label="Contours tracés à la main" data-testid="bande-contours">
          <p className="pl-aide">
            {`${tracees.map((b) => b.zone.nom).join(', ')} ${tracees.length > 1 ? 'ont' : 'a'} un contour tracé à la main, que la bande remplace. L’effacer ?`}
          </p>
          <button
            type="button"
            className="pl-bouton pl-principal"
            onClick={() => {
              ranger(true);
            }}
          >
            Effacer et ranger
          </button>
          <button
            type="button"
            className="pl-bouton"
            onClick={() => {
              ranger(false);
            }}
          >
            Ranger sans effacer
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="pl-bouton"
            disabled={!passePiedOk}
            aria-describedby={passePiedOk ? undefined : idRaison}
            onClick={() => {
              if (tracees.length > 0) setConfirmer(true);
              else ranger(false);
            }}
          >
            Ranger les planches dans les bandes
          </button>
          <p id={idRaison} className="pl-aide">
            {passePiedOk
              ? `Range les ${String(nombre)} planche${nombre > 1 ? 's' : ''} des sous-zones, chacune dans sa bande ; vous les déplacez ensuite.`
              : 'Le passe-pied est un nombre entier de centimètres, de 0 à 500.'}
          </p>
        </>
      )}
      {message !== null && (
        <p role="status" data-testid="bande-avertissement" className="pl-message">
          {message}
        </p>
      )}
    </div>
  );
}

// ── Panneau d'une zone ───────────────────────────────────────────────────────────────────────────

export interface ProprietesPanneauZone {
  readonly outils: Outils;
  readonly info: ZoneAffichee;
  readonly edition: boolean;
  /** Le point de départ du plan est posé et aucun bâtiment n'est en cours de pose. */
  readonly origineSouhaitee: boolean;
  readonly trace: Trace | null;
  readonly message: string | null;
  readonly conteneur: RefObject<HTMLDivElement | null>;
  readonly surTracer: () => void;
  readonly surRenoncer: () => void;
  /** « Placer la serre » (zone sans contour) ou « Remplacer par une serre » (zone avec contour). */
  readonly surSerre: () => void;
  readonly surSommet: (index: number, point: Point) => void;
  readonly passePied: string;
  readonly surPassePied: (texte: string) => void;
  readonly surDessiner: () => void;
  /** T85 : cap de l'axe de la zone si son bloc se tourne ; null sinon. */
  readonly orientation: number | null;
  /** Le champ « Orientation (°) » : le bloc tourne autour de son centre jusqu'au cap choisi. */
  readonly surOrientation: (m: MouvementBloc) => void;
  /** T86 : les bandes des zones abritées par une serre (par sous-zone) ; vide sans sous-zone. */
  readonly bandes: ReadonlyMap<string, InfoBande>;
  /** Les emplacements en service de la ferme : « Dessiner depuis les planches » (T85) et « Ranger les planches dans les bandes » (T86). */
  readonly emplacements: readonly EmplacementEnService[] | null;
  readonly surRanger: (r: RangementBandes) => void;
}

export function PanneauZone({
  outils,
  info,
  edition,
  origineSouhaitee,
  trace,
  message,
  conteneur,
  surTracer,
  surRenoncer,
  surSerre,
  surSommet,
  passePied,
  surPassePied,
  surDessiner,
  orientation,
  surOrientation,
  bandes,
  emplacements,
  surRanger,
}: ProprietesPanneauZone): ReactElement {
  const idRaison = useId();
  const contour = info.affiche;
  // T81 : type de serre que la zone peut recevoir (tunnel, serre) ; null : la zone se trace.
  const typeSerre = typeDeSerrePourZone(info.zone.typeAbri);
  // T85 : une zone qui se trace, sans contour, se dessine depuis ses planches en service (dont certaines déjà placées).
  const siens = typeSerre === null && contour === null && !info.abritee ? (emplacements ?? []).filter((x) => x.zoneId === info.zone.id) : [];
  const dessin = siens.length === 0 ? null : { nombre: siens.length, dejaPlaces: siens.filter((x) => x.placement !== null).length };
  const enBande = bandes.get(info.zone.id);
  const sesBandes = enBande === undefined && info.abritee ? bandesDeLaZone(bandes, info.zone.id) : [];
  const verdict = info.verdict ?? (contour === null ? null : outils.verifierContour(contour));
  return (
    <>
      <h3>{info.zone.nom}</h3>
      {enBande !== undefined && (
        <p role="status" data-testid="zone-en-bande" className="pl-aide">
          {enBande.case === null
            ? `Dans la serre ${enBande.serre}, bande ${String(enBande.bande.rang)} sur ${String(enBande.bande.total)}.`
            : `Dans la serre ${enBande.serre}, chapelle ${String(enBande.case.chapelle)}, tronçon ${String(enBande.case.troncon)}.`}
        </p>
      )}
      {info.abritee && enBande === undefined && (
        <p role="status" data-testid="zone-abritee" className="pl-aide">
          Cette zone est abritée par un bâtiment : {outils.zoneAbritee}, il n’y a pas de contour à tracer.
        </p>
      )}
      {edition && sesBandes.length > 0 && (
        <PanneauRangement bandes={sesBandes} emplacements={emplacements ?? []} passePied={passePied} surPassePied={surPassePied} surRanger={surRanger} message={message} />
      )}
      {!info.abritee && !edition && (
        <p className="pl-aide">{contour === null ? 'Aucun contour tracé pour cette zone.' : `Contour de ${String(contour.length)} sommets.`}</p>
      )}
      {!info.abritee && edition && trace === null && contour === null && dessin !== null && (
        <PanneauDessin dessin={dessin} passePied={passePied} surPassePied={surPassePied} surDessiner={surDessiner} origineSouhaitee={origineSouhaitee} message={message} />
      )}
      {!info.abritee && edition && trace === null && (contour === null || typeSerre !== null) && (
        <>
          <button
            type="button"
            className="pl-bouton"
            data-action="tracer"
            disabled={!origineSouhaitee}
            aria-describedby={origineSouhaitee ? undefined : idRaison}
            onClick={typeSerre === null ? surTracer : surSerre}
          >
            {typeSerre === null ? 'Tracer le contour' : contour === null ? 'Placer la serre' : 'Remplacer par une serre'}
          </button>
          <p id={idRaison} className="pl-aide">
            {origineSouhaitee
              ? typeSerre === null && 'Posez les sommets un à un sur la photo, puis fermez le tracé.'
              : 'Posez d’abord le point de départ du plan.'}
          </p>
        </>
      )}
      {!info.abritee && edition && trace !== null && (
        <div ref={conteneur} tabIndex={-1} className="pl-contour-edition" data-testid="contour-edition" data-id={info.zone.id} data-etat="trace" data-sommets={trace.sommets.length}>
          <p className="pl-aide">
            Touchez la photo pour poser chaque sommet ({String(trace.sommets.length)} posé{trace.sommets.length > 1 ? 's' : ''}). Pour fermer : touchez le premier sommet, ou Entrée (3 sommets au moins). Échap abandonne.
          </p>
          <button type="button" className="pl-bouton" onClick={surRenoncer}>
            Renoncer au tracé
          </button>
        </div>
      )}
      {!info.abritee && edition && trace === null && contour !== null && (
        <div
          ref={conteneur}
          tabIndex={-1}
          className="pl-contour-edition"
          data-testid="contour-edition"
          data-id={info.zone.id}
          data-etat={verdict?.ok === false ? 'invalide' : 'valide'}
          data-sommets={contour.length}
        >
          {verdict?.ok === false && (
            <p role="alert" data-testid="contour-erreur" className="pl-message pl-erreur">
              {verdict.message}
            </p>
          )}
          {message !== null && (
            <p role="status" className="pl-message">
              {message}
            </p>
          )}
          {orientation !== null && <PanneauBloc outils={outils} orientation={orientation} surOrientation={surOrientation} />}
          <p className="pl-aide">
            Glissez un sommet ; touchez un côté pour ajouter un sommet au milieu ; clic droit ou Suppr retire un sommet. Au clavier : Tab passe d’un sommet à l’autre, flèches 0,1 m (Maj : 1 m), Inser ajoute après.
          </p>
          {contour.map((p, k) => (
            <div key={k} className="pl-sommet-champs">
              <outils.Champ
                etiquette={`Sommet ${String(k + 1)} x (m)`}
                valeur={p.x}
                desactive={false}
                surChange={(x) => {
                  surSommet(k, { x, y: p.y });
                }}
              />
              <outils.Champ
                etiquette={`Sommet ${String(k + 1)} y (m)`}
                valeur={p.y}
                desactive={false}
                surChange={(y) => {
                  surSommet(k, { x: p.x, y });
                }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Nouveau bâtiment ────────────────────────────────────────────────────────────────────────────

export function FormulaireBatiment({ outils, surPoser, surFermer }: { readonly outils: Outils; readonly surPoser: (n: NouveauBatiment) => void; readonly surFermer: () => void }): ReactElement {
  const idType = useId();
  const idNom = useId();
  const idRaison = useId();
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
    <outils.Modale role="dialog" titre="Nouveau bâtiment" surEchap={surFermer}>
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
          {outils.types.map((t) => (
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
      {!valide && (
        <p id={idRaison} className="pl-aide">
          {outils.fiche}
        </p>
      )}
      <div className="pl-modale-actions">
        <button
          type="button"
          className="pl-bouton pl-principal"
          disabled={!valide}
          aria-describedby={valide ? undefined : idRaison}
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
    </outils.Modale>
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
