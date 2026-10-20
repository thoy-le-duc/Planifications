/**
 * T67 : garde-fou « publication ↔ flux » (lu par publication-flux.test.ts).
 *
 * Rejoue la publication PowerSync `powersync` telle que les migrations la construisent, et la
 * compare aux tables lues par les règles de synchro (`powersync/sync-config.yaml`). Une forme SQL
 * inconnue sur cette publication lève une erreur : mieux vaut un test rouge qu'un écart muet.
 */
import { parse } from 'yaml';

const PUBLICATION = 'powersync';

/** Retire les commentaires SQL (`-- …` jusqu'à la fin de la ligne, `/* … *\/`). */
function sansCommentaires(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** « public.ferme, "zone" » → ['ferme', 'zone']. */
function listeDeTables(texte: string): string[] {
  return texte
    .split(',')
    .map((morceau) =>
      morceau
        .trim()
        .replace(/^only\s+/i, '')
        .replace(/"/g, '')
        .replace(/^public\./i, '')
        .toLowerCase(),
    )
    .filter((nom) => nom !== '')
    .map((nom) => {
      if (!/^[a-z_][a-z0-9_]*$/.test(nom)) throw new Error(`publication ${PUBLICATION} : table illisible « ${nom} »`);
      return nom;
    });
}

/** Tables de la publication `powersync` après toutes les migrations, dans l'ordre donné, triées. */
export function tablesPublieesPowerSync(migrations: readonly string[]): string[] {
  let tables = new Set<string>();
  for (const migration of migrations) {
    const texte = sansCommentaires(migration);
    // Relecture : une mention de la publication hors d'une instruction de premier niveau (bloc DO,
    // EXECUTE d'une chaîne) échappe au découpage sur « ; » ; on compte les mentions et on exige
    // qu'elles aient toutes été rejouées.
    const mentions = [...texte.matchAll(new RegExp(`\\bpublication\\s+(?:if\\s+exists\\s+)?"?${PUBLICATION}"?(?![a-z0-9_])`, 'gi'))].length;
    let rejouees = 0;
    for (const brute of texte.split(';')) {
      const instruction = brute.replace(/\s+/g, ' ').trim();
      if (!new RegExp(`^(create|alter|drop) publication (if exists )?("?)${PUBLICATION}\\3(\\s|$)`, 'i').test(instruction)) continue;
      rejouees += 1;

      const creation = /^create publication "?powersync"? for table (.+?)(?: with \(.*\))?$/i.exec(instruction);
      if (creation !== null) {
        tables = new Set(listeDeTables(creation[1] ?? ''));
        continue;
      }
      const modification = /^alter publication "?powersync"? (add|drop|set) table (.+)$/i.exec(instruction);
      if (modification !== null) {
        const liste = listeDeTables(modification[2] ?? '');
        const verbe = (modification[1] ?? '').toLowerCase();
        if (verbe === 'set') tables = new Set(liste);
        for (const nom of verbe === 'set' ? [] : liste) {
          if (verbe === 'add') tables.add(nom);
          else tables.delete(nom);
        }
        continue;
      }
      // Réglages de la publication (publish = …) : sans effet sur les tables.
      if (/^alter publication "?powersync"? set \(/i.test(instruction)) continue;
      if (/^drop publication (if exists )?"?powersync"?$/i.test(instruction)) {
        tables = new Set();
        continue;
      }
      throw new Error(`publication ${PUBLICATION} : instruction non reconnue « ${instruction} »`);
    }
    if (mentions !== rejouees) {
      throw new Error(
        `publication ${PUBLICATION} : ${String(mentions - rejouees)} mention(s) hors d'une instruction CREATE, ALTER ou DROP PUBLICATION de premier niveau (bloc DO, EXECUTE…) : forme non rejouable`,
      );
    }
  }
  return [...tables].sort();
}

function objet(valeur: unknown, quoi: string): Record<string, unknown> {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw new Error(`${quoi} : objet attendu`);
  return valeur as Record<string, unknown>;
}

function tablesLues(requete: string): string[] {
  return [...requete.matchAll(/\b(?:from|join)\s+"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => (m[1] ?? '').toLowerCase());
}

export interface TablesDesFlux {
  /** La table de chaque flux (premier FROM de sa requête), triées, sans doublon. */
  readonly principales: string[];
  /** Toutes les tables lues par les flux et les requêtes `with`, triées, sans doublon. */
  readonly lues: string[];
}

/** Tables lues par les règles de synchro (texte YAML de sync-config.yaml). */
export function tablesDesFlux(regles: string): TablesDesFlux {
  const document = objet(parse(regles), 'règles de synchro');
  const avec = objet(document.with ?? {}, 'with');
  const flux = objet(document.streams ?? {}, 'streams');
  const nomsAvec = new Set(Object.keys(avec).map((nom) => nom.toLowerCase()));

  const requete = (valeur: unknown, quoi: string): string => {
    if (typeof valeur !== 'string') throw new Error(`${quoi} : requête attendue`);
    return valeur;
  };
  const principales = new Set<string>();
  const lues = new Set<string>();
  for (const [nom, definition] of Object.entries(flux)) {
    const sql = requete(objet(definition, nom).query, nom);
    const [premiere] = tablesLues(sql);
    if (premiere === undefined) throw new Error(`flux ${nom} : aucune table lue`);
    principales.add(premiere);
    for (const table of tablesLues(sql)) lues.add(table);
  }
  for (const [nom, sql] of Object.entries(avec)) for (const table of tablesLues(requete(sql, nom))) lues.add(table);
  for (const nom of nomsAvec) {
    principales.delete(nom);
    lues.delete(nom);
  }
  return { principales: [...principales].sort(), lues: [...lues].sort() };
}

export interface EcartsPublicationFlux {
  /** Publiées, mais aucun flux ne les envoie aux téléphones. */
  readonly sansFlux: string[];
  /** Lues par les règles, mais absentes de la publication (flux toujours vides). */
  readonly sansPublication: string[];
}

export function ecartsPublicationFlux(publiees: readonly string[], regles: string): EcartsPublicationFlux {
  const { principales, lues } = tablesDesFlux(regles);
  const publication = new Set(publiees);
  return {
    sansFlux: publiees.filter((table) => !principales.includes(table)).sort(),
    sansPublication: lues.filter((table) => !publication.has(table)).sort(),
  };
}
