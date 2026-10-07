/**
 * T13k (développeur) : « Fait » tapés avant la base et jamais écrits, appli fermée avant la base.
 * Le nombre est noté dans l'enregistrement de l'instantané (même clé : effacé à la déconnexion),
 * jamais pour un autre compte, sans aucun nom de culture ; le message ne nomme rien non plus.
 */
import { describe, expect, it } from 'vitest';
import { CLE_SESSION } from '../../connexion/session.ts';
import { cleInstantane } from './cle-instantane.ts';
import { texteFaitsAbandonnes } from './EcranAujourdhui.tsx';
import { lireFaitsEnAttente, lireInstantane, noterFaitsEnAttente, VERSION_INSTANTANE, type StockageInstantane } from './instantane.ts';

const U = 'u-1';
const AUTRE = 'u-2';

function stockage(connecte: string): StockageInstantane & { readonly valeurs: Map<string, string> } {
  const valeurs = new Map<string, string>([
    [CLE_SESSION, JSON.stringify({ utilisateurId: connecte, email: 'a@b.fr', jetonAcces: 'a.b.c', jetonRenouvellement: 'r'.repeat(43) })],
  ]);
  return {
    valeurs,
    getItem: (c) => valeurs.get(c) ?? null,
    setItem: (c, v) => {
      valeurs.set(c, v);
    },
    removeItem: (c) => {
      valeurs.delete(c);
    },
  };
}

const instantane = { version: VERSION_INSTANTANE, utilisateurId: U, fermeId: 'f', jour: '2026-09-30', semaine: 40, taches: [], retard: 0, cetteSemaine: 0, recoltes: 0, charge: 0, historique: [], saisies: 0 };

describe('T13k : « Fait » d’avant la base notés avec l’instantané', () => {
  it('noté, relu, effacé ; l’instantané reste lisible', () => {
    const s = stockage(U);
    s.setItem(cleInstantane(U), JSON.stringify(instantane));
    noterFaitsEnAttente(s, U, 3);
    expect(lireFaitsEnAttente(s, U)).toBe(3);
    expect(lireInstantane(s, { utilisateurId: U, fermeId: 'f', jour: '2026-09-30' })).not.toBeNull();
    noterFaitsEnAttente(s, U, 0);
    expect(lireFaitsEnAttente(s, U)).toBe(0);
    expect(s.getItem(cleInstantane(U))).not.toContain('faitsEnAttente');
  });

  it('rien pour un autre compte, ni sans instantané', () => {
    const s = stockage(AUTRE);
    s.setItem(cleInstantane(U), JSON.stringify(instantane));
    noterFaitsEnAttente(s, U, 2);
    expect(s.getItem(cleInstantane(U))).not.toContain('faitsEnAttente');
    expect(lireFaitsEnAttente(s, U)).toBe(0);
    const vide = stockage(U);
    noterFaitsEnAttente(vide, U, 2);
    expect(vide.getItem(cleInstantane(U))).toBeNull();
  });

  it('message : dit « enregistré », sans nom de culture', () => {
    expect(texteFaitsAbandonnes(1)).toBe('1 « Fait » tapé avant l’ouverture n’a peut-être pas été enregistré : vérifiez la liste.');
    expect(texteFaitsAbandonnes(3)).toBe('3 « Fait » tapés avant l’ouverture n’ont peut-être pas été enregistrés : vérifiez la liste.');
  });
});
