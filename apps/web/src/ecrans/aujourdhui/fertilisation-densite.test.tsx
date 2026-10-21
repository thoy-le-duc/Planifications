// @vitest-environment happy-dom
/**
 * Tests d'acceptation T72 — saisie d'un apport depuis Aujourd'hui : avertissements de densité
 * (docs/backlog/T72-densite-engrais-liquides.md, règles 3 et 4). Vrai écran dans un DOM simulé
 * (happy-dom), ferme neuve + ../ferme/fertilisation/test/jeu.ts (jour 2026-10-19).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleSaisieFertilisation, ProprietesSaisieFertilisation } from '../ferme/fertilisation/test/contrat.ts';
import { FERME } from '../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, type Banc, type Ligne } from '../parcellaire/test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, remplir, texte, toucher } from '../itineraires/test/outils.ts';
import { ecrireEngraisT72, ecrireJeu, LIQUIDE, POUDRE } from '../ferme/fertilisation/test/jeu.ts';

const CHEMIN = './fertilisation/index.ts';
const SANS_DENSITE = 'densité non renseignée : 1 kg/L supposé';
const SOLIDE_EN_VOLUME = 'produit solide saisi en volume : pas d’unités comptées, saisissez en kg ou t';
let m: ModuleSaisieFertilisation;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleSaisieFertilisation;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  await ecrireJeu(b);
  await ecrireEngraisT72(b);
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
  vi.unstubAllGlobals();
});

const apports = (): Ligne[] => lire(b, "SELECT * FROM evenement WHERE ferme_id = ? AND type = 'intervention' ORDER BY horodatage, id", [FERME]);

async function ouvrir(): Promise<HTMLElement> {
  const p: ProprietesSaisieFertilisation = { porte: b.porte, fermeId: FERME, aujourdhui: AUJOURDHUI, surFermer: () => undefined };
  await act(async () => {
    racine.render(createElement(m.SaisieFertilisation, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Fertilisation') !== undefined && dialogueOuEchec('Fertilisation').querySelector('[aria-pressed]') !== null, 'dialogue « Fertilisation » prêt');
  return dialogueOuEchec('Fertilisation');
}

describe('T72 : liquide sans densité, saisi en volume (règle 3)', () => {
  it('« densité non renseignée : 1 kg/L supposé » sous la quantité en L ; l’apport reste enregistrable', async () => {
    const d = await ouvrir();
    await toucher(bouton('P1', d));
    await toucher(bouton('Engrais liquide sans densité', d));
    expect(champ('Unité', d).value).toBe('L');
    expect(texte(d)).toContain(SANS_DENSITE);
    await remplir(champ('Quantité', d), '100');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => apports().length === 1, 'apport écrit');
    expect(JSON.parse(String(apports()[0]?.detail))).toMatchObject({ quantite: { valeur: 100, unite: 'L' } });
  });

  it('même mention en m³ (écrit « m3 » ou « m³ ») ; aucune en kg', async () => {
    const d = await ouvrir();
    await toucher(bouton('Engrais liquide sans densité', d));
    await remplir(champ('Unité', d), 'm3');
    expect(texte(d)).toContain(SANS_DENSITE);
    await remplir(champ('Unité', d), 'm³');
    expect(texte(d)).toContain(SANS_DENSITE);
    await remplir(champ('Unité', d), 'kg');
    expect(texte(d)).not.toContain(SANS_DENSITE);
  });

  it('liquide avec densité : pas de mention, pas d’avertissement', async () => {
    const d = await ouvrir();
    await toucher(bouton('Engrais liquide azoté', d));
    expect(champ('Unité', d).value).toBe('L');
    expect(texte(d)).not.toContain(SANS_DENSITE);
    expect(texte(d)).not.toContain(SOLIDE_EN_VOLUME);
    expect(LIQUIDE).toBeDefined();
  });
});

describe('T72 : solide saisi en volume (règle 4)', () => {
  it('« produit solide saisi en volume : pas d’unités comptées, saisissez en kg ou t » en L et en m³ ; la valeur n’est pas refusée', async () => {
    const d = await ouvrir();
    await toucher(bouton('P1', d));
    await toucher(bouton('Engrais en poudre', d));
    expect(champ('Unité', d).value).toBe('kg');
    expect(texte(d), 'en kg : rien').not.toContain(SOLIDE_EN_VOLUME);
    await remplir(champ('Unité', d), 'L');
    expect(texte(d)).toContain(SOLIDE_EN_VOLUME);
    expect(texte(d)).not.toContain(SANS_DENSITE);
    await remplir(champ('Unité', d), 'm3');
    expect(texte(d)).toContain(SOLIDE_EN_VOLUME);
    await remplir(champ('Unité', d), 't');
    expect(texte(d)).not.toContain(SOLIDE_EN_VOLUME);
    await remplir(champ('Unité', d), 'L');
    await remplir(champ('Quantité', d), '20');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => apports().length === 1, 'apport écrit malgré l’avertissement');
    expect(b.transactions()).toBe(1);
    expect(JSON.parse(String(apports()[0]?.detail))).toMatchObject({ produitFertilisantId: POUDRE, quantite: { valeur: 20, unite: 'L' } });
  });

  it('texte libre en L (« Autre produit ») : ni avertissement ni mention, comme avant', async () => {
    const d = await ouvrir();
    await remplir(champ('Autre produit', d), 'Purin d’ortie');
    await remplir(champ('Unité', d), 'L');
    expect(texte(d)).not.toContain(SOLIDE_EN_VOLUME);
    expect(texte(d)).not.toContain(SANS_DENSITE);
  });
});
