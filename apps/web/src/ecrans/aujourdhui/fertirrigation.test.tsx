// @vitest-environment happy-dom
/**
 * Tests d'acceptation T56 — fertirrigation au champ (docs/backlog/T56-fertirrigation.md, règles 2
 * et 4) : vanne, recette, durée en trois taps, hors ligne ; recopie de la veille en un tap ;
 * annulable. Ferme des vannes de T57 (V12 à 850 L/h sur P3 et P4, V13 sans débit) + nitrate de
 * calcium et recette « Fraise floraison » (../ferme/fertilisation/test/jeu.ts). Contrat :
 * ./test/contrat-fertirrigation.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, boutons, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';
import { ecrireFermeVannes, FERME, UTILISATEUR, VANNE_12, VANNE_13 } from '../parcellaire/test/ferme-vannes.ts';
import { ecrireNitrate, ecrireRecette, NITRATE, RECETTE } from '../ferme/fertilisation/test/jeu.ts';
import { ecrireFermeDuJour, FERME as FERME_DU_JOUR, UTILISATEUR as UTILISATEUR_DU_JOUR } from './test/ferme-du-jour.ts';
import { CHEMIN_SAISIE_IRRIGATION, type ModuleSaisieFertirrigation } from './test/contrat-fertirrigation.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';

const AUJOURDHUI = '2026-10-19';
const HIER = '2026-10-18';
const ANCIENNE = '0192f0c1-5656-7000-8000-0000000000a1';

let m: ModuleSaisieFertirrigation;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_SAISIE_IRRIGATION)) as ModuleSaisieFertirrigation;
});

let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

function porteSur(b: BaseMemoire, utilisateur: string, ferme: string): PorteDonnees {
  const compteuse: BaseLocale = {
    getAll: (sql, p) => b.getAll(sql, p),
    execute: (sql, p) => b.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return b.writeTransaction(fn);
    },
    onChange: (g, o) => b.onChange(g, o),
  };
  return creerPorte(compteuse, { utilisateurId: utilisateur as Id<'Utilisateur'>, fermeId: ferme as Id<'Ferme'> });
}

type Ligne = Record<string, string | null>;
const irrigations = (): Ligne[] => base.lireDirect<Ligne>(`SELECT * FROM evenement WHERE type = 'irrigation' ORDER BY horodatage, id`);
const duJour = (): Ligne[] => irrigations().filter((l) => l.date === AUJOURDHUI);
const detail = (l: Ligne | undefined): unknown => JSON.parse(String(l?.detail));

let k = 0;
/** Une irrigation déjà faite, écrite directement dans la base (hors de la porte). */
function irrigationFaite(date: string, d: Record<string, unknown>, remplace: { sorte: 'annulation'; id: string } | null = null): string {
  k++;
  const id = `0192f0c1-5656-7000-8000-${(0x900 + k).toString(16).padStart(12, '0')}`;
  base.recevoir(
    `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le, origine_id)
     VALUES (?, ?, 'irrigation', ?, ?, ?, 'tap', NULL, NULL, '[]', NULL, '[]', ?, ?, ?, ?, ?)`,
    [id, FERME, date, `${date}T06:${String(k).padStart(2, '0')}:00.000Z`, UTILISATEUR, remplace?.sorte ?? null, remplace?.id ?? null, JSON.stringify(d), `${date}T06:00:00.000Z`, id],
  );
  return id;
}

const DETAIL_HIER = {
  secteurIrrigationId: VANNE_12,
  dureeMinutes: 20,
  recetteFertirrigationId: RECETTE,
  volumeM3: 0.283,
  engrais: [{ produitFertilisantId: NITRATE, produit: 'Nitrate de calcium', quantite: { valeur: 0.0283, unite: 'kg' } }],
};

async function ouvrir(o: { readonly fertirrigation?: boolean; readonly vanneId?: string | null; readonly avant?: () => void } = {}): Promise<HTMLElement> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeVannes(base, { vannes: true });
  await ecrireNitrate({ base });
  await ecrireRecette({ base });
  await ecrireRecette({ base, id: ANCIENNE, nom: 'Ancienne recette', supprimeLe: '2026-09-01T08:00:00.000Z' });
  o.avant?.();
  porte = porteSur(base, UTILISATEUR, FERME);
  await act(async () => {
    racine.render(createElement(m.SaisieIrrigation, { porte, fermeId: FERME, vanneId: o.vanneId ?? null, fertirrigation: o.fertirrigation ?? true, surFermer: () => undefined, aujourdhui: () => AUJOURDHUI }));
    await Promise.resolve();
  });
  const nom = o.fertirrigation === false ? 'Irrigation' : 'Fertirrigation';
  await attendre(() => dialogue(nom)?.querySelector(`option[value="${RECETTE}"]`) !== null && dialogue(nom)?.querySelector(`option[value="${VANNE_12}"]`) !== null, 'vannes et recettes lues');
  transactions = 0;
  return dialogueOuEchec(nom);
}

const statut = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="irrigation-enregistree"]');

describe('T56 : fertirrigation au champ', () => {
  it('« Fertirrigation » : recettes non archivées par nom, la première choisie d’avance ; « Sans engrais » en tête', async () => {
    const d = await ouvrir();
    const l = liste('Recette', d);
    expect([...l.options].map((o) => o.textContent)).toEqual(['Sans engrais', 'Fraise floraison']);
    expect(l.value).toBe(RECETTE);
    expect(liste('Vanne', d).value).toBe(VANNE_12);
  });

  it('trois taps hors ligne (vanne et recette d’avance, « 20 min », « Enregistrer ») : une transaction, doses figées, acceptée par le serveur', async () => {
    const d = await ouvrir();
    await toucher(bouton('20 min', d));
    await toucher(bouton('Enregistrer', d));
    await attendre(() => statut() !== null, 'fertirrigation notée');
    expect(transactions).toBe(1);
    const [e, ...autres] = irrigations();
    expect(autres).toEqual([]);
    expect(e).toMatchObject({ ferme_id: FERME, type: 'irrigation', date: AUJOURDHUI, source: 'tap', remplace_sorte: null });
    // V12 : 850 L/h × 20 min = 0,283 m³ ; 10 kg pour 1 000 L de mère à 1 % → 0,0283 kg de nitrate.
    expect(detail(e)).toEqual(DETAIL_HIER);
    expect(validerSaisie({ ...e }).ok).toBe(true);
    expect(texte(statut())).toContain('Fertirrigation notée : V12, Fraise floraison, 20 min');
  });

  it('vanne sans débit : volume obligatoire (message, rien d’écrit), puis volume, EC et pH saisis à la virgule', async () => {
    const d = await ouvrir({ vanneId: VANNE_13 });
    await toucher(bouton('20 min', d));
    await toucher(bouton('Enregistrer', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'message : volume à saisir');
    expect(transactions).toBe(0);
    expect(irrigations()).toEqual([]);
    await remplir(champ('Volume (m³)', d), '2');
    await remplir(champ('EC mesurée', d), '1,9');
    await remplir(champ('pH mesuré', d), '5,9');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => statut() !== null, 'fertirrigation notée');
    expect(transactions).toBe(1);
    expect(detail(irrigations()[0])).toEqual({
      secteurIrrigationId: VANNE_13,
      dureeMinutes: 20,
      recetteFertirrigationId: RECETTE,
      volumeM3: 2,
      ecMesuree: 1.9,
      phMesure: 5.9,
      engrais: [{ produitFertilisantId: NITRATE, produit: 'Nitrate de calcium', quantite: { valeur: 0.2, unite: 'kg' } }],
    });
    expect(validerSaisie({ ...irrigations()[0] }).ok).toBe(true);
  });

  it('« Sans engrais » choisi : irrigation simple, comme T57', async () => {
    const d = await ouvrir();
    await remplir(liste('Recette', d), '');
    await toucher(bouton('20 min', d));
    await toucher(bouton('Enregistrer', d));
    await attendre(() => statut() !== null, 'irrigation notée');
    expect(detail(irrigations()[0])).toEqual({ secteurIrrigationId: VANNE_12, dureeMinutes: 20 });
  });

  it('« Irrigation » (T57) : « Sans engrais » d’avance, la recette se choisit au besoin', async () => {
    const d = await ouvrir({ fertirrigation: false });
    expect(liste('Recette', d).value).toBe('');
  });

  it('« Annuler » écrit l’annulation, même détail, en une transaction', async () => {
    const d = await ouvrir();
    await toucher(bouton('20 min', d));
    await toucher(bouton('Enregistrer', d));
    await attendre(() => statut() !== null, 'fertirrigation notée');
    const origine = irrigations()[0];
    transactions = 0;
    await toucher(bouton('Annuler', statut() ?? document));
    await attendre(() => irrigations().length === 2, 'annulation écrite');
    expect(transactions).toBe(1);
    const annulation = irrigations()[1];
    expect(annulation).toMatchObject({ remplace_sorte: 'annulation', remplace_evenement_id: origine?.id ?? '' });
    expect(detail(annulation)).toEqual(DETAIL_HIER);
    expect(validerSaisie({ ...annulation }).ok).toBe(true);
  });
});

describe('T56 : recopier la veille en un tap', () => {
  const recopies = (d: HTMLElement): HTMLElement[] => boutons(d).filter((x) => texte(x).startsWith('Recopier'));

  it('un bouton par irrigation en vigueur de la veille ; un tap écrit la même irrigation aujourd’hui, en une transaction', async () => {
    const d = await ouvrir({
      avant: () => {
        irrigationFaite(HIER, DETAIL_HIER);
        const annulee = irrigationFaite(HIER, { secteurIrrigationId: VANNE_13, dureeMinutes: 45 });
        irrigationFaite(HIER, { secteurIrrigationId: VANNE_13, dureeMinutes: 45 }, { sorte: 'annulation', id: annulee });
        irrigationFaite(HIER, { secteurIrrigationId: VANNE_13, dureeMinutes: 10 });
        irrigationFaite('2026-10-17', { secteurIrrigationId: VANNE_13, dureeMinutes: 30 });
      },
    });
    await attendre(() => recopies(d).length === 2, 'deux irrigations de la veille à recopier');
    expect(recopies(d).map((x) => texte(x)).sort()).toEqual(['Recopier : V12, Fraise floraison, 20 min', 'Recopier : V13, 10 min']);
    await toucher(bouton('Recopier : V12, Fraise floraison, 20 min', d));
    await attendre(() => duJour().length === 1, 'recopie écrite');
    expect(transactions).toBe(1);
    const [e] = duJour();
    expect(e).toMatchObject({ type: 'irrigation', date: AUJOURDHUI, source: 'tap', remplace_sorte: null });
    expect(detail(e)).toEqual(DETAIL_HIER);
    expect(validerSaisie({ ...e }).ok).toBe(true);
    await attendre(() => statut() !== null, 'recopie notée, annulable');
    transactions = 0;
    await toucher(bouton('Annuler', statut() ?? document));
    await attendre(() => duJour().length === 2, 'recopie annulée');
    expect(transactions).toBe(1);
    expect(duJour()[1]).toMatchObject({ remplace_sorte: 'annulation', remplace_evenement_id: e?.id ?? '' });
  });

  it('rien la veille : aucun bouton « Recopier »', async () => {
    const d = await ouvrir({ avant: () => irrigationFaite('2026-10-17', DETAIL_HIER) });
    expect(recopies(d)).toEqual([]);
  });
});

describe('T56 : point d’entrée « Fertirrigation » dans l’écran Aujourd’hui', () => {
  it('« Fertirrigation », « 20 min », « Enregistrer » : trois taps, une fertirrigation écrite', async () => {
    const ecran = (await import(/* @vite-ignore */ './index.ts')) as ModuleEcranAujourdhui;
    base = creerBaseMemoire(SCHEMA_LOCAL);
    await ecrireFermeDuJour(base, '2026-09-30');
    const V7 = '0192f0c1-5656-7000-8000-0000000000b7';
    const N = '0192f0c1-5656-7000-8000-0000000000b8';
    const R = '0192f0c1-5656-7000-8000-0000000000b9';
    base.recevoir(`INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom, debit_litres_heure, supprime_le) VALUES (?, ?, 7, 'V7', 6000, NULL)`, [V7, FERME_DU_JOUR]);
    base.recevoir(
      `INSERT INTO produit_fertilisant (id, ferme_id, nom, forme, unite, teneur_n, organique, utilisable_en_bio, source, supprime_le) VALUES (?, ?, 'Nitrate de calcium', 'solide', 'kg', 15.5, 0, 0, '', NULL)`,
      [N, FERME_DU_JOUR],
    );
    base.recevoir(`INSERT INTO recette_fertirrigation (id, ferme_id, nom, taux_injection, engrais, supprime_le) VALUES (?, ?, 'Fraise floraison', 1, ?, NULL)`, [
      R,
      FERME_DU_JOUR,
      JSON.stringify([{ produitFertilisantId: N, quantite: { valeur: 10, unite: 'kg' } }]),
    ]);
    porte = porteSur(base, UTILISATEUR_DU_JOUR, FERME_DU_JOUR);
    await act(async () => {
      racine.render(createElement(ecran.EcranAujourdhui, { porte, fermeId: FERME_DU_JOUR, aujourdhui: () => '2026-09-30' }));
      await Promise.resolve();
    });
    await attendre(() => document.querySelector('[data-testid="tache"]') !== null, 'écran prêt');
    await toucher(bouton('Fertirrigation'));
    await attendre(() => dialogue('Fertirrigation')?.querySelector(`option[value="${R}"]`) !== null, 'saisie ouverte, recette lue');
    const d = dialogueOuEchec('Fertirrigation');
    await attendre(() => liste('Recette', d).value === R && liste('Vanne', d).value === V7, 'vanne et recette choisies d’avance');
    await toucher(bouton('20 min', d));
    await toucher(bouton('Enregistrer', d));
    await attendre(() => statut() !== null, 'fertirrigation notée');
    const [e] = irrigations();
    // 6 000 L/h × 20 min = 2 m³ ; 10 kg pour 1 000 L de mère à 1 % → 0,2 kg de nitrate.
    expect(detail(e)).toEqual({ secteurIrrigationId: V7, dureeMinutes: 20, recetteFertirrigationId: R, volumeM3: 2, engrais: [{ produitFertilisantId: N, produit: 'Nitrate de calcium', quantite: { valeur: 0.2, unite: 'kg' } }] });
    expect(validerSaisie({ ...e }).ok).toBe(true);
  });
});
