// @vitest-environment happy-dom
/**
 * Tests d'acceptation T12 — le plan de culture depuis l'écran Planches (T11) : appui long sur une
 * case vide (planche et semaine préremplies), bouton « Nouvelle série », « Modifier la série »
 * depuis le détail d'une barre, bandeau « Annuler » après l'enregistrement, plantations en
 * lecture seule. DOM simulé (happy-dom), ferme du plan (./test/ferme-serie.ts), aujourd'hui =
 * 2026-09-30 (saison 2026 affichée par défaut). Contrat : ./test/contrat.ts, « Écran Planches ».
 *
 * happy-dom ne calcule pas la mise en page : getBoundingClientRect rend 0, la semaine sous le
 * doigt se lit donc directement dans clientX (contrat : LARGEUR_ETIQUETTE_PX + i ×
 * LARGEUR_SEMAINE_PX, exportés par ecrans/plan/calculs.ts). La géométrie réelle est vérifiée
 * par apps/web/e2e/serie.e2e.ts.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ecartEnJours, lundiDeSemaine, semaineIso, type DateCalendaire } from '@planif/core';
import type { ModuleEcranPlan } from '../plan/test/contrat.ts';
import { DELAI_APPUI_LONG_MS, type GeometriePlan } from './test/contrat.ts';
import { ATTENDU, EMPLACEMENT, ESPECE, FERME, OCCUPATION_FRAISE, OCCUPATION_LAITUE, SAISON, SERIE_LAITUE, VARIETE } from './test/ferme-serie.ts';
import {
  aBouton,
  attendre,
  AUJOURDHUI,
  bouton,
  boutons,
  champ,
  liste,
  compteur,
  creerBanc,
  dialogue,
  dialogueOuEchec,
  etat,
  nomAccessible,
  occupationsDe,
  occupationsValides,
  patienter,
  radio,
  remplir,
  serie,
  series,
  texte,
  toucher,
  verifierOrdres,
  type Banc,
} from './test/outils.ts';

/** Chemins tenus dans des variables : le typage ne dépend pas du code pas encore écrit. */
const CHEMIN_PLAN = '../plan/index.ts';
const CHEMIN_CALCULS = '../plan/calculs.ts';

let plan: ModuleEcranPlan;
let geometrie: GeometriePlan;

beforeAll(async () => {
  plan = (await import(/* @vite-ignore */ CHEMIN_PLAN)) as ModuleEcranPlan;
  geometrie = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as GeometriePlan;
});

let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  compteur.gestes = 0;
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
});

const ligne = (emplacementId: string): HTMLElement | null =>
  conteneur.querySelector<HTMLElement>(`[data-testid="ligne-plan"][data-sorte="emplacement"][data-id="${emplacementId}"]`);

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<plan.EcranPlan porte={b.porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => ligne(EMPLACEMENT.t2p01) !== null, 'plan affiché');
}

/** Affiche la saison 2027 (sélecteur « Saison » de T11). */
async function saison2027(): Promise<void> {
  await remplir(liste('Saison', conteneur), SAISON.s2027);
  await attendrePlan(() => conteneur.querySelector(`[data-testid="barre"][data-occupation="${OCCUPATION_LAITUE}"]`) !== null, 'plan 2027 affiché');
}

/** Abscisse (clientX) du milieu de la semaine ISO `annee`-S`numero` dans une saison qui commence le `debutSaison`. */
function xSemaine(debutSaison: string, annee: number, numero: number): number {
  const s = semaineIso(debutSaison as DateCalendaire);
  const premierLundi = lundiDeSemaine(s.annee, s.semaine);
  const indice = ecartEnJours(premierLundi, lundiDeSemaine(annee, numero)) / 7;
  return geometrie.LARGEUR_ETIQUETTE_PX + indice * geometrie.LARGEUR_SEMAINE_PX + geometrie.LARGEUR_SEMAINE_PX / 2;
}

function pointeur(type: string, cible: HTMLElement, x: number): void {
  cible.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: 20, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 }),
  );
}

/** Appui tenu `dureeMs` sur la ligne de `emplacementId`, à l'abscisse `x`. Un geste. */
async function appui(emplacementId: string, x: number, dureeMs: number): Promise<void> {
  const l = ligne(emplacementId);
  expect(l, `ligne ${emplacementId} affichée`).not.toBeNull();
  if (l === null) return;
  compteur.gestes++;
  await act(async () => {
    pointeur('pointerdown', l, x);
    await Promise.resolve();
  });
  await patienter(dureeMs);
  await act(async () => {
    pointeur('pointerup', l, x);
    l.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: 20 }));
    await Promise.resolve();
  });
  await patienter(20);
}

const formulaireCreation = () => dialogue('Nouvelle série');

/** Le plan se relit au plus toutes les 300 ms (T11, B1) : attente en temps réel, 5 s au plus. */
async function attendrePlan(condition: () => boolean, message: string): Promise<void> {
  for (let k = 0; k < 100 && !condition(); k++) await patienter(50);
  expect(condition(), message).toBe(true);
}
const emplacementsChoisis = (d: HTMLElement): string[] =>
  [...d.querySelectorAll<HTMLElement>('[data-testid="emplacement-serie"]')].map((e) => e.dataset.emplacement ?? '');

describe('T12 : appui long sur une case vide du plan', () => {
  it('C3-P02 en 2026-S42 : le formulaire s’ouvre en création, planche et semaine préremplies', async () => {
    await rendre();
    await appui(EMPLACEMENT.c3p02, xSemaine('2026-01-01', 2026, 42), DELAI_APPUI_LONG_MS + 150);
    await attendre(() => formulaireCreation() !== undefined, 'formulaire « Nouvelle série » ouvert par l’appui long');
    const d = dialogueOuEchec('Nouvelle série');
    await attendre(() => emplacementsChoisis(d).length > 0, 'planche préremplie');
    expect(emplacementsChoisis(d)).toEqual([EMPLACEMENT.c3p02]);
    expect(champ('Semaine', d).value).toBe('2026-W42');
  });

  it('un appui bref n’ouvre rien ; un appui long sur l’étiquette (code de la planche) non plus', async () => {
    await rendre();
    await appui(EMPLACEMENT.c3p02, xSemaine('2026-01-01', 2026, 42), 100);
    await patienter(DELAI_APPUI_LONG_MS + 100);
    expect(formulaireCreation(), 'appui bref : rien').toBeUndefined();
    await appui(EMPLACEMENT.c3p02, 10, DELAI_APPUI_LONG_MS + 150);
    expect(formulaireCreation(), 'étiquette : rien').toBeUndefined();
  });

  it('la batavia de T02 en moins de 8 gestes depuis la vue 2D (2027, T2-P01, S14) ; le plan la montre ; « Annuler » la retire', async () => {
    await rendre();
    await saison2027();
    compteur.gestes = 0;
    const avant = new Set(series(b).map((s) => String(s.id)));

    await appui(EMPLACEMENT.t2p01, xSemaine('2027-01-01', 2027, 14), DELAI_APPUI_LONG_MS + 150);
    await attendre(() => formulaireCreation() !== undefined, 'formulaire ouvert par l’appui long');
    const d = dialogueOuEchec('Nouvelle série');
    await attendre(() => emplacementsChoisis(d).length > 0, 'planche préremplie');
    expect(emplacementsChoisis(d)).toEqual([EMPLACEMENT.t2p01]);
    expect(champ('Semaine', d).value).toBe('2027-W14');

    await remplir(champ('Culture', d), 'bat');
    const choix = () => d.querySelector<HTMLElement>(`[data-testid="choix-culture"][data-espece="${ESPECE.batavia}"][data-variete="${VARIETE.grenobloise}"]`);
    await attendre(() => choix() !== null, 'Batavia Grenobloise proposée');
    const c = choix();
    if (c === null) return;
    await toucher(c);
    await toucher(radio('Récolte à partir de', d));
    await remplir(champ('Semaine', d), '2027-W22');
    const dates = (): Record<string, string> => {
      const r: Record<string, string> = {};
      for (const e of d.querySelectorAll<HTMLElement>('[data-testid="date-serie"]')) r[e.dataset.etape ?? '?'] = e.dataset.date ?? '';
      return r;
    };
    await attendre(() => dates().debutRecolte === ATTENDU.bataviaRecolteS22.debutRecolte, 'dates recalculées');
    expect(dates()).toEqual(ATTENDU.bataviaRecolteS22);
    await toucher(bouton('Planifier la série', d));

    await attendre(() => series(b).some((s) => !avant.has(String(s.id))), 'série écrite');
    expect(compteur.gestes, 'moins de 8 gestes, de l’appui long à l’enregistrement').toBeLessThan(8);
    const nouvelle = series(b).find((s) => !avant.has(String(s.id)));
    const id = String(nouvelle?.id);
    expect(nouvelle).toMatchObject({ ancre_type: 'debut_recolte', ancre_date: '2027-05-31', prevu_mise_en_place: '2027-04-12', prevu_fin_recolte: '2027-06-14' });
    occupationsValides(b, id);
    verifierOrdres(b);

    await attendre(() => dialogue('Nouvelle série') === undefined, 'le formulaire se ferme');
    const occ = occupationsDe(b, id)[0];
    await attendrePlan(
      () => conteneur.querySelector(`[data-testid="barre"][data-occupation="${String(occ?.id)}"]`) !== null,
      'la nouvelle barre est sur le plan (T2-P01)',
    );
    expect(ligne(EMPLACEMENT.t2p01)?.querySelector(`[data-testid="barre"][data-occupation="${String(occ?.id)}"]`)).not.toBeNull();

    const bandeau = conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');
    expect(bandeau, 'bandeau data-testid="saisie-annulable"').not.toBeNull();
    expect(bandeau?.getAttribute('role')).toBe('status');
    expect(texte(bandeau)).toMatch(/Batavia/);
    if (bandeau === null) return;
    b.remiseAZero();
    await toucher(bouton('Annuler', bandeau));
    await attendre(() => serie(b, id)?.supprime_le !== null, 'la série est supprimée doucement');
    expect(b.transactions()).toBe(1);
    expect(occupationsDe(b, id).every((o) => o.supprime_le !== null)).toBe(true);
    await attendrePlan(
      () => conteneur.querySelector(`[data-testid="barre"][data-occupation="${String(occ?.id)}"]`) === null,
      'la barre quitte le plan',
    );
    verifierOrdres(b);
  });
});

describe('T12 : autres entrées du plan de culture', () => {
  it('« Nouvelle série » ouvre le formulaire sans appui long (accessible), sans planche imposée ; « Fermer » le ferme', async () => {
    await rendre();
    await toucher(bouton('Nouvelle série', conteneur));
    await attendre(() => formulaireCreation() !== undefined, 'formulaire ouvert');
    const d = dialogueOuEchec('Nouvelle série');
    expect(emplacementsChoisis(d)).toEqual([]);
    await toucher(bouton('Fermer', d));
    await attendre(() => formulaireCreation() === undefined, 'formulaire fermé');
  });

  it('détail d’une barre de série : « Modifier la série » ; modifier puis « Annuler » restaure l’état initial', async () => {
    await rendre();
    await saison2027();
    const initiale = etat(serie(b, SERIE_LAITUE));
    const occupationsInitiales = occupationsDe(b, SERIE_LAITUE).map(etat);
    const barre = conteneur.querySelector<HTMLElement>(`[data-testid="barre"][data-occupation="${OCCUPATION_LAITUE}"]`);
    if (barre === null) throw new Error('barre de SERIE_LAITUE absente');
    await toucher(barre);
    const detail = dialogueOuEchec('Détail de la série');
    await toucher(bouton('Modifier la série', detail));
    await attendre(() => dialogue('Modifier la série') !== undefined, 'formulaire de modification');
    const f = dialogueOuEchec('Modifier la série');
    await attendre(() => f.querySelector('[data-testid="date-serie"]') !== null, 'formulaire rempli');
    expect(champ('Semaine', f).value).toBe('2027-W14');

    await remplir(champ('Longueur T2-P02', f), '20');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', f));
    await attendre(() => serie(b, SERIE_LAITUE)?.longueur_m === 20, 'modification écrite');
    expect(b.transactions()).toBe(1);
    await attendre(() => conteneur.querySelector('[data-testid="saisie-annulable"]') !== null, 'bandeau « Annuler »');
    const bandeau = conteneur.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');
    if (bandeau === null) return;
    await toucher(bouton('Annuler', bandeau));
    await attendre(() => serie(b, SERIE_LAITUE)?.longueur_m === 30, 'modification défaite');
    expect(etat(serie(b, SERIE_LAITUE))).toEqual(initiale);
    expect(occupationsDe(b, SERIE_LAITUE).map(etat)).toEqual(occupationsInitiales);
    verifierOrdres(b);
  });

  it('plantation pérenne : détail en lecture seule, jamais « Modifier »', async () => {
    await rendre();
    await saison2027();
    const barre = conteneur.querySelector<HTMLElement>(`[data-testid="barre"][data-occupation="${OCCUPATION_FRAISE}"]`);
    if (barre === null) throw new Error('barre des fraises absente');
    await toucher(barre);
    const detail = dialogueOuEchec('Détail de la série');
    expect(aBouton('Modifier la série', detail)).toBe(false);
    expect(boutons(detail).map(nomAccessible)).toEqual(['Fermer']);
  });
});
