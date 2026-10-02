/**
 * Tests d'acceptation T25 (relecture) — la démo ne touche pas au compte d'un autre.
 *
 * Contrat pour le développeur : nouveau module `src/demo/session.ts` (pur, sans React ni base),
 * utilisé par index.tsx à la place du code en ligne actuel.
 *
 *   - `poserSessionDemo(stockage): 'posee' | 'autre-compte'`
 *       · aucune session, session illisible ou session de la démo → pose la session de la démo,
 *         rend 'posee' ;
 *       · session d'un AUTRE utilisateur (CLE_SESSION, utilisateurId ≠ UTILISATEUR_DEMO) →
 *         n'écrit RIEN, rend 'autre-compte'. La démo ne démarre alors pas : index.tsx affiche un
 *         message d'erreur (data-etat="echec" ou texte dédié, par exemple « Ce navigateur est déjà
 *         connecté à un compte : ouvrez la démo dans une fenêtre privée ») et ne remplit aucune
 *         base. (Cas réel : la démo et l'appli servies sur la même origine.)
 *   - `reinitialiserStockage(stockage): void` : retire de `stockage` uniquement les clés connues
 *       de la démo — CLE_REMPLIE, et CLE_SESSION si elle est celle de la démo (jamais celle d'un
 *       autre utilisateur). Toute autre clé, `planif.*` inconnue comprise, reste.
 */
import { describe, expect, it } from 'vitest';
import { CLE_SESSION } from '../connexion/session.ts';
import { CLE_REMPLIE, UTILISATEUR_DEMO } from './identite.ts';
import { poserSessionDemo, reinitialiserStockage } from './session.ts';

class Stockage {
  readonly valeurs = new Map<string, string>();
  getItem(cle: string): string | null {
    return this.valeurs.get(cle) ?? null;
  }
  setItem(cle: string, valeur: string): void {
    this.valeurs.set(cle, valeur);
  }
  removeItem(cle: string): void {
    this.valeurs.delete(cle);
  }
}

const session = (utilisateurId: string) => JSON.stringify({ utilisateurId, email: 'x@y', jetonAcces: 'a', jetonRenouvellement: 'r' });

describe('T25 : session de la démo', () => {
  it('pose la session de la démo sur un stockage vide', () => {
    const s = new Stockage();
    expect(poserSessionDemo(s)).toBe('posee');
    expect((JSON.parse(s.getItem(CLE_SESSION) ?? 'null') as { utilisateurId?: string } | null)?.utilisateurId).toBe(UTILISATEUR_DEMO);
  });

  it('remplace une session illisible, garde celle de la démo', () => {
    const s = new Stockage();
    s.setItem(CLE_SESSION, '{pas du json');
    expect(poserSessionDemo(s)).toBe('posee');
    expect(poserSessionDemo(s)).toBe('posee');
  });

  it('ne remplace PAS la session d’un autre utilisateur : rien n’est écrit', () => {
    const s = new Stockage();
    const autre = session('0192f0c1-aaaa-7000-8000-000000000009');
    s.setItem(CLE_SESSION, autre);
    s.setItem('planif.ferme-active', 'f1');
    expect(poserSessionDemo(s)).toBe('autre-compte');
    expect(s.getItem(CLE_SESSION)).toBe(autre);
    expect([...s.valeurs.keys()].sort()).toEqual([CLE_SESSION, 'planif.ferme-active'].sort());
  });
});

describe('T25 : « Réinitialiser la démo » n’efface que ce qui est à elle', () => {
  it('retire la marque de remplissage et la session de la démo, garde les clés inconnues', () => {
    const s = new Stockage();
    s.setItem(CLE_REMPLIE, '2027-02-15');
    s.setItem(CLE_SESSION, session(UTILISATEUR_DEMO));
    s.setItem('planif.inconnue', 'garde');
    s.setItem('autre-appli', 'garde');
    reinitialiserStockage(s);
    expect([...s.valeurs.keys()].sort()).toEqual(['autre-appli', 'planif.inconnue']);
  });

  it('ne retire pas la session d’un autre utilisateur', () => {
    const s = new Stockage();
    const autre = session('0192f0c1-aaaa-7000-8000-000000000009');
    s.setItem(CLE_SESSION, autre);
    s.setItem(CLE_REMPLIE, '2027-02-15');
    reinitialiserStockage(s);
    expect(s.getItem(CLE_SESSION)).toBe(autre);
    expect(s.getItem(CLE_REMPLIE)).toBeNull();
  });
});
