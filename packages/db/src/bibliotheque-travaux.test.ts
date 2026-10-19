/**
 * Tests d'acceptation T42 — la bibliothèque complétée : travaux prévus pour chacun des 46
 * itinéraires, écartements des semis directs de graines « comptables », et la migration de
 * bibliothèque qui les porte en base (docs/backlog/T42-bibliotheque-travaux.md).
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * JSON (packages/db/bibliotheque/depart.json) : chaque itinéraire porte `travauxPrevus`, une liste
 *   au format `TravailPrevu` du cœur (T22), toutes les clés écrites (null pour les facultatives) :
 *   { categorie, type, repere, decalageJours, repetition: { tousLesJours, repereFin } | null,
 *     outil, produit: { nom, quantite: { valeur, unite } } | null, tempsEstime | null }.
 *   Types : la liste de départ (TYPES_INTERVENTION_PAR_DEFAUT), sous leur catégorie.
 *   Un semis direct à l'écartement porte `grainesParPoquet` (entier ≥ 1).
 *
 * Conversion (convertirBibliotheque) : `parametres.travauxPrevus` = la liste du JSON, telle que
 *   validerTravauxPrevus la normalise (rien de perdu, rien d'ajouté).
 *
 * Migration : `0034_bibliotheque_travaux`, écrite par `pnpm --filter @planif/db bibliotheque
 *   0034_bibliotheque_travaux` (mécanique de T41b), ne modifie que des itinéraires (aucune
 *   famille ni espèce, rien d'ajouté ni de retiré), et c'est la dernière migration de bibliothèque.
 */
import { readdirSync, readFileSync } from 'node:fs';
import {
  calculerDatesSerie,
  datesTravailPrevu,
  PARAMETRES_SERIE_OCTETS,
  TYPES_INTERVENTION_PAR_DEFAUT,
  validerTravauxPrevus,
  type DateCalendaire,
  type TravailPrevu,
} from '@planif/core';
import { describe, expect, it } from 'vitest';
import * as db from './index.ts';

const MIGRATION_TRAVAUX = '0034_bibliotheque_travaux';

const source = db.lireBibliothequeDepart();
const lignes = db.convertirBibliotheque(source);

/** Les types de la liste de départ, au format attendu par validerTravauxPrevus. */
const TYPES_DEPART = Object.entries(TYPES_INTERVENTION_PAR_DEFAUT).flatMap(([categorie, types]) => types.map((type) => ({ categorie, type })));

type SourceAvecTravaux = db.SourceItineraire & { readonly travauxPrevus?: unknown };

const travauxSource = (i: db.SourceItineraire): unknown => (i as SourceAvecTravaux).travauxPrevus;

function travauxDe(nom: string): readonly TravailPrevu[] {
  const l = lignes.itineraires.find((i) => i.nom === nom);
  if (l === undefined) throw new Error(`itinéraire « ${nom} » absent`);
  return l.parametres.travauxPrevus ?? [];
}

const avecType = (travaux: readonly TravailPrevu[], type: string): readonly TravailPrevu[] => travaux.filter((t) => t.type === type);

/** Texte sans accents ni casse. */
const plat = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

describe('T42 : travaux prévus pour chacun des 46 itinéraires', () => {
  it.each(source.itineraires.map((i) => [i.nom, i] as const))('%s : au moins 3 travaux, valides pour le cœur avec la liste de départ', (_nom, i) => {
    const brut = travauxSource(i);
    expect(Array.isArray(brut), `travauxPrevus de ${i.nom} dans le JSON`).toBe(true);
    const r = validerTravauxPrevus(brut, { mode: i.mode, typesIntervention: TYPES_DEPART });
    expect(r.ok ? null : r.erreur, `travaux de ${i.nom}`).toBeNull();
    if (!r.ok) return;
    expect(r.valeur.length, `travaux de ${i.nom}`).toBeGreaterThanOrEqual(3);
    expect(r.valeur, 'écrits sous leur forme normalisée (toutes les clés)').toEqual(brut);
    for (const t of r.valeur) {
      if (t.categorie === 'fertilisation' || t.categorie === 'amendement') {
        expect(t.produit?.nom.trim(), `produit d’un travail ${t.type} de ${i.nom}`).toBeTruthy();
        expect(t.produit?.quantite.valeur, `quantité d’un travail ${t.type} de ${i.nom}`).toBeGreaterThan(0);
      } else expect(t.produit, `pas de produit hors fertilisation et amendement (${t.type}, ${i.nom})`).toBeNull();
    }
  });

  it.each(lignes.itineraires.map((i) => [i.nom, i] as const))('%s : un amendement, une préparation du sol avant la mise en place, un entretien', (_nom, i) => {
    const t = i.parametres.travauxPrevus ?? [];
    expect(t.some((x) => x.categorie === 'amendement'), 'amendement (compost…)').toBe(true);
    expect(t.some((x) => x.categorie === 'travail_sol' && x.repere === 'mise_en_place' && x.decalageJours <= 0), 'travail du sol avant la mise en place').toBe(true);
    expect(t.some((x) => x.categorie === 'entretien'), 'entretien (désherbage…)').toBe(true);
  });

  it.each(lignes.itineraires.map((i) => [i.nom, i] as const))('%s : converti tel quel, tient dans l’instantané d’une série, dates calculables', (nom, i) => {
    const s = source.itineraires.find((x) => x.nom === nom);
    expect(i.parametres.travauxPrevus, 'parametres.travauxPrevus = la liste du JSON').toEqual(s === undefined ? undefined : travauxSource(s));
    expect(new TextEncoder().encode(JSON.stringify(i.parametres)).length).toBeLessThanOrEqual(PARAMETRES_SERIE_OCTETS);
    const dates = calculerDatesSerie(i.parametres, { type: i.mode === 'semis_direct' ? 'semis' : 'plantation', date: '2027-04-05' as DateCalendaire });
    for (const t of i.parametres.travauxPrevus ?? []) expect(datesTravailPrevu(t, dates).length, `occurrences de ${t.type}`).toBeGreaterThan(0);
  });

  it('tomate (les deux) : palissage, taille et effeuillage répétés, compost et engrais avec produit', () => {
    for (const nom of ['Tomate sous serre, plant greffé deux têtes', 'Tomate sous tunnel ou plein champ, plant maison franc']) {
      const t = travauxDe(nom);
      for (const type of ['palissage', 'taille', 'effeuillage']) {
        const x = avecType(t, type);
        expect(x.length, `${type} (${nom})`).toBeGreaterThan(0);
        expect(x.some((y) => y.repetition !== null), `${type} répété (${nom})`).toBe(true);
      }
      expect(avecType(t, 'compost').length, `compost (${nom})`).toBeGreaterThan(0);
      expect(avecType(t, 'engrais').length, `engrais (${nom})`).toBeGreaterThan(0);
    }
  });

  it('concombre, aubergine, poivron sous abri : effeuillage', () => {
    for (const nom of ['Concombre sous serre, palissé, plant maison', 'Aubergine sous serre chauffée, plant maison', 'Poivron sous serre, plant maison']) {
      expect(avecType(travauxDe(nom), 'effeuillage').length, nom).toBeGreaterThan(0);
    }
  });

  it('éclaircissage : carottes et navet ; buttage : pomme de terre et poireau', () => {
    for (const nom of ['Carotte de conservation, semis direct', 'Carotte botte, semis direct', 'Navet primeur (rabiole, Hakurei), semis direct']) {
      expect(avecType(travauxDe(nom), 'éclaircissage').length, nom).toBeGreaterThan(0);
    }
    for (const nom of ['Pomme de terre primeur, plant certifié', "Poireau d'automne-hiver, plant racines nues"]) {
      expect(avecType(travauxDe(nom), 'buttage').length, nom).toBeGreaterThan(0);
    }
  });

  it('protection par filet anti-insectes (« autre ») : choux, carottes, navet, radis', () => {
    const noms = [
      'Brocoli, plant maison',
      'Chou pommé, plant maison',
      'Chou-fleur, plant maison',
      'Chou kale, plant maison',
      'Carotte de conservation, semis direct',
      'Carotte botte, semis direct',
      'Navet primeur (rabiole, Hakurei), semis direct',
      'Radis rond, semis direct',
    ];
    for (const nom of noms) {
      const filet = avecType(travauxDe(nom), 'autre').filter((t) => t.outil !== null && plat(t.outil).includes('filet'));
      expect(filet.length, `filet anti-insectes (${nom})`).toBeGreaterThan(0);
    }
  });

  it('désherbage répété jusqu’à un repère de fin sur chaque itinéraire', () => {
    for (const i of lignes.itineraires) {
      const d = avecType(i.parametres.travauxPrevus ?? [], 'désherbage');
      expect(d.some((t) => t.repetition !== null), `désherbage répété (${i.nom})`).toBe(true);
    }
  });

  it('chaque itinéraire cite au moins deux sources publiques, dont une sur la conduite (fertilisation des cultures maraîchères bio)', () => {
    for (const i of source.itineraires) {
      expect(i.sources.length, i.nom).toBeGreaterThanOrEqual(2);
      expect(i.sources.some((s) => plat(s.titre).includes('fertilisation')), `source sur la fertilisation (${i.nom})`).toBe(true);
    }
  });
});

describe('T42 : écartements des semis directs', () => {
  const COMPTABLES = [
    'Carotte de conservation, semis direct',
    'Carotte botte, semis direct',
    'Radis rond, semis direct',
    'Navet primeur (rabiole, Hakurei), semis direct',
    'Épinard de printemps, semis direct',
    "Épinard d'hiver sous tunnel, semis direct",
    'Haricot nain, semis direct',
    'Haricot grimpant, semis direct en poquets',
    'Pois mangetout ou sucré, semis direct',
  ];
  const FINES = [
    'Mesclun, semis direct en lignes',
    "Mesclun d'hiver sous tunnel, semis direct en lignes",
    'Roquette, semis direct',
    "Roquette d'hiver sous tunnel, semis direct",
    'Aneth, semis direct',
    'Coriandre, semis direct',
  ];

  it.each(COMPTABLES)('%s : à l’écartement, rangs, écartement sur le rang (cm entiers) et graines par poquet', (nom) => {
    const l = lignes.itineraires.find((i) => i.nom === nom);
    expect(l, nom).toBeDefined();
    const p = l?.parametres;
    expect(p?.mode).toBe('semis_direct');
    if (p?.mode !== 'semis_direct') return;
    expect(p.densite.facon).toBe('ecartement');
    if (p.densite.facon !== 'ecartement') return;
    expect(Number.isInteger(p.densite.rangsParPlanche) && p.densite.rangsParPlanche >= 1, 'rangs').toBe(true);
    expect(Number.isInteger(p.densite.ecartementSurRangCm) && p.densite.ecartementSurRangCm >= 1, 'écartement').toBe(true);
    expect(p.grainesParPoquet !== null && Number.isInteger(p.grainesParPoquet) && p.grainesParPoquet >= 1, 'graines par poquet').toBe(true);
  });

  it.each(FINES)('%s : fines graines, restent au mètre linéaire', (nom) => {
    const p = lignes.itineraires.find((i) => i.nom === nom)?.parametres;
    expect(p?.densite.facon).toBe('metre_lineaire');
  });

  it('les itinéraires gardent leur identifiant (aucun renommage, aucun ajout ni retrait)', () => {
    const e33 = db.lireEtatsBibliotheque().find((e) => e.migration === '0033_bibliotheque_melon_plein_champ')?.lignes;
    expect(lignes.itineraires.map((i) => i.id).sort()).toEqual((e33?.itineraires ?? []).map((i) => i.id).sort());
    expect(lignes.itineraires.map((i) => [i.id, i.nom]).sort()).toEqual((e33?.itineraires ?? []).map((i) => [i.id, i.nom]).sort());
  });
});

describe('T42 : la migration de bibliothèque 0034', () => {
  const etats = db.lireEtatsBibliotheque();

  it('dernière migration de bibliothèque, au journal, dépôt à jour', () => {
    expect(etats.at(-1)?.migration).toBe(MIGRATION_TRAVAUX);
    const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find((e) => e.tag === MIGRATION_TRAVAUX)?.idx).toBe(34);
    expect(db.verifierBibliotheque(db.depotBibliotheque())).toEqual([]);
  });

  it('ne modifie que des itinéraires : les 46, ni famille ni espèce, rien d’ajouté ni de retiré', () => {
    const avant = etats.find((e) => e.migration === '0033_bibliotheque_melon_plein_champ')?.lignes;
    const apres = etats.find((e) => e.migration === MIGRATION_TRAVAUX)?.lignes;
    if (avant === undefined || apres === undefined) throw new Error('états 0033 ou 0034 absents');
    const changements = db.changementsBibliotheque(avant, apres);
    expect(changements.every((c) => c.table === 'itineraire' && c.sorte === 'modifiee'), JSON.stringify(changements.filter((c) => c.table !== 'itineraire' || c.sorte !== 'modifiee'))).toBe(true);
    expect(changements).toHaveLength(46);
  });

  it('son SQL est celui de la mécanique de T41b, sans DELETE, gardé par ferme_id IS NULL', () => {
    const sql = readFileSync(new URL(`../migrations/${MIGRATION_TRAVAUX}.sql`, import.meta.url), 'utf8');
    const avant = etats.find((e) => e.migration === '0033_bibliotheque_melon_plein_champ')?.lignes;
    const apres = etats.find((e) => e.migration === MIGRATION_TRAVAUX)?.lignes;
    if (avant === undefined || apres === undefined) throw new Error('états absents');
    expect(sql).toBe(db.sqlMiseAJourBibliotheque(MIGRATION_TRAVAUX, avant, apres));
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|DROP|ALTER)\b/);
    expect(sql).toMatch(/WHERE itineraire\.ferme_id IS NULL/);
  });

  it('décision Q43 : aucune trace de la Masterclass dans le JSON, les états ni la migration', () => {
    const fichiers = [
      new URL('../bibliotheque/depart.json', import.meta.url),
      ...readdirSync(new URL('../bibliotheque/etats/', import.meta.url)).map((f) => new URL(`../bibliotheque/etats/${f}`, import.meta.url)),
      new URL(`../migrations/${MIGRATION_TRAVAUX}.sql`, import.meta.url),
    ];
    for (const f of fichiers) {
      const texte = plat(readFileSync(f, 'utf8'));
      for (const interdit of ['masterclass', 'master class', 'jardinier-maraicher', 'jardinier maraicher', 'jardiniermaraicher', 'institut jardinier']) {
        expect(texte.includes(interdit), `« ${interdit} » dans ${f.pathname}`).toBe(false);
      }
    }
  });
});
