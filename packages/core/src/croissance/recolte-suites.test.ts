/**
 * Tests d'acceptation T32f — suites de T32e pour le cœur (docs/backlog/T32f-recolte-suites.md) :
 *   - la fin de récolte ne commence jamais avant la moitié de la fenêtre :
 *     début de la fin = max(F − 14, B + ⌈(F − B) / 2⌉), donc au moins un jour « à récolter » ;
 *   - pérennes à cheval sur deux années : la campagne qui contient le jour, ou celle qui commence
 *     dans les 28 jours, quelle que soit son année de rattachement (`campagne.annee`).
 * Les tests de T32e (recolte.test.ts, contrat-recolte.ts) ne changent pas : une fenêtre de 60 jours
 * (la courgette de T32e : 62 jours) reste exactement comme avant.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import { jaunissementA, jaunissementPerenneA } from './recolte.ts';
import { chargerRecolte, type DateCalendaire, type DatesCroissance, type EntreePerenne, type ModuleRecolte, type PhaseRecolte } from './test/contrat-recolte.ts';

let m: ModuleRecolte;
beforeAll(async () => {
  m = await chargerRecolte();
});

const d = (s: string): DateCalendaire => s as DateCalendaire;
const repere = (prevue: string | null, reelle: string | null = null) => ({ prevue: prevue === null ? null : d(prevue), reelle: reelle === null ? null : d(reelle) });
const plus = (jour: DateCalendaire, n: number): DateCalendaire => ajouterJours(jour, n);

const B = d('2027-07-01');
/** Une culture dont la récolte dure `longueur` jours (F = B + longueur), plantée 60 jours avant, arrachée 30 jours après la fin. */
function cultureDe(longueur: number, debut: DateCalendaire = B): DatesCroissance {
  return {
    miseEnPlace: repere(plus(debut, -60)),
    debutRecolte: repere(debut),
    finRecolte: repere(plus(debut, longueur)),
    arrachage: repere(plus(debut, longueur + 30)),
  };
}
/** La règle de T32f, écrite à part du code : indice (en jours depuis B) du premier jour de « fin de récolte ». */
const debutDeLaFin = (longueur: number): number => Math.max(longueur - 14, Math.ceil(longueur / 2));
const phaseA = (dates: DatesCroissance, jour: DateCalendaire): PhaseRecolte => m.recolteA(dates, jour).phase;

describe('T32f : récolte courte, au moins un jour « à récolter »', () => {
  it('récolte de 10 jours : 5 jours « à récolter » (du 1er au 5 juillet), puis « fin de récolte » (dès le 6)', () => {
    const radis = cultureDe(10);
    const vues = Array.from({ length: 10 }, (_, k) => phaseA(radis, plus(B, k)));
    expect(vues).toEqual(['a-recolter', 'a-recolter', 'a-recolter', 'a-recolter', 'a-recolter', 'fin-de-recolte', 'fin-de-recolte', 'fin-de-recolte', 'fin-de-recolte', 'fin-de-recolte']);
    expect(m.recolteA(radis, B)).toEqual({ phase: 'a-recolter', maturite: 1 });
    expect(m.recolteA(radis, d('2027-07-06'))).toEqual({ phase: 'fin-de-recolte', maturite: 1 });
  });

  it('la veille du début : encore fruits en formation (la formation ne change pas)', () => {
    expect(phaseA(cultureDe(10), plus(B, -1))).toBe('fruits-en-formation');
  });

  it('après la fin de la fenêtre, tant que la plante est en place : fin de récolte ; puis aucune à l’arrachage', () => {
    const radis = cultureDe(10);
    expect(phaseA(radis, plus(B, 10))).toBe('fin-de-recolte');
    expect(phaseA(radis, plus(B, 39))).toBe('fin-de-recolte');
    expect(phaseA(radis, plus(B, 40))).toBe('aucune');
  });

  it('toute fenêtre de 1 à 90 jours : le début de la fin est max(F − 14, B + ⌈(F − B) / 2⌉)', () => {
    for (let longueur = 1; longueur <= 90; longueur += 1) {
      const dates = cultureDe(longueur);
      const fin = debutDeLaFin(longueur);
      for (let k = 0; k < longueur + 5; k += 1) {
        const attendu: PhaseRecolte = k < fin ? 'a-recolter' : 'fin-de-recolte';
        expect(phaseA(dates, plus(B, k)), `fenêtre de ${String(longueur)} jours, jour B + ${String(k)}`).toBe(attendu);
      }
    }
  });

  it('toute récolte ouverte (au moins 1 jour) a au moins un jour « à récolter », le premier, avant la « fin de récolte »', () => {
    for (let longueur = 1; longueur <= 90; longueur += 1) {
      const dates = cultureDe(longueur);
      expect(phaseA(dates, B), `fenêtre de ${String(longueur)} jours : le jour du début`).toBe('a-recolter');
      const phases = Array.from({ length: longueur + 3 }, (_, k) => phaseA(dates, plus(B, k)));
      expect(phases.indexOf('a-recolter'), `fenêtre de ${String(longueur)} jours`).toBe(0);
      expect(phases.indexOf('fin-de-recolte'), `fenêtre de ${String(longueur)} jours : la fin vient après`).toBeGreaterThan(0);
    }
  });

  it('fenêtre de 1 jour : « à récolter » le jour du début, « fin de récolte » le lendemain (le jour de la fin)', () => {
    const unJour = cultureDe(1);
    expect(m.recolteA(unJour, B)).toEqual({ phase: 'a-recolter', maturite: 1 });
    expect(m.recolteA(unJour, plus(B, 1))).toEqual({ phase: 'fin-de-recolte', maturite: 1 });
  });

  it('la fin de la récolte ne revient jamais en arrière, quelle que soit la fenêtre (a-recolter puis fin-de-recolte, une seule fois)', () => {
    for (const longueur of [1, 2, 3, 7, 10, 14, 15, 20, 28, 29, 45, 60]) {
      const dates = cultureDe(longueur);
      const vues: PhaseRecolte[] = [];
      for (let k = -40; k < longueur + 40; k += 1) {
        const p = phaseA(dates, plus(B, k));
        if (vues.at(-1) !== p) vues.push(p);
      }
      expect(vues, `fenêtre de ${String(longueur)} jours`).toEqual(['aucune', 'fruits-en-formation', 'a-recolter', 'fin-de-recolte', 'aucune']);
    }
  });

  it('dates réelles : la fin réelle plus proche raccourcit la fenêtre, la règle s’applique à la fenêtre réelle', () => {
    // Prévue : 62 jours. Réelle : 10 jours (fin le 11 juillet).
    const reelle: DatesCroissance = { ...cultureDe(62), finRecolte: repere('2027-09-01', '2027-07-11') };
    expect(phaseA(reelle, d('2027-07-05'))).toBe('a-recolter');
    expect(phaseA(reelle, d('2027-07-06'))).toBe('fin-de-recolte');
  });

  it('début réel plus tard que le prévu : la fenêtre se compte depuis le début réel', () => {
    const decale: DatesCroissance = { ...cultureDe(10), debutRecolte: repere('2027-07-01', '2027-07-03'), finRecolte: repere('2027-07-11') };
    // B = 3 juillet, F = 11 juillet : 8 jours, la fin commence à B + 4 = 7 juillet.
    expect(phaseA(decale, d('2027-07-06'))).toBe('a-recolter');
    expect(phaseA(decale, d('2027-07-07'))).toBe('fin-de-recolte');
  });

  it('fin de récolte inconnue : toujours « à récolter » (rien n’est inventé), comme en T32e', () => {
    const sansFin: DatesCroissance = { ...cultureDe(10), finRecolte: repere(null) };
    expect(phaseA(sansFin, plus(B, 8))).toBe('a-recolter');
  });

  it('jaunissement d’une récolte courte : 0 avant la fin, positif ensuite, jamais au-dessus de 1, sans reculer', () => {
    const radis = cultureDe(10);
    let precedent = 0;
    for (let k = 0; k < 40; k += 1) {
      const j = jaunissementA(radis, plus(B, k));
      if (k < 5) expect(j, `B + ${String(k)}`).toBe(0);
      else {
        expect(j, `B + ${String(k)}`).toBeGreaterThan(0);
        expect(j, `B + ${String(k)}`).toBeLessThanOrEqual(1);
        expect(j, `B + ${String(k)}`).toBeGreaterThanOrEqual(precedent);
      }
      precedent = j;
    }
  });
});

describe('T32f : fenêtre de 60 jours, inchangée par rapport à T32e', () => {
  const soixante = cultureDe(60);
  it('« à récolter » jusqu’à F − 15 compris, « fin de récolte » dès F − 14 (JOURS_FIN_RECOLTE)', () => {
    expect(m.JOURS_FIN_RECOLTE).toBe(14);
    expect(phaseA(soixante, B)).toBe('a-recolter');
    expect(phaseA(soixante, plus(B, 45))).toBe('a-recolter');
    expect(phaseA(soixante, plus(B, 46))).toBe('fin-de-recolte');
    expect(phaseA(soixante, plus(B, 59))).toBe('fin-de-recolte');
  });

  it('la fenêtre de 28 jours est le cas limite : F − 14 = B + 14 ; en dessous, la moitié l’emporte, au-dessus, F − 14', () => {
    expect(phaseA(cultureDe(28), plus(B, 13))).toBe('a-recolter');
    expect(phaseA(cultureDe(28), plus(B, 14))).toBe('fin-de-recolte');
    expect(phaseA(cultureDe(20), plus(B, 9))).toBe('a-recolter');
    expect(phaseA(cultureDe(20), plus(B, 10))).toBe('fin-de-recolte');
    expect(phaseA(cultureDe(15), plus(B, 7))).toBe('a-recolter');
    expect(phaseA(cultureDe(15), plus(B, 8))).toBe('fin-de-recolte');
    expect(phaseA(cultureDe(40), plus(B, 25))).toBe('a-recolter');
    expect(phaseA(cultureDe(40), plus(B, 26))).toBe('fin-de-recolte');
  });
});

describe('T32f : pérennes à cheval sur deux années', () => {
  const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
  const campagne = (annee: number, debut: string | null, fin: string | null): EntreePerenne['campagne'] => ({ annee, debutRecolte: debut === null ? null : d(debut), finRecolte: fin === null ? null : d(fin) });
  const entree = (c: EntreePerenne['campagne']): EntreePerenne => ({ plantation: PLANTATION, campagne: c });
  const phaseP = (e: EntreePerenne, jour: string): PhaseRecolte => m.recoltePerenneA(e, d(jour)).phase;

  describe('fraise d’hiver : récolte du 10 janvier au 20 mars', () => {
    const hiver = entree(campagne(2027, '2027-01-10', '2027-03-20'));

    it('le 20 décembre de l’année précédente : fruits en formation (la campagne commence dans 21 jours)', () => {
      const e = m.recoltePerenneA(hiver, d('2026-12-20'));
      expect(e.phase).toBe('fruits-en-formation');
      expect(e.maturite).toBeCloseTo((m.JOURS_FORMATION_FRUITS - 21) / m.JOURS_FORMATION_FRUITS, 9);
    });

    it('la formation commence 28 jours avant (maturité 0), pas avant', () => {
      expect(m.recoltePerenneA(hiver, d('2026-12-13'))).toEqual({ phase: 'fruits-en-formation', maturite: 0 });
      expect(phaseP(hiver, '2026-12-12')).toBe('aucune');
      expect(phaseP(hiver, '2026-06-15')).toBe('aucune');
    });

    it('la maturité croît strictement de décembre au 9 janvier, puis « à récolter » le 10 janvier', () => {
      let precedente = -1;
      for (let k = 28; k >= 1; k -= 1) {
        const e = m.recoltePerenneA(hiver, plus(d('2027-01-10'), -k));
        expect(e.phase, `B − ${String(k)}`).toBe('fruits-en-formation');
        expect(e.maturite, `B − ${String(k)}`).toBeGreaterThan(precedente);
        precedente = e.maturite;
      }
      expect(m.recoltePerenneA(hiver, d('2027-01-10'))).toEqual({ phase: 'a-recolter', maturite: 1 });
    });

    it('pendant la campagne : à récolter, puis fin de récolte sur la dernière partie (F − 14 = 6 mars)', () => {
      expect(phaseP(hiver, '2027-02-01')).toBe('a-recolter');
      expect(phaseP(hiver, '2027-03-05')).toBe('a-recolter');
      expect(phaseP(hiver, '2027-03-06')).toBe('fin-de-recolte');
      expect(phaseP(hiver, '2027-03-19')).toBe('fin-de-recolte');
    });

    it('le calcul ne dépend pas de l’année de rattachement : la même campagne, rattachée à 2026 ou à 2027, donne les mêmes états', () => {
      const rattachee2026 = entree(campagne(2026, '2027-01-10', '2027-03-20'));
      for (const jour of ['2026-12-12', '2026-12-13', '2026-12-20', '2027-01-09', '2027-01-10', '2027-02-01', '2027-03-06']) {
        expect(m.recoltePerenneA(rattachee2026, d(jour)), jour).toEqual(m.recoltePerenneA(hiver, d(jour)));
      }
    });
  });

  describe('campagne du 1er décembre au 15 février (à cheval sur deux années)', () => {
    const cheval = entree(campagne(2026, '2026-12-01', '2027-02-15'));

    it('le 10 janvier de l’année suivante : à récolter (la campagne contient le jour)', () => {
      expect(m.recoltePerenneA(cheval, d('2027-01-10'))).toEqual({ phase: 'a-recolter', maturite: 1 });
    });

    it('le cycle tout entier : formation en novembre, à récolter du 1er décembre à fin janvier, fin de récolte dès le 1er février, puis plus rien', () => {
      expect(phaseP(cheval, '2026-11-02')).toBe('aucune');
      expect(phaseP(cheval, '2026-11-03')).toBe('fruits-en-formation');
      expect(phaseP(cheval, '2026-11-30')).toBe('fruits-en-formation');
      expect(phaseP(cheval, '2026-12-01')).toBe('a-recolter');
      expect(phaseP(cheval, '2026-12-31')).toBe('a-recolter');
      expect(phaseP(cheval, '2027-01-01')).toBe('a-recolter');
      expect(phaseP(cheval, '2027-01-31')).toBe('a-recolter');
      expect(phaseP(cheval, '2027-02-01')).toBe('fin-de-recolte');
      expect(phaseP(cheval, '2027-02-14')).toBe('fin-de-recolte');
    });

    it('la campagne n’est pas coupée au 31 décembre : le 2 janvier est comme le 30 décembre', () => {
      expect(phaseP(cheval, '2026-12-30')).toBe('a-recolter');
      expect(phaseP(cheval, '2027-01-02')).toBe('a-recolter');
    });

    it('la même campagne rattachée à l’année de sa fin (2027) donne les mêmes états', () => {
      const rattachee2027 = entree(campagne(2027, '2026-12-01', '2027-02-15'));
      for (const jour of ['2026-11-03', '2026-12-01', '2026-12-31', '2027-01-10', '2027-02-01']) {
        expect(m.recoltePerenneA(rattachee2027, d(jour)), jour).toEqual(m.recoltePerenneA(cheval, d(jour)));
      }
    });
  });

  describe('garde-fous inchangés', () => {
    it('avant la plantation et à partir de l’arrachage : aucune, même dans la fenêtre d’une campagne à cheval', () => {
      const neuve: EntreePerenne = { plantation: { datePlantation: d('2027-01-20'), dateArrachage: null }, campagne: campagne(2026, '2026-12-01', '2027-02-15') };
      expect(phaseP(neuve, '2027-01-10')).toBe('aucune');
      const arrachee: EntreePerenne = { plantation: { datePlantation: d('2020-03-01'), dateArrachage: d('2027-01-05') }, campagne: campagne(2026, '2026-12-01', '2027-02-15') };
      expect(phaseP(arrachee, '2027-01-04')).toBe('a-recolter');
      expect(phaseP(arrachee, '2027-01-05')).toBe('aucune');
    });

    it('sans campagne ou sans début : aucune', () => {
      expect(phaseP(entree(null), '2027-01-10')).toBe('aucune');
      expect(phaseP(entree(campagne(2026, null, '2027-02-15')), '2027-01-10')).toBe('aucune');
    });

    it('une campagne de même année que le jour se calcule comme en T32e (fraise de printemps)', () => {
      const printemps = entree(campagne(2027, '2027-05-10', '2027-06-30'));
      expect(phaseP(printemps, '2027-05-03')).toBe('fruits-en-formation');
      expect(phaseP(printemps, '2027-05-20')).toBe('a-recolter');
      expect(phaseP(printemps, '2027-06-20')).toBe('fin-de-recolte');
      expect(phaseP(printemps, '2027-03-15')).toBe('aucune');
      expect(phaseP(printemps, '2028-05-20')).toBe('aucune');
    });

    it('même entrée, même sortie ; l’entrée n’est pas modifiée', () => {
      const e = entree(campagne(2027, '2027-01-10', '2027-03-20'));
      const copie = JSON.stringify(e);
      expect(m.recoltePerenneA(e, d('2026-12-20'))).toEqual(m.recoltePerenneA(e, d('2026-12-20')));
      expect(JSON.stringify(e)).toBe(copie);
    });
  });
});

describe('T32f : fenêtre d’un jour et données incohérentes', () => {
  it('fenêtre d’un jour avec F = B : au moins un jour « à récolter » (le jour du début), puis « fin de récolte »', () => {
    const memeJour: DatesCroissance = { ...cultureDe(1), finRecolte: repere('2027-07-01') };
    expect(phaseA(memeJour, B)).toBe('a-recolter');
    expect(phaseA(memeJour, plus(B, 1))).toBe('fin-de-recolte');
  });

  it('fin avant début : le jaunissement reste entre 0 et 1, jamais négatif', () => {
    for (const ecart of [1, 2, 5, 30]) {
      const incoherente: DatesCroissance = { ...cultureDe(10), finRecolte: repere(plus(B, -ecart)), arrachage: repere(plus(B, 60)) };
      for (let k = -5; k < 70; k += 1) {
        const j = jaunissementA(incoherente, plus(B, k));
        expect(j, `fin B − ${String(ecart)}, jour B + ${String(k)}`).toBeGreaterThanOrEqual(0);
        expect(j, `fin B − ${String(ecart)}, jour B + ${String(k)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fin avant début, pérenne : jaunissement dans [0, 1]', () => {
    const e: EntreePerenne = { plantation: { datePlantation: d('2020-03-01'), dateArrachage: null }, campagne: { annee: 2027, debutRecolte: d('2027-07-01'), finRecolte: d('2027-06-20') } };
    for (let k = -30; k < 40; k += 1) {
      const j = jaunissementPerenneA(e, plus(B, k));
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThanOrEqual(1);
    }
  });
});
