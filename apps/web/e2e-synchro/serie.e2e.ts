/**
 * T10e — une série passe par la synchro : le téléphone A, hors ligne, crée une série de batavias
 * sur deux planches, la décale d'une semaine, puis annule ce décalage. Au retour du réseau, le
 * téléphone B reçoit la série dans son état final (celui de départ), avec ses deux occupations et
 * la décision de rotation, et l'historique du serveur compte 9 lignes : pour la série et pour
 * chaque occupation, une création et deux modifications. Lancement, services et règle de saut :
 * comme synchro.e2e.ts et stock.e2e.ts (`pnpm e2e:synchro`, banc paramétrable de T10c).
 * Exemple : E2E_PROJET_COMPOSE=planif-t10e E2E_PORT_PAGE=4278 E2E_PORT_POSTGRES=56932
 *           E2E_PORT_POWERSYNC=59580 E2E_PORT_API=3700 pnpm e2e:synchro
 *
 * ── Amorçage attendu (apps/api/src/sync/test/amorcer-e2e.ts) ────────────────────────────────
 *
 *   node apps/api/src/sync/test/amorcer-e2e.ts --plan-serie
 *
 * Avec l'argument `--plan-serie`, en plus de la ferme et des deux sessions, la ferme reçoit :
 * une famille « Astéracées » DE LA FERME (délai de retour minimal 2 ans, conseillé 3), une espèce
 * « Laitue » de cette famille, une variété « Batavia blonde », un itinéraire « Batavia de
 * printemps » (mode plant_maison, parametres = l'instantané de la batavia de T02 : pépinière
 * 28 j, avant récolte 49 j, fenêtre 14 j, densité à l'écartement), une saison « 2027 »
 * (2027-01-01 → 2027-12-31), une zone et deux planches de 30 m (sorte 'planche'), et AUCUNE
 * série. La sortie JSON gagne :
 *
 *   "planSerie": { "saisonId", "itineraireId", "especeId", "familleId", "delaiMinimalAns": 2,
 *                  "planches": ["<emplacement.id>", "<emplacement.id>"] }
 *
 * Sans l'argument, la sortie ne change pas ; `--serie-tomates` (T10c) continue de marcher.
 *
 * ── Page de diagnostic attendue (apps/web/diagnostic/synchro.html, src/diagnostic/) ─────────
 *
 * `/diagnostic/synchro.html?ferme=<id>&plan=<itineraireId>&saison=<saisonId>&planches=<id>,<id>` :
 * la page de T10, plus une section « Série de batavias » (paramètres absents ou pas des UUID →
 * section inerte). Comme le reste de la page, tout passe par la porte de @planif/sync (jamais
 * PowerSync directement), sans dépendre de l'écran de T12. « UNE transaction de la porte » = un
 * appel à `porte.ecrireEnsemble([...])` (donc un seul envoi, accepté ou refusé en entier). Les
 * dates viennent du cœur : `calculerDatesSerie` de @planif/core (T02), jamais recalculées à la main.
 *
 *   champ « Début de récolte de la série » (getByLabel, 'AAAA-MM-JJ') + bouton « Créer la série » :
 *       en UNE transaction de la porte :
 *       - INSERT serie : id neuf, ferme, saison_id = `saison`, itineraire_id = `plan`, espece_id et
 *         variete_id de l'itinéraire local, parametres = itineraire.parametres (texte JSON tel
 *         quel), ancre_type 'debut_recolte', ancre_date = le champ, prevu_* = calculerDatesSerie
 *         (prevu_semis_pepiniere NULL si l'étape est sans objet), longueur_m = somme des longueurs
 *         des planches, nombre_plants NULL, statut 'prevue', rotation_acceptee = texte JSON
 *         { "famille": famille_id de l'espèce, "delai_ans": delai_retour_minimal_ans de la
 *         famille, "le": new Date().toISOString() } (comme une alerte rouge acceptée dans T12) ;
 *       - un INSERT occupation par planche de `planches` : ferme, emplacement_id, serie_id,
 *         longueur_m = longueur de la planche, prevu_du = mise en place, prevu_au = fin de récolte,
 *         plantation_id, evenement_id, nombre_places, position_m, reel_du, reel_au NULL.
 *   bouton « Décaler la série d’une semaine » (apostrophe typographique) : pour la dernière série
 *       créée par la section, en UNE transaction de la porte, UPDATE serie (ancre_date + 7 jours
 *       et les quatre prevu_* recalculés par calculerDatesSerie) et UPDATE de chaque occupation
 *       non supprimée de la série (prevu_du, prevu_au). Les valeurs d'avant sont gardées en mémoire (comme le bandeau
 *       « Annuler » de T12, qui marche hors ligne).
 *   bouton « Annuler la dernière modification de la série » : en UNE transaction de la porte,
 *       UPDATE de la série et de ses occupations qui rétablit les valeurs gardées en mémoire.
 *   [data-testid="serie"] : un par ligne locale de `serie` de la ferme dont itineraire_id = `plan`,
 *       avec data-id, data-ancre-date, data-prevu-semis (chaîne vide si NULL),
 *       data-prevu-mise-en-place, data-prevu-debut-recolte, data-prevu-fin-recolte,
 *       data-supprimee ('oui' | 'non'), data-rotation-acceptee (texte de la colonne tel que la
 *       base locale le rend, chaîne vide si NULL).
 *   [data-testid="occupation"] : un par ligne locale de `occupation` d'une de ces séries, avec
 *       data-id, data-serie, data-emplacement, data-longueur (String(longueur_m) : '30'),
 *       data-prevu-du, data-prevu-au, data-supprimee ('oui' | 'non').
 *   [data-testid="historique"] : un par ligne locale de `modification` (redescendue du serveur)
 *       dont ligne_id est l'une de ces séries ou de leurs occupations, avec data-table
 *       (nom_table : 'Serie', 'Occupation'), data-ligne (ligne_id), data-operation.
 *   [data-testid="en-attente"], [data-testid="refus"] : ceux de T10 et T10c.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';

/** Délai maximal pour qu'une écriture d'un téléphone apparaisse sur l'autre, réseau revenu. */
const DELAI_SYNCHRO_MS = 20_000;
/** Temps pendant lequel on vérifie que rien ne passe tant que le premier téléphone est hors ligne. */
const PAUSE_HORS_LIGNE_MS = 3_000;
/** Délai d'un affichage local (base du téléphone, sans réseau). */
const DELAI_LOCAL_MS = 3_000;

const SERVICES = (process.env.API_URL ?? '') !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
const EN_CI = Boolean(process.env.CI);

const SCRIPT_AMORCAGE = fileURLToPath(new URL('../../api/src/sync/test/amorcer-e2e.ts', import.meta.url));

/** Batavia de T02, récolte à partir de la S22 2027, puis décalée d'une semaine (S23). */
const S22 = { ancre: '2027-05-31', semis: '2027-03-15', miseEnPlace: '2027-04-12', debutRecolte: '2027-05-31', finRecolte: '2027-06-14' } as const;
const S23 = { ancre: '2027-06-07', semis: '2027-03-22', miseEnPlace: '2027-04-19', debutRecolte: '2027-06-07', finRecolte: '2027-06-21' } as const;

interface PlanSerie {
  readonly saisonId: string;
  readonly itineraireId: string;
  readonly especeId: string;
  readonly familleId: string;
  readonly delaiMinimalAns: number;
  readonly planches: readonly [string, string];
}

interface Amorcage {
  readonly fermeId: string;
  readonly sessions: readonly [SessionConnexion, SessionConnexion];
  readonly planSerie?: PlanSerie;
}

interface Telephone {
  readonly contexte: BrowserContext;
  readonly page: Page;
}

if (!SERVICES && !EN_CI) {
  console.warn('[T10e] API_URL ou POWERSYNC_URL absente : test de bout en bout des séries sauté.');
}

test.describe('T10e : une série passe par la synchro', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let amorcage: Amorcage;
  let plan: PlanSerie;

  test.beforeAll(() => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE, '--plan-serie'], { encoding: 'utf8', env: process.env });
    amorcage = JSON.parse(sortie) as Amorcage;
    if (amorcage.planSerie === undefined) {
      throw new Error(`amorçage : « planSerie » absent de la sortie de amorcer-e2e.ts --plan-serie (clés : ${Object.keys(amorcage).join(', ')})`);
    }
    plan = amorcage.planSerie;
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
    const parametres = new URLSearchParams({
      ferme: amorcage.fermeId,
      plan: plan.itineraireId,
      saison: plan.saisonId,
      planches: plan.planches.join(','),
    });
    await page.goto(`/diagnostic/synchro.html?${parametres.toString()}`);
    await expect(page.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'synchronise', { timeout: DELAI_SYNCHRO_MS });
    return { contexte, page };
  }

  const series = (page: Page) => page.getByTestId('serie');
  const occupations = (page: Page) => page.getByTestId('occupation');
  const historique = (page: Page) => page.getByTestId('historique');
  const occupationSur = (page: Page, planche: string) => page.locator(`[data-testid="occupation"][data-emplacement="${planche}"]`);

  /** La série affichée a les dates de `d`, et chaque occupation les suit (de la plantation à la fin de récolte). */
  async function attendreDates(page: Page, d: typeof S22 | typeof S23, delai: number): Promise<void> {
    const s = series(page);
    await expect(s).toHaveAttribute('data-ancre-date', d.ancre, { timeout: delai });
    await expect(s).toHaveAttribute('data-prevu-semis', d.semis);
    await expect(s).toHaveAttribute('data-prevu-mise-en-place', d.miseEnPlace);
    await expect(s).toHaveAttribute('data-prevu-debut-recolte', d.debutRecolte);
    await expect(s).toHaveAttribute('data-prevu-fin-recolte', d.finRecolte);
    for (const planche of plan.planches) {
      await expect(occupationSur(page, planche)).toHaveAttribute('data-prevu-du', d.miseEnPlace, { timeout: delai });
      await expect(occupationSur(page, planche)).toHaveAttribute('data-prevu-au', d.finRecolte);
    }
  }

  test('A hors ligne crée une série sur deux planches, la décale puis annule ; au retour du réseau, B reçoit l’état final et l’historique compte 9 lignes', async ({
    browser,
  }) => {
    const a = await ouvrir(browser, amorcage.sessions[0]);
    const b = await ouvrir(browser, amorcage.sessions[1]);
    try {
      // Au départ : ni série, ni occupation, ni historique.
      for (const t of [a, b]) {
        await expect(series(t.page)).toHaveCount(0);
        await expect(occupations(t.page)).toHaveCount(0);
        await expect(historique(t.page)).toHaveCount(0);
      }

      await a.contexte.setOffline(true);

      // Création, hors ligne : la série et ses deux occupations dans UNE transaction.
      await a.page.getByLabel('Début de récolte de la série').fill(S22.ancre);
      await a.page.getByRole('button', { name: 'Créer la série' }).click();
      await expect(series(a.page)).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      const serieId = (await series(a.page).getAttribute('data-id')) ?? '';
      expect(serieId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(occupations(a.page)).toHaveCount(2, { timeout: DELAI_LOCAL_MS });
      for (const planche of plan.planches) {
        await expect(occupationSur(a.page, planche)).toHaveCount(1);
        await expect(occupationSur(a.page, planche)).toHaveAttribute('data-serie', serieId);
        await expect(occupationSur(a.page, planche)).toHaveAttribute('data-longueur', '30');
      }
      await attendreDates(a.page, S22, DELAI_LOCAL_MS);
      await expect(a.page.getByTestId('en-attente'), 'une création = une transaction').toHaveAttribute('data-nombre', '1', {
        timeout: DELAI_LOCAL_MS,
      });
      const occupationIds = await occupations(a.page).evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));

      // Décalage d'une semaine, toujours hors ligne : dates recalculées, occupations comprises.
      await a.page.getByRole('button', { name: 'Décaler la série d’une semaine' }).click();
      await attendreDates(a.page, S23, DELAI_LOCAL_MS);
      await expect(a.page.getByTestId('en-attente')).toHaveAttribute('data-nombre', '2', { timeout: DELAI_LOCAL_MS });

      // Annulation du décalage, toujours hors ligne : retour aux dates de départ.
      await a.page.getByRole('button', { name: 'Annuler la dernière modification de la série' }).click();
      await attendreDates(a.page, S22, DELAI_LOCAL_MS);
      await expect(a.page.getByTestId('en-attente')).toHaveAttribute('data-nombre', '3', { timeout: DELAI_LOCAL_MS });

      // Rien ne part tant que A est hors ligne.
      await b.page.waitForTimeout(PAUSE_HORS_LIGNE_MS);
      await expect(series(b.page)).toHaveCount(0);
      await expect(occupations(b.page)).toHaveCount(0);

      await a.contexte.setOffline(false);

      // B reçoit la série dans son état final, ses deux occupations et la décision de rotation.
      await expect(series(b.page)).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      await expect(series(b.page)).toHaveAttribute('data-id', serieId);
      await expect(occupations(b.page)).toHaveCount(2, { timeout: DELAI_SYNCHRO_MS });
      await attendreDates(b.page, S22, DELAI_SYNCHRO_MS);
      await expect(series(b.page)).toHaveAttribute('data-supprimee', 'non');
      for (const planche of plan.planches) await expect(occupationSur(b.page, planche)).toHaveAttribute('data-supprimee', 'non');
      const rotation = (await series(b.page).getAttribute('data-rotation-acceptee')) ?? '';
      expect(JSON.parse(rotation)).toMatchObject({ famille: plan.familleId, delai_ans: plan.delaiMinimalAns });

      // L'historique du serveur, redescendu : 3 lignes par ligne touchée (création, deux modifications).
      await expect(historique(b.page)).toHaveCount(9, { timeout: DELAI_SYNCHRO_MS });
      for (const ligne of [serieId, ...occupationIds]) {
        const lignes = b.page.locator(`[data-testid="historique"][data-ligne="${ligne}"]`);
        await expect(lignes).toHaveCount(3);
        const operations = await lignes.evaluateAll((els) => els.map((e) => e.getAttribute('data-operation') ?? '').sort());
        expect(operations).toEqual(['creation', 'modification', 'modification']);
      }
      await expect(b.page.locator(`[data-testid="historique"][data-table="Serie"]`)).toHaveCount(3);
      await expect(b.page.locator(`[data-testid="historique"][data-table="Occupation"]`)).toHaveCount(6);

      // Chez A : tout est parti, rien n'a été refusé, l'historique est redescendu aussi.
      await expect(a.page.getByTestId('en-attente')).toHaveAttribute('data-nombre', '0', { timeout: DELAI_SYNCHRO_MS });
      await expect(a.page.getByTestId('refus')).toHaveCount(0);
      await expect(historique(a.page)).toHaveCount(9, { timeout: DELAI_SYNCHRO_MS });
      await attendreDates(a.page, S22, DELAI_LOCAL_MS);
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });
});
