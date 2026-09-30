/**
 * Écran « Aujourd'hui » (T13, maquettes Main et Saisie) : le semainier de la semaine, en retard
 * d'abord ; « Fait » en un geste ; une récolte en trois gestes ; « Annuler » 10 s, puis depuis
 * l'historique. Contrat : ./test/contrat.ts (section « Écran (DOM) »).
 *
 * Chargé à la demande par App ; reçoit la porte (jamais PowerSync). Tout marche hors ligne : les
 * saisies vont dans la base du téléphone et partent avec la synchro. L'écran suit la base : une
 * saisie arrivée d'un autre téléphone s'y voit.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { EtapeRealisee, UniteRecolte } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import './aujourdhui.css';
import { journeeEnCache, suivreJournee } from './cache.ts';
import {
  codesEmplacements,
  dateCourte,
  ETAPES_FAITES,
  nomCulture,
  quand,
  quantiteAvecUnite,
  VERBES,
  type Culture,
  type EntreeHistorique,
  type EvenementLu,
  type Journee,
  type TacheJour,
} from './calculs.ts';
import { annulerSaisie, changerDate, marquerFait, noterRecolte, type ContexteEcriture } from './ecritures.ts';
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

/** Durée d'affichage du bouton « Annuler » après une saisie. */
export const DELAI_ANNULATION_MS = 10_000;

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
  | { readonly sorte: 'date'; readonly entree: EntreeHistorique }
  | null;

/** Libellé de l'étape faite, pour le bandeau et l'historique. */
function libelleEvenement(e: EvenementLu): string {
  return e.detail.type === 'realise' ? ETAPES_FAITES[e.detail.etape] : `Récolte · ${quantiteAvecUnite(e.detail.quantite, e.detail.unite)}`;
}

function detailTache(t: TacheJour, aujourdhui: string): string {
  const { tache } = t;
  const morceaux: string[] = [];
  if (tache.variete !== null) morceaux.push(tache.variete);
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

function CarteTache({ tache: t, aujourdhui, surFait, surPeser }: ProprietesCarte) {
  const { tache, culture } = t;
  const verbe = VERBES[tache.etape];
  const codes = codesEmplacements(tache.emplacements);
  const bande = tache.enRetard ? 'retard' : (culture.famille ?? 'neutre');
  const recolte = tache.etape === 'debut_recolte';
  const phrase = `${verbe.toLowerCase()} ${culture.espece.toLowerCase()}`;
  return (
    <li data-testid="tache" data-cle={t.cle} data-retard={tache.enRetard ? 'oui' : 'non'} className="auj-tache">
      <span data-testid="bande-famille" aria-hidden="true" className={`auj-bande auj-bande-${bande}`} />
      <div className="auj-tache-corps">
        <span className="auj-tache-verbe">{verbe}</span>
        <span className="auj-tache-titre">{culture.espece}</span>
        <span className="auj-tache-detail">{detailTache(t, aujourdhui)}</span>
        {(codes !== null || tache.enRetard) && (
          <span className="auj-tache-pied">
            {codes !== null && <span className="auj-code">{codes}</span>}
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
  readonly entrees: readonly EntreeHistorique[];
  readonly aujourdhui: string;
  readonly surAnnuler: (e: EntreeHistorique) => void;
  readonly surChangerDate: (e: EntreeHistorique) => void;
}

function Historique({ entrees, aujourdhui, surAnnuler, surChangerDate }: ProprietesHistorique) {
  return (
    <section aria-label="Historique" className="auj-historique">
      {entrees.length === 0 ? (
        <p className="auj-historique-vide">Aucune saisie ces 7 derniers jours.</p>
      ) : (
        <ul>
          {entrees.map((h) => {
            const e = h.evenement;
            const codes = h.culture === null ? null : codesEmplacements(h.culture.emplacements);
            return (
              <li key={e.id} data-testid="saisie-historique" data-evenement={e.id} data-type={e.detail.type} className="auj-entree">
                <div className="auj-entree-texte">
                  <span className="auj-entree-quoi">{libelleEvenement(e)}</span>
                  <span className="auj-entree-culture">{h.culture === null ? 'Culture retirée' : nomCulture(h.culture)}</span>
                  <span className="auj-entree-quand">{[quand(e.date, aujourdhui), codes].filter((x) => x !== null).join(' · ')}</span>
                </div>
                <div className="auj-entree-actions">
                  <button
                    type="button"
                    className="auj-bouton-secondaire"
                    onClick={() => {
                      surChangerDate(h);
                    }}
                  >
                    Changer la date
                  </button>
                  <button
                    type="button"
                    className="auj-bouton-secondaire"
                    onClick={() => {
                      surAnnuler(h);
                    }}
                  >
                    Annuler
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
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
      <div role="dialog" aria-modal="true" aria-label="Changer la date" className="auj-feuille">
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
  const [jour] = useState(() => (jourDonne ?? jourDuTelephone)());
  const [journee, setJournee] = useState<Journee | null>(() => journeeEnCache(porte, fermeId, jour));
  const [echecLecture, setEchecLecture] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annulable, setAnnulable] = useState<Annulable | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const [toutVoir, setToutVoir] = useState(false);
  /** Une écriture à la fois : un double appui n'écrit pas deux fois. */
  const occupe = useRef(false);
  const numero = useRef(0);

  useEffect(
    () =>
      suivreJournee(porte, fermeId, jour, setJournee, (e: unknown) => {
        console.error('Journée illisible', e);
        setEchecLecture(true);
      }),
    [porte, fermeId, jour],
  );

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

  const ctx: ContexteEcriture = { porte, fermeId, aujourdhui: jour };

  const ecrire = useCallback(async (action: () => Promise<void>) => {
    if (occupe.current) return;
    occupe.current = true;
    setErreur(null);
    try {
      await action();
    } catch (e) {
      console.error('Saisie impossible', e);
      setErreur(`La saisie n’a pas pu s’enregistrer sur ce téléphone${e instanceof Error && e.message !== '' ? ` : ${e.message}` : ''}. Réessayez ; si cela recommence, signalez-le.`);
    } finally {
      occupe.current = false;
    }
  }, []);

  function montrerAnnulable(evenement: EvenementLu, culture: Culture, titre: string, texte: string): void {
    numero.current++;
    setAnnulable({ evenement, culture, titre, texte, numero: numero.current });
  }

  function surFait(t: TacheJour): void {
    const etape = t.tache.etape;
    if (etape === 'debut_recolte') return;
    void ecrire(async () => {
      const id = await marquerFait(ctx, t.culture, etape);
      const detail = { type: 'realise' as const, etape: etape satisfies EtapeRealisee, quantiteReelle: null };
      montrerAnnulable(evenementEcrit(id, t.culture, jour, detail), t.culture, `Fait · ${ETAPES_FAITES[etape]}`, nomCulture(t.culture));
    });
  }

  function surValiderRecolte(culture: Culture, quantite: number, unite: UniteRecolte): void {
    void ecrire(async () => {
      const id = await noterRecolte(ctx, culture, quantite, unite);
      setDialogue(null);
      const detail = { type: 'recolte' as const, quantite, unite, categorie: null };
      montrerAnnulable(evenementEcrit(id, culture, jour, detail), culture, 'Récolte notée', `${nomCulture(culture)} · ${quantiteAvecUnite(quantite, unite)}`);
    });
  }

  function annuler(evenement: EvenementLu, culture: Culture | null): void {
    void ecrire(async () => {
      await annulerSaisie(ctx, evenement, culture);
      setAnnulable((a) => (a?.evenement.id === evenement.id ? null : a));
    });
  }

  function surChangerDate(entree: EntreeHistorique, date: string): void {
    void ecrire(async () => {
      await changerDate(ctx, entree.evenement, date, entree.culture);
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

  const taches = journee?.taches ?? [];
  const enRetard = taches.filter((t) => t.tache.enRetard);
  const semaine = taches.filter((t) => !t.tache.enRetard);
  const recoltes = journee?.recoltesEnCours ?? [];
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
        </div>
      )}

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
        <>
          <button
            type="button"
            aria-label="Historique"
            aria-expanded={historiqueOuvert}
            className="auj-bouton-secondaire auj-historique-bouton"
            onClick={() => {
              setHistoriqueOuvert((o) => !o);
            }}
          >
            <span>Historique</span>
            <span className="auj-historique-compte">
              {journee.historique.length} {journee.historique.length > 1 ? 'saisies' : 'saisie'} · 7 jours
            </span>
          </button>
          {historiqueOuvert && (
            <Historique
              entrees={journee.historique}
              aujourdhui={jour}
              surAnnuler={(h) => {
                annuler(h.evenement, h.culture);
              }}
              surChangerDate={(h) => {
                setDialogue({ sorte: 'date', entree: h });
              }}
            />
          )}
        </>
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
              annuler(annulable.evenement, annulable.culture);
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
          aujourdhui={jour}
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
