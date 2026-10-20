/**
 * Saisir un apport au champ (T54, règle 2), depuis Aujourd'hui : les planches au doigt, le produit
 * de la ferme au doigt (ou « Autre produit » en texte libre, compté sans unités), la quantité et
 * son unité (celle du produit par défaut), fertilisation ou amendement, à la date du jour ;
 * « Enregistrer ». Chargé à la demande (morceau à part) ; reçoit la porte, tout marche hors ligne.
 * L'apport se retrouve dans le cahier de fertilisation (onglet Ferme) et l'historique.
 * Aucune dose n'est proposée : on note ce qui a été apporté.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';
import '../../parcellaire/parcellaire.css';
import { ApportRefuse, ecrireApport, lirePlanches, lireProduits, type PlancheActive, type ProduitChoisissable } from './donnees.ts';

export interface ProprietesSaisieFertilisation {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** 'AAAA-MM-JJ'. */
  readonly aujourdhui: string;
  readonly surFermer: () => void;
  readonly surEcrit?: () => void;
}

/** « 1,5 » ou « 1.5 » → 1.5 ; illisible ou ≤ 0 → null. */
function lireQuantite(texte: string): number | null {
  const t = texte.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

function messageEchec(e: unknown): string {
  return e instanceof ApportRefuse ? `Apport refusé : ${e.message}` : 'L’apport n’a pas pu s’enregistrer sur ce téléphone. Réessayez ; si cela recommence, signalez-le.';
}

/** Amendement de fond (compté en t ou m³) ou fertilisation (kg, L). */
const categorieDe = (unite: string): 'fertilisation' | 'amendement' => (unite === 't' || unite === 'm3' ? 'amendement' : 'fertilisation');

function Pastille({ libelle, presse, surTap }: { readonly libelle: string; readonly presse: boolean; readonly surTap: () => void }): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={presse}
      className={presse ? 'parc-bouton-principal' : 'parc-bouton-secondaire'}
      style={{ minHeight: 48 }}
      onClick={surTap}
    >
      {libelle}
    </button>
  );
}

export function SaisieFertilisation({ porte, fermeId, aujourdhui, surFermer, surEcrit }: ProprietesSaisieFertilisation): ReactElement {
  const id = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const [lu, setLu] = useState<{ readonly planches: readonly PlancheActive[]; readonly produits: readonly ProduitChoisissable[] } | null>(null);
  const [echecLecture, setEchecLecture] = useState(false);
  const [planches, setPlanches] = useState<ReadonlySet<string>>(new Set());
  const [produitId, setProduitId] = useState<string | null>(null);
  const [autre, setAutre] = useState('');
  const [quantite, setQuantite] = useState('');
  const [unite, setUnite] = useState('kg');
  const [categorie, setCategorie] = useState<'fertilisation' | 'amendement'>('fertilisation');
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    titre.current?.focus();
    let actif = true;
    Promise.all([lirePlanches(porte, fermeId, aujourdhui), lireProduits(porte, fermeId)]).then(
      ([p, produits]) => {
        if (actif) setLu({ planches: p, produits });
      },
      (e: unknown) => {
        console.error('Planches ou produits illisibles', e);
        if (actif) setEchecLecture(true);
      },
    );
    return () => {
      actif = false;
    };
  }, [porte, fermeId, aujourdhui]);

  const produit = lu?.produits.find((p) => p.id === produitId) ?? null;

  function basculer(e: string): void {
    setPlanches((c) => {
      const n = new Set(c);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return n;
    });
  }

  function choisir(p: ProduitChoisissable): void {
    if (produitId === p.id) {
      setProduitId(null);
      return;
    }
    setProduitId(p.id);
    setAutre('');
    setUnite(p.unite);
    setCategorie(categorieDe(p.unite));
  }

  function enregistrer(): void {
    const valeur = lireQuantite(quantite);
    const nom = produit?.nom ?? autre.trim();
    const probleme =
      planches.size === 0
        ? 'Touchez au moins une planche.'
        : nom === ''
          ? 'Choisissez le produit, ou écrivez-le dans « Autre produit ».'
          : valeur === null
            ? 'Indiquez la quantité (un nombre, virgule acceptée).'
            : unite.trim() === ''
              ? 'Indiquez l’unité de la quantité.'
              : null;
    if (probleme !== null || valeur === null) {
      setMessage(probleme);
      return;
    }
    setMessage(null);
    setOccupe(true);
    ecrireApport(porte, {
      date: aujourdhui,
      emplacementIds: [...planches],
      categorie,
      produit: { id: produit?.id ?? null, nom },
      quantite: { valeur, unite: unite.trim() },
    }).then(
      () => {
        setOccupe(false);
        surEcrit?.();
        surFermer();
      },
      (e: unknown) => {
        console.error('Apport non enregistré', e);
        setOccupe(false);
        setMessage(messageEchec(e));
      },
    );
  }

  return (
    <div className="parc-voile">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titre`}
        data-saisie-en-cours="oui"
        className="parc-feuille"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <div className="parc-tete">
          <div className="parc-tete-textes">
            <span className="parc-surtitre">Apport du jour</span>
            <h2 id={`${id}-titre`} ref={titre} tabIndex={-1}>
              Fertilisation
            </h2>
          </div>
          <button type="button" aria-label="Fermer" className="parc-fermer" onClick={surFermer}>
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="parc-corps">
          {echecLecture ? (
            <p role="alert" className="parc-erreur">
              Les planches ou les produits n’ont pas pu se lire sur ce téléphone. Fermez et réessayez.
            </p>
          ) : lu === null ? (
            <p className="parc-aide">Lecture des planches et des produits…</p>
          ) : lu.planches.length === 0 ? (
            <p className="parc-aide">Aucune planche dans cette ferme pour l’instant : ajoutez-les dans Ferme › Ma ferme.</p>
          ) : (
            <div className="parc-carte">
              <fieldset className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="parc-etiquette">Planches</legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {lu.planches.map((p) => (
                    <Pastille key={p.id} libelle={p.code} presse={planches.has(p.id)} surTap={() => { basculer(p.id); }} />
                  ))}
                </div>
              </fieldset>
              <fieldset className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="parc-etiquette">Produit</legend>
                {lu.produits.length === 0 ? (
                  <p className="parc-aide">Aucun produit fertilisant pour l’instant : ajoutez-les dans Ferme › Produits fertilisants (liste de départ en un tap).</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {lu.produits.map((p) => (
                      <Pastille key={p.id} libelle={p.nom} presse={produitId === p.id} surTap={() => { choisir(p); }} />
                    ))}
                  </div>
                )}
              </fieldset>
              <div className="parc-grille">
                <div className="parc-champ-bloc parc-large">
                  <label className="parc-etiquette" htmlFor={`${id}-autre`}>
                    Autre produit
                  </label>
                  <input
                    id={`${id}-autre`}
                    className="parc-champ"
                    autoComplete="off"
                    placeholder="texte libre, sans calcul d’unités"
                    value={autre}
                    onChange={(e) => {
                      setAutre(e.target.value);
                      if (e.target.value.trim() !== '') setProduitId(null);
                    }}
                  />
                </div>
                <div className="parc-champ-bloc">
                  <label className="parc-etiquette" htmlFor={`${id}-quantite`}>
                    Quantité
                  </label>
                  <input id={`${id}-quantite`} className="parc-champ" inputMode="decimal" autoComplete="off" value={quantite} onChange={(e) => { setQuantite(e.target.value); }} />
                </div>
                <div className="parc-champ-bloc">
                  <label className="parc-etiquette" htmlFor={`${id}-unite`}>
                    Unité
                  </label>
                  <input id={`${id}-unite`} className="parc-champ" autoComplete="off" value={unite} onChange={(e) => { setUnite(e.target.value); }} />
                </div>
              </div>
              <fieldset className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 16 }}>
                <legend className="parc-etiquette">Nature</legend>
                {(['fertilisation', 'amendement'] as const).map((c) => (
                  <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 48 }}>
                    <input type="radio" name={`${id}-categorie`} checked={categorie === c} style={{ width: 24, height: 24 }} onChange={() => { setCategorie(c); }} />
                    {c === 'fertilisation' ? 'Fertilisation' : 'Amendement'}
                  </label>
                ))}
              </fieldset>
              {message !== null && (
                <p role="alert" className="parc-erreur">
                  {message}
                </p>
              )}
              <div className="parc-actions">
                <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={enregistrer}>
                  Enregistrer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
