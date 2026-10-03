/**
 * Tests d'acceptation T13i — « Fait » unique, partagé par toutes les écritures de réalisé.
 *
 * La règle de T13h (jamais deux réalisés en vigueur pour la même culture et la même étape) vivait
 * dans l'écran Aujourd'hui (apps/web/src/ecrans/aujourdhui/ecritures.ts). T13i la met dans
 * @planif/sync : une saisie de réalisé par `porte.saisirEvenement` (voix, agent, photo… sans passer
 * par l'écran) y est soumise, dans la même transaction que l'écriture.
 *
 * Contrat attendu de @planif/sync :
 *   - `DejaFait`, classe d'erreur exportée par le paquet (`export class DejaFait extends Error`) ;
 *   - `porte.saisirEvenement(saisie)` d'un réalisé NOUVEAU (remplaceEvenement nul) pour une culture
 *     qui a déjà un réalisé EN VIGUEUR de la même étape : rejet `DejaFait`, rien n'est écrit ;
 *   - « en vigueur » : la règle de T13h (`EN_VIGUEUR`/`CHAINES` de calculs.ts) — une chaîne annulée
 *     n'a rien en vigueur, sinon sa correction la plus récente (horodatage, puis id), à défaut
 *     l'original ; l'étape et la culture sont lues sur cette ligne-là ; seules les lignes de la
 *     ferme de la porte comptent ;
 *   - une correction ou une annulation (remplaceEvenement non nul) n'est pas refusée ; les autres
 *     types d'événement (récolte, intervention libre, observation) ne sont pas touchés.
 *
 * Banc : base mémoire (node:sqlite, schéma local), vraie porte ; une horloge qui avance d'une
 * seconde à chaque lecture (corrections ordonnées par horodatage).
 *
 *   P1  deux réalisés successifs, même série, même étape → le second rejeté (DejaFait), rien écrit ;
 *   P2  deux réalisés lancés sans attendre (même porte, puis deux portes sur la même base) → un seul ;
 *   P3  même règle sur une campagne (colonne campagne_id) ;
 *   P4  une autre étape, une autre série : rien n'empêche ;
 *   P5  annulation du réalisé (par saisirEvenement) acceptée ; ensuite un nouveau réalisé s'écrit ;
 *   P6  correction de date acceptée ; le réalisé reste en vigueur → DejaFait ;
 *   P7  correction qui change l'étape (semis → plantation) : le semis peut se refaire, pas la plantation ;
 *   P8  annulation reçue du serveur (origine_id, maillon intermédiaire absent) : nouveau réalisé accepté ;
 *   P9  un réalisé d'une AUTRE ferme dans la même base n'empêche rien ;
 *   P10 récolte, intervention libre, observation : deux saisies identiques s'écrivent toutes les deux.
 */
import type { DateCalendaire, Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as paquet from './index.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees, SaisieEvenement } from './types.ts';

const UTILISATEUR = '0192f0c1-13d0-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13d0-7000-8000-000000000002' as Id<'Ferme'>;
const AUTRE_FERME = '0192f0c1-13d0-7000-8000-000000000003' as Id<'Ferme'>;
const EMPLACEMENT = '0192f0c1-13d0-7000-8000-000000000010' as Id<'Emplacement'>;
const SERIE_A = '0192f0c1-13d0-7000-8000-000000000020' as Id<'Serie'>;
const SERIE_B = '0192f0c1-13d0-7000-8000-000000000021' as Id<'Serie'>;
const CAMPAGNE = '0192f0c1-13d0-7000-8000-000000000030' as Id<'Campagne'>;
const AUJOURDHUI = '2026-10-01' as DateCalendaire;

// ── Contrat : la classe DejaFait exportée par @planif/sync (lue sans casser le typage tant
//    qu'elle n'existe pas) ──────────────────────────────────────────────────────────────────

function classeDejaFait(): new (message?: string) => Error {
  const c = (paquet as unknown as Readonly<Record<string, unknown>>).DejaFait;
  expect(c, '@planif/sync exporte la classe d’erreur DejaFait (« déjà fait »)').toBeTypeOf('function');
  return c as new (message?: string) => Error;
}

/** Attend que `p` soit rejetée avec DejaFait. */
async function attendreDejaFait(p: Promise<unknown>, message: string): Promise<void> {
  let resultat: unknown;
  try {
    resultat = await p;
  } catch (e) {
    expect(e, `${message} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(classeDejaFait());
    return;
  }
  expect.fail(`${message} : rejet DejaFait attendu, saisirEvenement a rendu ${String(resultat)} (un événement a été écrit)`);
}

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

let base: BaseMemoire;
let instant: number;
let porte: PorteDonnees;

/** Horloge partagée par toutes les portes du test : avance d'une seconde à chaque lecture. */
const maintenant = (): Date => new Date((instant += 1_000));

const porteDe = (fermeId: Id<'Ferme'>): PorteDonnees => creerPorte(base, { utilisateurId: UTILISATEUR, fermeId, maintenant });

beforeEach(() => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  instant = Date.parse('2026-10-01T06:00:00.000Z');
  porte = porteDe(FERME);
});

afterEach(() => {
  base.fermer();
});

type Etape = 'semis_pepiniere' | 'semis_direct' | 'plantation' | 'arrachage';
type Cible = { readonly sorte: 'serie'; readonly serieId: Id<'Serie'> } | { readonly sorte: 'campagne'; readonly campagneId: Id<'Campagne'> };

const serie = (serieId: Id<'Serie'>): Cible => ({ sorte: 'serie', serieId });

const commun = (culture: Cible | null, date: DateCalendaire = AUJOURDHUI) => ({
  date,
  source: 'voix' as const,
  culture,
  emplacementIds: [EMPLACEMENT],
  note: null,
  photos: [],
  remplaceEvenement: null,
});

/** Réalisé nouveau, tel que la voix ou l'agent l'écrirait. */
const realise = (culture: Cible, etape: Etape, date: DateCalendaire = AUJOURDHUI): SaisieEvenement => ({
  ...commun(culture, date),
  type: 'realise',
  detail: { etape, quantiteReelle: null },
});

/** Correction ou annulation d'un réalisé. */
const remplacement = (
  culture: Cible,
  etape: Etape,
  sorte: 'correction' | 'annulation',
  evenementId: Id<'Evenement'>,
  date: DateCalendaire = AUJOURDHUI,
): SaisieEvenement => ({
  ...commun(culture, date),
  type: 'realise',
  remplaceEvenement: { sorte, evenementId },
  detail: { etape, quantiteReelle: null },
});

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;

// ── Réalisés nouveaux ────────────────────────────────────────────────────────────────────────

describe('T13i : un réalisé saisi par porte.saisirEvenement passe par la vérification « déjà fait »', () => {
  it('P1 : deux réalisés successifs (même série, même étape) → le second rejeté avec DejaFait, rien n’est écrit', async () => {
    await porte.saisirEvenement(realise(serie(SERIE_A), 'plantation', '2026-09-28' as DateCalendaire));
    const avant = nombreEvenements();
    await attendreDejaFait(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'second réalisé de la plantation');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('P2a : deux réalisés lancés sans attendre (même porte) → un seul écrit, l’autre rejeté avec DejaFait', async () => {
    const r = await Promise.allSettled([
      porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')),
      porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')),
    ]);
    expect(nombreEvenements(), 'un seul réalisé en base').toBe(1);
    expect(r.filter((x) => x.status === 'fulfilled'), 'un seul appel réussit').toHaveLength(1);
    const rejet = r.find((x) => x.status === 'rejected');
    expect(rejet?.status === 'rejected' ? rejet.reason : undefined, 'l’autre est rejeté avec DejaFait').toBeInstanceOf(classeDejaFait());
  });

  it('P2b : deux portes sur la même base (deux onglets), sans attendre → un seul réalisé', async () => {
    const r = await Promise.allSettled([
      porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')),
      porteDe(FERME).saisirEvenement(realise(serie(SERIE_A), 'plantation')),
    ]);
    expect(nombreEvenements(), 'un seul réalisé en base').toBe(1);
    const rejet = r.find((x) => x.status === 'rejected');
    expect(rejet?.status === 'rejected' ? rejet.reason : undefined, 'l’autre est rejeté avec DejaFait').toBeInstanceOf(classeDejaFait());
  });

  it('P3 : même règle sur une campagne (plantation pérenne)', async () => {
    const campagne: Cible = { sorte: 'campagne', campagneId: CAMPAGNE };
    await porte.saisirEvenement(realise(campagne, 'arrachage'));
    const avant = nombreEvenements();
    await attendreDejaFait(porte.saisirEvenement(realise(campagne, 'arrachage')), 'second arrachage de la campagne');
    expect(nombreEvenements()).toBe(avant);
  });

  it('P4 : une autre étape de la même série, ou la même étape d’une autre série, s’écrit', async () => {
    await porte.saisirEvenement(realise(serie(SERIE_A), 'semis_pepiniere'));
    await expect(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'autre étape').resolves.toBeTypeOf('string');
    await expect(porte.saisirEvenement(realise(serie(SERIE_B), 'semis_pepiniere')), 'autre série').resolves.toBeTypeOf('string');
    expect(nombreEvenements()).toBe(3);
  });
});

// ── Chaînes : corrections et annulations (règle « en vigueur » de T13h) ──────────────────────

describe('T13i : « en vigueur » jugé comme T13h (annulations, corrections)', () => {
  it('P5 : l’annulation du réalisé s’écrit, puis un nouveau réalisé de la même étape s’écrit', async () => {
    const id = await porte.saisirEvenement(realise(serie(SERIE_A), 'plantation', '2026-09-28' as DateCalendaire));
    await expect(
      porte.saisirEvenement(remplacement(serie(SERIE_A), 'plantation', 'annulation', id, '2026-09-28' as DateCalendaire)),
      'une annulation n’est jamais refusée « déjà fait »',
    ).resolves.toBeTypeOf('string');
    await expect(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'chaîne annulée : nouveau réalisé').resolves.toBeTypeOf('string');
    expect(nombreEvenements()).toBe(3);
    // Et ce nouveau réalisé est à son tour en vigueur.
    await attendreDejaFait(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'troisième réalisé');
  });

  it('P6 : la correction de date s’écrit ; le réalisé corrigé reste en vigueur → DejaFait', async () => {
    const id = await porte.saisirEvenement(realise(serie(SERIE_A), 'plantation'));
    await expect(
      porte.saisirEvenement(remplacement(serie(SERIE_A), 'plantation', 'correction', id, '2026-09-29' as DateCalendaire)),
      'une correction n’est pas refusée « déjà fait »',
    ).resolves.toBeTypeOf('string');
    const avant = nombreEvenements();
    await attendreDejaFait(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'réalisé après correction de date');
    expect(nombreEvenements()).toBe(avant);
  });

  it('P7 : réalisé « semis en pépinière » corrigé en « plantation » : le semis se refait, la plantation rend DejaFait', async () => {
    const id = await porte.saisirEvenement(realise(serie(SERIE_A), 'semis_pepiniere'));
    await porte.saisirEvenement(remplacement(serie(SERIE_A), 'plantation', 'correction', id));
    await attendreDejaFait(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'plantation (la correction en vigueur en est une)');
    await expect(porte.saisirEvenement(realise(serie(SERIE_A), 'semis_pepiniere')), 'semis (l’original n’est plus en vigueur)').resolves.toBeTypeOf('string');
  });

  it('P8 : annulation reçue du serveur (origine_id = l’original, maillon intermédiaire absent) : un nouveau réalisé s’écrit', async () => {
    const id = await porte.saisirEvenement(realise(serie(SERIE_A), 'plantation'));
    const original = base.lireDirect<Readonly<Record<string, string | number | null>>>('SELECT * FROM evenement WHERE id = ?', [id])[0];
    if (original === undefined) throw new Error('réalisé absent');
    const colonnes = Object.keys(original);
    const recue = {
      ...original,
      id: '0192f0c1-13d0-7000-8000-0000000000a1',
      horodatage: '2026-10-01T09:00:00.000Z',
      remplace_sorte: 'annulation',
      remplace_evenement_id: '0192f0c1-13d0-7000-8000-0000000000a0',
      origine_id: id,
    };
    base.recevoir(
      `INSERT INTO evenement (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
      colonnes.map((c) => (recue as Readonly<Record<string, string | number | null>>)[c] ?? null),
    );
    await expect(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'chaîne annulée par le serveur').resolves.toBeTypeOf('string');
  });

  it('P9 : un réalisé d’une AUTRE ferme dans la même base (même série) n’empêche rien', async () => {
    await porteDe(AUTRE_FERME).saisirEvenement(realise(serie(SERIE_A), 'plantation'));
    await expect(porte.saisirEvenement(realise(serie(SERIE_A), 'plantation')), 'réalisé de notre ferme').resolves.toBeTypeOf('string');
  });
});

// ── Les autres types d'événement ne sont pas touchés ─────────────────────────────────────────

describe('T13i : les autres types d’événement ne sont pas touchés', () => {
  it('P10 : récolte, intervention libre et observation identiques s’écrivent deux fois', async () => {
    const recolte: SaisieEvenement = { ...commun(serie(SERIE_A)), type: 'recolte', detail: { quantite: 12, unite: 'kg', categorie: null } };
    const intervention: SaisieEvenement = {
      ...commun(serie(SERIE_A)),
      type: 'intervention',
      detail: { categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: null },
    };
    const observation: SaisieEvenement = { ...commun(serie(SERIE_A)), type: 'observation', detail: { nature: 'ravageur', gravite: 'faible' } };
    // Un réalisé de la série au journal : la vérification ne doit pas déborder sur les autres types.
    await porte.saisirEvenement(realise(serie(SERIE_A), 'plantation'));
    for (const s of [recolte, recolte, intervention, intervention, observation, observation]) {
      await expect(porte.saisirEvenement(s), `${s.type} écrit`).resolves.toBeTypeOf('string');
    }
    expect(nombreEvenements()).toBe(7);
  });
});
