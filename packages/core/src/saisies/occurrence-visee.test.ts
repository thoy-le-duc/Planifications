/**
 * Tests d'acceptation T22b — `validerSaisie` accepte l'occurrence visée d'une intervention
 * (`detail.occurrenceVisee`, écrite par « Fait » sur une tâche de travail) : facultative, une
 * date 'AAAA-MM-JJ' existante, dans les mêmes bornes que la date de l'événement.
 *
 * Contrat : ../planification/test/contrat-travaux.ts, section « T22b » ; règles communes d'une
 * saisie : ./test/contrat.ts. Mêmes lignes d'exemple que ./saisies.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerSaisies, type CodeErreurSaisie, type ModuleSaisies, type ResultatSaisie } from './test/contrat.ts';

let m: ModuleSaisies;

beforeAll(async () => {
  m = await chargerSaisies();
});

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

type Detail = Record<string, unknown>;

/** Détail d'une intervention de chaque catégorie, tel que « Fait » l'écrit (T22). */
const INTERVENTIONS: Readonly<Record<string, Detail>> = {
  travail_sol: { categorie: 'travail_sol', type: 'grelinette', outil: 'grelinette' },
  couverture: { categorie: 'couverture', type: 'paillage', outil: null, dureeOccupationJours: null },
  fertilisation: { categorie: 'fertilisation', type: 'engrais', outil: null, produit: 'Orgamine', quantite: { valeur: 50, unite: 'kg' } },
  amendement: { categorie: 'amendement', type: 'compost', outil: null, produit: 'compost', quantite: { valeur: 3, unite: 'kg/m²' } },
  entretien: { categorie: 'entretien', type: 'désherbage', outil: null },
};

/** Ligne `evenement` telle que le téléphone l'envoie (format PowerSync). */
function ligne(type: string, detail: Detail): Record<string, unknown> {
  return {
    id: uuid(1),
    ferme_id: uuid(2),
    type,
    date: '2026-09-30',
    horodatage: '2026-09-30T07:12:00.000Z',
    auteur_id: uuid(3),
    source: 'tap',
    serie_id: uuid(4),
    campagne_id: null,
    emplacement_ids: JSON.stringify([uuid(6)]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify(detail),
  };
}

const intervention = (occurrenceVisee: unknown, categorie = 'entretien'): Record<string, unknown> =>
  ligne('intervention', { ...INTERVENTIONS[categorie], occurrenceVisee });

function valider(entree: unknown): ResultatSaisie {
  let r: ResultatSaisie | undefined;
  expect(() => (r = m.validerSaisie(entree)), 'validerSaisie ne lève jamais').not.toThrow();
  if (r === undefined) throw new Error('aucun résultat');
  return r;
}

/** Saisie acceptée : son détail tel que rendu. */
function accepte(entree: unknown): Detail {
  const r = valider(entree);
  expect(r.ok ? null : r.erreur, 'saisie acceptée').toBeNull();
  return r.ok ? (r.saisie.detail as unknown as Detail) : {};
}

function refuse(entree: unknown, code: CodeErreurSaisie, champ: string): void {
  const r = valider(entree);
  expect(r.ok, 'saisie refusée').toBe(false);
  if (r.ok) return;
  expect(r.erreur.code, `code reçu : ${r.erreur.code} (${r.erreur.message})`).toBe(code);
  expect(r.erreur.champ).toBe(champ);
  expect(r.erreur.message.trim().length).toBeGreaterThan(5);
  expect(r.erreur.message.length).toBeLessThanOrEqual(200);
}

describe('T22b : validerSaisie et detail.occurrenceVisee', () => {
  it.each(Object.keys(INTERVENTIONS))('intervention %s avec une occurrence visée : acceptée, gardée dans le détail', (categorie) => {
    const detail = accepte(intervention('2026-09-17', categorie));
    expect(detail.occurrenceVisee).toBe('2026-09-17');
    expect(detail.categorie).toBe(categorie);
  });

  it('l’exemple du ticket : désherbage fait le 30, carte du 17', () => {
    expect(accepte(intervention('2026-09-17'))).toStrictEqual({ categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: '2026-09-17' });
  });

  it('facultative : null ou absente, acceptée (saisie libre, anciennes saisies)', () => {
    expect(accepte(intervention(null)).occurrenceVisee ?? null).toBeNull();
    expect(accepte(ligne('intervention', INTERVENTIONS.entretien ?? {})).occurrenceVisee ?? null).toBeNull();
  });

  it('détail déjà en valeur (objet, pas texte JSON) : accepté aussi', () => {
    const l = { ...intervention(null), detail: { ...INTERVENTIONS.entretien, occurrenceVisee: '2026-09-17' } };
    expect(accepte(l).occurrenceVisee).toBe('2026-09-17');
  });

  it('occurrence visée après la date réelle (carte de la semaine touchée en avance) : acceptée', () => {
    expect(accepte(intervention('2026-10-02')).occurrenceVisee).toBe('2026-10-02');
  });

  it.each(['2000-01-01', '2100-12-31'])('borne comprise %s : acceptée', (date) => {
    expect(accepte(intervention(date)).occurrenceVisee).toBe(date);
  });

  it.each([
    ['2026-02-30', 'date impossible'],
    ['2026-13-01', 'mois impossible'],
    ['17/09/2026', 'format français'],
    ['2026-9-17', 'sans zéros'],
    ['2026-09-17T00:00:00Z', 'instant au lieu d’une date'],
    ['', 'texte vide'],
    [20260917, 'nombre'],
    [true, 'booléen'],
    [{ date: '2026-09-17' }, 'objet'],
    [['2026-09-17'], 'tableau'],
  ] as const)('%j (%s) : champ_invalide', (valeur: unknown, raison: string) => {
    expect(raison).not.toBe('');
    refuse(intervention(valeur), 'champ_invalide', 'detail.occurrenceVisee');
  });

  it.each(['1999-12-31', '2101-01-01', '0001-01-01', '9999-12-31'])('%s : hors_bornes, comme la date de l’événement', (date) => {
    refuse(intervention(date), 'hors_bornes', 'detail.occurrenceVisee');
  });

  it.each([
    ['recolte', { quantite: 12.5, unite: 'kg', categorie: null }],
    ['realise', { etape: 'plantation', quantiteReelle: null }],
    ['observation', { nature: 'ravageur', gravite: 'forte' }],
  ])('%s : pas d’occurrence visée hors d’une intervention (cle_inconnue)', (type, detail) => {
    refuse(ligne(type, { ...detail, occurrenceVisee: '2026-09-17' }), 'cle_inconnue', 'detail.occurrenceVisee');
  });

  it('une annulation reprend le détail avec son occurrence visée : acceptée', () => {
    const l = { ...intervention('2026-09-17'), id: uuid(10), remplace_sorte: 'annulation', remplace_evenement_id: uuid(1) };
    expect(accepte(l).occurrenceVisee).toBe('2026-09-17');
  });
});
