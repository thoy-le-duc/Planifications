/**
 * T60 : appui long sur une carte de l'écran Aujourd'hui (le gérant attribue le travail). Posé
 * une fois sur la liste des cartes (délégation) : la carte est retrouvée par son data-cle. Un doigt
 * tenu DUREE_APPUI_LONG_MS sans glisser, ou le menu contextuel (l'appui long d'Android, le clic
 * droit) déclenche ; le « Fait » que le doigt relâché toucherait alors n'est pas compté.
 */
import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

export const DUREE_APPUI_LONG_MS = 500;
/** Au-delà de ce glissé (px), c'est un défilement, pas un appui. */
const GLISSE_MAX_PX = 10;

export interface GestesAppuiLong {
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  readonly onContextMenu: (e: MouseEvent<HTMLElement>) => void;
  readonly onClickCapture: (e: MouseEvent<HTMLElement>) => void;
}

const cleDe = (cible: EventTarget | null): string | null => {
  const carte = cible instanceof Element ? cible.closest<HTMLElement>('[data-testid="tache"]') : null;
  return carte?.dataset.cle ?? null;
};

/** Gestes à poser sur la liste des cartes ; `surAppui` null : aucun geste (équipier). */
export function useAppuiLong(surAppui: ((cle: string) => void) | null): GestesAppuiLong | undefined {
  const appui = useRef<{ readonly x: number; readonly y: number; readonly minuterie: ReturnType<typeof setTimeout> } | null>(null);
  const declenche = useRef(false);
  // Écran quitté le doigt posé : la minuterie ne survit pas à la liste.
  useEffect(() => {
    const a = appui;
    return () => {
      if (a.current !== null) clearTimeout(a.current.minuterie);
    };
  }, []);
  const arreter = () => {
    if (appui.current !== null) clearTimeout(appui.current.minuterie);
    appui.current = null;
  };
  if (surAppui === null) return undefined;
  return {
    onPointerDown: (e) => {
      arreter();
      declenche.current = false;
      const cle = cleDe(e.target);
      if (cle === null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      appui.current = {
        x: e.clientX,
        y: e.clientY,
        minuterie: setTimeout(() => {
          appui.current = null;
          declenche.current = true;
          surAppui(cle);
        }, DUREE_APPUI_LONG_MS),
      };
    },
    onPointerMove: (e) => {
      const a = appui.current;
      if (a !== null && Math.hypot(e.clientX - a.x, e.clientY - a.y) > GLISSE_MAX_PX) arreter();
    },
    onPointerUp: arreter,
    onPointerCancel: arreter,
    onContextMenu: (e) => {
      const cle = cleDe(e.target);
      if (cle === null) return;
      e.preventDefault();
      arreter();
      if (declenche.current) return;
      declenche.current = true;
      surAppui(cle);
    },
    onClickCapture: (e) => {
      if (!declenche.current) return;
      declenche.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
