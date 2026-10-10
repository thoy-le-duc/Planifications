import { expect, test, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { LIBELLES_COURTS_ATTENDUS, type LigneEmplacementPlan, type ModuleCalculsPlan, type Plan } from '../src/ecrans/plan/test/contrat.ts';
import { COULEURS, FAMILLES } from '../src/ui/jetons.ts';
import {
  decrireDefilement,
  decrireSerie,
  jugerDefilement,
  ralentirCpu,
  jugerSerie,
  repeterMesures,
  REPETITIONS_MESURE,
  surveillerCsp,
  tempsAppPrete,
  type PassageDefilement,
} from './outils.ts';

/**
 * T11 — vue 2D planches × semaines, de bout en bout, sur le build de production servi par
 * `vite preview`, avec la ferme de T07 (400 emplacements, 3 000 occupations) dans la base
 * locale de l'appli, hors ligne, CPU ralenti ×4. Contrat de l'écran : src/ecrans/plan/test/contrat.ts.
 *
 * ── Amorçage de la base locale sans serveur ─────────────────────────────────────────────────
 * Page `/diagnostic/amorcer.html` (même régime que /diagnostic/synchro.html : entrée à part du
 * build, hors navigation, hors service worker et hors précache, jamais liée depuis l'appli, CSP
 * de l'appli). Elle :
 *   - ouvre, avec PowerSync, la base locale de l'utilisateur du jeu de T07 (utilisateurId de
 *     remplirJeuT07 : un identifiant de test, jamais un vrai compte) : même nom de fichier que
 *     l'appli (nomBaseLocale), même schéma (SCHEMA_LOCAL), même stockage ; sans jamais appeler
 *     connect() ;
 *   - la remplit par remplirJeuT07(base) (packages/sync/src/test/jeu-t07.ts, graine 7 par
 *     défaut : les mêmes identifiants que ce test recalcule sous Node) ; si la base contient
 *     déjà la ferme du jeu, ne réécrit rien ;
 *   - vide la file d'envoi (ps_crud) : rien de ce jeu ne partira jamais vers un serveur, et
 *     l'appli n'affiche pas de saisies en attente ;
 *   - titre exact « Amorçage de la base locale (tests) » ;
 *   - ferme la base, puis pose window.__amorcage = { utilisateurId, fermeId, lignes } (lignes :
 *     total inséré) ou { erreur: string }.
 * Le test range ensuite une session (jetons factices) de cet utilisateur dans localStorage.
 * Si le chef préfère sortir cette page du build de production, un build dédié aux tests suffit :
 * le test ne dépend que de l'URL.
 *
 * ── Appli ────────────────────────────────────────────────────────────────────────────────────
 *   - connecté, l'appli ouvre la base locale (chargée à la demande, depuis le cache hors ligne :
 *     PowerSync, ses workers et son WASM doivent donc être servis par le service worker) et
 *     choisit la ferme active (src/donnees/ferme-active.ts) ; data-testid="app" porte
 *     data-base="ouverture|sans-ferme|prete|echec" ;
 *   - indicateur data-testid="etat-synchro" (role="status") dans la coquille, sur chaque onglet :
 *     ici « Hors ligne » (libelleSynchro, src/donnees/ferme-active.test.ts) ;
 *   - onglet « Planches » : l'écran de la vue 2D (h1 « Planches »).
 *
 * ── Ce que mesure ce test (CPU ×4, hors ligne, appli servie par le service worker) ──────────
 *   1. réouverture hors ligne sous 300 ms (marque app-prete) malgré l'ouverture de la base ;
 *   2. tap sur « Planches » → marque 'planif:plan-affiche' en moins de 300 ms (base déjà ouverte
 *      au démarrage), puis de nouveau après un aller-retour par « Ferme » ;
 *      (T20) 1 et 2 répétés 5 fois (rechargement hors ligne, 1re répétition à froid) : la médiane de
 *      chaque temps est comparée au budget ; le journal donne les 5 valeurs ;
 *   3. un conflit du jeu (le premier du plan, recalculé sous Node par calculs.ts) est visible
 *      sur sa ligne et nommé (libellé court de sa sorte, relecture C1) ; sa barre a la bordure
 *      --couleur-conflit ; le toucher ouvre le détail qui le nomme (nom long) ;
 *   4. réel plein (fond = bande de la famille), prévu hachuré (repeating-linear-gradient) ;
 *   5. semaine courante marquée et visible à l'ouverture (si aujourd'hui est dans la saison) ;
 *   6. changement de saison sans rechargement ;
 *   7. défilement de haut en bas à ~40 px par image, 5 passages : échec si 4 passages ou plus
 *      perdent, au moins une fois, plus de 2 images d'affilée (à 60 Hz), ou si plus de 6
 *      intervalles au total dépassent cette limite ; à chaque passage,
 *      jamais 60 lignes ou plus dans le DOM et la dernière ligne atteinte ; un témoin
 *      volontairement saccadé doit échouer à la même mesure (T11d, ci-dessous) ;
 *   8. à 360 px de large : pas de défilement horizontal de la page, plan et barre de navigation
 *      visibles ; aucune violation de la CSP.
 *
 * ── T11d : pourquoi cette mesure du défilement ───────────────────────────────────────────────
 * Avant : le pire intervalle entre deux images d'UN seul passage, limite 50 ms. Quatre échecs au
 * hasard sous charge (66,7, 66,7, 50,1 ms), jamais seul (33,4 à 50,0 ms). Deux défauts :
 *   - 50 ms tombe pile sur 3 images à 60 Hz (3 × 16,7 ms) : un intervalle de 3 images mesuré
 *     50,1 ms au bruit d'horloge près échouait, alors qu'il est exactement ce qu'on autorisait ;
 *   - un seul passage : une seule rafale due à un autre processus (deux agents, un second e2e)
 *     fait échouer le test, sans rien dire de l'appli.
 * Maintenant :
 *   - la limite est comptée en images : chaque intervalle est arrondi à l'image à 60 Hz la plus
 *     proche (imagesPerdues, outils.ts) ; « au plus 2 images perdues d'affilée » est la même
 *     limite que 50 ms, sans la frontière : 50,1 ms compte 2 images perdues, 66,7 ms en compte 3.
 *     L'arrondi à l'image la plus proche place la frontière réelle vers 58 ms (3,5 images) :
 *     tout intervalle mesuré entre ~50 et ~58 ms compte encore 2 images perdues. Ce n'est vrai
 *     que si les horodatages de requestAnimationFrame sont alignés sur une synchro à 60 Hz, ce
 *     qui est le cas du Chromium headless des e2e (intervalles observés : 16,7, 33,4, 50,0,
 *     66,7 ms…, jamais entre deux). La limite n'est pas relevée ;
 *   - un passage est « saccadé » s'il dépasse cette limite au moins une fois (le pire intervalle,
 *     comme avant : un seul gel suffit à marquer le passage) ;
 *   - 5 passages (comme les 5 répétitions de T20) ; le défilement ÉCHOUE SI 4 PASSAGES OU PLUS
 *     SONT SACCADÉS, OU SI PLUS DE 6 INTERVALLES AU TOTAL (sur les 5 passages) DÉPASSENT LA
 *     LIMITE. Un saccadement de l'appli (rendu trop lourd, lignes non virtualisées, mise en page
 *     forcée, travail lancé à intervalles) se reproduit d'un passage à l'autre ; une rafale due
 *     à la machine tombe au hasard.
 * Pourquoi « 4 sur 5 » et pas la médiane des 5 pires (3 sur 5), essayée d'abord : 19 exécutions
 * menées jusqu'au défilement (une 20e a échoué avant, sur une médiane de temps de T20) sous charge (un second e2e en parallèle, deux agents sur une machine à 4 cœurs) ont donné
 * 17 passages saccadés sur 95 (18 %), toujours par 1 à 3 intervalles isolés sur ~500 : la
 * machine, pas l'appli. À 18 % par passage, la médiane échoue au hasard environ 1 fois sur 23
 * (observé : 1 sur 19) ; « 4 sur 5 » environ 1 fois sur 200 (sur ces 19 exécutions : au plus
 * 3 passages saccadés, aucun échec). Le témoin ci-dessous, lui, a été saccadé dans 100 passages
 * sur 100 (20 exécutions sous charge) : « 4 sur 5 » le voit à chaque fois.
 * Pourquoi, en plus, le total des intervalles fautifs (relecture) : « 4 sur 5 » seul laisse
 * passer un gel de l'appli présent dans 3 passages sur 5 seulement. Avec le total, un tel gel
 * est détecté dès 7 intervalles fautifs sur les 5 passages (par exemple 3 gels par passage
 * dans 3 passages : 9). Bruit observé sous charge : sur les 19 exécutions ci-dessus, au plus
 * 3 intervalles fautifs dans un passage et 3 au total ; sur la série finale (20 exécutions,
 * second e2e en parallèle), au plus 1 au total ; mais dans une série plus chargée (deux agents
 * et un second e2e, 4 exécutions), un passage en a compté 5 et une exécution 6 au total : le
 * seuil de 6 est donc au ras de ce bruit-là, pas au-dessus avec de la marge. Le témoin
 * ci-dessous en compte 28 au moins.
 * On a écarté le 95e centile des intervalles : un gel rare de l'appli (2 à 4 par passage,
 * moins de 1 % des images) y passerait inaperçu. Ce que la règle laisse encore passer, en
 * connaissance de cause : un gel qui ne survient que dans 3 passages sur 5 ou moins ET au plus
 * 6 fois en tout (par exemple un ramasse-miettes occasionnel). C'est le prix d'un test qui ne
 * crie pas au loup.
 * Les contraintes qui ne sont pas des temps restent exigées à CHAQUE passage : moins de 60
 * lignes dans le DOM, dernière ligne atteinte, une image par pas de 40 px.
 * Témoin : les 5 mêmes passages, avec un travail bloquant injecté dans la page, doivent être
 * jugés saccadés par la même fonction (jugerDefilement). Il est choisi le plus difficile à voir :
 * des gels RARES (100 ms de calcul par seconde, soit ~8 gels par passage de ~500 images, moins
 * de 2 %), nettement au-delà de la limite sur toute machine. Un premier réglage à 60 ms (juste
 * au-delà de la limite en local) n'était vu que comme 2 images perdues sur la machine de CI, plus
 * rapide (CPU ×4 relatif) : 1 passage saccadé, 2 intervalles fautifs, témoin non vu. À 100 ms, un
 * gel couvre au moins 5 images même si l'horodatage de requestAnimationFrame tombe pendant le
 * blocage, soit au moins 4 perdues, quelle que soit la vitesse de la machine. Sans ce témoin, rien
 * ne prouverait que la statistique n'a pas rendu la mesure aveugle.
 */

const BUDGET_MS = 300;
/**
 * T11d — limite de fluidité du défilement, en images à 60 Hz : au plus 2 images perdues d'affilée
 * (un intervalle de 3 images, 50 ms, comme l'ancienne limite IMAGE_MAX_MS = 50). Échec si au moins
 * PASSAGES_SACCADES_ECHEC passages sur REPETITIONS_MESURE (5) la dépassent, ou si plus de
 * RAFALES_TOTAL_MAX intervalles, sur les 5 passages, la dépassent. Justification en tête.
 */
const IMAGES_PERDUES_MAX = 2;
const PASSAGES_SACCADES_ECHEC = 4;
const RAFALES_TOTAL_MAX = 6;
/** Défilement à ~40 px par image (2,4 px/ms à 60 Hz : un balayage rapide du pouce). */
const PAS_DEFILEMENT_PX = 40;
/**
 * Témoin saccadé : blocage du fil principal (ms) et période (ms). 100 ms bloquées = au moins
 * 5 images à 60 Hz entre deux images affichées, soit au moins 4 perdues : au-delà de la limite
 * sur la CI comme en local (60 ms n'y suffisaient pas, voir l'en-tête).
 * Une fois par seconde : ~8 gels par passage (~8 s), des gels rares, pas un saccadement continu.
 */
const TEMOIN_BLOCAGE_MS = 100;
const TEMOIN_PERIODE_MS = 1_000;
const MARQUE_PLAN = 'planif:plan-affiche';
/** Remplir la base PowerSync (≈ 42 000 lignes, jeu de T07) prend quelques secondes sans ralentissement. */
const DELAI_AMORCAGE_MS = 120_000;

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

function rgb(hex: string): string {
  const c = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${String(c(1))}, ${String(c(3))}, ${String(c(5))})`;
}

/** Le plan attendu, recalculé sous Node sur le même jeu (graine 7) par les calculs de l'écran. */
async function planAttendu(): Promise<{ plan: Plan; calculs: ModuleCalculsPlan; utilisateurId: string; fermeId: string; lignes: number }> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, jeu.principale.fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui });
    // Total inséré par remplirJeuT07 : la page d'amorçage doit annoncer exactement ce nombre.
    const lignes = Object.values(jeu.lignes).reduce((total, n) => total + n, 0);
    return { plan, calculs, utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId, lignes };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const defilement = (page: Page) => page.getByTestId('plan-defilement');

/** Temps entre le prochain appui (pointerdown) et la marque de l'écran Planches. */
async function tapJusquAuPlan(page: Page, libelle: string): Promise<number> {
  await page.evaluate((marque) => {
    performance.clearMarks(marque);
    const f = window as unknown as { __tap?: number };
    delete f.__tap;
    document.addEventListener(
      'pointerdown',
      () => {
        f.__tap = performance.now();
      },
      { capture: true, once: true },
    );
  }, MARQUE_PLAN);
  await onglet(page, libelle).click();
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_PLAN);
  return page.evaluate((marque) => {
    const tap = (window as unknown as { __tap?: number }).__tap ?? Number.NaN;
    return (performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN) - tap;
  }, MARQUE_PLAN);
}

/** Un passage de défilement mesuré dans la page : intervalles entre images et état du DOM. */
interface PassageMesure extends PassageDefilement {
  readonly images: number;
  readonly lignesMax: number;
  readonly bas: boolean;
  readonly derniere: string | null;
}

/**
 * Un passage : remonte en haut, puis descend de PAS_DEFILEMENT_PX à chaque image
 * (requestAnimationFrame) jusqu'en bas, en relevant chaque intervalle entre deux images et le
 * nombre de lignes présentes dans le DOM.
 */
async function defilerUneFois(page: Page): Promise<PassageMesure> {
  await defilement(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  return defilement(page).evaluate(
    (el, pas) =>
      new Promise<PassageMesure>((fini) => {
        const intervalles: number[] = [];
        let lignesMax = 0;
        let precedent = -1;
        const image = (t: number) => {
          if (precedent >= 0) intervalles.push(t - precedent);
          precedent = t;
          lignesMax = Math.max(lignesMax, el.querySelectorAll('[data-testid="ligne-plan"]').length);
          const max = el.scrollHeight - el.clientHeight;
          if (el.scrollTop >= max - 1) {
            requestAnimationFrame(() => {
              const lignes = el.querySelectorAll('[data-testid="ligne-plan"]');
              fini({
                // Les deux premiers intervalles comptent le démarrage de la mesure, pas le défilement.
                intervalles: intervalles.slice(2),
                images: intervalles.length,
                lignesMax,
                bas: true,
                derniere: lignes[lignes.length - 1]?.getAttribute('data-id') ?? null,
              });
            });
            return;
          }
          el.scrollTop = Math.min(max, el.scrollTop + pas);
          requestAnimationFrame(image);
        };
        requestAnimationFrame(image);
      }),
    PAS_DEFILEMENT_PX,
  );
}

/** REPETITIONS_MESURE passages de défilement, l'un après l'autre (T11d). */
async function repeterDefilement(page: Page): Promise<PassageMesure[]> {
  const passages: PassageMesure[] = [];
  for (let i = 0; i < REPETITIONS_MESURE; i += 1) passages.push(await defilerUneFois(page));
  return passages;
}

test('plan des planches : ferme de T07, hors ligne, CPU ×4', async ({ page, context }) => {
  // T11d : +120 s pour les 10 passages de défilement (5 mesurés, 5 témoins, ~10 s chacun sous charge).
  test.setTimeout(DELAI_AMORCAGE_MS + 240_000);
  const attendu = await planAttendu();
  const { plan, calculs } = attendu;
  const H = calculs.HAUTEUR_LIGNE_PX;

  await test.step('amorcer la base locale (page de diagnostic)', async () => {
    await page.goto('/diagnostic/amorcer.html');
    // Échec rapide si la page n'existe pas (vite preview sert alors l'appli).
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(attendu.utilisateurId);
    expect(a.fermeId).toBe(attendu.fermeId);
    expect(attendu.lignes, 'le jeu de T07 insère des lignes').toBeGreaterThan(0);
    expect(a.lignes, 'lignes insérées : exactement le jeu de T07').toBe(attendu.lignes);
  });

  const violations = await surveillerCsp(page);

  await test.step('connexion (session rangée), installation du service worker', async () => {
    await page.goto('/');
    await page.evaluate(
      ([cle, valeur]) => {
        localStorage.setItem(cle, valeur);
      },
      [
        CLE_SESSION,
        JSON.stringify({ utilisateurId: attendu.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }),
      ] as const,
    );
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(navigation(page)).toBeVisible();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  });

  await test.step('réouverture hors ligne puis tap sur « Planches », CPU ×4, 5 fois : médianes sous 300 ms', async () => {
    await context.setOffline(true);
    await ralentirCpu(page);
    // T20 : 5 répétitions, médiane comparée au budget (inchangé). Chaque répétition part d'un
    // rechargement hors ligne (appli servie par le service worker), base locale rouverte (worker
    // dédié, recréé à chaque page), écran Aujourd'hui, module Planches pas encore chargé dans la
    // page. La 1re suit l'installation, caches froids, et est comptée exprès (voir outils.ts).
    const series = await repeterMesures(REPETITIONS_MESURE, async () => {
      await page.reload();
      const reouverture = await tempsAppPrete(page);
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'servie par le service worker').toBe(true);
      await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
      const base = await page.evaluate(() => performance.now());
      console.log(`base locale prête vers ${base.toFixed(0)} ms après la navigation`);
      const etat = page.getByTestId('etat-synchro');
      await expect(etat).toBeVisible();
      await expect(etat).toHaveText('Hors ligne');
      await expect(etat).toHaveAttribute('role', 'status');

      await expect(page.getByRole('heading', { level: 1, name: 'Planches' }), 'la répétition part d’Aujourd’hui').toHaveCount(0);
      const planches = await tapJusquAuPlan(page, 'Planches');
      await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
      await expect(page.getByTestId('barre').first()).toBeVisible();
      await expect(page.getByTestId('etat-synchro')).toHaveText('Hors ligne');

      await onglet(page, 'Ferme').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Ferme' })).toBeVisible();
      const retour = await tapJusquAuPlan(page, 'Planches');
      return { reouverture, planches, retour };
    });
    console.log(decrireSerie('réouverture hors ligne, base locale remplie', series.reouverture, BUDGET_MS));
    console.log(decrireSerie('Planches, premier affichage', series.planches, BUDGET_MS));
    console.log(decrireSerie('Planches, retour', series.retour, BUDGET_MS));
    // T11b : médiane sous le budget, et aucune répétition au-delà de 1,5 fois le budget.
    expect(jugerSerie(series.reouverture, BUDGET_MS).raisons, 'réouverture hors ligne').toEqual([]);
    expect(jugerSerie(series.planches, BUDGET_MS).raisons, 'Planches, premier affichage').toEqual([]);
    expect(jugerSerie(series.retour, BUDGET_MS).raisons, 'Planches, retour').toEqual([]);
    await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
  });

  await test.step('semaine courante marquée et visible à l’ouverture', async () => {
    const reperes = page.getByTestId('semaine-courante');
    if (plan.semaineCourante === null) {
      await expect(reperes).toHaveCount(0);
      return;
    }
    await expect(reperes).toHaveCount(1);
    await expect(page.locator('[data-testid="semaine"][data-courante="oui"]')).toHaveText(plan.semaines[plan.semaineCourante]?.libelle ?? '');
    const repere = await reperes.boundingBox();
    const vue = await defilement(page).boundingBox();
    expect(repere).not.toBeNull();
    expect(vue).not.toBeNull();
    if (repere === null || vue === null) return;
    expect(repere.x, 'repère dans la vue (gauche)').toBeGreaterThanOrEqual(vue.x);
    expect(repere.x + repere.width, 'repère dans la vue (droite)').toBeLessThanOrEqual(vue.x + vue.width);
  });

  await test.step('un conflit du jeu, visible et nommé ; détail en lecture seule', async () => {
    const index = plan.lignes.findIndex((l) => l.sorte === 'emplacement' && l.conflits.length > 0);
    expect(index, 'le jeu de T07 a un conflit dans la saison affichée').toBeGreaterThanOrEqual(0);
    const ligne = plan.lignes[index] as LigneEmplacementPlan;
    await defilement(page).evaluate((el, y) => {
      el.scrollTop = y;
    }, Math.max(0, index - 2) * H);
    const el = page.locator(`[data-testid="ligne-plan"][data-id="${ligne.id}"]`);
    await expect(el).toHaveCount(1);
    await el.scrollIntoViewIfNeeded();
    await expect(el).toHaveAttribute('data-conflit', 'oui');
    // Relecture C1 : libellé court de la sorte du premier conflit ; le nom long (cultures en
    // cause) est dans le détail de la barre et dans celui de l'étiquette (plan-relecture.e2e.ts).
    const nom = el.getByTestId('conflit').first();
    await expect(nom).toBeVisible();
    const premier = ligne.conflits[0]?.nom ?? '';
    const sorte = ligne.conflits[0]?.sorte;
    expect(sorte).toBeDefined();
    await expect(nom).toHaveText(sorte === undefined ? '' : LIBELLES_COURTS_ATTENDUS[sorte]);
    const conflit = rgb((COULEURS as Readonly<Record<string, string>>).conflit ?? '#000000');
    expect(await nom.evaluate((e) => getComputedStyle(e).color)).toBe(conflit);

    const cible = ligne.barres.find((b) => b.enConflit);
    expect(cible).toBeDefined();
    const barre = el.locator(`[data-testid="barre"][data-occupation="${cible?.occupationId ?? ''}"]`);
    await expect(barre).toBeVisible();
    const bordure = await barre.evaluate((e) => {
      const s = getComputedStyle(e);
      return { couleur: s.borderTopColor, largeur: parseFloat(s.borderTopWidth) };
    });
    expect(bordure.couleur).toBe(conflit);
    expect(bordure.largeur).toBeGreaterThanOrEqual(2);

    await barre.click();
    const detail = page.getByRole('dialog', { name: 'Détail de la série' });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(cible?.libelle ?? '');
    await expect(detail).toContainText(ligne.code);
    await expect(detail).toContainText(premier);
    const fermer = detail.getByRole('button', { name: 'Fermer' });
    const boite = await fermer.boundingBox();
    expect(boite?.height ?? 0).toBeGreaterThanOrEqual(48);
    await fermer.click();
    await expect(detail).toHaveCount(0);
  });

  await test.step('réel plein, prévu hachuré, couleur de la famille', async () => {
    const barres = await page.getByTestId('barre').evaluateAll((els) =>
      els.map((e) => {
        const s = getComputedStyle(e);
        return { etat: e.getAttribute('data-etat'), famille: e.getAttribute('data-famille') ?? '', fond: s.backgroundColor, image: s.backgroundImage };
      }),
    );
    const reelles = barres.filter((b) => b.etat === 'reel' && b.famille !== '');
    const prevues = barres.filter((b) => b.etat === 'prevu');
    expect(reelles.length, 'barres réelles d’une famille attitrée à l’écran').toBeGreaterThan(0);
    expect(prevues.length, 'barres prévues à l’écran').toBeGreaterThan(0);
    const bandes = FAMILLES as Readonly<Record<string, { readonly bande: string }>>;
    for (const b of reelles) {
      expect(b.image, 'réel : plein').toBe('none');
      expect(b.fond).toBe(rgb(bandes[b.famille]?.bande ?? '#000000'));
    }
    for (const b of prevues) expect(b.image, 'prévu : hachuré').toContain('repeating-linear-gradient');
  });

  await test.step('changement de saison sans rechargement', async () => {
    await page.evaluate(() => {
      (window as unknown as { __memePage?: boolean }).__memePage = true;
    });
    const choix = page.getByLabel('Saison', { exact: true });
    const avant = await page.getByTestId('barre').first().getAttribute('data-occupation');
    await choix.selectOption({ label: '2024' });
    await expect(page.getByTestId('barre').first()).not.toHaveAttribute('data-occupation', avant ?? '');
    expect(await page.evaluate(() => (window as unknown as { __memePage?: boolean }).__memePage)).toBe(true);
    await choix.selectOption({ label: plan.saison.nom });
    await expect(page.getByTestId('barre').first()).toBeVisible();
  });

  await test.step('défilement de haut en bas, 5 passages : moins de 4 passages et au plus 6 intervalles au-delà de 2 images perdues, < 60 lignes dans le DOM', async () => {
    const passages = await repeterDefilement(page);
    const verdict = jugerDefilement(passages, IMAGES_PERDUES_MAX, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
    console.log(decrireDefilement('défilement', verdict));
    for (const [i, p] of passages.entries()) {
      console.log(`  passage ${String(i + 1)} : ${String(p.images)} images, ${String(p.lignesMax)} lignes au plus dans le DOM`);
      expect(p.bas, `passage ${String(i + 1)} : bas atteint`).toBe(true);
      expect(p.images, `passage ${String(i + 1)} : une image par pas de 40 px`).toBeGreaterThan((plan.lignes.length * H) / PAS_DEFILEMENT_PX / 2);
      expect(p.lignesMax, `passage ${String(i + 1)} : virtualisation`).toBeLessThan(60);
      expect(p.derniere, `passage ${String(i + 1)} : dernière ligne`).toBe(plan.lignes.at(-1)?.id ?? '');
    }
    expect(verdict.passagesSaccades, 'passages qui perdent plus de 2 images d’affilée').toBeLessThan(PASSAGES_SACCADES_ECHEC);
    expect(verdict.rafalesTotal, 'intervalles au-delà de 2 images perdues, sur les 5 passages').toBeLessThanOrEqual(RAFALES_TOTAL_MAX);
    expect(verdict.fluide).toBe(true);
  });

  await test.step('témoin : un défilement volontairement saccadé fait échouer la mesure', async () => {
    // Travail bloquant injecté dans la page pendant le défilement : 100 ms de calcul par seconde.
    // Une image ne peut pas être produite pendant le blocage : en général 3 images perdues
    // d'affilée, juste au-delà de la limite, plusieurs fois par passage. Si ce témoin passait pour
    // fluide, la mesure ne garantirait plus rien.
    await page.evaluate(
      ([blocageMs, periodeMs]) => {
        const f = window as unknown as { __saccade?: number };
        f.__saccade = window.setInterval(() => {
          const fin = performance.now() + blocageMs;
          while (performance.now() < fin) {
            // attente active : le fil principal est bloqué, comme par un rendu trop lourd
          }
        }, periodeMs);
      },
      [TEMOIN_BLOCAGE_MS, TEMOIN_PERIODE_MS] as const,
    );
    try {
      const passages = await repeterDefilement(page);
      const verdict = jugerDefilement(passages, IMAGES_PERDUES_MAX, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
      console.log(decrireDefilement('témoin saccadé', verdict));
      expect(verdict.fluide, 'le défilement saccadé doit échouer à la mesure').toBe(false);
      expect(verdict.passagesSaccades).toBeGreaterThanOrEqual(PASSAGES_SACCADES_ECHEC);
      // Chacun des deux critères, seul, doit suffire à le voir.
      expect(verdict.rafalesTotal).toBeGreaterThan(RAFALES_TOTAL_MAX);
    } finally {
      await page.evaluate(() => {
        window.clearInterval((window as unknown as { __saccade?: number }).__saccade);
      });
    }
  });

  await test.step('à 360 px de large : pas de défilement horizontal, plan et navigation visibles', async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await defilement(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(defilement(page)).toBeVisible();
    await expect(page.getByTestId('barre').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const vue = await defilement(page).boundingBox();
    expect((vue?.x ?? 0) + (vue?.width ?? 0)).toBeLessThanOrEqual(360);
    for (const libelle of ['Planches', 'Ferme']) {
      const b = await onglet(page, libelle).boundingBox();
      expect(b, libelle).not.toBeNull();
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    await expect(page.getByTestId('etat-synchro')).toBeVisible();
  });

  expect(await violations()).toEqual([]);
});
