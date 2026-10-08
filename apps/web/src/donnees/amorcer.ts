/**
 * T11 — page `/diagnostic/amorcer.html`, pour les tests de bout en bout (e2e/plan.e2e.ts, contrat
 * en tête) : remplit la base locale PowerSync de l'utilisateur de TEST du jeu de T07 (ferme
 * d'exemple, 400 emplacements), sans serveur.
 *
 * T13 — `?jeu=aujourdhui&date=AAAA-MM-JJ` : la ferme du jour à la place (src/ecrans/aujourdhui/
 * test/ferme-du-jour.ts, datée relativement à `date`), dans la base de SON utilisateur de test ;
 * contrat : src/ecrans/aujourdhui/test/contrat.ts, « Amorçage ». T22 — `?jeu=aujourdhui-travaux` : la
 * même ferme, avec des travaux prévus (fermeDuJour(date, { travaux: true })).
 *
 * T12 — `?jeu=serie` : la ferme du plan (src/ecrans/serie/test/ferme-serie.ts : chapelle C3 de
 * T04, batavia de T02), dans la base de SON utilisateur de test ; contrat :
 * src/ecrans/serie/test/contrat.ts, « Amorçage ». Hors navigation, hors service worker et hors
 * précache, jamais liée depuis l'appli, comme /diagnostic/synchro.html.
 *
 * T13b — `?jeu=aujourdhui-grande-ferme&date=AAAA-MM-JJ` : la grande ferme d'Aujourd'hui
 * (src/ecrans/aujourdhui/test/grande-ferme.ts : 3 000 séries actives, ≈ 51 000 événements, datée
 * relativement à `date`), dans la base de SON utilisateur de test (e2e/aujourdhui-grande-ferme.e2e.ts).
 *
 * T24 — `?jeu=itineraires&date=AAAA-MM-JJ` : la ferme des itinéraires
 * (src/ecrans/itineraires/test/ferme-itineraires.ts, datée relativement à `date`), dans la base
 * de SON utilisateur de test ; contrat : src/ecrans/itineraires/test/contrat.ts, « Amorçage ».
 *
 * T28c — `?jeu=t07-place` : la même ferme, placée (origine du plan, serres, contours, bâtiments, planches ;
 * packages/sync/src/test/placement-t07.ts), pour e2e/vue-3d-jumeau.e2e.ts.
 *
 * T14b — `?jeu=import` : la ferme de l'import (src/ecrans/import/test/ferme-import.ts, dates fixes).
 * T28b — `?jeu=placement` : la ferme du placement (src/ecrans/placement/test/ferme-placement.ts :
 * gérant, sans point de départ, rien de placé), dans la base de SON utilisateur de test
 * (e2e/placement.e2e.ts).
 * T10i — `?jeu=refus&date=AAAA-MM-JJ` : la ferme du jour (comme `?jeu=aujourdhui`) et 101 refus de
 * synchro (src/ecrans/ferme/test/refus.ts : 100 de l'utilisateur de test, datés d'avant l'heure
 * du navigateur, et 1 d'un autre utilisateur), dans la base de SON utilisateur de test
 * (e2e/refus.e2e.ts).
 *
 * Garde-fous : seule la base de l'utilisateur du jeu (identifiant de test, jamais un vrai compte)
 * est ouverte, sans session ; la synchro n'est jamais branchée (aucun appel à connect()), et la
 * file d'envoi est vidée : rien de ce jeu ne partira vers un serveur.
 */
import type { BaseLocale } from '@planif/sync';
import { remplirJeuT07, type JeuT07 } from '../../../../packages/sync/src/test/jeu-t07.ts';
import { placerJeuT07 } from '../../../../packages/sync/src/test/placement-t07.ts';
import { ecrireFermeDuJour, fermeDuJour } from '../ecrans/aujourdhui/test/ferme-du-jour.ts';
import { ecrireGrandeFerme, grandeFerme } from '../ecrans/aujourdhui/test/grande-ferme.ts';
import { ecrireFermeItineraires, fermeItineraires } from '../ecrans/itineraires/test/ferme-itineraires.ts';
import { ecrireRefus, REFUS_DU_JEU_TOTAL, refusDuJeu } from '../ecrans/ferme/test/refus.ts';
import { ecrireFermeSerie, fermeSerie } from '../ecrans/serie/test/ferme-serie.ts';
import { ecrireFermeImport, fermeImport } from '../ecrans/import/test/ferme-import.ts';
import { ecrireFermePlacement, fermePlacement } from '../ecrans/placement/test/ferme-placement.ts';
import { ouvrirBaseLocale } from './ouvrir.ts';

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

function publier(a: Amorcage): void {
  (window as unknown as { __amorcage?: Amorcage }).__amorcage = a;
  const etat = document.getElementById('etat');
  if (etat !== null) etat.textContent = a.erreur === undefined ? `Base remplie : ${String(a.lignes ?? 0)} lignes.` : `Échec : ${a.erreur}`;
}

/** Le jeu calculé sans rien écrire : ses identifiants (graine 7) et le nombre de lignes. */
async function jeuSansEcrire(): Promise<JeuT07> {
  const nulle: Pick<BaseLocale, 'writeTransaction'> = {
    writeTransaction: (fn) => fn({ getAll: () => Promise.resolve([]), execute: () => Promise.resolve(undefined) }),
  };
  return remplirJeuT07(nulle);
}

/**
 * Ouvre la base de `utilisateurId`, la remplit par `remplir` si la ferme n'y est pas déjà, vide la
 * file d'envoi : rien d'un jeu ne doit partir vers un serveur, ni compter comme saisie en attente.
 */
async function remplirBase(utilisateurId: string, fermeId: string, remplir: (base: BaseLocale) => Promise<unknown>): Promise<void> {
  const { base, fermer } = ouvrirBaseLocale(utilisateurId);
  try {
    const deja = await base.getAll<{ id: string }>('SELECT id FROM ferme WHERE id = ?', [fermeId]);
    if (deja.length === 0) await remplir(base);
    await base.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM ps_crud');
    });
  } finally {
    await fermer();
  }
}

async function amorcerT07(): Promise<Amorcage> {
  const jeu = await jeuSansEcrire();
  await remplirBase(jeu.utilisateurId, jeu.principale.fermeId, (base) => remplirJeuT07(base));
  const lignes = Object.values(jeu.lignes).reduce((total, n) => total + n, 0);
  return { utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId, lignes };
}

/** T28c : la grande ferme de T07, placée (packages/sync/src/test/placement-t07.ts). */
async function amorcerT07Place(): Promise<Amorcage> {
  const jeu = await jeuSansEcrire();
  await remplirBase(jeu.utilisateurId, jeu.principale.fermeId, async (base) => {
    await remplirJeuT07(base);
    await placerJeuT07(base, jeu.principale.fermeId);
  });
  const lignes = Object.values(jeu.lignes).reduce((total, n) => total + n, 0);
  return { utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId, lignes };
}

/**
 * T13 : la ferme du jour, datée relativement à `date` ('AAAA-MM-JJ'). T22 : `travaux`, la même
 * ferme avec des travaux prévus dans les itinéraires et les séries (?jeu=aujourdhui-travaux).
 */
async function amorcerAujourdhui(date: string, travaux: boolean): Promise<Amorcage> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date invalide : « ${date} » (AAAA-MM-JJ attendu)`);
  const options = { travaux };
  const ferme = fermeDuJour(date, options);
  await remplirBase(ferme.utilisateurId, ferme.fermeId, (base) => ecrireFermeDuJour(base, date, options));
  return { utilisateurId: ferme.utilisateurId, fermeId: ferme.fermeId, lignes: ferme.total };
}

/** T13b : la grande ferme d'Aujourd'hui, datée relativement à `date` ('AAAA-MM-JJ'). */
async function amorcerGrandeFerme(date: string): Promise<Amorcage> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date invalide : « ${date} » (AAAA-MM-JJ attendu)`);
  const ferme = grandeFerme(date);
  await remplirBase(ferme.utilisateurId, ferme.fermeId, (base) => ecrireGrandeFerme(base, date));
  return { utilisateurId: ferme.utilisateurId, fermeId: ferme.fermeId, lignes: ferme.total };
}

/** T12 : la ferme du plan (dates fixes). */
async function amorcerSerie(): Promise<Amorcage> {
  const ferme = fermeSerie();
  await remplirBase(ferme.utilisateurId, ferme.fermeId, (base) => ecrireFermeSerie(base));
  return { utilisateurId: ferme.utilisateurId, fermeId: ferme.fermeId, lignes: ferme.total };
}

/** T24 : la ferme des itinéraires, datée relativement à `date` ('AAAA-MM-JJ'). */
async function amorcerItineraires(date: string): Promise<Amorcage> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date invalide : « ${date} » (AAAA-MM-JJ attendu)`);
  const ferme = fermeItineraires(date);
  await remplirBase(ferme.utilisateurId, ferme.fermeId, (base) => ecrireFermeItineraires(base, date));
  return { utilisateurId: ferme.utilisateurId, fermeId: ferme.fermeId, lignes: ferme.total };
}

/** T10i : la ferme du jour et les refus du jeu, datés d'avant l'heure du navigateur. */
async function amorcerRefus(date: string): Promise<Amorcage> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date invalide : « ${date} » (AAAA-MM-JJ attendu)`);
  const ferme = fermeDuJour(date);
  const maintenant = new Date();
  await remplirBase(ferme.utilisateurId, ferme.fermeId, async (base) => {
    await ecrireFermeDuJour(base, date);
    await ecrireRefus(base, refusDuJeu(maintenant));
  });
  return { utilisateurId: ferme.utilisateurId, fermeId: ferme.fermeId, lignes: ferme.total + REFUS_DU_JEU_TOTAL };
}

/** T14b : la ferme de l'import (dates fixes). */
async function amorcerImport(): Promise<Amorcage> {
  const ferme = fermeImport();
  await remplirBase(ferme.utilisateurId, ferme.fermeId, (base) => ecrireFermeImport(base));
  return { utilisateurId: ferme.utilisateurId, fermeId: ferme.fermeId, lignes: ferme.total };
}

/** T28b : la ferme du placement (sans point de départ, gérant) ; T28f : options par l'adresse. */
async function amorcerPlacement(parametres: URLSearchParams): Promise<Amorcage> {
  // T28f : `saison=1` (une saison, donc un plan et « Voir en 3D »), `origine=1` (ferme placée), `role=equipier`.
  const options = {
    ...(parametres.get('saison') === '1' ? { saison: true } : {}),
    ...(parametres.get('origine') === '1' ? { origine: true } : {}),
    ...(parametres.get('role') === 'equipier' ? { role: 'equipier' as const } : {}),
  };
  const ferme = fermePlacement(options);
  await remplirBase(ferme.utilisateurId, ferme.fermeId, (base) => ecrireFermePlacement(base, options));
  return { utilisateurId: ferme.utilisateurId, fermeId: ferme.fermeId, lignes: ferme.total };
}

function amorcer(): Promise<Amorcage> {
  const parametres = new URLSearchParams(location.search);
  const jeu = parametres.get('jeu');
  if (jeu === null) return amorcerT07();
  if (jeu === 't07-place') return amorcerT07Place();
  if (jeu === 'aujourdhui') return amorcerAujourdhui(parametres.get('date') ?? '', false);
  if (jeu === 'aujourdhui-travaux') return amorcerAujourdhui(parametres.get('date') ?? '', true);
  if (jeu === 'aujourdhui-grande-ferme') return amorcerGrandeFerme(parametres.get('date') ?? '');
  if (jeu === 'serie') return amorcerSerie();
  if (jeu === 'itineraires') return amorcerItineraires(parametres.get('date') ?? '');
  if (jeu === 'refus') return amorcerRefus(parametres.get('date') ?? '');
  if (jeu === 'import') return amorcerImport();
  if (jeu === 'placement') return amorcerPlacement(parametres);
  return Promise.reject(new Error(`jeu inconnu : « ${jeu} »`));
}

amorcer().then(publier, (erreur: unknown) => {
  console.error('Amorçage impossible', erreur);
  publier({ erreur: erreur instanceof Error ? erreur.message : String(erreur) });
});
