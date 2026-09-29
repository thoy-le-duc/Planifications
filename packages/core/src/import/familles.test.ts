/**
 * Tests d'acceptation T14 — bibliothèque : familles botaniques fournies avec l'appli et leurs
 * délais de retour par défaut (années), pour les alertes de rotation (T04) et l'assolement importé.
 *
 * VALEURS PROVISOIRES, À VALIDER PAR THÉOPHANE (docs/questions.md) : le ticket veut qu'elles lui
 * soient proposées avant d'être figées. Ce test les fige telles que proposées par le testeur ;
 * les changer après sa réponse est prévu (et se justifie dans la PR).
 * Ordres de grandeur des guides de rotation en maraîchage biologique (ITAB, GRAB, chambres
 * d'agriculture) ; Brassicacées 4 / 6 : la règle donnée par Théophane lui-même (Q4, « choux :
 * 4 minimum, 6 conseillés »). Chaque famille reste modifiable par la ferme, et une espèce peut
 * avoir ses propres délais (T01, `Espece.delaisRetour`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, type FamilleParDefaut, type ModuleImport } from './test/contrat.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

/** [nom, délai minimal, délai conseillé], dans l'ordre alphabétique. */
const PROPOSEES: readonly [string, number, number][] = [
  ['Alliacées', 4, 5], // ail, oignon, poireau, échalote — pourriture blanche, fusariose
  ['Amaranthacées', 3, 4], // betterave, épinard, blette (ex-Chénopodiacées)
  ['Apiacées', 3, 4], // carotte, céleri, persil, panais, fenouil
  ['Asparagacées', 8, 10], // asperge — maladie de replantation (fusariose, autotoxicité)
  ['Astéracées', 2, 3], // laitues, chicorées, artichaut
  ['Brassicacées', 4, 6], // choux, radis, navet, roquette — hernie du chou
  ['Convolvulacées', 3, 4], // patate douce
  ['Cucurbitacées', 3, 4], // courgette, courges, concombre, melon
  ['Fabacées', 3, 5], // haricot, pois, fève — pois : aphanomyces
  ['Lamiacées', 2, 3], // basilic, aromatiques
  ['Paeoniacées', 5, 8], // pivoine — replantation, à confirmer
  ['Poacées', 1, 2], // maïs doux, céréales d'engrais vert
  ['Polygonacées', 3, 4], // rhubarbe, oseille, sarrasin
  ['Rosacées', 4, 5], // fraisier — verticilliose, Phytophthora
  ['Solanacées', 3, 4], // tomate, aubergine, poivron, pomme de terre
  ['Valérianacées', 2, 3], // mâche
];

describe('FAMILLES_PAR_DEFAUT (provisoire, à valider par Théophane)', () => {
  it('valeurs proposées, figées ici', () => {
    const lues = m.FAMILLES_PAR_DEFAUT.map((f: FamilleParDefaut) => [f.nom, f.delaiRetourMinimalAns, f.delaiRetourConseilleAns]);
    expect(lues).toStrictEqual(PROPOSEES);
  });

  it('délais entiers, 1 ≤ minimal ≤ conseillé ≤ 10 ; noms uniques', () => {
    const noms = new Set<string>();
    for (const f of m.FAMILLES_PAR_DEFAUT) {
      expect(Number.isInteger(f.delaiRetourMinimalAns), f.nom).toBe(true);
      expect(Number.isInteger(f.delaiRetourConseilleAns), f.nom).toBe(true);
      expect(f.delaiRetourMinimalAns, f.nom).toBeGreaterThanOrEqual(1);
      expect(f.delaiRetourConseilleAns, f.nom).toBeGreaterThanOrEqual(f.delaiRetourMinimalAns);
      expect(f.delaiRetourConseilleAns, f.nom).toBeLessThanOrEqual(10);
      expect(noms.has(f.nom), f.nom).toBe(false);
      noms.add(f.nom);
    }
  });

  it('non modifiable par erreur (gelée) : une ferme modifie SES familles, pas la constante', () => {
    expect(Object.isFrozen(m.FAMILLES_PAR_DEFAUT)).toBe(true);
    for (const f of m.FAMILLES_PAR_DEFAUT) expect(Object.isFrozen(f), f.nom).toBe(true);
  });
});
