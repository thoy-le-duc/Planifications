// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24c — « Annuler » des itinéraires : types d'intervention et course
 * lecture/écriture (docs/backlog/T24c-annuler-types-suites.md).
 *
 * L'annulation n'écrit jamais un itinéraire ou un type que le serveur refuserait
 * (apps/api/src/sync/itineraire.ts) :
 *   - N1 : `verifierTypes` — un itinéraire actif ne cite que des types non supprimés ; la liste
 *     des types est relue en base au moment d'annuler, pas celle connue à l'enregistrement ;
 *   - N2 : un type utilisé ne se renomme pas (ici : le nouveau libellé, devenu utilisé ailleurs,
 *     ne se renomme pas en l'ancien) ; (catégorie, libellé) unique sans tenir compte de la casse ;
 *   - N3 : une synchro reçue entre les lectures de `ramener` et son écriture n'est jamais écrasée.
 * Ligne laissée : message « modifié entre-temps » ; le reste est défait.
 * Les écritures « d'un autre téléphone » arrivent par base.recevoir, comme la synchro.
 */
import { describe, expect, it, vi } from 'vitest';
import { FERME, ITINERAIRE, NOMS_ITINERAIRES, OCCUPATION, SERIE, TYPE } from './test/ferme-itineraires.ts';
import { bandeau, enregistrer, formulaire, harnais, laisserFiler, ouvrirFormulaire, travail, travaux } from './test/harnais.ts';
import {
  attendre,
  bouton,
  champ,
  dialogue,
  dialogueOuEchec,
  etat,
  itineraire,
  occupations,
  occupationsDe,
  ordres,
  parametresDe,
  region,
  remplir,
  serie,
  series,
  texte,
  toucher,
  typeIntervention,
  unTour,
  verifierOrdres,
  type Banc,
  type Ligne,
} from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

const AILLEURS = '2026-09-30T09:30:00.000Z';
const MODIFIER_BATAVIA = `Modifier ${NOMS_ITINERAIRES.bataviaFerme}`;
const NOUVEAU_LIBELLE = 'filet anti-insectes';

/** Texte de tous les messages de l'écran (alertes et statuts). */
const messages = (): string =>
  [...document.querySelectorAll('[role="alert"], [role="status"], [role="alertdialog"]')].map((e) => texte(e)).join(' | ');

/** UPDATE reçu par la synchro (ligne écrite par un autre téléphone). */
function recevoirUpdate(banc: Banc, table: string, id: string, valeurs: Readonly<Record<string, string | number | null>>): void {
  const cles = Object.keys(valeurs);
  banc.base.recevoir(`UPDATE ${table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, [...cles.map((c) => valeurs[c] ?? null), AILLEURS, id]);
}

/** INSERT reçu par la synchro. */
function recevoirInsert(banc: Banc, table: string, ligne: Readonly<Record<string, string | number | null>>): void {
  const cles = Object.keys(ligne);
  banc.base.recevoir(`INSERT INTO ${table} (${cles.join(', ')}) VALUES (${cles.map(() => '?').join(', ')})`, cles.map((c) => ligne[c] ?? null));
}

async function annuler(): Promise<void> {
  const bd = bandeau();
  expect(bd, 'bandeau « Annuler »').not.toBeNull();
  await toucher(bouton('Annuler', bd ?? document));
  await laisserFiler();
}

const brute = (liste: readonly Ligne[], id: string): Ligne | undefined => liste.find((l) => l.id === id);
const typesDesTravaux = (l: Ligne | undefined): string[] =>
  ((parametresDe(l).travauxPrevus ?? []) as { categorie: string; type: string }[]).map((t) => `${t.categorie}/${t.type}`);

interface Avant {
  readonly series: Ligne[];
  readonly occupations: Ligne[];
  readonly itineraire: Record<string, unknown>;
}

/** Batavia de la ferme : retire le travail « binette » (le 2e), appliqué aux deux séries à venir. Rend l'état d'avant. */
async function retirerBinette(): Promise<Avant> {
  await h.ouvrir();
  const avant = { series: series(b()), occupations: occupations(b()), itineraire: etat(itineraire(b(), ITINERAIRE.bataviaFerme)) };
  expect(typesDesTravaux(itineraire(b(), ITINERAIRE.bataviaFerme)), 'Batavia de la ferme cite binette').toContain('entretien/binette');
  await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA);
  expect(travaux()).toHaveLength(2);
  await toucher(bouton('Retirer ce travail', travail(1)));
  await attendre(() => travaux().length === 1, 'binette retirée');
  await enregistrer();
  await attendre(() => dialogue(/^Appliquer aux 2 séries à venir/) !== undefined, 'confirmation pour 2 séries');
  await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
  await attendre(() => bandeau() !== null, 'bandeau « Annuler »');
  expect(typesDesTravaux(itineraire(b(), ITINERAIRE.bataviaFerme)), 'binette retirée de l’itinéraire').not.toContain('entretien/binette');
  return avant;
}

/** Séries et occupations défaites. */
function seriesDefaites(avant: Avant): void {
  expect(etat(serie(b(), SERIE.aVenir1)), 'aVenir1 : défaite').toEqual(etat(brute(avant.series, SERIE.aVenir1)));
  expect(etat(serie(b(), SERIE.aVenir2)), 'aVenir2 : défaite').toEqual(etat(brute(avant.series, SERIE.aVenir2)));
  expect(occupationsDe(b(), SERIE.aVenir1).map(etat), 'occupation d’aVenir1 : défaite').toEqual([etat(brute(avant.occupations, OCCUPATION.aVenir1))]);
  expect(occupationsDe(b(), SERIE.aVenir2).map(etat), 'occupation d’aVenir2 : défaite').toEqual([etat(brute(avant.occupations, OCCUPATION.aVenir2))]);
}

/** Renomme « voile anti-insectes » (type de la ferme, non utilisé) en NOUVEAU_LIBELLE. */
async function renommerVoile(): Promise<void> {
  await h.ouvrir();
  const r = region(/^Types d.intervention$/);
  const el = r.querySelector<HTMLElement>(`[data-testid="type-intervention"][data-type="${TYPE.voile}"]`);
  if (el === null) throw new Error('voile absent');
  await toucher(bouton('Renommer voile anti-insectes', el));
  const d = dialogueOuEchec(/^Renommer/);
  await remplir(champ('Libellé', d), NOUVEAU_LIBELLE);
  await toucher(bouton('Enregistrer', d));
  await attendre(() => typeIntervention(b(), TYPE.voile)?.libelle === NOUVEAU_LIBELLE && bandeau() !== null, 'type renommé, bandeau « Annuler »');
}

/** Aucun ordre de l'annulation n'écrit sur la ligne `id`. */
function rienEcritSur(id: string): void {
  expect(
    ordres(b()).filter((sql) => /^\s*UPDATE\b/i.test(sql) && sql.includes(id)),
    `aucune écriture sur ${id}`,
  ).toEqual([]);
}

describe('T24c, N1 : « Annuler » relit les types d’intervention en base', () => {
  it('binette retirée des travaux, puis supprimée ailleurs : l’itinéraire n’est pas ramené avec binette ; message « modifié entre-temps » ; le reste est défait', async () => {
    const avant = await retirerBinette();
    const ecrit = itineraire(b(), ITINERAIRE.bataviaFerme);

    // L'autre téléphone supprime binette (elle n'est plus utilisée).
    recevoirUpdate(b(), 'type_intervention', TYPE.binette, { supprime_le: AILLEURS });
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    const l = itineraire(b(), ITINERAIRE.bataviaFerme);
    expect(typesDesTravaux(l), 'l’itinéraire ne cite pas un type supprimé').not.toContain('entretien/binette');
    expect(l, 'l’itinéraire reste tel que nous l’avions écrit').toEqual(ecrit);
    expect(typeIntervention(b(), TYPE.binette)?.supprime_le, 'binette reste supprimée').toBe(AILLEURS);
    seriesDefaites(avant);
  });

  it('témoin : rien n’a bougé ailleurs, tout est défait en une transaction, sans message', async () => {
    const avant = await retirerBinette();
    b().remiseAZero();
    await annuler();
    await attendre(() => b().transactions() === 1, 'annulation en une transaction');
    verifierOrdres(b());
    expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme)), 'l’itinéraire : défait (binette revient)').toEqual(avant.itineraire);
    seriesDefaites(avant);
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });
});

describe('T24c, N2 : annuler un renommage de type n’écrit pas ce que le serveur refuserait', () => {
  it('N2a : le nouveau libellé est devenu utilisé ailleurs : le type reste renommé, message « modifié entre-temps »', async () => {
    await renommerVoile();

    // L'autre téléphone ajoute un travail « filet anti-insectes » au chou d'automne.
    const chou = itineraire(b(), ITINERAIRE.chouAutomne);
    const p = parametresDe(chou);
    const parametres = {
      ...p,
      travauxPrevus: [
        { categorie: 'couverture', type: NOUVEAU_LIBELLE, repere: 'mise_en_place', decalageJours: 0, repetition: null, outil: null, produit: null, tempsEstime: null },
      ],
    };
    recevoirUpdate(b(), 'itineraire', ITINERAIRE.chouAutomne, { parametres: JSON.stringify(parametres) });
    const typeRecu = typeIntervention(b(), TYPE.voile);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    expect(typeIntervention(b(), TYPE.voile)?.libelle, 'un type utilisé ne se renomme pas : il reste renommé').toBe(NOUVEAU_LIBELLE);
    expect(typeIntervention(b(), TYPE.voile)).toEqual(typeRecu);
    rienEcritSur(TYPE.voile);
  });

  it('N2b : l’ancien libellé a été recréé ailleurs dans la même catégorie (autre casse) : le type reste renommé, message « modifié entre-temps »', async () => {
    await renommerVoile();

    // L'autre téléphone recrée « Voile Anti-Insectes » en couverture.
    recevoirInsert(b(), 'type_intervention', {
      id: '0192f0c1-2424-7000-8000-0000000000e1',
      ferme_id: FERME,
      categorie: 'couverture',
      libelle: 'Voile Anti-Insectes',
      masque: 0,
      cree_le: AILLEURS,
      modifie_le: AILLEURS,
      supprime_le: null,
    });
    const typeRecu = typeIntervention(b(), TYPE.voile);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    expect(typeIntervention(b(), TYPE.voile)?.libelle, 'pas de doublon (sans casse) : il reste renommé').toBe(NOUVEAU_LIBELLE);
    expect(typeIntervention(b(), TYPE.voile)).toEqual(typeRecu);
    rienEcritSur(TYPE.voile);
  });

  it('témoin : rien n’a bougé ailleurs, le renommage est défait, sans message', async () => {
    await renommerVoile();
    b().remiseAZero();
    await annuler();
    await attendre(() => b().transactions() === 1, 'annulation en une transaction');
    verifierOrdres(b());
    expect(typeIntervention(b(), TYPE.voile)?.libelle).toBe('voile anti-insectes');
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });
});

describe('T24c, N3 : une synchro reçue entre la lecture et l’écriture de « Annuler » n’est jamais écrasée', () => {
  it('itinéraire, série et occupation modifiés ailleurs au moment où l’annulation écrit : leurs valeurs restent', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA);
    await remplir(champ('Avant récolte (jours)', formulaire()), '56');
    await enregistrer();
    await attendre(() => dialogue(/^Appliquer aux 2 séries à venir/) !== undefined, 'confirmation pour 2 séries');
    await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
    await attendre(() => bandeau() !== null, 'bandeau « Annuler »');

    // Ce que l'autre téléphone écrit pendant l'annulation : itinéraire (fenêtre de récolte), aVenir1 recalée et son occupation.
    const ecrit = itineraire(b(), ITINERAIRE.bataviaFerme);
    const parametresAilleurs = JSON.stringify({ ...parametresDe(ecrit), fenetreRecolteJours: 21 });
    const serieAilleurs = {
      ancre_date: '2026-11-16',
      prevu_semis_pepiniere: '2026-10-19',
      prevu_mise_en_place: '2026-11-16',
      prevu_debut_recolte: '2027-01-11',
      prevu_fin_recolte: '2027-01-25',
    };
    let recu = false;
    const banc = b();
    const original = banc.base.writeTransaction.bind(banc.base);
    // Synchro reçue juste avant la transaction d'écriture de l'annulation (après ses lectures).
    vi.spyOn(banc.base, 'writeTransaction').mockImplementation((fn) => {
      if (!recu) {
        recu = true;
        recevoirUpdate(banc, 'itineraire', ITINERAIRE.bataviaFerme, { parametres: parametresAilleurs });
        recevoirUpdate(banc, 'serie', SERIE.aVenir1, serieAilleurs);
        recevoirUpdate(banc, 'occupation', OCCUPATION.aVenir1, { prevu_du: serieAilleurs.prevu_mise_en_place, prevu_au: serieAilleurs.prevu_fin_recolte });
      }
      return original(fn);
    });

    banc.remiseAZero();
    await annuler();
    await attendre(() => recu, 'synchro reçue pendant l’annulation');
    await laisserFiler();
    verifierOrdres(banc);

    const l = itineraire(banc, ITINERAIRE.bataviaFerme);
    expect(l?.parametres, 'les paramètres écrits ailleurs restent').toBe(parametresAilleurs);
    const s = serie(banc, SERIE.aVenir1);
    for (const [c, v] of Object.entries(serieAilleurs)) expect(s?.[c], `aVenir1.${c} écrit ailleurs reste`).toBe(v);
    const o = occupationsDe(banc, SERIE.aVenir1)[0];
    expect(o?.prevu_du, 'occupation d’aVenir1 : prevu_du écrit ailleurs reste').toBe(serieAilleurs.prevu_mise_en_place);
    expect(o?.prevu_au, 'occupation d’aVenir1 : prevu_au écrit ailleurs reste').toBe(serieAilleurs.prevu_fin_recolte);
  });
});
