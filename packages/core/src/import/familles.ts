/**
 * Familles botaniques fournies avec l'appli et leurs délais de retour par défaut (années).
 *
 * PROVISOIRES, à valider par Théophane (le ticket T14 veut qu'elles lui soient proposées avant
 * d'être figées ; voir familles.test.ts). Ordres de grandeur des guides de rotation en maraîchage
 * biologique ; Brassicacées 4 / 6 : règle donnée par Théophane. Une ferme modifie SES familles,
 * jamais cette constante (gelée).
 */
import type { FamilleParDefaut } from './types.ts';

const famille = (nom: string, delaiRetourMinimalAns: number, delaiRetourConseilleAns: number): FamilleParDefaut =>
  Object.freeze({ nom, delaiRetourMinimalAns, delaiRetourConseilleAns });

export const FAMILLES_PAR_DEFAUT: readonly FamilleParDefaut[] = /* @__PURE__ */ (() =>
  Object.freeze([
    famille('Alliacées', 4, 5), // ail, oignon, poireau, échalote
    famille('Amaranthacées', 3, 4), // betterave, épinard, blette
    famille('Apiacées', 3, 4), // carotte, céleri, persil, panais, fenouil
    famille('Asparagacées', 8, 10), // asperge
    famille('Astéracées', 2, 3), // laitues, chicorées, artichaut
    famille('Brassicacées', 4, 6), // choux, radis, navet, roquette
    famille('Convolvulacées', 3, 4), // patate douce
    famille('Cucurbitacées', 3, 4), // courgette, courges, concombre, melon
    famille('Fabacées', 3, 5), // haricot, pois, fève
    famille('Lamiacées', 2, 3), // basilic, aromatiques
    famille('Paeoniacées', 5, 8), // pivoine
    famille('Poacées', 1, 2), // maïs doux, engrais verts
    famille('Polygonacées', 3, 4), // rhubarbe, oseille, sarrasin
    famille('Rosacées', 4, 5), // fraisier
    famille('Solanacées', 3, 4), // tomate, aubergine, poivron, pomme de terre
    famille('Valérianacées', 2, 3), // mâche
  ]))();
