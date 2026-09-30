// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24 — décisions 9 à 12 du chef, après la relecture
 * (docs/backlog/T24-ecran-itineraires.md, « Décisions du chef (après la relecture) ») :
 *   9.  « Annuler » ne ramène que ce que l'écriture a changé, colonne par colonne, et seulement si
 *       la valeur actuelle est encore celle que nous avions écrite ; sinon l'annulation de cette
 *       ligne est refusée avec un message « modifié entre-temps » (itinéraire, séries, occupations) ;
 *   10. une série qui a une intervention en vigueur (un travail déjà fait) n'est pas « à venir » ;
 *   11. le caractère « à venir » est revérifié à l'écriture : une série commencée entre-temps (un
 *       réalisé reçu par la synchro, confirmation ouverte) n'est pas modifiée ;
 *   12. itinéraire + séries + occupations au-delà de ECRITURES_MAX_PAR_LOT (500) : la confirmation
 *       le dit AVANT d'écrire (« trop de séries », « Itinéraire seul ») ; « Appliquer » n'écrit rien,
 *       « Itinéraire seul » reste possible.
 * Les écritures « d'un autre téléphone » arrivent par base.recevoir, comme la synchro. Aucun test
 * existant n'est modifié : le cas « rien n'a bougé ailleurs, l'annulation rétablit tout » reste
 * couvert par ./series.test.tsx et ./ecran.test.tsx (« Annuler »), et un contrôle est repris ici.
 */
import { describe, expect, it } from 'vitest';
import { ECRITURES_MAX_PAR_LOT } from '@planif/sync';
import { EMPLACEMENT, FERME, ITINERAIRE, NOMS_ITINERAIRES, OCCUPATION, SERIE, UTILISATEUR } from './test/ferme-itineraires.ts';
import { bandeau, enregistrer, formulaire, formulaireOuvert, harnais, laisserFiler, ouvrirFormulaire } from './test/harnais.ts';
import {
  attendre,
  bouton,
  champ,
  desactive,
  dialogue,
  dialogueOuEchec,
  etat,
  itineraire,
  occupations,
  occupationsDe,
  occupationsValides,
  parametresDe,
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
const MODIFIER_CHOU = `Modifier ${NOMS_ITINERAIRES.chouAutomne}`;

/** Texte de tous les messages de l'écran (alertes et statuts). */
const messages = (): string =>
  [...document.querySelectorAll('[role="alert"], [role="status"], [role="alertdialog"]')].map((e) => texte(e)).join(' | ');

/** UPDATE reçu par la synchro (ligne écrite par un autre téléphone). */
function recevoirUpdate(banc: Banc, table: string, id: string, valeurs: Readonly<Record<string, string | number | null>>): void {
  const cles = Object.keys(valeurs);
  banc.base.recevoir(`UPDATE ${table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, [...cles.map((c) => valeurs[c] ?? null), AILLEURS, id]);
}

/** Événement reçu par la synchro sur une série. */
function recevoirEvenement(banc: Banc, idEvenement: string, type: 'realise' | 'intervention', serieId: string, emplacement: string, detail: unknown): void {
  banc.base.recevoir(
    `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
     VALUES (?, ?, ?, ?, ?, ?, 'tap', ?, NULL, ?, NULL, '[]', NULL, NULL, ?, ?)`,
    [idEvenement, FERME, type, '2026-09-29', AILLEURS, UTILISATEUR, serieId, JSON.stringify([emplacement]), JSON.stringify(detail), AILLEURS],
  );
}

async function ouvrirEtModifier(id: string, bouton_: string, champ_: string, valeur: string): Promise<void> {
  await h.ouvrir();
  await ouvrirFormulaire(id, bouton_);
  await remplir(champ(champ_, formulaire()), valeur);
  await enregistrer();
}

async function annuler(): Promise<void> {
  const bd = bandeau();
  expect(bd, 'bandeau « Annuler »').not.toBeNull();
  await toucher(bouton('Annuler', bd ?? document));
  await laisserFiler();
}

describe('T24, décision 9 : « Annuler » ne défait que ce que nous avons écrit, et pas par-dessus un autre téléphone', () => {
  it('itinéraire renommé et supprimé ailleurs après notre modification : l’annulation ne le ressuscite pas et le dit (« modifié entre-temps »)', async () => {
    await ouvrirEtModifier(ITINERAIRE.chouAutomne, MODIFIER_CHOU, 'Récolte (jours)', '20');
    await attendre(() => bandeau() !== null && parametresDe(itineraire(b(), ITINERAIRE.chouAutomne)).fenetreRecolteJours === 20, 'modification écrite');
    recevoirUpdate(b(), 'itineraire', ITINERAIRE.chouAutomne, { nom: 'Renommé ailleurs', supprime_le: AILLEURS });
    await unTour();
    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    expect(l?.nom, 'le nom venu d’ailleurs reste').toBe('Renommé ailleurs');
    expect(l?.supprime_le, 'l’itinéraire supprimé ailleurs n’est pas ressuscité').toBe(AILLEURS);
  });

  it('colonne par colonne : renommé ailleurs seulement, l’annulation ramène nos paramètres et garde le nom de l’autre téléphone', async () => {
    await ouvrirEtModifier(ITINERAIRE.chouAutomne, MODIFIER_CHOU, 'Récolte (jours)', '20');
    await attendre(() => bandeau() !== null && parametresDe(itineraire(b(), ITINERAIRE.chouAutomne)).fenetreRecolteJours === 20, 'modification écrite');
    recevoirUpdate(b(), 'itineraire', ITINERAIRE.chouAutomne, { nom: 'Renommé ailleurs' });
    await unTour();
    await annuler();
    await attendre(() => parametresDe(itineraire(b(), ITINERAIRE.chouAutomne)).fenetreRecolteJours === 30, 'nos paramètres ramenés (fenêtre 30 j)');
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    expect(l?.nom, 'le nom n’a pas été écrit par nous : il reste').toBe('Renommé ailleurs');
    expect(l?.supprime_le).toBeNull();
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });

  it('série à venir mise à jour puis modifiée ailleurs : elle garde les valeurs de l’autre téléphone ; le reste est défait ; message', async () => {
    await h.ouvrir();
    const avant = { series: series(b()), occupations: occupations(b()), itineraire: etat(itineraire(b(), ITINERAIRE.bataviaFerme)) };
    await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA);
    await remplir(champ('Avant récolte (jours)', formulaire()), '56');
    await enregistrer();
    await attendre(() => dialogue(/^Appliquer/) !== undefined, 'confirmation');
    await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
    await attendre(() => bandeau() !== null, 'bandeau');

    // L'autre téléphone recale aVenir1 (nouvelle ancre, dates, occupation).
    const ailleurs = {
      ancre_date: '2026-11-16',
      prevu_semis_pepiniere: '2026-10-19',
      prevu_mise_en_place: '2026-11-16',
      prevu_debut_recolte: '2027-01-11',
      prevu_fin_recolte: '2027-01-25',
    };
    recevoirUpdate(b(), 'serie', SERIE.aVenir1, ailleurs);
    recevoirUpdate(b(), 'occupation', OCCUPATION.aVenir1, { prevu_du: ailleurs.prevu_mise_en_place, prevu_au: ailleurs.prevu_fin_recolte });
    const recue = serie(b(), SERIE.aVenir1);
    const occRecue = occupationsDe(b(), SERIE.aVenir1);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    expect(serie(b(), SERIE.aVenir1), 'aVenir1 garde ce que l’autre téléphone a écrit').toEqual(recue);
    expect(occupationsDe(b(), SERIE.aVenir1)).toEqual(occRecue);
    const brute = (liste: readonly Ligne[], id: string) => liste.find((l) => l.id === id);
    expect(etat(serie(b(), SERIE.aVenir2)), 'aVenir2, intacte ailleurs : défaite').toEqual(etat(brute(avant.series, SERIE.aVenir2)));
    expect(occupationsDe(b(), SERIE.aVenir2).map(etat)).toEqual([etat(brute(avant.occupations, OCCUPATION.aVenir2))]);
    expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme)), 'l’itinéraire, intact ailleurs : défait').toEqual(avant.itineraire);
  });

  it('planche ajoutée ailleurs à aVenir1 aux nouvelles dates : la série et ses occupations restent telles quelles (valides) ; message ; le reste est défait', async () => {
    await h.ouvrir();
    const avant = { series: series(b()), occupations: occupations(b()), itineraire: etat(itineraire(b(), ITINERAIRE.bataviaFerme)) };
    await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA);
    await remplir(champ('Avant récolte (jours)', formulaire()), '56');
    await enregistrer();
    await attendre(() => dialogue(/^Appliquer/) !== undefined, 'confirmation');
    await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
    await attendre(() => bandeau() !== null, 'bandeau');

    // L'autre téléphone ajoute une planche (T1-P01) à aVenir1, aux dates nouvelles de la série.
    const nouvelle = serie(b(), SERIE.aVenir1);
    const modele = occupationsDe(b(), SERIE.aVenir1)[0];
    if (nouvelle === undefined || modele === undefined) throw new Error('aVenir1 absente');
    const ajoutee: Ligne = {
      ...modele,
      id: '0192f0c1-2424-7000-8000-0000000000d1',
      emplacement_id: EMPLACEMENT.t1p01,
      prevu_du: nouvelle.prevu_mise_en_place ?? null,
      prevu_au: nouvelle.prevu_fin_recolte ?? null,
      cree_le: AILLEURS,
      modifie_le: AILLEURS,
    };
    const cles = Object.keys(ajoutee);
    b().base.recevoir(`INSERT INTO occupation (${cles.join(', ')}) VALUES (${cles.map(() => '?').join(', ')})`, cles.map((c) => ajoutee[c] ?? null));
    occupationsValides(b(), SERIE.aVenir1);
    const occRecues = occupationsDe(b(), SERIE.aVenir1);
    expect(occRecues).toHaveLength(2);
    await unTour();

    b().remiseAZero();
    await annuler();
    await attendre(() => messages().includes('modifié entre-temps'), `message « modifié entre-temps » (vus : ${messages()})`);
    verifierOrdres(b());
    expect(serie(b(), SERIE.aVenir1), 'aVenir1 garde ses nouvelles dates').toEqual(nouvelle);
    expect(occupationsDe(b(), SERIE.aVenir1), 'ses occupations restent telles quelles').toEqual(occRecues);
    occupationsValides(b(), SERIE.aVenir1);
    const brute = (liste: readonly Ligne[], id: string) => liste.find((l) => l.id === id);
    expect(etat(serie(b(), SERIE.aVenir2)), 'aVenir2 : défaite').toEqual(etat(brute(avant.series, SERIE.aVenir2)));
    expect(occupationsDe(b(), SERIE.aVenir2).map(etat)).toEqual([etat(brute(avant.occupations, OCCUPATION.aVenir2))]);
    expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme)), 'l’itinéraire : défait').toEqual(avant.itineraire);
  });

  it('contrôle : rien n’a bougé ailleurs, l’annulation rétablit tout, sans message', async () => {
    await h.ouvrir();
    const avant = { series: series(b()).map(etat), occupations: occupations(b()).map(etat), itineraire: etat(itineraire(b(), ITINERAIRE.bataviaFerme)) };
    await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA);
    await remplir(champ('Avant récolte (jours)', formulaire()), '56');
    await enregistrer();
    await attendre(() => dialogue(/^Appliquer/) !== undefined, 'confirmation');
    await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
    await attendre(() => bandeau() !== null, 'bandeau');
    b().remiseAZero();
    await annuler();
    await attendre(() => b().transactions() === 1, 'annulation en une transaction');
    expect(series(b()).map(etat)).toEqual(avant.series);
    expect(occupations(b()).map(etat)).toEqual(avant.occupations);
    expect(etat(itineraire(b(), ITINERAIRE.bataviaFerme))).toEqual(avant.itineraire);
    expect(messages()).not.toMatch(/modifié entre-temps/);
  });
});

describe('T24, décision 10 : une série dont un travail est déjà fait n’est pas « à venir »', () => {
  it('intervention en vigueur sur aVenir2 : seule aVenir1 est proposée et modifiée', async () => {
    const e = '0192f0c1-2424-7000-8000-0000000000c1';
    const banc = b();
    recevoirEvenement(banc, e, 'intervention', SERIE.aVenir2, EMPLACEMENT.t1p06, { categorie: 'entretien', type: 'binette', outil: null, occurrenceVisee: null });
    const avant2 = serie(banc, SERIE.aVenir2);
    await ouvrirEtModifier(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA, 'Avant récolte (jours)', '56');
    await attendre(() => dialogue(/^Appliquer à la série à venir/) !== undefined, `confirmation « Appliquer à la série à venir ? » (ouverts : ${messages()})`);
    const d = dialogueOuEchec(/^Appliquer à la série à venir/);
    expect([...d.querySelectorAll<HTMLElement>('[data-testid="serie-a-venir"]')].map((x) => x.dataset.serie)).toEqual([SERIE.aVenir1]);
    await toucher(bouton('Appliquer aux séries', d));
    await attendre(() => formulaireOuvert() === undefined, 'enregistré');
    expect(serie(banc, SERIE.aVenir2), 'aVenir2 ne bouge pas').toEqual(avant2);
    expect(parametresDe(serie(banc, SERIE.aVenir1)).dureeAvantRecolteJours).toBe(56);
  });
});

describe('T24, décision 11 : « à venir » revérifié à l’écriture', () => {
  it('un réalisé arrive sur aVenir1 pendant la confirmation : aVenir1 n’est pas modifiée, aVenir2 l’est', async () => {
    await ouvrirEtModifier(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA, 'Avant récolte (jours)', '56');
    await attendre(() => dialogue(/^Appliquer aux 2 séries à venir/) !== undefined, 'confirmation pour 2 séries');
    const avant1 = serie(b(), SERIE.aVenir1);
    const occ1 = occupationsDe(b(), SERIE.aVenir1);
    recevoirEvenement(b(), '0192f0c1-2424-7000-8000-0000000000c2', 'realise', SERIE.aVenir1, EMPLACEMENT.t1p05, { etape: 'semis_pepiniere', quantiteReelle: null });
    b().remiseAZero();
    await toucher(bouton('Appliquer aux séries', dialogueOuEchec(/^Appliquer/)));
    await attendre(() => b().transactions() === 1, 'une transaction');
    await laisserFiler();
    verifierOrdres(b());
    expect(serie(b(), SERIE.aVenir1), 'devenue commencée : intacte').toEqual(avant1);
    expect(occupationsDe(b(), SERIE.aVenir1)).toEqual(occ1);
    expect(parametresDe(serie(b(), SERIE.aVenir2)).dureeAvantRecolteJours, 'aVenir2 : mise à jour').toBe(56);
    expect(parametresDe(itineraire(b(), ITINERAIRE.bataviaFerme)).dureeAvantRecolteJours).toBe(56);
  });
});

/** Jeu dédié : `n` séries à venir de plus, clones d'aVenir1 (même itinéraire et dates, planche T1-P05), une occupation chacune. */
function ajouterSeriesAVenir(banc: Banc, n: number): string[] {
  const modele = serie(banc, SERIE.aVenir1);
  const occ = occupationsDe(banc, SERIE.aVenir1)[0];
  if (modele === undefined || occ === undefined) throw new Error('aVenir1 absente');
  const ids: string[] = [];
  const inserer = (table: string, l: Ligne) => {
    const cles = Object.keys(l);
    banc.base.recevoir(`INSERT INTO ${table} (${cles.join(', ')}) VALUES (${cles.map(() => '?').join(', ')})`, cles.map((c) => l[c] ?? null));
  };
  for (let k = 0; k < n; k++) {
    const sid = `0192f0c1-2424-7000-8001-${k.toString(16).padStart(12, '0')}`;
    const oid = `0192f0c1-2424-7000-8002-${k.toString(16).padStart(12, '0')}`;
    inserer('serie', { ...modele, id: sid });
    inserer('occupation', { ...occ, id: oid, serie_id: sid });
    ids.push(sid);
  }
  return ids;
}

describe('T24, décision 12 : lot trop gros annoncé avant d’écrire', () => {
  it(`itinéraire + séries + occupations > ${String(ECRITURES_MAX_PAR_LOT)} écritures : la confirmation le dit ; « Appliquer » n’écrit rien ; « Itinéraire seul » passe`, async () => {
    // 1 itinéraire + 2 × (2 + n) lignes > 500.
    const n = Math.ceil(ECRITURES_MAX_PAR_LOT / 2) - 1;
    expect(1 + 2 * (2 + n)).toBeGreaterThan(ECRITURES_MAX_PAR_LOT);
    ajouterSeriesAVenir(b(), n);
    const avant = { series: series(b()), occupations: occupations(b()) };
    await ouvrirEtModifier(ITINERAIRE.bataviaFerme, MODIFIER_BATAVIA, 'Avant récolte (jours)', '56');
    await attendre(() => dialogue(/^Appliquer aux \d+ séries à venir/) !== undefined, `confirmation (ouverts : ${messages()})`);
    const d = dialogueOuEchec(/^Appliquer aux \d+ séries à venir/);
    expect(texte(d), 'annoncé avant d’écrire').toMatch(/trop de séries/i);
    expect(texte(d)).toContain('Itinéraire seul');
    expect(b().transactions(), 'rien d’écrit avant la réponse').toBe(0);

    b().remiseAZero();
    const appliquer = bouton('Appliquer aux séries', d);
    if (!desactive(appliquer)) await toucher(appliquer);
    await laisserFiler();
    expect(b().transactions(), '« Appliquer » : aucune écriture').toBe(0);
    expect(series(b())).toEqual(avant.series);

    await toucher(bouton('Itinéraire seul', dialogueOuEchec(/^Appliquer/)));
    await attendre(() => b().transactions() === 1, '« Itinéraire seul » : une transaction');
    await laisserFiler();
    expect(parametresDe(itineraire(b(), ITINERAIRE.bataviaFerme)).dureeAvantRecolteJours).toBe(56);
    expect(series(b())).toEqual(avant.series);
    expect(occupations(b())).toEqual(avant.occupations);
  });
});
