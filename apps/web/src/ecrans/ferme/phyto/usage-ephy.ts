/**
 * Libellé d'un usage e-phy (T53, T76) : « <culture> · <cible> · <dose> · DAR <n> j », ou « DAR non
 * précisé » quand e-phy n'en donne pas en jours (Q47). Partagé par la fiche produit et la saisie
 * d'un traitement (../../aujourdhui/traitement/).
 */
import type { UsageEphy } from '@planif/core/ephy';

const enFrancais = (n: number): string => String(n).replace('.', ',');

export function libelleUsage(u: UsageEphy): string {
  const dose = u.dose === null ? 'dose non précisée' : `${enFrancais(u.dose.valeur)} ${u.dose.unite}`;
  const dar = u.dar === null ? 'DAR non précisé' : `DAR ${String(u.dar)} j`;
  return `${u.culture} · ${u.cible} · ${dose} · ${dar}`;
}
