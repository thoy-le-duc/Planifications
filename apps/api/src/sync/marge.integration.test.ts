/**
 * T10f, relecture (décision du chef) — marge entre la porte du téléphone et le serveur.
 *
 * La porte mesure les ORDRES SQL (`JSON.stringify(ordres)`, au plus 5 Mio) ; le serveur mesure le
 * CORPS envoyé par le connecteur (`{ ecritures: [{ op, table, id, donnees }] }`), qui peut être
 * plus gros : PowerSync range dans `donnees` les colonnes de la ligne, même celles que l'ordre ne
 * cite pas. Cas du relecteur : 500 × `INSERT INTO serie (id) VALUES (?)`, remplis pour que la
 * porte mesure presque 5 Mio ; le corps dépasse alors 5 Mio. La limite souple du serveur
 * (TAILLE_MAX_CORPS, refus 'lot_trop_gros', saisie perdue) passe donc à 6 Mio ; la limite dure
 * (TAILLE_MAX_CORPS_DURE, 413) reste à 8 Mio.
 *
 * Le corps est produit par `envoyerEcritures` de @planif/sync, la fonction du connecteur, depuis
 * une transaction CRUD telle que PowerSync la donnerait, dans l'hypothèse la plus lourde : chaque
 * PUT porte TOUTES les colonnes de la table du schéma local (null pour celles que l'ordre ne cite
 * pas). Le `fetch` du connecteur est branché sur l'API (app.request), contre un vrai Postgres.
 * Les écritures elles-mêmes sont invalides (identifiants remplis) : seul compte qu'aucune n'est
 * refusée pour 'lot_trop_gros'.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';
import * as upload from './upload.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-01T06:00:00Z');
const MIO = 1_048_576;

/** Ce que le test utilise de @planif/sync (chargé par chemin : l'API n'en dépend pas). */
interface Ordre {
  readonly sql: string;
  readonly parametres?: readonly unknown[];
}
interface EcritureCrud {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly opData?: Record<string, unknown>;
}
interface FileEcritures {
  getNextCrudTransaction(): Promise<{ crud: readonly EcritureCrud[]; complete(): Promise<void> } | null>;
}
interface ModuleSync {
  readonly SCHEMA_LOCAL: { readonly tables: readonly { readonly name: string; readonly columns: readonly { readonly name: string }[] }[] };
  readonly TAILLE_MAX_PAR_LOT: number;
  creerPorte(base: unknown, options: { utilisateurId: string; fermeId: string }): { ecrireEnsemble(ordres: readonly Ordre[]): Promise<void> };
  envoyerEcritures(
    file: FileEcritures,
    options: { urlApi: string; fetch: typeof fetch; jetonAcces: () => Promise<string>; invaliderJeton: () => void },
  ): Promise<void>;
}
interface ModuleBaseMemoire {
  creerBaseMemoire(schema: ModuleSync['SCHEMA_LOCAL']): { fermer(): void };
}

const CHEMIN_SYNC = new URL('../../../../packages/sync/src/index.ts', import.meta.url).href;
const CHEMIN_BASE_MEMOIRE = new URL('../../../../packages/sync/src/test/base-memoire.ts', import.meta.url).href;

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };
const octets = (texte: string): number => new TextEncoder().encode(texte).length;

it('limites du serveur : souple (TAILLE_MAX_CORPS) 6 Mio, dure (TAILLE_MAX_CORPS_DURE) 8 Mio', () => {
  expect(upload.TAILLE_MAX_CORPS, 'limite souple, refus lot_trop_gros').toBe(6 * MIO);
  expect(upload.TAILLE_MAX_CORPS_DURE, 'limite dure, 413').toBe(8 * MIO);
});

decrireAvecBase('T10f')('T10f : une transaction acceptée par la porte n’est jamais un lot_trop_gros au serveur', { timeout: 120_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let sync: ModuleSync;
  let baseMemoire: ModuleBaseMemoire;
  let ferme: string;
  let theo: { id: string; jeton: string };

  beforeAll(async () => {
    sync = (await import(/* @vite-ignore */ CHEMIN_SYNC)) as ModuleSync;
    baseMemoire = (await import(/* @vite-ignore */ CHEMIN_BASE_MEMOIRE)) as ModuleBaseMemoire;
    base = await creerBaseJetable('t10f_marge');
    cles = { active: await genererCleSignature('cle-t10f-marge'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant: () => MAINTENANT });
    ferme = await creerFerme(base.pool, 'Jardins de Garonne');
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    theo = { id: u.id, jeton: await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT) };
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  it('500 × INSERT INTO serie (id) VALUES (?), la porte mesure presque 5 Mio : le corps envoyé passe, sans lot_trop_gros', async () => {
    const SQL = 'INSERT INTO serie (id) VALUES (?)';
    const N = 500;
    const prefixe = (i: number) => `0192f0c1-7a6e-7cc3-9b1e-${String(i).padStart(12, '0')}-`;
    const vides: Ordre[] = Array.from({ length: N }, (_, i) => ({ sql: SQL, parametres: [prefixe(i)] }));
    const cible = sync.TAILLE_MAX_PAR_LOT - 1_024;
    const parOrdre = Math.floor((cible - octets(JSON.stringify(vides))) / N);
    const ordres: Ordre[] = Array.from({ length: N }, (_, i) => ({ sql: SQL, parametres: [prefixe(i) + 'x'.repeat(parOrdre)] }));
    const mesure = octets(JSON.stringify(ordres));
    expect(mesure, 'mesure de la porte').toBeLessThanOrEqual(sync.TAILLE_MAX_PAR_LOT);
    expect(mesure, 'presque 5 Mio').toBeGreaterThan(sync.TAILLE_MAX_PAR_LOT - 4_096);

    // La porte accepte cette transaction.
    const locale = baseMemoire.creerBaseMemoire(sync.SCHEMA_LOCAL);
    try {
      await sync.creerPorte(locale, { utilisateurId: theo.id, fermeId: ferme }).ecrireEnsemble(ordres);
    } finally {
      locale.fermer();
    }

    // CRUD de PowerSync, hypothèse lourde : toutes les colonnes de la table, null sauf l'id.
    const colonnes = sync.SCHEMA_LOCAL.tables.find((t) => t.name === 'serie')?.columns.map((c) => c.name) ?? [];
    expect(colonnes.length, 'colonnes de serie dans le schéma local').toBeGreaterThan(5);
    const crud: EcritureCrud[] = ordres.map((o) => ({
      op: 'PUT',
      table: 'serie',
      id: String(o.parametres?.[0]),
      opData: Object.fromEntries(colonnes.map((c) => [c, null])),
    }));
    let terminee = false;
    const file: FileEcritures = {
      getNextCrudTransaction: () =>
        Promise.resolve(
          terminee
            ? null
            : {
                crud,
                complete: () => {
                  terminee = true;
                  return Promise.resolve();
                },
              },
        ),
    };

    const corps: string[] = [];
    const reponses: { statut: number; json: unknown }[] = [];
    const versApi = async (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const requete = new Request(entree, init);
      corps.push(await requete.clone().text());
      const url = new URL(requete.url);
      const res = await app.request(url.pathname, { method: requete.method, headers: requete.headers, body: await requete.text() });
      reponses.push({ statut: res.status, json: (await res.clone().json()) });
      return res;
    };
    await sync.envoyerEcritures(file, { urlApi: 'https://api.planif.test', fetch: versApi, jetonAcces: () => Promise.resolve(theo.jeton), invaliderJeton: () => undefined });

    expect(corps).toHaveLength(1);
    const taille = octets(corps[0] ?? '');
    expect(taille, 'le corps dépasse l’ancienne limite de 5 Mio : le cas est réel').toBeGreaterThan(5 * MIO);
    expect(taille, 'et reste sous la nouvelle limite souple').toBeLessThanOrEqual(6 * MIO);
    expect(reponses[0]?.statut).toBe(200);
    const refus = (reponses[0]?.json as { refus?: { motif: string }[] } | undefined)?.refus ?? [];
    expect(refus.filter((r) => r.motif === 'lot_trop_gros'), 'aucun lot_trop_gros').toEqual([]);
    expect(terminee, 'la transaction quitte la file').toBe(true);
  });
});
