/**
 * Harnais des tests d'écran de T24 : chaque test a sa propre base (ils écrivent), l'écran rendu
 * pour de vrai dans le DOM simulé, et les gestes du formulaire d'itinéraire (choisir un type,
 * ajouter un travail). Le module est chargé par import dynamique (chemin tenu dans une
 * variable) : le typage ne dépend pas du code pas encore écrit.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import type { ModuleItineraires } from './contrat.ts';
import { FERME } from './ferme-itineraires.ts';
import {
  aChamp,
  attendre,
  AUJOURDHUI,
  bouton,
  champ,
  coche,
  creerBanc,
  dialogue,
  dialogueOuEchec,
  liste,
  MAINTENANT,
  remplir,
  toucher,
  unTour,
  type Banc,
} from './outils.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_ECRAN = '../index.ts';

export const NOM_ECRAN = 'Mes itinéraires';
export const NOM_FORMULAIRE = /^(Nouvel itinéraire|Modifier l.itinéraire|Itinéraire de la bibliothèque)$/;

export interface Harnais {
  banc(): Banc;
  module(): ModuleItineraires;
  /** Appels de surFermer de l'écran. */
  fermetures(): number;
  /** Rend l'écran et attend les listes. */
  ouvrir(): Promise<HTMLElement>;
}

/** Pose les crochets beforeAll / beforeEach / afterEach du fichier de test ; rend les accès. */
export function harnais(): Harnais {
  let m: ModuleItineraires | undefined;
  let b: Banc | undefined;
  let conteneur: HTMLDivElement | undefined;
  let racine: Root | undefined;
  let fermetures = 0;

  beforeAll(async () => {
    m = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleItineraires;
  });

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    b = await creerBanc();
    conteneur = document.createElement('div');
    document.body.append(conteneur);
    racine = createRoot(conteneur);
    fermetures = 0;
  });

  afterEach(() => {
    act(() => {
      racine?.unmount();
    });
    conteneur?.remove();
    vi.useRealTimers();
    b?.base.fermer();
  });

  const banc = (): Banc => {
    if (b === undefined) throw new Error('banc absent');
    return b;
  };
  const module = (): ModuleItineraires => {
    if (m === undefined) throw new Error('module absent');
    return m;
  };

  return {
    banc,
    module,
    fermetures: () => fermetures,
    async ouvrir() {
      const Ecran = module().EcranItineraires;
      await act(async () => {
        racine?.render(
          createElement(Ecran, {
            porte: banc().porte,
            fermeId: FERME,
            surFermer: () => {
              fermetures++;
            },
            aujourdhui: () => AUJOURDHUI,
            maintenant: () => MAINTENANT,
          }),
        );
        await Promise.resolve();
      });
      await attendre(() => dialogue(NOM_ECRAN) !== undefined, `écran role="dialog" nommé « ${NOM_ECRAN} »`);
      const d = dialogueOuEchec(NOM_ECRAN);
      await attendre(() => d.querySelector('[data-testid="itineraire"]') !== null, 'itinéraires affichés');
      await attendre(() => d.querySelector('[data-testid="type-intervention"]') !== null, 'types d’intervention affichés');
      return d;
    },
  };
}

// ── Liste ────────────────────────────────────────────────────────────────────────────────────

export const ecran = (): HTMLElement => dialogueOuEchec(NOM_ECRAN);

export function elementItineraire(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="ecran-itineraires"] [data-testid="itineraire"][data-itineraire="${id}"]`);
}

export function itineraireOuEchec(id: string): HTMLElement {
  const el = elementItineraire(id);
  expect(el, `itinéraire ${id} dans la liste`).not.toBeNull();
  if (el === null) throw new Error(`itinéraire ${id} absent`);
  return el;
}

// ── Formulaire ───────────────────────────────────────────────────────────────────────────────

export const formulaireOuvert = (): HTMLElement | undefined => dialogue(NOM_FORMULAIRE);

export function formulaire(): HTMLElement {
  const f = formulaireOuvert();
  if (f === undefined) throw new Error('formulaire d’itinéraire fermé');
  return f;
}

/** Touche `nomBouton` (dans l'élément de liste de l'itinéraire `id`) et attend le formulaire utilisable. */
export async function ouvrirFormulaire(id: string, nomBouton: string | RegExp): Promise<HTMLElement> {
  await toucher(bouton(nomBouton, itineraireOuEchec(id)));
  await attendre(() => formulaireOuvert() !== undefined, 'formulaire d’itinéraire ouvert');
  await attendre(() => formulaire().querySelector('[data-testid="apercu-itineraire"]') !== null, 'aperçu dessiné');
  return formulaire();
}

export const travaux = (): HTMLElement[] => [...formulaire().querySelectorAll<HTMLElement>('[data-testid="travail-prevu"]')];

export function travail(indice: number): HTMLElement {
  const t = formulaire().querySelector<HTMLElement>(`[data-testid="travail-prevu"][data-indice="${String(indice)}"]`);
  expect(t, `travail prévu d’indice ${String(indice)}`).not.toBeNull();
  if (t === null) throw new Error(`travail ${String(indice)} absent`);
  return t;
}

/** Options de « Type » d'un travail (hors option vide). */
export function optionsType(groupe: HTMLElement): HTMLOptionElement[] {
  return [...liste('Type', groupe).options].filter((o) => o.value !== '');
}

export async function choisirType(groupe: HTMLElement, categorie: string, libelle: string): Promise<void> {
  const select = liste('Type', groupe);
  const o = [...select.options].find((x) => x.dataset.categorie === categorie && x.dataset.libelle === libelle);
  expect(o, `type ${categorie} / ${libelle} proposé (options : ${[...select.options].map((x) => x.dataset.libelle ?? '').join(' | ')})`).toBeDefined();
  if (o === undefined) return;
  await remplir(select, o.value);
}

export interface TravailSaisi {
  readonly categorie: string;
  readonly libelle: string;
  readonly jours: number;
  readonly sens: 'avant' | 'apres';
  readonly repere: string;
  readonly repetition?: { readonly tousLesJours: number; readonly repereFin: string };
  readonly minutes?: number;
  readonly par?: 'cent_metres' | 'planche';
}

/** « Ajouter un travail », puis le remplit ; rend son groupe. */
export async function ajouterTravail(t: TravailSaisi): Promise<HTMLElement> {
  const avant = travaux().length;
  await toucher(bouton('Ajouter un travail', formulaire()));
  await attendre(() => travaux().length === avant + 1, 'un travail de plus');
  const g = travail(avant);
  await remplirTravail(g, t);
  return g;
}

export async function remplirTravail(g: HTMLElement, t: TravailSaisi): Promise<void> {
  await choisirType(g, t.categorie, t.libelle);
  await remplir(champ('Jours', g), String(t.jours));
  await remplir(liste('Avant ou après', g), t.sens);
  await remplir(liste('Repère', g), t.repere);
  if (t.repetition !== undefined) {
    const c = champ('Répéter', g);
    if (!coche(c)) await toucher(c);
    await attendre(() => aChamp('Période (jours)', g), 'champ « Période (jours) » après « Répéter »');
    await remplir(champ('Période (jours)', g), String(t.repetition.tousLesJours));
    await remplir(liste('Fin de la répétition', g), t.repetition.repereFin);
  }
  if (t.minutes !== undefined) {
    await remplir(champ('Temps estimé (min)', g), String(t.minutes));
    await remplir(liste('Par', g), t.par ?? 'cent_metres');
  }
}

/** Dates de l'aperçu du travail `indice` ('' s'il ne tombe jamais ; undefined sans aperçu). */
export function datesApercu(indice: number): string | undefined {
  const el = formulaire().querySelector<HTMLElement>(`[data-testid="apercu-travail"][data-indice="${String(indice)}"]`);
  return el?.dataset.dates;
}

export function etapesApercu(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const el of formulaire().querySelectorAll<HTMLElement>('[data-testid="apercu-etape"]')) r[el.dataset.etape ?? '?'] = el.dataset.date ?? '';
  return r;
}

export async function enregistrer(): Promise<void> {
  await toucher(bouton('Enregistrer', formulaire()));
}

/** Laisse filer les écritures et rendus. */
export async function laisserFiler(tours = 10): Promise<void> {
  for (let k = 0; k < tours; k++) await unTour();
}

export const bandeau = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');
