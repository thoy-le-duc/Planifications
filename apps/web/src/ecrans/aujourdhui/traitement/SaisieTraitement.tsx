/**
 * Saisir un traitement au champ (T52, règle 2), depuis Aujourd'hui : la culture, puis un seul
 * écran (emplacements cochés par défaut, produit, date du jour, dose, surface calculée, cible,
 * opérateur), « Enregistrer ». Chargé à la demande (morceau à part) ; reçoit la porte, tout marche
 * hors ligne. Saisie manuelle (principe 3) : écrite au tap, « Annuler ce traitement » reste
 * possible tant que le dialogue est ouvert, puis depuis le registre (onglet Ferme).
 *
 * La dose au-dessus de la dose maximale du produit est dite (avertissement), jamais bloquée.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { avertissementDose, jourMois, surfaceEmplacements } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import '../../parcellaire/parcellaire.css';
import { annoncerSaisie } from '../cache.ts';
import {
  annulerTraitement,
  ecrireTraitement,
  lireCulturesEnPlace,
  lireProduitsUtilisables,
  TraitementPlusEnVigueur,
  TraitementRefuse,
  type CultureEnPlace,
  type ProduitUtilisable,
  type TraitementEcrit,
} from './donnees.ts';

export interface ProprietesSaisieTraitement {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Jour du téléphone, 'AAAA-MM-JJ'. */
  readonly aujourdhui: string;
  readonly surFermer: () => void;
}

const UNITE_PAR_DEFAUT = 'L/ha';

/** « 2,5 » ou « 2.5 » → 2.5 ; texte vide ou illisible → null. */
function lireNombre(texte: string): number | null {
  const t = texte.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const enFrancais = (n: number): string => String(n).replace('.', ',');

function messageEchec(e: unknown): string {
  if (e instanceof TraitementRefuse) return `Traitement refusé : ${e.message}`;
  if (e instanceof TraitementPlusEnVigueur) return 'Ce traitement a déjà été annulé ou corrigé : rien de plus n’est enregistré.';
  return 'Le traitement n’a pas pu s’enregistrer sur ce téléphone. Réessayez ; si cela recommence, signalez-le.';
}

function IconeFermer() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

interface ProprietesFormulaire {
  readonly culture: CultureEnPlace;
  readonly produits: readonly ProduitUtilisable[];
  readonly aujourdhui: string;
  readonly occupe: boolean;
  readonly message: string | null;
  readonly surEnregistrer: (s: Parameters<typeof ecrireTraitement>[1]) => void;
  readonly surMessage: (m: string | null) => void;
}

function Formulaire({ culture, produits, aujourdhui, occupe, message, surEnregistrer, surMessage }: ProprietesFormulaire): ReactElement {
  const id = useId();
  const [coches, setCoches] = useState<ReadonlySet<string>>(() => new Set(culture.emplacements.map((e) => e.id)));
  const [produitId, setProduitId] = useState('');
  const [date, setDate] = useState(aujourdhui);
  const [dose, setDose] = useState('');
  const [unite, setUnite] = useState(UNITE_PAR_DEFAUT);
  const [surfaceSaisie, setSurfaceSaisie] = useState<string | null>(null);
  const [cible, setCible] = useState('');
  const [operateur, setOperateur] = useState('');

  const produit = produits.find((p) => p.id === produitId) ?? null;
  const surfaceAuto = useMemo(() => surfaceEmplacements(culture.emplacements.filter((e) => coches.has(e.id))), [culture, coches]);
  const surface = surfaceSaisie ?? enFrancais(surfaceAuto);
  const valeurDose = lireNombre(dose);
  const avertissement = produit === null || valeurDose === null ? null : avertissementDose({ valeur: valeurDose, unite }, produit.doseMaximale);

  function basculer(e: string): void {
    setCoches((c) => {
      const n = new Set(c);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return n;
    });
    setSurfaceSaisie(null);
  }

  function choisirProduit(v: string): void {
    setProduitId(v);
    const p = produits.find((x) => x.id === v);
    if (p?.doseMaximale != null) setUnite(p.doseMaximale.unite);
  }

  function enregistrer(): void {
    const s = lireNombre(surface);
    const probleme =
      produit === null
        ? 'Choisissez le produit.'
        : valeurDose === null
          ? 'Indiquez la dose (un nombre, virgule acceptée).'
          : unite.trim() === ''
            ? 'Indiquez l’unité de la dose.'
            : s === null
              ? 'Indiquez la surface traitée en m² (un nombre).'
              : cible.trim() === ''
                ? 'Indiquez la cible (ravageur ou maladie).'
                : date === '' || date > aujourdhui
                  ? 'La date du traitement ne peut pas être après aujourd’hui.'
                  : culture.emplacements.length > 0 && coches.size === 0
                    ? 'Cochez au moins un emplacement traité.'
                    : null;
    if (probleme !== null || produit === null || valeurDose === null || s === null) {
      surMessage(probleme);
      return;
    }
    surMessage(null);
    surEnregistrer({
      culture: culture.cible,
      emplacementIds: culture.emplacements.filter((e) => coches.has(e.id)).map((e) => e.id),
      produit,
      date,
      dose: { valeur: valeurDose, unite: unite.trim() },
      surfaceTraiteeM2: s,
      cible,
      operateur,
    });
  }

  return (
    <div className="parc-carte">
      {culture.emplacements.length > 0 && (
        <fieldset className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="parc-etiquette">Emplacements</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {culture.emplacements.map((e) => (
              <label key={e.id} className="parc-bouton-secondaire" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={coches.has(e.id)} style={{ width: 28, height: 28 }} onChange={() => { basculer(e.id); }} />
                {e.code}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="parc-champ-bloc">
        <label className="parc-etiquette" htmlFor={`${id}-produit`}>
          Produit
        </label>
        <select id={`${id}-produit`} className="parc-champ" value={produitId} onChange={(e) => { choisirProduit(e.target.value); }}>
          <option value="">Choisir…</option>
          {produits.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nomCommercial} · DAR {p.delaiAvantRecolteJours} j{p.bio ? ' · bio' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="parc-grille">
        <div className="parc-champ-bloc">
          <label className="parc-etiquette" htmlFor={`${id}-dose`}>
            Dose
          </label>
          <input id={`${id}-dose`} className="parc-champ" inputMode="decimal" autoComplete="off" value={dose} onChange={(e) => { setDose(e.target.value); }} />
        </div>
        <div className="parc-champ-bloc">
          <label className="parc-etiquette" htmlFor={`${id}-unite`}>
            Unité
          </label>
          <input id={`${id}-unite`} className="parc-champ" autoComplete="off" value={unite} onChange={(e) => { setUnite(e.target.value); }} />
        </div>
        <div className="parc-champ-bloc">
          <label className="parc-etiquette" htmlFor={`${id}-surface`}>
            Surface traitée (m²)
          </label>
          <input id={`${id}-surface`} className="parc-champ" inputMode="decimal" autoComplete="off" value={surface} onChange={(e) => { setSurfaceSaisie(e.target.value); }} />
        </div>
        <div className="parc-champ-bloc">
          <label className="parc-etiquette" htmlFor={`${id}-date`}>
            Date
          </label>
          <input id={`${id}-date`} className="parc-champ" type="date" max={aujourdhui} value={date} onChange={(e) => { setDate(e.target.value); }} />
        </div>
        <div className="parc-champ-bloc parc-large">
          <label className="parc-etiquette" htmlFor={`${id}-cible`}>
            Cible
          </label>
          <input id={`${id}-cible`} className="parc-champ" autoComplete="off" placeholder="mildiou, pucerons…" value={cible} onChange={(e) => { setCible(e.target.value); }} />
        </div>
        <div className="parc-champ-bloc parc-large">
          <label className="parc-etiquette" htmlFor={`${id}-operateur`}>
            Opérateur
          </label>
          <input id={`${id}-operateur`} className="parc-champ" autoComplete="name" placeholder="facultatif" value={operateur} onChange={(e) => { setOperateur(e.target.value); }} />
        </div>
      </div>
      {avertissement !== null && (
        <p data-testid="avertissement-dose" role="status" className="parc-erreur">
          {avertissement}
        </p>
      )}
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
  );
}

type Etape = { readonly sorte: 'culture' } | { readonly sorte: 'formulaire'; readonly culture: CultureEnPlace } | { readonly sorte: 'enregistre'; readonly culture: CultureEnPlace; readonly ecrit: TraitementEcrit; readonly annule: boolean };

export function SaisieTraitement({ porte, fermeId, aujourdhui, surFermer }: ProprietesSaisieTraitement): ReactElement {
  const idTitre = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const [lu, setLu] = useState<{ readonly cultures: readonly CultureEnPlace[]; readonly produits: readonly ProduitUtilisable[] } | null>(null);
  const [echecLecture, setEchecLecture] = useState(false);
  const [etape, setEtape] = useState<Etape>({ sorte: 'culture' });
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    titre.current?.focus();
    let actif = true;
    Promise.all([lireCulturesEnPlace(porte, fermeId, aujourdhui), lireProduitsUtilisables(porte, fermeId)]).then(
      ([cultures, produits]) => {
        if (actif) setLu({ cultures, produits });
      },
      (e: unknown) => {
        console.error('Cultures ou produits illisibles', e);
        if (actif) setEchecLecture(true);
      },
    );
    return () => {
      actif = false;
    };
  }, [porte, fermeId, aujourdhui]);

  // La journée suivie ne relit que la culture touchée (un traitement ne change pas ses tâches).
  const annoncer = (c: Parameters<typeof annoncerSaisie>[2]) => annoncerSaisie(porte, fermeId, c, false);

  function enregistrer(culture: CultureEnPlace, s: Parameters<typeof ecrireTraitement>[1]): void {
    setOccupe(true);
    ecrireTraitement(porte, s, annoncer).then(
      (ecrit) => {
        setOccupe(false);
        setEtape({ sorte: 'enregistre', culture, ecrit, annule: false });
      },
      (e: unknown) => {
        console.error('Traitement non enregistré', e);
        setOccupe(false);
        setMessage(messageEchec(e));
      },
    );
  }

  function annuler(): void {
    if (etape.sorte !== 'enregistre' || etape.annule) return;
    setOccupe(true);
    annulerTraitement(porte, fermeId, etape.ecrit.id, aujourdhui, annoncer).then(
      () => {
        setOccupe(false);
        setMessage(null);
        setEtape({ ...etape, annule: true });
      },
      (e: unknown) => {
        console.error('Traitement non annulé', e);
        setOccupe(false);
        setMessage(messageEchec(e));
      },
    );
  }

  const surtitre = etape.sorte === 'culture' ? 'Quelle culture ?' : etape.culture.nom;

  return (
    <div className="parc-voile">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
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
            <span className="parc-surtitre">{surtitre}</span>
            <h2 id={idTitre} ref={titre} tabIndex={-1}>
              Traitement
            </h2>
          </div>
          <button type="button" aria-label="Fermer" className="parc-fermer" onClick={surFermer}>
            <IconeFermer />
          </button>
        </div>
        <div className="parc-corps">
          {echecLecture ? (
            <p role="alert" className="parc-erreur">
              Les cultures ou les produits n’ont pas pu se lire sur ce téléphone. Fermez et réessayez.
            </p>
          ) : lu === null ? (
            <p className="parc-aide">Lecture des cultures et des produits…</p>
          ) : lu.produits.length === 0 ? (
            <p className="parc-aide">Aucun produit phyto pour l’instant : ajoutez-les dans Ferme › Produits phyto.</p>
          ) : etape.sorte === 'culture' ? (
            lu.cultures.length === 0 ? (
              <p className="parc-aide">Aucune culture en place aujourd’hui.</p>
            ) : (
              <ul className="parc-liste">
                {lu.cultures.map((c) => (
                  <li key={c.cibleId}>
                    <button
                      type="button"
                      data-testid="choix-traitement"
                      data-cible={c.cibleId}
                      className="parc-ligne"
                      onClick={() => {
                        setMessage(null);
                        setEtape({ sorte: 'formulaire', culture: c });
                      }}
                    >
                      <span className="parc-ligne-textes">
                        <strong>{c.nom}</strong>
                        <span>{c.emplacements.map((e) => e.code).join(' · ')}</span>
                      </span>
                      <span aria-hidden="true" className="parc-chevron">
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : etape.sorte === 'formulaire' ? (
            <Formulaire
              culture={etape.culture}
              produits={lu.produits}
              aujourdhui={aujourdhui}
              occupe={occupe}
              message={message}
              surMessage={setMessage}
              surEnregistrer={(s) => {
                enregistrer(etape.culture, s);
              }}
            />
          ) : (
            <div className="parc-carte" role="status">
              <strong style={{ fontSize: 20 }}>{etape.annule ? 'Traitement annulé' : 'Traitement noté'}</strong>
              {!etape.annule && <span>Récolte autorisée le {jourMois(etape.ecrit.recolteAutoriseeLe)}. Enregistré sur le téléphone, envoyé dès que le réseau revient.</span>}
              {message !== null && (
                <p role="alert" className="parc-erreur">
                  {message}
                </p>
              )}
              <div className="parc-actions">
                {!etape.annule && (
                  <button type="button" className="parc-bouton-danger" disabled={occupe} onClick={annuler}>
                    Annuler ce traitement
                  </button>
                )}
                <button type="button" className="parc-bouton-principal" onClick={surFermer}>
                  Fermer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
