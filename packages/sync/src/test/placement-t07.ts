/**
 * Jeu de données de T28c : la grande ferme de T07 (jeu-t07.ts), PLACÉE. Origine du plan posée ;
 * les 12 premières zones (« Tunnel 1 » à « Tunnel 12 ») sont abritées par une serre (8 tunnels,
 * 4 serres chapelles, certaines tournées), 14 « Îlots » ont un contour (rectangles, un sur quatre
 * en L), les 4 derniers restent non placés ; un magasin et un hangar n'abritent aucune zone ; trois
 * planches sur quatre sont placées dans le repère de leur zone, la quatrième garde le rangement
 * automatique. Déterministe, valable pour `validerPlacement` du moteur (T28a).
 *
 * Sert à l'amorçage `?jeu=t07-place` (src/donnees/amorcer.ts) et à e2e/vue-3d-jumeau.e2e.ts, qui
 * recalcule le plan attendu sous Node sur la même base. Rien ne part vers un serveur.
 */
import type { BaseLocale } from '../types.ts';

export interface BilanPlacementT07 {
  readonly batiments: number;
  readonly serres: number;
  readonly zonesAbritees: number;
  readonly zonesAContour: number;
  readonly zonesNonPlacees: number;
  readonly planchesPlacees: number;
  readonly planchesNonPlacees: number;
}

interface LigneZone {
  readonly id: string;
  readonly nom: string;
}
interface LigneEmplacement {
  readonly id: string;
  readonly zone_id: string;
  readonly code: string;
}

const CREE = '2026-01-15T08:00:00.000Z';
const ORIGINE_PLAN = '{"latitude":44.35,"longitude":2.57}';
const idBatiment = (n: number): string => `0192f0c1-7a6e-7cc3-b0a0-${n.toString(16).padStart(12, '0')}`;

/** Rectangle en sens antihoraire. */
const rectangle = (x: number, y: number, l: number, h: number) => [
  { x, y },
  { x: x + l, y },
  { x: x + l, y: y + h },
  { x, y: y + h },
];
/** Un L de 30 × 30, branches de 10 m, en sens antihoraire. */
const enL = (x: number, y: number) => [
  { x, y },
  { x: x + 30, y },
  { x: x + 30, y: y + 10 },
  { x: x + 10, y: y + 10 },
  { x: x + 10, y: y + 30 },
  { x, y: y + 30 },
];

export async function placerJeuT07(base: Pick<BaseLocale, 'writeTransaction'>, fermeId: string): Promise<BilanPlacementT07> {
  return base.writeTransaction(async (tx) => {
    const zones = await tx.getAll<LigneZone>('SELECT id, nom FROM zone WHERE ferme_id = ? AND supprime_le IS NULL', [fermeId]);
    const rang = (z: LigneZone): number => {
      const [, type, n] = /^(Tunnel|Îlot) (\d+)$/.exec(z.nom) ?? [];
      return type === undefined ? 1000 : (type === 'Tunnel' ? 0 : 12) + Number(n) - 1;
    };
    zones.sort((a, b) => rang(a) - rang(b));
    const emplacements = await tx.getAll<LigneEmplacement>('SELECT id, zone_id, code FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL', [fermeId]);
    emplacements.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

    await tx.execute('UPDATE ferme SET origine_plan = ? WHERE id = ?', [ORIGINE_PLAN, fermeId]);

    let compteur = 0;
    let serres = 0;
    let zonesAbritees = 0;
    let zonesAContour = 0;
    let zonesNonPlacees = 0;
    const insererBatiment = async (nom: string, type: string, l: number, w: number, h: number, x: number, y: number, cap: number, zoneId: string | null) => {
      compteur += 1;
      await tx.execute(
        'INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
        [idBatiment(compteur), fermeId, nom, type, l, w, h, x, y, cap, zoneId, CREE, CREE],
      );
    };

    // Repère de chaque zone placée (pour choisir où mettre les planches) : largeur utile en x'.
    const demiLargeur = new Map<string, number>();
    for (const z of zones) {
      const r = rang(z);
      if (r < 12) {
        const chapelle = r >= 8;
        const cap = (r % 3) * 30;
        await insererBatiment(z.nom, chapelle ? 'serre_chapelle' : 'serre_tunnel', 40, chapelle ? 24 : 8, chapelle ? 5 : 3.5, (r % 4) * 60, Math.floor(r / 4) * 50, cap, z.id);
        serres += 1;
        zonesAbritees += 1;
        demiLargeur.set(z.id, chapelle ? 10 : 3);
      } else if (r < 26) {
        const k = r - 12;
        const x = (k % 7) * 45;
        const y = -100 - Math.floor(k / 7) * 60;
        const contour = k % 4 === 3 ? enL(x, y) : rectangle(x, y, 30, 20);
        await tx.execute('UPDATE zone SET contour = ? WHERE id = ?', [JSON.stringify(contour), z.id]);
        zonesAContour += 1;
        demiLargeur.set(z.id, 4);
      } else {
        zonesNonPlacees += 1;
      }
    }
    await insererBatiment('Magasin', 'magasin', 14, 8, 4, -60, 40, 0, null);
    await insererBatiment('Hangar', 'hangar', 20, 10, 6, -60, -20, 90, null);

    let planchesPlacees = 0;
    let planchesNonPlacees = 0;
    const rangDansZone = new Map<string, number>();
    for (const e of emplacements) {
      const k = rangDansZone.get(e.zone_id) ?? 0;
      rangDansZone.set(e.zone_id, k + 1);
      const demi = demiLargeur.get(e.zone_id);
      if (demi === undefined || k % 4 === 3) {
        planchesNonPlacees += 1;
        continue;
      }
      const colonnes = Math.max(1, Math.floor(demi / 3));
      const x = ((k % (2 * colonnes + 1)) - colonnes) * 3;
      const y = -18 + Math.floor(k / (2 * colonnes + 1)) * 9;
      await tx.execute('UPDATE emplacement SET placement_x_m = ?, placement_y_m = ?, orientation_deg = ? WHERE id = ?', [x, y, 0, e.id]);
      planchesPlacees += 1;
    }
    return { batiments: compteur, serres, zonesAbritees, zonesAContour, zonesNonPlacees, planchesPlacees, planchesNonPlacees };
  });
}
