// @vitest-environment happy-dom
/**
 * Tests d'acceptation T91 (règle 2) — le bouton « À placer (n) » de la vue 3D (plan3d/APlacer.tsx) :
 * il liste les zones non placées ; un tap sur une zone demande d'ouvrir l'éditeur sur elle (gérant
 * seulement : un équipier voit la liste, sans action). Le composant n'importe pas three.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APlacer } from './APlacer.tsx';

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
});

const ZONES = [
  { id: 'zB', nom: 'Verger' },
  { id: 'zC', nom: 'Tunnel 3' },
];
const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
async function toucher(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
    await Promise.resolve();
  });
}
async function rendre(zones: typeof ZONES, gerant: boolean, ouvertes: string[] = []): Promise<void> {
  await act(async () => {
    racine.render(createElement(APlacer, { zones, gerant, surOuvrir: (id: string) => ouvertes.push(id) }));
    await Promise.resolve();
  });
}

describe('T91 : « À placer (n) »', () => {
  it('rien à placer : le bouton n’existe pas', async () => {
    await rendre([], true);
    expect(un('a-placer-3d')).toBeNull();
  });

  it('le bouton porte le nombre de zones ; la liste est repliée puis se déplie au tap', async () => {
    await rendre(ZONES, true);
    const b = un('a-placer-3d');
    expect(b?.textContent?.trim()).toBe('À placer (2)');
    expect(b?.getAttribute('aria-expanded')).toBe('false');
    expect(un('a-placer-liste')).toBeNull();
    if (b !== null) await toucher(b);
    expect(un('a-placer-3d')?.getAttribute('aria-expanded')).toBe('true');
    expect(tous('a-placer-zone').map((z) => z.textContent?.trim())).toEqual(['Verger', 'Tunnel 3']);
  });

  it('gérant : un tap sur une zone demande d’ouvrir l’éditeur sur elle', async () => {
    const ouvertes: string[] = [];
    await rendre(ZONES, true, ouvertes);
    const b = un('a-placer-3d');
    if (b !== null) await toucher(b);
    const z = tous('a-placer-zone')[1];
    expect(z?.tagName).toBe('BUTTON');
    if (z !== undefined) await toucher(z);
    expect(ouvertes).toEqual(['zC']);
  });

  it('équipier : la liste se lit, sans bouton par zone', async () => {
    const ouvertes: string[] = [];
    await rendre(ZONES, false, ouvertes);
    const b = un('a-placer-3d');
    if (b !== null) await toucher(b);
    expect(tous('a-placer-zone').map((z) => z.textContent?.trim())).toEqual(['Verger', 'Tunnel 3']);
    expect(tous('a-placer-zone').every((z) => z.tagName !== 'BUTTON')).toBe(true);
    expect(ouvertes).toEqual([]);
  });
});
