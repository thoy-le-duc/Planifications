/**
 * Écran « Créer ma ferme » (T39) : connecté, base ouverte, aucune ferme. Contrat : en-tête de
 * ./EcranCreerFerme.test.tsx. Chargé à la demande par la coquille (App.tsx), jamais au
 * démarrage ; dans le précache du service worker comme les autres écrans.
 *
 * La ferme créée n'est pas écrite dans la base locale : elle y arrive par la synchro (membre et
 * ferme), et la coquille passe alors d'elle-même à l'écran de la ferme (donnees/ferme-active.ts).
 * D'ici là, « Ferme créée, synchronisation… ».
 */
import { useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { urlApi } from '../../connexion/client.ts';
import { stockageNavigateur, type SessionConnexion } from '../../connexion/session.ts';
import type { EtatSynchro } from '../../donnees/connecteur.ts';
import { cleFermeCreee, memoriserFerme } from '../../donnees/ferme-memorisee.ts';
import { gererJetons } from '../../donnees/jeton.ts';
import { BoutonPrincipal } from '../../ui/elements.tsx';
import { choisirEcranSansFerme, creerFerme, messageCreation, messageNom, NOM_FERME_MAX, validerNomFerme } from './creer-ferme.ts';
import './creer-ferme.css';

/**
 * Pour la vie de la page, par utilisateur : l'id de la ferme en cours de création, le même à
 * chaque essai (une réponse perdue ne crée pas deux fermes, l'API répond 409 au second envoi).
 */
const idsEnCours = new Map<string, string>();

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
}

export default function EcranCreerFerme({ session, synchro }: ProprietesCreerFerme) {
  const utilisateurId = session.utilisateurId;
  const reseau = useSyncExternalStore(abonnerReseau, enLigne, () => true);
  const [nom, setNom] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creee, setCreee] = useState(() => lireCreee(utilisateurId) !== null);
  /** Garde du double tap : l'état React n'est relu qu'au rendu suivant. */
  const enCours = useRef(false);

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
    let id = idsEnCours.get(utilisateurId);
    if (id === undefined) {
      id = crypto.randomUUID();
      idsEnCours.set(utilisateurId, id);
    }
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
    idsEnCours.delete(utilisateurId);
    try {
      stockage.setItem(cleFermeCreee(utilisateurId), r.fermeId);
    } catch {
      // Non retenue : seul cet écran monté sait que la ferme est créée.
    }
    // Ferme choisie : active dès que la synchro l'apporte, même si une autre arrive en même temps.
    memoriserFerme(stockage, utilisateurId, r.fermeId);
    setCreee(true);
  }

  const etat = creee ? 'creee' : choisirEcranSansFerme({ synchro, enLigne: reseau });
  return (
    <section data-testid="creer-ferme" data-etat={etat} className="creer-ferme">
      {etat === 'creee' ? (
        <p role="status" className="creer-ferme-texte">
          Ferme créée, synchronisation…
        </p>
      ) : etat === 'hors-ligne' ? (
        <p className="creer-ferme-texte">
          Aucune ferme sur ce compte pour l’instant. Pas de réseau : il en faut pour créer votre ferme la première fois. Le
          formulaire reviendra dès que le téléphone capte.
        </p>
      ) : etat === 'premiere-synchro' ? (
        <p className="creer-ferme-texte">Première synchronisation en cours : si votre compte a déjà une ferme, elle arrive.</p>
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
