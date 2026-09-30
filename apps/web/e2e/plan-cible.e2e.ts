import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * T11, relecture C6 — partie horizontale de la cible tactile des barres, que le jeu de T07 ne
 * prouve pas (aucune culture de moins de 8 jours, donc aucune barre de moins de 44 px) :
 * src/ecrans/plan/plan.css seule, sur une ligne dessinée à la main (pas de base, pas d'amorçage).
 *
 * Balisage d'une ligne tel qu'EcranPlan.tsx le produit (classe barre-etroite sous 24 px de large).
 * Une barre de 10 px de large (un peu moins de deux jours) garde sa largeur dessinée, et répond au
 * doigt à ±21 px de son centre, horizontalement et verticalement (44 × 44 px) ; deux barres
 * étroites voisines se partagent l'espace entre elles, sans que l'une vole le dessin de l'autre ;
 * le fond de la ligne, loin des barres, ne répond pas.
 */

const CSS = ['../src/ui/base.css', '../src/ecrans/plan/plan.css'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
const DEMI_CIBLE_PX = 21;

test('C6 — barre plus étroite que 44 px : cible de 44 × 44 px, largeur dessinée inchangée', async ({ page }) => {
  await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body style="margin:0">
    <div class="plan-grille" style="width:600px;height:200px">
      <div data-testid="ligne-plan" class="plan-ligne" style="transform:translateY(20px)">
        <span class="plan-etiquette"><span class="plan-code">T1-P01</span></span>
        <button type="button" data-testid="barre" data-occupation="seule" class="barre barre-reel famille-neutre barre-etroite" style="left:200px;width:10px"><span>Radis</span></button>
        <button type="button" data-testid="barre" data-occupation="large" class="barre barre-prevu famille-neutre" style="left:300px;width:120px"><span>Carotte</span></button>
        <button type="button" data-testid="barre" data-occupation="voisine-a" class="barre barre-reel famille-neutre barre-etroite" style="left:480px;width:10px"><span>A</span></button>
        <button type="button" data-testid="barre" data-occupation="voisine-b" class="barre barre-reel famille-neutre barre-etroite" style="left:500px;width:10px"><span>B</span></button>
      </div>
    </div></body></html>`);

  const mesures = await page.evaluate((demi) => {
    const barre = (id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="barre"][data-occupation="${id}"]`);
      if (el === null) throw new Error(`barre ${id} absente`);
      return el.getBoundingClientRect();
    };
    const touche = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-testid="barre"]')?.dataset.occupation ?? null;
    const seule = barre('seule');
    const cx = seule.left + seule.width / 2;
    const cy = seule.top + seule.height / 2;
    const a = barre('voisine-a');
    const b = barre('voisine-b');
    return {
      largeur: seule.width,
      hauteur: seule.height,
      autour: [touche(cx - demi, cy), touche(cx + demi, cy), touche(cx, cy - demi), touche(cx, cy + demi), touche(cx - demi, cy - demi + 2)],
      // Sur le dessin de chaque voisine : elle-même, jamais l'autre.
      dessinA: touche(a.left + a.width / 2, a.top + a.height / 2),
      dessinB: touche(b.left + b.width / 2, b.top + b.height / 2),
      // Entre les deux voisines : l'une ou l'autre, jamais le fond de la ligne.
      entre: touche((a.right + b.left) / 2, a.top + a.height / 2),
      // À gauche de A et à droite de B, à ±21 px de leur centre.
      bordA: touche(a.left + a.width / 2 - demi, a.top + a.height / 2),
      bordB: touche(b.left + b.width / 2 + demi, b.top + b.height / 2),
      // Loin de toute barre : le fond.
      fond: touche(seule.right + 40, cy),
    };
  }, DEMI_CIBLE_PX);

  expect(mesures.largeur, 'largeur dessinée inchangée (ses dates)').toBe(10);
  expect(mesures.hauteur, 'barre de 44 px de haut').toBeGreaterThanOrEqual(44);
  expect(mesures.autour, 'à ±21 px du centre : la barre').toEqual(['seule', 'seule', 'seule', 'seule', 'seule']);
  expect(mesures.dessinA).toBe('voisine-a');
  expect(mesures.dessinB).toBe('voisine-b');
  expect(['voisine-a', 'voisine-b']).toContain(mesures.entre);
  expect(mesures.bordA).toBe('voisine-a');
  expect(mesures.bordB).toBe('voisine-b');
  expect(mesures.fond, 'loin des barres : rien').toBeNull();
});
