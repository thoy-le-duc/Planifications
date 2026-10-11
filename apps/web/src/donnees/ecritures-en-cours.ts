/**
 * T11f — compteur global d'écritures en cours, pour toute l'appli (pas pour un écran) : une
 * écriture commencée compte jusqu'à sa fin, même si l'écran qui l'a lancée est démonté
 * (changement d'onglet). Tant qu'il n'est pas nul, <html> porte data-saisie-en-cours="oui", le
 * marqueur que `saisieEnCours()` (src/rechargement.ts) lit déjà : la page ne se recharge pas au
 * milieu d'une écriture, sans un octet de plus au démarrage (ce module est chargé par les écrans
 * qui écrivent, pas par main.tsx).
 */
let enCours = 0;

function refleter(): void {
  if (typeof document === 'undefined') return;
  if (enCours > 0) document.documentElement.dataset.saisieEnCours = 'oui';
  else delete document.documentElement.dataset.saisieEnCours;
}

/** Compte une écriture de plus ; rend la fonction qui la termine (sans effet si rappelée). */
export function commencerEcriture(): () => void {
  enCours += 1;
  refleter();
  let finie = false;
  return () => {
    if (finie) return;
    finie = true;
    enCours -= 1;
    refleter();
  };
}

/** Écritures commencées et pas encore terminées. */
export function ecrituresEnCours(): number {
  return enCours;
}
