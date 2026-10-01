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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { suivreJournee } from './cache.ts';
import { calculerJournee, lireJournee, type Journee } from './calculs.ts';
import { annulerSaisie, changerDate, marquerFait, marquerTravailFait, noterRecolte, type ContexteEcriture } from './ecritures.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE, UTILISATEUR_GRANDE } from './test/grande-ferme.ts';

const AUJOURDHUI = '2026-09-30';

let base: BasePowerSync;
let porte: PorteDonnees;
/** Lectures des séries (`sqlSeries`, première requête d'une relecture complète) depuis la dernière remise à zéro. */
let lecturesCompletes = 0;

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
