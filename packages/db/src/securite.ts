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

/**
 * Débit de la synchro (T10f, T38a) : derniers envois POST /sync/upload acceptés d'un utilisateur,
 * dans la fenêtre glissante d'une minute. Une ligne par utilisateur, tenue par une seule écriture
 * atomique (`INSERT … ON CONFLICT … DO UPDATE … RETURNING`) : la limite tient d'un processus
 * d'API ou d'une fonction Vercel à l'autre. `instants` garde au plus ENVOIS_MAX_PAR_MINUTE
 * valeurs, toutes dans la fenêtre ; `maj_le` est le dernier envoi accepté. L'API efface au passage
 * les lignes dont la fenêtre est passée. Sans clé étrangère : une ligne vit une minute.
 */
export const debitSynchro = securite.table(
  'debit_synchro',
  {
    utilisateurId: uuid('utilisateur_id').primaryKey(),
    instants: timestamp('instants', { withTimezone: true, mode: 'date' }).array().notNull(),
    majLe: timestamp('maj_le', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('debit_synchro_maj_idx').on(t.majLe)],
);
