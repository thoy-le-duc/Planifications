import { devices, expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';

/**
 * T32b — plants stylisés qui grandissent, de bout en bout, sur ordinateur (Chromium 1280 × 800,
 * WebGL logiciel). Les mesures de T27 (affichage < 1 s, semaine < 100 ms) et les garde-fous de
 * T29b restent vérifiés par vue-3d.e2e.ts, vue-3d-jumeau.e2e.ts et fluidite-3d.ts : AUCUN seuil
 * n'est changé ici.
 *
 * ── Attributs data- que la toile (`toile-3d`) doit porter en plus de ceux de T27 à T29 ───────
 *   data-plants          nombre total de plants dessinés (somme des instances) pour la semaine affichée ;
 *                        0 quand aucune planche n'a de plant ; entier ≥ 0, écrit à chaque image dessinée.
 *   data-formes-plants   nombre de groupes d'instances (un InstancedMesh par forme présente, pas par planche).
 *   data-hauteurs-plants texte JSON { [idPlanche]: hauteurM } : la hauteur du feuillage (m, arrondie
 *                        au centimètre) de chaque planche qui a des plants cette semaine ; une planche
 *                        sans plant est absente. C'est la hauteur de T32a, celle de `plantsDePlanche`.
 *   data-semaine-plants  indice de la semaine pour laquelle les plants ci-dessus ont été dessinés
 *                        (égal à `data-semaine` de la vue dès que l'image de la semaine est dessinée).
 *
 * ── Ce que vérifie ce fichier ────────────────────────────────────────────────────────────────
 *   1. ferme du jour (`?jeu=aujourdhui`, une tomate mise en place 90 jours avant le jour de
 *      l'essai, planche t2p07) : semaine après semaine, la hauteur de la planche de tomates ne
 *      baisse jamais, grandit d'au moins 1 m entre la première semaine de plants et la dernière
 *      semaine de hauteur maximale, et ne dépasse pas 3 m (Q33) ;
 *   (La démo en ligne, hors ligne, est vérifiée dans vue-3d-jumeau.e2e.ts, que la configuration
 *   de pnpm e2e:demo lance déjà : « plants 3D sur la démo ».)
 */

const DELAI_AMORCAGE_MS = 120_000;
const DELAI_MS = 30_000;
const HAUTEUR_MAX_TOMATE_M = 3;

const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
});

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const vue = (page: Page) => page.getByTestId(TESTID_3D.vue);
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const curseur = (page: Page) => page.getByTestId(TESTID_3D.curseur);

async function entier(page: Page, attribut: string): Promise<number> {
  return Number(await toile(page).getAttribute(attribut));
}

async function hauteurs(page: Page): Promise<Readonly<Record<string, number>>> {
  const brut = await toile(page).getAttribute('data-hauteurs-plants');
  if (brut === null) throw new Error('data-hauteurs-plants absent de la toile');
  return JSON.parse(brut) as Record<string, number>;
}

test('plants 3D : la planche de tomates grandit semaine après semaine (ferme du jour)', async ({ page }) => {
  test.skip(process.env.E2E_DEMO === '1', 'ne tourne pas sur la démo : elle a son propre test dans vue-3d-jumeau.e2e.ts');
  test.setTimeout(DELAI_AMORCAGE_MS + 180_000);
  const aujourdhui = jourLocal(new Date());
  await page.goto(`/diagnostic/amorcer.html?jeu=aujourdhui&date=${aujourdhui}`);
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; utilisateurId?: string; fermeId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  if (a.utilisateurId === undefined) throw new Error('amorçage sans utilisateur');

  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: a.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible();
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  await expect(page.getByTestId(TESTID_3D.repli)).toHaveCount(0);

  // La planche de tomates : celle dont la liste texte annonce « Tomate » la semaine du jour.
  const idTomate = await page.getByTestId(TESTID_3D.elementListe).evaluateAll((els) => els.find((e) => e.getAttribute('data-culture') === 'Tomate')?.getAttribute('data-id') ?? null);
  expect(idTomate, 'une planche de tomates la semaine du jour').not.toBeNull();
  if (idTomate === null) return;
  const max = Number(await curseur(page).getAttribute('max'));
  expect(max).toBeGreaterThan(10);

  const serie: { semaine: number; hauteur: number }[] = [];
  for (let i = 0; i <= max; i += 1) {
    await curseur(page).fill(String(i));
    await expect(vue(page)).toHaveAttribute('data-semaine', String(i));
    await expect(toile(page)).toHaveAttribute('data-semaine-plants', String(i));
    const culture = await page.locator(`[data-testid="${TESTID_3D.elementListe}"][data-id="${idTomate}"]`).getAttribute('data-culture');
    if (culture !== 'Tomate') continue;
    serie.push({ semaine: i, hauteur: (await hauteurs(page))[idTomate] ?? 0 });
  }
  console.log(`hauteur de la planche de tomates, semaine par semaine : ${serie.map((s) => `S${String(s.semaine)}=${s.hauteur.toFixed(2)}`).join(' ')}`);

  expect(serie.length, 'semaines où la planche porte des tomates').toBeGreaterThanOrEqual(8);
  for (let k = 1; k < serie.length; k += 1) {
    const avant = serie[k - 1];
    const apres = serie[k];
    if (avant === undefined || apres === undefined) continue;
    expect(apres.hauteur, `semaine ${String(apres.semaine)} : la tomate ne rapetisse pas (palissée, hauteur conservée)`).toBeGreaterThanOrEqual(avant.hauteur - 0.011);
  }
  const hauteursMesurees = serie.map((s) => s.hauteur);
  expect(Math.max(...hauteursMesurees), 'jamais au-delà de 3 m (Q33)').toBeLessThanOrEqual(HAUTEUR_MAX_TOMATE_M + 0.011);
  expect(Math.max(...hauteursMesurees) - Math.min(...hauteursMesurees), 'elle grandit d’au moins 1 m sur la saison').toBeGreaterThanOrEqual(1);
  // Au moins deux semaines consécutives où elle a bel et bien grandi.
  const pousse = serie.some((s, k) => k > 0 && s.hauteur > (serie[k - 1]?.hauteur ?? Infinity) + 0.01);
  expect(pousse, 'au moins une semaine où la hauteur augmente').toBe(true);

  // Un seul groupe d'instances par forme : jamais plus de groupes que de formes de plantes (7).
  expect(await entier(page, 'data-formes-plants')).toBeLessThanOrEqual(7);
  expect(await entier(page, 'data-plants')).toBeGreaterThan(0);
});
