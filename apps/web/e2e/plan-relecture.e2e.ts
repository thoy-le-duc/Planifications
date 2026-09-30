import { expect, test, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { LIBELLES_COURTS_ATTENDUS, type LigneEmplacementPlan, type ModuleCalculsPlan, type Plan, type SorteConflit } from '../src/ecrans/plan/test/contrat.ts';

/**
 * T11 — corrections de la relecture, de bout en bout (build de production servi par
 * `vite preview`, ferme de T07 amorcée par /diagnostic/amorcer.html, comme plan.e2e.ts).
 * Contrat : src/ecrans/plan/test/contrat.ts, section « Corrections de la relecture ».
 *
 * C1 — à 360 px : chaque libellé de conflit (data-testid="conflit") est entier (ni tronqué par
 *   lui-même, scrollWidth ≤ clientWidth, ni rogné par l'étiquette qui le contient), en police
 *   calculée d'au moins 12 px ; l'étiquette d'une ligne en conflit est un bouton d'au moins
 *   48 px de haut qui ouvre la liste des conflits.
 * C6 — cible tactile des barres, formulée par le toucher réel (elementFromPoint) plutôt que par
 *   la boîte de l'élément : la barre dessinée garde sa largeur (elle dit ses dates), c'est la
 *   zone qui répond au doigt qui doit faire au moins 44 × 44 px. Pour chaque barre visible :
 *     - verticalement, à ±21 px du centre de sa partie visible, le point touche cette barre
 *       (sauf s'il tombe dans le dessin d'une autre barre, qui a alors la priorité) ;
 *     - horizontalement, pour une barre plus étroite que 44 px, à ±21 px de son centre, le
 *       point touche cette barre ou une autre barre de la même ligne (deux barres voisines se
 *       partagent l'espace entre elles), jamais le fond de la ligne.
 *   Les points cachés par l'en-tête des semaines ou la colonne des codes, ou hors de la vue, ne
 *   sont pas testés.
 * C3 — déconnexion avec la base ouverte par l'appli (data-base="prete") : après confirmation,
 *   aucune base IndexedDB « planif… » et aucun effacement en attente. Non-régression : le
 *   relecteur a constaté que cela marche déjà.
 */

/** Remplir la base PowerSync (jeu de T07) prend quelques secondes. */
const DELAI_AMORCAGE_MS = 120_000;
const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';
const CLE_EFFACEMENT_EN_ATTENTE = 'planif.effacement-en-attente';
const POLICE_MIN_PX = 12;
const CIBLE_ETIQUETTE_PX = 48;
/** Demi-côté de la zone tactile minimale (44 px) moins 1 px. */
const DEMI_CIBLE_PX = 21;

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly erreur?: string;
}

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

async function planAttendu(): Promise<{ plan: Plan; calculs: ModuleCalculsPlan; utilisateurId: string }> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, jeu.principale.fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui });
    return { plan, calculs, utilisateurId: jeu.utilisateurId };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const defilement = (page: Page) => page.getByTestId('plan-defilement');

/** Base locale amorcée (jeu de T07), session rangée, appli connectée avec la base prête. */
async function ouvrirAvecBase(page: Page, utilisateurId: string): Promise<void> {
  await page.goto('/diagnostic/amorcer.html');
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as Amorcage;
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.utilisateurId).toBe(utilisateurId);
  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await expect(navigation(page)).toBeVisible();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
}

async function allerAuPlan(page: Page): Promise<void> {
  await onglet(page, 'Planches').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
  await expect(page.getByTestId('barre').first()).toBeVisible();
}

/** Défile jusqu'à la ligne d'indice `index` (deux lignes au-dessus) et la rend. */
async function allerALaLigne(page: Page, plan: Plan, index: number, hauteurLigne: number) {
  await defilement(page).evaluate((el, y) => {
    el.scrollTop = y;
  }, Math.max(0, index - 2) * hauteurLigne);
  const el = page.locator(`[data-testid="ligne-plan"][data-id="${plan.lignes[index]?.id ?? ''}"]`);
  await expect(el).toHaveCount(1);
  return el;
}

function sortesDe(ligne: LigneEmplacementPlan): SorteConflit[] {
  const sortes: SorteConflit[] = [];
  for (const c of ligne.conflits) if (!sortes.includes(c.sorte)) sortes.push(c.sorte);
  return sortes;
}

test('C1 — à 360 px : libellés de conflit courts, entiers, ≥ 12 px ; étiquette bouton ≥ 48 px qui liste les conflits', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 90_000);
  const { plan, calculs, utilisateurId } = await planAttendu();
  await page.setViewportSize({ width: 360, height: 780 });
  await ouvrirAvecBase(page, utilisateurId);
  await allerAuPlan(page);

  const enConflit = plan.lignes
    .map((l, i) => ({ l, i }))
    .filter((x): x is { l: LigneEmplacementPlan; i: number } => x.l.sorte === 'emplacement' && x.l.conflits.length > 0);
  expect(enConflit.length, 'le jeu de T07 a des conflits dans la saison affichée').toBeGreaterThan(0);
  // Une ligne par combinaison de sortes (la première rencontrée) : tous les cas de mise en page.
  const parCombinaison = new Map<string, { l: LigneEmplacementPlan; i: number }>();
  for (const x of enConflit) {
    const cle = sortesDe(x.l).join('+');
    if (!parCombinaison.has(cle)) parCombinaison.set(cle, x);
  }
  console.log(`combinaisons de sortes vues : ${[...parCombinaison.keys()].join(', ')}`);

  for (const { l, i } of parCombinaison.values()) {
    const ligne = await allerALaLigne(page, plan, i, calculs.HAUTEUR_LIGNE_PX);
    const noms = ligne.getByTestId('conflit');
    await expect(noms).toHaveText(sortesDe(l).map((s) => LIBELLES_COURTS_ATTENDUS[s]));
    const etiquette = ligne.getByTestId('etiquette-conflit');
    await expect(etiquette, `${l.code} : étiquette bouton`).toHaveCount(1);
    expect(await etiquette.evaluate((e) => e.tagName)).toBe('BUTTON');
    const mesures = await etiquette.evaluate((bouton) => {
      const b = bouton.getBoundingClientRect();
      return {
        hauteur: b.height,
        deborde: bouton.scrollWidth > bouton.clientWidth,
        libelles: [...bouton.querySelectorAll<HTMLElement>('[data-testid="conflit"]')].map((n) => {
          const r = n.getBoundingClientRect();
          return {
            texte: n.textContent.trim(),
            police: parseFloat(getComputedStyle(n).fontSize),
            tronque: n.clientWidth > 0 && n.scrollWidth > n.clientWidth,
            rogne: r.width === 0 || r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5,
          };
        }),
      };
    });
    expect(mesures.hauteur, `${l.code} : cible de l’étiquette`).toBeGreaterThanOrEqual(CIBLE_ETIQUETTE_PX);
    expect(mesures.deborde, `${l.code} : rien ne déborde de l’étiquette`).toBe(false);
    for (const m of mesures.libelles) {
      expect(m.police, `${l.code} « ${m.texte} » : police`).toBeGreaterThanOrEqual(POLICE_MIN_PX);
      expect(m.tronque, `${l.code} « ${m.texte} » : tronqué (scrollWidth > clientWidth)`).toBe(false);
      expect(m.rogne, `${l.code} « ${m.texte} » : rogné par l’étiquette`).toBe(false);
    }
  }

  // L'étiquette de la ligne qui a le plus de conflits ouvre leur liste complète.
  const pleine = enConflit.reduce((a, b) => (b.l.conflits.length > a.l.conflits.length ? b : a));
  const ligne = await allerALaLigne(page, plan, pleine.i, calculs.HAUTEUR_LIGNE_PX);
  await ligne.getByTestId('etiquette-conflit').click();
  const detail = page.getByRole('dialog', { name: /^Conflits/ });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(pleine.l.code);
  await expect(detail.locator('li')).toHaveText(pleine.l.conflits.map((c) => c.nom));
  await detail.getByRole('button', { name: 'Fermer' }).click();
  await expect(detail).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

interface Sonde {
  readonly occupation: string;
  readonly sens: 'haut' | 'bas' | 'gauche' | 'droite';
  readonly touche: string | null;
  /** Ligne de la barre touchée (data-id de la ligne-plan). */
  readonly ligneTouchee: string | null;
  readonly ligne: string;
}

test('C6 — barres : zone de toucher d’au moins 44 × 44 px autour du centre de chaque barre visible', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 90_000);
  const { plan, calculs, utilisateurId } = await planAttendu();
  await page.setViewportSize({ width: 360, height: 780 });
  await ouvrirAvecBase(page, utilisateurId);
  await allerAuPlan(page);

  // Positions : haut du plan, milieu, à gauche (début de saison), et sur la première barre plus
  // étroite que la cible (moins de 8 jours : 36 px par semaine), s'il y en a une.
  const positions: { readonly haut: number | 'milieu'; readonly gauche: number | null }[] = [
    { haut: 0, gauche: null },
    { haut: 'milieu', gauche: null },
    { haut: 'milieu', gauche: 0 },
  ];
  const etroite = plan.lignes
    .map((l, i) => ({ l, i }))
    .flatMap(({ l, i }) => (l.sorte === 'emplacement' ? l.barres.filter((b) => b.finJour - b.debutJour < 8).map((b) => ({ b, i })) : []))[0];
  if (etroite !== undefined) {
    positions.push({ haut: Math.max(0, etroite.i - 2) * calculs.HAUTEUR_LIGNE_PX, gauche: Math.max(0, (etroite.b.debutJour / 7) * 36 - 100) });
  }
  console.log(etroite === undefined ? 'aucune barre de moins de 8 jours dans la saison' : `barre étroite : ${String(etroite.b.finJour - etroite.b.debutJour)} jours`);
  const sondes: Sonde[] = [];
  let barresVues = 0;
  for (const p of positions) {
    await defilement(page).evaluate(
      (el, pos) => {
        el.scrollTop = pos.haut === 'milieu' ? Math.floor((el.scrollHeight - el.clientHeight) / 2) : pos.haut;
        if (pos.gauche !== null) el.scrollLeft = pos.gauche;
      },
      p,
    );
    await page.waitForTimeout(200);
    const r = await defilement(page).evaluate((vue, demi) => {
      const v = vue.getBoundingClientRect();
      const entete = vue.querySelector('[data-testid="semaine"]')?.getBoundingClientRect().bottom ?? v.top;
      const codes = vue.querySelector('[data-testid="ligne-plan"][data-sorte="emplacement"] > *')?.getBoundingClientRect().right ?? v.left;
      const dedans = (x: number, y: number) => x > codes + 1 && x < v.right - 1 && y > entete + 1 && y < v.bottom - 1;
      const barres = [...vue.querySelectorAll<HTMLElement>('[data-testid="barre"]')];
      const dessins = barres.map((b) => ({ b, r: b.getBoundingClientRect() }));
      const resultat: Sonde[] = [];
      let vues = 0;
      for (const { b, r } of dessins) {
        // Partie visible de la barre (hors colonne des codes, en-tête et bords de la vue).
        const gauche = Math.max(r.left, codes + 1);
        const droite = Math.min(r.right, v.right - 1);
        const cy = r.top + r.height / 2;
        if (droite - gauche < 1 || !dedans((gauche + droite) / 2, cy)) continue;
        vues++;
        const cx = (gauche + droite) / 2;
        const ligne = b.closest('[data-testid="ligne-plan"]')?.getAttribute('data-id') ?? '';
        const points: [Sonde['sens'], number, number][] = [
          ['haut', cx, cy - demi],
          ['bas', cx, cy + demi],
        ];
        // À l'horizontale, seules les barres plus étroites que la cible, entièrement visibles.
        if (r.width < 2 * demi + 2 && gauche === r.left && droite === r.right) {
          points.push(['gauche', r.left + r.width / 2 - demi, cy], ['droite', r.left + r.width / 2 + demi, cy]);
        }
        for (const [sens, x, y] of points) {
          if (!dedans(x, y)) continue;
          // Point dans le dessin d'une autre barre : elle a la priorité, rien à tester.
          if (dessins.some((d) => d.b !== b && x >= d.r.left && x <= d.r.right && y >= d.r.top && y <= d.r.bottom)) continue;
          const cible = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-testid="barre"]') ?? null;
          resultat.push({
            occupation: b.dataset.occupation ?? '',
            sens,
            touche: cible?.dataset.occupation ?? null,
            ligneTouchee: cible?.closest('[data-testid="ligne-plan"]')?.getAttribute('data-id') ?? null,
            ligne,
          });
        }
      }
      return { sondes: resultat, vues };
    }, DEMI_CIBLE_PX);
    sondes.push(...r.sondes);
    barresVues += r.vues;
  }
  expect(barresVues, 'barres visibles testées').toBeGreaterThan(5);
  expect(sondes.length).toBeGreaterThan(0);
  const ratees = sondes.filter((s) =>
    s.sens === 'haut' || s.sens === 'bas' ? s.touche !== s.occupation : s.touche === null || s.ligneTouchee !== s.ligne,
  );
  const horizontales = sondes.filter((x) => x.sens === 'gauche' || x.sens === 'droite').length;
  console.log(`${String(barresVues)} barres, ${String(sondes.length)} points sondés (${String(horizontales)} à l’horizontale), ${String(ratees.length)} ratés`);
  expect(ratees.slice(0, 10), `points à ±${String(DEMI_CIBLE_PX)} px du centre d’une barre qui ne la touchent pas`).toEqual([]);
});

test('C3 — déconnexion avec la base ouverte par l’appli : plus aucune base « planif », aucun effacement en attente (non-régression)', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 60_000);
  const { utilisateurId } = await planAttendu();
  await ouvrirAvecBase(page, utilisateurId);
  const avant = await page.evaluate(async () => (await indexedDB.databases()).map((b) => b.name ?? ''));
  expect(avant, 'base locale de l’utilisateur ouverte').toContain(`planif-${utilisateurId}.sqlite`);

  // Avant de couper le réseau, le service worker doit avoir tout mis en cache (précache
  // installé et actif) et contrôler la page, comme dans les autres e2e hors ligne : sinon,
  // sous charge, l'écran Ferme ne peut pas se charger hors ligne (instabilité, T16b).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // Hors ligne : l'appel à l'API échoue vite, la déconnexion se fait quand même (T09b).
  await context.setOffline(true);
  await onglet(page, 'Ferme').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ferme' })).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
  // Base ouverte par l'appli et file d'envoi vide (amorçage) : pas de confirmation (T09b) ; si
  // l'appli en montre une (file illisible), on confirme.
  const quandMeme = page.getByTestId('confirmation-deconnexion').getByRole('button', { name: 'Se déconnecter quand même' });
  const email = page.getByLabel('Adresse e-mail');
  await expect(quandMeme.or(email)).toBeVisible({ timeout: 15_000 });
  if (await quandMeme.isVisible()) await quandMeme.click();
  await expect(email).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => page.evaluate(async () => (await indexedDB.databases()).map((b) => b.name ?? '').filter((n) => n.startsWith('planif'))), {
      timeout: 15_000,
    })
    .toEqual([]);
  expect(await page.evaluate((cle) => localStorage.getItem(cle), CLE_EFFACEMENT_EN_ATTENTE), 'aucun effacement en attente').toBeNull();
  await expect(page.getByText(/Fermez les autres onglets/)).toHaveCount(0);
});
