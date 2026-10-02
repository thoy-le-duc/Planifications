import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/dist-synchro/**', '**/dist-essais/**', '**/dist-demo/**', '**/dev-dist/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.node,
    },
    rules: {
      // Principe 7 : pas de `any`, sous aucune forme.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // T10 : les écrans passent par @planif/sync, jamais par PowerSync directement. Seuls la couche
    // de données (connecteur, ouverture de la base) et les pages de mesure de T07 y touchent.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/donnees/**', 'apps/web/src/mesures/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@powersync/*'], message: 'Passer par @planif/sync (porte) ou src/donnees, jamais par PowerSync.' }] },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
