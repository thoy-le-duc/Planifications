/**
 * Tests T13j, relecture (bloquante) — un vérificateur ne doit pas ouvrir la porte à TOUS les
 * « Fait » d'un ensemble, et le SQL brut ne doit pas contourner « déjà fait ».
 *
 * Constat : `ecrireEnsemble` ne refuse un « Fait » préparé que si `verifier === undefined`
 * (marque posée sur l'objet ordre). Donc : un vérificateur pour un « Fait » couvre un autre
 * « Fait » de l'ensemble ; deux « Fait » identiques passent ensemble ; un vérificateur vide
 * suffit ; une copie de l'ordre perd la marque ; `porte.ecrire` en SQL brut n'est pas vérifié.
 *
 * Règle attendue : CHAQUE « Fait » écrit (réalisé nouveau sur une culture, intervention nouvelle
 * qui solde un travail prévu) est vérifié « déjà fait » dans la transaction, d'après la ligne
 * qu'il insère (pas d'après l'objet ordre ni le vérificateur fourni), en voyant les ordres déjà
 * exécutés de la même transaction. Le reste (récolte, intervention libre, observation,
 * correction, annulation, UPDATE de note) n'est pas touché, en SQL brut compris : les pages de
 * diagnostic (apps/web/src/diagnostic/synchro.ts : INSERT brut d'une récolte, UPDATE d'une note)
 * et porte.test.ts (INSERT brut d'une observation) continuent de marcher.
 *
 *   X1 ecrireEnsemble([p1, p2], p1.verification), p2 déjà fait → DejaFait, rien écrit ;
 *   X2 deux « Fait » identiques dans un même ensemble, vérificateur valide → refusé, rien écrit ;
 *   X3 vérificateur vide (async () => {}) et « Fait » déjà fait → refusé, rien écrit ;
 *   X4 copie {...p.ordre} d'un « Fait » préparé, sans vérificateur → refusé, rien écrit ;
 *   X5 porte.ecrire brut d'un réalisé (SQL de la porte, ou type en littéral) ou d'une intervention
 *      soldante, déjà faits → refusé, rien écrit ; récolte brute (forme de synchro.ts), observation
 *      brute et UPDATE de note restent permis ;
 *   X6 récolte, intervention libre, correction et annulation dans un ensemble avec un vérificateur
 *      quelconque : écrites.
 */
import type { DateCalendaire, Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DejaFait } from './fait-unique.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { EvenementPrepare, PorteDonnees, SaisieEvenement, VerificationEcriture } from './types.ts';

const UTILISATEUR = '0192f0c1-13d3-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13d3-7000-8000-000000000002' as Id<'Ferme'>;
const EMPLACEMENT = '0192f0c1-13d3-7000-8000-000000000010' as Id<'Emplacement'>;
const SERIE_A = '0192f0c1-13d3-7000-8000-000000000020' as Id<'Serie'>;
const SERIE_B = '0192f0c1-13d3-7000-8000-000000000021' as Id<'Serie'>;
const AUJOURDHUI = '2026-10-01' as DateCalendaire;
const OCCURRENCE = '2026-09-28' as DateCalendaire;

let base: BaseMemoire;
let instant: number;
let porte: PorteDonnees;

beforeEach(() => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  instant = Date.parse('2026-10-01T06:00:00.000Z');
  porte = creerPorte(base, { utilisateurId: UTILISATEUR, fermeId: FERME, maintenant: () => new Date((instant += 1_000)) });
});

afterEach(() => {
  base.fermer();
});

type Etape = 'semis_pepiniere' | 'plantation';

const commun = (serieId: Id<'Serie'>) => ({
  date: AUJOURDHUI,
  source: 'agent' as const,
  culture: { sorte: 'serie' as const, serieId },
  emplacementIds: [EMPLACEMENT],
  note: null,
  photos: [],
  remplaceEvenement: null,
});

const realise = (serieId: Id<'Serie'>, etape: Etape): SaisieEvenement => ({ ...commun(serieId), type: 'realise', detail: { etape, quantiteReelle: null } });
const desherbage = (serieId: Id<'Serie'>, occurrenceVisee: DateCalendaire | null): SaisieEvenement => ({
  ...commun(serieId),
  type: 'intervention',
  detail: { categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee },
});

/** Vérificateur qui ne vérifie rien. */
const VERIFICATEUR_VIDE: VerificationEcriture = () => Promise.resolve();

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;

function verification(p: EvenementPrepare): VerificationEcriture {
  if (p.verification === undefined) throw new Error('banc : « Fait » préparé sans vérification');
  return p.verification;
}

/** Rend l'erreur levée par `p`, ou échoue si l'écriture réussit. */
async function rejet(p: Promise<unknown>, message: string): Promise<unknown> {
  let resultat: unknown;
  try {
    resultat = await p;
  } catch (e) {
    return e;
  }
  return expect.fail(`${message} : refus attendu, l’écriture a réussi (rendu : ${String(resultat)})`);
}

/** Refus : DejaFait, ou erreur explicite qui nomme la vérification. */
async function attendreRefus(p: Promise<unknown>, message: string): Promise<void> {
  const e = await rejet(p, message);
  expect(e, `${message} : une erreur`).toBeInstanceOf(Error);
  if (!(e instanceof DejaFait)) expect(e instanceof Error ? e.message : '', `${message} : DejaFait ou erreur « vérification »`).toMatch(/vérification/i);
}

describe('T13j, relecture : chaque « Fait » d’un ensemble est vérifié, quel que soit le vérificateur fourni', () => {
  it('X1 : ecrireEnsemble([p1, p2], p1.verification), p2 déjà fait → DejaFait, rien n’est écrit', async () => {
    await porte.saisirEvenement(realise(SERIE_B, 'plantation'));
    const avant = nombreEvenements();
    const p1 = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    const p2 = porte.preparerSaisie(realise(SERIE_B, 'plantation'));
    const e = await rejet(porte.ecrireEnsemble([p1.ordre, p2.ordre], verification(p1)), 'p2 déjà fait, couvert par la vérification de p1');
    expect(e, 'DejaFait').toBeInstanceOf(DejaFait);
    expect(nombreEvenements(), 'rien n’est écrit (ni p1 ni p2)').toBe(avant);
  });

  it('X1b : même chose pour une intervention qui solde un travail déjà soldé, à côté d’un réalisé neuf', async () => {
    await porte.saisirEvenement(desherbage(SERIE_A, OCCURRENCE));
    const avant = nombreEvenements();
    const p1 = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    const p2 = porte.preparerSaisie(desherbage(SERIE_A, OCCURRENCE));
    const e = await rejet(porte.ecrireEnsemble([p1.ordre, p2.ordre], verification(p1)), 'travail déjà soldé, couvert par la vérification du réalisé');
    expect(e, 'DejaFait').toBeInstanceOf(DejaFait);
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('X2 : deux « Fait » identiques (même série, même étape) dans un même ensemble, vérificateur valide → refusé, rien n’est écrit', async () => {
    const p1 = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    const p2 = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    await attendreRefus(porte.ecrireEnsemble([p1.ordre, p2.ordre], verification(p1)), 'deux plantations dans le même ensemble');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(0);
  });

  it('X3 : vérificateur vide (async () => {}) alors que le « Fait » est déjà fait → refusé, rien n’est écrit', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const avant = nombreEvenements();
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    await attendreRefus(
      porte.ecrireEnsemble([p.ordre], VERIFICATEUR_VIDE),
      'vérificateur vide',
    );
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('X4 : copie {...p.ordre} d’un « Fait » préparé, sans vérificateur → refusé, rien n’est écrit', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const avant = nombreEvenements();
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    await attendreRefus(porte.ecrireEnsemble([{ ...p.ordre }]), 'copie de l’ordre préparé');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('X4b : ordre reconstruit à la main (même SQL, mêmes paramètres copiés), sans vérificateur → refusé', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const avant = nombreEvenements();
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    await attendreRefus(porte.ecrireEnsemble([{ sql: p.ordre.sql.slice(0), parametres: [...(p.ordre.parametres ?? [])] }]), 'ordre reconstruit');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });
});

describe('T13j, relecture : porte.ecrire en SQL brut ne contourne pas « déjà fait »', () => {
  it('X5a : porte.ecrire(SQL de la porte, paramètres d’un réalisé déjà fait) → refusé, rien n’est écrit', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const avant = nombreEvenements();
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    await attendreRefus(porte.ecrire(p.ordre.sql, p.ordre.parametres), 'réalisé en SQL brut');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('X5b : INSERT brut d’un réalisé, type en littéral (forme de diagnostic/synchro.ts), déjà fait → refusé', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const avant = nombreEvenements();
    await attendreRefus(
      porte.ecrire(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id,
           emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail)
         VALUES (?, ?, 'realise', ?, ?, ?, 'tap', ?, NULL, '[]', NULL, '[]', NULL, NULL, ?)`,
        ['0192f0c1-13d3-7000-8000-0000000000e0', FERME, AUJOURDHUI, '2026-10-01T09:00:00.000Z', UTILISATEUR, SERIE_A, JSON.stringify({ etape: 'plantation', quantiteReelle: null })],
      ),
      'réalisé brut, type littéral',
    );
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('X5c : porte.ecrire d’une intervention qui solde un travail déjà soldé → refusé', async () => {
    await porte.saisirEvenement(desherbage(SERIE_A, OCCURRENCE));
    const avant = nombreEvenements();
    const p = porte.preparerSaisie(desherbage(SERIE_A, OCCURRENCE));
    await attendreRefus(porte.ecrire(p.ordre.sql, p.ordre.parametres), 'intervention soldante en SQL brut');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('X5d : restent permis en SQL brut : récolte (forme de diagnostic/synchro.ts, même pour une autre ferme), observation, UPDATE de note', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const recolte = (id: string, fermeId: string) =>
      porte.ecrire(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id,
           emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail)
         VALUES (?, ?, 'recolte', ?, ?, ?, 'tap', NULL, NULL, '[]', NULL, '[]', NULL, NULL, ?)`,
        [id, fermeId, AUJOURDHUI, '2026-10-01T09:00:00.000Z', UTILISATEUR, JSON.stringify({ quantite: 99, unite: 'kg', categorie: null })],
      );
    await expect(recolte('0192f0c1-13d3-7000-8000-0000000000f0', FERME), 'récolte brute').resolves.toBeUndefined();
    await expect(recolte('0192f0c1-13d3-7000-8000-0000000000f1', '0192f0c1-13d3-7000-8000-0000000000ff'), 'récolte brute, autre ferme').resolves.toBeUndefined();
    await expect(
      porte.ecrire(`INSERT INTO evenement (id, ferme_id, type) VALUES (?, ?, 'observation')`, ['0192f0c1-13d3-7000-8000-0000000000f2', FERME]),
      'observation brute (porte.test.ts)',
    ).resolves.toBeUndefined();
    await expect(
      porte.ecrire('UPDATE evenement SET note = ? WHERE id = ?', ['modifiée sur place', '0192f0c1-13d3-7000-8000-0000000000f0']),
      'UPDATE de note (diagnostic/synchro.ts)',
    ).resolves.toBeUndefined();
    expect(nombreEvenements()).toBe(4);
  });
});

describe('T13j, relecture : le reste n’est pas touché', () => {
  it('X6 : récolte, intervention libre, correction et annulation dans un ensemble avec un vérificateur quelconque : écrites', async () => {
    const id = await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const id2 = await porte.saisirEvenement(realise(SERIE_A, 'semis_pepiniere'));
    const saisies: SaisieEvenement[] = [
      { ...commun(SERIE_A), type: 'recolte', detail: { quantite: 12, unite: 'kg', categorie: null } },
      desherbage(SERIE_A, null),
      { ...realise(SERIE_A, 'plantation'), date: '2026-09-30' as DateCalendaire, remplaceEvenement: { sorte: 'correction', evenementId: id } },
      { ...realise(SERIE_A, 'semis_pepiniere'), remplaceEvenement: { sorte: 'annulation', evenementId: id2 } },
    ];
    const ordres = saisies.map((s) => porte.preparerSaisie(s).ordre);
    await expect(porte.ecrireEnsemble(ordres, VERIFICATEUR_VIDE), 'vérificateur vide').resolves.toBeUndefined();
    const ordres2 = saisies.slice(0, 2).map((s) => porte.preparerSaisie(s).ordre);
    const p = porte.preparerSaisie(realise(SERIE_B, 'plantation'));
    await expect(porte.ecrireEnsemble([...ordres2, p.ordre], verification(p)), 'avec un « Fait » neuf et sa vérification').resolves.toBeUndefined();
    expect(nombreEvenements()).toBe(2 + 4 + 3);
  });
});
