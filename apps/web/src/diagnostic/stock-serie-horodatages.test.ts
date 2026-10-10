// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13q — diagnostic « Récolte d'une série » : même ordre des saisies que le
 * reste de l'appli, quel que soit le format de l'horodatage (docs/backlog/T13q-horodatages-suites.md).
 *
 * Constat (relecture T13n) : `stock-serie.ts` rangeait les récoltes par le texte de l'horodatage
 * (`ORDER BY r.horodatage DESC` pour « la dernière récolte » à annuler, `ORDER BY horodatage` pour
 * la liste). Une ligne reçue du serveur (`+00` au lieu de `Z`, espace au lieu de `T`, fractions
 * absentes ou plus courtes) passait alors avant ou après sa place. Ordre attendu : l'ordre
 * canonique (instant, puis id) de `comparerSaisies` / `cleHorodatageSql`.
 *
 * Banc : deux récoltes de la même série, reçues par la synchro, chacune avec son mouvement de
 * stock. La plus récente porte le plus PETIT id (l'id ne peut pas la sauver) et arrive la
 * première.
 *   - la liste « Événements de la série » montre l'ancienne puis la récente ;
 *   - « Annuler la dernière récolte » annule la récente : annulation qui la remplace, mouvement
 *     inverse de sa quantité.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../packages/sync/src/test/base-memoire.ts';
import { brancherSectionSerie } from './stock-serie.ts';

const JOUR = '2026-10-09';

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

const id = (n: number) => `0192f0c1-13e3-7000-8000-0000000d${n.toString(16).padStart(4, '0')}`;
const FERME = id(0x2);
const UTILISATEUR = id(0x1);
const SERIE = id(0x10);
const ARTICLE = id(0x20);
/** `PETIT` < `GRAND`. */
const PETIT = id(0xb1);
const GRAND = id(0xb2);

const HTML = `<section id="section-serie" hidden>
  <form id="saisie-serie"><input id="quantite-serie" type="number" /><button type="submit">Enregistrer</button></form>
  <button id="annuler-serie" type="button">Annuler la dernière récolte de la série</button>
  <ul id="evenements-serie"></ul>
  <ul id="mouvements"></ul>
  <ul id="stocks"></ul>
</section>`;

let base: BaseMemoire;
let porte: PorteDonnees;

beforeEach(() => {
  document.body.innerHTML = HTML;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterEach(() => {
  base.fermer();
  document.body.innerHTML = '';
});

/** Une récolte reçue par la synchro, et son mouvement de stock. */
function recevoirRecolte(idRecolte: string, idMouvement: string, horodatage: string, quantite: number): void {
  const ligne: Record<string, string | null> = {
    id: idRecolte,
    ferme_id: FERME,
    type: 'recolte',
    date: JOUR,
    horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: SERIE,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ quantite, unite: 'kg', categorie: null }),
    cree_le: `${JOUR}T11:00:00.000Z`,
    origine_id: idRecolte,
  };
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
  base.recevoir(
    "INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif, recolte_id) VALUES (?, ?, ?, ?, ?, 'recolte', ?)",
    [idMouvement, FERME, ARTICLE, JOUR, quantite, idRecolte],
  );
}

function brancher(): void {
  brancherSectionSerie({
    porte,
    fermeId: FERME,
    serieId: SERIE,
    auteurId: UTILISATEUR,
    aujourdhui: () => JOUR,
    afficherErreur: (message) => {
      throw new Error(message);
    },
  });
}

/** Ids de la liste « Événements de la série », dans l'ordre affiché. */
const liste = (): string[] => [...document.querySelectorAll<HTMLLIElement>('#evenements-serie li')].map((li) => li.dataset.id ?? '');

interface Annulation {
  readonly id: string;
  readonly remplace_evenement_id: string;
}

describe('T13q : diagnostic stock-série, ordre canonique (instant, id) quel que soit le format', () => {
  for (const p of PAIRES) {
    const deuxRecoltes = (): void => {
      // La plus récente porte le plus PETIT id, et arrive la première.
      recevoirRecolte(PETIT, id(0xc1), p.recent.replace('JJ', JOUR), 3);
      recevoirRecolte(GRAND, id(0xc2), p.ancien.replace('JJ', JOUR), 2);
      brancher();
    };

    it(`liste des événements : ${p.nom}`, async () => {
      deuxRecoltes();
      await vi.waitFor(() => {
        expect(liste().length).toBe(2);
      });
      expect(liste(), 'liste : l’ancienne, puis la récente').toEqual([GRAND, PETIT]);
    });

    it(`annuler la dernière récolte : ${p.nom}`, async () => {
      deuxRecoltes();
      document.querySelector<HTMLButtonElement>('#annuler-serie')?.click();
      const annulations = await vi.waitFor(() => {
        const a = base.lireDirect<Annulation>("SELECT id, remplace_evenement_id FROM evenement WHERE remplace_sorte = 'annulation'");
        expect(a.length).toBe(1);
        return a;
      });
      expect(annulations.map((a) => a.remplace_evenement_id), 'la dernière récolte annulée est la plus récente').toEqual([PETIT]);
      const inverses = base.lireDirect<{ quantite: number }>('SELECT quantite FROM mouvement_stock WHERE recolte_id = ?', [annulations[0]?.id ?? '']);
      expect(
        inverses.map((m) => m.quantite),
        'mouvement inverse : la quantité de la plus récente',
      ).toEqual([-3]);
    });
  }
});
