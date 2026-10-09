/**
 * Tests d'acceptation T36 — la configuration Vite range `packages/core/src/croissance/` dans un
 * morceau à lui (docs/backlog/T36-allegement-vue-3d.md), pour que la vue 3D ne charge plus tout le
 * morceau commun du cœur pour deux fonctions.
 *
 * `morceauManuel` n'est pas exportée de vite.config.ts : on la teste par la configuration
 * (`build.rollupOptions.output.manualChunks`), sans lancer de build. Fonction pure, id -> nom.
 */
import { fileURLToPath } from 'node:url';
import type { ConfigEnv, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import configuration from '../vite.config.ts';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const dansCoeur = (chemin: string): string => `${RACINE}packages/core/src/${chemin}`;

async function morceauManuel(): Promise<(id: string) => string | undefined> {
  const env: ConfigEnv = { command: 'build', mode: 'production' };
  const config: UserConfig = await (configuration as (env: ConfigEnv) => UserConfig | Promise<UserConfig>)(env);
  // `manualChunks` est l'option que vite.config.ts utilise (marquée dépréciée par Vite 8, mais seule en service ici).
  /* eslint-disable @typescript-eslint/no-deprecated */
  const sortie = config.build?.rollupOptions?.output;
  const manuel = Array.isArray(sortie) ? sortie[0]?.manualChunks : sortie?.manualChunks;
  /* eslint-enable @typescript-eslint/no-deprecated */
  if (typeof manuel !== 'function') throw new Error('manualChunks doit rester une fonction pure (id) -> nom de morceau');
  return (id) => (manuel as (id: string, meta: never) => string | undefined)(id, undefined as never);
}

describe('T36 : morceaux manuels de vite.config.ts', () => {
  it('le moteur de croissance (packages/core/src/croissance/) a son propre morceau, nommé', async () => {
    const m = await morceauManuel();
    const noms = ['index.ts', 'calcul.ts', 'profil.ts', 'defauts.ts', 'types.ts'].map((f) => m(dansCoeur(`croissance/${f}`)));
    expect(noms[0]).toBeTypeOf('string');
    expect(new Set(noms).size, 'tous les fichiers de croissance dans le même morceau').toBe(1);
  });

  it('ce morceau n’est ni celui des identifiants, ni celui du reste du cœur', async () => {
    const m = await morceauManuel();
    const croissance = m(dansCoeur('croissance/calcul.ts'));
    expect(croissance).not.toBe(m(dansCoeur('domaine/identifiants.ts')));
    for (const autre of ['placement/index.ts', 'dates/index.ts', 'planification/index.ts', 'index.ts']) {
      expect(m(dansCoeur(autre)), autre).not.toBe(croissance);
    }
  });

  it('les tests de croissance (même dossier) ne sont pas concernés : aucun effet sur le placement ni les identifiants', async () => {
    const m = await morceauManuel();
    expect(m(dansCoeur('placement/index.ts'))).toBeUndefined();
    expect(m(dansCoeur('domaine/identifiants.ts'))).toBe('identifiants');
  });
});
