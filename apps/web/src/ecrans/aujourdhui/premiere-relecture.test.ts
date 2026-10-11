/**
 * T13t — la première relecture après « Fait » n'attend pas la relecture complète de la journée.
 *
 * Constat (docs/mesures/T13t-avant.md) : rouvrir l'onglet « Aujourd'hui » dessine la journée en
 * cache puis relit TOUTE la journée (`lireJournee`, une dizaine de requêtes, puis `calculerEtat`).
 * Un « Fait » tapé tout de suite après attendait la fin de cette relecture complète avant sa
 * relecture incrémentale (T13c) : 1,1 à 2,4 s sur la grande ferme, CPU ×4, pour 500 ms de budget.
 *
 * Règle : pendant une relecture complète alors qu'une journée est déjà là, une saisie de l'écran
 * passe devant. La relecture complète s'arrête à sa requête suivante, la relecture incrémentale de
 * la culture touchée suit aussitôt (ses seules requêtes), puis la relecture complète reprend
 * aussitôt (elle n'attend pas la vérification de T13c, `VERIFICATION_MS`) et la journée finale est
 * celle d'une relecture complète. Une écriture qui échoue n'empêche pas la relecture complète de
 * reprendre. Un changement venu d'ailleurs (synchro) n'interrompt pas une relecture complète.
 *
 * Banc : la ferme du jour (./test/ferme-du-jour.ts) dans la base du téléphone telle que PowerSync
 * la range (./test/base-powersync.ts), aujourd'hui = 2026-09-30. La porte est enveloppée : chaque
 * requête est notée, et la première requête d'une relecture complète (les séries, `FROM serie s`)
 * peut être retenue pour figer cette relecture « en cours ».
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { DateCalendaire, Id } from '@planif/core';
import { journeeEnCache, retenirRelecture, suivreJournee } from './cache.ts';
import { calculerJournee, lireJournee, type Journee, type TacheJour } from './calculs.ts';
import { marquerFait, type ContexteEcriture } from './ecritures.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';

/** Première requête d'une relecture complète (`sqlSeries`) ; les relectures incrémentales n'en font pas. */
const SERIES = /FROM serie s\b/;

let base: BasePowerSync;
let porte: PorteDonnees;
/** Requêtes de lecture passées par la porte, dans l'ordre où elles commencent. */
let requetes: string[];
/** Posé : la prochaine requête des séries attend `liberer()` ; `atteinte` se tient quand elle commence. */
let retenue: { atteinte: () => void; liberee: Promise<void> } | null;
let echouerEcriture: boolean;

beforeEach(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  const vraie = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  requetes = [];
  retenue = null;
  echouerEcriture = false;
  porte = {
    ...vraie,
    lire: async <T,>(sql: string, parametres?: readonly unknown[]) => {
      requetes.push(sql);
      const r = retenue;
      if (r !== null && SERIES.test(sql)) {
        retenue = null;
        r.atteinte();
        await r.liberee;
      }
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
});

afterEach(() => {
  base.fermer();
});

/** Retient la prochaine relecture complète à sa première requête. */
function retenir(): { readonly atteinte: Promise<void>; readonly liberer: () => void } {
  let atteinte: () => void = () => undefined;
  let liberer: () => void = () => undefined;
  const promesseAtteinte = new Promise<void>((r) => {
    atteinte = r;
  });
  const liberee = new Promise<void>((r) => {
    liberer = r;
  });
  retenue = { atteinte, liberee };
  return { atteinte: promesseAtteinte, liberer };
}

/** Suit la journée comme l'écran ; `prochaine(condition)` attend la prochaine journée remise qui la remplit. */
function suivre(): {
  readonly prochaine: (condition: (j: Journee) => boolean) => Promise<Journee>;
  readonly arreter: () => void;
  readonly remises: Journee[];
  /** Nombre de requêtes commencées au moment de chaque remise (même indice que `remises`). */
  readonly requetesALaRemise: number[];
} {
  const remises: Journee[] = [];
  const requetesALaRemise: number[] = [];
  let attente: { condition: (j: Journee) => boolean; tenir: (j: Journee) => void } | null = null;
  const arreter = suivreJournee(
    porte,
    FERME,
    AUJOURDHUI,
    (j) => {
      remises.push(j);
      requetesALaRemise.push(requetes.length);
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
  return {
    prochaine: (condition) =>
      new Promise<Journee>((tenir) => {
        const d = remises.at(-1);
        if (d !== undefined && condition(d)) tenir(d);
        else attente = { condition, tenir };
      }),
    arreter,
    remises,
    requetesALaRemise,
  };
}

/** Forme canonique (clés triées, Map en entrées triées), comme incrementale.test.ts. */
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
const complete = async (): Promise<Journee> => calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, new Date()), AUJOURDHUI);

/** Première tâche qu'un « Fait » solde (ni début de récolte, ni travail). */
function tacheAFaire(j: Journee): TacheJour & { readonly etape: 'semis_pepiniere' | 'semis_direct' | 'plantation' } {
  for (const t of j.taches) {
    const e = t.tache.etape;
    if (e === 'semis_pepiniere' || e === 'semis_direct' || e === 'plantation') return { ...t, etape: e };
  }
  throw new Error('aucune tâche à marquer faite');
}

const ctx = (): ContexteEcriture => ({ porte, fermeId: FERME, aujourdhui: AUJOURDHUI });

/**
 * Ouvre l'écran une première fois (journée lue en entier), le quitte, puis le rouvre avec la
 * relecture complète de réouverture retenue à sa première requête : la journée en cache est là,
 * la relecture complète est « en cours ».
 */
async function rouvrirPendantRelectureComplete(): Promise<{ readonly suivi: ReturnType<typeof suivre>; readonly enCache: Journee; readonly liberer: () => void }> {
  const premier = suivre();
  await premier.prochaine(() => true);
  premier.arreter();
  const enCache = journeeEnCache(porte, FERME, AUJOURDHUI);
  if (enCache === null) throw new Error('journée absente du cache après une première ouverture');
  const r = retenir();
  const suivi = suivre();
  await r.atteinte;
  return { suivi, enCache, liberer: r.liberer };
}

describe('T13t : une saisie passe devant la relecture complète de réouverture', () => {
  it('« Fait » pendant la relecture complète : la saisie paraît après les seules requêtes de sa culture, puis la relecture complète reprend aussitôt', async () => {
    const { suivi, enCache, liberer } = await rouvrirPendantRelectureComplete();
    try {
      const t = tacheAFaire(enCache);
      const avant = requetes.length;
      const id = await marquerFait(ctx(), t.culture, t.etape);
      liberer();
      const avecSaisie = await suivi.prochaine((j) => j.historique.some((h) => h.evenement.id === id));
      const jusquALaSaisie = requetes.slice(avant, suivi.requetesALaRemise[suivi.remises.indexOf(avecSaisie)]);
      // Relecture incrémentale d'une série (T13c) : réalisés, interventions, saisies récentes.
      expect(jusquALaSaisie.filter((sql) => SERIES.test(sql)), 'aucune relecture complète avant que la saisie paraisse').toEqual([]);
      expect(jusquALaSaisie.length, `requêtes avant que la saisie paraisse : ${String(jusquALaSaisie.length)}`).toBeLessThanOrEqual(3);
      expect(avecSaisie.taches.some((x) => x.cle === t.cle), 'la tâche faite a quitté la journée').toBe(false);

      // La relecture complète interrompue reprend aussitôt (sans attendre VERIFICATION_MS) et la
      // journée finale est celle d'une relecture complète.
      const n = requetes.length;
      await vi.waitFor(() => {
        expect(requetes.slice(n).some((sql) => SERIES.test(sql)), 'relecture complète relancée').toBe(true);
      }, { timeout: 1_000, interval: 5 });
      const finale = await suivi.prochaine((j) => j !== avecSaisie);
      expect(empreinte(finale)).toBe(empreinte(await complete()));
    } finally {
      suivi.arreter();
    }
  });

  it('écriture en échec pendant la relecture complète : la relecture complète a quand même lieu', async () => {
    const { suivi, enCache, liberer } = await rouvrirPendantRelectureComplete();
    try {
      const t = tacheAFaire(enCache);
      echouerEcriture = true;
      await expect(marquerFait(ctx(), t.culture, t.etape)).rejects.toThrow('écriture impossible');
      const n = suivi.remises.length;
      liberer();
      const j = await suivi.prochaine(() => suivi.remises.length > n);
      expect(empreinte(j)).toBe(empreinte(await complete()));
      expect(j.taches.some((x) => x.cle === t.cle), 'rien d’écrit : la tâche reste').toBe(true);
    } finally {
      suivi.arreter();
    }
  });

  it('un changement venu d’ailleurs (synchro) n’interrompt pas la relecture complète', async () => {
    const { suivi, enCache, liberer } = await rouvrirPendantRelectureComplete();
    try {
      const t = tacheAFaire(enCache);
      // Saisie écrite sans passer par l'écran (aucune annonce) : comme une ligne reçue par la synchro.
      const id = await porte.saisirEvenement({
        type: 'realise',
        date: AUJOURDHUI as DateCalendaire,
        source: 'tap',
        culture: t.culture.cible,
        emplacementIds: [],
        note: null,
        photos: [],
        remplaceEvenement: null,
        detail: { etape: t.etape, quantiteReelle: null },
      });
      const avant = requetes.length;
      liberer();
      const j = await suivi.prochaine((x) => x.historique.some((h) => h.evenement.id === id));
      // La relecture complète en cours va jusqu'au bout (elle voit la ligne), sans repartir de zéro.
      const jusquALaRemise = requetes.slice(avant, suivi.requetesALaRemise[suivi.remises.indexOf(j)]);
      expect(jusquALaRemise.filter((sql) => SERIES.test(sql)), 'la relecture complète n’a pas été relancée').toEqual([]);
      expect(empreinte(j)).toBe(empreinte(await complete()));
    } finally {
      suivi.arreter();
    }
  });

  it('« Fait » sur l’instantané (aucune journée encore lue) : la relecture complète cède la place pendant la lecture ciblée et l’écriture, puis reprend', async () => {
    const r = retenir();
    const suivi = suivre();
    try {
      await r.atteinte;
      const lever = retenirRelecture(porte, FERME);
      const avant = requetes.length;
      r.liberer();
      // La requête en cours finit ; la relecture complète s'arrête là, rien d'autre n'est lu.
      await new Promise((attente) => setTimeout(attente, 20));
      expect(requetes.slice(avant), 'relecture complète arrêtée pendant la saisie').toEqual([]);
      expect(suivi.remises, 'aucune journée remise').toHaveLength(0);
      lever();
      const j = await suivi.prochaine(() => true);
      expect(requetes.slice(avant).filter((sql) => SERIES.test(sql)), 'relecture complète reprise').toHaveLength(1);
      expect(empreinte(j)).toBe(empreinte(await complete()));
    } finally {
      suivi.arreter();
    }
  });
});
