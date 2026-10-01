// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24b — « Annuler » des itinéraires : série supprimée ailleurs
 * (docs/backlog/T24b-annuler-serie-supprimee.md).
 *
 * Règle générale de l'annulation (T12b, décision 10), appliquée à `ramener` : avant d'écrire,
 * l'état de chaque série APRÈS l'annulation est vérifié comme la fin de lot du serveur
 * (apps/api/src/sync/serie.ts, `verifierFinDeLot`) :
 *   - la série passe `validerSerie`, ses références sont revérifiées si elles changent ou si la
 *     ligne est rétablie ;
 *   - l'emplacement d'une occupation n'est revérifié que s'il change ou si l'occupation redevient
 *     active (le serveur ne revérifie pas un emplacement inchangé) ;
 *   - aucune occupation active sous une série supprimée ;
 *   - toute occupation active passe `validerOccupation` avec la série ramenée.
 * Si une condition échoue, la série et ses occupations restent telles quelles, avec le message
 * « modifié entre-temps » ; le reste est défait.
 *
 * Le cas « planche ajoutée ailleurs, qui ne collerait plus aux dates rétablies » est couvert par
 * ./relecture.test.tsx (T24, décision 9) et n'est pas repris ici.
 * Les écritures « d'un autre téléphone » arrivent par base.recevoir, comme la synchro.
 */
import { describe, expect, it } from 'vitest';
import { EMPLACEMENT, ITINERAIRE, NOMS_ITINERAIRES, OCCUPATION, SERIE } from './test/ferme-itineraires.ts';
import { bandeau, enregistrer, formulaire, harnais, laisserFiler, ouvrirFormulaire } from './test/harnais.ts';
import {
  attendre,
  bouton,
  champ,
  dialogue,
  dialogueOuEchec,
  etat,
  itineraire,
  lire,
  occupations,
  occupationsDe,
  ordres,
  remplir,
  serie,
  series,
  texte,
  toucher,
  unTour,
  verifierOrdres,
  type Banc,
  type Ligne,
} from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

const AILLEURS = '2026-09-30T09:30:00.000Z';
const MODIFIER_BATAVIA = `Modifier ${NOMS_ITINERAIRES.bataviaFerme}`;

/** Texte de tous les messages de l'écran (alertes et statuts). */
const messages = (): string =>
  [...document.querySelectorAll('[role="alert"], [role="status"], [role="alertdialog"]')].map((e) => texte(e)).join(' | ');

/** UPDATE reçu par la synchro (ligne écrite par un autre téléphone). */
function recevoirUpdate(banc: Banc, table: string, id: string, valeurs: Readonly<Record<string, string | number | null>>): void {
  const cles = Object.keys(valeurs);
  banc.base.recevoir(`UPDATE ${table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, [...cles.map((c) => valeurs[c] ?? null), AILLEURS, id]);
}

/** Batavia de la ferme : « Avant récolte » à 56 j, appliqué aux deux séries à venir. Rend l'état d'avant. */
async function appliquerAuxSeriesAVenir(): Promise<{ series: Ligne[]; occupations: Ligne[]; itineraire: Record<string, unknown> }> {
  await h.ouvrir();
  const avant = { series: series(b()), occupations: occupations(b()), itineraire: etat(itineraire(b(), ITINERAIRE.bataviaFerme)) };
  await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA);
  await remplir(champ('Avant récolte (jours)', formulaire()), '56');
  await enregistrer();
  await attendre(() => dialogue(/^Appliquer aux 2 séries à venir/) !== undefined, 'confirmation pour 2 séries');
  await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
  await attendre(() => bandeau() !== null, 'bandeau « Annuler »');
  return avant;
}

async function annuler(): Promise<void> {
  const bd = bandeau();
  expect(bd, 'bandeau « Annuler »').not.toBeNull();
  await toucher(bouton('Annuler', bd ?? document));
  await laisserFiler();
}

const brute = (liste: readonly Ligne[], id: string): Ligne | undefined => liste.find((l) => l.id === id);

/** aVenir2 et l'itinéraire, intacts ailleurs : défaits. */
function resteDefait(avant: { series: Ligne[]; occupations: Ligne[]; itineraire: Record<string, unknown> }): void {
  expect(etat(serie(b(), SERIE.aVenir2)), 'aVenir2, intacte ailleurs : défaite').toEqual(etat(brute(avant.series, SERIE.aVenir2)));
  expect(occupationsDe(b(), SERIE.aVenir2).map(etat), 'occupation d’aVenir2 : défaite').toEqual([etat(brute(avant.occupations, OCCUPATION.aVenir2))]);
  expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme)), 'l’itinéraire, intact ailleurs : défait').toEqual(avant.itineraire);
}

/** Aucun ordre de l'annulation ne vise la série ni ses occupations. */
function rienEcritSur(serieId: string): void {
  const ids = [serieId, ...occupationsDe(b(), serieId).map((o) => String(o.id))];
  const visees = ordres(b()).filter((sql) => ids.some((id) => sql.includes(id)));
  expect(visees, `aucune écriture sur la série ${serieId} ni ses occupations`).toEqual([]);
}

describe('T24b : « Annuler » des itinéraires ne réactive jamais une occupation sous une série supprimée ailleurs', () => {
  it('cas du ticket : aVenir1 supprimée ailleurs (série et occupation) : rien n’est réactivé, message « modifié entre-temps », le reste est défait', async () => {
    const avant = await appliquerAuxSeriesAVenir();

    // L'autre téléphone supprime aVenir1 et son occupation.
    recevoirUpdate(b(), 'serie', SERIE.aVenir1, { supprime_le: AILLEURS });
    recevoirUpdate(b(), 'occupation', OCCUPATION.aVenir1, { supprime_le: AILLEURS });
    const recue = serie(b(), SERIE.aVenir1);
    const occRecues = occupationsDe(b(), SERIE.aVenir1);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    expect(b().transactions(), 'annulation en une transaction').toBe(1);
    expect(
      occupationsDe(b(), SERIE.aVenir1).filter((o) => o.supprime_le === null),
      'aucune occupation de la série supprimée n’est active',
    ).toEqual([]);
    expect(serie(b(), SERIE.aVenir1), 'la série supprimée reste telle quelle').toEqual(recue);
    expect(occupationsDe(b(), SERIE.aVenir1), 'ses occupations restent telles quelles').toEqual(occRecues);
    rienEcritSur(SERIE.aVenir1);
    resteDefait(avant);
  });

  it('série supprimée ailleurs, la suppression de son occupation pas encore reçue : l’occupation n’est pas touchée (jamais active sous une série supprimée après l’annulation), message, le reste est défait', async () => {
    const avant = await appliquerAuxSeriesAVenir();

    recevoirUpdate(b(), 'serie', SERIE.aVenir1, { supprime_le: AILLEURS });
    const recue = serie(b(), SERIE.aVenir1);
    const occRecues = occupationsDe(b(), SERIE.aVenir1);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    expect(serie(b(), SERIE.aVenir1), 'la série supprimée reste telle quelle').toEqual(recue);
    expect(occupationsDe(b(), SERIE.aVenir1), 'son occupation reste telle quelle').toEqual(occRecues);
    rienEcritSur(SERIE.aVenir1);
    resteDefait(avant);
  });

  it('chemin du constat (série absente de l’état ramené) : aVenir1 remise ailleurs à ses valeurs d’avant puis supprimée, son occupation pas encore reçue : l’occupation n’est pas écrite, message, le reste est défait', async () => {
    const avant = await appliquerAuxSeriesAVenir();

    // L'autre téléphone remet aVenir1 telle qu'avant notre écriture, puis la supprime : la ligne
    // série « vaut déjà l'avant » (ignorée par l'annulation), mais elle est supprimée.
    const ancienne = brute(avant.series, SERIE.aVenir1);
    if (ancienne === undefined) throw new Error('aVenir1 absente');
    recevoirUpdate(b(), 'serie', SERIE.aVenir1, {
      parametres: ancienne.parametres ?? null,
      prevu_semis_pepiniere: ancienne.prevu_semis_pepiniere ?? null,
      prevu_mise_en_place: ancienne.prevu_mise_en_place ?? null,
      prevu_debut_recolte: ancienne.prevu_debut_recolte ?? null,
      prevu_fin_recolte: ancienne.prevu_fin_recolte ?? null,
      supprime_le: AILLEURS,
    });
    const recue = serie(b(), SERIE.aVenir1);
    const occRecues = occupationsDe(b(), SERIE.aVenir1);
    expect(occRecues.filter((o) => o.supprime_le === null), 'occupation encore active en local').toHaveLength(1);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    expect(serie(b(), SERIE.aVenir1), 'la série supprimée reste telle quelle').toEqual(recue);
    expect(occupationsDe(b(), SERIE.aVenir1), 'son occupation reste telle quelle').toEqual(occRecues);
    rienEcritSur(SERIE.aVenir1);
    resteDefait(avant);
  });

  it('emplacement de l’occupation d’aVenir1 supprimé ailleurs : l’emplacement ne change pas, le serveur ne le revérifie pas ; tout est défait, sans message', async () => {
    const avant = await appliquerAuxSeriesAVenir();

    recevoirUpdate(b(), 'emplacement', EMPLACEMENT.t1p05, { supprime_le: AILLEURS });
    expect(lire(b(), 'SELECT supprime_le FROM emplacement WHERE id = ?', [EMPLACEMENT.t1p05])[0]?.supprime_le, 'emplacement supprimé ailleurs').toBe(AILLEURS);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => b().transactions() === 1, 'annulation en une transaction');
    verifierOrdres(b());
    expect(series(b()).map(etat), 'toutes les séries défaites').toEqual(avant.series.map(etat));
    expect(occupations(b()).map(etat), 'toutes les occupations défaites (emplacement inchangé)').toEqual(avant.occupations.map(etat));
    expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme))).toEqual(avant.itineraire);
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });

  it('témoin : rien n’a bougé ailleurs, tout est défait en une transaction, sans message', async () => {
    const avant = await appliquerAuxSeriesAVenir();
    b().remiseAZero();
    await annuler();
    await attendre(() => b().transactions() === 1, 'annulation en une transaction');
    verifierOrdres(b());
    expect(series(b()).map(etat)).toEqual(avant.series.map(etat));
    expect(occupations(b()).map(etat)).toEqual(avant.occupations.map(etat));
    expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme))).toEqual(avant.itineraire);
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });
});
