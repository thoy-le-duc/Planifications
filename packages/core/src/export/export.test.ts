/**
 * Tests d'acceptation T15 — export complet, partie pure (docs/backlog/T15-export.md).
 *
 * Contrat (entrée, filtrage par ferme, liste blanche, format du JSON, des CSV et de LISEZMOI.txt,
 * règle des nombres) : ./test/contrat.ts. Le ZIP (`creerZip`) se teste dans
 * packages/sync/src/export.test.ts, qui a Node pour le relire.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chargerCoeur,
  chargerExport,
  TABLES_ATTENDUES,
  TABLES_BIBLIOTHEQUE,
  type DescriptionTable,
  type EntreeExport,
  type FichierExport,
  type LigneLocale,
  type ModuleExport,
  type TypeExport,
  type ValeurLocale,
} from './test/contrat.ts';
import { BOM, lireCsv, objetsCsv } from './test/csv.ts';

let m: ModuleExport;

beforeAll(async () => {
  m = await chargerExport();
});

// ── Jeu de données ───────────────────────────────────────────────────────────────────────────

/** UUID bien formé ; `code` sépare les espaces d'identifiants (ferme A, ferme B, référence…). */
const uuid = (code: string, n: number): string => `0192f0c1-7a6e-7cc3-${code}-${n.toString(16).padStart(12, '0')}`;

const FERME_A = uuid('a000', 0);
const FERME_B = uuid('b000', 0);
const GENERE_LE = '2026-09-29T06:30:00.000Z';

/** Textes piégeux pour l'échappement CSV. */
const TEXTES = [
  'Planche nord; côté "est"',
  'ligne 1\nligne 2',
  'fin Windows\r\nsuite',
  '  espaces gardés  ',
  '=SOMME(A1)',
  'Fraise 🍓 « Gariguette »',
  '"',
  ';',
  '',
  'simple',
] as const;
const REELS = [12.5, -3.25, 30, 0.1, 1234567.875, 0] as const;
const JSONS = ['{"quantite":12.5,"unite":"kg"}', '["a;b","c\\"d"]', '{"note":"ligne 1\\nligne 2","ok":true}'] as const;

function aDe<T>(liste: readonly T[], n: number): T {
  const v = liste[n % liste.length];
  if (v === undefined) throw new Error('liste vide');
  return v;
}

const deux = (n: number) => String(n).padStart(2, '0');

function valeurPour(type: TypeExport, n: number): ValeurLocale {
  switch (type) {
    case 'texte':
      return aDe(TEXTES, n);
    case 'entier':
      return n * 3 - 7;
    case 'reel':
      return aDe(REELS, n);
    case 'booleen':
      return n % 2;
    case 'date':
      return `2026-${deux(1 + (n % 12))}-${deux(1 + (n % 28))}`;
    case 'instant':
      return `2026-09-29T06:${deux(n % 60)}:00.000Z`;
    case 'json':
      return aDe(JSONS, n);
  }
}

interface Generateur {
  readonly code: string;
  compteur: number;
}

function ligne(table: string, d: DescriptionTable, n: number, g: Generateur, fermeId: string | null, imposees: Readonly<Record<string, ValeurLocale>> = {}): LigneLocale {
  const l: Record<string, ValeurLocale> = {};
  for (const [col, desc] of Object.entries(d.colonnes)) {
    if (col in imposees) l[col] = imposees[col] ?? null;
    else if (col === 'ferme_id') l[col] = fermeId;
    else if (col === 'id' || col.endsWith('_id')) l[col] = uuid(g.code, ++g.compteur);
    else l[col] = valeurPour(desc.type, n + table.length);
  }
  if ('ferme_id' in d.colonnes && !('ferme_id' in imposees)) l.ferme_id = fermeId;
  return l;
}

/** Nombre de lignes de la ferme A par table : varié, et `proposition` vide (CSV réduit à l'en-tête). */
function volumeA(table: string, index: number): number {
  if (table === 'ferme') return 1;
  if (table === 'utilisateur' || table === 'membre') return 2;
  if (table === 'proposition') return 0;
  return (index % 4) + 1;
}

interface Jeu {
  readonly entree: EntreeExport;
  /** Lignes attendues dans l'export, par chemin de CSV sans extension ('zone', 'bibliotheque/famille'). */
  readonly attendu: Readonly<Record<string, readonly LigneLocale[]>>;
  /** Identifiants qui ne doivent jamais sortir. */
  readonly interdits: readonly string[];
}

/** Données de deux fermes A et B, de la bibliothèque de référence et de tables non exportables. */
function construireJeu(t: Readonly<Record<string, DescriptionTable>>): Jeu {
  const tables: Record<string, LigneLocale[]> = {};
  const attendu: Record<string, LigneLocale[]> = {};
  const interdits: string[] = [FERME_B];
  const ajouter = (table: string, l: LigneLocale) => {
    (tables[table] ??= []).push(l);
  };

  for (const [fermeId, code] of [
    [FERME_A, 'a000'],
    [FERME_B, 'b000'],
  ] as const) {
    const g: Generateur = { code, compteur: 0 };
    const membres = [uuid(code === 'a000' ? 'a111' : 'b111', 1), uuid(code === 'a000' ? 'a111' : 'b111', 2)];
    TABLES_ATTENDUES.forEach((table, index) => {
      const d = t[table];
      if (d === undefined) throw new Error(`TABLES_EXPORTEES sans ${table}`);
      const n = volumeA(table, index);
      for (let k = 0; k < n; k++) {
        const imposees: Record<string, ValeurLocale> =
          table === 'ferme'
            ? { id: fermeId, nom: fermeId === FERME_A ? 'Ferme de Benoît' : 'Ferme B voisine' }
            : table === 'utilisateur'
              ? { id: membres[k] ?? null }
              : table === 'membre'
                ? { utilisateur_id: membres[k] ?? null }
                : {};
        const l = ligne(table, d, k, g, fermeId, imposees);
        ajouter(table, l);
        if (fermeId === FERME_A) (attendu[table] ??= []).push(l);
        else if (typeof l.id === 'string') interdits.push(l.id);
      }
    });
    if (code === 'b000') interdits.push(...membres);
  }

  // Un utilisateur connu du téléphone mais membre d'aucune des deux fermes.
  const etranger = uuid('e000', 1);
  interdits.push(etranger);
  const dUtilisateur = t.utilisateur;
  if (dUtilisateur === undefined) throw new Error('TABLES_EXPORTEES sans utilisateur');
  ajouter('utilisateur', ligne('utilisateur', dUtilisateur, 0, { code: 'e000', compteur: 1 }, null, { id: etranger }));

  // Bibliothèque de référence (ferme_id nul) : 3, 2, 1, 2, 1 lignes.
  const gRef: Generateur = { code: 'c000', compteur: 0 };
  TABLES_BIBLIOTHEQUE.forEach((table, index) => {
    const d = t[table];
    if (d === undefined) throw new Error(`TABLES_EXPORTEES sans ${table}`);
    const n = [3, 2, 1, 2, 1][index] ?? 1;
    for (let k = 0; k < n; k++) {
      const l = ligne(table, d, k + 5, gRef, null);
      ajouter(table, l);
      (attendu[`bibliotheque/${table}`] ??= []).push(l);
    }
  });

  // Colonnes et tables sensibles, présentes dans l'entrée : jamais dans l'archive.
  const zoneA = tables.zone?.[0];
  if (zoneA !== undefined) tables.zone?.splice(0, 1, { ...zoneA, jeton_acces: 'SECRET-JETON-ZONE' });
  const utilisateurA = tables.utilisateur?.[0];
  if (utilisateurA !== undefined) tables.utilisateur?.splice(0, 1, { ...utilisateurA, email: 'secret-email-collegue@ferme.fr' });
  tables.refus_synchro = [
    {
      id: uuid('a000', 9001),
      utilisateur_id: uuid('a111', 1),
      ferme_id: FERME_A,
      nom_table: 'zone',
      ligne_id: uuid('b000', 9999),
      operation: 'PUT',
      motif: 'ferme_interdite',
      message: 'SECRET-REFUS',
      donnees: '{"ferme_id":"SECRET-DONNEES-REFUS"}',
      cree_le: GENERE_LE,
    },
  ];
  tables.code_connexion = [{ id: uuid('a000', 9002), email: 'secret-code@ferme.fr', code_hache: 'SECRET-CODE' }];
  tables.jeton_renouvellement = [{ id: uuid('a000', 9003), utilisateur_id: uuid('a111', 1), jeton_hache: 'SECRET-JETON' }];
  interdits.push(uuid('a000', 9001), uuid('b000', 9999), uuid('a000', 9002), uuid('a000', 9003));

  return { entree: { fermeId: FERME_A, genereLe: GENERE_LE, tables }, attendu, interdits };
}

const SECRETS = ['SECRET-JETON-ZONE', 'secret-email-collegue', 'SECRET-REFUS', 'SECRET-DONNEES-REFUS', 'secret-code@', 'SECRET-CODE', 'SECRET-JETON'];

// ── Outils ───────────────────────────────────────────────────────────────────────────────────

function fichier(fichiers: readonly FichierExport[], chemin: string): string {
  const f = fichiers.find((x) => x.chemin === chemin);
  if (f === undefined) throw new Error(`fichier absent de l'archive : ${chemin}`);
  return f.contenu;
}

function attenduCsv(type: TypeExport, v: ValeurLocale | undefined): string {
  if (v === null || v === undefined) return '';
  if (type === 'booleen' && (v === 0 || v === 1)) return v === 1 ? 'oui' : 'non';
  if ((type === 'entier' || type === 'reel') && typeof v === 'number') return String(v).replace('.', ',');
  return String(v);
}

function attenduJson(type: TypeExport, v: ValeurLocale | undefined): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'booleen' && (v === 0 || v === 1)) return v === 1;
  if (type === 'json' && typeof v === 'string') {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  }
  return v;
}

interface FermeJson {
  format: string;
  version: number;
  ferme_id: string;
  genere_le: string;
  tables: Record<string, Record<string, unknown>[]>;
  bibliotheque: Record<string, Record<string, unknown>[]>;
}

function gelerProfond<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) gelerProfond(x);
    Object.freeze(v);
  }
  return v;
}

function cheminsAttendus(): string[] {
  return ['ferme.json', 'LISEZMOI.txt', ...TABLES_ATTENDUES.map((t) => `${t}.csv`), ...TABLES_BIBLIOTHEQUE.map((t) => `bibliotheque/${t}.csv`)].sort();
}

function description(table: string): DescriptionTable {
  const d = m.TABLES_EXPORTEES[table];
  if (d === undefined) throw new Error(`TABLES_EXPORTEES sans ${table}`);
  return d;
}

/** Table d'origine d'un chemin de CSV sans extension ('bibliotheque/famille' → 'famille'). */
const tableDe = (cle: string) => cle.replace(/^bibliotheque\//, '');

// ── Tests ────────────────────────────────────────────────────────────────────────────────────

describe('T15 : liste blanche des tables et colonnes exportées', () => {
  it('@planif/core réexporte construireExport, creerZip, nomArchive et TABLES_EXPORTEES', async () => {
    const coeur = await chargerCoeur();
    expect(typeof coeur.construireExport).toBe('function');
    expect(typeof coeur.creerZip).toBe('function');
    expect(typeof coeur.nomArchive).toBe('function');
    expect(coeur.TABLES_EXPORTEES).toBe(m.TABLES_EXPORTEES);
  });

  it('exactement les tables du schéma local, sans refus_synchro', () => {
    expect(Object.keys(m.TABLES_EXPORTEES).sort()).toEqual([...TABLES_ATTENDUES].sort());
  });

  it('bibliothèque : famille, espece, variete, itineraire, produit_phyto, et elles seules', () => {
    const biblio = Object.entries(m.TABLES_EXPORTEES)
      .filter(([, d]) => d.bibliotheque)
      .map(([t]) => t)
      .sort();
    expect(biblio).toEqual([...TABLES_BIBLIOTHEQUE].sort());
  });

  it('chaque table : id en premier, description en français de chaque table et colonne', () => {
    for (const [table, d] of Object.entries(m.TABLES_EXPORTEES)) {
      expect(Object.keys(d.colonnes)[0], table).toBe('id');
      expect(d.description.trim().length, table).toBeGreaterThanOrEqual(10);
      for (const [col, c] of Object.entries(d.colonnes)) {
        expect(c.description.trim().length, `${table}.${col}`).toBeGreaterThanOrEqual(10);
        expect(c.description.trim(), `${table}.${col}`).not.toBe(col);
      }
    }
  });

  it('aucune colonne sensible : e-mail, jeton, code, données de refus, mot de passe', () => {
    for (const [table, d] of Object.entries(m.TABLES_EXPORTEES)) {
      for (const col of Object.keys(d.colonnes)) {
        expect(col, `${table}.${col}`).not.toMatch(/email|jeton|mot_de_passe|secret|^code_|hache|^donnees$/);
      }
    }
  });

  it('types d’export : quelques colonnes repères', () => {
    const type = (t: string, c: string) => description(t).colonnes[c]?.type;
    expect(type('evenement', 'date')).toBe('date');
    expect(type('evenement', 'horodatage')).toBe('instant');
    expect(type('evenement', 'detail')).toBe('json');
    expect(type('evenement', 'emplacement_ids')).toBe('json');
    expect(type('espece', 'perenne')).toBe('booleen');
    expect(type('produit_phyto', 'utilisable_en_bio')).toBe('booleen');
    expect(type('emplacement', 'longueur_m')).toBe('reel');
    expect(type('campagne', 'annee')).toBe('entier');
    expect(type('serie', 'prevu_debut_recolte')).toBe('date');
    expect(type('zone', 'supprime_le')).toBe('instant');
    expect(type('zone', 'nom')).toBe('texte');
  });
});

describe('T15 : fichiers de l’archive', () => {
  it('exactement ferme.json, LISEZMOI.txt, un CSV par table et un par table de bibliothèque', () => {
    const { entree } = construireJeu(m.TABLES_EXPORTEES);
    const chemins = m.construireExport(entree).map((f) => f.chemin);
    expect([...chemins].sort()).toEqual(cheminsAttendus());
    expect(new Set(chemins).size).toBe(chemins.length);
  });

  it('entrée vide : tous les fichiers quand même, CSV réduits à l’en-tête, tableaux JSON vides', () => {
    const fichiers = m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: {} });
    expect(fichiers.map((f) => f.chemin).sort()).toEqual(cheminsAttendus());
    for (const table of TABLES_ATTENDUES) {
      const csv = lireCsv(fichier(fichiers, `${table}.csv`));
      expect(csv.entete, table).toEqual(Object.keys(description(table).colonnes));
      expect(csv.lignes, table).toHaveLength(0);
    }
    const json = JSON.parse(fichier(fichiers, 'ferme.json')) as FermeJson;
    for (const table of TABLES_ATTENDUES) expect(json.tables[table], table).toEqual([]);
    for (const table of TABLES_BIBLIOTHEQUE) expect(json.bibliotheque[table], table).toEqual([]);
  });
});

describe('T15 : même nombre de lignes que la base, par table', () => {
  it('JSON et CSV : autant de lignes que la ferme en a dans l’entrée, bibliothèque à part', () => {
    const { entree, attendu } = construireJeu(m.TABLES_EXPORTEES);
    const fichiers = m.construireExport(entree);
    const json = JSON.parse(fichier(fichiers, 'ferme.json')) as FermeJson;
    for (const table of TABLES_ATTENDUES) {
      const n = attendu[table]?.length ?? 0;
      expect(lireCsv(fichier(fichiers, `${table}.csv`)).lignes, `${table}.csv`).toHaveLength(n);
      expect(json.tables[table], `ferme.json tables.${table}`).toHaveLength(n);
    }
    for (const table of TABLES_BIBLIOTHEQUE) {
      const n = attendu[`bibliotheque/${table}`]?.length ?? 0;
      expect(n).toBeGreaterThan(0);
      expect(lireCsv(fichier(fichiers, `bibliotheque/${table}.csv`)).lignes, table).toHaveLength(n);
      expect(json.bibliotheque[table], `ferme.json bibliotheque.${table}`).toHaveLength(n);
    }
  });

  it('les lignes supprimées (supprime_le rempli) sont exportées, avec leur date de suppression', () => {
    const d = description('zone');
    const zone = ligne('zone', d, 0, { code: 'a000', compteur: 500 }, FERME_A, { supprime_le: '2026-09-01T08:00:00.000Z' });
    const fichiers = m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { zone: [zone] } });
    const [lue] = objetsCsv(lireCsv(fichier(fichiers, 'zone.csv')));
    expect(lue?.id).toBe(zone.id);
    expect(lue?.supprime_le).toBe('2026-09-01T08:00:00.000Z');
  });
});

describe('T15 : CSV lisibles par Excel en français', () => {
  it('UTF-8 avec BOM, « ; », « \\r\\n », en-tête dans l’ordre de TABLES_EXPORTEES', () => {
    const { entree } = construireJeu(m.TABLES_EXPORTEES);
    const fichiers = m.construireExport(entree);
    for (const f of fichiers.filter((x) => x.chemin.endsWith('.csv'))) {
      expect(f.contenu.startsWith(BOM), f.chemin).toBe(true);
      expect(f.contenu.endsWith('\r\n'), f.chemin).toBe(true);
      const table = tableDe(f.chemin.replace(/\.csv$/, ''));
      expect(f.contenu.slice(1).split('\r\n')[0], f.chemin).toBe(Object.keys(description(table).colonnes).join(';'));
    }
  });

  it('aller-retour fidèle : chaque champ relu vaut la valeur d’origine (règles de type du contrat)', () => {
    const { entree, attendu } = construireJeu(m.TABLES_EXPORTEES);
    const fichiers = m.construireExport(entree);
    for (const [cle, lignes] of Object.entries(attendu)) {
      const d = description(tableDe(cle));
      const lues = objetsCsv(lireCsv(fichier(fichiers, `${cle}.csv`)));
      expect(lues, cle).toHaveLength(lignes.length);
      lignes.forEach((origine, k) => {
        for (const [col, c] of Object.entries(d.colonnes)) {
          expect(lues[k]?.[col], `${cle}.csv ligne ${String(k + 1)} ${col}`).toBe(attenduCsv(c.type, origine[col]));
        }
      });
    }
  });

  it('échappement : « ; », guillemets et retours à la ligne gardés à l’identique', () => {
    const d = description('zone');
    const lignes = TEXTES.map((nom, k) => ligne('zone', d, k, { code: 'a000', compteur: 700 + k * 10 }, FERME_A, { nom }));
    const texte = fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { zone: lignes } }), 'zone.csv');
    expect(objetsCsv(lireCsv(texte)).map((l) => l.nom)).toEqual([...TEXTES]);
    expect(texte).toContain('"Planche nord; côté ""est"""');
  });

  it('nombres : virgule décimale dans le CSV, relecture exacte', () => {
    const d = description('emplacement');
    const lignes = REELS.map((longueur_m, k) => ligne('emplacement', d, k, { code: 'a000', compteur: 900 + k * 20 }, FERME_A, { longueur_m }));
    const texte = fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { emplacement: lignes } }), 'emplacement.csv');
    const lues = objetsCsv(lireCsv(texte)).map((l) => l.longueur_m ?? '');
    expect(lues).toEqual(['12,5', '-3,25', '30', '0,1', '1234567,875', '0']);
    expect(lues.map((v) => Number(v.replace(',', '.')))).toEqual([...REELS]);
  });

  it('booléens en oui / non, null en champ vide', () => {
    const d = description('espece');
    const lignes = [0, 1, null].map((perenne, k) => ligne('espece', d, k, { code: 'a000', compteur: 1100 + k * 20 }, FERME_A, { perenne, nom: null }));
    const lues = objetsCsv(lireCsv(fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { espece: lignes } }), 'espece.csv')));
    expect(lues.map((l) => l.perenne)).toEqual(['non', 'oui', '']);
    expect(lues.map((l) => l.nom)).toEqual(['', '', '']);
  });

  it('booléen ni 0 ni 1 (« true », 2, « oui ») : rendu brut, jamais converti en oui / non', () => {
    const d = description('espece');
    const lignes = ['true', 2, 'oui', -1].map((perenne, k) => ligne('espece', d, k, { code: 'a000', compteur: 1200 + k * 20 }, FERME_A, { perenne }));
    const lues = objetsCsv(lireCsv(fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { espece: lignes } }), 'espece.csv')));
    expect(lues.map((l) => l.perenne)).toEqual(['true', '2', 'oui', '-1']);
  });
});

describe('T15 : ferme.json', () => {
  it('en-tête : format, version, ferme, instant de l’export', () => {
    const { entree } = construireJeu(m.TABLES_EXPORTEES);
    const json = JSON.parse(fichier(m.construireExport(entree), 'ferme.json')) as FermeJson;
    expect(json.format).toBe('planifications-export');
    expect(json.version).toBe(1);
    expect(json.ferme_id).toBe(FERME_A);
    expect(json.genere_le).toBe(GENERE_LE);
    expect(Object.keys(json.tables).sort()).toEqual([...TABLES_ATTENDUES].sort());
    expect(Object.keys(json.bibliotheque).sort()).toEqual([...TABLES_BIBLIOTHEQUE].sort());
  });

  it('chaque ligne : toutes les colonnes exportées, rien d’autre, valeurs typées selon le contrat', () => {
    const { entree, attendu } = construireJeu(m.TABLES_EXPORTEES);
    const json = JSON.parse(fichier(m.construireExport(entree), 'ferme.json')) as FermeJson;
    for (const [cle, lignes] of Object.entries(attendu)) {
      const table = tableDe(cle);
      const d = description(table);
      const lues = cle.startsWith('bibliotheque/') ? json.bibliotheque[table] : json.tables[table];
      lignes.forEach((origine, k) => {
        const lue = lues?.[k];
        expect(Object.keys(lue ?? {}).sort(), `${cle}[${String(k)}]`).toEqual(Object.keys(d.colonnes).sort());
        for (const [col, c] of Object.entries(d.colonnes)) {
          expect(lue?.[col], `${cle}[${String(k)}].${col}`).toEqual(attenduJson(c.type, origine[col]));
        }
      });
    }
  });

  it('nombres avec un point décimal, jamais de virgule', () => {
    const d = description('emplacement');
    const l = ligne('emplacement', d, 0, { code: 'a000', compteur: 1300 }, FERME_A, { longueur_m: 12.5, largeur_m: 0.75 });
    const texte = fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { emplacement: [l] } }), 'ferme.json');
    expect(texte).toMatch(/"longueur_m":\s*12\.5\b/);
    expect(texte).toMatch(/"largeur_m":\s*0\.75\b/);
    expect(texte).not.toMatch(/"longueur_m":\s*"?12,5/);
  });

  it('colonne JSON illisible : gardée en texte, sans exception ; colonne manquante → null', () => {
    const d = description('evenement');
    const l: Record<string, ValeurLocale> = { ...ligne('evenement', d, 0, { code: 'a000', compteur: 1400 }, FERME_A), detail: 'pas du json{' };
    Reflect.deleteProperty(l, 'note');
    const json = JSON.parse(fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { evenement: [l] } }), 'ferme.json')) as FermeJson;
    expect(json.tables.evenement?.[0]?.detail).toBe('pas du json{');
    expect(json.tables.evenement?.[0]?.note).toBeNull();
  });

  it('booléen ni 0 ni 1 (« true », 2) : valeur brute dans le JSON, pas convertie en false', () => {
    const d = description('espece');
    const lignes = ['true', 2, 0, 1].map((perenne, k) => ligne('espece', d, k, { code: 'a000', compteur: 1500 + k * 20 }, FERME_A, { perenne }));
    const json = JSON.parse(fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: { espece: lignes } }), 'ferme.json')) as FermeJson;
    expect(json.tables.espece?.map((l) => l.perenne)).toEqual(['true', 2, false, true]);
  });
});

describe('T15 : rien d’une autre ferme, aucun secret', () => {
  it('aucun identifiant de la ferme B, d’un utilisateur étranger ou d’un refus, dans aucun fichier', () => {
    const { entree, interdits } = construireJeu(m.TABLES_EXPORTEES);
    const fichiers = m.construireExport(entree);
    expect(interdits.length).toBeGreaterThan(40);
    for (const f of fichiers) {
      for (const id of interdits) expect(f.contenu.includes(id), `${id} dans ${f.chemin}`).toBe(false);
      expect(f.contenu, f.chemin).not.toContain('Ferme B voisine');
    }
  });

  it('ni jeton, ni e-mail, ni données de refus, ni table de secrets, même présents dans l’entrée', () => {
    const { entree } = construireJeu(m.TABLES_EXPORTEES);
    const fichiers = m.construireExport(entree);
    const tout = fichiers.map((f) => f.contenu).join('\n');
    for (const s of SECRETS) expect(tout, s).not.toContain(s);
    const json = JSON.parse(fichier(fichiers, 'ferme.json')) as FermeJson;
    expect(json.tables.refus_synchro).toBeUndefined();
    expect(json.tables.code_connexion).toBeUndefined();
    for (const f of fichiers.filter((x) => x.chemin.endsWith('.csv'))) {
      const entete = lireCsv(f.contenu).entete;
      for (const col of ['email', 'jeton_acces', 'donnees']) expect(entete, f.chemin).not.toContain(col);
    }
    for (const lignes of Object.values(json.tables)) {
      for (const l of lignes) for (const col of ['email', 'jeton_acces', 'donnees']) expect(Object.keys(l)).not.toContain(col);
    }
  });

  it('la ligne ferme exportée est celle de la ferme demandée, seule', () => {
    const { entree } = construireJeu(m.TABLES_EXPORTEES);
    const lues = objetsCsv(lireCsv(fichier(m.construireExport(entree), 'ferme.csv')));
    expect(lues.map((l) => l.id)).toEqual([FERME_A]);
    expect(lues[0]?.nom).toBe('Ferme de Benoît');
  });

  it('utilisateurs : les membres de la ferme seulement', () => {
    const { entree, attendu } = construireJeu(m.TABLES_EXPORTEES);
    const lues = objetsCsv(lireCsv(fichier(m.construireExport(entree), 'utilisateur.csv')));
    expect(lues.map((l) => l.id)).toEqual(attendu.utilisateur?.map((l) => l.id));
  });

  it('bibliothèque : lignes de la ferme avec la ferme, référence dans bibliotheque/, jamais celles de B', () => {
    const { entree, attendu } = construireJeu(m.TABLES_EXPORTEES);
    const fichiers = m.construireExport(entree);
    for (const table of TABLES_BIBLIOTHEQUE) {
      const ferme = objetsCsv(lireCsv(fichier(fichiers, `${table}.csv`)));
      expect(ferme.map((l) => l.id), table).toEqual(attendu[table]?.map((l) => l.id));
      expect(new Set(ferme.map((l) => l.ferme_id)), table).toEqual(new Set([FERME_A]));
      const ref = objetsCsv(lireCsv(fichier(fichiers, `bibliotheque/${table}.csv`)));
      expect(ref.map((l) => l.id), table).toEqual(attendu[`bibliotheque/${table}`]?.map((l) => l.id));
      expect(new Set(ref.map((l) => l.ferme_id)), table).toEqual(new Set(['']));
    }
  });
});

describe('T15 : LISEZMOI.txt', () => {
  function blocs(texte: string): Map<string, string[]> {
    const resultat = new Map<string, string[]>();
    let courant: string[] | undefined;
    for (const l of texte.split(/\r?\n/)) {
      const titre = /^##\s+(\S+)\s*$/.exec(l);
      if (titre?.[1] !== undefined) {
        courant = [];
        resultat.set(titre[1], courant);
      } else courant?.push(l);
    }
    return resultat;
  }

  it('explique les conventions de l’archive', () => {
    const texte = fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: {} }), 'LISEZMOI.txt');
    expect(texte).toContain('ferme.json');
    expect(texte).toContain('AAAA-MM-JJ');
    expect(texte).toContain('bibliotheque/');
    expect(texte).toMatch(/point-virgule/i);
    expect(texte).toMatch(/virgule décimale|virgule comme séparateur décimal/i);
    expect(texte).toMatch(/supprim/i);
  });

  it('« Ferme : » donne le nom de la ferme, pas son identifiant', () => {
    const { entree } = construireJeu(m.TABLES_EXPORTEES);
    const texte = fichier(m.construireExport(entree), 'LISEZMOI.txt');
    const ligneFerme = texte.split(/\r?\n/).find((l) => /^Ferme\s*:/.test(l));
    expect(ligneFerme, 'ligne « Ferme : … »').toBeDefined();
    expect(ligneFerme).toContain('Ferme de Benoît');
    expect(ligneFerme).not.toContain(FERME_A);
  });

  it('utilisateur.csv : « Votre compte (les collègues n’y sont pas encore). »', () => {
    const texte = fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: {} }), 'LISEZMOI.txt');
    const bloc = (blocs(texte).get('utilisateur.csv') ?? []).join('\n');
    expect(bloc).toMatch(/Votre compte \(les collègues n['’]y sont pas encore\)\./);
  });

  it('un bloc par CSV, et une ligne « - colonne : description » pour chaque colonne', () => {
    const texte = fichier(m.construireExport({ fermeId: FERME_A, genereLe: GENERE_LE, tables: {} }), 'LISEZMOI.txt');
    const b = blocs(texte);
    const csv = cheminsAttendus().filter((c) => c.endsWith('.csv'));
    // D'autres blocs (« ## ferme.json »…) sont permis ; chaque CSV a le sien.
    for (const chemin of csv) expect(b.has(chemin), `bloc « ## ${chemin} »`).toBe(true);
    for (const chemin of csv) {
      const lignes = b.get(chemin) ?? [];
      for (const col of Object.keys(description(tableDe(chemin.replace(/\.csv$/, ''))).colonnes)) {
        const trouvee = lignes.find((l) => new RegExp(`^-\\s*${col}\\s*:\\s*\\S`).test(l));
        expect(trouvee, `${chemin} : colonne ${col}`).toBeDefined();
        expect((trouvee ?? '').replace(/^-\s*\w+\s*:\s*/, '').trim().length, `${chemin} : ${col}`).toBeGreaterThanOrEqual(10);
      }
    }
  });
});

describe('T15 : nom de l’archive', () => {
  it('planifications-<ferme>-<AAAA-MM-JJ>.zip, sans accents ni caractères spéciaux', () => {
    expect(m.nomArchive('Ferme de Benoît', '2026-09-29')).toBe('planifications-ferme-de-benoit-2026-09-29.zip');
    expect(m.nomArchive('  L’Écho des Champs / 2 ', '2027-01-05')).toBe('planifications-l-echo-des-champs-2-2027-01-05.zip');
    expect(m.nomArchive('GAEC ÇÀ&LÀ', '2026-09-29')).toBe('planifications-gaec-ca-la-2026-09-29.zip');
    expect(m.nomArchive('', '2026-09-29')).toBe('planifications-ferme-2026-09-29.zip');
    expect(m.nomArchive('🍓🍓', '2026-09-29')).toBe('planifications-ferme-2026-09-29.zip');
    expect(m.nomArchive(null, '2026-09-29')).toBe('planifications-ferme-2026-09-29.zip');
  });

  it('ligatures : Œ/œ → oe, Æ/æ → ae (elles ne se décomposent pas en NFD)', () => {
    expect(m.nomArchive('Ferme d\'Œuvre', '2026-09-29')).toBe('planifications-ferme-d-oeuvre-2026-09-29.zip');
    expect(m.nomArchive('Ferme d’Œuvre', '2026-09-29')).toBe('planifications-ferme-d-oeuvre-2026-09-29.zip');
    expect(m.nomArchive('Æ', '2026-09-29')).toBe('planifications-ae-2026-09-29.zip');
    expect(m.nomArchive('Le Cœur de Cæsar', '2026-09-29')).toBe('planifications-le-coeur-de-caesar-2026-09-29.zip');
  });
});

describe('T15 : pureté', () => {
  it('même entrée → mêmes fichiers ; l’entrée n’est pas modifiée (gelée, aucune exception)', () => {
    const { entree } = construireJeu(m.TABLES_EXPORTEES);
    const copie = JSON.parse(JSON.stringify(entree)) as EntreeExport;
    const gelee = gelerProfond(entree);
    const a = m.construireExport(gelee);
    const b = m.construireExport(copie);
    expect(a).toEqual(b);
    expect(copie).toEqual(entree);
  });
});
