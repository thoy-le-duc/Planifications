/**
 * Tests d'acceptation T13b (relecture) — lecture du journal par `lireJournee`, après l'allègement.
 *
 * 1. Isolement entre fermes (BLOQUANT à la relecture) : un événement qui porte la ferme B mais
 *    vise une série ou une campagne de la ferme A affichée (réalisé, intervention, récolte de
 *    campagne) est ignoré : mêmes tâches, mêmes dernières récoltes, même historique que sans lui.
 *    Le serveur refuse un tel événement, mais la base locale ne doit pas s'y fier : une ligne
 *    d'une autre ferme ne solde jamais une tâche de celle-ci.
 *
 * 2. Témoin, règle « en vigueur » en SQL : deux corrections d'une même origine au MÊME horodatage,
 *    la plus grande id l'emporte (clé horodatage|id, comme `enVigueur` et le serveur).
 *
 * 3. Témoin, choix du chef sur le detail corrompu (T13b) : quand la correction gagnante d'une
 *    chaîne a un detail corrompu, la chaîne n'a RIEN en vigueur (l'origine ne revient pas ; la
 *    tâche revient au semainier, comme si rien n'était fait). Une annulation au detail corrompu
 *    annule toujours sa chaîne.
 *
 * Banc : la ferme du jour avec travaux (./test/ferme-du-jour.ts), dans la base du téléphone telle
 * que PowerSync la range (./test/base-powersync.ts), aujourd'hui = 2026-09-30.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { ajouterJours, type DateCalendaire, type Id } from '@planif/core';
import { calculerJournee, lireJournee, type Journee } from './calculs.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { CAMPAGNE, cleTache, ecrireFermeDuJour, EMPLACEMENT, EVENEMENT, FERME, SERIE, UTILISATEUR, type FermeDuJour } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');
const j = (n: number): string => ajouterJours(AUJOURDHUI as DateCalendaire, n);
const idTest = (n: number) => `0192f0c1-13b2-7000-8000-0000000a${n.toString(16).padStart(4, '0')}`;
/** Une autre ferme, absente de la base (ou présente : peu importe, ses lignes ne comptent pas ici). */
const AUTRE_FERME = '0192f0c1-13b2-7000-8000-00000000ffff';

let base: BasePowerSync;
let porte: PorteDonnees;
let ferme: FermeDuJour;

beforeEach(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  ferme = await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
});

afterEach(() => {
  base.fermer();
});

interface Recu {
  readonly id: string;
  readonly type: 'realise' | 'recolte' | 'intervention';
  readonly date: string;
  readonly horodatage?: string;
  readonly fermeId?: string;
  readonly serieId?: string | null;
  readonly campagneId?: string | null;
  readonly emplacement: string;
  readonly remplace?: { readonly sorte: 'correction' | 'annulation'; readonly de: string } | null;
  readonly origineId?: string | null;
  /** Objet sérialisé en JSON, ou texte brut (detail corrompu). */
  readonly detail: Record<string, unknown> | string;
}

/** Événement reçu par la synchro. */
function recevoir(e: Recu): void {
  const horodatage = e.horodatage ?? `${e.date}T08:00:00.000Z`;
  const ligne: Record<string, string | null> = {
    id: e.id,
    ferme_id: e.fermeId ?? FERME,
    type: e.type,
    date: e.date,
    horodatage,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: e.serieId ?? null,
    campagne_id: e.campagneId ?? null,
    emplacement_ids: JSON.stringify([e.emplacement]),
    note: null,
    photos: '[]',
    remplace_sorte: e.remplace?.sorte ?? null,
    remplace_evenement_id: e.remplace?.de ?? null,
    detail: typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail),
    cree_le: horodatage,
    origine_id: e.origineId ?? null,
  };
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

const journee = async (): Promise<Journee> => calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);

/** Ce que l'écran montre : tâches (ordre), historique (ordre), dernières récoltes. */
function vue(jn: Journee) {
  return {
    taches: jn.taches.map((t) => t.cle),
    historique: jn.historique.map((h) => h.evenement.id),
    dernieresRecoltes: [...jn.dernieresRecoltes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}

// ── 1. Isolement entre fermes ────────────────────────────────────────────────────────────────

describe('T13b : un événement d’une autre ferme ne touche pas la journée affichée', () => {
  const ETRANGERS: readonly Recu[] = [
    // Réalisés : plantation du chou (7 j de retard), semis direct de la carotte (20 j de retard).
    { id: idTest(0x101), type: 'realise', date: j(-1), serieId: SERIE.chou, emplacement: EMPLACEMENT.t2p03, detail: { etape: 'plantation', quantiteReelle: null } },
    { id: idTest(0x102), type: 'realise', date: j(-2), serieId: SERIE.carotte, emplacement: EMPLACEMENT.pcp01, detail: { etape: 'semis_direct', quantiteReelle: null } },
    // Interventions : désherbage de la tomate (J−6 en retard), grelinette de la batavia (J−12).
    { id: idTest(0x103), type: 'intervention', date: AUJOURDHUI, serieId: SERIE.tomate, emplacement: EMPLACEMENT.t2p07, detail: { categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: j(-6) } },
    { id: idTest(0x104), type: 'intervention', date: j(-1), serieId: SERIE.batavia, emplacement: EMPLACEMENT.t2p01, detail: { categorie: 'travail_sol', type: 'grelinette', outil: 'grelinette', occurrenceVisee: j(-12) } },
    // Récolte de la campagne de fraises (début de récolte, 10 j de retard) et de la tomate (dernière récolte).
    { id: idTest(0x105), type: 'recolte', date: j(-1), campagneId: CAMPAGNE.fraise, emplacement: EMPLACEMENT.s1g01, detail: { quantite: 4, unite: 'barquette', categorie: null } },
    { id: idTest(0x106), type: 'recolte', date: j(-1), serieId: SERIE.tomate, emplacement: EMPLACEMENT.t2p07, detail: { quantite: 99, unite: 'kg', categorie: null } },
  ].map((e) => ({ ...e, fermeId: AUTRE_FERME, origineId: e.id }) as Recu);

  it('réalisés, interventions et récoltes portant une autre ferme : mêmes tâches, même historique, mêmes dernières récoltes', async () => {
    const avant = vue(await journee());
    expect(avant.taches).toEqual(ferme.attendu.taches);
    for (const e of ETRANGERS) recevoir(e);
    expect(vue(await journee())).toEqual(avant);
  });

  it('témoin : les mêmes saisies dans la ferme affichée soldent bien ces tâches', async () => {
    for (const e of ETRANGERS) recevoir({ ...e, fermeId: FERME });
    const taches = vue(await journee()).taches;
    for (const cle of [cleTache(SERIE.chou, 'plantation'), cleTache(SERIE.carotte, 'semis_direct'), cleTache(CAMPAGNE.fraise, 'debut_recolte'), ferme.attendu.cles.desherbage, ferme.attendu.cles.grelinette]) {
      expect(taches, cle).not.toContain(cle);
    }
  });
});

// ── 2. Égalité d'horodatage ──────────────────────────────────────────────────────────────────

describe('T13b, témoin : deux corrections au même horodatage, la plus grande id l’emporte', () => {
  it('semis direct de la carotte : origine J−5, corrections J−2 (petite id) et J−4 (grande id) saisies au même instant : J−4', async () => {
    const O = idTest(0x201);
    const petite = idTest(0x202);
    const grande = idTest(0x203);
    const instant = `${j(-1)}T06:00:00.000Z`;
    const commun = { type: 'realise' as const, serieId: SERIE.carotte, emplacement: EMPLACEMENT.pcp01, detail: { etape: 'semis_direct', quantiteReelle: null }, origineId: O };
    recevoir({ ...commun, id: O, date: j(-5), horodatage: `${j(-5)}T06:00:00.000Z` });
    // La grande id arrive EN PREMIER : une règle « la dernière arrivée l'emporte » échouerait.
    recevoir({ ...commun, id: grande, date: j(-4), horodatage: instant, remplace: { sorte: 'correction', de: O } });
    recevoir({ ...commun, id: petite, date: j(-2), horodatage: instant, remplace: { sorte: 'correction', de: O } });

    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    const carotte = lignes.realises.filter((l) => l.serie_id === SERIE.carotte);
    expect(carotte.map((l) => l.date)).toEqual([j(-4)]);
    const ids = new Set([O, petite, grande]);
    expect(calculerJournee(lignes, AUJOURDHUI).historique.map((h) => h.evenement.id).filter((x) => ids.has(x))).toEqual([grande]);
  });
});

// ── 3. Detail corrompu dans une chaîne ───────────────────────────────────────────────────────

describe('T13b, témoin (choix du chef) : detail corrompu dans une chaîne', () => {
  it('correction gagnante corrompue : rien en vigueur, l’origine ne revient pas, la plantation du chou revient au semainier', async () => {
    const O = idTest(0x301);
    const C = idTest(0x302);
    const commun = { type: 'realise' as const, serieId: SERIE.chou, emplacement: EMPLACEMENT.t2p03, origineId: O };
    recevoir({ ...commun, id: O, date: j(-2), horodatage: `${j(-2)}T06:00:00.000Z`, detail: { etape: 'plantation', quantiteReelle: null } });
    expect(vue(await journee()).taches, 'la plantation faite solde la tâche').not.toContain(cleTache(SERIE.chou, 'plantation'));

    recevoir({ ...commun, id: C, date: j(-1), horodatage: `${j(-1)}T06:00:00.000Z`, remplace: { sorte: 'correction', de: O }, detail: '{"etape":"plantation",' });
    const lignes = await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    expect(lignes.realises.filter((l) => l.serie_id === SERIE.chou)).toEqual([]);
    const jn = calculerJournee(lignes, AUJOURDHUI);
    expect(vue(jn).taches).toContain(cleTache(SERIE.chou, 'plantation'));
    expect(vue(jn).historique.filter((x) => x === O || x === C)).toEqual([]);
  });

  it('annulation corrompue : la chaîne est annulée (récolte de tomates du journal, J−7, absente de l’historique)', async () => {
    const avant = vue(await journee());
    expect(avant.historique).toContain(EVENEMENT.recolteTomate2);
    recevoir({
      id: idTest(0x401),
      type: 'recolte',
      date: j(-7),
      horodatage: `${j(-1)}T06:00:00.000Z`,
      serieId: SERIE.tomate,
      emplacement: EMPLACEMENT.t2p07,
      remplace: { sorte: 'annulation', de: EVENEMENT.recolteTomate2 },
      detail: 'pas du JSON',
    });
    const apres = vue(await journee());
    expect(apres.historique).not.toContain(EVENEMENT.recolteTomate2);
    expect(apres.dernieresRecoltes.find(([cible]) => cible === SERIE.tomate)?.[1].quantite).not.toBe(8);
  });
});
