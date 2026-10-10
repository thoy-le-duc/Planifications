/**
 * Écran « Mes itinéraires et mes types d'intervention » (T24). Chargé à la demande depuis l'onglet
 * Ferme ; il reçoit la porte (ni PowerSync, ni src/donnees). Contrat : ./test/contrat.ts.
 *
 * Itinéraires par culture : ceux de la ferme se modifient, ceux de la bibliothèque commune se
 * consultent et s'adaptent (copie écrite à l'enregistrement seulement). Types d'intervention de
 * la ferme : ajouter, renommer (s'il n'est pas utilisé), masquer. Chaque enregistrement s'annule
 * pendant 10 s (bandeau « Annuler »), en une transaction, même hors ligne.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { validerTypeIntervention, type CategorieIntervention } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import './itineraires.css';
import { CATEGORIES, cleType, comparerNoms, resumeItineraire, typesUtilises, type EspeceLue, type ItineraireLu, type TypeLu } from './calculs.ts';
import { requeteEspeces, requeteItineraires, requeteTypes } from './donnees.ts';
import { ajouterType, EcritureRefusee, modifierType, nouvelId, ramener, supprimerType, type ContexteEcriture } from './ecritures.ts';
import { CROIX, FormulaireItineraire, garderLeFocus, type DepartFormulaire, type SaisieAnnulable } from './FormulaireItineraire.tsx';

/** Marque de performance posée quand les listes de l'écran sont dessinées. */
export const MARQUE_ITINERAIRES_AFFICHES = 'planif:itineraires-affiches';

/** T32c : le réglage de croissance, chargé au premier tap sur « Croissance » (morceau à part). */
const chargerReglage = () => import('./ReglageCroissance.tsx');
type ReglageCharge = Awaited<ReturnType<typeof chargerReglage>>['ReglageCroissance'];

/** Durée d'affichage du bandeau « Annuler » (comme T12 et T13). */
export const DELAI_ANNULATION_MS = 10_000;

export interface ProprietesEcranItineraires {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /**
   * T32c : utilisateur du téléphone ; son rôle dans la ferme (ligne locale `membre`) décide si le
   * réglage de croissance est modifiable (gérant) ou en lecture seule. Absent : lecture seule.
   */
  readonly utilisateurId?: string;
  readonly surFermer: () => void;
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

const LIBELLE_CATEGORIE: Readonly<Record<CategorieIntervention, string>> = Object.fromEntries(CATEGORIES.map((c) => [c.valeur, c.libelle])) as Record<
  CategorieIntervention,
  string
>;

type Verification = { readonly ok: true; readonly libelle: string } | { readonly ok: false; readonly message: string };

/**
 * Libellé d'un type, AVANT tout envoi : normalisé par le cœur (validerTypeIntervention : NFC,
 * espaces de bord rognés, caractères invisibles refusés, 30 caractères au plus), puis refusé s'il
 * existe déjà dans la catégorie, sans tenir compte de la casse (lui-même exclu).
 */
function verifierLibelle(brut: string, categorie: CategorieIntervention, types: readonly TypeLu[], ctx: ContexteEcriture, sauf: string | null): Verification {
  const r = validerTypeIntervention({ id: nouvelId(ctx.maintenant), ferme_id: ctx.fermeId, categorie, libelle: brut, masque: 0 });
  if (!r.ok) {
    if (r.erreur.code === 'trop_long') return { ok: false, message: '30 caractères au plus : raccourcis le libellé.' };
    if (r.erreur.message.includes('caractère')) return { ok: false, message: 'Ce libellé contient un caractère invisible ou interdit : retape-le.' };
    return { ok: false, message: 'Écris un libellé.' };
  }
  const libelle = r.valeur.libelle;
  const bas = libelle.toLocaleLowerCase('fr');
  const double = types.find((t) => t.id !== sauf && t.categorie === categorie && t.libelle.toLocaleLowerCase('fr') === bas);
  if (double !== undefined) {
    return { ok: false, message: `« ${double.libelle} » existe déjà en ${LIBELLE_CATEGORIE[categorie].toLocaleLowerCase('fr')}${double.masque ? ' (masqué : affiche-le plutôt)' : ''}.` };
  }
  return { ok: true, libelle };
}

const messageEchec = (e: unknown): string => (e instanceof EcritureRefusee ? `Rien n’a été enregistré : ${e.message}.` : 'Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');

function Icone({ chemin, taille = 22 }: { readonly chemin: string; readonly taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={chemin} />
    </svg>
  );
}

const PLUS = 'M12 5v14M5 12h14';

/** T32g : nom rapproché comme le cœur rapproche les noms (sans casse, sans accents, espaces en trop retirés). */
const rapprocher = (nom: string): string =>
  nom
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const CHEVRON = 'M9 6l6 6-6 6';
const COPIE = 'M9 9h10v10H9zM5 15V5h10';

// ── Renommer un type ─────────────────────────────────────────────────────────────────────────

interface ProprietesRenommer {
  readonly type: TypeLu;
  readonly types: readonly TypeLu[];
  readonly ctx: ContexteEcriture;
  readonly surFermer: () => void;
  readonly surEnregistre: (s: SaisieAnnulable) => void;
}

function RenommerType({ type, types, ctx, surFermer, surEnregistre }: ProprietesRenommer) {
  const idTitre = useId();
  const idChamp = useId();
  const champ = useRef<HTMLInputElement>(null);
  const [libelle, setLibelle] = useState(type.libelle);
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    champ.current?.focus();
  }, []);

  async function enregistrer(): Promise<void> {
    const v = verifierLibelle(libelle, type.categorie, types, ctx, type.id);
    if (!v.ok) {
      setMessage(v.message);
      return;
    }
    setOccupe(true);
    try {
      const avant = await modifierType(ctx, type.id, { libelle: v.libelle });
      surEnregistre({ texte: v.libelle, annuler: () => ramener(ctx, avant) });
      surFermer();
    } catch (e) {
      console.error('Type non renommé', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  return (
    <div className="itin-voile-confirmation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        className="itin-confirmation"
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape') {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <h3 id={idTitre}>Renommer « {type.libelle} »</h3>
        <div className="itin-champ-bloc itin-large">
          <label htmlFor={idChamp} className="itin-etiquette">
            Libellé
          </label>
          <input
            ref={champ}
            id={idChamp}
            type="text"
            autoComplete="off"
            className="itin-champ"
            value={libelle}
            onChange={(e) => {
              setLibelle(e.target.value);
              setMessage(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void enregistrer();
            }}
          />
        </div>
        {message !== null && (
          <p role="alert" className="itin-erreur">
            {message}
          </p>
        )}
        <div className="itin-confirmation-actions">
          <button type="button" className="itin-bouton-principal" disabled={occupe || libelle.trim() === ''} onClick={() => void enregistrer()}>
            Enregistrer
          </button>
          <button type="button" className="itin-bouton-secondaire" onClick={surFermer}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Écran ────────────────────────────────────────────────────────────────────────────────────

interface Bandeau extends SaisieAnnulable {
  readonly numero: number;
}

export function EcranItineraires({ porte, fermeId, utilisateurId, surFermer, aujourdhui = jourDuTelephone, maintenant = maintenantParDefaut }: ProprietesEcranItineraires): ReactElement {
  const [jour] = useState(aujourdhui);
  const [itineraires, setItineraires] = useState<ItineraireLu[] | null>(null);
  const [especes, setEspeces] = useState<EspeceLue[] | null>(null);
  const [types, setTypes] = useState<TypeLu[] | null>(null);
  const [depart, setDepart] = useState<(DepartFormulaire & { readonly numero: number }) | null>(null);
  const [renommer, setRenommer] = useState<TypeLu | null>(null);
  /** T32c : espèce dont le réglage de croissance est ouvert, et le réglage une fois chargé. */
  const [croissance, setCroissance] = useState<string | null>(null);
  const [Reglage, setReglage] = useState<{ readonly composant: ReglageCharge } | null>(null);
  /** T32g : gérant actif de la ferme (seul à personnaliser une espèce), et personnalisation en cours. */
  const [gerant, setGerant] = useState(false);
  const [enCopie, setEnCopie] = useState(false);
  const [bandeau, setBandeau] = useState<Bandeau | null>(null);
  const [echec, setEchec] = useState<{ readonly titre: string; readonly texte: string } | null>(null);
  const [categorie, setCategorie] = useState<CategorieIntervention>('entretien');
  const [nouveau, setNouveau] = useState('');
  const [messageType, setMessageType] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const idTitre = useId();
  const idItineraires = useId();
  const idTypes = useId();
  const idCategorie = useId();
  const idNouveau = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const marquee = useRef(false);
  const compteur = useRef(0);

  const ctx: ContexteEcriture = useMemo(() => ({ porte, fermeId, maintenant }), [porte, fermeId, maintenant]);

  // Listes surveillées : l'écran suit ses écritures et celles de la synchro.
  useEffect(() => porte.surveiller(requeteItineraires(fermeId), setItineraires), [porte, fermeId]);
  useEffect(() => porte.surveiller(requeteEspeces(fermeId), setEspeces), [porte, fermeId]);
  useEffect(
    () =>
      porte.surveiller(requeteTypes(fermeId), (l) => {
        setTypes(l.filter((t): t is TypeLu => t !== null));
      }),
    [porte, fermeId],
  );

  useEffect(() => {
    if (utilisateurId === undefined) return undefined;
    let actif = true;
    porte
      .lire(`SELECT 1 AS n FROM membre WHERE utilisateur_id = ? AND ferme_id = ? AND role = 'gerant' AND etat = 'accepte' AND supprime_le IS NULL`, [utilisateurId, fermeId])
      .then(
        (l) => {
          if (actif) setGerant(l.length > 0);
        },
        (e: unknown) => {
          console.error('Rôle illisible', e);
        },
      );
    return () => {
      actif = false;
    };
  }, [porte, fermeId, utilisateurId]);

  const pret = itineraires !== null && especes !== null && types !== null;
  useEffect(() => {
    titre.current?.focus();
  }, []);
  useEffect(() => {
    if (!pret || marquee.current) return;
    marquee.current = true;
    performance.mark(MARQUE_ITINERAIRES_AFFICHES);
  }, [pret]);

  // « Annuler » : DELAI_ANNULATION_MS après l'enregistrement.
  useEffect(() => {
    if (bandeau === null) return undefined;
    const minuterie = setTimeout(() => {
      setBandeau((b) => (b?.numero === bandeau.numero ? null : b));
    }, DELAI_ANNULATION_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [bandeau]);

  const especesTriees = useMemo(() => [...(especes ?? [])].sort((a, b) => comparerNoms(a.nom, b.nom) || (a.id < b.id ? -1 : 1)), [especes]);
  const parCulture = useMemo(() => {
    const liste = itineraires ?? [];
    return especesTriees.flatMap((e) => {
      const siens = liste.filter((i) => i.especeId === e.id);
      // Q40 : toute espèce de la ferme a son groupe, même sans itinéraire ; celles de la bibliothèque seulement si elles en ont.
      if (siens.length === 0 && e.fermeId === null) return [];
      const trier = (a: ItineraireLu, b: ItineraireLu) => comparerNoms(a.nom, b.nom) || (a.id < b.id ? -1 : 1);
      return [{ espece: e, ferme: siens.filter((i) => i.fermeId !== null).sort(trier), bibliotheque: siens.filter((i) => i.fermeId === null).sort(trier) }];
    });
  }, [itineraires, especesTriees]);
  /** T32g : espèce de la ferme par nom rapproché (la copie d'une espèce de la bibliothèque garde son nom). */
  const deLaFerme = useMemo(() => new Map(especesTriees.filter((e) => e.fermeId !== null).map((e) => [rapprocher(e.nom), e.id] as const)), [especesTriees]);
  const utilises = useMemo(() => typesUtilises(itineraires ?? []), [itineraires]);

  function enregistre(s: SaisieAnnulable): void {
    compteur.current += 1;
    setEchec(null);
    setBandeau({ ...s, numero: compteur.current });
  }

  function ouvrir(d: DepartFormulaire): void {
    compteur.current += 1;
    setDepart({ ...d, numero: compteur.current });
  }

  function ouvrirCroissance(especeId: string): void {
    setCroissance(especeId);
    if (Reglage !== null) return;
    chargerReglage().then(
      (m) => {
        setReglage({ composant: m.ReglageCroissance });
      },
      (e: unknown) => {
        console.error('Réglage de croissance non chargé', e);
        setCroissance(null);
        setEchec({ titre: 'Réglage indisponible', texte: 'Le réglage de croissance ne s’est pas chargé : réessaie avec du réseau.' });
      },
    );
  }

  /** T32g : copie de l'espèce de la bibliothèque écrite par la porte, puis son réglage ouvert. */
  async function personnaliser(espece: EspeceLue): Promise<void> {
    if (enCopie) return;
    setEnCopie(true);
    try {
      ouvrirCroissance(await porte.personnaliserEspece(espece.id));
    } catch (e) {
      console.error('Espèce non personnalisée', e);
      setBandeau(null);
      setEchec({ titre: 'Rien n’a été copié', texte: e instanceof Error ? e.message : 'la base du téléphone a refusé l’écriture.' });
    } finally {
      setEnCopie(false);
    }
  }

  function annuler(b: Bandeau): void {
    setBandeau(null);
    b.annuler().then(
      (laisse) => {
        if (laisse !== null) setEchec({ titre: 'Annulation incomplète', texte: `« ${b.texte} » : ${laisse}.` });
      },
      (e: unknown) => {
        console.error('Annulation impossible', e);
        setEchec({ titre: 'Annulation impossible', texte: `« ${b.texte} » reste enregistré tel quel : ${e instanceof EcritureRefusee ? e.message : 'la base du téléphone a refusé l’écriture'}.` });
      },
    );
  }

  async function ajouter(): Promise<void> {
    if (types === null || occupe) return;
    const v = verifierLibelle(nouveau, categorie, types, ctx, null);
    if (!v.ok) {
      setMessageType(v.message);
      return;
    }
    setOccupe(true);
    try {
      const id = await ajouterType(ctx, categorie, v.libelle);
      setNouveau('');
      setMessageType(null);
      enregistre({ texte: v.libelle, annuler: () => supprimerType(ctx, id) });
    } catch (e) {
      console.error('Type non ajouté', e);
      setMessageType(messageEchec(e));
    } finally {
      setOccupe(false);
    }
  }

  async function basculerMasque(t: TypeLu): Promise<void> {
    if (types === null || occupe) return;
    setOccupe(true);
    try {
      const avant = await modifierType(ctx, t.id, { masque: t.masque ? 0 : 1 });
      enregistre({ texte: t.libelle, annuler: () => ramener(ctx, avant) });
    } catch (e) {
      console.error('Type non modifié', e);
      setMessageType(messageEchec(e));
    } finally {
      setOccupe(false);
    }
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────────────────────

  const listeTypes = types ?? [];
  // T32c : l'espèce du réglage, relue dans la liste surveillée (le profil suit les écritures et la synchro).
  const especeCroissance = croissance === null ? undefined : especesTriees.find((e) => e.id === croissance);

  return (
    <>
      <div className="itin-voile">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitre}
          data-testid="ecran-itineraires"
          className="itin-feuille"
          onKeyDown={(e) => {
            if (depart !== null || renommer !== null || croissance !== null) return;
            garderLeFocus(e);
            if (e.key === 'Escape') surFermer();
          }}
        >
          <header className="itin-tete itin-tete-ecran">
            <span className="itin-tete-textes">
              <span className="itin-surtitre">Ferme · ma façon de cultiver</span>
              <h2 ref={titre} id={idTitre} tabIndex={-1}>
                Mes itinéraires
              </h2>
            </span>
            <button type="button" aria-label="Fermer" className="itin-bouton-fermer" onClick={surFermer}>
              <Icone chemin={CROIX} />
            </button>
          </header>

          <div className="itin-corps">
            {!pret ? (
              <p className="itin-aide itin-chargement">Lecture des itinéraires…</p>
            ) : (
              <>
                <section aria-labelledby={idItineraires} className="itin-section">
                  <div className="itin-section-tete">
                    <h3 id={idItineraires}>Itinéraires</h3>
                    <button
                      type="button"
                      className="itin-bouton-nouveau"
                      onClick={() => {
                        ouvrir({ sorte: 'creation' });
                      }}
                    >
                      <Icone chemin={PLUS} />
                      Nouvel itinéraire
                    </button>
                  </div>
                  {parCulture.length === 0 && <p className="itin-aide">Aucun itinéraire pour l’instant : crée le premier, ou attends la synchronisation de la bibliothèque.</p>}
                  {parCulture.map(({ espece, ferme, bibliotheque }) => {
                    const copie = espece.fermeId === null && gerant ? deLaFerme.get(rapprocher(espece.nom)) : undefined;
                    return (
                      <div key={espece.id} data-testid="culture-itineraires" data-espece={espece.id} className="itin-culture-groupe">
                        <div className="itin-culture-tete">
                          <h4>
                            {espece.nom}
                            <span>
                              {ferme.length} de la ferme · {bibliotheque.length} de la bibliothèque
                              {copie !== undefined && ' · déjà personnalisée'}
                            </span>
                          </h4>
                          <button
                            type="button"
                            aria-label={`Croissance de ${espece.nom}`}
                            className="itin-bouton-croissance"
                            onClick={() => {
                              ouvrirCroissance(espece.id);
                            }}
                          >
                            Croissance
                          </button>
                          {espece.fermeId === null && gerant && (
                            <button
                              type="button"
                              aria-label={copie === undefined ? `Personnaliser ${espece.nom}` : `Régler ma copie de ${espece.nom}`}
                              className="itin-bouton-croissance"
                              disabled={enCopie}
                              onClick={() => {
                                if (copie === undefined) void personnaliser(espece);
                                else ouvrirCroissance(copie);
                              }}
                            >
                              {copie === undefined ? 'Personnaliser' : 'Ma copie'}
                            </button>
                          )}
                        </div>
                        {ferme.length === 0 && bibliotheque.length === 0 && <p className="itin-aide">Aucun itinéraire</p>}
                        <ul>
                          {ferme.map((i) => (
                            <li key={i.id} data-testid="itineraire" data-itineraire={i.id} data-origine="ferme" className="itin-item">
                              <button
                                type="button"
                                aria-label={`Modifier ${i.nom}`}
                                className="itin-item-bouton"
                                onClick={() => {
                                  ouvrir({ sorte: 'modification', itineraire: i });
                                }}
                              >
                                <span className="itin-item-textes">
                                  <strong>{i.nom}</strong>
                                  <span>{resumeItineraire(i)}</span>
                                </span>
                                <span className="itin-item-action">
                                  Modifier
                                  <Icone chemin={CHEVRON} taille={18} />
                                </span>
                              </button>
                            </li>
                          ))}
                          {bibliotheque.map((i) => (
                            <li key={i.id} data-testid="itineraire" data-itineraire={i.id} data-origine="bibliotheque" className="itin-item itin-item-bibliotheque">
                              <button
                                type="button"
                                aria-label={`Voir ${i.nom}`}
                                className="itin-item-bouton"
                                onClick={() => {
                                  ouvrir({ sorte: 'lecture', itineraire: i });
                                }}
                              >
                                <span className="itin-item-textes">
                                  <strong>
                                    {i.nom}
                                    <em className="itin-pastille">Bibliothèque</em>
                                  </strong>
                                  <span>{resumeItineraire(i)}</span>
                                </span>
                                <span className="itin-item-action">
                                  Voir
                                  <Icone chemin={CHEVRON} taille={18} />
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label={`Adapter pour ma ferme : ${i.nom}`}
                                className="itin-bouton-adapter"
                                onClick={() => {
                                  ouvrir({ sorte: 'adaptation', itineraire: i });
                                }}
                              >
                                <Icone chemin={COPIE} taille={20} />
                                Adapter pour ma ferme
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </section>

                <section aria-labelledby={idTypes} className="itin-section">
                  <div className="itin-section-tete">
                    <h3 id={idTypes}>Types d’intervention</h3>
                  </div>
                  <p className="itin-aide">Un type utilisé par un itinéraire ne se renomme pas : masque-le, il reste sur les travaux qui l’ont déjà.</p>
                  <div className="itin-carte itin-ajout-type">
                    <div className="itin-grille">
                      <div className="itin-champ-bloc">
                        <label htmlFor={idCategorie} className="itin-etiquette">
                          Catégorie
                        </label>
                        <select
                          id={idCategorie}
                          className="itin-champ itin-liste"
                          value={categorie}
                          onChange={(e) => {
                            const c = CATEGORIES.find((x) => x.valeur === e.target.value)?.valeur ?? 'entretien';
                            setCategorie(c);
                            setMessageType(null);
                          }}
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c.valeur} value={c.valeur}>
                              {c.libelle}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="itin-champ-bloc">
                        <label htmlFor={idNouveau} className="itin-etiquette">
                          Nouveau type
                        </label>
                        <input
                          id={idNouveau}
                          type="text"
                          autoComplete="off"
                          placeholder="écimage, bâche…"
                          className="itin-champ"
                          value={nouveau}
                          onChange={(e) => {
                            setNouveau(e.target.value);
                            setMessageType(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void ajouter();
                          }}
                        />
                      </div>
                    </div>
                    {messageType !== null && (
                      <p role="alert" className="itin-erreur">
                        {messageType}
                      </p>
                    )}
                    <button type="button" className="itin-bouton-ajouter" disabled={nouveau.trim() === '' || occupe} onClick={() => void ajouter()}>
                      <Icone chemin={PLUS} />
                      Ajouter le type
                    </button>
                  </div>

                  {CATEGORIES.map((c) => {
                    const siens = listeTypes.filter((t) => t.categorie === c.valeur).sort((a, b) => comparerNoms(a.libelle, b.libelle) || (a.id < b.id ? -1 : 1));
                    const ferme = siens.filter((t) => t.fermeId !== null);
                    const listeDepart = siens.filter((t) => t.fermeId === null);
                    if (siens.length === 0) return null;
                    return (
                      <div key={c.valeur} className="itin-categorie">
                        <h4>{c.libelle}</h4>
                        {ferme.length > 0 && (
                          <ul className="itin-types-ferme">
                            {ferme.map((t) => {
                              const utilise = utilises.has(cleType(t.categorie, t.libelle));
                              return (
                                <li
                                  key={t.id}
                                  data-testid="type-intervention"
                                  data-type={t.id}
                                  data-origine="ferme"
                                  data-masque={t.masque ? 'oui' : 'non'}
                                  data-utilise={utilise ? 'oui' : 'non'}
                                  className={`itin-type${t.masque ? ' itin-type-masque' : ''}`}
                                >
                                  <span className="itin-type-textes">
                                    <strong>{t.libelle}</strong>
                                    <span>
                                      {utilise ? 'utilisé' : 'pas utilisé'}
                                      {t.masque ? ' · masqué' : ''}
                                    </span>
                                  </span>
                                  <span className="itin-type-actions">
                                    {!utilise && (
                                      <button
                                        type="button"
                                        aria-label={`Renommer ${t.libelle}`}
                                        className="itin-bouton-leger"
                                        onClick={() => {
                                          setRenommer(t);
                                        }}
                                      >
                                        Renommer
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      aria-label={`${t.masque ? 'Afficher' : 'Masquer'} ${t.libelle}`}
                                      className="itin-bouton-leger"
                                      disabled={occupe}
                                      onClick={() => void basculerMasque(t)}
                                    >
                                      {t.masque ? 'Afficher' : 'Masquer'}
                                    </button>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {listeDepart.length > 0 && (
                          <ul className="itin-types-depart">
                            {listeDepart.map((t) => {
                              const utilise = utilises.has(cleType(t.categorie, t.libelle));
                              return (
                                <li
                                  key={t.id}
                                  data-testid="type-intervention"
                                  data-type={t.id}
                                  data-origine="depart"
                                  data-masque={t.masque ? 'oui' : 'non'}
                                  data-utilise={utilise ? 'oui' : 'non'}
                                  className={`itin-puce${utilise ? ' itin-puce-utilisee' : ''}`}
                                >
                                  {t.libelle}
                                  {utilise && <span className="itin-invisible"> (utilisé)</span>}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </div>

          {bandeau !== null && (
            <div key={bandeau.numero} data-testid="saisie-annulable" role="status" className="itin-bandeau">
              <span className="itin-bandeau-texte">
                <strong>Enregistré</strong>
                <span>{bandeau.texte}</span>
              </span>
              <button
                type="button"
                className="itin-bandeau-annuler"
                onClick={() => {
                  annuler(bandeau);
                }}
              >
                Annuler
              </button>
              <span aria-hidden="true" className="itin-bandeau-temps" />
            </div>
          )}
          {echec !== null && bandeau === null && (
            <div role="alert" className="itin-bandeau itin-bandeau-echec">
              <span className="itin-bandeau-texte">
                <strong>{echec.titre}</strong>
                <span>{echec.texte}</span>
              </span>
              <button
                type="button"
                className="itin-bandeau-annuler"
                onClick={() => {
                  setEchec(null);
                }}
              >
                OK
              </button>
            </div>
          )}
        </div>
      </div>

      {depart !== null && pret && (
        <FormulaireItineraire
          key={depart.numero}
          depart={depart}
          especes={especesTriees}
          types={listeTypes}
          ctx={ctx}
          aujourdhui={jour}
          surFermer={() => {
            setDepart(null);
          }}
          surAdapter={(i) => {
            ouvrir({ sorte: 'adaptation', itineraire: i });
          }}
          surEnregistre={enregistre}
        />
      )}
      {especeCroissance !== undefined && Reglage !== null && pret && (
        <Reglage.composant
          porte={porte}
          fermeId={fermeId}
          utilisateurId={utilisateurId}
          espece={especeCroissance}
          copie={especeCroissance.fermeId !== null && especesTriees.some((e) => e.fermeId === null && rapprocher(e.nom) === rapprocher(especeCroissance.nom))}
          surFermer={() => {
            setCroissance(null);
          }}
          surEnregistre={enregistre}
          garderLeFocus={garderLeFocus}
        />
      )}
      {renommer !== null && pret && (
        <RenommerType
          type={renommer}
          types={listeTypes}
          ctx={ctx}
          surFermer={() => {
            setRenommer(null);
          }}
          surEnregistre={enregistre}
        />
      )}
    </>
  );
}

export default EcranItineraires;
