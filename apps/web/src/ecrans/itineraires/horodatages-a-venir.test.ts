/**
 * Tests d'acceptation T13q — itinéraires : la correction la plus récente gagne, quel que soit le
 * format de son horodatage (docs/backlog/T13q-horodatages-suites.md).
 *
 * Constat (relecture T13n) : la règle « en vigueur » des séries à venir (`conditionAVenir`,
 * donnees.ts) choisissait la correction la plus récente par `MAX(horodatage || '|' || id)`, donc
 * par le texte. Les lignes reçues du serveur peuvent être horodatées autrement que `toISOString`
 * (`+00` au lieu de `Z`, espace au lieu de `T`, fractions absentes ou plus courtes) : le texte élit
 * alors parfois la plus ancienne.
 *
 * Banc : ferme des itinéraires (./test/ferme-itineraires.ts), séries à venir de « Batavia de la
 * ferme » = aVenir1 et aVenir2. Un « réalisé » d'origine sur aVenir1, corrigé deux fois : une
 * correction reste sur une série, l'autre passe sur l'autre série. Seule la plus récente est en
 * vigueur : la série qu'elle porte n'est plus à venir, l'autre l'est. La plus récente porte le plus
 * PETIT id (l'id ne peut pas la sauver) et chaque paire est essayée dans les deux sens (la plus
 * récente sur aVenir1, puis sur aVenir2).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { lireSeriesAVenir } from './donnees.ts';
import { AUJOURDHUI_TESTS, ecrireFermeItineraires, EMPLACEMENT, FERME, ITINERAIRE, SERIE, UTILISATEUR } from './test/ferme-itineraires.ts';

const JOUR = '2026-09-29';

/**
 * Paires (plus ancienne, plus récente) dont l'ordre du texte est l'inverse de l'ordre des
 * instants. `JJ` est remplacé par le jour.
 */
const PAIRES: readonly { readonly nom: string; readonly ancien: string; readonly recent: string }[] = [
  { nom: 'Z sans fractions contre +00 (Postgres) avec fractions', ancien: 'JJT10:00:00Z', recent: 'JJT10:00:00.1+00' },
  { nom: '+02 (Postgres) contre Z, une heure plus tard', ancien: 'JJT12:00:00+02', recent: 'JJT11:00:00Z' },
  { nom: '+0530 (Postgres) contre Z', ancien: 'JJT15:30:00.500+0530', recent: 'JJT10:00:01.000Z' },
  { nom: 'T contre espace (serveur)', ancien: 'JJT10:00:00.000Z', recent: 'JJ 10:00:05.000+00' },
  { nom: 'T contre espace, sans fuseau (UTC)', ancien: 'JJT10:00:00.000Z', recent: 'JJ 10:00:00.001' },
  { nom: 'fractions absentes contre présentes', ancien: 'JJT10:00:00Z', recent: 'JJT10:00:00.25Z' },
  { nom: 'fractions absentes (Z) contre microsecondes (Postgres)', ancien: 'JJT10:00:00Z', recent: 'JJ 10:00:00.123456+00' },
];

const ids = (n: number) => `0192f0c1-2424-7000-8000-0000000c${n.toString(16).padStart(4, '0')}`;
const ORIGINE = ids(0xa0);
/** `PETIT` < `GRAND`. */
const PETIT = ids(0xb1);
const GRAND = ids(0xb2);

let base: BaseMemoire;
let porte: PorteDonnees;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeItineraires(base, AUJOURDHUI_TESTS);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterEach(() => {
  base.fermer();
});

/** Une ligne du journal reçue par la synchro. */
function recevoir(id: string, serieId: string, horodatage: string, corrige: string | null): void {
  const ligne: Record<string, string | null> = {
    id,
    ferme_id: FERME,
    type: 'realise',
    date: JOUR,
    horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: serieId,
    campagne_id: null,
    emplacement_ids: JSON.stringify([serieId === SERIE.aVenir1 ? EMPLACEMENT.t1p05 : EMPLACEMENT.t1p06]),
    note: null,
    photos: '[]',
    remplace_sorte: corrige === null ? null : 'correction',
    remplace_evenement_id: corrige,
    detail: JSON.stringify({ etape: 'semis_pepiniere', quantiteReelle: null }),
    cree_le: `${JOUR}T11:00:00.000Z`,
    origine_id: ORIGINE,
  };
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

const aVenir = async (): Promise<string[]> =>
  (await lireSeriesAVenir(porte, FERME, ITINERAIRE.bataviaFerme, AUJOURDHUI_TESTS)).map((s) => s.id).filter((id) => id === SERIE.aVenir1 || id === SERIE.aVenir2);

describe('T13q : séries à venir d’un itinéraire, la correction d’instant le plus récent est en vigueur', () => {
  it('témoin : sans saisie, aVenir1 et aVenir2 sont à venir', async () => {
    expect(await aVenir()).toEqual([SERIE.aVenir1, SERIE.aVenir2]);
  });

  for (const p of PAIRES) {
    for (const [sens, serieRecente, serieAncienne] of [
      ['la plus récente sur aVenir2', SERIE.aVenir2, SERIE.aVenir1],
      ['la plus récente sur aVenir1', SERIE.aVenir1, SERIE.aVenir2],
    ] as const) {
      it(`${p.nom} (${sens})`, async () => {
        recevoir(ORIGINE, SERIE.aVenir1, `${JOUR}T08:00:00.000Z`, null);
        // La plus récente porte le plus PETIT id, et arrive la première.
        recevoir(PETIT, serieRecente, p.recent.replace('JJ', JOUR), ORIGINE);
        recevoir(GRAND, serieAncienne, p.ancien.replace('JJ', JOUR), ORIGINE);
        expect(await aVenir(), 'seule la série de la correction la plus récente n’est plus à venir').toEqual([serieAncienne]);
      });
    }
  }
});
