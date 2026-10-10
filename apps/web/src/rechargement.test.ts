// @vitest-environment happy-dom
/**
 * Tests d'acceptation T11b — morceau introuvable après une mise à jour (relecture de T20).
 * Une page restée ouverte sur l'ancienne version demande un écran dont le fichier a disparu du
 * serveur : Vite lance alors `vite:preloadError` sur window. L'appli doit recharger la page, sans
 * jamais faire perdre une saisie en cours.
 *
 * ── Contrat (nouveau module `src/rechargement.ts`, appelé par `src/main.tsx`) ───────────────────
 *
 *   surveillerMorceauIntrouvable(options?: OptionsRechargement): () => void
 *     Écoute EVENEMENT_MORCEAU_INTROUVABLE ('vite:preloadError') sur `options.cible` (défaut :
 *     window) ; rend la fonction qui arrête l'écoute. À chaque événement :
 *       - `event.preventDefault()` (Vite ne relance pas l'erreur : l'appli gère) ;
 *       - si aucune saisie n'est en cours : `options.recharger()` (défaut : location.reload()) ;
 *       - sinon : on ne recharge PAS ; dès que `saisieEnCours()` redevient faux (sondée toutes
 *         les `sondageMs`, défaut 1 000 ms), on recharge, une seule fois ;
 *       - plusieurs événements (plusieurs fichiers manquants) : un seul rechargement ;
 *       - anti-boucle : si un rechargement de ce genre a déjà eu lieu il y a moins de
 *         DELAI_ANTI_BOUCLE_MS (60 s ; l'heure est rangée sous CLE_RECHARGEMENT dans
 *         `options.stockage`, défaut sessionStorage, écrite AVANT de recharger), on ne recharge
 *         pas : un fichier vraiment absent du serveur ne doit pas faire boucler la page. Un
 *         stockage illisible (exception) n'empêche pas de recharger.
 *
 *   saisieEnCours(doc?: Document): boolean   (défaut : document)
 *     Rien n'existait dans l'appli pour savoir si l'utilisateur est en train de saisir (pas de
 *     brouillon commun : chaque formulaire garde le sien en état React). Contrat simple, à partir
 *     du DOM seul : une saisie est en cours si
 *       - le focus est dans un champ éditable (input de texte, nombre, etc., textarea, élément
 *         contenteditable ; pas un bouton, une case à cocher ni un <select> seul), OU
 *       - un champ de texte (input ou textarea, non désactivé, non en lecture seule) contient du
 *         texte, focalisé ou non, OU
 *       - une boîte de dialogue est ouverte ([role="dialog"] ou [aria-modal="true"] : formulaire
 *         de série, feuille de détail, éditeur de placement), OU
 *       - un élément porte data-saisie-en-cours="oui" (pour un écran qui saisit sans champ, par
 *         exemple le pavé numérique de la récolte).
 *     Les écrans qui saisissent sans champ ni boîte de dialogue doivent poser ce marqueur.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface OptionsRechargement {
  readonly cible?: EventTarget;
  readonly recharger?: () => void;
  readonly saisieEnCours?: () => boolean;
  readonly stockage?: Pick<Storage, 'getItem' | 'setItem'>;
  readonly maintenant?: () => number;
  readonly sondageMs?: number;
}

interface ModuleRechargement {
  readonly EVENEMENT_MORCEAU_INTROUVABLE: string;
  readonly DELAI_ANTI_BOUCLE_MS: number;
  readonly CLE_RECHARGEMENT: string;
  surveillerMorceauIntrouvable(options?: OptionsRechargement): () => void;
  saisieEnCours(doc?: Document): boolean;
}

const CHEMIN = './rechargement.ts';
let m: ModuleRechargement;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleRechargement;
});

/** Stockage en mémoire, avec lecture de ce qui y est rangé. */
function stockageMemoire(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { lire: (k: string) => string | null } {
  const donnees = new Map(Object.entries(initial));
  return {
    getItem: (k) => donnees.get(k) ?? null,
    setItem: (k, v) => {
      donnees.set(k, v);
    },
    lire: (k) => donnees.get(k) ?? null,
  };
}

function preloadError(): Event {
  return new Event(m.EVENEMENT_MORCEAU_INTROUVABLE, { cancelable: true });
}

let arreter: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  arreter?.();
  arreter = null;
  vi.useRealTimers();
});

describe('T11b : morceau introuvable après une mise à jour — rechargement de la page', () => {
  it('l’événement est « vite:preloadError »', () => {
    expect(m.EVENEMENT_MORCEAU_INTROUVABLE).toBe('vite:preloadError');
  });

  it('sans saisie en cours : la page se recharge, et l’erreur n’est pas relancée (preventDefault)', () => {
    const cible = new EventTarget();
    const recharger = vi.fn();
    arreter = m.surveillerMorceauIntrouvable({ cible, recharger, saisieEnCours: () => false, stockage: stockageMemoire() });
    const e = preloadError();
    cible.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it('par défaut, l’écoute est sur window', () => {
    const recharger = vi.fn();
    arreter = m.surveillerMorceauIntrouvable({ recharger, saisieEnCours: () => false, stockage: stockageMemoire() });
    window.dispatchEvent(preloadError());
    vi.advanceTimersByTime(2_000);
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it('saisie en cours : pas de rechargement tant qu’elle dure ; rechargé une fois, dès qu’elle est finie', () => {
    const cible = new EventTarget();
    const recharger = vi.fn();
    let saisie = true;
    arreter = m.surveillerMorceauIntrouvable({ cible, recharger, saisieEnCours: () => saisie, stockage: stockageMemoire(), sondageMs: 1_000 });
    const e = preloadError();
    cible.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(recharger, 'rien n’est rechargé pendant la saisie').not.toHaveBeenCalled();
    saisie = false;
    vi.advanceTimersByTime(2_000);
    expect(recharger).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(recharger, 'une seule fois').toHaveBeenCalledTimes(1);
  });

  it('plusieurs fichiers manquants à la suite : un seul rechargement', () => {
    const cible = new EventTarget();
    const recharger = vi.fn();
    arreter = m.surveillerMorceauIntrouvable({ cible, recharger, saisieEnCours: () => false, stockage: stockageMemoire() });
    for (let i = 0; i < 4; i++) cible.dispatchEvent(preloadError());
    vi.advanceTimersByTime(5_000);
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it('anti-boucle : un rechargement a eu lieu il y a moins de 60 s, on ne recharge pas de nouveau', () => {
    const cible = new EventTarget();
    const recharger = vi.fn();
    const stockage = stockageMemoire();
    const maintenant = 1_800_000_000_000;
    arreter = m.surveillerMorceauIntrouvable({ cible, recharger, saisieEnCours: () => false, stockage, maintenant: () => maintenant });
    cible.dispatchEvent(preloadError());
    vi.advanceTimersByTime(2_000);
    expect(recharger).toHaveBeenCalledTimes(1);
    expect(stockage.lire(m.CLE_RECHARGEMENT), 'l’heure est rangée avant de recharger').not.toBeNull();
    arreter();

    // La page rechargée (même stockage de session) retombe sur le même fichier manquant.
    const apres = vi.fn();
    arreter = m.surveillerMorceauIntrouvable({ cible, recharger: apres, saisieEnCours: () => false, stockage, maintenant: () => maintenant + m.DELAI_ANTI_BOUCLE_MS - 1_000 });
    cible.dispatchEvent(preloadError());
    vi.advanceTimersByTime(5_000);
    expect(apres, 'pas de boucle de rechargements').not.toHaveBeenCalled();
    arreter();

    // Plus tard (une vraie mise à jour de plus), on recharge de nouveau.
    const plusTard = vi.fn();
    arreter = m.surveillerMorceauIntrouvable({ cible, recharger: plusTard, saisieEnCours: () => false, stockage, maintenant: () => maintenant + m.DELAI_ANTI_BOUCLE_MS + 1_000 });
    cible.dispatchEvent(preloadError());
    vi.advanceTimersByTime(2_000);
    expect(plusTard).toHaveBeenCalledTimes(1);
  });

  it('un stockage illisible n’empêche pas de recharger', () => {
    const cible = new EventTarget();
    const recharger = vi.fn();
    const casse: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('stockage bloqué');
      },
      setItem: () => {
        throw new Error('stockage bloqué');
      },
    };
    arreter = m.surveillerMorceauIntrouvable({ cible, recharger, saisieEnCours: () => false, stockage: casse });
    cible.dispatchEvent(preloadError());
    vi.advanceTimersByTime(2_000);
    expect(recharger).toHaveBeenCalledTimes(1);
  });

  it('la fonction rendue arrête l’écoute', () => {
    const cible = new EventTarget();
    const recharger = vi.fn();
    const stop = m.surveillerMorceauIntrouvable({ cible, recharger, saisieEnCours: () => false, stockage: stockageMemoire() });
    stop();
    cible.dispatchEvent(preloadError());
    vi.advanceTimersByTime(5_000);
    expect(recharger).not.toHaveBeenCalled();
  });
});

describe('T11b : saisieEnCours — ce que le DOM dit d’une saisie en cours', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const ajouter = <K extends keyof HTMLElementTagNameMap>(balise: K, proprietes: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => {
    const el = Object.assign(document.createElement(balise), proprietes);
    document.body.append(el);
    return el;
  };

  it('page au repos : pas de saisie', () => {
    ajouter('button', { textContent: 'Planches' });
    ajouter('select');
    ajouter('input', { type: 'text', value: '' });
    expect(m.saisieEnCours(document)).toBe(false);
  });

  it('focus dans un champ de texte, même vide : saisie en cours', () => {
    const champ = ajouter('input', { type: 'text' });
    champ.focus();
    expect(m.saisieEnCours(document)).toBe(true);
  });

  it('focus dans une zone de texte : saisie en cours', () => {
    ajouter('textarea').focus();
    expect(m.saisieEnCours(document)).toBe(true);
  });

  it('champ de texte rempli, sans le focus : saisie en cours', () => {
    ajouter('input', { type: 'text', value: '12,5' });
    expect(m.saisieEnCours(document)).toBe(true);
  });

  it('champ rempli mais désactivé ou en lecture seule : pas de saisie', () => {
    ajouter('input', { type: 'text', value: 'x', disabled: true });
    ajouter('input', { type: 'text', value: 'y', readOnly: true });
    expect(m.saisieEnCours(document)).toBe(false);
  });

  it('focus sur un simple bouton : pas de saisie', () => {
    ajouter('button', { textContent: 'Fermer' }).focus();
    expect(m.saisieEnCours(document)).toBe(false);
  });

  it('boîte de dialogue ouverte (formulaire de série, feuille) : saisie en cours', () => {
    const d = ajouter('div');
    d.setAttribute('role', 'dialog');
    expect(m.saisieEnCours(document)).toBe(true);
    d.remove();
    const modal = ajouter('div');
    modal.setAttribute('aria-modal', 'true');
    expect(m.saisieEnCours(document)).toBe(true);
  });

  it('marqueur data-saisie-en-cours="oui" posé par un écran qui saisit sans champ', () => {
    const el = ajouter('div');
    el.setAttribute('data-saisie-en-cours', 'oui');
    expect(m.saisieEnCours(document)).toBe(true);
  });
});

describe('T11b : branchement dans l’appli', () => {
  it('src/main.tsx importe rechargement.ts et appelle surveillerMorceauIntrouvable()', () => {
    const source = readFileSync(join(import.meta.dirname, 'main.tsx'), 'utf8');
    expect(source).toMatch(/from\s+['"]\.\/rechargement\.ts['"]/);
    expect(source).toMatch(/surveillerMorceauIntrouvable\(/);
  });
});
