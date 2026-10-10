/**
 * Tests d'acceptation T32c, cœur — réglage du profil de croissance par la ferme
 * (docs/backlog/T32c-reglage-profils.md ; Q32, Q33, Q35). Contrat : ./test/contrat-reglage.ts
 * (champ `fougereApresRecolte`) et ./test/contrat.ts (T32a : bornes, messages, profilEffectif).
 *
 * Ce que l'écran de réglage s'apprête à ouvrir :
 *   - la validation par le cœur (hauteur > 0 et ≤ 6 m, durée > 0, forme connue ; messages en
 *     français) : déjà posée par T32a, re-vérifiée ici sur les saisies de l'écran ;
 *   - l'asperge réglée par la ferme garde « pas de fougère pendant la récolte » (Q33), règle
 *     portée par un champ du profil et non plus par l'identité de l'objet par défaut ;
 *   - la tomate réglée à 1,8 m a une hauteur maximale de 1,8 m ; rétablie (profil nul), elle revient
 *     à la valeur par défaut du code : 3 m depuis Q33 (le ticket dit 2 m, écrit avant Q33).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import { chargerCroissance, d, prevue, type EntreePerenne, type ModuleCroissance, type ProfilCroissance, type ResultatCroissance } from './test/contrat.ts';
import { CHAMP_FOUGERE, fougereApresRecolte, HAUTEUR_TOMATE_DEFAUT_M, type ProfilReglable } from './test/contrat-reglage.ts';

let m: ModuleCroissance;

beforeAll(async () => {
  m = await chargerCroissance();
});

function valide<T>(r: ResultatCroissance<T>): T {
  if (!r.ok) throw new Error(`refusé à tort : ${r.erreur.code} (${String(r.erreur.champ)}) — ${r.erreur.message}`);
  return r.valeur;
}

/** Refus sur `champ`, avec un message en français, court, sans nom technique. */
function refuseSur(r: ResultatCroissance<unknown>, champ: string, motif: RegExp): string {
  expect(r.ok, `le profil aurait dû être refusé (${champ})`).toBe(false);
  if (r.ok) return '';
  expect(r.erreur.champ).toBe(champ);
  const message = r.erreur.message;
  expect(message.trim().length).toBeGreaterThan(0);
  expect(message.length).toBeLessThanOrEqual(200);
  expect(message, 'message en français qui dit ce qui ne va pas').toMatch(motif);
  expect(message, 'aucun nom technique dans le message').not.toMatch(/hauteurMaxM|fougereApresRecolte|duree|jsonb|undefined|null|NaN/);
  return message;
}

const tomate = (): ProfilCroissance => m.profilParDefaut('Tomate').profil;
const asperge = (): ProfilCroissance => m.profilParDefaut('Asperge').profil;

/** Copie lue de la base : texte JSON du téléphone, relu. Jamais le même objet que le défaut. */
const copieLue = (p: unknown): string => JSON.stringify(p);

// ── 1. Validation des saisies de l'écran ─────────────────────────────────────────────────────

describe('T32c : validation du profil saisi (hauteur, durée, forme), messages en français', () => {
  it.each([
    ['0 m', 0],
    ['négative', -1],
    ['au-dessus de 6 m', 6.01],
    ['7 m', 7],
    ['pas un nombre', Number.NaN],
    ['infinie', Number.POSITIVE_INFINITY],
    ['texte « 1,8 »', '1,8'],
  ])('hauteur %s : refusée, le message parle de la hauteur et de la borne de 6 m', (_cas, hauteur) => {
    const message = refuseSur(m.validerProfilCroissance({ ...tomate(), hauteurMaxM: hauteur }), 'hauteurMaxM', /hauteur/i);
    expect(message).toMatch(/6\s?m/);
  });

  it.each([
    ['1,8 m', 1.8],
    ['6 m (borne comprise)', 6],
    ['1 cm', 0.01],
  ])('hauteur %s : acceptée', (_cas, hauteur) => {
    expect(valide(m.validerProfilCroissance({ ...tomate(), hauteurMaxM: hauteur }))?.hauteurMaxM).toBe(hauteur);
  });

  it.each([
    ['0 jour', { en: 'jours', jours: 0 }],
    ['jours négatifs', { en: 'jours', jours: -5 }],
    ['jours non entiers', { en: 'jours', jours: 12.5 }],
    ['part du cycle nulle', { en: 'fraction_cycle', fraction: 0 }],
  ])('durée %s : refusée, le message parle de la durée', (_cas, duree) => {
    refuseSur(m.validerProfilCroissance({ ...tomate(), duree }), 'duree', /durée/i);
  });

  it('durée de 1 jour : acceptée', () => {
    expect(valide(m.validerProfilCroissance({ ...tomate(), duree: { en: 'jours', jours: 1 } }))?.duree).toEqual({ en: 'jours', jours: 1 });
  });

  it.each(['arbre', '', 'Erige-tuteure', 'tomate'])('forme « %s » : refusée, le message parle de la forme', (forme) => {
    refuseSur(m.validerProfilCroissance({ ...tomate(), forme }), 'forme', /forme/i);
  });

  it('chaque forme de la liste est acceptée', () => {
    for (const forme of m.FORMES_PLANT) expect(valide(m.validerProfilCroissance({ ...tomate(), forme }))?.forme, forme).toBe(forme);
  });
});

// ── 2. Le champ du profil qui porte la règle de l'asperge ────────────────────────────────────

describe(`T32c : le champ ${CHAMP_FOUGERE} du profil`, () => {
  it('l’asperge de la bibliothèque le porte à true ; aucun autre profil par défaut, ni le générique', () => {
    expect((asperge() as ProfilReglable).fougereApresRecolte).toBe(true);
    const autres = m.PROFILS_PAR_DEFAUT.filter((e) => e.espece !== 'Asperge' && fougereApresRecolte(e.profil)).map((e) => e.espece);
    expect(autres).toEqual([]);
    expect(fougereApresRecolte(m.PROFIL_GENERIQUE.profil)).toBe(false);
  });

  it('validé : true est gardé dans la valeur rendue (objet ou texte JSON du téléphone)', () => {
    const p: ProfilReglable = { ...tomate(), fougereApresRecolte: true };
    expect(valide(m.validerProfilCroissance(p))).toEqual(p);
    expect(valide(m.validerProfilCroissance(copieLue(p)))).toEqual(p);
  });

  it('le profil par défaut de l’asperge, relu de son texte JSON, revient identique (champ compris)', () => {
    expect(valide(m.validerProfilCroissance(copieLue(asperge())))).toEqual(asperge());
  });

  it('false est accepté ; absent reste valide (profils de T32a inchangés)', () => {
    expect(valide(m.validerProfilCroissance({ ...tomate(), fougereApresRecolte: false }))).not.toBeNull();
    const sansChamp = Object.fromEntries(Object.entries(tomate()).filter(([c]) => c !== CHAMP_FOUGERE));
    expect(valide(m.validerProfilCroissance(sansChamp))).toEqual(sansChamp);
  });

  it.each([
    ['texte « oui »', 'oui'],
    ['nombre 1', 1],
    ['objet', {}],
  ])('valeur %s : refusée sur ce champ, message en français', (_cas, valeur) => {
    const r = m.validerProfilCroissance({ ...asperge(), fougereApresRecolte: valeur });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur.champ).toBe(CHAMP_FOUGERE);
    expect(r.erreur.message.trim().length).toBeGreaterThan(0);
    expect(r.erreur.message.length).toBeLessThanOrEqual(200);
    expect(r.erreur.message).not.toMatch(/fougereApresRecolte|undefined|boolean/);
  });
});

// ── 3. Asperge réglée par la ferme : toujours pas de fougère pendant la récolte (Q33) ────────

describe('T32c : asperge réglée par la ferme, toujours pas de fougère pendant la récolte', () => {
  const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
  /** Campagne 2027 : récolte des turions du 10 avril au 10 juin. */
  const CAMPAGNE: EntreePerenne = { plantation: PLANTATION, campagne: { annee: 2027, debutRecolte: d('2027-04-10'), finRecolte: d('2027-06-10') } };
  /** Campagne 2027 sans fin de récolte saisie : le 15 juin par défaut (Q33). */
  const SANS_FIN: EntreePerenne = { plantation: PLANTATION, campagne: { annee: 2027, debutRecolte: d('2027-04-10'), finRecolte: null } };

  /** Le profil tel que la 3D le lit : profilEffectif d'une espèce « Asperge » de la ferme. */
  const effectif = (profilCroissance: unknown): ProfilCroissance => m.profilEffectif({ nom: 'Asperge', profilCroissance });

  it('profil enregistré IDENTIQUE au défaut (texte JSON relu) : hauteur 0 du débourrement à la fin de récolte comprise', () => {
    const p = effectif(copieLue(asperge()));
    expect(p, 'pas le même objet que le défaut').not.toBe(asperge());
    for (const jour of ['2027-04-02', '2027-04-21', '2027-05-15', '2027-06-01', '2027-06-10']) {
      const e = m.croissancePerenneA(CAMPAGNE, p, d(jour));
      expect(e.hauteurM, jour).toBe(0);
      expect(e.fraction, jour).toBe(0);
    }
  });

  it('copie profonde du défaut (objet neuf, pas relu par le cœur) : même règle', () => {
    const copie = JSON.parse(copieLue(asperge())) as ProfilCroissance;
    expect(m.croissancePerenneA(CAMPAGNE, copie, d('2027-05-15')).hauteurM).toBe(0);
  });

  it('après la fin de récolte, la fougère part de 0 le lendemain et atteint 1,5 m en `duree.jours`', () => {
    const p = effectif(copieLue(asperge()));
    const lendemain = d('2027-06-11');
    expect(m.croissancePerenneA(CAMPAGNE, p, lendemain).hauteurM).toBe(0);
    expect(m.croissancePerenneA(CAMPAGNE, p, ajouterJours(lendemain, 10)).hauteurM).toBeGreaterThan(0);
    const jours = p.duree.en === 'jours' ? p.duree.jours : 0;
    expect(jours).toBeGreaterThan(0);
    expect(m.croissancePerenneA(CAMPAGNE, p, ajouterJours(lendemain, jours)).hauteurM).toBeCloseTo(1.5, 10);
  });

  it('asperge réglée à 1,2 m (champ gardé) : 0 pendant la récolte, 1,2 m une fois la fougère montée', () => {
    const regle: ProfilReglable = { ...asperge(), hauteurMaxM: 1.2 };
    const p = effectif(copieLue(regle));
    expect(p.hauteurMaxM).toBe(1.2);
    expect(fougereApresRecolte(p)).toBe(true);
    expect(m.croissancePerenneA(CAMPAGNE, p, d('2027-05-15')).hauteurM).toBe(0);
    const jours = p.duree.en === 'jours' ? p.duree.jours : 0;
    expect(m.croissancePerenneA(CAMPAGNE, p, ajouterJours(d('2027-06-11'), jours)).hauteurM).toBeCloseTo(1.2, 10);
  });

  it('sans fin de récolte saisie : pas de fougère jusqu’au 15 juin compris', () => {
    const p = effectif(copieLue(asperge()));
    expect(m.croissancePerenneA(SANS_FIN, p, d('2027-06-15')).hauteurM).toBe(0);
    expect(m.croissancePerenneA(SANS_FIN, p, ajouterJours(d('2027-06-16'), 10)).hauteurM).toBeGreaterThan(0);
  });

  it('la ferme peut retirer la règle (false) : la fougère monte dès le débourrement, comme une pérenne ordinaire', () => {
    const p = effectif(copieLue({ ...asperge(), fougereApresRecolte: false }));
    expect(fougereApresRecolte(p)).toBe(false);
    expect(m.croissancePerenneA(CAMPAGNE, p, d('2027-04-21')).hauteurM).toBeGreaterThan(0);
  });

  it('la règle suit le champ, pas le nom : une pivoine qui le porte attend aussi la fin de récolte', () => {
    const pivoine: ProfilReglable = { ...m.profilParDefaut('Pivoine').profil, fougereApresRecolte: true };
    const p = m.profilEffectif({ nom: 'Pivoine', profilCroissance: copieLue(pivoine) });
    expect(m.croissancePerenneA(CAMPAGNE, p, d('2027-05-15')).hauteurM).toBe(0);
    expect(m.croissancePerenneA(CAMPAGNE, m.profilParDefaut('Pivoine').profil, d('2027-05-15')).hauteurM).toBeGreaterThan(0);
  });

  it('culture annuelle : croissanceA ignore le champ', () => {
    const dates = { miseEnPlace: prevue('2027-04-01'), debutRecolte: prevue('2027-06-01'), finRecolte: prevue('2027-08-01'), arrachage: prevue('2027-08-15') };
    const sans = tomate();
    const avec: ProfilReglable = { ...tomate(), fougereApresRecolte: true };
    expect(m.croissanceA(dates, avec, d('2027-05-01'))).toEqual(m.croissanceA(dates, sans, d('2027-05-01')));
  });
});

// ── 4. Tomate : réglée à 1,8 m, puis rétablie ────────────────────────────────────────────────

describe('T32c : tomate réglée à 1,8 m, puis rétablie', () => {
  /** Plantation au 1er mai, récolte de juillet à septembre : au 15 septembre, la hauteur maximale est atteinte. */
  const DATES = { miseEnPlace: prevue('2027-05-01'), debutRecolte: prevue('2027-07-01'), finRecolte: prevue('2027-10-01'), arrachage: prevue('2027-10-15') };
  const PLEINE = d('2027-09-15');

  it(`valeur par défaut actuelle de la tomate : ${String(HAUTEUR_TOMATE_DEFAUT_M)} m (Q33)`, () => {
    expect(tomate().hauteurMaxM).toBe(HAUTEUR_TOMATE_DEFAUT_M);
  });

  it('réglée à 1,8 m : la hauteur maximale de T32a est 1,8 m', () => {
    const regle = copieLue({ ...tomate(), hauteurMaxM: 1.8 });
    const p = m.profilEffectif({ nom: 'Tomate', profilCroissance: regle });
    expect(p.hauteurMaxM).toBe(1.8);
    expect(m.croissanceA(DATES, p, PLEINE).hauteurM).toBeCloseTo(1.8, 10);
  });

  it('rétablie (profil nul) : retour à la valeur par défaut', () => {
    const p = m.profilEffectif({ nom: 'Tomate', profilCroissance: null });
    expect(p.hauteurMaxM).toBe(HAUTEUR_TOMATE_DEFAUT_M);
    expect(m.croissanceA(DATES, p, PLEINE).hauteurM).toBeCloseTo(HAUTEUR_TOMATE_DEFAUT_M, 10);
  });
});
