/**
 * Base locale de l'appli (T11) : PowerSync ouvert pour l'utilisateur connecté, ferme active,
 * synchro et saisies en attente. Chargé à la demande par ./appli.ts : PowerSync et son WASM
 * restent hors du JavaScript de démarrage ; ils sont dans le précache du service worker, la base
 * s'ouvre donc aussi hors ligne.
 */
import type { SessionConnexion } from '../connexion/session.ts';
import type { EtatSynchro } from './connecteur.ts';
import { ETAT_DONNEES_INITIAL, type EtatDonnees, type PoigneeDonnees } from './etat-appli.ts';
import { suivreFermeActive } from './ferme-active.ts';
import { compterEcrituresEnAttente, ouvrirBaseLocale, synchroniser } from './ouvrir.ts';

export interface OptionsBaseAppli {
  readonly session: SessionConnexion;
  readonly urlApi: string;
  /** null : appli construite sans service de synchro, la base reste locale. */
  readonly urlPowerSync: string | null;
  readonly stockage: Pick<Storage, 'getItem' | 'setItem'>;
}

export function ouvrirBaseAppli(o: OptionsBaseAppli, surEtat: (e: EtatDonnees) => void): PoigneeDonnees {
  const utilisateurId = o.session.utilisateurId;
  const { base, fermer } = ouvrirBaseLocale(utilisateurId);
  const arrets: (() => void)[] = [];
  let fermee = false;
  let prete = false;
  // Sans service de synchro, rien ne part : le téléphone est « hors ligne » pour la synchro.
  let etat: EtatDonnees = { ...ETAT_DONNEES_INITIAL, synchro: o.urlPowerSync === null ? 'hors-ligne' : 'connexion' };
  const publier = (changement: Partial<EtatDonnees>) => {
    if (fermee) return;
    etat = { ...etat, ...changement };
    surEtat(etat);
  };

  base.waitForReady().then(
    () => {
      if (fermee) return;
      prete = true;
      arrets.push(
        suivreFermeActive(base, { utilisateurId, stockage: o.stockage }, (f) => {
          publier(f.etat === 'prete' ? { base: 'prete', ferme: { porte: f.porte, fermeId: f.fermeId } } : { base: 'sans-ferme', ferme: null });
        }),
      );
      const compter = () =>
        compterEcrituresEnAttente(base).then(
          (n) => {
            if (n !== etat.enAttente) publier({ enAttente: n });
          },
          (erreur: unknown) => {
            console.error('File d’envoi illisible', erreur);
          },
        );
      void compter();
      arrets.push(base.onChange({ onChange: compter }, { tables: ['ps_crud'], throttleMs: 200 }));
      if (o.urlPowerSync !== null) {
        const synchro = synchroniser(base, { session: o.session, urlApi: o.urlApi, urlPowerSync: o.urlPowerSync, stockage: o.stockage });
        arrets.push(
          synchro.surveillerEtat((s: EtatSynchro) => {
            if (s !== etat.synchro) publier({ synchro: s });
          }),
        );
      }
    },
    (erreur: unknown) => {
      console.error('Base locale illisible', erreur);
      publier({ base: 'echec' });
      void fermer();
    },
  );

  return {
    compterEnAttente: () => (prete && !fermee ? compterEcrituresEnAttente(base) : Promise.resolve(null)),
    async fermer() {
      fermee = true;
      for (const arreter of arrets.splice(0)) arreter();
      await fermer();
    },
  };
}
