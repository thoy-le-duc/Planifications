/**
 * Tests d'acceptation T78 — un même produit sur plusieurs cultures en une saisie
 * (docs/backlog/T78-traitement-plusieurs-cultures.md). Cœur seul : aucune base, aucun réseau,
 * aucune horloge.
 *
 * ── API cœur demandée (minimale) ────────────────────────────────────────────────────────────
 *
 * 1. `propositionsPourCultures(produit, cultures)` — dans ./ephy.ts (donc `@planif/core/ephy`,
 *    pas dans l'index du cœur, comme `propositionUsagePourCulture`). `cultures` : liste de
 *    `{ id, espece }` (id = série ou campagne). Rend UN élément par entrée, dans l'ordre d'entrée,
 *    sans fusionner deux cultures de même espèce : `{ id, espece, ...propositionUsagePourCulture(produit, espece) }`
 *    (`homologue`, `candidats`, `dar`, `dose`). Chaque culture n'est jugée que sur son propre usage
 *    E-Phy : le DAR d'une culture ne déteint jamais sur une autre (règle 2) ; DAR absent d'E-Phy :
 *    null, jamais deviné (Q47, règle 4). Pur.
 *
 * 2. `detailsLotTraitement(produit, commun, date, cultures)` — dans l'index du cœur
 *    (`@planif/core`, ./index.ts). `produit` : { id, nomCommercial, doseMaximale } (ProduitPourTraitement
 *    sans DAR utile : le DAR de la fiche n'est JAMAIS repris, chaque culture donne le sien) ;
 *    `commun` : { dose, cible, operateur } (communs à tout le lot) ; `date` : jour du traitement ;
 *    `cultures` : [{ cultureId, surfaceTraiteeM2, delaiAvantRecolteJours: number | null }].
 *    Rend `Resultat<[{ cultureId, detail: DetailTraitement }]>`, un détail par culture, dans l'ordre
 *    d'entrée, chacun construit comme `detailTraitement` (DAR figé : recolteAutoriseeLe = date + DAR
 *    de CETTE culture ; dose, cible, opérateur communs ; surface propre). Tout ou rien :
 *      - lot vide                          → erreur 'lot_vide' ;
 *      - DAR null (manquant)               → erreur 'dar_manquant', champ = cultureId de la première fautive ;
 *      - DAR non entier, < 0 ou > 365      → erreur 'dar_invalide', champ = cultureId ;
 *      - même cultureId deux fois          → erreur 'culture_en_double', champ = cultureId.
 *    Une seule culture fautive suffit à tout refuser (aucun détail rendu). Pur, ne modifie pas ses entrées.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as ephy from './ephy.ts';
import type { ProduitEphy, UsageEphy } from './ephy.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { chargerPhyto, type ModulePhyto, type TraitementLu } from './test/contrat.ts';

// ───────────────────────────── 1. propositionsPourCultures ─────────────────────────────

interface Ligne {
  readonly id: string;
  readonly espece: string;
  readonly homologue: boolean;
  readonly candidats: readonly UsageEphy[];
  readonly dar: number | null;
  readonly dose: { readonly valeur: number; readonly unite: string } | null;
}
const propositions = (ephy as unknown as { propositionsPourCultures?: (p: ProduitEphy, c: readonly { id: string; espece: string }[]) => readonly Ligne[] }).propositionsPourCultures;
function pourCultures(p: ProduitEphy, c: readonly { id: string; espece: string }[]): readonly Ligne[] {
  if (propositions === undefined) throw new Error('@planif/core/ephy n’exporte pas encore propositionsPourCultures (T78)');
  return propositions(p, c);
}

const u = (culture: string, cible: string, dar: number | null, dose: UsageEphy['dose'] = { valeur: 0.2, unite: 'L/ha' }): UsageEphy => ({ culture, mode: 'Trt Part.Aer.', cible, dose, dar });
const produit = (usages: readonly UsageEphy[]): ProduitEphy => ({ amm: '2060098', nom: 'DECIS PROTECH', autresNoms: [], substances: ['deltaméthrine'], bio: false, retire: false, retireLe: null, usages });
const TOMATE = { id: 'serie-tomate', espece: 'Tomate' };
const FRAISE = { id: 'campagne-fraise', espece: 'Fraise' };

describe('T78 cœur : le DAR E-Phy de chaque culture du lot, jamais celui d’une autre', () => {
  const DECIS = produit([u('Tomate - Aubergine', 'Thrips', 3), u('Fraisier', 'Thrips', 1)]);

  it('produit homologué sur tomate (DAR 3) et fraise (DAR 1) : un DAR par culture, dans l’ordre demandé', () => {
    const r = pourCultures(DECIS, [TOMATE, FRAISE]);
    expect(r.map((x) => [x.id, x.homologue, x.dar])).toEqual([
      ['serie-tomate', true, 3],
      ['campagne-fraise', true, 1],
    ]);
    expect(pourCultures(DECIS, [FRAISE, TOMATE]).map((x) => x.dar)).toEqual([1, 3]);
  });

  it('chaque élément est la proposition T76 de sa culture, plus son id et son espèce', () => {
    for (const c of [TOMATE, FRAISE]) {
      const attendu = ephy.propositionUsagePourCulture(DECIS, c.espece);
      expect(pourCultures(DECIS, [TOMATE, FRAISE]).find((x) => x.id === c.id)).toEqual({ id: c.id, espece: c.espece, ...attendu });
    }
  });

  it('une culture non homologuée : elle seule est signalée (homologue faux, DAR et dose vides), les autres inchangées', () => {
    const fraisierSeul = produit([u('Fraisier', 'Thrips', 1)]);
    const r = pourCultures(fraisierSeul, [TOMATE, FRAISE]);
    expect(r[0]).toEqual({ id: 'serie-tomate', espece: 'Tomate', homologue: false, candidats: [], dar: null, dose: null });
    expect(r[1]).toEqual({ id: 'campagne-fraise', espece: 'Fraise', ...ephy.propositionUsagePourCulture(fraisierSeul, 'Fraise') });
    expect(r[1]?.dar).toBe(1);
    // Ajouter ou retirer la tomate du lot ne change pas la proposition de la fraise.
    expect(pourCultures(fraisierSeul, [FRAISE])[0]).toEqual(r[1]);
  });

  it('Q47 par culture : DAR absent d’E-Phy pour la tomate = vide (homologuée, mais jamais deviné ni repris de la fraise) ; la fraise garde son DAR', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', null), u('Fraisier', 'Thrips', 1)]);
    const r = pourCultures(p, [TOMATE, FRAISE]);
    expect(r[0]).toMatchObject({ homologue: true, dar: null });
    expect(r[1]).toMatchObject({ homologue: true, dar: 1 });
  });

  it('usages de DAR différents pour une culture : pas de DAR proposé pour elle, candidats rendus ; l’autre culture n’en dépend pas', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', 3), u('Tomate - Aubergine', 'Mildiou', 7), u('Fraisier', 'Thrips', 1)]);
    const r = pourCultures(p, [TOMATE, FRAISE]);
    expect(r[0]?.dar).toBeNull();
    expect(r[0]?.candidats).toEqual([p.usages[0], p.usages[1]]);
    expect(r[1]?.dar).toBe(1);
  });

  it('DAR de 0 jour : proposé (0 n’est pas « absent »)', () => {
    expect(pourCultures(produit([u('Kiwi', 'Cochenilles', 0)]), [{ id: 'k', espece: 'Kiwi' }])[0]).toMatchObject({ homologue: true, dar: 0 });
  });

  it('deux cultures de même espèce (deux séries de tomates) : deux éléments, un par id, sans fusion', () => {
    const r = pourCultures(DECIS, [TOMATE, { id: 'serie-tomate-2', espece: 'tomate' }, FRAISE]);
    expect(r.map((x) => x.id)).toEqual(['serie-tomate', 'serie-tomate-2', 'campagne-fraise']);
    expect(r.map((x) => x.dar)).toEqual([3, 3, 1]);
  });

  it('lot vide : liste vide ; produit sans usage : aucune culture homologuée ; le produit n’est pas modifié', () => {
    expect(pourCultures(DECIS, [])).toEqual([]);
    expect(pourCultures(produit([]), [TOMATE, FRAISE]).map((x) => [x.homologue, x.dar])).toEqual([
      [false, null],
      [false, null],
    ]);
    const avant = JSON.stringify(DECIS);
    pourCultures(DECIS, [TOMATE, FRAISE]);
    expect(JSON.stringify(DECIS)).toBe(avant);
  });
});

// ───────────────────────────── 2. detailsLotTraitement ─────────────────────────────

interface DetailLot {
  readonly cultureId: string;
  readonly detail: { readonly produitPhytoId: string; readonly dose: { valeur: number; unite: string }; readonly surfaceTraiteeM2: number; readonly cible: string; readonly operateur: string; readonly recolteAutoriseeLe: string };
}
type ResultatLot = { readonly ok: true; readonly valeur: readonly DetailLot[] } | { readonly ok: false; readonly erreur: { readonly code: string; readonly champ: string | null; readonly message: string } };
interface EntreeCulture {
  readonly cultureId: string;
  readonly surfaceTraiteeM2: number;
  readonly delaiAvantRecolteJours: number | null;
}
type DetailsLot = (
  produit: { id: string; nomCommercial: string; delaiAvantRecolteJours: number; doseMaximale: null },
  commun: { dose: { valeur: number; unite: string }; cible: string; operateur: string | null },
  date: string,
  cultures: readonly EntreeCulture[],
) => ResultatLot;

let m: ModulePhyto;
let brut: { detailsLotTraitement?: DetailsLot };
beforeAll(async () => {
  m = await chargerPhyto();
  brut = (await import(/* @vite-ignore */ '../index.ts')) as typeof brut;
});
/** Échoue test par test (message clair) tant que le cœur n'exporte pas la fonction. */
const detailsLot: DetailsLot = (...a) => {
  if (brut.detailsLotTraitement === undefined) throw new Error('@planif/core n’exporte pas encore detailsLotTraitement (T78)');
  return brut.detailsLotTraitement(...a);
};

const uuid = (n: number): string => `0192f0c1-7878-7000-8000-${n.toString(16).padStart(12, '0')}`;
const DECIS_ID = uuid(0x20);
const PLANCHE_TOMATE = uuid(0x11);
const PLANCHE_FRAISE = uuid(0x12);
const SERIE_TOMATE = uuid(0x30);
const CAMPAGNE_FRAISE = uuid(0x31);
const FICHE = { id: DECIS_ID, nomCommercial: 'Decis Protech', delaiAvantRecolteJours: 9, doseMaximale: null } as const;
const COMMUN = { dose: { valeur: 0.5, unite: 'L/ha' }, cible: ' thrips ', operateur: ' Lucas ' } as const;
const TOMATE_3: EntreeCulture = { cultureId: SERIE_TOMATE, surfaceTraiteeM2: 24, delaiAvantRecolteJours: 3 };
const FRAISE_1: EntreeCulture = { cultureId: CAMPAGNE_FRAISE, surfaceTraiteeM2: 40, delaiAvantRecolteJours: 1 };

const code = (r: ResultatLot): string | undefined => (r.ok ? undefined : r.erreur.code);
const champErreur = (r: ResultatLot): string | null | undefined => (r.ok ? undefined : r.erreur.champ);

function ok(r: ResultatLot): readonly DetailLot[] {
  if (!r.ok) throw new Error(`lot refusé : ${r.erreur.code} (${r.erreur.message})`);
  return r.valeur;
}

describe('T78 cœur : detailsLotTraitement — un détail par culture, DAR figé par culture', () => {
  it('tomate DAR 3 et fraise DAR 1, traitées le 10/05 : récolte autorisée le 13/05 pour la tomate, le 11/05 pour la fraise', () => {
    const r = ok(detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3, FRAISE_1]));
    expect(r.map((x) => x.cultureId)).toEqual([SERIE_TOMATE, CAMPAGNE_FRAISE]);
    expect(r[0]?.detail.recolteAutoriseeLe).toBe('2027-05-13');
    expect(r[1]?.detail.recolteAutoriseeLe).toBe('2027-05-11');
  });

  it('le produit, la dose, la cible et l’opérateur sont communs (cible et opérateur rognés) ; la surface est celle de la culture ; le DAR de la fiche (9 j) n’est pas repris', () => {
    const r = ok(detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3, FRAISE_1]));
    expect(r[0]?.detail).toEqual({ produitPhytoId: DECIS_ID, dose: { valeur: 0.5, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'thrips', operateur: 'Lucas', recolteAutoriseeLe: '2027-05-13' });
    expect(r[1]?.detail).toEqual({ produitPhytoId: DECIS_ID, dose: { valeur: 0.5, unite: 'L/ha' }, surfaceTraiteeM2: 40, cible: 'thrips', operateur: 'Lucas', recolteAutoriseeLe: '2027-05-11' });
  });

  it('chaque détail est celui que produirait detailTraitement pour cette culture seule (même règle qu’une saisie simple)', () => {
    const r = ok(detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3, FRAISE_1]));
    for (const c of [TOMATE_3, FRAISE_1]) {
      const seul = m.detailTraitement({ ...FICHE, delaiAvantRecolteJours: c.delaiAvantRecolteJours ?? -1 }, { dose: COMMUN.dose, surfaceTraiteeM2: c.surfaceTraiteeM2, cible: COMMUN.cible, operateur: COMMUN.operateur }, '2027-05-10' as DateCalendaire);
      expect(r.find((x) => x.cultureId === c.cultureId)?.detail).toEqual(seul);
    }
  });

  it('DAR de 0 jour accepté (récolte le jour même) ; passage de mois et d’année par le calendrier', () => {
    const r = ok(detailsLot(FICHE, COMMUN, '2026-12-30', [{ ...TOMATE_3, delaiAvantRecolteJours: 0 }, { ...FRAISE_1, delaiAvantRecolteJours: 3 }]));
    expect(r.map((x) => x.detail.recolteAutoriseeLe)).toEqual(['2026-12-30', '2027-01-02']);
  });

  it('une seule culture : même résultat qu’une saisie simple (le lot de un)', () => {
    const r = ok(detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3]));
    expect(r).toHaveLength(1);
    expect(r[0]?.detail.recolteAutoriseeLe).toBe('2027-05-13');
  });
});

describe('T78 cœur : detailsLotTraitement — tout ou rien, aucun DAR deviné', () => {
  it('une culture sans DAR (non homologuée, à saisir) : lot refusé « dar_manquant » pour elle, aucun détail même pour les autres ; la fiche (9 j) ne comble pas', () => {
    const r = detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3, { ...FRAISE_1, delaiAvantRecolteJours: null }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur.code).toBe('dar_manquant');
    expect(r.erreur.champ).toBe(CAMPAGNE_FRAISE);
  });

  it('plusieurs fautives : la première dans l’ordre du lot est nommée', () => {
    const r = detailsLot(FICHE, COMMUN, '2027-05-10', [{ ...TOMATE_3, delaiAvantRecolteJours: null }, { ...FRAISE_1, delaiAvantRecolteJours: null }]);
    expect(champErreur(r)).toBe(SERIE_TOMATE);
  });

  it('DAR invalide (négatif, décimal, au-delà de 365 j, NaN) : « dar_invalide » pour la culture fautive', () => {
    for (const mauvais of [-1, 1.5, 366, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3, { ...FRAISE_1, delaiAvantRecolteJours: mauvais }]);
      expect(r.ok, String(mauvais)).toBe(false);
      if (!r.ok) {
        expect(r.erreur.code, String(mauvais)).toBe('dar_invalide');
        expect(r.erreur.champ, String(mauvais)).toBe(CAMPAGNE_FRAISE);
      }
    }
    expect(detailsLot(FICHE, COMMUN, '2027-05-10', [{ ...TOMATE_3, delaiAvantRecolteJours: 365 }]).ok).toBe(true);
  });

  it('lot vide : refusé « lot_vide » ; même culture deux fois : refusé « culture_en_double » (un seul traitement par culture)', () => {
    const vide = detailsLot(FICHE, COMMUN, '2027-05-10', []);
    expect(code(vide)).toBe('lot_vide');
    const double = detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3, { ...TOMATE_3, delaiAvantRecolteJours: 5 }]);
    expect(code(double)).toBe('culture_en_double');
    expect(champErreur(double)).toBe(SERIE_TOMATE);
  });

  it('pur : les entrées ne sont pas modifiées', () => {
    const entree = [TOMATE_3, FRAISE_1];
    const avant = JSON.stringify([FICHE, COMMUN, entree]);
    detailsLot(FICHE, COMMUN, '2027-05-10', entree);
    expect(JSON.stringify([FICHE, COMMUN, entree])).toBe(avant);
  });
});

// ───────────────────────────── 3. blocage de récolte par emplacement ─────────────────────────────

function evenements(details: readonly DetailLot[], emplacements: Readonly<Record<string, string>>): TraitementLu[] {
  return details.map((d, i) => ({
    id: uuid(0x100 + i),
    date: '2027-05-10',
    horodatage: `2027-05-10T08:0${String(i)}:00.000Z`,
    emplacementIds: [emplacements[d.cultureId] ?? ''],
    remplaceSorte: null,
    remplaceEvenementId: null,
    produitPhytoId: d.detail.produitPhytoId,
    recolteAutoriseeLe: d.detail.recolteAutoriseeLe,
    cultureId: d.cultureId,
  }));
}

describe('T78 cœur : le blocage de récolte reste par emplacement et par culture', () => {
  const lot = (): readonly DetailLot[] => ok(detailsLot(FICHE, COMMUN, '2027-05-10', [TOMATE_3, FRAISE_1]));
  const emplacements = { [SERIE_TOMATE]: PLANCHE_TOMATE, [CAMPAGNE_FRAISE]: PLANCHE_FRAISE };

  it('tomate récoltable le 13/05 (pas le 12/05), fraise le 11/05 (pas le 10/05) ; l’une ne bloque pas l’autre', () => {
    const t = evenements(lot(), emplacements);
    expect(m.interdictionRecolte(t, [PLANCHE_TOMATE], '2027-05-12', SERIE_TOMATE)?.recolteAutoriseeLe).toBe('2027-05-13');
    expect(m.interdictionRecolte(t, [PLANCHE_TOMATE], '2027-05-13', SERIE_TOMATE)).toBeNull();
    expect(m.interdictionRecolte(t, [PLANCHE_FRAISE], '2027-05-10', CAMPAGNE_FRAISE)?.recolteAutoriseeLe).toBe('2027-05-11');
    expect(m.interdictionRecolte(t, [PLANCHE_FRAISE], '2027-05-11', CAMPAGNE_FRAISE)).toBeNull();
    // Le 11/05 : fraise libre alors que la tomate est encore sous DAR (le DAR 3 j de la tomate ne retient pas la fraise).
    expect(m.interdictionRecolte(t, [PLANCHE_TOMATE], '2027-05-11', SERIE_TOMATE)).not.toBeNull();
    expect(m.interdictionRecolte(t, [PLANCHE_FRAISE], '2027-05-11', CAMPAGNE_FRAISE)).toBeNull();
  });

  it('annulation du lot (une annulation par événement) : tous les emplacements redeviennent libres ; annuler un seul événement ne libère que le sien', () => {
    const t = evenements(lot(), emplacements);
    const annulation = (i: number): TraitementLu => {
      const o = t[i];
      if (o === undefined) throw new Error('événement attendu');
      return { ...o, id: uuid(0x200 + i), horodatage: `2027-05-10T09:0${String(i)}:00.000Z`, remplaceSorte: 'annulation', remplaceEvenementId: o.id };
    };
    const tout = [...t, annulation(0), annulation(1)];
    expect(m.interdictionRecolte(tout, [PLANCHE_TOMATE], '2027-05-11', SERIE_TOMATE)).toBeNull();
    expect(m.interdictionRecolte(tout, [PLANCHE_FRAISE], '2027-05-10', CAMPAGNE_FRAISE)).toBeNull();
    const moitie = [...t, annulation(0)];
    expect(m.interdictionRecolte(moitie, [PLANCHE_TOMATE], '2027-05-11', SERIE_TOMATE)).toBeNull();
    expect(m.interdictionRecolte(moitie, [PLANCHE_FRAISE], '2027-05-10', CAMPAGNE_FRAISE)?.evenementId).toBe(t[1]?.id);
  });
});
