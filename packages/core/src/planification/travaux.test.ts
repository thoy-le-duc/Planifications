/**
 * Tests d'acceptation T22 (2/2) — dates des travaux prévus, instantané d'une série, semainier
 * (tâches, retards, soldes par une intervention, temps estimé) et charge de la semaine.
 *
 * Contrat complet : ./test/contrat-travaux.ts. Validation : ../saisies/travaux.test.ts.
 *
 * Exemple du ticket : « batavia de T02, mise en place le 2027-05-03, début de récolte le
 * 2027-05-31 ». La batavia de T02 a 49 jours avant récolte (début le 2027-06-21) : les 28 jours
 * qu'il faut pour un début de récolte au 2027-05-31 sont ceux d'une batavia d'été. Les tests
 * prennent donc BATAVIA_ETE (pépinière 28 j, 28 j avant récolte, fenêtre 14 j) pour garder les
 * dates du ticket, et vérifient aussi la batavia de T02.
 *
 * Décisions du testeur (à confirmer par Théophane, voir le rapport) :
 *   - le repère de fin d'une répétition est compris (« sans dépasser » : 05-31 est listé) ;
 *   - un travail tombe toujours à repère + décalage ; la répétition ajoute des occurrences.
 *     « Désherbage tous les 14 j de la mise en place au début de récolte → 05-17 et 05-31 »
 *     s'écrit donc décalage +14 (le premier désherbage 14 j après la plantation) ; avec un
 *     décalage 0 il y aurait aussi un désherbage le jour de la plantation ;
 *   - repère absent pour le mode (semis pépinière d'un semis direct) : refusé à l'écriture
 *     (validation), ignoré sans lever au calcul ;
 *   - une intervention solde l'occurrence la plus proche de sa date et toutes les précédentes
 *     (Q11) ; une seule ligne en retard par travail, la plus récente ;
 *   - décision du chef (Q23, remplace le choix 7 du testeur) : une occurrence datée avant son
 *     repère devient caduque dès que l'étape repère est réalisée (ou rendue faite par Q11).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { mesurer } from '../test/mesurer.ts';
import {
  chargerTravaux,
  type DatesSerieLues,
  type EmplacementLu,
  type InterventionRealisee,
  type ModuleTravaux,
  type RealisesLus,
  type SerieSemainierLue,
  type TacheLue,
  type TravailPrevuLu,
} from './test/contrat-travaux.ts';

let m: ModuleTravaux;

beforeAll(async () => {
  m = await chargerTravaux();
});

// ---------------------------------------------------------------------------------------------
// Jeu d'essai
// ---------------------------------------------------------------------------------------------

/** Batavia d'été : plant maison, pépinière 28 j, 28 j avant récolte, fenêtre 14 j. */
const BATAVIA_ETE = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 28,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
} as const;

/** Semis pépinière 2027-04-05, mise en place 2027-05-03, récolte 2027-05-31 → 2027-06-14. */
const DATES_ETE: DatesSerieLues = {
  semisPepiniere: '2027-04-05',
  miseEnPlace: '2027-05-03',
  debutRecolte: '2027-05-31',
  finRecolte: '2027-06-14',
};

function travail(t: Partial<TravailPrevuLu> & Pick<TravailPrevuLu, 'categorie' | 'type' | 'repere' | 'decalageJours'>): TravailPrevuLu {
  return { repetition: null, outil: null, produit: null, tempsEstime: null, ...t };
}

/** Grelinette 10 jours avant la mise en place, 20 min par 100 m. */
const GRELINETTE = travail({
  categorie: 'travail_sol',
  type: 'grelinette',
  repere: 'mise_en_place',
  decalageJours: -10,
  outil: 'grelinette',
  tempsEstime: { minutes: 20, par: 'cent_metres' },
});

/** Faux semis 7 jours avant la mise en place, sans temps estimé. */
const FAUX_SEMIS = travail({ categorie: 'travail_sol', type: 'faux semis', repere: 'mise_en_place', decalageJours: -7 });

/** Désherbage tous les 14 j, de 14 j après la mise en place jusqu'au début de récolte ; 30 min par planche. */
const DESHERBAGE = travail({
  categorie: 'entretien',
  type: 'désherbage',
  repere: 'mise_en_place',
  decalageJours: 14,
  repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
  tempsEstime: { minutes: 30, par: 'planche' },
});

const T2_P03: EmplacementLu = { id: 'emp-T2-P03', code: 'T2-P03', zone: 'Tunnel 2' };
const T2_P04: EmplacementLu = { id: 'emp-T2-P04', code: 'T2-P04', zone: 'Tunnel 2' };

function serie(autres: Partial<SerieSemainierLue> = {}): SerieSemainierLue {
  return {
    id: 'batavia-ete',
    statut: 'prevue',
    mode: 'plant_maison',
    culture: 'Laitue',
    variete: 'Batavia blonde',
    datesPrevues: DATES_ETE,
    taille: { unite: 'longueur', longueurM: 30 },
    emplacements: [T2_P04, T2_P03],
    travauxPrevus: [GRELINETTE, FAUX_SEMIS, DESHERBAGE],
    ...autres,
  };
}

function realises(
  interventions: readonly (readonly [string, readonly InterventionRealisee[]])[] = [],
  series: readonly (readonly [string, Readonly<Record<string, string>>])[] = [],
): RealisesLus {
  return { series: new Map(series), campagnes: new Map(), interventions: new Map(interventions) };
}

const intervention = (date: string, type: string, categorie = type === 'désherbage' ? 'entretien' : 'travail_sol'): InterventionRealisee => ({
  date,
  categorie,
  type,
});

/** Copie profonde (pas de structuredClone : `lib: ES2023` seulement). */
const copie = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** L'objet sans sa clé `travauxPrevus` (ligne écrite avant T22). */
function sansTravaux<T extends object>(o: T): Omit<T, 'travauxPrevus'> {
  return Object.fromEntries(Object.entries(o).filter(([cle]) => cle !== 'travauxPrevus')) as Omit<T, 'travauxPrevus'>;
}

const s = (annee: number, semaine: number): { annee: number; semaine: number } => ({ annee, semaine });

/** Tâches de travail seulement, résumées : 'type:date' (+ ':retard N'). */
function travaux(taches: readonly TacheLue[]): string[] {
  return taches
    .filter((t) => t.etape === 'travail')
    .map((t) => `${t.travail?.type ?? '?'}:${t.datePrevue}${t.enRetard ? `:retard ${String(t.joursDeRetard)}` : ''}`);
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

describe('datesTravailPrevu : exemples chiffrés du ticket (mise en place 2027-05-03)', () => {
  it('grelinette à −10 → 2027-04-23', () => {
    expect(m.datesTravailPrevu(GRELINETTE, DATES_ETE)).toStrictEqual(['2027-04-23']);
  });

  it('faux semis à −7 → 2027-04-26', () => {
    expect(m.datesTravailPrevu(FAUX_SEMIS, DATES_ETE)).toStrictEqual(['2027-04-26']);
  });

  it('désherbage tous les 14 j jusqu’au début de récolte (2027-05-31) → 05-17 et 05-31 : le repère de fin est compris', () => {
    expect(m.datesTravailPrevu(DESHERBAGE, DATES_ETE)).toStrictEqual(['2027-05-17', '2027-05-31']);
  });

  it('même désherbage avec un décalage 0 : il tombe aussi le jour de la mise en place', () => {
    expect(m.datesTravailPrevu({ ...DESHERBAGE, decalageJours: 0 }, DATES_ETE)).toStrictEqual(['2027-05-03', '2027-05-17', '2027-05-31']);
  });

  it('batavia de T02 (49 j avant récolte, début 2027-06-21) : 05-17, 05-31, 06-14', () => {
    const dates = m.calculerDatesSerie({ ...BATAVIA_ETE, dureeAvantRecolteJours: 49 }, { type: 'plantation', date: '2027-05-03' });
    expect(dates.debutRecolte).toBe('2027-06-21');
    expect(m.datesTravailPrevu(DESHERBAGE, dates)).toStrictEqual(['2027-05-17', '2027-05-31', '2027-06-14']);
  });

  it('les dates du jeu d’essai sont bien celles de T02', () => {
    expect(m.calculerDatesSerie(BATAVIA_ETE, { type: 'plantation', date: '2027-05-03' })).toStrictEqual(DATES_ETE);
  });
});

describe('datesTravailPrevu : règles', () => {
  it('chaque repère, avec un décalage positif ou négatif', () => {
    const cas: readonly [TravailPrevuLu['repere'], number, string][] = [
      ['semis_pepiniere', -2, '2027-04-03'],
      ['mise_en_place', 0, '2027-05-03'],
      ['debut_recolte', 1, '2027-06-01'],
      ['fin_recolte', 3, '2027-06-17'],
    ];
    for (const [repere, decalageJours, attendu] of cas) {
      expect(m.datesTravailPrevu({ ...FAUX_SEMIS, repere, decalageJours }, DATES_ETE), repere).toStrictEqual([attendu]);
    }
  });

  it('répétition qui ne tombe pas pile sur la fin : jamais au-delà du repère de fin', () => {
    const tous10 = { ...DESHERBAGE, repetition: { tousLesJours: 10, repereFin: 'debut_recolte' as const } };
    expect(m.datesTravailPrevu(tous10, DATES_ETE)).toStrictEqual(['2027-05-17', '2027-05-27']);
  });

  it('début déjà après le repère de fin : aucune occurrence', () => {
    expect(m.datesTravailPrevu({ ...DESHERBAGE, decalageJours: 35 }, DATES_ETE)).toStrictEqual([]);
  });

  it('début le jour du repère de fin : une occurrence', () => {
    expect(m.datesTravailPrevu({ ...DESHERBAGE, decalageJours: 28 }, DATES_ETE)).toStrictEqual(['2027-05-31']);
  });

  it('tous les jours du semis à la fin de récolte : 71 dates croissantes, sans trou', () => {
    const chaqueJour = travail({
      categorie: 'entretien',
      type: 'autre',
      repere: 'semis_pepiniere',
      decalageJours: 0,
      repetition: { tousLesJours: 1, repereFin: 'fin_recolte' },
    });
    const dates = m.datesTravailPrevu(chaqueJour, DATES_ETE);
    expect(dates).toHaveLength(71);
    expect(dates[0]).toBe('2027-04-05');
    expect(dates.at(-1)).toBe('2027-06-14');
    expect(dates.includes('2027-04-30') && dates.includes('2027-05-01')).toBe(true);
  });

  it('repère absent pour le mode (semis pépinière d’un semis direct) : ignoré, sans lever', () => {
    const semisDirect: DatesSerieLues = { miseEnPlace: '2027-05-03', debutRecolte: '2027-05-31', finRecolte: '2027-06-07' };
    const auSemis = { ...FAUX_SEMIS, repere: 'semis_pepiniere' as const };
    expect(m.datesTravailPrevu(auSemis, semisDirect)).toStrictEqual([]);
    const jusquAuSemis = { ...auSemis, decalageJours: -7, repetition: { tousLesJours: 2, repereFin: 'semis_pepiniere' as const } };
    expect(m.datesTravailPrevu(jusquAuSemis, semisDirect)).toStrictEqual([]);
  });

  it('dates recalées par un réalisé (T02) : plantation faite le 05-05, le désherbage suit', () => {
    const recalees = m.appliquerRealises(DATES_ETE, { miseEnPlace: '2027-05-05' });
    expect(m.datesTravailPrevu(DESHERBAGE, recalees)).toStrictEqual(['2027-05-19', '2027-06-02']);
  });

  it('pure : ni le travail ni les dates ne sont modifiés', () => {
    const t = copie(DESHERBAGE);
    const d = copie(DATES_ETE);
    m.datesTravailPrevu(t, d);
    expect(t).toStrictEqual(DESHERBAGE);
    expect(d).toStrictEqual(DATES_ETE);
  });
});

// ---------------------------------------------------------------------------------------------
// Temps estimé et charge
// ---------------------------------------------------------------------------------------------

describe('tempsEstimeMinutes', () => {
  const longueur = (longueurM: number, nombreEmplacements = 1) => ({ taille: { unite: 'longueur' as const, longueurM }, nombreEmplacements });

  it('20 min par 100 m pour une série de 30 m → 6 min (exemple du ticket)', () => {
    expect(m.tempsEstimeMinutes({ minutes: 20, par: 'cent_metres' }, longueur(30))).toBe(6);
  });

  it('arrondi à la minute la plus proche, demi vers le haut, sans erreur de virgule flottante', () => {
    expect(m.tempsEstimeMinutes({ minutes: 10, par: 'cent_metres' }, longueur(33))).toBe(3); // 3,3
    expect(m.tempsEstimeMinutes({ minutes: 20, par: 'cent_metres' }, longueur(12.5))).toBe(3); // 2,5
    // 29 × 50 / 100 = 14,5 exactement ; 29 / 100 × 50 vaut 14,499999999999998 en flottant.
    expect(m.tempsEstimeMinutes({ minutes: 29, par: 'cent_metres' }, longueur(50))).toBe(15);
    expect(m.tempsEstimeMinutes({ minutes: 35, par: 'cent_metres' }, longueur(90))).toBe(32); // 31,5
    expect(m.tempsEstimeMinutes({ minutes: 60, par: 'cent_metres' }, longueur(250))).toBe(150);
  });

  it('série comptée en plants : pas de longueur, pas d’estimation par 100 m', () => {
    expect(m.tempsEstimeMinutes({ minutes: 20, par: 'cent_metres' }, { taille: { unite: 'plants', nombrePlants: 450 }, nombreEmplacements: 2 })).toBeNull();
  });

  it('par planche : minutes × nombre d’emplacements ; aucun emplacement → null', () => {
    expect(m.tempsEstimeMinutes({ minutes: 30, par: 'planche' }, longueur(30, 2))).toBe(60);
    expect(m.tempsEstimeMinutes({ minutes: 30, par: 'planche' }, { taille: { unite: 'plants', nombrePlants: 450 }, nombreEmplacements: 3 })).toBe(90);
    expect(m.tempsEstimeMinutes({ minutes: 30, par: 'planche' }, longueur(30, 0))).toBeNull();
  });

  it('pas de temps estimé → null', () => {
    expect(m.tempsEstimeMinutes(null, longueur(30))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Semainier
// ---------------------------------------------------------------------------------------------

describe('semainier : les travaux prévus deviennent des tâches', () => {
  it('S16, le 2027-04-19 : grelinette le vendredi 04-23, sur les planches de la série, 6 min', () => {
    const taches = m.semainier(s(2027, 16), [serie()], [], realises(), '2027-04-19');
    expect(travaux(taches)).toStrictEqual(['grelinette:2027-04-23']);
    const t = taches.find((x) => x.etape === 'travail');
    expect(t?.cible).toStrictEqual({ sorte: 'serie', serieId: 'batavia-ete' });
    expect(t?.travail?.categorie).toBe('travail_sol');
    expect(t?.travail?.indice, 'position dans travauxPrevus : clé de la tâche pour l’écran').toBe(0);
    expect(t?.culture).toBe('Laitue');
    expect(t?.taille).toStrictEqual({ unite: 'longueur', longueurM: 30 });
    // Le travail du sol tombe sur les planches de la série, triées comme en T06.
    expect(t?.emplacements).toStrictEqual([T2_P03, T2_P04]);
    expect(t?.tempsEstimeMinutes).toBe(6);
    expect(t?.enRetard).toBe(false);
    expect(t?.joursDeRetard).toBe(0);
  });

  it('S17, le 2027-04-26 : faux semis ce jour, sans temps estimé ; la grelinette non faite est en retard', () => {
    const taches = m.semainier(s(2027, 17), [serie()], [], realises(), '2027-04-26');
    expect(travaux(taches)).toStrictEqual(['grelinette:2027-04-23:retard 3', 'faux semis:2027-04-26']);
    expect(taches.find((t) => t.travail?.type === 'faux semis')?.tempsEstimeMinutes).toBeNull();
    expect(taches.find((t) => t.travail?.type === 'faux semis')?.travail?.indice).toBe(1);
  });

  it('S18, le jour de la plantation : les deux travaux non faits sont en retard, une ligne chacun, avant la plantation', () => {
    const taches = m.semainier(s(2027, 18), [serie()], [], realises(), '2027-05-03');
    expect(travaux(taches)).toStrictEqual(['grelinette:2027-04-23:retard 10', 'faux semis:2027-04-26:retard 7']);
    const indexPlantation = taches.findIndex((t) => t.etape === 'plantation');
    const indexGrelinette = taches.findIndex((t) => t.travail?.type === 'grelinette');
    expect(indexPlantation).toBeGreaterThan(indexGrelinette);
  });

  it('les tâches d’étape de T06 restent comme avant, sans champ de travail', () => {
    const taches = m.semainier(s(2027, 18), [serie()], [], realises(), '2027-05-03');
    const plantation = taches.find((t) => t.etape === 'plantation');
    expect(plantation?.datePrevue).toBe('2027-05-03');
    expect(plantation !== undefined && 'travail' in plantation).toBe(false);
    expect(plantation !== undefined && 'tempsEstimeMinutes' in plantation).toBe(false);
  });

  it('série sans travaux prévus (avant T22), ou sans interventions dans les réalisés : rien ne change', () => {
    const sans = sansTravaux(serie());
    const avec: RealisesLus = { series: new Map(), campagnes: new Map() };
    expect(travaux(m.semainier(s(2027, 18), [sans], [], avec, '2027-05-03'))).toStrictEqual([]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], avec, '2027-05-03'))).toHaveLength(2);
  });

  it('S20, le 05-17 : désherbage du jour, 30 min × 2 planches = 60 min', () => {
    const taches = m.semainier(s(2027, 20), [serie({ travauxPrevus: [DESHERBAGE] })], [], realises(), '2027-05-17');
    expect(travaux(taches)).toStrictEqual(['désherbage:2027-05-17']);
    expect(taches.find((t) => t.etape === 'travail')?.tempsEstimeMinutes).toBe(60);
  });

  it('séries terminée ou abandonnée : aucune tâche de travail', () => {
    for (const statut of ['terminee', 'abandonnee'] as const) {
      expect(travaux(m.semainier(s(2027, 18), [serie({ statut })], [], realises(), '2027-05-03'))).toStrictEqual([]);
    }
  });

  it('dates recalées par les réalisés : plantation faite le 05-05, désherbage le 05-19', () => {
    const r = realises([], [['batavia-ete', { semisPepiniere: '2027-04-05', miseEnPlace: '2027-05-05' }]]);
    const taches = m.semainier(s(2027, 20), [serie({ travauxPrevus: [DESHERBAGE] })], [], r, '2027-05-17');
    expect(travaux(taches)).toStrictEqual(['désherbage:2027-05-19']);
  });

  it('repère absent pour le mode (donnée ancienne) : ignoré, le semainier ne plante pas', () => {
    const radis = serie({
      id: 'radis',
      mode: 'semis_direct',
      datesPrevues: { miseEnPlace: '2027-05-03', debutRecolte: '2027-05-31', finRecolte: '2027-06-07' },
      travauxPrevus: [{ ...FAUX_SEMIS, repere: 'semis_pepiniere' }, GRELINETTE],
    });
    const taches = m.semainier(s(2027, 16), [radis], [], realises(), '2027-04-19');
    expect(travaux(taches)).toStrictEqual(['grelinette:2027-04-23']);
  });
});

describe('semainier : une intervention du même type sur la même série solde la tâche', () => {
  it('grelinette faite la veille (04-22) : soldée ; le faux semis reste en retard', () => {
    const r = realises([['batavia-ete', [intervention('2027-04-22', 'grelinette')]]]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], r, '2027-05-03'))).toStrictEqual(['faux semis:2027-04-26:retard 7']);
  });

  it('faite en avance d’une semaine (04-16) : soldée aussi, comme un réalisé de T06', () => {
    const r = realises([['batavia-ete', [intervention('2027-04-16', 'grelinette')]]]);
    expect(travaux(m.semainier(s(2027, 16), [serie()], [], r, '2027-04-19'))).toStrictEqual([]);
  });

  it('autre type, même catégorie (rotobêche) : ne solde pas', () => {
    const r = realises([['batavia-ete', [intervention('2027-04-22', 'rotobêche')]]]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], r, '2027-05-03'))).toContain('grelinette:2027-04-23:retard 10');
  });

  it('même libellé dans une autre catégorie : ne solde pas', () => {
    const r = realises([['batavia-ete', [intervention('2027-04-22', 'grelinette', 'entretien')]]]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], r, '2027-05-03'))).toContain('grelinette:2027-04-23:retard 10');
  });

  it('grelinette sur une autre série : ne solde pas celle-ci', () => {
    const r = realises([['autre-serie', [intervention('2027-04-22', 'grelinette')]]]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], r, '2027-05-03'))).toContain('grelinette:2027-04-23:retard 10');
  });

});

describe('semainier : un travail prévu avant son repère devient caduc quand le repère est réalisé (décision du chef, Q23)', () => {
  it('plantation réalisée le jour prévu : grelinette (−10) et faux semis (−7) non saisis disparaissent', () => {
    const r = realises([], [['batavia-ete', { semisPepiniere: '2027-04-05', miseEnPlace: '2027-05-03' }]]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], r, '2027-05-03'))).toStrictEqual([]);
  });

  it('plantation réalisée en retard (05-05) : caducs aussi', () => {
    const r = realises([], [['batavia-ete', { miseEnPlace: '2027-05-05' }]]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], r, '2027-05-05'))).toStrictEqual([]);
  });

  it('repère pas encore réalisé (seul le semis en pépinière l’est) : toujours en retard', () => {
    const r = realises([], [['batavia-ete', { semisPepiniere: '2027-04-05' }]]);
    expect(travaux(m.semainier(s(2027, 18), [serie()], [], r, '2027-05-03'))).toStrictEqual([
      'grelinette:2027-04-23:retard 10',
      'faux semis:2027-04-26:retard 7',
    ]);
  });

  it('Q11 : une étape postérieure réalisée (début de récolte) rend le repère fait, donc les travaux d’avant caducs', () => {
    const r = realises([], [['batavia-ete', { debutRecolte: '2027-05-31' }]]);
    // Le désherbage (+14, après la mise en place) n'est pas caduc : seule une intervention le solde.
    expect(travaux(m.semainier(s(2027, 22), [serie()], [], r, '2027-06-02'))).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });

  it('travail après son repère (désherbage +14) : la plantation réalisée ne le solde pas', () => {
    const r = realises([], [['batavia-ete', { miseEnPlace: '2027-05-03' }]]);
    expect(travaux(m.semainier(s(2027, 20), [serie({ travauxPrevus: [DESHERBAGE] })], [], r, '2027-05-18'))).toStrictEqual([
      'désherbage:2027-05-17:retard 1',
    ]);
  });

  it('répétition qui franchit le repère : seules les occurrences d’avant le repère deviennent caduques', () => {
    // Binage tous les 7 j de 14 j avant la mise en place jusqu'au début de récolte :
    // 04-19, 04-26, 05-03, 05-10, 05-17, 05-24, 05-31.
    const binage = travail({
      categorie: 'entretien',
      type: 'binage',
      repere: 'mise_en_place',
      decalageJours: -14,
      repetition: { tousLesJours: 7, repereFin: 'debut_recolte' },
    });
    const avant = m.semainier(s(2027, 18), [serie({ travauxPrevus: [binage] })], [], realises(), '2027-05-03');
    expect(travaux(avant)).toStrictEqual(['binage:2027-04-26:retard 7', 'binage:2027-05-03']);
    const r = realises([], [['batavia-ete', { miseEnPlace: '2027-05-03' }]]);
    // 04-19 et 04-26 caducs ; 05-03, le jour même du repère, reste dû.
    expect(travaux(m.semainier(s(2027, 18), [serie({ travauxPrevus: [binage] })], [], r, '2027-05-03'))).toStrictEqual(['binage:2027-05-03']);
  });
});

describe('semainier : répétitions (occurrences 05-17 et 05-31)', () => {
  const desherbage = serie({ travauxPrevus: [DESHERBAGE] });
  const avec = (...dates: string[]): RealisesLus => realises([['batavia-ete', dates.map((d) => intervention(d, 'désherbage'))]]);

  it('rien de fait, le 06-02 : UNE ligne en retard, la plus récente (05-31, 2 jours)', () => {
    expect(travaux(m.semainier(s(2027, 22), [desherbage], [], realises(), '2027-06-02'))).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });

  it('rien de fait, le 05-24 : la 05-17 est en retard de 7 jours', () => {
    expect(travaux(m.semainier(s(2027, 21), [desherbage], [], realises(), '2027-05-24'))).toStrictEqual(['désherbage:2027-05-17:retard 7']);
  });

  it('désherbé le 05-15 (en avance) : solde la 05-17 ; la 05-31 reste due dans sa semaine', () => {
    expect(travaux(m.semainier(s(2027, 20), [desherbage], [], avec('2027-05-15'), '2027-05-17'))).toStrictEqual([]);
    expect(travaux(m.semainier(s(2027, 22), [desherbage], [], avec('2027-05-15'), '2027-05-31'))).toStrictEqual(['désherbage:2027-05-31']);
  });

  it('désherbé le 05-20 (en retard) : solde la 05-17 seulement', () => {
    expect(travaux(m.semainier(s(2027, 22), [desherbage], [], avec('2027-05-20'), '2027-06-02'))).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });

  it('désherbé le 05-26 : la plus proche est la 05-31, soldée avec la 05-17 d’avant', () => {
    expect(travaux(m.semainier(s(2027, 22), [desherbage], [], avec('2027-05-26'), '2027-06-02'))).toStrictEqual([]);
  });

  it('désherbé le 05-24, à égale distance des deux : la plus ancienne (05-17) est soldée', () => {
    expect(travaux(m.semainier(s(2027, 22), [desherbage], [], avec('2027-05-24'), '2027-06-02'))).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });

  it('désherbé deux fois (05-17 et 05-31) : tout est soldé ; l’ordre des interventions ne compte pas', () => {
    expect(travaux(m.semainier(s(2027, 22), [desherbage], [], avec('2027-05-31', '2027-05-17'), '2027-06-02'))).toStrictEqual([]);
  });
});

describe('chargeSemaine : somme des temps estimés des tâches de la semaine', () => {
  it('S20, le 05-17, rien de fait : grelinette en retard 6 min + désherbage 60 min = 66 min (faux semis sans temps)', () => {
    const taches = m.semainier(s(2027, 20), [serie()], [], realises(), '2027-05-17');
    expect(travaux(taches)).toStrictEqual(['grelinette:2027-04-23:retard 24', 'faux semis:2027-04-26:retard 21', 'désherbage:2027-05-17']);
    expect(m.chargeSemaine(taches)).toBe(66);
  });

  it('deux séries : les temps s’additionnent', () => {
    const autre = serie({ id: 'batavia-2', emplacements: [T2_P03], taille: { unite: 'longueur', longueurM: 50 } });
    const taches = m.semainier(s(2027, 16), [serie(), autre], [], realises(), '2027-04-19');
    // 20 min / 100 m : 30 m → 6 min, 50 m → 10 min.
    expect(m.chargeSemaine(taches)).toBe(16);
  });

  it('aucune tâche, ou des étapes seules : 0', () => {
    expect(m.chargeSemaine([])).toBe(0);
    const etapes = m.semainier(s(2027, 18), [serie({ travauxPrevus: [] })], [], realises(), '2027-05-03');
    expect(etapes.length).toBeGreaterThan(0);
    expect(m.chargeSemaine(etapes)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Instantané
// ---------------------------------------------------------------------------------------------

describe('instantaneItineraire : les travaux prévus sont figés dans la série', () => {
  const itineraire = {
    id: '0192f0c1-7a6e-7cc3-9b1e-000000000005',
    fermeId: '0192f0c1-7a6e-7cc3-9b1e-000000000002',
    especeId: '0192f0c1-7a6e-7cc3-9b1e-000000000004',
    varieteId: null,
    nom: 'Batavia d’été',
    supprimeLe: null,
    ...BATAVIA_ETE,
    travauxPrevus: [GRELINETTE, FAUX_SEMIS, DESHERBAGE],
  };

  it('copie les paramètres, travaux compris, sans l’identité de l’itinéraire', () => {
    expect(m.instantaneItineraire(itineraire)).toStrictEqual({ ...BATAVIA_ETE, travauxPrevus: [GRELINETTE, FAUX_SEMIS, DESHERBAGE] });
  });

  it('copie profonde : modifier l’itinéraire ensuite ne change pas l’instantané', () => {
    const source = copie(itineraire);
    const instantane = m.instantaneItineraire(source);
    source.travauxPrevus.push(GRELINETTE);
    const premier = source.travauxPrevus[0] as { decalageJours: number; tempsEstime: { minutes: number } };
    premier.decalageJours = -30;
    premier.tempsEstime.minutes = 99;
    expect(instantane.travauxPrevus).toStrictEqual([GRELINETTE, FAUX_SEMIS, DESHERBAGE]);
  });

  it('itinéraire sans travaux prévus (avant T22) : instantané sans travail', () => {
    const instantane = m.instantaneItineraire(sansTravaux(itineraire));
    expect(instantane.travauxPrevus ?? []).toStrictEqual([]);
    expect(instantane.dureeAvantRecolteJours).toBe(28);
  });

  it('modifier l’itinéraire ne change jamais une série existante : ses tâches viennent de son instantané', () => {
    const instantane = m.instantaneItineraire(itineraire);
    const serieExistante = serie({ travauxPrevus: instantane.travauxPrevus as readonly TravailPrevuLu[] });
    const avant = m.semainier(s(2027, 18), [serieExistante], [], realises(), '2027-05-03');

    // L'itinéraire change : grelinette 15 j avant, faux semis retiré, un paillage ajouté.
    const modifie = {
      ...itineraire,
      travauxPrevus: [{ ...GRELINETTE, decalageJours: -15 }, travail({ categorie: 'couverture', type: 'paillage', repere: 'mise_en_place', decalageJours: 1 })],
    };
    expect(m.instantaneItineraire(modifie)).not.toStrictEqual(instantane);
    const apres = m.semainier(s(2027, 18), [serieExistante], [], realises(), '2027-05-03');
    expect(apres).toStrictEqual(avant);
    expect(travaux(apres)).toStrictEqual(['grelinette:2027-04-23:retard 10', 'faux semis:2027-04-26:retard 7']);
  });
});

// ---------------------------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------------------------

describe('performance', () => {
  it('3 000 séries avec 6 travaux prévus chacune (dont 2 répétés) et leurs interventions : moins de 60 ms', () => {
    const series: SerieSemainierLue[] = [];
    const interventions: [string, InterventionRealisee[]][] = [];
    const tousLesJours = travail({
      categorie: 'entretien',
      type: 'arrosage manuel',
      repere: 'mise_en_place',
      decalageJours: 0,
      repetition: { tousLesJours: 3, repereFin: 'fin_recolte' },
      tempsEstime: { minutes: 5, par: 'planche' },
    });
    const compost = travail({ categorie: 'amendement', type: 'compost', repere: 'mise_en_place', decalageJours: -21, produit: { nom: 'compost', quantite: { valeur: 3, unite: 'kg/m²' } } });
    const paillage = travail({ categorie: 'couverture', type: 'paillage', repere: 'mise_en_place', decalageJours: 1 });
    for (let i = 0; i < 3000; i++) {
      const decalage = i % 120;
      const dates = m.calculerDatesSerie(BATAVIA_ETE, { type: 'plantation', date: `2027-0${String(3 + Math.floor(decalage / 30))}-${String(1 + (decalage % 28)).padStart(2, '0')}` });
      const id = `serie-${String(i)}`;
      series.push(serie({ id, datesPrevues: dates, travauxPrevus: [GRELINETTE, FAUX_SEMIS, compost, paillage, DESHERBAGE, tousLesJours] }));
      if (i % 3 === 0) interventions.push([id, [intervention(dates.miseEnPlace, 'désherbage'), intervention(dates.miseEnPlace, 'grelinette')]]);
    }
    const r = realises(interventions);
    const { mediane, detail, resultat: taches } = mesurer(() => m.semainier(s(2027, 20), series, [], r, '2027-05-19'), { borneMs: 60 });
    expect(taches.some((t) => t.etape === 'travail' && t.enRetard)).toBe(true);
    expect(taches.some((t) => t.etape === 'travail' && !t.enRetard)).toBe(true);
    expect(mediane, detail).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------------------------
// Relecture : nombre d'occurrences borné (problème 3)
// ---------------------------------------------------------------------------------------------

/**
 * Correctif de relecture (T22, problème 3) : `datesTravailPrevu` ne plafonnait pas le nombre
 * d'occurrences. Une série forgée (pas d'un jour, 70 ans de récolte) en donnait ≈ 25 600 par
 * travail. Forme choisie (la plus simple, voir contrat-travaux.ts, « Dates ») : un plafond
 * documenté, PLAFONDS_TRAVAUX.occurrences (400 à 2 000), les premières dates gardées. Le temps
 * seul ne montre rien (≈ 5 ms aujourd'hui pour 12 travaux de ce genre) : il est vérifié en garde,
 * avec l'égalité des tâches de la semaine face à une série bornée.
 */
describe('datesTravailPrevu : nombre d’occurrences plafonné (relecture)', () => {
  /** Mise en place 2027-05-03, fin de récolte 70 ans plus tard. */
  const DATES_FORGEES: DatesSerieLues = { ...DATES_ETE, finRecolte: '2097-05-31' };
  /** Même série, fin de récolte ramenée à la fin de l'été : ce qu'une vraie série donnerait. */
  const DATES_BORNEES: DatesSerieLues = { ...DATES_ETE, finRecolte: '2027-09-30' };
  const quotidien = (i: number): TravailPrevuLu =>
    travail({
      categorie: 'entretien',
      type: `arrosage ${String(i)}`,
      repere: 'mise_en_place',
      decalageJours: 0,
      repetition: { tousLesJours: 1, repereFin: 'fin_recolte' },
      tempsEstime: { minutes: 5, par: 'planche' },
    });
  const DOUZE = Array.from({ length: 12 }, (_, i) => quotidien(i));

  it('PLAFONDS_TRAVAUX.occurrences : entier documenté, entre 400 et 2 000', () => {
    const plafond = m.PLAFONDS_TRAVAUX.occurrences;
    expect(Number.isInteger(plafond), `PLAFONDS_TRAVAUX.occurrences = ${String(plafond)}`).toBe(true);
    expect(plafond).toBeGreaterThanOrEqual(400);
    expect(plafond).toBeLessThanOrEqual(2000);
  });

  it('pas d’un jour sur 70 ans : au plus PLAFONDS_TRAVAUX.occurrences dates, les premières', () => {
    const plafond = m.PLAFONDS_TRAVAUX.occurrences;
    const dates = m.datesTravailPrevu(quotidien(0), DATES_FORGEES);
    expect(dates.length, `${String(dates.length)} occurrences rendues`).toBeLessThanOrEqual(plafond);
    expect(dates.length).toBe(plafond);
    expect(dates[0]).toBe('2027-05-03');
    expect(dates[1]).toBe('2027-05-04');
    expect(dates.at(-1)).toBe(m.datesTravailPrevu(quotidien(0), { ...DATES_ETE, finRecolte: '2035-12-31' })[plafond - 1]);
  });

  it('sous le plafond, rien ne change : la saison bornée donne toutes ses dates', () => {
    // 2027-05-03 → 2027-09-30 : 151 dates, sous tout plafond admis (≥ 400).
    expect(m.datesTravailPrevu(quotidien(0), DATES_BORNEES)).toHaveLength(151);
  });

  it('semainier : 12 travaux quotidiens sur 70 ans, mêmes tâches de la semaine qu’une série bornée, en moins de 50 ms', () => {
    const forgee = serie({ id: 'forgee', statut: 'en_cours', datesPrevues: DATES_FORGEES, travauxPrevus: DOUZE });
    const bornee = serie({ id: 'forgee', statut: 'en_cours', datesPrevues: DATES_BORNEES, travauxPrevus: DOUZE });
    const r = realises([['forgee', [intervention('2027-05-10', 'arrosage 0', 'entretien')]]]);
    const semaine = s(2027, 20);
    const { mediane, detail, resultat: taches } = mesurer(() => m.semainier(semaine, [forgee], [], r, '2027-05-19'), { borneMs: 50 });
    expect(travaux(taches)).toStrictEqual(travaux(m.semainier(semaine, [bornee], [], r, '2027-05-19')));
    expect(travaux(taches).length).toBeGreaterThan(0);
    expect(mediane, detail).toBeLessThan(50);
  });
});
