/**
 * Tests d'acceptation T10u — refus d'une ferme quittée effacés du téléphone
 * (docs/backlog/T10u-refus-ferme-quittee.md, Q25). Partie téléphone, sur la base locale en
 * mémoire (packages/sync/src/test/base-memoire.ts) qui imite ce que la synchro écrit.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * C'est la synchro qui efface les refus d'une ferme quittée (flux refus_synchro filtré sur les
 * fermes actives : packages/sync/src/refus-ferme-quittee.test.ts ; preuve contre le vrai service,
 * téléphone hors ligne compris : apps/api/src/sync/refus-ferme-quittee.integration.test.ts).
 * Le téléphone, lui :
 *   - suit cet effacement en direct : dès que la synchro retire les lignes, l'écran des refus
 *     (porte.surveillerRefus) ne montre plus aucun refus de la ferme quittée ni son résumé, et
 *     garde ceux des autres fermes et ceux sans ferme ;
 *   - n'écrit JAMAIS lui-même dans refus_synchro pour les effacer : un DELETE local partirait au
 *     serveur (file d'envoi de PowerSync), qui le refuse (T10l, 'table_interdite') et
 *     enregistrerait un refus de plus ; PowerSync remettrait la ligne. Ni à la perte de
 *     l'adhésion, ni quand l'adhésion n'est pas (encore) dans la base locale (première synchro
 *     en cours, adhésion en attente de synchro) : rien n'est effacé, les refus restent montrés ;
 *   - ne montre jamais les refus d'un autre compte : une base locale par compte
 *     (nomBaseLocale), et la porte ne lit que les refus de son utilisateur ;
 *   - n'exporte jamais les refus (règle T15, confirmée le 2026-10-07 : packages/sync/src/
 *     export.test.ts, « toutes les tables synchronisées sauf refus_synchro » et suivants).
 *
 * Ces tests passent déjà sur main : ils gardent le téléphone contre un effacement « maison » (ou
 * un affichage qui ne suivrait pas la synchro). Ceux qui échouent tant que T10u n'est pas fait
 * sont les deux fichiers cités plus haut.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type RefusSynchro } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../packages/sync/src/test/base-memoire.ts';
import { nomBaseLocale } from './effacer.ts';
import { suivreFermeActive, type FermeActive } from './ferme-active.ts';

const MOI = '0192f0c1-0000-7000-8000-0000000000a1';
const ANCIEN_COMPTE = '0192f0c1-0000-7000-8000-0000000000a2';
const QUITTEE = '0192f0c1-0000-7000-8000-0000000000f1';
const GARDEE = '0192f0c1-0000-7000-8000-0000000000f2';

const CULTURE_QUITTEE = 'Tomate Cœur de bœuf';
const CULTURE_GARDEE = 'Fraise Mara des bois';
const CULTURE_ANCIEN_COMPTE = 'Asperge Argenteuil';

const R_QUITTEE = '0192f0c1-0000-7000-8000-0000000000b1';
const R_QUITTEE_2 = '0192f0c1-0000-7000-8000-0000000000b2';
const R_GARDEE = '0192f0c1-0000-7000-8000-0000000000b3';
const R_SANS_FERME = '0192f0c1-0000-7000-8000-0000000000b4';
const R_ANCIEN_COMPTE = '0192f0c1-0000-7000-8000-0000000000b5';

let bases: BaseMemoire[] = [];
afterEach(() => {
  for (const b of bases) b.fermer();
  bases = [];
});

async function attendre(condition: () => boolean): Promise<void> {
  for (let k = 0; k < 200 && !condition(); k++) await new Promise((r) => setTimeout(r, 0));
}

function stockage(): Pick<Storage, 'getItem' | 'setItem'> {
  const valeurs = new Map<string, string>();
  return { getItem: (k) => valeurs.get(k) ?? null, setItem: (k, v) => void valeurs.set(k, v) };
}

function ferme(base: BaseMemoire, id: string, nom: string): void {
  base.recevoir('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le) VALUES (?, ?, ?, ?)', [id, nom, 'Europe/Paris', '2026-01-01T00:00:00.000Z']);
}

function membre(base: BaseMemoire, id: string, utilisateur: string, fermeId: string, creeLe: string): void {
  base.recevoir('INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, cree_le) VALUES (?, ?, ?, ?, ?, ?)', [
    id,
    utilisateur,
    fermeId,
    'equipier',
    'accepte',
    creeLe,
  ]);
}

function refus(base: BaseMemoire, id: string, utilisateur: string, fermeId: string | null, culture: string | null, creeLe: string): void {
  base.recevoir(
    `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, cree_le,
                                saisie_type, saisie_culture, saisie_date, saisie_quantite, saisie_unite)
     VALUES (?, ?, ?, 'evenement', ?, 'PUT', 'recolte_annulee', 'Cette récolte ne peut plus être enregistrée.', ?, 'recolte', ?, '2026-10-01', 3, 'kg')`,
    [id, utilisateur, fermeId, `ligne-${id}`, creeLe, culture],
  );
}

const M_QUITTEE = '0192f0c1-0000-7000-8000-0000000000c1';
const M_GARDEE = '0192f0c1-0000-7000-8000-0000000000c2';

/** Téléphone de MOI, membre de QUITTEE et de GARDEE, avec ses refus et un refus d'un ancien compte. */
function telephone(avecAdhesions = true): BaseMemoire {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  bases.push(base);
  ferme(base, QUITTEE, 'Ferme quittée');
  ferme(base, GARDEE, 'Ferme gardée');
  if (avecAdhesions) {
    membre(base, M_QUITTEE, MOI, QUITTEE, '2026-02-01T00:00:00.000Z');
    membre(base, M_GARDEE, MOI, GARDEE, '2026-03-01T00:00:00.000Z');
  }
  refus(base, R_QUITTEE, MOI, QUITTEE, CULTURE_QUITTEE, '2026-10-01T06:00:05.000Z');
  refus(base, R_QUITTEE_2, MOI, QUITTEE, CULTURE_QUITTEE, '2026-10-01T06:00:04.000Z');
  refus(base, R_GARDEE, MOI, GARDEE, CULTURE_GARDEE, '2026-10-01T06:00:03.000Z');
  refus(base, R_SANS_FERME, MOI, null, null, '2026-10-01T06:00:02.000Z');
  refus(base, R_ANCIEN_COMPTE, ANCIEN_COMPTE, QUITTEE, CULTURE_ANCIEN_COMPTE, '2026-10-01T06:00:01.000Z');
  return base;
}

/** Ce que la synchro fait à la perte de l'adhésion : l'adhésion retirée, les refus de la ferme retirés. */
function synchroRetireDeQuittee(base: BaseMemoire): void {
  base.recevoir('UPDATE membre SET supprime_le = ? WHERE id = ?', ['2026-10-08T09:00:00.000Z', M_QUITTEE]);
  base.recevoir('DELETE FROM refus_synchro WHERE ferme_id = ? AND utilisateur_id = ?', [QUITTEE, MOI]);
}

const idsDe = (refus: readonly RefusSynchro[] | undefined): string[] => (refus ?? []).map((r) => r.id);

/** Écritures du téléphone lui-même (hors lignes reçues par la synchro) qui touchent refus_synchro. */
function ecrituresRefusDepuis(base: BaseMemoire, depuis: number): string[] {
  return base.ecritures.slice(depuis).filter((sql) => /refus_synchro/i.test(sql));
}

describe('T10u : refus d’une ferme quittée, côté téléphone', () => {
  it('la synchro retire les refus de la ferme quittée : l’écran ne les montre plus, ni leur résumé ; ceux de l’autre ferme et sans ferme restent', async () => {
    const base = telephone();
    const porte = creerPorte(base, { utilisateurId: MOI as Id<'Utilisateur'>, fermeId: GARDEE as Id<'Ferme'> });
    const vus: RefusSynchro[][] = [];
    const arreter = porte.surveillerRefus((r) => vus.push(r));
    try {
      await attendre(() => vus.length > 0);
      expect(idsDe(vus.at(-1)), 'avant : les refus de MOI, toutes fermes').toEqual([R_QUITTEE, R_QUITTEE_2, R_GARDEE, R_SANS_FERME]);

      synchroRetireDeQuittee(base);
      await attendre(() => idsDe(vus.at(-1)).length === 2);

      expect(idsDe(vus.at(-1))).toEqual([R_GARDEE, R_SANS_FERME]);
      expect(JSON.stringify(vus.at(-1)), 'aucun résumé de la ferme quittée').not.toContain(CULTURE_QUITTEE);
      expect(vus.at(-1)?.[0]?.saisie?.culture, 'le résumé des autres refus reste').toBe(CULTURE_GARDEE);
    } finally {
      arreter();
    }
  });

  it('perte de l’adhésion arrivée par la synchro : le téléphone n’écrit rien dans refus_synchro (rien ne part au serveur)', async () => {
    const base = telephone();
    const etats: FermeActive[] = [];
    const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: stockage() }, (e) => etats.push(e));
    try {
      await attendre(() => etats.length > 0);
      const depuis = base.ecritures.length;
      // L'adhésion seule descend d'abord (ordre possible d'un point de contrôle partiel) : le
      // téléphone ne prend pas l'initiative d'effacer.
      base.recevoir('UPDATE membre SET supprime_le = ? WHERE id = ?', ['2026-10-08T09:00:00.000Z', M_QUITTEE]);
      const recues = base.ecritures.length;
      await attendre(() => etats.length > 1);
      for (let k = 0; k < 50; k++) await new Promise((r) => setTimeout(r, 0));

      expect(base.ecritures.length - recues, 'aucune écriture du téléphone après la ligne reçue').toBe(0);
      expect(ecrituresRefusDepuis(base, depuis), 'aucune écriture sur refus_synchro').toEqual([]);
      const restants = base.lireDirect<{ id: string }>('SELECT id FROM refus_synchro WHERE ferme_id = ? ORDER BY id', [QUITTEE]);
      expect(
        restants.map((r) => r.id),
        'les lignes restent jusqu’à ce que la synchro les retire',
      ).toEqual([R_QUITTEE, R_QUITTEE_2, R_ANCIEN_COMPTE]);
    } finally {
      arreter();
    }
  });

  it('adhésion pas encore dans la base locale (en attente de synchro) : rien n’est effacé, les refus restent montrés', async () => {
    const base = telephone(false);
    const depuis = base.ecritures.length;
    const etats: FermeActive[] = [];
    const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: stockage() }, (e) => etats.push(e));
    const porte = creerPorte(base, { utilisateurId: MOI as Id<'Utilisateur'>, fermeId: GARDEE as Id<'Ferme'> });
    const vus: RefusSynchro[][] = [];
    const arreterRefus = porte.surveillerRefus((r) => vus.push(r));
    try {
      await attendre(() => etats.length > 0 && vus.length > 0);
      expect(etats.at(-1)?.etat).toBe('sans-ferme');
      for (let k = 0; k < 50; k++) await new Promise((r) => setTimeout(r, 0));

      expect(ecrituresRefusDepuis(base, depuis), 'aucune écriture sur refus_synchro').toEqual([]);
      expect(base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM refus_synchro')[0]?.n).toBe(5);
      expect(idsDe(vus.at(-1))).toEqual([R_QUITTEE, R_QUITTEE_2, R_GARDEE, R_SANS_FERME]);

      // L'adhésion arrive ensuite : toujours rien d'effacé.
      membre(base, M_QUITTEE, MOI, QUITTEE, '2026-02-01T00:00:00.000Z');
      const apresReception = base.ecritures.length;
      await attendre(() => etats.at(-1)?.etat === 'prete');
      for (let k = 0; k < 50; k++) await new Promise((r) => setTimeout(r, 0));
      expect(base.ecritures.length - apresReception, 'aucune écriture du téléphone').toBe(0);
      expect(idsDe(vus.at(-1))).toEqual([R_QUITTEE, R_QUITTEE_2, R_GARDEE, R_SANS_FERME]);
    } finally {
      arreter();
      arreterRefus();
    }
  });

  it('changement de compte sur le même téléphone : une base par compte, et aucun refus de l’ancien compte n’est montré', async () => {
    expect(nomBaseLocale(MOI)).not.toBe(nomBaseLocale(ANCIEN_COMPTE));
    // Même dans une base qui contiendrait les lignes de l'ancien compte, la porte ne lit que les siens.
    const base = telephone();
    const vus: RefusSynchro[][] = [];
    const arreter = creerPorte(base, { utilisateurId: MOI as Id<'Utilisateur'>, fermeId: QUITTEE as Id<'Ferme'> }).surveillerRefus((r) => vus.push(r));
    try {
      await attendre(() => vus.length > 0);
      expect(idsDe(vus.at(-1))).not.toContain(R_ANCIEN_COMPTE);
      expect(JSON.stringify(vus.at(-1))).not.toContain(CULTURE_ANCIEN_COMPTE);
    } finally {
      arreter();
    }
  });
});
