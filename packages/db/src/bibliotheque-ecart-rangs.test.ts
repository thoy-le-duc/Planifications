/**
 * Tests d'acceptation T43 — l'écart entre rangs des 46 itinéraires de la bibliothèque, porté par
 * une nouvelle migration de bibliothèque (mécanique de T41b) (docs/backlog/T43-ecart-entre-rangs.md,
 * règle 4).
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * JSON (packages/db/bibliotheque/depart.json), identifiants et noms inchangés :
 *   - chaque itinéraire (tous à l'écartement ou au mètre linéaire) porte `densite.ecartEntreRangsCm`,
 *     un nombre entier de centimètres de 5 à 200 ;
 *   - cohérent avec ses rangs sur la planche de 75 cm des hypothèses (passe-pied de 45 cm) :
 *     à 2 rangs ou plus, les rangs tiennent sur la planche ((rangs − 1) × écart ≤ 75) et
 *     l'occupent ((rangs) × écart entre 60 et 90 cm) ; à 1 rang, l'écart est l'entraxe des
 *     planches (75 + 45 = 120 cm) ;
 *   - « à vérifier » de chaque itinéraire dit l'écart entre rangs (« Écart entre rangs (T43) ») ;
 *     les hypothèses de `meta` disent d'où il vient ; aucune source payante (Masterclass).
 * Conversion : `densite.ecartEntreRangsCm` recopié tel quel dans les paramètres ; validerItineraire
 *   l'accepte sans perte.
 * Migration : `0036_bibliotheque_ecart_entre_rangs`, écrite par `pnpm --filter @planif/db
 *   bibliotheque 0036_bibliotheque_ecart_entre_rangs`, dernière migration de bibliothèque, modifie
 *   les 46 itinéraires (rien d'ajouté ni de retiré, ni famille ni espèce).
 */
import { readFileSync } from 'node:fs';
import { validerItineraire } from '@planif/core';
import { describe, expect, it } from 'vitest';
import * as db from './index.ts';

const MIGRATION = '0036_bibliotheque_ecart_entre_rangs';
const PRECEDENTE = '0035_bibliotheque_travaux_suites';
const PLANCHE_CM = 75;
const PASSE_PIED_CM = 45;
const FERME_TEST = '0192f0c1-4343-7000-8000-000000000099';

const source = db.lireBibliothequeDepart();
const lignes = db.convertirBibliotheque(source);

type Objet = Record<string, unknown>;

const plat = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

const ecartSource = (i: db.SourceItineraire): unknown => (i.densite as unknown as Objet).ecartEntreRangsCm;

describe('T43 : écart entre rangs des 46 itinéraires (JSON)', () => {
  it('46 itinéraires, tous à l’écartement ou au mètre linéaire', () => {
    expect(source.itineraires).toHaveLength(46);
    for (const i of source.itineraires) expect(['ecartement', 'metre_lineaire'], i.nom).toContain(i.densite.facon);
  });

  it.each(source.itineraires.map((i) => [i.nom, i] as const))('%s : écart entre rangs entier, de 5 à 200 cm', (_nom, i) => {
    const e = ecartSource(i);
    expect(typeof e === 'number' && Number.isInteger(e), `ecartEntreRangsCm de ${i.nom} : ${JSON.stringify(e)}`).toBe(true);
    expect(e as number).toBeGreaterThanOrEqual(5);
    expect(e as number).toBeLessThanOrEqual(200);
  });

  it.each(source.itineraires.map((i) => [i.nom, i] as const))('%s : cohérent avec ses rangs sur une planche de 75 cm', (_nom, i) => {
    const e = ecartSource(i) as number;
    const rangs = i.densite.facon === 'volee' ? 0 : i.densite.rangsParPlanche;
    if (rangs === 1) {
      expect(e, '1 rang : entraxe des planches (planche + passe-pied)').toBe(PLANCHE_CM + PASSE_PIED_CM);
      return;
    }
    expect((rangs - 1) * e, `${String(rangs)} rangs à ${String(e)} cm : les rangs tiennent sur la planche`).toBeLessThanOrEqual(PLANCHE_CM);
    expect(rangs * e, `${String(rangs)} rangs à ${String(e)} cm : occupent la planche`).toBeGreaterThanOrEqual(60);
    expect(rangs * e).toBeLessThanOrEqual(90);
  });

  it('valeurs usuelles retenues pour quelques cultures', () => {
    const ecart = (nom: string): unknown => {
      const i = source.itineraires.find((x) => x.nom === nom);
      if (i === undefined) throw new Error(`« ${nom} » absent`);
      return ecartSource(i);
    };
    expect(ecart('Carotte de conservation, semis direct')).toBe(18);
    expect(ecart('Carotte botte, semis direct')).toBe(15);
    expect(ecart('Laitue (batavia, feuille de chêne), plant maison')).toBe(30);
    expect(ecart('Radis rond, semis direct')).toBe(12);
    expect(ecart('Chou pommé, plant maison')).toBe(45);
    expect(ecart('Tomate sous serre, plant greffé deux têtes')).toBe(120);
  });

  it('« à vérifier » de chaque itinéraire dit l’écart entre rangs ; les hypothèses aussi ; aucune source payante', () => {
    for (const i of source.itineraires) {
      expect(i.aVerifier, i.nom).toMatch(/Écart entre rangs \(T43\)/);
      expect(i.aVerifier, i.nom).toContain(`${String(ecartSource(i))} cm`);
    }
    const hypotheses = (source.meta.hypotheses as string[]).join('\n');
    expect(hypotheses).toMatch(/[ÉE]cart entre rangs \(T43\)/);
    const texte = plat(readFileSync(new URL('../bibliotheque/depart.json', import.meta.url), 'utf8'));
    for (const interdit of ['masterclass', 'master class', 'jardinier-maraicher', 'jardinier maraicher', 'jardiniermaraicher', 'institut jardinier']) {
      expect(texte.includes(interdit), interdit).toBe(false);
    }
  });
});

describe('T43 : conversion', () => {
  it.each(lignes.itineraires.map((l, k) => [l.nom, l, source.itineraires[k]] as const))('%s : écart recopié, accepté par le cœur sans perte', (_nom, l, s) => {
    const d = l.parametres.densite as unknown as Objet;
    expect(d.ecartEntreRangsCm).toBe(s === undefined ? undefined : ecartSource(s));
    const r = validerItineraire({ ...l, ferme_id: FERME_TEST, parametres: JSON.stringify(l.parametres) });
    expect(r.ok ? null : r.erreur).toBeNull();
    if (r.ok) expect(r.valeur.parametres).toEqual(l.parametres);
  });

  it('mêmes itinéraires, mêmes noms et identifiants qu’après 0035', () => {
    const e35 = db.lireEtatsBibliotheque().find((e) => e.migration === PRECEDENTE)?.lignes;
    expect(lignes.itineraires.map((i) => [i.id, i.nom]).sort()).toEqual((e35?.itineraires ?? []).map((i) => [i.id, i.nom]).sort());
  });
});

describe('T43 : la migration de bibliothèque 0036', () => {
  const etats = db.lireEtatsBibliotheque();
  const etat = (m: string): db.LignesBibliotheque => {
    const e = etats.find((x) => x.migration === m)?.lignes;
    if (e === undefined) throw new Error(`état ${m} absent`);
    return e;
  };

  it('dernière migration de bibliothèque, au journal (idx 36), dépôt à jour', () => {
    expect(etats.at(-1)?.migration).toBe(MIGRATION);
    const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find((e) => e.tag === MIGRATION)?.idx).toBe(36);
    expect(db.verifierBibliotheque(db.depotBibliotheque())).toEqual([]);
  });

  it('modifie les 46 itinéraires, et seulement eux : ni famille ni espèce, rien d’ajouté ni de retiré', () => {
    const changements = db.changementsBibliotheque(etat(PRECEDENTE), etat(MIGRATION));
    expect(changements.every((c) => c.table === 'itineraire' && c.sorte === 'modifiee'), JSON.stringify(changements)).toBe(true);
    expect(changements.map((c) => c.id).sort()).toEqual(lignes.itineraires.map((i) => i.id).sort());
  });

  it('chaque itinéraire ne change que par son écart entre rangs', () => {
    const avant = new Map(etat(PRECEDENTE).itineraires.map((i) => [i.id, i] as const));
    for (const i of etat(MIGRATION).itineraires) {
      const a = avant.get(i.id);
      if (a === undefined) throw new Error(`${i.nom} absent de 0035`);
      const densite: Objet = { ...(i.parametres.densite as unknown as Objet) };
      delete densite.ecartEntreRangsCm;
      expect({ ...i, parametres: { ...i.parametres, densite } }, i.nom).toEqual(a);
    }
  });

  it('son SQL est celui de la mécanique de T41b, sans DELETE, gardé par ferme_id IS NULL', () => {
    const sql = readFileSync(new URL(`../migrations/${MIGRATION}.sql`, import.meta.url), 'utf8');
    expect(sql).toBe(db.sqlMiseAJourBibliotheque(MIGRATION, etat(PRECEDENTE), etat(MIGRATION)));
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|DROP|ALTER)\b/);
    expect(sql).toMatch(/WHERE itineraire\.ferme_id IS NULL/);
    for (const interdit of ['masterclass', 'master class', 'jardinier-maraicher', 'jardinier maraicher', 'institut jardinier']) expect(plat(sql).includes(interdit), interdit).toBe(false);
  });
});
