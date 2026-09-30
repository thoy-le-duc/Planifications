/**
 * Tests d'acceptation T11 — calculs de la vue 2D (placement des barres, conflits, groupement,
 * fenêtre de lignes à dessiner). Contrat : ./test/contrat.ts.
 *
 * Deux jeux : une petite ferme écrite à la main pour les résultats chiffrés
 * (./test/petite-ferme.ts), et la ferme de T07 au volume réel (400 emplacements, 3 000
 * occupations) dans la base mémoire de @planif/sync, lue par la porte. Les conflits attendus
 * sont calculés par le moteur de T03 lui-même (./test/t03.ts) : la vue n'invente aucune règle.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07, type JeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import type { BarrePlan, DonneesPlan, LigneEmplacementPlan, LigneLocale, ModuleCalculsPlan, Plan, SaisonPlan } from './test/contrat.ts';
import { E, FERME, LIGNES_SAISON, O, PETITE_FERME, PLANTATION, S, SAISON_2025, SAISON_2026, SAISONS, Z } from './test/petite-ferme.ts';
import { comparable, conflitsAttendus, recoupeSaison } from './test/t03.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_MODULE = './calculs.ts';

let m: ModuleCalculsPlan;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleCalculsPlan;
});

/** Jours depuis le lundi 2025-12-29 (colonne 0 de la saison 2026), sans fuseau. */
function jour2026(date: string): number {
  const [a, mo, j] = date.split('-').map(Number);
  return Math.round((Date.UTC(a ?? 0, (mo ?? 1) - 1, j ?? 1) - Date.UTC(2025, 11, 29)) / 86_400_000);
}

function emplacements(plan: Plan): LigneEmplacementPlan[] {
  return plan.lignes.filter((l): l is LigneEmplacementPlan => l.sorte === 'emplacement');
}

function ligne(plan: Plan, id: string): LigneEmplacementPlan {
  const l = emplacements(plan).find((e) => e.id === id);
  if (l === undefined) throw new Error(`ligne ${id} absente`);
  return l;
}

function barre(plan: Plan, occupationId: string): BarrePlan {
  const b = emplacements(plan)
    .flatMap((l) => l.barres)
    .find((x) => x.occupationId === occupationId);
  if (b === undefined) throw new Error(`barre ${occupationId} absente`);
  return b;
}

// ── Petite ferme : résultats chiffrés ────────────────────────────────────────────────────────

describe('T11 : petite ferme, saison 2026', () => {
  let plan: Plan;

  beforeAll(() => {
    plan = m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-04-15' });
  });

  it('colonnes : les 53 semaines ISO de 2026, de S01 (lundi 2025-12-29) à S53', () => {
    expect(plan.saison).toEqual(SAISON_2026);
    expect(plan.semaines).toHaveLength(53);
    expect(plan.semaines[0]).toEqual({ annee: 2026, semaine: 1, libelle: 'S01', lundi: '2025-12-29' });
    expect(plan.semaines[15]).toEqual({ annee: 2026, semaine: 16, libelle: 'S16', lundi: '2026-04-13' });
    expect(plan.semaines[52]).toEqual({ annee: 2026, semaine: 53, libelle: 'S53', lundi: '2026-12-28' });
    // Sans trou : sept jours entre deux lundis.
    for (let i = 1; i < plan.semaines.length; i++) {
      expect(jour2026(plan.semaines[i]?.lundi ?? '') - jour2026(plan.semaines[i - 1]?.lundi ?? '')).toBe(7);
    }
  });

  it('semaine courante : indice de la semaine d’aujourd’hui, null hors saison', () => {
    expect(plan.semaineCourante).toBe(15);
    expect(m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2025-12-29' }).semaineCourante).toBe(0);
    expect(m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2027-01-03' }).semaineCourante).toBe(52);
    expect(m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2027-06-01' }).semaineCourante).toBeNull();
  });

  it('lignes groupées par zone puis chapelle, emplacements actifs seulement, tri « naturel »', () => {
    expect(plan.lignes.map((l) => [l.sorte, l.sorte === 'emplacement' ? l.code : l.nom])).toEqual([
      ['zone', 'Serre'],
      ['emplacement', 'S-P1'],
      ['chapelle', 'Chapelle 1'],
      ['emplacement', 'C1-P1'],
      // Sous-chapelle : rangée sous sa chapelle, pas de troisième niveau.
      ['emplacement', 'DC-P1'],
      ['chapelle', 'Chapelle 2'],
      ['emplacement', 'C2-P1'],
      ['zone', 'Tunnel 2'],
      ['emplacement', 'T2-P2'],
      ['emplacement', 'T2-P10'],
      ['zone', 'Tunnel 10'],
      ['emplacement', 'T10-P1'],
    ]);
    const ids = plan.lignes.map((l) => l.id);
    // Verger : son seul emplacement a fini d'être actif le jour où la saison commence.
    expect(ids).not.toContain(Z.vide);
    for (const inactif of [E.ancien, E.futur, E.supprime]) expect(ids).not.toContain(inactif);
    expect(ligne(plan, E.dcp1)).toMatchObject({ zoneId: Z.serre, chapelleId: Z.chapelle1, barres: [], conflits: [] });
    expect(ligne(plan, E.sp1)).toMatchObject({ zoneId: Z.serre, chapelleId: null });
    expect(ligne(plan, E.t2p2)).toMatchObject({ zoneId: Z.tunnel2, chapelleId: null });
  });

  it('barres : une par occupation de la saison, triées par début, bornées à la saison', () => {
    const t2p2 = ligne(plan, E.t2p2);
    expect(t2p2.barres.map((b) => b.occupationId)).toEqual([O.courgetteHiver, O.tomateReelle, O.laituePrevue]);
    const toutes = emplacements(plan).flatMap((l) => l.barres.map((b) => b.occupationId));
    // Supprimée, 2027, 2025 : pas de barre.
    for (const absente of [O.supprimee, O.laitue2027, O.horsSaisonA, O.horsSaisonB]) expect(toutes).not.toContain(absente);
    expect(new Set(toutes).size).toBe(toutes.length);
  });

  it('placement : jours entiers depuis le lundi de S01 ; le réel prime sur le prévu', () => {
    // Plantée le 8 avril (réel), fin prévue le 3 août.
    expect(barre(plan, O.tomateReelle)).toMatchObject({
      etat: 'reel',
      du: '2026-04-08',
      au: '2026-08-03',
      debutJour: jour2026('2026-04-08'),
      finJour: jour2026('2026-08-03'),
      serieId: S.tomate,
      plantationId: null,
    });
    expect(jour2026('2026-04-08')).toBe(100);
    expect(barre(plan, O.laituePrevue)).toMatchObject({ etat: 'prevu', du: '2026-06-01', au: '2026-07-13', debutJour: 154, finJour: 196 });
    // Commencée en octobre 2025 : bornée à 0, la période reste entière.
    expect(barre(plan, O.courgetteHiver)).toMatchObject({ du: '2025-10-01', au: '2026-02-02', debutJour: 0, finJour: 35 });
    // Pérenne sans fin : toute la saison, au nul.
    expect(barre(plan, O.plantation)).toMatchObject({ du: '2024-03-01', au: null, debutJour: 0, finJour: 53 * 7, plantationId: PLANTATION, serieId: null });
    for (const b of emplacements(plan).flatMap((l) => l.barres)) {
      expect(Number.isInteger(b.debutJour) && Number.isInteger(b.finJour), b.occupationId).toBe(true);
      expect(b.debutJour).toBeGreaterThanOrEqual(0);
      expect(b.finJour).toBeLessThanOrEqual(53 * 7);
      expect(b.finJour).toBeGreaterThan(b.debutJour);
    }
  });

  it('libellé culture + variété, famille et couleur', () => {
    expect(barre(plan, O.tomateReelle)).toMatchObject({ libelle: 'Tomate Cœur de bœuf', famille: 'Solanacées', cleFamille: 'solanacees' });
    expect(barre(plan, O.laituePrevue)).toMatchObject({ libelle: 'Laitue Batavia', famille: 'Astéracées', cleFamille: 'salades' });
    // Sans variété : l'espèce seule ; famille propre à la ferme, sans couleur attitrée.
    expect(barre(plan, O.courgetteHiver)).toMatchObject({ libelle: 'Courgette', famille: 'Cucurbitacées', cleFamille: null });
    expect(barre(plan, O.plantation)).toMatchObject({ libelle: 'Tomate', famille: 'Solanacées', cleFamille: 'solanacees' });
    expect(barre(plan, O.couverture)).toMatchObject({ libelle: 'Couverture', famille: null, cleFamille: null, serieId: null, plantationId: null });
  });

  it('conflits de T03 : chevauchement et dépassement, nommés ; rien hors saison', () => {
    expect(m.NOMS_CONFLITS.chevauchement).toBe('Chevauchement');
    const noms = Object.values(m.NOMS_CONFLITS);
    expect(noms).toHaveLength(5);
    for (const n of noms) expect(n.trim()).not.toBe('');
    expect(new Set(noms).size).toBe(5);

    const t2p2 = ligne(plan, E.t2p2);
    expect(t2p2.conflits.map(comparable)).toEqual([
      comparable({ sorte: 'chevauchement', occupations: [O.tomateReelle, O.laituePrevue], du: '2026-06-01', au: '2026-07-13' }),
    ]);
    expect(t2p2.conflits[0]?.nom).toMatch(/^Chevauchement : (Tomate Cœur de bœuf et Laitue Batavia|Laitue Batavia et Tomate Cœur de bœuf)$/);
    expect(barre(plan, O.tomateReelle).enConflit).toBe(true);
    expect(barre(plan, O.laituePrevue).enConflit).toBe(true);
    expect(barre(plan, O.courgetteHiver).enConflit).toBe(false);

    const c1p1 = ligne(plan, E.c1p1);
    expect(c1p1.conflits.map((c) => c.sorte)).toEqual(['depassement']);
    expect(c1p1.conflits[0]?.nom).toBe(`${m.NOMS_CONFLITS.depassement} : Tomate Cœur de bœuf`);
    expect(barre(plan, O.depassement).enConflit).toBe(true);

    // Chevauchement de 2025 sur S-P1 : pas dans la saison 2026.
    expect(ligne(plan, E.sp1).conflits).toEqual([]);
    expect(barre(plan, O.sp1Seule).enConflit).toBe(false);
    // Le même, vu en 2025.
    const plan2025 = m.construirePlan(PETITE_FERME, { saison: SAISON_2025, aujourdhui: '2026-04-15' });
    expect(ligne(plan2025, E.sp1).conflits.map((c) => c.sorte)).toEqual(['chevauchement']);
  });

  it('conflits identiques à ceux de T03, emplacement par emplacement', () => {
    const attendus = conflitsAttendus(PETITE_FERME.emplacement, PETITE_FERME.occupation, SAISON_2026);
    for (const l of emplacements(plan)) expect(l.conflits.map(comparable), l.code).toEqual(attendus.get(l.id) ?? []);
  });

  it('pas de Date ni de fuseau : même résultat, quel que soit le fuseau du téléphone', () => {
    const avant = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      const loin = m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-04-15' });
      process.env.TZ = 'America/Anchorage';
      const ouest = m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-04-15' });
      expect(loin).toEqual(plan);
      expect(ouest).toEqual(plan);
    } finally {
      if (avant === undefined) delete process.env.TZ;
      else process.env.TZ = avant;
    }
  });

  it('données non modifiées (fonction pure)', () => {
    const copie = structuredClone(PETITE_FERME);
    m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-04-15' });
    expect(PETITE_FERME).toEqual(copie);
  });
});

describe('T11 : saison par défaut', () => {
  it('celle qui contient aujourd’hui ; sinon la dernière commencée ; sinon la première', () => {
    expect(m.saisonParDefaut(SAISONS, '2026-04-15')?.nom).toBe('2026');
    expect(m.saisonParDefaut(SAISONS, '2026-01-01')?.nom).toBe('2026');
    expect(m.saisonParDefaut(SAISONS, '2025-12-31')?.nom).toBe('2025');
    expect(m.saisonParDefaut(SAISONS, '2031-05-01')?.nom).toBe('2027');
    expect(m.saisonParDefaut(SAISONS, '2020-05-01')?.nom).toBe('2025');
    expect(m.saisonParDefaut([], '2026-04-15')).toBeNull();
    // Saisons sans ordre : le résultat ne dépend pas de l'ordre reçu.
    expect(m.saisonParDefaut([...SAISONS].reverse(), '2031-05-01')?.nom).toBe('2027');
  });
});

describe('T11 : couleur par famille (jetons FAMILLES de T16)', () => {
  it('quatre familles attitrées, les autres neutres', () => {
    expect(m.cleFamille('Solanacées')).toBe('solanacees');
    expect(m.cleFamille('solanacees')).toBe('solanacees');
    expect(m.cleFamille('Brassicacées')).toBe('cruciferes');
    expect(m.cleFamille('Crucifères')).toBe('cruciferes');
    expect(m.cleFamille('Astéracées')).toBe('salades');
    expect(m.cleFamille('ASTÉRACÉES')).toBe('salades');
    expect(m.cleFamille('Apiacées')).toBe('racines');
    for (const autre of ['Cucurbitacées', 'Fabacées', 'Alliacées', 'Rosacées', 'Famille locale 1', '']) expect(m.cleFamille(autre), autre).toBeNull();
    expect(m.cleFamille(null)).toBeNull();
  });
});

describe('T11 : fenêtre de lignes à dessiner (virtualisation)', () => {
  const H = 44;

  it('hauteur de ligne : au moins 44 px (maquette Plan, gants)', () => {
    expect(m.HAUTEUR_LIGNE_PX).toBeGreaterThanOrEqual(44);
  });

  it('couvre la vue, marge comprise, bornée ; 400 lignes → une vingtaine dessinées', () => {
    for (const [defilement, hauteurVue] of [
      [0, 800],
      [44 * 100 + 13, 800],
      [44 * 395, 800],
      [44 * 430, 800],
      [0, 0],
      [1234, 360],
    ] as const) {
      const f = m.fenetreVisible({ defilement, hauteurVue, hauteurLigne: H, total: 430, marge: 5 });
      const premiere = Math.min(430, Math.floor(defilement / H));
      const derniere = Math.min(430, Math.ceil((defilement + hauteurVue) / H));
      expect(f.debut, `debut à ${String(defilement)}`).toBeLessThanOrEqual(premiere);
      expect(f.fin, `fin à ${String(defilement)}`).toBeGreaterThanOrEqual(derniere);
      expect(f.debut).toBeGreaterThanOrEqual(Math.max(0, premiere - 5));
      expect(f.fin).toBeLessThanOrEqual(Math.min(430, derniere + 5 + 1));
      expect(f.debut).toBeGreaterThanOrEqual(0);
      expect(f.fin).toBeLessThanOrEqual(430);
      expect(f.fin).toBeGreaterThanOrEqual(f.debut);
    }
    const haut = m.fenetreVisible({ defilement: 0, hauteurVue: 800, hauteurLigne: H, total: 430, marge: 5 });
    expect(haut.debut).toBe(0);
    expect(haut.fin - haut.debut).toBeLessThan(60);
    const bas = m.fenetreVisible({ defilement: 44 * 430 - 800, hauteurVue: 800, hauteurLigne: H, total: 430, marge: 5 });
    expect(bas.fin).toBe(430);
  });

  it('liste vide : fenêtre vide', () => {
    expect(m.fenetreVisible({ defilement: 0, hauteurVue: 800, hauteurLigne: H, total: 0, marge: 5 })).toEqual({ debut: 0, fin: 0 });
  });
});

// ── Ferme de T07 : 400 emplacements, lue par la porte ────────────────────────────────────────

const lignesDe = (base: BaseMemoire, table: string, fermeId: string): LigneLocale[] =>
  base.lireDirect<LigneLocale>(`SELECT * FROM ${table} WHERE ferme_id = ? OR ferme_id IS NULL`, [fermeId]);

describe('T11 : ferme de T07 (jeu de T15), lue par la porte', () => {
  let base: BaseMemoire;
  const aFermer: BaseMemoire[] = [];
  let porte: PorteDonnees;
  let jeu: JeuT07;
  let saisons: SaisonPlan[];
  let saison: SaisonPlan;
  let plan: Plan;

  beforeAll(async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    aFermer.push(base);
    jeu = await remplirJeuT07(base);
    porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    saisons = await m.chargerSaisons(porte, jeu.principale.fermeId);
    const s = m.saisonParDefaut(saisons, '2026-09-30');
    if (s === null) throw new Error('aucune saison');
    saison = s;
    plan = await m.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui: '2026-09-30' });
  }, 120_000);

  afterAll(() => {
    for (const b of aFermer) b.fermer();
  });

  it('saisons de la ferme, triées ; 2026 par défaut le 30 septembre 2026', () => {
    expect(saisons.map((s) => s.nom)).toEqual(['2022', '2023', '2024', '2025', '2026']);
    expect(saison).toMatchObject({ nom: '2026', debut: '2026-01-01', fin: '2026-12-31' });
    expect(plan.semaineCourante).toBe(39);
    expect(plan.semaines[39]?.libelle).toBe('S40');
  });

  it('400 emplacements sous 30 zones, sans chapelle', () => {
    expect(emplacements(plan)).toHaveLength(400);
    expect(plan.lignes.filter((l) => l.sorte === 'zone')).toHaveLength(30);
    expect(plan.lignes.filter((l) => l.sorte === 'chapelle')).toHaveLength(0);
    expect(plan.lignes[0]?.sorte).toBe('zone');
    // Chaque emplacement suit sa zone.
    let zoneCourante = '';
    for (const l of plan.lignes) {
      if (l.sorte === 'zone') zoneCourante = l.id;
      else if (l.sorte === 'emplacement') expect(l.zoneId).toBe(zoneCourante);
    }
  });

  it('rien de la ferme voisine', () => {
    const voisine = new Set(jeu.voisine.ids);
    for (const l of plan.lignes) {
      expect(voisine.has(l.id), l.id).toBe(false);
      if (l.sorte === 'emplacement') for (const b of l.barres) expect(voisine.has(b.occupationId), b.occupationId).toBe(false);
    }
  });

  it('une barre par occupation qui recoupe 2026', () => {
    const occupations = base.lireDirect<LigneLocale>('SELECT * FROM occupation WHERE ferme_id = ? AND supprime_le IS NULL', [jeu.principale.fermeId]);
    const attendues = occupations
      .filter((o) => {
        const du = String(o.reel_du ?? o.prevu_du);
        const au = String(o.reel_au ?? o.prevu_au);
        return recoupeSaison(du, au === '9999-12-31' ? null : au, saison.debut, saison.fin);
      })
      .map((o) => String(o.id))
      .sort();
    expect(attendues.length).toBeGreaterThan(500);
    expect(
      emplacements(plan)
        .flatMap((l) => l.barres.map((b) => b.occupationId))
        .sort(),
    ).toEqual(attendues);
    const etats = new Set(emplacements(plan).flatMap((l) => l.barres.map((b) => b.etat)));
    expect(etats).toEqual(new Set(['reel', 'prevu']));
  });

  it('conflits : ceux de T03, et le jeu en contient (témoin)', () => {
    const attendus = conflitsAttendus(
      lignesDe(base, 'emplacement', jeu.principale.fermeId).filter((e) => e.ferme_id === jeu.principale.fermeId),
      base.lireDirect<LigneLocale>('SELECT * FROM occupation WHERE ferme_id = ?', [jeu.principale.fermeId]),
      saison,
    );
    let total = 0;
    for (const l of emplacements(plan)) {
      expect(l.conflits.map(comparable), l.code).toEqual(attendus.get(l.id) ?? []);
      total += l.conflits.length;
      const enCause = new Set(l.conflits.flatMap((c) => c.occupations));
      for (const b of l.barres) expect(b.enConflit, `${l.code} ${b.occupationId}`).toBe(enCause.has(b.occupationId));
      for (const c of l.conflits) expect(c.nom.startsWith(`${m.NOMS_CONFLITS[c.sorte]} : `), c.nom).toBe(true);
    }
    expect(total).toBeGreaterThan(0);
  });

  it('libellés « Espèce N Variété N-k » et familles du jeu', () => {
    const b = emplacements(plan).flatMap((l) => l.barres);
    for (const x of b) expect(x.libelle).toMatch(/^Espèce \d+ Variété \d+-\d$/);
    const cles = new Set(b.map((x) => x.cleFamille));
    // Solanacées, Brassicacées, Astéracées, Apiacées et des familles sans couleur attitrée.
    expect(cles).toContain('solanacees');
    expect(cles).toContain(null);
  });

  it('calcul rapide : construirePlan sur toute la ferme en moins de 80 ms (médiane de 5, Node)', () => {
    const f = jeu.principale.fermeId;
    const donnees: DonneesPlan = {
      zone: base.lireDirect('SELECT * FROM zone WHERE ferme_id = ?', [f]),
      emplacement: base.lireDirect('SELECT * FROM emplacement WHERE ferme_id = ?', [f]),
      occupation: base.lireDirect('SELECT * FROM occupation WHERE ferme_id = ?', [f]),
      serie: base.lireDirect('SELECT * FROM serie WHERE ferme_id = ?', [f]),
      plantation: base.lireDirect('SELECT * FROM plantation WHERE ferme_id = ?', [f]),
      espece: lignesDe(base, 'espece', f),
      variete: lignesDe(base, 'variete', f),
      famille: lignesDe(base, 'famille', f),
    };
    const direct = m.construirePlan(donnees, { saison, aujourdhui: '2026-09-30' });
    expect(direct).toEqual(plan);
    const durees: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      m.construirePlan(donnees, { saison, aujourdhui: '2026-09-30' });
      durees.push(performance.now() - t);
    }
    durees.sort((a, b) => a - b);
    const mediane = durees[2] ?? Number.POSITIVE_INFINITY;
    console.log(`construirePlan, ferme de T07 : ${mediane.toFixed(1)} ms (médiane)`);
    expect(mediane).toBeLessThan(80);
  });
});

describe('T11 : petite ferme lue par la porte (base mémoire)', () => {
  it('chargerPlan rend ce que construirePlan calcule ; chargerSaisons ignore les saisons supprimées', async () => {
    const base = creerBaseMemoire(SCHEMA_LOCAL);
    try {
      const inserer = async (table: string, lignes: readonly LigneLocale[]) => {
        for (const l of lignes) {
          const cles = Object.keys(l);
          await base.execute(`INSERT INTO ${table} (${cles.join(', ')}) VALUES (${cles.map(() => '?').join(', ')})`, cles.map((c) => l[c] ?? null));
        }
      };
      for (const [table, lignes] of Object.entries(PETITE_FERME) as [string, LigneLocale[]][]) await inserer(table, lignes);
      await inserer('saison', [
        ...LIGNES_SAISON,
        { id: '0192f0c1-0000-7000-8000-000000000999', ferme_id: FERME, nom: 'Supprimée', debut: '2024-01-01', fin: '2024-12-31', cree_le: null, modifie_le: null, supprime_le: '2026-01-02T00:00:00.000Z' },
        // Saison d'une autre ferme.
        { id: '0192f0c1-0000-7000-8000-000000000998', ferme_id: '0192f0c1-0000-7000-8000-00000000f002', nom: 'Ailleurs', debut: '2026-01-01', fin: '2026-12-31', cree_le: null, modifie_le: null, supprime_le: null },
      ]);
      const porte = creerPorte(base, { utilisateurId: '0192f0c1-0000-7000-8000-00000000u001' as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
      const saisons = await m.chargerSaisons(porte, FERME);
      expect(saisons).toEqual(SAISONS);
      const lu = await m.chargerPlan(porte, FERME, { saison: SAISON_2026, aujourdhui: '2026-04-15' });
      expect(lu).toEqual(m.construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-04-15' }));
    } finally {
      base.fermer();
    }
  });
});

// ── Les conflits viennent de T03 : aucune règle réécrite dans l'écran ─────────────────────────

function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === 'test' ? [] : sources(chemin);
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : [];
  });
}

describe('T11 : sources de l’écran', () => {
  it('appellent detecterConflits de T03 et n’importent ni PowerSync ni src/donnees', () => {
    const fichiers = sources(import.meta.dirname);
    const textes = fichiers.map((f) => readFileSync(f, 'utf8'));
    expect(fichiers.length).toBeGreaterThan(0);
    expect(textes.some((t) => /\bdetecterConflits\s*\(/.test(t)), 'detecterConflits appelé').toBe(true);
    for (const [i, t] of textes.entries()) {
      expect(/from\s+['"]@powersync\//.test(t), fichiers[i]).toBe(false);
      expect(/from\s+['"][./]*donnees\//.test(t), fichiers[i]).toBe(false);
      // Pas d'objet Date dans les calculs : dates calendaires de @planif/core.
      if (fichiers[i]?.endsWith('calculs.ts')) expect(/\bnew Date\b|\bDate\.(?:now|parse|UTC)\b/.test(t), 'Date dans calculs.ts').toBe(false);
    }
  });
});
