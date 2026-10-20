// @vitest-environment happy-dom
/**
 * Relecture T60 : après un appui long (attribution), le « Fait » que le doigt relâché toucherait
 * n'est pas compté ; mais un « Fait » validé ensuite au clavier (Entrée, Espace : un clic sans
 * pointeur, `detail` 0) l'est toujours. Sinon le premier « Fait » au clavier après un appui long
 * était avalé sans rien dire.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DUREE_APPUI_LONG_MS, useAppuiLong } from './appui-long.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
const surAppui = vi.fn();
const surFait = vi.fn();

function Liste() {
  const gestes = useAppuiLong(surAppui);
  return (
    <ul {...gestes}>
      <li data-testid="tache" data-cle="chou:semis">
        <button type="button" onClick={surFait}>
          Fait
        </button>
      </li>
    </ul>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  surAppui.mockReset();
  surFait.mockReset();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  act(() => {
    racine.render(<Liste />);
  });
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.useRealTimers();
});

const bouton = (): HTMLButtonElement => {
  const b = conteneur.querySelector('button');
  if (b === null) throw new Error('bouton absent');
  return b;
};

function appuiLong(): void {
  act(() => {
    bouton().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10 }));
  });
  act(() => {
    vi.advanceTimersByTime(DUREE_APPUI_LONG_MS + 50);
  });
  act(() => {
    bouton().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 10, clientY: 10 }));
  });
}

it('le clic du doigt relâché après l’appui long n’est pas un « Fait »', () => {
  appuiLong();
  expect(surAppui).toHaveBeenCalledWith('chou:semis');
  act(() => {
    bouton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
  expect(surFait).not.toHaveBeenCalled();
});

it('un « Fait » au clavier après un appui long sans clic relâché est compté', () => {
  appuiLong();
  // Entrée sur le bouton : clic sans pointeur (detail 0).
  act(() => {
    bouton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  });
  expect(surFait).toHaveBeenCalledTimes(1);
});
