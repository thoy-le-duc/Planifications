/**
 * Limite de débit en mémoire (T10f) : fenêtre glissante par clé, et mémoire bornée même avec des
 * milliers d'utilisateurs passés une seule fois.
 */
import { describe, expect, it } from 'vitest';
import { creerLimiteMemoire } from './limites.ts';

describe('creerLimiteMemoire', () => {
  it('au plus max actions par fenêtre glissante, Retry-After jusqu’à la plus ancienne', () => {
    const limite = creerLimiteMemoire(3, 60_000);
    expect(limite.enregistrer('a', 0)).toBeNull();
    expect(limite.enregistrer('a', 10_000)).toBeNull();
    expect(limite.enregistrer('a', 20_000)).toBeNull();
    expect(limite.enregistrer('a', 30_000)).toBe(30);
    expect(limite.enregistrer('b', 30_000), 'une autre clé a son propre quota').toBeNull();
    expect(limite.enregistrer('a', 60_001), 'la plus ancienne est sortie de la fenêtre').toBeNull();
    expect(limite.enregistrer('a', 60_002)).toBe(10);
  });

  it('un refus ne prolonge pas l’attente', () => {
    const limite = creerLimiteMemoire(1, 60_000);
    expect(limite.enregistrer('a', 0)).toBeNull();
    for (let t = 1_000; t < 60_000; t += 1_000) expect(limite.enregistrer('a', t)).not.toBeNull();
    expect(limite.enregistrer('a', 60_000)).toBeNull();
  });

  it('mémoire bornée : les clés sans action dans la fenêtre sont oubliées', () => {
    const limite = creerLimiteMemoire(120, 60_000);
    for (let i = 0; i < 10_000; i++) limite.enregistrer(`u${String(i)}`, i);
    expect(limite.taille).toBe(10_000);
    limite.enregistrer('dernier', 10 * 60_000);
    expect(limite.taille).toBe(1);
  });
});
