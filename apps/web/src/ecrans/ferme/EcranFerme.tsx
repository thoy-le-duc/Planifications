/**
 * Écran Ferme (T16, maquette « Ferme ») : l'export de toute la ferme (T15, branché en T16b) et la
 * déconnexion (T09b). Chargé à la demande par App : hors du JavaScript de démarrage.
 *
 * Export (T16b) : un seul bouton, actif quand la base du téléphone est prête et la ferme connue
 * (ContexteFerme). Un tap charge l'export (`import('../export/index.ts')`, jamais un import
 * statique : ni l'entrée ni ce morceau ne portent l'export), lit la base par la porte du contexte
 * et télécharge l'archive. Barre d'avancement et bouton « Annuler » pendant l'export.
 * T15e : l'export vit dans le morceau de l'export (exportEnFond), pas dans l'écran ; l'écran en
 * montre l'état. Avec `surExport` (App), l'appli héberge l'export : quitter l'onglet ne l'arrête
 * plus, son bandeau le montre ailleurs. Sans hôte, quitter l'écran l'annule, comme avant.
 *
 * Déconnexion (T11) : la base ouverte par l'appli compte les saisies en attente et se ferme avant
 * l'effacement. Dès que la déconnexion est décidée, le bouton d'export est désactivé et un export
 * en cours est annulé (téléphone partagé : aucune archive ne sort après). L'annulation rejette
 * tout de suite côté export, mais une lecture de page déjà partie dans la porte continue : la
 * base n'est fermée qu'une fois toutes les lectures de l'export terminées (relecture T16b), ou
 * au plus tard après DELAI_FERMETURE_MS : une lecture qui ne revient jamais (worker planté,
 * verrou d'un autre onglet) ne doit pas empêcher d'effacer le téléphone.
 *
 * Mes itinéraires (T24) : une ligne, active quand la base est prête et la ferme connue. Un tap
 * charge l'écran (`import('../itineraires/index.ts')`, jamais un import statique : ni l'entrée
 * ni ce morceau ne le portent ; préchargé au repos) et le montre avec la porte du contexte.
 *
 * Importer un tableur (T14b) : une ligne de la carte « Mes données », active comme « Mes
 * itinéraires ». Un tap charge l'écran (`import('../import/index.ts')`, jamais un import statique)
 * et le montre avec la porte et la ferme du contexte.
 *
 * Placer sur la photo aérienne (T28b) : une ligne de la carte « Plan de la ferme », active comme
 * « Mes itinéraires ». Un tap charge l'éditeur (`import('../placement/index.ts')`, jamais un
 * import statique : ni l'entrée ni ce morceau ne le portent) et le montre avec la porte, la ferme
 * et l'utilisateur de la session. Lecture seule pour un équipier ou sur téléphone.
 *
 * Saisies refusées (T10i) : les refus de synchro de l'utilisateur (porte.surveillerRefus), en
 * tête de l'écran quand il y en a (./Refus.tsx). Marque MARQUE_REFUS_AFFICHES une fois par
 * ouverture, quand la liste est lue et dessinée (même vide).
 */
import { startTransition, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { urlApi } from '../../connexion/client.ts';
import { deconnecterAvecConfirmation, effacementsEnAttente } from '../../connexion/deconnexion.ts';
import { stockageNavigateur, type SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import { baseLocaleExiste, effacerDonneesLocales } from '../../donnees/effacer.ts';
import type { PorteDonnees, RefusSynchro } from '@planif/sync';
import type { EtatBase, PoigneeDonnees } from '../../donnees/etat-appli.ts';
import type * as ModuleExportType from '../export/index.ts';
import type { EtatExport, InstantExport } from '../export/index.ts';
import { AlerteOrange, BoutonSecondaire, CARTE } from '../../ui/elements.tsx';
import { Confirmation } from '../../ui/confirmation.tsx';
import { Apparence } from './Apparence.tsx';
import { SaisiesRefusees, type VidangeArchivage } from './Refus.tsx';

/** Marque de performance : les refus de synchro sont lus et dessinés (T10i, e2e/refus.e2e.ts). */
export const MARQUE_REFUS_AFFICHES = 'planif:refus-affiches';

const AUCUN_REFUS: readonly RefusSynchro[] = [];

/** Confirmation de déconnexion en attente de réponse (vrai : se déconnecter quand même). */
interface ConfirmationEnAttente {
  readonly message: string;
  readonly repondre: (quandMeme: boolean) => void;
}

export interface ProprietesEcranFerme {
  readonly session: SessionConnexion;
  /**
   * Base locale ouverte par l'appli (T11) : elle compte les saisies en attente, et se ferme avant
   * l'effacement (une base ouverte bloquerait la suppression).
   */
  readonly baseLocale: PoigneeDonnees;
  /** Déconnecté : retour à l'écran de connexion, avec le message d'échec éventuel. */
  readonly surDeconnecte: (erreur: string | null) => void;
  /** État de la base locale (T11) : l'export n'est possible que base 'prete'. */
  readonly etatBase: EtatBase;
  /** Démo (T25b) : pas de bouton « Se déconnecter ». */
  readonly sansDeconnexion?: boolean;
  /**
   * T15e : l'appli héberge l'export (bandeau sur les autres onglets) ; reçoit le morceau de
   * l'export dès qu'il est chargé. Sans hôte, quitter l'écran annule l'export.
   */
  readonly surExport?: (module: ModuleExport) => void;
}

/** Morceau de l'export (T15e) : App en tire le bandeau. */
export type ModuleExport = typeof ModuleExportType;

/** Morceau de l'export une fois chargé : il porte l'export en cours, qui survit à l'écran. */
let exportCharge: ModuleExport | null = null;

/** L'écran d'export, chargé à la demande (morceau à part). */
const chargerExport = () =>
  import('../export/index.ts').then((m) => {
    exportCharge = m;
    return m;
  });

/** Aucun export chargé : rien à montrer. */
const SANS_EXPORT: InstantExport = { id: 0, porte: null, fermeId: null, etat: { etape: 'repos' }, actif: false };

/** L'écran des itinéraires (T24), chargé à la demande (morceau à part). */
const chargerItineraires = () => import('../itineraires/index.ts');
type ModuleItineraires = Awaited<ReturnType<typeof chargerItineraires>>;

/** L'écran d'import d'un tableur (T14b), chargé à la demande (morceau à part). */
const chargerImport = () => import('../import/index.ts');
type EcranImportCharge = Awaited<ReturnType<typeof chargerImport>>['EcranImport'];

/**
 * L'éditeur de placement sur la photo aérienne (T28b), chargé à la demande (morceau à part).
 * T28f : la seule façon de l'ouvrir dans le code. La vue 3D (EcranPlan) réutilise ce chargeur
 * par un import dynamique d'EcranFerme au tap : ni l'éditeur ni l'écran Ferme ne sont chargés avant.
 */
export const chargerPlacement = () => import('../placement/index.ts');
/** T28i : build de la démo en ligne (constante du build, éliminée en production) : l'éditeur et la 3D y invitent à essayer. */
const DEMO = import.meta.env.MODE === 'demo';

export type EditeurPlacementCharge = Awaited<ReturnType<typeof chargerPlacement>>['EditeurPlacement'];

/** Pourquoi le bouton d'export est désactivé, dit en clair. */
const EXPLICATION_EXPORT: Readonly<Record<Exclude<EtatBase, 'prete'>, string>> = {
  ouverture: 'Ouverture des données de ce téléphone… L’export sera possible dans un instant.',
  'sans-ferme': 'Aucune ferme sur ce téléphone pour l’instant : rien à exporter avant la première synchronisation.',
  echec: 'Les données de ce téléphone n’ont pas pu s’ouvrir : export impossible. Rechargez l’appli ; si cela recommence, signalez-le.',
};

/** Texte de la zone d'annonce (role="status") de la carte « Mes données », selon l'étape. */
const ANNONCE: Readonly<Partial<Record<EtatExport['etape'], string>>> = { en_cours: 'Export en cours…', annule: 'Export annulé.' };
const BARRE: CSSProperties = { display: 'block', width: '100%', height: 16, accentColor: 'var(--couleur-foret)' };
const PIED_CARTE: CSSProperties = { display: 'grid', gap: 12, padding: '0 16px 16px' };

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

function Carte({ titre, idTitre, children }: { readonly titre: string; readonly idTitre?: string; readonly children: ReactNode }) {
  return (
    <section aria-label={titre} style={CARTE}>
      <h2
        id={idTitre}
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

export default function EcranFerme({ session, baseLocale, surDeconnecte, etatBase, sansDeconnexion = false, surExport }: ProprietesEcranFerme) {
  const idApparence = useId();
  // Lu à l'ouverture de l'écran : l'effacement n'est repris que sur l'écran de connexion.
  const [effacementEnAttente] = useState(() => effacementsEnAttente(stockageNavigateur()).length > 0);
  const ouverte = useContext(ContexteFerme);
  // T15e : l'export vit dans son morceau (exportEnFond) ; l'écran en suit l'état, par tranches
  // (startTransition, T15d : chaque avancée de la barre redessine l'écran).
  const [moduleExport, setModuleExport] = useState(exportCharge);
  // Dernier état notifié ; avant la première notification, l'état est lu au rendu.
  const [notifie, setNotifie] = useState<{ readonly module: ModuleExport; readonly instant: InstantExport } | null>(null);
  const instant =
    moduleExport === null ? SANS_EXPORT : notifie?.module === moduleExport ? notifie.instant : moduleExport.exportEnFond.lire();
  const instantDessine = useRef(instant);
  useLayoutEffect(() => {
    instantDessine.current = instant;
  });
  useEffect(() => {
    if (moduleExport === null) return undefined;
    surExport?.(moduleExport);
    const { exportEnFond } = moduleExport;
    const suivre = () => {
      startTransition(() => {
        setNotifie({ module: moduleExport, instant: exportEnFond.lire() });
      });
    };
    const fin = exportEnFond.abonner(suivre);
    // Changé entre le rendu et l'abonnement : rattrapé.
    if (exportEnFond.lire() !== instantDessine.current) suivre();
    return fin;
  }, [moduleExport, surExport]);
  // Sans hôte (surExport), écran quitté (onglet changé, déconnexion) : l'export est annulé, rien ne sort après.
  const heberge = surExport !== undefined;
  const demonte = useRef(false);
  useEffect(() => {
    demonte.current = false;
    return () => {
      demonte.current = true;
      if (!heberge) void exportCharge?.exportEnFond.arreter();
    };
  }, [heberge]);
  // L'export d'une autre ferme ouverte ne concerne pas cet écran.
  const exportDeCetteFerme = ouverte !== null && moduleExport?.exportDe(instant, ouverte.porte, ouverte.fermeId) === true;
  const etatExport: EtatExport = exportDeCetteFerme ? instant.etat : SANS_EXPORT.etat;
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);
  /** Déconnexion décidée : lu par `exporter` au moment du tap, sans attendre un nouveau rendu. */
  const deconnexionDecidee = useRef(false);
  /** Vrai du lancement jusqu'à la fin de l'export, lectures en vol comprises (annulé : un peu après « Export annulé »). */
  const exportActif = exportDeCetteFerme && instant.actif;
  /** Le morceau de l'export n'a pas pu se charger au tap : même alerte qu'un export en échec. */
  const [echecChargement, setEchecChargement] = useState(false);
  /** Export lancé depuis cet écran : le focus passe sur « Annuler » (pas au retour sur l'onglet). */
  const focusAnnuler = useRef(false);
  const pied = useRef<HTMLDivElement>(null);
  const enCours = etatExport.etape === 'en_cours';

  // Refus de synchro de l'utilisateur, tenus à jour (un refus qui arrive s'ajoute). Sans ferme
  // ouverte, rien à lire : la liste est vide.
  const porteRefus = ouverte?.porte ?? null;
  const [refusLus, setRefusLus] = useState<{ readonly porte: PorteDonnees; readonly refus: readonly RefusSynchro[] } | null>(null);
  useEffect(() => {
    if (porteRefus === null) return undefined;
    return porteRefus.surveillerRefus((r) => {
      setRefusLus({ porte: porteRefus, refus: r });
    });
  }, [porteRefus]);
  const refus = porteRefus === null ? AUCUN_REFUS : refusLus?.porte === porteRefus ? refusLus.refus : null;
  // T10l : archiver un refus vu (il sort de la liste ; la ligne reste).
  const archiverRefus = porteRefus === null ? undefined : (ids: readonly string[]) => porteRefus.archiverRefus(ids);
  // T10n : l'archivage différé (bandeau « Annuler ») est écrit et terminé avant la déconnexion.
  const vidangeRefus = useRef<VidangeArchivage | null>(null);

  // Une marque par ouverture de l'écran, quand les refus (ou leur absence) sont dessinés.
  const refusMarques = useRef(false);
  useEffect(() => {
    if (refus === null || refusMarques.current) return;
    refusMarques.current = true;
    performance.mark(MARQUE_REFUS_AFFICHES);
  }, [refus]);

  // Au lancement, le focus clavier passe sur « Annuler » (le bouton tapé devient désactivé).
  useEffect(() => {
    if (!enCours || !focusAnnuler.current) return;
    focusAnnuler.current = false;
    pied.current?.querySelector('button')?.focus();
  }, [enCours]);

  const exportPossible = etatBase === 'prete' && ouverte !== null && !deconnexionEnCours;
  const itinerairesPossibles = etatBase === 'prete' && ouverte !== null && !deconnexionEnCours;
  const [itineraires, setItineraires] = useState<ModuleItineraires | null>(null);
  const [itinerairesOuverts, setItinerairesOuverts] = useState(false);

  // Écran des itinéraires : son code est chargé au repos, pour que le tap ne paie que le rendu.
  useEffect(() => {
    if (!itinerairesPossibles) return;
    let actif = true;
    const g = globalThis as { requestIdleCallback?: (f: () => void) => number; cancelIdleCallback?: (id: number) => void };
    const precharger = () => {
      chargerItineraires().then(
        (m) => {
          if (actif) setItineraires(m);
        },
        () => undefined,
      );
    };
    if (g.requestIdleCallback === undefined || g.cancelIdleCallback === undefined) {
      const minuterie = setTimeout(precharger, 300);
      return () => {
        actif = false;
        clearTimeout(minuterie);
      };
    }
    const id = g.requestIdleCallback(precharger);
    const annuler = g.cancelIdleCallback;
    return () => {
      actif = false;
      annuler(id);
    };
  }, [itinerairesPossibles]);

  // Import d'un tableur (T14b) : chargé au tap, montré avec la porte du contexte.
  const [EcranImport, setEcranImport] = useState<EcranImportCharge | null>(null);
  function ouvrirImport(): void {
    if (!itinerairesPossibles) return;
    // Le composant seul (pas le module entier) : le morceau de l'écran n'a pas d'objet module à construire.
    chargerImport().then(
      ({ EcranImport: composant }) => {
        setEcranImport(() => composant);
      },
      (e: unknown) => {
        console.error('Écran d’import introuvable', e);
      },
    );
  }

  // Éditeur de placement (T28b) : chargé au tap, montré avec la porte du contexte.
  const [EditeurPlacement, setEditeurPlacement] = useState<EditeurPlacementCharge | null>(null);
  // Focus rendu au bouton d'ouverture une fois l'éditeur retiré (T28g).
  const boutonPlacement = useRef<HTMLDivElement>(null);
  const rendreFocus = useRef(false);
  useLayoutEffect(() => {
    if (EditeurPlacement !== null || !rendreFocus.current) return;
    rendreFocus.current = false;
    boutonPlacement.current?.querySelector('button')?.focus();
  }, [EditeurPlacement]);
  function ouvrirPlacement(): void {
    if (!itinerairesPossibles) return;
    chargerPlacement().then(
      ({ EditeurPlacement: composant }) => {
        setEditeurPlacement(() => composant);
      },
      (e: unknown) => {
        console.error('Éditeur de placement introuvable', e);
      },
    );
  }

  function ouvrirItineraires(): void {
    if (!itinerairesPossibles) return;
    setItinerairesOuverts(true);
    if (itineraires !== null) return;
    chargerItineraires().then(setItineraires, (e: unknown) => {
      console.error('Écran des itinéraires introuvable', e);
      setItinerairesOuverts(false);
    });
  }

  // Export possible : son code est chargé au repos, après l'affichage de l'écran, pour que le tap
  // ne paie pas l'évaluation du morceau (observé : une tâche d'≈ 50 ms, CPU ×4, juste après le tap).
  useEffect(() => {
    if (!exportPossible) return;
    const g = globalThis as { requestIdleCallback?: (f: () => void) => number; cancelIdleCallback?: (id: number) => void };
    const precharger = () => {
      chargerExport().then(setModuleExport, () => undefined);
    };
    if (g.requestIdleCallback === undefined || g.cancelIdleCallback === undefined) {
      const minuterie = setTimeout(precharger, 500);
      return () => {
        clearTimeout(minuterie);
      };
    }
    const id = g.requestIdleCallback(precharger);
    const annuler = g.cancelIdleCallback;
    return () => {
      annuler(id);
    };
  }, [exportPossible]);

  const annonce = ANNONCE[etatExport.etape] ?? (etatExport.etape === 'fini' ? etatExport.message : '');
  const explication =
    etatBase === 'prete' && ouverte !== null ? null : EXPLICATION_EXPORT[etatBase === 'prete' ? 'ouverture' : etatBase];

  function exporter(): void {
    if (ouverte === null || exportActif || deconnexionDecidee.current) return;
    const { porte, fermeId } = ouverte;
    if (echecChargement) setEchecChargement(false);
    const lancer = (m: ModuleExport) => {
      // Écran quitté pendant le chargement, sans hôte : rien ne part.
      if (deconnexionDecidee.current || (!heberge && demonte.current)) return;
      // L'appli reçoit le morceau ici aussi : écran déjà quitté (tap avant le préchargement),
      // l'effet qui le lui donne ne s'exécutera plus ; sans lui, ni bandeau ni arrêt en fin de session.
      surExport?.(m);
      // Le rendu du tap (barre, « Annuler ») passe par l'abonnement, en transition (T15d).
      if (m.exportEnFond.lancer(porte, fermeId)) focusAnnuler.current = true;
    };
    if (exportCharge !== null) {
      lancer(exportCharge);
      return;
    }
    // Tap avant le préchargement au repos : le morceau se charge (quelques ms depuis le précache).
    chargerExport().then(
      (m) => {
        setModuleExport(m);
        lancer(m);
      },
      (e: unknown) => {
        console.error('Export de la ferme impossible', e);
        setEchecChargement(true);
      },
    );
  }

  /** Annule l'export en cours (s'il y en a un) ; résout quand il est bien arrêté, lectures en vol comprises. */
  function arreterExport(): Promise<void> {
    return exportCharge?.exportEnFond.arreter() ?? Promise.resolve();
  }

  // Appel détaché : fetch ne doit pas être invoqué comme méthode d'un autre objet. Premier geste
  // de la déconnexion une fois décidée (confirmée s'il le fallait) : l'export s'arrête là, pas
  // 5 s plus tard quand l'API hors d'atteinte a fini de ne pas répondre.
  const envoyer: typeof fetch = (entree, init) => {
    void arreterExport();
    return fetch(entree, init);
  };
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
    deconnexionDecidee.current = true;
    setDeconnexionEnCours(true);
    let erreur: string | null = null;
    try {
      // T10n : un archivage de refus encore annulable part maintenant, avant de compter la file
      // d'envoi et de fermer la base (sinon il serait écrit dans une base fermée, ou perdu).
      await vidangeRefus.current?.();
      // Base ouverte par l'appli (T11) : elle compte la file d'envoi. Pas encore lisible (en cours
      // d'ouverture, ou bloquée par un autre onglet) : si la base locale existe, confirmation
      // générique d'abord (null) ; sans base, rien à perdre (0). Effacement : la base est fermée
      // d'abord, puis supprimée sans PowerSync (quelques lignes, aussi hors ligne).
      const issue = await deconnecterAvecConfirmation(session, {
        urlApi: urlApi(),
        fetch: envoyer,
        stockage: stockageNavigateur(),
        effacerBaseLocale: async (utilisateurId) => {
          // Export arrêté AVANT la fermeture : il ne lit plus une base qui se ferme.
          await arreterExport();
          await baseLocale.fermer();
          await effacerDonneesLocales(utilisateurId);
        },
        compterEnAttente: async () => (await baseLocale.compterEnAttente()) ?? ((await baseLocaleExiste(session.utilisateurId)) ? null : 0),
        confirmer,
      });
      if (issue === 'annule') {
        deconnexionDecidee.current = false;
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
      {refus !== null && <SaisiesRefusees refus={refus} archiver={archiverRefus} vidangeRef={vidangeRefus} />}
      <Carte titre="Ma façon de cultiver">
        <Ligne
          nom="Mes itinéraires"
          detail="Itinéraires par culture, travaux prévus, types d’intervention"
          signe="›"
          couleur="var(--couleur-foret)"
          desactivee={!itinerairesPossibles}
          surTap={ouvrirItineraires}
        />
      </Carte>
      {itinerairesOuverts && itineraires !== null && ouverte !== null && (
        <itineraires.EcranItineraires
          porte={ouverte.porte}
          fermeId={ouverte.fermeId}
          utilisateurId={session.utilisateurId}
          surFermer={() => {
            setItinerairesOuverts(false);
          }}
        />
      )}
      <Carte titre="Plan de la ferme">
        <div ref={boutonPlacement}>
          <Ligne
            nom="Placer sur la photo aérienne"
            detail="Serres, bâtiments et planches à leur vraie place, sur la photo IGN. Aussi depuis la vue 3D, « Modifier le plan »."
            signe="›"
            couleur="var(--couleur-foret)"
            desactivee={!itinerairesPossibles}
            surTap={ouvrirPlacement}
          />
        </div>
      </Carte>
      {EditeurPlacement !== null && ouverte !== null && (
        <EditeurPlacement
          key={ouverte.fermeId}
          porte={ouverte.porte}
          fermeId={ouverte.fermeId}
          utilisateurId={session.utilisateurId}
          invitationDemo={DEMO}
          surFermer={() => {
            rendreFocus.current = true;
            setEditeurPlacement(null);
          }}
        />
      )}
      <Carte titre="Mes données">
        <Ligne
          nom="Importer un tableur"
          detail="Parcellaire, cultures, séries ou assolement : CSV ou Excel, même hors ligne."
          signe="↑"
          couleur="var(--couleur-foret)"
          desactivee={!itinerairesPossibles}
          surTap={ouvrirImport}
        />
        <Ligne
          nom="Exporter toute ma ferme"
          detail="Archive ZIP : tout en JSON, et un CSV par table. Sans réseau."
          signe="↓"
          couleur="var(--couleur-encre)"
          desactivee={!exportPossible || enCours || exportActif}
          surTap={exporter}
        />
        {explication !== null && (
          <p style={{ ...PIED_CARTE, fontSize: 15, color: 'var(--couleur-secondaire)' }}>{explication}</p>
        )}
        {etatExport.etape === 'en_cours' && (
          <div ref={pied} style={PIED_CARTE}>
            {etatExport.total > 0 ? (
              <progress style={BARRE} max={etatExport.total} value={etatExport.fait} aria-label="Avancement de l’export" />
            ) : (
              <progress style={BARRE} aria-label="Avancement de l’export" />
            )}
            <BoutonSecondaire onClick={() => void arreterExport()}>
              Annuler
            </BoutonSecondaire>
          </div>
        )}
        {/* Une seule zone d'annonce, toujours présente : seul son texte change (lecteurs d'écran). */}
        <p role="status" style={annonce === '' ? undefined : { ...PIED_CARTE, overflowWrap: 'anywhere' }}>
          {annonce}
        </p>
      </Carte>
      {EcranImport !== null && ouverte !== null && (
        <EcranImport
          porte={ouverte.porte}
          fermeId={ouverte.fermeId}
          surFermer={() => {
            setEcranImport(null);
          }}
        />
      )}
      {(etatExport.etape === 'echec' || echecChargement) && <AlerteOrange>L’export n’a pas pu se faire. Réessayez ; si cela recommence, signalez-le.</AlerteOrange>}

      <Carte titre="Apparence" idTitre={idApparence}>
        <Apparence idTitre={idApparence} />
      </Carte>

      {!sansDeconnexion && (
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
      )}
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
