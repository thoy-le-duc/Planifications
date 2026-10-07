/**
 * T10s — règles d'une ligne du parcellaire et du catalogue (structure-lignes.ts), sans base :
 * chaque plafond de PLAFONDS_STRUCTURE juste dessous (accepté) et juste dessus (refusé), gouttière
 * ⇔ nombre de places, délais de retour, dates de 1900 à 2100, liste `remplace`.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PLAFONDS_STRUCTURE, validerStructure, type Ligne, type TableStructure } from './structure-lignes.ts';

const FERME = randomUUID();

const BASES: Readonly<Record<TableStructure, () => Record<string, unknown>>> = {
  zone: () => ({ id: randomUUID(), ferme_id: FERME, nom: 'Tunnel 3', zone_parente_id: null, type_abri: 'tunnel', surface_m2: 240 }),
  emplacement: () => ({
    id: randomUUID(),
    ferme_id: FERME,
    zone_id: randomUUID(),
    code: 'T3-P01',
    sorte: 'planche',
    longueur_m: 30,
    largeur_m: 0.8,
    nombre_places: null,
    actif_du: '2026-01-01',
    actif_au: null,
    remplace: '[]',
  }),
  famille: () => ({ id: randomUUID(), ferme_id: FERME, nom: 'Brassicacées', delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6 }),
  espece: () => ({
    id: randomUUID(),
    ferme_id: FERME,
    famille_id: randomUUID(),
    nom: 'Chou',
    categorie: 'legume',
    perenne: 0,
    unite_recolte: 'piece',
    delai_retour_minimal_ans: null,
    delai_retour_conseille_ans: null,
  }),
  variete: () => ({ id: randomUUID(), ferme_id: FERME, espece_id: randomUUID(), nom: 'Rougette', fournisseur: null, poids_mille_graines_g: 3.5, taux_germination: 85 }),
  saison: () => ({ id: randomUUID(), ferme_id: FERME, nom: '2027', debut: '2027-01-01', fin: '2027-12-31' }),
  assolement: () => ({
    id: randomUUID(),
    ferme_id: FERME,
    saison_id: randomUUID(),
    zone_id: null,
    emplacement_id: randomUUID(),
    famille_id: randomUUID(),
    espece_id: null,
    nature: 'prevu',
    source_import: null,
  }),
};

function valider(table: TableStructure, autres: Ligne = {}) {
  return validerStructure(table, { ...BASES[table](), ...autres });
}

function accepte(table: TableStructure, autres: Ligne = {}): void {
  const r = valider(table, autres);
  expect(r, JSON.stringify(autres).slice(0, 200)).toMatchObject({ ok: true });
}

function refuse(table: TableStructure, autres: Ligne, code: string, champ: string): void {
  const r = valider(table, autres);
  expect(r.ok, JSON.stringify(autres).slice(0, 200)).toBe(false);
  if (!r.ok) expect({ code: r.erreur.code, champ: r.erreur.champ }).toEqual({ code, champ });
}

const ids = (n: number): string[] => Array.from({ length: n }, () => randomUUID());

describe('T10s : plafonds de PLAFONDS_STRUCTURE, juste dessous et juste dessus', () => {
  it('les plafonds valent ce que le modèle de données annonce', () => {
    expect(PLAFONDS_STRUCTURE).toEqual({
      texteCaracteres: 200,
      longueurM: 10_000,
      largeurM: 1_000,
      surfaceM2: 10_000_000,
      nombrePlaces: 1_000_000,
      delaiRetourAns: 100,
      poidsMilleGrainesG: 100_000,
      remplace: 200,
    });
  });

  it.each([
    ['zone', 'nom'],
    ['emplacement', 'code'],
    ['famille', 'nom'],
    ['espece', 'nom'],
    ['variete', 'nom'],
    ['variete', 'fournisseur'],
    ['saison', 'nom'],
  ] as const)('texte %s.%s : 200 caractères acceptés, 201 refusés', (table, champ) => {
    const max = PLAFONDS_STRUCTURE.texteCaracteres;
    accepte(table, { [champ]: 'a'.repeat(max) });
    refuse(table, { [champ]: 'a'.repeat(max + 1) }, 'trop_long', champ);
  });

  it('source d’import : 200 caractères acceptés, 201 refusés', () => {
    const base = { nature: 'passe_importe' };
    accepte('assolement', { ...base, source_import: 'a'.repeat(200) });
    refuse('assolement', { ...base, source_import: 'a'.repeat(201) }, 'trop_long', 'source_import');
  });

  it.each([
    ['emplacement', 'longueur_m', PLAFONDS_STRUCTURE.longueurM],
    ['emplacement', 'largeur_m', PLAFONDS_STRUCTURE.largeurM],
    ['zone', 'surface_m2', PLAFONDS_STRUCTURE.surfaceM2],
    ['variete', 'poids_mille_graines_g', PLAFONDS_STRUCTURE.poidsMilleGrainesG],
  ] as const)('%s.%s : le plafond accepté, à peine plus refusé (plafond_depasse), 0 et négatif refusés', (table, champ, max) => {
    accepte(table, { [champ]: max });
    accepte(table, { [champ]: 0.001 });
    refuse(table, { [champ]: max + 0.5 }, 'plafond_depasse', champ);
    refuse(table, { [champ]: 1e308 }, 'plafond_depasse', champ);
    refuse(table, { [champ]: 0 }, 'hors_bornes', champ);
    refuse(table, { [champ]: -1 }, 'hors_bornes', champ);
    refuse(table, { [champ]: '30' }, 'champ_invalide', champ);
  });

  it('nombre de places d’une gouttière : 1 et le plafond acceptés ; 0, plafond + 1 et 1,5 refusés', () => {
    const g = { sorte: 'gouttiere' };
    const max = PLAFONDS_STRUCTURE.nombrePlaces;
    accepte('emplacement', { ...g, nombre_places: 1 });
    accepte('emplacement', { ...g, nombre_places: max });
    refuse('emplacement', { ...g, nombre_places: max + 1 }, 'hors_bornes', 'nombre_places');
    refuse('emplacement', { ...g, nombre_places: 0 }, 'hors_bornes', 'nombre_places');
    refuse('emplacement', { ...g, nombre_places: 1.5 }, 'champ_invalide', 'nombre_places');
  });

  it.each(['famille', 'espece'] as const)('délais de retour d’une %s : 0 et 100 ans acceptés, 101 et −1 refusés', (table) => {
    const max = PLAFONDS_STRUCTURE.delaiRetourAns;
    accepte(table, { delai_retour_minimal_ans: 0, delai_retour_conseille_ans: 0 });
    accepte(table, { delai_retour_minimal_ans: max, delai_retour_conseille_ans: max });
    refuse(table, { delai_retour_minimal_ans: 4, delai_retour_conseille_ans: max + 1 }, 'hors_bornes', 'delai_retour_conseille_ans');
    refuse(table, { delai_retour_minimal_ans: -1, delai_retour_conseille_ans: 3 }, 'hors_bornes', 'delai_retour_minimal_ans');
    refuse(table, { delai_retour_minimal_ans: 2.5, delai_retour_conseille_ans: 3 }, 'champ_invalide', 'delai_retour_minimal_ans');
  });

  it('remplace : 200 emplacements acceptés, 201 refusés', () => {
    const max = PLAFONDS_STRUCTURE.remplace;
    accepte('emplacement', { remplace: JSON.stringify(ids(max)) });
    refuse('emplacement', { remplace: JSON.stringify(ids(max + 1)) }, 'trop_nombreux', 'remplace');
  });

  it('taux de germination : 0 et 100 acceptés, −1 et 101 refusés', () => {
    accepte('variete', { taux_germination: 0 });
    accepte('variete', { taux_germination: 100 });
    refuse('variete', { taux_germination: 101 }, 'hors_bornes', 'taux_germination');
    refuse('variete', { taux_germination: -1 }, 'hors_bornes', 'taux_germination');
  });
});

describe('T10s : gouttière ⇔ nombre de places', () => {
  it('gouttière avec places : acceptée ; sans places : refusée', () => {
    accepte('emplacement', { sorte: 'gouttiere', nombre_places: 40 });
    refuse('emplacement', { sorte: 'gouttiere', nombre_places: null }, 'incoherent', 'nombre_places');
    refuse('emplacement', { sorte: 'gouttiere', nombre_places: undefined }, 'incoherent', 'nombre_places');
  });

  it.each(['planche', 'rang'])('%s avec un nombre de places : refusé ; sans : accepté', (sorte) => {
    accepte('emplacement', { sorte, nombre_places: null });
    refuse('emplacement', { sorte, nombre_places: 12 }, 'incoherent', 'nombre_places');
  });
});

describe('T10s : délais de retour', () => {
  it('famille : les deux délais sont obligatoires', () => {
    refuse('famille', { delai_retour_minimal_ans: null }, 'champ_manquant', 'delai_retour_minimal_ans');
    refuse('famille', { delai_retour_conseille_ans: null }, 'champ_manquant', 'delai_retour_conseille_ans');
  });

  it('espèce : les deux délais ou aucun', () => {
    accepte('espece', { delai_retour_minimal_ans: null, delai_retour_conseille_ans: null });
    accepte('espece', { delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6 });
    refuse('espece', { delai_retour_minimal_ans: 4, delai_retour_conseille_ans: null }, 'incoherent', 'delai_retour_conseille_ans');
    refuse('espece', { delai_retour_minimal_ans: null, delai_retour_conseille_ans: 6 }, 'incoherent', 'delai_retour_conseille_ans');
  });

  it.each(['famille', 'espece'] as const)('%s : conseillé égal au minimal accepté, plus court refusé', (table) => {
    accepte(table, { delai_retour_minimal_ans: 3, delai_retour_conseille_ans: 3 });
    refuse(table, { delai_retour_minimal_ans: 3, delai_retour_conseille_ans: 2 }, 'incoherent', 'delai_retour_conseille_ans');
  });
});

describe('T10s : dates de 1900 à 2100', () => {
  it.each([
    ['emplacement', 'actif_du', {}],
    ['emplacement', 'actif_au', { actif_du: '1900-01-01' }],
    ['saison', 'debut', { fin: '2100-12-31' }],
    ['saison', 'fin', { debut: '1900-01-01' }],
  ] as const)('%s.%s : 1900-01-01 et 2100-12-31 acceptés, 1899-12-31 et 2101-01-01 refusés', (table, champ, autres) => {
    accepte(table, { ...autres, [champ]: '1900-01-01' });
    accepte(table, { ...autres, [champ]: '2100-12-31' });
    refuse(table, { ...autres, [champ]: '1899-12-31' }, 'hors_bornes', champ);
    refuse(table, { ...autres, [champ]: '2101-01-01' }, 'hors_bornes', champ);
  });

  it.each(['2026-02-30', '2026-13-01', '26-01-01', '2026-01-01T00:00:00Z', 20260101])('date « %s » : refusée (champ_invalide)', (date) => {
    refuse('emplacement', { actif_du: date }, 'champ_invalide', 'actif_du');
    refuse('saison', { debut: date }, 'champ_invalide', 'debut');
  });

  it('période : fin le jour du début acceptée, la veille refusée', () => {
    accepte('emplacement', { actif_du: '2026-06-01', actif_au: '2026-06-01' });
    refuse('emplacement', { actif_du: '2026-06-01', actif_au: '2026-05-31' }, 'incoherent', 'actif_au');
    accepte('saison', { debut: '2027-06-01', fin: '2027-06-01' });
    refuse('saison', { debut: '2027-06-01', fin: '2027-05-31' }, 'incoherent', 'fin');
  });
});

describe('T10s : liste remplace', () => {
  it('texte JSON (PowerSync) ou tableau (Postgres), vide ou absent : accepté, rendu en tableau d’identifiants en minuscules', () => {
    const [a, b] = ids(2) as [string, string];
    const r = valider('emplacement', { remplace: JSON.stringify([a.toUpperCase(), b]) });
    expect(r.ok && r.ligne.remplace).toEqual([a, b]);
    const t = valider('emplacement', { remplace: [a] });
    expect(t.ok && t.ligne.remplace).toEqual([a]);
    const v = valider('emplacement', { remplace: null });
    expect(v.ok && v.ligne.remplace).toEqual([]);
  });

  it('illisible, pas une liste, identifiant invalide, doublon, lui-même : refusé', () => {
    const [a] = ids(1) as [string];
    refuse('emplacement', { remplace: 'pas une liste' }, 'json_illisible', 'remplace');
    refuse('emplacement', { remplace: '{"a":1}' }, 'champ_invalide', 'remplace');
    refuse('emplacement', { remplace: JSON.stringify(['T2-P03']) }, 'champ_invalide', 'remplace');
    refuse('emplacement', { remplace: JSON.stringify([1]) }, 'champ_invalide', 'remplace');
    refuse('emplacement', { remplace: JSON.stringify([a, a.toUpperCase()]) }, 'doublon', 'remplace');
    const soi = BASES.emplacement();
    const r = validerStructure('emplacement', { ...soi, remplace: JSON.stringify([soi.id]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatchObject({ code: 'incoherent', champ: 'remplace' });
  });
});
