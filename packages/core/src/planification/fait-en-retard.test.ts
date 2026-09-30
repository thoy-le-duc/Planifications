/**
 * Tests d'acceptation T22b — « Fait » sur un travail répété en retard (Q24) : une intervention
 * qui porte une occurrence visée (`occurrenceVisee`, date prévue de la carte touchée) solde
 * cette occurrence et les précédentes, jamais les suivantes. Sans occurrence visée (saisie
 * libre, anciennes saisies), la règle de T22 reste : l'occurrence la plus proche de la date.
 *
 * Contrat : ./test/contrat-travaux.ts, section « T22b ». Validation du champ :
 * ../saisies/occurrence-visee.test.ts.
 *
 * Exemple du ticket : désherbage tous les 14 jours, occurrences 2027-05-17 et 2027-05-31 (batavia
 * d'été de T22 : mise en place 05-03, début de récolte 05-31). « Fait » le 05-25 sur la carte du
 * 17 : aujourd'hui la règle de T22 solde la plus proche du 25, donc le 31 aussi (6 jours contre
 * 8) ; avec l'occurrence visée, seul le 17 est soldé et le 31 reste dû.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chargerTravaux,
  type DatesSerieLues,
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

// ── Jeu d'essai (celui de ./travaux.test.ts) ─────────────────────────────────────────────────

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

/** Désherbage tous les 14 j, de 14 j après la mise en place jusqu'au début de récolte : 05-17, 05-31. */
const DESHERBAGE = travail({
  categorie: 'entretien',
  type: 'désherbage',
  repere: 'mise_en_place',
  decalageJours: 14,
  repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
});

/** Grelinette 10 jours avant la mise en place (2027-04-23), sans répétition. */
const GRELINETTE = travail({ categorie: 'travail_sol', type: 'grelinette', repere: 'mise_en_place', decalageJours: -10 });

function serie(travaux: readonly TravailPrevuLu[] = [DESHERBAGE]): SerieSemainierLue {
  return {
    id: 'batavia-ete',
    statut: 'en_cours',
    mode: 'plant_maison',
    culture: 'Laitue',
    variete: 'Batavia blonde',
    datesPrevues: DATES_ETE,
    taille: { unite: 'longueur', longueurM: 30 },
    emplacements: [{ id: 'emp-T2-P03', code: 'T2-P03', zone: 'Tunnel 2' }],
    travauxPrevus: travaux,
  };
}

function realises(interventions: readonly InterventionRealisee[], etapes: Readonly<Record<string, string>> = {}): RealisesLus {
  return {
    series: new Map([['batavia-ete', etapes]]),
    campagnes: new Map(),
    interventions: new Map([['batavia-ete', interventions]]),
  };
}

/** Désherbage fait le `date` ; `occurrenceVisee` : undefined = clé absente. */
function desherbe(date: string, occurrenceVisee?: string | null): InterventionRealisee {
  const i: InterventionRealisee = { date, categorie: 'entretien', type: 'désherbage' };
  return occurrenceVisee === undefined ? i : { ...i, occurrenceVisee };
}

const s = (annee: number, semaine: number): { annee: number; semaine: number } => ({ annee, semaine });

/** Tâches de travail seulement, résumées : 'type:date' (+ ':retard N'). */
function travaux(taches: readonly TacheLue[]): string[] {
  return taches
    .filter((t) => t.etape === 'travail')
    .map((t) => `${t.travail?.type ?? '?'}:${t.datePrevue}${t.enRetard ? `:retard ${String(t.joursDeRetard)}` : ''}`);
}

/** Semainier de la semaine ISO `semaine` de 2027, le jour `jour`, sur la série du jeu d'essai. */
const semaine = (n: number, jour: string, r: RealisesLus, travauxPrevus?: readonly TravailPrevuLu[]): string[] =>
  travaux(m.semainier(s(2027, n), [serie(travauxPrevus)], [], r, jour));

// ── Exemple du ticket ────────────────────────────────────────────────────────────────────────

describe('T22b : « Fait » le 05-25 sur la carte du 17 (exemple du ticket)', () => {
  it('le jeu d’essai : désherbage les 05-17 et 05-31 ; le 05-25, la carte du 17 est la seule en retard (8 jours)', () => {
    expect(m.datesTravailPrevu(DESHERBAGE, DATES_ETE)).toStrictEqual(['2027-05-17', '2027-05-31']);
    expect(semaine(21, '2027-05-25', realises([]))).toStrictEqual(['désherbage:2027-05-17:retard 8']);
  });

  it('occurrence visée 05-17 : le 17 est soldé, la carte quitte la semaine du 25', () => {
    expect(semaine(21, '2027-05-25', realises([desherbe('2027-05-25', '2027-05-17')]))).toStrictEqual([]);
  });

  it('occurrence visée 05-17 : le 31 reste dû dans sa semaine, puis en retard', () => {
    const r = realises([desherbe('2027-05-25', '2027-05-17')]);
    expect(semaine(22, '2027-05-31', r)).toStrictEqual(['désherbage:2027-05-31']);
    expect(semaine(22, '2027-06-02', r)).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });

  it('même intervention sans occurrence visée (saisie libre) : règle de T22, la plus proche du 25 (le 31) et le 17 sont soldés', () => {
    expect(semaine(22, '2027-06-02', realises([desherbe('2027-05-25')]))).toStrictEqual([]);
  });

  it('occurrence visée null : comme une clé absente, la règle de T22', () => {
    expect(semaine(22, '2027-06-02', realises([desherbe('2027-05-25', null)]))).toStrictEqual([]);
    expect(semaine(22, '2027-06-02', realises([desherbe('2027-05-20', null)]))).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });
});

// ── Règles ───────────────────────────────────────────────────────────────────────────────────

describe('T22b : l’occurrence visée et les précédentes, jamais les suivantes', () => {
  it('fait le jour même du 31 sur la carte du 17 : le 31 n’est pas soldé', () => {
    const r = realises([desherbe('2027-05-31', '2027-05-17')]);
    expect(semaine(22, '2027-05-31', r)).toStrictEqual(['désherbage:2027-05-31']);
    expect(semaine(22, '2027-06-02', r)).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });

  it('occurrence visée 05-31 (fait en retard le 06-02) : le 31 et le 17 d’avant sont soldés', () => {
    const r = realises([desherbe('2027-06-02', '2027-05-31')]);
    expect(semaine(22, '2027-06-02', r)).toStrictEqual([]);
    expect(semaine(21, '2027-05-24', r), 'le 17 d’avant aussi').toStrictEqual([]);
  });

  it('fait en avance sur la carte du 17 (le 05-15) : le 17 soldé, le 31 reste dû', () => {
    const r = realises([desherbe('2027-05-15', '2027-05-17')]);
    expect(semaine(20, '2027-05-17', r)).toStrictEqual([]);
    expect(semaine(22, '2027-05-31', r)).toStrictEqual(['désherbage:2027-05-31']);
  });

  it('occurrence visée plus loin que la date réelle ne change rien pour les occurrences d’avant : toutes soldées', () => {
    // Carte du 31 touchée le 05-25 (en avance) : le 17 d'avant l'est aussi.
    const r = realises([desherbe('2027-05-25', '2027-05-31')]);
    expect(semaine(21, '2027-05-25', r)).toStrictEqual([]);
    expect(semaine(22, '2027-06-02', r)).toStrictEqual([]);
  });

  it('plusieurs interventions : la plus avancée l’emporte, l’ordre ne compte pas', () => {
    // Carte du 17, puis désherbage libre le 06-01 (plus proche du 31) : tout est soldé.
    const tout = [desherbe('2027-05-25', '2027-05-17'), desherbe('2027-06-01')];
    expect(semaine(22, '2027-06-02', realises(tout))).toStrictEqual([]);
    expect(semaine(22, '2027-06-02', realises([...tout].reverse()))).toStrictEqual([]);
    // Carte du 17 et désherbage libre le 05-18 (plus proche du 17) : le 31 reste dû.
    const partiel = [desherbe('2027-05-18'), desherbe('2027-05-25', '2027-05-17')];
    expect(semaine(22, '2027-06-02', realises(partiel))).toStrictEqual(['désherbage:2027-05-31:retard 2']);
    expect(semaine(22, '2027-06-02', realises([...partiel].reverse()))).toStrictEqual(['désherbage:2027-05-31:retard 2']);
  });

  it('autre type ou autre catégorie avec la même occurrence visée : ne solde pas', () => {
    const autreType: InterventionRealisee = { date: '2027-05-25', categorie: 'entretien', type: 'binage', occurrenceVisee: '2027-05-17' };
    const autreCategorie: InterventionRealisee = { date: '2027-05-25', categorie: 'travail_sol', type: 'désherbage', occurrenceVisee: '2027-05-17' };
    expect(semaine(21, '2027-05-25', realises([autreType, autreCategorie]))).toStrictEqual(['désherbage:2027-05-17:retard 8']);
  });

  it('travail sans répétition : l’occurrence visée le solde, comme avant', () => {
    const r = realises([{ date: '2027-05-01', categorie: 'travail_sol', type: 'grelinette', occurrenceVisee: '2027-04-23' }]);
    expect(semaine(17, '2027-04-26', realises([]), [GRELINETTE])).toStrictEqual(['grelinette:2027-04-23:retard 3']);
    expect(semaine(17, '2027-05-01', r, [GRELINETTE])).toStrictEqual([]);
  });

  it('dates recalées après coup (plantation saisie au 05-05 : 05-19 et 06-02) : la carte touchée reste soldée, la suivante non', () => {
    // Décision du testeur (contrat) : l'occurrence visée est la plus proche de `occurrenceVisee`.
    // « Fait » le 05-27 sur la carte du 17, puis la plantation est saisie au 05-05 : les
    // occurrences deviennent 05-19 et 06-02 ; le 05-19 est soldé, le 06-02 reste dû.
    const recale = m.appliquerRealises(DATES_ETE, { miseEnPlace: '2027-05-05' });
    expect(m.datesTravailPrevu(DESHERBAGE, recale)).toStrictEqual(['2027-05-19', '2027-06-02']);
    const r = realises([desherbe('2027-05-27', '2027-05-17')], { miseEnPlace: '2027-05-05' });
    expect(semaine(21, '2027-05-27', r)).toStrictEqual([]);
    expect(semaine(22, '2027-06-01', r)).toStrictEqual(['désherbage:2027-06-02']);
  });

  it('pure : les interventions reçues ne sont pas modifiées', () => {
    const i = desherbe('2027-05-25', '2027-05-17');
    const copie = { ...i };
    m.semainier(s(2027, 22), [serie()], [], realises([i]), '2027-06-02');
    expect(i).toStrictEqual(copie);
  });
});
