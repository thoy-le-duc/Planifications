/**
 * Tests d'acceptation T32a — croissanceA : hauteur et stade d'une culture annuelle à une date
 * (docs/backlog/T32a-croissance-profils.md, critères 1 à 4 et 7). Contrat : ./test/contrat.ts.
 *
 * Exemple du ticket : tomate mise en place le 1er mai 2027, début de récolte le 1er juillet, fin
 * de récolte le 28 septembre (150 jours après la mise en place), arrachée le 15 octobre ; profil
 * de test 2 m, 90 jours jusqu'à la hauteur maximale (le 30 juillet), linéaire, conservée.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours, ecartEnJours } from '../dates/index.ts';
import {
  chargerCroissance,
  d,
  enS,
  prevue,
  profil,
  type DateCalendaire,
  type DatesCroissance,
  type EtatCroissance,
  type ModuleCroissance,
  type ProfilCroissance,
  type StadeCroissance,
} from './test/contrat.ts';

let m: ModuleCroissance;

beforeAll(async () => {
  m = await chargerCroissance();
});

const M = d('2027-05-01');
const B = d('2027-07-01');
const F = d('2027-09-28');
const A = d('2027-10-15');
const MAX = d('2027-07-30');

const TOMATE = profil();

const DATES_TOMATE: DatesCroissance = {
  miseEnPlace: prevue(M),
  debutRecolte: prevue(B),
  finRecolte: prevue(F),
  arrachage: prevue(A),
};

const j = (n: number, depuis: DateCalendaire = M): DateCalendaire => ajouterJours(depuis, n);

function etat(jour: DateCalendaire, p: ProfilCroissance = TOMATE, dates: DatesCroissance = DATES_TOMATE): EtatCroissance {
  return m.croissanceA(dates, p, jour);
}

function attendu(e: EtatCroissance, stade: StadeCroissance, hauteurM: number, p: ProfilCroissance = TOMATE): void {
  expect(e.stade).toBe(stade);
  expect(e.hauteurM).toBeCloseTo(hauteurM, 9);
  expect(e.fraction).toBeCloseTo(hauteurM / p.hauteurMaxM, 9);
}

describe('T32a : constantes des stades', () => {
  it('levée jusqu’à 10 % de la hauteur, fin baissée à 50 %, repli de 60 jours sans fin de cycle', () => {
    expect(m.FRACTION_FIN_LEVEE).toBe(0.1);
    expect(m.FRACTION_HAUTEUR_FIN_BAISSEE).toBe(0.5);
    expect(m.JOURS_REPLI_SANS_FIN).toBe(60);
  });
});

describe('T32a : tomate du 1er mai au 15 octobre (exemple du ticket)', () => {
  it('avant la mise en place : rien, hauteur 0', () => {
    attendu(etat(d('2027-04-30')), 'aucun', 0);
    attendu(etat(d('2026-12-31')), 'aucun', 0);
  });

  it('jour de la mise en place : levée, hauteur 0', () => {
    attendu(etat(M), 'levee', 0);
  });

  it('levée tant que la hauteur reste sous 10 % du maximum, puis croissance', () => {
    attendu(etat(j(8)), 'levee', (2 * 8) / 90);
    attendu(etat(j(10)), 'croissance', (2 * 10) / 90);
    attendu(etat(j(30)), 'croissance', (2 * 30) / 90);
  });

  it('veille du début de récolte : croissance ; jour du début de récolte : pleine production', () => {
    attendu(etat(j(-1, B)), 'croissance', (2 * 60) / 90);
    attendu(etat(B), 'pleine_production', (2 * 61) / 90);
  });

  it('croissante jusqu’à 2 m à la date de hauteur maximale (30 juillet), puis 2 m tenus', () => {
    attendu(etat(j(-1, MAX)), 'pleine_production', (2 * 89) / 90);
    attendu(etat(MAX), 'pleine_production', 2);
    attendu(etat(d('2027-08-15')), 'pleine_production', 2);
    attendu(etat(j(-1, F)), 'pleine_production', 2);
  });

  it('jour de la fin de récolte : fin, 2 m (hauteur conservée) jusqu’à la veille de l’arrachage', () => {
    attendu(etat(F), 'fin', 2);
    attendu(etat(d('2027-10-01')), 'fin', 2);
    attendu(etat(j(-1, A)), 'fin', 2);
  });

  it('jour de l’arrachage et après : rien', () => {
    attendu(etat(A), 'aucun', 0);
    attendu(etat(j(1, A)), 'aucun', 0);
    attendu(etat(d('2030-01-01')), 'aucun', 0);
  });

  it('hauteur baissée en fin de cycle : la moitié de la hauteur atteinte à la fin de récolte', () => {
    const baissee = profil({ finDeCycle: 'baissee' });
    attendu(etat(j(-1, F), baissee), 'pleine_production', 2, baissee);
    attendu(etat(F, baissee), 'fin', 1, baissee);
    attendu(etat(j(-1, A), baissee), 'fin', 1, baissee);
    attendu(etat(A, baissee), 'aucun', 0, baissee);
  });

  it('fin de récolte avant la hauteur maximale : la hauteur atteinte à la fin de récolte est tenue', () => {
    const lente = profil({ duree: { en: 'jours', jours: 300 } });
    const hF = (2 * 150) / 300;
    attendu(etat(F, lente), 'fin', hF, lente);
    attendu(etat(j(-1, A), lente), 'fin', hF, lente);
    const lenteBaissee = profil({ duree: { en: 'jours', jours: 300 }, finDeCycle: 'baissee' });
    attendu(etat(j(-1, A), lenteBaissee), 'fin', hF / 2, lenteBaissee);
  });

  it('hauteur maximale atteinte avant le début de récolte : pleine production dès ce jour-là', () => {
    const rapide = profil({ duree: { en: 'jours', jours: 30 } });
    attendu(etat(j(29), rapide), 'croissance', (2 * 29) / 30, rapide);
    attendu(etat(j(30), rapide), 'pleine_production', 2, rapide);
    attendu(etat(j(-1, B), rapide), 'pleine_production', 2, rapide);
  });

  it('courbe en S : x²(3 − 2x) de l’avancement', () => {
    const s = profil({ allure: 'en-s' });
    attendu(etat(j(45), s), 'croissance', 2 * enS(0.5), s);
    attendu(etat(j(30), s), 'croissance', 2 * enS(30 / 90), s);
    attendu(etat(j(5), s), 'levee', 2 * enS(5 / 90), s);
    attendu(etat(MAX, s), 'pleine_production', 2, s);
    expect(etat(j(45), s).hauteurM).toBeCloseTo(1, 12);
  });

  it('déterministe, et n’altère pas ses entrées', () => {
    const p = Object.freeze({ ...TOMATE, duree: Object.freeze({ ...TOMATE.duree }) });
    const dates = Object.freeze({
      miseEnPlace: Object.freeze(prevue(M)),
      debutRecolte: Object.freeze(prevue(B)),
      finRecolte: Object.freeze(prevue(F)),
      arrachage: Object.freeze(prevue(A)),
    });
    const a = m.croissanceA(dates, p, j(30));
    const b = m.croissanceA(dates, p, j(30));
    expect(a).toEqual(b);
    expect(p).toEqual(TOMATE);
  });

  it('le cycle annuel d’un profil de pérenne est ignoré pour une culture annuelle', () => {
    const avecCycle = profil({ cycleAnnuel: { debourrement: '04-01', repos: '11-15' } });
    for (const jour of [d('2027-04-30'), M, j(30), B, MAX, F, A]) {
      expect(etat(jour, avecCycle), jour).toEqual(etat(jour));
    }
  });
});

describe('T32a : durée en jours ou en fraction du cycle', () => {
  it('90 jours et 0,6 du cycle (150 jours de la mise en place à la fin de récolte) : même hauteur, même stade, chaque jour', () => {
    expect(ecartEnJours(M, F)).toBe(150);
    const enJours = profil({ duree: { en: 'jours', jours: 90 } });
    const enFraction = profil({ duree: { en: 'fraction_cycle', fraction: 0.6 } });
    for (let n = -3; n <= ecartEnJours(M, A) + 3; n++) {
      const a = etat(j(n), enJours);
      const b = etat(j(n), enFraction);
      expect(b.stade, `jour ${String(n)}`).toBe(a.stade);
      expect(b.hauteurM, `jour ${String(n)}`).toBeCloseTo(a.hauteurM, 9);
      expect(b.fraction, `jour ${String(n)}`).toBeCloseTo(a.fraction, 9);
    }
  });

  it('fraction 1 : hauteur maximale le jour de la fin de récolte', () => {
    const p = profil({ duree: { en: 'fraction_cycle', fraction: 1 } });
    attendu(etat(j(75), p), 'pleine_production', 1, p);
    attendu(etat(j(-1, F), p), 'pleine_production', (2 * 149) / 150, p);
    attendu(etat(F, p), 'fin', 2, p);
  });

  it('fraction sans fin de récolte : fraction de la durée jusqu’à l’arrachage', () => {
    const p = profil({ duree: { en: 'fraction_cycle', fraction: 0.5 } });
    const dates: DatesCroissance = { ...DATES_TOMATE, debutRecolte: prevue(null), finRecolte: prevue(null), arrachage: prevue(j(100)) };
    attendu(etat(j(25), p, dates), 'croissance', 1, p);
    attendu(etat(j(50), p, dates), 'pleine_production', 2, p);
    attendu(etat(j(99), p, dates), 'pleine_production', 2, p);
    attendu(etat(j(100), p, dates), 'aucun', 0, p);
  });

  it('fraction sans fin de récolte ni arrachage : repli sur 60 jours, aucune fin inventée', () => {
    const p = profil({ duree: { en: 'fraction_cycle', fraction: 0.5 } });
    const dates: DatesCroissance = { miseEnPlace: prevue(M), debutRecolte: prevue(null), finRecolte: prevue(null), arrachage: prevue(null) };
    attendu(etat(j(30), p, dates), 'croissance', 1, p);
    attendu(etat(j(60), p, dates), 'pleine_production', 2, p);
    attendu(etat(j(5_000), p, dates), 'pleine_production', 2, p);
  });
});

describe('T32a : dates manquantes', () => {
  it('sans mise en place (ni prévue ni réelle) : rien, à toute date', () => {
    const dates: DatesCroissance = { ...DATES_TOMATE, miseEnPlace: prevue(null) };
    for (const jour of [d('2027-01-01'), M, B, F, d('2027-12-31')]) attendu(etat(jour, TOMATE, dates), 'aucun', 0);
  });

  it('occupation sans date de fin (ni fin de récolte ni arrachage) : hauteur maximale tenue, aucune fin', () => {
    const dates: DatesCroissance = { miseEnPlace: prevue(M), debutRecolte: prevue(B), finRecolte: prevue(null), arrachage: prevue(null) };
    attendu(etat(MAX, TOMATE, dates), 'pleine_production', 2);
    attendu(etat(d('2027-12-31'), TOMATE, dates), 'pleine_production', 2);
    attendu(etat(d('2035-06-01'), TOMATE, dates), 'pleine_production', 2);
  });

  it('sans début de récolte : pleine production à la hauteur maximale seulement', () => {
    const dates: DatesCroissance = { ...DATES_TOMATE, debutRecolte: prevue(null) };
    attendu(etat(B, TOMATE, dates), 'croissance', (2 * 61) / 90);
    attendu(etat(MAX, TOMATE, dates), 'pleine_production', 2);
  });

  it('arrachage inconnu mais fin de récolte connue : fin tenue sans limite', () => {
    const dates: DatesCroissance = { ...DATES_TOMATE, arrachage: prevue(null) };
    attendu(etat(F, TOMATE, dates), 'fin', 2);
    attendu(etat(d('2028-03-01'), TOMATE, dates), 'fin', 2);
  });
});

describe('T32a : la date réelle remplace la date prévue', () => {
  it('mise en place réelle 10 jours plus tard : rien avant, croissance décalée', () => {
    const dates: DatesCroissance = { ...DATES_TOMATE, miseEnPlace: { prevue: M, reelle: d('2027-05-11') } };
    attendu(etat(d('2027-05-05'), TOMATE, dates), 'aucun', 0);
    attendu(etat(d('2027-05-11'), TOMATE, dates), 'levee', 0);
    attendu(etat(d('2027-06-25'), TOMATE, dates), 'croissance', 1);
  });

  it('début de récolte réel plus tôt : pleine production dès ce jour', () => {
    const dates: DatesCroissance = { ...DATES_TOMATE, debutRecolte: { prevue: B, reelle: d('2027-06-15') } };
    attendu(etat(d('2027-06-15'), TOMATE, dates), 'pleine_production', (2 * 45) / 90);
    attendu(etat(d('2027-06-14'), TOMATE, dates), 'croissance', (2 * 44) / 90);
  });

  it('fin de récolte réelle plus tôt : fin dès ce jour', () => {
    const dates: DatesCroissance = { ...DATES_TOMATE, finRecolte: { prevue: F, reelle: d('2027-09-10') } };
    attendu(etat(d('2027-09-09'), TOMATE, dates), 'pleine_production', 2);
    attendu(etat(d('2027-09-10'), TOMATE, dates), 'fin', 2);
  });

  it('arrachage réel plus tôt (ou plus tard) que prévu : rien à partir du jour réel seulement', () => {
    const tot: DatesCroissance = { ...DATES_TOMATE, arrachage: { prevue: A, reelle: d('2027-09-30') } };
    attendu(etat(d('2027-09-29'), TOMATE, tot), 'fin', 2);
    attendu(etat(d('2027-09-30'), TOMATE, tot), 'aucun', 0);
    const tard: DatesCroissance = { ...DATES_TOMATE, arrachage: { prevue: A, reelle: d('2027-10-31') } };
    attendu(etat(A, TOMATE, tard), 'fin', 2);
    attendu(etat(d('2027-10-31'), TOMATE, tard), 'aucun', 0);
  });

  it('date réelle sans date prévue : la réelle compte', () => {
    const dates: DatesCroissance = { ...DATES_TOMATE, miseEnPlace: { prevue: null, reelle: M } };
    attendu(etat(j(30), TOMATE, dates), 'croissance', (2 * 30) / 90);
  });

  it('fraction du cycle : calculée sur les dates réelles', () => {
    const p = profil({ duree: { en: 'fraction_cycle', fraction: 0.5 } });
    const dates: DatesCroissance = { ...DATES_TOMATE, finRecolte: { prevue: F, reelle: j(100) }, arrachage: { prevue: A, reelle: j(120) } };
    attendu(etat(j(25), p, dates), 'croissance', 1, p);
    attendu(etat(j(50), p, dates), 'pleine_production', 2, p);
  });
});

describe('T32a : cycles très courts et très longs', () => {
  it('cycle d’un jour, récolte dès la mise en place : pleine production à hauteur 0 ce jour-là, rien le lendemain', () => {
    const p = profil({ duree: { en: 'fraction_cycle', fraction: 1 } });
    const dates: DatesCroissance = { miseEnPlace: prevue(M), debutRecolte: prevue(M), finRecolte: prevue(j(1)), arrachage: prevue(j(1)) };
    const e = etat(M, p, dates);
    expect(e.stade).toBe('pleine_production');
    expect(e.hauteurM).toBe(0);
    attendu(etat(j(1), p, dates), 'aucun', 0, p);
  });

  it('durée d’un jour : hauteur maximale dès le lendemain de la mise en place', () => {
    const p = profil({ duree: { en: 'jours', jours: 1 } });
    attendu(etat(M, p), 'levee', 0, p);
    attendu(etat(j(1), p), 'pleine_production', 2, p);
  });

  it('cycle de longueur nulle (fin de récolte le jour de la mise en place) : valeurs finies, bornées, sans division par zéro', () => {
    const p = profil({ duree: { en: 'fraction_cycle', fraction: 0.5 } });
    const dates: DatesCroissance = { miseEnPlace: prevue(M), debutRecolte: prevue(M), finRecolte: prevue(M), arrachage: prevue(j(3)) };
    for (const jour of [M, j(1), j(2)]) {
      const e = etat(jour, p, dates);
      expect(Number.isFinite(e.hauteurM)).toBe(true);
      expect(e.hauteurM).toBeGreaterThanOrEqual(0);
      expect(e.hauteurM).toBeLessThanOrEqual(2);
      expect(e.stade).toBe('fin');
    }
  });

  it('cycle de deux ans : durée de 730 jours, moitié à un an, maximum à deux ans, tenu ensuite', () => {
    const p = profil({ duree: { en: 'jours', jours: 730 } });
    const debut = d('2027-01-01');
    const dates: DatesCroissance = { miseEnPlace: prevue(debut), debutRecolte: prevue(null), finRecolte: prevue(null), arrachage: prevue(null) };
    attendu(etat(ajouterJours(debut, 365), p, dates), 'croissance', 1, p);
    attendu(etat(ajouterJours(debut, 730), p, dates), 'pleine_production', 2, p);
    attendu(etat(ajouterJours(debut, 3_650), p, dates), 'pleine_production', 2, p);
  });

  it('courbe en S sur 400 jours : un quart du temps → 15,625 % de la hauteur', () => {
    const p = profil({ duree: { en: 'jours', jours: 400 }, allure: 'en-s' });
    const debut = d('2027-01-01');
    const dates: DatesCroissance = { miseEnPlace: prevue(debut), debutRecolte: prevue(null), finRecolte: prevue(null), arrachage: prevue(null) };
    attendu(etat(ajouterJours(debut, 100), p, dates), 'croissance', 2 * 0.15625, p);
  });
});

// ── Propriétés ───────────────────────────────────────────────────────────────────────────────

/** Générateur pseudo-aléatoire déterministe (LCG de Numerical Recipes). */
function alea(graine: number): () => number {
  let s = graine >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

const ORDRE: readonly StadeCroissance[] = ['aucun', 'levee', 'croissance', 'pleine_production', 'fin'];

describe('T32a : propriétés (profils par défaut et profils tirés au hasard)', () => {
  function profils(): ProfilCroissance[] {
    const r = alea(32);
    const tires: ProfilCroissance[] = [];
    for (let i = 0; i < 60; i++) {
      tires.push(
        profil({
          hauteurMaxM: 0.01 + r() * 5.99,
          duree: r() < 0.5 ? { en: 'jours', jours: 1 + Math.floor(r() * 730) } : { en: 'fraction_cycle', fraction: Math.max(1e-6, r()) },
          allure: r() < 0.5 ? 'lineaire' : 'en-s',
          finDeCycle: r() < 0.5 ? 'conservee' : 'baissee',
        }),
      );
    }
    return [...m.PROFILS_PAR_DEFAUT.map((p) => p.profil), m.PROFIL_GENERIQUE.profil, ...tires];
  }

  function datesTirees(): DatesCroissance[] {
    const r = alea(7);
    const liste: DatesCroissance[] = [DATES_TOMATE];
    for (let i = 0; i < 8; i++) {
      const mep = ajouterJours(d('2027-03-01'), Math.floor(r() * 120));
      const b = ajouterJours(mep, Math.floor(r() * 200));
      const f = ajouterJours(b, Math.floor(r() * 120));
      const a = ajouterJours(f, Math.floor(r() * 30));
      liste.push({ miseEnPlace: prevue(mep), debutRecolte: prevue(b), finRecolte: prevue(f), arrachage: prevue(a) });
    }
    liste.push({ miseEnPlace: prevue(M), debutRecolte: prevue(null), finRecolte: prevue(null), arrachage: prevue(null) });
    return liste;
  }

  it('hauteur jamais négative, jamais au-dessus du maximum, fraction dans [0, 1], monotone croissante jusqu’à la fin de récolte', () => {
    let faute: string | null = null;
    for (const p of profils()) {
      for (const dates of datesTirees()) {
        const debut = dates.miseEnPlace.prevue ?? M;
        const fin = dates.finRecolte.prevue ?? ajouterJours(debut, 800);
        let avant = -1;
        for (let n = -2; n < ecartEnJours(debut, fin) && faute === null; n++) {
          const e = m.croissanceA(dates, p, ajouterJours(debut, n));
          const ok =
            e.hauteurM >= 0 &&
            e.hauteurM <= p.hauteurMaxM &&
            e.fraction >= 0 &&
            e.fraction <= 1 &&
            Math.abs(e.fraction - e.hauteurM / p.hauteurMaxM) < 1e-9 &&
            e.hauteurM + 1e-12 >= avant;
          if (!ok) faute = `${JSON.stringify(p)} ${JSON.stringify(dates)} jour ${String(n)} : ${JSON.stringify(e)} (avant ${String(avant)})`;
          avant = e.hauteurM;
        }
      }
    }
    expect(faute).toBeNull();
  });

  it('les stades se suivent dans l’ordre : rien, levée, croissance, pleine production, fin, puis rien', () => {
    let faute: string | null = null;
    for (const p of profils()) {
      for (const dates of datesTirees()) {
        const debut = dates.miseEnPlace.prevue ?? M;
        const a = dates.arrachage.prevue ?? ajouterJours(debut, 800);
        let rang = 0;
        let arrache = false;
        for (let n = -2; n <= ecartEnJours(debut, a) + 2 && faute === null; n++) {
          const { stade } = m.croissanceA(dates, p, ajouterJours(debut, n));
          const ctx = `${JSON.stringify(p)} ${JSON.stringify(dates)} jour ${String(n)} : ${stade}`;
          const r = ORDRE.indexOf(stade);
          if (arrache) {
            if (stade !== 'aucun') faute = `${ctx} après l’arrachage`;
          } else if (r < 0) faute = `${ctx} : stade d’une pérenne`;
          else if (r === 0 && rang > 0) arrache = true;
          else if (r < rang) faute = `${ctx} : retour en arrière`;
          else rang = r;
        }
      }
    }
    expect(faute).toBeNull();
  });

  it('hors de [mise en place, arrachage[ : rien, hauteur 0', () => {
    for (const p of profils()) {
      for (const dates of datesTirees()) {
        const debut = dates.miseEnPlace.prevue ?? M;
        expect(m.croissanceA(dates, p, ajouterJours(debut, -1))).toEqual({ stade: 'aucun', hauteurM: 0, fraction: 0 });
        const a = dates.arrachage.prevue;
        if (a !== null) expect(m.croissanceA(dates, p, a)).toEqual({ stade: 'aucun', hauteurM: 0, fraction: 0 });
      }
    }
  });
});
