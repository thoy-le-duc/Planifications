/**
 * Règle `fermes_actives` de powersync/sync-config.yaml : la forme qui tient la limite de PowerSync
 * sur les résultats de requêtes de paramètres (1000 par connexion, erreur PSYNC_S2305).
 *
 * PowerSync compte, à chaque flux, chaque ligne renvoyée par ses recherches de paramètres. Écrite
 * en jointures (membre ⋈ ferme ⋈ utilisateur), la règle lui faisait chercher toutes les fermes et
 * tous les utilisateurs non supprimés de l'instance, à chaque flux (plan compilé par
 * @powersync/service-sync-rules 0.42, celui du service 1.26.1) : la synchro cassait pour tout le
 * monde dès une trentaine de fermes et de comptes au total. En sous-requêtes imbriquées, il
 * cherche le compte par id, ses adhésions par utilisateur, puis ces fermes seules par id.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
const avec = /^with:\n {2}fermes_actives: >-\n((?: {4}[^\n]*\n)+)/m.exec(regles)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';

describe('fermes_actives : recherches de paramètres bornées par l’utilisateur', () => {
  it('la règle est lue', () => {
    expect(avec).not.toBe('');
  });

  it('aucune jointure : chaque table est cherchée par une clé venue du compte connecté', () => {
    expect(avec).not.toMatch(/\bJOIN\b/i);
  });

  it('fermes cherchées par id parmi les adhésions du compte, compte cherché par son id', () => {
    expect(avec).toMatch(/^SELECT f\.id AS ferme_id FROM ferme f WHERE f\.supprime_le IS NULL AND f\.id IN \( SELECT m\.ferme_id FROM membre m WHERE m\.utilisateur_id = auth\.user_id\(\)/);
    expect(avec).toContain('m.utilisateur_id IN ( SELECT u.id FROM utilisateur u WHERE u.id = auth.user_id() AND u.supprime_le IS NULL)');
  });
});
