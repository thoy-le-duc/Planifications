/**
 * T40 — installer l'appli sur le téléphone : ce qui est possible, et le faire en un tap.
 *
 *   - Android / Chrome (et Chrome, Edge sur ordinateur) : l'invitation `beforeinstallprompt`,
 *     retenue au démarrage par ./capture.ts ; `prompt()` ouvre la fenêtre d'installation du
 *     navigateur. Une invitation ne sert qu'une fois : elle est oubliée dès qu'elle est servie,
 *     et le navigateur en émet une nouvelle plus tard s'il le juge bon.
 *   - iPhone / iPad : pas d'API ; l'appli montre une aide (« Partager », puis « Sur l'écran
 *     d'accueil »), ./AideIos.tsx, chargée à la demande.
 *   - Rien si l'appli tourne déjà installée (`display-mode: standalone`, `navigator.standalone`),
 *     si elle vient d'être installée (`appinstalled`), ni sans moyen d'installer.
 *
 * Après un refus (T40b), l'invitation est perdue mais la carte reste : le bouton montre alors
 * l'aide du navigateur (menu ⋮, « Installer l'application »), ./AideAndroid.tsx, jusqu'à ce qu'une
 * nouvelle invitation reprenne la main. Acceptée (ou `appinstalled`) : plus rien.
 *
 * Bandeau d'Aujourd'hui : une fois fermé (ou l'installation demandée), il ne revient plus sur ce
 * téléphone (localStorage, CLE_BANDEAU).
 */
import { useSyncExternalStore } from 'react';

/** `menu` : invitation refusée et pas encore renouvelée, le menu du navigateur reste (T40b). */
export type MoyenInstallation = 'invite' | 'menu' | 'ios' | 'aucun';

/** Bandeau d'installation d'Aujourd'hui fermé sur ce téléphone. */
export const CLE_BANDEAU = 'planif.installation.bandeau-ferme';

const REQUETE_INSTALLEE = '(display-mode: standalone)';

/** Émis quand l'invitation vient d'être servie : la carte et le bandeau se redessinent. */
const EVENEMENT_SERVIE = 'planif:invitation-servie';

/** `appinstalled` reçu pendant ce chargement de l'appli. */
let installee = false;

/** T40b : l'invitation a été servie (la fenêtre s'est ouverte) sans installation constatée. */
let servie = false;

function dejaInstallee(): boolean {
  return installee || navigator.standalone === true || window.matchMedia(REQUETE_INSTALLEE).matches;
}

/** iPhone, iPod, iPad ; iPadOS se dit « Macintosh » mais a un écran tactile. */
function surIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function moyenInstallation(): MoyenInstallation {
  if (dejaInstallee()) return 'aucun';
  if (window.__planifInvitation) return 'invite';
  if (servie) return 'menu';
  return surIos() ? 'ios' : 'aucun';
}

/** Prévient à chaque changement : invitation reçue ou servie, appli installée. */
export function surveillerInstallation(rappel: () => void): () => void {
  const surInstallee = () => {
    installee = true;
    window.__planifInvitation = null;
    rappel();
  };
  const requete = window.matchMedia(REQUETE_INSTALLEE);
  addEventListener('beforeinstallprompt', rappel);
  addEventListener('appinstalled', surInstallee);
  addEventListener(EVENEMENT_SERVIE, rappel);
  requete.addEventListener('change', rappel);
  return () => {
    removeEventListener('beforeinstallprompt', rappel);
    removeEventListener('appinstalled', surInstallee);
    removeEventListener(EVENEMENT_SERVIE, rappel);
    requete.removeEventListener('change', rappel);
  };
}

/** Le moyen d'installer, tenu à jour (carte de l'onglet Ferme, bandeau d'Aujourd'hui). */
export function useMoyenInstallation(): MoyenInstallation {
  return useSyncExternalStore(surveillerInstallation, moyenInstallation);
}

/**
 * Ouvre la fenêtre d'installation du navigateur (Android, Chrome), une fois par invitation.
 * Vrai si le maraîcher a accepté.
 */
export async function ouvrirInvitation(): Promise<boolean> {
  const invitation = window.__planifInvitation;
  if (!invitation) return false;
  window.__planifInvitation = null;
  servie = true;
  dispatchEvent(new Event(EVENEMENT_SERVIE));
  try {
    await invitation.prompt();
    const accepte = (await invitation.userChoice).outcome === 'accepted';
    if (accepte) {
      installee = true;
      dispatchEvent(new Event(EVENEMENT_SERVIE));
    }
    return accepte;
  } catch (e) {
    console.warn('Installation non proposée', e);
    return false;
  }
}

function stockage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function bandeauFerme(): boolean {
  try {
    const s = stockage();
    return s !== null && s.getItem(CLE_BANDEAU) !== null;
  } catch {
    return false;
  }
}

export function fermerBandeau(): void {
  try {
    stockage()?.setItem(CLE_BANDEAU, '1');
  } catch {
    // Stockage refusé : le bandeau reviendra au prochain lancement, rien de grave.
  }
}
