/**
 * Tests d'acceptation T13n — horodatages comparés comme des dates (côté synchro).
 *
 * Constat (relecture T13l) : les lignes locales sont horodatées par `toISOString`
 * (`2026-10-01T10:00:00.000Z`), celles reçues du serveur peuvent l'être autrement (espace au lieu
 * de `T`, fractions de seconde absentes ou plus courtes, `+00:00` au lieu de `Z`). Les règles
 * « correction la plus récente » comparent du texte : `chaines` prend
 * `MAX(horodatage || '|' || id)`, qui diffère en plus de l'ordre (horodatage, id) quand un
 * horodatage est le préfixe d'un autre (`…10:00:00Z` contre `…10:00:00.5Z`).
 *
 * Contrat : la correction la plus récente (instant, puis id le plus grand) gagne, quel que soit
 * le format de son horodatage ; à instant égal écrit dans deux formats, l'id départage, quel que
 * soit l'ordre d'arrivée des lignes.
 *
 * Banc : base mémoire node:sqlite, vraie porte ; lignes reçues du serveur (`origine_id` posé)
 * écrites directement, comme la synchro.
 *
 *   H1  `chaineDe` : la correction d'instant le plus récent est en vigueur, pour chaque paire de
 *       formats (fractions / préfixe, `T` ou espace, `Z` ou `+00:00`) et chaque ordre d'arrivée ;
 *   H2  `chaineDe` : même instant dans deux formats → l'id le plus grand, quelle que soit la
 *       paire de formats et l'ordre d'arrivée ;
 *   H3  porte (« déjà fait », `saisirEvenement` et `pasDejaFait`) : la plantation n'est « déjà
 *       faite » que si la correction la plus récente (instant) dit plantation ;
 *   H4  porte : même instant, deux formats → l'id le plus grand décide du « déjà fait ».
 */
import type { DateCalendaire, Id } from '@planif/core';
import { afterEach, describe, expect, it } from 'vitest';
import { chaineDe, DejaFait, pasDejaFait } from './fait-unique.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { SaisieEvenement } from './types.ts';

const UTILISATEUR = '0192f0c1-13e1-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13e1-7000-8000-000000000002' as Id<'Ferme'>;
const SERIE = '0192f0c1-13e1-7000-8000-000000000020' as Id<'Serie'>;
const ORIGINE = '0192f0c1-13e1-7000-8000-0000000000a0';
/** Deux corrections : `PETIT` < `GRAND` (ordre des ids). */
const PETIT = '0192f0c1-13e1-7000-8000-0000000000b1';
const GRAND = '0192f0c1-13e1-7000-8000-0000000000b2';
const AUJOURDHUI = '2026-10-01' as DateCalendaire;

/**
 * Paires (plus ancienne, plus récente) dont l'ordre du texte est l'inverse de l'ordre des
 * instants : comparer le texte élit la plus ancienne.
 */
const PAIRES: readonly { readonly nom: string; readonly ancien: string; readonly recent: string }[] = [
  { nom: 'préfixe : fractions absentes contre présentes', ancien: '2026-10-01T10:00:00Z', recent: '2026-10-01T10:00:00.5Z' },
  { nom: 'fractions absentes contre millisecondes', ancien: '2026-10-01T10:00:00Z', recent: '2026-10-01T10:00:00.001Z' },
  { nom: 'séparateur espace contre T', ancien: '2026-10-01T10:00:00.000Z', recent: '2026-10-01 10:00:05.000Z' },
  { nom: '+00:00 et espace (serveur) contre toISOString', ancien: '2026-10-01T10:00:00.400Z', recent: '2026-10-01 10:00:00.5+00:00' },
  { nom: 'Z sans fractions contre +00:00 avec fractions', ancien: '2026-10-01T10:00:00Z', recent: '2026-10-01T10:00:00.250+00:00' },
];

/** Le même instant, écrit de plusieurs façons. */
const MEME_INSTANT = [
  '2026-10-01T10:00:00Z',
  '2026-10-01T10:00:00.000Z',
  '2026-10-01T10:00:00+00:00',
  '2026-10-01 10:00:00+00:00',
  '2026-10-01 10:00:00.000Z',
] as const;

/** Paires ordonnées de formats distincts du même instant (format de PETIT, format de GRAND). */
const PAIRES_MEME_INSTANT = MEME_INSTANT.flatMap((a) => MEME_INSTANT.filter((b) => b !== a).map((b) => [a, b] as const));

const bases: BaseMemoire[] = [];
afterEach(() => {
  for (const b of bases.splice(0)) b.fermer();
});

function nouvelleBase(): BaseMemoire {
  const b = creerBaseMemoire(SCHEMA_LOCAL);
  bases.push(b);
  return b;
}

interface Maillon {
  readonly id: string;
  readonly horodatage: string;
  readonly etape: string;
}

/**
 * Écrit, comme la synchro, une plantation (origine) et deux corrections reçues du serveur
 * (`origine_id` = l'origine), dans l'ordre donné.
 */
function recevoirChaine(base: BaseMemoire, corrections: readonly Maillon[]): void {
  const colonnes = ['id', 'ferme_id', 'type', 'date', 'horodatage', 'auteur_id', 'source', 'serie_id', 'campagne_id', 'emplacement_ids', 'note', 'photos', 'remplace_sorte', 'remplace_evenement_id', 'detail', 'cree_le', 'origine_id'];
  const sql = `INSERT INTO evenement (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`;
  const ligne = (id: string, horodatage: string, etape: string, remplace: string | null) => [
    id, FERME, 'realise', AUJOURDHUI, horodatage, UTILISATEUR, 'tap', SERIE, null, '[]', null, '[]',
    remplace === null ? null : 'correction', remplace, JSON.stringify({ etape, quantiteReelle: null }), '2026-10-01T09:00:00.000Z', ORIGINE,
  ];
  base.recevoir(sql, ligne(ORIGINE, '2026-10-01T08:00:00.000Z', 'plantation', null));
  for (const c of corrections) base.recevoir(sql, ligne(c.id, c.horodatage, c.etape, ORIGINE));
}

const lireDe = (base: BaseMemoire) => <T>(sql: string, parametres?: readonly unknown[]) => base.getAll<T>(sql, parametres);

async function enVigueurDe(corrections: readonly Maillon[]): Promise<string | null> {
  const base = nouvelleBase();
  recevoirChaine(base, corrections);
  const c = await chaineDe(lireDe(base), FERME, ORIGINE);
  expect(c.annulee, 'chaîne sans annulation').toBe(false);
  return c.enVigueur;
}

/** Les deux ordres d'arrivée d'une paire de corrections. */
const deuxOrdres = (a: Maillon, b: Maillon): readonly (readonly Maillon[])[] => [
  [a, b],
  [b, a],
];

describe('T13n, H1 : chaineDe élit la correction d’instant le plus récent, quel que soit le format', () => {
  it('pour chaque paire de formats et chaque ordre d’arrivée', async () => {
    const obtenu: Record<string, string | null> = {};
    const attendu: Record<string, string | null> = {};
    for (const p of PAIRES) {
      // La plus récente porte le plus PETIT id : l'id ne peut pas la sauver.
      const ancienne = { id: GRAND, horodatage: p.ancien, etape: 'plantation' };
      const recente = { id: PETIT, horodatage: p.recent, etape: 'plantation' };
      for (const [i, ordre] of deuxOrdres(ancienne, recente).entries()) {
        const cle = `${p.nom} (ordre ${String(i + 1)})`;
        obtenu[cle] = await enVigueurDe(ordre);
        attendu[cle] = PETIT;
      }
    }
    expect(obtenu).toEqual(attendu);
  });
});

describe('T13n, H2 : chaineDe, même instant dans deux formats → l’id le plus grand, de façon stable', () => {
  it('pour chaque paire de formats du même instant et chaque ordre d’arrivée', async () => {
    const obtenu: Record<string, string | null> = {};
    const attendu: Record<string, string | null> = {};
    for (const [fPetit, fGrand] of PAIRES_MEME_INSTANT) {
      const petit = { id: PETIT, horodatage: fPetit, etape: 'plantation' };
      const grand = { id: GRAND, horodatage: fGrand, etape: 'plantation' };
      for (const [i, ordre] of deuxOrdres(petit, grand).entries()) {
        const cle = `petit ${fPetit} / grand ${fGrand} (ordre ${String(i + 1)})`;
        obtenu[cle] = await enVigueurDe(ordre);
        attendu[cle] = GRAND;
      }
    }
    expect(obtenu).toEqual(attendu);
  });
});

// ── Porte : « déjà fait » ────────────────────────────────────────────────────────────────────

const PLANTATION: SaisieEvenement = {
  type: 'realise',
  date: AUJOURDHUI,
  source: 'agent',
  culture: { sorte: 'serie', serieId: SERIE },
  emplacementIds: [],
  note: null,
  photos: [],
  remplaceEvenement: null,
  detail: { etape: 'plantation', quantiteReelle: null },
};

/**
 * La plantation est-elle « déjà faite » selon la porte ? Vérifié deux fois : la vérification
 * d'avant l'écriture (`pasDejaFait`) et l'écriture elle-même (`saisirEvenement`, contrôle d'après
 * écriture). Les deux doivent dire la même chose.
 */
async function dejaFaite(corrections: readonly Maillon[]): Promise<boolean> {
  const base = nouvelleBase();
  recevoirChaine(base, corrections);
  const porte = creerPorte(base, { utilisateurId: UTILISATEUR, fermeId: FERME, maintenant: () => new Date('2026-10-01T12:00:00.000Z') });
  let avant: boolean;
  try {
    await pasDejaFait({ fermeId: FERME, colonne: 'serie_id', cibleId: SERIE, type: 'realise', detail: { etape: 'plantation' } })(lireDe(base));
    avant = false;
  } catch (e) {
    if (!(e instanceof DejaFait)) throw e;
    avant = true;
  }
  let ecriture: boolean;
  try {
    await porte.saisirEvenement(PLANTATION);
    ecriture = false;
  } catch (e) {
    if (!(e instanceof DejaFait)) throw e;
    ecriture = true;
  }
  expect(ecriture, 'pasDejaFait et saisirEvenement disent la même chose').toBe(avant);
  return ecriture;
}

describe('T13n, H3 : porte, « déjà fait » selon la correction d’instant le plus récent', () => {
  it('la plus récente dit plantation → déjà faite ; elle dit semis direct → pas faite', async () => {
    const obtenu: Record<string, boolean> = {};
    const attendu: Record<string, boolean> = {};
    for (const p of PAIRES) {
      for (const recentePlantation of [true, false]) {
        const ancienne = { id: GRAND, horodatage: p.ancien, etape: recentePlantation ? 'semis_direct' : 'plantation' };
        const recente = { id: PETIT, horodatage: p.recent, etape: recentePlantation ? 'plantation' : 'semis_direct' };
        const cle = `${p.nom}, la plus récente dit ${recentePlantation ? 'plantation' : 'semis direct'}`;
        obtenu[cle] = await dejaFaite([ancienne, recente]);
        attendu[cle] = recentePlantation;
      }
    }
    expect(obtenu).toEqual(attendu);
  });
});

describe('T13n, H4 : porte, même instant dans deux formats → l’id le plus grand décide', () => {
  it('pour chaque paire de formats du même instant', async () => {
    const obtenu: Record<string, boolean> = {};
    const attendu: Record<string, boolean> = {};
    for (const [fPetit, fGrand] of PAIRES_MEME_INSTANT) {
      for (const grandPlantation of [true, false]) {
        const petit = { id: PETIT, horodatage: fPetit, etape: grandPlantation ? 'semis_direct' : 'plantation' };
        const grand = { id: GRAND, horodatage: fGrand, etape: grandPlantation ? 'plantation' : 'semis_direct' };
        const cle = `petit ${fPetit} / grand ${fGrand}, le grand dit ${grandPlantation ? 'plantation' : 'semis direct'}`;
        obtenu[cle] = await dejaFaite([petit, grand]);
        attendu[cle] = grandPlantation;
      }
    }
    expect(obtenu).toEqual(attendu);
  });
});
