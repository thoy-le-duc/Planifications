/**
 * Test T13j, contre-relecture — un INSERT direct dans la table interne de PowerSync
 * (`ps_data__evenement`) ne contourne pas « déjà fait ».
 *
 * Constat : la porte ne contrôle que les ensembles dont un ordre nomme le journal par le mot
 * entier `evenement` (/\bevenement\b/i) ; dans `ps_data__evenement`, « _ » est un caractère de
 * mot, donc le nom n'est pas reconnu et l'ordre s'écrit sans contrôle.
 *
 * Banc : la base locale telle que PowerSync la range (./test/base-powersync.ts : table interne
 * `ps_data__evenement(id, data)` en JSON, vue `evenement`), vraie porte.
 *
 *   PS1 témoin : INSERT d'un réalisé déjà fait par la vue `evenement` → DejaFait, rien écrit ;
 *   PS2 même ligne, INSERT direct dans `ps_data__evenement` → DejaFait, rien écrit.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { creerPorte, DejaFait, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { DateCalendaire, Id } from '@planif/core';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';

const UTILISATEUR = '0192f0c1-13d4-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13d4-7000-8000-000000000002' as Id<'Ferme'>;
const SERIE = '0192f0c1-13d4-7000-8000-000000000020' as Id<'Serie'>;
const DOUBLON = '0192f0c1-13d4-7000-8000-0000000000e0';

const SCHEMA = SCHEMA_LOCAL.toJSON() as SchemaJson;

let base: BasePowerSync;
let porte: PorteDonnees;
let instant: number;

beforeEach(async () => {
  base = creerBasePowerSync(SCHEMA);
  instant = Date.parse('2026-10-01T06:00:00.000Z');
  porte = creerPorte(base, { utilisateurId: UTILISATEUR, fermeId: FERME, maintenant: () => new Date((instant += 1_000)) });
  await porte.saisirEvenement({
    type: 'realise',
    date: '2026-10-01' as DateCalendaire,
    source: 'agent',
    culture: { sorte: 'serie', serieId: SERIE },
    emplacementIds: [],
    note: null,
    photos: [],
    remplaceEvenement: null,
    detail: { etape: 'plantation', quantiteReelle: null },
  });
});

afterEach(() => {
  base.fermer();
});

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;

/** Le réalisé déjà écrit, recopié sous un autre id (colonnes de la vue, sans `id`). */
function doublon(): Readonly<Record<string, unknown>> {
  const ligne = base.lireDirect<Readonly<Record<string, unknown>>>('SELECT * FROM evenement')[0];
  if (ligne === undefined) throw new Error('banc : réalisé absent');
  const colonnes = Object.fromEntries(Object.entries(ligne).filter(([c]) => c !== 'id'));
  return { ...colonnes, horodatage: '2026-10-01T09:00:00.000Z' };
}

async function attendreDejaFait(p: Promise<unknown>, message: string): Promise<void> {
  let resultat: unknown;
  try {
    resultat = await p;
  } catch (e) {
    expect(e, `${message} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(DejaFait);
    return;
  }
  expect.fail(`${message} : rejet DejaFait attendu, l’écriture a réussi (rendu : ${String(resultat)})`);
}

it('PS1 (témoin) : INSERT brut d’un réalisé déjà fait par la vue evenement → DejaFait, rien n’est écrit', async () => {
  const d = doublon();
  const colonnes = Object.keys(d);
  const avant = nombreEvenements();
  await attendreDejaFait(
    porte.ecrire(`INSERT INTO evenement (id, ${colonnes.join(', ')}) VALUES (?, ${colonnes.map(() => '?').join(', ')})`, [DOUBLON, ...colonnes.map((c) => d[c])]),
    'INSERT par la vue',
  );
  expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
});

it('PS2 : INSERT direct dans ps_data__evenement d’un réalisé déjà fait → DejaFait, rien n’est écrit', async () => {
  const avant = nombreEvenements();
  await attendreDejaFait(porte.ecrire('INSERT INTO ps_data__evenement (id, data) VALUES (?, ?)', [DOUBLON, JSON.stringify(doublon())]), 'INSERT dans ps_data__evenement');
  expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
});
