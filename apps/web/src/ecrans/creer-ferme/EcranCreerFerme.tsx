/**
 * Écran « Créer ma ferme » (T39) : connecté, base ouverte, aucune ferme. Contrat : en-tête de
 * ./EcranCreerFerme.test.tsx. Chargé à la demande par la coquille (App.tsx), jamais au
 * démarrage ; dans le précache du service worker comme les autres écrans.
 *
 * La ferme créée n'est pas écrite dans la base locale : elle y arrive par la synchro (membre et
 * ferme), et la coquille passe alors d'elle-même à l'écran de la ferme (donnees/ferme-active.ts).
 * D'ici là, « Ferme créée, synchronisation… ».
 *
 * T39b : l'id en cours d'envoi est rangé sur le téléphone (cleFermeEnCours) ; une attente de plus
 * de 30 s le dit et propose de réessayer ; session expirée : pas de formulaire.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { urlApi } from '../../connexion/client.ts';
import { stockageNavigateur, type SessionConnexion } from '../../connexion/session.ts';
import type { EtatSynchro } from '../../donnees/connecteur.ts';
import { cleFermeCreee, cleFermeEnCours, memoriserFerme } from '../../donnees/ferme-memorisee.ts';
import { gererJetons } from '../../donnees/jeton.ts';
import { BoutonPrincipal } from '../../ui/elements.tsx';
import { choisirEcranSansFerme, creerFerme, DELAI_ATTENTE_SYNCHRO_MS, messageCreation, messageNom, NOM_FERME_MAX, validerNomFerme } from './creer-ferme.ts';
import './creer-ferme.css';

/**
 * Par utilisateur : l'id de la ferme en cours de création, le même à chaque essai et après un
 * rechargement (T39b) : une réponse perdue ne crée pas deux fermes, l'API répond 409 au second
 * envoi. Rangé sur le téléphone (cleFermeEnCours) AVANT l'envoi ; stockage indisponible : gardé
 * pour la vie de la page seulement.
 */
const idsEnCours = new Map<string, string>();

function idEnCours(utilisateurId: string): string {
  let id: string | null = null;
  try {
    id = stockageNavigateur().getItem(cleFermeEnCours(utilisateurId));
  } catch {
    // Stockage indisponible : l'id de la page, s'il y en a un.
  }
  id = id !== null && id !== '' ? id : (idsEnCours.get(utilisateurId) ?? crypto.randomUUID());
  idsEnCours.set(utilisateurId, id);
  try {
    stockageNavigateur().setItem(cleFermeEnCours(utilisateurId), id);
  } catch {
    // Non rangé : seul l'id de la page protège d'une seconde ferme.
  }
  return id;
}

function oublierIdEnCours(utilisateurId: string): void {
  idsEnCours.delete(utilisateurId);
  try {
    stockageNavigateur().removeItem(cleFermeEnCours(utilisateurId));
  } catch {
    // Rien de lisible à retirer.
  }
}

/** Par défaut, « Réessayer » recharge la page : la synchro et la vérification repartent de zéro. */
function recharger(): void {
  location.reload();
}

/**
 * Ferme créée et pas encore arrivée (cleFermeCreee) : rangée sur le téléphone, pour que ni un
 * changement d'onglet ni un rechargement ne repropose le formulaire (une seconde ferme par
 * erreur). Retirée si l'API ne la connaît pas (GET /moi, plus bas).
 */
function lireCreee(utilisateurId: string): string | null {
  try {
    return stockageNavigateur().getItem(cleFermeCreee(utilisateurId));
  } catch {
    return null;
  }
}

function abonnerReseau(rappel: () => void): () => void {
  window.addEventListener('online', rappel);
  window.addEventListener('offline', rappel);
  return () => {
    window.removeEventListener('online', rappel);
    window.removeEventListener('offline', rappel);
  };
}
const enLigne = () => navigator.onLine;

export interface ProprietesCreerFerme {
  readonly session: SessionConnexion;
  readonly synchro: EtatSynchro;
  /** T39b : « Réessayer » après une attente trop longue ; recharge la page par défaut. */
  readonly surReessayer?: (() => void) | undefined;
}

export default function EcranCreerFerme({ session, synchro, surReessayer = recharger }: ProprietesCreerFerme) {
  const utilisateurId = session.utilisateurId;
  const reseau = useSyncExternalStore(abonnerReseau, enLigne, () => true);
  const [nom, setNom] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creee, setCreee] = useState(() => lireCreee(utilisateurId) !== null);
  /** Garde du double tap : l'état React n'est relu qu'au rendu suivant. */
  const enCours = useRef(false);
  /** T39b : numéro de l'attente en cours (« Réessayer » en commence une autre). */
  const [essai, setEssai] = useState(0);
  /** T39b : l'attente (écran et numéro) qui dure depuis plus de 30 s ; null : aucune. */
  const [attenteLongue, setAttenteLongue] = useState<string | null>(null);

  // Ferme créée lors d'une ouverture précédente et toujours pas arrivée : si l'API dit que le
  // compte n'a aucune ferme de cet id (supprimée depuis, autre cas imprévu), le formulaire
  // revient. Sans réponse claire (réseau, erreur), on attend la synchro.
  useEffect(() => {
    const fermeId = lireCreee(utilisateurId);
    if (fermeId === null) return undefined;
    /** Objet : la valeur change après le démontage, pendant les attentes. */
    const ecran = { monte: true };
    const url = urlApi();
    const stockage = stockageNavigateur();
    const jetons = gererJetons(session, { urlApi: url, fetch: (...a) => fetch(...a), stockage });
    void (async () => {
      try {
        const res = await fetch(`${url}/moi`, { headers: { authorization: `Bearer ${await jetons.jetonValide()}` } });
        if (res.status !== 200) return;
        const corps = (await res.json()) as { fermes?: unknown };
        const connue = Array.isArray(corps.fermes) && corps.fermes.some((f: unknown) => typeof f === 'object' && f !== null && 'id' in f && f.id === fermeId);
        if (connue || !ecran.monte) return;
        stockage.removeItem(cleFermeCreee(utilisateurId));
        setCreee(false);
      } catch {
        // Pas de réponse : la synchro tranchera.
      }
    })();
    return () => {
      ecran.monte = false;
    };
    // Une fois par écran monté et par compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [utilisateurId]);

  async function creer(e: SyntheticEvent): Promise<void> {
    e.preventDefault();
    if (enCours.current) return;
    const validation = validerNomFerme(nom);
    if (!validation.ok) {
      setMessage(messageNom(validation.raison));
      return;
    }
    enCours.current = true;
    setEnvoi(true);
    setMessage(null);
    const id = idEnCours(utilisateurId);
    const stockage = stockageNavigateur();
    const url = urlApi();
    const r = await creerFerme({
      urlApi: url,
      fetch: (...a) => fetch(...a),
      jetons: gererJetons(session, { urlApi: url, fetch: (...a) => fetch(...a), stockage }),
      id,
      nom,
    });
    enCours.current = false;
    setEnvoi(false);
    if (!r.ok) {
      setMessage(messageCreation(r.raison));
      return;
    }
    oublierIdEnCours(utilisateurId);
    try {
      stockage.setItem(cleFermeCreee(utilisateurId), r.fermeId);
    } catch {
      // Non retenue : seul cet écran monté sait que la ferme est créée.
    }
    // Ferme choisie : active dès que la synchro l'apporte, même si une autre arrive en même temps.
    memoriserFerme(stockage, utilisateurId, r.fermeId);
    setCreee(true);
  }

  // Session expirée : rien n'arrivera par la synchro avant de se reconnecter, même une ferme créée.
  const etat = creee && synchro !== 'session-expiree' ? 'creee' : choisirEcranSansFerme({ synchro, enLigne: reseau });
  const attente = etat === 'creee' || etat === 'premiere-synchro' ? `${etat}:${String(essai)}` : null;
  useEffect(() => {
    if (attente === null) return undefined;
    const minuterie = setTimeout(() => {
      setAttenteLongue(attente);
    }, DELAI_ATTENTE_SYNCHRO_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [attente]);
  const tropLongue = attente !== null && attenteLongue === attente && (
    <>
      <p role="alert" className="message-connexion">
        La synchronisation ne répond pas depuis 30 secondes : réseau trop faible ou service indisponible. Rien n’est perdu.
      </p>
      <BoutonPrincipal
        type="button"
        onClick={() => {
          setEssai((n) => n + 1);
          surReessayer();
        }}
      >
        Réessayer
      </BoutonPrincipal>
    </>
  );
  return (
    <section data-testid="creer-ferme" data-etat={etat} className="creer-ferme">
      {etat === 'creee' ? (
        <>
          <p role="status" className="creer-ferme-texte">
            Ferme créée, synchronisation…
          </p>
          {tropLongue}
        </>
      ) : etat === 'session-expiree' ? (
        <p role="alert" className="creer-ferme-texte">
          {messageCreation('session_expiree')}
        </p>
      ) : etat === 'hors-ligne' ? (
        <p className="creer-ferme-texte">
          Aucune ferme sur ce compte pour l’instant. Pas de réseau : il en faut pour créer votre ferme la première fois. Le
          formulaire reviendra dès que le téléphone capte.
        </p>
      ) : etat === 'premiere-synchro' ? (
        <>
          <p className="creer-ferme-texte">Première synchronisation en cours : si votre compte a déjà une ferme, elle arrive.</p>
          {tropLongue}
        </>
      ) : (
        <form className="creer-ferme-formulaire" onSubmit={(e) => void creer(e)} noValidate>
          <p className="creer-ferme-texte">Aucune ferme sur ce compte pour l’instant. Donnez-lui un nom pour commencer.</p>
          <label className="champ-libelle">
            Nom de la ferme
            <input
              className="champ"
              type="text"
              name="nom-ferme"
              autoComplete="organization"
              maxLength={NOM_FERME_MAX}
              value={nom}
              onChange={(e) => {
                setNom(e.target.value);
              }}
            />
          </label>
          {message !== null && (
            <p role="alert" className="message-connexion">
              {message}
            </p>
          )}
          <BoutonPrincipal type="submit" disabled={envoi}>
            Créer ma ferme
          </BoutonPrincipal>
        </form>
      )}
    </section>
  );
}
