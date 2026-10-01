import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @planif/db generer` : génère la migration qui amène la base au schéma.
// Aucune connexion n'est nécessaire pour générer.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', './src/securite.ts', './src/interne.ts'],
  out: './migrations',
  strict: true,
  verbose: true,
});
