// @vitest-environment happy-dom
/**
 * T11b, relecture B1 — un écran dont le fichier manque (vite:preloadError) et qu'on ne recharge
 * pas tout de suite (saisie en cours, anti-boucle) : l'erreur suit son cours, l'écran dit son
 * échec, et `differe` réessaie au prochain affichage (le réseau est revenu, le fichier aussi).
 *
 * Le chargeur imite celui de Vite 8 : il lance `vite:preloadError` sur window ; si l'événement
 * est empêché (preventDefault), l'`import()` se résout à vide, sinon l'erreur est relancée.
 */
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { differe } from './App.tsx';
import { EVENEMENT_MORCEAU_INTROUVABLE, surveillerMorceauIntrouvable } from './rechargement.ts';

function Ecran() {
  return <p data-testid="ecran">Écran chargé</p>;
}

/** Chargeur « à la Vite » : le fichier manque tant que `present` est faux. */
function chargeurVite(etat: { present: boolean; appels: number }): () => Promise<{ default: ComponentType<object> }> {
  return () => {
    etat.appels++;
    if (etat.present) return Promise.resolve({ default: Ecran });
    const erreur = new Error('Failed to fetch dynamically imported module');
    const e = new Event(EVENEMENT_MORCEAU_INTROUVABLE, { cancelable: true });
    window.dispatchEvent(e);
    // Vite 8 : erreur empêchée → import() résolu à vide.
    return e.defaultPrevented ? (Promise.resolve(undefined) as unknown as Promise<{ default: ComponentType<object> }>) : Promise.reject(erreur);
  };
}

let conteneur: HTMLDivElement;
let racine: Root;
let arreter: () => void = () => undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  arreter();
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
});

async function laisserFinir(): Promise<void> {
  for (let k = 0; k < 10; k++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('T11b : écran introuvable sans rechargement immédiat — differe réessaie', () => {
  for (const [cas, options] of [
    ['saisie en cours', { saisieEnCours: () => true }],
    ['rechargement refusé par l’anti-boucle', { saisieEnCours: () => false, stockage: { getItem: () => String(Date.now()), setItem: () => undefined } }],
    ['stockage illisible', { saisieEnCours: () => false, stockage: { getItem: (): string => { throw new Error('bloqué'); }, setItem: () => undefined } }],
  ] as const) {
    it(`${cas} : écran d’échec, puis l’écran s’ouvre au prochain affichage`, async () => {
      let recharges = 0;
      arreter = surveillerMorceauIntrouvable({ ...options, recharger: () => recharges++, sondageMs: 60_000 });
      const etat = { present: false, appels: 0 };
      const { Composant } = differe(chargeurVite(etat));

      await act(async () => {
        racine.render(<Composant />);
        await Promise.resolve();
      });
      await laisserFinir();
      expect(conteneur.querySelector('[role="alert"]')?.textContent).toContain('n’a pas pu s’ouvrir');
      expect(recharges).toBe(0);

      // Le fichier est revenu (réseau, cache) : l'affichage suivant réessaie et réussit.
      etat.present = true;
      act(() => {
        racine.render(<p>ailleurs</p>);
      });
      await act(async () => {
        racine.render(<Composant />);
        await Promise.resolve();
      });
      await laisserFinir();
      expect(etat.appels).toBe(2);
      expect(conteneur.querySelector('[data-testid="ecran"]')).not.toBeNull();
    });
  }
});
