/**
 * Saisir un traitement au champ (T52, règle 2), depuis Aujourd'hui : la culture, puis un seul
 * écran (emplacements cochés par défaut, produit, date du jour, dose, surface calculée, cible,
 * opérateur), « Enregistrer ». Chargé à la demande (morceau à part) ; reçoit la porte, tout marche
 * hors ligne. Saisie manuelle (principe 3) : écrite au tap, « Annuler ce traitement » reste
 * possible tant que le dialogue est ouvert, puis depuis le registre (onglet Ferme).
 *
 * La dose au-dessus de la dose maximale du produit est dite (avertissement), jamais bloquée.
 *
 * Délai avant récolte (T76) : un champ du formulaire, seule source du DAR figé dans le traitement.
 * Produit venu d'e-phy (son AMM est dans le catalogue) : prérempli du DAR de l'usage de LA culture
 * traitée s'il est unique ; usages de DAR différents : l'utilisateur choisit ; aucun usage :
 * avertissement « non homologué » (non bloquant), DAR à saisir ; DAR absent d'e-phy (Q47) : vide,
 * jamais deviné. Produit sans N° AMM, ou dont l'AMM n'est pas dans le catalogue : DAR de la fiche.
 * Produit avec N° AMM et catalogue en chargement ou indisponible : champ vide et avis « e-phy
 * indisponible » (non bloquant) ; jamais le DAR de la fiche, qui peut être celui d'une autre culture.
 *
 * Plusieurs cultures (T78) : cases « Cultures traitées » ; produit, date, dose, cible et opérateur
 * communs ; pour chaque culture cochée, ses emplacements, son DAR (règle ci-dessus appliquée à
 * CETTE culture) et sa surface. Le cœur (detailsLotTraitement) juge les DAR, tout ou rien ; un
 * événement par culture, en une transaction ; « Annuler ce traitement » annule tout le lot.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { avertissementDose, DAR_MAX_JOURS, detailsLotTraitement, jourMois, surfaceEmplacements } from '@planif/core';
import { propositionsPourCultures, type CatalogueEphy, type UsageEphy } from '@planif/core/ephy';
import { libelleUsage } from '../../ferme/phyto/RechercheEphy.tsx';
import type { PorteDonnees } from '@planif/sync';
import '../../parcellaire/parcellaire.css';
import { annoncerSaisie } from '../cache.ts';
import {
  annulerLotTraitement,
  ecrireLotTraitement,
  lireCulturesEnPlace,
  lireProduitsUtilisables,
  TraitementPlusEnVigueur,
  TraitementRefuse,
  type CultureEnPlace,
  type ProduitUtilisable,
  type SaisieDuTraitement,
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
  /**
   * Catalogue e-phy (T76) ; défaut : celui de l'appli, chargé à la demande (cache du navigateur,
   * hors ligne après un premier chargement). Un échec n'empêche rien : DAR de la fiche du produit.
   */
  readonly chargerCatalogue?: () => Promise<CatalogueEphy>;
}

/** Catalogue gardé en mémoire pour la session : une seule lecture ; un échec se retente à l'ouverture suivante. */
let catalogueEnMemoire: Promise<CatalogueEphy> | null = null;

function chargerCatalogueParDefaut(): Promise<CatalogueEphy> {
  catalogueEnMemoire ??= import('../../ferme/phyto/catalogue.ts')
    .then((m) => m.chargerCatalogueEphy())
    .catch((e: unknown) => {
      catalogueEnMemoire = null;
      throw e;
    });
  return catalogueEnMemoire;
}

/** Ce que l'e-phy dit du produit pour une culture traitée. */
interface UsagesCulture {
  readonly homologue: boolean;
  readonly candidats: readonly UsageEphy[];
  readonly dar: number | null;
}

/**
 * Ce que l'e-phy dit du produit pour chaque culture cochée (T76 par culture, T78), par id de
 * culture ; null : produit hors e-phy (ou catalogue absent).
 */
function usagesCultures(catalogue: CatalogueEphy | null, produit: ProduitUtilisable | null, cultures: readonly CultureEnPlace[]): ReadonlyMap<string, UsagesCulture> | null {
  if (catalogue === null || produit === null || produit.numeroAmm === '') return null;
  const p = catalogue.produits.find((x) => x.amm.trim() === produit.numeroAmm);
  return p === undefined ? null : new Map(propositionsPourCultures(p, cultures.map((c) => ({ id: c.cibleId, espece: c.espece }))).map((x) => [x.id, x]));
}

/**
 * DAR tapé pour le lot, même règle que `lireJours` (chiffres seuls) : vide → null (manquant) ;
 * tout autre texte (« 1e1 », « 0x5 », « 5. », « +3 », « 2,5 ») → NaN, que le cœur refuse (invalide).
 */
function joursDuLot(texte: string): number | null {
  const t = texte.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** Unité par surface (« L/ha », « kg/ha », « g/hL ») ; sinon une quantité totale. */
const unitePorteeParSurface = (unite: string): boolean => /\/\s*h[al]\b/i.test(unite.trim());

/** « 12 » → 12 ; vide, décimal, négatif ou au-delà d'un an → null. */
function lireJours(texte: string): number | null {
  const t = texte.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= DAR_MAX_JOURS ? n : null;
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

/** Une culture traitée du lot, telle qu'enregistrée : la confirmation dit son DAR (T78). */
interface LigneDuLot {
  readonly culture: CultureEnPlace;
  readonly dar: number;
  readonly ecrit: TraitementEcrit;
}

interface ProprietesFormulaire {
  /** La culture choisie à l'étape 1. */
  readonly culture: CultureEnPlace;
  /** Toutes les cultures en place ce jour : on peut en cocher plusieurs (T78). */
  readonly cultures: readonly CultureEnPlace[];
  readonly produits: readonly ProduitUtilisable[];
  /** null : en chargement, ou indisponible. */
  readonly catalogue: CatalogueEphy | null;
  readonly aujourdhui: string;
  readonly occupe: boolean;
  readonly message: string | null;
  /** Une saisie par culture cochée, dans l'ordre ; `dar` : le DAR figé de chacune. */
  readonly surEnregistrer: (lot: readonly { readonly culture: CultureEnPlace; readonly dar: number; readonly saisie: SaisieDuTraitement }[]) => void;
  readonly surMessage: (m: string | null) => void;
}

type ParCulture<T> = Readonly<Record<string, T>>;

const sans = <T,>(r: ParCulture<T>, cle: string): ParCulture<T> => Object.fromEntries(Object.entries(r).filter(([k]) => k !== cle));

function Formulaire({ culture: initiale, cultures, produits, catalogue, aujourdhui, occupe, message, surEnregistrer, surMessage }: ProprietesFormulaire): ReactElement {
  const id = useId();
  const [cochees, setCochees] = useState<ReadonlySet<string>>(() => new Set([initiale.cibleId]));
  /** Emplacements cochés, par culture. */
  const [coches, setCoches] = useState<ParCulture<ReadonlySet<string>>>(() => Object.fromEntries(cultures.map((c) => [c.cibleId, new Set(c.emplacements.map((e) => e.id))])));
  const [produitId, setProduitId] = useState('');
  const [date, setDate] = useState(aujourdhui);
  const [dose, setDose] = useState('');
  const [unite, setUnite] = useState(UNITE_PAR_DEFAUT);
  const [surfacesSaisies, setSurfacesSaisies] = useState<ParCulture<string>>({});
  const [cible, setCible] = useState('');
  const [operateur, setOperateur] = useState('');
  /** DAR tapé ou choisi, par culture ; absent : la proposition (e-phy de CETTE culture, ou fiche du produit). */
  const [darsSaisis, setDarsSaisis] = useState<ParCulture<string>>({});
  const [usagesChoisis, setUsagesChoisis] = useState<ParCulture<number>>({});

  /** Les cultures traitées, dans l'ordre de la liste ; la culture d'origine si rien d'autre (jamais vide). */
  const traitees = useMemo(() => {
    const t = cultures.filter((c) => cochees.has(c.cibleId));
    return t.length > 0 ? t : [initiale];
  }, [cultures, cochees, initiale]);
  const lot = traitees.length > 1;
  const produit = produits.find((p) => p.id === produitId) ?? null;
  const ephy = useMemo(() => usagesCultures(catalogue, produit, traitees), [catalogue, produit, traitees]);
  /** Produit avec N° AMM, catalogue absent : l'usage de chaque culture est inconnu, rien n'est proposé. */
  const ephyInconnu = produit !== null && produit.numeroAmm !== '' && catalogue === null;
  const valeurDose = lireNombre(dose);
  const avertissement = produit === null || valeurDose === null ? null : avertissementDose({ valeur: valeurDose, unite }, produit.doseMaximale);

  const cochesDe = (c: CultureEnPlace): ReadonlySet<string> => coches[c.cibleId] ?? new Set<string>();
  const emplacementsDe = (c: CultureEnPlace) => c.emplacements.filter((e) => cochesDe(c).has(e.id));
  const surfaceDe = (c: CultureEnPlace): string => surfacesSaisies[c.cibleId] ?? enFrancais(surfaceEmplacements(emplacementsDe(c)));
  const ephyDe = (c: CultureEnPlace): UsagesCulture | null => ephy?.get(c.cibleId) ?? null;
  const darDe = (c: CultureEnPlace): string => {
    const saisi = darsSaisis[c.cibleId];
    if (saisi !== undefined) return saisi;
    const e = ephyDe(c);
    // Jamais le DAR de la fiche pour un produit d'e-phy, ni celui d'une autre culture (T76, Q47).
    return produit === null || ephyInconnu ? '' : e === null ? String(produit.delaiAvantRecolteJours) : e.dar === null ? '' : String(e.dar);
  };
  const choixUsageDe = (c: CultureEnPlace): boolean => {
    const e = ephyDe(c);
    return e !== null && e.dar === null && e.candidats.length > 1;
  };

  function basculerCulture(c: CultureEnPlace): void {
    setCochees((avant) => {
      const n = new Set(avant);
      if (n.has(c.cibleId)) n.delete(c.cibleId);
      else n.add(c.cibleId);
      return n.size === 0 ? avant : n;
    });
    // Recochée : tous ses emplacements, sa surface recalculée, son DAR proposé à nouveau.
    setCoches((avant) => ({ ...avant, [c.cibleId]: new Set(c.emplacements.map((e) => e.id)) }));
    setSurfacesSaisies((avant) => sans(avant, c.cibleId));
    setDarsSaisis((avant) => sans(avant, c.cibleId));
    setUsagesChoisis((avant) => sans(avant, c.cibleId));
  }

  function basculer(c: CultureEnPlace, e: string): void {
    setCoches((avant) => {
      const n = new Set(avant[c.cibleId] ?? []);
      if (n.has(e)) n.delete(e);
      else n.add(e);
      return { ...avant, [c.cibleId]: n };
    });
    setSurfacesSaisies((avant) => sans(avant, c.cibleId));
  }

  function choisirProduit(v: string): void {
    setProduitId(v);
    setDarsSaisis({});
    setUsagesChoisis({});
    const p = produits.find((x) => x.id === v);
    if (p?.doseMaximale != null) setUnite(p.doseMaximale.unite);
  }

  /** Le problème commun à tout le lot (hors DAR), ou null. */
  function problemeCommun(): string | null {
    const sansEmplacement = traitees.find((c) => c.emplacements.length > 0 && emplacementsDe(c).length === 0);
    const sansSurface = traitees.find((c) => lireNombre(surfaceDe(c)) === null);
    return valeurDose === null
      ? 'Indiquez la dose (un nombre, virgule acceptée).'
      : unite.trim() === ''
        ? 'Indiquez l’unité de la dose.'
        : sansSurface !== undefined
          ? `Indiquez la surface traitée en m² (un nombre)${lot ? ` pour ${sansSurface.nom}` : ''}.`
          : cible.trim() === ''
            ? 'Indiquez la cible (ravageur ou maladie).'
            : date === '' || date > aujourdhui
              ? 'La date du traitement ne peut pas être après aujourd’hui.'
              : sansEmplacement !== undefined
                ? `Cochez au moins un emplacement traité${lot ? ` pour ${sansEmplacement.nom}` : ''}.`
                : null;
  }

  function enregistrer(): void {
    if (produit === null) {
      surMessage('Choisissez le produit.');
      return;
    }
    // Une seule culture : le DAR d'abord, comme avant T78.
    const seule = lot ? undefined : traitees[0];
    if (seule !== undefined && lireJours(darDe(seule)) === null) {
      surMessage(`Indiquez le délai avant récolte (jours entiers, ${String(DAR_MAX_JOURS)} au plus)${choixUsageDe(seule) ? ', ou choisissez l’usage e-phy' : ''}.`);
      return;
    }
    const commun = problemeCommun();
    if (commun !== null || valeurDose === null) {
      surMessage(commun);
      return;
    }
    // Le DAR de chaque culture est jugé par le cœur : tout ou rien, aucun deviné (T78).
    const r = detailsLotTraitement(
      produit,
      { dose: { valeur: valeurDose, unite: unite.trim() }, cible, operateur },
      date,
      traitees.map((c) => ({ cultureId: c.cibleId, surfaceTraiteeM2: lireNombre(surfaceDe(c)) ?? 0, delaiAvantRecolteJours: joursDuLot(darDe(c)) })),
    );
    if (!r.ok) {
      const fautive = traitees.find((c) => c.cibleId === r.erreur.champ);
      const nom = fautive?.nom ?? '';
      surMessage(
        r.erreur.code === 'dar_manquant'
          ? `Indiquez le délai avant récolte pour ${nom}${fautive !== undefined && choixUsageDe(fautive) ? ', ou choisissez son usage e-phy' : ''}.`
          : r.erreur.code === 'dar_invalide'
            ? `Délai avant récolte de ${nom} : jours entiers, de 0 à ${String(DAR_MAX_JOURS)}.`
            : 'Cochez au moins une culture traitée, une seule fois chacune.',
      );
      return;
    }
    surMessage(null);
    surEnregistrer(
      traitees.map((c) => {
        const dar = joursDuLot(darDe(c)) ?? 0;
        return {
          culture: c,
          dar,
          saisie: {
            culture: c.cible,
            emplacementIds: emplacementsDe(c).map((e) => e.id),
            // Le DAR figé est celui du champ de CETTE culture, pas forcément celui de la fiche (T76, T78).
            produit: { ...produit, delaiAvantRecolteJours: dar },
            date,
            dose: { valeur: valeurDose, unite: unite.trim() },
            surfaceTraiteeM2: lireNombre(surfaceDe(c)) ?? 0,
            cible,
            operateur,
          },
        };
      }),
    );
  }

  /** Emplacements d'une culture ; T69 : la dernière planche cochée le reste (un traitement sans planche bloquerait toute la culture). */
  const emplacements = (c: CultureEnPlace, legende: string) =>
    c.emplacements.length > 0 && (
      <fieldset className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="parc-etiquette">{legende}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {c.emplacements.map((e) => (
            <label key={e.id} className="parc-bouton-secondaire" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={cochesDe(c).has(e.id)} disabled={cochesDe(c).has(e.id) && cochesDe(c).size === 1} style={{ width: 28, height: 28 }} onChange={() => { basculer(c, e.id); }} />
              {e.code}
            </label>
          ))}
        </div>
      </fieldset>
    );

  const avertissementCulture = (c: CultureEnPlace) => {
    const e = ephyDe(c);
    return (
      e !== null &&
      !e.homologue && (
        <p data-testid="avertissement-culture" data-cible={c.cibleId} role="status" className="parc-erreur">
          Produit non homologué sur cette culture dans e-phy ({c.espece}). Vérifiez avant de traiter ; le délai avant récolte est à saisir.
        </p>
      )
    );
  };

  const choixUsage = (c: CultureEnPlace, k: number) => {
    const e = ephyDe(c);
    if (e === null || !choixUsageDe(c)) return null;
    return (
      <div role="radiogroup" aria-label={lot ? `Usage e-phy pour ${c.nom}` : 'Usage e-phy pour cette culture'} className="parc-champ-bloc">
        <span className="parc-etiquette">Usage e-phy (le délai avant récolte en dépend)</span>
        <div className="parc-liste">
          {e.candidats.map((u, i) => (
            <label key={`${String(i)}-${libelleUsage(u)}`} className="parc-bouton-secondaire" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
              <input
                type="radio"
                name={`${id}-usage-${String(k)}`}
                checked={usagesChoisis[c.cibleId] === i}
                style={{ width: 24, height: 24, flex: 'none' }}
                onChange={() => {
                  setUsagesChoisis((avant) => ({ ...avant, [c.cibleId]: i }));
                  setDarsSaisis((avant) => ({ ...avant, [c.cibleId]: u.dar === null ? '' : String(u.dar) }));
                }}
              />
              {libelleUsage(u)}
            </label>
          ))}
        </div>
      </div>
    );
  };

  const champDar = (c: CultureEnPlace, cle: string, suffixe: string) => (
    <div className="parc-champ-bloc">
      <label className="parc-etiquette" htmlFor={`${id}-dar${cle}`}>
        Délai avant récolte (jours){suffixe}
      </label>
      <input id={`${id}-dar${cle}`} className="parc-champ" inputMode="numeric" autoComplete="off" value={darDe(c)} onChange={(e) => { const v = e.target.value; setDarsSaisis((avant) => ({ ...avant, [c.cibleId]: v })); }} />
    </div>
  );

  const champSurface = (c: CultureEnPlace, cle: string, suffixe: string) => (
    <div className="parc-champ-bloc">
      <label className="parc-etiquette" htmlFor={`${id}-surface${cle}`}>
        Surface traitée (m²){suffixe}
      </label>
      <input id={`${id}-surface${cle}`} className="parc-champ" inputMode="decimal" autoComplete="off" value={surfaceDe(c)} onChange={(e) => { const v = e.target.value; setSurfacesSaisies((avant) => ({ ...avant, [c.cibleId]: v })); }} />
    </div>
  );

  const seule = traitees[0] ?? initiale;

  return (
    <div className="parc-carte">
      {cultures.length > 1 && (
        <fieldset className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="parc-etiquette">Cultures traitées</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {cultures.map((c) => (
              <label key={c.cibleId} className="parc-bouton-secondaire" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {/* La dernière culture cochée le reste : un traitement vise au moins une culture. */}
                <input type="checkbox" checked={cochees.has(c.cibleId)} disabled={cochees.has(c.cibleId) && cochees.size === 1} style={{ width: 28, height: 28 }} onChange={() => { basculerCulture(c); }} />
                {c.nom}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!lot && emplacements(seule, 'Emplacements')}
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
      {ephyInconnu && (
        <p data-testid="avertissement-ephy" role="status" className="parc-erreur">
          e-phy indisponible sur ce téléphone : vérifiez le DAR pour {lot ? 'chaque culture' : 'cette culture'}, puis saisissez-le.
        </p>
      )}
      {lot ? (
        traitees.map((c, k) => (
          <fieldset key={c.cibleId} className="parc-champ-bloc" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="parc-etiquette">
              <strong>{c.nom}</strong>
            </legend>
            {emplacements(c, `Emplacements · ${c.nom}`)}
            {avertissementCulture(c)}
            {choixUsage(c, k)}
            <div className="parc-grille">
              {champDar(c, `-${String(k)}`, ` · ${c.nom}`)}
              {champSurface(c, `-${String(k)}`, ` · ${c.nom}`)}
            </div>
          </fieldset>
        ))
      ) : (
        <>
          {avertissementCulture(seule)}
          {choixUsage(seule, 0)}
        </>
      )}
      <div className="parc-grille">
        {!lot && champDar(seule, '', '')}
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
        {!lot && champSurface(seule, '', '')}
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
      {lot && unite.trim() !== '' && !unitePorteeParSurface(unite) && (
        <p data-testid="avertissement-unite-lot" role="status" className="parc-erreur">
          Unité « {unite.trim()} » : c’est une quantité totale, et elle sera notée telle quelle pour chaque culture. Préférez une dose par hectare (L/ha, kg/ha), ou saisissez chaque culture à part.
        </p>
      )}
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

type Etape =
  | { readonly sorte: 'culture' }
  | { readonly sorte: 'formulaire'; readonly culture: CultureEnPlace }
  | { readonly sorte: 'enregistre'; readonly culture: CultureEnPlace; readonly lot: readonly LigneDuLot[]; readonly annule: boolean };

export function SaisieTraitement({ porte, fermeId, aujourdhui, surFermer, surEcrit, chargerCatalogue = chargerCatalogueParDefaut }: ProprietesSaisieTraitement): ReactElement {
  const idTitre = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const [lu, setLu] = useState<{ readonly cultures: readonly CultureEnPlace[]; readonly produits: readonly ProduitUtilisable[] } | null>(null);
  const [echecLecture, setEchecLecture] = useState(false);
  const [etape, setEtape] = useState<Etape>({ sorte: 'culture' });
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueEphy | null>(null);
  const charge = useRef(chargerCatalogue);
  const avecAmm = lu?.produits.some((p) => p.numeroAmm !== '') === true;

  // Le catalogue e-phy n'est chargé que si un produit de la ferme a un N° AMM.
  useEffect(() => {
    if (!avecAmm) return;
    let actif = true;
    charge.current().then(
      (c) => {
        if (actif) setCatalogue(c);
      },
      (e: unknown) => {
        console.warn('Catalogue e-phy indisponible : DAR des fiches produit', e);
      },
    );
    return () => {
      actif = false;
    };
  }, [avecAmm]);

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

  function enregistrer(culture: CultureEnPlace, lot: readonly { readonly culture: CultureEnPlace; readonly dar: number; readonly saisie: SaisieDuTraitement }[]): void {
    setOccupe(true);
    // Une culture ou plusieurs : un événement par culture, en une transaction (T78).
    ecrireLotTraitement(
      porte,
      lot.map((l) => l.saisie),
      annoncer,
      aujourdhui,
    ).then(
      (ecrits) => {
        setOccupe(false);
        setEtape({ sorte: 'enregistre', culture, lot: lot.flatMap((l, i) => { const ecrit = ecrits[i]; return ecrit === undefined ? [] : [{ culture: l.culture, dar: l.dar, ecrit }]; }), annule: false });
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
    // Tout le lot ou rien, en une transaction.
    annulerLotTraitement(
      porte,
      fermeId,
      etape.lot.map((l) => l.ecrit.id),
      aujourdhui,
      annoncer,
    ).then(
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
              cultures={lu.cultures}
              produits={lu.produits}
              catalogue={catalogue}
              aujourdhui={aujourdhui}
              occupe={occupe}
              message={message}
              surMessage={setMessage}
              surEnregistrer={(lot) => {
                enregistrer(etape.culture, lot);
              }}
            />
          ) : (
            <div className="parc-carte" role="status">
              <strong style={{ fontSize: 20 }}>{etape.annule ? 'Traitement annulé' : 'Traitement noté'}</strong>
              {!etape.annule &&
                (etape.lot.length === 1 ? (
                  <span>Récolte autorisée le {jourMois(etape.lot[0]?.ecrit.recolteAutoriseeLe ?? '')}. Enregistré sur le téléphone, envoyé dès que le réseau revient.</span>
                ) : (
                  <>
                    <ul className="parc-liste">
                      {etape.lot.map((l) => (
                        <li key={l.culture.cibleId} data-testid="lot-culture" data-cible={l.culture.cibleId}>
                          <strong>{l.culture.nom}</strong> · DAR {String(l.dar)} j · Récolte autorisée le {jourMois(l.ecrit.recolteAutoriseeLe)}
                        </li>
                      ))}
                    </ul>
                    <span>Enregistré sur le téléphone, envoyé dès que le réseau revient.</span>
                  </>
                ))}
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
