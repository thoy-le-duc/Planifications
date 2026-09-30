/**
 * Ouverture de la base locale par l'appli (T11), après la connexion. Chargé à la demande par
 * App.tsx ; léger : PowerSync ne se charge (./base-appli.ts, import dynamique) que s'il y a une
 * base à ouvrir.
 *
 * Base ouverte si la synchro est configurée (URL du service PowerSync au build), ou si une base
 * locale existe déjà sur le téléphone (appli construite sans service : tests, démonstration).
 * Sinon, rien à lire : 'sans-ferme', sans charger PowerSync. Une base IndexedDB du même nom mais
 * d'un autre format n'est jamais ouverte ('echec') : PowerSync tenterait une mise à niveau qu'il
 * ne sait pas faire, bloquée si un autre onglet la garde ouverte.
 *
 * Un effacement de cette base encore en cours dans la page (déconnexion pendant qu'un autre
 * onglet la gardait ouverte, puis reconnexion) est attendu d'abord : rouvrir la base le
 * bloquerait, ou la recréerait sous l'effacement.
 */
import { urlApi } from '../connexion/client.ts';
import { lireSession, stockageNavigateur } from '../connexion/session.ts';
import { effacementEnCours, formatBaseLocale } from './effacer.ts';
import { ETAT_DONNEES_INITIAL, type EtatDonnees, type PoigneeDonnees } from './etat-appli.ts';

/** URL du service PowerSync figée au build (VITE_POWERSYNC_URL), ou null. */
function urlPowerSync(): string | null {
  const url: unknown = import.meta.env.VITE_POWERSYNC_URL;
  return typeof url === 'string' && url !== '' ? url.replace(/\/+$/, '') : null;
}

export function ouvrirDonneesAppli(utilisateurId: string, surEtat: (e: EtatDonnees) => void): PoigneeDonnees {
  let arretee = false;
  /** Lu par une fonction : la valeur change pendant les attentes. */
  const fermee = () => arretee;
  let ouverte: PoigneeDonnees | null = null;

  async function ouvrir(): Promise<void> {
    await effacementEnCours(utilisateurId);
    const url = urlPowerSync();
    const session = lireSession(stockageNavigateur());
    if (fermee() || session?.utilisateurId !== utilisateurId) return;
    const format = await formatBaseLocale(utilisateurId);
    if (fermee()) return;
    if (format === 'autre') {
      // Même nom, autre format : ni PowerSync ne saurait la reprendre, ni l'appli l'écraser.
      surEtat({ ...ETAT_DONNEES_INITIAL, base: 'echec', synchro: url === null ? 'hors-ligne' : 'connexion' });
      return;
    }
    if (url === null && format === 'absente') {
      surEtat({ ...ETAT_DONNEES_INITIAL, base: 'sans-ferme', synchro: 'hors-ligne' });
      return;
    }
    const { ouvrirBaseAppli } = await import('./base-appli.ts');
    if (fermee()) return;
    ouverte = ouvrirBaseAppli({ session, urlApi: urlApi(), urlPowerSync: url, stockage: stockageNavigateur() }, (e) => {
      if (!fermee()) surEtat(e);
    });
  }

  ouvrir().catch((erreur: unknown) => {
    console.error('Base locale impossible à ouvrir', erreur);
    if (!fermee()) surEtat({ ...ETAT_DONNEES_INITIAL, base: 'echec' });
  });

  return {
    compterEnAttente: () => ouverte?.compterEnAttente() ?? Promise.resolve(null),
    async fermer() {
      arretee = true;
      await ouverte?.fermer();
    },
  };
}
