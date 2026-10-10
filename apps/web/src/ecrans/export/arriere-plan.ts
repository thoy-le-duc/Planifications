/**
 * Export en arrière-plan (T15e, Q28) : l'export de toute la ferme ne vit plus dans l'écran Ferme
 * mais ici, au niveau du module (chargé à la demande avec le reste de l'export). Quitter l'onglet
 * Ferme ne l'arrête plus ; le téléchargement arrive quand l'archive est prête. L'écran Ferme
 * (barre, « Annuler », annonce) et le bandeau des autres onglets (./BandeauExport.tsx) lisent le
 * même état et s'y abonnent.
 *
 * Un seul export à la fois : un second lancement sur la même ferme est refusé tant que le premier
 * n'est pas fini (lectures en vol comprises pour la même porte ; tant qu'il est en cours si la
 * porte de cette ferme a été republiée). Un lancement sur une autre porte arrête l'ancien export.
 *
 * Qui l'arrête : « Annuler » (écran Ferme ou bandeau), la déconnexion depuis l'écran Ferme (AVANT
 * la fermeture de la base, en attendant les lectures en vol), le changement de ferme active (Q25 :
 * le bandeau compare le fermeId de l'export à celui de la ferme ouverte), et la fin de la session
 * connectée de l'appli (bandeau démonté : déconnexion dans un autre onglet, appli fermée), qui
 * remet aussi l'état à zéro.
 */
import type { PorteDonnees } from '@planif/sync/export';
import { lancerExport, rendreLaMain, telechargerDansLeNavigateur } from './lancer.ts';

export type EtatExport =
  | { readonly etape: 'repos' }
  | { readonly etape: 'en_cours'; readonly fait: number; readonly total: number }
  | { readonly etape: 'fini'; readonly message: string }
  | { readonly etape: 'annule' }
  | { readonly etape: 'echec' };

/** Ce que montrent l'écran Ferme et le bandeau. Un nouvel objet à chaque changement. */
export interface InstantExport {
  /** Numéro de l'export (0 : aucun encore). */
  readonly id: number;
  /** Porte de la ferme exportée (celle du contexte, avant suivi des lectures). */
  readonly porte: PorteDonnees | null;
  /** Ferme exportée. */
  readonly fermeId: string | null;
  readonly etat: EtatExport;
  /** Vrai du lancement jusqu'à la fin de l'export, lectures en vol comprises. */
  readonly actif: boolean;
}

/** Attente maximale des lectures de l'export encore en vol avant de rendre la main (déconnexion). */
export const DELAI_FERMETURE_MS = 2_000;

/** Attend la fin des lectures suivies, au plus DELAI_FERMETURE_MS ; ne rejette jamais, ne laisse aucune minuterie. */
async function attendreLectures(lectures: ReadonlySet<Promise<unknown>>): Promise<void> {
  if (lectures.size === 0) return;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<void>((fin) => {
    minuterie = setTimeout(fin, DELAI_FERMETURE_MS);
  });
  const toutes = (async () => {
    while (lectures.size > 0) await Promise.allSettled([...lectures]);
  })();
  try {
    await Promise.race([toutes, limite]);
  } finally {
    clearTimeout(minuterie);
  }
}

const nombre = new Intl.NumberFormat('fr-FR');

let instant: InstantExport = { id: 0, porte: null, fermeId: null, etat: { etape: 'repos' }, actif: false };
let controleur: AbortController | null = null;
/** Fin de l'export courant, lectures en vol comprises (jamais rejetée). */
let fin: Promise<void> = Promise.resolve();
const abonnes = new Set<() => void>();

function notifier(): void {
  for (const f of [...abonnes]) f();
}

/**
 * Vrai si l'export courant est celui de cette ferme ouverte : même porte, ou même ferme (porte
 * republiée) tant qu'il est en cours.
 */
export function exportDe(i: InstantExport, porte: PorteDonnees, fermeId: string): boolean {
  return i.porte === porte || (i.fermeId === fermeId && i.etat.etape === 'en_cours');
}

/** Met à jour l'instant de l'export `id` ; ignoré si un autre export l'a remplacé. */
function poser(id: number, changement: Partial<Pick<InstantExport, 'etat' | 'actif'>>): void {
  if (id !== instant.id) return;
  instant = { ...instant, ...changement };
  notifier();
}

export const exportEnFond = {
  lire: (): InstantExport => instant,

  /** Appelé à chaque changement ; renvoie le désabonnement. */
  abonner: (f: () => void): (() => void) => {
    abonnes.add(f);
    return () => {
      abonnes.delete(f);
    };
  },

  /**
   * Lance l'export de la ferme ouverte (porte du contexte). Faux si un export de cette ferme est
   * déjà en cours (un seul à la fois).
   */
  lancer(porteFerme: PorteDonnees, fermeId: string): boolean {
    if (instant.actif && exportDe(instant, porteFerme, fermeId)) return false;
    // Une autre porte : l'ancien export lit une porte périmée, il s'arrête.
    controleur?.abort();
    const ctrl = new AbortController();
    controleur = ctrl;
    const { signal } = ctrl;
    const id = instant.id + 1;
    // Porte suivie : les lectures encore en vol sont attendues avant de dire l'export fini
    // (la déconnexion ferme la base ensuite).
    const lectures = new Set<Promise<unknown>>();
    const porte: PorteDonnees = {
      ...porteFerme,
      lire: <T>(sql: string, parametres?: readonly unknown[]) => {
        const p = porteFerme.lire<T>(sql, parametres);
        const suivie = p.then(
          () => undefined,
          () => undefined,
        );
        lectures.add(suivie);
        void suivie.then(() => lectures.delete(suivie));
        return p;
      },
    };
    instant = { id, porte: porteFerme, fermeId, etat: { etape: 'en_cours', fait: 0, total: 0 }, actif: true };
    fin = (async () => {
      try {
        // Le rendu du tap (barre, « Annuler ») d'abord, le lancement dans une tâche à part :
        // observé sous charge, les deux ensemble faisaient une tâche de ≈ 54 ms (CPU ×4).
        // MessageChannel, pas setTimeout : très ralenti dans un onglet caché.
        await rendreLaMain();
        signal.throwIfAborted();
        const archive = await lancerExport({
          porte,
          fermeId,
          maintenant: () => new Date(),
          telecharger: telechargerDansLeNavigateur,
          signal,
          avancement: ({ fait, total }) => {
            if (!signal.aborted) poser(id, { etat: { etape: 'en_cours', fait, total } });
          },
        });
        const evenements = archive.lignes.evenement ?? 0;
        poser(id, { etat: { etape: 'fini', message: `Archive ${archive.nomFichier} prête : ${nombre.format(evenements)} événements exportés.` } });
      } catch (erreur: unknown) {
        if (signal.aborted) {
          poser(id, { etat: { etape: 'annule' } });
          return;
        }
        console.error('Export de la ferme impossible', erreur);
        poser(id, { etat: { etape: 'echec' } });
      } finally {
        // Annulé : l'export a rejeté tout de suite, mais une lecture de page peut être en vol.
        await attendreLectures(lectures);
        if (controleur === ctrl) controleur = null;
        poser(id, { actif: false });
      }
    })();
    notifier();
    return true;
  },

  /**
   * Annule l'export en cours (s'il y en a un) : « Export annulé » tout de suite, aucun
   * téléchargement ensuite. Résout quand il est bien arrêté, lectures en vol comprises.
   */
  arreter(): Promise<void> {
    if (!instant.actif) return Promise.resolve();
    controleur?.abort();
    if (instant.etat.etape === 'en_cours') poser(instant.id, { etat: { etape: 'annule' } });
    return fin;
  },

  /**
   * Fin de la session connectée : l'export en cours est arrêté (aucun téléchargement ensuite) et
   * l'état revient au repos ; les lectures encore en vol ne sont pas attendues.
   */
  reinitialiser(): void {
    controleur?.abort();
    controleur = null;
    instant = { id: instant.id + 1, porte: null, fermeId: null, etat: { etape: 'repos' }, actif: false };
    fin = Promise.resolve();
    notifier();
  },
};
