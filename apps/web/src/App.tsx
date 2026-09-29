/**
 * Appli (T16 : habillage des maquettes validées). Le JavaScript de démarrage ne porte que ce qui
 * sert à chaque ouverture : la session gardée sur le téléphone, la coquille (en-tête, barre de
 * navigation) et le bandeau de l'écran de connexion. Les écrans secondaires se chargent à la
 * demande (budget de poids, apps/web/budget.json) :
 *   - la carte de connexion (utile une fois par téléphone) et la reprise des effacements en
 *     attente : ecrans/accueil/Accueil.tsx ;
 *   - l'écran Ferme (export, déconnexion) : ecrans/ferme/EcranFerme.tsx.
 * Les deux sont dans le précache du service worker : ils s'ouvrent aussi hors ligne.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { lireSession, stockageNavigateur, surveillerSession, type SessionConnexion } from './connexion/session.ts';
import './connexion/connexion.css';
import { marquerAppPrete } from './perf.ts';
import { BarreNavigation, EnTete, ONGLETS, type Onglet } from './ui/composants.tsx';

/**
 * Écran chargé à la demande, sans <Suspense> : React retient l'affichage d'un contenu suspendu
 * jusqu'à 300 ms pour éviter les clignotements, ce qui ferait perdre le budget de 300 ms. Rien
 * ne s'affiche à sa place pendant le chargement (quelques millisecondes depuis le précache).
 */
function differe<P extends object>(charger: () => Promise<{ default: ComponentType<P> }>): {
  readonly Composant: ComponentType<P>;
  /** Lance le chargement ; la promesse est tenue quand l'écran est prêt (ou a échoué). */
  readonly precharger: () => Promise<unknown>;
} {
  let charge: ComponentType<P> | null = null;
  let enCours: Promise<ComponentType<P>> | null = null;
  const demarrer = () =>
    (enCours ??= charger().then(
      (m) => {
        charge = m.default;
        return m.default;
      },
      (erreur: unknown) => {
        // Échec (fichier absent du cache, hors ligne) : un prochain affichage réessaiera.
        enCours = null;
        throw erreur;
      },
    ));
  function Composant(props: P) {
    const [C, setC] = useState<ComponentType<P> | null>(() => charge);
    const [echec, setEchec] = useState(false);
    useEffect(() => {
      if (C !== null) return undefined;
      let actif = true;
      demarrer().then(
        (c) => {
          if (actif) setC(() => c);
        },
        (erreur: unknown) => {
          console.error('Écran impossible à charger', erreur);
          if (actif) setEchec(true);
        },
      );
      return () => {
        actif = false;
      };
    }, [C]);
    if (C !== null) return <C {...props} />;
    return echec ? (
      <p role="alert" className="attente">
        Cet écran n’a pas pu s’ouvrir. Rechargez l’appli ; si cela recommence, signalez-le.
      </p>
    ) : null;
  }
  return {
    Composant,
    precharger: () => demarrer().catch(() => undefined),
  };
}

const accueil = differe(() => import('./ecrans/accueil/Accueil.tsx'));
const ferme = differe(() => import('./ecrans/ferme/EcranFerme.tsx'));
/**
 * À attendre avant le premier rendu (main.tsx) : sans session, la carte de connexion est le
 * premier écran, son chargement part tout de suite et l'appli s'affiche d'un coup, carte
 * comprise, au lieu de deux rendus successifs.
 */
export function avantPremierRendu(): Promise<unknown> {
  return lireSession(stockageNavigateur()) === null ? accueil.precharger() : Promise.resolve();
}

/** Onglets pas encore construits : un écran d'attente propre (T11, T13, phase 2). */
const BIENTOT: Readonly<Record<Exclude<Onglet, 'ferme'>, string>> = {
  aujourdhui: 'Bientôt : les tâches du jour, ce qui est en retard d’abord.',
  planches: 'Bientôt : le plan des planches, ce qui y pousse et ce qui vient.',
  dicter: 'Bientôt : dicter une récolte ou une tâche ; l’appli propose, vous validez.',
};

/**
 * Date de l'en-tête d'Aujourd'hui : « MAR. 29 SEPTEMBRE ». Formatée à l'affichage : créer un
 * formateur Intl au chargement du module coûte au démarrage, même sans session.
 */
function jourAffiche(): string {
  return new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }).toUpperCase();
}

/** Pousses du motif de l'écran de connexion : centre (x, y) en px. */
const POUSSES: readonly (readonly [number, number])[] = [
  [80, 66],
  [140, 54],
  [200, 50],
  [260, 54],
  [320, 66],
];

export function App() {
  // Session gardée sur le téléphone : lue une fois, sans réseau.
  const [session, setSession] = useState<SessionConnexion | null>(() => lireSession(stockageNavigateur()));
  /** Échec de la dernière déconnexion, montré sur l'écran de connexion. */
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<Onglet>('aujourdhui');

  // Connecté : la coquille est le premier écran. Sinon, la carte de connexion pose la marque.
  const connecte = session !== null;
  useEffect(() => {
    if (connecte) marquerAppPrete();
  }, [connecte]);

  /** Retour à l'écran de connexion (déconnexion ici ou dans un autre onglet). */
  function finDeSession(message: string | null): void {
    setErreur(message);
    setOnglet('aujourdhui');
    setSession(null);
  }

  // Déconnexion, ou autre compte, dans un autre onglet : écran de connexion, sans rechargement.
  const utilisateurId = session?.utilisateurId;
  useEffect(() => {
    if (utilisateurId === undefined) return undefined;
    return surveillerSession({
      cible: window,
      stockage: stockageNavigateur(),
      utilisateurId,
      surFin: () => {
        finDeSession(null);
      },
    });
  }, [utilisateurId]);

  if (session === null) {
    // Maquette « Connexion » : bandeau vert et motif des planches, carte claire en bas.
    return (
      <main data-testid="app" className="connexion">
        <svg className="connexion-motif" width="390" height="360" viewBox="0 0 390 360" aria-hidden="true">
          <path
            d="M-20 90Q195 30 410 90M-20 150Q195 90 410 150M-20 210Q195 150 410 210M-20 270Q195 210 410 270"
            fill="none"
            strokeWidth="18"
            strokeLinecap="round"
            style={{ stroke: 'var(--couleur-foret-clair)' }}
          />
          <g style={{ fill: 'var(--couleur-pousse)' }}>
            {POUSSES.map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r="6" />
            ))}
          </g>
        </svg>
        <div className="connexion-titre">
          <h1>Planifications</h1>
          <p>Ta ferme dans la poche, même sans réseau.</p>
        </div>
        <accueil.Composant erreur={erreur} surConnexion={setSession} />
      </main>
    );
  }

  const titre = ONGLETS.find((o) => o.id === onglet)?.libelle ?? '';
  return (
    <main data-testid="app" className="coquille">
      <EnTete titre={titre} {...(onglet === 'aujourdhui' ? { surtitre: jourAffiche() } : {})} />
      <div className="coquille-contenu">
        {onglet === 'ferme' ? (
          <ferme.Composant session={session} surDeconnecte={finDeSession} />
        ) : (
          <p className="attente">{BIENTOT[onglet]}</p>
        )}
      </div>
      <BarreNavigation actif={onglet} surChoix={setOnglet} />
    </main>
  );
}
