// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37 — le panneau « Travaux du jour » (plan3d/PanneauTravaux.tsx) : lignes
 * numérotées, tap sur une ligne, « Suivant », repli. Composant de présentation : il ne lit ni
 * n'écrit rien. Contrat : ./test/contrat-travaux.ts (section « Panneau »).
 */
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TESTID_3D_TRAVAUX as T, TEXTES_3D_TRAVAUX as TEXTES, type ProprietesPanneauTravaux3d, type Travail3d } from './test/contrat-travaux.ts';

const CHEMIN_PANNEAU = './PanneauTravaux.tsx';

let Panneau: ComponentType<ProprietesPanneauTravaux3d>;

beforeAll(async () => {
  Panneau = ((await import(/* @vite-ignore */ CHEMIN_PANNEAU)) as { PanneauTravaux3d: ComponentType<ProprietesPanneauTravaux3d> }).PanneauTravaux3d;
});

const TRAVAUX: readonly Travail3d[] = [
  { rang: 1, cle: 'a', texte: '1. Semer carotte — Plein champ, PC-P01', planche: null, enRetard: true },
  { rang: 2, cle: 'b', texte: '2. Repiquer salades — Tunnel 2, T2-P04', planche: 'p4', enRetard: true },
  { rang: 3, cle: 'c', texte: '3. Désherbage tomate — Tunnel 2, T2-P07', planche: 'p7', enRetard: false },
  { rang: 4, cle: 'd', texte: '4. Palissage tomate — Tunnel 2, T2-P07', planche: 'p7', enRetard: false },
];

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

function rendre(props: Partial<ProprietesPanneauTravaux3d> = {}): ReturnType<typeof vi.fn<(rang: number) => void>> {
  const surChoisir = vi.fn<(rang: number) => void>();
  act(() => {
    racine.render(<Panneau travaux={TRAVAUX} actif={null} surChoisir={surChoisir} {...props} />);
  });
  return surChoisir;
}

const un = (id: string): HTMLElement | null => conteneur.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const tous = (id: string): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const requis = (id: string): HTMLElement => {
  const el = un(id);
  if (el === null) throw new Error(`${id} absent`);
  return el;
};
const texte = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const toucher = (el: HTMLElement): void => {
  act(() => {
    el.click();
  });
};

describe('T37 : panneau « Travaux du jour »', () => {
  it('une ligne par travail, dans l’ordre, au texte « 2. Repiquer salades — Tunnel 2, T2-P04 »', () => {
    rendre();
    const panneau = requis(T.panneau);
    expect(panneau.getAttribute('role')).toBe('region');
    expect(panneau.getAttribute('aria-label')).toBe(TEXTES.titre);
    expect(texte(panneau)).toContain(TEXTES.titre);
    expect(panneau.dataset.nombre).toBe('4');
    expect(panneau.dataset.actif).toBe('');
    expect(tous(T.ligne).map((l) => l.dataset.rang)).toEqual(['1', '2', '3', '4']);
    expect(tous(T.ligne).map((l) => l.dataset.cle)).toEqual(['a', 'b', 'c', 'd']);
    expect(tous(T.aller).map((b) => texte(b))).toEqual(TRAVAUX.map((t) => t.texte));
    expect(tous(T.ligne).map((l) => l.dataset.planche)).toEqual(['', 'p4', 'p7', 'p7']);
  });

  it('tap sur la ligne 2 : surChoisir(2), une seule fois', () => {
    const surChoisir = rendre();
    toucher(tous(T.aller)[1] ?? requis(T.aller));
    expect(surChoisir.mock.calls).toEqual([[2]]);
  });

  it('un travail sans planche placée est listé mais ne vole nulle part (bouton désactivé)', () => {
    const surChoisir = rendre();
    const sans = tous(T.aller)[0] as HTMLButtonElement;
    expect(texte(sans)).toBe(TRAVAUX[0]?.texte);
    expect(sans.disabled).toBe(true);
    toucher(sans);
    expect(surChoisir).not.toHaveBeenCalled();
  });

  it('le travail actif est mis en évidence (aria-current, data-actif), et lui seul', () => {
    rendre({ actif: 3 });
    expect(requis(T.panneau).dataset.actif).toBe('3');
    expect(tous(T.ligne).map((l) => l.getAttribute('aria-current'))).toEqual([null, null, 'true', null]);
  });

  it('« Suivant » passe au travail suivant qui a une planche, puis revient au premier', () => {
    const surChoisir = rendre();
    const suivant = requis(T.suivant);
    expect(suivant.getAttribute('aria-label') ?? texte(suivant)).toBe(TEXTES.suivant);
    toucher(suivant);
    expect(surChoisir.mock.calls.at(-1)).toEqual([2]); // le 1 n'a pas de planche
    act(() => {
      racine.render(<Panneau travaux={TRAVAUX} actif={2} surChoisir={surChoisir} />);
    });
    toucher(requis(T.suivant));
    expect(surChoisir.mock.calls.at(-1)).toEqual([3]);
    act(() => {
      racine.render(<Panneau travaux={TRAVAUX} actif={4} surChoisir={surChoisir} />);
    });
    toucher(requis(T.suivant));
    expect(surChoisir.mock.calls.at(-1)).toEqual([2]);
  });

  it('« Suivant » est désactivé quand aucun travail n’a de planche', () => {
    const surChoisir = rendre({ travaux: TRAVAUX.map((t) => ({ ...t, planche: null })) });
    const suivant = requis(T.suivant) as HTMLButtonElement;
    expect(suivant.disabled).toBe(true);
    toucher(suivant);
    expect(surChoisir).not.toHaveBeenCalled();
  });

  it('repliable : ouvert au départ, le bouton replie la liste (masquée) mais « Suivant » reste visible', () => {
    rendre();
    const panneau = requis(T.panneau);
    const replier = requis(T.replier);
    expect(panneau.dataset.replie).toBe('non');
    expect(replier.getAttribute('aria-expanded')).toBe('true');
    expect(replier.getAttribute('aria-label') ?? texte(replier)).toBe(TEXTES.replier);
    expect(requis(T.liste).hidden).toBe(false);
    toucher(replier);
    expect(panneau.dataset.replie).toBe('oui');
    expect(replier.getAttribute('aria-expanded')).toBe('false');
    expect(replier.getAttribute('aria-label') ?? texte(replier)).toBe(TEXTES.deplier);
    expect(requis(T.liste).hidden).toBe(true);
    expect(un(T.suivant)?.hidden ?? false).toBe(false);
    toucher(replier);
    expect(panneau.dataset.replie).toBe('non');
    expect(requis(T.liste).hidden).toBe(false);
  });

  it('replieDepart : replié à l’ouverture', () => {
    rendre({ replieDepart: true });
    expect(requis(T.panneau).dataset.replie).toBe('oui');
    expect(requis(T.liste).hidden).toBe(true);
  });

  it('aucun travail : rien n’est dessiné', () => {
    rendre({ travaux: [] });
    expect(un(T.panneau)).toBeNull();
    expect(conteneur.textContent).toBe('');
  });

  it('aucun contrôle d’écriture : seulement replier, les lignes et « Suivant »', () => {
    rendre();
    const boutons = [...conteneur.querySelectorAll('button')];
    expect(boutons).toHaveLength(TRAVAUX.length + 2);
    expect(conteneur.querySelector('input, textarea, select, form')).toBeNull();
  });
});
