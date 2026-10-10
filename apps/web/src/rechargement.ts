/**
 * T11b — morceau introuvable après une mise à jour (relecture de T20). Une page restée ouverte sur
 * l'ancienne version demande un écran dont le fichier a disparu : Vite lance `vite:preloadError`.
 * On recharge la page, jamais pendant une saisie, une seule fois, et jamais en boucle.
 * Chargé au démarrage par main.tsx : le code reste minimal (budget de démarrage).
 */

export const EVENEMENT_MORCEAU_INTROUVABLE = 'vite:preloadError';
/** Un rechargement de ce genre au plus par minute : un fichier vraiment absent ne fait pas boucler la page. */
export const DELAI_ANTI_BOUCLE_MS = 60_000;
export const CLE_RECHARGEMENT = 'planif:rechargement';

export interface OptionsRechargement {
  readonly cible?: EventTarget;
  readonly recharger?: () => void;
  readonly saisieEnCours?: () => boolean;
  readonly stockage?: Pick<Storage, 'getItem' | 'setItem'>;
  readonly maintenant?: () => number;
  readonly sondageMs?: number;
}

/**
 * Saisie en cours, d'après le DOM seul : boîte de dialogue ouverte, marqueur
 * data-saisie-en-cours="oui" (écran qui saisit sans champ), focus dans un élément contenteditable,
 * ou champ de texte modifiable (input de texte, nombre, date…, ou textarea) focalisé ou rempli.
 * Les `type` exclus commencent par b, c, f, h, i, r ou « su » : button, checkbox, color, file,
 * hidden, image, radio, range, reset, submit (search, lui, est un champ de texte).
 */
export function saisieEnCours(doc: Document = document): boolean {
  return (
    doc.querySelector('[role=dialog],[aria-modal=true],[data-saisie-en-cours=oui],[contenteditable]:focus') !== null ||
    [...doc.querySelectorAll<HTMLInputElement>('input,textarea')].some(
      (e) => !/^(?:[bcfhir]|su)/.test(e.type) && !e.disabled && !e.readOnly && (e.value !== '' || e === doc.activeElement),
    )
  );
}

/**
 * Écoute `vite:preloadError` et recharge la page (sondée toutes les `sondageMs`) dès qu'aucune
 * saisie n'est en cours, une seule fois ; rend la fonction qui arrête l'écoute.
 */
export function surveillerMorceauIntrouvable({
  cible = window,
  recharger = () => {
    location.reload();
  },
  saisieEnCours: enCours = () => saisieEnCours(),
  stockage,
  maintenant = Date.now,
  sondageMs = 1_000,
}: OptionsRechargement = {}): () => void {
  let minuterie: ReturnType<typeof setInterval> | undefined;
  const surErreur = (e: Event) => {
    e.preventDefault();
    minuterie ??= setInterval(() => {
      if (enCours()) return;
      clearInterval(minuterie);
      try {
        const s = stockage ?? sessionStorage;
        const t = maintenant();
        if (t - Number(s.getItem(CLE_RECHARGEMENT)) < DELAI_ANTI_BOUCLE_MS) return;
        s.setItem(CLE_RECHARGEMENT, String(t));
      } catch {
        // Stockage illisible : on recharge quand même.
      }
      recharger();
    }, sondageMs);
  };
  cible.addEventListener(EVENEMENT_MORCEAU_INTROUVABLE, surErreur);
  return () => {
    cible.removeEventListener(EVENEMENT_MORCEAU_INTROUVABLE, surErreur);
    clearInterval(minuterie);
  };
}
