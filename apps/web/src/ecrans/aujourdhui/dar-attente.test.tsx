// @vitest-environment happy-dom
/**
 * T52 (relecture PR #211) — règle 4 : une récolte validée AVANT que le suivi des délais avant
 * récolte (./dar.ts, chargé à la demande après la journée relue) soit prêt demande quand même
 * la confirmation sur un emplacement traité. Le morceau ./dar.ts est retenu derrière une
 * barrière : tant qu'elle est fermée, ni le suivi ni rien d'autre ne peut le lire.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';
import { attendre, bouton, dialogue, dialogueOuEchec, toucher } from '../itineraires/test/outils.ts';

const barriere = vi.hoisted(() => {
  let ouvrir: () => void = () => undefined;
  const ouverte = new Promise<void>((r) => {
    ouvrir = r;
  });
  return { ouverte, ouvrir: () => { ouvrir(); } };
});

vi.mock('./dar.ts', async (original) => {
  await barriere.ouverte;
  return original();
});

const AUJOURDHUI = '2026-09-30';
const BOUILLIE = '0192f0c1-5252-7000-8000-000000000010';
const TRAITEMENT = '0192f0c1-5252-7000-8000-000000000100';

let ecran: ModuleEcranAujourdhui;
let base: BaseMemoire;
let porte: PorteDonnees;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ './index.ts')) as ModuleEcranAujourdhui;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, 'Bouillie bordelaise', '9300417', 'cuivre', 3, 1, NULL, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)`,
      [BOUILLIE, FERME],
    );
    await tx.execute(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
       VALUES (?, ?, 'traitement', '2026-09-29', '2026-09-29T07:00:00.000Z', ?, 'tap', ?, NULL, ?, NULL, '[]', NULL, NULL, ?, '2026-09-29T07:00:00.000Z')`,
      [
        TRAITEMENT,
        FERME,
        UTILISATEUR,
        SERIE.tomate,
        JSON.stringify([EMPLACEMENT.t2p07]),
        JSON.stringify({ produitPhytoId: BOUILLIE, dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: '', recolteAutoriseeLe: '2026-10-02' }),
      ],
    );
  });
  avant = new Set(base.lireDirect<{ id: string }>('SELECT id FROM evenement').map((e) => e.id));
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
  vi.unstubAllGlobals();
});

let avant = new Set<string>();
/** Récoltes écrites pendant le test (la ferme du jour en a déjà). */
const recoltes = () => base.lireDirect<{ id: string; note: string | null }>(`SELECT id, note FROM evenement WHERE type = 'recolte'`).filter((r) => !avant.has(r.id));

describe('T52 (relecture) : récolte validée avant le chargement du suivi des délais', () => {
  it('emplacement traité : la récolte attend le suivi, puis demande la confirmation ; rien d’écrit avant', async () => {
    await act(async () => {
      racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
      await Promise.resolve();
    });
    await attendre(() => conteneur.querySelectorAll('[data-testid="tache"]').length > 0, 'tâches affichées');
    await toucher(bouton(/^Noter une récolte/, conteneur));
    await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
    const choix = dialogueOuEchec('Récolte').querySelector<HTMLElement>(`[data-testid="choix-recolte"][data-cible="${SERIE.tomate}"]`);
    if (choix === null) throw new Error('culture absente de la récolte');
    await toucher(choix);
    await toucher(bouton('5', dialogueOuEchec('Récolte')));
    await toucher(bouton(/^Valider/, dialogueOuEchec('Récolte')));
    // Le suivi n'est pas chargé : rien ne s'écrit sans vérification.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(recoltes()).toHaveLength(0);
    barriere.ouvrir();
    await attendre(() => dialogue('Récolter quand même ?') !== undefined, 'confirmation demandée une fois le suivi chargé');
    expect(recoltes()).toHaveLength(0);
    await toucher(bouton('Récolter quand même', dialogueOuEchec('Récolter quand même ?')));
    await attendre(() => recoltes().length === 1, 'récolte écrite après confirmation');
    expect(recoltes()[0]?.note).toContain('Récolte interdite jusqu’au 02/10 (Bouillie bordelaise, traité le 29/09)');
  });
});
