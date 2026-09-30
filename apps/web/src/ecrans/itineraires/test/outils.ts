/**
 * Outils communs des tests d'écran de T24 : base mémoire de la ferme des itinéraires, porte qui
 * compte les transactions, lecture des lignes écrites, règles d'écriture (validerItineraire,
 * validerTypeIntervention, validerSerie, validerOccupation) et gestes dans le DOM simulé
 * (happy-dom). Même méthode que T12 (../../serie/test/outils.ts), horloge simulée comprise.
 */
import { act } from 'react';
import { expect, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import {
  validerItineraire,
  validerOccupation,
  validerSerie,
  validerTypeIntervention,
  type Id,
  type ItineraireEcrit,
  type Serie,
  type TypeInterventionEcrit,
} from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../../packages/sync/src/test/base-memoire.ts';
import { AUJOURDHUI_TESTS, ecrireFermeItineraires, FERME, UTILISATEUR } from './ferme-itineraires.ts';

export const AUJOURDHUI = AUJOURDHUI_TESTS;
/** Horloge fixe des tests : horodatages. */
export const MAINTENANT = new Date('2026-09-30T08:00:00.000Z');
export const ISO = MAINTENANT.toISOString();

export type Ligne = Readonly<Record<string, string | number | null>>;

export interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  /** Transactions d'écriture passées par la porte depuis le dernier `remiseAZero()`. */
  transactions(): number;
  /** Nombre d'écritures SQL de la base au dernier `remiseAZero()`. */
  ecrituresAvant(): number;
  remiseAZero(): void;
}

/** Base mémoire remplie de la ferme des itinéraires, porte posée sur une enveloppe qui compte les transactions. */
export async function creerBanc(): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeItineraires(base, AUJOURDHUI);
  let transactions = 0;
  let ecrituresAvant = base.ecritures.length;
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  const porte = creerPorte(compteuse, {
    utilisateurId: UTILISATEUR as Id<'Utilisateur'>,
    fermeId: FERME as Id<'Ferme'>,
    maintenant: () => MAINTENANT,
  });
  return {
    base,
    porte,
    transactions: () => transactions,
    ecrituresAvant: () => ecrituresAvant,
    remiseAZero: () => {
      transactions = 0;
      ecrituresAvant = base.ecritures.length;
    },
  };
}

export const lire = (b: Banc, sql: string, p: readonly unknown[] = []): Ligne[] => b.base.lireDirect<Ligne>(sql, p);
export const itineraire = (b: Banc, id: string): Ligne | undefined => lire(b, 'SELECT * FROM itineraire WHERE id = ?', [id])[0];
export const itineraires = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM itineraire ORDER BY id');
export const itinerairesDeLaFerme = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM itineraire WHERE ferme_id = ? ORDER BY id', [FERME]);
export const serie = (b: Banc, id: string): Ligne | undefined => lire(b, 'SELECT * FROM serie WHERE id = ?', [id])[0];
export const series = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM serie ORDER BY id');
export const occupations = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM occupation ORDER BY id');
export const occupationsDe = (b: Banc, serieId: string): Ligne[] => lire(b, 'SELECT * FROM occupation WHERE serie_id = ? ORDER BY id', [serieId]);
export const typeIntervention = (b: Banc, id: string): Ligne | undefined => lire(b, 'SELECT * FROM type_intervention WHERE id = ?', [id])[0];
export const typesIntervention = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM type_intervention ORDER BY id');

/** UUID v7 (version 7, variante RFC 4122). */
export const MOTIF_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ordres SQL d'écriture exécutés depuis le dernier `remiseAZero()`. */
export const ordres = (b: Banc): string[] => b.base.ecritures.slice(b.ecrituresAvant());

/**
 * Règles d'écriture de T24 sur les ordres SQL exécutés : jamais d'écriture dans `modification`
 * (le serveur l'écrit), jamais de DELETE ni de REPLACE sur les tables de l'écran (suppression
 * douce), jamais de changement d'espèce ni de ferme d'un itinéraire.
 */
export function verifierOrdres(b: Banc): void {
  const vers = (motif: RegExp) => ordres(b).filter((sql) => motif.test(sql));
  expect(vers(/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b[^;]*\bmodification\b/i), 'jamais d’écriture dans modification (le serveur l’écrit)').toEqual([]);
  expect(
    vers(/^\s*(DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+["`]?(itineraire|type_intervention|serie|occupation)\b/i),
    'jamais de DELETE ni de REPLACE (suppression douce)',
  ).toEqual([]);
  // Colonnes de la clause SET (avant WHERE) d'un UPDATE itineraire.
  const changeCulture = ordres(b).filter((sql) => {
    const set = /^\s*UPDATE\s+["`]?itineraire["`]?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(sql)?.[1] ?? '';
    return /\b(espece_id|ferme_id)\b/i.test(set);
  });
  expect(changeCulture, 'jamais d’UPDATE de espece_id ni de ferme_id d’un itinéraire').toEqual([]);
}

/** Les (catégorie, libellé) permis dans les travaux : types non supprimés de la ferme (masqués compris) et de la liste de départ. */
export function typesPermis(b: Banc): { categorie: string; type: string }[] {
  return lire(b, 'SELECT categorie, libelle FROM type_intervention WHERE supprime_le IS NULL AND (ferme_id = ? OR ferme_id IS NULL)', [FERME]).map((l) => ({
    categorie: String(l.categorie),
    type: String(l.libelle),
  }));
}

/** La ligne est acceptée par validerItineraire, avec la liste des types de la ferme ; rend l'itinéraire lu. */
export function itineraireValide(b: Banc, l: Ligne | undefined): ItineraireEcrit {
  if (l === undefined) throw new Error('itinéraire absent');
  const r = validerItineraire({ ...l }, { typesIntervention: typesPermis(b) });
  expect(r.ok, r.ok ? '' : `validerItineraire refuse ${String(l.id)} : ${r.erreur.message} (${String(r.erreur.champ)})`).toBe(true);
  if (!r.ok) throw new Error('itinéraire invalide');
  return r.valeur;
}

export function typeValide(l: Ligne | undefined): TypeInterventionEcrit {
  if (l === undefined) throw new Error('type absent');
  const r = validerTypeIntervention({ ...l });
  expect(r.ok, r.ok ? '' : `validerTypeIntervention refuse ${String(l.id)} : ${r.erreur.message}`).toBe(true);
  if (!r.ok) throw new Error('type invalide');
  return r.valeur;
}

export function serieValide(l: Ligne | undefined): Serie {
  if (l === undefined) throw new Error('série absente');
  const r = validerSerie({ ...l });
  expect(r.ok, r.ok ? '' : `validerSerie refuse ${String(l.id)} : ${r.erreur.message}`).toBe(true);
  if (!r.ok) throw new Error('série invalide');
  return r.valeur;
}

/** Chaque occupation active de la série est acceptée par validerOccupation, dates de la série comprises. */
export function occupationsValides(b: Banc, serieId: string): void {
  const lue = serieValide(serie(b, serieId));
  for (const o of occupationsDe(b, serieId)) {
    const r = validerOccupation({ ...o }, lue, { datesDeLaSerie: o.supprime_le === null });
    expect(r.ok, r.ok ? '' : `validerOccupation refuse ${String(o.id)} : ${r.erreur.message}`).toBe(true);
  }
}

/** Colonnes comparées pour « état identique » (horodatages de création et de modification exclus, JSON relu). */
export function etat(l: Ligne | undefined): Record<string, unknown> {
  if (l === undefined) return {};
  const r: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(l)) {
    if (c === 'cree_le' || c === 'modifie_le') continue;
    r[c] = (c === 'parametres' || c === 'rotation_acceptee') && typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  }
  return r;
}

/** Paramètres (texte JSON) d'une ligne, relus. */
export function parametresDe(l: Ligne | undefined): Record<string, unknown> {
  if (l === undefined || typeof l.parametres !== 'string') throw new Error('paramètres absents');
  return JSON.parse(l.parametres) as Record<string, unknown>;
}

// ── DOM ──────────────────────────────────────────────────────────────────────────────────────

/** Un tour de boucle (lectures de la base mémoire, rendu). Avance l'horloge simulée de 0 ms si elle est active. */
export async function unTour(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((r) => setTimeout(r, 0));
  });
}

export async function attendre(condition: () => boolean, message: string, tours = 300): Promise<void> {
  for (let k = 0; k < tours && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

export const texte = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Nom accessible simplifié : aria-label, aria-labelledby, <label>, puis le texte. */
export function nomAccessible(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  const par = el.getAttribute('aria-labelledby');
  if (par !== null) return par.split(/\s+/).map((i) => texte(document.getElementById(i))).join(' ').trim();
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const lie = el.id === '' ? null : document.querySelector(`label[for="${el.id}"]`);
    const englobant = el.closest('label');
    return texte(lie ?? englobant);
  }
  return texte(el);
}

const correspond = (nom: string | RegExp, el: Element) => (typeof nom === 'string' ? nomAccessible(el) === nom : nom.test(nomAccessible(el)));

export function boutons(dans: ParentNode = document): HTMLElement[] {
  return [...dans.querySelectorAll<HTMLElement>('button, [role="button"]')];
}

export function bouton(nom: string | RegExp, dans: ParentNode = document): HTMLElement {
  const trouves = boutons(dans).filter((b) => correspond(nom, b));
  expect(trouves.length, `un bouton « ${String(nom)} » (trouvés : ${boutons(dans).map(nomAccessible).join(' | ')})`).toBeGreaterThan(0);
  const b = trouves[0];
  if (b === undefined) throw new Error(`bouton ${String(nom)} absent`);
  return b;
}

export const aBouton = (nom: string | RegExp, dans: ParentNode = document): boolean => boutons(dans).some((b) => correspond(nom, b));

export const desactive = (b: HTMLElement): boolean =>
  ((b instanceof HTMLButtonElement || b instanceof HTMLInputElement || b instanceof HTMLSelectElement) && b.disabled) || b.getAttribute('aria-disabled') === 'true';

function trouverChamp(selecteur: string, nom: string | RegExp, dans: ParentNode): Element {
  const tous = [...dans.querySelectorAll(selecteur)];
  const trouves = tous.filter((c) => correspond(nom, c));
  expect(trouves.length, `un champ « ${String(nom)} » (trouvés : ${tous.map(nomAccessible).join(' | ')})`).toBeGreaterThan(0);
  const c = trouves[0];
  if (c === undefined) throw new Error(`champ ${String(nom)} absent`);
  return c;
}

/** Champ <input> par son nom accessible. */
export function champ(nom: string | RegExp, dans: ParentNode = document): HTMLInputElement {
  const c = trouverChamp('input', nom, dans);
  if (!(c instanceof HTMLInputElement)) throw new Error(`champ ${String(nom)} : pas un <input>`);
  return c;
}

/** Liste <select> par son nom accessible. */
export function liste(nom: string | RegExp, dans: ParentNode = document): HTMLSelectElement {
  const c = trouverChamp('select', nom, dans);
  if (!(c instanceof HTMLSelectElement)) throw new Error(`liste ${String(nom)} : pas un <select>`);
  return c;
}

export const aChamp = (nom: string | RegExp, dans: ParentNode = document): boolean =>
  [...dans.querySelectorAll('input, select')].some((c) => correspond(nom, c));

/** Radio (input type=radio ou role="radio") par son nom accessible. */
export function radio(nom: string, dans: ParentNode = document): HTMLElement {
  const tous = [...dans.querySelectorAll<HTMLElement>('input[type="radio"], [role="radio"]')];
  const r = tous.find((x) => nomAccessible(x) === nom);
  expect(r, `un radio « ${nom} » (trouvés : ${tous.map(nomAccessible).join(' | ')})`).toBeDefined();
  if (r === undefined) throw new Error(`radio ${nom} absent`);
  return r;
}

export const coche = (r: HTMLElement): boolean => (r instanceof HTMLInputElement ? r.checked : r.getAttribute('aria-checked') === 'true');

export async function toucher(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

/** Pose la valeur d'un champ comme le ferait une saisie (React écoute input / change). */
export async function remplir(c: HTMLInputElement | HTMLSelectElement, valeur: string): Promise<void> {
  await act(async () => {
    const proto = c instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(c, valeur);
    c.dispatchEvent(new Event('input', { bubbles: true }));
    c.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}

export const dialogues = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')];
export const dialogue = (nom: string | RegExp): HTMLElement | undefined =>
  dialogues().find((d) => (typeof nom === 'string' ? nomAccessible(d).startsWith(nom) : nom.test(nomAccessible(d))));

export function dialogueOuEchec(nom: string | RegExp): HTMLElement {
  const d = dialogue(nom);
  expect(d, `dialogue « ${String(nom)} » (ouverts : ${dialogues().map(nomAccessible).join(' | ')})`).toBeDefined();
  if (d === undefined) throw new Error(`dialogue ${String(nom)} absent`);
  return d;
}

/** Région (role="region" ou <section aria-label>) par son nom accessible. */
export function region(nom: string | RegExp, dans: ParentNode = document): HTMLElement {
  const toutes = [...dans.querySelectorAll<HTMLElement>('[role="region"], section[aria-label], section[aria-labelledby]')];
  const r = toutes.find((x) => (typeof nom === 'string' ? nomAccessible(x) === nom : nom.test(nomAccessible(x))));
  expect(r, `région « ${String(nom)} » (trouvées : ${toutes.map(nomAccessible).join(' | ')})`).toBeDefined();
  if (r === undefined) throw new Error(`région ${String(nom)} absente`);
  return r;
}
