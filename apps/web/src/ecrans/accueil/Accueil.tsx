/**
 * Sans session (T16, chargé à la demande par App) : la carte de connexion, et la reprise des
 * effacements restés en attente (T09b). Utile une fois par téléphone : hors du JavaScript de
 * démarrage. Pose la marque de premier affichage quand la carte est là.
 */
import { useEffect, useState } from 'react';
import { creerClientConnexion, urlApi } from '../../connexion/client.ts';
import {
  MESSAGE_EFFACEMENT_EN_ATTENTE,
  effacementsEnAttente,
  reprendreEffacements,
  retirerEffacementEnAttente,
} from '../../connexion/deconnexion.ts';
import { EcranConnexion } from '../../connexion/EcranConnexion.tsx';
import { enregistrerSession, stockageNavigateur, type SessionConnexion } from '../../connexion/session.ts';
import { effacerDonneesLocales } from '../../donnees/effacer.ts';
import { marquerAppPrete } from '../../perf.ts';
import { AlerteOrange } from '../../ui/elements.tsx';

// Appel détaché : fetch ne doit pas être invoqué comme méthode d'un autre objet.
const envoyer: typeof fetch = (entree, init) => fetch(entree, init);
const clientConnexion = creerClientConnexion({ baseUrl: urlApi(), fetch: envoyer });

/** Intervalle entre deux essais d'un effacement resté en attente. */
const INTERVALLE_REPRISE_MS = 5_000;

/** Pousses du motif de l'écran de connexion (maquette) : centre (x, y), rayon, opacité. */
const POUSSES: readonly (readonly [number, number, number, number])[] = [
  [80, 66, 6, 1],
  [140, 54, 6, 1],
  [200, 50, 6, 1],
  [260, 54, 6, 1],
  [320, 66, 6, 1],
  [110, 120, 5, 0.6],
  [230, 112, 5, 0.6],
  [290, 120, 5, 0.6],
];

/**
 * Motif des planches du bandeau vert (maquette « Connexion »). Dessiné ici plutôt que dans App
 * (T11b) : hors du JavaScript de démarrage. Placé après le titre dans le DOM, il passe dessous
 * grâce au z-index du titre (connexion.css).
 */
function MotifConnexion() {
  return (
    <svg className="connexion-motif zone-entete" width="390" height="360" viewBox="0 0 390 360" aria-hidden="true">
      <path
        d="M-20 90Q195 30 410 90M-20 150Q195 90 410 150M-20 210Q195 150 410 210M-20 270Q195 210 410 270"
        fill="none"
        strokeWidth="18"
        strokeLinecap="round"
        style={{ stroke: 'var(--couleur-foret-clair)' }}
      />
      <g style={{ fill: 'var(--couleur-pousse)' }}>
        {POUSSES.map(([x, y, r, opacite]) => (
          <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r={r} opacity={opacite} />
        ))}
      </g>
    </svg>
  );
}

export interface ProprietesAccueil {
  /** Échec de la dernière déconnexion. */
  readonly erreur: string | null;
  readonly surConnexion: (session: SessionConnexion) => void;
}

export default function Accueil({ erreur, surConnexion }: ProprietesAccueil) {
  /** Bases locales qui restent à effacer (base ouverte dans un autre onglet). */
  const [enAttente, setEnAttente] = useState<readonly string[]>(() => effacementsEnAttente(stockageNavigateur()));

  useEffect(() => {
    marquerAppPrete();
  }, []);

  // Effacement resté en attente : repris sur l'écran de connexion (au démarrage sans session,
  // après une déconnexion) toutes les 5 s jusqu'à réussite (l'autre onglet fermé, la base
  // disparaît sans rien toucher). Jamais une fois connecté (2e relecture sécurité, B2) : cet
  // écran n'existe que sans session.
  useEffect(() => {
    let actif = true;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    async function essayer(): Promise<void> {
      // Effacement sans PowerSync (quelques lignes) : hors ligne, ses fichiers ne sont pas en cache.
      const restants = await reprendreEffacements({ stockage: stockageNavigateur(), effacerBaseLocale: effacerDonneesLocales });
      if (!actif) return;
      setEnAttente(restants);
      if (restants.length > 0) {
        minuterie = setTimeout(() => void essayer(), INTERVALLE_REPRISE_MS);
      }
    }
    if (effacementsEnAttente(stockageNavigateur()).length > 0) void essayer();
    return () => {
      actif = false;
      clearTimeout(minuterie);
    };
  }, []);

  return (
    <>
      <MotifConnexion />
      <EcranConnexion
        client={clientConnexion}
        surConnexion={(nouvelle) => {
          // Effacement de cette base resté en attente (déconnexion avec un autre onglet ouvert) :
          // abandonné, l'utilisateur est de retour (2e relecture sécurité, B2).
          retirerEffacementEnAttente(stockageNavigateur(), nouvelle.utilisateurId);
          enregistrerSession(stockageNavigateur(), nouvelle);
          surConnexion(nouvelle);
        }}
      >
        {erreur !== null && <AlerteOrange>{erreur}</AlerteOrange>}
        {enAttente.length > 0 && <AlerteOrange>{MESSAGE_EFFACEMENT_EN_ATTENTE}</AlerteOrange>}
      </EcranConnexion>
    </>
  );
}
