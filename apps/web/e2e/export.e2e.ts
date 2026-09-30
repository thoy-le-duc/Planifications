import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TABLES_EXPORTEES, type Id } from '@planif/core';
import { SCHEMA_LOCAL } from '@planif/sync';
import { TABLES_BIBLIOTHEQUE } from '../../../packages/core/src/export/test/contrat.ts';
import { lireCsv } from '../../../packages/core/src/export/test/csv.ts';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { lireZip, texteZip, verifierAvecUnzip } from '../../../packages/sync/src/test/zip.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ralentirCpu, surveillerCsp } from './outils.ts';

/**
 * T16b — l'export de toute la ferme, branché dans l'onglet Ferme, de bout en bout : build de
 * production servi par `vite preview`, ferme de T07 dans la base locale de l'appli (amorcée par
 * /diagnostic/amorcer.html, comme e2e/plan.e2e.ts), HORS LIGNE, CPU ralenti ×4.
 *
 * ── Contrat de l'écran Ferme (voir aussi src/ecrans/ferme/ferme.test.tsx) ─────────────────────
 *   - le texte « … l’export n’y est pas encore relié … » (et le titre « Pas encore branché »)
 *     disparaît : jamais affiché, même après un tap ;
 *   - carte « Mes données » (section nommée « Mes données ») : UN SEUL bouton de nom accessible
 *     « Exporter toute ma ferme », d'au moins 56 px de haut (cible au gant) ;
 *   - base prête (data-base="prete") : bouton actif ; UN tap lance l'export (pas de second tap
 *     sur un autre écran) ; l'écran d'export (ecrans/export/index.ts) est chargé à la demande ;
 *   - base pas prête (ouverture, sans ferme, échec) : bouton désactivé (attribut disabled) et
 *     une explication en clair dans la carte « Mes données » ; ici « sans ferme » :
 *     « Aucune ferme sur ce téléphone… » (texte qui contient « aucune ferme ») ;
 *   - pendant l'export : barre d'avancement (role progressbar, `<progress>` convient) nommée
 *     « Avancement de l’export », qui monte ; bouton « Annuler » ; « Se déconnecter » reste
 *     visible et utilisable ;
 *   - fin : téléchargement d'une archive ZIP (lien `download`, Blob) ; annulé : « Export
 *     annulé » (role="status"), aucun téléchargement, bouton d'export de nouveau actif ;
 *   - « Se déconnecter » pendant l'export : l'export est annulé AVANT la fermeture et
 *     l'effacement de la base ; aucune erreur non gérée, aucun console.error de l'export, aucun
 *     téléchargement ; retour à l'écran de connexion, base IndexedDB effacée.
 *
 * ── Ce que mesure ce test (CPU ×4, hors ligne) ───────────────────────────────────────────────
 *   - archive valide (relue par node:zlib et `unzip -t`) : ferme.json, LISEZMOI.txt et un CSV
 *     par table exportée (TABLES_EXPORTEES, plus bibliotheque/<table>.csv), avec, par table,
 *     le même nombre de lignes que la base (recompté sous Node sur le même jeu, graine 7) dans
 *     le CSV et dans ferme.json ;
 *   - aucune tâche longue (PerformanceObserver « longtask ») de plus de 50 ms entre le tap et
 *     le téléchargement : le fil principal ne gèle pas ;
 *   - durée totale tap → téléchargement sous DUREE_MAX_MS (voir plus bas) : une attente sans
 *     calcul, invisible dans la mesure CPU des tests Node (relecture T19), se voit ici.
 */

/** Remplir la base PowerSync (≈ 42 000 lignes, jeu de T07) prend quelques secondes sans ralentissement. */
const DELAI_AMORCAGE_MS = 120_000;
/** Cible au gant (T16b), plus large que les 48 px des autres boutons. */
const CIBLE_GANT_PX = 56;
/**
 * Aucune tâche du fil principal au-delà (CPU ×4) pendant l'export (demande du chef pour T16b ;
 * T15b disait 100 ms).
 *
 * Mesure du testeur avant le code, sur main (branchement provisoire de l'écran Ferme sur
 * EcranExport, non commité, build de production, ce test) : UNE tâche de 190 à 213 ms, 3,1 à
 * 3,6 s après le tap, pendant la lecture de la base (barre encore indéterminée) : les 21
 * lectures parallèles de `exporterFerme` (packages/sync/src/export.ts), dont les 30 000
 * événements d'un bloc, reviennent du worker de PowerSync en un seul message à désérialiser
 * sur le fil principal. La construction de l'archive, elle, ne dépasse jamais 50 ms.
 */
const TACHE_MAX_MS = 50;
/**
 * Durée totale tap → téléchargement, CPU ×4, ferme de T07. Critère de T15 : 10 s, jamais
 * mesuré jusqu'ici dans un navigateur (relecture T19 : les tests Node ne voient plus une
 * attente sans calcul).
 * Mesures :
 *   - testeur, sur main (branchement provisoire) : 11,9 à 13,0 s sur 4 essais ;
 *   - développeur T16b (lecture par pages, compression dans un worker, aucune tâche longue) :
 *     11,7 à 13,1 s, dont ≈ 6 s de lecture de la base (limitée par IndexedDB) et 3,7 à 5,5 s
 *     de construction de l'archive sur le fil principal.
 * Décision du chef (T16b) : borne à 15 s. Geste rare, barre d'avancement, annulable, et le fil
 * principal ne gèle jamais (TACHE_MAX_MS = 50 inchangé). Le ticket T15c ramènera l'export
 * sous 10 s (archive construite au fil de la lecture).
 */
const DUREE_MAX_MS = 15_000;

const EXPORTER = 'Exporter toute ma ferme';

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

interface Attendu {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: number;
  /** Lignes de la ferme principale par chemin de CSV sans extension (comme export.test.ts de @planif/sync). */
  readonly comptes: Readonly<Record<string, number>>;
}

/** Le jeu de T07 recalculé sous Node (graine 7) : identifiants et lignes par table exportée. */
async function attendu(): Promise<Attendu> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const f = jeu.principale.fermeId as Id<'Ferme'>;
    const compter = (sql: string, p: readonly unknown[]) => base.lireDirect<{ n: number }>(sql, p)[0]?.n ?? -1;
    const bibliotheque: ReadonlySet<string> = new Set(TABLES_BIBLIOTHEQUE);
    const comptes: Record<string, number> = {};
    for (const t of Object.keys(TABLES_EXPORTEES)) {
      if (t === 'ferme') comptes[t] = compter('SELECT COUNT(*) AS n FROM ferme WHERE id = ?', [f]);
      else if (t === 'utilisateur') comptes[t] = compter('SELECT COUNT(*) AS n FROM utilisateur WHERE id IN (SELECT utilisateur_id FROM membre WHERE ferme_id = ?)', [f]);
      else comptes[t] = compter(`SELECT COUNT(*) AS n FROM "${t}" WHERE ferme_id = ?`, [f]);
      if (bibliotheque.has(t)) comptes[`bibliotheque/${t}`] = compter(`SELECT COUNT(*) AS n FROM "${t}" WHERE ferme_id IS NULL`, []);
    }
    const lignes = Object.values(jeu.lignes).reduce((total, n) => total + n, 0);
    return { utilisateurId: jeu.utilisateurId, fermeId: f, lignes, comptes };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const mesDonnees = (page: Page) => page.getByRole('region', { name: 'Mes données' });
const boutonExporter = (page: Page) => page.getByRole('button', { name: EXPORTER, exact: true });
const barre = (page: Page) => page.getByRole('progressbar', { name: 'Avancement de l’export' });

async function allerFerme(page: Page): Promise<void> {
  await navigation(page).locator('button').filter({ hasText: 'Ferme' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ferme' })).toBeVisible();
}

async function rangerSession(page: Page, utilisateurId: string): Promise<void> {
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
}

/** Le texte de T16 qui disait franchement que l'export n'était pas relié : il doit avoir disparu. */
async function sansTexteProvisoire(page: Page): Promise<void> {
  await expect(page.getByText(/pas encore reli/i)).toHaveCount(0);
  await expect(page.getByText('Pas encore branché')).toHaveCount(0);
}

/**
 * Pose dans la page, avant le tap, les sondes de l'export : tâches longues (PerformanceObserver
 * « longtask ») et valeurs successives de la barre d'avancement (lues à chaque image).
 */
async function poserSondes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __sondes?: { taches: number[]; valeurs: number[]; detail: string[]; arreter: () => void; debut: number };
    };
    w.__sondes?.arreter();
    const taches: number[] = [];
    const valeurs: number[] = [];
    /** Tâches longues datées depuis le tap, avec la barre à ce moment (diagnostic du journal). */
    const detail: string[] = [];
    const serie: { t: number; v: number }[] = [];
    const debut = performance.now();
    const obs = new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) {
        if (e.startTime < debut) continue;
        taches.push(e.duration);
        const barre = serie.filter((x) => x.t <= e.startTime).at(-1)?.v;
        detail.push(`${(e.startTime - debut).toFixed(0)} ms : ${e.duration.toFixed(0)} ms (barre ${barre === undefined ? '—' : `${(barre * 100).toFixed(0)} %`})`);
      }
    });
    obs.observe({ type: 'longtask', buffered: false });
    let actif = true;
    const lire = () => {
      if (!actif) return;
      const el = document.querySelector('progress, [role="progressbar"]');
      if (el !== null) {
        const brut = el instanceof HTMLProgressElement ? (el.hasAttribute('value') ? el.value / (el.max || 1) : Number.NaN) : Number(el.getAttribute('aria-valuenow')) / Number(el.getAttribute('aria-valuemax') ?? '100');
        if (Number.isFinite(brut) && valeurs.at(-1) !== brut) {
          valeurs.push(brut);
          serie.push({ t: performance.now(), v: brut });
        }
      }
      requestAnimationFrame(lire);
    };
    requestAnimationFrame(lire);
    w.__sondes = {
      taches,
      valeurs,
      detail,
      debut,
      arreter: () => {
        actif = false;
        obs.disconnect();
      },
    };
  });
}

async function lireSondes(page: Page): Promise<{ taches: number[]; valeurs: number[]; detail: string[] }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __sondes?: { taches: number[]; valeurs: number[]; detail: string[]; arreter: () => void } }).__sondes;
    s?.arreter();
    return { taches: [...(s?.taches ?? [])], valeurs: [...(s?.valeurs ?? [])], detail: [...(s?.detail ?? [])] };
  });
}

test('sans ferme sur ce téléphone : bouton d’export désactivé, avec une explication', async ({ page }) => {
  await page.goto('/');
  // Utilisateur de test sans aucune base : l'appli ouvre une base vide, sans ferme.
  await rangerSession(page, '0192f0c1-7a6e-7cc3-9b1e-00000000b16b');
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'sans-ferme', { timeout: 30_000 });
  await allerFerme(page);
  await sansTexteProvisoire(page);
  const bouton = boutonExporter(page);
  await expect(bouton).toHaveCount(1);
  await expect(bouton).toBeDisabled();
  await expect(mesDonnees(page)).toContainText(/aucune ferme/i);
});

test('export de toute la ferme depuis l’onglet Ferme : hors ligne, CPU ×4, ferme de T07', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 240_000);
  const a = await attendu();
  const telechargements: string[] = [];
  page.on('download', (d) => telechargements.push(d.suggestedFilename()));

  await test.step('amorcer la base locale (page de diagnostic)', async () => {
    await page.goto('/diagnostic/amorcer.html');
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const amorcage = (await poignee.jsonValue()) as Amorcage;
    expect(amorcage.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(amorcage.utilisateurId).toBe(a.utilisateurId);
    expect(amorcage.fermeId).toBe(a.fermeId);
    expect(amorcage.lignes).toBe(a.lignes);
  });

  const violations = await surveillerCsp(page);

  await test.step('connexion (session rangée), service worker installé, base prête', async () => {
    await page.goto('/');
    await rangerSession(page, a.utilisateurId);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(navigation(page)).toBeVisible();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  });

  await test.step('hors ligne, CPU ×4 : réouverture, base prête, onglet Ferme', async () => {
    await context.setOffline(true);
    await ralentirCpu(page);
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await expect(page.getByTestId('etat-synchro')).toHaveText('Hors ligne');
    await allerFerme(page);
    await sansTexteProvisoire(page);
    const bouton = boutonExporter(page);
    await expect(bouton).toHaveCount(1);
    await expect(bouton).toBeEnabled();
    const boite = await bouton.boundingBox();
    expect(boite?.height ?? 0, 'cible au gant').toBeGreaterThanOrEqual(CIBLE_GANT_PX);
  });

  await test.step('un tap : barre qui monte, fil principal jamais gelé, archive téléchargée', async () => {
    await poserSondes(page);
    const attente = page.waitForEvent('download', { timeout: 120_000 });
    // Échec d'une étape avant le téléchargement : pas de second message « Test ended ».
    attente.catch(() => undefined);
    const debut = Date.now();
    await boutonExporter(page).click();
    await expect(barre(page), 'barre d’avancement dès le tap').toBeVisible();
    const telechargement = await attente;
    const duree = Date.now() - debut;
    const { taches, valeurs, detail } = await lireSondes(page);
    const pire = Math.max(0, ...taches);
    console.log(
      `export T07 hors ligne, CPU ×4 : ${String(duree)} ms (borne ${String(DUREE_MAX_MS)} ms), ${String(taches.length)} tâches longues, pire ${pire.toFixed(0)} ms (limite ${String(TACHE_MAX_MS)} ms), ${String(valeurs.length)} valeurs de la barre`,
    );
    for (const d of detail) console.log(`  tâche longue à ${d}`);
    await sansTexteProvisoire(page);

    // Barre d'avancement : plusieurs valeurs, jamais en recul, qui montent vraiment.
    expect(valeurs.length, 'la barre d’avancement a pris plusieurs valeurs').toBeGreaterThanOrEqual(3);
    for (let k = 1; k < valeurs.length; k++) expect(valeurs[k] ?? 0, `valeur ${String(k)} de la barre`).toBeGreaterThanOrEqual(valeurs[k - 1] ?? 0);
    expect((valeurs.at(-1) ?? 0) - (valeurs[0] ?? 0), 'la barre monte').toBeGreaterThan(0.5);

    expect(pire, 'tâche longue sur le fil principal pendant l’export').toBeLessThanOrEqual(TACHE_MAX_MS);
    expect(duree, 'durée tap → téléchargement').toBeLessThan(DUREE_MAX_MS);

    // Archive : valide, complète, même nombre de lignes que la base, table par table.
    expect(telechargement.suggestedFilename()).toMatch(/^planifications-.+-\d{4}-\d{2}-\d{2}\.zip$/);
    const chemin = await telechargement.path();
    const octets = new Uint8Array(readFileSync(chemin));
    const entrees = lireZip(octets);
    const fichiers = ['ferme.json', 'LISEZMOI.txt', ...Object.keys(a.comptes).map((t) => `${t}.csv`)].sort();
    expect(entrees.map((e) => e.chemin).sort()).toEqual(fichiers);
    expect(verifierAvecUnzip(octets).sort()).toEqual(fichiers);
    const json = JSON.parse(texteZip(entrees, 'ferme.json')) as { tables: Record<string, unknown[]>; bibliotheque: Record<string, unknown[]> };
    for (const [cle, n] of Object.entries(a.comptes)) {
      expect(lireCsv(texteZip(entrees, `${cle}.csv`)).lignes, `${cle}.csv`).toHaveLength(n);
      const tableau = cle.startsWith('bibliotheque/') ? json.bibliotheque[cle.slice('bibliotheque/'.length)] : json.tables[cle];
      expect(tableau, `ferme.json ${cle}`).toHaveLength(n);
    }
    expect(a.comptes.evenement, 'le jeu de T07 a ses 30 000 événements').toBe(30_000);
    expect(telechargements).toHaveLength(1);
  });

  await test.step('annuler pendant l’export : « Export annulé », rien de téléchargé', async () => {
    const avant = telechargements.length;
    await expect(boutonExporter(page)).toBeEnabled();
    await boutonExporter(page).click();
    await expect(barre(page)).toBeVisible();
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Export annulé' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // Assez longtemps pour qu'un export non arrêté aille au bout (borne de durée ci-dessus).
    await page.waitForTimeout(DUREE_MAX_MS);
    expect(telechargements.length, 'aucun téléchargement après « Annuler »').toBe(avant);
    await expect(boutonExporter(page)).toBeEnabled();
  });

  await test.step('se déconnecter pendant l’export : export annulé avant l’effacement, aucune erreur', async () => {
    const avant = telechargements.length;
    const erreurs: string[] = [];
    page.on('pageerror', (e) => erreurs.push(`pageerror : ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && /export|abort|annul/i.test(m.text())) erreurs.push(`console.error : ${m.text()}`);
    });
    await page.evaluate(() => {
      window.addEventListener('unhandledrejection', (e) => {
        const r: unknown = e.reason;
        console.error(`rejet non géré (export) : ${r instanceof Error ? `${r.name} ${r.message}` : String(r)}`);
      });
    });
    await boutonExporter(page).click();
    await expect(barre(page)).toBeVisible();
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    const confirmation = page.getByTestId('confirmation-deconnexion');
    const quandMeme = confirmation.getByRole('button', { name: 'Se déconnecter quand même' });
    // Aucune saisie en attente (file vidée à l'amorçage) : pas de confirmation, sauf base illisible.
    await expect(navigation(page).or(quandMeme)).toBeVisible();
    if (await quandMeme.isVisible()) await quandMeme.click();
    await expect(navigation(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => (await indexedDB.databases()).map((b) => b.name ?? '')), { timeout: 20_000 })
      .not.toContain(`planif-${a.utilisateurId}.sqlite`);
    expect(await page.evaluate(() => localStorage.getItem('planif.effacement-en-attente'))).toBeNull();
    // Laisse à un export non arrêté le temps d'échouer (base fermée) ou d'aller au bout : il
    // téléchargerait alors, après la déconnexion, les données d'un compte effacé du téléphone.
    await page.waitForTimeout(DUREE_MAX_MS);
    expect(erreurs).toEqual([]);
    expect(telechargements.length, 'aucun téléchargement après la déconnexion').toBe(avant);
    await expect(page.getByRole('alert').filter({ hasText: /export/i })).toHaveCount(0);
  });

  expect(await violations()).toEqual([]);
});
