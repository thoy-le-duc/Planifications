/**
 * Champ « Adresse, commune ou lieu-dit » de l'éditeur de placement (T28h, Q35). Tape, attend 300 ms,
 * interroge le géocodage de la Géoplateforme (une requête à la fois, la précédente abandonnée) et
 * propose au plus 5 lieux ; un tap déplace la vue, rien d'autre : ni origine du plan, ni écriture.
 * Données du maraîcher : seul le texte tapé part dans la requête, rien n'est gardé.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { analyserReponseAdresse, DELAI_SAISIE_MS, urlRechercheAdresse, type PropositionAdresse } from './adresse.ts';

export const MESSAGES_ADRESSE = {
  indisponible: 'Recherche d’adresse indisponible sans réseau ; déplacez la carte à la main',
  aucun: 'Aucune adresse trouvée',
} as const;

export interface ProprietesRechercheAdresse {
  readonly enLigne: boolean;
  /** Ferme sans origine ni position : le champ est la porte d'entrée. */
  readonly misEnAvant: boolean;
  readonly surChoix: (proposition: PropositionAdresse) => void;
}

export function RechercheAdresse({ enLigne, misEnAvant, surChoix }: ProprietesRechercheAdresse): ReactElement {
  const [texte, setTexte] = useState('');
  const [propositions, setPropositions] = useState<readonly PropositionAdresse[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requete = useRef<AbortController | null>(null);
  const enLigneRef = useRef(enLigne);
  useEffect(() => {
    enLigneRef.current = enLigne;
  }, [enLigne]);

  function arreter(): void {
    if (minuterie.current !== null) clearTimeout(minuterie.current);
    minuterie.current = null;
    requete.current?.abort();
    requete.current = null;
  }
  useEffect(() => arreter, []);

  async function chercher(saisie: string): Promise<void> {
    const url = urlRechercheAdresse(saisie);
    if (url === null) return;
    if (!enLigneRef.current) {
      setPropositions([]);
      setMessage(MESSAGES_ADRESSE.indisponible);
      return;
    }
    const controleur = new AbortController();
    requete.current = controleur;
    let trouvees: readonly PropositionAdresse[] | null = null;
    try {
      const reponse = await fetch(url, { signal: controleur.signal });
      if (reponse.ok) trouvees = analyserReponseAdresse(await reponse.json());
    } catch {
      trouvees = null;
    }
    if (controleur.signal.aborted) return;
    requete.current = null;
    setPropositions(trouvees ?? []);
    setMessage(trouvees === null ? MESSAGES_ADRESSE.indisponible : trouvees.length === 0 ? MESSAGES_ADRESSE.aucun : null);
  }

  function saisir(valeur: string): void {
    arreter();
    setTexte(valeur);
    setMessage(null);
    if (valeur.trim() === '') {
      setPropositions([]);
      return;
    }
    minuterie.current = setTimeout(() => {
      minuterie.current = null;
      void chercher(valeur);
    }, DELAI_SAISIE_MS);
  }

  function choisir(p: PropositionAdresse): void {
    arreter();
    setTexte(p.libelle);
    setPropositions([]);
    setMessage(null);
    surChoix(p);
  }

  function surTouche(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    // Saisie encore en attente : les propositions affichées sont celles du texte précédent.
    if (minuterie.current !== null || requete.current !== null) return;
    const [premiere] = propositions;
    if (premiere !== undefined) choisir(premiere);
  }

  return (
    <div className="pl-recherche">
      <input
        type="search"
        data-testid="recherche-adresse"
        data-mis-en-avant={misEnAvant ? 'true' : 'false'}
        className="pl-recherche-champ"
        aria-label="Adresse, commune ou lieu-dit"
        placeholder="Adresse, commune ou lieu-dit"
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="search"
        value={texte}
        onChange={(e) => {
          saisir(e.target.value);
        }}
        onKeyDown={surTouche}
      />
      {propositions.length > 0 && (
        <ul data-testid="propositions-adresse" className="pl-propositions">
          {propositions.map((p, i) => (
            <li key={`${String(i)}-${p.libelle}`}>
              <button
                type="button"
                data-testid="proposition-adresse"
                data-type={p.type}
                data-latitude={p.latitude}
                data-longitude={p.longitude}
                className="pl-proposition"
                onClick={() => {
                  choisir(p);
                }}
              >
                {p.libelle}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message !== null && (
        <p role="status" data-testid="message-adresse" className="pl-message">
          {message}
        </p>
      )}
    </div>
  );
}
