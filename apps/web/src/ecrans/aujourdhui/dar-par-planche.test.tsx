// @vitest-environment happy-dom
/**
 * Tests d'acceptation T69 — écran Aujourd'hui : le délai avant récolte (DAR) ne bloque que les
 * planches traitées (docs/backlog/T69-dar-par-planche.md, réponse de Théophane à Q46 : « on peut
 * récolter les autres »). Vrai écran dans un DOM simulé (happy-dom), sur la ferme du jour
 * (./test/ferme-du-jour.ts, aujourd'hui = 2026-09-30), à laquelle on ajoute une deuxième planche
 * aux tomates (T2-P09) et une deuxième gouttière aux fraises (S1-G02). Sans réseau.
 *
 * ── Contrat (en plus de traitement.test.tsx, T52) ───────────────────────────────────────────
 *
 * Alerte d'une culture en partie traitée (récolte de la culture : toutes ses planches) :
 * « Récolte interdite sur T2-P07 jusqu’au 02/10 (Bouillie bordelaise, traité le 29/09) » (codes des
 * planches sous DAR, dans l'ordre des emplacements de la culture), sur la carte « Peser » comme dans
 * le dialogue « Récolte ».
 *
 * Dialogue « Récolte », culture d'au moins deux planches dont une partie seulement est sous DAR :
 * groupe role="group" nommé « Planches récoltées », une case à cocher par emplacement de la
 * culture (nom = code), toutes cochées. L'alerte et la confirmation suivent les planches cochées :
 *   - planche non traitée seule : ni alerte ni confirmation ; la récolte s'écrit sur cette planche
 *     seulement (emplacement_ids), note vide ;
 *   - planche traitée seule : « Récolte interdite jusqu’au 02/10 (…) », confirmation exigée, la
 *     récolte s'écrit sur cette planche avec l'avertissement dans sa note.
 * Pas de groupe quand rien n'est sous DAR, ni quand toute la culture l'est (traitement sans planche,
 * ou toutes les planches traitées) : l'écran reste celui de T52.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';
import { CAMPAGNE, cleTache, EMPLACEMENT, ecrireFermeDuJour, FERME, PLANTATION, SERIE, UTILISATEUR } from './test/ferme-du-jour.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN_ECRAN = './index.ts';
const AUJOURDHUI = '2026-09-30';

const id = (n: number) => `0192f0c1-6969-7000-8000-${n.toString(16).padStart(12, '0')}`;
/** Zones de la ferme du jour (./test/ferme-du-jour.ts). */
const ZONE_TUNNEL2 = '0192f0c1-1313-7000-8000-000000000010';
const ZONE_SERRE1 = '0192f0c1-1313-7000-8000-000000000012';
const T2P09 = id(0x20);
const S1G02 = id(0x21);
const BOUILLIE = id(0x10);
const TRAITEMENT = id(0x100);

let ecran: ModuleEcranAujourdhui;
let base: BaseMemoire;
let porte: PorteDonnees;
let avant: Set<string>;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  ecran = (await import(/* @vite-ignore */ CHEMIN_ECRAN)) as ModuleEcranAujourdhui;
});

interface LigneEvenement {
  readonly id: string;
  readonly type: string;
  readonly date: string;
  readonly serie_id: string | null;
  readonly campagne_id: string | null;
  readonly emplacement_ids: string;
  readonly note: string | null;
  readonly source: string;
  readonly detail: string;
  readonly remplace_sorte: string | null;
}

const evenements = (): LigneEvenement[] => base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY horodatage, id');
const nouveaux = (): LigneEvenement[] => evenements().filter((e) => !avant.has(e.id));
const emplacementsDe = (e: LigneEvenement | undefined): string[] => (JSON.parse(e?.emplacement_ids ?? '[]') as string[]).map((x) => x.toLowerCase());

function remiseAZero(): void {
  avant = new Set(evenements().map((e) => e.id));
}

function valide(e: LigneEvenement | undefined): void {
  if (e === undefined) throw new Error('événement absent');
  const r = validerSaisie({ ...e });
  expect(r.ok, r.ok ? '' : `validerSaisie refuse : ${r.erreur.message}`).toBe(true);
}

const horo = { cree_le: '2026-01-01T08:00:00.000Z', modifie_le: '2026-01-01T08:00:00.000Z' };

/** Deuxième planche des tomates (T2-P09) et deuxième gouttière des fraises (S1-G02), et le produit. */
async function ecrireSecondesPlanches(): Promise<void> {
  await base.writeTransaction(async (tx) => {
    const emplacement = `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_places, actif_du, actif_au, remplace, cree_le, modifie_le)
      VALUES (?, ?, ?, ?, ?, 30, 0.8, ?, '2024-01-01', NULL, '[]', ?, ?)`;
    await tx.execute(emplacement, [T2P09, FERME, ZONE_TUNNEL2, 'T2-P09', 'planche', null, horo.cree_le, horo.modifie_le]);
    await tx.execute(emplacement, [S1G02, FERME, ZONE_SERRE1, 'S1-G02', 'gouttiere', 400, horo.cree_le, horo.modifie_le]);
    const occupation = `INSERT INTO occupation (id, ferme_id, emplacement_id, serie_id, plantation_id, evenement_id, longueur_m, nombre_places, position_m, prevu_du, prevu_au, reel_du, reel_au, cree_le, modifie_le)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`;
    await tx.execute(occupation, [id(0x30), FERME, T2P09, SERIE.tomate, null, 30, null, 0, '2026-07-02', '2026-10-30', null, horo.cree_le, horo.modifie_le]);
    await tx.execute(occupation, [id(0x31), FERME, S1G02, null, PLANTATION.fraise, null, 400, null, '2024-11-01', '9999-12-31', '2024-11-01', horo.cree_le, horo.modifie_le]);
    await tx.execute(
      `INSERT INTO produit_phyto (id, ferme_id, nom_commercial, numero_amm, substance_active, delai_avant_recolte_jours, utilisable_en_bio, dose_maximale, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, 'Bouillie bordelaise', '9300417', 'cuivre', 3, 1, NULL, ?, ?, NULL)`,
      [BOUILLIE, FERME, horo.cree_le, horo.modifie_le],
    );
  });
}

/** Un traitement déjà au journal (autre téléphone), sur `emplacements`. */
async function ecrireTraitement(emplacements: readonly string[], culture: { serie_id?: string; campagne_id?: string }, date: string, recolteAutoriseeLe: string): Promise<void> {
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le)
       VALUES (?, ?, 'traitement', ?, ?, ?, 'tap', ?, ?, ?, NULL, '[]', NULL, NULL, ?, ?)`,
      [
        TRAITEMENT,
        FERME,
        date,
        `${date}T07:00:00.000Z`,
        UTILISATEUR,
        culture.serie_id ?? null,
        culture.campagne_id ?? null,
        JSON.stringify(emplacements),
        JSON.stringify({ produitPhytoId: BOUILLIE, dose: { valeur: 2, unite: 'L/ha' }, surfaceTraiteeM2: 24, cible: 'mildiou', operateur: '', recolteAutoriseeLe }),
        `${date}T07:00:00.000Z`,
      ],
    );
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  await ecrireSecondesPlanches();
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
  remiseAZero();
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
  vi.unstubAllGlobals();
});

const taches = (): HTMLElement[] => [...conteneur.querySelectorAll<HTMLElement>('[data-testid="tache"]')];
const tache = (cle: string): HTMLElement | undefined => taches().find((t) => t.dataset.cle === cle);
const alerte = (d: ParentNode | undefined): string => texte(d?.querySelector('[data-testid="alerte-dar"]'));
const groupePlanches = (d: ParentNode): HTMLElement | null => d.querySelector<HTMLElement>('[role="group"][aria-label="Planches récoltées"]');

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ecran.EcranAujourdhui porte={porte} fermeId={FERME} aujourdhui={() => AUJOURDHUI} />);
    await Promise.resolve();
  });
  await attendre(() => taches().length > 0, 'tâches affichées');
}

async function choisirRecolte(cible: string): Promise<HTMLElement> {
  await toucher(bouton(/^Noter une récolte/, conteneur));
  await attendre(() => dialogue('Récolte') !== undefined, 'la récolte s’ouvre');
  const choix = dialogueOuEchec('Récolte').querySelector<HTMLElement>(`[data-testid="choix-recolte"][data-cible="${cible}"]`);
  if (choix === null) throw new Error('culture absente de la récolte');
  await toucher(choix);
  return dialogueOuEchec('Récolte');
}

const SUR_T2P07 = 'Récolte interdite sur T2-P07 jusqu’au 02/10 (Bouillie bordelaise, traité le 29/09)';
const TOUTE = 'Récolte interdite jusqu’au 02/10 (Bouillie bordelaise, traité le 29/09)';

describe('T69 : tomates sur T2-P07 et T2-P09, traitées sur T2-P07 seulement', () => {
  beforeEach(async () => {
    await ecrireTraitement([EMPLACEMENT.t2p07], { serie_id: SERIE.tomate }, '2026-09-29', '2026-10-02');
    remiseAZero();
  });

  it('la récolte de la culture nomme la planche interdite ; les deux planches sont proposées, cochées', async () => {
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await attendre(() => alerte(d) === SUR_T2P07, 'alerte qui nomme T2-P07');
    const groupe = groupePlanches(d);
    expect(groupe, 'groupe « Planches récoltées »').not.toBeNull();
    if (groupe === null) return;
    expect(champ('T2-P07', groupe).checked).toBe(true);
    expect(champ('T2-P09', groupe).checked).toBe(true);
  });

  it('pesée de la planche non traitée : ni alerte ni confirmation, récolte écrite sur T2-P09 seulement', async () => {
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await attendre(() => groupePlanches(d) !== null, 'planches proposées');
    await toucher(champ('T2-P07', d));
    await attendre(() => d.querySelector('[data-testid="alerte-dar"]') === null, 'plus d’alerte sans la planche traitée');
    await toucher(bouton('5', d));
    await toucher(bouton(/^Valider/, d));
    await attendre(() => nouveaux().length === 1, 'récolte écrite sans confirmation');
    expect(dialogue('Récolter quand même ?')).toBeUndefined();
    const [r] = nouveaux();
    valide(r);
    expect(r).toMatchObject({ type: 'recolte', serie_id: SERIE.tomate, note: null });
    expect(emplacementsDe(r)).toEqual([T2P09]);
  });

  it('pesée de la planche traitée : alerte, confirmation exigée, récolte écrite sur T2-P07 avec l’avertissement', async () => {
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await attendre(() => groupePlanches(d) !== null, 'planches proposées');
    await toucher(champ('T2-P09', d));
    await attendre(() => alerte(d) === TOUTE, 'alerte de la planche traitée');
    await toucher(bouton('5', d));
    await toucher(bouton(/^Valider/, d));
    await attendre(() => dialogue('Récolter quand même ?') !== undefined, 'confirmation demandée');
    expect(nouveaux()).toHaveLength(0);
    await toucher(bouton('Récolter quand même', dialogueOuEchec('Récolter quand même ?')));
    await attendre(() => nouveaux().length === 1, 'récolte écrite après confirmation');
    const [r] = nouveaux();
    valide(r);
    expect(r?.note).toContain(TOUTE);
    expect(emplacementsDe(r)).toEqual([EMPLACEMENT.t2p07]);
  });

  it('les deux planches cochées : confirmation, la note nomme T2-P07', async () => {
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await attendre(() => alerte(d) === SUR_T2P07, 'alerte qui nomme T2-P07');
    await toucher(bouton('5', d));
    await toucher(bouton(/^Valider/, d));
    await attendre(() => dialogue('Récolter quand même ?') !== undefined, 'confirmation demandée');
    await toucher(bouton('Récolter quand même', dialogueOuEchec('Récolter quand même ?')));
    await attendre(() => nouveaux().length === 1, 'récolte écrite après confirmation');
    const [r] = nouveaux();
    expect(r?.note).toContain(SUR_T2P07);
    expect(emplacementsDe(r).sort()).toEqual([EMPLACEMENT.t2p07, T2P09].sort());
  });
});

describe('T69 : toute la culture sous DAR, ou rien : l’écran de T52', () => {
  it('traitement sans planche des tomates : alerte sans planche nommée, pas de choix des planches', async () => {
    await ecrireTraitement([], { serie_id: SERIE.tomate }, '2026-09-29', '2026-10-02');
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await attendre(() => alerte(d) === TOUTE, 'toute la culture interdite');
    expect(groupePlanches(d)).toBeNull();
  });

  it('les deux planches traitées : alerte sans planche nommée, pas de choix des planches', async () => {
    await ecrireTraitement([EMPLACEMENT.t2p07, T2P09], { serie_id: SERIE.tomate }, '2026-09-29', '2026-10-02');
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await attendre(() => alerte(d) === TOUTE, 'toute la culture interdite');
    expect(groupePlanches(d)).toBeNull();
  });

  it('sans traitement : ni alerte ni choix des planches', async () => {
    await rendre();
    const d = await choisirRecolte(SERIE.tomate);
    await toucher(bouton('5', d));
    expect(groupePlanches(d)).toBeNull();
    await toucher(bouton(/^Valider/, d));
    await attendre(() => nouveaux().length === 1, 'récolte écrite sans confirmation');
    expect(emplacementsDe(nouveaux()[0]).sort()).toEqual([EMPLACEMENT.t2p07, T2P09].sort());
  });
});

describe('T69 : carte « Peser » d’une culture en partie traitée', () => {
  it('fraises sur S1-G01 et S1-G02, traitées sur S1-G01 : la carte nomme S1-G01', async () => {
    await ecrireTraitement([EMPLACEMENT.s1g01], { campagne_id: CAMPAGNE.fraise }, AUJOURDHUI, '2026-10-01');
    await rendre();
    const fraise = () => tache(cleTache(CAMPAGNE.fraise, 'debut_recolte'));
    await attendre(() => alerte(fraise()) !== '', 'alerte sur la carte de la fraise');
    expect(alerte(fraise())).toBe('Récolte interdite sur S1-G01 jusqu’au 01/10 (Bouillie bordelaise, traité le 30/09)');
  });
});
