/**
 * Journal du serveur (T10j, T10m) : une entrée = une ligne, jamais de valeur saisie.
 *
 * - `ligneDeJournal` : nettoyage commun à toute entrée (contrôles et séparateurs de ligne
 *   remplacés, longueur bornée) ; appliqué par le journal du contexte (dependances.ts).
 * - `decrireErreur` : une erreur inattendue décrite par sa classe, son code s'il est sûr, celui
 *   de sa cause, et sa pile sans la ligne « Nom: message ». Jamais son message ni ses champs
 *   (detail, params, query, response…), qui peuvent recopier la saisie ou une adresse.
 */

/** Longueur au plus d'une entrée du journal du serveur. */
const LONGUEUR_MAX_LIGNE_JOURNAL = 1_000;

/** Frames de pile gardées au plus : assez pour situer l'erreur, sans noyer le journal. */
const FRAMES_MAX = 8;

/**
 * Entrée du journal sur UNE ligne, toujours : la table, l'id et le détail (nom de clé reçu…)
 * viennent du téléphone. Caractères de contrôle et séparateurs de ligne (U+0085, U+2028, U+2029)
 * remplacés, entrée tronquée.
 */
export function ligneDeJournal(texte: string): string {
  return texte.slice(0, LONGUEUR_MAX_LIGNE_JOURNAL).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '?');
}

/**
 * Code cité seulement s'il a une forme sûre : SQLSTATE de Postgres (5 caractères, chiffres et
 * majuscules) ou code nodemailer / Node (EAUTH, ECONNREFUSED…). Sinon rien.
 */
const CODE_SUR = /^[0-9A-Z][0-9A-Z_]{0,31}$/;

/** Nom de classe cité seulement s'il ressemble à un identifiant. */
const CLASSE_SURE = /^[A-Za-z_$][\w$]{0,63}$/;

function champ(valeur: unknown, nom: string): unknown {
  if (typeof valeur !== 'object' || valeur === null) return undefined;
  try {
    return (valeur as Record<string, unknown>)[nom];
  } catch {
    return undefined;
  }
}

function classe(valeur: unknown): string {
  if (typeof valeur !== 'object' || valeur === null) return typeof valeur;
  const constructeur = champ(valeur, 'constructor');
  const nom = typeof constructeur === 'function' ? constructeur.name : '';
  return CLASSE_SURE.test(nom) ? nom : 'objet';
}

function codeSur(valeur: unknown): string | null {
  const code = champ(valeur, 'code');
  return typeof code === 'string' && CODE_SUR.test(code) ? code : null;
}

/**
 * Lignes « at … » de la pile, après le message. Le début de la pile recopie « Nom: message » et le
 * message peut tenir sur plusieurs lignes, dont certaines imitent une frame : on coupe donc après
 * le texte du message lui-même. Message introuvable dans la pile (pile réécrite) : pas de pile.
 */
function pile(valeur: unknown): string | null {
  const brute = champ(valeur, 'stack');
  if (typeof brute !== 'string') return null;
  const message = champ(valeur, 'message');
  let suite = brute;
  if (typeof message === 'string' && message !== '') {
    const debut = brute.indexOf(message);
    if (debut < 0) return null;
    suite = brute.slice(debut + message.length);
  }
  const frames = suite
    .split(/\r\n|[\n\r\u0085\p{Zl}\p{Zp}]/u)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))
    .slice(0, FRAMES_MAX);
  return frames.length > 0 ? frames.join(' | ') : null;
}

/** Description d'une erreur inattendue pour le journal : classe, code, cause, pile. */
export function decrireErreur(erreur: unknown): string {
  const morceaux = [classe(erreur)];
  const code = codeSur(erreur);
  if (code !== null) morceaux.push(`code ${code}`);
  const cause = champ(erreur, 'cause');
  if (cause !== undefined && cause !== null) {
    const codeCause = codeSur(cause);
    morceaux.push(`cause ${classe(cause)}${codeCause === null ? '' : ` code ${codeCause}`}`);
  }
  const frames = pile(erreur);
  if (frames !== null) morceaux.push(`pile ${frames}`);
  return morceaux.join(' ');
}
