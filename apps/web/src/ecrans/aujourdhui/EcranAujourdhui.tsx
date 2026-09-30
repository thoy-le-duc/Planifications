/**
 * Écran « Aujourd'hui » (T13, maquettes Main et Saisie) : le semainier de la semaine, en retard
 * d'abord ; « Fait » en un geste ; une récolte en trois gestes ; « Annuler » 10 s, puis depuis
 * l'historique. Contrat : ./test/contrat.ts (section « Écran (DOM) »).
 *
 * Chargé à la demande par App ; reçoit la porte (jamais PowerSync). Tout marche hors ligne : les
 * saisies vont dans la base du téléphone et partent avec la synchro. L'écran suit la base : une
 * saisie arrivée d'un autre téléphone s'y voit.
 */
import { useCallback, useDeferredValue, useEffect, useId, useRef, useState } from 'react';
import { chargeSemaine, type EtapeRealisee, type TacheTravail, type UniteRecolte } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import './aujourdhui.css';
import { journeeEnCache, suivreJournee } from './cache.ts';
import {
  capitale,
  codesEmplacements,
  dateCourte,
  ETAPES_FAITES,
  LIBELLES_CATEGORIES,
  nombreFrancais,
  nomCulture,
  quand,
  quantiteAvecUnite,
  texteCharge,
  texteDuree,
  VERBES,
  type Culture,
  type EntreeHistorique,
  type EvenementLu,
  type Journee,
  type TacheJour,
} from './calculs.ts';
import { useFocusDuDialogue } from './dialogue.ts';
import { annulerSaisie, changerDate, marquerFait, marquerTravailFait, noterRecolte, type ContexteEcriture } from './ecritures.ts';
import { IconeCoche, IconePanier, Recolte } from './Recolte.tsx';

export interface ProprietesEcranAujourdhui {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Jour du téléphone, 'AAAA-MM-JJ' ; par défaut celui de l'horloge du téléphone. */
  readonly aujourdhui?: () => string;
}

/** Marque de performance posée quand les tâches (ou « rien à faire ») sont dessinées. */
export const MARQUE_AUJOURDHUI_AFFICHE = 'planif:aujourdhui-affiche';

/**
 * Tâches dessinées par groupe avant « Voir les autres » : l'écran s'affiche vite même quand des
 * séries anciennes, jamais marquées faites, traînent en retard par centaines.
 */
const TACHES_PAR_GROUPE = 25;

/** Saisies de l'historique dessinées avant « Voir les autres » (une grosse journée de récolte). */
const SAISIES_HISTORIQUE = 20;
const AUCUNE_SAISIE: readonly EntreeHistorique[] = [];

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
  | { readonly sorte: 'recolte'; readonly culture: Culture | null }
  | { readonly sorte: 'date'; readonly entree: EntreeHistorique; readonly max: string }
  | null;

/** Libellé de l'étape faite, pour le bandeau et l'historique. */
function libelleEvenement(e: EvenementLu): string {
  const d = e.detail;
  switch (d.type) {
    case 'realise':
      return ETAPES_FAITES[d.etape];
    case 'recolte':
      return `Récolte · ${quantiteAvecUnite(d.quantite, d.unite)}`;
    case 'intervention':
      return capitale(d.libelle);
  }
}

/** Ce que nomme une saisie : « Récolte 12 kg, Tomate Cœur de bœuf, aujourd'hui ». */
function nomSaisie(h: EntreeHistorique, aujourdhui: string): string {
  const e = h.evenement;
  const quoi = e.detail.type === 'recolte' ? `Récolte ${quantiteAvecUnite(e.detail.quantite, e.detail.unite)}` : libelleEvenement(e);
  return `${quoi}, ${h.culture === null ? 'culture retirée' : nomCulture(h.culture)}, ${quand(e.date, aujourdhui)}`;
}

function detailTache(t: TacheJour, aujourdhui: string): string {
  const { tache, culture } = t;
  const morceaux: string[] = [];
  if (tache.etape === 'travail') {
    // Un travail se lit par son libellé : la culture vient ensuite, avec le produit à épandre.
    morceaux.push(nomCulture(culture));
    const produit = tache.travail.produit;
    if (produit !== null) {
      const dose = `${nombreFrancais(produit.quantite.valeur)} ${produit.quantite.unite}`;
      morceaux.push(produit.nom.toLocaleLowerCase('fr') === tache.travail.type.toLocaleLowerCase('fr') ? dose : `${produit.nom} ${dose}`);
    }
  } else if (tache.variete !== null) morceaux.push(tache.variete);
  if (tache.taille.unite === 'longueur') morceaux.push(`${String(tache.taille.longueurM).replace('.', ',')} m`);
  else if (tache.taille.nombrePlants > 0) morceaux.push(`${String(tache.taille.nombrePlants)} plants`);
  morceaux.push(tache.enRetard ? `prévu le ${dateCourte(tache.datePrevue)}` : quand(tache.datePrevue, aujourdhui));
  return morceaux.join(' · ');
}

function texteRetard(jours: number): string {
  return jours === 1 ? '1 jour de retard' : `${String(jours)} jours de retard`;
}

// ── Carte de tâche (maquette Main) ───────────────────────────────────────────────────────────

interface ProprietesCarte {
  readonly tache: TacheJour;
  readonly aujourdhui: string;
  readonly surFait: (t: TacheJour) => void;
  readonly surPeser: (t: TacheJour) => void;
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

function CarteTache({ tache: t, aujourdhui, surFait, surPeser }: ProprietesCarte) {
  const { tache, culture } = t;
  const travail = tache.etape === 'travail' ? tache : null;
  const surtitre = tache.etape === 'travail' ? LIBELLES_CATEGORIES[tache.travail.categorie] : VERBES[tache.etape];
  const titre = travail === null ? culture.espece : capitale(travail.travail.type);
  const codes = codesEmplacements(tache.emplacements);
  const bande = tache.enRetard ? 'retard' : travail !== null ? 'travail' : (culture.famille ?? 'neutre');
  const recolte = tache.etape === 'debut_recolte';
  const phrase = travail === null ? `${surtitre.toLowerCase()} ${culture.espece.toLowerCase()}` : `${travail.travail.type} ${culture.espece.toLowerCase()}`;
  const temps = travail?.tempsEstimeMinutes ?? null;
  return (
    <li data-testid="tache" data-cle={t.cle} data-retard={tache.enRetard ? 'oui' : 'non'} className={travail === null ? 'auj-tache' : 'auj-tache auj-tache-travail'}>
      <span data-testid="bande-famille" aria-hidden="true" className={`auj-bande auj-bande-${bande}`} />
      <div className="auj-tache-corps">
        <span data-testid="surtitre" className="auj-tache-verbe">
          {surtitre}
        </span>
        <span className="auj-tache-titre">{titre}</span>
        <span className="auj-tache-detail">{detailTache(t, aujourdhui)}</span>
        {(codes !== null || tache.enRetard || temps !== null) && (
          <span className="auj-tache-pied">
            {codes !== null && <span className="auj-code">{codes}</span>}
            {temps !== null && (
              <span className="auj-temps">
                <IconeHorloge />
                <span data-testid="temps-estime">{texteDuree(temps)}</span>
              </span>
            )}
            {tache.enRetard && <span className="auj-retard">{texteRetard(tache.joursDeRetard)}</span>}
          </span>
        )}
      </div>
      {recolte ? (
        <button
          type="button"
          aria-label={`Saisir une récolte : ${culture.espece.toLowerCase()}`}
          className="auj-action auj-action-peser"
          onClick={() => {
            surPeser(t);
          }}
        >
          <IconePanier />
          Peser
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Marquer fait : ${phrase}`}
          className="auj-action auj-action-fait"
          onClick={() => {
            surFait(t);
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
  readonly aujourdhui: string;
  readonly surAnnuler: (e: EntreeHistorique) => void;
  readonly surChangerDate: (e: EntreeHistorique) => void;
}

function Historique({ id, entrees, aujourdhui, surAnnuler, surChangerDate }: ProprietesHistorique) {
  const idTitre = useId();
  const [tout, setTout] = useState(false);
  // Dessinées en tâche de fond (interruptible) : l'historique, en bas de l'écran, ne retarde ni
  // l'affichage des tâches ni un tap sur un autre onglet.
  const differees = useDeferredValue(entrees, AUCUNE_SAISIE);
  const montrees = tout ? differees : differees.slice(0, SAISIES_HISTORIQUE);
  return (
    <section id={id} aria-labelledby={idTitre} className="auj-historique">
      <div className="auj-historique-tete">
        <h2 id={idTitre} className="auj-groupe">
          Historique
        </h2>
        <span className="auj-historique-compte">
          {entrees.length} {entrees.length > 1 ? 'saisies' : 'saisie'} · 7 jours
        </span>
      </div>
      {entrees.length === 0 ? (
        <p className="auj-historique-vide">Aucune saisie ces 7 derniers jours.</p>
      ) : (
        <ul>
          {montrees.map((h, i) => {
            const e = h.evenement;
            const codes = h.culture === null ? null : codesEmplacements(h.culture.emplacements);
            // Deux saisies identiques le même jour : leurs boutons gardent des noms distincts.
            const base = nomSaisie(h, aujourdhui);
            const rang = montrees.slice(0, i).filter((x) => nomSaisie(x, aujourdhui) === base).length;
            const nom = rang === 0 ? base : `${base} (${String(rang + 1)})`;
            return (
              <li key={e.id} data-testid="saisie-historique" data-evenement={e.id} data-type={e.detail.type} className="auj-entree">
                <div className="auj-entree-texte">
                  <span className="auj-entree-quoi">{libelleEvenement(e)}</span>
                  <span className="auj-entree-culture">{h.culture === null ? 'Culture retirée' : nomCulture(h.culture)}</span>
                  <span className="auj-entree-quand">{[quand(e.date, aujourdhui), codes].filter((x) => x !== null).join(' · ')}</span>
                </div>
                {h.culture === null ? (
                  <p className="auj-entree-retiree">{TEXTE_CULTURE_RETIREE}</p>
                ) : (
                  <div className="auj-entree-actions">
                    <button
                      type="button"
                      aria-label={`Changer la date : ${nom}`}
                      className="auj-bouton-secondaire"
                      onClick={() => {
                        surChangerDate(h);
                      }}
                    >
                      Changer la date
                    </button>
                    <button
                      type="button"
                      aria-label={`Annuler : ${nom}`}
                      className="auj-bouton-secondaire"
                      onClick={() => {
                        surAnnuler(h);
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {montrees.length < differees.length && (
        <button
          type="button"
          className="auj-bouton-secondaire"
          onClick={() => {
            setTout(true);
          }}
        >
          Voir les {differees.length - montrees.length} autres saisies
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

export function EcranAujourdhui({ porte, fermeId, aujourdhui: jourDonne }: ProprietesEcranAujourdhui) {
  /** Jour du téléphone maintenant (relu à chaque écriture : l'écran peut rester ouvert à minuit). */
  const jourCourant = () => (jourDonne ?? jourDuTelephone)();
  const [jour, setJour] = useState(jourCourant);
  const [lue, setLue] = useState<Journee | null>(() => journeeEnCache(porte, fermeId, jour));
  // Journée du jour affiché : celle lue, sinon celle du cache (changement de jour).
  const journee = lue !== null && lue.aujourdhui === jour ? lue : journeeEnCache(porte, fermeId, jour);
  const [echecLecture, setEchecLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annulable, setAnnulable] = useState<Annulable | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [toutVoir, setToutVoir] = useState(false);
  /**
   * Tâches marquées faites et masquées dès le tap (un second tap n'écrit rien) : 'attente'
   * pendant l'écriture, puis la journée affichée à ce moment, jusqu'à ce qu'une journée relue
   * la remplace.
   */
  const [masquees, setMasquees] = useState<ReadonlyMap<string, Journee | null | 'attente'>>(new Map());
  const journeeActuelle = useRef<Journee | null>(journee);
  useEffect(() => {
    journeeActuelle.current = journee;
  }, [journee]);
  /** Une écriture à la fois : un double appui n'écrit pas deux fois. */
  const occupe = useRef(false);
  const numero = useRef(0);
  const idHistorique = useId();

  useEffect(
    () =>
      suivreJournee(porte, fermeId, jour, setLue, (e: unknown) => {
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

  // Une marque par ouverture de l'écran, quand les tâches (ou « rien à faire ») sont dessinées.
  const marquee = useRef(false);
  useEffect(() => {
    if (journee === null || marquee.current) return;
    marquee.current = true;
    performance.mark(MARQUE_AUJOURDHUI_AFFICHE);
  }, [journee]);

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
  const contexte = (): ContexteEcriture => ({ porte, fermeId, aujourdhui: jourCourant() });

  const ecrire = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (occupe.current) return false;
    occupe.current = true;
    setErreur(null);
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

  function masquer(cle: string, valeur: Journee | null | 'attente' | undefined): void {
    setMasquees((m) => {
      const n = new Map(m);
      if (valeur === undefined) n.delete(cle);
      else n.set(cle, valeur);
      return n;
    });
  }

  /** « Fait » sur un travail prévu (T22) : l'intervention du même type sur la série. */
  function surTravailFait(t: TacheJour, tache: TacheTravail): void {
    const travail = tache.travail;
    void ecrire(async () => {
      const ctx = contexte();
      const id = await marquerTravailFait(ctx, t.culture, travail, tache.datePrevue);
      const detail = { type: 'intervention' as const, categorie: travail.categorie, libelle: travail.type };
      montrerAnnulable(evenementEcrit(id, t.culture, ctx.aujourdhui, detail), t.culture, `Fait · ${capitale(travail.type)}`, nomCulture(t.culture));
    }).then((ok) => {
      masquer(t.cle, ok ? journeeActuelle.current : undefined);
    });
  }

  function surFait(t: TacheJour): void {
    const tache = t.tache;
    if (tache.etape === 'debut_recolte' || masquees.has(t.cle) || occupe.current) return;
    masquer(t.cle, 'attente');
    if (tache.etape === 'travail') {
      surTravailFait(t, tache);
      return;
    }
    const etape = tache.etape;
    void ecrire(async () => {
      const ctx = contexte();
      const id = await marquerFait(ctx, t.culture, etape);
      const detail = { type: 'realise' as const, etape: etape satisfies EtapeRealisee, quantiteReelle: null };
      montrerAnnulable(evenementEcrit(id, t.culture, ctx.aujourdhui, detail), t.culture, `Fait · ${ETAPES_FAITES[etape]}`, nomCulture(t.culture));
    }).then((ok) => {
      masquer(t.cle, ok ? journeeActuelle.current : undefined);
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
      // La tâche faite puis annulée redevient à faire : plus de masque.
      setMasquees(new Map());
    });
  }

  function surChangerDate(entree: EntreeHistorique, date: string): void {
    void ecrire(async () => {
      await changerDate(contexte(), entree.evenement, date);
      setDialogue(null);
    });
  }

  if (echecLecture && journee === null) {
    return (
      <div data-testid="aujourdhui" className="auj">
        <p role="alert" className="attente">
          Les tâches n’ont pas pu se lire sur ce téléphone. Rechargez l’appli ; si cela recommence, signalez-le.
        </p>
      </div>
    );
  }

  const taches = (journee?.taches ?? []).filter((t) => {
    const m = masquees.get(t.cle);
    return m === undefined || (m !== 'attente' && m !== journee);
  });
  const enRetard = taches.filter((t) => t.tache.enRetard);
  const semaine = taches.filter((t) => !t.tache.enRetard);
  const recoltes = journee?.recoltesEnCours ?? [];
  // Charge de la semaine (T22) : le cœur additionne les temps estimés des tâches affichées.
  const charge = chargeSemaine(taches.map((t) => t.tache));
  const peser = (x: TacheJour) => {
    setDialogue({ sorte: 'recolte', culture: x.culture });
  };
  const cachees = toutVoir ? 0 : Math.max(0, enRetard.length - TACHES_PAR_GROUPE) + Math.max(0, semaine.length - TACHES_PAR_GROUPE);
  const groupe = (liste: readonly TacheJour[]) => (toutVoir ? liste : liste.slice(0, TACHES_PAR_GROUPE));

  return (
    <div data-testid="aujourdhui" className={annulable === null ? 'auj' : 'auj auj-avec-bandeau'}>
      {journee !== null && (
        <div className="auj-resume">
          <span className="auj-semaine">Semaine {journee.semaine}</span>
          {enRetard.length > 0 && <span className="auj-pastille auj-pastille-urgente">{enRetard.length} en retard</span>}
          <span className="auj-pastille">{semaine.length} cette semaine</span>
          <span className="auj-pastille">
            {recoltes.length} {recoltes.length > 1 ? 'récoltes' : 'récolte'} en cours
          </span>
          {charge > 0 && (
            <span className="auj-pastille auj-pastille-charge">
              <IconeHorloge />
              <span data-testid="charge-semaine">{texteCharge(charge)}</span>
            </span>
          )}
        </div>
      )}

      <div className="auj-actions">
        <button
          type="button"
          className="auj-bouton-principal auj-noter"
          onClick={() => {
            setDialogue({ sorte: 'recolte', culture: null });
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

      {journee === null ? (
        <p className="auj-chargement">Lecture des tâches…</p>
      ) : taches.length === 0 ? (
        <p className="auj-vide">Rien de prévu cette semaine. Les semis, plantations et récoltes du plan s’afficheront ici.</p>
      ) : (
        <>
          {enRetard.length > 0 && (
            <>
              <h2 className="auj-groupe auj-groupe-retard">En retard</h2>
              <ul className="auj-taches">
                {groupe(enRetard).map((t) => (
                  <CarteTache key={t.cle} tache={t} aujourdhui={jour} surFait={surFait} surPeser={peser} />
                ))}
              </ul>
            </>
          )}
          {semaine.length > 0 && (
            <>
              <h2 className="auj-groupe">Cette semaine</h2>
              <ul className="auj-taches">
                {groupe(semaine).map((t) => (
                  <CarteTache key={t.cle} tache={t} aujourdhui={jour} surFait={surFait} surPeser={peser} />
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

      {journee !== null && (
        <Historique
          id={idHistorique}
          entrees={journee.historique}
          aujourdhui={jour}
          surAnnuler={(h) => {
            annuler(h.evenement);
          }}
          surChangerDate={(h) => {
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
          culture={dialogue.culture}
          recoltesEnCours={recoltes}
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
