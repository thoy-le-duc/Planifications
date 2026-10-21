/**
 * Jeu des tests d'écran de T54, posé sur la ferme neuve (../../../parcellaire/test/ferme-neuve.ts,
 * jour des tests 2026-10-19) : une zone « Plein champ », P1 (50 m × 2 m = 100 m²), P2 (25 m ×
 * 0,8 m = 20 m²), la saison 2026, deux produits fertilisants de la ferme (compost de déchets verts
 * à 1 % N en t ; corne broyée à 13 % N en kg), et de quoi écrire des apports réalisés. Écrit à la
 * main au format du schéma local (snake_case), directement dans la base (hors de la porte : les
 * transactions comptées par le banc restent celles des écrans).
 */
import type { Banc } from '../../../parcellaire/test/outils.ts';
import { FERME, UTILISATEUR } from '../../../parcellaire/test/ferme-neuve.ts';

const id = (n: number) => `0192f0c1-5454-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const ZONE = id(0x10);
export const P1 = id(0x20);
export const P2 = id(0x21);
export const SAISON = id(0x30);
export const COMPOST = id(0x40);
export const CORNE = id(0x41);
const HORO = '2026-01-01T08:00:00.000Z';

export async function ecrireJeu(b: Banc, options: { readonly produits?: boolean } = {}): Promise<void> {
  await b.base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Plein champ', NULL, 'plein_champ', NULL, NULL, ?, ?, NULL)`,
      [ZONE, FERME, HORO, HORO],
    );
    const e = `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_places, actif_du, actif_au, remplace, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, ?, 'planche', ?, ?, NULL, '2026-01-01', NULL, '[]', ?, ?, NULL)`;
    await tx.execute(e, [P1, FERME, ZONE, 'P1', 50, 2, HORO, HORO]);
    await tx.execute(e, [P2, FERME, ZONE, 'P2', 25, 0.8, HORO, HORO]);
    await tx.execute(`INSERT INTO saison (id, ferme_id, nom, debut, fin, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Saison 2026', '2026-01-01', '2026-12-31', ?, ?, NULL)`, [SAISON, FERME, HORO, HORO]);
    if (options.produits === false) return;
    const p = `INSERT INTO produit_fertilisant (id, ferme_id, nom, forme, unite, teneur_n, teneur_p2o5, teneur_k2o, organique, utilisable_en_bio, source, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, 'solide', ?, ?, NULL, NULL, 1, 1, '', ?, ?, NULL)`;
    await tx.execute(p, [COMPOST, FERME, 'Compost de déchets verts', 't', 1, HORO, HORO]);
    await tx.execute(p, [CORNE, FERME, 'Corne broyée', 'kg', 13, HORO, HORO]);
  });
}

let n = 0;
/** Un apport réalisé (intervention en vigueur), écrit directement dans la base. */
export async function ecrireApport(b: Banc, a: { readonly date: string; readonly produitId: string | null; readonly produit: string; readonly quantite: number; readonly unite: string; readonly emplacements?: readonly string[] }): Promise<string> {
  n++;
  const eid = id(0x1000 + n);
  const detail = { categorie: 'amendement', type: 'amendement', outil: null, produit: a.produit, quantite: { valeur: a.quantite, unite: a.unite }, produitFertilisantId: a.produitId };
  await b.base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le, origine_id)
       VALUES (?, ?, 'intervention', ?, ?, ?, 'tap', NULL, NULL, ?, NULL, '[]', NULL, NULL, ?, ?, ?)`,
      [eid, FERME, a.date, `${a.date}T08:00:00.000Z`, UTILISATEUR, JSON.stringify(a.emplacements ?? [P1]), JSON.stringify(detail), `${a.date}T08:00:00.000Z`, eid],
    );
  });
  return eid;
}

export async function cocherZoneVulnerable(b: Banc): Promise<void> {
  await b.base.writeTransaction(async (tx) => {
    await tx.execute('UPDATE ferme SET zone_vulnerable_nitrates = 1 WHERE id = ?', [FERME]);
  });
}

// ── T56 : fertirrigation ─────────────────────────────────────────────────────────────────────

/** Nitrate de calcium, engrais soluble de la ferme : 15,5 % N, compté en kg (T56). */
export const NITRATE = id(0x42);
/** « Fraise floraison » : 10 kg de nitrate pour 1 000 L de mère, injection 1 % (T56). */
export const RECETTE = id(0x50);

export async function ecrireNitrate(b: Pick<Banc, 'base'>): Promise<void> {
  await b.base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO produit_fertilisant (id, ferme_id, nom, forme, unite, teneur_n, teneur_p2o5, teneur_k2o, organique, utilisable_en_bio, source, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, 'Nitrate de calcium', 'solide', 'kg', 15.5, NULL, NULL, 0, 0, 'étiquette', ?, ?, NULL)`,
      [NITRATE, FERME, HORO, HORO],
    );
  });
}

/** La recette du ticket (ou une autre), écrite directement dans la base. */
export async function ecrireRecette(
  b: Pick<Banc, 'base'>,
  r: { readonly id?: string; readonly nom?: string; readonly taux?: number | null; readonly supprimeLe?: string | null } = {},
): Promise<string> {
  const rid = r.id ?? RECETTE;
  await b.base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO recette_fertirrigation (id, ferme_id, nom, taux_injection, engrais, ec_cible, ph_cible, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, ?, 1.8, 5.8, ?, ?, ?)`,
      [rid, FERME, r.nom ?? 'Fraise floraison', r.taux === undefined ? 1 : r.taux, JSON.stringify([{ produitFertilisantId: NITRATE, quantite: { valeur: 10, unite: 'kg' } }]), HORO, HORO, r.supprimeLe ?? null],
    );
  });
  return rid;
}
