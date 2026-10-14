/**
 * T13u — une saisie de l'écran qui ne se termine jamais ne suspend pas la relecture complète
 * indéfiniment.
 *
 * T13t : une relecture complète cède la place à une saisie de l'écran (retenue pendant sa
 * préparation, `retenirRelecture` ; annonce jusqu'à son changement, `annoncerSaisie`), puis
 * reprend quand la saisie est écrite ou abandonnée. Une écriture qui ne finit jamais (base
 * bloquée, promesse perdue) la suspendait pour toujours : l'écran gardait l'instantané. Désormais
 * la retenue et l'annonce tombent d'elles-mêmes après ATTENTE_SAISIE_MAX_MS, et la relecture
 * complète reprend.
 *
 * Banc : la ferme du jour dans la base du téléphone telle que PowerSync la range
 * (./test/base-powersync.ts), aujourd'hui = 2026-09-30 ; la première requête de la relecture
 * complète (les séries, `FROM serie s`) est retenue pour la figer « en cours » ; minuteries
 * simulées (setTimeout, clearTimeout) à partir de là.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { annoncerSaisie, ATTENTE_SAISIE_MAX_MS, retenirRelecture, suivreJournee } from './cache.ts';
import type { Journee } from './calculs.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';

const AUJOURDHUI = '2026-09-30';
const SERIES = /FROM serie s\b/;

let base: BasePowerSync;
let porte: PorteDonnees;
let requetes: string[];
let retenue: { atteinte: () => void; liberee: Promise<void> } | null;

beforeEach(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  const vraie = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  requetes = [];
  retenue = null;
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
  };
});

afterEach(() => {
  vi.useRealTimers();
  base.fermer();
});

/** Relecture complète figée à sa première requête, écran abonné ; `remises` : journées remises. */
async function relectureEnCours(): Promise<{ readonly remises: Journee[]; readonly liberer: () => void; readonly arreter: () => void }> {
  let atteinte: () => void = () => undefined;
  let liberer: () => void = () => undefined;
  const promesseAtteinte = new Promise<void>((r) => {
    atteinte = r;
  });
  const liberee = new Promise<void>((r) => {
    liberer = r;
  });
  retenue = { atteinte, liberee };
  const remises: Journee[] = [];
  const arreter = suivreJournee(
    porte,
    FERME,
    AUJOURDHUI,
    (j) => {
      remises.push(j);
    },
    (e) => {
      throw e;
    },
  );
  await promesseAtteinte;
  return { remises, liberer, arreter };
}

describe('T13u : une saisie jamais terminée ne suspend la relecture complète que ATTENTE_SAISIE_MAX_MS', () => {
  it('borne raisonnable : quelques secondes', () => {
    expect(ATTENTE_SAISIE_MAX_MS).toBeGreaterThanOrEqual(2_000);
    expect(ATTENTE_SAISIE_MAX_MS).toBeLessThanOrEqual(10_000);
  });

  it.each([
    ['retenue jamais levée (lecture ciblée ou écriture sans fin)', () => retenirRelecture(porte, FERME)],
    ['annonce jamais suivie de son changement (écriture sans fin)', () => annoncerSaisie(porte, FERME, { sorte: 'serie', serieId: SERIE.chou as Id<'Serie'> }, false)],
  ] as const)('%s : la relecture complète reprend après le délai', async (_nom, saisieSansFin) => {
    const { remises, liberer, arreter } = await relectureEnCours();
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      saisieSansFin();
      const avant = requetes.length;
      liberer();
      // La relecture complète cède la place à la saisie : arrêtée, aucune journée remise.
      await vi.advanceTimersByTimeAsync(ATTENTE_SAISIE_MAX_MS - 100);
      expect(remises, 'relecture complète suspendue tant que la saisie peut encore finir').toHaveLength(0);
      expect(requetes.length - avant, 'rien d’autre n’est lu pendant ce temps').toBeLessThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(200);
      await vi.waitFor(() => {
        expect(remises.length, 'journée relue remise après le délai').toBeGreaterThan(0);
      });
      expect(requetes.slice(avant).filter((sql) => SERIES.test(sql)).length, 'relecture complète reprise').toBeGreaterThan(0);
    } finally {
      arreter();
    }
  });
});
