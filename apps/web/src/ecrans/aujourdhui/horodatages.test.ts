/**
 * Tests d'acceptation T13n — horodatages comparés comme des dates (écran Aujourd'hui).
 *
 * Constat (relecture T13l) : les lignes locales sont horodatées par `toISOString`, celles reçues
 * du serveur peuvent l'être autrement (espace au lieu de `T`, fractions de seconde absentes ou
 * plus courtes, `+00:00` au lieu de `Z`). Chaque endroit qui choisit « la plus récente » compare
 * aujourd'hui du texte. Contrat : la plus récente (instant, puis id le plus grand) gagne partout,
 * quel que soit le format ; à instant égal écrit dans deux formats, l'id départage, quel que soit
 * l'ordre des lignes. Côté synchro (`chaineDe`, « déjà fait » de la porte) :
 * packages/sync/src/horodatages.test.ts.
 *
 *   W1  `enVigueur` (historique de l'écran, règle en JavaScript) : la correction d'instant le plus
 *       récent est en vigueur, pour chaque paire de formats et chaque ordre des lignes ;
 *   W2  `enVigueur` : même instant dans deux formats → l'id le plus grand, de façon stable ;
 *   W3  journée lue dans la base (`lireJournee` : CHAINES, EN_VIGUEUR) : l'historique montre la
 *       correction d'instant le plus récent d'une récolte, pas l'autre, et la dernière récolte de
 *       la culture est la sienne ;
 *   W4  journée : deux récoltes du même jour (chaînes distinctes) → l'historique met la saisie
 *       d'instant le plus récent en tête, et la dernière récolte est la sienne ;
 *   W5  journée : deux récoltes du même jour, même instant dans deux formats → l'id le plus grand
 *       en tête et en dernière récolte ;
 *   W6  écritures (`changerDate`, `annulerSaisie`, garde « encore en vigueur ») : changer la date
 *       de la correction d'instant le plus récent est accepté, celle de l'autre refusé ; annuler la
 *       chaîne vise la correction d'instant le plus récent.
 */
import { SCHEMA_LOCAL, creerPorte, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerJournee, COLONNES_DETAIL, enVigueur, evenementLu, lireJournee, type EvenementLu, type Journee, type LigneJournal, type MaillonChaine } from './calculs.ts';
import { annulerSaisie, changerDate, SaisiePlusEnVigueur, type ContexteEcriture } from './ecritures.ts';
import { ecrireFermeDuJour, EMPLACEMENT, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

/**
 * Paires (plus ancienne, plus récente) dont l'ordre du texte est l'inverse de l'ordre des
 * instants : comparer le texte élit la plus ancienne. Le jour est remplacé par celui du test.
 */
const PAIRES: readonly { readonly nom: string; readonly ancien: string; readonly recent: string }[] = [
  { nom: 'préfixe : fractions absentes contre présentes', ancien: 'JJT10:00:00Z', recent: 'JJT10:00:00.5Z' },
  { nom: 'fractions absentes contre millisecondes', ancien: 'JJT10:00:00Z', recent: 'JJT10:00:00.001Z' },
  { nom: 'séparateur espace contre T', ancien: 'JJT10:00:00.000Z', recent: 'JJ 10:00:05.000Z' },
  { nom: '+00:00 et espace (serveur) contre toISOString', ancien: 'JJT10:00:00.400Z', recent: 'JJ 10:00:00.5+00:00' },
  { nom: 'Z sans fractions contre +00:00 avec fractions', ancien: 'JJT10:00:00Z', recent: 'JJT10:00:00.250+00:00' },
];

/** Le même instant, écrit de plusieurs façons. */
const MEME_INSTANT = ['JJT10:00:00Z', 'JJT10:00:00.000Z', 'JJT10:00:00+00:00', 'JJ 10:00:00+00:00', 'JJ 10:00:00.000Z'] as const;
const PAIRES_MEME_INSTANT = MEME_INSTANT.flatMap((a) => MEME_INSTANT.filter((b) => b !== a).map((b) => [a, b] as const));

const le = (jour: string, h: string): string => h.replace('JJ', jour);

/** Ids : `PETIT` < `GRAND`. */
const ORIGINE = '0192f0c1-13e3-7000-8000-0000000000a0';
const PETIT = '0192f0c1-13e3-7000-8000-0000000000b1';
const GRAND = '0192f0c1-13e3-7000-8000-0000000000b2';

const deuxOrdres = <T>(a: T, b: T): readonly (readonly T[])[] => [
  [a, b],
  [b, a],
];

// ── W1, W2 : enVigueur ───────────────────────────────────────────────────────────────────────

const JOUR_PUR = '2026-10-01';
const origine: MaillonChaine = { id: ORIGINE, horodatage: `${JOUR_PUR}T08:00:00.000Z`, remplaceSorte: null, remplaceEvenementId: null };
const correction = (id: string, horodatage: string): MaillonChaine => ({ id, horodatage, remplaceSorte: 'correction', remplaceEvenementId: ORIGINE });
const gagnante = (chaine: readonly MaillonChaine[]): string[] => enVigueur(chaine).map((e) => e.id);

describe('T13n, W1 : enVigueur élit la correction d’instant le plus récent, quel que soit le format', () => {
  it('pour chaque paire de formats et chaque ordre des lignes', () => {
    const obtenu: Record<string, string[]> = {};
    const attendu: Record<string, string[]> = {};
    for (const p of PAIRES) {
      // La plus récente porte le plus PETIT id : l'id ne peut pas la sauver.
      const ancienne = correction(GRAND, le(JOUR_PUR, p.ancien));
      const recente = correction(PETIT, le(JOUR_PUR, p.recent));
      for (const [i, ordre] of deuxOrdres(ancienne, recente).entries()) {
        const cle = `${p.nom} (ordre ${String(i + 1)})`;
        obtenu[cle] = gagnante([origine, ...ordre]);
        attendu[cle] = [PETIT];
      }
    }
    expect(obtenu).toEqual(attendu);
  });
});

describe('T13n, W2 : enVigueur, même instant dans deux formats → l’id le plus grand, de façon stable', () => {
  it('pour chaque paire de formats du même instant et chaque ordre des lignes', () => {
    const obtenu: Record<string, string[]> = {};
    const attendu: Record<string, string[]> = {};
    for (const [fPetit, fGrand] of PAIRES_MEME_INSTANT) {
      const petit = correction(PETIT, le(JOUR_PUR, fPetit));
      const grand = correction(GRAND, le(JOUR_PUR, fGrand));
      for (const [i, ordre] of deuxOrdres(petit, grand).entries()) {
        const cle = `petit ${fPetit} / grand ${fGrand} (ordre ${String(i + 1)})`;
        obtenu[cle] = gagnante([origine, ...ordre]);
        attendu[cle] = [GRAND];
      }
    }
    expect(obtenu).toEqual(attendu);
  });
});

// ── W3 à W6 : la base du téléphone (ferme du jour) ───────────────────────────────────────────

const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T12:00:00.000Z');

let base: BaseMemoire;
let porte: PorteDonnees;
let ctx: ContexteEcriture;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  ctx = { porte, fermeId: FERME, aujourdhui: AUJOURDHUI };
});

afterEach(() => {
  base.fermer();
});

interface Recue {
  readonly id: string;
  readonly type: 'recolte' | 'realise';
  readonly serieId: string;
  readonly horodatage: string;
  readonly detail: unknown;
  /** Ligne remplacée (correction), sinon une origine. */
  readonly corrige?: string;
  /** Origine de la chaîne (`origine_id` posé par le serveur). */
  readonly origine: string;
}

/** Une ligne du journal reçue par la synchro (format d'horodatage du serveur). */
function recevoir(l: Recue): void {
  const ligne: Record<string, string | null> = {
    id: l.id,
    ferme_id: FERME,
    type: l.type,
    date: AUJOURDHUI,
    horodatage: l.horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: l.serieId,
    campagne_id: null,
    emplacement_ids: JSON.stringify([l.serieId === SERIE.tomate ? EMPLACEMENT.t2p07 : EMPLACEMENT.t2p01]),
    note: null,
    photos: '[]',
    remplace_sorte: l.corrige === undefined ? null : 'correction',
    remplace_evenement_id: l.corrige ?? null,
    detail: JSON.stringify(l.detail),
    cree_le: `${AUJOURDHUI}T11:00:00.000Z`,
    origine_id: l.origine,
  };
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

const recolte = (quantite: number) => ({ quantite, unite: 'kg', categorie: null });

async function journee(): Promise<Journee> {
  return calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
}

/** Ids de l'historique, dans l'ordre, restreints à `ids`. */
const historiqueDe = (j: Journee, ids: readonly string[]): string[] => j.historique.map((h) => h.evenement.id).filter((id) => ids.includes(id));

describe('T13n, W3 : journée, la correction d’instant le plus récent est en vigueur (CHAINES, EN_VIGUEUR)', () => {
  for (const p of PAIRES) {
    it(p.nom, async () => {
      recevoir({ id: ORIGINE, type: 'recolte', serieId: SERIE.tomate, horodatage: `${AUJOURDHUI}T08:00:00.000Z`, detail: recolte(1), origine: ORIGINE });
      // La plus récente porte le plus PETIT id, et arrive la première.
      recevoir({ id: PETIT, type: 'recolte', serieId: SERIE.tomate, horodatage: le(AUJOURDHUI, p.recent), detail: recolte(3), corrige: ORIGINE, origine: ORIGINE });
      recevoir({ id: GRAND, type: 'recolte', serieId: SERIE.tomate, horodatage: le(AUJOURDHUI, p.ancien), detail: recolte(2), corrige: ORIGINE, origine: ORIGINE });
      const j = await journee();
      expect(historiqueDe(j, [ORIGINE, PETIT, GRAND]), 'seule la correction la plus récente est en vigueur').toEqual([PETIT]);
      expect(j.dernieresRecoltes.get(SERIE.tomate)?.quantite, 'dernière récolte : celle de la correction la plus récente').toBe(3);
    });
  }
});

describe('T13n, W4 : journée, deux récoltes du même jour → la saisie d’instant le plus récent en tête et en dernière récolte', () => {
  for (const p of PAIRES) {
    it(p.nom, async () => {
      recevoir({ id: GRAND, type: 'recolte', serieId: SERIE.tomate, horodatage: le(AUJOURDHUI, p.ancien), detail: recolte(2), origine: GRAND });
      recevoir({ id: PETIT, type: 'recolte', serieId: SERIE.tomate, horodatage: le(AUJOURDHUI, p.recent), detail: recolte(3), origine: PETIT });
      const j = await journee();
      expect(historiqueDe(j, [PETIT, GRAND]), 'la plus récente d’abord').toEqual([PETIT, GRAND]);
      expect(j.dernieresRecoltes.get(SERIE.tomate)?.quantite, 'dernière récolte : la saisie la plus récente').toBe(3);
    });
  }
});

describe('T13n, W5 : journée, deux récoltes du même jour au même instant (deux formats) → l’id le plus grand', () => {
  it('pour chaque paire de formats du même instant et chaque ordre d’arrivée', async () => {
    const obtenu: Record<string, unknown> = {};
    const attendu: Record<string, unknown> = {};
    for (const [fPetit, fGrand] of PAIRES_MEME_INSTANT) {
      const petit: Recue = { id: PETIT, type: 'recolte', serieId: SERIE.tomate, horodatage: le(AUJOURDHUI, fPetit), detail: recolte(2), origine: PETIT };
      const grand: Recue = { id: GRAND, type: 'recolte', serieId: SERIE.tomate, horodatage: le(AUJOURDHUI, fGrand), detail: recolte(3), origine: GRAND };
      for (const [i, ordre] of deuxOrdres(petit, grand).entries()) {
        base.recevoir('DELETE FROM evenement WHERE id IN (?, ?)', [PETIT, GRAND]);
        for (const l of ordre) recevoir(l);
        const j = await journee();
        const cle = `petit ${fPetit} / grand ${fGrand} (ordre ${String(i + 1)})`;
        obtenu[cle] = { historique: historiqueDe(j, [PETIT, GRAND]), derniere: j.dernieresRecoltes.get(SERIE.tomate)?.quantite };
        attendu[cle] = { historique: [GRAND, PETIT], derniere: 3 };
      }
    }
    expect(obtenu).toEqual(attendu);
  });
});

describe('T13n, W6 : écritures, la garde « encore en vigueur » suit l’instant le plus récent', () => {
  /** L'événement tel que l'écran le lit. */
  async function lu(id: string): Promise<EvenementLu> {
    const l = (await porte.lire<LigneJournal>(`SELECT id, type, date, horodatage, serie_id, campagne_id, remplace_sorte, remplace_evenement_id, ${COLONNES_DETAIL} FROM evenement WHERE id = ?`, [id]))[0];
    const e = l === undefined ? null : evenementLu(l);
    if (e === null) throw new Error(`événement ${id} illisible`);
    return e;
  }

  function chaineDePlantation(p: (typeof PAIRES)[number]): void {
    const plantation = { etape: 'plantation', quantiteReelle: null };
    recevoir({ id: ORIGINE, type: 'realise', serieId: SERIE.batavia, horodatage: `${AUJOURDHUI}T08:00:00.000Z`, detail: plantation, origine: ORIGINE });
    recevoir({ id: PETIT, type: 'realise', serieId: SERIE.batavia, horodatage: le(AUJOURDHUI, p.recent), detail: plantation, corrige: ORIGINE, origine: ORIGINE });
    recevoir({ id: GRAND, type: 'realise', serieId: SERIE.batavia, horodatage: le(AUJOURDHUI, p.ancien), detail: plantation, corrige: ORIGINE, origine: ORIGINE });
  }

  for (const p of PAIRES) {
    it(`${p.nom} : changer la date de la plus récente est accepté, de l’autre refusé`, async () => {
      chaineDePlantation(p);
      await expect(changerDate(ctx, await lu(GRAND), '2026-09-29'), 'la plus ancienne n’est plus en vigueur').rejects.toBeInstanceOf(SaisiePlusEnVigueur);
      await expect(changerDate(ctx, await lu(PETIT), '2026-09-29'), 'la plus récente est en vigueur').resolves.toBeTypeOf('string');
    });

    it(`${p.nom} : annuler la chaîne vise la correction la plus récente`, async () => {
      chaineDePlantation(p);
      const a = await annulerSaisie(ctx, await lu(ORIGINE));
      const vise = base.lireDirect<{ r: string | null }>('SELECT remplace_evenement_id AS r FROM evenement WHERE id = ?', [a])[0]?.r;
      expect(vise).toBe(PETIT);
    });
  }
});
