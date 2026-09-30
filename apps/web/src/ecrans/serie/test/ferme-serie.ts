/**
 * Ferme de test de T12 (« ferme du plan »), écrite à la main, dates FIXES (les années comptent
 * pour la rotation). Format du schéma local de @planif/sync (snake_case, texte JSON), comme la
 * ferme du jour de T13.
 *
 * Utilisée par :
 *   - ../ecran.test.tsx et ../plan.test.tsx (base mémoire, aujourd'hui = 2026-09-30) ;
 *   - la page /diagnostic/amorcer.html?jeu=serie (e2e, voir contrat.ts, « Amorçage ») ;
 *   - apps/web/e2e/serie.e2e.ts.
 *
 * Parcellaire : Serre (racine) → chapelles C2 (C2-P01) et C3 (C3-P01, C3-P02) ; Tunnel 2 (racine)
 * → T2-P01, T2-P02, T2-P03. Toutes les planches font 30 m × 0,8 m, actives depuis 2020.
 * Saisons : 2023, 2026, 2027 (années civiles).
 *
 * Bibliothèque de la ferme :
 *   Famille        délais (min / conseillé)   espèces
 *   Brassicacées   4 / 6                      Chou (délais propres 4 / 6, comme T04), variété Filderkraut
 *   Astéracées     2 / 3                      Batavia, variété Grenobloise (germination 90 %, PMG inconnu)
 *   Rosacées       4 / 5                      Fraise (pérenne)
 *   + Blette (supprimée : jamais proposée) ; Mâche et Valérianacées dans la bibliothèque commune
 *     (ferme_id nul).
 *
 * Itinéraires :
 *   Batavia de printemps  plant maison, S08–S20, pépinière 28 j, avant récolte 49 j, fenêtre
 *                         14 j (le batavia de T02) ; 3 rangs à 30 cm, 1 graine et 1 plant par
 *                         motte, perte 5 %, plaques de 104, marge 10 % (le batavia de T05)
 *   Batavia d'été         plant maison, S21–S35, pépinière 21 j, avant récolte 42 j, fenêtre 10 j
 *   Chou d'automne        plant acheté, S30–S45, avant récolte 90 j, fenêtre 30 j, 2 rangs à 40 cm
 *
 * Déjà planifié et historique :
 *   - série SERIE_LAITUE : Batavia Grenobloise, itinéraire de printemps, ancre plantation
 *     2027-04-05 (T02, ligne 1), 30 m sur T2-P02, une occupation (OCCUPATION_LAITUE) ;
 *   - plantation de fraises sur T2-P03 depuis 2024 (occupation sans fin, en lecture seule) ;
 *   - assolement PASSÉ saisi : Brassicacées sur toute la chapelle C3 en 2023 (le jeu de T04).
 *
 * Attendus (voir ATTENDU) :
 *   - batavia de printemps planté en 2027-S14 : dates de T02 ligne 1 ; récolte à partir de
 *     2027-S22 : dates de T02 ligne 2 ; sur 30 m : besoins de T05 (300 plants, 330 mottes à
 *     planter, 348 mottes à semer, 387 graines, 4 plaques) ;
 *   - choux plantés sur C3-P02 : 2026 → alerte rouge (écart 3 < 4), 2027 → orange (4), 2029 →
 *     aucune (6) ; sur C2-P01 : aucune (autre chapelle) ;
 *   - une batavia sur T2-P02 aux dates de SERIE_LAITUE : conflit « surcharge » (30 m + 30 m sur
 *     une planche de 30 m, sans position).
 */
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';

type Valeur = string | number | null;
export type LigneLocale = Readonly<Record<string, Valeur>>;

const id = (n: number) => `0192f0c1-1212-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Utilisateur de TEST (jamais un vrai compte) : sa base locale est celle que l'amorçage remplit. */
export const UTILISATEUR = id(0x1);
export const FERME = id(0x2);
const MEMBRE = id(0x3);

export const SAISON = { s2023: id(0x4), s2026: id(0x5), s2027: id(0x6) } as const;

export const ZONE = { serre: id(0x10), c2: id(0x11), c3: id(0x12), tunnel2: id(0x13) } as const;

export const EMPLACEMENT = {
  c2p01: id(0x20),
  c3p01: id(0x21),
  c3p02: id(0x22),
  t2p01: id(0x23),
  t2p02: id(0x24),
  t2p03: id(0x25),
} as const;

export const CODES: Readonly<Record<keyof typeof EMPLACEMENT, string>> = {
  c2p01: 'C2-P01',
  c3p01: 'C3-P01',
  c3p02: 'C3-P02',
  t2p01: 'T2-P01',
  t2p02: 'T2-P02',
  t2p03: 'T2-P03',
};

export const FAMILLE = { brassicacees: id(0x30), asteracees: id(0x31), rosacees: id(0x32), valerianacees: id(0x33) } as const;

export const ESPECE = { chou: id(0x40), batavia: id(0x41), fraise: id(0x42), blette: id(0x43), mache: id(0x44) } as const;

export const VARIETE = { filderkraut: id(0x50), grenobloise: id(0x51) } as const;

export const ITINERAIRE = { bataviaPrintemps: id(0x60), bataviaEte: id(0x61), chouAutomne: id(0x62) } as const;

export const SERIE_LAITUE = id(0x70);
export const OCCUPATION_LAITUE = id(0x71);
export const PLANTATION_FRAISE = id(0x72);
export const OCCUPATION_FRAISE = id(0x73);
const ASSOLEMENT_C3 = id(0x74);

/** Horodatage de création de toutes les lignes du jeu. */
export const CREE_LE = '2025-01-01T08:00:00.000Z';

const DENSITE_BATAVIA = { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 };

/** Instantanés (parametres) des itinéraires, tels que la série doit les recopier. */
export const PARAMETRES: Readonly<Record<keyof typeof ITINERAIRE, Readonly<Record<string, unknown>>>> = {
  bataviaPrintemps: {
    mode: 'plant_maison',
    periodeUsage: { semaineDebut: 8, semaineFin: 20 },
    typeAbri: 'tunnel',
    dureePepiniereJours: 28,
    dureeAvantRecolteJours: 49,
    fenetreRecolteJours: 14,
    margeSecurite: 10,
    rendementAttendu: null,
    perenne: null,
    densite: DENSITE_BATAVIA,
    grainesParMotte: 1,
    plantsParMotte: 1,
    pertePepiniere: 5,
    alveolesParPlaque: 104,
  },
  bataviaEte: {
    mode: 'plant_maison',
    periodeUsage: { semaineDebut: 21, semaineFin: 35 },
    typeAbri: 'tunnel',
    dureePepiniereJours: 21,
    dureeAvantRecolteJours: 42,
    fenetreRecolteJours: 10,
    margeSecurite: 10,
    rendementAttendu: null,
    perenne: null,
    densite: DENSITE_BATAVIA,
    grainesParMotte: 1,
    plantsParMotte: 1,
    pertePepiniere: 5,
    alveolesParPlaque: 104,
  },
  chouAutomne: {
    mode: 'plant_achete',
    periodeUsage: { semaineDebut: 30, semaineFin: 45 },
    typeAbri: null,
    dureeAvantRecolteJours: 90,
    fenetreRecolteJours: 30,
    margeSecurite: 10,
    rendementAttendu: null,
    perenne: null,
    densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 40 },
  },
};

export const NOMS_ITINERAIRES: Readonly<Record<keyof typeof ITINERAIRE, string>> = {
  bataviaPrintemps: 'Batavia de printemps',
  bataviaEte: 'Batavia d’été',
  chouAutomne: 'Chou d’automne',
};

/** Dates attendues (T02) et besoins attendus (T05). */
export const ATTENDU = {
  /** Batavia de printemps, ancre plantation 2027-S14 (lundi 2027-04-05) : T02, ligne 1. */
  bataviaPlantationS14: { semisPepiniere: '2027-03-08', miseEnPlace: '2027-04-05', debutRecolte: '2027-05-24', finRecolte: '2027-06-07' },
  /** Même batavia, récolte à partir de 2027-S22 (lundi 2027-05-31) : T02, ligne 2. */
  bataviaRecolteS22: { semisPepiniere: '2027-03-15', miseEnPlace: '2027-04-12', debutRecolte: '2027-05-31', finRecolte: '2027-06-14' },
  /** Batavia de printemps sur 30 m : le cas « avec perte en pépinière et plaques » de T05. */
  besoinsBatavia30m: { mottesEnPlace: 300, plants: 300, mottesAPlanter: 330, mottesASemer: 348, graines: 387, plaques: 4 },
} as const;

export interface FermeSerie {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: Readonly<Partial<Record<NomTableLocale, readonly LigneLocale[]>>>;
  readonly total: number;
}

/** Construit la ferme du plan, sans rien écrire. */
export function fermeSerie(): FermeSerie {
  const horo = { cree_le: CREE_LE, modifie_le: CREE_LE, supprime_le: null };
  const lignes: Partial<Record<NomTableLocale, LigneLocale[]>> = {};
  const ajouter = (table: NomTableLocale, l: LigneLocale) => {
    (lignes[table] ??= []).push(l);
  };

  ajouter('utilisateur', { id: UTILISATEUR, nom: 'Théophane (test plan)', ...horo });
  ajouter('ferme', {
    id: FERME,
    nom: 'Ferme du plan (tests)',
    fuseau_horaire: 'Europe/Paris',
    position: '{"latitude":44.35,"longitude":2.57}',
    unites: '{"longueur":"m","masse":"kg"}',
    ...horo,
  });
  ajouter('membre', { id: MEMBRE, utilisateur_id: UTILISATEUR, ferme_id: FERME, role: 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  for (const [cle, sid] of Object.entries(SAISON)) {
    const annee = cle.slice(1);
    ajouter('saison', { id: sid, ferme_id: FERME, nom: annee, debut: `${annee}-01-01`, fin: `${annee}-12-31`, ...horo });
  }

  const zone = (zid: string, nom: string, parente: string | null, typeAbri: string) => {
    ajouter('zone', { id: zid, ferme_id: FERME, nom, zone_parente_id: parente, type_abri: typeAbri, surface_m2: 300, ...horo });
  };
  zone(ZONE.serre, 'Serre', null, 'serre');
  zone(ZONE.c2, 'C2', ZONE.serre, 'serre');
  zone(ZONE.c3, 'C3', ZONE.serre, 'serre');
  zone(ZONE.tunnel2, 'Tunnel 2', null, 'tunnel');

  const zoneDe: Readonly<Record<keyof typeof EMPLACEMENT, string>> = {
    c2p01: ZONE.c2,
    c3p01: ZONE.c3,
    c3p02: ZONE.c3,
    t2p01: ZONE.tunnel2,
    t2p02: ZONE.tunnel2,
    t2p03: ZONE.tunnel2,
  };
  for (const cle of Object.keys(EMPLACEMENT) as (keyof typeof EMPLACEMENT)[]) {
    ajouter('emplacement', {
      id: EMPLACEMENT[cle],
      ferme_id: FERME,
      zone_id: zoneDe[cle],
      code: CODES[cle],
      sorte: 'planche',
      longueur_m: 30,
      largeur_m: 0.8,
      nombre_places: null,
      actif_du: '2020-01-01',
      actif_au: null,
      remplace: '[]',
      ...horo,
    });
  }

  ajouter('famille', { id: FAMILLE.brassicacees, ferme_id: FERME, nom: 'Brassicacées', delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6, ...horo });
  ajouter('famille', { id: FAMILLE.asteracees, ferme_id: FERME, nom: 'Astéracées', delai_retour_minimal_ans: 2, delai_retour_conseille_ans: 3, ...horo });
  ajouter('famille', { id: FAMILLE.rosacees, ferme_id: FERME, nom: 'Rosacées', delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 5, ...horo });
  ajouter('famille', { id: FAMILLE.valerianacees, ferme_id: null, nom: 'Valérianacées', delai_retour_minimal_ans: 2, delai_retour_conseille_ans: 3, ...horo });

  const espece = (eid: string, ferme: string | null, nom: string, famille: string, unite: string, perenne: number, delais: [number, number] | null, supprimeLe: string | null = null) => {
    ajouter('espece', {
      id: eid,
      ferme_id: ferme,
      famille_id: famille,
      nom,
      categorie: nom === 'Fraise' ? 'petit_fruit' : 'legume',
      perenne,
      unite_recolte: unite,
      delai_retour_minimal_ans: delais?.[0] ?? null,
      delai_retour_conseille_ans: delais?.[1] ?? null,
      ...horo,
      supprime_le: supprimeLe,
    });
  };
  espece(ESPECE.chou, FERME, 'Chou', FAMILLE.brassicacees, 'piece', 0, [4, 6]);
  espece(ESPECE.batavia, FERME, 'Batavia', FAMILLE.asteracees, 'piece', 0, null);
  espece(ESPECE.fraise, FERME, 'Fraise', FAMILLE.rosacees, 'barquette', 1, null);
  espece(ESPECE.blette, FERME, 'Blette', FAMILLE.asteracees, 'botte', 0, null, '2026-01-15T08:00:00.000Z');
  espece(ESPECE.mache, null, 'Mâche', FAMILLE.valerianacees, 'kg', 0, null);

  ajouter('variete', { id: VARIETE.filderkraut, ferme_id: FERME, espece_id: ESPECE.chou, nom: 'Filderkraut', fournisseur: null, poids_mille_graines_g: 3.5, taux_germination: 85, ...horo });
  ajouter('variete', { id: VARIETE.grenobloise, ferme_id: FERME, espece_id: ESPECE.batavia, nom: 'Grenobloise', fournisseur: null, poids_mille_graines_g: null, taux_germination: 90, ...horo });

  const itineraire = (cle: keyof typeof ITINERAIRE, especeId: string) => {
    const p = PARAMETRES[cle];
    ajouter('itineraire', {
      id: ITINERAIRE[cle],
      ferme_id: FERME,
      espece_id: especeId,
      variete_id: null,
      nom: NOMS_ITINERAIRES[cle],
      mode: String(p.mode),
      parametres: JSON.stringify(p),
      ...horo,
    });
  };
  itineraire('bataviaPrintemps', ESPECE.batavia);
  itineraire('bataviaEte', ESPECE.batavia);
  itineraire('chouAutomne', ESPECE.chou);

  const d = ATTENDU.bataviaPlantationS14;
  ajouter('serie', {
    id: SERIE_LAITUE,
    ferme_id: FERME,
    saison_id: SAISON.s2027,
    espece_id: ESPECE.batavia,
    variete_id: VARIETE.grenobloise,
    itineraire_id: ITINERAIRE.bataviaPrintemps,
    parametres: JSON.stringify(PARAMETRES.bataviaPrintemps),
    ancre_type: 'plantation',
    ancre_date: d.miseEnPlace,
    prevu_semis_pepiniere: d.semisPepiniere,
    prevu_mise_en_place: d.miseEnPlace,
    prevu_debut_recolte: d.debutRecolte,
    prevu_fin_recolte: d.finRecolte,
    longueur_m: 30,
    nombre_plants: null,
    statut: 'prevue',
    rotation_acceptee: null,
    ...horo,
  });
  ajouter('occupation', {
    id: OCCUPATION_LAITUE,
    ferme_id: FERME,
    emplacement_id: EMPLACEMENT.t2p02,
    serie_id: SERIE_LAITUE,
    plantation_id: null,
    evenement_id: null,
    longueur_m: 30,
    nombre_places: null,
    position_m: null,
    prevu_du: d.miseEnPlace,
    prevu_au: d.finRecolte,
    reel_du: null,
    reel_au: null,
    ...horo,
  });

  ajouter('plantation', {
    id: PLANTATION_FRAISE,
    ferme_id: FERME,
    espece_id: ESPECE.fraise,
    variete_id: null,
    date_plantation: '2024-04-01',
    nombre_plants: 200,
    date_arrachage: null,
    ...horo,
  });
  ajouter('occupation', {
    id: OCCUPATION_FRAISE,
    ferme_id: FERME,
    emplacement_id: EMPLACEMENT.t2p03,
    serie_id: null,
    plantation_id: PLANTATION_FRAISE,
    evenement_id: null,
    longueur_m: 30,
    nombre_places: null,
    position_m: null,
    prevu_du: '2024-04-01',
    prevu_au: '9999-12-31',
    reel_du: '2024-04-01',
    reel_au: null,
    ...horo,
  });

  ajouter('assolement', {
    id: ASSOLEMENT_C3,
    ferme_id: FERME,
    saison_id: SAISON.s2023,
    zone_id: ZONE.c3,
    emplacement_id: null,
    famille_id: FAMILLE.brassicacees,
    espece_id: null,
    nature: 'passe_saisi',
    source_import: null,
    ...horo,
  });

  const total = Object.values(lignes).reduce((n, l) => n + l.length, 0);
  return { utilisateurId: UTILISATEUR, fermeId: FERME, lignes, total };
}

/**
 * Écrit la ferme du plan dans `base` (base mémoire des tests, ou PowerSync dans la page
 * d'amorçage), une transaction par table, colonnes du schéma local. Rend la ferme construite.
 */
export async function ecrireFermeSerie(base: Pick<BaseLocale, 'writeTransaction'>): Promise<FermeSerie> {
  const ferme = fermeSerie();
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
