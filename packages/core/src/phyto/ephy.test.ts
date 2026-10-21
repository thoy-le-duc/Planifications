/**
 * Tests d'acceptation T53 — catalogue e-phy côté cœur (docs/backlog/T53-base-e-phy.md, règles 2
 * et 4) : recherche, correspondance espèce → usage, choix du DAR. Pur, sans réseau.
 *
 * Contrat attendu de ./ephy.ts (exporté par `@planif/core/ephy`, jamais par l'index du cœur :
 * rien du catalogue au démarrage de l'appli) :
 *   - `validerCatalogueEphy(x)` : le catalogue s'il a la bonne forme, sinon null ;
 *   - `chercherProduitsEphy(catalogue, texte, max?)` : 2 lettres au moins ; chaque mot tapé doit
 *     se trouver (sans casse ni accents) dans le nom, un second nom, l'AMM ou une substance ;
 *     autorisés d'abord, puis le nom qui commence par le texte, puis l'ordre alphabétique ;
 *   - `culturesEphyPourEspece(nomEspece)` : cultures e-phy qui couvrent l'espèce de la ferme ;
 *   - `usagesPourEspeces(produit, especes)` : les usages du produit pour ces espèces ;
 *   - `propositionUsage(produit, especes)` : { candidats, dar, dose } — DAR (et dose) proposés
 *     seulement quand tous les usages candidats sont d'accord ; sinon null : l'utilisateur choisit.
 */
import { describe, expect, it } from 'vitest';
import * as index from '../index.ts';
import { ANCIENNES_FORMES, CORRESPONDANCES, chercherProduitsEphy, culturesEphyPourEspece, propositionUsage, usagesPourEspeces, validerCatalogueEphy, type CatalogueEphy, type ProduitEphy, type UsageEphy } from './ephy.ts';
import { CULTURES_EPHY_2026 } from './test/cultures-ephy-2026.ts';

const u = (culture: string, cible: string, dar: number | null, dose: UsageEphy['dose'] = { valeur: 0.2, unite: 'L/ha' }): UsageEphy => ({ culture, mode: 'Trt Part.Aer.', cible, dose, dar });

const SUCCESS: ProduitEphy = {
  amm: '2060098',
  nom: 'SUCCESS 4',
  autresNoms: ['MUSDO 4'],
  substances: ['spinosad 480 g/L'],
  bio: true,
  retire: false,
  retireLe: null,
  usages: [u('Tomate', 'Thrips', 3), u('Tomate', 'Chenilles phytophages', 3, { valeur: 0.015, unite: 'L/hL' }), u('Fraisier', 'Thrips', 1), u('Laitue', 'Thrips', 3), u('Vigne', 'Thrips', 14)],
};
const SOUFRE: ProduitEphy = { amm: '9200352', nom: 'SODIEX', autresNoms: [], substances: ['soufre micronisé 80 %'], bio: true, retire: true, retireLe: '2020-09-22', usages: [u('Melon', 'Oïdium(s)', null)] };
const THIOVIT: ProduitEphy = { amm: '9000186', nom: 'THIOVIT JET MICROBILLES', autresNoms: [], substances: ['soufre 80 %'], bio: true, retire: false, retireLe: null, usages: [u('Cultures légumières', 'Oïdium(s)', 3)] };
const SUCCESSEUR: ProduitEphy = { amm: '2200001', nom: 'LE SUCCESSEUR', autresNoms: [], substances: ['huile de colza'], bio: false, retire: false, retireLe: null, usages: [u('Kiwi', 'Cochenilles', 0), u('Cultures florales et plantes vertes', 'Pucerons', 0)] };

const CATALOGUE: CatalogueEphy = {
  format: 1,
  source: 'E-Phy, Anses (data.gouv.fr)',
  licence: 'Licence Ouverte 2.0',
  dateBase: '2026-10-14',
  produits: [SUCCESSEUR, SOUFRE, SUCCESS, THIOVIT],
};

describe('T53 : hors de l’index du cœur', () => {
  it('le catalogue e-phy ne passe que par @planif/core/ephy (rien au démarrage de l’appli)', () => {
    const noms = Object.keys(index);
    for (const n of ['chercherProduitsEphy', 'culturesEphyPourEspece', 'propositionUsage', 'validerCatalogueEphy']) expect(noms).not.toContain(n);
  });
});

describe('T53 : validation du catalogue', () => {
  it('accepte le catalogue, refuse une forme inattendue', () => {
    expect(validerCatalogueEphy(JSON.parse(JSON.stringify(CATALOGUE)))).toEqual(CATALOGUE);
    expect(validerCatalogueEphy({ ...CATALOGUE, format: 2 })).toBeNull();
    expect(validerCatalogueEphy({ ...CATALOGUE, produits: [{ ...SUCCESS, usages: [{ culture: 'Tomate' }] }] })).toBeNull();
    expect(validerCatalogueEphy(null)).toBeNull();
    expect(validerCatalogueEphy('[]')).toBeNull();
    // Catalogue initial du dépôt : vide, sans date, mais valide.
    expect(validerCatalogueEphy({ ...CATALOGUE, dateBase: null, produits: [] })).toEqual({ ...CATALOGUE, dateBase: null, produits: [] });
  });
});

describe('T53 : recherche « quelques lettres »', () => {
  it('par le nom, sans casse ; autorisés d’abord, puis le nom qui commence par le texte', () => {
    expect(chercherProduitsEphy(CATALOGUE, 'succ').map((p) => p.nom)).toEqual(['SUCCESS 4', 'LE SUCCESSEUR']);
  });

  it('par la substance, sans accents ; le produit retiré après les autorisés', () => {
    expect(chercherProduitsEphy(CATALOGUE, 'soufre').map((p) => p.nom)).toEqual(['THIOVIT JET MICROBILLES', 'SODIEX']);
    expect(chercherProduitsEphy(CATALOGUE, 'micronise').map((p) => p.nom)).toEqual(['SODIEX']);
  });

  it('par un second nom, par l’AMM, par plusieurs mots', () => {
    expect(chercherProduitsEphy(CATALOGUE, 'musdo').map((p) => p.nom)).toEqual(['SUCCESS 4']);
    expect(chercherProduitsEphy(CATALOGUE, '2060098').map((p) => p.nom)).toEqual(['SUCCESS 4']);
    expect(chercherProduitsEphy(CATALOGUE, 'spinosad success').map((p) => p.nom)).toEqual(['SUCCESS 4']);
  });

  it('moins de 2 lettres : rien ; plafond de résultats', () => {
    expect(chercherProduitsEphy(CATALOGUE, 's')).toEqual([]);
    expect(chercherProduitsEphy(CATALOGUE, '  ')).toEqual([]);
    expect(chercherProduitsEphy(CATALOGUE, 'su', 1)).toHaveLength(1);
  });
});

describe('T53 : correspondance espèce → usage', () => {
  it('tomate, fraise, laitue (au moins), sans casse ni accents ni pluriel', () => {
    expect(culturesEphyPourEspece('Tomate')).toContain('Tomate');
    expect(culturesEphyPourEspece('tomates')).toContain('Tomate');
    expect(culturesEphyPourEspece('Tomate cerise')).toContain('Tomate');
    expect(culturesEphyPourEspece('Fraise')).toEqual(['Fraisier']);
    expect(culturesEphyPourEspece('Fraisier')).toEqual(['Fraisier']);
    expect(culturesEphyPourEspece('Laitue')).toContain('Laitue');
    expect(culturesEphyPourEspece('Batavia')).toContain('Laitue');
    expect(culturesEphyPourEspece('Salade')).toContain('Laitue');
  });

  it('les cultures de la ferme : kiwi, pivoine, asperge ; les légumes couverts par « Cultures légumières »', () => {
    expect(culturesEphyPourEspece('Kiwi')).toEqual(['Kiwi']);
    expect(culturesEphyPourEspece('Pivoine')).toEqual(['Cultures florales et plantes vertes']);
    expect(culturesEphyPourEspece('Asperge')).toContain('Asperge');
    expect(culturesEphyPourEspece('Tomate')).toContain('Cultures légumières');
    expect(culturesEphyPourEspece('Laitue')).toContain('Cultures légumières');
    // La fraise n'est pas rangée dans les cultures légumières : pas de DAR emprunté à un autre usage.
    expect(culturesEphyPourEspece('Fraise')).not.toContain('Cultures légumières');
    expect(culturesEphyPourEspece('Kiwi')).not.toContain('Cultures légumières');
  });

  it('espèce inconnue : son propre nom seulement (aucune devinette)', () => {
    expect(culturesEphyPourEspece('Poireau')).toEqual(['Poireau', 'Cultures légumières']);
    expect(culturesEphyPourEspece('Plante mystère')).toEqual(['Plante mystère']);
  });

  it('usages d’un produit pour les espèces de la ferme', () => {
    expect(usagesPourEspeces(SUCCESS, ['Tomate'])).toEqual([SUCCESS.usages[0], SUCCESS.usages[1]]);
    expect(usagesPourEspeces(SUCCESS, ['Fraise', 'Laitue'])).toEqual([SUCCESS.usages[2], SUCCESS.usages[3]]);
    expect(usagesPourEspeces(SUCCESS, ['Kiwi'])).toEqual([]);
    expect(usagesPourEspeces(THIOVIT, ['Tomate'])).toEqual(THIOVIT.usages);
    expect(usagesPourEspeces(SUCCESSEUR, ['Pivoine'])).toEqual([SUCCESSEUR.usages[1]]);
  });
});

describe('T53 : DAR proposé selon l’usage', () => {
  it('une seule culture, DAR identique pour tous ses usages : DAR proposé ; doses différentes : pas de dose', () => {
    expect(propositionUsage(SUCCESS, ['Tomate'])).toEqual({ candidats: [SUCCESS.usages[0], SUCCESS.usages[1]], dar: 3, dose: null });
  });

  it('un seul usage : DAR et dose proposés', () => {
    expect(propositionUsage(SUCCESS, ['Fraise'])).toEqual({ candidats: [SUCCESS.usages[2]], dar: 1, dose: { valeur: 0.2, unite: 'L/ha' } });
  });

  it('DAR différents (tomate 3 j, fraise 1 j) : rien de proposé, l’utilisateur choisit l’usage', () => {
    expect(propositionUsage(SUCCESS, ['Tomate', 'Fraise'])).toEqual({ candidats: [SUCCESS.usages[0], SUCCESS.usages[1], SUCCESS.usages[2]], dar: null, dose: null });
  });

  it('aucun usage pour les cultures de la ferme, ou DAR non précisé : rien de proposé', () => {
    expect(propositionUsage(SUCCESS, ['Kiwi'])).toEqual({ candidats: [], dar: null, dose: null });
    expect(propositionUsage(SUCCESS, [])).toEqual({ candidats: [], dar: null, dose: null });
    expect(propositionUsage(SOUFRE, ['Melon'])).toEqual({ candidats: SOUFRE.usages, dar: null, dose: { valeur: 0.2, unite: 'L/ha' } });
  });
});

/**
 * Tests d'acceptation T75 (docs/backlog/T75-ephy-cultures-2026.md) : les noms de cultures du
 * catalogue réel du 2026-10-20 (« Tomate - Aubergine », « Cucurbitacées à peau comestible »…).
 * Un faux négatif est grave, un faux positif (DAR d'une autre culture) plus encore.
 */
const LEG = 'Cultures légumières';

describe('T75 : espèces de la ferme → noms de cultures e-phy de 2026', () => {
  it('tomate et aubergine → « Tomate - Aubergine » (l’ancienne forme reste acceptée, chacune la sienne)', () => {
    expect(culturesEphyPourEspece('Tomate')).toEqual(['Tomate - Aubergine', 'Tomate', LEG]);
    expect(culturesEphyPourEspece('Aubergine')).toEqual(['Tomate - Aubergine', 'Aubergine', LEG]);
    expect(culturesEphyPourEspece('Aubergine')).not.toContain('Tomate');
  });

  it('fraise → « Fraisier » ; laitue, batavia, salade → « Laitue »', () => {
    expect(culturesEphyPourEspece('Fraise')).toEqual(['Fraisier']);
    for (const e of ['Laitue', 'Batavia', 'Salade', 'Romaine', 'Feuille de chêne']) expect(culturesEphyPourEspece(e)).toEqual(['Laitue', LEG]);
  });

  it('courgette, concombre → peau comestible ; melon, pastèque → peau non comestible', () => {
    expect(culturesEphyPourEspece('Courgette')).toEqual(['Cucurbitacées à peau comestible', 'Courgette', LEG]);
    expect(culturesEphyPourEspece('Concombre')).toEqual(['Cucurbitacées à peau comestible', 'Concombre', LEG]);
    expect(culturesEphyPourEspece('Melon')).toEqual(['Cucurbitacées à peau non comestible', 'Melon', LEG]);
    expect(culturesEphyPourEspece('Pastèque')).toEqual(['Cucurbitacées à peau non comestible', 'Pastèque', LEG]);
    expect(culturesEphyPourEspece('Potimarron')).toEqual(['Cucurbitacées à peau non comestible', LEG]);
    expect(culturesEphyPourEspece('Courge butternut')).toEqual(['Cucurbitacées à peau non comestible', LEG]);
  });

  it('choux : chacun sa famille, plus « Choux » (générique) ; « Chou » seul : le générique seulement', () => {
    expect(culturesEphyPourEspece('Chou pommé')).toEqual(['Choux pommés', 'Choux', LEG]);
    expect(culturesEphyPourEspece('Chou kale')).toEqual(['Choux feuillus', 'Choux', LEG]);
    expect(culturesEphyPourEspece('Kale')).toEqual(['Choux feuillus', 'Choux', LEG]);
    expect(culturesEphyPourEspece('Brocoli')).toEqual(['Choux à inflorescence', 'Choux', LEG]);
    expect(culturesEphyPourEspece('Chou-fleur')).toEqual(['Choux à inflorescence', 'Choux', LEG]);
    expect(culturesEphyPourEspece('Chou fleur')).toEqual(['Choux à inflorescence', 'Choux', LEG]);
    expect(culturesEphyPourEspece('Chou-rave')).toEqual(['Choux-raves', 'Choux', LEG]);
    expect(culturesEphyPourEspece('Chou')).toEqual(['Choux', LEG]);
  });

  it('haricot vert → « Haricots et pois non écossés frais », casse indifférente', () => {
    expect(culturesEphyPourEspece('Haricot vert')).toEqual(['Haricots et pois non écossés frais', LEG]);
    const p: ProduitEphy = { ...SUCCESS, usages: [u('Haricots et Pois non écossés frais', 'Thrips', 3), u('Haricots et pois non écossés frais', 'Pucerons', 3), u('Haricots et Pois écossés frais', 'Thrips', 7)] };
    expect(usagesPourEspeces(p, ['Haricots verts'])).toEqual([p.usages[0], p.usages[1]]);
    expect(propositionUsage(p, ['Haricot vert']).dar).toBe(3);
  });

  it('kiwi → « Kiwi » ; pivoine → « Cultures florales et plantes vertes »', () => {
    expect(culturesEphyPourEspece('Kiwi')).toEqual(['Kiwi']);
    expect(culturesEphyPourEspece('Pivoine')).toEqual(['Cultures florales et plantes vertes']);
  });

  it('asperge, carotte, poivron, poireau, oignon, épinard, betterave : nom exact de 2026', () => {
    expect(culturesEphyPourEspece('Asperge')).toEqual(['Asperge', LEG]);
    expect(culturesEphyPourEspece('Carotte')).toEqual(['Carotte', LEG]);
    expect(culturesEphyPourEspece('Poivron')).toEqual(['Poivron', LEG]);
    expect(culturesEphyPourEspece('Poireau')).toEqual(['Poireau', LEG]);
    expect(culturesEphyPourEspece('Oignon')).toEqual(['Oignon', LEG]);
    expect(culturesEphyPourEspece('Épinard')).toEqual(['Epinard', LEG]);
    expect(culturesEphyPourEspece('Betterave')).toEqual(['Betterave potagère', LEG]);
    expect(culturesEphyPourEspece('Betterave potagère')).toEqual(['Betterave potagère', LEG]);
  });

  it('Success 4 (usages du catalogue réel) : tomate → « Tomate - Aubergine », DAR 3 j ; jamais le DAR d’une autre culture', () => {
    const success2026: ProduitEphy = {
      ...SUCCESS,
      usages: [u('Poivron', 'Thrips', 3), u('Tomate - Aubergine', 'Chenilles phytophages', 3), u('Tomate - Aubergine', 'Thrips', 3), u('Artichaut', 'Chenilles phytophages', 7), u('Fraisier', 'Thrips', 3), u('Cucurbitacées à peau non comestible', 'Thrips', 3), u('Oignon', 'Thrips', 7), u('Bananier', 'Thrips', 56)],
    };
    expect(propositionUsage(success2026, ['Tomate'])).toEqual({ candidats: [success2026.usages[1], success2026.usages[2]], dar: 3, dose: { valeur: 0.2, unite: 'L/ha' } });
    expect(usagesPourEspeces(success2026, ['Courgette'])).toEqual([]);
    expect(usagesPourEspeces(success2026, ['Melon'])).toEqual([success2026.usages[5]]);
    expect(usagesPourEspeces(success2026, ['Kiwi', 'Pivoine'])).toEqual([]);
  });
});

describe('T75 : cohérence avec le catalogue réel (liste figée du 2026-10-20)', () => {
  const reels = new Set(CULTURES_EPHY_2026);
  const anciennes = new Set(ANCIENNES_FORMES);

  it('la fixture a les 126 cultures, sans doublon', () => {
    expect(CULTURES_EPHY_2026).toHaveLength(126);
    expect(reels.size).toBe(126);
  });

  it('chaque culture visée par CORRESPONDANCES existe dans le catalogue, hors anciennes formes déclarées', () => {
    const absentes = Object.entries(CORRESPONDANCES).flatMap(([espece, cultures]) => cultures.filter((c) => !anciennes.has(c) && !reels.has(c)).map((c) => `${espece} → ${c}`));
    expect(absentes).toEqual([]);
  });

  it('chaque espèce garde au moins une culture du catalogue réel ; une ancienne forme n’est pas un nom actuel', () => {
    for (const [espece, cultures] of Object.entries(CORRESPONDANCES)) expect(cultures.some((c) => reels.has(c)), espece).toBe(true);
    for (const c of ANCIENNES_FORMES) expect(reels.has(c), c).toBe(false);
  });
});

describe('T75 : repli « premier mot » encadré', () => {
  it('têtes sûres : la variété garde la culture de l’espèce', () => {
    expect(culturesEphyPourEspece('Tomate cerise')).toEqual(culturesEphyPourEspece('Tomate'));
    expect(culturesEphyPourEspece('Tomates anciennes')).toEqual(culturesEphyPourEspece('Tomate'));
    expect(culturesEphyPourEspece('Batavia de printemps')).toEqual(['Laitue', LEG]);
    expect(culturesEphyPourEspece('Fraise des bois')).toEqual(['Fraisier']);
    expect(culturesEphyPourEspece('Poireau perpétuel')).toEqual(['Poireau', LEG]);
  });

  it('« Melon d’eau » est la pastèque, jamais « Melon »', () => {
    expect(culturesEphyPourEspece('Melon d’eau')).toEqual(['Cucurbitacées à peau non comestible', 'Pastèque', LEG]);
    expect(culturesEphyPourEspece("Melon d'eau")).not.toContain('Melon');
    const p: ProduitEphy = { ...SUCCESS, usages: [u('Melon', 'Oïdium(s)', 3)] };
    expect(usagesPourEspeces(p, ['Melon d’eau'])).toEqual([]);
  });

  it('hors des têtes sûres, ou exception connue : aucun rattachement deviné (son propre nom seulement)', () => {
    expect(culturesEphyPourEspece('Chou chinois')).not.toContain('Choux pommés');
    expect(culturesEphyPourEspece('Chou de Chine')).toEqual(['Chou de Chine']);
    expect(culturesEphyPourEspece('Tomate en arbre')).toEqual(['Tomate en arbre']);
    expect(culturesEphyPourEspece('Salade de blé')).toEqual(['Salade de blé']);
    expect(culturesEphyPourEspece('Kiwi de Sibérie')).toEqual(['Kiwi de Sibérie']);
    expect(culturesEphyPourEspece('Asperge des bois')).toEqual(['Asperge des bois']);
    expect(culturesEphyPourEspece('Épinard fraise')).toEqual(['Épinard fraise']);
    expect(culturesEphyPourEspece('Pois chiche')).toEqual(['Pois chiche']);
    expect(culturesEphyPourEspece('Betterave sucrière')).toEqual(['Betterave sucrière']);
  });
});
