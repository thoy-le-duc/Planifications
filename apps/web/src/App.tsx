/**
 * Appli (T16 : habillage des maquettes validées). Le JavaScript de démarrage ne porte que ce qui
 * sert à chaque ouverture : la session gardée sur le téléphone, la coquille (en-tête, barre de
 * navigation) et le bandeau de l'écran de connexion. Les écrans secondaires se chargent à la
 * demande (budget de poids, apps/web/budget.json) :
 *   - la carte de connexion (utile une fois par téléphone) et la reprise des effacements en
 *     attente : ecrans/accueil/Accueil.tsx ;
 *   - l'écran Ferme (export, déconnexion) : ecrans/ferme/EcranFerme.tsx ;
 *   - l'écran Planches (T11) : ecrans/plan/.
 * Tous sont dans le précache du service worker : ils s'ouvrent aussi hors ligne.
 *
 * T11 : connecté, l'appli ouvre la base locale (src/donnees/appli.ts, chargé à la demande, puis
 * PowerSync s'il y a une base à ouvrir), la garde ouverte pour les écrans et la ferme à la
 * déconnexion, avant l'effacement. Les écrans reçoivent la ferme par ContexteFerme.
 */
import { useContext, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { lireSession, stockageNavigateur, surveillerSession, type SessionConnexion } from './connexion/session.ts';
import './connexion/connexion.css';
import { ContexteFerme } from './donnees/contexte.ts';
import { ETAT_DONNEES_INITIAL, type EtatDonnees, type FermeOuverte, type PoigneeDonnees } from './donnees/etat-appli.ts';
import { libelleSynchro } from './donnees/libelle-synchro.ts';
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
const chargerPlanches = () => import('./ecrans/plan/index.ts');
const planches = differe(chargerPlanches);
/**
 * À attendre avant le premier rendu (main.tsx) : sans session, la carte de connexion est le
 * premier écran, son chargement part tout de suite et l'appli s'affiche d'un coup, carte
 * comprise, au lieu de deux rendus successifs.
 */
export function avantPremierRendu(): Promise<unknown> {
  return lireSession(stockageNavigateur()) === null ? accueil.precharger() : Promise.resolve();
}

/** Onglets pas encore construits : un écran d'attente propre (T13, phase 2). */
const BIENTOT: Readonly<Record<Exclude<Onglet, 'ferme' | 'planches'>, string>> = {
  aujourdhui: 'Bientôt : les tâches du jour, ce qui est en retard d’abord.',
  dicter: 'Bientôt : dicter une récolte ou une tâche ; l’appli propose, vous validez.',
};

/** Onglet Planches sans ferme ouverte : ce qui se passe, dit franchement. */
const ATTENTE_PLANCHES: Readonly<Record<Exclude<EtatDonnees['base'], 'prete'>, string>> = {
  ouverture: 'Ouverture des données de ce téléphone…',
  'sans-ferme': 'Aucune ferme sur ce téléphone pour l’instant : le plan s’affichera après la première synchronisation.',
  echec: 'Les données de ce téléphone n’ont pas pu s’ouvrir. Rechargez l’appli ; si cela recommence, signalez-le.',
};

/** L'écran Planches sur la ferme du contexte (fournie par la coquille). */
function OngletPlanches({ base }: { readonly base: EtatDonnees['base'] }) {
  const ouverte = useContext(ContexteFerme);
  if (ouverte === null) return <p className="attente">{ATTENTE_PLANCHES[base === 'prete' ? 'ouverture' : base]}</p>;
  return <planches.Composant key={ouverte.fermeId} porte={ouverte.porte} fermeId={ouverte.fermeId} />;
}

/**
 * Date de l'en-tête d'Aujourd'hui : « MAR. 29 SEPTEMBRE ». Formatée à l'affichage : créer un
 * formateur Intl au chargement du module coûte au démarrage, même sans session.
 */
function jourAffiche(): string {
  return new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }).toUpperCase();
}

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

  // Base locale de l'utilisateur connecté : ouverte à la demande, gardée pour les écrans,
  // fermée à la déconnexion (EcranFerme l'attend avant d'effacer) ou au changement de compte.
  const utilisateurId = session?.utilisateurId;
  const [donnees, setDonnees] = useState<EtatDonnees>(ETAT_DONNEES_INITIAL);
  const poignee = useRef<PoigneeDonnees | null>(null);
  useEffect(() => {
    if (utilisateurId === undefined) return undefined;
    let fermee = false;
    let ouverte: PoigneeDonnees | null = null;
    const p: PoigneeDonnees = {
      compterEnAttente: () => ouverte?.compterEnAttente() ?? Promise.resolve(null),
      async fermer() {
        fermee = true;
        await ouverte?.fermer();
      },
    };
    poignee.current = p;
    // L'écran Planches se charge pendant que la base s'ouvre ; dès la ferme connue, le début de
    // son plan se prépare (avant même le rendu) : un tap sur « Planches » l'affiche tout de suite.
    const planches = chargerPlanches();
    let prechargee: FermeOuverte | null = null;
    const surEtat = (e: EtatDonnees) => {
      if (fermee) return;
      setDonnees(e);
      const f = e.ferme;
      if (f !== null && f !== prechargee) {
        prechargee = f;
        // Échec : l'écran lira le plan lui-même à l'ouverture.
        planches.then((m) => m.prechargerPlan(f.porte, f.fermeId, m.jourDuTelephone())).catch(() => undefined);
      }
    };
    import('./donnees/appli.ts').then(
      (m) => {
        if (!fermee) ouverte = m.ouvrirDonneesAppli(utilisateurId, surEtat);
      },
      (erreur: unknown) => {
        console.error('Données impossibles à charger', erreur);
        if (!fermee) setDonnees({ ...ETAT_DONNEES_INITIAL, base: 'echec' });
      },
    );
    return () => {
      void p.fermer();
      setDonnees(ETAT_DONNEES_INITIAL);
    };
  }, [utilisateurId]);
  const baseLocale = useMemo<PoigneeDonnees>(
    () => ({
      compterEnAttente: () => poignee.current?.compterEnAttente() ?? Promise.resolve(null),
      fermer: () => poignee.current?.fermer() ?? Promise.resolve(),
    }),
    [],
  );

  // Déconnexion, ou autre compte, dans un autre onglet : écran de connexion, sans rechargement.
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
            {POUSSES.map(([x, y, r, opacite]) => (
              <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r={r} opacity={opacite} />
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
    <main data-testid="app" data-base={donnees.base} className={onglet === 'planches' ? 'coquille coquille-plan' : 'coquille'}>
      <EnTete titre={titre} {...(onglet === 'aujourdhui' ? { surtitre: jourAffiche() } : {})}>
        <span data-testid="etat-synchro" role="status" className="etat-synchro">
          {libelleSynchro(donnees.synchro, donnees.enAttente)}
        </span>
      </EnTete>
      <div className="coquille-contenu">
        <ContexteFerme value={donnees.ferme}>
          {onglet === 'ferme' ? (
            <ferme.Composant session={session} baseLocale={baseLocale} surDeconnecte={finDeSession} />
          ) : onglet === 'planches' ? (
            <OngletPlanches base={donnees.base} />
          ) : (
            <p className="attente">{BIENTOT[onglet]}</p>
          )}
        </ContexteFerme>
      </div>
      <BarreNavigation actif={onglet} surChoix={setOnglet} />
    </main>
  );
}
