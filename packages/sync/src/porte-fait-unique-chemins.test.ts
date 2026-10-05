/**
 * Tests d'acceptation T13j — « Fait » unique : tous les chemins d'écriture de la porte.
 *
 * T13i a mis la vérification « déjà fait » dans @planif/sync, mais deux chemins la contournent
 * encore :
 *   - `preparerSaisie` + `ecrireEnsemble` SANS vérificateur écrit un réalisé sans rien vérifier
 *     (l'écran passe sa vérification ; la voix et l'agent pourraient l'oublier) ;
 *   - une intervention qui solde un travail prévu (`occurrenceVisee`), saisie par
 *     `saisirEvenement`, n'est pas vérifiée (l'écran la vérifie : `marquerTravailFait`).
 *
 * Contrat attendu (option la plus sûre : les deux règles du ticket à la fois) :
 *   - `porte.preparerSaisie(saisie)` rend aussi `verification` (VerificationEcriture) : la
 *     vérification « déjà fait » à passer à `ecrireEnsemble`, pour un réalisé NOUVEAU sur une
 *     culture, ou une intervention NOUVELLE qui solde un travail prévu (occurrenceVisee non nulle) ;
 *     `undefined` pour tout le reste (récolte, intervention libre, correction, annulation…) ;
 *   - `porte.ecrireEnsemble(ordres)` SANS vérificateur, dont l'un des ordres insère un tel
 *     « Fait » préparé : refus explicite (Error dont le message dit « vérification »), même quand
 *     rien n'est encore fait ; aucun ordre de l'ensemble n'est écrit. Avec un vérificateur
 *     (celui de `preparerSaisie`, ou celui de l'écran : `pasDejaFait`), rien ne change ;
 *   - `porte.saisirEvenement` d'une intervention NOUVELLE qui solde un travail prévu : rejet
 *     `DejaFait` si une intervention en vigueur de la même culture a le même libellé (`type`), la
 *     même catégorie et la même occurrence visée — la règle de l'écran (ecritures.ts,
 *     `marquerTravailFait`) ; l'outil, le produit, la date ne comptent pas. « En vigueur » : la
 *     règle de T13h/T13i (une chaîne annulée n'a rien en vigueur). Seules les lignes de la ferme
 *     de la porte comptent.
 *
 * Banc : celui de porte-fait-unique.test.ts (base mémoire node:sqlite, schéma local, vraie porte,
 * horloge qui avance d'une seconde à chaque lecture).
 *
 *   E1  réalisé préparé, écrit sans vérificateur alors qu'un réalisé de l'étape est en vigueur → refusé, rien écrit ;
 *   E2  même chose sans réalisé en vigueur → refus explicite « vérification », rien écrit (aucun ordre de l'ensemble) ;
 *   E3  `preparerSaisie` rend la vérification ; avec elle : écrit si rien n'est fait, DejaFait sinon ;
 *   E4  le chemin de l'écran (vérification `pasDejaFait` passée à ecrireEnsemble) marche comme avant ;
 *   E5  récolte, intervention libre, correction et annulation préparées : écrites sans vérificateur ;
 *   E6  intervention qui solde un travail prévu, préparée : même règle que le réalisé ;
 *   I1  intervention soldante par saisirEvenement, travail déjà soldé → DejaFait, rien écrit ;
 *   I2  autre occurrence, autre libellé, autre catégorie, autre culture : s'écrit ;
 *   I3  outil différent, même travail et même occurrence : DejaFait (l'écran ne compare pas l'outil) ;
 *   I4  annulation de l'intervention acceptée, puis le travail se solde de nouveau ; correction acceptée, reste soldé ;
 *   I5  même règle sur une campagne ;
 *   I6  intervention libre (occurrenceVisee nulle) : deux saisies identiques s'écrivent (P10) ;
 *   F1  isolement : un travail soldé (ou un réalisé) dans une AUTRE ferme ne bloque pas, par aucun chemin.
 */
import type { DateCalendaire, DetailIntervention, Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DejaFait, pasDejaFait } from './fait-unique.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { EvenementPrepare, PorteDonnees, SaisieEvenement, VerificationEcriture } from './types.ts';

const UTILISATEUR = '0192f0c1-13d2-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13d2-7000-8000-000000000002' as Id<'Ferme'>;
const AUTRE_FERME = '0192f0c1-13d2-7000-8000-000000000003' as Id<'Ferme'>;
const EMPLACEMENT = '0192f0c1-13d2-7000-8000-000000000010' as Id<'Emplacement'>;
const SERIE_A = '0192f0c1-13d2-7000-8000-000000000020' as Id<'Serie'>;
const SERIE_B = '0192f0c1-13d2-7000-8000-000000000021' as Id<'Serie'>;
const CAMPAGNE = '0192f0c1-13d2-7000-8000-000000000030' as Id<'Campagne'>;
const AUJOURDHUI = '2026-10-01' as DateCalendaire;
const OCCURRENCE = '2026-09-28' as DateCalendaire;
const AUTRE_OCCURRENCE = '2026-10-12' as DateCalendaire;

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

let base: BaseMemoire;
let instant: number;
let porte: PorteDonnees;

const maintenant = (): Date => new Date((instant += 1_000));
const porteDe = (fermeId: Id<'Ferme'>): PorteDonnees => creerPorte(base, { utilisateurId: UTILISATEUR, fermeId, maintenant });

beforeEach(() => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  instant = Date.parse('2026-10-01T06:00:00.000Z');
  porte = porteDe(FERME);
});

afterEach(() => {
  base.fermer();
});

type Etape = 'semis_pepiniere' | 'plantation' | 'arrachage';
type Cible = { readonly sorte: 'serie'; readonly serieId: Id<'Serie'> } | { readonly sorte: 'campagne'; readonly campagneId: Id<'Campagne'> };

const serie = (serieId: Id<'Serie'>): Cible => ({ sorte: 'serie', serieId });
const campagne: Cible = { sorte: 'campagne', campagneId: CAMPAGNE };

const commun = (culture: Cible | null, date: DateCalendaire = AUJOURDHUI) => ({
  date,
  source: 'agent' as const,
  culture,
  emplacementIds: [EMPLACEMENT],
  note: null,
  photos: [],
  remplaceEvenement: null,
});

const realise = (culture: Cible, etape: Etape): SaisieEvenement => ({ ...commun(culture), type: 'realise', detail: { etape, quantiteReelle: null } });

/** Désherbage (entretien) qui solde l'occurrence `occurrenceVisee` du travail prévu, ou libre (null). */
const desherbage = (
  culture: Cible,
  occurrenceVisee: DateCalendaire | null,
  autre: { readonly type?: string; readonly outil?: string | null; readonly date?: DateCalendaire } = {},
): SaisieEvenement => ({
  ...commun(culture, autre.date ?? AUJOURDHUI),
  type: 'intervention',
  detail: { categorie: 'entretien', type: autre.type ?? 'désherbage', outil: autre.outil ?? null, occurrenceVisee },
});

/** Travail du sol (autre catégorie), même libellé et même occurrence que `desherbage`. */
const travailSol = (culture: Cible, occurrenceVisee: DateCalendaire): SaisieEvenement => ({
  ...commun(culture),
  type: 'intervention',
  detail: { categorie: 'travail_sol', type: 'désherbage', outil: null, occurrenceVisee },
});

/** Correction ou annulation de `evenementId` (même saisie, remplaceEvenement renseigné). */
const remplacant = (s: SaisieEvenement, sorte: 'correction' | 'annulation', evenementId: Id<'Evenement'>, date?: DateCalendaire): SaisieEvenement => ({
  ...s,
  date: date ?? s.date,
  remplaceEvenement: { sorte, evenementId },
});

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;
const nombreArticles = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM article_stock')[0]?.n ?? -1;

/** Rend l'erreur levée par `p`, ou échoue si `p` réussit (quelque chose a été écrit). */
async function rejet(p: Promise<unknown>, message: string): Promise<unknown> {
  let resultat: unknown;
  try {
    resultat = await p;
  } catch (e) {
    return e;
  }
  return expect.fail(`${message} : refus attendu, l’écriture a réussi (rendu : ${String(resultat)})`);
}

async function attendreDejaFait(p: Promise<unknown>, message: string): Promise<void> {
  const e = await rejet(p, message);
  expect(e, `${message} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(DejaFait);
}

/**
 * T13j : la vérification que `preparerSaisie` rend avec l'événement préparé (`verification`).
 * Lue sans casser le typage tant que le champ n'existe pas.
 */
const verificationDe = (p: EvenementPrepare): unknown => (p as unknown as { readonly verification?: unknown }).verification;

function verificationRendue(p: EvenementPrepare, message: string): VerificationEcriture {
  const v = verificationDe(p);
  expect(v, `${message} : preparerSaisie rend la vérification « déjà fait » (champ \`verification\`)`).toBeTypeOf('function');
  return v as VerificationEcriture;
}

/** Ordre d'écriture neutre (un article de stock), pour vérifier que tout l'ensemble est annulé. */
const ORDRE_ARTICLE = {
  sql: 'INSERT INTO article_stock (id, ferme_id, espece_id, variete_id, unite, categorie) VALUES (?, ?, ?, ?, ?, ?)',
  parametres: ['0192f0c1-13d2-7000-8000-0000000000c0', FERME, '0192f0c1-13d2-7000-8000-0000000000c1', null, 'kg', null],
};

/** Vérification de l'écran pour un réalisé (ecritures.ts, `marquerFait`). */
const verificationEcranRealise = (serieId: Id<'Serie'>, etape: Etape, fermeId: Id<'Ferme'> = FERME): VerificationEcriture =>
  pasDejaFait({ fermeId, colonne: 'serie_id', cibleId: serieId, type: 'realise', detail: { etape } });

// ── preparerSaisie + ecrireEnsemble ──────────────────────────────────────────────────────────

describe('T13j : un réalisé préparé ne s’écrit pas sans vérification « déjà fait »', () => {
  it('E1 : réalisé préparé, écrit par ecrireEnsemble SANS vérificateur alors que la plantation est déjà faite → refusé, rien n’est écrit', async () => {
    await porte.saisirEvenement(realise(serie(SERIE_A), 'plantation'));
    const avant = nombreEvenements();
    const p = porte.preparerSaisie(realise(serie(SERIE_A), 'plantation'));
    const e = await rejet(porte.ecrireEnsemble([p.ordre]), 'second réalisé de la plantation, sans vérificateur');
    expect(e, 'refus : une erreur (DejaFait ou « vérification manquante »)').toBeInstanceOf(Error);
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('E2 : même sans réalisé en vigueur, un réalisé préparé écrit SANS vérificateur est refusé explicitement ; aucun ordre de l’ensemble n’est écrit', async () => {
    const p = porte.preparerSaisie(realise(serie(SERIE_A), 'plantation'));
    const e = await rejet(porte.ecrireEnsemble([ORDRE_ARTICLE, p.ordre]), 'réalisé préparé sans vérificateur');
    expect(e, 'refus explicite (Error)').toBeInstanceOf(Error);
    expect(e, 'pas DejaFait : rien n’est fait, c’est la vérification qui manque').not.toBeInstanceOf(DejaFait);
    expect(e instanceof Error ? e.message : '', 'le message nomme la vérification manquante').toMatch(/vérification/i);
    expect(nombreEvenements(), 'aucun réalisé écrit').toBe(0);
    expect(nombreArticles(), 'aucun autre ordre de l’ensemble écrit').toBe(0);
  });

  it('E3 : preparerSaisie rend la vérification ; avec elle, le réalisé s’écrit, puis le second est refusé avec DejaFait', async () => {
    const p1 = porte.preparerSaisie(realise(serie(SERIE_A), 'plantation'));
    await expect(porte.ecrireEnsemble([p1.ordre], verificationRendue(p1, 'premier réalisé')), 'rien n’est fait : écrit').resolves.toBeUndefined();
    expect(nombreEvenements()).toBe(1);
    const p2 = porte.preparerSaisie(realise(serie(SERIE_A), 'plantation'));
    await attendreDejaFait(porte.ecrireEnsemble([p2.ordre], verificationRendue(p2, 'second réalisé')), 'second réalisé, vérification de preparerSaisie');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(1);
  });

  it('E4 : chemin de l’écran (vérification pasDejaFait passée à ecrireEnsemble) : écrit, puis DejaFait', async () => {
    const p1 = porte.preparerSaisie(realise(serie(SERIE_A), 'plantation'));
    await expect(porte.ecrireEnsemble([p1.ordre], verificationEcranRealise(SERIE_A, 'plantation')), 'premier « Fait » de l’écran').resolves.toBeUndefined();
    const p2 = porte.preparerSaisie(realise(serie(SERIE_A), 'plantation'));
    await attendreDejaFait(porte.ecrireEnsemble([p2.ordre], verificationEcranRealise(SERIE_A, 'plantation')), 'second « Fait » de l’écran');
    expect(nombreEvenements()).toBe(1);
  });

  it('E5 : récolte, intervention libre, correction et annulation préparées : pas de vérification rendue, écrites sans vérificateur', async () => {
    const id = await porte.saisirEvenement(realise(serie(SERIE_A), 'plantation'));
    const saisies: readonly [string, SaisieEvenement][] = [
      ['récolte', { ...commun(serie(SERIE_A)), type: 'recolte', detail: { quantite: 12, unite: 'kg', categorie: null } }],
      ['intervention libre', desherbage(serie(SERIE_A), null)],
      ['correction du réalisé', remplacant(realise(serie(SERIE_A), 'plantation'), 'correction', id, '2026-09-30' as DateCalendaire)],
      ['annulation du réalisé', remplacant(realise(serie(SERIE_A), 'plantation'), 'annulation', id)],
    ];
    for (const [nom, s] of saisies) {
      const p = porte.preparerSaisie(s);
      expect(verificationDe(p), `${nom} : aucune vérification « déjà fait »`).toBeUndefined();
      await expect(porte.ecrireEnsemble([p.ordre]), `${nom} : écrite sans vérificateur`).resolves.toBeUndefined();
    }
    expect(nombreEvenements()).toBe(5);
  });

  it('E6 : intervention qui solde un travail prévu, préparée : refusée sans vérificateur ; avec celle de preparerSaisie, écrite puis DejaFait', async () => {
    const p0 = porte.preparerSaisie(desherbage(serie(SERIE_A), OCCURRENCE));
    const e = await rejet(porte.ecrireEnsemble([p0.ordre]), 'intervention soldante préparée, sans vérificateur');
    expect(e, 'refus explicite').toBeInstanceOf(Error);
    expect(nombreEvenements(), 'rien n’est écrit').toBe(0);

    const p1 = porte.preparerSaisie(desherbage(serie(SERIE_A), OCCURRENCE));
    await expect(porte.ecrireEnsemble([p1.ordre], verificationRendue(p1, 'intervention soldante')), 'travail pas encore soldé : écrit').resolves.toBeUndefined();
    const p2 = porte.preparerSaisie(desherbage(serie(SERIE_A), OCCURRENCE, { outil: 'binette' }));
    await attendreDejaFait(porte.ecrireEnsemble([p2.ordre], verificationRendue(p2, 'seconde intervention soldante')), 'travail déjà soldé');
    expect(nombreEvenements()).toBe(1);
  });
});

// ── saisirEvenement : intervention qui solde un travail prévu ────────────────────────────────

describe('T13j : une intervention qui solde un travail prévu, saisie par saisirEvenement, passe par « déjà fait »', () => {
  it('I1 : le même travail soldé deux fois (même culture, libellé, catégorie, occurrence) → le second rejeté avec DejaFait, rien n’est écrit', async () => {
    await porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE, { date: '2026-09-29' as DateCalendaire }));
    const avant = nombreEvenements();
    await attendreDejaFait(porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE)), 'désherbage du 28/09 déjà soldé');
    expect(nombreEvenements(), 'rien n’est écrit').toBe(avant);
  });

  it('I2 : autre occurrence, autre libellé, autre catégorie, autre série : s’écrit', async () => {
    await porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE));
    await expect(porte.saisirEvenement(desherbage(serie(SERIE_A), AUTRE_OCCURRENCE)), 'autre occurrence').resolves.toBeTypeOf('string');
    await expect(porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE, { type: 'binage' })), 'autre libellé').resolves.toBeTypeOf('string');
    await expect(porte.saisirEvenement(travailSol(serie(SERIE_A), OCCURRENCE)), 'autre catégorie').resolves.toBeTypeOf('string');
    await expect(porte.saisirEvenement(desherbage(serie(SERIE_B), OCCURRENCE)), 'autre série').resolves.toBeTypeOf('string');
    expect(nombreEvenements()).toBe(5);
  });

  it('I3 : même travail, même occurrence, autre outil et autre date : DejaFait (l’écran ne compare que libellé, catégorie, occurrence)', async () => {
    await porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE, { outil: 'binette' }));
    await attendreDejaFait(
      porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE, { outil: null, date: '2026-10-02' as DateCalendaire })),
      'même travail soldé, outil différent',
    );
    expect(nombreEvenements()).toBe(1);
  });

  it('I4a : l’annulation de l’intervention s’écrit ; ensuite le travail se solde de nouveau, puis est refusé', async () => {
    const s = desherbage(serie(SERIE_A), OCCURRENCE);
    const id = await porte.saisirEvenement(s);
    await expect(porte.saisirEvenement(remplacant(s, 'annulation', id)), 'une annulation n’est jamais refusée « déjà fait »').resolves.toBeTypeOf('string');
    await expect(porte.saisirEvenement(s), 'chaîne annulée : le travail se solde de nouveau').resolves.toBeTypeOf('string');
    await attendreDejaFait(porte.saisirEvenement(s), 'soldé de nouveau');
    expect(nombreEvenements()).toBe(3);
  });

  it('I4b : la correction de date s’écrit ; l’intervention corrigée solde toujours le travail → DejaFait', async () => {
    const s = desherbage(serie(SERIE_A), OCCURRENCE);
    const id = await porte.saisirEvenement(s);
    await expect(porte.saisirEvenement(remplacant(s, 'correction', id, '2026-09-30' as DateCalendaire)), 'une correction n’est pas refusée').resolves.toBeTypeOf('string');
    await attendreDejaFait(porte.saisirEvenement(s), 'travail soldé par l’intervention corrigée');
    expect(nombreEvenements()).toBe(2);
  });

  it('I4c : correction qui change l’occurrence visée (28/09 → 12/10) : le 28/09 se solde de nouveau, le 12/10 est refusé', async () => {
    const s = desherbage(serie(SERIE_A), OCCURRENCE);
    const id = await porte.saisirEvenement(s);
    await porte.saisirEvenement(remplacant(desherbage(serie(SERIE_A), AUTRE_OCCURRENCE), 'correction', id));
    await attendreDejaFait(porte.saisirEvenement(desherbage(serie(SERIE_A), AUTRE_OCCURRENCE)), 'occurrence du 12/10 (la correction en vigueur la solde)');
    await expect(porte.saisirEvenement(s), 'occurrence du 28/09 (l’original n’est plus en vigueur)').resolves.toBeTypeOf('string');
  });

  it('I5 : même règle sur une campagne (plantation pérenne)', async () => {
    const detail: DetailIntervention = { categorie: 'travail_sol', type: 'griffage', outil: null, occurrenceVisee: OCCURRENCE };
    const s: SaisieEvenement = { ...commun(campagne), type: 'intervention', detail };
    await porte.saisirEvenement(s);
    await attendreDejaFait(porte.saisirEvenement(s), 'griffage de la campagne déjà soldé');
    expect(nombreEvenements()).toBe(1);
  });

  it('I6 : intervention libre (occurrenceVisee nulle ou absente) : deux saisies identiques s’écrivent', async () => {
    await porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE));
    const sansOccurrence: SaisieEvenement = { ...commun(serie(SERIE_A)), type: 'intervention', detail: { categorie: 'entretien', type: 'désherbage', outil: null } };
    for (const s of [desherbage(serie(SERIE_A), null), desherbage(serie(SERIE_A), null), sansOccurrence, sansOccurrence]) {
      await expect(porte.saisirEvenement(s), 'intervention libre').resolves.toBeTypeOf('string');
    }
    expect(nombreEvenements()).toBe(5);
  });
});

// ── Isolement entre fermes ───────────────────────────────────────────────────────────────────

describe('T13j : un « Fait » d’une AUTRE ferme ne bloque rien', () => {
  it('F1a : travail soldé dans une autre ferme (même série, même travail, même occurrence) : saisirEvenement l’écrit', async () => {
    await porteDe(AUTRE_FERME).saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE));
    await expect(porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE)), 'travail de notre ferme').resolves.toBeTypeOf('string');
    // Et c'est bien notre saisie qui bloque la suivante, pas celle de l'autre ferme.
    await attendreDejaFait(porte.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE)), 'notre travail soldé');
  });

  it('F1b : réalisé et travail soldés dans une autre ferme : les « Fait » préparés de notre ferme s’écrivent avec leur vérification', async () => {
    const autre = porteDe(AUTRE_FERME);
    await autre.saisirEvenement(realise(serie(SERIE_A), 'plantation'));
    await autre.saisirEvenement(desherbage(serie(SERIE_A), OCCURRENCE));
    for (const s of [realise(serie(SERIE_A), 'plantation'), desherbage(serie(SERIE_A), OCCURRENCE)]) {
      const p = porte.preparerSaisie(s);
      await expect(porte.ecrireEnsemble([p.ordre], verificationRendue(p, s.type)), `${s.type} de notre ferme`).resolves.toBeUndefined();
    }
    expect(nombreEvenements()).toBe(4);
  });
});
