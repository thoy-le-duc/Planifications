import { defineConfig } from 'vitest/config';

// L'évaluateur de règles de PowerSync (@powersync/service-sync-rules, utilisé par
// src/fermes-actives-evaluees.test.ts) emploie `using` : Node 22 le demande par ce drapeau.
export default defineConfig({
  test: {
    execArgv: ['--js-explicit-resource-management'],
  },
});
