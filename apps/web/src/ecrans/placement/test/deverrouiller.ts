/**
 * T87 : l'éditeur s'ouvre verrouillé, même pour le gérant. Les tests qui éditent passent d'abord par
 * le bouton « Modifier le plan » de l'éditeur (`deverrouiller-plan`) ; sans lui (équipier, ferme
 * neuve que le parcours guidé déverrouille de lui-même), rien ne se passe.
 */
import { act } from 'react';

export const DEVERROUILLER_PLAN = 'deverrouiller-plan';
export const VERROUILLER_PLAN = 'verrouiller-plan';

export async function deverrouiller(): Promise<void> {
  const bouton = document.querySelector<HTMLElement>(`[data-testid="editeur-placement"] [data-testid="${DEVERROUILLER_PLAN}"]`);
  if (bouton === null) return;
  await act(async () => {
    bouton.click();
    await Promise.resolve();
  });
}
