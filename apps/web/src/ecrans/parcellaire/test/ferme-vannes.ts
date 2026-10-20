/**
 * Ferme de test de T57 (« ferme des vannes »), écrite à la main au format du schéma local de
 * @planif/sync, sur la ferme neuve de T49 (./ferme-neuve.ts : UTILISATEUR gérant, ou équipier).
 *
 * Utilisée par les tests de l'écran « Vannes » (../vannes.test.tsx), de la vue 3D
 * (plan3d/vannes-3d*.test.ts*) et de la saisie d'irrigation (aujourdhui/irrigation.test.tsx).
 *
 * Saison 2026. Zones et planches (en service depuis le 1er janvier 2026, 30 × 0,8 m) :
 *   « Tunnel 2 » (ZONE_TUNNEL) : P3, P4, P5 ;
 *   « Plein champ » (ZONE_CHAMP) : PC-01, PC-02.
 * Option `vannes` : V12 (VANNE_12, 850 L/h) arrose P3 depuis le 1er janvier 2026 (LIEN_12_P3) et
 * P4 depuis le 1er janvier 2026 (LIEN_12_P4) ; V13 (VANNE_13) arrose PC-01 depuis le 1er janvier
 * 2026 (LIEN_13_PC1) ; V14 (VANNE_14) n'arrose rien. Aucune n'est placée.
 */
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';
import { CREE_LE, ecrireFermeNeuve, FERME, type OptionsFermeNeuve } from './ferme-neuve.ts';

export { FERME, UTILISATEUR } from './ferme-neuve.ts';

const id = (n: number) => `0192f0c1-5757-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const SAISON = id(0x10);
export const ZONE_TUNNEL = id(0x20);
export const ZONE_CHAMP = id(0x21);
export const P3 = id(0x30);
export const P4 = id(0x31);
export const P5 = id(0x32);
export const PC1 = id(0x33);
export const PC2 = id(0x34);
export const VANNE_12 = id(0x40);
export const VANNE_13 = id(0x41);
export const VANNE_14 = id(0x42);
export const LIEN_12_P3 = id(0x50);
export const LIEN_12_P4 = id(0x51);
export const LIEN_13_PC1 = id(0x52);

export const CODES: Readonly<Record<string, string>> = { [P3]: 'P3', [P4]: 'P4', [P5]: 'P5', [PC1]: 'PC-01', [PC2]: 'PC-02' };

export interface OptionsFermeVannes extends OptionsFermeNeuve {
  /** V12, V13 et V14, et ce qu'elles arrosent. Défaut : faux (aucune vanne). */
  readonly vannes?: boolean;
}

type Valeur = string | number | null;

async function inserer(base: Pick<BaseLocale, 'writeTransaction'>, table: NomTableLocale, lignes: readonly Readonly<Record<string, Valeur>>[]): Promise<void> {
  const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
  await base.writeTransaction(async (tx) => {
    for (const l of lignes) {
      for (const c of Object.keys(l)) if (!colonnes.includes(c)) throw new Error(`${table}.${c} absente du schéma local`);
      await tx.execute(`INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, colonnes.map((c) => l[c] ?? null));
    }
  });
}

export async function ecrireFermeVannes(base: Pick<BaseLocale, 'writeTransaction'>, options: OptionsFermeVannes = {}): Promise<void> {
  await ecrireFermeNeuve(base, options);
  const horo = { cree_le: CREE_LE, modifie_le: CREE_LE, supprime_le: null };
  await inserer(base, 'saison', [{ id: SAISON, ferme_id: FERME, nom: '2026', debut: '2026-01-01', fin: '2026-12-31', ...horo }]);
  await inserer(base, 'zone', [
    { id: ZONE_TUNNEL, ferme_id: FERME, nom: 'Tunnel 2', zone_parente_id: null, type_abri: 'tunnel', surface_m2: null, contour: null, ...horo },
    { id: ZONE_CHAMP, ferme_id: FERME, nom: 'Plein champ', zone_parente_id: null, type_abri: 'plein_champ', surface_m2: null, contour: null, ...horo },
  ]);
  const planche = (pid: string, zone: string) => ({
    id: pid,
    ferme_id: FERME,
    zone_id: zone,
    code: CODES[pid] ?? '?',
    sorte: 'planche',
    longueur_m: 30,
    largeur_m: 0.8,
    nombre_places: null,
    actif_du: '2026-01-01',
    actif_au: null,
    remplace: '[]',
    placement_x_m: null,
    placement_y_m: null,
    orientation_deg: null,
    ...horo,
  });
  await inserer(base, 'emplacement', [planche(P3, ZONE_TUNNEL), planche(P4, ZONE_TUNNEL), planche(P5, ZONE_TUNNEL), planche(PC1, ZONE_CHAMP), planche(PC2, ZONE_CHAMP)]);
  if (options.vannes !== true) return;
  const vanne = (vid: string, numero: number, debit: number | null) => ({
    id: vid,
    ferme_id: FERME,
    numero_vanne: numero,
    nom: `V${String(numero)}`,
    debit_litres_heure: debit,
    adresse_modbus: null,
    placement_x_m: null,
    placement_y_m: null,
    ...horo,
  });
  await inserer(base, 'secteur_irrigation', [vanne(VANNE_12, 12, 850), vanne(VANNE_13, 13, null), vanne(VANNE_14, 14, null)]);
  const lien = (lid: string, vid: string, pid: string) => ({ id: lid, ferme_id: FERME, secteur_irrigation_id: vid, emplacement_id: pid, du: '2026-01-01', au: null, ...horo });
  await inserer(base, 'secteur_emplacement', [lien(LIEN_12_P3, VANNE_12, P3), lien(LIEN_12_P4, VANNE_12, P4), lien(LIEN_13_PC1, VANNE_13, PC1)]);
}
