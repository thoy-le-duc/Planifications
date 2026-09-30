/**
 * Formulaire d'un itinéraire (T24) : créer, adapter (copie d'un itinéraire de la bibliothèque),
 * modifier, ou consulter en lecture seule. Contrat : ./test/contrat.ts, « Formulaire ».
 *
 * Aucun bouton « calculer » : à chaque changement, l'aperçu (dates de la série d'exemple et de
 * chaque travail) est recalculé par le cœur. Rien n'est écrit avant « Enregistrer » ; modifier un
 * itinéraire qui a des séries à venir demande d'abord « Appliquer aux N séries à venir ? ».
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { CATEGORIES_AVEC_PRODUIT, type FaconDensite, type ModeItineraire, type RepereTravail } from '@planif/core';
import {
  apercu,
  CATEGORIES,
  cleType,
  comparerNoms,
  dateCourte,
  dateLisible,
  egauxJson,
  LIBELLES_MODES,
  ligneValidee,
  nomAdapte,
  nouveauTravail,
  PARAMETRES_NOUVEAUX,
  parametresDe,
  parametresNormalises,
  REPERES,
  repereFinParDefaut,
  saisieDepuis,
  type EspeceLue,
  type ItineraireLu,
  type Ligne,
  type Par,
  type Saisie,
  type SaisieTravail,
  type TypeLu,
} from './calculs.ts';
import { lireSeriesAVenir, type SerieAVenir } from './donnees.ts';
import { creerItineraire, EcritureRefusee, modifierItineraire, nouvelId, ramener, supprimerItineraire, type ContexteEcriture } from './ecritures.ts';

/** Marque de performance posée quand le formulaire est utilisable (champs et aperçu dessinés). */
export const MARQUE_ITINERAIRE_AFFICHE = 'planif:itineraire-affiche';

export type DepartFormulaire =
  | { readonly sorte: 'creation' }
  | { readonly sorte: 'adaptation'; readonly itineraire: ItineraireLu }
  | { readonly sorte: 'modification'; readonly itineraire: ItineraireLu }
  | { readonly sorte: 'lecture'; readonly itineraire: ItineraireLu };

/** Saisie enregistrée, que le bandeau de l'écran peut défaire. */
export interface SaisieAnnulable {
  readonly texte: string;
  annuler(): Promise<void>;
}

export interface ProprietesFormulaire {
  readonly depart: DepartFormulaire;
  readonly especes: readonly EspeceLue[];
  readonly types: readonly TypeLu[];
  readonly ctx: ContexteEcriture;
  readonly aujourdhui: string;
  readonly surFermer: () => void;
  readonly surAdapter: (itineraire: ItineraireLu) => void;
  readonly surEnregistre: (saisie: SaisieAnnulable) => void;
}

const FOCALISABLES = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Tab et Maj+Tab restent dans le dialogue. */
export function garderLeFocus(e: KeyboardEvent<HTMLElement>): void {
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

const TITRES: Readonly<Record<DepartFormulaire['sorte'], string>> = {
  creation: 'Nouvel itinéraire',
  adaptation: 'Nouvel itinéraire',
  modification: 'Modifier l’itinéraire',
  lecture: 'Itinéraire de la bibliothèque',
};

const MODES: readonly ModeItineraire[] = ['semis_direct', 'plant_maison', 'plant_achete'];
const FACONS: readonly { readonly valeur: FaconDensite; readonly libelle: string }[] = [
  { valeur: 'ecartement', libelle: 'À l’écartement' },
  { valeur: 'metre_lineaire', libelle: 'Au mètre linéaire' },
  { valeur: 'volee', libelle: 'À la volée' },
];
const ETAPES: readonly { readonly cle: 'semisPepiniere' | 'miseEnPlace' | 'debutRecolte' | 'finRecolte'; readonly libelle: string }[] = [
  { cle: 'semisPepiniere', libelle: 'Semis' },
  { cle: 'miseEnPlace', libelle: 'Mise en place' },
  { cle: 'debutRecolte', libelle: 'Récolte' },
  { cle: 'finRecolte', libelle: 'Fin' },
];

function saisieInitiale(depart: DepartFormulaire): Saisie {
  if (depart.sorte === 'creation') return saisieDepuis(PARAMETRES_NOUVEAUX, '', '');
  const it = depart.itineraire;
  const nom = depart.sorte === 'adaptation' ? nomAdapte(it.nom) : it.nom;
  return saisieDepuis(it.parametres ?? { mode: it.mode }, nom, it.especeId);
}

/** Ligne d'origine (modification) telle que lue, pour savoir si les paramètres changent. */
function ligneOrigine(it: ItineraireLu, fermeId: string): Ligne {
  return { id: it.id, ferme_id: it.fermeId ?? fermeId, espece_id: it.especeId, variete_id: it.varieteId, nom: it.nom, mode: it.mode, parametres: it.parametresTexte };
}

// ── Petits composants ────────────────────────────────────────────────────────────────────────

function Icone({ chemin, taille = 22 }: { readonly chemin: string; readonly taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={chemin} />
    </svg>
  );
}

export const CROIX = 'M6 6l12 12M18 6L6 18';
const PLUS = 'M12 5v14M5 12h14';
const ALERTE = 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z';

interface ProprietesChamp {
  readonly libelle: string;
  readonly valeur: string;
  readonly surChanger: (v: string) => void;
  readonly desactive: boolean;
  readonly mode?: 'numeric' | 'decimal' | 'text';
  readonly large?: boolean;
  readonly suffixe?: string;
}

function Champ({ libelle, valeur, surChanger, desactive, mode = 'numeric', large = false, suffixe }: ProprietesChamp) {
  const id = useId();
  return (
    <div className={`itin-champ-bloc${large ? ' itin-large' : ''}`}>
      <label htmlFor={id} className="itin-etiquette">
        {libelle}
      </label>
      <span className="itin-champ-cadre">
        <input
          id={id}
          type="text"
          inputMode={mode}
          autoComplete="off"
          className={`itin-champ${mode === 'text' ? '' : ' itin-champ-nombre'}`}
          value={valeur}
          disabled={desactive}
          onChange={(e) => {
            surChanger(e.target.value);
          }}
        />
        {suffixe !== undefined && (
          <span aria-hidden="true" className="itin-suffixe">
            {suffixe}
          </span>
        )}
      </span>
    </div>
  );
}

interface ProprietesListe {
  readonly libelle: string;
  readonly valeur: string;
  readonly surChanger: (v: string) => void;
  readonly desactive: boolean;
  readonly large?: boolean;
  readonly children: ReactNode;
}

function Liste({ libelle, valeur, surChanger, desactive, large = false, children }: ProprietesListe) {
  const id = useId();
  return (
    <div className={`itin-champ-bloc${large ? ' itin-large' : ''}`}>
      <label htmlFor={id} className="itin-etiquette">
        {libelle}
      </label>
      <select
        id={id}
        className="itin-champ itin-liste"
        value={valeur}
        disabled={desactive}
        onChange={(e) => {
          surChanger(e.target.value);
        }}
      >
        {children}
      </select>
    </div>
  );
}

// ── Travail prévu ────────────────────────────────────────────────────────────────────────────

interface ProprietesTravail {
  readonly indice: number;
  readonly travail: SaisieTravail;
  readonly mode: ModeItineraire;
  readonly types: readonly TypeLu[];
  readonly dates: readonly string[] | null;
  readonly lectureSeule: boolean;
  readonly surChanger: (f: (t: SaisieTravail) => SaisieTravail) => void;
  readonly surRetirer: () => void;
}

/** Valeur de l'option « Type » d'un travail : l'id du type (catégorie, libellé exact). */
function valeurType(t: SaisieTravail, types: readonly TypeLu[]): string {
  if (t.categorie === null || t.type === null) return '';
  const trouves = types.filter((x) => x.categorie === t.categorie && x.libelle === t.type);
  return (trouves.find((x) => !x.masque) ?? trouves[0])?.id ?? 'inconnu';
}

function TravailPrevuSaisi({ indice, travail: t, mode, types, dates, lectureSeule, surChanger, surRetirer }: ProprietesTravail) {
  const idRepeter = useId();
  const valeur = valeurType(t, types);
  const reperes = REPERES.filter((r) => r.valeur !== 'semis_pepiniere' || mode === 'plant_maison');
  const avecProduit = t.categorie !== null && CATEGORIES_AVEC_PRODUIT.includes(t.categorie);
  const jamais = t.type !== null && dates !== null && dates.length === 0;
  // Un type masqué reste proposé au seul travail qui l'a déjà.
  const visibles = types.filter((x) => !x.masque || x.id === valeur);
  const optionsRepere = (courant: RepereTravail) => {
    const liste = reperes.some((r) => r.valeur === courant) ? reperes : [...REPERES.filter((r) => r.valeur === courant), ...reperes];
    return liste.map((r) => (
      <option key={r.valeur} value={r.valeur}>
        {r.libelle}
      </option>
    ));
  };
  const changer = (f: (x: SaisieTravail) => SaisieTravail) => {
    surChanger(f);
  };
  return (
    <div role="group" aria-label={`Travail ${String(indice + 1)}`} data-testid="travail-prevu" data-indice={indice} className={`itin-travail${jamais ? ' itin-travail-jamais' : ''}`}>
      <div className="itin-travail-tete">
        <span className="itin-numero" aria-hidden="true">
          {indice + 1}
        </span>
        <Liste
          libelle="Type"
          valeur={valeur}
          desactive={lectureSeule}
          large
          surChanger={(v) => {
            if (v === 'inconnu') return;
            const type = types.find((x) => x.id === v);
            changer((x) => (type === undefined ? { ...x, categorie: null, type: null } : { ...x, categorie: type.categorie, type: type.libelle }));
          }}
        >
          <option value="">Choisir un type…</option>
          {CATEGORIES.map((c) => {
            const liste = visibles.filter((x) => x.categorie === c.valeur).sort((a, b) => comparerNoms(a.libelle, b.libelle));
            if (liste.length === 0 && !(valeur === 'inconnu' && t.categorie === c.valeur)) return null;
            return (
              <optgroup key={c.valeur} label={c.libelle}>
                {liste.map((x) => (
                  <option key={x.id} value={x.id} data-categorie={x.categorie} data-libelle={x.libelle}>
                    {x.libelle}
                  </option>
                ))}
                {valeur === 'inconnu' && t.categorie === c.valeur && (
                  <option value="inconnu" data-categorie={t.categorie} data-libelle={t.type ?? ''}>
                    {t.type} (type inconnu)
                  </option>
                )}
              </optgroup>
            );
          })}
        </Liste>
      </div>

      <div className="itin-grille">
        <Champ
          libelle="Jours"
          valeur={t.jours}
          desactive={lectureSeule}
          suffixe="j"
          surChanger={(v) => {
            changer((x) => ({ ...x, jours: v }));
          }}
        />
        <Liste
          libelle="Avant ou après"
          valeur={t.sens}
          desactive={lectureSeule}
          surChanger={(v) => {
            changer((x) => ({ ...x, sens: v === 'avant' ? 'avant' : 'apres' }));
          }}
        >
          <option value="avant">avant</option>
          <option value="apres">après</option>
        </Liste>
        <Liste
          libelle="Repère"
          valeur={t.repere}
          desactive={lectureSeule}
          large
          surChanger={(v) => {
            const r = REPERES.find((x) => x.valeur === v)?.valeur ?? 'mise_en_place';
            changer((x) => ({ ...x, repere: r, repereFin: x.repeter ? x.repereFin : repereFinParDefaut(r) }));
          }}
        >
          {optionsRepere(t.repere)}
        </Liste>
      </div>

      <label htmlFor={idRepeter} className={`itin-case${t.repeter ? ' itin-case-cochee' : ''}${lectureSeule ? ' itin-case-inactive' : ''}`}>
        <input
          id={idRepeter}
          type="checkbox"
          checked={t.repeter}
          disabled={lectureSeule}
          onChange={(e) => {
            const repeter = e.target.checked;
            changer((x) => ({ ...x, repeter }));
          }}
        />
        <span className="itin-case-marque" aria-hidden="true" />
        <span>Répéter</span>
      </label>
      {t.repeter && (
        <div className="itin-grille">
          <Champ
            libelle="Période (jours)"
            valeur={t.periode}
            desactive={lectureSeule}
            suffixe="j"
            surChanger={(v) => {
              changer((x) => ({ ...x, periode: v }));
            }}
          />
          <Liste
            libelle="Fin de la répétition"
            valeur={t.repereFin}
            desactive={lectureSeule}
            surChanger={(v) => {
              const r = REPERES.find((x) => x.valeur === v)?.valeur ?? 'fin_recolte';
              changer((x) => ({ ...x, repereFin: r }));
            }}
          >
            {optionsRepere(t.repereFin)}
          </Liste>
        </div>
      )}

      {avecProduit && (
        <div className="itin-grille">
          <Champ
            libelle="Produit"
            valeur={t.produit}
            desactive={lectureSeule}
            mode="text"
            large
            surChanger={(v) => {
              changer((x) => ({ ...x, produit: v }));
            }}
          />
          <Champ
            libelle="Quantité"
            valeur={t.quantite}
            desactive={lectureSeule}
            mode="decimal"
            surChanger={(v) => {
              changer((x) => ({ ...x, quantite: v }));
            }}
          />
          <Champ
            libelle="Unité"
            valeur={t.unite}
            desactive={lectureSeule}
            mode="text"
            surChanger={(v) => {
              changer((x) => ({ ...x, unite: v }));
            }}
          />
        </div>
      )}

      <div className="itin-grille">
        <Champ
          libelle="Temps estimé (min)"
          valeur={t.minutes}
          desactive={lectureSeule}
          surChanger={(v) => {
            changer((x) => ({ ...x, minutes: v }));
          }}
        />
        <Liste
          libelle="Par"
          valeur={t.par}
          desactive={lectureSeule}
          surChanger={(v) => {
            const par: Par = v === 'planche' ? 'planche' : 'cent_metres';
            changer((x) => ({ ...x, par }));
          }}
        >
          <option value="cent_metres">100 m</option>
          <option value="planche">planche</option>
        </Liste>
        <Champ
          libelle="Outil"
          valeur={t.outil}
          desactive={lectureSeule}
          mode="text"
          large
          surChanger={(v) => {
            changer((x) => ({ ...x, outil: v }));
          }}
        />
      </div>

      {jamais && (
        <p data-testid="travail-jamais" className="itin-jamais">
          <Icone chemin={ALERTE} taille={20} />
          <span>Ce travail ne tombe jamais dans une série : il commencerait après la fin de sa répétition. Vérifie les jours ou le repère.</span>
        </p>
      )}

      {!lectureSeule && (
        <button type="button" className="itin-bouton-retirer" onClick={surRetirer}>
          <Icone chemin={CROIX} taille={18} />
          Retirer ce travail
        </button>
      )}
    </div>
  );
}

// ── Confirmation des séries à venir ──────────────────────────────────────────────────────────

interface ProprietesConfirmation {
  readonly series: readonly SerieAVenir[];
  readonly occupe: boolean;
  readonly surAppliquer: () => void;
  readonly surSeul: () => void;
  readonly surRevenir: () => void;
}

function ConfirmationSeries({ series, occupe, surAppliquer, surSeul, surRevenir }: ProprietesConfirmation) {
  const idTitre = useId();
  const revenir = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    revenir.current?.focus();
  }, []);
  const n = series.length;
  const titre = n === 1 ? 'Appliquer à la série à venir ?' : `Appliquer aux ${String(n)} séries à venir ?`;
  return (
    <div className="itin-voile-confirmation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-testid="confirmation-series"
        className="itin-confirmation"
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape') {
            e.stopPropagation();
            surRevenir();
          }
        }}
      >
        <h3 id={idTitre}>{titre}</h3>
        <p>Les séries passées, commencées ou terminées ne bougent pas. {n === 1 ? 'Celle-ci recevra' : 'Celles-ci recevront'} le nouvel itinéraire et des dates recalculées :</p>
        <ul className="itin-series">
          {series.map((s) => (
            <li key={s.id} data-testid="serie-a-venir" data-serie={s.id}>
              <strong>{s.culture}</strong>
              <span>
                {s.planches === '' ? 'sans planche' : s.planches} · mise en place le {dateLisible(s.miseEnPlace)}
              </span>
            </li>
          ))}
        </ul>
        <div className="itin-confirmation-actions">
          <button type="button" className="itin-bouton-principal" disabled={occupe} onClick={surAppliquer}>
            Appliquer aux séries
          </button>
          <button type="button" className="itin-bouton-secondaire" disabled={occupe} onClick={surSeul}>
            Itinéraire seul
          </button>
          <button ref={revenir} type="button" className="itin-bouton-leger" onClick={surRevenir}>
            Revenir
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Formulaire ───────────────────────────────────────────────────────────────────────────────

export function FormulaireItineraire({ depart, especes, types, ctx, aujourdhui, surFermer, surAdapter, surEnregistre }: ProprietesFormulaire): ReactElement {
  const lectureSeule = depart.sorte === 'lecture';
  const origine = depart.sorte === 'creation' ? null : depart.itineraire;
  const base = useMemo(() => origine?.parametres ?? (origine === null ? PARAMETRES_NOUVEAUX : { mode: origine.mode }), [origine]);
  const [saisie, setSaisie] = useState<Saisie>(() => saisieInitiale(depart));
  const [id] = useState(() => (depart.sorte === 'creation' || depart.sorte === 'adaptation' ? nouvelId(ctx.maintenant) : depart.itineraire.id));
  const [confirmer, setConfirmer] = useState<readonly SerieAVenir[] | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const idTitre = useId();
  const idCulture = useId();
  const idMode = useId();
  const idTravaux = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const marquee = useRef(false);

  // Utilisable dès le premier rendu (données reçues de l'écran) : focus dedans, une marque.
  useEffect(() => {
    if (marquee.current) return;
    marquee.current = true;
    titre.current?.focus();
    performance.mark(MARQUE_ITINERAIRE_AFFICHE);
  }, []);

  const calcul = useMemo(() => apercu(saisie, base.periodeUsage, aujourdhui), [saisie, base, aujourdhui]);

  /** La ligne à écrire, validée par le cœur ; ou ce qui manque. */
  const construite = useMemo(() => {
    if (lectureSeule) return null;
    if (saisie.nom.trim() === '') return { ok: false as const, message: 'Donne un nom à l’itinéraire.' };
    if (saisie.especeId === '') return { ok: false as const, message: 'Choisis la culture.' };
    const p = parametresDe(base, saisie);
    if (!p.ok) return p;
    const ligne: Ligne = {
      id,
      ferme_id: ctx.fermeId,
      espece_id: origine?.especeId ?? saisie.especeId,
      variete_id: origine?.varieteId ?? null,
      nom: saisie.nom.trim(),
      mode: saisie.mode,
      parametres: JSON.stringify(p.valeur),
    };
    return ligneValidee(ligne, types);
  }, [lectureSeule, saisie, base, id, ctx.fermeId, origine, types]);

  function changer(f: (s: Saisie) => Saisie): void {
    setErreur(null);
    setSaisie(f);
  }

  function changerTravail(cle: number, f: (t: SaisieTravail) => SaisieTravail): void {
    changer((s) => ({ ...s, travaux: s.travaux.map((t) => (t.cle === cle ? f(t) : t)) }));
  }

  function choisirMode(mode: ModeItineraire): void {
    // Plant acheté ou maison : des plants à l'écartement, jamais à la volée.
    changer((s) => ({ ...s, mode, facon: mode === 'semis_direct' ? s.facon : 'ecartement' }));
  }

  async function ecrireModification(seriesIds: readonly string[], ligne: Ligne): Promise<void> {
    if (origine === null) return;
    setOccupe(true);
    try {
      const avant = await modifierItineraire(
        ctx,
        origine.id,
        { nom: String(ligne.nom), mode: String(ligne.mode), parametres: String(ligne.parametres) },
        seriesIds,
        types,
      );
      surEnregistre({ texte: String(ligne.nom), annuler: () => ramener(ctx, avant, types) });
      surFermer();
    } catch (e) {
      console.error('Itinéraire non enregistré', e);
      setErreur(e instanceof EcritureRefusee ? `Rien n’a été enregistré : ${e.message}.` : 'Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');
      setConfirmer(null);
      setOccupe(false);
    }
  }

  async function enregistrer(): Promise<void> {
    if (construite?.ok !== true || occupe) return;
    const ligne = construite.valeur;
    if (origine === null || depart.sorte === 'adaptation') {
      setOccupe(true);
      try {
        const nouveau = await creerItineraire(ctx, ligne, types);
        surEnregistre({ texte: String(ligne.nom), annuler: () => supprimerItineraire(ctx, nouveau, types) });
        surFermer();
      } catch (e) {
        console.error('Itinéraire non enregistré', e);
        setErreur(e instanceof EcritureRefusee ? `Rien n’a été enregistré : ${e.message}.` : 'Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');
        setOccupe(false);
      }
      return;
    }
    // Seul le nom change : l'itinéraire seul, sans question.
    const avant = parametresNormalises(ligneOrigine(origine, ctx.fermeId));
    const apres = JSON.parse(String(ligne.parametres)) as unknown;
    if (!egauxJson(avant, apres) || origine.mode !== ligne.mode) {
      setOccupe(true);
      let series: SerieAVenir[];
      try {
        series = await lireSeriesAVenir(ctx.porte, ctx.fermeId, origine.id, aujourdhui);
      } catch (e) {
        console.error('Séries à venir illisibles', e);
        setErreur('Les séries de cet itinéraire n’ont pas pu se lire : rien n’a été enregistré.');
        setOccupe(false);
        return;
      }
      setOccupe(false);
      if (series.length > 0) {
        setConfirmer(series);
        return;
      }
    }
    await ecrireModification([], ligne);
  }

  function enregistrerAvec(appliquer: boolean): void {
    if (construite?.ok !== true || confirmer === null) return;
    void ecrireModification(appliquer ? confirmer.map((s) => s.id) : [], construite.valeur);
  }

  function ajouterTravail(): void {
    changer((s) => ({ ...s, travaux: [...s.travaux, nouveauTravail()] }));
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────────────────────

  const nomEspece = especes.find((e) => e.id === (origine?.especeId ?? saisie.especeId))?.nom ?? 'Culture inconnue';
  const d = calcul.dates;
  const peutEnregistrer = construite?.ok === true && !occupe;
  const aide = construite !== null && !construite.ok ? construite.message : null;
  const libellesTypes = new Map(types.map((t) => [cleType(t.categorie, t.libelle), t.libelle]));

  return (
    <div className="itin-voile itin-voile-formulaire">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-testid="formulaire-itineraire"
        className="itin-feuille"
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape' && confirmer === null) {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <header className="itin-tete">
          <span className="itin-surtitre">{lectureSeule ? 'Bibliothèque commune · lecture seule' : depart.sorte === 'adaptation' ? 'Copie pour ma ferme' : 'Ma façon de cultiver'}</span>
          <h2 ref={titre} id={idTitre} tabIndex={-1}>
            {TITRES[depart.sorte]}
          </h2>
        </header>

        <div className="itin-corps">
          <section className="itin-carte">
            <Champ
              libelle="Nom"
              valeur={saisie.nom}
              desactive={lectureSeule}
              mode="text"
              large
              surChanger={(v) => {
                changer((s) => ({ ...s, nom: v }));
              }}
            />
            {depart.sorte === 'creation' ? (
              <div className="itin-champ-bloc itin-large">
                <label htmlFor={idCulture} className="itin-etiquette">
                  Culture
                </label>
                <select
                  id={idCulture}
                  className="itin-champ itin-liste"
                  value={saisie.especeId}
                  onChange={(e) => {
                    const especeId = e.target.value;
                    changer((s) => ({ ...s, especeId }));
                  }}
                >
                  <option value="">Choisir une culture…</option>
                  {especes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nom}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p data-testid="culture-itineraire" className="itin-culture">
                <span className="itin-etiquette">Culture</span>
                <strong>{nomEspece}</strong>
              </p>
            )}
          </section>

          <section className="itin-carte">
            <span id={idMode} className="itin-etiquette">
              Mode
            </span>
            <div role="radiogroup" aria-labelledby={idMode} className="itin-modes">
              {MODES.map((m) => (
                <label key={m} className={`itin-mode${saisie.mode === m ? ' itin-mode-choisi' : ''}${lectureSeule ? ' itin-mode-inactif' : ''}`}>
                  <input
                    type="radio"
                    name={idMode}
                    value={m}
                    checked={saisie.mode === m}
                    disabled={lectureSeule}
                    onChange={() => {
                      choisirMode(m);
                    }}
                  />
                  <span>{LIBELLES_MODES[m]}</span>
                </label>
              ))}
            </div>
            <div className="itin-grille">
              {saisie.mode === 'plant_maison' && (
                <Champ
                  libelle="Pépinière (jours)"
                  valeur={saisie.pepiniere}
                  desactive={lectureSeule}
                  suffixe="j"
                  surChanger={(v) => {
                    changer((s) => ({ ...s, pepiniere: v }));
                  }}
                />
              )}
              <Champ
                libelle="Avant récolte (jours)"
                valeur={saisie.avantRecolte}
                desactive={lectureSeule}
                suffixe="j"
                surChanger={(v) => {
                  changer((s) => ({ ...s, avantRecolte: v }));
                }}
              />
              <Champ
                libelle="Récolte (jours)"
                valeur={saisie.recolte}
                desactive={lectureSeule}
                suffixe="j"
                surChanger={(v) => {
                  changer((s) => ({ ...s, recolte: v }));
                }}
              />
            </div>
          </section>

          <section className="itin-carte">
            <span className="itin-etiquette itin-titre-carte">Densité</span>
            <div className="itin-grille">
              {saisie.mode === 'semis_direct' && (
                <Liste
                  libelle="Façon"
                  valeur={saisie.facon}
                  desactive={lectureSeule}
                  large
                  surChanger={(v) => {
                    const facon = FACONS.find((f) => f.valeur === v)?.valeur ?? 'ecartement';
                    changer((s) => ({ ...s, facon }));
                  }}
                >
                  {FACONS.map((f) => (
                    <option key={f.valeur} value={f.valeur}>
                      {f.libelle}
                    </option>
                  ))}
                </Liste>
              )}
              {(saisie.mode !== 'semis_direct' || saisie.facon !== 'volee') && (
                <Champ
                  libelle="Rangs par planche"
                  valeur={saisie.rangs}
                  desactive={lectureSeule}
                  surChanger={(v) => {
                    changer((s) => ({ ...s, rangs: v }));
                  }}
                />
              )}
              {(saisie.mode !== 'semis_direct' || saisie.facon === 'ecartement') && (
                <Champ
                  libelle="Écartement sur le rang (cm)"
                  valeur={saisie.ecartement}
                  desactive={lectureSeule}
                  mode="decimal"
                  suffixe="cm"
                  surChanger={(v) => {
                    changer((s) => ({ ...s, ecartement: v }));
                  }}
                />
              )}
              {saisie.mode === 'semis_direct' && saisie.facon === 'metre_lineaire' && (
                <Champ
                  libelle="Graines par mètre"
                  valeur={saisie.grainesParMetre}
                  desactive={lectureSeule}
                  mode="decimal"
                  surChanger={(v) => {
                    changer((s) => ({ ...s, grainesParMetre: v }));
                  }}
                />
              )}
              {saisie.mode === 'semis_direct' && saisie.facon === 'volee' && (
                <>
                  <Champ
                    libelle="Largeur semée (cm)"
                    valeur={saisie.largeur}
                    desactive={lectureSeule}
                    mode="decimal"
                    suffixe="cm"
                    surChanger={(v) => {
                      changer((s) => ({ ...s, largeur: v }));
                    }}
                  />
                  <Champ
                    libelle="Dose (g/m²)"
                    valeur={saisie.dose}
                    desactive={lectureSeule}
                    mode="decimal"
                    surChanger={(v) => {
                      changer((s) => ({ ...s, dose: v }));
                    }}
                  />
                </>
              )}
            </div>
          </section>

          <section aria-labelledby={idTravaux} className="itin-carte">
            <h3 id={idTravaux} className="itin-etiquette itin-titre-carte">
              Travaux prévus
            </h3>
            {saisie.travaux.length === 0 && <p className="itin-aide">Aucun travail prévu. Ajoute la grelinette, le désherbage… : ils apparaîtront dans Aujourd’hui pour chaque série.</p>}
            {saisie.travaux.map((t, i) => (
              <TravailPrevuSaisi
                key={t.cle}
                indice={i}
                travail={t}
                mode={saisie.mode}
                types={types}
                dates={calcul.travaux[i] ?? null}
                lectureSeule={lectureSeule}
                surChanger={(f) => {
                  changerTravail(t.cle, f);
                }}
                surRetirer={() => {
                  changer((s) => ({ ...s, travaux: s.travaux.filter((x) => x.cle !== t.cle) }));
                }}
              />
            ))}
            {!lectureSeule && (
              <button type="button" className="itin-bouton-ajouter" onClick={ajouterTravail}>
                <Icone chemin={PLUS} />
                Ajouter un travail
              </button>
            )}
          </section>

          <section data-testid="apercu-itineraire" data-mise-en-place={calcul.ancre.date} aria-label="Aperçu" className="itin-carte itin-apercu">
            <span className="itin-etiquette itin-titre-carte">Aperçu calculé</span>
            <p className="itin-aide">
              Série d’exemple {calcul.ancre.type === 'semis' ? 'semée' : 'plantée'} le <strong>{dateLisible(calcul.ancre.date)}</strong>
            </p>
            {d === null ? (
              <p className="itin-aide">Les dates s’afficheront dès que les durées seront remplies.</p>
            ) : (
              <div className="itin-etapes">
                {ETAPES.map((e) => {
                  const date = d[e.cle];
                  if (date === undefined) return null;
                  return (
                    <div key={e.cle} data-testid="apercu-etape" data-etape={e.cle} data-date={date} className={`itin-etape itin-etape-${e.cle}`}>
                      <i aria-hidden="true" />
                      <span>{e.cle === 'miseEnPlace' && saisie.mode === 'semis_direct' ? 'Semis en place' : e.libelle}</span>
                      <strong>{dateCourte(date)}</strong>
                    </div>
                  );
                })}
              </div>
            )}
            {saisie.travaux.some((t) => t.type !== null) && (
              <ul className="itin-apercu-travaux">
                {saisie.travaux.map((t, i) => {
                  if (t.categorie === null || t.type === null) return null;
                  const dates = calcul.travaux[i] ?? null;
                  return (
                    <li key={t.cle} data-testid="apercu-travail" data-indice={i} data-dates={dates === null ? '' : dates.join(',')} className={dates !== null && dates.length === 0 ? 'itin-apercu-jamais' : undefined}>
                      <strong>{libellesTypes.get(cleType(t.categorie, t.type)) ?? t.type}</strong>
                      <span>{dates === null ? 'à compléter' : dates.length === 0 ? 'ne tombe jamais' : dates.map(dateCourte).join(' · ')}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="itin-pied">
          {erreur !== null && (
            <p role="alert" className="itin-erreur">
              {erreur}
            </p>
          )}
          {erreur === null && aide !== null && <p className="itin-aide itin-aide-pied">{aide}</p>}
          <div className="itin-actions">
            <button type="button" className="itin-bouton-secondaire" onClick={surFermer}>
              Fermer
            </button>
            {lectureSeule && origine !== null ? (
              <button
                type="button"
                className="itin-bouton-principal"
                onClick={() => {
                  surAdapter(origine);
                }}
              >
                Adapter pour ma ferme
              </button>
            ) : (
              <button type="button" className="itin-bouton-principal" disabled={!peutEnregistrer} onClick={() => void enregistrer()}>
                Enregistrer
              </button>
            )}
          </div>
        </footer>
      </div>

      {confirmer !== null && (
        <ConfirmationSeries
          series={confirmer}
          occupe={occupe}
          surAppliquer={() => {
            enregistrerAvec(true);
          }}
          surSeul={() => {
            enregistrerAvec(false);
          }}
          surRevenir={() => {
            setConfirmer(null);
          }}
        />
      )}
    </div>
  );
}
