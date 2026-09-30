/**
 * Ferme de test de T24 (« ferme des itinéraires »), écrite à la main, datée relativement au jour
 * `jour` ('AAAA-MM-JJ') : les tests d'écran la prennent au 2026-09-30 (AUJOURDHUI_TESTS), l'e2e
 * au jour du navigateur (l'écran Aujourd'hui lit la date du téléphone). Format du schéma local de
 * @planif/sync (snake_case, texte JSON), comme la ferme du plan de T12.
 *
 * Utilisée par :
 *   - ../ecran.test.tsx, ../series.test.tsx, ../types.test.tsx, ../../ferme/itineraires.test.tsx
 *     (base mémoire) ;
 *   - la page /diagnostic/amorcer.html?jeu=itineraires&date=AAAA-MM-JJ (voir contrat.ts,
 *     « Amorçage ») ;
 *   - apps/web/e2e/itineraires.e2e.ts.
 *
 * Parcellaire : Tunnel 1 → planches T1-P01 à T1-P08, 30 m × 0,8 m, actives depuis 2020. T1-P01
 * reste libre (la nouvelle série de l'e2e). Saisons : année de `jour` − 1, année, année + 1.
 *
 * Bibliothèque commune (ferme_id nul, lecture seule) :
 *   - famille Astéracées, espèce Batavia ;
 *   - itinéraire « Batavia » (ITINERAIRE.batavia) : plant maison, S18–S30, pépinière 21 j, avant
 *     récolte 28 j (la « batavia d'été » de T22), fenêtre 14 j, 3 rangs à 30 cm, sans travaux ;
 *   - la liste de départ des types d'intervention (TYPES_INTERVENTION_PAR_DEFAUT, une ligne par
 *     libellé, ids TYPE_DEPART).
 *
 * Ferme :
 *   - famille Brassicacées ; espèces Chou et Radis ;
 *   - itinéraire « Batavia de la ferme » (ITINERAIRE.bataviaFerme), sur la Batavia de la
 *     bibliothèque : plant maison, S08–S20, pépinière 28 j, avant récolte 49 j, fenêtre 14 j,
 *     travaux : [0] compost 15 j avant la mise en place (amendement, 2 kg/m²),
 *     [1] binette 7 j après la mise en place (entretien, outil « houe », 20 min par 100 m) ;
 *   - itinéraire « Chou d’automne » (ITINERAIRE.chouAutomne) : plant acheté, S30–S45, avant
 *     récolte 90 j, fenêtre 30 j, 2 rangs à 40 cm, aucun travail, aucune série ;
 *   - itinéraire « Batavia 2025 » (ITINERAIRE.ancien), SUPPRIMÉ : son travail « voile
 *     anti-insectes » ne compte pas comme une utilisation (décision 3 du chef, T23) ;
 *   - types de la ferme : « binette » (entretien, UTILISÉ par Batavia de la ferme), « voile
 *     anti-insectes » (couverture, pas utilisé : seul l'itinéraire supprimé le cite),
 *     « rouleau » (travail du sol, MASQUÉ, pas utilisé).
 *
 * Séries de « Batavia de la ferme » (instantané = PARAMETRES.bataviaFerme, dates de T02), J = jour :
 *   SERIE.passee      plantation J−150, statut 'terminee'                          T1-P02
 *   SERIE.commencee   plantation J+40 (semis prévu J+12), semis en pépinière RÉALISÉ
 *                     à J−2 (fait en avance), statut 'prevue'                       T1-P03
 *   SERIE.enRetard    plantation J+20 : semis prévu J−8 déjà passé, rien de réalisé  T1-P04
 *   SERIE.aVenir1     plantation J+35 (semis prévu J+7)                              T1-P05
 *   SERIE.aVenir2     ancre « récolte à partir de » J+120 (mise en place J+71)       T1-P06
 *   SERIE.supprimee   plantation J+60, supprimée (et son occupation)                 T1-P07
 * Et SERIE.bibliotheque, sur l'itinéraire « Batavia » de la bibliothèque, plantation J+30, T1-P08.
 * Une occupation par série (prevu_du = mise en place, prevu_au = fin de récolte, 30 m).
 *
 * Séries à venir de « Batavia de la ferme » (règle du contrat) : aVenir1 et aVenir2, seulement.
 */
import {
  ajouterJours,
  calculerDatesSerie,
  TYPES_INTERVENTION_PAR_DEFAUT,
  type AncreSerie,
  type DateCalendaire,
  type DatesSerie,
  type ParametresDatesSerie,
} from '@planif/core';
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';

type Valeur = string | number | null;
export type LigneLocale = Readonly<Record<string, Valeur>>;

const id = (n: number) => `0192f0c1-2424-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Jour des tests d'écran (mercredi). */
export const AUJOURDHUI_TESTS = '2026-09-30';

/** Utilisateur de TEST (jamais un vrai compte) : sa base locale est celle que l'amorçage remplit. */
export const UTILISATEUR = id(0x1);
export const FERME = id(0x2);
const MEMBRE = id(0x3);

export const SAISON = { precedente: id(0x4), courante: id(0x5), suivante: id(0x6) } as const;

export const ZONE_TUNNEL = id(0x10);

export const EMPLACEMENT = {
  t1p01: id(0x20),
  t1p02: id(0x21),
  t1p03: id(0x22),
  t1p04: id(0x23),
  t1p05: id(0x24),
  t1p06: id(0x25),
  t1p07: id(0x26),
  t1p08: id(0x27),
} as const;

export const CODES: Readonly<Record<keyof typeof EMPLACEMENT, string>> = {
  t1p01: 'T1-P01',
  t1p02: 'T1-P02',
  t1p03: 'T1-P03',
  t1p04: 'T1-P04',
  t1p05: 'T1-P05',
  t1p06: 'T1-P06',
  t1p07: 'T1-P07',
  t1p08: 'T1-P08',
};

export const FAMILLE = { asteracees: id(0x30), brassicacees: id(0x31) } as const;

export const ESPECE = { batavia: id(0x40), chou: id(0x41), radis: id(0x42) } as const;

export const ITINERAIRE = { batavia: id(0x60), bataviaFerme: id(0x61), chouAutomne: id(0x62), ancien: id(0x63) } as const;

export const NOMS_ITINERAIRES: Readonly<Record<keyof typeof ITINERAIRE, string>> = {
  batavia: 'Batavia',
  bataviaFerme: 'Batavia de la ferme',
  chouAutomne: 'Chou d’automne',
  ancien: 'Batavia 2025',
};

/** Types d'intervention de la ferme. */
export const TYPE = { binette: id(0x80), voile: id(0x81), rouleau: id(0x82) } as const;

export const LIBELLES_TYPES: Readonly<Record<keyof typeof TYPE, { readonly categorie: string; readonly libelle: string; readonly masque: 0 | 1 }>> = {
  binette: { categorie: 'entretien', libelle: 'binette', masque: 0 },
  voile: { categorie: 'couverture', libelle: 'voile anti-insectes', masque: 0 },
  rouleau: { categorie: 'travail_sol', libelle: 'rouleau', masque: 1 },
};

/** Liste de départ (ferme_id nul) : une ligne par (catégorie, libellé) de TYPES_INTERVENTION_PAR_DEFAUT. */
export const TYPES_DEPART: readonly { readonly id: string; readonly categorie: string; readonly libelle: string }[] = Object.entries(
  TYPES_INTERVENTION_PAR_DEFAUT,
).flatMap(([categorie, libelles], i) => libelles.map((libelle, k) => ({ id: id(0x100 + i * 0x10 + k), categorie, libelle })));

/** Id du type de départ (catégorie, libellé). */
export function typeDepart(categorie: string, libelle: string): string {
  const t = TYPES_DEPART.find((x) => x.categorie === categorie && x.libelle === libelle);
  if (t === undefined) throw new Error(`type de départ inconnu : ${categorie} / ${libelle}`);
  return t.id;
}

export const SERIE = {
  passee: id(0x90),
  commencee: id(0x91),
  enRetard: id(0x92),
  aVenir1: id(0x93),
  aVenir2: id(0x94),
  supprimee: id(0x95),
  bibliotheque: id(0x96),
} as const;

/** Occupation de chaque série (même clé). */
export const OCCUPATION: Readonly<Record<keyof typeof SERIE, string>> = {
  passee: id(0xa0),
  commencee: id(0xa1),
  enRetard: id(0xa2),
  aVenir1: id(0xa3),
  aVenir2: id(0xa4),
  supprimee: id(0xa5),
  bibliotheque: id(0xa6),
};

export const EVENEMENT_SEMIS_COMMENCEE = id(0xb0);

/** Horodatage de création de toutes les lignes du jeu. */
export const CREE_LE = '2025-01-01T08:00:00.000Z';
const SUPPRIME_LE = '2026-01-15T08:00:00.000Z';

const DENSITE_BATAVIA = { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 };

/** Paramètres (texte JSON rangé dans itineraire.parametres) des itinéraires du jeu. */
export const PARAMETRES: Readonly<Record<keyof typeof ITINERAIRE, Readonly<Record<string, unknown>>>> = {
  batavia: {
    mode: 'plant_maison',
    periodeUsage: { semaineDebut: 18, semaineFin: 30 },
    typeAbri: null,
    dureePepiniereJours: 21,
    dureeAvantRecolteJours: 28,
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
  bataviaFerme: {
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
    travauxPrevus: [
      {
        categorie: 'amendement',
        type: 'compost',
        repere: 'mise_en_place',
        decalageJours: -15,
        repetition: null,
        outil: null,
        produit: { nom: 'compost', quantite: { valeur: 2, unite: 'kg/m²' } },
        tempsEstime: null,
      },
      {
        categorie: 'entretien',
        type: 'binette',
        repere: 'mise_en_place',
        decalageJours: 7,
        repetition: null,
        outil: 'houe',
        produit: null,
        tempsEstime: { minutes: 20, par: 'cent_metres' },
      },
    ],
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
    travauxPrevus: [],
  },
  ancien: {
    mode: 'plant_maison',
    periodeUsage: null,
    typeAbri: null,
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
    travauxPrevus: [
      {
        categorie: 'couverture',
        type: 'voile anti-insectes',
        repere: 'mise_en_place',
        decalageJours: 0,
        repetition: null,
        outil: null,
        produit: null,
        tempsEstime: null,
      },
    ],
  },
};

/** Dates de T02 pour `parametres` et `ancre` (moteur du cœur). */
export function datesDe(parametres: Readonly<Record<string, unknown>>, ancre: AncreSerie): DatesSerie {
  return calculerDatesSerie(parametres as unknown as ParametresDatesSerie, ancre);
}

export interface DescriptionSerie {
  readonly itineraire: keyof typeof ITINERAIRE;
  readonly ancre: AncreSerie;
  readonly emplacement: keyof typeof EMPLACEMENT;
  readonly statut: string;
  readonly supprimee: boolean;
}

/** Séries du jeu, datées relativement à `jour`. */
export function seriesDuJeu(jour: string): Readonly<Record<keyof typeof SERIE, DescriptionSerie>> {
  const j = (n: number): DateCalendaire => ajouterJours(jour as DateCalendaire, n);
  const s = (
    itineraire: keyof typeof ITINERAIRE,
    type: AncreSerie['type'],
    decalage: number,
    emplacement: keyof typeof EMPLACEMENT,
    statut = 'prevue',
    supprimee = false,
  ): DescriptionSerie => ({ itineraire, ancre: { type, date: j(decalage) }, emplacement, statut, supprimee });
  return {
    passee: s('bataviaFerme', 'plantation', -150, 't1p02', 'terminee'),
    commencee: s('bataviaFerme', 'plantation', 40, 't1p03'),
    enRetard: s('bataviaFerme', 'plantation', 20, 't1p04'),
    aVenir1: s('bataviaFerme', 'plantation', 35, 't1p05'),
    aVenir2: s('bataviaFerme', 'debut_recolte', 120, 't1p06'),
    supprimee: s('bataviaFerme', 'plantation', 60, 't1p07', 'prevue', true),
    bibliotheque: s('batavia', 'plantation', 30, 't1p08'),
  };
}

export interface FermeItineraires {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: Readonly<Partial<Record<NomTableLocale, readonly LigneLocale[]>>>;
  readonly total: number;
}

/** Construit la ferme des itinéraires au jour `jour`, sans rien écrire. */
export function fermeItineraires(jour: string = AUJOURDHUI_TESTS): FermeItineraires {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) throw new Error(`jour invalide : « ${jour} »`);
  const annee = Number(jour.slice(0, 4));
  const horo = { cree_le: CREE_LE, modifie_le: CREE_LE, supprime_le: null };
  const lignes: Partial<Record<NomTableLocale, LigneLocale[]>> = {};
  const ajouter = (table: NomTableLocale, l: LigneLocale) => {
    (lignes[table] ??= []).push(l);
  };

  ajouter('utilisateur', { id: UTILISATEUR, nom: 'Théophane (test itinéraires)', ...horo });
  ajouter('ferme', {
    id: FERME,
    nom: 'Ferme des itinéraires (tests)',
    fuseau_horaire: 'Europe/Paris',
    position: '{"latitude":44.35,"longitude":2.57}',
    unites: '{"longueur":"m","masse":"kg"}',
    ...horo,
  });
  ajouter('membre', { id: MEMBRE, utilisateur_id: UTILISATEUR, ferme_id: FERME, role: 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  const saisons: [string, number][] = [
    [SAISON.precedente, annee - 1],
    [SAISON.courante, annee],
    [SAISON.suivante, annee + 1],
  ];
  for (const [sid, a] of saisons) ajouter('saison', { id: sid, ferme_id: FERME, nom: String(a), debut: `${String(a)}-01-01`, fin: `${String(a)}-12-31`, ...horo });
  const saisonDe = (date: string): string => saisons.find(([, a]) => date.startsWith(`${String(a)}-`))?.[0] ?? SAISON.courante;

  ajouter('zone', { id: ZONE_TUNNEL, ferme_id: FERME, nom: 'Tunnel 1', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 400, ...horo });
  for (const cle of Object.keys(EMPLACEMENT) as (keyof typeof EMPLACEMENT)[]) {
    ajouter('emplacement', {
      id: EMPLACEMENT[cle],
      ferme_id: FERME,
      zone_id: ZONE_TUNNEL,
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

  ajouter('famille', { id: FAMILLE.asteracees, ferme_id: null, nom: 'Astéracées', delai_retour_minimal_ans: 2, delai_retour_conseille_ans: 3, ...horo });
  ajouter('famille', { id: FAMILLE.brassicacees, ferme_id: FERME, nom: 'Brassicacées', delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6, ...horo });
  const espece = (eid: string, ferme: string | null, nom: string, famille: string, unite: string) => {
    ajouter('espece', {
      id: eid,
      ferme_id: ferme,
      famille_id: famille,
      nom,
      categorie: 'legume',
      perenne: 0,
      unite_recolte: unite,
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      ...horo,
    });
  };
  espece(ESPECE.batavia, null, 'Batavia', FAMILLE.asteracees, 'piece');
  espece(ESPECE.chou, FERME, 'Chou', FAMILLE.brassicacees, 'piece');
  espece(ESPECE.radis, FERME, 'Radis', FAMILLE.brassicacees, 'botte');

  const itineraire = (cle: keyof typeof ITINERAIRE, ferme: string | null, especeId: string, supprimeLe: string | null = null) => {
    const p = PARAMETRES[cle];
    ajouter('itineraire', {
      id: ITINERAIRE[cle],
      ferme_id: ferme,
      espece_id: especeId,
      variete_id: null,
      nom: NOMS_ITINERAIRES[cle],
      mode: String(p.mode),
      parametres: JSON.stringify(p),
      ...horo,
      supprime_le: supprimeLe,
    });
  };
  itineraire('batavia', null, ESPECE.batavia);
  itineraire('bataviaFerme', FERME, ESPECE.batavia);
  itineraire('chouAutomne', FERME, ESPECE.chou);
  itineraire('ancien', FERME, ESPECE.batavia, SUPPRIME_LE);

  for (const t of TYPES_DEPART) ajouter('type_intervention', { id: t.id, ferme_id: null, categorie: t.categorie, libelle: t.libelle, masque: 0, ...horo });
  for (const cle of Object.keys(TYPE) as (keyof typeof TYPE)[]) {
    const t = LIBELLES_TYPES[cle];
    ajouter('type_intervention', { id: TYPE[cle], ferme_id: FERME, categorie: t.categorie, libelle: t.libelle, masque: t.masque, ...horo });
  }

  const series = seriesDuJeu(jour);
  for (const cle of Object.keys(SERIE) as (keyof typeof SERIE)[]) {
    const s = series[cle];
    const p = PARAMETRES[s.itineraire];
    const d = datesDe(p, s.ancre);
    const suppression = s.supprimee ? SUPPRIME_LE : null;
    ajouter('serie', {
      id: SERIE[cle],
      ferme_id: FERME,
      saison_id: saisonDe(d.miseEnPlace),
      espece_id: ESPECE.batavia,
      variete_id: null,
      itineraire_id: ITINERAIRE[s.itineraire],
      parametres: JSON.stringify(p),
      ancre_type: s.ancre.type,
      ancre_date: s.ancre.date,
      prevu_semis_pepiniere: d.semisPepiniere ?? null,
      prevu_mise_en_place: d.miseEnPlace,
      prevu_debut_recolte: d.debutRecolte,
      prevu_fin_recolte: d.finRecolte,
      longueur_m: 30,
      nombre_plants: null,
      statut: s.statut,
      rotation_acceptee: null,
      ...horo,
      supprime_le: suppression,
    });
    ajouter('occupation', {
      id: OCCUPATION[cle],
      ferme_id: FERME,
      emplacement_id: EMPLACEMENT[s.emplacement],
      serie_id: SERIE[cle],
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
      supprime_le: suppression,
    });
  }

  const dateSemis = ajouterJours(jour as DateCalendaire, -2);
  ajouter('evenement', {
    id: EVENEMENT_SEMIS_COMMENCEE,
    ferme_id: FERME,
    type: 'realise',
    date: dateSemis,
    horodatage: `${dateSemis}T07:30:00.000Z`,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: SERIE.commencee,
    campagne_id: null,
    emplacement_ids: JSON.stringify([EMPLACEMENT.t1p03]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ etape: 'semis_pepiniere', quantiteReelle: null }),
    cree_le: `${dateSemis}T07:30:00.000Z`,
  });

  const total = Object.values(lignes).reduce((n, l) => n + l.length, 0);
  return { utilisateurId: UTILISATEUR, fermeId: FERME, lignes, total };
}

/**
 * Écrit la ferme des itinéraires dans `base` (base mémoire des tests, ou PowerSync dans la page
 * d'amorçage), une transaction par table, colonnes du schéma local. Rend la ferme construite.
 */
export async function ecrireFermeItineraires(base: Pick<BaseLocale, 'writeTransaction'>, jour: string = AUJOURDHUI_TESTS): Promise<FermeItineraires> {
  const ferme = fermeItineraires(jour);
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
