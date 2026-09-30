/**
 * Écran Ferme (T16, maquette « Ferme ») : l'export de toute la ferme (T15, branché en T16b) et la
 * déconnexion (T09b). Chargé à la demande par App : hors du JavaScript de démarrage.
 *
 * Export (T16b) : un seul bouton, actif quand la base du téléphone est prête et la ferme connue
 * (ContexteFerme). Un tap charge l'export (`import('../export/index.ts')`, jamais un import
 * statique : ni l'entrée ni ce morceau ne portent l'export), lit la base par la porte du contexte
 * et télécharge l'archive. Barre d'avancement et bouton « Annuler » pendant l'export.
 *
 * Déconnexion (T11) : la base ouverte par l'appli compte les saisies en attente et se ferme avant
 * l'effacement. Dès que la déconnexion est décidée, le bouton d'export est désactivé et un export
 * en cours est annulé (téléphone partagé : aucune archive ne sort après). L'annulation rejette
 * tout de suite côté export, mais une lecture de page déjà partie dans la porte continue : la
 * base n'est fermée qu'une fois toutes les lectures de l'export terminées (relecture T16b).
 */
import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { urlApi } from '../../connexion/client.ts';
import { deconnecterAvecConfirmation, effacementsEnAttente } from '../../connexion/deconnexion.ts';
import { stockageNavigateur, type SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import { baseLocaleExiste, effacerDonneesLocales } from '../../donnees/effacer.ts';
import type { PorteDonnees } from '@planif/sync';
import type { EtatBase, PoigneeDonnees } from '../../donnees/etat-appli.ts';
import { AlerteOrange, BoutonSecondaire, CARTE } from '../../ui/elements.tsx';
import { Confirmation } from '../../ui/confirmation.tsx';

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
}

/** L'écran d'export, chargé à la demande (morceau à part). */
const chargerExport = () => import('../export/index.ts');

/** Pourquoi le bouton d'export est désactivé, dit en clair. */
const EXPLICATION_EXPORT: Readonly<Record<Exclude<EtatBase, 'prete'>, string>> = {
  ouverture: 'Ouverture des données de ce téléphone… L’export sera possible dans un instant.',
  'sans-ferme': 'Aucune ferme sur ce téléphone pour l’instant : rien à exporter avant la première synchronisation.',
  echec: 'Les données de ce téléphone n’ont pas pu s’ouvrir : export impossible. Rechargez l’appli ; si cela recommence, signalez-le.',
};

type EtatExport =
  | { readonly etape: 'repos' }
  | { readonly etape: 'en_cours'; readonly fait: number; readonly total: number }
  | { readonly etape: 'fini'; readonly message: string }
  | { readonly etape: 'annule' }
  | { readonly etape: 'echec' };

/** Export en cours : son annulation, et sa fin, lectures de la porte comprises (jamais rejetée). */
interface ExportEnCours {
  readonly controleur: AbortController;
  readonly fin: Promise<void>;
}

const nombre = new Intl.NumberFormat('fr-FR');
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

export default function EcranFerme({ session, baseLocale, surDeconnecte, etatBase }: ProprietesEcranFerme) {
  // Lu à l'ouverture de l'écran : l'effacement n'est repris que sur l'écran de connexion.
  const [effacementEnAttente] = useState(() => effacementsEnAttente(stockageNavigateur()).length > 0);
  const ouverte = useContext(ContexteFerme);
  const [etatExport, setEtatExport] = useState<EtatExport>({ etape: 'repos' });
  const exportEnCours = useRef<ExportEnCours | null>(null);
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);
  /** Déconnexion décidée : lu par `exporter` au moment du tap, sans attendre un nouveau rendu. */
  const deconnexionDecidee = useRef(false);
  /** Vrai du tap jusqu'à la fin de l'export, lectures en vol comprises (annulé : un peu après « Export annulé »). */
  const [exportActif, setExportActif] = useState(false);
  const pied = useRef<HTMLDivElement>(null);
  const enCours = etatExport.etape === 'en_cours';

  // Au lancement, le focus clavier passe sur « Annuler » (le bouton tapé devient désactivé).
  useEffect(() => {
    if (enCours) pied.current?.querySelector('button')?.focus();
  }, [enCours]);

  // Écran quitté (onglet changé, déconnexion) : l'export en cours est annulé, rien ne sort après.
  useEffect(
    () => () => {
      exportEnCours.current?.controleur.abort();
    },
    [],
  );

  const exportPossible = etatBase === 'prete' && ouverte !== null && !deconnexionEnCours;

  // Export possible : son code est chargé au repos, après l'affichage de l'écran, pour que le tap
  // ne paie pas l'évaluation du morceau (observé : une tâche d'≈ 50 ms, CPU ×4, juste après le tap).
  useEffect(() => {
    if (!exportPossible) return;
    const g = globalThis as { requestIdleCallback?: (f: () => void) => number; cancelIdleCallback?: (id: number) => void };
    const precharger = () => {
      chargerExport().catch(() => undefined);
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
    if (ouverte === null || exportEnCours.current !== null || deconnexionDecidee.current) return;
    const controleur = new AbortController();
    const signal = controleur.signal;
    // Porte suivie : les lectures encore en vol sont attendues avant de fermer la base.
    const lectures = new Set<Promise<unknown>>();
    const porte: PorteDonnees = {
      ...ouverte.porte,
      lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
        const p = ouverte.porte.lire<T>(sql, parametres);
        const suivie = p.then(
          () => undefined,
          () => undefined,
        );
        lectures.add(suivie);
        void suivie.then(() => lectures.delete(suivie));
        return p;
      },
    };
    const { fermeId } = ouverte;
    setEtatExport({ etape: 'en_cours', fait: 0, total: 0 });
    setExportActif(true);
    const fin = (async () => {
      try {
        const { lancerExport, telechargerDansLeNavigateur } = await chargerExport();
        signal.throwIfAborted();
        const archive = await lancerExport({
          porte,
          fermeId,
          maintenant: () => new Date(),
          telecharger: telechargerDansLeNavigateur,
          signal,
          avancement: ({ fait, total }) => {
            if (!signal.aborted) setEtatExport({ etape: 'en_cours', fait, total });
          },
        });
        const evenements = archive.lignes.evenement ?? 0;
        setEtatExport({ etape: 'fini', message: `Archive ${archive.nomFichier} prête : ${nombre.format(evenements)} événements exportés.` });
      } catch (erreur: unknown) {
        if (signal.aborted) {
          setEtatExport({ etape: 'annule' });
          return;
        }
        console.error('Export de la ferme impossible', erreur);
        setEtatExport({ etape: 'echec' });
      } finally {
        // Annulé : l'export a rejeté tout de suite, mais une lecture de page peut être en vol.
        while (lectures.size > 0) await Promise.allSettled([...lectures]);
        if (exportEnCours.current?.controleur === controleur) exportEnCours.current = null;
        setExportActif(false);
      }
    })();
    exportEnCours.current = { controleur, fin };
  }

  /** Annule l'export en cours (s'il y en a un) ; résout quand il est bien arrêté. */
  function arreterExport(): Promise<void> {
    const enCours = exportEnCours.current;
    if (enCours === null) return Promise.resolve();
    enCours.controleur.abort();
    return enCours.fin;
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
      <Carte titre="Mes données">
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
      {etatExport.etape === 'echec' && <AlerteOrange>L’export n’a pas pu se faire. Réessayez ; si cela recommence, signalez-le.</AlerteOrange>}

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
