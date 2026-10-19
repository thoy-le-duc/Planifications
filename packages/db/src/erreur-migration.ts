/**
 * T44 : message d'erreur de `migrer` sans rien de l'adresse de la base. En production, le journal
 * du workflow est public (dépôt public) : jamais l'adresse, l'hôte, l'utilisateur ni le mot de
 * passe, seulement le code de l'erreur et son message nettoyé.
 */

const MASQUE_ADRESSE = '[adresse]';
const MASQUE_HOTE = '[hôte]';
const MASQUE = '[masqué]';

/** Adresses postgres:// ou postgresql:// glissées dans un texte (jusqu'au premier blanc). */
const ADRESSE_POSTGRES = /postgres(?:ql)?:\/\/\S*/gi;
/** Adresses IPv4, avec ou sans port. */
const ADRESSE_IP = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;

function decoder(morceau: string): string {
  try {
    return decodeURIComponent(morceau);
  } catch {
    return morceau;
  }
}

/** Morceaux sensibles de l'adresse (utilisateur, mot de passe, hôte), lisible ou mal formée. */
function morceauxSensibles(url: string): string[] {
  const morceaux = new Set<string>();
  const ajouter = (morceau: string | undefined): void => {
    if (morceau === undefined || morceau.length < 2) return;
    morceaux.add(morceau);
    morceaux.add(decoder(morceau));
  };
  try {
    const lue = new URL(url);
    ajouter(lue.username);
    ajouter(lue.password);
    ajouter(lue.hostname);
    ajouter(lue.host);
  } catch {
    // Adresse mal formée : on découpe à la main « schéma://utilisateur:mot-de-passe@hôte… ».
  }
  const brute = /^[a-z]+:\/\/([^:@/]*)(?::([^@]*))?@([^:/?\s]*)/i.exec(url);
  if (brute !== null) {
    ajouter(brute[1]);
    ajouter(brute[2]);
    ajouter(brute[3]);
  }
  // Mots de l'adresse elle-même (une adresse mal formée peut être n'importe quoi).
  for (const mot of url.split(/[\s:@/?#&=]+/)) if (mot.length >= 4 && !/^postgres(ql)?$/i.test(mot)) ajouter(mot);
  return [...morceaux].sort((a, b) => b.length - a.length);
}

function nettoyer(texte: string, url: string): string {
  let propre = url === '' ? texte : texte.split(url).join(MASQUE_ADRESSE);
  propre = propre.replace(ADRESSE_POSTGRES, MASQUE_ADRESSE);
  for (const morceau of morceauxSensibles(url)) propre = propre.split(morceau).join(MASQUE);
  return propre.replace(ADRESSE_IP, MASQUE_HOTE);
}

/** « code X : message » (ou le message seul), nettoyé de tout ce qui vient de l'adresse `url`. */
export function messageErreurNettoye(erreur: unknown, url: string): string {
  if (!(erreur instanceof Error)) return 'erreur inconnue (sans détail, pour ne rien afficher de l’adresse)';
  const { code } = erreur as { code?: unknown };
  const message = nettoyer(erreur.message, url);
  const codeLisible = typeof code === 'string' || typeof code === 'number' ? nettoyer(String(code), url) : '';
  return codeLisible === '' ? message : `code ${codeLisible} : ${message}`;
}
