/**
 * Tests d'acceptation T53 — extraction du catalogue e-phy (docs/backlog/T53-base-e-phy.md, règle 1).
 *
 * Extrait figé (./test/extrait/) : quelques lignes RÉELLES des fichiers `produits` et
 * `produits_usages` publiés par l'Anses sur data.gouv.fr (archive « decisionamm-intrant-format-CSV »,
 * version d'octobre 2020 conservée par le projet d2kab/E-Phy-Ontology), dans leur format : UTF-8
 * (avec BOM pour `produits`), séparateur « ; », fins de ligne CRLF, en-têtes `(produit) …` dans
 * `produits`, coquilles d'origine (« tade cultural max », « date decision » précédé d'une
 * espace), listes séparées par « | », dates JJ/MM/AAAA, nombres à point. Ajouts pour le test, signalés : une
 * ligne en double, un usage passé en « Retrait », un champ entre guillemets sur deux lignes avec
 * « ; » et des guillemets doublés. ./test/extrait-windows-1252/ : le même extrait en Windows-1252.
 *
 * Contrat attendu de ./extraire.ts :
 *   - `extraireCatalogue({ produits, usages, dateBase, retraitGardeAns? })` : textes déjà décodés
 *     → `CatalogueEphy` (@planif/core/ephy). Produits phytopharmaceutiques seuls (type « PPP »),
 *     autorisés, et retirés depuis moins de `retraitGardeAns` ans (3 par défaut) avant `dateBase` ;
 *     usages autorisés (« Autorisé », « Autorisé (Provisoire) ») pour un produit autorisé, tous ses
 *     usages pour un produit retiré ; doublons retirés.
 *   - `decoderCsv(octets)` : UTF-8 (BOM retiré), sinon Windows-1252.
 *   - `trouverFichiers(noms)` : repère `produits` et `produits_usages` quel que soit le suffixe
 *     (`_utf8`, `_v3_utf8`, `_windows-1252`, majuscules, `.CSV`).
 *   - `ecrireCatalogue(dossier, sortie, dateBase)` : lit le dossier décompressé, écrit le JSON.
 *   - `ErreurFormatEphy` : colonne ou fichier introuvable, message qui le nomme.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { validerCatalogueEphy, type CatalogueEphy, type ProduitEphy } from '@planif/core/ephy';
import { decoderCsv, ecrireCatalogue, ErreurFormatEphy, extraireCatalogue, refusCatalogue, trouverFichiers } from './extraire.ts';

const EXTRAIT = fileURLToPath(new URL('./test/extrait/', import.meta.url));
const EXTRAIT_1252 = fileURLToPath(new URL('./test/extrait-windows-1252/', import.meta.url));
const DATE_BASE = '2020-10-15';

const texte = (dossier: string, nom: string): string => decoderCsv(readFileSync(join(dossier, nom)));

function catalogue(dossier = EXTRAIT, produits = 'produits_utf8.csv', usages = 'produits_usages_utf8.csv'): CatalogueEphy {
  return extraireCatalogue({ produits: texte(dossier, produits), usages: texte(dossier, usages), dateBase: DATE_BASE });
}

function produit(c: CatalogueEphy, amm: string): ProduitEphy {
  const p = c.produits.find((x) => x.amm === amm);
  if (p === undefined) throw new Error(`produit ${amm} absent du catalogue`);
  return p;
}

const temporaires: string[] = [];
afterEach(() => {
  for (const d of temporaires.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('T53 : extraction du catalogue e-phy sur l’extrait figé', () => {
  it('produit autorisé : nom, AMM, seconds noms, substances lisibles, mention bio', () => {
    const p = produit(catalogue(), '2060098');
    expect(p).toMatchObject({ amm: '2060098', nom: 'SUCCESS 4', autresNoms: ['MUSDO 4'], substances: ['spinosad 480 g/L'], bio: true, retire: false, retireLe: null });
    // « Production biologique amateur » n'est pas « Utilisable en agriculture biologique ».
    expect(produit(catalogue(), '2000125').bio).toBe(false);
    expect(produit(catalogue(), '2010509')).toMatchObject({ bio: true, substances: ['sulfate de cuivre 20 %'] });
  });

  it('usages : culture × cible, dose retenue, DAR en jours ; DAR absent (stade BBCH seul) → null', () => {
    const p = produit(catalogue(), '2060098');
    const tomate = p.usages.filter((u) => u.culture === 'Tomate');
    expect(tomate).toEqual([
      { culture: 'Tomate', mode: 'Trt Part.Aer.', cible: 'Chenilles phytophages', dose: { valeur: 0.015, unite: 'L/hL' }, dar: 3 },
      { culture: 'Tomate', mode: 'Trt Part.Aer.', cible: 'Thrips', dose: { valeur: 0.02, unite: 'L/hL' }, dar: 3 },
      // La ligne en double de l'extrait n'apparaît qu'une fois.
      { culture: 'Tomate', mode: 'Trt Part.Aer.', cible: 'Thrips', dose: { valeur: 0.2, unite: 'L/ha' }, dar: 3 },
    ]);
    expect(p.usages.find((u) => u.culture === 'Fraisier')).toEqual({ culture: 'Fraisier', mode: 'Trt Part.Aer.', cible: 'Thrips', dose: { valeur: 0.2, unite: 'L/ha' }, dar: 3 });
    // Champ entre guillemets sur deux lignes, avec « ; » : la ligne suivante est bien lue.
    expect(p.usages.find((u) => u.culture === 'Laitue')?.dar).toBe(3);
    // « Autorisé (Provisoire) » compte comme autorisé ; DAR exprimé en stade BBCH seulement → null.
    expect(p.usages.find((u) => u.culture === 'Maïs')).toEqual({ culture: 'Maïs', mode: 'Trt Part.Aer.', cible: 'Pyrale(s) (1)', dose: { valeur: 0.2, unite: 'L/ha' }, dar: null });
    // Usage retiré d'un produit autorisé : absent.
    expect(p.usages.some((u) => u.culture === 'Vigne')).toBe(false);
    expect(p.usages).toHaveLength(6);
    // Usage sans mode (« Maïs*Désherbage ») et sans DAR.
    expect(produit(catalogue(), '2090080').usages).toEqual([{ culture: 'Maïs', mode: '', cible: 'Désherbage', dose: { valeur: 1.5, unite: 'L/ha' }, dar: null }]);
  });

  it('retrait : produit retiré récemment gardé avec sa date et ses usages ; retiré depuis plus de 3 ans, absent', () => {
    const c = catalogue();
    const sodiex = produit(c, '9200352');
    expect(sodiex).toMatchObject({ nom: 'SODIEX', retire: true, retireLe: '2020-09-22', bio: true, substances: ['soufre micronisé 80 %'] });
    expect(sodiex.usages).toEqual([
      { culture: 'Melon', mode: 'Trt Part.Aer.', cible: 'Oïdium(s)', dose: { valeur: 7.5, unite: 'kg/ha' }, dar: null },
      { culture: 'Vigne', mode: 'Trt Part.Aer.', cible: 'Acariens', dose: null, dar: null },
    ]);
    // DIMATE BF 400, retiré le 01/02/2016 : plus de 3 ans avant la date de la base.
    expect(c.produits.some((p) => p.amm === '8800006')).toBe(false);
    const ancien = extraireCatalogue({ produits: texte(EXTRAIT, 'produits_utf8.csv'), usages: texte(EXTRAIT, 'produits_usages_utf8.csv'), dateBase: DATE_BASE, retraitGardeAns: 5 });
    expect(produit(ancien, '8800006')).toMatchObject({ retire: true, retireLe: '2016-02-01', autresNoms: ['DANADIM PROGRESS', 'DANADIM SUPER', 'ROGOR PLUS'], substances: ['diméthoate 400 g/L'] });
  });

  it('produits phytopharmaceutiques seuls ; champ entre guillemets (seconds noms) découpé proprement', () => {
    const c = catalogue();
    expect(c.produits.some((p) => p.amm === '9700095')).toBe(false);
    expect(produit(c, '2090080').autresNoms).toEqual(['VENEUR', 'MI K ZEA', 'RIKKI', 'SULCOTRINA']);
    expect(c.produits.map((p) => p.amm).sort()).toEqual(['2000125', '2010509', '2060098', '2090080', '9200352']);
  });

  it('catalogue : source citée, date de la base, valide pour l’appli, trié par nom', () => {
    const c = catalogue();
    expect(c.format).toBe(1);
    expect(c.dateBase).toBe(DATE_BASE);
    expect(c.source).toMatch(/E-Phy/);
    expect(c.source).toMatch(/Anses/);
    expect(c.licence).toMatch(/Licence Ouverte/);
    expect(validerCatalogueEphy(JSON.parse(JSON.stringify(c)))).toEqual(c);
    const noms = c.produits.map((p) => p.nom);
    expect(noms).toEqual([...noms].sort((a, b) => a.localeCompare(b, 'fr')));
  });

  it('Windows-1252 : même catalogue que l’UTF-8', () => {
    expect(catalogue(EXTRAIT_1252, 'produits_windows-1252.csv', 'produits_usages_windows-1252.csv')).toEqual(catalogue());
  });
});

describe('T53 : format tolérant, erreurs claires', () => {
  it('colonnes repérées par leur nom, dans n’importe quel ordre, sans préfixe « (produit) »', () => {
    const lignes = texte(EXTRAIT, 'produits_utf8.csv').split(/\r?\n/);
    const enTete = (lignes[0] ?? '').split(';').map((c) => c.replace('(produit) ', ''));
    // On permute deux colonnes (nom produit ↔ numéro AMM) dans l'en-tête ET dans chaque ligne.
    const permuter = (l: string): string => {
      const c = l.split(';');
      [c[1], c[2]] = [c[2] ?? '', c[1] ?? ''];
      return c.join(';');
    };
    const produits = [permuter(enTete.join(';')), ...lignes.slice(1).filter((l) => !l.includes('"')).map(permuter)].join('\n');
    const c = extraireCatalogue({ produits, usages: texte(EXTRAIT, 'produits_usages_utf8.csv'), dateBase: DATE_BASE });
    expect(produit(c, '2060098').nom).toBe('SUCCESS 4');
  });

  it('colonne attendue absente : ErreurFormatEphy qui nomme la colonne et le fichier', () => {
    const usages = texte(EXTRAIT, 'produits_usages_utf8.csv').replace('delai avant recolte jour', 'delai inconnu');
    let erreur: unknown = null;
    try {
      extraireCatalogue({ produits: texte(EXTRAIT, 'produits_utf8.csv'), usages, dateBase: DATE_BASE });
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeInstanceOf(ErreurFormatEphy);
    expect((erreur as Error).message).toMatch(/delai avant recolte jour/);
    expect((erreur as Error).message).toMatch(/produits_usages/);
  });

  it('fichiers repérés quel que soit le suffixe ; fichier absent : erreur claire', () => {
    expect(trouverFichiers(['substance_active_utf8.csv', 'produits_usages_v3_utf8.csv', 'produits_v3_utf8.csv', 'usages_des_produits_autorises_utf8.csv'])).toEqual({
      produits: 'produits_v3_utf8.csv',
      usages: 'produits_usages_v3_utf8.csv',
    });
    expect(trouverFichiers(['PRODUITS_USAGES.CSV', 'produits.CSV'])).toEqual({ produits: 'produits.CSV', usages: 'PRODUITS_USAGES.CSV' });
    expect(() => trouverFichiers(['produits_utf8.csv'])).toThrow(ErreurFormatEphy);
    expect(() => trouverFichiers(['produits_utf8.csv'])).toThrow(/produits_usages/);
  });

  it('ecrireCatalogue : lit le dossier décompressé, écrit un JSON valide et rend le nombre de produits', () => {
    const d = mkdtempSync(join(tmpdir(), 'ephy-'));
    temporaires.push(d);
    const sortie = join(d, 'catalogue.json');
    const r = ecrireCatalogue(EXTRAIT, sortie, DATE_BASE);
    expect(r.produits).toBe(5);
    const lu: unknown = JSON.parse(readFileSync(sortie, 'utf8'));
    expect(validerCatalogueEphy(lu)).toEqual(catalogue());
  });
});

describe('T53 : garde-fou du workflow (un format mal lu ne remplace pas le catalogue)', () => {
  it('trop peu de produits : refus', () => {
    expect(refusCatalogue({ produits: 999, usages: 9000 }, null, 1000)).toMatch(/999 produits/);
    expect(refusCatalogue({ produits: 1000, usages: 9000 }, null, 1000)).toBeNull();
  });

  it('produits lus mais usages perdus (colonne ou AMM mal lus) : refus', () => {
    expect(refusCatalogue({ produits: 2300, usages: 0 }, null, 1000)).toMatch(/usages/);
    expect(refusCatalogue({ produits: 2300, usages: 2299 }, null, 1000)).toMatch(/usages/);
  });

  it('chute brutale par rapport au catalogue en place : refus ; catalogue initial vide : accepté', () => {
    expect(refusCatalogue({ produits: 1500, usages: 15000 }, { produits: 2337 }, 1000)).toMatch(/2337/);
    expect(refusCatalogue({ produits: 2200, usages: 19000 }, { produits: 2337 }, 1000)).toBeNull();
    expect(refusCatalogue({ produits: 2200, usages: 19000 }, { produits: 0 }, 1000)).toBeNull();
  });
});
