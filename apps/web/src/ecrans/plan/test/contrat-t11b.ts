/**
 * Contrat de T11b — suites de la relecture de T11 (docs/backlog/T11b-plan-suites.md). Types seuls
 * pour les modules lus par import dynamique, plus la ferme des tests (FERME_T11B) et son
 * chargement dans une base mémoire.
 *
 * ── Règles testées ───────────────────────────────────────────────────────────────────────────
 *
 * 1. Libellé collant (suites-affichage.test.tsx). Dans chaque barre, le libellé (le <span> enfant
 *    direct de [data-testid="barre"]) est `position: sticky` avec `left` ≥ LARGEUR_ETIQUETTE_PX
 *    (le bord droit de la colonne des codes, collée à gauche) : une barre qui commence avant la
 *    zone visible garde son libellé lisible en entier, au bord de la colonne des codes. Pour que
 *    `sticky` agisse, ni la barre, ni la ligne, ni la grille ne doivent avoir un `overflow`
 *    différent de `visible` (un tel ancêtre deviendrait le conteneur de défilement du libellé).
 *
 * 2. Plus de deux sortes de conflit sur une planche (suites-affichage.test.tsx). Une planche en
 *    conflit montre :
 *      - 1 ou 2 sortes : un [data-testid="conflit"] par sorte, comme aujourd'hui (libellés courts
 *        de LIBELLES_COURTS_ATTENDUS) ;
 *      - 3 sortes ou plus : UN SEUL [data-testid="conflit"], de texte exact
 *        `${LIBELLES_COURTS_ATTENDUS[première sorte]} +${nombre de sortes - 1}` (« Chevauche +2 »),
 *        la première sorte étant celle du premier conflit de la ligne (ordre de T03).
 *    L'étiquette reste un <button data-testid="etiquette-conflit"> du code, qui ouvre la liste
 *    complète. Elle ne déborde jamais sur la ligne suivante : sa mise en forme calculée a
 *    `overflow` ≠ visible et une `height` ≠ auto (comme toute étiquette de ligne).
 *
 * 3. Zones supprimées (zones-supprimees.test.ts). `zone.supprime_le` non nul : la zone et ses
 *    planches n'existent plus pour le plan. `lireDonneesPlan` (donc `lireStructure`),
 *    `lireDebutDePlan` (début ET `.structure`, qui réserve la hauteur) ne rendent ni la zone, ni
 *    ses emplacements (même non supprimés eux-mêmes) ; aucun plan construit dessus n'a de ligne
 *    pour elles. Même décision que les autres lignes supprimées (décision du chef).
 *
 * 4. Focus rendu à la fermeture (suites-affichage.test.tsx). Que la feuille (détail d'une série
 *    ou conflits d'une planche) se ferme par « Fermer » ou par Échap :
 *      - le focus revient à l'élément qui l'a ouverte : la barre (même data-occupation) ou
 *        l'étiquette de conflit (même ligne) ;
 *      - cet élément est retrouvé par son identité (occupation, ligne), pas par la référence
 *        gardée à l'ouverture : la virtualisation peut avoir retiré la ligne puis remis une
 *        NOUVELLE barre dans le DOM entre-temps ;
 *      - si la barre n'existe plus mais que sa ligne est dessinée (occupation supprimée pendant
 *        que la feuille était ouverte), le focus va à la ligne ([data-testid="ligne-plan"], que
 *        l'écran rend focalisable par programme : tabindex="-1").
 *    L'identité est notée au toucher lui-même, jamais lue dans document.activeElement (un tap ne
 *    focalise pas le bouton sous Safari).
 *
 * 5. Hauteur réservée (zones-supprimees.test.ts). Pour toute saison, `totalLignes` du début
 *    (obtenirDebutDePlan) = nombre de lignes du plan complet (obtenirPlan), avec une zone sans
 *    emplacement actif et des emplacements inactifs (ni l'une ni les autres n'ont de ligne).
 *
 * 6. Morceau introuvable (src/rechargement.test.ts) : voir ce fichier.
 * 7. Garde-fou des mesures (e2e/outils.test.ts) : voir ce fichier.
 */
import type { PorteDonnees } from '@planif/sync';
import type { BaseMemoire } from '../../../../../../packages/sync/src/test/base-memoire.ts';
import type { DonneesPlan, LigneLocale, Plan, SaisonPlan } from './contrat.ts';
import { E, FERME, LIGNES_SAISON, O, PETITE_FERME, S, SAISONS, Z } from './petite-ferme.ts';

export { FERME, SAISONS };

export interface DonneesDebutDePlan extends DonneesPlan {
  readonly structure: DonneesPlan;
}

export interface PlanLu {
  readonly plan: Plan;
  readonly complet: boolean;
  readonly totalLignes: number;
}

/** Fonctions de calculs.ts lues par les tests de T11b (en plus de ModuleCalculsPlan). */
export interface ModuleCalculsT11b {
  lireDonneesPlan(porte: PorteDonnees, fermeId: string): Promise<DonneesPlan>;
  lireDebutDePlan(porte: PorteDonnees, fermeId: string, emplacements: number): Promise<DonneesDebutDePlan>;
  construirePlan(donnees: DonneesPlan, options: { readonly saison: SaisonPlan; readonly aujourdhui: string }): Plan;
  chargerSaisons(porte: PorteDonnees, fermeId: string): Promise<SaisonPlan[]>;
  readonly HAUTEUR_LIGNE_PX: number;
  readonly LARGEUR_ETIQUETTE_PX: number;
}

/** Fonctions de cache.ts lues par les tests de T11b. */
export interface ModuleCachePlan {
  obtenirDebutDePlan(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): Promise<PlanLu>;
  obtenirPlan(porte: PorteDonnees, fermeId: string, saison: SaisonPlan, aujourdhui: string): Promise<PlanLu>;
  readonly EMPLACEMENTS_DU_DEBUT: number;
}

// ── La ferme des tests ───────────────────────────────────────────────────────────────────────

const C = '2026-01-15T08:00:00.000Z';
const horo = { cree_le: C, modifie_le: C, supprime_le: null };
const SUPPRIME = '2026-03-01T08:00:00.000Z';
const id = (n: number) => `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const Z11B = {
  /** Zone supprimée, racine, qui se rangerait EN PREMIER (ordre alphabétique) si elle était lue. */
  supprimee: id(0xa10),
  /** Chapelle supprimée sous la serre. */
  chapelleSupprimee: id(0xa11),
  /** Zone vivante avec 14 planches, après toutes les autres : le début du plan s'arrête avant. */
  zeta: id(0xa12),
} as const;

export const E11B = {
  /** Trois sortes de conflit : chevauchement, dépassement, période inversée. */
  triple: id(0xa20),
  /** Deux sortes : chevauchement et période inversée. */
  double: id(0xa21),
  anciensP1: id(0xa22),
  anciensP2: id(0xa23),
  chapelleSupprimeeP1: id(0xa24),
} as const;

export const O11B = {
  tripleA: id(0xa30),
  tripleB: id(0xa31),
  tripleLong: id(0xa32),
  tripleInverse: id(0xa33),
  doubleA: id(0xa34),
  doubleB: id(0xa35),
  doubleInverse: id(0xa36),
  anciens: id(0xa37),
  chapelleSupprimee: id(0xa38),
} as const;

/** Codes des planches des zones supprimées. */
export const CODES_SUPPRIMES = ['AT-P1', 'AT-P2', 'CS-P1'] as const;
export const NOMS_ZONES_SUPPRIMEES = ['Anciens tunnels', 'Chapelle supprimée'] as const;

function zone(zid: string, nom: string, parente: string | null, supprimeLe: string | null = null): LigneLocale {
  return { id: zid, ferme_id: FERME, nom, zone_parente_id: parente, type_abri: 'tunnel', surface_m2: 300, ...horo, supprime_le: supprimeLe };
}

function emplacement(eid: string, zoneId: string, code: string, extra: Partial<Record<string, string | number | null>> = {}): LigneLocale {
  return {
    id: eid,
    ferme_id: FERME,
    zone_id: zoneId,
    code,
    sorte: 'planche',
    longueur_m: 30,
    largeur_m: 0.8,
    nombre_places: null,
    actif_du: '2022-01-01',
    actif_au: null,
    remplace: '[]',
    ...horo,
    ...extra,
  };
}

function occupation(oid: string, emplacementId: string, serieId: string, prevuDu: string, prevuAu: string, extra: Partial<Record<string, string | number | null>> = {}): LigneLocale {
  return {
    id: oid,
    ferme_id: FERME,
    emplacement_id: emplacementId,
    serie_id: serieId,
    plantation_id: null,
    evenement_id: null,
    longueur_m: 15,
    nombre_places: null,
    position_m: 0,
    prevu_du: prevuDu,
    prevu_au: prevuAu,
    reel_du: null,
    reel_au: null,
    ...horo,
    ...extra,
  };
}

const remplissage = Array.from({ length: 14 }, (_, k) => emplacement(id(0xb00 + k), Z11B.zeta, `ZZ-P${String(k + 1).padStart(2, '0')}`));

/** La petite ferme de T11, plus ce dont T11b a besoin (voir les en-têtes de chaque test). */
export const FERME_T11B: DonneesPlan = {
  ...PETITE_FERME,
  zone: [
    ...PETITE_FERME.zone,
    zone(Z11B.supprimee, 'Anciens tunnels', null, SUPPRIME),
    zone(Z11B.chapelleSupprimee, 'Chapelle supprimée', Z.serre, SUPPRIME),
    zone(Z11B.zeta, 'Zeta', null),
  ],
  emplacement: [
    ...PETITE_FERME.emplacement,
    emplacement(E11B.triple, Z.tunnel2, 'T2-P3'),
    emplacement(E11B.double, Z.tunnel2, 'T2-P4'),
    // Planches non supprimées d'une zone supprimée : elles disparaissent avec elle.
    emplacement(E11B.anciensP1, Z11B.supprimee, 'AT-P1'),
    emplacement(E11B.anciensP2, Z11B.supprimee, 'AT-P2'),
    emplacement(E11B.chapelleSupprimeeP1, Z11B.chapelleSupprimee, 'CS-P1'),
    ...remplissage,
  ],
  occupation: [
    ...PETITE_FERME.occupation,
    // T2-P3 : chevauchement (A et B, même tronçon), dépassement (40 m sur 30 m), période inversée.
    occupation(O11B.tripleA, E11B.triple, S.tomate, '2026-04-06', '2026-08-03'),
    occupation(O11B.tripleB, E11B.triple, S.laitue, '2026-06-01', '2026-07-13'),
    occupation(O11B.tripleLong, E11B.triple, S.tomateC1, '2026-09-01', '2026-10-01', { longueur_m: 40 }),
    occupation(O11B.tripleInverse, E11B.triple, S.laitue, '2026-11-10', '2026-11-01'),
    // T2-P4 : chevauchement et période inversée.
    occupation(O11B.doubleA, E11B.double, S.tomate, '2026-04-06', '2026-08-03'),
    occupation(O11B.doubleB, E11B.double, S.laitue, '2026-06-01', '2026-07-13'),
    occupation(O11B.doubleInverse, E11B.double, S.laitue, '2026-11-10', '2026-11-01'),
    occupation(O11B.anciens, E11B.anciensP1, S.tomate, '2026-04-06', '2026-08-03'),
    occupation(O11B.chapelleSupprimee, E11B.chapelleSupprimeeP1, S.tomate, '2026-04-06', '2026-08-03'),
  ],
};

async function inserer(base: BaseMemoire, table: string, ligne: LigneLocale): Promise<void> {
  const colonnes = Object.keys(ligne);
  await base.execute(
    `INSERT INTO ${table} (${colonnes.map((c) => `"${c}"`).join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
    colonnes.map((c) => ligne[c] ?? null),
  );
}

/** Écrit FERME_T11B (et ses saisons) dans la base mémoire. */
export async function remplirFermeT11b(base: BaseMemoire): Promise<void> {
  for (const l of LIGNES_SAISON) await inserer(base, 'saison', l);
  for (const table of ['famille', 'espece', 'variete', 'zone', 'emplacement', 'serie', 'plantation', 'occupation'] as const) {
    for (const l of FERME_T11B[table]) await inserer(base, table, l);
  }
}

export { E, O };
