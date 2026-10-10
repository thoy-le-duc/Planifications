/**
 * Tests d'acceptation T32e — état de récolte d'une occupation (cœur, calcul pur). Écrits AVANT le
 * code : ils échouent tant que `recolteA`, `recoltePerenneA`, `PHASES_RECOLTE`,
 * `JOURS_FORMATION_FRUITS` et `JOURS_FIN_RECOLTE` ne sont pas exportés. Contrat :
 * ./test/contrat-recolte.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import { chargerRecolte, type DateCalendaire, type DatesCroissance, type EntreePerenne, type ModuleRecolte } from './test/contrat-recolte.ts';

let m: ModuleRecolte;
beforeAll(async () => {
  m = await chargerRecolte();
});

const d = (s: string): DateCalendaire => s as DateCalendaire;
const repere = (prevue: string | null, reelle: string | null = null) => ({ prevue: prevue === null ? null : d(prevue), reelle: reelle === null ? null : d(reelle) });

/** Courgette : mise en place le 15 mai, récolte du 1er juillet au 1er septembre, arrachage le 15 septembre. */
const COURGETTE: DatesCroissance = {
  miseEnPlace: repere('2027-05-15'),
  debutRecolte: repere('2027-07-01'),
  finRecolte: repere('2027-09-01'),
  arrachage: repere('2027-09-15'),
};
const B = d('2027-07-01');
const F = d('2027-09-01');
const avant = (jour: DateCalendaire, n: number): DateCalendaire => ajouterJours(jour, -n);

describe('T32e : constantes et phases', () => {
  it('quatre phases, dans l’ordre', () => {
    expect(m.PHASES_RECOLTE).toEqual(['aucune', 'fruits-en-formation', 'a-recolter', 'fin-de-recolte']);
  });

  it('formation des fruits : un entier de 7 à 42 jours ; fin de récolte : un entier de 7 à 28 jours', () => {
    expect(Number.isInteger(m.JOURS_FORMATION_FRUITS)).toBe(true);
    expect(m.JOURS_FORMATION_FRUITS).toBeGreaterThanOrEqual(7);
    expect(m.JOURS_FORMATION_FRUITS).toBeLessThanOrEqual(42);
    expect(Number.isInteger(m.JOURS_FIN_RECOLTE)).toBe(true);
    expect(m.JOURS_FIN_RECOLTE).toBeGreaterThanOrEqual(7);
    expect(m.JOURS_FIN_RECOLTE).toBeLessThanOrEqual(28);
  });
});

describe('T32e : courgette, du plant à l’arrachage', () => {
  it('avant la formation des fruits (et avant la mise en place) : aucune, maturité 0', () => {
    expect(m.recolteA(COURGETTE, d('2027-05-14'))).toEqual({ phase: 'aucune', maturite: 0 });
    expect(m.recolteA(COURGETTE, avant(B, m.JOURS_FORMATION_FRUITS + 1))).toEqual({ phase: 'aucune', maturite: 0 });
  });

  it('une semaine avant le début de récolte : fruits en formation, maturité entre 0 et 1', () => {
    const e = m.recolteA(COURGETTE, avant(B, 7));
    expect(e.phase).toBe('fruits-en-formation');
    expect(e.maturite).toBeGreaterThan(0);
    expect(e.maturite).toBeLessThan(1);
  });

  it('maturité linéaire : 0 le premier jour de formation, (jour − (B − N)) / N ensuite, < 1 la veille du début', () => {
    const N = m.JOURS_FORMATION_FRUITS;
    const premier = m.recolteA(COURGETTE, avant(B, N));
    expect(premier.phase).toBe('fruits-en-formation');
    expect(premier.maturite).toBeCloseTo(0, 12);
    const milieu = m.recolteA(COURGETTE, avant(B, N / 2));
    expect(milieu.maturite).toBeCloseTo(0.5, 9);
    const veille = m.recolteA(COURGETTE, avant(B, 1));
    expect(veille.phase).toBe('fruits-en-formation');
    expect(veille.maturite).toBeCloseTo((N - 1) / N, 9);
    expect(veille.maturite).toBeLessThan(1);
  });

  it('la maturité croît strictement, jour après jour, pendant toute la formation', () => {
    let precedente = -1;
    for (let k = m.JOURS_FORMATION_FRUITS; k >= 1; k -= 1) {
      const e = m.recolteA(COURGETTE, avant(B, k));
      expect(e.phase, `B − ${String(k)}`).toBe('fruits-en-formation');
      expect(e.maturite, `B − ${String(k)}`).toBeGreaterThan(precedente);
      precedente = e.maturite;
    }
  });

  it('au début de récolte et pendant la fenêtre : à récolter, maturité 1', () => {
    for (const jour of [B, ajouterJours(B, 1), ajouterJours(B, 20), avant(F, m.JOURS_FIN_RECOLTE + 1)]) {
      expect(m.recolteA(COURGETTE, jour), jour).toEqual({ phase: 'a-recolter', maturite: 1 });
    }
  });

  it('dernières semaines de la fenêtre : fin de récolte, maturité 1', () => {
    for (const jour of [avant(F, m.JOURS_FIN_RECOLTE), avant(F, 3), avant(F, 1)]) {
      expect(m.recolteA(COURGETTE, jour), jour).toEqual({ phase: 'fin-de-recolte', maturite: 1 });
    }
  });

  it('après la fin de récolte, tant que la plante est en place : fin de récolte', () => {
    expect(m.recolteA(COURGETTE, F)).toEqual({ phase: 'fin-de-recolte', maturite: 1 });
    expect(m.recolteA(COURGETTE, d('2027-09-14'))).toEqual({ phase: 'fin-de-recolte', maturite: 1 });
  });

  it('après l’arrachage (le jour même compris) : aucune', () => {
    expect(m.recolteA(COURGETTE, d('2027-09-15'))).toEqual({ phase: 'aucune', maturite: 0 });
    expect(m.recolteA(COURGETTE, d('2027-12-01'))).toEqual({ phase: 'aucune', maturite: 0 });
  });

  it('la formation ne commence jamais avant la mise en place', () => {
    const tot = { ...COURGETTE, miseEnPlace: repere(ajouterJours(B, -3)) };
    expect(m.recolteA(tot, avant(B, 4)).phase).toBe('aucune');
    expect(m.recolteA(tot, avant(B, 3)).phase).toBe('fruits-en-formation');
  });

  it('la phase ne recule jamais sur toute la saison (aucune, formation, à récolter, fin, aucune)', () => {
    const vues: string[] = [];
    for (let k = 0; k < 220; k += 1) {
      const { phase } = m.recolteA(COURGETTE, ajouterJours(d('2027-05-01'), k));
      if (vues.at(-1) !== phase) vues.push(phase);
    }
    expect(vues).toEqual(['aucune', 'fruits-en-formation', 'a-recolter', 'fin-de-recolte', 'aucune']);
  });
});

describe('T32e : rien n’est inventé sans date', () => {
  it('sans début de récolte : aucune, toute la saison', () => {
    const sans: DatesCroissance = { ...COURGETTE, debutRecolte: repere(null) };
    for (const jour of ['2027-05-20', '2027-07-01', '2027-08-15', '2027-09-10']) expect(m.recolteA(sans, d(jour)), jour).toEqual({ phase: 'aucune', maturite: 0 });
  });

  it('une fin de récolte sans début : aucune', () => {
    const sans: DatesCroissance = { ...COURGETTE, debutRecolte: repere(null) };
    expect(sans.finRecolte.prevue).not.toBeNull();
    expect(m.recolteA(sans, avant(F, 2)).phase).toBe('aucune');
  });

  it('début connu, fin inconnue : à récolter dès le début, jusqu’à l’arrachage, sans fin inventée', () => {
    const sansFin: DatesCroissance = { ...COURGETTE, finRecolte: repere(null) };
    expect(m.recolteA(sansFin, ajouterJours(B, 30))).toEqual({ phase: 'a-recolter', maturite: 1 });
    expect(m.recolteA(sansFin, d('2027-09-14'))).toEqual({ phase: 'a-recolter', maturite: 1 });
    expect(m.recolteA(sansFin, d('2027-09-15')).phase).toBe('aucune');
  });

  it('ni fin ni arrachage : à récolter indéfiniment', () => {
    const ouvert: DatesCroissance = { ...COURGETTE, finRecolte: repere(null), arrachage: repere(null) };
    expect(m.recolteA(ouvert, d('2028-03-01'))).toEqual({ phase: 'a-recolter', maturite: 1 });
  });
});

describe('T32e : les dates réelles priment sur les prévues', () => {
  it('début réel plus tôt : à récolter alors que la prévue dirait « en formation »', () => {
    const jour = d('2027-06-25');
    expect(m.recolteA(COURGETTE, jour).phase).toBe('fruits-en-formation');
    const reelle: DatesCroissance = { ...COURGETTE, debutRecolte: repere('2027-07-01', '2027-06-20') };
    expect(m.recolteA(reelle, jour)).toEqual({ phase: 'a-recolter', maturite: 1 });
  });

  it('début réel plus tard : encore en formation alors que la prévue dirait « à récolter »', () => {
    const jour = d('2027-07-05');
    expect(m.recolteA(COURGETTE, jour).phase).toBe('a-recolter');
    const reelle: DatesCroissance = { ...COURGETTE, debutRecolte: repere('2027-07-01', '2027-07-12') };
    const e = m.recolteA(reelle, jour);
    expect(e.phase).toBe('fruits-en-formation');
    expect(e.maturite).toBeCloseTo((m.JOURS_FORMATION_FRUITS - 7) / m.JOURS_FORMATION_FRUITS, 9);
  });

  it('fin réelle plus tôt : fin de récolte plus tôt', () => {
    const jour = d('2027-07-30');
    expect(m.recolteA(COURGETTE, jour).phase).toBe('a-recolter');
    const reelle: DatesCroissance = { ...COURGETTE, finRecolte: repere('2027-09-01', '2027-08-01') };
    expect(m.recolteA(reelle, jour).phase).toBe('fin-de-recolte');
  });

  it('arrachage réel plus tôt : la plante n’est plus là', () => {
    const jour = d('2027-09-10');
    expect(m.recolteA(COURGETTE, jour).phase).toBe('fin-de-recolte');
    const reelle: DatesCroissance = { ...COURGETTE, arrachage: repere('2027-09-15', '2027-09-05') };
    expect(m.recolteA(reelle, jour)).toEqual({ phase: 'aucune', maturite: 0 });
  });

  it('début réel rempli alors que la prévue manque : la réelle suffit', () => {
    const reelleSeule: DatesCroissance = { ...COURGETTE, debutRecolte: repere(null, '2027-07-01') };
    expect(m.recolteA(reelleSeule, d('2027-07-10')).phase).toBe('a-recolter');
  });
});

describe('T32e : pérenne à récolte annuelle (fraise)', () => {
  const PLANTATION = { datePlantation: d('2024-03-01'), dateArrachage: null };
  const campagne = (annee: number, debut: string | null, fin: string | null): EntreePerenne['campagne'] => ({ annee, debutRecolte: debut === null ? null : d(debut), finRecolte: fin === null ? null : d(fin) });
  const fraise2027: EntreePerenne = { plantation: PLANTATION, campagne: campagne(2027, '2027-05-10', '2027-06-30') };
  const debut = d('2027-05-10');
  const fin = d('2027-06-30');

  it('suit sa période de récolte de l’année : formation, à récolter, fin de récolte', () => {
    expect(m.recoltePerenneA(fraise2027, d('2027-03-15')).phase).toBe('aucune');
    const formation = m.recoltePerenneA(fraise2027, avant(debut, 7));
    expect(formation.phase).toBe('fruits-en-formation');
    expect(formation.maturite).toBeGreaterThan(0);
    expect(formation.maturite).toBeLessThan(1);
    expect(m.recoltePerenneA(fraise2027, debut)).toEqual({ phase: 'a-recolter', maturite: 1 });
    expect(m.recoltePerenneA(fraise2027, d('2027-06-01'))).toEqual({ phase: 'a-recolter', maturite: 1 });
    expect(m.recoltePerenneA(fraise2027, avant(fin, 2))).toEqual({ phase: 'fin-de-recolte', maturite: 1 });
  });

  it('même maturité que la culture annuelle pour le même écart au début de récolte', () => {
    const annuelle = m.recolteA(COURGETTE, avant(B, 10));
    const perenne = m.recoltePerenneA({ plantation: PLANTATION, campagne: campagne(2027, '2027-07-01', '2027-09-01') }, avant(B, 10));
    expect(perenne).toEqual(annuelle);
  });

  it('pas de campagne cette année-là : aucune (la période est annuelle)', () => {
    expect(m.recoltePerenneA({ plantation: PLANTATION, campagne: null }, d('2027-05-20')).phase).toBe('aucune');
    expect(m.recoltePerenneA(fraise2027, d('2028-05-20')).phase).toBe('aucune');
  });

  it('campagne sans date de début : aucune', () => {
    expect(m.recoltePerenneA({ plantation: PLANTATION, campagne: campagne(2027, null, '2027-06-30') }, d('2027-06-01')).phase).toBe('aucune');
    expect(m.recoltePerenneA({ plantation: PLANTATION, campagne: campagne(2027, null, null) }, d('2027-06-01')).phase).toBe('aucune');
  });

  it('chaque année avec campagne, le cycle recommence', () => {
    const fraise2028: EntreePerenne = { plantation: PLANTATION, campagne: campagne(2028, '2028-05-12', '2028-07-01') };
    expect(m.recoltePerenneA(fraise2028, d('2028-05-20')).phase).toBe('a-recolter');
    expect(m.recoltePerenneA(fraise2028, d('2028-05-05')).phase).toBe('fruits-en-formation');
  });

  it('avant la plantation et à partir de l’arrachage : aucune', () => {
    const neuve: EntreePerenne = { plantation: { datePlantation: d('2027-06-10'), dateArrachage: null }, campagne: fraise2027.campagne };
    expect(m.recoltePerenneA(neuve, d('2027-06-01')).phase).toBe('aucune');
    const arrachee: EntreePerenne = { plantation: { datePlantation: d('2024-03-01'), dateArrachage: d('2027-06-01') }, campagne: fraise2027.campagne };
    expect(m.recoltePerenneA(arrachee, d('2027-05-20')).phase).toBe('a-recolter');
    expect(m.recoltePerenneA(arrachee, d('2027-06-01'))).toEqual({ phase: 'aucune', maturite: 0 });
  });

  it('début connu, fin inconnue : à récolter dès le début', () => {
    expect(m.recoltePerenneA({ plantation: PLANTATION, campagne: campagne(2027, '2027-05-10', null) }, d('2027-06-20'))).toEqual({ phase: 'a-recolter', maturite: 1 });
  });
});

describe('T32e : pur et déterministe', () => {
  it('même entrée, même sortie ; l’entrée n’est pas modifiée', () => {
    const copie = JSON.stringify(COURGETTE);
    const a = m.recolteA(COURGETTE, d('2027-06-25'));
    const b = m.recolteA(COURGETTE, d('2027-06-25'));
    expect(a).toEqual(b);
    expect(JSON.stringify(COURGETTE)).toBe(copie);
  });

  it('maturité toujours dans [0, 1], sur trois ans de jours', () => {
    for (let k = 0; k < 1100; k += 7) {
      const e = m.recolteA(COURGETTE, ajouterJours(d('2026-01-01'), k));
      expect(e.maturite).toBeGreaterThanOrEqual(0);
      expect(e.maturite).toBeLessThanOrEqual(1);
      if (e.phase === 'aucune') expect(e.maturite).toBe(0);
    }
  });
});
