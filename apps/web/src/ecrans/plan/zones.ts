/**
 * T11e — ce que l'écran Planches tire du plan pour la maquette (docs/maquettes/Plan.dc.html) :
 * puces de zone, surtitre « TUNNEL 2 · 6 PLANCHES · 30 M », carte d'alerte. Et la place de
 * chaque ligne visible dans le DOM (réutilisation des nœuds au défilement).
 *
 * Fonctions pures, sans React ni DOM ; dans un fichier à part de calculs.ts, que d'autres écrans
 * importent : rien ici n'alourdit leurs morceaux.
 */
import type { BarrePlan, LigneEmplacementPlan, LignePlan } from './calculs.ts';

/** Une zone racine du plan, dans l'ordre du plan. */
export interface ZoneDuPlan {
  readonly id: string;
  readonly nom: string;
  /** Index de la ligne de la zone dans le plan. */
  readonly ligne: number;
  /** Planches (emplacements) de la zone dans le plan, sous-zones comprises. */
  readonly planches: number;
  /** Plus petite et plus grande longueur de ses planches (m) ; nulles sans planche. */
  readonly longueurMin: number | null;
  readonly longueurMax: number | null;
}

export interface ZonesDuPlan {
  readonly zones: readonly ZoneDuPlan[];
  /** Pour chaque ligne du plan, l'index (dans `zones`) de sa zone racine ; -1 avant la première. */
  readonly zoneDeLigne: Int32Array;
}

/** Zones racines du plan et zone de chaque ligne : un seul passage sur les lignes. */
export function zonesDuPlan(lignes: readonly LignePlan[]): ZonesDuPlan {
  const zones: { id: string; nom: string; ligne: number; planches: number; longueurMin: number | null; longueurMax: number | null }[] = [];
  const parId = new Map<string, number>();
  const zoneDeLigne = new Int32Array(lignes.length).fill(-1);
  let courante = -1;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (l === undefined) continue;
    if (l.sorte === 'zone') {
      courante = zones.length;
      parId.set(l.id, courante);
      zones.push({ id: l.id, nom: l.nom, ligne: i, planches: 0, longueurMin: null, longueurMax: null });
    } else if (l.sorte === 'emplacement') {
      const z = parId.get(l.zoneId) ?? courante;
      const zone = zones[z];
      if (zone !== undefined) {
        zone.planches += 1;
        zone.longueurMin = zone.longueurMin === null ? l.longueurM : Math.min(zone.longueurMin, l.longueurM);
        zone.longueurMax = zone.longueurMax === null ? l.longueurM : Math.max(zone.longueurMax, l.longueurM);
      }
      zoneDeLigne[i] = z;
      continue;
    }
    zoneDeLigne[i] = courante;
  }
  return { zones, zoneDeLigne };
}

const METRES = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Surtitre d'une zone (décision du chef, T11e) : « Tunnel 2 · 6 planches · 30 m ». La longueur
 * est celle, commune, des planches de la zone ; si elles diffèrent, l'intervalle « 25–30 m ».
 * Sans planche, ni longueur. L'écran l'affiche en capitales (CSS).
 */
export function surtitreZone(zone: ZoneDuPlan): string {
  const n = zone.planches;
  const planches = `${String(n)} ${n < 2 ? 'planche' : 'planches'}`;
  if (zone.longueurMin === null || zone.longueurMax === null) return `${zone.nom} · ${planches}`;
  const min = METRES.format(zone.longueurMin);
  const max = METRES.format(zone.longueurMax);
  return `${zone.nom} · ${planches} · ${min === max ? min : `${min}–${max}`} m`;
}

/** Culture prévue dont la date de début est passée sans réel : la plus en retard, et combien d'autres. */
export interface AlerteRetard {
  readonly ligne: LigneEmplacementPlan;
  readonly barre: BarrePlan;
  readonly autres: number;
}

/**
 * La culture prévue la plus en retard (début prévu le plus ancien, avant `aujourdhui`) ; à date
 * égale, la première dans l'ordre du plan. Nulle s'il n'y en a pas.
 */
export function alerteRetard(lignes: readonly LignePlan[], aujourdhui: string): AlerteRetard | null {
  let choisie: { ligne: LigneEmplacementPlan; barre: BarrePlan } | null = null;
  let n = 0;
  for (const l of lignes) {
    if (l.sorte !== 'emplacement') continue;
    for (const b of l.barres) {
      if (b.etat !== 'prevu' || b.du >= aujourdhui) continue;
      n += 1;
      if (choisie === null || b.du < choisie.barre.du) choisie = { ligne: l, barre: b };
    }
  }
  return choisie === null ? null : { ...choisie, autres: n - 1 };
}

/**
 * Place (clé React) de chaque ligne de [debut, fin[, plus la ligne `garde` (celle qui a le focus,
 * même sortie de la fenêtre) : une ligne qui reste dessinée garde sa place ; une ligne qui entre
 * prend la place d'une ligne sortie, sinon la plus petite libre. Au défilement, React déplace et
 * met à jour les nœuds au lieu d'en retirer et d'en créer ; la ligne focalisée n'est jamais
 * réutilisée pour une autre planche.
 */
export function attribuerPlaces(precedentes: ReadonlyMap<number, number>, debut: number, fin: number, garde: number | null = null): Map<number, number> {
  const indices: number[] = [];
  for (let i = debut; i < fin; i++) indices.push(i);
  if (garde !== null && (garde < debut || garde >= fin)) indices.push(garde);
  const dessinees = new Set(indices);
  const places = new Map<number, number>();
  const prises = new Set<number>();
  for (const i of indices) {
    const p = precedentes.get(i);
    if (p !== undefined) {
      places.set(i, p);
      prises.add(p);
    }
  }
  const liberees: number[] = [];
  for (const [i, p] of precedentes) if (!dessinees.has(i) && !prises.has(p)) liberees.push(p);
  liberees.sort((a, b) => b - a);
  let suivante = 0;
  for (const i of indices) {
    if (places.has(i)) continue;
    let p = liberees.pop();
    if (p === undefined) {
      while (prises.has(suivante)) suivante++;
      p = suivante;
    }
    places.set(i, p);
    prises.add(p);
  }
  return places;
}
