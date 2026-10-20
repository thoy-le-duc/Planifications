/**
 * « Ma ferme : saisons, zones, planches » (T49). Chargé à la demande depuis l'onglet Ferme ; il
 * reçoit la porte (ni PowerSync, ni src/donnees). Contrat : ./test/contrat.ts.
 *
 * Une ferme neuve, sans tableur, s'y met en route au doigt : la saison de l'année en un tap, ses
 * zones, puis des planches en lot (« 10 planches P de 30 × 0,8 m »), chacune modifiable ensuite.
 * Règles : ./regles.ts ; écritures (une transaction par geste, annulable 10 s) : ./ecritures.ts.
 */
import { useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { painsParDefaut } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import './parcellaire.css';
import {
  ajouterPlanches,
  avertissementHorsService,
  avertissementSaison,
  changerService,
  creerSaison,
  creerZone,
  EcritureRefusee,
  modifierEmplacement,
  modifierSaison,
  modifierZone,
  supprimerEmplacement,
  supprimerSaison,
  supprimerZone,
  type ContexteParcellaire,
  type Enregistrement,
} from './ecritures.ts';
import {
  codesDuLot,
  LIBELLES_ABRI,
  LIBELLES_SORTE,
  lireNombre,
  saisonProposee,
  SORTES,
  TYPES_ABRI,
  verifierEmplacement,
  verifierLot,
  verifierSaison,
  verifierZone,
} from './regles.ts';
import type { ProprietesEcranVannes } from './vannes/EcranVannes.tsx';

/** Durée du bandeau « Annuler » (comme T12, T13, T24). */
export const DELAI_ANNULATION_MS = 10_000;

export interface ProprietesEcranParcellaire {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Section à montrer d'abord (parcours guidé). */
  readonly section?: 'saisons' | 'zones';
  readonly surFermer: () => void;
  /** « Vous avez déjà un tableur ? » : ouvre l'import (T14b). */
  readonly surImporter?: () => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

interface SaisonLue {
  readonly id: string;
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
}
interface ZoneLue {
  readonly id: string;
  readonly nom: string;
  readonly typeAbri: string;
  readonly parenteId: string | null;
}
interface PlancheLue {
  readonly id: string;
  readonly zoneId: string;
  readonly code: string;
  readonly sorte: string;
  readonly longueurM: number;
  readonly largeurM: number | null;
  /** T51 : pains d'une gouttière (l'ancien nombre de places n'est plus lu). */
  readonly nombrePains: number | null;
  readonly actifAu: string | null;
}

type L = Readonly<Record<string, unknown>>;
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const txtOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nbOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const deux = (n: number) => String(n).padStart(2, '0');
function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}
const maintenantParDefaut = () => new Date();

function dateCourte(jour: string): string {
  const [a, m, j] = jour.split('-').map(Number);
  if (a === undefined || m === undefined || j === undefined) return jour;
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
const libelleAbri = (t: string): string => (LIBELLES_ABRI as Readonly<Partial<Record<string, string>>>)[t] ?? t;
const libelleSorte = (t: string): string => (LIBELLES_SORTE as Readonly<Partial<Record<string, string>>>)[t] ?? t;
const nombreFr = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));
const comparerCodes = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
const messageEchec = (e: unknown): string => (e instanceof EcritureRefusee ? `Rien n’a été enregistré : ${e.message}.` : 'Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');

/** Garde le focus clavier dans le dialogue (Tab, Maj+Tab). */
function garderLeFocus(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const cibles = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')];
  const premiere = cibles[0];
  const derniere = cibles[cibles.length - 1];
  if (premiere === undefined || derniere === undefined) return;
  if (e.shiftKey && document.activeElement === premiere) {
    e.preventDefault();
    derniere.focus();
  } else if (!e.shiftKey && document.activeElement === derniere) {
    e.preventDefault();
    premiere.focus();
  }
}

const CROIX = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// ── Briques ──────────────────────────────────────────────────────────────────────────────────

function Champ({ etiquette, valeur, surChange, type = 'text', mode, large = false }: { etiquette: string; valeur: string; surChange: (v: string) => void; type?: 'text' | 'date'; mode?: 'decimal' | 'numeric'; large?: boolean }) {
  const id = useId();
  return (
    <div className={large ? 'parc-champ-bloc parc-large' : 'parc-champ-bloc'}>
      <label htmlFor={id} className="parc-etiquette">
        {etiquette}
      </label>
      <input
        id={id}
        type={type}
        autoComplete="off"
        {...(mode === undefined ? {} : { inputMode: mode })}
        className="parc-champ"
        value={valeur}
        onChange={(e) => {
          surChange(e.target.value);
        }}
      />
    </div>
  );
}

function Liste({ etiquette, valeur, surChange, options, large = false }: { etiquette: string; valeur: string; surChange: (v: string) => void; options: readonly (readonly [string, string])[]; large?: boolean }) {
  const id = useId();
  return (
    <div className={large ? 'parc-champ-bloc parc-large' : 'parc-champ-bloc'}>
      <label htmlFor={id} className="parc-etiquette">
        {etiquette}
      </label>
      <select
        id={id}
        className="parc-champ"
        value={valeur}
        onChange={(e) => {
          surChange(e.target.value);
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Feuille de saisie en bas de l'écran (dialogue modal). */
function Saisie({ titre, surFermer, children, message }: { titre: string; surFermer: () => void; children: ReactNode; message: string | null }) {
  const idTitre = useId();
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus();
  }, []);
  return (
    <div className="parc-voile-saisie">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        className="parc-saisie"
        onKeyDown={(e) => {
          garderLeFocus(e);
          if (e.key === 'Escape') {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <h3 id={idTitre} ref={h} tabIndex={-1}>
          {titre}
        </h3>
        {children}
        {message !== null && (
          <p role="alert" className="parc-erreur">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Saison ───────────────────────────────────────────────────────────────────────────────────

interface ProprietesFormulaire {
  readonly ctx: ContexteParcellaire;
  readonly surFermer: () => void;
  readonly surEnregistre: (e: Enregistrement | null) => void;
}

function FormulaireSaison({ ctx, saison, nomsPris, surFermer, surEnregistre }: ProprietesFormulaire & { readonly saison: SaisonLue | null; readonly nomsPris: readonly string[] }) {
  const [depart] = useState(() => saison ?? saisonProposee(ctx.aujourdhui, nomsPris));
  const [nom, setNom] = useState(depart.nom);
  const [debut, setDebut] = useState(depart.debut);
  const [fin, setFin] = useState(depart.fin);
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function faire(action: () => Promise<Enregistrement | null>): Promise<void> {
    setOccupe(true);
    try {
      surEnregistre(await action());
      surFermer();
    } catch (e) {
      console.error('Saison non enregistrée', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  /** Avertissement montré (dates qui laissent des séries dehors) : le prochain tap enregistre quand même. */
  const [averti, setAverti] = useState(false);

  async function enregistrer(): Promise<void> {
    const v = verifierSaison({ nom, debut, fin });
    if (!v.ok) {
      setMessage(v.message);
      return;
    }
    if (saison !== null && !averti) {
      const a = await avertissementSaison(ctx, saison.id, v.valeur).catch(() => null);
      if (a !== null) {
        setMessage(a);
        setAverti(true);
        return;
      }
    }
    void faire(() => (saison === null ? creerSaison(ctx, v.valeur) : modifierSaison(ctx, saison.id, v.valeur)));
  }

  const changer = (f: (v: string) => void) => (v: string) => {
    f(v);
    setMessage(null);
    setAverti(false);
  };
  return (
    <Saisie titre={saison === null ? 'Nouvelle saison' : 'Modifier la saison'} surFermer={surFermer} message={message}>
      <div className="parc-grille">
        <Champ etiquette="Nom" valeur={nom} surChange={changer(setNom)} large />
        <Champ etiquette="Début" type="date" valeur={debut} surChange={changer(setDebut)} />
        <Champ etiquette="Fin" type="date" valeur={fin} surChange={changer(setFin)} />
      </div>
      <div className="parc-actions">
        <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={() => void enregistrer()}>
          {averti ? 'Enregistrer quand même' : 'Enregistrer'}
        </button>
        {saison !== null && (
          <button type="button" className="parc-bouton-danger" disabled={occupe} onClick={() => void faire(() => supprimerSaison(ctx, saison.id))}>
            Supprimer la saison
          </button>
        )}
        <button type="button" className="parc-bouton-secondaire" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </Saisie>
  );
}

// ── Zone ─────────────────────────────────────────────────────────────────────────────────────

/** Zones où ranger `zoneId` : toutes, sauf elle et ses sous-zones (pas de boucle). */
function parentesPossibles(zones: readonly ZoneLue[], zoneId: string | null): ZoneLue[] {
  if (zoneId === null) return [...zones];
  const exclues = new Set([zoneId]);
  for (let ajout = true; ajout; ) {
    ajout = false;
    for (const z of zones) {
      if (z.parenteId !== null && exclues.has(z.parenteId) && !exclues.has(z.id)) {
        exclues.add(z.id);
        ajout = true;
      }
    }
  }
  return zones.filter((z) => !exclues.has(z.id));
}

function FormulaireZone({
  ctx,
  zone,
  zones,
  surFermer,
  surEnregistre,
  surSupprimee,
}: ProprietesFormulaire & { readonly zone: ZoneLue | null; readonly zones: readonly ZoneLue[]; readonly surSupprimee: () => void }) {
  const [nom, setNom] = useState(zone?.nom ?? '');
  const [type, setType] = useState(zone?.typeAbri ?? 'plein_champ');
  const [parente, setParente] = useState(zone?.parenteId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const possibles = parentesPossibles(zones, zone?.id ?? null);

  async function faire(action: () => Promise<Enregistrement | null>, apres?: () => void): Promise<void> {
    setOccupe(true);
    try {
      surEnregistre(await action());
      surFermer();
      apres?.();
    } catch (e) {
      console.error('Zone non enregistrée', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    const v = verifierZone({ nom, typeAbri: type, parenteId: parente === '' ? null : parente });
    if (!v.ok) {
      setMessage(v.message);
      return;
    }
    void faire(() => (zone === null ? creerZone(ctx, v.valeur) : modifierZone(ctx, zone.id, v.valeur)));
  }

  return (
    <Saisie titre={zone === null ? 'Nouvelle zone' : 'Modifier la zone'} surFermer={surFermer} message={message}>
      <div className="parc-grille">
        <Champ
          etiquette="Nom"
          valeur={nom}
          surChange={(v) => {
            setNom(v);
            setMessage(null);
          }}
          large
        />
        <Liste etiquette="Type d’abri" valeur={type} surChange={setType} options={TYPES_ABRI.map((t) => [t, LIBELLES_ABRI[t]] as const)} large />
        <Liste etiquette="Dans la zone" valeur={parente} surChange={setParente} options={[['', 'Aucune (zone principale)'] as const, ...possibles.map((z) => [z.id, z.nom] as const)]} large />
      </div>
      <div className="parc-actions">
        <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={enregistrer}>
          Enregistrer
        </button>
        {zone !== null && (
          <button type="button" className="parc-bouton-danger" disabled={occupe} onClick={() => void faire(() => supprimerZone(ctx, zone.id), surSupprimee)}>
            Supprimer la zone
          </button>
        )}
        <button type="button" className="parc-bouton-secondaire" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </Saisie>
  );
}

// ── Planche ──────────────────────────────────────────────────────────────────────────────────

function FormulairePlanche({ ctx, planche, codesPris, surFermer, surEnregistre }: ProprietesFormulaire & { readonly planche: PlancheLue; readonly codesPris: readonly string[] }) {
  const [code, setCode] = useState(planche.code);
  const [sorte, setSorte] = useState(planche.sorte);
  const [longueur, setLongueur] = useState(nombreFr(planche.longueurM));
  const [largeur, setLargeur] = useState(nombreFr(planche.largeurM));
  // T51 : pains saisis ; null tant qu'ils ne sont pas touchés (proposés à 1 par mètre de longueur).
  const [painsSaisis, setPainsSaisis] = useState<string | null>(planche.nombrePains === null ? null : String(planche.nombrePains));
  const longueurLue = lireNombre(longueur);
  const pains = painsSaisis ?? (longueurLue === null || longueurLue <= 0 ? '' : String(painsParDefaut(longueurLue)));
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const enService = planche.actifAu === null;

  async function faire(action: () => Promise<Enregistrement | null>): Promise<void> {
    setOccupe(true);
    try {
      surEnregistre(await action());
      surFermer();
    } catch (e) {
      console.error('Planche non enregistrée', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    const v = verifierEmplacement({ code, sorte, longueur, largeur, nombrePains: sorte === 'gouttiere' ? pains : '' }, enService ? codesPris : []);
    if (!v.ok) {
      setMessage(v.message);
      return;
    }
    void faire(() => modifierEmplacement(ctx, planche.id, v.valeur));
  }

  /** Avertissement montré (planche encore occupée) : le prochain tap la met hors service quand même. */
  const [averti, setAverti] = useState(false);
  async function basculerService(): Promise<void> {
    if (enService && !averti) {
      const a = await avertissementHorsService(ctx, planche.id).catch(() => null);
      if (a !== null) {
        setMessage(a);
        setAverti(true);
        return;
      }
    }
    await faire(() => changerService(ctx, planche.id, !enService));
  }

  const changer = (f: (v: string) => void) => (v: string) => {
    f(v);
    setMessage(null);
  };
  /** Un pain de plus ou de moins, au doigt (au moins 1). */
  const ajouterPains = (delta: number) => () => {
    const n = lireNombre(pains);
    const depart = n === null || !Number.isInteger(n) ? 1 : n;
    setPainsSaisis(String(Math.max(1, depart + delta)));
    setMessage(null);
  };
  return (
    <Saisie titre={`Modifier ${planche.code}`} surFermer={surFermer} message={message}>
      <div className="parc-grille">
        <Champ etiquette="Code" valeur={code} surChange={changer(setCode)} />
        <Liste etiquette="Sorte" valeur={sorte} surChange={changer(setSorte)} options={SORTES.map((s) => [s, LIBELLES_SORTE[s]] as const)} />
        <Champ etiquette="Longueur (m)" mode="decimal" valeur={longueur} surChange={changer(setLongueur)} />
        <Champ etiquette="Largeur (m)" mode="decimal" valeur={largeur} surChange={changer(setLargeur)} />
        {sorte === 'gouttiere' && (
          <>
            <Champ etiquette="Nombre de pains" mode="numeric" valeur={pains} surChange={changer(setPainsSaisis)} large />
            <div className="parc-pas parc-large">
              <button type="button" className="parc-bouton-secondaire" aria-label="Un pain de moins" onClick={ajouterPains(-1)}>
                −1
              </button>
              <button type="button" className="parc-bouton-secondaire" aria-label="Un pain de plus" onClick={ajouterPains(1)}>
                +1
              </button>
            </div>
          </>
        )}
      </div>
      {sorte === 'gouttiere' && <p className="parc-aide">1 pain ≈ 1 m (pains, sacs ou pots posés sur la gouttière).</p>}
      {!enService && <p className="parc-aide">Hors service depuis le {dateCourte(planche.actifAu)} : elle n’est plus proposée pour les nouvelles séries.</p>}
      <div className="parc-actions">
        <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={enregistrer}>
          Enregistrer
        </button>
        <button type="button" className="parc-bouton-secondaire" disabled={occupe} onClick={() => void basculerService()}>
          {enService ? (averti ? 'Mettre hors service quand même' : 'Mettre hors service') : 'Remettre en service'}
        </button>
        <button type="button" className="parc-bouton-danger" disabled={occupe} onClick={() => void faire(() => supprimerEmplacement(ctx, planche.id))}>
          Supprimer la planche
        </button>
        <button type="button" className="parc-bouton-secondaire" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </Saisie>
  );
}

// ── Dialogue d'une zone : ses planches, en ajouter en lot ────────────────────────────────────

function DialogueZone({
  ctx,
  zone,
  planches,
  surFermer,
  surModifierZone,
  surModifierPlanche,
  surEnregistre,
}: {
  readonly ctx: ContexteParcellaire;
  readonly zone: ZoneLue;
  readonly planches: readonly PlancheLue[];
  readonly surFermer: () => void;
  readonly surModifierZone: () => void;
  readonly surModifierPlanche: (p: PlancheLue) => void;
  readonly surEnregistre: (e: Enregistrement | null) => void;
}) {
  const idTitre = useId();
  const h = useRef<HTMLHeadingElement>(null);
  const derniere = planches[planches.length - 1];
  const [nombre, setNombre] = useState('');
  const [prefixe, setPrefixe] = useState('P');
  const [longueur, setLongueur] = useState(derniere === undefined ? '' : nombreFr(derniere.longueurM));
  const [largeur, setLargeur] = useState(derniere === undefined ? '' : nombreFr(derniere.largeurM));
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    h.current?.focus();
  }, []);
  const codesPris = planches.filter((p) => p.actifAu === null).map((p) => p.code);
  const n = lireNombre(nombre);
  const apercu = n !== null && Number.isInteger(n) && n >= 1 && n <= 200 ? codesDuLot(prefixe, n, codesPris) : [];

  async function ajouter(): Promise<void> {
    const v = verifierLot({ nombre, prefixe, longueur, largeur }, codesPris);
    if (!v.ok) {
      setMessage(v.message);
      return;
    }
    setOccupe(true);
    try {
      surEnregistre(await ajouterPlanches(ctx, zone.id, v.valeur));
      setNombre('');
      setMessage(null);
    } catch (e) {
      console.error('Planches non ajoutées', e);
      setMessage(messageEchec(e));
    } finally {
      setOccupe(false);
    }
  }

  const changer = (f: (v: string) => void) => (v: string) => {
    f(v);
    setMessage(null);
  };
  const enService = planches.filter((p) => p.actifAu === null).length;
  return (
    <div className="parc-voile parc-voile-zone">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
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
            <span className="parc-surtitre">
              {libelleAbri(zone.typeAbri)} · {enService} {enService > 1 ? 'planches' : 'planche'}
            </span>
            <h2 id={idTitre} ref={h} tabIndex={-1}>
              {zone.nom}
            </h2>
          </div>
          <button type="button" aria-label="Fermer" className="parc-fermer" onClick={surFermer}>
            {CROIX}
          </button>
        </div>
        <div className="parc-corps">
          <button type="button" className="parc-bouton-secondaire" onClick={surModifierZone}>
            Modifier la zone
          </button>
          <section className="parc-carte" aria-label="Ajouter des planches">
            <h3 className="parc-etiquette">Ajouter des planches</h3>
            <div className="parc-grille">
              <Champ etiquette="Nombre de planches" mode="numeric" valeur={nombre} surChange={changer(setNombre)} />
              <Champ etiquette="Préfixe du code" valeur={prefixe} surChange={changer(setPrefixe)} />
              <Champ etiquette="Longueur (m)" mode="decimal" valeur={longueur} surChange={changer(setLongueur)} />
              <Champ etiquette="Largeur (m)" mode="decimal" valeur={largeur} surChange={changer(setLargeur)} />
            </div>
            <p className="parc-aide" aria-live="polite">
              {apercu.length === 0 ? 'Les codes se suivent dans la zone : P1, P2, P3…' : apercu.length === 1 ? `Code : ${apercu[0] ?? ''}` : `Codes : ${apercu[0] ?? ''} à ${apercu[apercu.length - 1] ?? ''}`}
            </p>
            {message !== null && (
              <p role="alert" className="parc-erreur">
                {message}
              </p>
            )}
            <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={() => void ajouter()}>
              Ajouter les planches
            </button>
          </section>
          {planches.length === 0 ? (
            <p className="parc-aide">Aucune planche dans cette zone pour l’instant.</p>
          ) : (
            <ul className="parc-liste" aria-label="Planches de la zone">
              {planches.map((p) => (
                <li key={p.id} data-testid="planche" data-emplacement={p.id}>
                  <button type="button" aria-label={`Modifier ${p.code}`} className={p.actifAu === null ? 'parc-ligne' : 'parc-ligne parc-ligne-hors'} onClick={() => {
                    surModifierPlanche(p);
                  }}>
                    <span className="parc-ligne-textes">
                      <strong>{p.code}</strong>
                      <span>
                        {libelleSorte(p.sorte)} · {nombreFr(p.longueurM)} m{p.largeurM === null ? '' : ` × ${nombreFr(p.largeurM)} m`}
                        {p.nombrePains === null ? '' : ` · ${String(p.nombrePains)} pains`}
                        {p.actifAu === null ? '' : ' · hors service'}
                      </span>
                    </span>
                    <span aria-hidden="true" className="parc-chevron">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Écran ────────────────────────────────────────────────────────────────────────────────────

type Formulaire =
  | { readonly sorte: 'saison'; readonly saison: SaisonLue | null }
  | { readonly sorte: 'zone'; readonly zone: ZoneLue | null }
  | { readonly sorte: 'planche'; readonly planche: PlancheLue };

interface Bandeau extends Enregistrement {
  readonly numero: number;
}

export function EcranParcellaire({ porte, fermeId, section, surFermer, surImporter, aujourdhui = jourDuTelephone, maintenant = maintenantParDefaut }: ProprietesEcranParcellaire): ReactElement {
  const [jour] = useState(aujourdhui);
  const ctx = useMemo<ContexteParcellaire>(() => ({ porte, fermeId, maintenant, aujourdhui: jour }), [porte, fermeId, maintenant, jour]);
  const [saisons, setSaisons] = useState<SaisonLue[] | null>(null);
  const [zones, setZones] = useState<ZoneLue[] | null>(null);
  const [planches, setPlanches] = useState<PlancheLue[] | null>(null);
  const [zoneOuverte, setZoneOuverte] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState<(Formulaire & { readonly numero: number }) | null>(null);
  const [bandeau, setBandeau] = useState<Bandeau | null>(null);
  const [echec, setEchec] = useState<{ readonly titre: string; readonly texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const compteur = useRef(0);
  const idTitre = useId();
  const idSaisons = useId();
  const idZones = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const titreZones = useRef<HTMLHeadingElement>(null);

  useEffect(
    () =>
      porte.surveiller<SaisonLue>(
        {
          sql: 'SELECT id, nom, debut, fin FROM saison WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY debut, nom, id',
          parametres: [fermeId],
          tables: ['saison'],
          convertir: (l: L) => ({ id: txt(l.id), nom: txt(l.nom), debut: txt(l.debut), fin: txt(l.fin) }),
        },
        setSaisons,
      ),
    [porte, fermeId],
  );
  useEffect(
    () =>
      porte.surveiller<ZoneLue>(
        {
          sql: 'SELECT id, nom, type_abri, zone_parente_id FROM zone WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY nom, id',
          parametres: [fermeId],
          tables: ['zone'],
          convertir: (l: L) => ({ id: txt(l.id), nom: txt(l.nom), typeAbri: txt(l.type_abri), parenteId: txtOuNul(l.zone_parente_id) }),
        },
        setZones,
      ),
    [porte, fermeId],
  );
  useEffect(
    () =>
      porte.surveiller<PlancheLue>(
        {
          sql: 'SELECT id, zone_id, code, sorte, longueur_m, largeur_m, nombre_pains, actif_au FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL',
          parametres: [fermeId],
          tables: ['emplacement'],
          convertir: (l: L) => ({
            id: txt(l.id),
            zoneId: txt(l.zone_id),
            code: txt(l.code),
            sorte: txt(l.sorte),
            longueurM: nbOuNul(l.longueur_m) ?? 0,
            largeurM: nbOuNul(l.largeur_m),
            nombrePains: nbOuNul(l.nombre_pains),
            actifAu: txtOuNul(l.actif_au),
          }),
        },
        (l) => {
          setPlanches(l.sort((a, b) => comparerCodes(a.code, b.code) || (a.id < b.id ? -1 : 1)));
        },
      ),
    [porte, fermeId],
  );

  const pret = saisons !== null && zones !== null && planches !== null;

  // T57 : l'écran des vannes, chargé au premier tap sur « Vannes » (hors du morceau du parcellaire).
  const [Vannes, setVannes] = useState<ComponentType<ProprietesEcranVannes> | null>(null);
  const [vannesOuvertes, setVannesOuvertes] = useState(false);
  function ouvrirVannes(): void {
    setVannesOuvertes(true);
    if (Vannes !== null) return;
    import('./vannes/index.ts').then(
      (m) => {
        setVannes(() => m.EcranVannes);
      },
      (e: unknown) => {
        console.error('Écran des vannes : chargement impossible', e);
        setVannesOuvertes(false);
        setEchec({ titre: 'Vannes indisponibles', texte: 'L’écran des vannes n’a pas pu s’ouvrir : réessayez.' });
      },
    );
  }

  useEffect(() => {
    if (section === 'zones') titreZones.current?.focus();
    else titre.current?.focus();
  }, [section]);

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

  function enregistre(e: Enregistrement | null): void {
    if (e === null) return;
    compteur.current += 1;
    setEchec(null);
    setBandeau({ ...e, numero: compteur.current });
  }

  function ouvrir(f: Formulaire): void {
    compteur.current += 1;
    setFormulaire({ ...f, numero: compteur.current });
  }

  function annuler(b: Bandeau): void {
    setBandeau(null);
    b.annuler().catch((e: unknown) => {
      console.error('Annulation impossible', e);
      setEchec({ titre: 'Annulation impossible', texte: `« ${b.texte} » reste tel quel : ${e instanceof EcritureRefusee ? e.message : 'la base du téléphone a refusé l’écriture'}.` });
    });
  }

  async function saisonEnUnTap(): Promise<void> {
    if (occupe || saisons === null) return;
    setOccupe(true);
    try {
      enregistre(await creerSaison(ctx, saisonProposee(jour, saisons.map((s) => s.nom))));
    } catch (e) {
      console.error('Saison non créée', e);
      setEchec({ titre: 'Saison non créée', texte: messageEchec(e) });
    } finally {
      setOccupe(false);
    }
  }

  const listeZones = useMemo(() => zones ?? [], [zones]);
  const listePlanches = planches ?? [];
  /** Zones dans l'ordre de l'arbre (sous-zones sous leur parente), avec leur profondeur. */
  const arbre = useMemo(() => {
    const parParente = new Map<string | null, ZoneLue[]>();
    const ids = new Set(listeZones.map((z) => z.id));
    for (const z of listeZones) {
      const p = z.parenteId !== null && ids.has(z.parenteId) ? z.parenteId : null;
      parParente.set(p, [...(parParente.get(p) ?? []), z]);
    }
    const sortie: { readonly zone: ZoneLue; readonly profondeur: number }[] = [];
    const vues = new Set<string>();
    const descendre = (p: string | null, profondeur: number) => {
      for (const z of parParente.get(p) ?? []) {
        if (vues.has(z.id)) continue;
        vues.add(z.id);
        sortie.push({ zone: z, profondeur });
        descendre(z.id, profondeur + 1);
      }
    };
    descendre(null, 0);
    for (const z of listeZones) if (!vues.has(z.id)) sortie.push({ zone: z, profondeur: 0 });
    return sortie;
  }, [listeZones]);
  const zone = zoneOuverte === null ? undefined : listeZones.find((z) => z.id === zoneOuverte);
  const planchesDe = (zoneId: string) => listePlanches.filter((p) => p.zoneId === zoneId);
  const proposee = saisons === null ? null : saisonProposee(jour, saisons.map((s) => s.nom));

  return (
    <>
      <div className="parc-voile">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitre}
          data-testid="ecran-parcellaire"
          className="parc-feuille"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && formulaire === null && zoneOuverte === null && !vannesOuvertes) surFermer();
          }}
        >
          <div className="parc-tete">
            <div className="parc-tete-textes">
              <span className="parc-surtitre">Saisons, zones et planches</span>
              <h2 id={idTitre} ref={titre} tabIndex={-1}>
                Ma ferme
              </h2>
            </div>
            <button type="button" aria-label="Fermer" className="parc-fermer" onClick={surFermer}>
              {CROIX}
            </button>
          </div>
          <div className="parc-corps" {...(pret ? { 'data-testid': 'parcellaire-pret' } : {})}>
            {!pret ? (
              <p className="parc-aide">Lecture de la ferme…</p>
            ) : (
              <>
                <section className="parc-section" aria-labelledby={idSaisons}>
                  <h3 id={idSaisons}>Saisons</h3>
                  {saisons.length === 0 ? (
                    <>
                      <p className="parc-aide">Aucune saison pour l’instant. Une saison regroupe les séries d’une année : le plan des planches et les tâches en partent.</p>
                      {proposee !== null && (
                        <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={() => void saisonEnUnTap()}>
                          Créer la saison {proposee.nom}
                        </button>
                      )}
                    </>
                  ) : (
                    <ul className="parc-liste">
                      {saisons.map((s) => (
                        <li key={s.id} data-testid="saison" data-saison={s.id}>
                          <button
                            type="button"
                            aria-label={`Modifier la saison ${s.nom}`}
                            className="parc-ligne"
                            onClick={() => {
                              ouvrir({ sorte: 'saison', saison: s });
                            }}
                          >
                            <span className="parc-ligne-textes">
                              <strong>{s.nom}</strong>
                              <span>
                                {dateCourte(s.debut)} → {dateCourte(s.fin)}
                              </span>
                            </span>
                            <span aria-hidden="true" className="parc-chevron">
                              ›
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="parc-bouton-secondaire"
                    onClick={() => {
                      ouvrir({ sorte: 'saison', saison: null });
                    }}
                  >
                    Nouvelle saison
                  </button>
                </section>

                <section className="parc-section" aria-labelledby={idZones}>
                  <h3 id={idZones} ref={titreZones} tabIndex={-1}>
                    Zones et planches
                  </h3>
                  {arbre.length === 0 ? (
                    <p className="parc-aide">Aucune zone pour l’instant. Une zone, c’est un tunnel, une serre, un îlot de plein champ : ajoutez-la, puis ses planches.</p>
                  ) : (
                    <ul className="parc-liste">
                      {arbre.map(({ zone: z, profondeur }) => {
                        const n = planchesDe(z.id).filter((p) => p.actifAu === null).length;
                        return (
                          <li key={z.id} data-testid="zone" data-zone={z.id} style={profondeur > 0 ? { paddingLeft: Math.min(profondeur, 3) * 18 } : undefined}>
                            <button
                              type="button"
                              aria-label={`Ouvrir ${z.nom}`}
                              className="parc-ligne"
                              onClick={() => {
                                setZoneOuverte(z.id);
                              }}
                            >
                              <span className="parc-ligne-textes">
                                <strong>{z.nom}</strong>
                                <span>
                                  {libelleAbri(z.typeAbri)} · {n === 0 ? 'aucune planche' : `${String(n)} ${n > 1 ? 'planches' : 'planche'}`}
                                </span>
                              </span>
                              <span aria-hidden="true" className="parc-chevron">
                                ›
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="parc-bouton-secondaire"
                    onClick={() => {
                      ouvrir({ sorte: 'zone', zone: null });
                    }}
                  >
                    Nouvelle zone
                  </button>
                </section>

                <section className="parc-section" aria-label="Vannes d’irrigation">
                  <p className="parc-aide">Les vannes d’irrigation : déclarez-les d’un coup, puis dites ce que chacune arrose.</p>
                  <button type="button" className="parc-bouton-secondaire" onClick={ouvrirVannes}>
                    Vannes
                  </button>
                </section>

                {surImporter !== undefined && (
                  <section className="parc-section" aria-label="Importer">
                    <p className="parc-aide">Vous avez déjà un tableur (parcellaire, cultures, séries) ? Importez-le d’un coup.</p>
                    <button type="button" className="parc-bouton-secondaire" onClick={surImporter}>
                      Importer un tableur
                    </button>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {zone !== undefined && (
        <DialogueZone
          key={zone.id}
          ctx={ctx}
          zone={zone}
          planches={planchesDe(zone.id)}
          surFermer={() => {
            setZoneOuverte(null);
          }}
          surModifierZone={() => {
            ouvrir({ sorte: 'zone', zone });
          }}
          surModifierPlanche={(p) => {
            ouvrir({ sorte: 'planche', planche: p });
          }}
          surEnregistre={enregistre}
        />
      )}

      {formulaire?.sorte === 'saison' && (
        <FormulaireSaison
          key={formulaire.numero}
          ctx={ctx}
          saison={formulaire.saison}
          nomsPris={(saisons ?? []).map((s) => s.nom)}
          surFermer={() => {
            setFormulaire(null);
          }}
          surEnregistre={enregistre}
        />
      )}
      {formulaire?.sorte === 'zone' && (
        <FormulaireZone
          key={formulaire.numero}
          ctx={ctx}
          zone={formulaire.zone}
          zones={listeZones}
          surFermer={() => {
            setFormulaire(null);
          }}
          surEnregistre={enregistre}
          // Zone supprimée depuis son dialogue : il se ferme avec elle.
          surSupprimee={() => {
            setZoneOuverte(null);
          }}
        />
      )}
      {formulaire?.sorte === 'planche' && (
        <FormulairePlanche
          key={formulaire.numero}
          ctx={ctx}
          planche={formulaire.planche}
          codesPris={listePlanches.filter((p) => p.zoneId === formulaire.planche.zoneId && p.id !== formulaire.planche.id && p.actifAu === null).map((p) => p.code)}
          surFermer={() => {
            setFormulaire(null);
          }}
          surEnregistre={enregistre}
        />
      )}

      {vannesOuvertes && Vannes !== null && (
        <Vannes
          porte={porte}
          fermeId={fermeId}
          aujourdhui={() => jour}
          maintenant={maintenant}
          surFermer={() => {
            setVannesOuvertes(false);
          }}
        />
      )}

      {bandeau !== null && (
        <div key={bandeau.numero} data-testid="saisie-annulable" role="status" className="parc-bandeau">
          <span className="parc-bandeau-texte">
            <strong>Enregistré</strong>
            <span>{bandeau.texte}</span>
          </span>
          <button
            type="button"
            className="parc-bandeau-annuler"
            onClick={() => {
              annuler(bandeau);
            }}
          >
            Annuler
          </button>
        </div>
      )}
      {echec !== null && bandeau === null && (
        <div role="alert" className="parc-bandeau parc-bandeau-echec">
          <span className="parc-bandeau-texte">
            <strong>{echec.titre}</strong>
            <span>{echec.texte}</span>
          </span>
          <button
            type="button"
            className="parc-bandeau-annuler"
            onClick={() => {
              setEchec(null);
            }}
          >
            OK
          </button>
        </div>
      )}
    </>
  );
}

export default EcranParcellaire;
