/**
 * Petite ferme de T11, écrite à la main pour des résultats chiffrés : zones, chapelles, une
 * sous-chapelle, emplacements actifs et inactifs, occupations réelles et prévues, un
 * chevauchement, un dépassement, une plantation pérenne, une couverture, et des conflits hors
 * saison qui ne doivent pas apparaître.
 *
 * Saison 2026 (2026-01-01 → 2026-12-31) : colonnes 2026-S01 (lundi 2025-12-29) à 2026-S53.
 */
import type { DonneesPlan, LigneLocale, SaisonPlan } from './contrat.ts';

export const FERME = '0192f0c1-0000-7000-8000-00000000f001';
const C = '2026-01-15T08:00:00.000Z';
const horo = { cree_le: C, modifie_le: C, supprime_le: null };

const id = (n: number) => `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const SAISONS: readonly SaisonPlan[] = [
  { id: id(0x901), nom: '2025', debut: '2025-01-01', fin: '2025-12-31' },
  { id: id(0x902), nom: '2026', debut: '2026-01-01', fin: '2026-12-31' },
  { id: id(0x903), nom: '2027', debut: '2027-01-01', fin: '2027-12-31' },
];
function saison(i: number): SaisonPlan {
  const s = SAISONS[i];
  if (s === undefined) throw new Error(`saison ${String(i)} absente`);
  return s;
}
export const SAISON_2025 = saison(0);
export const SAISON_2026 = saison(1);

export const Z = {
  tunnel10: id(0x10),
  tunnel2: id(0x11),
  serre: id(0x12),
  chapelle2: id(0x13),
  chapelle1: id(0x14),
  demiChapelle: id(0x15),
  vide: id(0x16),
} as const;

export const E = {
  t2p10: id(0x20),
  t2p2: id(0x21),
  t10p1: id(0x22),
  sp1: id(0x23),
  c1p1: id(0x24),
  c2p1: id(0x25),
  dcp1: id(0x26),
  ancien: id(0x27),
  futur: id(0x28),
  supprime: id(0x29),
} as const;

export const O = {
  tomateReelle: id(0x31),
  laituePrevue: id(0x32),
  courgetteHiver: id(0x33),
  laitue2027: id(0x34),
  supprimee: id(0x35),
  plantation: id(0x36),
  depassement: id(0x37),
  couverture: id(0x38),
  horsSaisonA: id(0x39),
  horsSaisonB: id(0x3a),
  sp1Seule: id(0x3b),
} as const;

export const S = { tomate: id(0x41), laitue: id(0x42), courgette: id(0x43), laitue2027: id(0x44), tomateC1: id(0x45), hs: id(0x46), sp1: id(0x47) } as const;
export const PLANTATION = id(0x51);
export const EVENEMENT_COUVERTURE = id(0x52);

const FAM = { solanacees: id(0x61), asteracees: id(0x62), cucurbitacees: id(0x63) } as const;
const ESP = { tomate: id(0x71), laitue: id(0x72), courgette: id(0x73) } as const;
const VAR = { coeurDeBoeuf: id(0x81), batavia: id(0x82) } as const;

function zone(zid: string, nom: string, parente: string | null): LigneLocale {
  return { id: zid, ferme_id: FERME, nom, zone_parente_id: parente, type_abri: 'tunnel', surface_m2: 300, ...horo };
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

function occupation(
  oid: string,
  emplacementId: string,
  occupant: { serie_id?: string; plantation_id?: string; evenement_id?: string },
  prevuDu: string,
  prevuAu: string,
  extra: Partial<Record<string, string | number | null>> = {},
): LigneLocale {
  return {
    id: oid,
    ferme_id: FERME,
    emplacement_id: emplacementId,
    serie_id: occupant.serie_id ?? null,
    plantation_id: occupant.plantation_id ?? null,
    evenement_id: occupant.evenement_id ?? null,
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

function serie(sid: string, saisonId: string, especeId: string, varieteId: string | null, miseEnPlace: string, finRecolte: string): LigneLocale {
  return {
    id: sid,
    ferme_id: FERME,
    saison_id: saisonId,
    espece_id: especeId,
    variete_id: varieteId,
    itineraire_id: null,
    parametres: '{}',
    ancre_type: 'plantation',
    ancre_date: miseEnPlace,
    prevu_semis_pepiniere: null,
    prevu_mise_en_place: miseEnPlace,
    prevu_debut_recolte: miseEnPlace,
    prevu_fin_recolte: finRecolte,
    longueur_m: 15,
    nombre_plants: null,
    statut: 'prevue',
    ...horo,
  };
}

const S25 = SAISONS[0]?.id ?? '';
const S26 = SAISON_2026.id;
const S27 = SAISONS[2]?.id ?? '';

export const PETITE_FERME: DonneesPlan = {
  zone: [
    zone(Z.tunnel10, 'Tunnel 10', null),
    zone(Z.tunnel2, 'Tunnel 2', null),
    zone(Z.serre, 'Serre', null),
    zone(Z.chapelle2, 'Chapelle 2', Z.serre),
    zone(Z.chapelle1, 'Chapelle 1', Z.serre),
    zone(Z.demiChapelle, 'Demi-chapelle', Z.chapelle1),
    zone(Z.vide, 'Verger', null),
  ],
  emplacement: [
    emplacement(E.t2p10, Z.tunnel2, 'T2-P10'),
    emplacement(E.t2p2, Z.tunnel2, 'T2-P2'),
    emplacement(E.t10p1, Z.tunnel10, 'T10-P1'),
    emplacement(E.sp1, Z.serre, 'S-P1'),
    emplacement(E.c1p1, Z.chapelle1, 'C1-P1', { longueur_m: 10 }),
    emplacement(E.c2p1, Z.chapelle2, 'C2-P1'),
    emplacement(E.dcp1, Z.demiChapelle, 'DC-P1'),
    // Inactifs sur 2026 : fini le jour où la saison commence ([du, au[), à venir, supprimé.
    emplacement(E.ancien, Z.vide, 'V-P1', { actif_au: '2026-01-01' }),
    emplacement(E.futur, Z.tunnel2, 'T2-P99', { actif_du: '2027-01-01' }),
    emplacement(E.supprime, Z.tunnel2, 'T2-P98', { supprime_le: '2026-02-01T08:00:00.000Z' }),
  ],
  occupation: [
    // T2-P2 : tomate plantée le 8 avril (réel), fin prévue le 3 août.
    occupation(O.tomateReelle, E.t2p2, { serie_id: S.tomate }, '2026-04-06', '2026-08-03', { reel_du: '2026-04-08' }),
    // Même tronçon (0–15 m) du 1er juin au 13 juillet : chevauchement.
    occupation(O.laituePrevue, E.t2p2, { serie_id: S.laitue }, '2026-06-01', '2026-07-13'),
    // Tronçon 15–30 m, commencée en 2025 : bornée au début de la saison.
    occupation(O.courgetteHiver, E.t2p2, { serie_id: S.courgette }, '2025-10-01', '2026-02-02', { position_m: 15 }),
    // 2027 : hors saison.
    occupation(O.laitue2027, E.t2p2, { serie_id: S.laitue2027 }, '2027-03-01', '2027-04-01'),
    // Supprimée : ni barre ni conflit.
    occupation(O.supprimee, E.t2p2, { serie_id: S.laitue }, '2026-05-01', '2026-06-15', { supprime_le: '2026-03-01T08:00:00.000Z' }),
    // T10-P1 : plantation pérenne sans fin (9999-12-31).
    occupation(O.plantation, E.t10p1, { plantation_id: PLANTATION }, '2024-03-01', '9999-12-31', { position_m: null, longueur_m: 30 }),
    // C1-P1 (10 m) : tronçon de 15 m depuis 0 → dépassement.
    occupation(O.depassement, E.c1p1, { serie_id: S.tomateC1 }, '2026-05-04', '2026-09-07'),
    // C2-P1 : bâche.
    occupation(O.couverture, E.c2p1, { evenement_id: EVENEMENT_COUVERTURE }, '2026-02-02', '2026-03-02'),
    // S-P1 : chevauchement en 2025 seulement, puis une série seule en 2026.
    occupation(O.horsSaisonA, E.sp1, { serie_id: S.hs }, '2025-03-03', '2025-05-05'),
    occupation(O.horsSaisonB, E.sp1, { serie_id: S.hs }, '2025-04-07', '2025-06-02'),
    occupation(O.sp1Seule, E.sp1, { serie_id: S.sp1 }, '2026-03-02', '2026-04-27'),
  ],
  serie: [
    serie(S.tomate, S26, ESP.tomate, VAR.coeurDeBoeuf, '2026-04-06', '2026-08-03'),
    serie(S.laitue, S26, ESP.laitue, VAR.batavia, '2026-06-01', '2026-07-13'),
    serie(S.courgette, S25, ESP.courgette, null, '2025-10-01', '2026-02-02'),
    serie(S.laitue2027, S27, ESP.laitue, VAR.batavia, '2027-03-01', '2027-04-01'),
    serie(S.tomateC1, S26, ESP.tomate, VAR.coeurDeBoeuf, '2026-05-04', '2026-09-07'),
    serie(S.hs, S25, ESP.laitue, null, '2025-03-03', '2025-05-05'),
    serie(S.sp1, S26, ESP.laitue, VAR.batavia, '2026-03-02', '2026-04-27'),
  ],
  plantation: [
    { id: PLANTATION, ferme_id: FERME, espece_id: ESP.tomate, variete_id: null, date_plantation: '2024-03-01', nombre_plants: 40, date_arrachage: null, ...horo },
  ],
  espece: [
    { id: ESP.tomate, ferme_id: null, famille_id: FAM.solanacees, nom: 'Tomate', categorie: 'legume', perenne: 0, unite_recolte: 'kg', delai_retour_minimal_ans: null, delai_retour_conseille_ans: null, ...horo },
    { id: ESP.laitue, ferme_id: null, famille_id: FAM.asteracees, nom: 'Laitue', categorie: 'legume', perenne: 0, unite_recolte: 'piece', delai_retour_minimal_ans: null, delai_retour_conseille_ans: null, ...horo },
    { id: ESP.courgette, ferme_id: FERME, famille_id: FAM.cucurbitacees, nom: 'Courgette', categorie: 'legume', perenne: 0, unite_recolte: 'kg', delai_retour_minimal_ans: null, delai_retour_conseille_ans: null, ...horo },
  ],
  variete: [
    { id: VAR.coeurDeBoeuf, ferme_id: null, espece_id: ESP.tomate, nom: 'Cœur de bœuf', fournisseur: null, poids_mille_graines_g: 3, taux_germination: 90, ...horo },
    { id: VAR.batavia, ferme_id: FERME, espece_id: ESP.laitue, nom: 'Batavia', fournisseur: null, poids_mille_graines_g: 1, taux_germination: 90, ...horo },
  ],
  famille: [
    { id: FAM.solanacees, ferme_id: null, nom: 'Solanacées', delai_retour_minimal_ans: 3, delai_retour_conseille_ans: 4, ...horo },
    { id: FAM.asteracees, ferme_id: null, nom: 'Astéracées', delai_retour_minimal_ans: 2, delai_retour_conseille_ans: 3, ...horo },
    { id: FAM.cucurbitacees, ferme_id: FERME, nom: 'Cucurbitacées', delai_retour_minimal_ans: 3, delai_retour_conseille_ans: 4, ...horo },
  ],
};

/** Lignes de saison au format local, pour remplir une base. */
export const LIGNES_SAISON: readonly LigneLocale[] = SAISONS.map((s) => ({ id: s.id, ferme_id: FERME, nom: s.nom, debut: s.debut, fin: s.fin, ...horo }));
