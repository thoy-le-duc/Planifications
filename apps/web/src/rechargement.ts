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
 * Écoute `vite:preloadError` ; rend la fonction qui arrête l'écoute.
 *   - Rechargement permis (aucune saisie en cours, stockage lisible, pas de rechargement de ce
 *     genre depuis DELAI_ANTI_BOUCLE_MS) : `preventDefault()` et rechargement tout de suite.
 *   - Sinon l'erreur suit son cours (l'écran dit qu'il n'a pas pu s'ouvrir, et réessaiera au
 *     prochain affichage) : jamais d'`import()` résolu à vide.
 *   - Saisie en cours : sondée toutes les `sondageMs` ; rechargé une fois, dès qu'elle est finie
 *     (si le rechargement est permis à ce moment-là).
 *   - Stockage illisible : on ne recharge pas (sans l'heure rangée, un fichier vraiment absent
 *     ferait boucler la page).
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
  /** 0 : rien vu ; 1 : saisie en cours, on sonde ; 2 : décidé (rechargé ou refusé). */
  let etat = 0;
  let recharge = false;
  let minuterie: ReturnType<typeof setInterval> | undefined;
  /** Recharge si c'est permis ; l'heure est rangée AVANT de recharger. */
  const tenter = () => {
    etat = 2;
    try {
      const s = stockage ?? sessionStorage;
      const t = maintenant();
      if (t - Number(s.getItem(CLE_RECHARGEMENT)) < DELAI_ANTI_BOUCLE_MS) return;
      s.setItem(CLE_RECHARGEMENT, String(t));
    } catch {
      return;
    }
    recharge = true;
    recharger();
  };
  const surErreur = (e: Event) => {
    if (etat === 0) {
      if (enCours()) {
        etat = 1;
        minuterie = setInterval(() => {
          if (enCours()) return;
          clearInterval(minuterie);
          tenter();
        }, sondageMs);
      } else tenter();
    }
    if (recharge) e.preventDefault();
  };
  cible.addEventListener(EVENEMENT_MORCEAU_INTROUVABLE, surErreur);
  return () => {
    cible.removeEventListener(EVENEMENT_MORCEAU_INTROUVABLE, surErreur);
    clearInterval(minuterie);
  };
}
