/**
 * Tests d'acceptation T13h, relecture — « en vigueur » jugé comme la journée, travaux par
 * catégorie, chaînes reçues du serveur, isolement entre fermes.
 *
 * Banc : comme fait-unique.test.ts (ferme du jour, base mémoire, vraie porte, aujourd'hui =
 * 2026-09-30). Les lignes « reçues par la synchro » sont posées par `base.recevoir`, recopiées
 * d'une ligne existante (comme fait-double.test.tsx).
 *
 *   B1   La saisie en vigueur d'une chaîne est sa correction GAGNANTE (la plus récente : même règle
 *        que EN_VIGUEUR de calculs.ts, et que `enVigueur`), pas l'original :
 *        a) réalisé « semis en pépinière » corrigé en « plantation » → « Fait » semis s'écrit,
 *           « Fait » plantation rend DejaFait ;
 *        b) deux corrections, la plus récente revient à « semis » → l'inverse ;
 *        c) réalisé corrigé vers une autre série → l'ancienne série peut le refaire, la nouvelle non.
 *   B2   Deux travaux prévus de même libellé, même date, catégories différentes (entretien /
 *        travail_sol) : noter l'un n'empêche pas l'autre.
 *   NB2  Annulation reçue du serveur, portant origine_id = l'original et un remplace_evenement_id
 *        absent ici (maillon intermédiaire pas encore reçu) : un nouveau « Fait » s'écrit.
 *   NB4  Deux fermes dans la même base : une annulation d'une AUTRE ferme qui vise notre réalisé ne
 *        compte pas (toujours DejaFait).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { EtapeRealisee, Id, TravailPrevu } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { calculerJournee, lireJournee, type Culture, type Journee, type TacheJour } from './calculs.ts';
import { DejaFait, marquerFait, marquerTravailFait, type ContexteEcriture } from './ecritures.ts';
import { ecrireFermeDuJour, EVENEMENT, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';
const AUTRE_FERME = '0192f0c1-13c0-7000-8000-00000000fe02';

type Ligne = Readonly<Record<string, unknown>> & { readonly id: string; readonly horodatage: string };

let base: BaseMemoire;
let porte: PorteDonnees;
let ctx: ContexteEcriture;

beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  ctx = { porte, fermeId: FERME, aujourdhui: AUJOURDHUI };
});

const journee = async (): Promise<Journee> => calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, new Date()), AUJOURDHUI);

function culture(j: Journee, id: string): Culture {
  const c = j.cultures.get(id);
  if (c === undefined) throw new Error(`culture ${id} absente de la journée`);
  return c;
}

function ligne(id: string): Ligne {
  const l = base.lireDirect<Ligne>('SELECT * FROM evenement WHERE id = ?', [id])[0];
  if (l === undefined) throw new Error(`événement ${id} absent`);
  return l;
}

let compteur = 0;
const idRecu = () => `0192f0c1-13c0-7000-8000-0000000c${(++compteur).toString(16).padStart(4, '0')}`;

/** Ligne reçue par la synchro : copie de `modele` avec `changements` ; rend son id. */
function recevoir(modele: Ligne, changements: Readonly<Record<string, unknown>>): string {
  const l: Record<string, unknown> = { ...modele, id: idRecu(), ...changements };
  const c = Object.keys(l);
  base.recevoir(
    `INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`,
    c.map((k) => l[k] ?? null),
  );
  return String(l.id);
}

const plus = (horodatage: string, secondes: number): string => new Date(Date.parse(horodatage) + secondes * 1000).toISOString();

/** Correction reçue de `cible` (origine `origine`), `secondes` après l'original. */
function correctionRecue(cible: Ligne, origine: string, secondes: number, changements: Readonly<Record<string, unknown>>): string {
  return recevoir(cible, {
    horodatage: plus(cible.horodatage, secondes),
    cree_le: plus(cible.horodatage, secondes + 1),
    remplace_sorte: 'correction',
    remplace_evenement_id: cible.id,
    origine_id: origine,
    ...changements,
  });
}

const detailRealise = (etape: EtapeRealisee): string => JSON.stringify({ etape, quantiteReelle: null });

async function attendreDejaFait(p: Promise<unknown>, message: string): Promise<void> {
  let rendu: unknown;
  try {
    rendu = await p;
  } catch (e) {
    expect(e, `${message} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(DejaFait);
    return;
  }
  expect.fail(`${message} : rejet DejaFait attendu, la promesse a rendu ${String(rendu)} (un événement a été écrit)`);
}

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;

// ── B1 ───────────────────────────────────────────────────────────────────────────────────────

describe('T13h, B1 : « en vigueur » jugé sur la correction gagnante', () => {
  it('a) réalisé « semis en pépinière » corrigé (reçu) en « plantation » : « Fait » semis s’écrit, « Fait » plantation rend DejaFait', async () => {
    const batavia = culture(await journee(), SERIE.batavia);
    const semis = ligne(EVENEMENT.semisBatavia);
    expect(JSON.parse(String(semis.detail)) as unknown, 'banc : semis en pépinière de la batavia').toMatchObject({ etape: 'semis_pepiniere' });
    correctionRecue(semis, semis.id, 60, { detail: detailRealise('plantation') });

    const avant = nombreEvenements();
    await attendreDejaFait(marquerFait(ctx, batavia, 'plantation'), '« Fait » plantation (la correction en vigueur est une plantation)');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
    await expect(marquerFait(ctx, batavia, 'semis_pepiniere'), '« Fait » semis (l’original n’est plus en vigueur)').resolves.toBeTypeOf('string');
  });

  it('b) deux corrections reçues, la plus récente revient au semis : « Fait » semis rend DejaFait, « Fait » plantation s’écrit', async () => {
    const batavia = culture(await journee(), SERIE.batavia);
    const semis = ligne(EVENEMENT.semisBatavia);
    const c1 = correctionRecue(semis, semis.id, 60, { detail: detailRealise('plantation') });
    correctionRecue(ligne(c1), semis.id, 120, { detail: detailRealise('semis_pepiniere') });

    await attendreDejaFait(marquerFait(ctx, batavia, 'semis_pepiniere'), '« Fait » semis (la correction gagnante est un semis)');
    await expect(marquerFait(ctx, batavia, 'plantation'), '« Fait » plantation (la correction plantation est dépassée)').resolves.toBeTypeOf('string');
  });

  it('c) réalisé corrigé vers une autre série : l’ancienne série peut le refaire, la nouvelle rend DejaFait', async () => {
    const j = await journee();
    const batavia = culture(j, SERIE.batavia);
    const chou = culture(j, SERIE.chou);
    const semis = ligne(EVENEMENT.semisBatavia);
    expect(
      base.lireDirect('SELECT id FROM evenement WHERE serie_id = ? AND type = ?', [SERIE.chou, 'realise']),
      'banc : aucun réalisé sur le chou',
    ).toHaveLength(0);
    correctionRecue(semis, semis.id, 60, { serie_id: SERIE.chou });

    await attendreDejaFait(marquerFait(ctx, chou, 'semis_pepiniere'), '« Fait » semis du chou (la correction l’y a mis)');
    await expect(marquerFait(ctx, batavia, 'semis_pepiniere'), '« Fait » semis de la batavia (corrigé ailleurs)').resolves.toBeTypeOf('string');
  });
});

// ── B2 ───────────────────────────────────────────────────────────────────────────────────────

type TacheTravail = TacheJour & { readonly tache: { readonly etape: 'travail'; readonly travail: TravailPrevu; readonly datePrevue: string } };

describe('T13h, B2 : travaux de même libellé, catégories différentes', () => {
  it('noter l’un (travail du sol) n’empêche pas l’autre (entretien), même libellé, même date', async () => {
    const j = await journee();
    const t = j.taches.find((x): x is TacheTravail => x.tache.etape === 'travail' && x.tache.travail.categorie === 'travail_sol' && x.tache.travail.produit === null);
    if (t === undefined) throw new Error('banc : un travail du sol prévu sans produit (grelinette)');
    const sol = t.tache.travail;
    const entretien: TravailPrevu = { ...sol, categorie: 'entretien' };
    const date = t.tache.datePrevue;

    await marquerTravailFait(ctx, t.culture, sol, date);
    await expect(marquerTravailFait(ctx, t.culture, entretien, date), 'même libellé, autre catégorie').resolves.toBeTypeOf('string');
    // Et la même catégorie reste refusée.
    await attendreDejaFait(marquerTravailFait(ctx, t.culture, sol, date), 'même travail, même catégorie');
  });
});

// ── NB2 ──────────────────────────────────────────────────────────────────────────────────────

describe('T13h, NB2 : annulation reçue dont le maillon intermédiaire manque ici', () => {
  it('annulation portant origine_id = l’original, remplace_evenement_id absent en local : un nouveau « Fait » s’écrit', async () => {
    const chou = culture(await journee(), SERIE.chou);
    const id = await marquerFait(ctx, chou, 'plantation');
    const fait = ligne(id);
    // Une correction faite ailleurs (pas encore reçue) puis son annulation (reçue).
    const correctionAbsente = '0192f0c1-13c0-7000-8000-0000000cffff';
    recevoir(fait, {
      horodatage: plus(fait.horodatage, 120),
      cree_le: plus(fait.horodatage, 121),
      remplace_sorte: 'annulation',
      remplace_evenement_id: correctionAbsente,
      origine_id: id,
    });
    await expect(marquerFait(ctx, chou, 'plantation'), 'chaîne annulée : nouveau « Fait »').resolves.toBeTypeOf('string');
  });
});

// ── NB4 ──────────────────────────────────────────────────────────────────────────────────────

describe('T13h, NB4 : deux fermes dans la même base', () => {
  it('une annulation d’une AUTRE ferme qui vise notre réalisé ne compte pas : toujours DejaFait', async () => {
    const chou = culture(await journee(), SERIE.chou);
    const id = await marquerFait(ctx, chou, 'plantation');
    const fait = ligne(id);
    recevoir(fait, {
      ferme_id: AUTRE_FERME,
      horodatage: plus(fait.horodatage, 60),
      cree_le: plus(fait.horodatage, 61),
      remplace_sorte: 'annulation',
      remplace_evenement_id: id,
      origine_id: id,
    });
    const avant = nombreEvenements();
    await attendreDejaFait(marquerFait(ctx, chou, 'plantation'), '« Fait » malgré l’annulation d’une autre ferme');
    expect(nombreEvenements()).toBe(avant);
  });
});
