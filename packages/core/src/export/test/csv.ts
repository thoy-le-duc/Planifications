/**
 * Relecture des CSV de l'export (T15), écrite pour les tests, indépendante du code de production :
 * RFC 4180 avec ';' comme séparateur, champs entre guillemets (guillemets doublés, ';' et retours
 * à la ligne gardés à l'identique), enregistrements terminés par '\r\n'.
 * Pure (aucun type Node) : utilisable depuis @planif/core, @planif/sync et l'appli.
 */

export const BOM = '\uFEFF';

export interface CsvLu {
  readonly entete: readonly string[];
  readonly lignes: readonly (readonly string[])[];
}

/**
 * Découpe un CSV complet. Exige le BOM en tête et '\r\n' après chaque enregistrement ; lève une
 * erreur explicite sinon (guillemet non fermé, caractère après un guillemet fermant, ligne de
 * largeur différente de l'en-tête).
 */
export function lireCsv(texte: string): CsvLu {
  if (!texte.startsWith(BOM)) throw new Error('CSV sans BOM UTF-8 en tête');
  const enregistrements: string[][] = [];
  let champ = '';
  let courant: string[] = [];
  let i = BOM.length;
  let entreGuillemets = false;
  let finChampGuillemets = false;
  while (i < texte.length) {
    const c = texte[i] ?? '';
    if (entreGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"';
          i += 2;
          continue;
        }
        entreGuillemets = false;
        finChampGuillemets = true;
        i++;
        continue;
      }
      champ += c;
      i++;
      continue;
    }
    if (c === ';') {
      courant.push(champ);
      champ = '';
      finChampGuillemets = false;
      i++;
      continue;
    }
    if (c === '\r') {
      if (texte[i + 1] !== '\n') throw new Error(`'\\r' seul hors guillemets à la position ${String(i)}`);
      courant.push(champ);
      enregistrements.push(courant);
      courant = [];
      champ = '';
      finChampGuillemets = false;
      i += 2;
      continue;
    }
    if (c === '\n') throw new Error(`'\\n' sans '\\r' hors guillemets à la position ${String(i)} (attendu : '\\r\\n')`);
    if (finChampGuillemets) throw new Error(`caractère ${JSON.stringify(c)} après un guillemet fermant, position ${String(i)}`);
    if (c === '"') {
      if (champ !== '') throw new Error(`guillemet au milieu d'un champ non protégé, position ${String(i)}`);
      entreGuillemets = true;
      i++;
      continue;
    }
    champ += c;
    i++;
  }
  if (entreGuillemets) throw new Error('guillemet jamais fermé');
  if (champ !== '' || courant.length > 0) throw new Error('dernier enregistrement sans \\r\\n final');
  const [entete, ...lignes] = enregistrements;
  if (entete === undefined) throw new Error('CSV sans en-tête');
  lignes.forEach((l, n) => {
    if (l.length !== entete.length) {
      throw new Error(`ligne ${String(n + 2)} : ${String(l.length)} champs pour ${String(entete.length)} colonnes`);
    }
  });
  return { entete, lignes };
}

/** Lignes d'un CSV en objets colonne → texte. */
export function objetsCsv(csv: CsvLu): Record<string, string>[] {
  return csv.lignes.map((l) => Object.fromEntries(csv.entete.map((c, k) => [c, l[k] ?? ''])));
}
