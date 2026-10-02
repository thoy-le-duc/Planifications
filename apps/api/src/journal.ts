/**
 * Journal du serveur (T10j, T10m) : une entrée = une ligne, jamais de valeur saisie.
 *
 * - `ligneDeJournal` : nettoyage commun à toute entrée (contrôles, formats, séparateurs de ligne,
 *   substituts isolés remplacés, longueur bornée) ; `journalSur` l'applique à toute sortie.
 * - `decrireErreur` : une erreur inattendue décrite par sa classe, son code s'il est sûr, celui
 *   de sa cause, et les seules positions `fichier:ligne:colonne` de sa pile sous node: ou sous la
 *   racine du dépôt, écrites relatives à celle-ci. Jamais son message,
 *   ses noms de fonction ni ses champs (detail, params, query, response…), qui peuvent recopier
 *   la saisie ou une adresse. Ne lève jamais.
 */
import { fileURLToPath } from 'node:url';

/** Longueur au plus d'une entrée du journal du serveur. */
const LONGUEUR_MAX_LIGNE_JOURNAL = 1_000;

/** Positions de pile gardées au plus : assez pour situer l'erreur, sans noyer le journal. */
const FRAMES_MAX = 8;

/** Ce qu'aucune entrée ne contient : contrôles, formats (U+202E…), séparateurs, substituts isolés. */
const INTERDITS_LIGNE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/**
 * Entrée du journal sur UNE ligne, toujours : la table, l'id et le détail (nom de clé reçu…)
 * viennent du téléphone. Caractères de contrôle, de format (qui retournent ou masquent
 * l'affichage), séparateurs de ligne (U+0085, U+2028, U+2029) et substituts isolés remplacés ;
 * entrée tronquée sans couper une paire de substitution.
 */
export function ligneDeJournal(texte: string): string {
  let fin = Math.min(texte.length, LONGUEUR_MAX_LIGNE_JOURNAL);
  if (fin < texte.length) {
    const dernier = texte.charCodeAt(fin - 1);
    const suivant = texte.charCodeAt(fin);
    if (dernier >= 0xd800 && dernier <= 0xdbff && suivant >= 0xdc00 && suivant <= 0xdfff) fin -= 1;
  }
  return texte.slice(0, fin).replace(INTERDITS_LIGNE, '?');
}

/**
 * Code cité seulement s'il a une forme sûre : SQLSTATE de Postgres (5 caractères, chiffres et
 * majuscules) ou code nodemailer / Node (EAUTH, ECONNREFUSED…). Sinon rien.
 */
const CODE_SUR = /^[0-9A-Z][0-9A-Z_]{0,31}$/;

/** Nom de classe cité seulement s'il ressemble à un identifiant. */
const CLASSE_SURE = /^[A-Za-z_$][\w$]{0,63}$/;

/**
 * Racine du dépôt (journal.ts est dans apps/api/src), en URL file:// et en chemin, calculée une
 * fois. Seules les positions sous `node:` ou sous cette racine sont gardées, écrites relatives
 * (apps/api/src/app.ts:12:3, node_modules/pg/lib/client.js:1:2) : un chemin hors du dépôt
 * (/home/<personne>/…) peut citer quelqu'un.
 */
const RACINE_URL = new URL('../../../', import.meta.url).href;
const RACINE_CHEMIN = fileURLToPath(RACINE_URL);

/** `fichier:ligne:colonne`. */
const POSITION = /^(.+):(\d+):(\d+)$/;
/** Module interne de Node. */
const MODULE_NODE = /^node:[\w/.-]+$/;
/** Chemin relatif sous la racine : segments sûrs, sans . ni .. */
const CHEMIN_RELATIF = /^[\w@+-][\w.@+-]*(?:\/[\w@+-][\w.@+-]*)*$/;

/** Position gardée, relative à la racine ou sous node:, sinon null. */
function positionSure(position: string): string | null {
  const morceaux = POSITION.exec(position);
  if (morceaux === null) return null;
  const [, fichier = '', ligne = '', colonne = ''] = morceaux;
  let relatif: string;
  if (MODULE_NODE.test(fichier)) relatif = fichier;
  else if (fichier.startsWith(RACINE_URL)) relatif = fichier.slice(RACINE_URL.length);
  else if (fichier.startsWith(RACINE_CHEMIN)) relatif = fichier.slice(RACINE_CHEMIN.length);
  else return null;
  if (!MODULE_NODE.test(relatif) && !CHEMIN_RELATIF.test(relatif)) return null;
  return `${relatif}:${ligne}:${colonne}`;
}

/** Lecture d'un champ qui ne lève jamais (accesseur, Proxy hostiles). */
function champ(valeur: unknown, nom: string): unknown {
  if ((typeof valeur !== 'object' && typeof valeur !== 'function') || valeur === null) return undefined;
  try {
    return (valeur as Record<string, unknown>)[nom];
  } catch {
    return undefined;
  }
}

function texte(valeur: unknown): string | null {
  return typeof valeur === 'string' ? valeur : null;
}

function classe(valeur: unknown): string {
  if (typeof valeur !== 'object' || valeur === null) return typeof valeur;
  const nom = texte(champ(champ(valeur, 'constructor'), 'name')) ?? '';
  return CLASSE_SURE.test(nom) ? nom : 'objet';
}

function codeSur(valeur: unknown): string | null {
  const code = texte(champ(valeur, 'code'));
  return code !== null && CODE_SUR.test(code) ? code : null;
}

/**
 * Pile privée de son en-tête « Nom: message » (nom et message peuvent tenir sur plusieurs lignes
 * et imiter des frames). null si l'en-tête ne se reconnaît pas : mieux vaut pas de pile.
 */
function sansEnTete(pile: string, nom: string | null, message: string | null): string | null {
  const msg = message ?? '';
  if (nom !== null) {
    const entete = msg === '' ? nom : `${nom}: ${msg}`;
    if (pile.startsWith(entete)) return pile.slice(entete.length);
  }
  if (msg !== '') {
    const debut = pile.indexOf(msg);
    return debut < 0 ? null : pile.slice(debut + msg.length);
  }
  // Ni nom ni message reconnus : l'en-tête est la première ligne seulement si rien ne peut
  // l'avoir étendue sur plusieurs lignes.
  if (nom !== null && /[\r\n\u0085\p{Zl}\p{Zp}]/u.test(nom)) return null;
  const saut = pile.search(/\r\n|[\n\r\u0085\p{Zl}\p{Zp}]/u);
  return saut < 0 ? '' : pile.slice(saut);
}

/**
 * Positions `fichier:ligne:colonne` des premières frames de la pile, jamais le nom de fonction,
 * le « [as …] » ni l'en-tête. S'arrête à la première ligne qui n'est pas une frame (« cause: »
 * suivi de la pile d'une cause, concaténée par une bibliothèque).
 */
function positions(valeur: unknown): string[] {
  const pile = texte(champ(valeur, 'stack'));
  if (pile === null) return [];
  const suite = sansEnTete(pile, texte(champ(valeur, 'name')), texte(champ(valeur, 'message')));
  if (suite === null) return [];
  const gardees: string[] = [];
  let dansLesFrames = false;
  for (const brute of suite.split(/\r\n|[\n\r\u0085\p{Zl}\p{Zp}]/u)) {
    const ligne = brute.trim();
    if (ligne === '' && !dansLesFrames) continue;
    if (!ligne.startsWith('at ')) break;
    dansLesFrames = true;
    const corps = ligne.slice(3);
    const entreParentheses = /\(([^()]*)\)$/.exec(corps);
    const position = entreParentheses === null ? corps : (entreParentheses[1] ?? '');
    const sure = positionSure(position);
    if (sure !== null) gardees.push(sure);
    if (gardees.length >= FRAMES_MAX) break;
  }
  return gardees;
}

function decrire(erreur: unknown): string {
  const morceaux = [classe(erreur)];
  const code = codeSur(erreur);
  if (code !== null) morceaux.push(`code ${code}`);
  const cause = champ(erreur, 'cause');
  if (cause !== undefined && cause !== null) {
    const codeCause = codeSur(cause);
    morceaux.push(`cause ${classe(cause)}${codeCause === null ? '' : ` code ${codeCause}`}`);
  }
  const frames = positions(erreur);
  if (frames.length > 0) morceaux.push(`pile ${frames.join(' | ')}`);
  return morceaux.join(' ');
}

/**
 * Journal sûr bâti sur une sortie : chaque entrée nettoyée par `ligneDeJournal`, et une sortie en
 * panne (sortie d'erreur fermée…) n'est jamais propagée à l'appelant (réponse HTTP, démarrage).
 */
export function journalSur(sortie: (ligne: string) => void): (ligne: string) => void {
  return (ligne) => {
    try {
      sortie(ligneDeJournal(ligne));
    } catch {
      // Rien : le journal ne doit jamais changer une réponse ni arrêter l'API.
    }
  };
}

/** Description d'une erreur inattendue pour le journal : classe, code, cause, positions. Ne lève jamais. */
export function decrireErreur(erreur: unknown): string {
  try {
    return decrire(erreur);
  } catch {
    return 'erreur indescriptible';
  }
}
