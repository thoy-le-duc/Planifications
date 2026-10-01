// @vitest-environment happy-dom
/**
 * Tests d'acceptation T13b — robustesse de la lecture de la journée (relecture de T22b).
 *
 * 1. Un `detail` d'événement qui n'est pas du JSON (ligne corrompue, reçue telle quelle) fait
 *    lever `json_extract` et échouer toute la lecture de la journée : l'écran n'affiche plus rien.
 *    Règle : la ligne corrompue est ignorée (filtre `json_valid(e.detail)`), le reste de la
 *    journée est identique à la journée sans elle, et l'écran affiche ses tâches.
 *
 * 2. `occurrenceVisee` (T22b) se lit avec `estDateValide` du cœur, plus avec une regex : une
 *    occurrence visée qui n'est pas une date qui existe ('2026-02-31', '2026-00-10', 'xx') est
 *    ignorée, et l'intervention est soldée selon sa date réelle (règle de T22), comme une saisie
 *    libre. Avant T13b, '2026-02-31' passait la regex et devenait le 3 mars : l'intervention ne
 *    soldait que la première occurrence du désherbage.
 *
 * Banc : la ferme du jour avec travaux (./test/ferme-du-jour.ts, `{ travaux: true }`), dans la
 * base du téléphone telle que PowerSync la range (./test/base-powersync.ts), aujourd'hui =
 * 2026-09-30. Désherbage de la tomate : tous les 14 jours, J−76 … J−6 (en retard), J+8.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { ajouterJours, type DateCalendaire, type Id } from '@planif/core';
import { calculerJournee, lireJournee, type Journee } from './calculs.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { ecrireFermeDuJour, EMPLACEMENT, FERME, SERIE, UTILISATEUR, type FermeDuJour } from './test/ferme-du-jour.ts';

const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');
const j = (n: number): string => ajouterJours(AUJOURDHUI as DateCalendaire, n);
const idTest = (n: number) => `0192f0c1-13b1-7000-8000-0000000a${n.toString(16).padStart(4, '0')}`;

let ecran: ModuleEcranAujourdhui;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

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

/** Événement reçu par la synchro, `detail` en texte brut (corrompu ou non). */
function recevoir(e: { id: string; type: string; date: string; serieId: string; emplacement: string; detail: string }): void {
  const ligne: Record<string, string | null> = {
    id: e.id,
    ferme_id: FERME,
    type: e.type,
    date: e.date,
    horodatage: `${e.date}T08:00:00.000Z`,
    auteur_id: UTILISATEUR,
    source: 'tap',
    serie_id: e.serieId,
    campagne_id: null,
    emplacement_ids: JSON.stringify([e.emplacement]),
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: e.detail,
    cree_le: `${e.date}T08:00:00.000Z`,
    origine_id: e.id,
  };
  const c = Object.keys(ligne);
  base.recevoir(`INSERT INTO evenement (${c.join(', ')}) VALUES (${c.map(() => '?').join(', ')})`, c.map((k) => ligne[k] ?? null));
}

const journee = async (): Promise<Journee> => calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);

/** Ce que l'écran montre d'une journée : tâches (ordre), historique (ordre), dernières récoltes. */
function vue(jn: Journee) {
  return {
    taches: jn.taches.map((t) => t.cle),
    historique: jn.historique.map((h) => h.evenement.id),
    recoltesEnCours: jn.recoltesEnCours.map((c) => c.cibleId),
    dernieresRecoltes: [...jn.dernieresRecoltes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}

/** Lignes corrompues : un réalisé (semainier), une récolte et une intervention récentes (historique). */
const CORROMPUES = [
  { id: idTest(0x1), type: 'realise', date: j(-3), serieId: SERIE.carotte, emplacement: EMPLACEMENT.pcp01, detail: '{"etape":"semis_direct",' },
  { id: idTest(0x2), type: 'recolte', date: j(-1), serieId: SERIE.tomate, emplacement: EMPLACEMENT.t2p07, detail: 'pas du JSON' },
  { id: idTest(0x3), type: 'intervention', date: j(-2), serieId: SERIE.tomate, emplacement: EMPLACEMENT.t2p07, detail: '{categorie: entretien}' },
] as const;

describe('T13b : une ligne du journal au detail corrompu', () => {
  it('lireJournee ne lève pas ; la journée est celle d’avant la ligne corrompue (ligne ignorée)', async () => {
    const avant = vue(await journee());
    expect(avant.taches).toEqual(ferme.attendu.taches);
    for (const e of CORROMPUES) recevoir(e);

    const lecture = lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT);
    await expect(lecture, 'la lecture de la journée ne doit pas échouer').resolves.toBeDefined();
    const apres = vue(calculerJournee(await lecture, AUJOURDHUI));
    expect(apres).toEqual(avant);
    const ids: readonly string[] = CORROMPUES.map((e) => e.id);
    expect(apres.historique.filter((x) => ids.includes(x)), 'aucune ligne corrompue dans l’historique').toEqual([]);
  });

  it('témoin : la même récolte au detail valide entre dans l’historique', async () => {
    recevoir({ ...CORROMPUES[1], detail: JSON.stringify({ quantite: 3, unite: 'kg', categorie: null }) });
    expect((await journee()).historique.map((h) => h.evenement.id)).toContain(CORROMPUES[1].id);
  });

  describe('écran', () => {
    let conteneur: HTMLDivElement;
    let racine: Root;

    beforeEach(() => {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      conteneur = document.createElement('div');
      document.body.append(conteneur);
      racine = createRoot(conteneur);
    });

    afterEach(() => {
      act(() => {
        racine.unmount();
      });
      conteneur.remove();
    });

    it('Aujourd’hui affiche ses tâches malgré la ligne corrompue', async () => {
      for (const e of CORROMPUES) recevoir(e);
      await act(async () => {
        racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
        await Promise.resolve();
      });
      const cles = () => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')].map((t) => t.dataset.cle ?? '');
      for (let k = 0; k < 200 && cles().length === 0; k++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      expect(cles()).toEqual(ferme.attendu.taches);
    });
  });
});

// ── 2. occurrenceVisee ───────────────────────────────────────────────────────────────────────

describe('T13b : occurrenceVisee lue avec estDateValide', () => {
  const desherbage = (): string => ferme.attendu.cles.desherbage ?? '';

  async function apresDesherbage(occurrenceVisee: string | null): Promise<string[]> {
    recevoir({
      id: idTest(0x10),
      type: 'intervention',
      date: AUJOURDHUI,
      serieId: SERIE.tomate,
      emplacement: EMPLACEMENT.t2p07,
      detail: JSON.stringify({ categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee }),
    });
    return (await journee()).taches.map((t) => t.cle);
  }

  it('témoin : sans intervention, le désherbage de la tomate (J−6) est en retard', async () => {
    expect((await journee()).taches.map((t) => t.cle)).toContain(desherbage());
  });

  it('témoin : occurrence visée nulle (saisie libre), datée de J : solde J−6, la tâche part', async () => {
    expect(await apresDesherbage(null)).not.toContain(desherbage());
  });

  it.each(['2026-02-31', '2026-00-10', 'xx'])('occurrence visée « %s » (pas une date qui existe) : ignorée, soldée par sa date (J), la tâche part', async (visee) => {
    expect(await apresDesherbage(visee)).not.toContain(desherbage());
  });
});
