/**
 * Tests d'acceptation T10u — refus d'une ferme quittée effacés du téléphone
 * (docs/backlog/T10u-refus-ferme-quittee.md, Q25). Partie « règles de synchro », lue dans le
 * fichier powersync/sync-config.yaml (sans service). La preuve contre le vrai service PowerSync,
 * téléphone hors ligne compris : apps/api/src/sync/refus-ferme-quittee.integration.test.ts.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * C'est la synchro qui efface : un seul flux `refus_synchro`, toujours au seul auteur, qui ne sert
 * plus que les refus d'une ferme dont il est membre actif (`fermes_actives`) ou qui ne visent
 * aucune ferme (ferme_id NULL). Requête attendue, à l'espace près :
 *
 *   SELECT <mêmes colonnes qu'avant, jamais donnees ni *> FROM refus_synchro
 *   WHERE utilisateur_id = auth.user_id()
 *   AND (ferme_id IS NULL OR ferme_id IN (SELECT ferme_id FROM fermes_actives))
 *
 * (forme vérifiée contre powersync-service 1.26.1 par le testeur). À la perte de l'adhésion,
 * PowerSync retire du téléphone les refus de cette ferme, résumé compris, à sa prochaine synchro ;
 * le téléphone n'écrit rien (voir apps/web/src/donnees/refus-ferme-quittee.test.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');

/** Requêtes des flux, sur une ligne ou repliées (`>-`), espaces normalisés. */
const requetes = [...regles.matchAll(/query:[ \t]*(?:>-?[ \t]*\n((?:[ \t]{6,}[^\n]*\n?)+)|(SELECT[^\n]*))/g)].map((r) =>
  (r[1] ?? r[2] ?? '').replace(/\s+/g, ' ').trim(),
);
const fluxRefus = requetes.filter((q) => /\bFROM refus_synchro\b/.test(q));

const COLONNES = [
  'id',
  'utilisateur_id',
  'ferme_id',
  'nom_table',
  'ligne_id',
  'operation',
  'motif',
  'message',
  'cree_le',
  'saisie_type',
  'saisie_culture',
  'saisie_date',
  'saisie_quantite',
  'saisie_unite',
  'archive_le',
];

const FILTRE = 'WHERE utilisateur_id = auth.user_id() AND (ferme_id IS NULL OR ferme_id IN (SELECT ferme_id FROM fermes_actives))';

describe('T10u : le flux refus_synchro ne sert que les refus des fermes dont l’auteur est membre actif', () => {
  it('un seul flux refus_synchro, en auto_subscribe', () => {
    expect(fluxRefus, 'un seul flux pour refus_synchro').toHaveLength(1);
    expect(regles).toMatch(/^ {2}refus_synchro:\n {4}auto_subscribe: true\n/m);
  });

  it('filtre : au seul auteur, et seulement les refus sans ferme ou d’une ferme active (adhésion perdue → plus rien de la ferme)', () => {
    const q = fluxRefus[0] ?? '';
    expect(q.slice(q.indexOf(' FROM refus_synchro ') + ' FROM refus_synchro '.length)).toBe(FILTRE);
  });

  it('mêmes colonnes qu’avant (résumé T10k, archive_le T10l), jamais les données reçues', () => {
    const colonnes = (/^SELECT (.*?) FROM refus_synchro/.exec(fluxRefus[0] ?? '')?.[1] ?? '').split(',').map((c) => c.trim());
    expect([...colonnes].sort()).toEqual([...COLONNES].sort());
  });

  it('fermes_actives reste la règle d’adhésion des autres flux : acceptée, non supprimée, ferme et utilisateur non supprimés', () => {
    const avec = /^with:\n {2}fermes_actives: >-\n((?: {4}[^\n]*\n)+)/m.exec(regles)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    expect(avec).toContain('m.utilisateur_id = auth.user_id()');
    expect(avec).toContain("m.etat = 'accepte'");
    expect(avec).toContain('m.supprime_le IS NULL');
    expect(avec).toContain('f.supprime_le IS NULL');
    expect(avec).toContain('u.supprime_le IS NULL');
  });
});
