/**
 * Écran « Aujourd'hui » (T13, maquettes Main et Saisie) : le semainier de la semaine, en retard
 * d'abord ; « Fait » en un geste ; une récolte en trois gestes ; « Annuler » 10 s, puis depuis
 * l'historique. Contrat : ./test/contrat.ts (section « Écran (DOM) »).
 *
 * Chargé à la demande par App ; reçoit la porte (jamais PowerSync). Tout marche hors ligne : les
 * saisies vont dans la base du téléphone et partent avec la synchro. L'écran suit la base : une
 * saisie arrivée d'un autre téléphone s'y voit.
 *
 * T13d : au lancement, l'instantané de la dernière journée dessinée (./instantane.ts) s'affiche
 * tout de suite, puis la journée relue le remplace et devient le nouvel instantané. Rien n'est
 * écrit depuis l'instantané : « Fait » y passe par une lecture ciblée de la tâche dans la base.
 *
 * T13g : l'instantané s'affiche AVANT l'ouverture de la base (porte encore absente), en lecture
 * seule (boutons des cartes inactifs), s'il est de la dernière ferme choisie par cet utilisateur,
 * mémorisée avec la session (src/donnees/ferme-memorisee.ts). La ferme connue, l'écran reste le même si c'est celle-là,
 * sinon il repart de zéro sur la vraie ferme (l'instantané de l'autre n'est plus montré).
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { chargeSemaine, type EtapeRealisee, type UniteRecolte } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import { lireFermeMemorisee } from '../../donnees/ferme-memorisee.ts';
import './aujourdhui.css';
import { changerMasques, estMasquee as estMasqueeDans, journeeEnCache, marquerEcriture, masquesDe, suivreJournee, suivreMasques, type Masques } from './cache.ts';
import {
  capitale,
  ETAPES_FAITES,
  lireTacheCiblee,
  nomCulture,
  quantiteAvecUnite,
  texteCharge,
  texteDuree,
  type Culture,
  type EntreeHistorique,
  type EvenementLu,
  type Journee,
  type TacheJour,
} from './calculs.ts';
import { useFocusDuDialogue } from './dialogue.ts';
import { annulerSaisie, changerDate, DejaFait, marquerFait, marquerTravailFait, noterRecolte, type ContexteEcriture } from './ecritures.ts';
import { garderInstantane, lireInstantane, stockageParDefaut, type StockageInstantane, type VueJournee } from './instantane.ts';
import { IconeCoche, IconePanier, Recolte } from './Recolte.tsx';
import { libelleEvenement, vueCarte, vuesHistorique, type CarteVue, type SaisieVue } from './vues.ts';

export interface ProprietesEcranAujourdhui {
  /**
   * T13g : null tant que la base s'ouvre ; l'écran montre alors, en lecture seule, l'instantané
   * de la dernière ferme choisie (avec `utilisateurId`), ou dit que la base s'ouvre.
   */
  readonly porte: PorteDonnees | null;
  /** Ferme ouverte ; null tant que la base s'ouvre. */
  readonly fermeId: string | null;
  /** Jour du téléphone, 'AAAA-MM-JJ' ; par défaut celui de l'horloge du téléphone. */
  readonly aujourdhui?: () => string;
  /** T13d : utilisateur connecté (session) ; sans lui, aucun instantané n'est lu ni gardé. */
  readonly utilisateurId?: string;
  /** T13d : où garder l'instantané de la journée (défaut : localStorage). */
  readonly stockage?: StockageInstantane;
}

/** Marque de performance posée quand les tâches (ou « rien à faire ») sont dessinées. */
export const MARQUE_AUJOURDHUI_AFFICHE = 'planif:aujourdhui-affiche';

/**
 * Tâches dessinées par groupe avant « Voir les autres » : l'écran s'affiche vite même quand des
 * séries anciennes, jamais marquées faites, traînent en retard par centaines.
 */
const TACHES_PAR_GROUPE = 25;

/**
 * T13d : cartes du premier dessin à l'ouverture de l'écran (un écran de téléphone et un peu plus) ;
 * les autres suivent aussitôt, en tâche de fond (interruptible). Au lancement à froid, les tâches
 * du haut de l'écran se montrent sans attendre la mise en page de toute la liste.
 */
const CARTES_PREMIER_DESSIN = 8;

/** Saisies de l'historique dessinées avant « Voir les autres » (une grosse journée de récolte). */
const SAISIES_HISTORIQUE = 20;
const AUCUNE_SAISIE: readonly EntreeHistorique[] = [];
const AUCUNE_VUE: readonly SaisieVue[] = [];

/** Durée d'affichage du bouton « Annuler » après une saisie. */
export const DELAI_ANNULATION_MS = 10_000;

/**
 * Saisie de l'historique dont la série ou la campagne est supprimée : le serveur refuserait sa
 * correction ou son annulation (culture supprimée), le téléphone ne les propose pas.
 */
export const TEXTE_CULTURE_RETIREE = 'Culture retirée : correction impossible depuis le téléphone';

const deux = (n: number) => String(n).padStart(2, '0');

/** Jour du téléphone, 'AAAA-MM-JJ' (heure locale, pas UTC). */
export function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Saisie que le bandeau permet d'annuler. */
interface Annulable {
  readonly evenement: EvenementLu;
  readonly culture: Culture;
  readonly titre: string;
  readonly texte: string;
  /** Distingue deux saisies successives (le compte à rebours repart). */
  readonly numero: number;
}

type Dialogue =
  /** `cle` : tâche de début de récolte touchée sur l'instantané (sa culture vient de la journée relue). */
  | { readonly sorte: 'recolte'; readonly culture: Culture | null; readonly cle: string | null }
  | { readonly sorte: 'date'; readonly entree: EntreeHistorique; readonly max: string }
  | null;

function texteRetard(jours: number): string {
  return jours === 1 ? '1 jour de retard' : `${String(jours)} jours de retard`;
}

// ── Carte de tâche (maquette Main) ───────────────────────────────────────────────────────────

interface ProprietesCarte {
  readonly carte: CarteVue;
  /** T13g : base pas encore ouverte, rien ne peut s'écrire : boutons inactifs. */
  readonly inactive: boolean;
  readonly surFait: (cle: string) => void;
  readonly surPeser: (cle: string) => void;
}

/** Petite horloge du temps estimé et de la charge de la semaine. */
function IconeHorloge() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CarteTache({ carte: c, inactive, surFait, surPeser }: ProprietesCarte) {
  return (
    <li data-testid="tache" data-cle={c.cle} data-retard={c.retard ? 'oui' : 'non'} className={c.travail ? 'auj-tache auj-tache-travail' : 'auj-tache'}>
      <span data-testid="bande-famille" aria-hidden="true" className={`auj-bande auj-bande-${c.bande}`} />
      <div className="auj-tache-corps">
        <span data-testid="surtitre" className="auj-tache-verbe">
          {c.surtitre}
        </span>
        <span className="auj-tache-titre">{c.titre}</span>
        <span className="auj-tache-detail">{c.detail}</span>
        {(c.codes !== null || c.retard || c.minutes !== null) && (
          <span className="auj-tache-pied">
            {c.codes !== null && <span className="auj-code">{c.codes}</span>}
            {c.minutes !== null && (
              <span className="auj-temps">
                <IconeHorloge />
                <span data-testid="temps-estime">{texteDuree(c.minutes)}</span>
              </span>
            )}
            {c.retard && <span className="auj-retard">{texteRetard(c.joursRetard)}</span>}
          </span>
        )}
      </div>
      {c.peser ? (
        <button
          type="button"
          aria-label={c.action}
          className="auj-action auj-action-peser"
          disabled={inactive}
          onClick={() => {
            surPeser(c.cle);
          }}
        >
          <IconePanier />
          Peser
        </button>
      ) : (
        <button
          type="button"
          aria-label={c.action}
          className="auj-action auj-action-fait"
          disabled={inactive}
          onClick={() => {
            surFait(c.cle);
          }}
        >
          <IconeCoche taille={28} />
          Fait
        </button>
      )}
    </li>
  );
}

// ── Historique ───────────────────────────────────────────────────────────────────────────────

interface ProprietesHistorique {
  readonly id: string;
  readonly entrees: readonly EntreeHistorique[];
  /**
   * T13d : saisies de l'instantané, montrées tant que la journée relue n'est pas là (`entrees`
   * vide) ; leurs boutons attendent la journée relue (rien n'est écrit depuis l'instantané).
   */
  readonly instantane: { readonly vues: readonly SaisieVue[]; readonly total: number } | null;
  /**
   * Saisie qui doit recevoir le focus (T13c, après « Changer la date ») : sa correction, une fois
   * la journée relue. Absente de l'historique, le focus va au titre de l'historique.
   */
  readonly focus: string | null;
  /** Le focus a été placé : il ne sera plus jamais repris (une seule fois, T13c). */
  readonly surFocusPlace: () => void;
  readonly aujourdhui: string;
  readonly surAnnuler: (e: EntreeHistorique) => void;
  readonly surChangerDate: (e: EntreeHistorique) => void;
}

function Historique({ id, entrees, instantane, focus, surFocusPlace, aujourdhui, surAnnuler, surChangerDate }: ProprietesHistorique) {
  const idTitre = useId();
  const [tout, setTout] = useState(false);
  // Dessinées en tâche de fond (interruptible) : l'historique, en bas de l'écran, ne retarde ni
  // l'affichage des tâches ni un tap sur un autre onglet.
  const differees = useDeferredValue(entrees, AUCUNE_SAISIE);
  const vuesInstantane = useDeferredValue(instantane?.vues ?? AUCUNE_VUE, AUCUNE_VUE);
  const montrees = useMemo(() => (tout ? differees : differees.slice(0, SAISIES_HISTORIQUE)), [tout, differees]);
  const lignes = useMemo(
    () =>
      instantane !== null
        ? vuesInstantane.map((vue) => ({ vue, entree: null }))
        : vuesHistorique(montrees, aujourdhui).map((vue, i) => ({ vue, entree: montrees[i] ?? null })),
    [instantane, vuesInstantane, montrees, aujourdhui],
  );
  const total = instantane?.total ?? entrees.length;
  const autres = (instantane !== null ? instantane.total : differees.length) - lignes.length;
  const section = useRef<HTMLElement>(null);
  const titre = useRef<HTMLHeadingElement>(null);
  // Focus placé UNE fois, à la première journée relue après la correction, puis oublié
  // (`surFocusPlace`) : une relecture suivante (synchro) ne le reprend jamais, la page ne saute
  // pas sous le pouce.
  useEffect(() => {
    if (focus === null) return;
    const s = section.current;
    if (s === null) return;
    const actif = document.activeElement;
    // Le focus est déjà ailleurs, hors de l'historique (autre geste) : on le laisse.
    if (actif !== null && actif !== document.body && !s.contains(actif)) {
      surFocusPlace();
      return;
    }
    const entree = [...s.querySelectorAll<HTMLElement>('[data-testid="saisie-historique"]')].find((li) => li.dataset.evenement === focus);
    if (entree === undefined && differees !== entrees && entrees.some((h) => h.evenement.id === focus)) return; // pas encore dessinée
    if (entree?.contains(actif) !== true) (entree?.querySelector<HTMLElement>('button') ?? titre.current)?.focus();
    surFocusPlace();
  }, [focus, entrees, differees, lignes, surFocusPlace]);
  return (
    <section ref={section} id={id} aria-labelledby={idTitre} className="auj-historique">
      <div className="auj-historique-tete">
        <h2 ref={titre} id={idTitre} tabIndex={-1} className="auj-groupe">
          Historique
        </h2>
        <span className="auj-historique-compte">
          {total} {total > 1 ? 'saisies' : 'saisie'} · 7 jours
        </span>
      </div>
      {total === 0 ? (
        <p className="auj-historique-vide">Aucune saisie ces 7 derniers jours.</p>
      ) : (
        <ul>
          {lignes.map(({ vue: v, entree: h }) => (
            <li key={v.id} data-testid="saisie-historique" data-evenement={v.id} data-type={v.type} className="auj-entree">
              <div className="auj-entree-texte">
                <span className="auj-entree-quoi">{v.quoi}</span>
                <span className="auj-entree-culture">{v.culture}</span>
                <span className="auj-entree-quand">{v.quand}</span>
              </div>
              {v.retiree ? (
                <p className="auj-entree-retiree">{TEXTE_CULTURE_RETIREE}</p>
              ) : (
                <div className="auj-entree-actions">
                  <button
                    type="button"
                    aria-label={`Changer la date : ${v.nom}`}
                    className="auj-bouton-secondaire"
                    disabled={h === null}
                    onClick={() => {
                      if (h !== null) surChangerDate(h);
                    }}
                  >
                    Changer la date
                  </button>
                  <button
                    type="button"
                    aria-label={`Annuler : ${v.nom}`}
                    className="auj-bouton-secondaire"
                    disabled={h === null}
                    onClick={() => {
                      if (h !== null) surAnnuler(h);
                    }}
                  >
                    Annuler
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {autres > 0 && (
        <button
          type="button"
          className="auj-bouton-secondaire"
          onClick={() => {
            setTout(true);
          }}
        >
          Voir les {autres} autres saisies
        </button>
      )}
    </section>
  );
}

// ── Changer la date ──────────────────────────────────────────────────────────────────────────

interface ProprietesChangerDate {
  readonly entree: EntreeHistorique;
  readonly aujourdhui: string;
  readonly surEnregistrer: (date: string) => void;
  readonly surFermer: () => void;
}

function ChangerDate({ entree, aujourdhui, surEnregistrer, surFermer }: ProprietesChangerDate) {
  const [date, setDate] = useState(entree.evenement.date);
  const idChamp = useId();
  const champ = useRef<HTMLInputElement>(null);
  const garderFocus = useFocusDuDialogue();
  useEffect(() => {
    champ.current?.focus();
  }, []);
  const valide = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= aujourdhui;
  return (
    <div
      className="auj-voile"
      onKeyDown={(e) => {
        if (e.key === 'Escape') surFermer();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Changer la date" className="auj-feuille" onKeyDown={garderFocus}>
        <h2 className="auj-feuille-titre">Changer la date</h2>
        <p className="auj-feuille-texte">
          {libelleEvenement(entree.evenement)} · {entree.culture === null ? 'culture retirée' : nomCulture(entree.culture)}
        </p>
        <label htmlFor={idChamp} className="auj-champ-libelle">
          Date
        </label>
        <input
          ref={champ}
          id={idChamp}
          type="date"
          className="auj-champ"
          value={date}
          max={aujourdhui}
          onChange={(e) => {
            setDate(e.target.value);
          }}
        />
        <button
          type="button"
          className="auj-bouton-principal"
          disabled={!valide}
          onClick={() => {
            if (!valide) return;
            if (date === entree.evenement.date) surFermer();
            else surEnregistrer(date);
          }}
        >
          Enregistrer
        </button>
        <button type="button" className="auj-bouton-secondaire" onClick={surFermer}>
          Retour
        </button>
      </div>
    </div>
  );
}

// ── Écran ────────────────────────────────────────────────────────────────────────────────────

/** Événement tel qu'il vient d'être écrit (pour « Annuler » sans relire la base). */
function evenementEcrit(id: string, culture: Culture, date: string, detail: EvenementLu['detail']): EvenementLu {
  return {
    id,
    date,
    horodatage: new Date().toISOString(),
    serieId: culture.cible.sorte === 'serie' ? culture.cible.serieId : null,
    campagneId: culture.cible.sorte === 'campagne' ? culture.cible.campagneId : null,
    remplaceSorte: null,
    remplaceEvenementId: null,
    detail,
  };
}

/*
 * Tâche masquée (cache.ts) : écriture en cours, ou journée affichée qui n'a pas relu la culture
 * depuis la fin de l'écriture (elle n'a pas pu voir le réalisé, T13e, T13f). T13c : une journée
 * qui l'a relue lève le masque ; une tâche revenue (réalisé annulé depuis un autre téléphone) se
 * marque faite de nouveau. Sur l'instantané (aucune journée lue), le masque tient. Les masques
 * vivent dans le cache, pas dans l'écran : ils tiennent à un changement d'onglet (T13f).
 */

/** Ce que l'écran dessine de la journée relue (tâches masquées retirées) : c'est aussi l'instantané gardé. */
function vueDeJournee(journee: Journee, masquees: Masques, toutVoir: boolean): VueJournee {
  const taches = journee.taches.filter((t) => !estMasqueeDans(masquees, journee, t.cle));
  const enRetard = taches.filter((t) => t.tache.enRetard);
  const semaine = taches.filter((t) => !t.tache.enRetard);
  const groupe = (liste: readonly TacheJour[]) => (toutVoir ? liste : liste.slice(0, TACHES_PAR_GROUPE));
  return {
    semaine: journee.semaine,
    taches: [...groupe(enRetard), ...groupe(semaine)].map((t) => vueCarte(t, journee.aujourdhui)),
    retard: enRetard.length,
    cetteSemaine: semaine.length,
    recoltes: journee.recoltesEnCours.length,
    // Charge de la semaine (T22) : le cœur additionne les temps estimés des tâches affichées.
    charge: chargeSemaine(taches.map((t) => t.tache)),
    historique: vuesHistorique(journee.historique.slice(0, SAISIES_HISTORIQUE), journee.aujourdhui),
    saisies: journee.historique.length,
  };
}

/** L'instantané, moins les tâches marquées faites depuis son affichage. */
function vueDeInstantane(instantane: VueJournee, masquees: Masques): VueJournee {
  if (masquees.size === 0) return instantane;
  const faites = instantane.taches.filter((c) => estMasqueeDans(masquees, null, c.cle));
  if (faites.length === 0) return instantane;
  return {
    ...instantane,
    taches: instantane.taches.filter((c) => !faites.includes(c)),
    retard: Math.max(0, instantane.retard - faites.filter((c) => c.retard).length),
    cetteSemaine: Math.max(0, instantane.cetteSemaine - faites.filter((c) => !c.retard).length),
    charge: Math.max(0, instantane.charge - faites.reduce((n, c) => n + (c.travail ? (c.minutes ?? 0) : 0), 0)),
  };
}

/** Délai avant de garder l'instantané d'une journée relue : les relectures en rafale n'en gardent qu'un. */
const DELAI_INSTANTANE_MS = 300;

const AUCUN_MASQUE: Masques = new Map();
const sansMasques = () => () => undefined;

/** Ce qu'on dit tant que la base s'ouvre et qu'aucun instantané n'est à montrer. */
function Ouverture() {
  return (
    <div data-testid="aujourdhui" className="auj">
      <p className="attente">Ouverture des données de ce téléphone…</p>
    </div>
  );
}

/**
 * T13g : l'écran sur la ferme ouverte ; tant que la base s'ouvre (`porte` null), sur la dernière
 * ferme choisie par cet utilisateur sur ce téléphone (sans elle, rien n'est montré). Un écran par
 * utilisateur et par ferme (`key`) : ni masques ni instantané ne passent de l'une à l'autre.
 */
export function EcranAujourdhui(p: ProprietesEcranAujourdhui) {
  const { porte, utilisateurId } = p;
  // T13d : où l'instantané est gardé ; sans utilisateur, aucun instantané n'est lu ni gardé.
  const [stockageDonne] = useState(() => p.stockage ?? stockageParDefaut());
  const stockage = utilisateurId === undefined ? null : stockageDonne;
  const fermeId = porte !== null ? p.fermeId : utilisateurId === undefined || stockage === null ? null : lireFermeMemorisee(stockage, utilisateurId);
  if (fermeId === null) return <Ouverture />;
  return <Ecran key={`${utilisateurId ?? ''}|${fermeId}`} {...p} porte={porte} fermeId={fermeId} stockage={stockage} />;
}

interface ProprietesEcran extends Omit<ProprietesEcranAujourdhui, 'fermeId' | 'stockage'> {
  readonly fermeId: string;
  readonly stockage: StockageInstantane | null;
}

function Ecran({ porte, fermeId, aujourdhui: jourDonne, utilisateurId, stockage }: ProprietesEcran) {
  /** Jour du téléphone maintenant (relu à chaque écriture : l'écran peut rester ouvert à minuit). */
  const jourCourant = () => (jourDonne ?? jourDuTelephone)();
  const [jour, setJour] = useState(jourCourant);
  const [lue, setLue] = useState<Journee | null>(() => (porte === null ? null : journeeEnCache(porte, fermeId, jour)));
  // Journée du jour affiché : celle lue, sinon celle du cache (changement de jour). Base pas
  // encore ouverte (T13g) : aucune.
  const journee = porte === null ? null : lue !== null && lue.aujourdhui === jour ? lue : journeeEnCache(porte, fermeId, jour);
  // T13d : l'instantané, lu au premier rendu (synchrone).
  const [instantane] = useState(() => (utilisateurId === undefined || stockage === null ? null : lireInstantane(stockage, { utilisateurId, fermeId, jour })));
  /** L'instantané n'est montré que tant qu'aucune journée relue n'est là, et pour le jour affiché. */
  const surInstantane = journee === null && instantane !== null && instantane.jour === jour;
  const [echecLecture, setEchecLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  /** T13d : « Fait » touché sur l'instantané et rien écrit (tâche faite ailleurs, ou changée) : dit pourquoi. */
  const [avis, setAvis] = useState<string | null>(null);
  const [annulable, setAnnulable] = useState<Annulable | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [toutVoir, setToutVoir] = useState(false);
  /**
   * Tâches marquées faites et masquées dès le tap (un second tap n'écrit rien) : 'attente'
   * pendant l'écriture, puis le numéro pris à la fin de l'écriture. Gardées dans le cache, par
   * porte et ferme (T13f).
   */
  const masquees: Masques = useSyncExternalStore(
    useCallback((rappel: () => void) => (porte === null ? sansMasques() : suivreMasques(porte, fermeId, rappel)), [porte, fermeId]),
    () => (porte === null ? AUCUN_MASQUE : masquesDe(porte, fermeId)),
  );
  const estMasquee = (cle: string): boolean => estMasqueeDans(masquees, journee, cle);
  const journeeActuelle = useRef<Journee | null>(journee);
  useEffect(() => {
    journeeActuelle.current = journee;
  }, [journee]);
  /**
   * T13c : saisie à qui rendre le focus après « Changer la date » (sa correction), et la journée
   * affichée au moment de l'écriture : le focus attend une journée relue.
   */
  const [focusSaisie, setFocusSaisie] = useState<{ readonly evenementId: string; readonly avant: Journee | null } | null>(null);
  const oublierFocus = useCallback(() => {
    setFocusSaisie(null);
  }, []);
  /** Une écriture à la fois : un double appui n'écrit pas deux fois. */
  const occupe = useRef(false);
  const numero = useRef(0);
  const idHistorique = useId();

  useEffect(
    () =>
      porte === null
        ? undefined
        : suivreJournee(porte, fermeId, jour, setLue, (e: unknown) => {
            console.error('Journée illisible', e);
            setEchecLecture(true);
          }),
    [porte, fermeId, jour],
  );

  // Retour au premier plan (téléphone rallumé le lendemain) : l'écran passe au jour courant.
  useEffect(() => {
    const surVisibilite = () => {
      if (document.visibilityState === 'visible') setJour((jourDonne ?? jourDuTelephone)());
    };
    document.addEventListener('visibilitychange', surVisibilite);
    return () => {
      document.removeEventListener('visibilitychange', surVisibilite);
    };
  }, [jourDonne]);

  // Premier dessin : les CARTES_PREMIER_DESSIN premières cartes ; toutes au rendu suivant, différé.
  // T13g : avant la base, seulement elles, sans l'historique : un écran de téléphone, et la page
  // laisse la main à l'ouverture de la base ; le reste suit, différé, la base ouverte.
  const complet = useDeferredValue(porte !== null, false);

  // Une marque par ouverture de l'écran, quand les tâches (ou « rien à faire ») sont dessinées,
  // celles de l'instantané comprises (T13d).
  const dessinee = journee !== null || surInstantane;
  const marquee = useRef(false);
  useEffect(() => {
    if (!dessinee || marquee.current) return;
    marquee.current = true;
    performance.mark(MARQUE_AUJOURDHUI_AFFICHE);
  }, [dessinee]);

  // T13d : chaque journée relue affichée devient l'instantané du prochain lancement (ce qui est
  // dessiné, tâches marquées faites retirées), un peu plus tard : rien ne retarde l'affichage.
  useEffect(() => {
    if (journee === null || utilisateurId === undefined || stockage === null) return undefined;
    const minuterie = setTimeout(() => {
      garderInstantane(stockage, { utilisateurId, fermeId, jour: journee.aujourdhui }, vueDeJournee(journee, masquees, false));
    }, DELAI_INSTANTANE_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [journee, masquees, utilisateurId, fermeId, stockage]);

  // « Annuler » : 10 s après la saisie, puis l'historique.
  useEffect(() => {
    if (annulable === null) return undefined;
    const minuterie = setTimeout(() => {
      setAnnulable((a) => (a?.numero === annulable.numero ? null : a));
    }, DELAI_ANNULATION_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [annulable]);

  /** Contexte d'une écriture, au jour du téléphone à l'instant de l'écriture. */
  const contexte = (): ContexteEcriture => {
    // Aucun bouton d'écriture n'est actif sans la base (T13g) : filet seulement.
    if (porte === null) throw new Error('les données de ce téléphone sont encore en cours d’ouverture');
    return { porte, fermeId, aujourdhui: jourCourant() };
  };

  const ecrire = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (occupe.current) return false;
    occupe.current = true;
    setErreur(null);
    setAvis(null);
    setFocusSaisie(null);
    try {
      await action();
      return true;
    } catch (e) {
      console.error('Saisie impossible', e);
      setErreur(`La saisie n’a pas pu s’enregistrer sur ce téléphone${e instanceof Error && e.message !== '' ? ` : ${e.message}` : ''}. Réessayez ; si cela recommence, signalez-le.`);
      return false;
    } finally {
      occupe.current = false;
    }
  }, []);

  function montrerAnnulable(evenement: EvenementLu, culture: Culture, titre: string, texte: string): void {
    numero.current++;
    setAnnulable({ evenement, culture, titre, texte, numero: numero.current });
  }

  /** Pose ou retire le masque de `cle` (dans le cache : l'écran peut être quitté entre temps). */
  function masquer(cle: string, valeur: number | 'attente' | undefined): void {
    if (porte === null) return;
    changerMasques(porte, fermeId, journeeActuelle.current, (m) => {
      if (valeur === undefined) m.delete(cle);
      else m.set(cle, valeur);
    });
  }

  /**
   * Écrit le « Fait » de la tâche `t` (étape ou travail prévu, T22) et montre le bandeau. T13h :
   * déjà noté (autre onglet, autre source, pas encore relu ici) → rien d'écrit, la tâche reste
   * masquée, un avis le dit, sans bandeau « Annuler » ni erreur.
   */
  async function ecrireFait(t: TacheJour): Promise<void> {
    try {
      await ecrireFaitSansAvis(t);
    } catch (e) {
      if (!(e instanceof DejaFait)) throw e;
      setAvis('Déjà notée : rien de plus n’est enregistré.');
    }
  }

  async function ecrireFaitSansAvis(t: TacheJour): Promise<void> {
    const tache = t.tache;
    const ctx = contexte();
    if (tache.etape === 'travail') {
      const travail = tache.travail;
      const id = await marquerTravailFait(ctx, t.culture, travail, tache.datePrevue);
      const detail = { type: 'intervention' as const, categorie: travail.categorie, libelle: travail.type };
      montrerAnnulable(evenementEcrit(id, t.culture, ctx.aujourdhui, detail), t.culture, `Fait · ${capitale(travail.type)}`, nomCulture(t.culture));
      return;
    }
    if (tache.etape === 'debut_recolte') return;
    const etape = tache.etape;
    const id = await marquerFait(ctx, t.culture, etape);
    const detail = { type: 'realise' as const, etape: etape satisfies EtapeRealisee, quantiteReelle: null };
    montrerAnnulable(evenementEcrit(id, t.culture, ctx.aujourdhui, detail), t.culture, `Fait · ${ETAPES_FAITES[etape]}`, nomCulture(t.culture));
  }

  /**
   * « Fait » : la tâche est masquée dès le tap. Sur la journée relue, la saisie s'écrit tout de
   * suite. Sur l'instantané (T13d), rien n'est écrit depuis lui : une lecture ciblée de la tâche
   * dans la base (`lireTacheCiblee`) donne ce qu'écrirait la journée relue (emplacements relus,
   * B2) ; si la tâche n'y est plus (faite ailleurs entre temps), rien n'est écrit.
   */
  function surFait(cle: string): void {
    if (porte === null || estMasquee(cle) || occupe.current) return;
    let tache: () => Promise<TacheJour | null>;
    /** Lecture ciblée : la tâche a changé, la carte revient (pas de masque). */
    let changee = false;
    if (journee !== null) {
      const t = journee.taches.find((x) => x.cle === cle);
      if (t === undefined || t.tache.etape === 'debut_recolte') return;
      tache = () => Promise.resolve(t);
    } else {
      const carte = surInstantane ? instantane.taches.find((c) => c.cle === cle) : undefined;
      if (carte === undefined || carte.peser) return;
      const affichee = carte.action;
      tache = async () => {
        const t = await lireTacheCiblee(porte, fermeId, jourCourant(), cle);
        if (t === null) {
          setAvis('Déjà notée depuis un autre téléphone : rien de plus n’est enregistré.');
          return null;
        }
        // La base ne décrit plus la tâche comme la carte touchée (itinéraire changé depuis le
        // bureau) : rien n'est écrit, la carte revient telle que la base la décrit.
        if (vueCarte(t, jour).action !== affichee) {
          setAvis('Cette tâche a changé depuis le bureau : rien n’est enregistré, vérifiez-la puis touchez « Fait » de nouveau.');
          changee = true;
          return null;
        }
        return t;
      };
    }
    masquer(cle, 'attente');
    void ecrire(async () => {
      const t = await tache();
      if (t !== null) await ecrireFait(t);
    }).then((ok) => {
      masquer(cle, ok && !changee ? marquerEcriture() : undefined);
    });
  }

  function surValiderRecolte(culture: Culture, quantite: number, unite: UniteRecolte): void {
    void ecrire(async () => {
      const ctx = contexte();
      const id = await noterRecolte(ctx, culture, quantite, unite);
      setDialogue(null);
      const detail = { type: 'recolte' as const, quantite, unite, categorie: null };
      montrerAnnulable(evenementEcrit(id, culture, ctx.aujourdhui, detail), culture, 'Récolte notée', `${nomCulture(culture)} · ${quantiteAvecUnite(quantite, unite)}`);
    });
  }

  function annuler(evenement: EvenementLu): void {
    void ecrire(async () => {
      await annulerSaisie(contexte(), evenement);
      setAnnulable((a) => (a?.evenement.id === evenement.id ? null : a));
      // Aucun masque n'est retiré (T13f) : l'annulation provoque une relecture de sa culture, plus
      // récente que les masques, qui fait revenir la tâche annulée ; les autres tâches masquées
      // tiennent tant que leur culture n'a pas été relue.
    });
  }

  function surChangerDate(entree: EntreeHistorique, date: string): void {
    const avant = journeeActuelle.current;
    void ecrire(async () => {
      const id = await changerDate(contexte(), entree.evenement, date);
      // La saisie d'origine quitte l'historique à la relecture : le focus ira à sa correction.
      setFocusSaisie({ evenementId: id, avant });
      setDialogue(null);
    });
  }

  // T13g : base pas encore ouverte, rien à montrer de cette ferme.
  if (porte === null && !surInstantane) return <Ouverture />;

  if (echecLecture && journee === null) {
    return (
      <div data-testid="aujourdhui" className="auj">
        <p role="alert" className="attente">
          Les tâches n’ont pas pu se lire sur ce téléphone. Rechargez l’appli ; si cela recommence, signalez-le.
        </p>
      </div>
    );
  }

  // Ce qui est dessiné : la journée relue, sinon l'instantané (T13d), sinon rien encore.
  const vue = journee !== null ? vueDeJournee(journee, masquees, toutVoir) : surInstantane ? vueDeInstantane(instantane, masquees) : null;
  const toutes = vue?.taches ?? [];
  const dessinees = complet ? toutes : toutes.slice(0, CARTES_PREMIER_DESSIN);
  const enRetard = dessinees.filter((c) => c.retard);
  const semaine = dessinees.filter((c) => !c.retard);
  const cachees = vue === null || !complet || (toutVoir && journee !== null) ? 0 : vue.retard - enRetard.length + (vue.cetteSemaine - semaine.length);
  const peser = (cle: string) => {
    const t = journee?.taches.find((x) => x.cle === cle);
    setDialogue({ sorte: 'recolte', culture: t?.culture ?? null, cle: t === undefined ? cle : null });
  };
  // Récolte ouverte depuis une carte de l'instantané : sa culture vient de la journée relue.
  const cultureDialogue =
    dialogue?.sorte !== 'recolte' ? null : (dialogue.culture ?? (dialogue.cle === null ? null : (journee?.taches.find((t) => t.cle === dialogue.cle)?.culture ?? null)));

  return (
    <div data-testid="aujourdhui" className={annulable === null ? 'auj' : 'auj auj-avec-bandeau'}>
      {vue !== null && (
        <div className="auj-resume">
          <span className="auj-semaine">Semaine {vue.semaine}</span>
          {vue.retard > 0 && <span className="auj-pastille auj-pastille-urgente">{vue.retard} en retard</span>}
          <span className="auj-pastille">{vue.cetteSemaine} cette semaine</span>
          <span className="auj-pastille">
            {vue.recoltes} {vue.recoltes > 1 ? 'récoltes' : 'récolte'} en cours
          </span>
          {vue.charge > 0 && (
            <span className="auj-pastille auj-pastille-charge">
              <IconeHorloge />
              <span data-testid="charge-semaine">{texteCharge(vue.charge)}</span>
            </span>
          )}
        </div>
      )}

      <div className="auj-actions">
        <button
          type="button"
          className="auj-bouton-principal auj-noter"
          onClick={() => {
            setDialogue({ sorte: 'recolte', culture: null, cle: null });
          }}
        >
          <IconePanier />
          Noter une récolte
        </button>
        {/* L'historique est en bas de l'écran : ce bouton y mène d'un geste. */}
        <button
          type="button"
          aria-label="Historique"
          className="auj-vers-historique"
          onClick={() => {
            document.getElementById(idHistorique)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5M12 7v5l3 2" />
          </svg>
          Historique
        </button>
      </div>

      {erreur !== null && (
        <p role="alert" className="auj-erreur">
          {erreur}
        </p>
      )}
      {avis !== null && (
        <p role="status" className="auj-avis">
          {avis}
        </p>
      )}

      {vue === null ? (
        <p className="auj-chargement">Lecture des tâches…</p>
      ) : vue.retard + vue.cetteSemaine === 0 ? (
        <p className="auj-vide">Rien de prévu cette semaine. Les semis, plantations et récoltes du plan s’afficheront ici.</p>
      ) : (
        <>
          {enRetard.length > 0 && (
            <>
              <h2 className="auj-groupe auj-groupe-retard">En retard</h2>
              <ul className="auj-taches">
                {enRetard.map((c) => (
                  <CarteTache key={c.cle} carte={c} inactive={porte === null} surFait={surFait} surPeser={peser} />
                ))}
              </ul>
            </>
          )}
          {semaine.length > 0 && (
            <>
              <h2 className="auj-groupe">Cette semaine</h2>
              <ul className="auj-taches">
                {semaine.map((c) => (
                  <CarteTache key={c.cle} carte={c} inactive={porte === null} surFait={surFait} surPeser={peser} />
                ))}
              </ul>
            </>
          )}
          {cachees > 0 && (
            <button
              type="button"
              className="auj-bouton-secondaire"
              onClick={() => {
                setToutVoir(true);
              }}
            >
              Voir les {cachees} autres tâches
            </button>
          )}
        </>
      )}

      {vue !== null && complet && (
        <Historique
          id={idHistorique}
          entrees={journee?.historique ?? AUCUNE_SAISIE}
          instantane={journee === null && surInstantane ? { vues: instantane.historique, total: instantane.saisies } : null}
          focus={focusSaisie !== null && focusSaisie.avant !== journee ? focusSaisie.evenementId : null}
          surFocusPlace={oublierFocus}
          aujourdhui={jour}
          surAnnuler={(h) => {
            annuler(h.evenement);
          }}
          surChangerDate={(h) => {
            setFocusSaisie(null);
            setDialogue({ sorte: 'date', entree: h, max: jourCourant() });
          }}
        />
      )}

      {annulable !== null && (
        <div key={annulable.numero} data-testid="saisie-annulable" role="status" className="auj-bandeau">
          <span className="auj-bandeau-icone">
            <IconeCoche taille={24} />
          </span>
          <span className="auj-bandeau-texte">
            <strong>{annulable.titre}</strong>
            <span>{annulable.texte}</span>
          </span>
          <button
            type="button"
            className="auj-bandeau-annuler"
            onClick={() => {
              annuler(annulable.evenement);
            }}
          >
            Annuler
          </button>
          <span aria-hidden="true" className="auj-bandeau-temps" />
        </div>
      )}

      {dialogue?.sorte === 'recolte' && (
        <Recolte
          key={journee === null ? 'attente' : 'lue'}
          culture={cultureDialogue}
          recoltesEnCours={journee?.recoltesEnCours ?? []}
          enAttente={journee === null}
          dernieres={journee?.dernieresRecoltes ?? new Map()}
          erreur={erreur}
          surValider={surValiderRecolte}
          surFermer={() => {
            setDialogue(null);
          }}
        />
      )}
      {dialogue?.sorte === 'date' && (
        <ChangerDate
          entree={dialogue.entree}
          aujourdhui={dialogue.max}
          surEnregistrer={(date) => {
            surChangerDate(dialogue.entree, date);
          }}
          surFermer={() => {
            setDialogue(null);
          }}
        />
      )}
    </div>
  );
}
