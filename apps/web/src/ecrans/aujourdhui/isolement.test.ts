/**
 * Test d'acceptation T13c (contre-relecture de T13b) — isolement entre fermes des NOMS de la
 * journée : emplacements, espèces et variétés sont lus par identifiant (`SQL_EMPLACEMENTS`,
 * `SQL_ESPECES`, `SQL_VARIETES`, jointures de `sqlCampagnes`), sans filtre de ferme. Une ligne
 * d'une AUTRE ferme présente dans la base locale, dont l'identifiant est référencé par une
 * occupation, une série ou une plantation de la ferme affichée, ne doit jamais apparaître dans la
 * journée : ni code d'emplacement (ni son identifiant), ni nom d'espèce, ni nom de variété ;
 * dans les tâches, les récoltes en cours, les dernières récoltes ou l'historique.
 *
 * Témoin : les mêmes lignes rangées dans la ferme affichée apparaissent bien (le relevé de la
 * journée les voit).
 *
 * Banc : comme journal.test.ts, la ferme du jour avec travaux (./test/ferme-du-jour.ts) dans la
 * base du téléphone telle que PowerSync la range (./test/base-powersync.ts), aujourd'hui =
 * 2026-09-30.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { calculerJournee, lireJournee, type Journee } from './calculs.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { cleTache, CAMPAGNE, ecrireFermeDuJour, FERME, PLANTATION, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');
const C = '2025-01-01T08:00:00.000Z';
const idTest = (n: number) => `0192f0c1-13c1-7000-8000-0000000b${n.toString(16).padStart(4, '0')}`;
/** L'autre ferme : ses lignes sont dans la base locale (un utilisateur membre de deux fermes). */
const AUTRE_FERME = '0192f0c1-13c1-7000-8000-00000000eeee';

const EMPLACEMENT_ETRANGER = idTest(0x1);
const ESPECE_ETRANGERE = idTest(0x2);
const VARIETE_ETRANGERE = idTest(0x3);
const CODE_ETRANGER = 'ZZ-P99';
const NOM_ESPECE_ETRANGERE = 'Espèce de l’autre ferme';
const NOM_VARIETE_ETRANGERE = 'Variété de l’autre ferme';

let base: BasePowerSync;
let porte: PorteDonnees;

beforeEach(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  porte = creerPorte(base, {
    utilisateurId: UTILISATEUR as Id<'Utilisateur'>,
    fermeId: FERME as Id<'Ferme'>,
  });
});

afterEach(() => {
  base.fermer();
});

/** Ligne reçue par la synchro. */
function recevoir(table: string, ligne: Readonly<Record<string, string | number | null>>): void {
  const c = Object.keys(ligne);
  base.recevoir(
    `INSERT INTO ${table} (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`,
    c.map((k) => ligne[k] ?? null),
  );
}

const horo = { cree_le: C, modifie_le: C, supprime_le: null };

/**
 * Range dans la base l'emplacement, l'espèce et la variété de `fermeDesLignes`, et les fait
 * référencer par la ferme affichée :
 *   - l'emplacement : occupé (occupation de la ferme affichée) par la série de chou (plantation,
 *     7 j de retard) et par la plantation de fraisiers (début de récolte en retard, récolte en
 *     cours) ;
 *   - l'espèce : celle de la série de chou et de la plantation de fraisiers ;
 *   - la variété : celle de la série de radis (semis cette semaine), de la plantation de
 *     fraisiers et de la série de tomates (récolte en cours, récoltes dans l'historique).
 */
type Reference = 'emplacement' | 'espece' | 'variete';

function lignesReferencees(fermeDesLignes: string, quoi: readonly Reference[] = ['emplacement', 'espece', 'variete']): void {
  if (quoi.includes('emplacement')) {
    recevoir('emplacement', {
      id: EMPLACEMENT_ETRANGER,
      ferme_id: fermeDesLignes,
      zone_id: null,
      code: CODE_ETRANGER,
      sorte: 'planche',
      longueur_m: 30,
      largeur_m: 0.8,
      nombre_places: null,
      actif_du: '2024-01-01',
      actif_au: null,
      remplace: '[]',
      ...horo,
    });
  }
  // L'espèce est rangée dans tous les cas (la variété la référence) ; seule `quoi` dit qui la référence.
  recevoir('espece', {
    id: ESPECE_ETRANGERE,
    ferme_id: fermeDesLignes,
    famille_id: null,
    nom: NOM_ESPECE_ETRANGERE,
    categorie: 'legume',
    perenne: 0,
    unite_recolte: 'kg',
    delai_retour_minimal_ans: null,
    delai_retour_conseille_ans: null,
    ...horo,
  });
  recevoir('variete', {
    id: VARIETE_ETRANGERE,
    ferme_id: fermeDesLignes,
    espece_id: ESPECE_ETRANGERE,
    nom: NOM_VARIETE_ETRANGERE,
    fournisseur: null,
    poids_mille_graines_g: 3,
    taux_germination: 90,
    ...horo,
  });
  const occupation = (id: string, cible: { serie_id: string | null; plantation_id: string | null }) => {
    recevoir('occupation', {
      id,
      ferme_id: FERME,
      emplacement_id: EMPLACEMENT_ETRANGER,
      ...cible,
      evenement_id: null,
      longueur_m: 30,
      nombre_places: null,
      position_m: 0,
      prevu_du: '2026-01-01',
      prevu_au: '2027-12-31',
      reel_du: null,
      reel_au: null,
      ...horo,
    });
  };
  if (quoi.includes('emplacement')) {
    occupation(idTest(0x11), { serie_id: SERIE.chou, plantation_id: null });
    occupation(idTest(0x12), {
      serie_id: null,
      plantation_id: PLANTATION.fraise,
    });
  }
  if (quoi.includes('espece')) {
    base.recevoir('UPDATE serie SET espece_id = ? WHERE id = ?', [ESPECE_ETRANGERE, SERIE.chou]);
    base.recevoir('UPDATE plantation SET espece_id = ? WHERE id = ?', [ESPECE_ETRANGERE, PLANTATION.fraise]);
  }
  if (quoi.includes('variete')) {
    base.recevoir('UPDATE plantation SET variete_id = ? WHERE id = ?', [VARIETE_ETRANGERE, PLANTATION.fraise]);
    base.recevoir('UPDATE serie SET variete_id = ? WHERE id IN (?, ?)', [VARIETE_ETRANGERE, SERIE.radis, SERIE.tomate]);
  }
}

const journee = async (): Promise<Journee> => calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);

/** Toute la journée en texte (Map comprises) : ce que l'écran peut en montrer. */
const enTexte = (j: Journee): string => JSON.stringify(j, (_cle, v: unknown) => (v instanceof Map ? [...(v as Map<unknown, unknown>).entries()] : v));

/** Ce qui fuit de l'autre ferme dans la journée. */
function fuites(j: Journee): string[] {
  const t = enTexte(j);
  return [
    [CODE_ETRANGER, 'code d’emplacement'],
    [EMPLACEMENT_ETRANGER, 'identifiant d’emplacement'],
    [NOM_ESPECE_ETRANGERE, 'nom d’espèce'],
    [NOM_VARIETE_ETRANGERE, 'nom de variété'],
  ]
    .filter(([x]) => t.includes(x ?? ''))
    .map(([x, quoi]) => `${quoi ?? ''} « ${x ?? ''} »`);
}

describe('T13c : emplacement, espèce et variété d’une autre ferme jamais dans la journée', () => {
  it('référencés par une occupation, une série ou une plantation de la ferme affichée : ni code, ni nom d’espèce, ni nom de variété', async () => {
    lignesReferencees(AUTRE_FERME);
    const j = await journee();
    // Les cultures concernées sont bien dans la journée (sinon le test ne prouverait rien).
    const cles = j.taches.map((t) => t.cle);
    expect(cles).toContain(cleTache(SERIE.chou, 'plantation'));
    expect(cles).toContain(cleTache(CAMPAGNE.fraise, 'debut_recolte'));
    expect(cles).toContain(cleTache(SERIE.radis, 'semis_direct'));
    expect(fuites(j), 'lignes de l’autre ferme montrées dans la journée').toEqual([]);
  });

  it('l’emplacement seul (occupation de la ferme affichée sur la série de chou) : pas dans les emplacements du chou', async () => {
    lignesReferencees(AUTRE_FERME, ['emplacement']);
    const chou = (await journee()).taches.find((t) => t.cle === cleTache(SERIE.chou, 'plantation'));
    expect(
      chou?.culture.emplacements.map((e) => e.code),
      'emplacements du chou',
    ).toEqual(['T2-P03']);
  });

  it('l’espèce seule (série de chou) : pas le nom de l’espèce de l’autre ferme', async () => {
    lignesReferencees(AUTRE_FERME, ['espece']);
    const chou = (await journee()).taches.find((t) => t.cle === cleTache(SERIE.chou, 'plantation'));
    expect(chou, 'tâche du chou').toBeDefined();
    expect(chou?.culture.espece, 'nom d’espèce du chou').not.toBe(NOM_ESPECE_ETRANGERE);
  });

  it('la variété seule (série de radis) : pas le nom de la variété de l’autre ferme', async () => {
    lignesReferencees(AUTRE_FERME, ['variete']);
    const radis = (await journee()).taches.find((t) => t.cle === cleTache(SERIE.radis, 'semis_direct'));
    expect(radis, 'tâche du radis').toBeDefined();
    expect(radis?.culture.variete ?? null, 'nom de variété du radis').not.toBe(NOM_VARIETE_ETRANGERE);
  });

  it('témoin : les mêmes lignes rangées dans la ferme affichée apparaissent (code, espèce, variété)', async () => {
    lignesReferencees(FERME);
    const j = await journee();
    expect(fuites(j).sort()).toEqual(
      [
        `code d’emplacement « ${CODE_ETRANGER} »`,
        `identifiant d’emplacement « ${EMPLACEMENT_ETRANGER} »`,
        `nom d’espèce « ${NOM_ESPECE_ETRANGERE} »`,
        `nom de variété « ${NOM_VARIETE_ETRANGERE} »`,
      ].sort(),
    );
  });
});
