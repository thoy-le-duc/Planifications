/**
 * T68 (relecture) — jeu de traitements varié pour comparer une requête réécrite à l'ancienne sur
 * le double FIDÈLE de PowerSync (./base-powersync.ts) : deux fermes et une ferme nulle, plusieurs
 * types, dates sur deux ans de part et d'autre des bornes (nulles, vides, numériques), chaînes de
 * corrections et d'annulations dans tous les sens (ancienne qui remplace une récente et l'inverse,
 * chaînes longues, cycles, cible absente, autre ferme), `remplace_evenement_id` absent, nul, vide,
 * numérique, et `detail` invalide. Les lignes sont rangées directement dans ps_data__evenement
 * (JSON brut), pour couvrir aussi des valeurs que l'appli n'écrit pas. Outil de test.
 */
import type { BasePowerSync } from './base-powersync.ts';

/** Générateur pseudo-aléatoire déterministe (LCG). */
function hasard(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

const choisir = <T>(r: () => number, l: readonly T[]): T => l[Math.floor(r() * l.length)] as T;

function jourDecale(base: string, jours: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

export const FERME = 'f1';
export const AUTRE_FERME = 'f2';
/** Jours autour desquels les dates du jeu se resserrent (bornes des requêtes comparées). */
export const JOURS_PIVOTS = ['2026-09-30', '2025-09-29', '2026-10-01'] as const;

export function chargerJeuVarie(base: BasePowerSync, graine = 68, nombre = 600): void {
  const r = hasard(graine);
  const ids: string[] = [];
  base.exec('BEGIN');
  base.recevoir(`INSERT INTO ps_data__produit_phyto (id, data) VALUES ('p1', json_object('ferme_id', 'f1', 'nom_commercial', 'Bouillie'))`);
  base.recevoir(`INSERT INTO ps_data__produit_phyto (id, data) VALUES ('p2', json_object('ferme_id', 'f1', 'nom_commercial', 'Soufre'))`);
  for (let i = 0; i < nombre; i++) {
    const id = `e${String(i).padStart(4, '0')}`;
    const pivot = choisir(r, JOURS_PIVOTS);
    const date: unknown = r() < 0.05 ? choisir(r, [null, '', 20260930, 'x']) : jourDecale(pivot, choisir(r, [0, 0, 0, -1, 1, -366, -367, -365, Math.floor(r() * 1400) - 700]));
    const ligne: Record<string, unknown> = {
      ferme_id: r() < 0.03 ? null : choisir(r, [FERME, FERME, FERME, AUTRE_FERME]),
      type: r() < 0.15 ? choisir(r, ['recolte', 'semis', 'Traitement', 'traitement ', null]) : 'traitement',
      date,
      horodatage: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z#${id}`,
      emplacement_ids: JSON.stringify([choisir(r, ['a', 'b', 'c'])]),
      detail:
        r() < 0.05
          ? choisir(r, [null, 'pas du json', '{"produitPhytoId":', ''])
          : JSON.stringify({ produitPhytoId: choisir(r, ['p1', 'P2', 'p3', 7]), recolteAutoriseeLe: choisir(r, ['2026-10-05', 3, null]) }),
    };
    const v = r();
    if (v < 0.35) {
      // Pas de remplacement : clé absente, nulle, vide ou bizarre.
      const sorte = choisir(r, ['absente', 'nulle', 'vide', 'vide', 'numerique', 'objet'] as const);
      if (sorte === 'nulle') ligne.remplace_evenement_id = null;
      else if (sorte === 'vide') ligne.remplace_evenement_id = '';
      else if (sorte === 'numerique') ligne.remplace_evenement_id = choisir(r, [0, -1, 42, 1.5]);
      else if (sorte === 'objet') ligne.remplace_evenement_id = choisir(r, [{}, [], false, true]);
    } else {
      // Remplacement : d'une ligne déjà vue (chaîne, dans n'importe quel ordre de dates), d'une
      // ligne future (cycle possible), ou d'une cible absente.
      const cible = v < 0.85 && ids.length > 0 ? choisir(r, ids) : v < 0.95 ? `e${String(Math.floor(r() * nombre)).padStart(4, '0')}` : 'absente';
      ligne.remplace_evenement_id = cible;
      ligne.remplace_sorte = choisir(r, ['correction', 'correction', 'annulation', null]);
    }
    base.recevoir(`INSERT INTO ps_data__evenement (id, data) VALUES (?, ?)`, [id, JSON.stringify(ligne)]);
    ids.push(id);
  }
  base.exec('COMMIT');
}

/** Lignes rendues, en multiensemble trié : l'ordre d'une requête sans ORDER BY n'est pas un résultat. */
export function multiensemble(lignes: readonly unknown[]): string[] {
  return lignes.map((l) => JSON.stringify(l)).sort();
}
