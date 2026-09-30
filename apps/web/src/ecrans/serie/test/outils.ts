/**
 * Outils communs des tests d'écran de T12 (../ecran.test.tsx, ../plan.test.tsx) : base mémoire
 * de la ferme du plan, porte qui compte les transactions, lecture des lignes écrites, et gestes
 * dans le DOM simulé (happy-dom). Même méthode que les tests de T13.
 */
import { act } from 'react';
import { expect } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerOccupation, validerSerie, type Id, type Serie } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../../packages/sync/src/test/base-memoire.ts';
import { ecrireFermeSerie, FERME, UTILISATEUR } from './ferme-serie.ts';

export const AUJOURDHUI = '2026-09-30';
/** Horloge fixe des tests : horodatages et décision de rotation. */
export const MAINTENANT = new Date('2026-09-30T08:00:00.000Z');

export type Ligne = Readonly<Record<string, string | number | null>>;

export interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  /** Transactions d'écriture passées par la porte depuis le dernier `remiseAZero()`. */
  transactions(): number;
  remiseAZero(): void;
}

/** Base mémoire remplie de la ferme du plan, porte posée sur une enveloppe qui compte les transactions. */
export async function creerBanc(): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeSerie(base);
  let transactions = 0;
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
    remiseAZero: () => {
      transactions = 0;
    },
  };
}

export const series = (b: Banc): Ligne[] => b.base.lireDirect<Ligne>('SELECT * FROM serie ORDER BY id');
export const serie = (b: Banc, id: string): Ligne | undefined => b.base.lireDirect<Ligne>('SELECT * FROM serie WHERE id = ?', [id])[0];
export const occupationsDe = (b: Banc, serieId: string): Ligne[] =>
  b.base.lireDirect<Ligne>('SELECT * FROM occupation WHERE serie_id = ? ORDER BY id', [serieId]);
export const toutesOccupations = (b: Banc): Ligne[] => b.base.lireDirect<Ligne>('SELECT * FROM occupation ORDER BY id');

/** UUID v7 (version 7, variante RFC 4122). */
export const MOTIF_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Règles d'écriture de T12 sur les ordres SQL exécutés : jamais d'écriture dans `modification`
 * (le serveur seul), jamais de DELETE ni de REPLACE sur `serie` ou `occupation`.
 */
export function verifierOrdres(b: Banc): void {
  const vers = (motif: RegExp) => b.base.ecritures.filter((sql) => motif.test(sql));
  expect(vers(/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b[^;]*\bmodification\b/i), 'jamais d’écriture dans modification (le serveur l’écrit)').toEqual([]);
  expect(
    vers(/^\s*(DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+["`]?(serie|occupation)\b/i),
    'jamais de DELETE ni de REPLACE sur serie ou occupation (suppression douce)',
  ).toEqual([]);
}

/** La série est acceptée par validerSerie (règles rejouées par le serveur) ; rend la série lue. */
export function serieValide(l: Ligne): Serie {
  const r = validerSerie({ ...l });
  expect(r.ok, r.ok ? '' : `validerSerie refuse ${String(l.id)} : ${r.erreur.message}`).toBe(true);
  if (!r.ok) throw new Error('série invalide');
  return r.valeur;
}

/** Chaque occupation active est acceptée par validerOccupation, dates de la série comprises (fin de lot). */
export function occupationsValides(b: Banc, serieId: string): void {
  const s = serie(b, serieId);
  if (s === undefined) throw new Error(`série ${serieId} absente`);
  const lue = serieValide(s);
  for (const o of occupationsDe(b, serieId)) {
    const r = validerOccupation({ ...o }, lue, { datesDeLaSerie: o.supprime_le === null });
    expect(r.ok, r.ok ? '' : `validerOccupation refuse ${String(o.id)} : ${r.erreur.message}`).toBe(true);
  }
}

/** Colonnes comparées pour « état identique » (horodatages de création et de modification exclus). */
export function etat(l: Ligne | undefined): Record<string, unknown> {
  if (l === undefined) return {};
  const r: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(l)) {
    if (c === 'cree_le' || c === 'modifie_le') continue;
    r[c] = (c === 'parametres' || c === 'rotation_acceptee') && typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  }
  return r;
}

// ── DOM ──────────────────────────────────────────────────────────────────────────────────────

/** Un tour de boucle (lectures de la base mémoire, rendu). */
export async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

export async function attendre(condition: () => boolean, message: string, tours = 300): Promise<void> {
  for (let k = 0; k < tours && !condition(); k++) await unTour();
  expect(condition(), message).toBe(true);
}

export async function patienter(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
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
  ((b instanceof HTMLButtonElement || b instanceof HTMLInputElement) && b.disabled) || b.getAttribute('aria-disabled') === 'true';

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

/** Compte les gestes : chaque appui passe par ici. */
export const compteur = { gestes: 0 };

export async function toucher(b: HTMLElement): Promise<void> {
  compteur.gestes++;
  await act(async () => {
    b.click();
    await Promise.resolve();
  });
  await unTour();
}

/** Pose la valeur d'un champ comme le ferait une saisie (React écoute input / change). Un geste. */
export async function remplir(c: HTMLInputElement | HTMLSelectElement, valeur: string): Promise<void> {
  compteur.gestes++;
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
export const dialogue = (debutNom: string): HTMLElement | undefined => dialogues().find((d) => nomAccessible(d).startsWith(debutNom));

export function dialogueOuEchec(debutNom: string): HTMLElement {
  const d = dialogue(debutNom);
  expect(d, `dialogue « ${debutNom}… » (ouverts : ${dialogues().map(nomAccessible).join(' | ')})`).toBeDefined();
  if (d === undefined) throw new Error(`dialogue ${debutNom} absent`);
  return d;
}
