// @vitest-environment happy-dom
/**
 * Tests d'acceptation T11f — compteur global d'écritures en cours (suite de la relecture T11b).
 *
 * ── Contrat (nouveau module `src/donnees/ecritures-en-cours.ts`, minuscule et partagé) ─────────
 *
 *   commencerEcriture(): () => void
 *     Compte une écriture de plus ; rend la fonction qui la termine. Appeler cette fonction
 *     plusieurs fois ne décompte qu'une fois (un `finally` rejoué ne fausse pas le compte).
 *   ecrituresEnCours(): number
 *     Nombre d'écritures commencées et pas encore terminées, pour toute l'appli (pas pour un
 *     écran) : il survit au démontage de l'écran qui a commencé l'écriture.
 *
 *   `saisieEnCours()` (src/rechargement.ts) est vrai tant que ce compteur n'est pas nul, même si
 *   aucun écran n'est affiché : la page ne se recharge pas (morceau introuvable) au milieu d'une
 *   écriture. Comment rechargement.ts le lit est libre (le démarrage n'a que 2 octets de marge
 *   après T11b) : le compteur peut par exemple se refléter dans le DOM, sur un marqueur déjà lu.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { saisieEnCours } from '../rechargement.ts';

interface ModuleEcrituresEnCours {
  commencerEcriture(): () => void;
  ecrituresEnCours(): number;
}

const CHEMIN = './ecritures-en-cours.ts';
let m: ModuleEcrituresEnCours;
const fins: (() => void)[] = [];

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEcrituresEnCours;
});

afterEach(() => {
  for (const fin of fins.splice(0)) fin();
});

function commencer(): () => void {
  const fin = m.commencerEcriture();
  fins.push(fin);
  return fin;
}

describe('T11f : compteur global d’écritures en cours', () => {
  it('au repos : zéro, et aucune saisie en cours (DOM vide)', () => {
    expect(m.ecrituresEnCours()).toBe(0);
    expect(saisieEnCours(document)).toBe(false);
  });

  it('compte chaque écriture commencée, décompte chacune une seule fois', () => {
    const a = commencer();
    const b = commencer();
    expect(m.ecrituresEnCours()).toBe(2);
    a();
    a();
    expect(m.ecrituresEnCours(), 'une fin rejouée ne décompte pas deux fois').toBe(1);
    b();
    expect(m.ecrituresEnCours()).toBe(0);
  });

  it('saisieEnCours() est vrai tant qu’une écriture tourne, sans aucun écran affiché', () => {
    expect(document.body.children).toHaveLength(0);
    const fin = commencer();
    expect(saisieEnCours(document), 'écriture en cours : saisie en cours').toBe(true);
    expect(saisieEnCours(), 'par défaut, sur document').toBe(true);
    fin();
    expect(saisieEnCours(document), 'écriture finie : plus de saisie en cours').toBe(false);
  });
});
