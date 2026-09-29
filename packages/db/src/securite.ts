/**
 * Données du serveur seul (T09b), dans le schéma `securite` : jamais publiées vers PowerSync (la
 * publication `powersync` est une liste explicite de tables, qui n'en contient aucune de ce
 * schéma), jamais sur un téléphone. Hors du point d'entrée de @planif/db
 * (qui décrit le modèle et les comptes, et dont @planif/sync dérive le schéma local) :
 * `import { demandeIp } from '@planif/db/securite'`. Migrations : drizzle.config.ts lit aussi
 * ce fichier.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const securite = pgSchema('securite');

/** Actions limitées par adresse IP. */
export const ACTIONS_LIMITEES_IP = ['code', 'verifier'] as const;

/**
 * Demande reçue d'une adresse IP sur /auth/code ou /auth/verifier (limite par IP, fenêtre
 * glissante d'une heure). Donnée personnelle : l'API efface les lignes de plus de 24 heures à
 * chaque insertion.
 */
export const demandeIp = securite.table(
  'demande_ip',
  {
    id: uuid('id').primaryKey(),
    ip: text('ip').notNull(),
    action: text('action', { enum: ACTIONS_LIMITEES_IP }).notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('demande_ip_action', sql`${t.action} IN ('code', 'verifier')`),
    index('demande_ip_action_ip_cree_idx').on(t.action, t.ip, t.creeLe),
    index('demande_ip_cree_idx').on(t.creeLe),
  ],
);
