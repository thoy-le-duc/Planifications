/**
 * T28c — placement de la ferme de démo : de quoi montrer le jumeau 3D en ligne (serres en tunnels,
 * chapelles, magasin, hangar, un champ au contour en L). Pur : prend les lignes fusionnées de la
 * démo (./fusion.ts) et en rend de nouvelles, avec l'origine du plan, des serres, un contour et des
 * placements de planches ; les lignes d'origine ne sont pas modifiées.
 *
 * Disposition, dans un repère de la ferme tourné de 12° (toutes les serres sont parallèles, comme
 * sur une vraie exploitation) : de gauche à droite la serre à chapelles, deux tunnels et la serre
 * des fraises ; le magasin et le hangar devant ; le champ au nord. Une planche du tunnel 2 reste
 * sans placement, pour montrer le rangement automatique. Valeurs arrondies au millimètre : ce
 * sont celles du moteur (`validerPlacement`, `validerContour`) qui font foi, tests à l'appui.
 *
 * Ces lignes sont des lignes de la démo, jamais envoyées nulle part (la synchro n'est pas branchée).
 */
import { depuisRepereZone, repereZone, versRepereZone, type RepereZone } from '@planif/core';
import type { Ligne } from './fusion.ts';

type Tables = ReadonlyMap<string, readonly Ligne[]>;

/** Origine du plan : celle de la position météo de la démo (44,35 N, 2,57 E). */
const ORIGINE_PLAN = JSON.stringify({ latitude: 44.35, longitude: 2.57 });
/** Cap des serres (degrés, sens horaire depuis le nord). */
const CAP = 12;
const CAP_PERPENDICULAIRE = CAP + 90;
const REPERE_FERME: RepereZone = { centre: { x: 0, y: 0 }, orientationDeg: CAP };

const mm = (n: number): number => Math.round(n * 1000) / 1000;
/** Point (u, v) du repère des serres → repère de la ferme, au millimètre. */
function dansLaFerme(u: number, v: number): { x: number; y: number } {
  const p = depuisRepereZone(REPERE_FERME, { x: u, y: v });
  return { x: mm(p.x), y: mm(p.y) };
}

interface DescriptionBatiment {
  readonly id: number;
  readonly nom: string;
  readonly type: 'serre_tunnel' | 'serre_chapelle' | 'hangar' | 'magasin';
  readonly longueurM: number;
  readonly largeurM: number;
  readonly hauteurM: number;
  readonly u: number;
  readonly v: number;
  readonly cap: number;
  /** Nom de la zone abritée (une zone de la démo), ou nul. */
  readonly zone: string | null;
}

const BATIMENTS: readonly DescriptionBatiment[] = [
  { id: 0xb1, nom: 'Serre à chapelles', type: 'serre_chapelle', longueurM: 36, largeurM: 16, hauteurM: 4.5, u: -17, v: 0, cap: CAP, zone: 'Serre M1' },
  { id: 0xb2, nom: 'Tunnel 1', type: 'serre_tunnel', longueurM: 32, largeurM: 9.2, hauteurM: 3.5, u: 0, v: 0, cap: CAP, zone: 'Tunnel 1' },
  { id: 0xb3, nom: 'Tunnel 2', type: 'serre_tunnel', longueurM: 32, largeurM: 6.4, hauteurM: 3.2, u: 14, v: -2, cap: CAP, zone: 'Tunnel 2' },
  { id: 0xb4, nom: 'Serre des fraises', type: 'serre_tunnel', longueurM: 34, largeurM: 4.5, hauteurM: 3, u: 24, v: 0, cap: CAP, zone: 'Serre fraises' },
  { id: 0xb5, nom: 'Magasin', type: 'magasin', longueurM: 16, largeurM: 8, hauteurM: 4.2, u: -6, v: -36, cap: CAP_PERPENDICULAIRE, zone: null },
  { id: 0xb6, nom: 'Hangar à matériel', type: 'hangar', longueurM: 20, largeurM: 9, hauteurM: 5.5, u: 18, v: -38, cap: CAP_PERPENDICULAIRE, zone: null },
];

/** Planches des zones abritées : position (x', y') dans le repère de la serre, cap relatif 0 (le long de la serre). */
const PLANCHES_ABRITEES: Readonly<Record<string, readonly (readonly [string, number, number])[]>> = {
  'Serre M1': [
    ['C2-P01', -5, 0],
    ['C3-P01', 2, 0],
    ['C3-P02', 5, 0],
  ],
  'Tunnel 1': [-3.85, -2.75, -1.65, -0.55, 0.55, 1.65, 2.75, 3.85].map((x, i) => [`T1-P0${String(i + 1)}`, x, 0] as const),
  // T2-P07 n'a pas de place choisie : le rangement automatique la loge dans le tunnel.
  'Tunnel 2': [
    ['T2-P01', -2.2, 0],
    ['T2-P02', -1.1, 0],
    ['T2-P03', 0, 0],
    ['T2-P05', 1.1, 0],
  ],
  'Serre fraises': [['S1-G01', 0, 0]],
};

/** Le champ : un L de 26 m sur 36 m dans le repère des serres, centré 52 m au nord, et ses rangs (u, de gauche à droite). */
const CHAMP = { zone: 'Plein champ', u: 0, v: 52, forme: [[-13, -18], [13, -18], [13, 2], [4, 2], [4, 18], [-13, 18]] as const, rangs: [['PC-P01', -11], ['PC-P02', -8.5], ['PC-P03', -6], ['PC-P04', -3.5]] as const };

const texte = (v: string | number | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/** Remplace des lignes d'une table, sans toucher aux autres. */
function modifier(lignes: readonly Ligne[] | undefined, f: (l: Ligne) => Ligne): Ligne[] {
  return (lignes ?? []).map(f);
}

export function placerLaDemo(tables: Tables): Map<string, Ligne[]> {
  const sortie = new Map<string, Ligne[]>();
  for (const [nom, lignes] of tables) sortie.set(nom, [...lignes]);
  const ferme = sortie.get('ferme')?.[0];
  if (ferme === undefined) return sortie;
  // Noms parlants et uniques pour la démo (les jeux de test partagés les appellent « Serre » et « Serre 1 »).
  const RENOMMAGES: Readonly<Record<string, string>> = { Serre: 'Serre M1', 'Serre 1': 'Serre fraises' };
  sortie.set('zone', modifier(sortie.get('zone'), (l) => (typeof l.nom === 'string' && Object.hasOwn(RENOMMAGES, l.nom) && !l.zone_parente_id ? { ...l, nom: RENOMMAGES[l.nom] ?? l.nom } : l)));
  const zones = sortie.get('zone') ?? [];
  const zoneParNom = new Map(zones.filter((z) => z.zone_parente_id === null || z.zone_parente_id === undefined).map((z) => [texte(z.nom), texte(z.id)]));
  const horodatage = texte(ferme.cree_le);

  // Origine du plan : avant tout placement (règle du serveur, T28s).
  sortie.set('ferme', modifier(sortie.get('ferme'), (l) => (l.id === ferme.id ? { ...l, origine_plan: ORIGINE_PLAN } : l)));

  // Bâtiments, une serre par zone abritée (zones présentes dans la démo seulement).
  const batiments: Ligne[] = [];
  const reperes = new Map<string, RepereZone>();
  for (const b of BATIMENTS) {
    const zoneId = b.zone === null ? null : (zoneParNom.get(b.zone) ?? null);
    if (b.zone !== null && zoneId === null) continue;
    const centre = dansLaFerme(b.u, b.v);
    batiments.push({
      id: `0192f0c1-de00-7000-8000-${b.id.toString(16).padStart(12, '0')}`,
      ferme_id: texte(ferme.id),
      nom: b.nom,
      type: b.type,
      longueur_m: b.longueurM,
      largeur_m: b.largeurM,
      hauteur_m: b.hauteurM,
      centre_x_m: centre.x,
      centre_y_m: centre.y,
      orientation_deg: b.cap,
      zone_id: zoneId,
      cree_le: horodatage,
      modifie_le: horodatage,
      supprime_le: null,
    });
    if (zoneId !== null) reperes.set(zoneId, { centre, orientationDeg: b.cap });
  }
  sortie.set('batiment', batiments);

  // Le champ : contour en L (sens antihoraire, comme le veut le moteur), repère de la zone par le moteur.
  const champId = zoneParNom.get(CHAMP.zone);
  const centreChamp = dansLaFerme(CHAMP.u, CHAMP.v);
  const repereChamp: RepereZone = { centre: centreChamp, orientationDeg: CAP };
  const contour = CHAMP.forme.map(([u, v]) => {
    const p = depuisRepereZone(repereChamp, { x: u, y: v });
    return { x: mm(p.x), y: mm(p.y) };
  });
  const reperePlacementChamp = repereZone({ contour });
  if (champId !== undefined && reperePlacementChamp !== null) {
    sortie.set('zone', modifier(sortie.get('zone'), (l) => (l.id === champId ? { ...l, contour: JSON.stringify(contour) } : l)));
    reperes.set(champId, reperePlacementChamp);
  }

  // Planches : dans le repère de leur zone.
  const placements = new Map<string, { x: number; y: number; orientationDeg: number }>();
  const idZone = (nom: string): string | undefined => zoneParNom.get(nom);
  for (const [nomZone, planches] of Object.entries(PLANCHES_ABRITEES)) {
    const zoneId = idZone(nomZone);
    if (zoneId === undefined || !reperes.has(zoneId)) continue;
    for (const [code, x, y] of planches) placements.set(code, { x, y, orientationDeg: 0 });
  }
  if (champId !== undefined && reperePlacementChamp !== null) {
    for (const [code, u] of CHAMP.rangs) {
      const p = versRepereZone(reperePlacementChamp, depuisRepereZone(repereChamp, { x: u, y: 0 }));
      placements.set(code, { x: mm(p.x), y: mm(p.y), orientationDeg: mm((((CAP - reperePlacementChamp.orientationDeg) % 360) + 360) % 360) });
    }
  }
  sortie.set(
    'emplacement',
    modifier(sortie.get('emplacement'), (l) => {
      const p = placements.get(texte(l.code));
      return p === undefined ? l : { ...l, placement_x_m: p.x, placement_y_m: p.y, orientation_deg: p.orientationDeg };
    }),
  );
  return sortie;
}
