/**
 * Tests d'acceptation T15 — export complet depuis la base locale du téléphone
 * (docs/backlog/T15-export.md).
 *
 * Contrats : src/test/contrat-export.ts (`exporterFerme`, temps) et
 * packages/core/src/export/test/contrat.ts (fichiers, CSV, JSON, ZIP). La base est le SQLite en
 * mémoire de T10 (src/test/base-memoire.ts), remplie au volume de la ferme de T07
 * (src/test/jeu-t07.ts). Les archives sont relues par une implémentation indépendante
 * (src/test/zip.ts : node:zlib, et `unzip` d'Info-ZIP).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModuleExport, TypeExport } from '../../core/src/export/test/contrat.ts';
import { lireCsv } from '../../core/src/export/test/csv.ts';
import { SCHEMA_LOCAL, TABLES_LOCALES } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees } from './test/contrat.ts';
import { exigerExporterFerme, type ArchiveExport, type ModuleExportSync } from './test/contrat-export.ts';
import { remplirJeuT07, VOLUMES_T07, type JeuT07 } from './test/jeu-t07.ts';
import { lireZip, texteZip, verifierAvecUnzip, type EntreeZip } from './test/zip.ts';
import { creerPorte } from './porte.ts';
import type { Id } from '@planif/core';

/** Nom tenu dans une variable : le typage ne dépend pas de l'API pas encore écrite. */
const NOM_COEUR = '@planif/core';

async function exigerCoeur(): Promise<ModuleExport> {
  const coeur = (await import(/* @vite-ignore */ NOM_COEUR)) as Partial<ModuleExport>;
  if (typeof coeur.creerZip !== 'function' || typeof coeur.construireExport !== 'function' || coeur.TABLES_EXPORTEES === undefined) {
    throw new Error('@planif/core n’exporte pas encore creerZip, construireExport et TABLES_EXPORTEES (T15)');
  }
  return coeur as ModuleExport;
}

const TABLES_BIBLIOTHEQUE = new Set(['famille', 'espece', 'variete', 'itineraire', 'produit_phyto']);
const JOUR = '2026-09-29';
const GENERE_LE = '2026-09-29T06:30:00.000Z';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const encoder = new TextEncoder();

// ── ZIP ──────────────────────────────────────────────────────────────────────────────────────

describe('T15 : archive ZIP (creerZip de @planif/core)', () => {
  let coeur: ModuleExport;

  beforeAll(async () => {
    coeur = await exigerCoeur();
  });

  const binaire = Uint8Array.from({ length: 256 }, (_, i) => i);
  const FICHIERS = [
    { chemin: 'ferme.json', contenu: '{"format":"planifications-export","nombre":12.5}' },
    { chemin: 'LISEZMOI.txt', contenu: 'Données de la ferme — « exportées »\r\n' },
    { chemin: 'bibliotheque/famille.csv', contenu: '\uFEFFid;nom\r\n1;Solanacées\r\n' },
    { chemin: 'binaire.bin', contenu: binaire },
  ] as const;

  const octetsDe = (c: string | Uint8Array) => (typeof c === 'string' ? encoder.encode(c) : c);

  it('archive valide, relue par node:zlib : chemins dans l’ordre, contenus identiques, UTF-8 (BOM gardé)', () => {
    const zip = coeur.creerZip(FICHIERS, { date: JOUR });
    const entrees = lireZip(zip);
    expect(entrees.map((e) => e.chemin)).toEqual(FICHIERS.map((f) => f.chemin));
    FICHIERS.forEach((f, k) => {
      expect(entrees[k]?.contenu, f.chemin).toEqual(octetsDe(f.contenu));
      expect([0, 8], f.chemin).toContain(entrees[k]?.methode);
    });
    expect(entrees[2]?.contenu.subarray(0, 3)).toEqual(Uint8Array.from([0xef, 0xbb, 0xbf]));
  });

  it('archive valide pour unzip (Info-ZIP) : intégrité et liste des fichiers', () => {
    const zip = coeur.creerZip(FICHIERS, { date: JOUR });
    expect(verifierAvecUnzip(zip)).toEqual(FICHIERS.map((f) => f.chemin));
  });

  it('noms en UTF-8 (bit 11 des drapeaux), accents compris', () => {
    const entrees = lireZip(coeur.creerZip([{ chemin: 'récoltes/été.csv', contenu: 'x' }, ...FICHIERS]));
    expect(entrees[0]?.chemin).toBe('récoltes/été.csv');
    for (const e of entrees) expect(e.drapeaux & 0x0800, e.chemin).toBe(0x0800);
  });

  it('date des entrées : celle donnée, 1980-01-01 par défaut', () => {
    for (const e of lireZip(coeur.creerZip(FICHIERS, { date: JOUR }))) expect(e.date, e.chemin).toBe(JOUR);
    for (const e of lireZip(coeur.creerZip(FICHIERS))) expect(e.date, e.chemin).toBe('1980-01-01');
  });

  it('déterministe : même entrée, mêmes octets', () => {
    expect(Buffer.compare(coeur.creerZip(FICHIERS, { date: JOUR }), coeur.creerZip(FICHIERS, { date: JOUR }))).toBe(0);
  });

  it('liste vide : archive vide valide de 22 octets ; chemin en double : exception', () => {
    const vide = coeur.creerZip([]);
    expect(vide.length).toBe(22);
    expect(lireZip(vide)).toEqual([]);
    expect(() => coeur.creerZip([FICHIERS[0], FICHIERS[0]])).toThrow();
  });

  it('gros fichier (8 Mo de CSV) : relu à l’identique', () => {
    const gros = '\uFEFF' + 'id;note\r\n' + Array.from({ length: 200_000 }, (_, i) => `${String(i)};"ligne ""${String(i)}"" ; ok"\r\n`).join('');
    expect(gros.length).toBeGreaterThan(5_000_000);
    const zip = coeur.creerZip([{ chemin: 'evenement.csv', contenu: gros }]);
    expect(texteZip(lireZip(zip), 'evenement.csv')).toBe(gros);
    expect(verifierAvecUnzip(zip)).toEqual(['evenement.csv']);
  });
});

// ── Liste blanche contre le schéma local ─────────────────────────────────────────────────────

/** Type d'export attendu d'une colonne du schéma local (règle du contrat de @planif/core). */
function typeAttendu(colonne: string, typeLocal: 'texte' | 'entier' | 'reel'): TypeExport {
  const JSON_ = new Set(['position', 'unites', 'parametres', 'rendement_prevu', 'dose_maximale', 'changements', 'avant', 'apres', 'detail', 'emplacement_ids', 'photos', 'remplace']);
  const DATES = new Set(['actif_du', 'actif_au', 'ancre_date', 'du', 'au', 'date', 'date_arrachage', 'date_plantation', 'debut', 'fin', 'debut_recolte_prevu', 'fin_recolte_prevue', 'prevu_du', 'prevu_au', 'reel_du', 'reel_au', 'prevu_debut_recolte', 'prevu_fin_recolte', 'prevu_mise_en_place', 'prevu_semis_pepiniere']);
  const INSTANTS = new Set(['cree_le', 'modifie_le', 'supprime_le', 'decide_le', 'horodatage', 'invite_le']);
  const BOOLEENS = new Set(['perenne', 'utilisable_en_bio']);
  if (BOOLEENS.has(colonne)) return 'booleen';
  if (typeLocal === 'entier') return 'entier';
  if (typeLocal === 'reel') return 'reel';
  if (JSON_.has(colonne)) return 'json';
  if (DATES.has(colonne)) return 'date';
  if (INSTANTS.has(colonne)) return 'instant';
  return 'texte';
}

describe('T15 : TABLES_EXPORTEES suit le schéma local (powersync/sync-config.yaml)', () => {
  it('toutes les tables synchronisées sauf refus_synchro, toutes leurs colonnes, id en premier', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    const locales = Object.keys(TABLES_LOCALES).filter((t) => t !== 'refus_synchro');
    expect(Object.keys(TABLES_EXPORTEES).sort()).toEqual(locales.sort());
    for (const table of locales) {
      const colonnes = Object.keys(TABLES_EXPORTEES[table]?.colonnes ?? {});
      expect(colonnes[0], table).toBe('id');
      expect([...colonnes].sort(), table).toEqual(['id', ...Object.keys(TABLES_LOCALES[table as keyof typeof TABLES_LOCALES])].sort());
    }
  });

  it('type d’export de chaque colonne : booléens, nombres, JSON, dates, instants, texte', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    for (const [table, colonnes] of Object.entries(TABLES_LOCALES)) {
      if (table === 'refus_synchro') continue;
      expect(TABLES_EXPORTEES[table]?.colonnes.id?.type, `${table}.id`).toBe('texte');
      for (const [col, typeLocal] of Object.entries(colonnes as Readonly<Record<string, 'texte' | 'entier' | 'reel'>>)) {
        expect(TABLES_EXPORTEES[table]?.colonnes[col]?.type, `${table}.${col}`).toBe(typeAttendu(col, typeLocal));
      }
    }
  });
});

// ── exporterFerme sur la ferme de T07 ────────────────────────────────────────────────────────

interface FermeJson {
  tables: Record<string, unknown[]>;
  bibliotheque: Record<string, unknown[]>;
}

describe('T15 : exporterFerme, depuis la base locale, ferme de T07', () => {
  let exporterFerme: ModuleExportSync['exporterFerme'];
  let base: BaseMemoire;
  let jeu: JeuT07;
  let porte: PorteDonnees;
  let archive: ArchiveExport;
  let entrees: EntreeZip[];
  /** Durée du premier export (à froid), en ms. */
  let duree: number;

  beforeAll(async () => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    jeu = await remplirJeuT07(base);
    porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    exporterFerme = await exigerExporterFerme();
    const debut = performance.now();
    archive = await exporterFerme(porte, { fermeId: jeu.principale.fermeId, genereLe: GENERE_LE, jour: JOUR });
    duree = performance.now() - debut;
    entrees = lireZip(archive.octets);
  }, 60_000);

  afterAll(() => {
    base.fermer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Nombre de lignes de la ferme principale dans la base, par chemin de CSV sans extension. */
  function comptesBase(tables: readonly string[]): Record<string, number> {
    const f = jeu.principale.fermeId;
    const compter = (sql: string, p: readonly unknown[]) => base.lireDirect<{ n: number }>(sql, p)[0]?.n ?? -1;
    const r: Record<string, number> = {};
    for (const t of tables) {
      if (t === 'ferme') r[t] = compter('SELECT COUNT(*) AS n FROM ferme WHERE id = ?', [f]);
      else if (t === 'utilisateur') r[t] = compter('SELECT COUNT(*) AS n FROM utilisateur WHERE id IN (SELECT utilisateur_id FROM membre WHERE ferme_id = ?)', [f]);
      else r[t] = compter(`SELECT COUNT(*) AS n FROM ${t} WHERE ferme_id = ?`, [f]);
      if (TABLES_BIBLIOTHEQUE.has(t)) r[`bibliotheque/${t}`] = compter(`SELECT COUNT(*) AS n FROM ${t} WHERE ferme_id IS NULL`, []);
    }
    return r;
  }

  it('temps : premier export complet (à froid) en moins de 2,5 s sous Node (≈ 10 s CPU ralenti ×4, voir contrat-export.ts)', () => {
    console.info(`T15 : export de la ferme de T07 en ${duree.toFixed(0)} ms, archive de ${(archive.octets.length / 1_048_576).toFixed(1)} Mio`);
    expect(duree).toBeLessThan(2500);
  });

  it('le jeu a bien le volume de T07', () => {
    const c = comptesBase(['zone', 'emplacement', 'saison', 'serie', 'occupation', 'evenement']);
    expect(c).toMatchObject({
      zone: VOLUMES_T07.zones,
      emplacement: VOLUMES_T07.emplacements,
      saison: VOLUMES_T07.saisons,
      serie: VOLUMES_T07.series,
      occupation: VOLUMES_T07.series,
      evenement: VOLUMES_T07.evenements,
    });
  });

  it('archive valide (node:zlib et unzip) avec tous les fichiers attendus', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    const attendus = [
      'ferme.json',
      'LISEZMOI.txt',
      ...Object.keys(TABLES_EXPORTEES).map((t) => `${t}.csv`),
      ...[...TABLES_BIBLIOTHEQUE].map((t) => `bibliotheque/${t}.csv`),
    ].sort();
    expect(entrees.map((e) => e.chemin).sort()).toEqual(attendus);
    expect(verifierAvecUnzip(archive.octets).sort()).toEqual(attendus);
  });

  it('relecture : même nombre de lignes par table dans les CSV, le JSON et `lignes` que dans la base', async () => {
    const { TABLES_EXPORTEES } = await exigerCoeur();
    const attendu = comptesBase(Object.keys(TABLES_EXPORTEES));
    const json = JSON.parse(texteZip(entrees, 'ferme.json')) as FermeJson;
    for (const [cle, n] of Object.entries(attendu)) {
      expect(lireCsv(texteZip(entrees, `${cle}.csv`)).lignes, `${cle}.csv`).toHaveLength(n);
      const tableau = cle.startsWith('bibliotheque/') ? json.bibliotheque[cle.slice('bibliotheque/'.length)] : json.tables[cle];
      expect(tableau, `ferme.json ${cle}`).toHaveLength(n);
    }
    expect(archive.lignes).toEqual(attendu);
    expect(attendu.evenement).toBe(VOLUMES_T07.evenements);
  });

  it('aucun identifiant de la ferme voisine, ni du refus de synchro, dans aucun fichier', () => {
    const vus = new Set<string>();
    for (const e of entrees) for (const id of texteZip(entrees, e.chemin).match(UUID) ?? []) vus.add(id);
    expect(vus.has(jeu.principale.fermeId)).toBe(true);
    expect(jeu.voisine.ids.length).toBeGreaterThan(500);
    const fuites = jeu.voisine.ids.filter((id) => vus.has(id));
    expect(fuites, 'identifiants de la ferme voisine exportés').toEqual([]);
    expect(vus.has(jeu.refusId)).toBe(false);
    const tout = entrees.map((e) => texteZip(entrees, e.chemin)).join('\n');
    expect(tout).not.toContain('Ferme voisine');
  });

  it('nom du fichier : planifications-<ferme>-<jour>.zip', () => {
    expect(archive.nomFichier).toBe('planifications-ferme-de-benoit-2026-09-29.zip');
  });

  it('hors ligne : aucun appel réseau, aucune écriture, lecture par porte.lire seulement, jamais refus_synchro', async () => {
    const reseau = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', reseau);
    const ecrituresAvant = base.ecritures.length;
    const requetes: string[] = [];
    const interdit = (nom: string) => () => {
      throw new Error(`exporterFerme ne doit pas appeler porte.${nom}`);
    };
    const porteLectureSeule: PorteDonnees = {
      lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
        requetes.push(sql);
        return porte.lire<T>(sql, parametres);
      },
      ecrire: interdit('ecrire'),
      surveiller: interdit('surveiller'),
      saisirEvenement: interdit('saisirEvenement'),
      surveillerRefus: interdit('surveillerRefus'),
    };
    const resultat = await exporterFerme(porteLectureSeule, { fermeId: jeu.principale.fermeId, genereLe: GENERE_LE, jour: JOUR });
    expect(reseau).not.toHaveBeenCalled();
    expect(base.ecritures.length).toBe(ecrituresAvant);
    expect(requetes.some((sql) => /refus_synchro/i.test(sql))).toBe(false);
    const { TABLES_EXPORTEES } = await exigerCoeur();
    for (const table of Object.keys(TABLES_EXPORTEES)) {
      expect(requetes.some((sql) => new RegExp(`\\bFROM\\s+"?${table}"?(\\s|$)`, 'i').test(sql)), `lecture de ${table}`).toBe(true);
    }
    // Même archive qu'à la première lecture (comparaison d'octets rapide : l'archive fait des Mio).
    expect(Buffer.compare(resultat.octets, archive.octets), 'archive identique').toBe(0);
  }, 60_000);

  it('ferme absente de la base : archive quand même, nom par défaut, bibliothèque de référence seule', async () => {
    const inconnue = '0192f0c1-7a6e-7cc3-f000-000000000001';
    const r = await exporterFerme(porte, { fermeId: inconnue, genereLe: GENERE_LE, jour: JOUR });
    expect(r.nomFichier).toBe('planifications-ferme-2026-09-29.zip');
    expect(r.lignes.evenement).toBe(0);
    expect(r.lignes.ferme).toBe(0);
    expect(r.lignes['bibliotheque/famille']).toBeGreaterThan(0);
    lireZip(r.octets);
  }, 60_000);
});
