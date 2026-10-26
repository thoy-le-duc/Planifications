/**
 * T86 : les sous-zones d'une serre en bandes, côté éditeur. Chargé à la demande avec le panneau de la zone
 * (./zone-ecran.tsx) : il n'alourdit pas l'ouverture de l'éditeur. N'importe que le cœur (voir bloc.ts).
 *
 * Une zone abritée par une serre (tunnel ou chapelle) qui a des sous-zones se dessine en bandes (calcul pur du cœur,
 * `bandesDeSerre`) ; les planches d'une sous-zone se rangent dans sa bande (`rangerDansBande`), au même repère que les autres
 * planches de la serre : celui du bâtiment. Rien n'est stocké : les bandes se recalculent depuis le bâtiment et les sous-zones.
 */
import { bandesDeSerre, depuisRepereZone, rangerDansBande, type BandeSerre, type RepereZone } from '@planif/core/placement';
import type { ChangementPlacement } from '@planif/sync';
import type { Batiment, EmplacementEnService, Planche, Zone } from './donnees.ts';
import type { Point } from './tuiles.ts';

const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/** Une sous-zone d'une zone abritée, vue comme une bande de la serre. */
export interface InfoBande {
  /** La sous-zone. */
  readonly zoneId: string;
  readonly zone: Zone;
  /** La zone abritée par la serre. */
  readonly racineId: string;
  /** Nom de la serre. */
  readonly serre: string;
  readonly bande: BandeSerre;
  /** Repère de la serre, où les planches de la bande gardent leur placement. */
  readonly repere: RepereZone;
  /** Les 4 coins de la bande dans le repère de la ferme, sens antihoraire. */
  readonly contour: readonly Point[];
  /** Centre de la bande dans le repère de la ferme. */
  readonly centre: Point;
  /** Où le nom de la bande se pose : près de son bout nord, dans le repère de la ferme. */
  readonly etiquette: Point;
}

const estSerre = (b: Batiment): boolean => b.type === 'serre_tunnel' || b.type === 'serre_chapelle';

/** Les bandes de chaque sous-zone (par identifiant) des zones abritées par une serre ; vide si aucune. */
export function bandesDesSerres(zones: readonly Zone[], batiments: readonly Batiment[]): Map<string, InfoBande> {
  const resultat = new Map<string, InfoBande>();
  const abritees = new Set(batiments.map((b) => b.zoneId));
  const vues = new Set<string>();
  for (const serre of batiments) {
    if (!estSerre(serre) || serre.zoneId === null || vues.has(serre.zoneId)) continue;
    const racineId = serre.zoneId;
    vues.add(racineId);
    // Une sous-zone qui a sa propre serre se dessine par elle.
    const filles = zones.filter((z) => z.parenteId === racineId && !abritees.has(z.id));
    const repere: RepereZone = { centre: serre.centre, orientationDeg: serre.orientationDeg };
    const coin = (x: number, y: number): Point => {
      const p = depuisRepereZone(repere, { x, y });
      return { x: mm(p.x), y: mm(p.y) };
    };
    for (const bande of bandesDeSerre(serre, filles)) {
      const zone = filles.find((z) => z.id === bande.id);
      if (zone === undefined) continue;
      const l = bande.largeurM / 2;
      const L = bande.longueurM / 2;
      const { x, y } = bande.centre;
      resultat.set(bande.id, {
        zoneId: bande.id,
        zone,
        racineId,
        serre: serre.nom,
        bande,
        repere,
        contour: [coin(x - l, y - L), coin(x + l, y - L), coin(x + l, y + L), coin(x - l, y + L)],
        centre: coin(x, y),
        etiquette: coin(x, y + L * 0.8),
      });
    }
  }
  return resultat;
}

/** Les bandes d'une zone abritée, dans l'ordre (de l'ouest à l'est). */
export const bandesDeLaZone = (bandes: ReadonlyMap<string, InfoBande>, racineId: string): InfoBande[] =>
  [...bandes.values()].filter((b) => b.racineId === racineId).sort((a, b) => a.bande.rang - b.bande.rang);

export interface RangementBandes {
  /** Une planche par emplacement des sous-zones, placement dans le repère de la serre. */
  readonly planches: readonly Planche[];
  /** Sous-zones à contour tracé qui seront effacées : leur contour prend la valeur vide au brouillon. */
  readonly zones: readonly (readonly [string, readonly Point[]])[];
  /** Avertissement non bloquant (« Manon 2 : 3 planches dépassent de la bande »), ou null. */
  readonly message: string | null;
}

/**
 * Range les emplacements en service de chaque sous-zone dans sa bande (règle de T85, bloc centré). Ceux de la zone
 * abritée elle-même ne sont pas touchés. `effacer` : les sous-zones dont il faut effacer le contour tracé à la main.
 * `null` : passe-pied invalide, ou rien à ranger.
 */
export function rangerDansBandes(bandes: readonly InfoBande[], emplacements: readonly EmplacementEnService[], passePiedCm: number, effacerContours: boolean): RangementBandes | null {
  const planches: Planche[] = [];
  const avertissements: string[] = [];
  for (const b of bandes) {
    const siens = emplacements.filter((e) => e.zoneId === b.zoneId);
    if (siens.length === 0) continue;
    const r = rangerDansBande(
      b.bande,
      siens.map((e) => ({ id: e.id, code: e.code, longueurM: e.longueurM, largeurM: e.largeurM })),
      passePiedCm,
    );
    if (r === null) return null;
    const parId = new Map(siens.map((e) => [e.id, e]));
    for (const p of r.planches) {
      const e = parId.get(p.id);
      if (e !== undefined) planches.push({ id: e.id, zoneId: e.zoneId, code: e.code, longueurM: p.longueurM, largeurM: p.largeurM, placement: { x: mm(p.centre.x), y: mm(p.centre.y), orientation_deg: 0 } });
    }
    const n = r.depassent.length;
    if (n > 0) avertissements.push(`${b.zone.nom} : ${String(n)} planche${n > 1 ? 's dépassent' : ' dépasse'} de la bande.`);
  }
  if (planches.length === 0) return null;
  return {
    planches,
    zones: effacerContours ? bandes.filter((b) => b.zone.contour !== null).map((b): [string, readonly Point[]] => [b.zoneId, []]) : [],
    message: avertissements.length === 0 ? null : avertissements.join(' '),
  };
}

/**
 * Ce que le rangement dans les bandes ajoute aux changements du brouillon : le contour vide d'une sous-zone est un contour à
 * effacer ; le placement d'un emplacement rangé dans une bande s'écrit tel quel (son repère est celui de la serre : aucun contour
 * ne le replace), sauf pour les planches déjà placées (lues avec leur placement), que `changementsDuBrouillon` écrit lui-même.
 */
export function changementsDesBandes(
  zones: readonly Zone[],
  planches: readonly Planche[],
  brouillonPlanches: ReadonlyMap<string, Planche>,
  brouillonZones: ReadonlyMap<string, readonly Point[]>,
  bandes: ReadonlyMap<string, InfoBande>,
): ChangementPlacement[] {
  if (bandes.size === 0) return [];
  const changements: ChangementPlacement[] = [];
  for (const z of zones) if (brouillonZones.get(z.id)?.length === 0 && z.contour !== null && bandes.has(z.id)) changements.push({ sorte: 'zone', id: z.id, contour: null });
  for (const [id, p] of brouillonPlanches) {
    if (!bandes.has(p.zoneId) || planches.some((x) => x.id === id)) continue;
    changements.push({ sorte: 'emplacement', id, placement: { x: mm(p.placement.x), y: mm(p.placement.y), orientation_deg: mm(p.placement.orientation_deg) } });
  }
  return changements;
}
