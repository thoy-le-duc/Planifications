/**
 * Tests d'acceptation T41 — la bibliothèque commune de départ (docs/backlog/T41-bibliotheque-depart.md) :
 * familles, espèces et itinéraires de `packages/db/bibliotheque/depart.json`, convertis vers les
 * lignes de la base (`ferme_id` nul) et rangés dans une migration de données.
 *
 * ── API attendue (packages/db/src/bibliotheque.ts, exportée par @planif/db) ─────────────────
 *
 * lireBibliothequeDepart(): SourceBibliotheque
 *   Le JSON du dépôt, tel quel (meta, familles, especes, itineraires).
 *
 * idBibliotheque(sorte: 'famille' | 'espece' | 'itineraire', cle: string): string
 *   Identifiant FIXE dérivé du nom : md5(`${sorte}:${cle}`) écrit en UUID (8-4-4-4-12, minuscules),
 *   comme `md5(…)::uuid` de Postgres (liste de départ des types d'intervention, migration 0016).
 *   Clés : le nom de la famille ; le nom de l'espèce ; `${espèce}:${nom de l'itinéraire}` (T41b : le
 *   nom initial, `nomInitial`, quand la ligne a été renommée).
 *
 * convertirBibliotheque(source): LignesBibliotheque
 *   Lignes au format de la base (snake_case), toutes à `ferme_id` nul :
 *   - familles  { id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans }
 *   - especes   { id, ferme_id, famille_id, nom, categorie, perenne (false si absent du JSON),
 *                 unite_recolte, delai_retour_minimal_ans: null, delai_retour_conseille_ans: null,
 *                 profil_croissance: null }
 *   - itineraires { id, ferme_id, espece_id, variete_id: null, nom, mode, parametres }
 *   `parametres` est un ParametresItineraire du cœur : periodeUsage → { semaineDebut, semaineFin },
 *   densite → Densite (ecartementCm → ecartementSurRangCm ; disposition écrite seulement en
 *   quinconce sur plusieurs rangs, absente = alignés, comme l'écrit le formulaire de T35a), rendementAttendu
 *   { par, kg } → { par, quantite: kg, unite: 'kg' }, margeSecuritePct → margeSecurite,
 *   pertePepinierePct → pertePepiniere, perenne: null ; les clés du mode seulement (pépinière en
 *   plant maison, grainesParPoquet en semis direct). Ni sources ni « à vérifier » en base.
 *
 * sqlBibliotheque(lignes): string
 *   Le texte de la migration : un INSERT … ON CONFLICT (id) DO NOTHING par table (familles, puis
 *   espèces, puis itinéraires), séparés par `--> statement-breakpoint`.
 *
 * MIGRATION_BIBLIOTHEQUE_DEPART : le tag de la migration (`0032_bibliotheque_depart`), inscrite au
 *   journal de drizzle-kit. Une mise à jour des valeurs passe par une NOUVELLE migration (on ne
 *   modifie jamais une migration fusionnée) : voir bibliotheque-suites.test.ts (T41b), qui fige
 *   0032 et vérifie que le JSON courant est « 0032 + migrations de bibliothèque suivantes ».
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { calculerDatesSerie, validerItineraire, type DateCalendaire } from '@planif/core';
import { describe, expect, it } from 'vitest';
import * as db from './index.ts';
import { CATEGORIES_ESPECE, MODES_ITINERAIRE, TYPES_ABRI, UNITES_RECOLTE } from './valeurs.ts';

/** Ferme fictive : validerItineraire exige une ferme (le téléphone n'écrit jamais dans la bibliothèque). */
const FERME_TEST = '0192f0c1-4141-7000-8000-000000000001';

const source = db.lireBibliothequeDepart();
const lignes = db.convertirBibliotheque(source);

const uuidMd5 = (texte: string): string => {
  const h = createHash('md5').update(texte, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const entier = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v);
const pourcentage = (v: unknown): boolean => entier(v) && (v as number) >= 0 && (v as number) <= 100;
const semaine = (v: unknown): boolean => entier(v) && (v as number) >= 1 && (v as number) <= 53;
const strictementPositif = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Texte sans accents ni casse, pour chercher une mention. */
const plat = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

type Objet = Readonly<Record<string, unknown>>;

/** T42 : les paramètres sans les travaux prévus (vérifiés par bibliotheque-travaux.test.ts). */
const sansTravaux = (p: object | undefined): object | undefined => {
  if (p === undefined) return undefined;
  return Object.fromEntries(Object.entries(p).filter(([cle]) => cle !== 'travauxPrevus'));
};

describe('T41 : le JSON de la bibliothèque de départ', () => {
  it('10 familles, 35 espèces, 46 itinéraires', () => {
    expect(source.familles).toHaveLength(10);
    expect(source.especes).toHaveLength(35);
    expect(source.itineraires).toHaveLength(46);
  });

  it('cohérence : noms uniques, toute espèce a sa famille, tout itinéraire son espèce (même famille, même catégorie)', () => {
    const familles = new Set(source.familles.map((f) => f.nom));
    expect(familles.size, 'noms de familles uniques').toBe(source.familles.length);
    const especes = new Map(source.especes.map((e) => [e.nom, e] as const));
    expect(especes.size, 'noms d’espèces uniques').toBe(source.especes.length);
    for (const e of source.especes) expect(familles.has(e.famille), `famille « ${e.famille} » de l’espèce ${e.nom}`).toBe(true);
    const cles = new Set<string>();
    for (const i of source.itineraires) {
      const e = especes.get(i.espece);
      expect(e, `espèce « ${i.espece} » de l’itinéraire ${i.nom}`).toBeDefined();
      expect(i.famille, `famille de l’itinéraire ${i.nom} = celle de son espèce`).toBe(e?.famille);
      expect(i.categorie, `catégorie de l’itinéraire ${i.nom} = celle de son espèce`).toBe(e?.categorie);
      cles.add(`${i.espece}:${i.nom}`);
    }
    expect(cles.size, 'un seul itinéraire par (espèce, nom)').toBe(source.itineraires.length);
    const avecItineraire = new Set(source.itineraires.map((i) => i.espece));
    expect(source.especes.filter((e) => !avecItineraire.has(e.nom)).map((e) => e.nom), 'toute espèce a au moins un itinéraire').toEqual([]);
  });

  it('chaque itinéraire cite au moins une source publique (titre, url https) et dit ce qui reste à vérifier', () => {
    for (const i of source.itineraires) {
      expect(i.sources.length, `sources de ${i.nom}`).toBeGreaterThan(0);
      for (const s of i.sources) {
        expect(s.titre.trim(), `titre d’une source de ${i.nom}`).not.toBe('');
        expect(s.url, `url d’une source de ${i.nom}`).toMatch(/^https:\/\//);
      }
      expect(typeof i.aVerifier).toBe('string');
    }
  });

  it('décision Q43 : aucun contenu de la Masterclass ni de l’Institut Jardinier-Maraîcher', () => {
    const texte = plat(readFileSync(new URL('../bibliotheque/depart.json', import.meta.url), 'utf8'));
    for (const interdit of ['masterclass', 'master class', 'jardinier-maraicher', 'jardinier maraicher', 'jardiniermaraicher', 'institut jardinier']) {
      expect(texte.includes(interdit), `« ${interdit} » dans depart.json`).toBe(false);
    }
  });
});

describe('T41 : identifiants fixes, dérivés du nom', () => {
  it('md5(`sorte:clé`) en UUID, comme md5(…)::uuid de Postgres', () => {
    expect(db.idBibliotheque('famille', 'Solanacées')).toBe(uuidMd5('famille:Solanacées'));
    expect(db.idBibliotheque('espece', 'tomate')).toBe(uuidMd5('espece:tomate'));
    expect(db.idBibliotheque('itineraire', 'tomate:Tomate sous serre, plant greffé deux têtes')).toBe(
      uuidMd5('itineraire:tomate:Tomate sous serre, plant greffé deux têtes'),
    );
  });

  it('les lignes portent ces identifiants, uniques, et les références suivent les noms', () => {
    const tous = [...lignes.familles, ...lignes.especes, ...lignes.itineraires].map((l) => l.id);
    for (const id of tous) expect(id).toMatch(MOTIF_UUID);
    expect(new Set(tous).size).toBe(tous.length);
    expect(lignes.familles.map((f) => f.id)).toEqual(source.familles.map((f) => db.idBibliotheque('famille', f.nom)));
    expect(lignes.especes.map((e) => [e.id, e.famille_id])).toEqual(
      source.especes.map((e) => [db.idBibliotheque('espece', e.nom), db.idBibliotheque('famille', e.famille)]),
    );
    expect(lignes.itineraires.map((i) => [i.id, i.espece_id])).toEqual(
      // T41b : un itinéraire renommé garde l'identifiant de son nom initial.
      source.itineraires.map((i) => [db.idBibliotheque('itineraire', `${i.espece}:${i.nomInitial ?? i.nom}`), db.idBibliotheque('espece', i.espece)]),
    );
  });

  it('la conversion est déterministe (deux appels, mêmes lignes)', () => {
    expect(db.convertirBibliotheque(db.lireBibliothequeDepart())).toEqual(lignes);
  });
});

describe('T41 : conversion vers les lignes de la base', () => {
  it('familles et espèces : ferme_id nul, valeurs du JSON, unions du modèle', () => {
    expect(lignes.familles[0]).toEqual({
      id: db.idBibliotheque('famille', 'Solanacées'),
      ferme_id: null,
      nom: 'Solanacées',
      delai_retour_minimal_ans: 3,
      delai_retour_conseille_ans: 4,
    });
    for (const f of lignes.familles) {
      expect(f.ferme_id).toBeNull();
      expect(entier(f.delai_retour_minimal_ans) && f.delai_retour_minimal_ans >= 0, `délai minimal de ${f.nom}`).toBe(true);
      expect(entier(f.delai_retour_conseille_ans) && f.delai_retour_conseille_ans >= f.delai_retour_minimal_ans, `délai conseillé de ${f.nom}`).toBe(true);
    }
    const tomate = lignes.especes.find((e) => e.nom === 'tomate');
    expect(tomate).toEqual({
      id: db.idBibliotheque('espece', 'tomate'),
      ferme_id: null,
      famille_id: db.idBibliotheque('famille', 'Solanacées'),
      nom: 'tomate',
      categorie: 'legume',
      perenne: false,
      unite_recolte: 'kg',
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      profil_croissance: null,
    });
    for (const e of lignes.especes) {
      expect(e.ferme_id).toBeNull();
      expect(CATEGORIES_ESPECE as readonly string[]).toContain(e.categorie);
      expect(UNITES_RECOLTE as readonly string[]).toContain(e.unite_recolte);
      expect(e.perenne, `${e.nom} : annuelle`).toBe(false);
    }
  });

  it('plant acheté (tomate greffée sous serre) : ParametresItineraire du cœur, sans clé de pépinière', () => {
    const i = lignes.itineraires.find((l) => l.nom === 'Tomate sous serre, plant greffé deux têtes');
    expect(i === undefined ? undefined : { ...i, parametres: sansTravaux(i.parametres) }).toEqual({
      id: db.idBibliotheque('itineraire', 'tomate:Tomate sous serre, plant greffé deux têtes'),
      ferme_id: null,
      espece_id: db.idBibliotheque('espece', 'tomate'),
      variete_id: null,
      nom: 'Tomate sous serre, plant greffé deux têtes',
      mode: 'plant_achete',
      parametres: {
        mode: 'plant_achete',
        periodeUsage: { semaineDebut: 12, semaineFin: 16 },
        typeAbri: 'serre',
        dureeAvantRecolteJours: 70,
        fenetreRecolteJours: 110,
        margeSecurite: 10,
        rendementAttendu: { par: 'plant', quantite: 8, unite: 'kg' },
        perenne: null,
        densite: { facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50 },
      },
    });
  });

  it('plant maison (oignon frais en mottes) : pépinière, mottes, perte et plaques', () => {
    const i = lignes.itineraires.find((l) => l.nom === 'Oignon frais (botte ou primeur), mottes');
    expect(sansTravaux(i?.parametres)).toEqual({
      mode: 'plant_maison',
      periodeUsage: { semaineDebut: 10, semaineFin: 15 },
      typeAbri: 'plein_champ',
      dureePepiniereJours: 50,
      grainesParMotte: 5,
      plantsParMotte: 4,
      pertePepiniere: 15,
      alveolesParPlaque: 104,
      dureeAvantRecolteJours: 75,
      fenetreRecolteJours: 30,
      margeSecurite: 15,
      rendementAttendu: { par: 'metre', quantite: 4, unite: 'kg' },
      perenne: null,
      densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 25, disposition: 'quinconce' },
    });
  });

  it('semis direct : au mètre linéaire (aneth), à l’écartement (carotte depuis T42, haricot grimpant en poquets)', () => {
    const aneth = lignes.itineraires.find((l) => l.nom === 'Aneth, semis direct');
    expect(sansTravaux(aneth?.parametres)).toEqual({
      mode: 'semis_direct',
      periodeUsage: { semaineDebut: 15, semaineFin: 32 },
      typeAbri: 'plein_champ',
      dureeAvantRecolteJours: 45,
      fenetreRecolteJours: 21,
      margeSecurite: 25,
      rendementAttendu: { par: 'metre', quantite: 0.8, unite: 'kg' },
      perenne: null,
      densite: { facon: 'metre_lineaire', rangsParPlanche: 3, grainesParMetre: 60 },
      grainesParPoquet: null,
    });
    const carotte = lignes.itineraires.find((l) => l.nom === 'Carotte de conservation, semis direct');
    expect(sansTravaux(carotte?.parametres)).toEqual({
      mode: 'semis_direct',
      periodeUsage: { semaineDebut: 20, semaineFin: 26 },
      typeAbri: 'plein_champ',
      dureeAvantRecolteJours: 120,
      fenetreRecolteJours: 60,
      margeSecurite: 20,
      rendementAttendu: { par: 'metre', quantite: 5, unite: 'kg' },
      perenne: null,
      densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 2 },
      grainesParPoquet: 1,
    });
    const haricot = lignes.itineraires.find((l) => l.nom === 'Haricot grimpant, semis direct en poquets');
    expect(haricot?.parametres).toMatchObject({
      mode: 'semis_direct',
      grainesParPoquet: 5,
    });
    expect(haricot?.parametres.densite, 'rangs alignés : pas de clé disposition').toEqual({ facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 40 });
  });

  it('ni sources, ni « à vérifier », ni famille ou catégorie dans les paramètres rangés en base', () => {
    for (const i of lignes.itineraires) {
      // T42b (règle 6) : tout est contrôlé, travaux prévus compris ; seule `categorie` (catégorie
      // d'intervention, clé légitime d'un travail prévu) n'est cherchée que hors des travaux.
      const texte = JSON.stringify(i);
      for (const cle of ['sources', 'aVerifier', 'famille', 'Pct', 'debutSemaine', 'ecartementCm"', '"kg":']) {
        expect(texte.includes(cle), `${cle} dans ${i.nom}`).toBe(false);
      }
      expect(JSON.stringify({ ...i, parametres: sansTravaux(i.parametres) }).includes('categorie'), `categorie dans ${i.nom}`).toBe(false);
      for (const t of i.parametres.travauxPrevus ?? []) {
        expect(Object.keys(t).sort(), `clés d’un travail prévu de ${i.nom}`).toEqual(['categorie', 'decalageJours', 'outil', 'produit', 'repere', 'repetition', 'tempsEstime', 'type']);
      }
    }
  });
});

describe('T41 : chaque itinéraire passe les règles du cœur après conversion', () => {
  it.each(lignes.itineraires.map((i) => [i.nom, i] as const))('%s : accepté par validerItineraire, sans perte', (_nom, i) => {
    const r = validerItineraire({ ...i, ferme_id: FERME_TEST, parametres: JSON.stringify(i.parametres) });
    expect(r.ok ? null : r.erreur, `validerItineraire refuse ${i.nom}`).toBeNull();
    if (!r.ok) return;
    expect(r.valeur.parametres, 'paramètres relus = paramètres convertis').toEqual(i.parametres);
    expect(r.valeur.mode).toBe(i.mode);
    expect(r.valeur.nom).toBe(i.nom);
  });

  it.each(lignes.itineraires.map((i) => [i.nom, i] as const))('%s : valeurs dans les bornes du modèle', (_nom, i) => {
    const p = i.parametres as unknown as Objet;
    expect(MODES_ITINERAIRE as readonly string[]).toContain(p.mode);
    expect(TYPES_ABRI as readonly string[], `typeAbri de ${i.nom}`).toContain(p.typeAbri);
    const periode = p.periodeUsage as Objet;
    expect(semaine(periode.semaineDebut) && semaine(periode.semaineFin), `période de ${i.nom}`).toBe(true);
    expect(entier(p.dureeAvantRecolteJours) && (p.dureeAvantRecolteJours as number) > 0, 'durée avant récolte').toBe(true);
    expect(entier(p.fenetreRecolteJours) && (p.fenetreRecolteJours as number) > 0, 'fenêtre de récolte').toBe(true);
    expect(pourcentage(p.margeSecurite), 'marge de sécurité').toBe(true);
    const rendement = p.rendementAttendu as Objet;
    expect(['metre', 'plant']).toContain(rendement.par);
    expect(strictementPositif(rendement.quantite), 'rendement').toBe(true);
    expect(rendement.unite).toBe('kg');
    expect(p.perenne).toBeNull();
    const d = p.densite as Objet;
    if (d.facon === 'ecartement') {
      expect(entier(d.rangsParPlanche) && (d.rangsParPlanche as number) > 0, 'rangs').toBe(true);
      expect(entier(d.ecartementSurRangCm) && (d.ecartementSurRangCm as number) > 0, 'écartement (cm entiers)').toBe(true);
      expect([undefined, 'quinconce'], 'disposition : absente (alignés) ou quinconce').toContain(d.disposition);
      if (d.disposition === 'quinconce') expect(d.rangsParPlanche as number, 'quinconce : plusieurs rangs').toBeGreaterThan(1);
    } else if (d.facon === 'metre_lineaire') {
      expect(p.mode, 'au mètre linéaire : semis direct seulement').toBe('semis_direct');
      expect(entier(d.rangsParPlanche) && (d.rangsParPlanche as number) > 0, 'rangs').toBe(true);
      expect(strictementPositif(d.grainesParMetre), 'graines par mètre').toBe(true);
    } else {
      expect(d.facon).toBe('volee');
      expect(p.mode, 'à la volée : semis direct seulement').toBe('semis_direct');
      expect(entier(d.largeurSemeeCm) && (d.largeurSemeeCm as number) > 0, 'largeur semée').toBe(true);
      expect(strictementPositif(d.doseGParM2), 'dose').toBe(true);
    }
    if (p.mode === 'semis_direct') {
      expect(p.grainesParPoquet === null || (entier(p.grainesParPoquet) && (p.grainesParPoquet as number) > 0), 'graines par poquet').toBe(true);
      expect(p.grainesParPoquet !== null, 'graines par poquet : à l’écartement seulement').toBe(d.facon === 'ecartement');
    }
    if (p.mode === 'plant_maison') {
      expect(entier(p.dureePepiniereJours) && (p.dureePepiniereJours as number) > 0, 'pépinière').toBe(true);
      expect(entier(p.grainesParMotte) && (p.grainesParMotte as number) > 0, 'graines par motte').toBe(true);
      expect(entier(p.plantsParMotte) && (p.plantsParMotte as number) > 0, 'plants par motte').toBe(true);
      expect(pourcentage(p.pertePepiniere) && (p.pertePepiniere as number) < 100, 'perte en pépinière').toBe(true);
      expect(p.alveolesParPlaque === null || (entier(p.alveolesParPlaque) && (p.alveolesParPlaque as number) > 0), 'alvéoles').toBe(true);
    }
    // Le moteur de dates de T02 calcule une série d'exemple (mise en place le 2027-04-05).
    const dates = calculerDatesSerie(i.parametres, {
      type: i.mode === 'semis_direct' ? 'semis' : 'plantation',
      date: '2027-04-05' as DateCalendaire,
    });
    expect(dates.miseEnPlace < dates.debutRecolte && dates.debutRecolte < dates.finRecolte, `dates de ${i.nom}`).toBe(true);
  });
});

describe('T41 : la migration de données', () => {
  const dossier = new URL('../migrations/', import.meta.url);

  it('inscrite au journal de drizzle-kit', () => {
    expect(db.MIGRATION_BIBLIOTHEQUE_DEPART).toBe('0032_bibliotheque_depart');
    const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', dossier), 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain(db.MIGRATION_BIBLIOTHEQUE_DEPART);
  });

  it('trois INSERT rejouables (ON CONFLICT (id) DO NOTHING), familles puis espèces puis itinéraires, rien d’autre', () => {
    const sql = db.sqlBibliotheque(lignes);
    const instructions = sql
      .split('--> statement-breakpoint')
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter((s) => s !== '');
    expect(instructions).toHaveLength(3);
    expect(instructions.map((s) => /^INSERT INTO (\w+)/.exec(s)?.[1])).toEqual(['famille', 'espece', 'itineraire']);
    for (const s of instructions) expect(s).toMatch(/ON CONFLICT \(id\) DO NOTHING;?$/);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/);
  });
});
