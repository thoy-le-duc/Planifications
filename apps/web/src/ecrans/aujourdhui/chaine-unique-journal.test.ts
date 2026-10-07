/**
 * Tests d'acceptation T13m, P3 — `evenementDuJournal` (ecritures.ts) lit une ligne du journal
 * comme l'écran (`evenementLu` / `detailLu` de calculs.ts), pas en moins strict.
 *
 * Chemin observé : « Annuler » d'une saisie X corrigée depuis par C (reçue de la synchro) :
 * `annulerSaisie` relit C, la ligne en vigueur, par `evenementDuJournal`. Une ligne que l'écran
 * écarte (detailLu → null : étape inconnue, catégorie inconnue, libellé vide ou blanc) n'est pas
 * une saisie en vigueur à ses yeux : refus SaisiePlusEnVigueur, rien d'écrit (aujourd'hui : la
 * ligne passe telle quelle et c'est la validation du serveur qui la refuse, SaisieRefusee). Une
 * unité de récolte inconnue est ramenée à « kg », comme à l'écran (`unite` de calculs.ts) :
 * l'annulation s'écrit, avec l'unité normalisée.
 *
 * Banc : ferme du jour (base mémoire, vraie porte), aujourd'hui = 2026-09-30.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { EvenementLu } from './calculs.ts';
import { annulerSaisie, SaisiePlusEnVigueur, type ContexteEcriture } from './ecritures.ts';
import { ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';
const X = '0192f0c1-13de-7000-8000-0000000000a0';
const C = '0192f0c1-13de-7000-8000-0000000000a1';

let base: BaseMemoire;
let ctx: ContexteEcriture;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  const porte: PorteDonnees = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  ctx = { porte, fermeId: FERME, aujourdhui: AUJOURDHUI };
});

afterEach(() => {
  base.fermer();
});

/** Ligne reçue de la synchro (X : l'original ; C : sa correction, plus récente). */
function recevoir(id: string, type: string, detail: unknown, remplace: string | null): void {
  const l: Readonly<Record<string, string | null>> = {
    id,
    ferme_id: FERME,
    type,
    date: AUJOURDHUI,
    horodatage: remplace === null ? `${AUJOURDHUI}T06:00:00.000Z` : `${AUJOURDHUI}T07:00:00.000Z`,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: SERIE.batavia,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: remplace === null ? null : 'correction',
    remplace_evenement_id: remplace,
    detail: JSON.stringify(detail),
    cree_le: `${AUJOURDHUI}T07:00:01.000Z`,
    origine_id: X,
  };
  const c = Object.keys(l);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => l[k] ?? null));
}

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;
const annulationDe = (id: string) =>
  base.lireDirect<{ type: string; detail: string }>("SELECT type, detail FROM evenement WHERE remplace_sorte = 'annulation' AND remplace_evenement_id = ?", [id]);

/** X tel que l'écran le garde au bandeau (avant la correction C). */
function lu(detail: EvenementLu['detail']): EvenementLu {
  return {
    id: X,
    date: AUJOURDHUI,
    horodatage: `${AUJOURDHUI}T06:00:00.000Z`,
    serieId: SERIE.batavia,
    campagneId: null,
    remplaceSorte: null,
    remplaceEvenementId: null,
    detail,
  };
}

const REALISE: EvenementLu['detail'] = { type: 'realise', etape: 'plantation', quantiteReelle: null };
const INTERVENTION: EvenementLu['detail'] = { type: 'intervention', categorie: 'entretien', libelle: 'désherbage' };
const DETAIL_INTERVENTION = { type: 'désherbage', categorie: 'entretien', outil: null, occurrenceVisee: AUJOURDHUI };

describe('T13m, P3 : evenementDuJournal lit la ligne comme l’écran (evenementLu / detailLu)', () => {
  it('témoin : C valide → l’annulation de C s’écrit', async () => {
    recevoir(X, 'realise', { etape: 'plantation', quantiteReelle: null }, null);
    recevoir(C, 'realise', { etape: 'semis_direct', quantiteReelle: null }, X);
    await expect(annulerSaisie(ctx, lu(REALISE))).resolves.toBeTypeOf('string');
    expect(annulationDe(C)).toHaveLength(1);
  });

  it.each([
    ['réalisé, étape inconnue', 'realise', { etape: 'repiquage', quantiteReelle: null }, REALISE, { etape: 'plantation', quantiteReelle: null }],
    ['intervention, catégorie inconnue', 'intervention', { ...DETAIL_INTERVENTION, categorie: 'binage' }, INTERVENTION, DETAIL_INTERVENTION],
    ['intervention, libellé vide', 'intervention', { ...DETAIL_INTERVENTION, type: '' }, INTERVENTION, DETAIL_INTERVENTION],
    ['intervention, libellé blanc', 'intervention', { ...DETAIL_INTERVENTION, type: '   ' }, INTERVENTION, DETAIL_INTERVENTION],
  ] as const)('%s : C écartée comme à l’écran → SaisiePlusEnVigueur, rien d’écrit', async (_cas, type, detailC, detailX, brutX) => {
    recevoir(X, type, brutX, null);
    recevoir(C, type, detailC, X);
    const avant = nombreEvenements();
    await expect(annulerSaisie(ctx, lu(detailX))).rejects.toBeInstanceOf(SaisiePlusEnVigueur);
    expect(nombreEvenements(), 'rien d’écrit').toBe(avant);
  });

  it('récolte, unité inconnue : ramenée à « kg » comme à l’écran → l’annulation s’écrit en kg', async () => {
    recevoir(X, 'recolte', { quantite: 3, unite: 'kg', categorie: null }, null);
    recevoir(C, 'recolte', { quantite: 3, unite: 'tonne', categorie: null }, X);
    await expect(annulerSaisie(ctx, lu({ type: 'recolte', quantite: 3, unite: 'kg', categorie: null }))).resolves.toBeTypeOf('string');
    const a = annulationDe(C);
    expect(a).toHaveLength(1);
    expect((JSON.parse(a[0]?.detail ?? 'null') as { unite?: unknown }).unite).toBe('kg');
  });
});
