import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { LigneEmplacementPlan, LigneZonePlan, Plan } from '../src/ecrans/plan/test/contrat.ts';
import { COULEURS } from '../src/ui/jetons.ts';
import { installerAvecBase, navigation, onglet, planAttendu } from './plan-performances-outils.ts';

/**
 * T11e — écarts avec la maquette Plan (docs/maquettes/Plan.dc.html, validée par Théophane le
 * 2026-09-29, Q16) : puces de zone, surtitre « TUNNEL 2 · 6 PLANCHES · 30 M », carte d'alerte
 * sous la légende. Aucun des trois n'existe aujourd'hui (src/ecrans/plan/EcranPlan.tsx).
 * Ferme de T07 (30 zones, 400 planches), téléphone Pixel 7, connecté, base prête.
 *
 * Contrat retenu par le testeur (la maquette montre une seule zone et ne dit pas tout ; points à
 * confirmer par le chef, voir docs/mesures/T11e-avant.md, « Maquette ») :
 *
 * Puces de zone — un groupe role="group" nommé « Zones », au-dessus du plan : un bouton par zone
 *   racine du plan, dans l'ordre du plan (même tri que les lignes, « Tunnel 2 » avant
 *   « Tunnel 10 »), texte = nom de la zone, cible d'au moins 44 px de haut (gants). Les puces ne
 *   FILTRENT pas le plan (plan.e2e.ts parcourt toujours les 400 planches) : elles y NAVIGUENT.
 *   Toucher une puce amène la ligne de sa zone en haut de la vue ; la puce active
 *   (aria-pressed="true", une seule) est celle de la zone de la première ligne visible, à
 *   l'ouverture comme après un défilement. Trop de puces pour la largeur : la rangée défile
 *   d'elle-même, jamais la page (pas de défilement horizontal à 360 px).
 * Surtitre — data-testid="plan-surtitre", au-dessus du plan : « NOM DE LA ZONE ACTIVE · N
 *   PLANCHES · L M », en capitales : N = planches (emplacements) de la zone dans le plan affiché
 *   (« 1 PLANCHE » au singulier), L = total de leurs longueurs en mètres (mètres de planche),
 *   écrit à la française (Intl fr-FR, au plus une décimale). Suit la puce active. Entier
 *   (ni tronqué ni coupé), police d'au moins 12 px.
 * Carte d'alerte — data-testid="plan-alerte", SOUS la légende (« Légende »), dans l'écran sans
 *   défiler la page (au-dessus de la barre de navigation), bord gauche orange (COULEURS.orange,
 *   au moins 4 px), quand une culture prévue de la saison affichée a passé sa date de début sans
 *   être faite (barre « prévu » dont `du` est avant aujourd'hui). Elle nomme une de ces cultures :
 *   code de la planche, libellé de la barre (casse libre), date prévue (« 12 avril ») et « pas
 *   encore faite » (police d'au moins 16 px). Le plan garde au moins 4 lignes de haut.
 *   La phrase « Récolte décalée au … si plantée cette semaine » de la maquette demande un calcul
 *   du moteur qui n'existe pas encore : hors de ce test (ticket de suite proposé).
 */

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CIBLE_MIN_PX = 44;
const POLICE_SURTITRE_MIN_PX = 12;
const POLICE_ALERTE_MIN_PX = 16;
const LIGNES_PLAN_MIN = 4;

function rgb(hex: string): string {
  const c = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${String(c(1))}, ${String(c(3))}, ${String(c(5))})`;
}

/** '2026-04-12' → '12 avril'. */
function jourEtMois(date: string): string {
  const [, m, j] = date.split('-');
  return `${String(Number(j))} ${MOIS[Number(m) - 1] ?? ''}`;
}

/** Espaces insécables (Intl) ramenées à des espaces simples, capitales. */
function normaliser(texte: string): string {
  return texte.replace(/[\s\u00a0\u202f]+/g, ' ').trim().toLocaleUpperCase('fr');
}

interface ZoneAttendue {
  readonly id: string;
  readonly nom: string;
  readonly surtitre: string;
}

const puces = (page: Page): Locator => page.getByRole('group', { name: 'Zones' }).getByRole('button');
const puceActive = (page: Page): Locator => page.getByRole('group', { name: 'Zones' }).getByRole('button', { pressed: true });
const surtitre = (page: Page): Locator => page.getByTestId('plan-surtitre');
const vue = (page: Page): Locator => page.getByTestId('plan-defilement');

/** Attendu, calculé une fois sous Node (jeu de T07). */
let plan: Plan;
let H: number;
let zones: ZoneAttendue[];
let enRetard: { readonly code: string; readonly libelle: string; readonly du: string }[];
let contexte: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const attendu = await planAttendu();
  plan = attendu.plan;
  H = attendu.calculs.HAUTEUR_LIGNE_PX;
  const metres = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  zones = plan.lignes
    .filter((l): l is LigneZonePlan => l.sorte === 'zone')
    .map((z) => {
      const planches = plan.lignes.filter((l): l is LigneEmplacementPlan => l.sorte === 'emplacement' && l.zoneId === z.id);
      const total = planches.reduce((s, l) => s + (attendu.longueurs.get(l.id) ?? 0), 0);
      const n = planches.length;
      return { id: z.id, nom: z.nom, surtitre: normaliser(`${z.nom} · ${String(n)} ${n === 1 ? 'PLANCHE' : 'PLANCHES'} · ${metres.format(total)} M`) };
    });
  enRetard = plan.lignes
    .filter((l): l is LigneEmplacementPlan => l.sorte === 'emplacement')
    .flatMap((l) => l.barres.filter((b) => b.etat === 'prevu' && b.du < attendu.aujourdhui).map((b) => ({ code: l.code, libelle: b.libelle, du: b.du })));

  contexte = await browser.newContext();
  page = await contexte.newPage();
  await installerAvecBase(page);
  await onglet(page, 'Planches').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await contexte.close();
});

/** Chaque test part du haut du plan. */
test.beforeEach(async () => {
  await vue(page).evaluate((el) => {
    el.scrollTop = 0;
  });
});

function zone(i: number): ZoneAttendue {
  const z = zones[i];
  if (z === undefined) throw new Error(`zone ${String(i)} absente du jeu`);
  return z;
}

test('jeu de T07 : plusieurs zones et des cultures prévues en retard (condition des tests suivants)', () => {
  expect(zones.length).toBeGreaterThan(5);
  expect(enRetard.length).toBeGreaterThan(0);
});

test('puces de zone : une par zone, dans l’ordre du plan, au-dessus du plan, 44 px, la première active', async () => {
  await expect(puces(page)).toHaveText(zones.map((z) => z.nom));
  await expect(puceActive(page)).toHaveText([zone(0).nom]);
  const groupe = await page.getByRole('group', { name: 'Zones' }).boundingBox();
  const plan2d = await vue(page).boundingBox();
  expect(groupe !== null && plan2d !== null && groupe.y + groupe.height <= plan2d.y + 1, 'puces au-dessus du plan').toBe(true);
  const hauteur = await puces(page).first().evaluate((e) => e.getBoundingClientRect().height);
  expect(hauteur, 'cible d’une puce').toBeGreaterThanOrEqual(CIBLE_MIN_PX);
});

test('toucher une puce amène sa zone en haut du plan ; défiler jusqu’à une zone rend sa puce active', async () => {
  const troisieme = zone(2);
  await expect(puces(page), 'puces de zone présentes').not.toHaveCount(0);
  await puces(page).filter({ hasText: troisieme.nom }).first().click();
  const ligne = page.locator(`[data-testid="ligne-plan"][data-sorte="zone"][data-id="${troisieme.id}"]`);
  await expect(ligne).toBeVisible();
  await expect
    .poll(async () => {
      const l = await ligne.boundingBox();
      const v = await vue(page).boundingBox();
      return l === null || v === null ? Number.NaN : l.y - v.y;
    }, 'ligne de la zone en haut de la vue (sous l’en-tête des semaines)')
    .toBeLessThanOrEqual(H + 30);
  await expect(puceActive(page)).toHaveText([troisieme.nom]);

  const sixieme = zone(5);
  const index = plan.lignes.findIndex((l) => l.sorte === 'zone' && l.id === sixieme.id);
  await vue(page).evaluate((el, y) => {
    el.scrollTop = y;
  }, index * H + 1);
  await expect(puceActive(page)).toHaveText([sixieme.nom]);
});

test('surtitre « ZONE · N PLANCHES · L M » de la zone active, entier et lisible, qui suit la zone', async () => {
  await expect(surtitre(page)).toBeVisible();
  await expect.poll(async () => normaliser(await surtitre(page).innerText())).toBe(zone(0).surtitre);
  const mesure = await surtitre(page).evaluate((e) => ({ police: parseFloat(getComputedStyle(e).fontSize), entier: e.scrollWidth <= e.clientWidth + 1 }));
  expect(mesure.police).toBeGreaterThanOrEqual(POLICE_SURTITRE_MIN_PX);
  expect(mesure.entier, 'surtitre non tronqué').toBe(true);
  const boite = await surtitre(page).boundingBox();
  const plan2d = await vue(page).boundingBox();
  expect(boite !== null && plan2d !== null && boite.y + boite.height <= plan2d.y + 1, 'surtitre au-dessus du plan').toBe(true);

  const sixieme = zone(5);
  const index = plan.lignes.findIndex((l) => l.sorte === 'zone' && l.id === sixieme.id);
  await vue(page).evaluate((el, y) => {
    el.scrollTop = y;
  }, index * H + 1);
  await expect.poll(async () => normaliser(await surtitre(page).innerText())).toBe(sixieme.surtitre);
});

test('carte d’alerte sous la légende : une culture en retard, nommée et datée, dans l’écran', async () => {
  const carte = page.getByTestId('plan-alerte');
  await expect(carte).toBeVisible();
  const legende = await page.getByRole('list', { name: 'Légende' }).boundingBox();
  const boite = await carte.boundingBox();
  const nav = await navigation(page).boundingBox();
  if (legende === null || boite === null || nav === null) throw new Error('légende, carte ou navigation sans boîte');
  expect(boite.y, 'carte sous la légende').toBeGreaterThanOrEqual(legende.y + legende.height - 1);
  expect(boite.y + boite.height, 'carte au-dessus de la barre de navigation, sans défiler la page').toBeLessThanOrEqual(nav.y + 1);
  const bord = await carte.evaluate((e) => {
    const s = getComputedStyle(e);
    return { couleur: s.borderLeftColor, largeur: parseFloat(s.borderLeftWidth) };
  });
  expect(bord.couleur).toBe(rgb(COULEURS.orange));
  expect(bord.largeur).toBeGreaterThanOrEqual(4);

  const texte = normaliser(await carte.innerText());
  expect(texte).toContain('PAS ENCORE FAIT');
  const nommee = enRetard.find((r) => texte.includes(normaliser(r.code)) && texte.includes(normaliser(r.libelle)) && texte.includes(normaliser(jourEtMois(r.du))));
  expect(nommee, `la carte nomme une culture en retard (code, libellé, date prévue) : « ${texte} »`).toBeDefined();
  const police = await carte
    .getByText(/pas encore fait/i)
    .first()
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(police, 'phrase de l’alerte lisible').toBeGreaterThanOrEqual(POLICE_ALERTE_MIN_PX);

  const hauteurPlan = await vue(page).evaluate((e) => e.clientHeight);
  expect(hauteurPlan, 'le plan garde au moins 4 lignes de haut').toBeGreaterThanOrEqual(LIGNES_PLAN_MIN * H);
});

test('à 360 px : puces, surtitre et carte sans défilement horizontal de la page', async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  try {
    await expect(page.getByRole('group', { name: 'Zones' })).toBeVisible();
    await expect(surtitre(page)).toBeVisible();
    await expect(page.getByTestId('plan-alerte')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const groupe = await page.getByRole('group', { name: 'Zones' }).boundingBox();
    expect((groupe?.x ?? 0) + (groupe?.width ?? 0)).toBeLessThanOrEqual(360);
  } finally {
    await page.setViewportSize({ width: 412, height: 839 });
  }
});
