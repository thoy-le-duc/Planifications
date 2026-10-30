/**
 * T87 : l'éditeur de placement s'ouvre verrouillé, même pour le gérant. Les parcours qui modifient le
 * plan passent d'abord par « Modifier le plan » (`deverrouiller-plan`) ; sur une ferme neuve, le parcours
 * guidé déverrouille de lui-même et le bouton n'existe pas.
 */
import { expect, type Page } from '@playwright/test';

export async function deverrouillerPlan(page: Page): Promise<void> {
  const editeur = page.getByTestId('editeur-placement');
  await expect(editeur).toHaveAttribute('data-mode', /.+/);
  const bouton = editeur.getByTestId('deverrouiller-plan');
  if (await bouton.isVisible()) await bouton.click();
}
