// @vitest-environment happy-dom
/**
 * Tests d'acceptation T37b — le panneau « Travaux du jour » (PanneauTravaux.tsx) :
 *   - annonce `aria-live` quand « Suivant » change le travail actif (lecteur d'écran, ouvrier qui ne
 *     regarde pas l'écran : il entend « 2. Repiquer salades — Tunnel 2, T2-P04 ») ;
 *   - message à l'écran si la lecture des travaux échoue (propriété `erreur`).
 * Contrat : ./test/contrat-telephone.ts (section 5). Les tests de T37 (travaux-panneau.test.tsx)
 * ne changent pas.
 */
import { act, useState, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProprietesPanneauTravaux3d, Travail3d } from './test/contrat-travaux.ts';
import { TEXTE_ERREUR_TRAVAUX, TESTID_TELEPHONE as T } from './test/contrat-telephone.ts';

const CHEMIN_PANNEAU = './PanneauTravaux.tsx';
type ProprietesT37b = ProprietesPanneauTravaux3d & { readonly erreur?: boolean };
let Panneau: ComponentType<ProprietesT37b>;

beforeAll(async () => {
  Panneau = ((await import(/* @vite-ignore */ CHEMIN_PANNEAU)) as { PanneauTravaux3d: ComponentType<ProprietesT37b> }).PanneauTravaux3d;
});

const TRAVAUX: readonly Travail3d[] = [
  { rang: 1, cle: 'a', texte: '1. Semer carotte — Plein champ, PC-P01', planche: null, enRetard: true },
  { rang: 2, cle: 'b', texte: '2. Repiquer salades — Tunnel 2, T2-P04', planche: 'p4', enRetard: true },
  { rang: 3, cle: 'c', texte: '3. Désherbage tomate — Tunnel 2, T2-P07', planche: 'p7', enRetard: false },
  { rang: 4, cle: 'd', texte: '4. Palissage tomate — Tunnel 2, T2-P09', planche: 'p9', enRetard: false },
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

/** Le panneau tel que la vue le branche : « Suivant » et les lignes changent le travail actif. */
function Banc({ travaux = TRAVAUX, erreur = false, actifDepart = null, replieDepart = false }: { readonly travaux?: readonly Travail3d[]; readonly erreur?: boolean; readonly actifDepart?: number | null; readonly replieDepart?: boolean }) {
  const [actif, setActif] = useState<number | null>(actifDepart);
  return <Panneau travaux={travaux} actif={actif} surChoisir={setActif} erreur={erreur} replieDepart={replieDepart} />;
}

const un = (id: string): HTMLElement | null => conteneur.querySelector<HTMLElement>(`[data-testid="${id}"]`);
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

describe('T37b : annonce aria-live du travail actif', () => {
  it('la zone vivante existe dès le premier rendu, polie, vide tant qu’aucun travail n’est actif', () => {
    act(() => {
      racine.render(<Banc />);
    });
    const annonce = requis(T.annonce);
    expect(annonce.getAttribute('aria-live')).toBe('polite');
    expect(annonce.closest('[data-testid="travaux-du-jour-3d"]'), 'dans le panneau').not.toBeNull();
    expect(texte(annonce)).toBe('');
  });

  it('« Suivant » : la zone annonce chaque nouveau travail actif, dans l’ordre, puis revient au premier', () => {
    act(() => {
      racine.render(<Banc />);
    });
    const annonce = requis(T.annonce);
    const dites: string[] = [];
    for (let k = 0; k < 4; k += 1) {
      toucher(requis('travail-suivant-3d'));
      dites.push(texte(requis(T.annonce)));
    }
    // Même nœud tout du long : un lecteur d'écran n'annonce que le texte d'une zone qui existait déjà.
    expect(requis(T.annonce)).toBe(annonce);
    const attendus = [TRAVAUX[1], TRAVAUX[2], TRAVAUX[3], TRAVAUX[1]].map((t) => t?.texte ?? '');
    dites.forEach((dit, i) => {
      expect(dit, `annonce après ${String(i + 1)} « Suivant »`).toContain(attendus[i]);
    });
    expect(dites[0]).not.toBe(dites[1]);
  });

  it('un tap sur une ligne annonce aussi le travail', () => {
    act(() => {
      racine.render(<Banc />);
    });
    const boutons = [...conteneur.querySelectorAll<HTMLElement>('[data-testid="aller-travail-3d"]')];
    toucher(boutons[2] ?? requis('aller-travail-3d'));
    expect(texte(requis(T.annonce))).toContain(TRAVAUX[2]?.texte);
  });

  it('la zone vivante reste là et visible quand le panneau est replié', () => {
    act(() => {
      racine.render(<Banc replieDepart />);
    });
    toucher(requis('travail-suivant-3d'));
    const annonce = requis(T.annonce);
    expect(annonce.closest('[hidden]'), 'pas dans la liste masquée').toBeNull();
    expect(texte(annonce)).toContain(TRAVAUX[1]?.texte);
  });

  it('le travail actif d’origine est lu à l’ouverture si le parent en donne un', () => {
    act(() => {
      racine.render(<Banc actifDepart={3} />);
    });
    expect(texte(requis(T.annonce))).toContain(TRAVAUX[2]?.texte);
  });
});

describe('T37b : message si la lecture des travaux échoue', () => {
  it('erreur sans aucun travail : un message d’alerte à l’écran (le panneau ne se tait plus)', () => {
    act(() => {
      racine.render(<Banc travaux={[]} erreur />);
    });
    const message = requis(T.erreur);
    expect(message.getAttribute('role')).toBe('alert');
    expect(texte(message)).toBe(TEXTE_ERREUR_TRAVAUX);
  });

  it('erreur avec des travaux déjà lus : le message s’ajoute, les lignes restent', () => {
    act(() => {
      racine.render(<Banc erreur />);
    });
    expect(texte(requis(T.erreur))).toBe(TEXTE_ERREUR_TRAVAUX);
    expect(conteneur.querySelectorAll('[data-testid="travail-3d"]')).toHaveLength(TRAVAUX.length);
  });

  it('pas d’erreur : aucun message (avec ou sans travaux)', () => {
    act(() => {
      racine.render(<Banc />);
    });
    expect(un(T.erreur)).toBeNull();
    act(() => {
      racine.render(<Banc travaux={[]} erreur={false} />);
    });
    expect(un(T.erreur)).toBeNull();
    expect(conteneur.textContent).toBe('');
  });

  it('l’erreur se lève : le message disparaît', () => {
    act(() => {
      racine.render(<Panneau travaux={TRAVAUX} actif={null} surChoisir={() => undefined} erreur />);
    });
    expect(un(T.erreur)).not.toBeNull();
    act(() => {
      racine.render(<Panneau travaux={TRAVAUX} actif={null} surChoisir={() => undefined} erreur={false} />);
    });
    expect(un(T.erreur)).toBeNull();
  });
});
