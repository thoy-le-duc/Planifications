/**
 * Écran Ferme (T16, maquette « Ferme ») : l'export de toute la ferme (T15) et la déconnexion
 * (T09b). Chargé à la demande par App : hors du JavaScript de démarrage.
 *
 * Export : la ligne est en place, mais l'appli n'ouvre pas encore la base du téléphone (PowerSync)
 * et ne sait pas quelle est sa ferme ; c'est le rôle des premiers écrans de données (T11). Tant
 * que ce n'est pas fait, le tap le dit franchement au lieu de faire semblant (voir le journal).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { urlApi } from '../../connexion/client.ts';
import { deconnecterAvecConfirmation, effacementsEnAttente } from '../../connexion/deconnexion.ts';
import { stockageNavigateur, type SessionConnexion } from '../../connexion/session.ts';
import { baseLocaleExiste, effacerDonneesLocales } from '../../donnees/effacer.ts';
import { AlerteOrange, CARTE } from '../../ui/elements.tsx';
import { Confirmation } from '../../ui/confirmation.tsx';

/** Confirmation de déconnexion en attente de réponse (vrai : se déconnecter quand même). */
interface ConfirmationEnAttente {
  readonly message: string;
  readonly repondre: (quandMeme: boolean) => void;
}

export interface ProprietesEcranFerme {
  readonly session: SessionConnexion;
  /** Déconnecté : retour à l'écran de connexion, avec le message d'échec éventuel. */
  readonly surDeconnecte: (erreur: string | null) => void;
}

// Appel détaché : fetch ne doit pas être invoqué comme méthode d'un autre objet.
const envoyer: typeof fetch = (entree, init) => fetch(entree, init);

/** Ligne d'une carte (maquette) : toute la ligne est la cible, 64 px au moins. */
const LIGNE: CSSProperties = {
  width: '100%',
  minHeight: 64,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 16px',
  border: 0,
  background: 'var(--couleur-surface)',
  textAlign: 'left',
  overflowWrap: 'anywhere',
};

const SOUS_TITRE: CSSProperties = { display: 'block', fontSize: 14, color: 'var(--couleur-secondaire)' };

interface ProprietesLigne {
  readonly nom: string;
  readonly detail: string;
  readonly signe: string;
  readonly couleur: string;
  readonly desactivee: boolean;
  readonly surTap: () => void;
}

/** Nom accessible = le nom seul (aria-label) : le détail reste un complément visuel. */
function Ligne({ nom, detail, signe, couleur, desactivee, surTap }: ProprietesLigne) {
  return (
    <button type="button" className="ligne-carte" aria-label={nom} disabled={desactivee} onClick={surTap} style={LIGNE}>
      <span>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 700, color: couleur }}>{nom}</span>
        <span style={SOUS_TITRE}>{detail}</span>
      </span>
      <span aria-hidden="true" style={{ fontSize: 22, color: 'var(--couleur-tertiaire)' }}>
        {signe}
      </span>
    </button>
  );
}

function Carte({ titre, children }: { readonly titre: string; readonly children: ReactNode }) {
  return (
    <section aria-label={titre} style={CARTE}>
      <h2
        style={{
          padding: '12px 16px 6px',
          fontFamily: 'var(--police-texte)',
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--couleur-secondaire)',
        }}
      >
        {titre}
      </h2>
      <div style={{ borderTop: '1px solid var(--couleur-fond)' }}>{children}</div>
    </section>
  );
}

/** Effacement d'un ancien compte resté en attente (T09b) : le dire, jusqu'à ce qu'il aboutisse. */
const ALERTE_EFFACEMENT = 'Les données d’un ancien compte n’ont pas encore été effacées de ce téléphone : fermez les autres onglets.';

export default function EcranFerme({ session, surDeconnecte }: ProprietesEcranFerme) {
  // Lu à l'ouverture de l'écran : l'effacement n'est repris que sur l'écran de connexion.
  const [effacementEnAttente] = useState(() => effacementsEnAttente(stockageNavigateur()).length > 0);
  const [exportDemande, setExportDemande] = useState(false);
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationEnAttente | null>(null);

  /** Montre la confirmation ; résout à la réponse (vrai : se déconnecter quand même). */
  function confirmer(message: string): Promise<boolean> {
    return new Promise((resoudre) => {
      setConfirmation({
        message,
        repondre: (quandMeme) => {
          setConfirmation(null);
          resoudre(quandMeme);
        },
      });
    });
  }

  async function seDeconnecter(): Promise<void> {
    if (deconnexionEnCours) return;
    setDeconnexionEnCours(true);
    let erreur: string | null = null;
    try {
      // Sans ouvrir PowerSync, on ne sait pas compter la file d'envoi : si la base locale existe,
      // confirmation générique d'abord (null) ; sans base, rien à perdre (0). Effacement de la base
      // sans PowerSync (quelques lignes) : hors ligne, ses fichiers ne sont pas en cache.
      const issue = await deconnecterAvecConfirmation(session, {
        urlApi: urlApi(),
        fetch: envoyer,
        stockage: stockageNavigateur(),
        effacerBaseLocale: effacerDonneesLocales,
        compterEnAttente: async () => ((await baseLocaleExiste(session.utilisateurId)) ? null : 0),
        confirmer,
      });
      if (issue === 'annule') {
        setDeconnexionEnCours(false);
        return;
      }
    } catch (e) {
      // La session est effacée quand même : on revient à la connexion, en le disant. Effacement
      // noté en attente : repris tout seul par l'écran de connexion, dont le message dit quoi faire.
      if (!effacementsEnAttente(stockageNavigateur()).includes(session.utilisateurId)) {
        erreur = `Données de ce téléphone non effacées : ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    surDeconnecte(erreur);
  }

  return (
    <>
      {effacementEnAttente && <AlerteOrange>{ALERTE_EFFACEMENT}</AlerteOrange>}
      <Carte titre="Mes données">
        <Ligne
          nom="Exporter toute ma ferme"
          detail="Archive ZIP : tout en JSON, et un CSV par table"
          signe="↓"
          couleur="var(--couleur-encre)"
          desactivee={false}
          surTap={() => {
            setExportDemande(true);
          }}
        />
      </Carte>
      {exportDemande && (
        <AlerteOrange titre="Pas encore branché">
          Bientôt : l’export lira les données de ce téléphone dès que l’appli les ouvrira (premiers écrans de planches).
        </AlerteOrange>
      )}

      <div style={CARTE}>
        <Ligne
          nom="Se déconnecter"
          detail={`${session.email} · efface les données de ce téléphone`}
          signe=""
          couleur="var(--couleur-texte-orange)"
          desactivee={deconnexionEnCours}
          surTap={() => void seDeconnecter()}
        />
      </div>
      {confirmation !== null && (
        <Confirmation
          testId="confirmation-deconnexion"
          titre="Se déconnecter ?"
          message={confirmation.message}
          libelleConfirmer="Se déconnecter quand même"
          surConfirmer={() => {
            confirmation.repondre(true);
          }}
          surAnnuler={() => {
            confirmation.repondre(false);
          }}
        />
      )}
    </>
  );
}
