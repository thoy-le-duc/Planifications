/**
 * Comportement commun des dialogues de l'écran (T13, relecture) : le focus reste dans le
 * dialogue (Tab et Maj+Tab en boucle) et revient à l'élément qui l'a ouvert à la fermeture.
 */
import { useEffect, useState, type KeyboardEvent } from 'react';

const FOCALISABLES = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * À appeler dans le composant du dialogue : retient l'élément qui avait le focus à l'ouverture
 * et le lui rend au démontage. Rend le gestionnaire de Tab à poser sur le dialogue.
 */
export function useFocusDuDialogue(): (e: KeyboardEvent<HTMLElement>) => void {
  const [origine] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(
    () => () => {
      if (origine?.isConnected === true) origine.focus();
    },
    [origine],
  );
  return (e) => {
    if (e.key !== 'Tab') return;
    const elements = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCALISABLES)];
    const premier = elements[0];
    const dernier = elements.at(-1);
    if (premier === undefined || dernier === undefined) return;
    const actif = document.activeElement;
    if (e.shiftKey && (actif === premier || !e.currentTarget.contains(actif))) {
      e.preventDefault();
      dernier.focus();
    } else if (!e.shiftKey && (actif === dernier || !e.currentTarget.contains(actif))) {
      e.preventDefault();
      premier.focus();
    }
  };
}
