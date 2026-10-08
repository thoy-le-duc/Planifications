/**
 * Ferme de test de T28b (« ferme du placement »), écrite à la main, format du schéma local de
 * @planif/sync (snake_case, texte JSON).
 *
 * Utilisée par :
 *   - ../editeur.test.tsx (base mémoire, avec ou sans origine, en gérant ou en équipier) ;
 *   - la page /diagnostic/amorcer.html?jeu=placement (sans origine, en gérant) : à brancher dans
 *     src/donnees/amorcer.ts (amorcerPlacement, comme ?jeu=import), lue par e2e/placement.e2e.ts.
 *
 * Ferme « Ferme du placement (tests) », position météo 44° N, 1,5° E.
 *   UTILISATEUR : gérant actif (ou équipier, option `role`).
 *   Zones : « Tunnel 1 » (ZONE_TUNNEL, sans contour) ; « Plein champ » (ZONE_CHAMP).
 *   Planche « PC-01 » (PLANCHE) dans Plein champ, 25 × 0,8 m.
 * Option `origine` (défaut : faux) : origine du plan = la position météo, ET les placements :
 *   - contour de Plein champ : (100, 0) (140, 0) (140, 30) (100, 30), antihoraire ; repère :
 *     centre (120, 15), cap 90° (plus long côté est-ouest) ;
 *   - PC-01 placée en (0, 0, 0°) dans Plein champ, donc centrée en (120, 15), cap 90° dans la ferme ;
 *   - HANGAR « Hangar » (hangar) 20 × 12 × 6 m, centre (−10, 15), 0°, sans zone ;
 *   - SERRE « Serre M1 » (serre tunnel) 30 × 8 × 3,5 m, centre (40, 40), 0°, sans zone.
 * Sans origine, rien n'est placé (règle de T28s : aucun placement sans point de départ).
 */
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';

type Valeur = string | number | null;
export type LigneLocale = Readonly<Record<string, Valeur>>;

const id = (n: number) => `0192f0c1-28b0-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Utilisateur de TEST (jamais un vrai compte) : sa base locale est celle que l'amorçage remplit. */
export const UTILISATEUR = id(0x1);
export const FERME = id(0x2);
const MEMBRE = id(0x3);
export const ZONE_TUNNEL = id(0x10);
export const ZONE_CHAMP = id(0x11);
export const PLANCHE = id(0x20);
export const SAISON = id(0x40);
export const HANGAR = id(0x30);
export const SERRE = id(0x31);

export const POSITION = { latitude: 44, longitude: 1.5 } as const;
export const CONTOUR_CHAMP = [
  { x: 100, y: 0 },
  { x: 140, y: 0 },
  { x: 140, y: 30 },
  { x: 100, y: 30 },
] as const;
export const CREE_LE = '2026-01-01T08:00:00.000Z';

export interface OptionsFermePlacement {
  /** Origine du plan posée (= POSITION) et éléments placés. Défaut : faux. */
  readonly origine?: boolean;
  /** Rôle de UTILISATEUR. Défaut : 'gerant'. */
  readonly role?: 'gerant' | 'equipier';
  /** T28e : la ferme n'a pas de position (ferme.position = null). Incompatible avec `origine`. Défaut : faux. */
  readonly sansPosition?: boolean;
  /**
   * T28f : une saison « 2026 » (2026-01-01 → 2026-12-31), pour que l'écran Planches (donc la vue 3D)
   * ait un plan à montrer. Défaut : faux (aucune saison, comme avant : les tests de T28b/T28e ne changent pas).
   */
  readonly saison?: boolean;
}

export interface FermePlacement {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: Readonly<Partial<Record<NomTableLocale, readonly LigneLocale[]>>>;
  readonly total: number;
}

export function fermePlacement(options: OptionsFermePlacement = {}): FermePlacement {
  const origine = options.origine ?? false;
  const horo = { cree_le: CREE_LE, modifie_le: CREE_LE, supprime_le: null };
  const lignes: Partial<Record<NomTableLocale, LigneLocale[]>> = {};
  const ajouter = (table: NomTableLocale, l: LigneLocale) => {
    (lignes[table] ??= []).push(l);
  };
  if (origine && options.sansPosition === true) throw new Error('origine et sansPosition sont incompatibles');
  const position = JSON.stringify(POSITION);

  ajouter('utilisateur', { id: UTILISATEUR, nom: 'Théophane (test placement)', ...horo });
  ajouter('ferme', {
    id: FERME,
    nom: 'Ferme du placement (tests)',
    fuseau_horaire: 'Europe/Paris',
    position: options.sansPosition === true ? null : position,
    origine_plan: origine ? position : null,
    unites: '{"longueur":"m","masse":"kg"}',
    ...horo,
  });
  ajouter('membre', { id: MEMBRE, utilisateur_id: UTILISATEUR, ferme_id: FERME, role: options.role ?? 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  if (options.saison === true) ajouter('saison', { id: SAISON, ferme_id: FERME, nom: '2026', debut: '2026-01-01', fin: '2026-12-31', ...horo });
  ajouter('zone', { id: ZONE_TUNNEL, ferme_id: FERME, nom: 'Tunnel 1', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240, contour: null, ...horo });
  ajouter('zone', {
    id: ZONE_CHAMP,
    ferme_id: FERME,
    nom: 'Plein champ',
    zone_parente_id: null,
    type_abri: 'plein_champ',
    surface_m2: 1200,
    contour: origine ? JSON.stringify(CONTOUR_CHAMP) : null,
    ...horo,
  });
  ajouter('emplacement', {
    id: PLANCHE,
    ferme_id: FERME,
    zone_id: ZONE_CHAMP,
    code: 'PC-01',
    sorte: 'planche',
    longueur_m: 25,
    largeur_m: 0.8,
    nombre_places: null,
    actif_du: '2020-01-01',
    actif_au: null,
    remplace: '[]',
    placement_x_m: origine ? 0 : null,
    placement_y_m: origine ? 0 : null,
    orientation_deg: origine ? 0 : null,
    ...horo,
  });
  if (origine) {
    const batiment = (bid: string, nom: string, type: string, l: [number, number, number], centre: [number, number]) => {
      ajouter('batiment', {
        id: bid,
        ferme_id: FERME,
        nom,
        type,
        longueur_m: l[0],
        largeur_m: l[1],
        hauteur_m: l[2],
        centre_x_m: centre[0],
        centre_y_m: centre[1],
        orientation_deg: 0,
        zone_id: null,
        ...horo,
      });
    };
    batiment(HANGAR, 'Hangar', 'hangar', [20, 12, 6], [-10, 15]);
    batiment(SERRE, 'Serre M1', 'serre_tunnel', [30, 8, 3.5], [40, 40]);
  }
  const total = Object.values(lignes).reduce((n, l) => n + l.length, 0);
  return { utilisateurId: UTILISATEUR, fermeId: FERME, lignes, total };
}

export async function ecrireFermePlacement(base: Pick<BaseLocale, 'writeTransaction'>, options: OptionsFermePlacement = {}): Promise<FermePlacement> {
  const ferme = fermePlacement(options);
  for (const [table, liste] of Object.entries(ferme.lignes) as [NomTableLocale, readonly LigneLocale[]][]) {
    const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
    for (const l of liste) {
      for (const cle of Object.keys(l)) if (!colonnes.includes(cle)) throw new Error(`${table}.${cle} absente du schéma local`);
    }
    const sql = `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`;
    await base.writeTransaction(async (tx) => {
      for (const l of liste) await tx.execute(sql, colonnes.map((c) => l[c] ?? null));
    });
  }
  return ferme;
}
