/**
 * T60 — consignes par ouvrier dans l'écran Aujourd'hui (Q36, Q44) : « Mes travaux » / « Tous »,
 * « Attribuer » (gérant, en lot par zone), « Fiche du jour » par personne, et le bandeau
 * « Annuler » d'une attribution. Chargé à la demande, une fois la journée relue : rien ici ne
 * retarde le premier affichage. Contrat : ../equipe.test.tsx.
 *
 * Tout marche hors ligne : une attribution est UNE transaction locale (./donnees.ts), annulable
 * pendant 10 s par le bandeau (l'état d'avant est réécrit, une transaction).
 */
import { useEffect, useId, useMemo, useState } from 'react';
import type { PorteDonnees } from '@planif/sync';
import { commencerEcriture } from '../../../donnees/ecritures-en-cours.ts';
import type { TravailVu } from '../vues.ts';
import { useFocusDuDialogue } from '../dialogue.ts';
import type { ModeEquipe } from '../cache.ts';
import { attribuer, type Equipe } from './donnees.ts';
import { ficheEnImage, lignesFiche } from './fiche.ts';
import './equipe.css';

/** Durée du bandeau « Annuler » d'une attribution (comme celui d'un « Fait »). */
const DELAI_ANNULATION_MS = 10_000;

export interface ProprietesConsignes {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly utilisateurId: string | undefined;
  readonly equipe: Equipe;
  /** Les travaux de l'écran (tous, marqués faits retirés), dans l'ordre de ses cartes (travauxVus). */
  readonly travaux: readonly TravailVu[];
  readonly mode: ModeEquipe;
  readonly surMode: (mode: ModeEquipe) => void;
  /** Appui long sur une carte (gérant) : la clé du travail, et un numéro qui change à chaque appui. */
  readonly demande: { readonly cle: string; readonly n: number } | null;
}

/** Prénoms des personnes d'un travail, triés, séparés par « , » ; null s'il n'est attribué à personne. */
export function prenomsDe(equipe: Equipe, cle: string): string | null {
  const ids = equipe.parTache.get(cle);
  if (ids === undefined || ids.length === 0) return null;
  const noms = ids.map((id) => equipe.personnes.find((p) => p.id === id)?.prenom).filter((p): p is string => p !== undefined);
  return noms.length === 0 ? null : noms.sort((a, b) => a.localeCompare(b, 'fr')).join(', ');
}

type Ouvert = { readonly sorte: 'attribuer'; readonly cle: string | null; readonly n: number } | { readonly sorte: 'fiche' } | null;

interface Annulable {
  readonly numero: number;
  readonly texte: string;
  readonly avant: ReadonlyMap<string, readonly string[]>;
}

export function Consignes({ porte, fermeId, utilisateurId, equipe, travaux, mode, surMode, demande }: ProprietesConsignes) {
  const [ouvert, setOuvert] = useState<Ouvert>(null);
  const [annulable, setAnnulable] = useState<Annulable | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Un appui long (gérant) ouvre l'attribution de ce travail.
  const [demandeVue, setDemandeVue] = useState<number | null>(null);
  if (demande !== null && demande.n !== demandeVue && equipe.gerant) {
    setDemandeVue(demande.n);
    setOuvert({ sorte: 'attribuer', cle: demande.cle, n: demande.n });
  }
  useEffect(() => {
    if (annulable === null) return undefined;
    const minuterie = setTimeout(() => {
      setAnnulable((a) => (a?.numero === annulable.numero ? null : a));
    }, DELAI_ANNULATION_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [annulable]);

  async function ecrire(voulues: ReadonlyMap<string, readonly string[]>): Promise<ReadonlyMap<string, readonly string[]> | null> {
    setOccupe(true);
    setErreur(null);
    const finir = commencerEcriture();
    try {
      return await attribuer(porte, fermeId, utilisateurId, voulues);
    } catch (e) {
      console.error('Attribution impossible', e);
      setErreur(`L’attribution n’a pas pu s’enregistrer sur ce téléphone${e instanceof Error && e.message !== '' ? ` : ${e.message}` : ''}`);
      return null;
    } finally {
      finir();
      setOccupe(false);
    }
  }

  function valider(cles: readonly string[], personnes: readonly string[]): void {
    const voulues = new Map(cles.map((c) => [c, personnes]));
    const noms = personnes.map((id) => equipe.personnes.find((p) => p.id === id)?.prenom ?? '').filter((n) => n !== '');
    void ecrire(voulues).then((avant) => {
      if (avant === null) return;
      setOuvert(null);
      const travaux = cles.length === 1 ? '1 travail' : `${String(cles.length)} travaux`;
      setAnnulable({ numero: Date.now(), avant, texte: noms.length === 0 ? `${travaux} pour toute l’équipe` : `${travaux} pour ${noms.sort((a, b) => a.localeCompare(b, 'fr')).join(', ')}` });
    });
  }

  const avecPersonnes = equipe.personnes.length > 0;
  if (!avecPersonnes && annulable === null) return null;
  return (
    <>
      <div className="auj-equipe">
        {equipe.moi !== null && (
          <div data-testid="filtre-travaux" role="group" aria-label="Travaux" className="auj-filtre">
            {(['mes', 'tous'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className="auj-filtre-bouton"
                onClick={() => {
                  surMode(m);
                }}
              >
                {m === 'mes' ? 'Mes travaux' : 'Tous'}
              </button>
            ))}
          </div>
        )}
        {equipe.gerant && avecPersonnes && (
          <button
            type="button"
            className="auj-equipe-bouton"
            onClick={() => {
              setOuvert({ sorte: 'attribuer', cle: null, n: 0 });
            }}
          >
            Attribuer
          </button>
        )}
        {avecPersonnes && (
          <button
            type="button"
            className="auj-equipe-bouton"
            onClick={() => {
              setOuvert({ sorte: 'fiche' });
            }}
          >
            Fiche du jour
          </button>
        )}
      </div>
      {erreur !== null && ouvert === null && (
        <p role="alert" className="auj-erreur">
          {erreur}
        </p>
      )}
      {ouvert?.sorte === 'attribuer' && (
        <DialogueAttribution
          key={ouvert.n}
          travaux={travaux}
          equipe={equipe}
          cleDepart={ouvert.cle}
          occupe={occupe}
          erreur={erreur}
          surValider={valider}
          surFermer={() => {
            setOuvert(null);
            setErreur(null);
          }}
        />
      )}
      {ouvert?.sorte === 'fiche' && (
        <FicheDuJour
          travaux={travaux}
          equipe={equipe}
          surFermer={() => {
            setOuvert(null);
          }}
        />
      )}
      {annulable !== null && (
        <div key={annulable.numero} data-testid="attribution-annulable" data-saisie-en-cours="oui" role="status" className="auj-bandeau">
          <span className="auj-bandeau-texte">
            <strong>Attribué</strong>
            <span>{annulable.texte}</span>
          </span>
          <button
            type="button"
            className="auj-bandeau-annuler"
            disabled={occupe}
            onClick={() => {
              const a = annulable;
              void ecrire(a.avant).then((ok) => {
                if (ok !== null) setAnnulable((x) => (x?.numero === a.numero ? null : x));
              });
            }}
          >
            Annuler
          </button>
          <span aria-hidden="true" className="auj-bandeau-temps" />
        </div>
      )}
    </>
  );
}

// ── Attribuer ────────────────────────────────────────────────────────────────────────────────

interface ProprietesAttribution {
  readonly travaux: readonly TravailVu[];
  readonly equipe: Equipe;
  /** Travail de l'appui long (coché, ses personnes cochées), ou null (« Attribuer »). */
  readonly cleDepart: string | null;
  readonly occupe: boolean;
  readonly erreur: string | null;
  readonly surValider: (cles: readonly string[], personnes: readonly string[]) => void;
  readonly surFermer: () => void;
}

function DialogueAttribution({ travaux, equipe, cleDepart, occupe, erreur, surValider, surFermer }: ProprietesAttribution) {
  const [cles, setCles] = useState<ReadonlySet<string>>(() => new Set(cleDepart === null ? [] : [cleDepart]));
  const [personnes, setPersonnes] = useState<ReadonlySet<string>>(() => new Set(cleDepart === null ? [] : (equipe.parTache.get(cleDepart) ?? [])));
  const garderFocus = useFocusDuDialogue();
  const id = useId();
  const zones = useMemo(() => {
    const parZone = new Map<string, string[]>();
    for (const t of travaux) {
      const zone = t.zone;
      if (zone === '') continue;
      const l = parZone.get(zone);
      if (l === undefined) parZone.set(zone, [t.cle]);
      else l.push(t.cle);
    }
    return [...parZone].sort(([a], [b]) => a.localeCompare(b, 'fr'));
  }, [travaux]);
  const basculer = (ensemble: ReadonlySet<string>, cle: string): ReadonlySet<string> => {
    const s = new Set(ensemble);
    if (s.has(cle)) s.delete(cle);
    else s.add(cle);
    return s;
  };
  const choisies = travaux.filter((t) => cles.has(t.cle)).map((t) => t.cle);
  return (
    <div
      className="auj-voile"
      onKeyDown={(e) => {
        if (e.key === 'Escape') surFermer();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Attribuer" className="auj-feuille" onKeyDown={garderFocus}>
        <h2 className="auj-feuille-titre">Attribuer</h2>
        <fieldset className="auj-equipe-groupe">
          <legend className="auj-champ-libelle">Travaux</legend>
          {zones.length > 0 && (
            <div className="auj-equipe-zones">
              {zones.map(([zone, deLaZone]) => (
                <button
                  key={zone}
                  type="button"
                  className="auj-equipe-zone"
                  onClick={() => {
                    setCles((s) => new Set([...s, ...deLaZone]));
                  }}
                >
                  Toute la zone {zone}
                </button>
              ))}
            </div>
          )}
          {travaux.map((t, i) => {
            const qui = prenomsDe(equipe, t.cle);
            const codes = t.codes;
            return (
              <label key={t.cle} htmlFor={`${id}-t${String(i)}`} className="auj-equipe-choix">
                <input
                  id={`${id}-t${String(i)}`}
                  type="checkbox"
                  data-testid="choix-tache"
                  data-cle={t.cle}
                  checked={cles.has(t.cle)}
                  onChange={() => {
                    setCles((s) => basculer(s, t.cle));
                  }}
                />
                <span>
                  {t.phrase}
                  {codes !== null && <span className="auj-code"> {codes}</span>}
                  {qui !== null && <span className="auj-equipe-qui"> · {qui}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
        <fieldset className="auj-equipe-groupe">
          <legend className="auj-champ-libelle">Pour</legend>
          {equipe.personnes.map((p, i) => (
            <label key={p.id} htmlFor={`${id}-p${String(i)}`} className="auj-equipe-choix">
              <input
                id={`${id}-p${String(i)}`}
                type="checkbox"
                checked={personnes.has(p.id)}
                onChange={() => {
                  setPersonnes((s) => basculer(s, p.id));
                }}
              />
              <span>{p.prenom}</span>
            </label>
          ))}
          <p className="auj-feuille-texte">Personne de coché : le travail est pour toute l’équipe.</p>
        </fieldset>
        {erreur !== null && (
          <p role="alert" className="auj-erreur">
            {erreur}
          </p>
        )}
        <button
          type="button"
          className="auj-bouton-principal"
          disabled={choisies.length === 0 || occupe}
          onClick={() => {
            if (choisies.length === 0 || occupe) return;
            surValider(
              choisies,
              equipe.personnes.filter((p) => personnes.has(p.id)).map((p) => p.id),
            );
          }}
        >
          Valider
        </button>
        <button type="button" className="auj-bouton-secondaire" onClick={surFermer}>
          Retour
        </button>
      </div>
    </div>
  );
}

// ── Fiche du jour ────────────────────────────────────────────────────────────────────────────

interface ProprietesFiche {
  readonly travaux: readonly TravailVu[];
  readonly equipe: Equipe;
  readonly surFermer: () => void;
}

function FicheDuJour({ travaux, equipe, surFermer }: ProprietesFiche) {
  const [personne, setPersonne] = useState(() => equipe.moi ?? equipe.personnes[0]?.id ?? '');
  const [avis, setAvis] = useState<string | null>(null);
  const garderFocus = useFocusDuDialogue();
  const idListe = useId();
  const lignes = useMemo(() => (personne === '' ? [] : lignesFiche(travaux, equipe.parTache, personne)), [travaux, equipe, personne]);
  const prenom = equipe.personnes.find((p) => p.id === personne)?.prenom ?? '';
  const titre = `Travaux du jour — ${prenom}`;

  async function partager(): Promise<void> {
    setAvis(null);
    const image = await ficheEnImage(titre, lignes);
    if (image === null) {
      setAvis('Ce téléphone ne sait pas faire l’image : imprimez la fiche.');
      return;
    }
    const fichier = new File([image], `travaux-${prenom.toLowerCase()}.png`, { type: 'image/png' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: titre }).catch(() => undefined);
      return;
    }
    // Sans partage (ordinateur) : l'image se télécharge.
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(image);
    lien.download = fichier.name;
    lien.click();
    URL.revokeObjectURL(lien.href);
  }

  return (
    <div
      className="auj-voile auj-voile-plein"
      onKeyDown={(e) => {
        if (e.key === 'Escape') surFermer();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Fiche du jour" className="auj-feuille auj-fiche" onKeyDown={garderFocus}>
        <h2 className="auj-feuille-titre">Fiche du jour</h2>
        <label htmlFor={idListe} className="auj-champ-libelle auj-fiche-ecran">
          Personne
        </label>
        <select
          id={idListe}
          className="auj-champ auj-fiche-ecran"
          value={personne}
          onChange={(e) => {
            setPersonne(e.target.value);
          }}
        >
          {equipe.personnes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.prenom}
            </option>
          ))}
        </select>
        <p className="auj-fiche-titre">{titre}</p>
        {lignes.length === 0 ? (
          <p className="auj-feuille-texte">Aucun travail aujourd’hui.</p>
        ) : (
          <table className="auj-fiche-table">
            <thead>
              <tr>
                <th scope="col">N°</th>
                <th scope="col">Planche</th>
                <th scope="col">Travail</th>
                <th scope="col">Outil</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.cle} data-testid="ligne-fiche" data-cle={l.cle}>
                  <td data-colonne="numero">{l.numero}</td>
                  <td data-colonne="planche">{l.planche}</td>
                  <td data-colonne="travail">
                    {l.travail}
                    {l.pourTous && <span className="auj-fiche-tous"> (pour tous)</span>}
                  </td>
                  <td data-colonne="outil">{l.outil}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {avis !== null && (
          <p role="status" className="auj-feuille-texte">
            {avis}
          </p>
        )}
        <div className="auj-fiche-actions auj-fiche-ecran">
          <button
            type="button"
            className="auj-bouton-principal"
            onClick={() => {
              window.print();
            }}
          >
            Imprimer
          </button>
          <button
            type="button"
            className="auj-equipe-bouton"
            onClick={() => {
              void partager();
            }}
          >
            Partager en image
          </button>
          <button type="button" className="auj-bouton-secondaire" onClick={surFermer}>
            Retour
          </button>
        </div>
      </div>
    </div>
  );
}
