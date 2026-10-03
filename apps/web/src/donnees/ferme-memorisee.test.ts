/**
 * T13g (tests du développeur) — la ferme active est notée comme « dernière ferme montrée » dès
 * qu'elle est connue (suivreFermeActive), sous une clé à part : l'écran Aujourd'hui, au lancement
 * suivant, ne montre avant la base que l'instantané de cette ferme. Le choix de l'utilisateur
 * (T11) n'est jamais réécrit : si son adhésion disparaît puis revient, il revient avec elle.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../packages/sync/src/test/base-memoire.ts';
import { suivreFermeActive, type FermeActive } from './ferme-active.ts';
import { lireFermeMemorisee, lireFermeMontree, memoriserFerme } from './ferme-memorisee.ts';

const MOI = '0192f0c1-13f1-7000-8000-0000000000a1';
const F1 = '0192f0c1-13f1-7000-8000-0000000000f1';
const F2 = '0192f0c1-13f1-7000-8000-0000000000f2';

let base: BaseMemoire;
afterEach(() => {
  base.fermer();
});

function stockage(): Pick<Storage, 'getItem' | 'setItem'> & { readonly valeurs: Map<string, string> } {
  const valeurs = new Map<string, string>();
  return {
    valeurs,
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

const retirer = (fermeId: string) => {
  base.recevoir("UPDATE membre SET supprime_le = '2026-09-30T00:00:00.000Z' WHERE ferme_id = ?", [fermeId]);
};
const rendre = (fermeId: string) => {
  base.recevoir('UPDATE membre SET supprime_le = NULL WHERE ferme_id = ?', [fermeId]);
};

async function attendre(condition: () => boolean): Promise<void> {
  for (let k = 0; k < 100 && !condition(); k++) await new Promise((r) => setTimeout(r, 0));
  expect(condition()).toBe(true);
}

const active = (etats: readonly FermeActive[]) => {
  const e = etats.at(-1);
  return e?.etat === 'prete' ? e.fermeId : e?.etat;
};

describe('T13g : la dernière ferme montrée est notée, le choix reste intact', () => {
  it('ferme connue → notée ; retirée → la suivante l’est ; sans ferme → plus aucune ; le choix n’est jamais écrit', async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    const s = stockage();
    const etats: FermeActive[] = [];
    const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: s }, (e) => etats.push(e));
    await attendre(() => etats.length === 1);
    expect(lireFermeMontree(s, MOI)).toBeNull();

    adherer(F1, '2024-01-01T00:00:00.000Z');
    adherer(F2, '2025-01-01T00:00:00.000Z');
    await attendre(() => active(etats) === F1);
    expect(lireFermeMontree(s, MOI)).toBe(F1);

    retirer(F1);
    await attendre(() => lireFermeMontree(s, MOI) === F2);

    retirer(F2);
    await attendre(() => active(etats) === 'sans-ferme');
    expect(lireFermeMontree(s, MOI)).toBeNull();
    expect(lireFermeMemorisee(s, MOI), 'le choix de l’utilisateur n’est pas écrit par l’appli').toBeNull();
    arreter();
  });

  it('choix conservé quand son adhésion disparaît puis revient', async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    adherer(F1, '2024-01-01T00:00:00.000Z');
    adherer(F2, '2025-01-01T00:00:00.000Z');
    const s = stockage();
    memoriserFerme(s, MOI, F2);
    const etats: FermeActive[] = [];
    const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: s }, (e) => etats.push(e));
    await attendre(() => active(etats) === F2);
    expect(lireFermeMontree(s, MOI)).toBe(F2);

    // Adhésion à F2 retirée un temps : F1 est montrée, le choix reste F2.
    retirer(F2);
    await attendre(() => active(etats) === F1);
    expect(lireFermeMontree(s, MOI)).toBe(F1);
    expect(lireFermeMemorisee(s, MOI)).toBe(F2);

    // Elle revient : le choix de l'utilisateur aussi.
    rendre(F2);
    await attendre(() => active(etats) === F2);
    expect(lireFermeMontree(s, MOI)).toBe(F2);
    expect(lireFermeMemorisee(s, MOI)).toBe(F2);
    arreter();
  });
});
