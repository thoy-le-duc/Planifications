/**
 * Appli (T16 : habillage des maquettes validées). Le JavaScript de démarrage ne porte que ce qui
 * sert à chaque ouverture : la session gardée sur le téléphone, la coquille (en-tête, barre de
 * navigation) et le bandeau de l'écran de connexion. Les écrans secondaires se chargent à la
 * demande (budget de poids, apps/web/budget.json) :
 *   - la carte de connexion (utile une fois par téléphone) et la reprise des effacements en
 *     attente : ecrans/accueil/Accueil.tsx ;
 *   - l'écran Ferme (export, déconnexion) : ecrans/ferme/EcranFerme.tsx ;
 *   - l'écran Planches (T11) : ecrans/plan/ ;
 *   - l'écran Aujourd'hui (T13) : ecrans/aujourdhui/.
 * Tous sont dans le précache du service worker : ils s'ouvrent aussi hors ligne.
 *
 * T11 : connecté, l'appli ouvre la base locale (src/donnees/appli.ts, chargé à la demande, puis
 * PowerSync s'il y a une base à ouvrir), la garde ouverte pour les écrans et la ferme à la
 * déconnexion, avant l'effacement. Les écrans reçoivent la ferme par ContexteFerme.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { lireSession, stockageNavigateur, surveillerSession, type SessionConnexion } from './connexion/session.ts';
import './connexion/connexion.css';
import { ContexteFerme } from './donnees/contexte.ts';
import { ETAT_DONNEES_INITIAL, type EtatDonnees, type FermeOuverte, type PoigneeDonnees } from './donnees/etat-appli.ts';
import { libelleSynchro } from './donnees/libelle-synchro.ts';
import { lireRefusVus, noterRefusVus, refusNonVus } from './donnees/refus-vus.ts';
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
const chargerAujourdhui = () => import('./ecrans/aujourdhui/index.ts');
const aujourdhui = differe(chargerAujourdhui);
/**
 * À attendre avant le premier rendu (main.tsx) : sans session, la carte de connexion est le
 * premier écran, son chargement part tout de suite et l'appli s'affiche d'un coup, carte
 * comprise, au lieu de deux rendus successifs.
 */
export function avantPremierRendu(): Promise<unknown> {
  return lireSession(stockageNavigateur()) === null ? accueil.precharger() : Promise.resolve();
}

/** Onglets pas encore construits : un écran d'attente propre (phase 2). */
const BIENTOT: Readonly<Record<Exclude<Onglet, 'ferme' | 'planches' | 'aujourdhui'>, string>> = {
  dicter: 'Bientôt : dicter une récolte ou une tâche ; l’appli propose, vous validez.',
};

/**
 * Onglet d'un écran de la ferme (Aujourd'hui, Planches) sans ferme ouverte : ce qui se passe, dit
 * franchement. `sans-ferme` : ce que l'onglet montrera.
 */
function Attente({ base, montrera }: { readonly base: EtatDonnees['base']; readonly montrera: string }) {
  return (
    <p className="attente">
      {base === 'sans-ferme'
        ? `Aucune ferme sur ce téléphone pour l’instant : ${montrera} après la première synchronisation.`
        : base === 'echec'
          ? 'Les données de ce téléphone n’ont pas pu s’ouvrir. Rechargez l’appli ; si cela recommence, signalez-le.'
          : 'Ouverture des données de ce téléphone…'}
    </p>
  );
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

/**
 * Au lancement, la lecture de la journée attend au plus ce délai le début du plan (T13c). Mesuré
 * (e2e, CPU ×4) : sans aucune attente, la journée et le plan se disputent la base et le tap sur
 * « Planches » juste après l'ouverture passe de ≈ 140 ms à ≈ 650 ms (budget 300 ms) ; avec
 * l'attente bornée, ≈ 110 ms, et Aujourd'hui s'affiche même si le plan ne finit jamais.
 */
const ATTENTE_PLAN_MAX_MS = 400;

/**
 * Refus de synchro (T10i) : la coquille ne les lit qu'après ce délai, une fois la journée et le
 * plan lancés (même raison qu'ATTENTE_PLAN_MAX_MS : ne pas disputer la base aux écrans au
 * lancement). Onglet Ferme ouvert : tout de suite.
 */
const ATTENTE_REFUS_MS = 1_000;

/**
 * Pastille des refus de synchro (T10i) : vrai si un refus de l'utilisateur n'a pas encore été vu.
 * Onglet Ferme ouvert : les refus lus (y compris ceux qui arrivent) sont notés vus, sur le
 * téléphone (./donnees/refus-vus.ts). La porte vient de l'état des données : rien de
 * @planif/sync dans le JavaScript de démarrage.
 */
function useRefusNonVus(ferme: FermeOuverte | null, utilisateurId: string | undefined, fermeOuvert: boolean): boolean {
  const porte = ferme?.porte ?? null;
  const [eveil, setEveil] = useState(false);
  const actif = eveil || fermeOuvert;
  const [lus, setLus] = useState<{ readonly porte: FermeOuverte['porte']; readonly ids: readonly string[] } | null>(null);

  useEffect(() => {
    if (porte === null) return undefined;
    const minuterie = setTimeout(() => {
      setEveil(true);
    }, ATTENTE_REFUS_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [porte]);

  useEffect(() => {
    if (!actif || porte === null) return undefined;
    return porte.surveillerRefus((refus) => {
      setLus({ porte, ids: refus.map((r) => r.id) });
    });
  }, [actif, porte]);

  const ids = porte !== null && lus?.porte === porte ? lus.ids : null;

  // Onglet Ferme ouvert : ce qui est lu (refus arrivés pendant l'ouverture compris) est vu.
  useEffect(() => {
    if (utilisateurId !== undefined && fermeOuvert && ids !== null) noterRefusVus(stockageNavigateur(), utilisateurId, ids);
  }, [utilisateurId, fermeOuvert, ids]);

  // Relu en quittant l'onglet Ferme : les refus notés vus pendant l'ouverture comptent.
  const vus = useMemo(
    () => (fermeOuvert || utilisateurId === undefined ? null : lireRefusVus(stockageNavigateur(), utilisateurId)),
    [fermeOuvert, utilisateurId],
  );
  return ids !== null && vus !== null && refusNonVus(ids, vus);
}

/** Démo en ligne (T25b) : constante du build, éliminée en production. */
const demo = import.meta.env.MODE === 'demo';

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
    // Démo : session disparue (« Réinitialiser » dans un autre onglet) → on recharge, pas de connexion.
    if (demo) {
      location.reload();
      return;
    }
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
    // Aujourd'hui, premier écran : son code se charge aussi pendant que la base s'ouvre, et la
    // journée se lit dès la ferme connue. T13d : chargé par `precharger`, l'écran (et son
    // instantané) se dessine dans le même rendu que la ferme ouverte, sans rendu de plus.
    const ecranDuJour = chargerAujourdhui();
    void aujourdhui.precharger();
    let prechargee: FermeOuverte | null = null;
    const surEtat = (e: EtatDonnees) => {
      if (fermee) return;
      setDonnees(e);
      const f = e.ferme;
      if (f !== null && f !== prechargee) {
        prechargee = f;
        // Échec : l'écran lira le plan (ou la journée) lui-même à l'ouverture. Le début du plan
        // passe d'abord à la base (un tap sur « Planches » juste après l'ouverture l'affiche
        // tout de suite) ; la journée le suit, mais ne l'attend jamais plus de
        // ATTENTE_PLAN_MAX_MS (T13c) : Aujourd'hui, écran d'accueil, ne reste pas bloqué
        // derrière le plan d'une grande ferme ou d'un téléphone lent.
        const plan = planches.then((m) => m.prechargerPlan(f.porte, f.fermeId, m.jourDuTelephone())).catch(() => undefined);
        const auPlusTard = new Promise<void>((tenir) => {
          setTimeout(tenir, ATTENTE_PLAN_MAX_MS);
        });
        ecranDuJour.then((m) => m.prechargerJournee(f.porte, f.fermeId, m.jourDuTelephone(), Promise.race([plan, auPlusTard]))).catch(() => undefined);
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
  const pastilleRefus = useRefusNonVus(donnees.ferme, utilisateurId, onglet === 'ferme');
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
        <div className="connexion-titre zone-entete">
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
          {demo ? 'Démo' : libelleSynchro(donnees.synchro, donnees.enAttente)}
        </span>
      </EnTete>
      <div className="coquille-contenu">
        <ContexteFerme value={donnees.ferme}>
          {onglet === 'ferme' ? (
            <ferme.Composant session={session} baseLocale={baseLocale} surDeconnecte={finDeSession} sansDeconnexion={demo} etatBase={donnees.base} />
          ) : onglet === 'planches' ? (
            donnees.ferme === null ? (
              <Attente base={donnees.base} montrera="le plan s’affichera" />
            ) : (
              <planches.Composant key={donnees.ferme.fermeId} porte={donnees.ferme.porte} fermeId={donnees.ferme.fermeId} />
            )
          ) : onglet === 'aujourdhui' ? (
            // T13g : dessiné dès l'ouverture de la base, sans attendre la ferme : l'écran montre en
            // lecture seule l'instantané de la dernière ferme montrée (ecrans/aujourdhui/), puis
            // reçoit la porte. T13d : l'utilisateur de la session, pour l'instantané.
            donnees.ferme !== null || donnees.base === 'ouverture' ? (
              <aujourdhui.Composant porte={donnees.ferme?.porte ?? null} fermeId={donnees.ferme?.fermeId ?? null} utilisateurId={session.utilisateurId} />
            ) : (
              <Attente base={donnees.base} montrera="les tâches du jour s’afficheront" />
            )
          ) : (
            <p className="attente">{BIENTOT[onglet]}</p>
          )}
        </ContexteFerme>
      </div>
      <BarreNavigation actif={onglet} surChoix={setOnglet} pastilleFerme={pastilleRefus} />
    </main>
  );
}
