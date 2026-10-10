/**
 * T32c — réglage du profil de croissance d'une espèce, dans l'écran Itinéraires culturaux (Q39).
 * Chargé à la demande au premier tap sur « Croissance » (morceau à part : ni le démarrage, ni
 * l'affichage de l'écran Itinéraires n'embarquent les profils du cœur). Contrat :
 * ./test/contrat-croissance.ts.
 *
 * Le gérant actif de la ferme règle forme, hauteur et durée d'une espèce de SA ferme ; la valeur
 * par défaut (cœur, profilParDefaut) est affichée à côté ; « Rétablir la valeur par défaut » en un
 * tap. Tous les autres (équipier, utilisateur inconnu) et toute espèce de la bibliothèque commune :
 * lecture seule (Q35). Validation par le cœur ; écriture par la porte, que le serveur contrôle.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { FORMES_PLANT, profilEffectif, profilParDefaut, validerProfilCroissance, type DureeCroissance, type FormePlant, type ProfilCroissance } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import type { EspeceLue } from './calculs.ts';
import { CROIX, garderLeFocus, type SaisieAnnulable } from './FormulaireItineraire.tsx';

/** Texte d'une espèce de la bibliothèque commune (Q39 ; « Personnaliser » vient avec T32g). */
export const TEXTE_ESPECE_BIBLIOTHEQUE = 'Espèce de la bibliothèque : personnalisez-la pour régler sa croissance';
const TEXTE_EQUIPIER = 'Seul le gérant de la ferme règle la croissance des espèces.';

const LIBELLE_FORME: Readonly<Record<FormePlant, string>> = {
  'erige-tuteure': 'Érigée, tuteurée',
  rosette: 'Rosette',
  touffe: 'Touffe',
  rampant: 'Rampante',
  buisson: 'Buisson',
  'arbre-ou-liane': 'Arbre ou liane',
  'bulbe-ou-racine': 'Bulbe ou racine',
};

const estForme = (v: string): v is FormePlant => (FORMES_PLANT as readonly string[]).includes(v);

/** Nombre écrit à la française : « 1,8 ». */
const enFrancais = (n: number): string => String(n).replace('.', ',');
const enMetres = (n: number): string => `${enFrancais(n)} m`;

function dureeEnTexte(d: DureeCroissance): string {
  return d.en === 'jours' ? `${String(d.jours)} jours` : `${enFrancais(Math.round(d.fraction * 100))} % du cycle`;
}

/** Valeur du champ « Durée » : les jours, ou vide pour une durée en part du cycle (gardée si le champ reste vide). */
const champDuree = (d: DureeCroissance): string => (d.en === 'jours' ? String(d.jours) : '');

/** Saisie décimale (« 1,8 » ou « 1.8 ») ; vide ou illisible : NaN, que le cœur refuse avec son message. */
function lireNombre(brut: string): number {
  const t = brut.trim().replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
}

/** Le profil réglé par la ferme (relu par le cœur), ou null s'il n'y en a pas (ou illisible). */
function profilRegle(espece: EspeceLue): ProfilCroissance | null {
  const r = validerProfilCroissance(espece.profilCroissance ?? null);
  return r.ok ? r.valeur : null;
}

export interface ProprietesReglageCroissance {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly utilisateurId: string | undefined;
  readonly espece: EspeceLue;
  readonly surFermer: () => void;
  /** Enregistrement fait : le bandeau « Annuler » de l'écran. */
  readonly surEnregistre: (s: SaisieAnnulable) => void;
}

/** L'utilisateur est-il gérant actif de la ferme (ligne locale `membre`) ? undefined : pas encore lu. */
function useGerant(porte: PorteDonnees, fermeId: string, utilisateurId: string | undefined): boolean | undefined {
  const [gerant, setGerant] = useState<boolean | undefined>(utilisateurId === undefined ? false : undefined);
  useEffect(() => {
    if (utilisateurId === undefined) return undefined;
    let actif = true;
    porte
      .lire<{ n: number }>(`SELECT 1 AS n FROM membre WHERE utilisateur_id = ? AND ferme_id = ? AND role = 'gerant' AND etat = 'accepte' AND supprime_le IS NULL`, [utilisateurId, fermeId])
      .then(
        (l) => {
          if (actif) setGerant(l.length > 0);
        },
        (e: unknown) => {
          console.error('Rôle illisible', e);
          if (actif) setGerant(false);
        },
      );
    return () => {
      actif = false;
    };
  }, [porte, fermeId, utilisateurId]);
  return gerant;
}

export function ReglageCroissance({ porte, fermeId, utilisateurId, espece, surFermer, surEnregistre }: ProprietesReglageCroissance): ReactElement | null {
  const gerant = useGerant(porte, fermeId, utilisateurId);
  // Rien tant que le rôle n'est pas lu (base locale : quelques millisecondes) : jamais de champs actifs à tort.
  if (gerant === undefined) return null;
  const deLaFerme = espece.fermeId === fermeId;
  return <Reglage porte={porte} espece={espece} modifiable={gerant && deLaFerme} bibliotheque={espece.fermeId === null} surFermer={surFermer} surEnregistre={surEnregistre} />;
}

interface ProprietesReglage {
  readonly porte: PorteDonnees;
  readonly espece: EspeceLue;
  readonly modifiable: boolean;
  readonly bibliotheque: boolean;
  readonly surFermer: () => void;
  readonly surEnregistre: (s: SaisieAnnulable) => void;
}

function Reglage({ porte, espece, modifiable, bibliotheque, surFermer, surEnregistre }: ProprietesReglage): ReactElement {
  const idTitre = useId();
  const idForme = useId();
  const idHauteur = useId();
  const idDuree = useId();
  const premier = useRef<HTMLHeadingElement>(null);
  const defaut = profilParDefaut(espece.nom).profil;
  const regle = profilRegle(espece);
  const effectif = profilEffectif({ nom: espece.nom, profilCroissance: espece.profilCroissance ?? null });

  const [forme, setForme] = useState<FormePlant>(effectif.forme);
  const [hauteur, setHauteur] = useState(enFrancais(effectif.hauteurMaxM));
  const [duree, setDuree] = useState(champDuree(effectif.duree));
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    premier.current?.focus();
  }, []);

  function revenirAuDefaut(): void {
    setForme(defaut.forme);
    setHauteur(enFrancais(defaut.hauteurMaxM));
    setDuree(champDuree(defaut.duree));
  }

  async function ecrire(profil: ProfilCroissance | null, texte: string): Promise<boolean> {
    const avant = regle;
    setOccupe(true);
    try {
      await porte.reglerProfilCroissance(espece.id, profil);
      surEnregistre({
        texte,
        annuler: async () => {
          await porte.reglerProfilCroissance(espece.id, avant);
          return null;
        },
      });
      return true;
    } catch (e) {
      console.error('Profil de croissance non enregistré', e);
      setMessage(`Rien n’a été enregistré : ${e instanceof Error ? e.message : 'la base du téléphone a refusé l’écriture.'}`);
      return false;
    } finally {
      setOccupe(false);
    }
  }

  async function enregistrer(): Promise<void> {
    if (occupe) return;
    // Champ vide : la durée en part du cycle est gardée ; une durée en jours vidée est refusée par le cœur.
    const jours = duree.trim() === '' && effectif.duree.en !== 'jours' ? null : lireNombre(duree);
    const saisie = {
      ...effectif,
      forme,
      hauteurMaxM: lireNombre(hauteur),
      duree: jours === null ? effectif.duree : { en: 'jours', jours },
    };
    const v = validerProfilCroissance(saisie);
    if (!v.ok || v.valeur === null) {
      setMessage(v.ok ? 'Le profil de croissance est illisible.' : v.erreur.message);
      return;
    }
    if (await ecrire(v.valeur, `Croissance de ${espece.nom}`)) surFermer();
  }

  async function retablir(): Promise<void> {
    if (occupe) return;
    if (await ecrire(null, `Croissance de ${espece.nom} : valeur par défaut`)) {
      setMessage(null);
      revenirAuDefaut();
    }
  }

  return (
    <div className="itin-voile-confirmation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-testid="reglage-croissance"
        data-espece={espece.id}
        className="itin-confirmation"
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape') {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <header className="itin-croissance-tete">
          <h3 id={idTitre} ref={premier} tabIndex={-1}>
            Croissance de {espece.nom}
          </h3>
          <button type="button" aria-label="Fermer" className="itin-bouton-fermer" onClick={surFermer}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
              <path d={CROIX} />
            </svg>
          </button>
        </header>
        <p>Pour la vue 3D : hauteur de la plante et temps pour l’atteindre. Une illustration, pas une prévision.</p>

        {modifiable ? (
          <div className="itin-croissance-champs">
            <div className="itin-champ-bloc">
              <label htmlFor={idForme} className="itin-etiquette">
                Forme
              </label>
              <select
                id={idForme}
                className="itin-champ"
                value={forme}
                onChange={(e) => {
                  if (estForme(e.target.value)) setForme(e.target.value);
                  setMessage(null);
                }}
              >
                {FORMES_PLANT.map((f) => (
                  <option key={f} value={f}>
                    {LIBELLE_FORME[f]}
                  </option>
                ))}
              </select>
              <span className="itin-aide" data-testid="defaut-forme">
                Par défaut : {LIBELLE_FORME[defaut.forme]}
              </span>
            </div>
            <div className="itin-champ-bloc">
              <label htmlFor={idHauteur} className="itin-etiquette">
                Hauteur maximale (m)
              </label>
              <span className="itin-champ-cadre">
                <input
                  id={idHauteur}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="itin-champ itin-champ-nombre"
                  value={hauteur}
                  onChange={(e) => {
                    setHauteur(e.target.value);
                    setMessage(null);
                  }}
                />
                <span className="itin-suffixe" aria-hidden="true">
                  m
                </span>
              </span>
              <span className="itin-aide" data-testid="defaut-hauteur">
                Par défaut : {enMetres(defaut.hauteurMaxM)}
              </span>
            </div>
            <div className="itin-champ-bloc">
              <label htmlFor={idDuree} className="itin-etiquette">
                Durée jusqu’à la hauteur maximale (jours)
              </label>
              <span className="itin-champ-cadre">
                <input
                  id={idDuree}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="itin-champ itin-champ-nombre"
                  placeholder={effectif.duree.en === 'jours' ? undefined : dureeEnTexte(effectif.duree)}
                  value={duree}
                  onChange={(e) => {
                    setDuree(e.target.value);
                    setMessage(null);
                  }}
                />
                <span className="itin-suffixe" aria-hidden="true">
                  j
                </span>
              </span>
              <span className="itin-aide" data-testid="defaut-duree">
                Par défaut : {dureeEnTexte(defaut.duree)}
              </span>
            </div>
          </div>
        ) : (
          <dl className="itin-croissance-lecture">
            <div>
              <dt>Forme</dt>
              <dd>{LIBELLE_FORME[effectif.forme]}</dd>
            </div>
            <div>
              <dt>Hauteur maximale</dt>
              <dd>{enMetres(effectif.hauteurMaxM)}</dd>
            </div>
            <div>
              <dt>Durée jusqu’à la hauteur maximale</dt>
              <dd>{dureeEnTexte(effectif.duree)}</dd>
            </div>
            {regle !== null && (
              <div>
                <dt>Valeur par défaut</dt>
                <dd>
                  {LIBELLE_FORME[defaut.forme]}, {enMetres(defaut.hauteurMaxM)}, {dureeEnTexte(defaut.duree)}
                </dd>
              </div>
            )}
          </dl>
        )}

        {!modifiable && <p className="itin-aide">{bibliotheque ? TEXTE_ESPECE_BIBLIOTHEQUE : TEXTE_EQUIPIER}</p>}
        {message !== null && (
          <p role="alert" className="itin-erreur">
            {message}
          </p>
        )}
        {modifiable && (
          <div className="itin-confirmation-actions itin-croissance-actions">
            <button type="button" className="itin-bouton-principal" disabled={occupe} onClick={() => void enregistrer()}>
              Enregistrer
            </button>
            <button type="button" className="itin-bouton-secondaire" disabled={occupe || regle === null} onClick={() => void retablir()}>
              Rétablir la valeur par défaut
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
