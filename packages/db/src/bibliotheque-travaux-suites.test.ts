/**
 * Tests d'acceptation T42b — suites de T42 : ordre et cohérence agronomique des travaux prévus de
 * la bibliothèque, portés par une nouvelle migration de bibliothèque (mécanique de T41b)
 * (docs/backlog/T42b-travaux-suites.md).
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * JSON (packages/db/bibliotheque/depart.json), identifiants et noms inchangés :
 *   1. carotte botte : compost → grelinette → occultation → préparation (râteau) à J−1 ; partout,
 *      une occultation vient après le travail du sol, jamais avant ;
 *   2. un filet anti-insectes posé au semis vient après le désherbage thermique (J+7 environ) ;
 *   3. pas d'éclaircissage sur un semis graine à graine (écartement, 1 graine par poquet), et
 *      « à vérifier » de la carotte et du navet l'explique ;
 *   4. cultures paillées en toile tissée (tomate, aubergine, poivron, piment, concombre) :
 *      désherbage au trou de plantation et au passe-pied, tous les 30 à 45 jours.
 *
 * Migration : `0035_bibliotheque_travaux_suites`, écrite par `pnpm --filter @planif/db
 *   bibliotheque 0035_bibliotheque_travaux_suites` (T43 : 0036 la suit), ne modifie
 *   que les 11 itinéraires concernés (rien d'ajouté ni de retiré, ni famille ni espèce).
 */
import { readFileSync } from 'node:fs';
import type { TravailPrevu } from '@planif/core';
import { describe, expect, it } from 'vitest';
import * as db from './index.ts';

const MIGRATION = '0035_bibliotheque_travaux_suites';
const PRECEDENTE = '0034_bibliotheque_travaux';

const source = db.lireBibliothequeDepart();
const lignes = db.convertirBibliotheque(source);

const plat = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

function travauxDe(nom: string): readonly TravailPrevu[] {
  const l = lignes.itineraires.find((i) => i.nom === nom);
  if (l === undefined) throw new Error(`itinéraire « ${nom} » absent`);
  return l.parametres.travauxPrevus ?? [];
}

function sourceDe(nom: string): db.SourceItineraire {
  const s = source.itineraires.find((i) => i.nom === nom);
  if (s === undefined) throw new Error(`itinéraire « ${nom} » absent du JSON`);
  return s;
}

const deType = (t: readonly TravailPrevu[], type: string): readonly TravailPrevu[] => t.filter((x) => x.type === type);
const avant = (t: readonly TravailPrevu[]): readonly TravailPrevu[] => t.filter((x) => x.repere === 'mise_en_place');
const estThermique = (t: TravailPrevu): boolean => t.type === 'désherbage' && t.outil !== null && plat(t.outil).includes('thermique');
const estFilet = (t: TravailPrevu): boolean => t.type === 'autre' && t.outil !== null && plat(t.outil).includes('filet anti-insectes');
const estToile = (t: TravailPrevu): boolean => t.type === 'paillage' && t.outil !== null && plat(t.outil).includes('toile tissee');

const CAROTTE_BOTTE = 'Carotte botte, semis direct';
const CAROTTE_CONSERVATION = 'Carotte de conservation, semis direct';
const NAVET = 'Navet primeur (rabiole, Hakurei), semis direct';

const TOILE = [
  'Tomate sous serre, plant greffé deux têtes',
  'Tomate sous tunnel ou plein champ, plant maison franc',
  'Aubergine sous serre chauffée, plant maison',
  'Aubergine sous tunnel ou plein champ, plant maison',
  'Poivron sous serre, plant maison',
  'Poivron sous tunnel ou plein champ, plant maison',
  'Piment fort sous tunnel, plant maison',
  'Concombre sous serre, palissé, plant maison',
];

describe('T42b, règle 1 : la carotte botte travaille le sol avant d’occulter', () => {
  it('compost → grelinette → occultation → préparation (râteau) à J−1, tous avant la mise en place', () => {
    const t = avant(travauxDe(CAROTTE_BOTTE));
    const jour = (type: string): number => {
      const x = deType(t, type);
      expect(x, `un seul ${type} avant le semis`).toHaveLength(1);
      return x[0]?.decalageJours ?? Number.NaN;
    };
    const compost = jour('compost');
    const grelinette = jour('grelinette');
    const occultation = jour('bâchage ou occultation');
    const preparation = jour('préparation de planche');
    expect(compost, 'compost avant la grelinette').toBeLessThan(grelinette);
    expect(grelinette, 'grelinette avant l’occultation').toBeLessThan(occultation);
    expect(occultation, 'occultation avant la préparation').toBeLessThan(preparation);
    expect(preparation, 'préparation à J−1').toBe(-1);
    expect(deType(t, 'préparation de planche')[0]?.outil).toBe('râteau');
  });

  it('partout : une occultation vient après tout travail du sol profond (grelinette) et avant la préparation', () => {
    for (const i of lignes.itineraires) {
      const t = avant(i.parametres.travauxPrevus ?? []);
      for (const o of deType(t, 'bâchage ou occultation')) {
        for (const g of deType(t, 'grelinette')) expect(g.decalageJours, `grelinette avant l’occultation (${i.nom})`).toBeLessThan(o.decalageJours);
        for (const p of deType(t, 'préparation de planche')) expect(o.decalageJours, `occultation avant la préparation (${i.nom})`).toBeLessThan(p.decalageJours);
      }
    }
  });
});

describe('T42b, règle 2 : le filet anti-insectes après le désherbage thermique', () => {
  it.each([CAROTTE_BOTTE, CAROTTE_CONSERVATION])('%s : thermique puis filet vers J+7', (nom) => {
    const t = travauxDe(nom);
    const thermique = t.filter(estThermique);
    const filet = t.filter(estFilet);
    expect(thermique.length, 'désherbage thermique').toBeGreaterThan(0);
    expect(filet).toHaveLength(1);
    expect(filet[0]?.repere).toBe('mise_en_place');
    expect(filet[0]?.decalageJours, 'filet vers J+7').toBeGreaterThanOrEqual(6);
    expect(filet[0]?.decalageJours, 'filet vers J+7').toBeLessThanOrEqual(10);
  });

  it('partout : un filet posé au semis vient après chaque désherbage thermique, jamais avant', () => {
    for (const i of lignes.itineraires) {
      const t = i.parametres.travauxPrevus ?? [];
      for (const th of t.filter(estThermique)) {
        for (const f of t.filter(estFilet)) {
          if (f.repere !== th.repere) continue;
          expect(f.decalageJours, `filet après le thermique (${i.nom})`).toBeGreaterThan(th.decalageJours);
        }
      }
    }
  });
});

describe('T42b, règle 3 : pas d’éclaircissage sur un semis graine à graine', () => {
  it('aucun semis direct à l’écartement, une graine par poquet, ne prévoit d’éclaircissage', () => {
    for (const i of lignes.itineraires) {
      const p = i.parametres;
      if (p.mode !== 'semis_direct' || p.densite.facon !== 'ecartement' || p.grainesParPoquet !== 1) continue;
      expect(deType(p.travauxPrevus ?? [], 'éclaircissage'), `éclaircissage injustifié (${i.nom})`).toHaveLength(0);
    }
  });

  it.each([CAROTTE_BOTTE, CAROTTE_CONSERVATION, NAVET])('%s : sans éclaircissage, et « à vérifier » l’explique', (nom) => {
    expect(deType(travauxDe(nom), 'éclaircissage')).toHaveLength(0);
    const v = plat(sourceDe(nom).aVerifier);
    expect(v, '« à vérifier » parle de l’éclaircissage').toContain('eclaircissage');
    expect(v, '« à vérifier » dit pourquoi (graine à graine)').toContain('graine a graine');
  });
});

describe('T42b, règle 4 : cultures paillées en toile tissée', () => {
  it('tomate, aubergine, poivron, piment, concombre : paillage en toile tissée', () => {
    for (const nom of TOILE) expect(travauxDe(nom).some(estToile), nom).toBe(true);
  });

  it('partout où la toile tissée est posée : désherbage au trou de plantation et au passe-pied, tous les 30 à 45 jours', () => {
    const paillees = lignes.itineraires.filter((i) => (i.parametres.travauxPrevus ?? []).some(estToile));
    expect(paillees.map((i) => i.nom).sort()).toEqual([...TOILE].sort());
    for (const i of paillees) {
      const d = deType(i.parametres.travauxPrevus ?? [], 'désherbage');
      expect(d.length, `désherbage (${i.nom})`).toBeGreaterThan(0);
      for (const x of d) {
        expect(x.repetition, `désherbage répété (${i.nom})`).not.toBeNull();
        expect(x.repetition?.tousLesJours, `fréquence réduite (${i.nom})`).toBeGreaterThanOrEqual(30);
        expect(x.repetition?.tousLesJours, `fréquence réduite (${i.nom})`).toBeLessThanOrEqual(45);
        expect(plat(x.outil ?? ''), `limité au passe-pied (${i.nom})`).toContain('passe-pied');
      }
    }
  });
});

describe('T42b : identifiants et noms inchangés', () => {
  it('mêmes itinéraires, mêmes noms qu’après 0034', () => {
    const e34 = db.lireEtatsBibliotheque().find((e) => e.migration === PRECEDENTE)?.lignes;
    expect(lignes.itineraires.map((i) => [i.id, i.nom]).sort()).toEqual((e34?.itineraires ?? []).map((i) => [i.id, i.nom]).sort());
  });
});

describe('T42b : la migration de bibliothèque 0035', () => {
  const etats = db.lireEtatsBibliotheque();
  const etat = (m: string): db.LignesBibliotheque => {
    const e = etats.find((x) => x.migration === m)?.lignes;
    if (e === undefined) throw new Error(`état ${m} absent`);
    return e;
  };

  // T43 : 0036_bibliotheque_ecart_entre_rangs la suit ; 0035 reste au journal, à sa place.
  it('migration de bibliothèque après 0034, au journal (idx 35), dépôt à jour', () => {
    const i = etats.findIndex((e) => e.migration === MIGRATION);
    expect(etats[i - 1]?.migration).toBe(PRECEDENTE);
    const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find((e) => e.tag === MIGRATION)?.idx).toBe(35);
    expect(db.verifierBibliotheque(db.depotBibliotheque())).toEqual([]);
  });

  it('ne modifie que les 11 itinéraires concernés : ni famille ni espèce, rien d’ajouté ni de retiré', () => {
    const changements = db.changementsBibliotheque(etat(PRECEDENTE), etat(MIGRATION));
    expect(changements.every((c) => c.table === 'itineraire' && c.sorte === 'modifiee'), JSON.stringify(changements)).toBe(true);
    const attendus = [CAROTTE_BOTTE, CAROTTE_CONSERVATION, NAVET, ...TOILE].map((nom) => lignes.itineraires.find((i) => i.nom === nom)?.id);
    expect(changements.map((c) => c.id).sort()).toEqual([...attendus].sort());
  });

  it('son SQL est celui de la mécanique de T41b, sans DELETE, gardé par ferme_id IS NULL, sans trace de la Masterclass', () => {
    const sql = readFileSync(new URL(`../migrations/${MIGRATION}.sql`, import.meta.url), 'utf8');
    expect(sql).toBe(db.sqlMiseAJourBibliotheque(MIGRATION, etat(PRECEDENTE), etat(MIGRATION)));
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|DROP|ALTER)\b/);
    expect(sql).toMatch(/WHERE itineraire\.ferme_id IS NULL/);
    const textes = [plat(sql), plat(JSON.stringify(etat(MIGRATION))), plat(readFileSync(new URL('../bibliotheque/depart.json', import.meta.url), 'utf8'))];
    for (const t of textes) {
      for (const interdit of ['masterclass', 'master class', 'jardinier-maraicher', 'jardinier maraicher', 'jardiniermaraicher', 'institut jardinier']) {
        expect(t.includes(interdit), interdit).toBe(false);
      }
    }
  });
});
