// @vitest-environment happy-dom
/**
 * Tests d'acceptation T54 — cahier de fertilisation de l'onglet Ferme, fiche « Fertilisation »
 * d'une planche, option « zone vulnérable nitrates » (docs/backlog/T54-cahier-fertilisation.md,
 * règles 3, 4 et 6 ; Q44). Vrai écran dans un DOM simulé (happy-dom), ferme neuve + ./test/jeu.ts
 * (jour 2026-10-19, saison 2026). Contrat : ./test/contrat.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleFertilisationFerme, ProprietesEcranFertilisation } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, MAINTENANT, type Banc } from '../../parcellaire/test/outils.ts';
import { attendre, bouton, champ, coche, dialogue, dialogueOuEchec, texte, toucher } from '../../itineraires/test/outils.ts';
import { cocherZoneVulnerable, COMPOST, CORNE, ecrireApport, ecrireJeu, P1, P2 } from './test/jeu.ts';

const CHEMIN = './index.ts';
let m: ModuleFertilisationFerme;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleFertilisationFerme;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  await ecrireJeu(b);
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

/** Texte sans espaces de groupement (fines, insécables) : « 2 000 » devient « 2000 ». */
const sansEspaces = (t: string): string => t.replace(/[\s  ]/g, '');
const planche = (emplacementId: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="bilan-planche"][data-emplacement="${emplacementId}"]`);
const alertes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="alerte-azote"]')];
const plan = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="plan-previsionnel"]');

async function ouvrir(): Promise<HTMLElement> {
  const p: ProprietesEcranFertilisation = { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined };
  await act(async () => {
    racine.render(createElement(m.EcranCahierFertilisation, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Cahier de fertilisation') !== undefined, 'dialogue « Cahier de fertilisation »');
  return dialogueOuEchec('Cahier de fertilisation');
}

/** Corne broyée à 13 % sur P1 (100 m² = 0,01 ha) : x kg N/ha ↔ x ÷ 100 kg N ↔ x ÷ 13 kg de corne. */
const corne = (date: string, kgNParHa: number) => ecrireApport(b, { date, produitId: CORNE, produit: 'Corne broyée', quantite: kgNParHa / 13, unite: 'kg' });

describe('T54 : bilan affiché sur la planche', () => {
  it('2 t de compost à 1 % N sur P1 (100 m²) : 2 000 kg N/ha sur sa ligne et dans sa fiche', async () => {
    await ecrireApport(b, { date: '2026-03-10', produitId: COMPOST, produit: 'Compost de déchets verts', quantite: 2, unite: 't' });
    await ouvrir();
    await attendre(() => planche(P1) !== null, 'ligne de P1');
    expect(texte(planche(P1))).toContain('P1');
    expect(sansEspaces(texte(planche(P1)))).toContain('2000');
    expect(planche(P2), 'P2 sans apport : pas de ligne').toBeNull();
    await toucher(bouton('Fertilisation P1'));
    const fiche = dialogueOuEchec('Fertilisation P1');
    const apports = [...fiche.querySelectorAll<HTMLElement>('[data-testid="apport"]')];
    expect(apports).toHaveLength(1);
    expect(texte(apports[0])).toContain('Compost de déchets verts');
    expect(sansEspaces(texte(apports[0]))).toContain('2000');
  });

  it('apport sans teneur (texte libre) : affiché, « sans teneur »', async () => {
    await ecrireApport(b, { date: '2026-03-10', produitId: null, produit: 'Purin du voisin', quantite: 20, unite: 'L' });
    await ouvrir();
    await attendre(() => planche(P1) !== null, 'ligne de P1');
    await toucher(bouton('Fertilisation P1'));
    const fiche = dialogueOuEchec('Fertilisation P1');
    expect(texte(fiche)).toContain('Purin du voisin');
    expect(texte(fiche)).toMatch(/sans teneur/i);
  });

  it('apport d’une saison passée : hors du cahier de la saison', async () => {
    await ecrireApport(b, { date: '2025-03-10', produitId: COMPOST, produit: 'Compost de déchets verts', quantite: 2, unite: 't' });
    await ouvrir();
    await attendre(() => texte(dialogueOuEchec('Cahier de fertilisation')).includes('Saison 2026'), 'période affichée');
    expect(planche(P1)).toBeNull();
  });
});

describe('T54 : zone vulnérable nitrates (Q44, règle 6)', () => {
  it('décochée par défaut : ni plan prévisionnel ni alerte, même au-delà de 170 kg N/ha', async () => {
    await corne('2026-03-10', 180);
    const d = await ouvrir();
    await attendre(() => planche(P1) !== null, 'ligne de P1');
    expect(coche(champ('Zone vulnérable nitrates', d))).toBe(false);
    expect(alertes()).toHaveLength(0);
    await toucher(bouton('Fertilisation P1'));
    expect(plan()).toBeNull();
    expect(alertes()).toHaveLength(0);
  });

  it('cochée, 180 kg N/ha d’azote organique sur l’année : une alerte non bloquante', async () => {
    await cocherZoneVulnerable(b);
    await corne('2026-03-10', 100);
    await corne('2026-09-01', 80);
    const d = await ouvrir();
    await attendre(() => alertes().length > 0, 'alerte affichée');
    expect(coche(champ('Zone vulnérable nitrates', d))).toBe(true);
    expect(alertes()).toHaveLength(1);
    expect(texte(alertes()[0])).toContain('P1');
    expect(sansEspaces(texte(alertes()[0]))).toContain('170');
    await toucher(bouton('Fertilisation P1'));
    expect(plan(), 'plan prévisionnel dans la fiche').not.toBeNull();
  });

  it('cochée, 160 kg N/ha : aucune alerte', async () => {
    await cocherZoneVulnerable(b);
    await corne('2026-03-10', 160);
    await ouvrir();
    await attendre(() => planche(P1) !== null, 'ligne de P1');
    expect(alertes()).toHaveLength(0);
  });

  it('cocher la case écrit l’option de la ferme en une transaction ; l’alerte apparaît', async () => {
    await corne('2026-03-10', 180);
    const d = await ouvrir();
    await attendre(() => planche(P1) !== null, 'ligne de P1');
    b.remiseAZero();
    await toucher(champ('Zone vulnérable nitrates', d));
    await attendre(() => lire(b, 'SELECT zone_vulnerable_nitrates AS z FROM ferme WHERE id = ?', [FERME])[0]?.z === 1, 'option écrite');
    expect(b.transactions()).toBe(1);
    await attendre(() => alertes().length === 1, 'alerte affichée après avoir coché');
  });
});
