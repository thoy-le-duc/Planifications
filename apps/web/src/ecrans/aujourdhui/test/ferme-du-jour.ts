/**
 * Ferme de test de T13 (« ferme du jour »), écrite à la main et datée RELATIVEMENT au jour
 * donné : les mêmes tâches tombent en retard ou dans la semaine quel que soit le jour où le test
 * tourne (tests d'écran : jour fixe ; e2e : jour du téléphone). Format du schéma local de
 * @planif/sync (snake_case, texte JSON), comme le jeu de T07.
 *
 * Utilisée par :
 *   - ../ecran.test.tsx (base mémoire, aujourd'hui = 2026-09-30, un mercredi, 2026-S40) ;
 *   - la page /diagnostic/amorcer.html?jeu=aujourdhui&date=AAAA-MM-JJ (e2e, voir contrat.ts) ;
 *   - apps/web/e2e/aujourdhui.e2e.ts (attendus recalculés sous Node).
 *
 * J = aujourd'hui. Contenu et ce que l'écran doit en tirer (semainier de T06, Q11, Q12) :
 *
 *   Série          mode          emplacement  dates prévues                   journal              tâche attendue
 *   Carotte        semis direct  PC-P01       mise en place J−20              —                    semis direct, 20 j de retard
 *   Chou pointu    plant acheté  T2-P03       mise en place J−7               —                    plantation, 7 j de retard
 *   Batavia        plant maison  T2-P01       semis J−30, mise en place J     semis réalisé J−30   plantation, cette semaine
 *   Radis          semis direct  T2-P05       mise en place = dimanche        —                    semis direct, cette semaine
 *   Poireau        plant acheté  PC-P02       mise en place = lundi suivant   —                    aucune (semaine suivante)
 *   Tomate         plant maison  T2-P07       récolte J−30 → J+30, en cours   semis, plantation,   aucune ; RÉCOLTE EN COURS
 *                                                                              récoltes J−30, J−7
 *   Courgette      plant acheté  PC-P03       récolte J−50 → J+20, TERMINÉE   —                    aucune, pas en cours
 *
 *   Campagne       plantation                 récolte prévue                  journal              tâche attendue
 *   Fraise         S1-G01 (gouttière)         J−10 → J+30                     —                    début de récolte, 10 j de retard ;
 *                                                                                                   RÉCOLTE EN COURS
 *   Asperge        PC-P04                     J−200 → J−150                   —                    aucune, pas en cours
 *
 * Unités de récolte (espece.unite_recolte) : tomate kg, fraise barquette, radis botte, chou et
 * batavia pièce, carotte, asperge et courgette kg, poireau pièce.
 *
 * Variante « avec travaux prévus » (T22, `{ travaux: true }` ; amorçage ?jeu=aujourdhui-travaux) :
 * mêmes lignes, et des travaux prévus dans les paramètres de l'itinéraire ET dans l'instantané de
 * la série (clé `travauxPrevus`, contrat packages/core/src/planification/test/contrat-travaux.ts) :
 *
 *   Série    indice  travail (catégorie, libellé)       repère + décalage        temps estimé      tâche attendue
 *   Batavia  0       travail_sol, grelinette (outil     mise en place −12        20 min / 100 m    J−12, 12 j de retard, 6 min
 *                    « grelinette »)
 *   Batavia  1       amendement, compost (produit       mise en place −3         30 min / planche  J−3, 3 j de retard, 30 min
 *                    « compost », 3 kg/m²)
 *   Tomate   0       entretien, désherbage, tous les    mise en place +14,       45 min / planche  J−6 (la plus récente en
 *                    14 j jusqu'à la fin de récolte     puis J−62 … J−6, J+8…                      retard), 6 j de retard, 45 min
 *   Tomate   1       entretien, palissage               dimanche de la semaine   10 min / 100 m    dimanche, cette semaine, 3 min
 *
 *   Charge de la semaine : 6 + 30 + 45 + 3 = 84 min, « 1 h 24 de travail ».
 *   Batavia : plantation non réalisée (J), donc grelinette et compost ne sont pas caducs ; ils le
 *   deviennent dès que la plantation est marquée faite (décision du chef, Q23).
 *
 * Stock : un article « Tomate Cœur de bœuf, kg » existe déjà, avec les entrées des deux récoltes
 * du journal (+5, +8) et une vente (−3) : stock de 10 kg. Aucun article pour la fraise.
 */
import { ajouterJours, ecartEnJours, lundiDeSemaine, semaineIso, type DateCalendaire } from '@planif/core';
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';

type Valeur = string | number | null;
export type LigneLocale = Readonly<Record<string, Valeur>>;

/** Jours de `a` à `b` (b − a). */
const jours = (a: DateCalendaire, b: DateCalendaire): number => ecartEnJours(a, b);

const id = (n: number) => `0192f0c1-1313-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Utilisateur de TEST (jamais un vrai compte) : sa base locale est celle que l'amorçage remplit. */
export const UTILISATEUR = id(0x1);
export const FERME = id(0x2);
const MEMBRE = id(0x3);
const SAISON = id(0x4);

const ZONE = { tunnel2: id(0x10), pleinChamp: id(0x11), serre1: id(0x12) } as const;

export const EMPLACEMENT = {
  t2p01: id(0x20),
  t2p03: id(0x21),
  t2p05: id(0x22),
  t2p07: id(0x23),
  pcp01: id(0x24),
  pcp02: id(0x25),
  pcp03: id(0x26),
  pcp04: id(0x27),
  s1g01: id(0x28),
} as const;

export const CODES: Readonly<Record<keyof typeof EMPLACEMENT, string>> = {
  t2p01: 'T2-P01',
  t2p03: 'T2-P03',
  t2p05: 'T2-P05',
  t2p07: 'T2-P07',
  pcp01: 'PC-P01',
  pcp02: 'PC-P02',
  pcp03: 'PC-P03',
  pcp04: 'PC-P04',
  s1g01: 'S1-G01',
};

const FAMILLE = {
  brassicacees: id(0x30),
  asteracees: id(0x31),
  apiacees: id(0x32),
  solanacees: id(0x33),
  rosacees: id(0x34),
  asparagacees: id(0x35),
  alliacees: id(0x36),
  cucurbitacees: id(0x37),
} as const;

export const ESPECE = {
  chou: id(0x40),
  batavia: id(0x41),
  radis: id(0x42),
  carotte: id(0x43),
  tomate: id(0x44),
  fraise: id(0x45),
  asperge: id(0x46),
  poireau: id(0x47),
  courgette: id(0x48),
} as const;

export const VARIETE = {
  filderkraut: id(0x50),
  grenobloise: id(0x51),
  flamboyant: id(0x52),
  nantaise: id(0x53),
  coeurDeBoeuf: id(0x54),
  maraDesBois: id(0x55),
} as const;

export const SERIE = {
  chou: id(0x60),
  batavia: id(0x61),
  radis: id(0x62),
  carotte: id(0x63),
  tomate: id(0x64),
  poireau: id(0x65),
  courgette: id(0x66),
} as const;

export const PLANTATION = { fraise: id(0x70), asperge: id(0x71) } as const;
export const CAMPAGNE = { fraise: id(0x72), asperge: id(0x73) } as const;

/** Article de stock déjà présent : Tomate Cœur de bœuf, en kg. */
export const ARTICLE_TOMATE = id(0x80);
/** Stock de cet article avant toute saisie (somme de ses mouvements). */
export const STOCK_TOMATE_INITIAL = 10;

/** Événements du journal de la ferme (avant toute saisie). */
export const EVENEMENT = {
  semisBatavia: id(0x90),
  semisTomate: id(0x91),
  plantationTomate: id(0x92),
  recolteTomate1: id(0x93),
  recolteTomate2: id(0x94),
} as const;

const PARAMETRES_COMMUNS = {
  periodeUsage: null,
  typeAbri: null,
  dureeAvantRecolteJours: 60,
  fenetreRecolteJours: 30,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};
const DENSITE = { sorte: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 };

function parametres(mode: 'semis_direct' | 'plant_maison' | 'plant_achete'): string {
  switch (mode) {
    case 'semis_direct':
      return JSON.stringify({ ...PARAMETRES_COMMUNS, mode, densite: DENSITE, grainesParPoquet: 1 });
    case 'plant_maison':
      return JSON.stringify({
        ...PARAMETRES_COMMUNS,
        mode,
        densite: DENSITE,
        dureePepiniereJours: 30,
        grainesParMotte: 1,
        plantsParMotte: 1,
        pertePepiniere: 5,
        alveolesParPlaque: 104,
      });
    case 'plant_achete':
      return JSON.stringify({ ...PARAMETRES_COMMUNS, mode, densite: DENSITE });
  }
}

/** Travail prévu d'itinéraire (T22), tel que rangé dans `parametres.travauxPrevus`. */
export interface TravailPrevuFerme {
  readonly categorie: string;
  readonly type: string;
  readonly repere: 'semis_pepiniere' | 'mise_en_place' | 'debut_recolte' | 'fin_recolte';
  readonly decalageJours: number;
  readonly repetition: { readonly tousLesJours: number; readonly repereFin: string } | null;
  readonly outil: string | null;
  readonly produit: { readonly nom: string; readonly quantite: { readonly valeur: number; readonly unite: string } } | null;
  readonly tempsEstime: { readonly minutes: number; readonly par: 'cent_metres' | 'planche' } | null;
}

export const GRELINETTE: TravailPrevuFerme = {
  categorie: 'travail_sol',
  type: 'grelinette',
  repere: 'mise_en_place',
  decalageJours: -12,
  repetition: null,
  outil: 'grelinette',
  produit: null,
  tempsEstime: { minutes: 20, par: 'cent_metres' },
};

export const COMPOST: TravailPrevuFerme = {
  categorie: 'amendement',
  type: 'compost',
  repere: 'mise_en_place',
  decalageJours: -3,
  repetition: null,
  outil: null,
  produit: { nom: 'compost', quantite: { valeur: 3, unite: 'kg/m²' } },
  tempsEstime: { minutes: 30, par: 'planche' },
};

export const DESHERBAGE: TravailPrevuFerme = {
  categorie: 'entretien',
  type: 'désherbage',
  repere: 'mise_en_place',
  decalageJours: 14,
  repetition: { tousLesJours: 14, repereFin: 'fin_recolte' },
  outil: null,
  produit: null,
  tempsEstime: { minutes: 45, par: 'planche' },
};

/** Palissage de la tomate : son décalage (dimanche de la semaine − mise en place) dépend du jour. */
const palissage = (decalageJours: number): TravailPrevuFerme => ({
  categorie: 'entretien',
  type: 'palissage',
  repere: 'mise_en_place',
  decalageJours,
  repetition: null,
  outil: null,
  produit: null,
  tempsEstime: { minutes: 10, par: 'cent_metres' },
});

/** Clé d'une tâche de travail prévu (T22) : `<id de la série>:travail:<indice dans travauxPrevus>`. */
export const cleTravail = (serieId: string, indice: number) => `${serieId}:travail:${String(indice)}`;

/** Libellés des catégories d'intervention, en surtitre des tâches de travail (T22). */
export const LIBELLES_CATEGORIES: Readonly<Record<string, string>> = {
  travail_sol: 'Travail du sol',
  couverture: 'Couverture',
  fertilisation: 'Fertilisation',
  amendement: 'Amendement',
  entretien: 'Entretien',
};

/**
 * Texte de la pastille de charge de la semaine (T22) : moins d'une heure « 45 min de travail » ;
 * sinon « 6 h de travail », « 1 h 24 de travail », « 1 h 05 de travail » (minutes sur deux
 * chiffres). Aucune tâche avec un temps estimé (charge 0) : pas de pastille.
 */
export function texteCharge(minutes: number): string {
  return `${texteDuree(minutes)} de travail`;
}

/** Durée d'une tâche (data-testid="temps-estime") : « 6 min », « 1 h », « 1 h 05 ». */
export function texteDuree(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m).padStart(2, '0')}`;
}

export interface OptionsFermeDuJour {
  /** T22 : ajoute les travaux prévus (voir l'en-tête). */
  readonly travaux?: boolean;
}

/** Clé d'une tâche, telle que l'écran la porte (data-cle) : `<id de la série ou campagne>:<étape>`. */
export const cleTache = (cibleId: string, etape: string) => `${cibleId}:${etape}`;

export interface FermeDuJour {
  readonly aujourdhui: string;
  readonly utilisateurId: string;
  readonly fermeId: string;
  /** Lignes à insérer, par table. */
  readonly lignes: Readonly<Partial<Record<NomTableLocale, readonly LigneLocale[]>>>;
  /** Total des lignes (ce que la page d'amorçage annonce). */
  readonly total: number;
  readonly attendu: {
    /** Clés des tâches, dans l'ordre d'affichage : en retard d'abord (par date), puis la semaine. */
    readonly taches: readonly string[];
    /** Clés des tâches en retard, et leur retard en jours. */
    readonly retards: Readonly<Record<string, number>>;
    /** Séries et campagnes proposées pour une récolte (ordre libre). */
    readonly recoltesEnCours: readonly string[];
    /** T22 : charge de la semaine en minutes (0 sans travaux prévus). */
    readonly chargeMinutes: number;
    /** T22 : temps estimé de chaque tâche de travail, en minutes (null : sans estimation). */
    readonly tempsEstimes: Readonly<Record<string, number | null>>;
  };
}

/** Construit la ferme du jour, sans rien écrire. `aujourdhui` : 'AAAA-MM-JJ'. */
export function fermeDuJour(aujourdhui: string, options: OptionsFermeDuJour = {}): FermeDuJour {
  const avecTravaux = options.travaux === true;
  const J = aujourdhui as DateCalendaire;
  const j = (n: number): string => ajouterJours(J, n);
  const semaine = semaineIso(J);
  const lundi = lundiDeSemaine(semaine.annee, semaine.semaine);
  const dimanche = ajouterJours(lundi, 6);
  const lundiSuivant = ajouterJours(lundi, 7);
  const annee = Number(aujourdhui.slice(0, 4));

  const C = `${j(-400)}T08:00:00.000Z`;
  const horo = { cree_le: C, modifie_le: C, supprime_le: null };
  const lignes: Partial<Record<NomTableLocale, LigneLocale[]>> = {};
  const ajouter = (table: NomTableLocale, l: LigneLocale) => {
    (lignes[table] ??= []).push(l);
  };

  ajouter('utilisateur', { id: UTILISATEUR, nom: 'Théophane (test)', ...horo });
  ajouter('ferme', {
    id: FERME,
    nom: 'Ferme du jour (tests)',
    fuseau_horaire: 'Europe/Paris',
    position: '{"latitude":44.35,"longitude":2.57}',
    unites: '{"longueur":"m","masse":"kg"}',
    ...horo,
  });
  ajouter('membre', { id: MEMBRE, utilisateur_id: UTILISATEUR, ferme_id: FERME, role: 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  ajouter('saison', { id: SAISON, ferme_id: FERME, nom: String(annee), debut: `${String(annee)}-01-01`, fin: `${String(annee)}-12-31`, ...horo });

  const zone = (zid: string, nom: string, typeAbri: string) => {
    ajouter('zone', { id: zid, ferme_id: FERME, nom, zone_parente_id: null, type_abri: typeAbri, surface_m2: 400, ...horo });
  };
  zone(ZONE.tunnel2, 'Tunnel 2', 'tunnel');
  zone(ZONE.pleinChamp, 'Plein champ', 'plein_champ');
  zone(ZONE.serre1, 'Serre 1', 'hors_sol');

  const zoneDe = (cle: keyof typeof EMPLACEMENT) => (cle.startsWith('t2') ? ZONE.tunnel2 : cle.startsWith('pc') ? ZONE.pleinChamp : ZONE.serre1);
  for (const cle of Object.keys(EMPLACEMENT) as (keyof typeof EMPLACEMENT)[]) {
    const gouttiere = cle === 's1g01';
    ajouter('emplacement', {
      id: EMPLACEMENT[cle],
      ferme_id: FERME,
      zone_id: zoneDe(cle),
      code: CODES[cle],
      sorte: gouttiere ? 'gouttiere' : 'planche',
      longueur_m: 30,
      largeur_m: 0.8,
      nombre_places: gouttiere ? 400 : null,
      actif_du: j(-800),
      actif_au: null,
      remplace: '[]',
      ...horo,
    });
  }

  const familles: [string, string, number, number][] = [
    [FAMILLE.brassicacees, 'Brassicacées', 4, 6],
    [FAMILLE.asteracees, 'Astéracées', 2, 3],
    [FAMILLE.apiacees, 'Apiacées', 3, 4],
    [FAMILLE.solanacees, 'Solanacées', 3, 4],
    [FAMILLE.rosacees, 'Rosacées', 4, 5],
    [FAMILLE.asparagacees, 'Asparagacées', 8, 10],
    [FAMILLE.alliacees, 'Alliacées', 4, 5],
    [FAMILLE.cucurbitacees, 'Cucurbitacées', 3, 4],
  ];
  for (const [fid, nom, min, conseille] of familles) {
    ajouter('famille', { id: fid, ferme_id: FERME, nom, delai_retour_minimal_ans: min, delai_retour_conseille_ans: conseille, ...horo });
  }

  const especes: [string, string, string, string, number][] = [
    [ESPECE.chou, 'Chou pointu', FAMILLE.brassicacees, 'piece', 0],
    [ESPECE.batavia, 'Batavia', FAMILLE.asteracees, 'piece', 0],
    [ESPECE.radis, 'Radis', FAMILLE.brassicacees, 'botte', 0],
    [ESPECE.carotte, 'Carotte', FAMILLE.apiacees, 'kg', 0],
    [ESPECE.tomate, 'Tomate', FAMILLE.solanacees, 'kg', 0],
    [ESPECE.fraise, 'Fraise', FAMILLE.rosacees, 'barquette', 1],
    [ESPECE.asperge, 'Asperge', FAMILLE.asparagacees, 'kg', 1],
    [ESPECE.poireau, 'Poireau', FAMILLE.alliacees, 'piece', 0],
    [ESPECE.courgette, 'Courgette', FAMILLE.cucurbitacees, 'kg', 0],
  ];
  for (const [eid, nom, famille, unite, perenne] of especes) {
    ajouter('espece', {
      id: eid,
      ferme_id: FERME,
      famille_id: famille,
      nom,
      categorie: nom === 'Fraise' ? 'petit_fruit' : 'legume',
      perenne,
      unite_recolte: unite,
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      ...horo,
    });
  }

  const varietes: [string, string, string][] = [
    [VARIETE.filderkraut, ESPECE.chou, 'Filderkraut'],
    [VARIETE.grenobloise, ESPECE.batavia, 'Grenobloise'],
    [VARIETE.flamboyant, ESPECE.radis, 'Flamboyant'],
    [VARIETE.nantaise, ESPECE.carotte, 'Nantaise'],
    [VARIETE.coeurDeBoeuf, ESPECE.tomate, 'Cœur de bœuf'],
    [VARIETE.maraDesBois, ESPECE.fraise, 'Mara des bois'],
  ];
  for (const [vid, eid, nom] of varietes) {
    ajouter('variete', { id: vid, ferme_id: FERME, espece_id: eid, nom, fournisseur: null, poids_mille_graines_g: 3, taux_germination: 90, ...horo });
  }

  let prochain = 0xa0;
  const nouvelId = () => id(prochain++);

  type Mode = 'semis_direct' | 'plant_maison' | 'plant_achete';
  // T22 : travaux prévus de l'itinéraire, copiés dans l'instantané de la série.
  const travauxDe = (sid: string): readonly TravailPrevuFerme[] => {
    if (!avecTravaux) return [];
    if (sid === SERIE.batavia) return [GRELINETTE, COMPOST];
    if (sid === SERIE.tomate) return [DESHERBAGE, palissage(90 + jours(J, dimanche))];
    return [];
  };
  const parametresAvecTravaux = (mode: Mode, sid: string): string => {
    const travaux = travauxDe(sid);
    return travaux.length === 0 ? parametres(mode) : JSON.stringify({ ...(JSON.parse(parametres(mode)) as object), travauxPrevus: travaux });
  };
  const serie = (
    sid: string,
    especeId: string,
    varieteId: string | null,
    mode: Mode,
    emplacement: string,
    dates: { semis: string | null; miseEnPlace: string; debutRecolte: string; finRecolte: string },
    statut: string,
  ) => {
    const itineraire = nouvelId();
    ajouter('itineraire', { id: itineraire, ferme_id: FERME, espece_id: especeId, variete_id: null, nom: `Itinéraire ${mode}`, mode, parametres: parametresAvecTravaux(mode, sid), ...horo });
    ajouter('serie', {
      id: sid,
      ferme_id: FERME,
      saison_id: SAISON,
      espece_id: especeId,
      variete_id: varieteId,
      itineraire_id: itineraire,
      parametres: parametresAvecTravaux(mode, sid),
      ancre_type: 'plantation',
      ancre_date: dates.miseEnPlace,
      prevu_semis_pepiniere: dates.semis,
      prevu_mise_en_place: dates.miseEnPlace,
      prevu_debut_recolte: dates.debutRecolte,
      prevu_fin_recolte: dates.finRecolte,
      longueur_m: 30,
      nombre_plants: null,
      statut,
      ...horo,
    });
    ajouter('occupation', {
      id: nouvelId(),
      ferme_id: FERME,
      emplacement_id: emplacement,
      serie_id: sid,
      plantation_id: null,
      evenement_id: null,
      longueur_m: 30,
      nombre_places: null,
      position_m: 0,
      prevu_du: dates.miseEnPlace,
      prevu_au: dates.finRecolte,
      reel_du: null,
      reel_au: null,
      ...horo,
    });
  };

  serie(SERIE.carotte, ESPECE.carotte, VARIETE.nantaise, 'semis_direct', EMPLACEMENT.pcp01, { semis: null, miseEnPlace: j(-20), debutRecolte: j(70), finRecolte: j(100) }, 'prevue');
  serie(SERIE.chou, ESPECE.chou, VARIETE.filderkraut, 'plant_achete', EMPLACEMENT.t2p03, { semis: null, miseEnPlace: j(-7), debutRecolte: j(53), finRecolte: j(113) }, 'prevue');
  serie(SERIE.batavia, ESPECE.batavia, VARIETE.grenobloise, 'plant_maison', EMPLACEMENT.t2p01, { semis: j(-30), miseEnPlace: j(0), debutRecolte: j(45), finRecolte: j(60) }, 'en_cours');
  serie(SERIE.radis, ESPECE.radis, VARIETE.flamboyant, 'semis_direct', EMPLACEMENT.t2p05, { semis: null, miseEnPlace: dimanche, debutRecolte: ajouterJours(dimanche, 30), finRecolte: ajouterJours(dimanche, 45) }, 'prevue');
  serie(SERIE.poireau, ESPECE.poireau, null, 'plant_achete', EMPLACEMENT.pcp02, { semis: null, miseEnPlace: lundiSuivant, debutRecolte: ajouterJours(lundiSuivant, 90), finRecolte: ajouterJours(lundiSuivant, 150) }, 'prevue');
  serie(SERIE.tomate, ESPECE.tomate, VARIETE.coeurDeBoeuf, 'plant_maison', EMPLACEMENT.t2p07, { semis: j(-140), miseEnPlace: j(-90), debutRecolte: j(-30), finRecolte: j(30) }, 'en_cours');
  serie(SERIE.courgette, ESPECE.courgette, null, 'plant_achete', EMPLACEMENT.pcp03, { semis: null, miseEnPlace: j(-100), debutRecolte: j(-50), finRecolte: j(20) }, 'terminee');

  const plantation = (pid: string, cid: string, especeId: string, varieteId: string | null, emplacement: string, debut: string, fin: string) => {
    ajouter('plantation', { id: pid, ferme_id: FERME, espece_id: especeId, variete_id: varieteId, date_plantation: j(-700), nombre_plants: 400, date_arrachage: null, ...horo });
    ajouter('campagne', {
      id: cid,
      ferme_id: FERME,
      plantation_id: pid,
      annee: Number(debut.slice(0, 4)),
      debut_recolte_prevu: debut,
      fin_recolte_prevue: fin,
      rendement_prevu: null,
      ...horo,
    });
    ajouter('occupation', {
      id: nouvelId(),
      ferme_id: FERME,
      emplacement_id: emplacement,
      serie_id: null,
      plantation_id: pid,
      evenement_id: null,
      longueur_m: null,
      nombre_places: 400,
      position_m: null,
      prevu_du: j(-700),
      prevu_au: '9999-12-31',
      reel_du: j(-700),
      reel_au: null,
      ...horo,
    });
  };
  plantation(PLANTATION.fraise, CAMPAGNE.fraise, ESPECE.fraise, VARIETE.maraDesBois, EMPLACEMENT.s1g01, j(-10), j(30));
  plantation(PLANTATION.asperge, CAMPAGNE.asperge, ESPECE.asperge, null, EMPLACEMENT.pcp04, j(-200), j(-150));

  const evenement = (eid: string, type: string, date: string, serieId: string, emplacement: string, detail: unknown) => {
    ajouter('evenement', {
      id: eid,
      ferme_id: FERME,
      type,
      date,
      horodatage: `${date}T07:30:00.000Z`,
      auteur_id: UTILISATEUR,
      source: 'tap',
      serie_id: serieId,
      campagne_id: null,
      emplacement_ids: JSON.stringify([emplacement]),
      note: null,
      photos: '[]',
      remplace_sorte: null,
      remplace_evenement_id: null,
      detail: JSON.stringify(detail),
      cree_le: `${date}T07:30:00.000Z`,
    });
  };
  evenement(EVENEMENT.semisBatavia, 'realise', j(-30), SERIE.batavia, EMPLACEMENT.t2p01, { etape: 'semis_pepiniere', quantiteReelle: null });
  evenement(EVENEMENT.semisTomate, 'realise', j(-140), SERIE.tomate, EMPLACEMENT.t2p07, { etape: 'semis_pepiniere', quantiteReelle: null });
  evenement(EVENEMENT.plantationTomate, 'realise', j(-90), SERIE.tomate, EMPLACEMENT.t2p07, { etape: 'plantation', quantiteReelle: null });
  evenement(EVENEMENT.recolteTomate1, 'recolte', j(-30), SERIE.tomate, EMPLACEMENT.t2p07, { quantite: 5, unite: 'kg', categorie: null });
  evenement(EVENEMENT.recolteTomate2, 'recolte', j(-7), SERIE.tomate, EMPLACEMENT.t2p07, { quantite: 8, unite: 'kg', categorie: null });

  ajouter('article_stock', { id: ARTICLE_TOMATE, ferme_id: FERME, espece_id: ESPECE.tomate, variete_id: VARIETE.coeurDeBoeuf, unite: 'kg', categorie: null, ...horo });
  const mouvement = (date: string, quantite: number, motif: string, recolteId: string | null) => {
    ajouter('mouvement_stock', { id: nouvelId(), ferme_id: FERME, article_stock_id: ARTICLE_TOMATE, date, quantite, motif, recolte_id: recolteId, cree_le: `${date}T08:00:00.000Z` });
  };
  mouvement(j(-30), 5, 'recolte', EVENEMENT.recolteTomate1);
  mouvement(j(-7), 8, 'recolte', EVENEMENT.recolteTomate2);
  mouvement(j(-5), -3, 'vente', null);

  const total = Object.values(lignes).reduce((n, l) => n + l.length, 0);
  const retards: Record<string, number> = {
    [cleTache(SERIE.carotte, 'semis_direct')]: 20,
    [cleTache(CAMPAGNE.fraise, 'debut_recolte')]: 10,
    [cleTache(SERIE.chou, 'plantation')]: 7,
  };
  if (!avecTravaux) {
    return {
      aujourdhui,
      utilisateurId: UTILISATEUR,
      fermeId: FERME,
      lignes,
      total,
      attendu: {
        taches: [
          cleTache(SERIE.carotte, 'semis_direct'),
          cleTache(CAMPAGNE.fraise, 'debut_recolte'),
          cleTache(SERIE.chou, 'plantation'),
          cleTache(SERIE.batavia, 'plantation'),
          cleTache(SERIE.radis, 'semis_direct'),
        ],
        retards,
        recoltesEnCours: [SERIE.tomate, CAMPAGNE.fraise],
        chargeMinutes: 0,
        tempsEstimes: {},
      },
    };
  }
  // Avec travaux : en retard d'abord par date (J−20, J−12, J−10, J−7, J−6, J−3), puis la
  // semaine par date et par code d'emplacement (T2-P01, T2-P05, T2-P07 le même jour).
  return {
    aujourdhui,
    utilisateurId: UTILISATEUR,
    fermeId: FERME,
    lignes,
    total,
    attendu: {
      taches: [
        cleTache(SERIE.carotte, 'semis_direct'),
        cleTravail(SERIE.batavia, 0),
        cleTache(CAMPAGNE.fraise, 'debut_recolte'),
        cleTache(SERIE.chou, 'plantation'),
        cleTravail(SERIE.tomate, 0),
        cleTravail(SERIE.batavia, 1),
        cleTache(SERIE.batavia, 'plantation'),
        cleTache(SERIE.radis, 'semis_direct'),
        cleTravail(SERIE.tomate, 1),
      ],
      retards: {
        ...retards,
        [cleTravail(SERIE.batavia, 0)]: 12,
        [cleTravail(SERIE.tomate, 0)]: 6,
        [cleTravail(SERIE.batavia, 1)]: 3,
      },
      recoltesEnCours: [SERIE.tomate, CAMPAGNE.fraise],
      chargeMinutes: 84,
      tempsEstimes: {
        [cleTravail(SERIE.batavia, 0)]: 6,
        [cleTravail(SERIE.batavia, 1)]: 30,
        [cleTravail(SERIE.tomate, 0)]: 45,
        [cleTravail(SERIE.tomate, 1)]: 3,
      },
    },
  };
}

/**
 * Écrit la ferme du jour dans `base` (base mémoire des tests, ou PowerSync dans la page
 * d'amorçage), une transaction par table, colonnes du schéma local. Rend la ferme construite.
 */
export async function ecrireFermeDuJour(base: Pick<BaseLocale, 'writeTransaction'>, aujourdhui: string, options: OptionsFermeDuJour = {}): Promise<FermeDuJour> {
  const ferme = fermeDuJour(aujourdhui, options);
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
