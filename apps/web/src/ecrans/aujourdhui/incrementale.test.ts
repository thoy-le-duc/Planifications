/**
 * T13c — relecture incrémentale : après une saisie de l'écran, la journée recalculée culture par
 * culture (`suivreJournee`, ./cache.ts) est IDENTIQUE à une relecture complète
 * (`calculerJournee(lireJournee(…))`) faite au même moment, sans relire séries ni noms.
 *
 * Banc : la grande ferme de T13b (./test/grande-ferme.ts) dans la base du téléphone telle que
 * PowerSync la range (./test/base-powersync.ts), aujourd'hui = 2026-09-30. Saisies, dans l'ordre,
 * chacune comparée à la relecture complète (et sans relire les séries) : « Fait » sur une étape, « Fait » sur un travail
 * prévu, récolte d'une campagne, deux récoltes le même jour sur une série (la dernière récolte
 * départagée par l'instant de saisie), annulation, changement de date. Puis une ligne reçue par
 * la synchro : relue en entier.
 */
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { suivreJournee } from './cache.ts';
import { calculerJournee, lireJournee, type EvenementLu, type Journee, type TacheJour } from './calculs.ts';
import { annulerSaisie, changerDate, marquerFait, marquerTravailFait, noterRecolte, type ContexteEcriture } from './ecritures.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, idSerie, UTILISATEUR_GRANDE } from './test/grande-ferme.ts';

const AUJOURDHUI = '2026-09-30';

let base: BasePowerSync;
let porte: PorteDonnees;
/** Lectures des séries (`sqlSeries`, première requête d'une relecture complète) depuis la dernière remise à zéro. */
let lecturesCompletes = 0;
/** Posé : la prochaine écriture de l'écran échoue (T13c, relecture : annonce retirée). */
let echouerEcriture = false;

beforeAll(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  await ecrireGrandeFerme(base, AUJOURDHUI);
  const vraie = creerPorte(base, { utilisateurId: UTILISATEUR_GRANDE as Id<'Utilisateur'>, fermeId: FERME_GRANDE as Id<'Ferme'> });
  porte = {
    ...vraie,
    lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
      if (/FROM serie s\b/.test(sql)) lecturesCompletes++;
      return vraie.lire<T>(sql, parametres);
    },
    ecrireEnsemble: (ordres, verifier) => {
      if (echouerEcriture) {
        echouerEcriture = false;
        return Promise.reject(new Error('écriture impossible (simulée)'));
      }
      return vraie.ecrireEnsemble(ordres, verifier);
    },
  };
}, 120_000);

afterAll(() => {
  base.fermer();
});

/** Forme canonique : clés d'objet triées, Map en entrées triées par clé (comme grande-ferme.test.ts). */
function canonique(v: unknown): unknown {
  if (v instanceof Map) {
    return [...(v as Map<unknown, unknown>).entries()].map(([k, x]) => [String(k), canonique(x)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  if (Array.isArray(v)) return v.map(canonique);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonique((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

const empreinte = (j: Journee): string => createHash('sha256').update(JSON.stringify(canonique(j))).digest('hex');

/** Relecture complète, maintenant. */
const complete = async (): Promise<Journee> => calculerJournee(await lireJournee(porte, FERME_GRANDE, AUJOURDHUI, new Date()), AUJOURDHUI);

const ctx: ContexteEcriture = { get porte() { return porte; }, fermeId: FERME_GRANDE, aujourdhui: AUJOURDHUI };

describe('T13c : relecture incrémentale identique à une relecture complète (grande ferme)', { timeout: 120_000 }, () => {
  it('chaque saisie : même journée qu’une relecture complète, sans relire les séries ; une synchro relit tout', async () => {
    let derniere: Journee | null = null;
    let attente: { condition: (j: Journee) => boolean; tenir: (j: Journee) => void } | null = null;
    const arreter = suivreJournee(
      porte,
      FERME_GRANDE,
      AUJOURDHUI,
      (j) => {
        derniere = j;
        if (attente?.condition(j) === true) {
          const a = attente;
          attente = null;
          a.tenir(j);
        }
      },
      (e) => {
        throw e;
      },
    );
    const prochaine = (condition: (j: Journee) => boolean) =>
      new Promise<Journee>((tenir) => {
        const d = derniere;
        if (d !== null && condition(d)) tenir(d);
        else attente = { condition, tenir };
      });

    /** Saisie, journée remise qui la montre, comparée à la relecture complète. */
    async function verifier(nom: string, saisir: () => Promise<string>, vue: (j: Journee, id: string) => boolean): Promise<Journee> {
      const avant = derniere;
      lecturesCompletes = 0;
      const id = await saisir();
      const j = await prochaine((x) => x !== avant && vue(x, id));
      expect(lecturesCompletes, `${nom} : relecture incrémentale (séries non relues)`).toBe(0);
      expect(empreinte(j), `${nom} : journée incrémentale = relecture complète`).toBe(empreinte(await complete()));
      return j;
    }
    const enTete = (j: Journee, id: string) => j.historique[0]?.evenement.id === id;

    try {
      let j = await prochaine(() => true);
      expect(empreinte(j)).toBe(empreinte(await complete()));

      // « Fait » sur une étape.
      const etape = j.taches.find((t) => t.tache.etape !== 'debut_recolte' && t.tache.etape !== 'travail');
      if (etape === undefined || etape.tache.etape === 'debut_recolte' || etape.tache.etape === 'travail') throw new Error('aucune étape');
      const e = etape.tache.etape;
      j = await verifier('« Fait » sur une étape', () => marquerFait(ctx, etape.culture, e), (x, id) => enTete(x, id) && !x.taches.some((t) => t.cle === etape.cle));

      // « Fait » sur un travail prévu.
      const travail = j.taches.find((t) => t.tache.etape === 'travail');
      if (travail?.tache.etape !== 'travail') throw new Error('aucun travail');
      const tt = travail.tache;
      j = await verifier('« Fait » sur un travail', () => marquerTravailFait(ctx, travail.culture, tt.travail, tt.datePrevue), enTete);

      // Récolte d'une campagne.
      const campagne = j.recoltesEnCours.find((c) => c.cible.sorte === 'campagne');
      if (campagne === undefined) throw new Error('aucune campagne en récolte');
      j = await verifier('récolte d’une campagne', () => noterRecolte(ctx, campagne, 3, campagne.unite), enTete);

      // Deux récoltes le même jour sur une série : la dernière récolte est la dernière saisie.
      const serie = j.recoltesEnCours.find((c) => c.cible.sorte === 'serie');
      if (serie === undefined) throw new Error('aucune série en récolte');
      j = await verifier('première récolte d’une série', () => noterRecolte(ctx, serie, 7, serie.unite), enTete);
      j = await verifier('seconde récolte le même jour', () => noterRecolte(ctx, serie, 2, serie.unite), enTete);
      expect(j.dernieresRecoltes.get(serie.cibleId)?.quantite).toBe(2);

      // Annulation de la seconde récolte : la première redevient la dernière.
      const seconde = j.historique[0];
      if (seconde === undefined) throw new Error('historique vide');
      j = await verifier('annulation', () => annulerSaisie(ctx, seconde.evenement), (x) => !x.historique.some((h) => h.evenement.id === seconde.evenement.id));
      expect(j.dernieresRecoltes.get(serie.cibleId)?.quantite).toBe(7);

      // Changement de date de la première.
      const premiere = j.historique.find((h) => h.evenement.serieId === serie.cibleId && h.evenement.detail.type === 'recolte' && h.evenement.date === AUJOURDHUI);
      if (premiere === undefined) throw new Error('première récolte absente');
      j = await verifier('changement de date', () => changerDate(ctx, premiere.evenement, '2026-09-29'), enTete);

      // Une ligne reçue par la synchro (pas annoncée) : relecture complète.
      lecturesCompletes = 0;
      const avant = derniere as Journee | null;
      base.recevoir('UPDATE serie SET statut = ? WHERE id = ?', ['terminee', etape.culture.cibleId]);
      j = await prochaine((x) => x !== avant);
      expect(lecturesCompletes, 'synchro : relecture complète').toBeGreaterThan(0);
      expect(j.taches.some((t) => t.culture.cibleId === etape.culture.cibleId), 'série terminée : plus de tâche').toBe(false);
      expect(empreinte(j)).toBe(empreinte(await complete()));
    } finally {
      arreter();
    }
  });
});

// ── Relecture du chef (T13c) : cas limites de la relecture incrémentale ──────────────────────

/** Suit la journée de la grande ferme ; `prochaine(condition)` attend la prochaine journée remise qui la remplit. */
function suivre() {
  let derniere: Journee | null = null;
  let attente: { condition: (j: Journee) => boolean; tenir: (j: Journee) => void } | null = null;
  const arreter = suivreJournee(
    porte,
    FERME_GRANDE,
    AUJOURDHUI,
    (j) => {
      derniere = j;
      const a = attente;
      if (a?.condition(j) === true) {
        attente = null;
        a.tenir(j);
      }
    },
    (e) => {
      throw e;
    },
  );
  const prochaine = (condition: (j: Journee) => boolean) =>
    new Promise<Journee>((tenir) => {
      const d = derniere;
      if (d !== null && condition(d)) tenir(d);
      else attente = { condition, tenir };
    });
  return { prochaine, arreter, derniere: () => derniere };
}

type Suivi = ReturnType<typeof suivre>;

/** Saisie de l'écran, journée remise qui la montre (relecture incrémentale), comparée à la relecture complète. */
async function verifier(suivi: Suivi, nom: string, saisir: () => Promise<string>, vue: (j: Journee, id: string) => boolean): Promise<{ readonly j: Journee; readonly id: string }> {
  const avant = suivi.derniere();
  lecturesCompletes = 0;
  const id = await saisir();
  const j = await suivi.prochaine((x) => x !== avant && vue(x, id));
  expect(lecturesCompletes, `${nom} : relecture incrémentale (séries non relues)`).toBe(0);
  expect(empreinte(j), `${nom} : journée incrémentale = relecture complète`).toBe(empreinte(await complete()));
  return { j, id };
}

const enTete = (j: Journee, id: string) => j.historique[0]?.evenement.id === id;
const dansHistorique = (j: Journee, id: string) => j.historique.some((h) => h.evenement.id === id);

function evenement(j: Journee, id: string): EvenementLu {
  const e = j.historique.find((h) => h.evenement.id === id)?.evenement;
  if (e === undefined) throw new Error(`saisie ${id} absente de l’historique`);
  return e;
}

/** Une étape (ni début de récolte ni travail) à marquer faite, hors des clés déjà prises. */
function etapeAFaire(j: Journee, prises: ReadonlySet<string>): TacheJour & { readonly tache: { readonly etape: 'semis_pepiniere' | 'semis_direct' | 'plantation' | 'arrachage' } } {
  const t = j.taches.find((x) => x.tache.etape !== 'debut_recolte' && x.tache.etape !== 'travail' && !prises.has(x.cle));
  if (t === undefined || t.tache.etape === 'debut_recolte' || t.tache.etape === 'travail') throw new Error('aucune étape à faire');
  return t as TacheJour & { readonly tache: { readonly etape: 'semis_pepiniere' | 'semis_direct' | 'plantation' | 'arrachage' } };
}

let recus = 0;
/** Intervention saisie sur un autre téléphone, reçue par la synchro (changement non annoncé). */
function interventionRecue(serieId: string, date: string, horodatage: string): string {
  const id = `0192f0c1-13c2-7000-8000-0000000c${(++recus).toString(16).padStart(4, '0')}`;
  const ligne: Record<string, string | null> = {
    id,
    ferme_id: FERME_GRANDE,
    type: 'intervention',
    date,
    horodatage,
    auteur_id: UTILISATEUR_GRANDE,
    source: 'tap',
    serie_id: serieId,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ categorie: 'entretien', type: 'binage (autre téléphone)', outil: null }),
    cree_le: horodatage,
    origine_id: id,
  };
  const c = Object.keys(ligne);
  base.recevoir(
    `INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`,
    c.map((k) => ligne[k] ?? null),
  );
  return id;
}

describe('T13c, relecture : cas limites de la relecture incrémentale (grande ferme)', { timeout: 120_000 }, () => {
  afterEach(() => {
    echouerEcriture = false;
    vi.useRealTimers();
  });

  it('« Fait » puis annulation de ce « Fait » : la tâche revient à sa place, journée identique à une relecture complète', async () => {
    const suivi = suivre();
    try {
      const j0 = await suivi.prochaine(() => true);
      const t = etapeAFaire(j0, new Set());
      const place = j0.taches.findIndex((x) => x.cle === t.cle);
      const etape = t.tache.etape;
      const { j: j1, id } = await verifier(
        suivi,
        '« Fait »',
        () => marquerFait(ctx, t.culture, etape),
        (x, i) => enTete(x, i) && !x.taches.some((y) => y.cle === t.cle),
      );
      const fait = evenement(j1, id);
      const { j: j2 } = await verifier(
        suivi,
        'annulation du « Fait »',
        () => annulerSaisie(ctx, fait),
        (x) => !dansHistorique(x, id) && x.taches.some((y) => y.cle === t.cle),
      );
      expect(
        j2.taches.findIndex((x) => x.cle === t.cle),
        'la tâche revient à sa place',
      ).toBe(place);
      expect(empreinte(j2), 'même journée qu’avant le « Fait »').toBe(empreinte(await complete()));
    } finally {
      suivi.arreter();
    }
  });

  it('correction, correction de la correction, annulation d’une correction : chaque fois identique à une relecture complète', async () => {
    const suivi = suivre();
    try {
      const j0 = await suivi.prochaine(() => true);
      const t = etapeAFaire(j0, new Set());
      const etape = t.tache.etape;
      const { j: j1, id: fait } = await verifier(suivi, '« Fait »', () => marquerFait(ctx, t.culture, etape), enTete);
      const { j: j2, id: c1 } = await verifier(
        suivi,
        'correction',
        () => changerDate(ctx, evenement(j1, fait), '2026-09-29'),
        (x, i) => dansHistorique(x, i) && !dansHistorique(x, fait),
      );
      const { j: j3, id: c2 } = await verifier(
        suivi,
        'correction de la correction',
        () => changerDate(ctx, evenement(j2, c1), '2026-09-28'),
        (x, i) => dansHistorique(x, i) && !dansHistorique(x, c1),
      );
      expect(evenement(j3, c2).date).toBe('2026-09-28');
      await verifier(
        suivi,
        'annulation d’une correction',
        () => annulerSaisie(ctx, evenement(j3, c2)),
        (x) => !dansHistorique(x, c2) && !dansHistorique(x, c1) && !dansHistorique(x, fait),
      );
    } finally {
      suivi.arreter();
    }
  });

  it('écriture qui échoue : l’annonce est retirée, la synchro suivante relit tout (identique à une relecture complète)', async () => {
    const suivi = suivre();
    try {
      const j0 = await suivi.prochaine(() => true);
      const t = etapeAFaire(j0, new Set());
      const etape = t.tache.etape;
      echouerEcriture = true;
      await expect(marquerFait(ctx, t.culture, etape)).rejects.toThrow('écriture impossible');
      // Une ligne d'une AUTRE culture arrive par la synchro : avec l'annonce restée, la relecture
      // ne relirait que la culture de la saisie ratée et manquerait celle-ci.
      const autre = j0.taches.find((x) => x.culture.cible.sorte === 'serie' && x.culture.cibleId !== t.culture.cibleId)?.culture.cibleId ?? idSerie(7);
      lecturesCompletes = 0;
      const avant = suivi.derniere();
      const recu = interventionRecue(autre, AUJOURDHUI, new Date().toISOString());
      const j = await suivi.prochaine((x) => x !== avant && dansHistorique(x, recu));
      expect(lecturesCompletes, 'synchro après une écriture ratée : relecture complète').toBeGreaterThan(0);
      expect(
        j.taches.some((x) => x.cle === t.cle),
        'la tâche de la saisie ratée reste à faire',
      ).toBe(true);
      expect(empreinte(j)).toBe(empreinte(await complete()));
    } finally {
      suivi.arreter();
    }
  });

  it('fenêtre de 7 jours qui glisse (recalculerCultures rend null) : relecture complète, identique à une relecture complète', async () => {
    // Horloge simulée (Date seule) : la fenêtre de l'historique glisse sans attendre.
    const debut = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: debut });
    const suivi = suivre();
    try {
      const j0 = await suivi.prochaine(() => true);
      // Saisie d'une autre culture, datée d'avant la fenêtre mais saisie il y a presque 7 jours :
      // dans l'historique pour 5 s encore.
      const autre = j0.taches.find((x) => x.culture.cible.sorte === 'serie')?.culture.cibleId ?? idSerie(11);
      const limite = new Date(debut - 7 * 86_400_000 + 5_000).toISOString();
      const avant = suivi.derniere();
      const recu = interventionRecue(autre, '2026-09-01', limite);
      const j1 = await suivi.prochaine((x) => x !== avant && dansHistorique(x, recu));
      expect(empreinte(j1)).toBe(empreinte(await complete()));

      // 10 s plus tard, elle sort de la fenêtre ; « Fait » sur une autre culture.
      vi.setSystemTime(debut + 10_000);
      const t = etapeAFaire(j1, new Set(j1.taches.filter((x) => x.culture.cibleId === autre).map((x) => x.cle)));
      expect(t.culture.cibleId, 'la saisie touche une autre culture que la ligne reçue').not.toBe(autre);
      const etape = t.tache.etape;
      lecturesCompletes = 0;
      await marquerFait(ctx, t.culture, etape);
      const j2 = await suivi.prochaine((x) => x !== j1 && !x.taches.some((y) => y.cle === t.cle) && !dansHistorique(x, recu));
      expect(lecturesCompletes, 'saisie sortie de la fenêtre : relecture complète').toBeGreaterThan(0);
      expect(empreinte(j2), 'journée identique à une relecture complète').toBe(empreinte(await complete()));
    } finally {
      suivi.arreter();
    }
  });
});
