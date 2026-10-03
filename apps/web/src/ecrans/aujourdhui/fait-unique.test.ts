/**
 * Tests d'acceptation T13h — « Fait » unique, vérifié au moment d'écrire, dans la transaction.
 *
 * Banc : la ferme du jour (./test/ferme-du-jour.ts) dans la base mémoire de @planif/sync, lue et
 * écrite par la vraie porte, aujourd'hui = 2026-09-30. Les cultures et les travaux viennent de la
 * journée calculée (`lireJournee` + `calculerJournee`), comme à l'écran.
 *
 * Contrat choisi (le plus simple pour les appelants actuels : la signature ne change pas) :
 *   - `marquerFait` et `marquerTravailFait` rendent toujours l'id de l'événement écrit ;
 *   - si un « Fait » en vigueur (non annulé) existe déjà pour cette culture et cette étape (ou ce
 *     travail prévu et cette occurrence visée), RIEN n'est écrit et la promesse est rejetée avec
 *     `DejaFait`, classe d'erreur exportée par ./ecritures.ts (`class DejaFait extends Error`) ;
 *   - la vérification et l'écriture se font dans la MÊME transaction locale : deux appels lancés
 *     sans attendre (même porte, ou deux portes sur la même base, comme deux onglets) n'écrivent
 *     qu'un seul événement ; l'autre est rejeté avec `DejaFait`.
 *
 * Règles :
 *   U1  deux « Fait » successifs sur la même étape → un réalisé, le second rejeté (DejaFait) ;
 *   U2  deux « Fait » concurrents (même porte, puis deux portes) → un réalisé, un rejet DejaFait ;
 *   U3  réalisé arrivé d'ailleurs (journal de la ferme, autre date) → DejaFait, rien d'écrit ;
 *   U4  réalisé corrigé (changement de date) : toujours en vigueur → DejaFait ;
 *   U5  après annulation du réalisé, un nouveau « Fait » s'écrit ;
 *   U6  un réalisé d'une AUTRE étape ou d'une AUTRE culture n'empêche rien ;
 *   U7–U10  mêmes règles pour `marquerTravailFait` (même travail, même occurrence visée) ;
 *          un autre travail ou une autre occurrence n'empêche rien.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { DateCalendaire, EtapeRealisee, Id, TravailPrevu } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerJournee, lireJournee, type Culture, type EvenementLu, type Journee, type TacheJour } from './calculs.ts';
import type { ContexteEcriture } from './ecritures.ts';
import { cleTache, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';

// ── Contrat attendu de ./ecritures.ts (chargé par un chemin en variable : le typage reste vert tant
//    que `DejaFait` n'existe pas, et le test dit clairement ce qui manque) ──────────────────────

interface ModuleEcritures {
  readonly DejaFait?: new (message?: string) => Error;
  marquerFait(ctx: ContexteEcriture, culture: Culture, etape: EtapeRealisee): Promise<Id<'Evenement'>>;
  marquerTravailFait(ctx: ContexteEcriture, culture: Culture, travail: TravailPrevu, datePrevue: DateCalendaire): Promise<Id<'Evenement'>>;
  annulerSaisie(ctx: ContexteEcriture, ev: EvenementLu): Promise<Id<'Evenement'>>;
  changerDate(ctx: ContexteEcriture, ev: EvenementLu, date: string): Promise<Id<'Evenement'>>;
}

const CHEMIN_ECRITURES = './ecritures.ts';
let ecritures: ModuleEcritures;

beforeAll(async () => {
  ecritures = (await import(/* @vite-ignore */ CHEMIN_ECRITURES)) as ModuleEcritures;
});

/** La classe `DejaFait` exportée par ./ecritures.ts ; échec explicite si elle manque. */
function classeDejaFait(): new (message?: string) => Error {
  const c = ecritures.DejaFait;
  expect(c, './ecritures.ts exporte la classe d’erreur DejaFait (« déjà fait »)').toBeTypeOf('function');
  if (c === undefined) throw new Error('DejaFait absent');
  return c;
}

/** Attend que `p` soit rejetée avec DejaFait. */
async function attendreDejaFait(p: Promise<unknown>, message: string): Promise<void> {
  let resultat: unknown;
  try {
    resultat = await p;
  } catch (e) {
    const DejaFait = classeDejaFait();
    expect(e, `${message} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(DejaFait);
    return;
  }
  expect.fail(`${message} : rejet DejaFait attendu, la promesse a rendu ${String(resultat)} (un événement a été écrit)`);
}

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly remplace_sorte: string | null;
  readonly remplace_evenement_id: string | null;
  readonly detail: string | null;
}

let base: BaseMemoire;
let porte: PorteDonnees;
let ctx: ContexteEcriture;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  // Travaux prévus (T22) et désherbage de la batavia en deux occurrences, J−13 et J+1 (T22b).
  await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true, faitEnRetard: true });
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  ctx = { porte, fermeId: FERME, aujourdhui: AUJOURDHUI };
});

/** Une seconde porte sur la même base (second onglet du même téléphone). */
const secondOnglet = (): ContexteEcriture => ({
  porte: creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> }),
  fermeId: FERME,
  aujourdhui: AUJOURDHUI,
});

const journee = async (): Promise<Journee> => calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, new Date()), AUJOURDHUI);

const lignes = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const detailDe = (l: LigneEvenement): Record<string, unknown> => JSON.parse(l.detail ?? '{}') as Record<string, unknown>;

/** Réalisés originaux (ni correction ni annulation) de `cibleId` pour `etape`. */
const realises = (cibleId: string, etape: EtapeRealisee): LigneEvenement[] =>
  lignes().filter((l) => l.type === 'realise' && l.remplace_sorte === null && (l.serie_id === cibleId || l.campagne_id === cibleId) && detailDe(l).etape === etape);

/** Interventions originales de `cibleId` du type `libelle`, pour l'occurrence visée `occurrence`. */
const interventions = (cibleId: string, libelle: string, occurrence: string): LigneEvenement[] =>
  lignes().filter(
    (l) =>
      l.type === 'intervention' &&
      l.remplace_sorte === null &&
      (l.serie_id === cibleId || l.campagne_id === cibleId) &&
      detailDe(l).type === libelle &&
      detailDe(l).occurrenceVisee === occurrence,
  );

function tacheEtape(j: Journee, cle: string): TacheJour & { readonly tache: { readonly etape: EtapeRealisee } } {
  const t = j.taches.find((x) => x.cle === cle);
  if (t === undefined || t.tache.etape === 'travail' || t.tache.etape === 'debut_recolte') {
    throw new Error(`tâche d'étape ${cle} absente (tâches : ${j.taches.map((x) => x.cle).join(', ')})`);
  }
  return t as TacheJour & { readonly tache: { readonly etape: EtapeRealisee } };
}

type TacheTravail = TacheJour & { readonly tache: { readonly etape: 'travail'; readonly travail: TravailPrevu; readonly datePrevue: DateCalendaire } };

function premierTravail(j: Journee): TacheTravail {
  const t = j.taches.find((x) => x.tache.etape === 'travail');
  if (t === undefined) throw new Error('aucune tâche de travail prévu sur la ferme du jour');
  return t as TacheTravail;
}

/** L'événement en vigueur `id`, tel que la journée le lit (pour l'annuler ou le corriger). */
async function evenementLu(id: string): Promise<EvenementLu> {
  const e = (await journee()).historique.find((h) => h.evenement.id === id)?.evenement;
  if (e === undefined) throw new Error(`événement ${id} absent de l'historique`);
  return e;
}

const CHOU = cleTache(SERIE.chou, 'plantation');

// ── Étapes : marquerFait ─────────────────────────────────────────────────────────────────────

describe('T13h, « Fait » d’une étape : un seul réalisé en vigueur par culture et par étape', () => {
  it('U1 : deux « Fait » successifs sur la même étape → un seul réalisé, le second rejeté avec DejaFait', async () => {
    const t = tacheEtape(await journee(), CHOU);
    const id = await ecritures.marquerFait(ctx, t.culture, 'plantation');
    expect(realises(SERIE.chou, 'plantation').map((l) => l.id)).toEqual([id]);

    await attendreDejaFait(ecritures.marquerFait(ctx, t.culture, 'plantation'), 'second « Fait »');
    expect(realises(SERIE.chou, 'plantation'), 'un seul réalisé').toHaveLength(1);
  });

  it('U2a : deux « Fait » lancés sans attendre (même porte) → un seul réalisé, un rejet DejaFait', async () => {
    const t = tacheEtape(await journee(), CHOU);
    const avant = lignes().length;
    const r = await Promise.allSettled([ecritures.marquerFait(ctx, t.culture, 'plantation'), ecritures.marquerFait(ctx, t.culture, 'plantation')]);
    expect(realises(SERIE.chou, 'plantation'), 'un seul réalisé en base').toHaveLength(1);
    expect(lignes().length - avant, 'une seule ligne écrite').toBe(1);
    expect(r.filter((x) => x.status === 'fulfilled'), 'un seul appel réussit').toHaveLength(1);
    const rejet = r.find((x) => x.status === 'rejected');
    expect(rejet?.status === 'rejected' ? rejet.reason : undefined, 'l’autre est rejeté avec DejaFait').toBeInstanceOf(classeDejaFait());
  });

  it('U2b : deux onglets (deux portes, même base), « Fait » lancés sans attendre → un seul réalisé', async () => {
    const t = tacheEtape(await journee(), CHOU);
    const r = await Promise.allSettled([ecritures.marquerFait(ctx, t.culture, 'plantation'), ecritures.marquerFait(secondOnglet(), t.culture, 'plantation')]);
    expect(realises(SERIE.chou, 'plantation'), 'un seul réalisé en base').toHaveLength(1);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejet = r.find((x) => x.status === 'rejected');
    expect(rejet?.status === 'rejected' ? rejet.reason : undefined).toBeInstanceOf(classeDejaFait());
  });

  it('U3 : réalisé déjà au journal (arrivé d’ailleurs, autre date) → DejaFait, rien n’est écrit', async () => {
    // La ferme du jour porte la plantation de la tomate, réalisée il y a 90 jours.
    const j = await journee();
    const tomate = j.cultures.get(SERIE.tomate);
    if (tomate === undefined) throw new Error('culture tomate absente de la journée');
    expect(realises(SERIE.tomate, 'plantation'), 'banc : plantation de la tomate au journal').toHaveLength(1);
    const avant = lignes().length;
    await attendreDejaFait(ecritures.marquerFait(ctx, tomate, 'plantation'), '« Fait » sur une plantation déjà au journal');
    expect(lignes().length, 'rien n’est écrit').toBe(avant);
  });

  it('U4 : réalisé corrigé (changement de date) : toujours en vigueur → DejaFait', async () => {
    const t = tacheEtape(await journee(), CHOU);
    const id = await ecritures.marquerFait(ctx, t.culture, 'plantation');
    await ecritures.changerDate(ctx, await evenementLu(id), '2026-09-29');
    const avant = lignes().length;
    await attendreDejaFait(ecritures.marquerFait(ctx, t.culture, 'plantation'), '« Fait » après correction de date');
    expect(lignes().length, 'rien n’est écrit').toBe(avant);
  });

  it('U5 : après annulation du réalisé, un nouveau « Fait » s’écrit', async () => {
    const t = tacheEtape(await journee(), CHOU);
    const id = await ecritures.marquerFait(ctx, t.culture, 'plantation');
    await ecritures.annulerSaisie(ctx, await evenementLu(id));
    const second = await ecritures.marquerFait(ctx, t.culture, 'plantation');
    expect(second).not.toBe(id);
    expect(realises(SERIE.chou, 'plantation').map((l) => l.id), 'deux réalisés : l’annulé et le nouveau').toEqual([id, second]);
    // Et le nouveau compte à son tour.
    await attendreDejaFait(ecritures.marquerFait(ctx, t.culture, 'plantation'), 'troisième « Fait »');
    expect(realises(SERIE.chou, 'plantation')).toHaveLength(2);
  });

  it('U6 : un réalisé d’une autre étape ou d’une autre culture n’empêche rien', async () => {
    const j = await journee();
    const chou = tacheEtape(j, CHOU);
    await ecritures.marquerFait(ctx, chou.culture, 'plantation');

    // Même culture, autre étape.
    await expect(ecritures.marquerFait(ctx, chou.culture, 'arrachage'), 'autre étape, même culture').resolves.toBeTypeOf('string');
    expect(realises(SERIE.chou, 'arrachage')).toHaveLength(1);

    // Même étape, autre culture.
    const autre = j.taches.find((x) => x.cle !== CHOU && x.tache.etape === 'plantation' && x.culture.cibleId !== SERIE.chou);
    const cible = autre?.culture ?? j.cultures.get(SERIE.poireau);
    if (cible === undefined) throw new Error('aucune autre culture à planter');
    const deja = realises(cible.cibleId, 'plantation').length;
    expect(deja, 'banc : l’autre culture n’est pas encore plantée').toBe(0);
    await expect(ecritures.marquerFait(ctx, cible, 'plantation'), 'même étape, autre culture').resolves.toBeTypeOf('string');
    expect(realises(cible.cibleId, 'plantation')).toHaveLength(1);
  });
});

// ── Travaux prévus : marquerTravailFait ─────────────────────────────────────────────────────

describe('T13h, « Fait » d’un travail prévu : une seule intervention en vigueur par travail et par occurrence', () => {
  it('U7 : deux « Fait » successifs sur le même travail et la même occurrence → une intervention, le second rejeté avec DejaFait', async () => {
    const t = premierTravail(await journee());
    const { travail, datePrevue } = t.tache;
    const id = await ecritures.marquerTravailFait(ctx, t.culture, travail, datePrevue);
    expect(interventions(t.culture.cibleId, travail.type, datePrevue).map((l) => l.id)).toEqual([id]);

    await attendreDejaFait(ecritures.marquerTravailFait(ctx, t.culture, travail, datePrevue), 'second « Fait » du travail');
    expect(interventions(t.culture.cibleId, travail.type, datePrevue), 'une seule intervention').toHaveLength(1);
  });

  it('U8 : deux « Fait » du même travail lancés sans attendre → une seule intervention, un rejet DejaFait', async () => {
    const t = premierTravail(await journee());
    const { travail, datePrevue } = t.tache;
    const r = await Promise.allSettled([
      ecritures.marquerTravailFait(ctx, t.culture, travail, datePrevue),
      ecritures.marquerTravailFait(secondOnglet(), t.culture, travail, datePrevue),
    ]);
    expect(interventions(t.culture.cibleId, travail.type, datePrevue), 'une seule intervention en base').toHaveLength(1);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejet = r.find((x) => x.status === 'rejected');
    expect(rejet?.status === 'rejected' ? rejet.reason : undefined).toBeInstanceOf(classeDejaFait());
  });

  it('U9 : après annulation de l’intervention, un nouveau « Fait » du travail s’écrit', async () => {
    const t = premierTravail(await journee());
    const { travail, datePrevue } = t.tache;
    const id = await ecritures.marquerTravailFait(ctx, t.culture, travail, datePrevue);
    await ecritures.annulerSaisie(ctx, await evenementLu(id));
    const second = await ecritures.marquerTravailFait(ctx, t.culture, travail, datePrevue);
    expect(interventions(t.culture.cibleId, travail.type, datePrevue).map((l) => l.id)).toEqual([id, second]);
  });

  it('U10 : une occurrence suivante du même travail, ou un autre travail, n’est pas empêchée', async () => {
    const j = await journee();
    // Le désherbage de la batavia, en deux occurrences (J−13 en retard, J+1) : « Fait » sur la
    // première n'empêche pas la suivante.
    const desherbages = j.taches
      .filter((x): x is TacheTravail => x.tache.etape === 'travail' && x.culture.cibleId === SERIE.batavia && x.tache.travail.type === 'désherbage')
      .sort((x, y) => x.tache.datePrevue.localeCompare(y.tache.datePrevue));
    const [premiere, suivante] = desherbages;
    if (premiere === undefined || suivante === undefined) throw new Error(`banc : deux occurrences du désherbage de la batavia (${String(desherbages.length)})`);
    expect(premiere.tache.datePrevue < suivante.tache.datePrevue).toBe(true);
    await ecritures.marquerTravailFait(ctx, premiere.culture, premiere.tache.travail, premiere.tache.datePrevue);
    await expect(
      ecritures.marquerTravailFait(ctx, suivante.culture, suivante.tache.travail, suivante.tache.datePrevue),
      'occurrence suivante du même travail',
    ).resolves.toBeTypeOf('string');
    expect(interventions(SERIE.batavia, 'désherbage', suivante.tache.datePrevue)).toHaveLength(1);

    // Un autre travail (autre type), sur une autre culture ou la même.
    const autre = j.taches.find((x): x is TacheTravail => x.tache.etape === 'travail' && x.tache.travail.type !== 'désherbage');
    if (autre === undefined) throw new Error('banc : un travail prévu d’un autre type');
    await expect(
      ecritures.marquerTravailFait(ctx, autre.culture, autre.tache.travail, autre.tache.datePrevue),
      'autre travail',
    ).resolves.toBeTypeOf('string');
  });

  it('U11 : un « Fait » d’étape n’empêche pas le « Fait » d’un travail de la même culture (et inversement)', async () => {
    const j = await journee();
    const t = premierTravail(j);
    const etape = j.taches.find((x) => x.culture.cibleId === t.culture.cibleId && x.tache.etape !== 'travail' && x.tache.etape !== 'debut_recolte');
    await ecritures.marquerTravailFait(ctx, t.culture, t.tache.travail, t.tache.datePrevue);
    if (etape !== undefined && etape.tache.etape !== 'travail' && etape.tache.etape !== 'debut_recolte') {
      await expect(ecritures.marquerFait(ctx, etape.culture, etape.tache.etape)).resolves.toBeTypeOf('string');
    } else {
      // Pas d'étape à faire sur cette culture : une étape non encore réalisée (arrachage).
      expect(realises(t.culture.cibleId, 'arrachage')).toHaveLength(0);
      await expect(ecritures.marquerFait(ctx, t.culture, 'arrachage')).resolves.toBeTypeOf('string');
    }
  });
});
