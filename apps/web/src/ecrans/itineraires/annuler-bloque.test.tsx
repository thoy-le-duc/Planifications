// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24d — « Annuler » bloqué en silence : prévenir le maraîcher
 * (docs/backlog/T24d-annuler-bloque-message.md).
 *
 * T24c protège chaque UPDATE de « Annuler » par une garde dans son WHERE : une synchro reçue
 * entre les lectures de `ramener` et son écriture n'est jamais écrasée. Mais si la garde bloque
 * une ligne, rien ne le dit : l'écran doit alors afficher le même message que lorsque
 * l'annulation est refusée à la lecture (`messageModifieAilleurs`, « modifié entre-temps »),
 * sans écraser la synchro ni empêcher de défaire les lignes restées intactes.
 *
 * Harnais : celui des tests N3 et N3 bis de T24c (annuler-types-suites.test.tsx) — la synchro est
 * injectée juste avant la transaction d'écriture de l'annulation (après ses lectures).
 */
import { describe, expect, it, vi } from 'vitest';
import { ITINERAIRE, NOMS_ITINERAIRES, OCCUPATION, SERIE } from './test/ferme-itineraires.ts';
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
  occupationsValides,
  parametresDe,
  remplir,
  serie,
  series,
  texte,
  toucher,
  verifierOrdres,
  type Banc,
  type Ligne,
} from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

const AILLEURS = '2026-09-30T09:30:00.000Z';
const MODIFIER_BATAVIA = `Modifier ${NOMS_ITINERAIRES.bataviaFerme}`;

/** Même texte que `messageModifieAilleurs` (ecritures.ts) pour `n` lignes laissées. */
const messageAttendu = (n: number): string =>
  `ce qui a été modifié entre-temps sur un autre téléphone est gardé tel quel (${String(n)} ${n > 1 ? 'lignes' : 'ligne'})`;

/** Texte de tous les messages de l'écran (alertes et statuts). */
const messages = (): string =>
  [...document.querySelectorAll('[role="alert"], [role="status"], [role="alertdialog"]')].map((e) => texte(e)).join(' | ');

/** UPDATE reçu par la synchro (ligne écrite par un autre téléphone). */
function recevoirUpdate(banc: Banc, table: string, id: string, valeurs: Readonly<Record<string, string | number | null>>): void {
  const cles = Object.keys(valeurs);
  banc.base.recevoir(`UPDATE ${table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, [...cles.map((c) => valeurs[c] ?? null), AILLEURS, id]);
}

/** Attend le message « modifié entre-temps » avec le compte exact de lignes laissées. */
async function attendreMessage(n: number): Promise<void> {
  await attendre(() => messages().includes(messageAttendu(n)), `message « ${messageAttendu(n)} » (vus : ${messages()})`);
}

async function annuler(): Promise<void> {
  const bd = bandeau();
  expect(bd, 'bandeau « Annuler »').not.toBeNull();
  await toucher(bouton('Annuler', bd ?? document));
  await laisserFiler();
}

const brute = (liste: readonly Ligne[], id: string): Ligne | undefined => liste.find((l) => l.id === id);

interface Avant {
  readonly itineraireBrut: Ligne | undefined;
  readonly itineraire: Record<string, unknown>;
  readonly series: Ligne[];
  readonly occupations: Ligne[];
}

/** Batavia de la ferme : « Avant récolte » passe à 56 jours, appliqué aux deux séries à venir. Rend l'état d'avant. */
async function modifierBatavia(): Promise<Avant> {
  await h.ouvrir();
  const avant = { itineraireBrut: itineraire(b(), ITINERAIRE.bataviaFerme), itineraire: etat(itineraire(b(), ITINERAIRE.bataviaFerme)), series: series(b()), occupations: occupations(b()) };
  await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA);
  await remplir(champ('Avant récolte (jours)', formulaire()), '56');
  await enregistrer();
  await attendre(() => dialogue(/^Appliquer aux 2 séries à venir/) !== undefined, 'confirmation pour 2 séries');
  await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
  await attendre(() => bandeau() !== null, 'bandeau « Annuler »');
  expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme)), 'l’itinéraire a bien changé').not.toEqual(avant.itineraire);
  expect(etat(serie(b(), SERIE.aVenir2)), 'aVenir2 a bien changé').not.toEqual(etat(brute(avant.series, SERIE.aVenir2)));
  return avant;
}

/** La série `id` et ses occupations sont revenues à l'état d'avant. */
function serieDefaite(avant: Avant, id: string, occupationId: string): void {
  expect(etat(serie(b(), id)), `${id} : défaite`).toEqual(etat(brute(avant.series, id)));
  expect(occupationsDe(b(), id).map(etat), `occupation de ${id} : défaite`).toEqual([etat(brute(avant.occupations, occupationId))]);
}

/**
 * Cas N3 : l'autre téléphone change l'itinéraire (fenêtre de récolte), recale aVenir1 et son
 * occupation, juste avant la transaction d'écriture. aVenir2 n'est pas touchée ailleurs.
 */
async function annulerAvecSynchroN3(): Promise<{ parametresAilleurs: string; serieAilleurs: Record<string, string> }> {
  const banc = b();
  const ecrit = itineraire(banc, ITINERAIRE.bataviaFerme);
  const parametresAilleurs = JSON.stringify({ ...parametresDe(ecrit), fenetreRecolteJours: 21 });
  const serieAilleurs = {
    ancre_date: '2026-11-16',
    prevu_semis_pepiniere: '2026-10-19',
    prevu_mise_en_place: '2026-11-16',
    prevu_debut_recolte: '2027-01-11',
    prevu_fin_recolte: '2027-01-25',
  };
  let recu = false;
  const original = banc.base.writeTransaction.bind(banc.base);
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
  return { parametresAilleurs, serieAilleurs };
}

describe('T24d : « Annuler » bloqué par la garde du WHERE affiche « modifié entre-temps »', () => {
  it('cas N3 : synchro entre la lecture et l’écriture → message « modifié entre-temps », les valeurs reçues restent', async () => {
    await modifierBatavia();
    const { parametresAilleurs, serieAilleurs } = await annulerAvecSynchroN3();

    const banc = b();
    expect(itineraire(banc, ITINERAIRE.bataviaFerme)?.parametres, 'les paramètres écrits ailleurs restent').toBe(parametresAilleurs);
    const s = serie(banc, SERIE.aVenir1);
    for (const [c, v] of Object.entries(serieAilleurs)) expect(s?.[c], `aVenir1.${c} écrit ailleurs reste`).toBe(v);
    const o = occupationsDe(banc, SERIE.aVenir1)[0];
    expect(o?.prevu_du, 'occupation d’aVenir1 : prevu_du écrit ailleurs reste').toBe(serieAilleurs.prevu_mise_en_place);
    expect(o?.prevu_au, 'occupation d’aVenir1 : prevu_au écrit ailleurs reste').toBe(serieAilleurs.prevu_fin_recolte);

    // Bloquées : l'itinéraire, aVenir1 et son occupation (changés ailleurs). aVenir2 et son occupation sont défaites.
    await attendreMessage(3);
  });

  it('cas N3, une partie seulement bloquée : aVenir2 (intacte ailleurs) est bien défaite ET le message s’affiche', async () => {
    const avant = await modifierBatavia();
    await annulerAvecSynchroN3();

    serieDefaite(avant, SERIE.aVenir2, OCCUPATION.aVenir2);
    occupationsValides(b(), SERIE.aVenir2);
    // Bloquées : l'itinéraire, aVenir1 et son occupation ; aVenir2 et la sienne ne comptent pas.
    await attendreMessage(3);
  });

  it('cas N3 bis : occupation passée dans une autre série pendant l’annulation → message « modifié entre-temps », l’occupation reçue reste', async () => {
    const avant = await modifierBatavia();

    const banc = b();
    const s1 = serie(banc, SERIE.aVenir1);
    if (s1 === undefined) throw new Error('aVenir1 absente');
    const datesS1 = {
      ancre_type: s1.ancre_type ?? null,
      ancre_date: s1.ancre_date ?? null,
      prevu_semis_pepiniere: s1.prevu_semis_pepiniere ?? null,
      prevu_mise_en_place: s1.prevu_mise_en_place ?? null,
      prevu_debut_recolte: s1.prevu_debut_recolte ?? null,
      prevu_fin_recolte: s1.prevu_fin_recolte ?? null,
    };
    let recue: Ligne | undefined;
    const original = banc.base.writeTransaction.bind(banc.base);
    vi.spyOn(banc.base, 'writeTransaction').mockImplementation((fn) => {
      if (recue === undefined) {
        recevoirUpdate(banc, 'serie', SERIE.aVenir2, datesS1);
        recevoirUpdate(banc, 'occupation', OCCUPATION.aVenir2, { prevu_du: datesS1.prevu_mise_en_place, prevu_au: datesS1.prevu_fin_recolte });
        recevoirUpdate(banc, 'occupation', OCCUPATION.aVenir1, { serie_id: SERIE.aVenir2 });
        recue = lire(banc, 'SELECT * FROM occupation WHERE id = ?', [OCCUPATION.aVenir1])[0];
      }
      return original(fn);
    });

    banc.remiseAZero();
    await annuler();
    await attendre(() => recue !== undefined, 'synchro reçue pendant l’annulation');
    await laisserFiler();
    verifierOrdres(banc);

    const o = lire(banc, 'SELECT * FROM occupation WHERE id = ?', [OCCUPATION.aVenir1])[0];
    expect(o, 'O n’est pas réécrite : elle reste telle que reçue').toEqual(recue);
    occupationsValides(banc, SERIE.aVenir2);
    // L'itinéraire, intact ailleurs, est bien défait (pas de tout ou rien).
    expect(etat(itineraire(banc, ITINERAIRE.bataviaFerme)), 'l’itinéraire : défait').toEqual(avant.itineraire);

    // aVenir1 (intacte ailleurs, sans occupation depuis le départ de O) est défaite elle aussi.
    expect(etat(serie(banc, SERIE.aVenir1)), 'aVenir1 : défaite').toEqual(etat(brute(avant.series, SERIE.aVenir1)));
    // Bloquées : O, aVenir2 et son occupation (changées ailleurs). L'itinéraire et aVenir1 sont défaits.
    await attendreMessage(3);
  });

  it('témoin : rien n’a bougé ailleurs, tout est défait en une transaction, sans message « modifié entre-temps »', async () => {
    const avant = await modifierBatavia();
    b().remiseAZero();
    await annuler();
    await attendre(() => b().transactions() === 1, 'annulation en une transaction');
    await laisserFiler();
    verifierOrdres(b());
    expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme)), 'l’itinéraire : défait').toEqual(avant.itineraire);
    serieDefaite(avant, SERIE.aVenir1, OCCUPATION.aVenir1);
    serieDefaite(avant, SERIE.aVenir2, OCCUPATION.aVenir2);
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });
});

describe('T24d : la synchro a remis ailleurs les valeurs d’avant — rien n’est perdu, pas de message pour cette ligne', () => {
  /** Colonnes de l'itinéraire que la modification a changées, remises par l'autre téléphone à leur valeur d'avant. */
  function valeursDAvant(avant: Avant): Record<string, string | number | null> {
    const l = avant.itineraireBrut;
    const courant = itineraire(b(), ITINERAIRE.bataviaFerme);
    if (l === undefined || courant === undefined) throw new Error('Batavia absente');
    const r: Record<string, string | number | null> = {};
    for (const [c, v] of Object.entries(l)) if (c !== 'modifie_le' && v !== courant[c]) r[c] = v;
    expect(Object.keys(r), 'la modification a changé les paramètres de l’itinéraire').toContain('parametres');
    return r;
  }

  /** Espionne la transaction d'écriture de l'annulation et y injecte `synchro` une seule fois. */
  function injecter(banc: Banc, synchro: () => void): () => boolean {
    let recu = false;
    const original = banc.base.writeTransaction.bind(banc.base);
    vi.spyOn(banc.base, 'writeTransaction').mockImplementation((fn) => {
      if (!recu) {
        recu = true;
        synchro();
      }
      return original(fn);
    });
    return () => recu;
  }

  it('seul l’itinéraire est bloqué, l’autre téléphone l’ayant déjà défait : valeurs d’avant, tout le reste défait, aucun message', async () => {
    const avant = await modifierBatavia();
    const banc = b();
    const recu = injecter(banc, () => {
      recevoirUpdate(banc, 'itineraire', ITINERAIRE.bataviaFerme, valeursDAvant(avant));
    });

    banc.remiseAZero();
    await annuler();
    await attendre(recu, 'synchro reçue pendant l’annulation');
    await attendre(() => banc.transactions() === 1, 'annulation en une transaction');
    await laisserFiler();
    verifierOrdres(banc);

    const l = itineraire(banc, ITINERAIRE.bataviaFerme);
    expect(l?.modifie_le, 'la garde a bloqué l’UPDATE : la ligne est celle reçue').toBe(AILLEURS);
    expect(etat(l), 'l’itinéraire : valeurs d’avant').toEqual(avant.itineraire);
    serieDefaite(avant, SERIE.aVenir1, OCCUPATION.aVenir1);
    serieDefaite(avant, SERIE.aVenir2, OCCUPATION.aVenir2);
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });

  it('itinéraire remis ailleurs aux valeurs d’avant et aVenir1 recalée ailleurs : seules aVenir1 et son occupation comptent (2 lignes)', async () => {
    const avant = await modifierBatavia();
    const banc = b();
    const serieAilleurs = {
      ancre_date: '2026-11-16',
      prevu_semis_pepiniere: '2026-10-19',
      prevu_mise_en_place: '2026-11-16',
      prevu_debut_recolte: '2027-01-11',
      prevu_fin_recolte: '2027-01-25',
    };
    const recu = injecter(banc, () => {
      recevoirUpdate(banc, 'itineraire', ITINERAIRE.bataviaFerme, valeursDAvant(avant));
      recevoirUpdate(banc, 'serie', SERIE.aVenir1, serieAilleurs);
      recevoirUpdate(banc, 'occupation', OCCUPATION.aVenir1, { prevu_du: serieAilleurs.prevu_mise_en_place, prevu_au: serieAilleurs.prevu_fin_recolte });
    });

    banc.remiseAZero();
    await annuler();
    await attendre(recu, 'synchro reçue pendant l’annulation');
    await laisserFiler();
    verifierOrdres(banc);

    expect(etat(itineraire(banc, ITINERAIRE.bataviaFerme)), 'l’itinéraire : valeurs d’avant').toEqual(avant.itineraire);
    const s = serie(banc, SERIE.aVenir1);
    for (const [c, v] of Object.entries(serieAilleurs)) expect(s?.[c], `aVenir1.${c} écrit ailleurs reste`).toBe(v);
    serieDefaite(avant, SERIE.aVenir2, OCCUPATION.aVenir2);
    await attendreMessage(2);
  });
});
