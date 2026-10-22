/**
 * Règles de synchro ÉVALUÉES par le vrai évaluateur de PowerSync (@powersync/service-sync-rules
 * 0.42.0, celui du service 1.26.1 figé dans docker-compose.yml et la CI), sur le vrai
 * powersync/sync-config.yaml (T61, relecture ; complète fermes-actives-limite.test.ts, qui ne
 * vérifie que la forme du texte).
 *
 * (a) Isolement : un compte ne reçoit que les fermes dont il est membre actif — adhésion d'un
 *     autre compte, état refusé ou nul, adhésion, ferme ou compte supprimés, autre jeton : jamais
 *     la ferme d'autrui.
 * (b) Coût : PowerSync compte chaque ligne renvoyée par les recherches de paramètres d'une
 *     connexion et casse au-delà de 1000 (PSYNC_S2305). Ce coût ne dépend que des adhésions du
 *     compte, jamais du nombre de fermes ni de comptes de l'instance ; 14 fermes tiennent sous
 *     1000 ; ajouter un flux fait monter le coût, et ce test échoue avant que la synchro ne casse.
 *
 * Banc : les lignes (ferme, utilisateur, membre) sont passées à `evaluateParameterRow` pour
 * construire l'index de recherche, puis `queryDynamicBucketDescriptions` interroge cet index en
 * comptant les lignes rendues, comme le service. Variable PLANIF_REGLES_SYNCHRO : autre fichier
 * de règles (pour éprouver une ancienne règle) ; défaut, celui du dépôt.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_HYDRATION_STATE, RequestParameters, SqlSyncRules } from '@powersync/service-sync-rules';
import { describe, expect, it } from 'vitest';

const CHEMIN = process.env.PLANIF_REGLES_SYNCHRO ?? new URL('../../../powersync/sync-config.yaml', import.meta.url).pathname;
const YAML = readFileSync(CHEMIN, 'utf8');
const PLAFOND = 1000;

type Ligne = Readonly<Record<string, string | null>>;
interface Adhesion {
  readonly utilisateur: string;
  readonly ferme: string;
  readonly etat?: string | null;
  readonly supprimee?: boolean;
}
interface Instance {
  readonly fermes: readonly { id: string; supprimee?: boolean }[];
  readonly comptes: readonly { id: string; supprime?: boolean }[];
  readonly adhesions: readonly Adhesion[];
}

const table = (name: string) => ({ connectionTag: 'default', schema: 'public', name });

async function evaluer(yaml: string, instance: Instance, jeton: string): Promise<{ fermes: string[]; resultats: number }> {
  const regles = SqlSyncRules.fromYaml(yaml, { defaultSchema: 'public', throwOnError: true });
  const h = regles.config.hydrate({ hydrationState: DEFAULT_HYDRATION_STATE, sqlite: null });
  const index = new Map<string, unknown[]>();
  const ajouter = (nom: string, ligne: Ligne): void => {
    for (const p of h.evaluateParameterRow(table(nom), ligne)) {
      const cle = p.lookup.serializedRepresentation;
      index.set(cle, [...(index.get(cle) ?? []), ...p.bucketParameters]);
    }
  };
  for (const f of instance.fermes) ajouter('ferme', { id: f.id, supprime_le: f.supprimee === true ? '2026-01-01' : null });
  for (const c of instance.comptes) ajouter('utilisateur', { id: c.id, supprime_le: c.supprime === true ? '2026-01-01' : null });
  instance.adhesions.forEach((a, i) => {
    ajouter('membre', { id: `m${String(i)}`, utilisateur_id: a.utilisateur, ferme_id: a.ferme, etat: a.etat === undefined ? 'accepte' : a.etat, supprime_le: a.supprimee === true ? '2026-01-01' : null });
  });
  const requete = new RequestParameters({ userIdJson: jeton, parsedPayload: { sub: jeton } }, {});
  const { querier, errors } = h.getBucketParameterQuerier({ globalParameters: requete, hasDefaultStreams: true, streams: {} });
  expect(errors).toEqual([]);
  let resultats = 0;
  const buckets = await querier.queryDynamicBucketDescriptions({
    getParameterSets: (recherches: readonly { serializedRepresentation: string }[]) =>
      Promise.resolve(
        recherches.map((r) => {
          const rows = index.get(r.serializedRepresentation) ?? [];
          resultats += rows.length;
          return { lookup: r, rows };
        }),
      ),
  } as never);
  const fermes = new Set<string>();
  for (const b of buckets) for (const m of b.bucket.matchAll(/"(f[A-Za-z0-9]+)"/g)) fermes.add(m[1] ?? '');
  return { fermes: [...fermes].sort(), resultats };
}

const instanceDeBase = (surcharge: Partial<Instance> = {}): Instance => ({
  fermes: [{ id: 'fA' }, { id: 'fB' }],
  comptes: [{ id: 'u0' }, { id: 'u1' }],
  adhesions: [
    { utilisateur: 'u0', ferme: 'fA' },
    { utilisateur: 'u1', ferme: 'fB' },
  ],
  ...surcharge,
});

describe('règles évaluées : un compte ne reçoit que ses fermes', () => {
  it('membre actif : sa ferme, et seulement elle', async () => {
    expect((await evaluer(YAML, instanceDeBase(), 'u0')).fermes).toEqual(['fA']);
  });

  it('un autre jeton reçoit l’autre ferme, jamais la première', async () => {
    expect((await evaluer(YAML, instanceDeBase(), 'u1')).fermes).toEqual(['fB']);
  });

  it('un compte sans adhésion, ou inconnu, ne reçoit rien', async () => {
    expect((await evaluer(YAML, instanceDeBase({ adhesions: [{ utilisateur: 'u1', ferme: 'fB' }] }), 'u0')).fermes).toEqual([]);
    expect((await evaluer(YAML, instanceDeBase(), 'u-inconnu')).fermes).toEqual([]);
  });

  it('l’adhésion d’un autre compte à ma ferme ne me la donne pas', async () => {
    const i = instanceDeBase({ adhesions: [{ utilisateur: 'u1', ferme: 'fA' }, { utilisateur: 'u1', ferme: 'fB' }] });
    expect((await evaluer(YAML, i, 'u0')).fermes).toEqual([]);
    expect((await evaluer(YAML, i, 'u1')).fermes).toEqual(['fA', 'fB']);
  });

  it.each([
    ['invité (pas accepté)', 'invite'],
    ['refusé', 'refuse'],
    ['état nul', null],
  ])('adhésion %s : aucune ferme', async (_cas, etat) => {
    const i = instanceDeBase({ adhesions: [{ utilisateur: 'u0', ferme: 'fA', etat }, { utilisateur: 'u1', ferme: 'fB' }] });
    expect((await evaluer(YAML, i, 'u0')).fermes).toEqual([]);
  });

  it('adhésion supprimée : aucune ferme', async () => {
    const i = instanceDeBase({ adhesions: [{ utilisateur: 'u0', ferme: 'fA', supprimee: true }, { utilisateur: 'u1', ferme: 'fB' }] });
    expect((await evaluer(YAML, i, 'u0')).fermes).toEqual([]);
  });

  it('ferme supprimée : aucune ferme (l’autre compte garde la sienne)', async () => {
    const i = instanceDeBase({ fermes: [{ id: 'fA', supprimee: true }, { id: 'fB' }] });
    expect((await evaluer(YAML, i, 'u0')).fermes).toEqual([]);
    expect((await evaluer(YAML, i, 'u1')).fermes).toEqual(['fB']);
  });

  it('compte supprimé : aucune ferme', async () => {
    const i = instanceDeBase({ comptes: [{ id: 'u0', supprime: true }, { id: 'u1' }] });
    expect((await evaluer(YAML, i, 'u0')).fermes).toEqual([]);
    expect((await evaluer(YAML, i, 'u1')).fermes).toEqual(['fB']);
  });

  it('plusieurs fermes dont une seule supprimée : les autres descendent', async () => {
    const i = instanceDeBase({
      fermes: [{ id: 'fA' }, { id: 'fB' }, { id: 'fC', supprimee: true }],
      adhesions: [{ utilisateur: 'u0', ferme: 'fA' }, { utilisateur: 'u0', ferme: 'fB' }, { utilisateur: 'u0', ferme: 'fC' }],
    });
    expect((await evaluer(YAML, i, 'u0')).fermes).toEqual(['fA', 'fB']);
  });
});

/** Une instance de `fermesTotales` fermes et `comptesTotaux` comptes dont u0 est membre actif de ses `siennes` premières fermes. */
function grandeInstance(fermesTotales: number, comptesTotaux: number, siennes: number): Instance {
  const fermes = Array.from({ length: fermesTotales }, (_, i) => ({ id: `f${String(i)}` }));
  const comptes = Array.from({ length: comptesTotaux }, (_, i) => ({ id: `u${String(i)}` }));
  // Les autres comptes sont membres des autres fermes (chacun d'une, en rond).
  const adhesions: Adhesion[] = [
    ...Array.from({ length: siennes }, (_, i) => ({ utilisateur: 'u0', ferme: `f${String(i)}` })),
    ...Array.from({ length: Math.max(0, fermesTotales - siennes) }, (_, i) => ({ utilisateur: `u${String(1 + (i % Math.max(1, comptesTotaux - 1)))}`, ferme: `f${String(siennes + i)}` })),
  ];
  return { fermes, comptes, adhesions };
}

describe('règles évaluées : le coût en résultats de paramètres ne dépend que du compte', () => {
  it.each([1, 14])('%i ferme(s) au compte : le même coût que l’instance ait 50 ou 500 fermes et comptes', async (siennes) => {
    const petite = await evaluer(YAML, grandeInstance(Math.max(50, siennes), 50, siennes), 'u0');
    const grande = await evaluer(YAML, grandeInstance(500, 500, siennes), 'u0');
    expect(petite.fermes).toHaveLength(siennes);
    expect(grande.fermes).toHaveLength(siennes);
    expect(grande.resultats, 'coût indépendant de la taille de l’instance').toBe(petite.resultats);
  });

  it('14 fermes, instance de 500 fermes et 500 comptes : sous le plafond de 1000', async () => {
    const r = await evaluer(YAML, grandeInstance(500, 500, 14), 'u0');
    expect(r.resultats).toBeLessThan(PLAFOND);
  });

  it('le coût croît avec les fermes du compte, pas plus vite que linéairement', async () => {
    const un = await evaluer(YAML, grandeInstance(500, 500, 1), 'u0');
    const quatorze = await evaluer(YAML, grandeInstance(500, 500, 14), 'u0');
    expect(quatorze.resultats).toBeGreaterThan(un.resultats);
    expect(quatorze.resultats).toBeLessThanOrEqual(14 * un.resultats);
  });

  it('garde-fou du plafond : 14 fermes sous 1000 résultats avec les flux actuels (un flux de plus qui ferait dépasser 1000 fait échouer ce test)', async () => {
    const actuel = await evaluer(YAML, grandeInstance(500, 500, 14), 'u0');
    const flux = (YAML.match(/^ {2}[a-z_0-9]+:\n {4}(?:auto_subscribe|query)/gm) ?? []).length;
    expect(flux, 'des flux sont lus').toBeGreaterThan(10);
    expect(actuel.resultats, `14 fermes : ${String(actuel.resultats)} résultats pour ${String(flux)} flux (plafond ${String(PLAFOND)})`).toBeLessThan(PLAFOND);
  });

  it('un flux ajouté pour de vrai est compté : le banc voit bien monter le coût', async () => {
    const supplementaire = `${YAML.trimEnd()}\n  flux_de_garde:\n    auto_subscribe: true\n    query: SELECT * FROM zone WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)\n`;
    const avant = await evaluer(YAML, grandeInstance(50, 50, 14), 'u0');
    const apres = await evaluer(supplementaire, grandeInstance(50, 50, 14), 'u0');
    expect(apres.resultats).toBeGreaterThan(avant.resultats);
  });
});
