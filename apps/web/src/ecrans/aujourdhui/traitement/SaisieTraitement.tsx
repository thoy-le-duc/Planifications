/**
 * Saisir un traitement au champ (T52, règle 2), depuis Aujourd'hui : la culture, puis un seul
 * écran (emplacements cochés par défaut, produit, date du jour, dose, surface calculée, cible,
 * opérateur), « Enregistrer ». Chargé à la demande (morceau à part) ; reçoit la porte, tout marche
 * hors ligne. Saisie manuelle (principe 3) : écrite au tap, « Annuler ce traitement » reste
 * possible tant que le dialogue est ouvert, puis depuis le registre (onglet Ferme).
 *
 * La dose au-dessus de la dose maximale du produit est dite (avertissement), jamais bloquée.
 *
 * Délai avant récolte (T76) : un champ, figé dans l'événement. Produit venu d'e-phy (son AMM est
 * dans le catalogue) : le DAR proposé est celui de l'usage de l'espèce traitée (`darPourCulture`),
 * jamais celui d'une autre culture ni un DAR deviné ; aucun usage pour cette espèce → avertissement
 * non bloquant et champ vide ; DAR différents selon l'usage → l'utilisateur choisit. Produit saisi à
 * la main ou catalogue indisponible : le DAR de la fiche (T52). Champ vide → enregistrement refusé.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { avertissementDose, jourMois, surfaceEmplacements } from '@planif/core';
import { darPourCulture, type CatalogueEphy, type DarPourCulture } from '@planif/core/ephy';
import type { PorteDonnees } from '@planif/sync';
import '../../parcellaire/parcellaire.css';
import { chargerCatalogueEphy } from '../../ferme/phyto/catalogue.ts';
import { libelleUsage } from '../../ferme/phyto/usage-ephy.ts';
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
  /** Un traitement vient d'être écrit ou annulé : l'écran relit les délais avant récolte. */
  readonly surEcrit?: () => void;
  /** Catalogue e-phy (T76), chargé seulement quand un produit avec AMM est choisi. */
  readonly chargerCatalogue?: () => Promise<CatalogueEphy>;
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
  readonly catalogue: () => Promise<CatalogueEphy>;
}

/** Ce qu'e-phy dit du produit choisi pour l'espèce traitée. */
type EtatEphy = { readonly sorte: 'hors_ephy' } | { readonly sorte: 'chargement' } | { readonly sorte: 'lu'; readonly r: DarPourCulture };

function Formulaire({ culture, produits, aujourdhui, occupe, message, surEnregistrer, surMessage, catalogue }: ProprietesFormulaire): ReactElement {
  const id = useId();
  const [coches, setCoches] = useState<ReadonlySet<string>>(() => new Set(culture.emplacements.map((e) => e.id)));
  const [produitId, setProduitId] = useState('');
  const [date, setDate] = useState(aujourdhui);
  const [dose, setDose] = useState('');
  const [unite, setUnite] = useState(UNITE_PAR_DEFAUT);
  const [surfaceSaisie, setSurfaceSaisie] = useState<string | null>(null);
  const [cible, setCible] = useState('');
  const [operateur, setOperateur] = useState('');
  const [dar, setDar] = useState('');
  const [ephy, setEphy] = useState<EtatEphy>({ sorte: 'hors_ephy' });
  const [usageChoisi, setUsageChoisi] = useState<number | null>(null);
  /** Dernier produit choisi : une réponse du catalogue pour un produit précédent est ignorée. */
  const demande = useRef(0);
  /** Le maraîcher a écrit le délai lui-même : la réponse du catalogue ne l'écrase pas. */
  const darTouche = useRef(false);

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
    const n = ++demande.current;
    darTouche.current = false;
    setUsageChoisi(null);
    if (p === undefined || p.numeroAmm === '') {
      setEphy({ sorte: 'hors_ephy' });
      setDar(p === undefined ? '' : String(p.delaiAvantRecolteJours));
      return;
    }
    // Rien de proposé tant qu'e-phy n'a pas répondu : ni le DAR de la fiche, ni celui du produit précédent.
    setEphy({ sorte: 'chargement' });
    setDar('');
    const deLaFiche = (): void => {
      setEphy({ sorte: 'hors_ephy' });
      if (!darTouche.current) setDar(String(p.delaiAvantRecolteJours));
    };
    catalogue().then(
      (c) => {
        if (n !== demande.current) return;
        const pe = c.produits.find((x) => x.amm === p.numeroAmm);
        if (pe === undefined) {
          deLaFiche();
          return;
        }
        const r = darPourCulture(pe, culture.espece);
        setEphy({ sorte: 'lu', r });
        if (!darTouche.current) setDar(r.sorte === 'propose' ? String(r.dar) : '');
      },
      (e: unknown) => {
        console.error('Catalogue e-phy non chargé : DAR de la fiche produit', e);
        if (n === demande.current) deLaFiche();
      },
    );
  }

  function choisirUsage(i: number, d: number | null): void {
    setUsageChoisi(i);
    darTouche.current = false;
    setDar(d === null ? '' : String(d));
  }

  function enregistrer(): void {
    const s = lireNombre(surface);
    const jours = dar.trim();
    const probleme =
      produit === null
        ? 'Choisissez le produit.'
        : !/^\d+$/.test(jours)
          ? 'Indiquez le délai avant récolte en jours (un nombre entier, 0 si aucun).'
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
      // Le DAR du champ est figé dans l'événement (T52) ; la fiche produit n'est pas modifiée.
      produit: { ...produit, delaiAvantRecolteJours: Number(jours) },
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
                {/* T69 : la dernière planche cochée le reste ; un traitement sans planche bloquerait toute la culture. */}
                <input type="checkbox" checked={coches.has(e.id)} disabled={coches.has(e.id) && coches.size === 1} style={{ width: 28, height: 28 }} onChange={() => { basculer(e.id); }} />
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
              {p.nomCommercial}
              {p.bio ? ' · bio' : ''}
            </option>
          ))}
        </select>
      </div>
      {produit !== null && <UsageEphyCulture espece={culture.espece} ephy={ephy} choisi={usageChoisi} nom={`${id}-usage`} surChoisir={choisirUsage} />}
      <div className="parc-grille">
        <div className="parc-champ-bloc">
          <label className="parc-etiquette" htmlFor={`${id}-dar`}>
            Délai avant récolte (jours)
          </label>
          <input
            id={`${id}-dar`}
            className="parc-champ"
            inputMode="numeric"
            autoComplete="off"
            value={dar}
            onChange={(e) => {
              darTouche.current = true;
              setDar(e.target.value);
            }}
          />
        </div>
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

/** Ce qu'e-phy dit du produit pour l'espèce traitée : DAR repris, usage à choisir, ou avertissement. */
function UsageEphyCulture({
  espece,
  ephy,
  choisi,
  nom,
  surChoisir,
}: {
  readonly espece: string;
  readonly ephy: EtatEphy;
  readonly choisi: number | null;
  readonly nom: string;
  readonly surChoisir: (i: number, dar: number | null) => void;
}): ReactElement | null {
  if (ephy.sorte === 'hors_ephy') return null;
  if (ephy.sorte === 'chargement') return <p className="parc-aide">Recherche de l’usage e-phy pour {espece}…</p>;
  const r = ephy.r;
  switch (r.sorte) {
    case 'non_homologue':
      return (
        <p data-testid="avertissement-homologation" role="status" className="parc-erreur">
          Produit non homologué sur cette culture ({espece}) dans e-phy. Vous restez maître de la décision : saisissez le délai avant récolte.
        </p>
      );
    case 'propose':
      return <p className="parc-aide">Délai avant récolte repris de l’usage e-phy pour {espece}.</p>;
    case 'dar_absent':
      return <p className="parc-aide">Délai avant récolte non précisé dans e-phy pour {espece} : saisissez-le.</p>;
    case 'a_choisir':
      return (
        <fieldset className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="parc-etiquette">Choisissez l’usage : le délai avant récolte en dépend</legend>
          <div role="radiogroup" className="parc-liste">
            {r.usages.map((u, i) => (
              <label key={`${String(i)}-${libelleUsage(u)}`} className="parc-bouton-secondaire" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                <input
                  type="radio"
                  name={nom}
                  checked={choisi === i}
                  style={{ width: 24, height: 24, flex: 'none' }}
                  onChange={() => {
                    surChoisir(i, u.dar);
                  }}
                />
                {libelleUsage(u)}
              </label>
            ))}
          </div>
        </fieldset>
      );
  }
}

type Etape = { readonly sorte: 'culture' } | { readonly sorte: 'formulaire'; readonly culture: CultureEnPlace } | { readonly sorte: 'enregistre'; readonly culture: CultureEnPlace; readonly ecrit: TraitementEcrit; readonly annule: boolean };

export function SaisieTraitement({ porte, fermeId, aujourdhui, surFermer, surEcrit, chargerCatalogue = chargerCatalogueEphy }: ProprietesSaisieTraitement): ReactElement {
  const idTitre = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const [lu, setLu] = useState<{ readonly cultures: readonly CultureEnPlace[]; readonly produits: readonly ProduitUtilisable[] } | null>(null);
  const [echecLecture, setEchecLecture] = useState(false);
  const [etape, setEtape] = useState<Etape>({ sorte: 'culture' });
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Une lecture du catalogue par dialogue ; un échec (hors ligne) se retente au produit suivant. */
  const catalogueLu = useRef<Promise<CatalogueEphy> | null>(null);
  const catalogue = (): Promise<CatalogueEphy> => {
    const c = (catalogueLu.current ??= chargerCatalogue());
    c.catch(() => {
      if (catalogueLu.current === c) catalogueLu.current = null;
    });
    return c;
  };

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
        surEcrit?.();
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
        surEcrit?.();
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
              catalogue={catalogue}
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
