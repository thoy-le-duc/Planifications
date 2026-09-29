/**
 * Politique de sécurité du contenu (CSP) de l'appli (T09b), posée au build en balise
 * <meta http-equiv="Content-Security-Policy"> en tête de dist/index.html (vite.config.ts).
 * Contrat et décision : csp.test.ts.
 *
 * Pourquoi une balise : elle voyage avec le build quel que soit l'hébergeur, et le service worker
 * la resert hors ligne avec index.html. Ce qu'une balise ne peut pas porter (frame-ancestors,
 * report-uri, sandbox : ignorés par le navigateur) se pose en en-tête HTTP chez l'hébergeur le
 * jour de la mise en production : `Content-Security-Policy: frame-ancestors 'none'`.
 */

export interface OptionsCsp {
  /** VITE_API_URL du build : absente ou relative → même origine. */
  readonly urlApi?: string | undefined;
  /** VITE_POWERSYNC_URL du build : absente ou relative → même origine. */
  readonly urlPowerSync?: string | undefined;
}

/** Origine réduite à schéma, hôte (nom, IPv4 ou [IPv6]) et port : rien qui puisse fermer une directive. */
const MOTIF_ORIGINE = /^https?:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/**
 * Origine à autoriser pour une URL de service, null si elle est de la même origine (absente ou
 * relative). Toute autre forme lève : une valeur glissée dans VITE_API_URL ne doit pas pouvoir
 * élargir la politique (« https://x; script-src 'unsafe-inline' »).
 */
export function origineAutorisee(nom: string, url: string | undefined): string | null {
  if (url === undefined || url === '') return null;
  if (url.startsWith('/') && !url.startsWith('//')) {
    if (/[\s;,'"]/.test(url)) throw new Error(`${nom} : chemin relatif invalide « ${url} ».`);
    return null;
  }
  let analysee: URL;
  try {
    analysee = new URL(url);
  } catch {
    throw new Error(`${nom} : « ${url} » n'est ni une URL http(s) absolue, ni un chemin relatif.`);
  }
  if (analysee.protocol !== 'https:' && analysee.protocol !== 'http:') {
    throw new Error(`${nom} : schéma « ${analysee.protocol} » refusé (http ou https seulement).`);
  }
  if (!MOTIF_ORIGINE.test(analysee.origin) || !url.toLowerCase().startsWith(analysee.origin)) {
    throw new Error(`${nom} : origine « ${analysee.origin} » refusée dans la CSP.`);
  }
  return analysee.origin;
}

export function politiqueCsp(o: OptionsCsp): string {
  const origines = [origineAutorisee('VITE_API_URL', o.urlApi), origineAutorisee('VITE_POWERSYNC_URL', o.urlPowerSync)].filter(
    (v): v is string => v !== null,
  );
  const directives: readonly (readonly [string, ...string[]])[] = [
    ['default-src', "'self'"],
    // 'wasm-unsafe-eval' : compilation WebAssembly seulement (SQLite de PowerSync), ni eval() ni
    // JavaScript en ligne.
    ['script-src', "'self'", "'wasm-unsafe-eval'"],
    // Workers de PowerSync et service worker : fichiers de l'appli.
    ['worker-src', "'self'"],
    ['connect-src', "'self'", ...new Set(origines)],
    ['style-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
  ];
  return directives.map((d) => d.join(' ')).join('; ');
}

/** Balise <meta> de la politique (aucune valeur ne contient de guillemet double). */
export function baliseCsp(o: OptionsCsp): string {
  return `<meta http-equiv="Content-Security-Policy" content="${politiqueCsp(o)}" />`;
}
