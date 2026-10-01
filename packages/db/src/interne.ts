/**
 * État dérivé tenu par la base seule (T10h), dans le schéma `interne` : jamais écrit par l'API ni
 * par un téléphone, jamais publié vers PowerSync (la publication `powersync` est une liste
 * explicite de tables du schéma public), jamais sur un téléphone. Hors du point d'entrée de
 * @planif/db (dont @planif/sync dérive le schéma local), comme `securite.ts`. Migrations :
 * drizzle.config.ts lit aussi ce fichier.
 */
import { boolean, foreignKey, index, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';
import { evenement } from './schema.ts';

export const interne = pgSchema('interne');

/**
 * Une ligne par chaîne d'événements (l'origine, ses corrections, les corrections de ses
 * corrections, et toutes leurs annulations), tenue à chaque insertion dans `evenement` par le
 * déclencheur `evenement_chaine` (migration 0020), sous le verrou de la ligne : c'est la règle
 * « en vigueur » de T10g (décision 4) déjà calculée, que la vue `evenements_en_vigueur` lit par
 * ferme ou par id sans parcourir la chaîne.
 *   - `annulee` : la chaîne contient une annulation (de l'origine ou de n'importe quelle
 *     correction) ;
 *   - `en_vigueur_id` : la correction la plus récente de toute la chaîne (horodatage du
 *     téléphone, puis id le plus grand), à défaut l'origine.
 */
export const chaineEvenement = interne.table(
  'chaine_evenement',
  {
    origineId: uuid('origine_id').primaryKey(),
    fermeId: uuid('ferme_id').notNull(),
    enVigueurId: uuid('en_vigueur_id').notNull(),
    /** Horodatage de `en_vigueur_id` (l'ordre de la règle : horodatage, puis id). */
    enVigueurHorodatage: timestamp('en_vigueur_horodatage', { withTimezone: true, mode: 'date' }).notNull(),
    annulee: boolean('annulee').notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: 'chaine_evenement_origine_fk',
      columns: [t.fermeId, t.origineId],
      foreignColumns: [evenement.fermeId, evenement.id],
    }),
    foreignKey({
      name: 'chaine_evenement_en_vigueur_fk',
      columns: [t.fermeId, t.enVigueurId],
      foreignColumns: [evenement.fermeId, evenement.id],
    }),
    index('chaine_evenement_ferme_idx').on(t.fermeId),
    index('chaine_evenement_en_vigueur_idx').on(t.enVigueurId),
  ],
);
