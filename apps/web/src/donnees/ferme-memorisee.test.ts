/**
 * T13g (tests du développeur) — la ferme active est mémorisée avec la session dès qu'elle est
 * connue (suivreFermeActive), pour que l'écran Aujourd'hui, au lancement suivant, ne montre avant
 * la base que l'instantané de cette ferme. Sans ferme : mémoire vidée (lue comme « aucune »).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../packages/sync/src/test/base-memoire.ts';
import { suivreFermeActive, type FermeActive } from './ferme-active.ts';
import { lireFermeMemorisee, memoriserFerme } from './ferme-memorisee.ts';

const MOI = '0192f0c1-13f1-7000-8000-0000000000a1';
const F1 = '0192f0c1-13f1-7000-8000-0000000000f1';
const F2 = '0192f0c1-13f1-7000-8000-0000000000f2';

let base: BaseMemoire;
afterEach(() => {
  base.fermer();
});

function stockage(): Pick<Storage, 'getItem' | 'setItem'> {
  const valeurs = new Map<string, string>();
  return {
    getItem: (k) => valeurs.get(k) ?? null,
    setItem: (k, v) => {
      valeurs.set(k, v);
    },
  };
}

let n = 0;
function adherer(fermeId: string, creeLe: string): void {
  base.recevoir('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, supprime_le) VALUES (?, ?, ?, ?, NULL)', [fermeId, 'Ferme', 'Europe/Paris', creeLe]);
  n++;
  base.recevoir('INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, cree_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)', [
    `0192f0c1-13f1-7000-8000-${n.toString(16).padStart(12, '0')}`,
    MOI,
    fermeId,
    'proprietaire',
    'accepte',
    creeLe,
  ]);
}

async function attendre(condition: () => boolean): Promise<void> {
  for (let k = 0; k < 100 && !condition(); k++) await new Promise((r) => setTimeout(r, 0));
  expect(condition()).toBe(true);
}

describe('T13g : la ferme active est mémorisée', () => {
  it('ferme connue → mémorisée ; mémorisée retirée → la nouvelle active l’est ; sans ferme → plus aucune', async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    const s = stockage();
    const etats: FermeActive[] = [];
    const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: s }, (e) => etats.push(e));
    await attendre(() => etats.length === 1);
    expect(lireFermeMemorisee(s, MOI)).toBeNull();

    adherer(F1, '2024-01-01T00:00:00.000Z');
    adherer(F2, '2025-01-01T00:00:00.000Z');
    await attendre(() => etats.at(-1)?.etat === 'prete');
    expect(lireFermeMemorisee(s, MOI)).toBe(F1);

    base.recevoir("UPDATE membre SET supprime_le = '2026-09-30T00:00:00.000Z' WHERE ferme_id = ?", [F1]);
    await attendre(() => lireFermeMemorisee(s, MOI) === F2);

    base.recevoir("UPDATE membre SET supprime_le = '2026-09-30T00:00:00.000Z' WHERE ferme_id = ?", [F2]);
    await attendre(() => etats.at(-1)?.etat === 'sans-ferme');
    expect(lireFermeMemorisee(s, MOI)).toBeNull();
    arreter();
  });

  it('le choix mémorisé reste celui de l’utilisateur tant qu’il en est membre', async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    adherer(F1, '2024-01-01T00:00:00.000Z');
    adherer(F2, '2025-01-01T00:00:00.000Z');
    const s = stockage();
    memoriserFerme(s, MOI, F2);
    const etats: FermeActive[] = [];
    const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: s }, (e) => etats.push(e));
    await attendre(() => etats.length === 1);
    expect(etats[0]).toMatchObject({ etat: 'prete', fermeId: F2 });
    expect(lireFermeMemorisee(s, MOI)).toBe(F2);
    arreter();
  });
});
