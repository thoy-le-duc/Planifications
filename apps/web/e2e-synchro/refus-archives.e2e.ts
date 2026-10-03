/**
 * T10o — un refus archivé sur un téléphone disparaît sur l'autre, avec la vraie synchro (Postgres,
 * service PowerSync, API ; pas la base en mémoire qui imite la synchro). Lancement, services et
 * règle de saut : comme synchro.e2e.ts (`pnpm e2e:synchro`, banc paramétrable de T10c).
 *
 * ── Ce qui est vérifié ──────────────────────────────────────────────────────────────────────
 *
 * Les refus ne descendent qu'à leur auteur (powersync/sync-config.yaml, flux refus_synchro filtré
 * sur auth.user_id()) : « les deux téléphones » sont donc deux navigateurs (deux contextes, deux
 * bases locales) du MÊME utilisateur, sessions[0] de l'amorçage, sur la vraie appli (`/`, onglet
 * Ferme, carte « Saisies refusées » de src/ecrans/ferme/Refus.tsx), pas la page de diagnostic.
 *
 * Session partagée : A et B reçoivent la MÊME session (même jeton d'accès, même jeton de
 * renouvellement), et rien ne verrouille le renouvellement entre deux contextes de navigateur. Le
 * jeton d'accès (1 h) couvre le test, donc aucun renouvellement n'est attendu. Si l'un des deux
 * renouvelait quand même, l'autre présenterait ensuite un jeton de renouvellement déjà tourné ;
 * dès que le successeur a servi, l'API y voit un rejeu et révoque toute la famille de jetons
 * (apps/api/src/auth/routes.ts). Symptôme : les deux téléphones
 * passent en « session expirée » et plus rien ne se synchronise.
 *
 * Amorçage : amorcer-e2e.ts (sans argument), puis deux refus écrits directement dans Postgres pour
 * cet utilisateur, comme le serveur les écrit (apps/api/src/sync/upload.ts) : celui qu'on archive
 * et un témoin qui doit rester. Aucun code de production n'est touché pour provoquer le refus.
 *
 *   1. A et B reçoivent les deux refus par la synchro ([data-testid="refus"][data-refus=<id>]).
 *   2. A tape « Archiver » sur le premier : la carte sort tout de suite de la liste de A, le
 *      bandeau « 1 refus archivé — Annuler » s'affiche (T10n) et RIEN n'est encore écrit :
 *      archive_le reste NULL en base, B voit toujours la carte.
 *   3. À la fin du délai d'annulation (5 s, T10n), A envoie POST /sync/upload : on intercepte la
 *      requête ; son corps est exactement { ecritures: [{ op: 'PATCH', table: 'refus_synchro',
 *      id, donnees: { archive_le } }] } (le PATCH ne porte que archive_le), réponse 200.
 *   4. En base, la ligne a archive_le = l'instant envoyé ; le témoin reste NULL ; l'archivage n'a
 *      pas été refusé (aucun refus sur la table refus_synchro).
 *   5. La ligne redescend archivée chez B : sa carte disparaît, le témoin reste affiché. Le flux
 *      descend les refus archivés compris et l'écran ne masque que archive_le non NULL
 *      (porte.surveillerRefus) : la disparition chez B prouve que la ligne y est descendue avec
 *      archive_le rempli.
 *
 * Accès à Postgres : DATABASE_URL (celle de l'API, posée par scripts/e2e-synchro.ts), avec le
 * client `pg` d'apps/api (apps/web n'en dépend pas), chargé par createRequire comme amorcer-e2e.ts
 * l'utilise.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page, type Request } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';

/** Délai maximal pour qu'une écriture d'un téléphone apparaisse sur l'autre. */
const DELAI_SYNCHRO_MS = 20_000;
/** Délai d'un affichage local (base du téléphone, sans réseau). */
const DELAI_LOCAL_MS = 3_000;
/**
 * T10n : durée du bandeau « Annuler » avant l'écriture (DELAI_ANNULATION_ARCHIVAGE_MS de
 * src/ecrans/ferme/Refus.tsx, recopié : ce module importe une feuille de style que Playwright ne
 * sait pas charger).
 */
const DELAI_ANNULATION_MS = 5_000;
/** Marge d'horloge entre Node et le navigateur pour vérifier que rien ne part avant la fin du délai. */
const MARGE_HORLOGE_MS = 500;

const SERVICES = (process.env.API_URL ?? '') !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
const EN_CI = Boolean(process.env.CI);

const SCRIPT_AMORCAGE = fileURLToPath(new URL('../../api/src/sync/test/amorcer-e2e.ts', import.meta.url));

/** Le peu du client `pg` dont le test se sert (types d'apps/api hors de portée d'apps/web). */
interface PoolPg {
  query(texte: string, valeurs?: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
}
interface ModulePg {
  readonly Pool: new (options: { readonly connectionString: string; readonly max?: number }) => PoolPg;
}
const requireApi = createRequire(fileURLToPath(new URL('../../api/package.json', import.meta.url)));

interface Amorcage {
  readonly fermeId: string;
  readonly sessions: readonly [SessionConnexion, SessionConnexion];
}

interface Telephone {
  readonly contexte: BrowserContext;
  readonly page: Page;
}

/** Corps de POST /sync/upload (packages/sync/src/envoi.ts). */
interface CorpsEnvoi {
  readonly ecritures: readonly {
    readonly op: string;
    readonly table: string;
    readonly id: string;
    readonly donnees?: Readonly<Record<string, unknown>>;
  }[];
}

if (!SERVICES && !EN_CI) {
  console.warn('[T10o] API_URL ou POWERSYNC_URL absente : test de bout en bout de l’archivage des refus sauté.');
}

test.describe('T10o : un refus archivé sur un téléphone disparaît sur l’autre', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let amorcage: Amorcage;
  let bd: PoolPg;
  /** Fermeture du pool, posée seulement s'il a été ouvert (beforeAll peut échouer avant). */
  let fermerBd: (() => Promise<void>) | null = null;
  /** Le refus qu'on archive, et le témoin qui doit rester. */
  const refusArchive = randomUUID();
  const refusTemoin = randomUUID();

  test.beforeAll(async () => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const urlBase = process.env.DATABASE_URL ?? '';
    if (urlBase === '') throw new Error('DATABASE_URL absente : le test lit refus_synchro dans Postgres (pnpm e2e:synchro la pose).');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE], { encoding: 'utf8', env: process.env });
    amorcage = JSON.parse(sortie) as Amorcage;
    const pg = requireApi('pg') as ModulePg;
    bd = new pg.Pool({ connectionString: urlBase, max: 1 });
    const pool = bd;
    fermerBd = () => pool.end();
    // Deux refus de l'utilisateur A, tels que le serveur les écrit (une modification d'événement
    // refusée, avec le résumé de T10k), le plus récent d'abord à l'écran.
    const utilisateurId = amorcage.sessions[0].utilisateurId;
    for (const [id, ligneId, quantite, age] of [
      [refusTemoin, randomUUID(), 4, '2 minutes'],
      [refusArchive, randomUUID(), 3, '1 minute'],
    ] as const) {
      await bd.query(
        `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, donnees,
                                    saisie_type, saisie_date, saisie_quantite, saisie_unite, cree_le)
         VALUES ($1, $2, $3, 'evenement', $4, 'PATCH', 'ajout_seul',
                 'Un événement du journal ne se modifie pas après coup : annulez-le ou corrigez-le.', NULL,
                 'recolte', CURRENT_DATE, $5, 'kg', now() - $6::interval)`,
        [id, utilisateurId, amorcage.fermeId, ligneId, quantite, age],
      );
    }
  });

  test.afterAll(async () => {
    await fermerBd?.();
  });

  async function ouvrir(browser: Browser, session: SessionConnexion): Promise<Telephone> {
    const contexte = await browser.newContext();
    await contexte.addInitScript(
      ([cle, valeur]) => {
        localStorage.setItem(cle, valeur);
      },
      [CLE_SESSION, JSON.stringify(session)] as const,
    );
    const page = await contexte.newPage();
    await page.goto('/');
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_SYNCHRO_MS });
    await page.getByRole('navigation', { name: 'Navigation principale' }).locator('button').filter({ hasText: 'Ferme' }).click();
    return { contexte, page };
  }

  const carte = (page: Page, id: string) => page.locator(`[data-testid="refus"][data-refus="${id}"]`);
  const bandeau = (page: Page) => page.getByTestId('refus-annulation');

  /** Vrai si archive_le du refus est rempli en base ; undefined si la ligne n'existe pas. */
  async function archiveEnBase(id: string): Promise<boolean | undefined> {
    const { rows } = await bd.query(`SELECT archive_le IS NOT NULL AS rempli FROM refus_synchro WHERE id = $1`, [id]);
    return (rows as readonly { rempli: boolean }[])[0]?.rempli;
  }

  /** Requêtes d'envoi (POST /sync/upload) qui touchent refus_synchro. */
  const estEnvoiRefus = (r: Request) =>
    r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/sync/upload') && (r.postData() ?? '').includes('refus_synchro');

  test('A archive un refus : rien ne part pendant le délai, puis un PATCH { archive_le } seul ; la ligne est archivée en base et la carte disparaît chez B', async ({
    browser,
  }) => {
    // Deux ouvertures, première synchro, délai d'annulation et redescente chez B : plus que les 120 s par défaut.
    test.setTimeout(180_000);
    const sessionA = amorcage.sessions[0];
    // Deux navigateurs du même utilisateur : les refus ne descendent qu'à leur auteur.
    const a = await ouvrir(browser, sessionA);
    const b = await ouvrir(browser, sessionA);
    const envoisRefus: Request[] = [];
    const envoisRefusB: Request[] = [];
    a.contexte.on('request', (r) => {
      if (estEnvoiRefus(r)) envoisRefus.push(r);
    });
    b.contexte.on('request', (r) => {
      if (estEnvoiRefus(r)) envoisRefusB.push(r);
    });
    try {
      // 1. Les deux refus descendent sur les deux téléphones.
      for (const t of [a, b]) {
        await expect(carte(t.page, refusArchive)).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
        // Les deux refus arrivent dans le même point de contrôle : le témoin suit la première carte.
        await expect(carte(t.page, refusTemoin)).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      }
      expect(await archiveEnBase(refusArchive)).toBe(false);

      // 2. A archive le premier : la carte sort tout de suite, le bandeau s'affiche, rien n'est écrit.
      const envoi = a.page.waitForRequest(estEnvoiRefus, { timeout: DELAI_ANNULATION_MS + DELAI_SYNCHRO_MS });
      const avantTap = Date.now();
      await carte(a.page, refusArchive).getByTestId('refus-archiver').click();
      await expect(carte(a.page, refusArchive)).toHaveCount(0, { timeout: DELAI_LOCAL_MS });
      await expect(carte(a.page, refusTemoin)).toHaveCount(1);
      await expect(bandeau(a.page)).toContainText('1 refus archivé');
      await expect(bandeau(a.page).getByTestId('refus-annuler')).toBeVisible();
      expect(envoisRefus, 'rien ne part tant que l’archivage peut être annulé').toHaveLength(0);
      expect(await archiveEnBase(refusArchive), 'rien n’est écrit pendant le délai d’annulation').toBe(false);
      await expect(carte(b.page, refusArchive)).toHaveCount(1);

      // 3. Fin du délai : un seul envoi, un PATCH qui ne porte que archive_le.
      const requete = await envoi;
      // Départ de la requête (heure epoch en ms, Request.timing().startTime), pas son arrivée côté Node.
      expect(requete.timing().startTime - avantTap, 'envoi après la fin du délai d’annulation').toBeGreaterThanOrEqual(DELAI_ANNULATION_MS - MARGE_HORLOGE_MS);
      const corps = JSON.parse(requete.postData() ?? '{}') as CorpsEnvoi;
      expect(corps.ecritures).toHaveLength(1);
      const [ecriture] = corps.ecritures;
      expect(ecriture).toEqual({ op: 'PATCH', table: 'refus_synchro', id: refusArchive, donnees: { archive_le: expect.any(String) as unknown } });
      expect(Object.keys(ecriture?.donnees ?? {}), 'le PATCH ne porte que archive_le').toEqual(['archive_le']);
      const archiveLe = String(ecriture?.donnees?.archive_le);
      expect(Number.isNaN(new Date(archiveLe).getTime()), `archive_le lisible (${archiveLe})`).toBe(false);
      expect((await requete.response())?.status(), 'réponse de /sync/upload').toBe(200);
      await expect(bandeau(a.page).getByTestId('refus-annuler')).toHaveCount(0, { timeout: DELAI_LOCAL_MS });

      // 4. En base : la ligne est archivée à l'instant envoyé, le témoin non ; l'archivage n'a pas été refusé.
      await expect
        .poll(
          async () =>
            (
              await bd.query(
                `SELECT archive_le IS NOT NULL AS rempli, archive_le = $2::timestamptz AS meme_instant FROM refus_synchro WHERE id = $1`,
                [refusArchive, archiveLe],
              )
            ).rows[0],
          { timeout: DELAI_SYNCHRO_MS, message: 'archive_le rempli en base, à l’instant du PATCH' },
        )
        .toEqual({ rempli: true, meme_instant: true });
      expect(await archiveEnBase(refusTemoin), 'le témoin n’est pas archivé').toBe(false);
      const refusDArchivage = await bd.query(
        `SELECT count(*)::text AS n FROM refus_synchro WHERE utilisateur_id = $1 AND nom_table = 'refus_synchro'`,
        [sessionA.utilisateurId],
      );
      expect((refusDArchivage.rows as readonly { n: string }[])[0]?.n, 'l’archivage n’a pas été refusé par le serveur').toBe('0');

      // 5. La ligne redescend archivée chez B : la carte disparaît, le témoin reste.
      await expect(carte(b.page, refusArchive)).toHaveCount(0, { timeout: DELAI_SYNCHRO_MS });
      await expect(carte(b.page, refusTemoin)).toHaveCount(1);
      // B n'a rien envoyé : l'archivage ne vient que de A, et A ne l'a envoyé qu'une fois.
      await expect(carte(a.page, refusArchive)).toHaveCount(0);
      await expect(carte(a.page, refusTemoin)).toHaveCount(1);
      expect(envoisRefus, 'un seul envoi d’archivage').toHaveLength(1);
      expect(envoisRefusB, 'B n’envoie rien').toHaveLength(0);
      expect(envoisRefus.some((r) => (r.postData() ?? '').includes(refusTemoin)), 'le témoin n’est jamais envoyé').toBe(false);
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });
});
