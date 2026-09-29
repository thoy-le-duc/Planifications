/**
 * Garde d'exhaustivité pour les `switch` sur une union discriminée :
 *
 *   switch (evenement.type) {
 *     case 'realise': …
 *     …
 *     default: return verifierExhaustif(evenement);
 *   }
 *
 * Si une variante est ajoutée sans être traitée, `evenement` n'est plus `never` et la
 * compilation échoue. À l'exécution (donnée corrompue ou venue d'une version plus récente),
 * l'appel lève une erreur explicite au lieu de continuer en silence.
 */
export function verifierExhaustif(valeur: never): never {
  throw new Error(`variante non traitée : ${JSON.stringify(valeur)}`);
}
