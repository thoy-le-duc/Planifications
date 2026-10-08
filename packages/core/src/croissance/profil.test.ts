/**
 * Tests d'acceptation T32a — profils de croissance : validation du jsonb `espece.profil_croissance`
 * (règles que la porte du téléphone et le serveur rejouent), profils par défaut de la
 * bibliothèque commune, profil de la ferme qui remplace le défaut (Q32, option A).
 * Contrat (clés, codes, ordre des règles) : ./test/contrat.ts.
 *
 * La liste des espèces à couvrir est LUE, pas recopiée : la bibliothèque des profils elle-même
 * (PROFILS_PAR_DEFAUT), et les espèces de la ferme complète des tests d'import
 * (import/test/jeu-ferme.ts, 40 cultures courantes d'une ferme diversifiée), en plus des
 * espèces nommées par le ticket et des pérennes de la ferme de Théophane.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { fermeComplete } from '../import/test/jeu-ferme.ts';
import {
  chargerCroissance,
  profil,
  sansAccents,
  type CodeErreurCroissance,
  type FormePlant,
  type ModuleCroissance,
  type ProfilCroissance,
  type ResultatCroissance,
} from './test/contrat.ts';

let m: ModuleCroissance;

beforeAll(async () => {
  m = await chargerCroissance();
});

function valide<T>(r: ResultatCroissance<T>): T {
  if (!r.ok) throw new Error(`refusé à tort : ${r.erreur.code} (${String(r.erreur.champ)}) — ${r.erreur.message}`);
  return r.valeur;
}

function refuse<T>(r: ResultatCroissance<T>, code: CodeErreurCroissance, champ: string | null): void {
  expect(r.ok, 'le profil aurait dû être refusé').toBe(false);
  if (r.ok) return;
  expect({ code: r.erreur.code, champ: r.erreur.champ }).toEqual({ code, champ });
  expect(r.erreur.message.trim().length).toBeGreaterThan(0);
  expect(r.erreur.message.length).toBeLessThanOrEqual(200);
  expect(r.erreur.message).not.toMatch(/\b(error|invalid|must|undefined|NaN|null|NULL|jsonb?)\b/i);
}

const PERENNE: ProfilCroissance = profil({
  forme: 'arbre-ou-liane',
  hauteurMaxM: 2.5,
  duree: { en: 'fraction_cycle', fraction: 0.3 },
  allure: 'en-s',
  cycleAnnuel: { debourrement: '04-01', repos: '11-15' },
});

// ── Constantes ───────────────────────────────────────────────────────────────────────────────

describe('T32a : constantes du profil', () => {
  it('formes, allures, fins de cycle : les listes du ticket, rien d’autre', () => {
    expect([...m.FORMES_PLANT].sort()).toEqual(['arbre-ou-liane', 'buisson', 'bulbe-ou-racine', 'erige-tuteure', 'rampant', 'rosette', 'touffe']);
    expect([...m.ALLURES].sort()).toEqual(['en-s', 'lineaire']);
    expect([...m.FINS_DE_CYCLE].sort()).toEqual(['baissee', 'conservee']);
  });

  it('bornes : 6 m, 730 jours, 2 048 caractères ; mention « valeur usuelle à vérifier »', () => {
    expect(m.HAUTEUR_MAX_PROFIL_M).toBe(6);
    expect(m.DUREE_MAX_JOURS).toBe(730);
    expect(m.PROFIL_CARACTERES_MAX).toBe(2048);
    expect(m.MENTION_A_VERIFIER).toBe('valeur usuelle à vérifier');
  });
});

// ── Validation ───────────────────────────────────────────────────────────────────────────────

describe('T32a : validerProfilCroissance, profils acceptés', () => {
  it('profil complet (objet) : accepté, rendu à l’identique', () => {
    expect(valide(m.validerProfilCroissance(profil()))).toEqual(profil());
    expect(valide(m.validerProfilCroissance(PERENNE))).toEqual(PERENNE);
  });

  it('texte JSON tel que le téléphone le garde : lu, même profil', () => {
    expect(valide(m.validerProfilCroissance(JSON.stringify(PERENNE)))).toEqual(PERENNE);
  });

  it('nul ou absent : accepté, valeur nulle (profil par défaut)', () => {
    expect(valide(m.validerProfilCroissance(null))).toBeNull();
    expect(valide(m.validerProfilCroissance(undefined))).toBeNull();
  });

  it('cycleAnnuel absent : rendu à null ; exactement les six clés, durée à deux clés', () => {
    const sansCycle = Object.fromEntries(Object.entries(profil()).filter(([cle]) => cle !== 'cycleAnnuel'));
    const v = valide(m.validerProfilCroissance(sansCycle));
    expect(v).toEqual(profil());
    expect(Object.keys(v ?? {}).sort()).toEqual(['allure', 'cycleAnnuel', 'duree', 'finDeCycle', 'forme', 'hauteurMaxM']);
    expect(Object.keys(v?.duree ?? {}).sort()).toEqual(['en', 'jours']);
  });

  it.each([
    ['hauteur pile 6 m', profil({ hauteurMaxM: 6 })],
    ['hauteur de 1 cm', profil({ hauteurMaxM: 0.01 })],
    ['durée d’un jour', profil({ duree: { en: 'jours', jours: 1 } })],
    ['durée de 730 jours', profil({ duree: { en: 'jours', jours: 730 } })],
    ['fraction 1', profil({ duree: { en: 'fraction_cycle', fraction: 1 } })],
    ['fraction minuscule', profil({ duree: { en: 'fraction_cycle', fraction: 1e-9 } })],
    ['cycle du 1er janvier au 31 décembre', profil({ cycleAnnuel: { debourrement: '01-01', repos: '12-31' } })],
  ])('bornes comprises : %s', (_, p) => {
    expect(valide(m.validerProfilCroissance(p))).toEqual(p);
  });

  it('chaque forme de la liste est acceptée', () => {
    for (const forme of m.FORMES_PLANT) expect(valide(m.validerProfilCroissance(profil({ forme })))?.forme).toBe(forme);
  });

  it('texte de 2 048 caractères pile : lu', () => {
    const texte = JSON.stringify(profil());
    const pile = texte + ' '.repeat(2048 - texte.length);
    expect(pile).toHaveLength(2048);
    expect(valide(m.validerProfilCroissance(pile))).toEqual(profil());
  });
});

describe('T32a : validerProfilCroissance, chaque refus avec un message en français', () => {
  it('texte de plus de 2 048 caractères : refusé avant d’être lu', () => {
    const texte = JSON.stringify(profil());
    refuse(m.validerProfilCroissance(texte + ' '.repeat(2049 - texte.length)), 'trop_long', null);
    refuse(m.validerProfilCroissance('x'.repeat(1_000_000)), 'trop_long', null);
  });

  it.each([
    ['texte JSON illisible', '{forme: tomate'],
    ['texte vide', ''],
    ['tableau', [profil()]],
    ['tableau en texte', '[1,2]'],
    ['nombre', 2],
    ['texte JSON d’un nombre', '2'],
    ['texte JSON d’un texte', '"tomate"'],
    ['texte JSON nul', 'null'],
    ['booléen', true],
    ['fonction', () => profil()],
  ])('%s → entree_invalide', (_, entree) => {
    refuse(m.validerProfilCroissance(entree), 'entree_invalide', null);
  });

  it('champ inconnu : refusé, la clé nommée (avant toute autre règle)', () => {
    refuse(m.validerProfilCroissance({ ...profil(), couleur: 'rouge' }), 'champ_inconnu', 'couleur');
    refuse(m.validerProfilCroissance({ ...profil(), hauteurMaxM: 99, rendement: 3 }), 'champ_inconnu', 'rendement');
    refuse(m.validerProfilCroissance({ ...profil(), hauteur_max_m: 2 }), 'champ_inconnu', 'hauteur_max_m');
  });

  it('clé __proto__ ou constructor venue d’un texte JSON : champ inconnu, aucune pollution', () => {
    refuse(m.validerProfilCroissance(`{"__proto__":{"pollue":true},${JSON.stringify(profil()).slice(1)}`), 'champ_inconnu', '__proto__');
    refuse(m.validerProfilCroissance({ ...profil(), constructor: 'x' }), 'champ_inconnu', 'constructor');
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
  });

  it.each(['forme', 'hauteurMaxM', 'duree', 'allure', 'finDeCycle'] as const)('%s absent : champ_manquant', (cle) => {
    const p = Object.fromEntries(Object.entries(profil()).filter(([k]) => k !== cle));
    refuse(m.validerProfilCroissance(p), 'champ_manquant', cle);
  });

  it('plusieurs champs manquants : le premier dans l’ordre forme, hauteurMaxM, duree, allure, finDeCycle', () => {
    refuse(m.validerProfilCroissance({ allure: 'lineaire', duree: { en: 'jours', jours: 3 } }), 'champ_manquant', 'forme');
    refuse(m.validerProfilCroissance({}), 'champ_manquant', 'forme');
    refuse(m.validerProfilCroissance({ forme: 'rosette', allure: 'lineaire' }), 'champ_manquant', 'hauteurMaxM');
  });

  it.each(['arbre', 'Rosette', 'erige_tuteure', '', 3, null])('forme %o : forme_inconnue', (forme) => {
    refuse(m.validerProfilCroissance({ ...profil(), forme }), 'forme_inconnue', 'forme');
  });

  it.each([0, -1, 6.000001, 7, 100, Number.NaN, Number.POSITIVE_INFINITY, '2', null, true])('hauteur %o : hauteur_invalide', (hauteurMaxM) => {
    refuse(m.validerProfilCroissance({ ...profil(), hauteurMaxM }), 'hauteur_invalide', 'hauteurMaxM');
  });

  it.each([
    ['fraction au-dessus de 1', { en: 'fraction_cycle', fraction: 1.5 }],
    ['fraction 1,0000001', { en: 'fraction_cycle', fraction: 1.0000001 }],
    ['fraction nulle', { en: 'fraction_cycle', fraction: 0 }],
    ['fraction négative', { en: 'fraction_cycle', fraction: -0.2 }],
    ['fraction non finie', { en: 'fraction_cycle', fraction: Number.NaN }],
    ['fraction en texte', { en: 'fraction_cycle', fraction: '0.5' }],
    ['zéro jour', { en: 'jours', jours: 0 }],
    ['jours négatifs', { en: 'jours', jours: -3 }],
    ['jours non entiers', { en: 'jours', jours: 12.5 }],
    ['731 jours', { en: 'jours', jours: 731 }],
    ['jours en texte', { en: 'jours', jours: '90' }],
    ['les deux à la fois', { en: 'jours', jours: 90, fraction: 0.5 }],
    ['jours annoncés, fraction donnée', { en: 'jours', fraction: 0.5 }],
    ['unité inconnue', { en: 'semaines', semaines: 12 }],
    ['clé en trop', { en: 'jours', jours: 90, note: 'x' }],
    ['sans unité', { jours: 90 }],
    ['nombre seul', 90],
    ['tableau', [90]],
    ['nul', null],
  ])('durée : %s → duree_invalide', (_, duree) => {
    refuse(m.validerProfilCroissance({ ...profil(), duree }), 'duree_invalide', 'duree');
  });

  it.each(['sigmoide', 'en_s', 'S', '', null])('allure %o : allure_inconnue', (allure) => {
    refuse(m.validerProfilCroissance({ ...profil(), allure }), 'allure_inconnue', 'allure');
  });

  it.each(['garde', 'baisse', '', null])('fin de cycle %o : fin_de_cycle_inconnue', (finDeCycle) => {
    refuse(m.validerProfilCroissance({ ...profil(), finDeCycle }), 'fin_de_cycle_inconnue', 'finDeCycle');
  });

  it.each([
    ['repos avant le débourrement', { debourrement: '11-15', repos: '04-01' }],
    ['même jour', { debourrement: '04-01', repos: '04-01' }],
    ['29 février', { debourrement: '02-29', repos: '11-15' }],
    ['31 avril', { debourrement: '04-31', repos: '11-15' }],
    ['mois 13', { debourrement: '04-01', repos: '13-01' }],
    ['format J/M', { debourrement: '1/4', repos: '15/11' }],
    ['date complète', { debourrement: '2027-04-01', repos: '2027-11-15' }],
    ['repos absent', { debourrement: '04-01' }],
    ['clé en trop', { debourrement: '04-01', repos: '11-15', taille: '02-01' }],
    ['texte', '04-01/11-15'],
    ['tableau', ['04-01', '11-15']],
  ])('cycle annuel : %s → cycle_annuel_invalide', (_, cycleAnnuel) => {
    refuse(m.validerProfilCroissance({ ...profil(), cycleAnnuel }), 'cycle_annuel_invalide', 'cycleAnnuel');
  });

  it('ordre des règles : forme avant hauteur, hauteur avant durée, durée avant allure, allure avant fin de cycle, fin avant cycle annuel', () => {
    const tout = { forme: 'arbre', hauteurMaxM: 9, duree: { en: 'jours', jours: 0 }, allure: 'x', finDeCycle: 'y', cycleAnnuel: 'z' };
    refuse(m.validerProfilCroissance(tout), 'forme_inconnue', 'forme');
    refuse(m.validerProfilCroissance({ ...tout, forme: 'rosette' }), 'hauteur_invalide', 'hauteurMaxM');
    refuse(m.validerProfilCroissance({ ...tout, forme: 'rosette', hauteurMaxM: 0.2 }), 'duree_invalide', 'duree');
    refuse(m.validerProfilCroissance({ ...tout, forme: 'rosette', hauteurMaxM: 0.2, duree: { en: 'jours', jours: 30 } }), 'allure_inconnue', 'allure');
    refuse(
      m.validerProfilCroissance({ ...tout, forme: 'rosette', hauteurMaxM: 0.2, duree: { en: 'jours', jours: 30 }, allure: 'lineaire' }),
      'fin_de_cycle_inconnue',
      'finDeCycle',
    );
    refuse(
      m.validerProfilCroissance({ ...tout, forme: 'rosette', hauteurMaxM: 0.2, duree: { en: 'jours', jours: 30 }, allure: 'lineaire', finDeCycle: 'conservee' }),
      'cycle_annuel_invalide',
      'cycleAnnuel',
    );
  });

  it('ne lève jamais, quelle que soit l’entrée', () => {
    const cyclique: Record<string, unknown> = { ...profil() };
    cyclique.duree = cyclique;
    const entrees: unknown[] = [Symbol('x'), 10n, new Date(), new Map(), Object.create(null), cyclique, { forme: { toString: () => { throw new Error('piège'); } } }];
    for (const e of entrees) expect(() => m.validerProfilCroissance(e)).not.toThrow();
  });

  it('n’altère pas son entrée', () => {
    const p = Object.freeze({ ...PERENNE, duree: Object.freeze({ ...PERENNE.duree }), cycleAnnuel: Object.freeze({ debourrement: '04-01', repos: '11-15' }) });
    expect(valide(m.validerProfilCroissance(p))).toEqual(PERENNE);
  });
});

// ── Profils par défaut ───────────────────────────────────────────────────────────────────────

/** Espèces nommées par le ticket (ordres de grandeur, dix plus visibles) et pérennes de la ferme. */
const NOMMEES = ['Tomate', 'Concombre', 'Poivron', 'Aubergine', 'Courgette', 'Laitue', 'Salade', 'Chou', 'Carotte', 'Fraisier', 'Fraise', 'Asperge', 'Kiwi', 'Pivoine'];

/** Espèces de la ferme complète des tests d'import, lues dans le jeu (pas recopiées). */
const especesDuJeu = (): string[] => [...new Set((fermeComplete().tables.espece ?? []).map((l) => String(l.nom)))];

describe('T32a : profils par défaut de la bibliothèque commune', () => {
  it('la bibliothèque des profils n’est pas vide et le jeu de ferme complète a bien ses 40 espèces', () => {
    expect(m.PROFILS_PAR_DEFAUT.length).toBeGreaterThanOrEqual(NOMMEES.length - 2);
    expect(especesDuJeu()).toHaveLength(40);
  });

  it('chaque profil par défaut est valide : hauteur > 0 et ≤ 6 m, durée > 0, forme connue, source ou mention renseignée', () => {
    for (const e of m.PROFILS_PAR_DEFAUT) {
      const ctx = `profil par défaut « ${e.espece} »`;
      expect(e.espece.trim().length, ctx).toBeGreaterThan(0);
      expect(m.validerProfilCroissance(e.profil), ctx).toEqual({ ok: true, valeur: e.profil });
      expect(e.profil.hauteurMaxM, ctx).toBeGreaterThan(0);
      expect(e.profil.hauteurMaxM, ctx).toBeLessThanOrEqual(6);
      const duree = e.profil.duree.en === 'jours' ? e.profil.duree.jours : e.profil.duree.fraction;
      expect(duree, ctx).toBeGreaterThan(0);
      expect(m.FORMES_PLANT, ctx).toContain(e.profil.forme);
      expect(e.source.trim().length, `${ctx} : source ou « ${m.MENTION_A_VERIFIER} »`).toBeGreaterThan(0);
      expect(Array.isArray(e.synonymes), ctx).toBe(true);
    }
  });

  it('profil générique (espèce inconnue) : valide, documenté, sans cycle annuel', () => {
    const g = m.PROFIL_GENERIQUE;
    expect(m.validerProfilCroissance(g.profil)).toEqual({ ok: true, valeur: g.profil });
    expect(g.source.trim().length).toBeGreaterThan(0);
    expect(g.profil.cycleAnnuel).toBeNull();
    expect(m.PROFILS_PAR_DEFAUT).not.toContain(g);
  });

  it('un nom ou synonyme ne désigne qu’une espèce (sans tenir compte de la casse ni des accents)', () => {
    const vus = new Map<string, string>();
    for (const e of m.PROFILS_PAR_DEFAUT) {
      for (const nom of [e.espece, ...e.synonymes]) {
        const cle = sansAccents(nom);
        expect(vus.get(cle), `« ${nom} » déjà pris par « ${String(vus.get(cle))} »`).toBeUndefined();
        vus.set(cle, e.espece);
      }
    }
  });

  it.each(NOMMEES)('%s (nommée par le ticket) : profil propre, pas le générique', (nom) => {
    expect(m.profilParDefaut(nom)).not.toBe(m.PROFIL_GENERIQUE);
  });

  it('chaque espèce du jeu de ferme complète a son profil propre', () => {
    const sansProfil = especesDuJeu().filter((nom) => m.profilParDefaut(nom) === m.PROFIL_GENERIQUE);
    expect(sansProfil).toEqual([]);
  });

  it('ordres de grandeur du ticket : tomate 2 m tuteurée, salade 0,25 m en rosette, carotte 0,3 m, courgette 0,6 m en buisson, fraise 0,25 m, asperge 1,5 m', () => {
    const p = (nom: string) => m.profilParDefaut(nom).profil;
    expect(p('Tomate')).toMatchObject({ hauteurMaxM: 2, forme: 'erige-tuteure', finDeCycle: 'conservee' });
    expect(p('Laitue')).toMatchObject({ hauteurMaxM: 0.25, forme: 'rosette' });
    expect(p('Salade')).toEqual(p('Laitue'));
    expect(p('Carotte').hauteurMaxM).toBe(0.3);
    expect(p('Courgette')).toMatchObject({ hauteurMaxM: 0.6, forme: 'buisson' });
    expect(p('Fraisier').hauteurMaxM).toBe(0.25);
    expect(p('Fraise')).toEqual(p('Fraisier'));
    expect(p('Asperge').hauteurMaxM).toBe(1.5);
  });

  it('les dix plus visibles : hauteurs plausibles', () => {
    const plage: Readonly<Record<string, readonly [number, number]>> = {
      Tomate: [1.5, 3],
      Concombre: [1, 3],
      Poivron: [0.4, 1.2],
      Aubergine: [0.5, 1.5],
      Courgette: [0.4, 1],
      Laitue: [0.15, 0.4],
      Chou: [0.3, 1],
      Carotte: [0.2, 0.5],
      Fraisier: [0.15, 0.4],
      Asperge: [1, 2],
    };
    for (const [nom, [min, max]] of Object.entries(plage)) {
      const h = m.profilParDefaut(nom).profil.hauteurMaxM;
      expect(h, nom).toBeGreaterThanOrEqual(min);
      expect(h, nom).toBeLessThanOrEqual(max);
    }
  });

  it.each(['Asperge', 'Kiwi', 'Pivoine', 'Fraisier'])('%s (pérenne de la ferme) : cycle annuel valide', (nom) => {
    const c = m.profilParDefaut(nom).profil.cycleAnnuel;
    expect(c).not.toBeNull();
    expect(c?.debourrement).toMatch(/^\d\d-\d\d$/);
    expect(c?.repos).toMatch(/^\d\d-\d\d$/);
  });

  it('kiwi : liane ; formes cohérentes pour les rosettes et racines', () => {
    expect(m.profilParDefaut('Kiwi').profil.forme).toBe<FormePlant>('arbre-ou-liane');
    expect(m.profilParDefaut('Tomate').profil.cycleAnnuel).toBeNull();
    expect(m.profilParDefaut('Laitue').profil.cycleAnnuel).toBeNull();
  });

  it('rapprochement : casse, accents et espaces en trop ignorés', () => {
    const tomate = m.profilParDefaut('Tomate');
    expect(m.profilParDefaut('tomate')).toBe(tomate);
    expect(m.profilParDefaut('  TOMATE ')).toBe(tomate);
    expect(m.profilParDefaut('Épinard')).toBe(m.profilParDefaut('epinard'));
    expect(m.profilParDefaut('epinard')).not.toBe(m.PROFIL_GENERIQUE);
    expect(m.profilParDefaut('salade')).toBe(m.profilParDefaut('LAITUE'));
  });

  it('espèce inconnue ou nom vide : le profil générique', () => {
    expect(m.profilParDefaut('Rutabaga de Mars')).toBe(m.PROFIL_GENERIQUE);
    expect(m.profilParDefaut('')).toBe(m.PROFIL_GENERIQUE);
    expect(m.profilParDefaut('   ')).toBe(m.PROFIL_GENERIQUE);
  });

  it('bibliothèque gelée : une ferme ne modifie jamais les profils par défaut', () => {
    expect(Object.isFrozen(m.PROFILS_PAR_DEFAUT)).toBe(true);
    for (const e of [...m.PROFILS_PAR_DEFAUT, m.PROFIL_GENERIQUE]) {
      expect(Object.isFrozen(e), e.espece).toBe(true);
      expect(Object.isFrozen(e.profil), e.espece).toBe(true);
      expect(Object.isFrozen(e.profil.duree), e.espece).toBe(true);
    }
  });
});

// ── Profil de la ferme : remplace le défaut ──────────────────────────────────────────────────

describe('T32a : profilEffectif, le profil réglé par la ferme remplace le défaut', () => {
  const REGLE = profil({ hauteurMaxM: 1.2, duree: { en: 'jours', jours: 70 }, allure: 'en-s' });

  it('profil nul ou absent : le défaut de l’espèce', () => {
    const defaut = m.profilParDefaut('Tomate').profil;
    expect(m.profilEffectif({ nom: 'Tomate', profilCroissance: null })).toEqual(defaut);
    expect(m.profilEffectif({ nom: 'Tomate' })).toEqual(defaut);
  });

  it('profil réglé (objet ou texte JSON du téléphone) : il remplace le défaut', () => {
    expect(m.profilEffectif({ nom: 'Tomate', profilCroissance: REGLE })).toEqual(REGLE);
    expect(m.profilEffectif({ nom: 'Tomate', profilCroissance: JSON.stringify(REGLE) })).toEqual(REGLE);
  });

  it('profil réglé sur une espèce inconnue de la bibliothèque : il s’applique ; sinon le générique', () => {
    expect(m.profilEffectif({ nom: 'Rutabaga de Mars', profilCroissance: REGLE })).toEqual(REGLE);
    expect(m.profilEffectif({ nom: 'Rutabaga de Mars', profilCroissance: null })).toEqual(m.PROFIL_GENERIQUE.profil);
  });

  it('profil illisible ou hors bornes : le défaut, sans exception', () => {
    const defaut = m.profilParDefaut('Tomate').profil;
    for (const corrompu of ['{pas du json', '[]', 42, { ...REGLE, hauteurMaxM: 7 }, { ...REGLE, duree: { en: 'fraction_cycle', fraction: 1.5 } }, { ...REGLE, inconnu: 1 }]) {
      expect(() => m.profilEffectif({ nom: 'Tomate', profilCroissance: corrompu })).not.toThrow();
      expect(m.profilEffectif({ nom: 'Tomate', profilCroissance: corrompu }), JSON.stringify(corrompu)).toEqual(defaut);
    }
  });

  it('isolement : la tomate réglée d’une ferme ne change ni la tomate de l’autre ferme ni la bibliothèque', () => {
    const fermeA = { nom: 'Tomate', profilCroissance: REGLE };
    const fermeB = { nom: 'Tomate', profilCroissance: null };
    const a = m.profilEffectif(fermeA);
    const b = m.profilEffectif(fermeB);
    expect(a.hauteurMaxM).toBe(1.2);
    expect(b.hauteurMaxM).toBe(2);
    expect(m.profilParDefaut('Tomate').profil.hauteurMaxM).toBe(2);
    // Ordre inverse : rien n'est retenu d'un appel à l'autre.
    expect(m.profilEffectif(fermeB).hauteurMaxM).toBe(2);
    expect(m.profilEffectif(fermeA).hauteurMaxM).toBe(1.2);
  });
});

// ── Pureté du module ─────────────────────────────────────────────────────────────────────────

/** `@planif/core` est compilé sans les types de Node : `node:fs` et `node:url` retrouvés dynamiquement. */
interface Fs {
  readdirSync(chemin: string): string[];
  readFileSync(chemin: string, encodage: 'utf8'): string;
}
interface Url {
  fileURLToPath(url: string): string;
}
const MODULE_FS = 'node:fs';
const MODULE_URL = 'node:url';

describe('T32a : module pur (principe 2)', () => {
  it('src/croissance : ni réseau, ni IA, ni horloge, ni hasard, aucune dépendance hors du cœur', async () => {
    const fs = (await import(/* @vite-ignore */ MODULE_FS)) as Fs;
    const url = (await import(/* @vite-ignore */ MODULE_URL)) as Url;
    const dossier = url.fileURLToPath((import.meta as { readonly url: string }).url).replace(/profil\.test\.ts$/, '');
    const sources = fs.readdirSync(dossier).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources, 'au moins index.ts').toContain('index.ts');
    for (const f of sources) {
      const code = fs.readFileSync(dossier + f, 'utf8');
      expect(code, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|anthropic|openai|Date\.now|new Date\b|Math\.random|process\.env/i);
      for (const [, chemin] of code.matchAll(/\bfrom\s+'([^']+)'/g)) {
        expect(chemin, `${f} importe ${String(chemin)}`).toMatch(/^\.\.?\//);
        expect(chemin, `${f} importe ${String(chemin)}`).not.toMatch(/\/test\//);
      }
    }
  });
});
