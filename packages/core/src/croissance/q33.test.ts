/**
 * Tests d'acceptation T32b, cœur — valeurs par défaut de Q33 (docs/questions.md, réponses de
 * Théophane du 2026-10-09), à côté de ceux de T32a. Les tests de T32a (annuelle, perenne, profil)
 * restent les arbitres du reste ; deux assertions seulement ont changé (commit séparé, Q33).
 *
 * ── API attendue (ajouts à `src/croissance/index.ts`, réexportés par `@planif/core`) ─────────
 *
 *   HAUTEUR_TRAVAIL_HORS_SOL_M: number
 *       hauteur de la gouttière surélevée du fraisier hors-sol, dans [0,8 ; 1,2] m (environ 1 m).
 *   surelevationHorsSolM(nomEspece: string, horsSol: boolean): number
 *       Fraisier (et synonyme Fraise, mêmes règles de rapprochement que profilParDefaut) en
 *       hors-sol → HAUTEUR_TRAVAIL_HORS_SOL_M ; fraisier au sol → 0 ; toute autre espèce → 0, hors-sol
 *       ou pas. Ne lève jamais.
 *       « Hors-sol » existe déjà dans les données : zone.type_abri = 'hors_sol' (docs/modele-donnees.md,
 *       packages/db) et emplacement.sorte = 'gouttiere'. L'appelant (la scène 3D) décide du booléen ;
 *       aucun champ n'est inventé dans le cœur ni dans le profil.
 *   hauteurStructureM(profil: ProfilCroissance): number
 *       hauteur (m) de la structure qui reste visible au repos (pergola et bois du kiwi). Pour
 *       forme 'arbre-ou-liane' : > 0 et ≤ hauteurMaxM ; pour toute autre forme : 0. Ne dépend ni de
 *       la date ni du stade ; `croissancePerenneA` ne change pas (le feuillage reste à 0 au repos).
 *
 * ── Valeurs par défaut (profilParDefaut / croissancePerenneA) ────────────────────────────────
 *   Tomate : hauteurMaxM 3, forme 'erige-tuteure', hauteur conservée en fin de récolte.
 *   Asperge (campagne annuelle) : fin de récolte F = campagne.finRecolte si elle est connue, sinon
 *     le 15 juin de l'année. Jusqu'à F compris : pas de fougère (hauteur 0, fraction 0). À partir
 *     du lendemain de F, la fougère part de 0 et monte en `duree.jours` jusqu'à 1,5 m (courbe du
 *     profil), puis reste à 1,5 m jusqu'au repos du 15 novembre (hauteur 0 dès le 15 novembre).
 *     Le profil par défaut de l'asperge garde `duree` en jours et un cycle annuel qui finit le
 *     15 novembre ; comment « fougère après récolte » est porté (champ du profil, ou autre) est
 *     libre : seuls les comportements ci-dessous sont testés.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours, ecartEnJours } from '../dates/index.ts';
import {
  chargerCoeurCroissance,
  chargerCroissance,
  d,
  enS,
  type EntreePerenne,
  type EtatCroissance,
  type ModuleCroissance,
  type ProfilCroissance,
} from './test/contrat.ts';

interface ModuleQ33 {
  readonly HAUTEUR_TRAVAIL_HORS_SOL_M: number;
  surelevationHorsSolM(nomEspece: string, horsSol: boolean): number;
  hauteurStructureM(profil: ProfilCroissance): number;
}

let m: ModuleCroissance;
let brut: Partial<ModuleQ33>;

beforeAll(async () => {
  m = await chargerCroissance();
  brut = (await chargerCoeurCroissance()) as Partial<ModuleQ33>;
});

/** Les ajouts de Q33, ou une erreur claire qui nomme ce qui manque (les tests de valeurs par défaut n'en dépendent pas). */
const q: ModuleQ33 = {
  get HAUTEUR_TRAVAIL_HORS_SOL_M(): number {
    return exiger('HAUTEUR_TRAVAIL_HORS_SOL_M');
  },
  surelevationHorsSolM: (nom, horsSol) => exiger('surelevationHorsSolM')(nom, horsSol),
  hauteurStructureM: (profil) => exiger('hauteurStructureM')(profil),
};

function exiger<K extends keyof ModuleQ33>(nom: K): ModuleQ33[K] {
  const v = brut[nom];
  if (v === undefined) throw new Error(`@planif/core n'exporte pas encore : ${nom} (T32b, Q33)`);
  return v;
}

const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };

const campagne = (annee: number, debut: string | null, fin: string | null): EntreePerenne['campagne'] => ({
  annee,
  debutRecolte: debut === null ? null : d(debut),
  finRecolte: fin === null ? null : d(fin),
});

const courbe = (p: ProfilCroissance, x: number): number => (p.allure === 'en-s' ? enS(Math.min(Math.max(x, 0), 1)) : Math.min(Math.max(x, 0), 1));

describe('Q33 : tomate à 3 m', () => {
  it('le profil par défaut : 3 m, tuteurée, hauteur conservée', () => {
    expect(m.profilParDefaut('Tomate').profil).toMatchObject({ hauteurMaxM: 3, forme: 'erige-tuteure', finDeCycle: 'conservee' });
  });

  it('à pleine production (mise en place le 1er mai, 90 jours) : 3 m, et 3 m tenus jusqu’à l’arrachage', () => {
    const p = m.profilParDefaut('Tomate').profil;
    expect(p.duree.en).toBe('jours');
    const jours = p.duree.en === 'jours' ? p.duree.jours : 0;
    const M = d('2027-05-01');
    const dates = {
      miseEnPlace: { prevue: M, reelle: null },
      debutRecolte: { prevue: ajouterJours(M, 60), reelle: null },
      finRecolte: { prevue: d('2027-09-15'), reelle: null },
      arrachage: { prevue: d('2027-10-15'), reelle: null },
    };
    const plein = m.croissanceA(dates, p, ajouterJours(M, jours));
    expect(plein.stade).toBe('pleine_production');
    expect(plein.hauteurM).toBeCloseTo(3, 9);
    expect(plein.fraction).toBeCloseTo(1, 9);
    expect(m.croissanceA(dates, p, d('2027-09-14')).hauteurM).toBeCloseTo(3, 9);
    expect(m.croissanceA(dates, p, d('2027-10-01'))).toMatchObject({ stade: 'fin', hauteurM: 3 });
    // à mi-chemin elle est plus basse, au jour de mise en place elle est à 0
    expect(m.croissanceA(dates, p, M).hauteurM).toBe(0);
    const mi = m.croissanceA(dates, p, ajouterJours(M, Math.floor(jours / 2))).hauteurM;
    expect(mi).toBeGreaterThan(0);
    expect(mi).toBeLessThan(3);
  });
});

describe('Q33 : asperge, turions seuls pendant la récolte, fougère ensuite', () => {
  const ASPERGE = (): ProfilCroissance => m.profilParDefaut('Asperge').profil;
  const etat = (jour: string, c: EntreePerenne['campagne']): EtatCroissance => m.croissancePerenneA({ plantation: PLANTATION, campagne: c }, ASPERGE(), d(jour));
  const SANS_DATES = campagne(2027, null, null);

  it('profil : 1,5 m, durée en jours, repos le 15 novembre', () => {
    const p = ASPERGE();
    expect(p.hauteurMaxM).toBe(1.5);
    expect(p.duree.en).toBe('jours');
    expect(p.cycleAnnuel?.repos).toBe('11-15');
  });

  it('fin de récolte par défaut (15 juin) : pas de fougère du début de saison au 15 juin compris', () => {
    for (const jour of ['2027-01-15', '2027-03-31', '2027-04-01', '2027-04-20', '2027-05-15', '2027-06-01', '2027-06-14', '2027-06-15']) {
      const e = etat(jour, SANS_DATES);
      expect(e.hauteurM, jour).toBe(0);
      expect(e.fraction, jour).toBe(0);
    }
  });

  it('après le 15 juin la fougère part de 0 et monte jusqu’à 1,5 m, sur la durée du profil', () => {
    const p = ASPERGE();
    const jours = p.duree.en === 'jours' ? p.duree.jours : 100;
    const D = d('2027-06-16');
    expect(etat('2027-06-16', SANS_DATES).hauteurM).toBe(0);
    for (const n of [10, Math.floor(jours / 2), jours - 1]) {
      const e = etat(ajouterJours(D, n), SANS_DATES);
      expect(e.hauteurM, `jour +${String(n)}`).toBeCloseTo(1.5 * courbe(p, n / jours), 9);
      expect(e.fraction, `jour +${String(n)}`).toBeCloseTo(courbe(p, n / jours), 9);
      expect(e.hauteurM, `jour +${String(n)}`).toBeGreaterThan(0);
    }
    const haute = etat(ajouterJours(D, jours), SANS_DATES);
    expect(haute).toEqual({ stade: 'pleine_vegetation', hauteurM: 1.5, fraction: 1 });
  });

  it('1,5 m tenus jusqu’à la veille du repos, repos le 15 novembre', () => {
    for (const jour of ['2027-10-01', '2027-10-31', '2027-11-14']) expect(etat(jour, SANS_DATES), jour).toEqual({ stade: 'pleine_vegetation', hauteurM: 1.5, fraction: 1 });
    expect(etat('2027-11-15', SANS_DATES)).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
    expect(etat('2027-12-31', SANS_DATES)).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
  });

  it('date réelle de fin de récolte (10 juillet) : pas de fougère jusqu’à ce jour compris, elle monte ensuite', () => {
    const c = campagne(2027, null, '2027-07-10');
    const p = ASPERGE();
    const jours = p.duree.en === 'jours' ? p.duree.jours : 100;
    for (const jour of ['2027-06-16', '2027-06-30', '2027-07-09', '2027-07-10', '2027-07-11']) expect(etat(jour, c).hauteurM, jour).toBe(0);
    const n = 30;
    const jour = ajouterJours(d('2027-07-11'), n);
    expect(etat(jour, c).hauteurM).toBeCloseTo(1.5 * courbe(p, n / jours), 9);
    expect(etat(ajouterJours(d('2027-07-11'), jours), c).hauteurM).toBeCloseTo(1.5, 9);
  });

  it('fin de récolte réelle plus tôt (31 mai) : la fougère monte déjà le 15 juin', () => {
    const c = campagne(2027, null, '2027-05-31');
    const p = ASPERGE();
    const jours = p.duree.en === 'jours' ? p.duree.jours : 100;
    expect(etat('2027-05-31', c).hauteurM).toBe(0);
    expect(etat('2027-06-15', c).hauteurM).toBeCloseTo(1.5 * courbe(p, 14 / jours), 9);
    expect(etat('2027-06-15', c).hauteurM).toBeGreaterThan(0);
  });

  it('propriété : sur l’année, la hauteur ne baisse jamais avant le repos et ne dépasse pas 1,5 m (fin par défaut ou réelle)', () => {
    for (const fin of [null, '2027-05-31', '2027-07-10']) {
      let avant = 0;
      let jour = d('2027-01-01');
      for (let n = 0; n < 365; n++, jour = ajouterJours(jour, 1)) {
        const e = etat(jour, campagne(2027, null, fin));
        if (e.stade === 'repos' && jour >= '2027-11-15') {
          expect(e.hauteurM, `${String(fin)} ${jour}`).toBe(0);
          continue;
        }
        expect(e.hauteurM + 1e-12, `${String(fin)} ${jour}`).toBeGreaterThanOrEqual(avant);
        expect(e.hauteurM, `${String(fin)} ${jour}`).toBeLessThanOrEqual(1.5 + 1e-12);
        avant = e.hauteurM;
      }
    }
  });

  it('écart de jours entiers : le lendemain de la fin de récolte est le premier jour de montée', () => {
    expect(ecartEnJours(d('2027-06-15'), d('2027-06-16'))).toBe(1);
    const p = ASPERGE();
    const jours = p.duree.en === 'jours' ? p.duree.jours : 100;
    expect(etat('2027-06-17', SANS_DATES).hauteurM).toBeCloseTo(1.5 * courbe(p, 1 / jours), 9);
  });
});

describe('Q33 : kiwi, la structure reste visible l’hiver', () => {
  const KIWI = (): ProfilCroissance => m.profilParDefaut('Kiwi').profil;

  it('hauteur de structure non nulle, au plus la hauteur maximale', () => {
    const h = q.hauteurStructureM(KIWI());
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(KIWI().hauteurMaxM);
  });

  it('au repos l’hiver : plus de feuillage (hauteur 0, comme T32a) mais la structure demeure', () => {
    for (const jour of ['2027-01-15', '2027-02-28', '2027-12-20']) {
      const e = m.croissancePerenneA({ plantation: PLANTATION, campagne: campagne(2027, null, null) }, KIWI(), d(jour));
      expect(e, jour).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
      expect(q.hauteurStructureM(KIWI()), jour).toBeGreaterThan(0);
    }
  });

  it('seul le kiwi (arbre-ou-liane) a une structure ; une tomate, une salade, une asperge : 0', () => {
    for (const nom of ['Tomate', 'Laitue', 'Asperge', 'Pivoine', 'Fraisier', 'Courgette']) expect(q.hauteurStructureM(m.profilParDefaut(nom).profil), nom).toBe(0);
  });

  it('un profil réglé par la ferme en arbre-ou-liane a aussi sa structure ; en touffe, non', () => {
    const base = KIWI();
    expect(q.hauteurStructureM({ ...base, forme: 'arbre-ou-liane', hauteurMaxM: 4 })).toBeGreaterThan(0);
    expect(q.hauteurStructureM({ ...base, forme: 'touffe' })).toBe(0);
  });
});

describe('Q33 : fraisier hors-sol, sur une gouttière surélevée', () => {
  it('hauteur de travail d’environ 1 m', () => {
    expect(q.HAUTEUR_TRAVAIL_HORS_SOL_M).toBeGreaterThanOrEqual(0.8);
    expect(q.HAUTEUR_TRAVAIL_HORS_SOL_M).toBeLessThanOrEqual(1.2);
  });

  it('fraisier (et fraise) hors-sol : surélevé ; au sol : à 0', () => {
    for (const nom of ['Fraisier', 'Fraise', 'fraisier', 'FRAISE  ']) {
      expect(q.surelevationHorsSolM(nom, true), nom).toBe(q.HAUTEUR_TRAVAIL_HORS_SOL_M);
      expect(q.surelevationHorsSolM(nom, false), nom).toBe(0);
    }
  });

  it('les autres espèces restent au sol, même sur une zone hors-sol', () => {
    for (const nom of ['Tomate', 'Laitue', 'Kiwi', 'Asperge', 'Espèce inconnue', '']) expect(q.surelevationHorsSolM(nom, true), nom).toBe(0);
  });

  it('le profil du fraisier ne change pas avec le hors-sol : mêmes hauteurs de plant (0,25 m)', () => {
    expect(m.profilParDefaut('Fraisier').profil.hauteurMaxM).toBe(0.25);
  });
});
