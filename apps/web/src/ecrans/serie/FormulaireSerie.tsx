/**
 * Formulaire d'une série (T12, maquette Serie) : créer ou modifier une série du plan de culture.
 * Contrat : ./test/contrat.ts. Chargé à la demande par l'écran Planches ; il reçoit la porte.
 *
 * Aucun bouton « calculer » : dès qu'un champ change, dates (T02), besoins (T05), conflits (T03)
 * et alertes de rotation (T04) sont recalculés par le moteur (./calculs.ts) et affichés. Rien
 * n'est écrit avant « Planifier la série » (ou « Enregistrer ») ; une alerte rouge demande une
 * confirmation, gardée dans la série. Chaque enregistrement s'annule (bandeau de l'écran
 * Planches, puis historique du serveur).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { ajouterJours, type DateCalendaire, type TypeAncreSerie } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import './serie.css';
import {
  ancreParDefaut,
  calculer,
  chercherCultures,
  culturesDe,
  etapeDeLAncre,
  itinerairePropose,
  itinerairesDe,
  libelleCulture,
  libelleDate,
  lireLongueur,
  modeDe,
  nombreLisible,
  objetJson,
  semaineDe,
  type AlerteAffichee,
  type Bibliotheque,
  type ChoixCulture,
  type Saisie,
} from './calculs.ts';
import { entreeAnnulable, lireBibliotheque, lireEtatSerie, requeteHistorique, type EtatSerie, type Modification } from './donnees.ts';
import { annulerEntree, creerSerie, modifierSerie, ramenerSerie, SerieRefusee, type ContexteEcriture, type SerieAEcrire } from './ecritures.ts';

/** Marque de performance posée quand le formulaire est utilisable (e2e/serie.e2e.ts). */
export const MARQUE_SERIE_AFFICHEE = 'planif:serie-affichee';

/** D'où part le formulaire. `semaine` : 'AAAA-Www' (valeur d'un <input type="week">). */
export type DepartSerie =
  | {
      readonly sorte: 'creation';
      readonly emplacementId?: string;
      readonly semaine?: string;
      readonly saisonId?: string;
    }
  | { readonly sorte: 'modification'; readonly serieId: string };

/** Saisie enregistrée, que le bandeau de l'écran Planches peut défaire. */
export interface SaisieSerieAnnulable {
  readonly texte: string;
  annuler(): Promise<void>;
}

export interface ProprietesFormulaireSerie {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly depart: DepartSerie;
  readonly surFermer: () => void;
  readonly surEnregistree?: (saisie: SaisieSerieAnnulable) => void;
  /** Jour du téléphone, 'AAAA-MM-JJ'. */
  readonly aujourdhui?: () => string;
  /** Horloge des horodatages et des identifiants. */
  readonly maintenant?: () => Date;
}

const deux = (n: number) => String(n).padStart(2, '0');

function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

const maintenantParDefaut = () => new Date();

const ETAPES: readonly { readonly cle: 'semisPepiniere' | 'miseEnPlace' | 'debutRecolte' | 'finRecolte'; readonly libelle: string }[] = [
  { cle: 'semisPepiniere', libelle: 'Semis' },
  { cle: 'miseEnPlace', libelle: 'Plantation' },
  { cle: 'debutRecolte', libelle: 'Récolte' },
  { cle: 'finRecolte', libelle: 'Fin' },
];

const ANCRES: readonly { readonly valeur: TypeAncreSerie; readonly libelle: string }[] = [
  { valeur: 'semis', libelle: 'Semis' },
  { valeur: 'plantation', libelle: 'Plantation' },
  { valeur: 'debut_recolte', libelle: 'Récolte à partir de' },
];

const OPERATIONS: Readonly<Record<Modification['operation'], string>> = { creation: 'Création', modification: 'Modification', suppression: 'Suppression' };

const FOCALISABLES = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Tab et Maj+Tab restent dans le dialogue. */
function garderLeFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const elements = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCALISABLES)];
  const premier = elements[0];
  const dernier = elements.at(-1);
  if (premier === undefined || dernier === undefined) return;
  const actif = document.activeElement;
  if (e.shiftKey && (actif === premier || !e.currentTarget.contains(actif))) {
    e.preventDefault();
    dernier.focus();
  } else if (!e.shiftKey && (actif === dernier || !e.currentTarget.contains(actif))) {
    e.preventDefault();
    premier.focus();
  }
}

/** Semaine proposée sans `depart.semaine` : celle du jour, ou le début de la saison affichée. */
function semaineParDefaut(bib: Bibliotheque, jour: string, saisonId: string | undefined): string {
  const saison = saisonId === undefined ? undefined : bib.saisons.find((s) => s.id === saisonId);
  if (saison === undefined || (saison.debut <= jour && jour <= saison.fin)) return semaineDe(jour);
  // Le premier lundi de la saison (ou presque) : la semaine qui contient son quatrième jour.
  return semaineDe(ajouterJours(saison.debut as DateCalendaire, 3));
}

/** Série lue et non supprimée. */
const serieActive = (e: EtatSerie | null): e is EtatSerie => e !== null && e.serie.supprime_le === null;

function cultureDe(bib: Bibliotheque, especeId: string, varieteId: string | null): ChoixCulture | null {
  const espece = bib.especes.find((e) => e.id === especeId);
  if (espece === undefined) return null;
  const variete = varieteId === null ? undefined : bib.varietes.find((v) => v.id === varieteId);
  return { especeId, varieteId: variete?.id ?? null, nomEspece: espece.nom, nomVariete: variete?.nom ?? null };
}

function saisieInitiale(bib: Bibliotheque, depart: DepartSerie, etat: EtatSerie | null, jour: string): Saisie {
  if (depart.sorte === 'modification' && etat !== null) {
    const s = etat.serie;
    return {
      culture: cultureDe(bib, String(s.espece_id), typeof s.variete_id === 'string' ? s.variete_id : null),
      itineraireId: String(s.itineraire_id),
      parametresTexte: typeof s.parametres === 'string' ? s.parametres : null,
      ancre: s.ancre_type === 'semis' || s.ancre_type === 'debut_recolte' ? s.ancre_type : 'plantation',
      semaine: semaineDe(String(s.ancre_date)),
      emplacements: etat.occupations.filter((o) => o.supprime_le === null).map((o) => ({ id: String(o.emplacement_id), longueur: String(o.longueur_m ?? '') })),
    };
  }
  const creation: Extract<DepartSerie, { sorte: 'creation' }> = depart.sorte === 'creation' ? depart : { sorte: 'creation' };
  const planche = creation.emplacementId === undefined ? undefined : bib.planches.find((p) => p.id === creation.emplacementId);
  return {
    culture: null,
    itineraireId: null,
    parametresTexte: null,
    ancre: 'plantation',
    semaine: creation.semaine ?? semaineParDefaut(bib, jour, creation.saisonId),
    emplacements: planche === undefined ? [] : [{ id: planche.id, longueur: String(planche.longueurM) }],
  };
}

/** Instant lisible d'une ligne d'historique : « 30 sept. 2026, 10:00 ». */
function quand(m: Modification): string {
  if (Number.isNaN(m.instant)) return 'date inconnue';
  return new Date(m.instant).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Jour d'une entrée, en heure du téléphone : « 2 mars 2027 » (vide si l'horodatage est illisible). */
function jourLocal(m: Modification): string {
  if (Number.isNaN(m.instant)) return '';
  const d = new Date(m.instant);
  return `${String(d.getDate())} ${MOIS[d.getMonth()] ?? ''} ${String(d.getFullYear())}`;
}

/** Ce qu'une modification a changé, en quelques mots. */
function resume(m: Modification): string | null {
  if (m.operation !== 'modification' || m.avant === null || m.apres === null) return null;
  const morceaux: string[] = [];
  const a = m.avant;
  const b = m.apres;
  if (typeof a.ancre_date === 'string' && typeof b.ancre_date === 'string' && a.ancre_date !== b.ancre_date) {
    morceaux.push(`${libelleDate(a.ancre_date)} → ${libelleDate(b.ancre_date)}`);
  }
  if (typeof a.longueur_m === 'number' && typeof b.longueur_m === 'number' && a.longueur_m !== b.longueur_m) {
    morceaux.push(`${nombreLisible(a.longueur_m)} m → ${nombreLisible(b.longueur_m)} m`);
  }
  if (a.itineraire_id !== b.itineraire_id) morceaux.push('autre itinéraire');
  return morceaux.length === 0 ? null : morceaux.join(' · ');
}

// ── Petits composants ────────────────────────────────────────────────────────────────────────

function Icone({ chemin, taille = 24 }: { readonly chemin: string; readonly taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={chemin} />
    </svg>
  );
}

const CROIX = 'M6 6l12 12M18 6L6 18';
const ALERTE = 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z';

function Etiquette({ htmlFor, id, children }: { readonly htmlFor?: string; readonly id?: string; readonly children: ReactNode }) {
  return htmlFor === undefined ? (
    <span id={id} className="serie-etiquette">
      {children}
    </span>
  ) : (
    <label htmlFor={htmlFor} id={id} className="serie-etiquette">
      {children}
    </label>
  );
}

interface ProprietesConfirmation {
  readonly titre: string;
  readonly children: ReactNode;
  readonly libelleConfirmer: string;
  readonly surConfirmer: () => void;
  readonly surRevenir: () => void;
  readonly occupe: boolean;
}

/** Confirmation en un tap, par-dessus le formulaire : « Revenir » ne fait rien. */
function Confirmation({ titre, children, libelleConfirmer, surConfirmer, surRevenir, occupe }: ProprietesConfirmation) {
  const idTitre = useId();
  const revenir = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    revenir.current?.focus();
  }, []);
  return (
    <div className="serie-voile-confirmation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        className="serie-confirmation"
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape') {
            e.stopPropagation();
            surRevenir();
          }
        }}
      >
        <span className="serie-confirmation-icone">
          <Icone chemin={ALERTE} taille={28} />
        </span>
        <h3 id={idTitre}>{titre}</h3>
        {children}
        <div className="serie-confirmation-actions">
          <button ref={revenir} type="button" className="serie-bouton-secondaire" onClick={surRevenir}>
            Revenir
          </button>
          <button type="button" className="serie-bouton-danger" disabled={occupe} onClick={surConfirmer}>
            {libelleConfirmer}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Formulaire ───────────────────────────────────────────────────────────────────────────────

type Confirmer =
  | { readonly sorte: 'rotation'; readonly alerte: AlerteAffichee }
  | { readonly sorte: 'historique'; readonly entree: Modification; readonly plusRecentes: number };

export function FormulaireSerie({
  porte,
  fermeId,
  depart,
  surFermer,
  surEnregistree,
  aujourdhui = jourDuTelephone,
  maintenant = maintenantParDefaut,
}: ProprietesFormulaireSerie): ReactElement {
  const creation = depart.sorte === 'creation';
  const serieId = depart.sorte === 'modification' ? depart.serieId : null;
  const [jour] = useState(aujourdhui);
  const [bib, setBib] = useState<Bibliotheque | null>(null);
  const [etat, setEtat] = useState<EtatSerie | null>(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [echecLecture, setEchecLecture] = useState(false);
  const [saisie, setSaisie] = useState<Saisie | null>(null);
  const [recherche, setRecherche] = useState('');
  const [confirmer, setConfirmer] = useState<Confirmer | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [historique, setHistorique] = useState<Modification[]>([]);

  const idTitre = useId();
  const idCulture = useId();
  const idItineraire = useId();
  const idAncre = useId();
  const idSemaine = useId();
  const idAjouter = useId();
  const idPlanches = useId();
  const idHistorique = useId();
  const champCulture = useRef<HTMLInputElement>(null);
  const titre = useRef<HTMLHeadingElement>(null);
  const racine = useRef<HTMLDivElement>(null);
  const marquee = useRef(false);

  // Lecture à l'ouverture : bibliothèque, et la série en modification.
  useEffect(() => {
    let actif = true;
    const lectures = Promise.all([lireBibliotheque(porte, fermeId, jour), serieId === null ? Promise.resolve(null) : lireEtatSerie(porte, serieId)]);
    lectures.then(
      ([b, e]) => {
        if (!actif) return;
        if (serieId !== null && !serieActive(e)) {
          setIntrouvable(true);
          return;
        }
        setBib(b);
        setEtat(e);
        setSaisie(saisieInitiale(b, depart, e, jour));
      },
      (raison: unknown) => {
        console.error('Formulaire de série illisible', raison);
        if (actif) setEchecLecture(true);
      },
    );
    return () => {
      actif = false;
    };
    // `depart` est lu une fois, à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [porte, fermeId, serieId, jour]);

  // Historique du serveur (modification seulement), tenu à jour par la synchro.
  useEffect(() => {
    if (serieId === null) return undefined;
    return porte.surveiller<Modification>(requeteHistorique(serieId), setHistorique);
  }, [porte, serieId]);

  // Formulaire utilisable : focus dedans, une marque par ouverture.
  const pret = saisie !== null;
  useEffect(() => {
    if (!pret || marquee.current) return;
    marquee.current = true;
    if (creation) champCulture.current?.focus();
    else titre.current?.focus();
    performance.mark(MARQUE_SERIE_AFFICHEE);
  }, [pret, creation]);
  useEffect(() => {
    if (!pret) racine.current?.focus();
  }, [pret]);

  const exclure = useMemo(() => new Set((etat?.occupations ?? []).map((o) => String(o.id))), [etat]);
  const calcul = useMemo(() => (bib === null || saisie === null ? null : calculer({ bib, exclure }, saisie)), [bib, saisie, exclure]);
  const cultures = useMemo(() => (bib === null ? [] : culturesDe(bib)), [bib]);
  const trouvees = useMemo(() => chercherCultures(cultures, recherche), [cultures, recherche]);
  const cultureChoisie = saisie?.culture ?? null;
  const itineraires = useMemo(() => (bib === null || cultureChoisie === null ? [] : itinerairesDe(bib, cultureChoisie)), [bib, cultureChoisie]);

  const parametresTexte = saisie?.parametresTexte ?? null;
  const parametres = useMemo(() => objetJson(parametresTexte), [parametresTexte]);
  const mode = modeDe(parametres);

  function changer(f: (s: Saisie) => Saisie): void {
    setErreur(null);
    setSaisie((s) => (s === null ? s : f(s)));
  }

  function choisirCulture(c: ChoixCulture): void {
    if (bib === null) return;
    const itineraire = itinerairePropose(itinerairesDe(bib, c), saisie?.semaine ?? '');
    changer((s) => ({
      ...s,
      culture: c,
      itineraireId: itineraire?.id ?? null,
      parametresTexte: itineraire?.parametresTexte ?? null,
      ancre: ancreParDefaut(modeDe(objetJson(itineraire?.parametresTexte ?? null))),
    }));
    setRecherche('');
  }

  function choisirItineraire(id: string): void {
    const it = itineraires.find((i) => i.id === id);
    // En modification, l'itinéraire d'origine garde l'instantané de la série (jamais réécrit).
    const origine = etat !== null && String(etat.serie.itineraire_id) === id && typeof etat.serie.parametres === 'string' ? etat.serie.parametres : null;
    const texte = origine ?? it?.parametresTexte ?? null;
    const nouveauMode = modeDe(objetJson(texte));
    changer((s) => ({ ...s, itineraireId: it?.id ?? null, parametresTexte: texte, ancre: s.ancre === 'semis' && nouveauMode === 'plant_achete' ? 'plantation' : s.ancre }));
  }

  /** Changer d'ancre garde les dates : la semaine devient celle de l'étape choisie. */
  function choisirAncre(ancre: TypeAncreSerie): void {
    const d = calcul?.dates ?? null;
    const date = d === null ? undefined : d[etapeDeLAncre(ancre, mode)];
    changer((s) => ({ ...s, ancre, semaine: date === undefined ? s.semaine : semaineDe(date) }));
  }

  function ajouterPlanche(id: string): void {
    const planche = bib?.planches.find((p) => p.id === id);
    if (planche === undefined) return;
    changer((s) => (s.emplacements.some((e) => e.id === id) ? s : { ...s, emplacements: [...s.emplacements, { id, longueur: String(planche.longueurM) }] }));
  }

  // ── Écrire ─────────────────────────────────────────────────────────────────────────────────

  const ctx: ContexteEcriture = { porte, fermeId, maintenant };

  function aEcrire(rotation: string | null | undefined): SerieAEcrire | null {
    if (saisie?.culture == null || calcul?.dates == null || calcul.ancreDate === null) return null;
    if (saisie.itineraireId === null || saisie.parametresTexte === null) return null;
    const existante = etat === null ? null : typeof etat.serie.saison_id === 'string' ? etat.serie.saison_id : null;
    const saisonId = calcul.saisonId ?? (depart.sorte === 'creation' ? depart.saisonId : undefined) ?? existante;
    if (saisonId === null) {
      setErreur('Aucune saison de la ferme ne couvre cette mise en place : ajoute la saison d’abord.');
      return null;
    }
    const gardee = etat === null ? null : typeof etat.serie.rotation_acceptee === 'string' ? etat.serie.rotation_acceptee : null;
    return {
      saisonId,
      especeId: saisie.culture.especeId,
      varieteId: saisie.culture.varieteId,
      itineraireId: saisie.itineraireId,
      parametresTexte: saisie.parametresTexte,
      ancre: saisie.ancre,
      ancreDate: calcul.ancreDate,
      dates: calcul.dates,
      emplacements: saisie.emplacements.map((e) => ({ id: e.id, longueurM: lireLongueur(e.longueur) ?? 0 })),
      longueurTotale: calcul.longueurTotale,
      rotationAcceptee: rotation === undefined ? gardee : rotation,
    };
  }

  async function ecrire(rotation: string | null | undefined): Promise<void> {
    const s = aEcrire(rotation);
    if (s === null || saisie?.culture == null) return;
    const texte = libelleCulture(saisie.culture);
    setOccupe(true);
    try {
      if (serieId === null) {
        const id = await creerSerie(ctx, s);
        surEnregistree?.({ texte, annuler: () => ramenerSerie(ctx, id, null) });
      } else {
        const avant = await modifierSerie(ctx, serieId, s);
        surEnregistree?.({ texte, annuler: () => ramenerSerie(ctx, serieId, avant) });
      }
      surFermer();
    } catch (e) {
      console.error('Série non enregistrée', e);
      setErreur(e instanceof SerieRefusee ? `Rien n’a été enregistré : ${e.message}.` : 'Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');
      setConfirmer(null);
    } finally {
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    if (calcul?.manque !== null || occupe) return;
    const rouge = calcul.alertes.find((a) => a.niveau === 'rouge');
    if (rouge === undefined) {
      void ecrire(undefined);
      return;
    }
    // Décision déjà prise pour cette famille (modification) : pas de nouvelle question.
    const gardee = objetJson(etat !== null && typeof etat.serie.rotation_acceptee === 'string' ? etat.serie.rotation_acceptee : null);
    const famille = bib?.especes.find((e) => e.id === saisie?.culture?.especeId)?.familleId;
    if (gardee !== null && gardee.famille === famille) {
      void ecrire(undefined);
      return;
    }
    setConfirmer({ sorte: 'rotation', alerte: rouge });
  }

  function accepterRotation(a: AlerteAffichee): void {
    const famille = bib?.especes.find((e) => e.id === saisie?.culture?.especeId)?.familleId ?? '';
    void ecrire(JSON.stringify({ famille, delai_ans: a.alerte.delais.minimalAns, le: maintenant().toISOString() }));
  }

  async function annulerHistorique(entree: Modification): Promise<void> {
    if (serieId === null || saisie?.culture == null) return;
    const texte = libelleCulture(saisie.culture);
    setOccupe(true);
    try {
      const avant = await annulerEntree(ctx, serieId, entree);
      surEnregistree?.({ texte, annuler: () => ramenerSerie(ctx, serieId, avant) });
      surFermer();
    } catch (e) {
      console.error('Annulation impossible', e);
      setErreur(e instanceof SerieRefusee ? `Rien n’a été annulé : ${e.message}.` : 'Rien n’a été annulé : la base du téléphone a refusé l’écriture.');
      setConfirmer(null);
    } finally {
      setOccupe(false);
    }
  }

  function demanderAnnulation(entree: Modification, index: number): void {
    if (index === 0) void annulerHistorique(entree);
    else setConfirmer({ sorte: 'historique', entree, plusRecentes: index });
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────────────────────

  const nom = creation ? 'Nouvelle série' : 'Modifier la série';
  const annee = calcul?.dates?.miseEnPlace.slice(0, 4) ?? saisie?.semaine.slice(0, 4) ?? '';
  const famille = saisie?.culture == null || bib === null ? null : bib.familles.get(bib.especes.find((e) => e.id === saisie.culture?.especeId)?.familleId ?? '');
  const choisies = new Set(saisie?.emplacements.map((e) => e.id) ?? []);
  const proposees = bib?.planches.filter((p) => p.proposee && !choisies.has(p.id)) ?? [];
  const zonesProposees = [...new Set(proposees.map((p) => p.nomZone))];

  let corps: ReactNode;
  if (echecLecture || introuvable) {
    corps = (
      <p role="alert" className="serie-vide">
        {introuvable ? 'Cette série n’existe plus sur ce téléphone.' : 'La bibliothèque de la ferme n’a pas pu se lire. Ferme puis rouvre le formulaire.'}
      </p>
    );
  } else if (bib === null || saisie === null || calcul === null) {
    corps = <p className="serie-vide">Lecture de la bibliothèque…</p>;
  } else {
    const d = calcul.dates;
    corps = (
      <>
        {/* Culture */}
        <section className="serie-carte">
          {saisie.culture === null ? (
            <>
              <Etiquette htmlFor={idCulture}>Culture</Etiquette>
              <input
                ref={champCulture}
                id={idCulture}
                type="search"
                className="serie-champ"
                autoComplete="off"
                autoCapitalize="none"
                enterKeyHint="search"
                placeholder="Tape « bat », « chou »…"
                value={recherche}
                onChange={(e) => {
                  setRecherche(e.target.value);
                }}
              />
              {recherche.trim() !== '' && (
                <ul className="serie-choix">
                  {trouvees.length === 0 && <li className="serie-aucun">Aucune culture de la bibliothèque ne correspond.</li>}
                  {trouvees.map((c) => (
                    <li key={`${c.especeId}/${c.varieteId ?? ''}`}>
                      <button
                        type="button"
                        data-testid="choix-culture"
                        data-espece={c.especeId}
                        data-variete={c.varieteId ?? ''}
                        className="serie-choix-bouton"
                        onClick={() => {
                          choisirCulture(c);
                        }}
                      >
                        <strong>{c.nomEspece}</strong>
                        {c.nomVariete !== null && <span>{c.nomVariete}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="serie-culture">
              <div className="serie-culture-texte">
                <span className="serie-etiquette">Culture</span>
                <p data-testid="culture-choisie">
                  <strong>{libelleCulture(saisie.culture)}</strong>
                  <span className="serie-separateur"> · </span>
                  <span>{famille?.nom ?? 'famille inconnue'}</span>
                </p>
              </div>
              <button
                type="button"
                className="serie-bouton-leger"
                onClick={() => {
                  changer((s) => ({ ...s, culture: null, itineraireId: null, parametresTexte: null }));
                }}
              >
                Changer
              </button>
            </div>
          )}
        </section>

        {saisie.culture !== null && (
          <section className="serie-carte">
            <Etiquette htmlFor={idItineraire}>Itinéraire</Etiquette>
            <select
              id={idItineraire}
              className="serie-champ"
              value={saisie.itineraireId ?? ''}
              onChange={(e) => {
                choisirItineraire(e.target.value);
              }}
            >
              {saisie.itineraireId === null && <option value="">Aucun itinéraire</option>}
              {itineraires.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nom}
                </option>
              ))}
            </select>
            {itineraires.length === 0 && <p className="serie-aide">Aucun itinéraire pour cette culture : l’import de la bibliothèque les fournit.</p>}
          </section>
        )}

        {/* Ancre et semaine */}
        <section className="serie-carte">
          <Etiquette id={idAncre}>Ancre</Etiquette>
          <div role="radiogroup" aria-labelledby={idAncre} className="serie-ancres">
            {ANCRES.map((a) => {
              const desactivee = a.valeur === 'semis' && mode === 'plant_achete';
              return (
                <label key={a.valeur} className={`serie-ancre${saisie.ancre === a.valeur ? ' serie-ancre-choisie' : ''}${desactivee ? ' serie-ancre-desactivee' : ''}`}>
                  <input
                    type="radio"
                    name={idAncre}
                    value={a.valeur}
                    checked={saisie.ancre === a.valeur}
                    disabled={desactivee}
                    onChange={() => {
                      choisirAncre(a.valeur);
                    }}
                  />
                  <span>{a.libelle}</span>
                </label>
              );
            })}
          </div>
          <Etiquette htmlFor={idSemaine}>Semaine</Etiquette>
          <input
            id={idSemaine}
            type="week"
            className="serie-champ serie-champ-semaine"
            value={saisie.semaine}
            onChange={(e) => {
              const semaine = e.target.value;
              changer((s) => ({ ...s, semaine }));
            }}
          />
          {mode === 'plant_achete' && <p className="serie-aide">Plant acheté : pas de semis à la ferme.</p>}
        </section>

        {/* Planches */}
        <section className="serie-carte" aria-labelledby={idPlanches}>
          <span id={idPlanches} className="serie-etiquette">
            Planches
          </span>
          {saisie.emplacements.length === 0 && <p className="serie-aide">Aucune planche choisie.</p>}
          <ul className="serie-planches">
            {saisie.emplacements.map((e) => {
              const planche = bib.planches.find((p) => p.id === e.id);
              const code = planche?.code ?? '?';
              return (
                <li key={e.id} data-testid="emplacement-serie" data-emplacement={e.id} className="serie-planche">
                  <span className="serie-planche-nom">
                    <strong className="serie-code">{code}</strong>
                    <span>{planche?.nomZone ?? ''}</span>
                  </span>
                  <span className="serie-longueur">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      aria-label={`Longueur ${code}`}
                      className="serie-champ serie-champ-longueur"
                      value={e.longueur}
                      onChange={(x) => {
                        const longueur = x.target.value;
                        changer((s) => ({ ...s, emplacements: s.emplacements.map((y) => (y.id === e.id ? { ...y, longueur } : y)) }));
                      }}
                    />
                    <span aria-hidden="true">m</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Retirer ${code}`}
                    className="serie-retirer"
                    onClick={() => {
                      changer((s) => ({ ...s, emplacements: s.emplacements.filter((y) => y.id !== e.id) }));
                    }}
                  >
                    <Icone chemin={CROIX} />
                  </button>
                </li>
              );
            })}
          </ul>
          <Etiquette htmlFor={idAjouter}>Ajouter une planche</Etiquette>
          <select
            id={idAjouter}
            className="serie-champ"
            value=""
            onChange={(e) => {
              ajouterPlanche(e.target.value);
            }}
          >
            <option value="">Choisir une planche…</option>
            {zonesProposees.map((z) => (
              <optgroup key={z} label={z === '' ? 'Sans zone' : z}>
                {proposees
                  .filter((p) => p.nomZone === z)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </section>

        {/* Calculé par le moteur */}
        <section className="serie-carte serie-moteur">
          <span className="serie-etiquette">Calculé par le moteur</span>
          {d === null ? (
            <p className="serie-aide">{calcul.manque ?? 'Les dates s’afficheront ici.'}</p>
          ) : (
            <div data-testid="dates-serie" className="serie-dates">
              {ETAPES.map((etape) => {
                const date = d[etape.cle];
                if (date === undefined) return null;
                const libelle = etape.cle === 'miseEnPlace' && mode === 'semis_direct' ? 'Semis en place' : etape.libelle;
                return (
                  <div key={etape.cle} data-testid="date-serie" data-etape={etape.cle} data-date={date} className={`serie-date serie-date-${etape.cle}`}>
                    <i aria-hidden="true" />
                    <span>{libelle}</span>
                    <strong>{libelleDate(date)}</strong>
                  </div>
                );
              })}
            </div>
          )}
          {calcul.besoins.length > 0 && (
            <ul data-testid="besoins-serie" className="serie-besoins">
              {calcul.besoins.map((b) => (
                <li key={b.cle} data-testid="besoin" data-cle={b.cle} data-valeur={b.valeur}>
                  {b.texte}
                </li>
              ))}
            </ul>
          )}
          {calcul.longueurTotale > 0 && saisie.emplacements.length > 1 && <p className="serie-aide">{nombreLisible(calcul.longueurTotale)} m de planche en tout.</p>}
        </section>

        {calcul.conflits.map((c, i) => (
          <div key={`${c.emplacementId}-${c.sorte}-${String(i)}`} data-testid="conflit-serie" data-sorte={c.sorte} data-emplacement={c.emplacementId} className="serie-alerte serie-alerte-rouge">
            <strong>{c.texte}</strong>
            <span>La planche est déjà prise à ces dates. Change la semaine, la longueur ou la planche.</span>
          </div>
        ))}

        {calcul.alertes.map((a) => (
          <div key={`${a.emplacementId}-${a.niveau}`} data-testid="alerte-rotation" data-niveau={a.niveau} data-emplacement={a.emplacementId} className={`serie-alerte serie-alerte-${a.niveau}`}>
            <strong>
              Rotation sur {a.code} : {a.nomFamille} en {String(a.annee)} sur {a.lieu}
            </strong>
            <span>
              {a.niveau === 'rouge'
                ? `Retour minimal après ${String(a.alerte.delais.minimalAns)} ans. Tu peux enregistrer quand même ; ta décision sera gardée.`
                : `Retour conseillé après ${String(a.alerte.delais.conseilleAns)} ans.`}
            </span>
          </div>
        ))}

        {serieId !== null && (
          <section aria-labelledby={idHistorique} className="serie-carte serie-historique">
            <h3 id={idHistorique} className="serie-etiquette">
              Historique
            </h3>
            {historique.length === 0 ? (
              <p className="serie-aide">Rien encore : l’historique arrive du serveur après la synchronisation.</p>
            ) : (
              <ol>
                {historique.map((m, i) => {
                  const detail = resume(m);
                  const acceptee = (m.apres?.rotation_acceptee ?? null) !== null;
                  const annulable = entreeAnnulable(m);
                  return (
                    <li key={m.id} data-testid="modification-historique" data-modification={m.id} data-operation={m.operation} className="serie-entree">
                      <span className="serie-entree-texte">
                        <strong>{OPERATIONS[m.operation]}</strong>
                        <span>
                          {quand(m)}
                          {detail === null ? '' : ` · ${detail}`}
                          {acceptee ? ' · alerte de rotation acceptée' : ''}
                        </span>
                        {!annulable && <span className="serie-entree-illisible">Ligne illisible : elle ne peut pas être annulée.</span>}
                      </span>
                      <button
                        type="button"
                        aria-label={`Annuler : ${OPERATIONS[m.operation]} du ${quand(m)}`}
                        className="serie-bouton-leger"
                        disabled={occupe || !annulable}
                        onClick={() => {
                          demanderAnnulation(m, i);
                        }}
                      >
                        Annuler
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </>
    );
  }

  const peutEnregistrer = calcul !== null && calcul.manque === null && !occupe;
  return (
    <div className="serie-voile">
      <div
        ref={racine}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-testid="formulaire-serie"
        className="serie"
        tabIndex={-1}
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape' && confirmer === null) surFermer();
        }}
      >
        <header className="serie-tete">
          <span className="serie-surtitre">Plan de culture {annee}</span>
          <h2 ref={titre} id={idTitre} tabIndex={-1}>
            {nom}
          </h2>
        </header>
        <div className="serie-corps">{corps}</div>
        <footer className="serie-pied">
          {erreur !== null && (
            <p role="alert" className="serie-erreur">
              {erreur}
            </p>
          )}
          {erreur === null && calcul?.manque != null && calcul.dates !== null && <p className="serie-aide">{calcul.manque}</p>}
          <div className="serie-actions">
            <button type="button" className="serie-bouton-secondaire" onClick={surFermer}>
              Fermer
            </button>
            <button type="button" className="serie-bouton-principal" disabled={!peutEnregistrer} onClick={enregistrer}>
              {creation ? 'Planifier la série' : 'Enregistrer'}
            </button>
          </div>
        </footer>
      </div>

      {confirmer?.sorte === 'rotation' && (
        <Confirmation
          titre={`Alerte de rotation : ${confirmer.alerte.nomFamille}`}
          libelleConfirmer="Planifier quand même"
          occupe={occupe}
          surRevenir={() => {
            setConfirmer(null);
          }}
          surConfirmer={() => {
            accepterRotation(confirmer.alerte);
          }}
        >
          <p>
            {confirmer.alerte.nomFamille} en {String(confirmer.alerte.annee)} sur {confirmer.alerte.lieu} : le retour sur {confirmer.alerte.code} demande au moins{' '}
            {String(confirmer.alerte.alerte.delais.minimalAns)} ans.
          </p>
          <p>Si tu planifies quand même, ta décision est gardée dans l’historique de la série.</p>
        </Confirmation>
      )}
      {confirmer?.sorte === 'historique' && (
        <Confirmation
          titre="Annuler aussi les changements plus récents ?"
          libelleConfirmer="Tout annuler jusqu’ici"
          occupe={occupe}
          surRevenir={() => {
            setConfirmer(null);
          }}
          surConfirmer={() => {
            void annulerHistorique(confirmer.entree);
          }}
        >
          <p>
            La série reviendra à son état d’avant le {jourLocal(confirmer.entree)} : les {String(confirmer.plusRecentes)}{' '}
            {confirmer.plusRecentes > 1 ? 'changements plus récents seront défaits' : 'changement plus récent sera défait'} aussi.
          </p>
        </Confirmation>
      )}
    </div>
  );
}

export default FormulaireSerie;
