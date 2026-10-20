// @vitest-environment happy-dom
/**
 * Tests d'acceptation T52 — registre phyto dans l'onglet Ferme (docs/backlog/T52-registre-phyto.md,
 * règle 6). Vrai écran dans un DOM simulé (happy-dom), porte sur la ferme du jour
 * (../../aujourdhui/test/ferme-du-jour.ts, aujourd'hui = 2026-09-30, saison 2026), sans réseau.
 * Contrat : ./test/contrat.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModulePhyto } from './test/contrat.ts';
import { CAMPAGNE, EMPLACEMENT, ecrireFermeDuJour, FERME, SERIE, UTILISATEUR } from '../../aujourdhui/test/ferme-du-jour.ts';
import { attendre, bouton, dialogue, dialogueOuEchec, radio, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
const AUJOURDHUI = '2026-09-30';
const id = (n: number) => `0192f0c1-5255-7000-8000-${n.toString(16).padStart(12, '0')}`;
const BOUILLIE = id(0x10);
const SPINOSAD = id(0x11);
const T_TOMATE = id(0x100);
const T_FRAISE = id(0x101);
const T_ANNULE = id(0x102);
const ANNULATION = id(0x103);
const T_ANCIEN = id(0x104);

let m: ModulePhyto;
let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModulePhyto;
});

const horo = '2026-01-01T08:00:00.000Z';

async function ecrireJeu(): Promise<void> {
  await base.writeTransaction(async (tx) => {
    const p = `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`;
    await tx.execute(p, [BOUILLIE, FERME, 'Bouillie bordelaise', '9300417', 'cuivre', 3, 1, horo, horo]);
    await tx.execute(p, [SPINOSAD, null, 'Success 4', '2010513', 'spinosad', 1, 0, horo, horo]);
    const e = `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
       VALUES (?, ?, 'traitement', ?, ?, ?, 'tap', ?, ?, ?, NULL, '[]', ?, ?, ?, ?)`;
    const detail = (produit: string, recolte: string, cible: string, operateur = '') =>
      JSON.stringify({ produitPhytoId: produit, dose: { valeur: 2.5, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible, operateur, recolteAutoriseeLe: recolte });
    const ligne = (eid: string, date: string, h: string, serie: string | null, campagne: string | null, emplacement: string, d: string, remplace: [string, string] | null = null) => [
      eid,
      FERME,
      date,
      h,
      UTILISATEUR,
      serie,
      campagne,
      JSON.stringify([emplacement]),
      remplace?.[0] ?? null,
      remplace?.[1] ?? null,
      d,
      h,
    ];
    await tx.execute(e, ligne(T_TOMATE, '2026-09-28', '2026-09-28T07:00:00.000Z', SERIE.tomate, null, EMPLACEMENT.t2p07, detail(BOUILLIE, '2026-10-01', 'mildiou', 'Théo')));
    await tx.execute(e, ligne(T_FRAISE, '2026-09-29', '2026-09-29T07:00:00.000Z', null, CAMPAGNE.fraise, EMPLACEMENT.s1g01, detail(SPINOSAD, '2026-09-30', 'thrips')));
    await tx.execute(e, ligne(T_ANNULE, '2026-09-27', '2026-09-27T07:00:00.000Z', SERIE.tomate, null, EMPLACEMENT.t2p07, detail(BOUILLIE, '2026-09-30', 'oïdium')));
    await tx.execute(e, ligne(ANNULATION, '2026-09-27', '2026-09-27T08:00:00.000Z', SERIE.tomate, null, EMPLACEMENT.t2p07, detail(BOUILLIE, '2026-09-30', 'oïdium'), ['annulation', T_ANNULE]));
    // Saison passée : hors du registre de la saison.
    await tx.execute(e, ligne(T_ANCIEN, '2025-06-10', '2025-06-10T07:00:00.000Z', SERIE.tomate, null, EMPLACEMENT.t2p07, detail(BOUILLIE, '2025-06-13', 'mildiou')));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  await ecrireJeu();
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
  transactions = 0;
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
  vi.unstubAllGlobals();
});

const lignes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="ligne-registre"]')];
const ids = (): (string | undefined)[] => lignes().map((l) => l.dataset.evenement);

async function ouvrir(): Promise<HTMLElement> {
  await act(async () => {
    racine.render(createElement(m.EcranRegistrePhyto, { porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, surFermer: () => undefined }));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Registre phyto') !== undefined && lignes().length > 0, 'registre lu');
  return dialogueOuEchec('Registre phyto');
}

describe('T52 : registre phyto', () => {
  it('les traitements en vigueur de la saison, du plus récent au plus ancien, sans l’annulé ni la saison passée', async () => {
    await ouvrir();
    expect(ids()).toEqual([T_FRAISE, T_TOMATE]);
    const tomate = lignes()[1];
    for (const attendu of ['Bouillie bordelaise', '9300417', '2,5 L/ha', '24 m²', 'T2-P07', 'Tomate Cœur de bœuf', 'mildiou', 'Théo', 'Récolte autorisée le 01/10']) {
      expect(texte(tomate), attendu).toContain(attendu);
    }
    expect(texte(lignes()[0])).toContain('Success 4');
    expect(texte(lignes()[0])).toContain('Fraise');
  });

  it('filtre « Bio uniquement » / « Non bio » / « Tous »', async () => {
    const d = await ouvrir();
    await toucher(radio('Bio uniquement', d));
    await attendre(() => ids().length === 1, 'filtre bio');
    expect(ids()).toEqual([T_TOMATE]);
    await toucher(radio('Non bio', d));
    await attendre(() => ids()[0] === T_FRAISE, 'filtre non bio');
    expect(ids()).toEqual([T_FRAISE]);
    await toucher(radio('Tous', d));
    await attendre(() => ids().length === 2, 'tous');
  });

  it('« Annuler ce traitement » : confirmation, une annulation en ajout seul, la ligne quitte le registre', async () => {
    await ouvrir();
    const tomate = lignes().find((l) => l.dataset.evenement === T_TOMATE);
    if (tomate === undefined) throw new Error('ligne absente');
    const avant = base.lireDirect<{ id: string }>('SELECT id FROM evenement').length;
    await toucher(bouton('Annuler ce traitement', tomate));
    await attendre(() => dialogue('Annuler ce traitement ?') !== undefined, 'confirmation');
    expect(base.lireDirect<{ id: string }>('SELECT id FROM evenement')).toHaveLength(avant);
    transactions = 0;
    await toucher(bouton('Annuler le traitement', dialogueOuEchec('Annuler ce traitement ?')));
    await attendre(() => !ids().includes(T_TOMATE), 'ligne retirée');
    expect(transactions).toBe(1);
    const [a] = base.lireDirect<Record<string, string | null>>('SELECT * FROM evenement WHERE remplace_evenement_id = ?', [T_TOMATE]);
    expect(a?.remplace_sorte).toBe('annulation');
    const r = validerSaisie({ ...a });
    expect(r.ok, r.ok ? '' : r.erreur.message).toBe(true);
    const interdits = base.ecritures.filter((sql) => /^\s*(UPDATE|DELETE|REPLACE)\b/i.test(sql) && /\bevenement\b/i.test(sql));
    expect(interdits).toEqual([]);
  });
});
