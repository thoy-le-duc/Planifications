// @vitest-environment happy-dom
/**
 * T13s : la table `modification` se trie par l'instant de l'horodatage, jamais comme du texte,
 * à chaque endroit qui la lit (historique de la série, entrées des occupations, historiques des
 * pages de diagnostic « Itinéraires » et « Plan de série »). Ordre canonique (instant, id), le
 * même que `cleHorodatageSql` / `comparerSaisies` (T13n).
 *
 * Les horodatages mêlent les formes de Postgres (`+00`, `+00:00`, espace) et du navigateur
 * (`Z`, `T`, fractions) de sorte que l'ordre du texte soit l'inverse de l'ordre des instants.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../packages/sync/src/test/base-memoire.ts';
import { lireModificationsOccupations, requeteHistorique } from '../ecrans/serie/donnees.ts';
import { ecrireFermeSerie, ESPECE, FERME, ITINERAIRE, OCCUPATION_LAITUE, SERIE_LAITUE, UTILISATEUR } from '../ecrans/serie/test/ferme-serie.ts';
import { brancherSectionItineraires } from './itineraires.ts';
import { brancherSectionPlanSerie } from './plan-serie.ts';

/** Dans l'ordre des instants (la colonne `operation` sert d'étiquette). */
const MODIFICATIONS = [
  { etiquette: 'e1', horodatage: '2026-10-01T10:00:00Z', id: 'm-1' },
  { etiquette: 'e2', horodatage: '2026-10-01T10:00:00.250Z', id: 'm-2' },
  { etiquette: 'e3', horodatage: '2026-10-01 10:00:00.5+00', id: 'm-3' },
  { etiquette: 'e4', horodatage: '2026-10-01 11:00:00+00:00', id: 'm-4' },
  // Même instant, formes différentes : l'id départage (a avant b), pas le texte.
  { etiquette: 'e5', horodatage: '2026-10-01T12:00:00.000Z', id: 'm-a' },
  { etiquette: 'e6', horodatage: '2026-10-01 12:00:00+00', id: 'm-b' },
] as const;
const ATTENDU = MODIFICATIONS.map((m) => m.etiquette);

const bases: BaseMemoire[] = [];
afterEach(() => {
  for (const b of bases.splice(0)) b.fermer();
  document.body.replaceChildren();
});

interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
}

async function banc(nomTable: string, ligneId: string): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  bases.push(base);
  await ecrireFermeSerie(base);
  // Insérées dans l'ordre inverse : ni l'ordre d'insertion ni celui du texte ne donnent le bon.
  for (const m of [...MODIFICATIONS].reverse()) {
    base.recevoir(
      `INSERT INTO modification (id, ferme_id, nom_table, ligne_id, auteur_id, horodatage, operation, avant, apres, proposition_id, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '{}', NULL, ?, ?, NULL)`,
      [m.id, FERME, nomTable, ligneId, UTILISATEUR, m.horodatage, m.etiquette, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'],
    );
  }
  const porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => new Date('2026-10-02T08:00:00.000Z') });
  return { base, porte };
}

const attendre = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
};

/** Pose le corps de la vraie page de diagnostic (les éléments qu'attendent les sections). */
function poserPage(): void {
  const html = readFileSync(resolve(import.meta.dirname, '../../diagnostic/synchro.html'), 'utf8');
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, '') ?? '';
}

describe('T13s : ordre des modifications par l’instant', () => {
  it('historique de la série (requeteHistorique) : le plus récent d’abord, (instant, id) décroissant', async () => {
    const { base } = await banc('Serie', SERIE_LAITUE);
    const r = requeteHistorique(SERIE_LAITUE);
    const lignes = await base.getAll<{ operation: string }>(r.sql, r.parametres);
    expect(lignes.map((l) => l.operation)).toEqual([...ATTENDU].reverse());
  });

  it('entrées des occupations (lireModificationsOccupations) : le plus ancien d’abord, (instant, id)', async () => {
    const { porte } = await banc('Occupation', OCCUPATION_LAITUE);
    const modifications = await lireModificationsOccupations(porte, SERIE_LAITUE);
    expect(modifications.map((m) => m.operation)).toEqual(ATTENDU.map(() => 'modification'));
    expect(modifications.map((m) => m.horodatage)).toEqual(MODIFICATIONS.map((m) => m.horodatage));
  });

  it('diagnostic « Itinéraires » : historique en (instant, id)', async () => {
    const { porte } = await banc('Itineraire', ITINERAIRE.bataviaPrintemps);
    poserPage();
    const arret = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-testid="historique-itineraire"]')].map((e) => e.dataset.operation ?? '');
    brancherSectionItineraires({ porte, fermeId: FERME, especeId: ESPECE.batavia, afficherErreur: () => undefined });
    await attendre(() => arret().length === ATTENDU.length);
    expect(arret()).toEqual(ATTENDU);
  });

  it('diagnostic « Plan de série » : historique en (instant, id)', async () => {
    const { porte } = await banc('Serie', SERIE_LAITUE);
    poserPage();
    const arret = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-testid="historique"]')].map((e) => e.dataset.operation ?? '');
    brancherSectionPlanSerie({
      porte,
      fermeId: FERME,
      itineraireId: ITINERAIRE.bataviaPrintemps,
      saisonId: '',
      planches: [],
      afficherErreur: () => undefined,
    });
    await attendre(() => arret().length === ATTENDU.length);
    expect(arret()).toEqual(ATTENDU);
  });
});
