// @vitest-environment happy-dom
/**
 * Tests d'acceptation T51 — « Nombre de pains » d'une gouttière dans « Ma ferme »
 * (docs/backlog/T51-hors-sol-pains.md, règles 1 et 5). Même banc que ./ecran.test.tsx.
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * Dialogue « Modifier <code> », sorte gouttière : champ « Nombre de pains » (remplace « Nombre
 * de places »), clavier numérique (`inputmode="numeric"`), proposé à la longueur arrondie
 * (1 pain par mètre) tant qu'il n'est pas touché, aide « 1 pain ≈ 1 m », boutons « Un pain de
 * moins » et « Un pain de plus » pour régler au doigt, avec des gants. Enregistré :
 * `nombre_pains`, l'ancien `nombre_places` n'est plus écrit (nul pour une nouvelle gouttière).
 * Une planche ou un rang n'a pas de nombre de pains.
 *
 * Règles (regles.ts) : `verifierEmplacement` lit `nombrePains` (texte) et rend `nombrePains`
 * (nombre, ou null hors gouttière) ; gouttière sans pains, ou pains non entiers : refus
 * `champ: 'nombrePains'`, message en français ; pains hors gouttière : refus.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleParcellaire } from './test/contrat.ts';
import { FERME } from './test/ferme-neuve.ts';
import { actifs, AUJOURDHUI, creerBanc, emplacements, MAINTENANT, zones, type Banc } from './test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher, aBouton } from '../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
const CHEMIN_REGLES = './regles.ts';
let m: ModuleParcellaire;
interface Regles {
  verifierEmplacement(
    e: { code: string; sorte: string; longueur: string; largeur: string; nombrePains: string },
    pris: readonly string[],
  ): { ok: true; valeur: { nombrePains: number | null } } | { ok: false; champ: string; message: string };
}
let r: Regles;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleParcellaire;
  r = (await import(/* @vite-ignore */ CHEMIN_REGLES)) as Regles;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
});

async function ouvrir(): Promise<void> {
  await act(async () => {
    racine.render(createElement(m.EcranParcellaire, { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined }));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Ma ferme') !== undefined, 'dialogue « Ma ferme »');
  await attendre(() => document.querySelector('[data-testid="parcellaire-pret"]') !== null || aBouton(/^Créer la saison/) || aBouton('Nouvelle zone'), 'listes lues');
}

/** Zone « Serre fraises » et une planche P1 de `longueur` m ; rend le dialogue « Modifier P1 ». */
async function planchePuisModifier(longueur: string): Promise<HTMLElement> {
  await ouvrir();
  await toucher(bouton('Nouvelle zone'));
  const z = dialogueOuEchec('Nouvelle zone');
  await remplir(champ('Nom', z), 'Serre fraises');
  await remplir(liste('Type d’abri', z), 'hors_sol');
  await toucher(bouton('Enregistrer', z));
  await attendre(() => actifs(zones(b)).length === 1, 'zone créée');
  await toucher(bouton('Ouvrir Serre fraises'));
  const d = dialogueOuEchec('Serre fraises');
  await remplir(champ('Nombre de planches', d), '1');
  await remplir(champ('Préfixe du code', d), 'P');
  await remplir(champ('Longueur (m)', d), longueur);
  await remplir(champ('Largeur (m)', d), '0,3');
  await toucher(bouton('Ajouter les planches', d));
  await attendre(() => actifs(emplacements(b)).length === 1, 'planche créée');
  await toucher(bouton('Modifier P1', d));
  return dialogueOuEchec('Modifier P1');
}

const gouttiere = () => actifs(emplacements(b))[0];

describe('T51 : nombre de pains d’une gouttière', () => {
  it('gouttière de 29,6 m : « Nombre de pains » proposé à 30, aide « 1 pain ≈ 1 m », clavier numérique ; enregistré dans nombre_pains', async () => {
    const f = await planchePuisModifier('29,6');
    await remplir(champ('Code', f), 'G1');
    await remplir(liste('Sorte', f), 'gouttiere');
    const pains = champ('Nombre de pains', f);
    expect(pains.value).toBe('30');
    expect(pains.getAttribute('inputmode')).toBe('numeric');
    expect(texte(f)).toMatch(/1 pain ≈ 1 m/);
    b.remiseAZero();
    await toucher(bouton('Enregistrer', f));
    await attendre(() => gouttiere()?.code === 'G1', 'G1 enregistrée');
    expect(b.transactions()).toBe(1);
    expect(gouttiere()).toMatchObject({ sorte: 'gouttiere', nombre_pains: 30, nombre_places: null });
  });

  it('au doigt : « Un pain de moins » deux fois, « Un pain de plus » une fois → 29 pains', async () => {
    const f = await planchePuisModifier('30');
    await remplir(liste('Sorte', f), 'gouttiere');
    await toucher(bouton('Un pain de moins', f));
    await toucher(bouton('Un pain de moins', f));
    await toucher(bouton('Un pain de plus', f));
    expect(champ('Nombre de pains', f).value).toBe('29');
    await toucher(bouton('Enregistrer', f));
    await attendre(() => gouttiere()?.sorte === 'gouttiere', 'gouttière enregistrée');
    expect(gouttiere()?.nombre_pains).toBe(29);
  });

  it('nombre de pains tapé à la main (28) : gardé même si la longueur change ensuite', async () => {
    const f = await planchePuisModifier('30');
    await remplir(liste('Sorte', f), 'gouttiere');
    await remplir(champ('Nombre de pains', f), '28');
    await remplir(champ('Longueur (m)', f), '32');
    expect(champ('Nombre de pains', f).value).toBe('28');
    await toucher(bouton('Enregistrer', f));
    await attendre(() => gouttiere()?.sorte === 'gouttiere', 'gouttière enregistrée');
    expect(gouttiere()).toMatchObject({ longueur_m: 32, nombre_pains: 28 });
  });

  it('« Nombre de places » n’est plus demandé ; une planche n’a pas de nombre de pains', async () => {
    const f = await planchePuisModifier('30');
    expect(f.querySelector('input[aria-label="Nombre de places"]')).toBeNull();
    expect([...f.querySelectorAll('label')].map((l) => texte(l))).not.toContain('Nombre de pains');
    await remplir(liste('Sorte', f), 'gouttiere');
    expect([...f.querySelectorAll('label')].some((l) => /Nombre de places/.test(texte(l)))).toBe(false);
  });

  it('vide ou non entier : refusé avec un message clair, rien d’écrit', async () => {
    const f = await planchePuisModifier('30');
    await remplir(liste('Sorte', f), 'gouttiere');
    await remplir(champ('Nombre de pains', f), '2,5');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', f));
    expect(texte(f.querySelector('[role="alert"]'))).toMatch(/pains/i);
    expect(b.transactions()).toBe(0);
  });
});

describe('T51 : règle « nombre de pains »', () => {
  const base = { code: 'G1', sorte: 'gouttiere', longueur: '30', largeur: '', nombrePains: '30' };

  it('gouttière avec ses pains : valide', () => {
    expect(r.verifierEmplacement(base, [])).toMatchObject({ ok: true, valeur: { nombrePains: 30 } });
  });

  it.each(['', '0', '2,5', 'trente'])('gouttière avec « %s » pains : refus sur nombrePains', (n) => {
    const v = r.verifierEmplacement({ ...base, nombrePains: n }, []);
    expect(v).toMatchObject({ ok: false, champ: 'nombrePains' });
    if (!v.ok) expect(v.message).toMatch(/pains/i);
  });

  it('planche : pas de pains (vide → null ; renseigné → refus)', () => {
    expect(r.verifierEmplacement({ ...base, sorte: 'planche', nombrePains: '' }, [])).toMatchObject({ ok: true, valeur: { nombrePains: null } });
    expect(r.verifierEmplacement({ ...base, sorte: 'planche', nombrePains: '30' }, [])).toMatchObject({ ok: false, champ: 'nombrePains' });
  });
});
