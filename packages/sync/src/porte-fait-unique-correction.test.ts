/**
 * Tests d'acceptation T13o — un « Fait » et sa correction écrits dans la même transaction.
 *
 * Constat (relecture T13j) : le contrôle « déjà fait » d'après écriture compte la correction en
 * vigueur, écrite par la même transaction, comme un autre « Fait » identique : refus à tort.
 * Contrat attendu : un « Fait » n'est pas un doublon de sa propre correction ; deux « Fait »
 * identiques restent refusés, même quand la transaction corrige l'un d'eux.
 *
 * Banc : base mémoire node:sqlite (sans ps_crud), vraie porte. Le même cas tourne sur le double
 * fidèle PowerSync avec ps_crud : apps/web/src/ecrans/aujourdhui/fait-unique-ps-crud.test.ts (K1–K3).
 *
 *   K1  plantation + sa correction de date (ecrireEnsemble, vérification rendue) → écrits ; la
 *       plantation reste faite ensuite ;
 *   K2  intervention qui solde un travail + sa correction de date → écrites ;
 *   K3  témoin : plantation déjà faite, nouvelle plantation + sa correction → DejaFait, rien écrit ;
 *   K4  témoin : deux plantations identiques + la correction de l'une → DejaFait, rien écrit.
 */
import type { DateCalendaire, Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DejaFait } from './fait-unique.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees, SaisieEvenement, VerificationEcriture } from './types.ts';

const UTILISATEUR = '0192f0c1-13e1-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13e1-7000-8000-000000000002' as Id<'Ferme'>;
const SERIE = '0192f0c1-13e1-7000-8000-000000000020' as Id<'Serie'>;
const AUJOURDHUI = '2026-10-01' as DateCalendaire;
const HIER = '2026-09-30' as DateCalendaire;
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

const commun = {
  date: AUJOURDHUI,
  source: 'agent' as const,
  culture: { sorte: 'serie' as const, serieId: SERIE },
  emplacementIds: [],
  note: null,
  photos: [],
  remplaceEvenement: null,
};
const plantation: SaisieEvenement = { ...commun, type: 'realise', detail: { etape: 'plantation', quantiteReelle: null } };
const desherbage: SaisieEvenement = { ...commun, type: 'intervention', detail: { categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: OCCURRENCE } };
const correction = (s: SaisieEvenement, evenementId: Id<'Evenement'>): SaisieEvenement => ({ ...s, date: HIER, remplaceEvenement: { sorte: 'correction', evenementId } });

const VERIFICATEUR_VIDE: VerificationEcriture = () => Promise.resolve();
const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;

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

describe('T13o : un « Fait » et sa correction écrits dans la même transaction', () => {
  it('K1 : plantation + sa correction de date (vérification rendue) → écrites ; la plantation reste faite', async () => {
    const p = porte.preparerSaisie(plantation);
    const c = porte.preparerSaisie(correction(plantation, p.id));
    await expect(porte.ecrireEnsemble([p.ordre, c.ordre], p.verification), 'Fait + correction').resolves.toBeUndefined();
    expect(nombreEvenements()).toBe(2);
    await attendreDejaFait(porte.saisirEvenement(plantation), 'plantation ressaisie ensuite');
  });

  it('K2 : intervention qui solde un travail + sa correction de date → écrites ; le travail reste soldé', async () => {
    const p = porte.preparerSaisie(desherbage);
    const c = porte.preparerSaisie(correction(desherbage, p.id));
    await expect(porte.ecrireEnsemble([p.ordre, c.ordre], p.verification), 'Fait + correction').resolves.toBeUndefined();
    expect(nombreEvenements()).toBe(2);
    await attendreDejaFait(porte.saisirEvenement(desherbage), 'travail ressoldé ensuite');
  });

  it('K3 (témoin) : plantation déjà faite ; nouvelle plantation + sa correction → DejaFait, rien n’est écrit', async () => {
    await porte.saisirEvenement(plantation);
    const p = porte.preparerSaisie(plantation);
    const c = porte.preparerSaisie(correction(plantation, p.id));
    await attendreDejaFait(porte.ecrireEnsemble([p.ordre, c.ordre], VERIFICATEUR_VIDE), 'doublon + correction');
    expect(nombreEvenements()).toBe(1);
  });

  it('K4 (témoin) : deux plantations identiques + la correction de l’une, même transaction → DejaFait, rien n’est écrit', async () => {
    const p1 = porte.preparerSaisie(plantation);
    const p2 = porte.preparerSaisie(plantation);
    const c = porte.preparerSaisie(correction(plantation, p1.id));
    await attendreDejaFait(porte.ecrireEnsemble([p1.ordre, p2.ordre, c.ordre], VERIFICATEUR_VIDE), 'deux Fait + correction');
    expect(nombreEvenements()).toBe(0);
  });
});
