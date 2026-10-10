/**
 * Tests d'acceptation T13q — fenêtre de l'historique d'Aujourd'hui : l'horodatage d'une saisie est
 * comparé à la borne comme un instant, jamais comme du texte (docs/backlog/T13q-horodatages-suites.md).
 *
 * Constat (relecture T13n) : la fenêtre de l'historique (saisies des 7 derniers jours, par la
 * date du journal OU par l'instant de saisie) compare l'horodatage à la borne
 * (`toISOString`, `2026-10-10T10:00:00.123Z`) en texte : `e.horodatage >= ?` dans `sqlRecents`
 * (lecture complète `lireJournee`, relecture de quelques cultures `lireCultures`) et
 * `dansLaFenetre` (relecture incrémentale `recalculerCultures`). Une ligne du serveur
 * `2026-10-10 10:00:00.123+00` (format de Postgres) sort alors de la fenêtre alors qu'elle y est ;
 * une ligne `2026-10-10T15:30:00.122+0530` y entre alors qu'elle en est sortie.
 *
 * Banc : ferme du jour au 2026-10-17, maintenant = 2026-10-17T10:00:00.123Z, donc borne de
 * l'instant de saisie = 2026-10-10T10:00:00.123Z (7 jours). Chaque cas reçoit UNE récolte de la
 * tomate, datée du 2026-09-01 (avant la borne de date : seule la borne d'instant compte), saisie
 * à la borne exacte (dans la fenêtre : la borne est incluse) ou une milliseconde avant (hors de
 * la fenêtre), dans un format donné.
 *   F1  `lireJournee` : la saisie dans la fenêtre est dans l'historique, l'autre non ;
 *   F2  `lireCultures` (relecture de la tomate) : même règle pour ses saisies récentes ;
 *   F3  `recalculerCultures` (journée lue plus tôt, saisie sur une autre culture) : la saisie
 *       dans la fenêtre y reste (pas de relecture complète), celle qui en est sortie la force
 *       (rend null).
 */
import { SCHEMA_LOCAL, creerPorte, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerEtat, calculerJournee, lireCultures, lireJournee, recalculerCultures } from './calculs.ts';
import { ecrireFermeDuJour, EMPLACEMENT, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-10-17';
const MAINTENANT = new Date('2026-10-17T10:00:00.123Z');
/** Date du journal de la saisie : avant la borne de date (2026-10-10), seul l'instant compte. */
const DATE_ANCIENNE = '2026-09-01';

/** Formats d'une saisie à la borne exacte (`dans`) et une milliseconde avant (`hors`). */
const CAS: readonly { readonly nom: string; readonly dans: string; readonly hors: string }[] = [
  { nom: 'Postgres, espace et +00', dans: '2026-10-10 10:00:00.123+00', hors: '2026-10-10 10:00:00.122+00' },
  { nom: 'T et +00', dans: '2026-10-10T10:00:00.123+00', hors: '2026-10-10T10:00:00.122+00' },
  { nom: 'Postgres, espace et +0530', dans: '2026-10-10 15:30:00.123+0530', hors: '2026-10-10 15:30:00.122+0530' },
  { nom: 'T et +0530', dans: '2026-10-10T15:30:00.123+0530', hors: '2026-10-10T15:30:00.122+0530' },
  { nom: 'T et -03', dans: '2026-10-10T07:00:00.123-03', hors: '2026-10-10T07:00:00.122-03' },
  { nom: '-12, la veille en heure locale', dans: '2026-10-09T22:00:00.123-12', hors: '2026-10-09T22:00:00.122-12' },
  { nom: 'sans fuseau (UTC), espace', dans: '2026-10-10 10:00:00.123', hors: '2026-10-10 10:00:00.122' },
  { nom: 'sans fuseau (UTC), T', dans: '2026-10-10T10:00:00.123', hors: '2026-10-10T10:00:00.122' },
  { nom: 'toISOString (témoin)', dans: '2026-10-10T10:00:00.123Z', hors: '2026-10-10T10:00:00.122Z' },
];

const SAISIE = '0192f0c1-13e3-7000-8000-0000000e00a1';

let base: BaseMemoire;
let porte: PorteDonnees;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterEach(() => {
  base.fermer();
});

/** Une récolte de la tomate reçue par la synchro, horodatée `horodatage`. */
function recevoir(horodatage: string): void {
  const ligne: Record<string, string | null> = {
    id: SAISIE,
    ferme_id: FERME,
    type: 'recolte',
    date: DATE_ANCIENNE,
    horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: SERIE.tomate,
    campagne_id: null,
    emplacement_ids: JSON.stringify([EMPLACEMENT.t2p07]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ quantite: 4, unite: 'kg', categorie: null }),
    cree_le: `${AUJOURDHUI}T09:00:00.000Z`,
    origine_id: SAISIE,
  };
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

const ATTENDUS = [
  ['dans', true],
  ['hors', false],
] as const;

describe('T13q, F1 : lireJournee, fenêtre de l’historique par l’instant de saisie', () => {
  for (const c of CAS) {
    for (const [ou, attendu] of ATTENDUS) {
      it(`${c.nom}, ${ou === 'dans' ? 'à la borne : dans l’historique' : 'une milliseconde avant : hors de l’historique'}`, async () => {
        recevoir(c[ou]);
        const j = calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
        expect(j.historique.some((h) => h.evenement.id === SAISIE)).toBe(attendu);
      });
    }
  }
});

describe('T13q, F2 : lireCultures, même fenêtre pour les saisies relues d’une culture', () => {
  for (const c of CAS) {
    for (const [ou, attendu] of ATTENDUS) {
      it(`${c.nom}, ${ou === 'dans' ? 'à la borne : relue' : 'une milliseconde avant : pas relue'}`, async () => {
        recevoir(c[ou]);
        // Contexte d'une lecture faite UNE HEURE plus tôt : la saisie y était bien dans la fenêtre.
        const { contexte } = await lireJournee(porte, FERME, AUJOURDHUI, new Date(MAINTENANT.getTime() - 3_600_000));
        const lues = await lireCultures(porte, contexte, { series: [SERIE.tomate], campagnes: [] }, false, MAINTENANT);
        expect(lues.recents.some((l) => l.id === SAISIE)).toBe(attendu);
      });
    }
  }
});

describe('T13q, F3 : recalculerCultures, la fenêtre glisse (relecture complète seulement si la saisie en sort)', () => {
  it('témoin : la tomate et la batavia sont des cultures de la journée', async () => {
    const etat = calculerEtat(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
    expect(etat.socle.cultures.has(SERIE.tomate)).toBe(true);
    expect(etat.socle.cultures.has(SERIE.batavia)).toBe(true);
  });

  for (const c of CAS) {
    for (const [ou, attendu] of ATTENDUS) {
      it(`${c.nom}, ${ou === 'dans' ? 'à la borne : recalcul sans relecture complète' : 'une milliseconde avant : relecture complète (null)'}`, async () => {
        recevoir(c[ou]);
        // Journée lue UNE HEURE plus tôt : la saisie était dans la fenêtre.
        const avant = new Date(MAINTENANT.getTime() - 3_600_000);
        const etat = calculerEtat(await lireJournee(porte, FERME, AUJOURDHUI, avant), AUJOURDHUI);
        expect(
          etat.journee.historique.some((h) => h.evenement.id === SAISIE),
          'une heure plus tôt, la saisie est dans l’historique',
        ).toBe(true);
        // Saisie sur une AUTRE culture, relue à `MAINTENANT`.
        const lues = await lireCultures(porte, etat.contexte, { series: [SERIE.batavia], campagnes: [] }, false, MAINTENANT);
        const recalcule = recalculerCultures(etat, lues);
        if (attendu) {
          expect(recalcule, 'saisie restée dans la fenêtre : pas de relecture complète').not.toBeNull();
          expect(recalcule?.journee.historique.some((h) => h.evenement.id === SAISIE)).toBe(true);
        } else {
          expect(recalcule, 'saisie sortie de la fenêtre : relecture complète').toBeNull();
        }
      });
    }
  }
});
