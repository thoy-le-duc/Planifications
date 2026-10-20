// @vitest-environment happy-dom
/**
 * Tests d'acceptation T57 — la saisie d'irrigation (aujourdhui/SaisieIrrigation.tsx) : vanne et
 * durée, écrites hors ligne dans le journal du téléphone, annulables ; et son point d'entrée dans
 * l'écran Aujourd'hui (bouton « Irrigation »). Contrat : ./test/contrat-irrigation.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';
import { ecrireFermeVannes, FERME, UTILISATEUR, VANNE_12, VANNE_13, VANNE_14 } from '../parcellaire/test/ferme-vannes.ts';
import { ecrireFermeDuJour, FERME as FERME_DU_JOUR, UTILISATEUR as UTILISATEUR_DU_JOUR } from './test/ferme-du-jour.ts';
import { CHEMIN_SAISIE_IRRIGATION, TESTID_IRRIGATION as T, type ModuleSaisieIrrigation } from './test/contrat-irrigation.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';

const AUJOURDHUI = '2026-10-19';

let m: ModuleSaisieIrrigation;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_SAISIE_IRRIGATION)) as ModuleSaisieIrrigation;
});

let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let fermetures = 0;
let conteneur: HTMLDivElement;
let racine: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fermetures = 0;
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
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

async function ouvrir(vanneId: string | null = null): Promise<HTMLElement> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeVannes(base, { vannes: true });
  base.recevoir('UPDATE secteur_irrigation SET supprime_le = ? WHERE id = ?', ['2026-10-01T08:00:00.000Z', VANNE_14]);
  porte = porteSur(base, UTILISATEUR, FERME);
  await act(async () => {
    racine.render(
      createElement(m.SaisieIrrigation, {
        porte,
        fermeId: FERME,
        vanneId,
        surFermer: () => {
          fermetures++;
        },
        aujourdhui: () => AUJOURDHUI,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => document.querySelector(`[data-testid="${T.saisie}"] option[value="${VANNE_12}"]`) !== null, 'vannes lues');
  transactions = 0;
  return dialogueOuEchec('Irrigation');
}

type Ligne = Record<string, string | null>;
const irrigations = (): Ligne[] => base.lireDirect<Ligne>(`SELECT * FROM evenement WHERE type = 'irrigation' ORDER BY horodatage, id`);

describe('T57 : saisie d’irrigation', () => {
  it('liste les vannes non supprimées par numéro ; la vanne donnée est choisie d’avance', async () => {
    const d = await ouvrir(VANNE_13);
    const l = liste('Vanne', d);
    expect([...l.options].map((o) => o.textContent)).toEqual(['V12', 'V13']);
    expect(l.value).toBe(VANNE_13);
  });

  it('V12, 20 min : un événement irrigation, une transaction, accepté par les règles du serveur', async () => {
    const d = await ouvrir();
    await remplir(liste('Vanne', d), VANNE_12);
    await remplir(champ('Durée (min)', d), '20');
    await toucher(bouton('Enregistrer', d));
    await attendre(() => document.querySelector(`[data-testid="${T.enregistree}"]`) !== null, 'enregistrée');
    expect(transactions).toBe(1);
    const [e, ...autres] = irrigations();
    expect(autres).toEqual([]);
    expect(e).toMatchObject({ ferme_id: FERME, type: 'irrigation', date: AUJOURDHUI, source: 'tap', serie_id: null, campagne_id: null, remplace_sorte: null, auteur_id: UTILISATEUR });
    expect(JSON.parse(String(e?.detail))).toEqual({ secteurIrrigationId: VANNE_12, dureeMinutes: 20 });
    expect(JSON.parse(String(e?.emplacement_ids))).toEqual([]);
    expect(validerSaisie({ ...e }).ok).toBe(true);
    expect(texte(document.querySelector(`[data-testid="${T.enregistree}"]`))).toContain('Irrigation notée : V12, 20 min');
  });

  it('« 1 h » remplit 60 min ; durée vide, nulle, non entière ou de plus de 24 h : message, rien d’écrit', async () => {
    const d = await ouvrir(VANNE_12);
    await toucher(bouton('1 h', d));
    expect(champ('Durée (min)', d).value).toBe('60');
    for (const mauvaise of ['', '0', '12,5', '1441', 'abc']) {
      await remplir(champ('Durée (min)', d), mauvaise);
      await toucher(bouton('Enregistrer', d));
      await attendre(() => d.querySelector('[role="alert"]') !== null, `message pour « ${mauvaise} »`);
    }
    expect(transactions).toBe(0);
    expect(irrigations()).toEqual([]);
  });

  it('« Annuler » écrit l’annulation (même détail), en une transaction ; « Fermer » ferme', async () => {
    const d = await ouvrir(VANNE_12);
    await toucher(bouton('20 min', d));
    await toucher(bouton('Enregistrer', d));
    await attendre(() => document.querySelector(`[data-testid="${T.enregistree}"]`) !== null, 'enregistrée');
    const origine = irrigations()[0];
    transactions = 0;
    await toucher(bouton('Annuler', document.querySelector<HTMLElement>(`[data-testid="${T.enregistree}"]`) ?? document));
    await attendre(() => irrigations().length === 2, 'annulation écrite');
    expect(transactions).toBe(1);
    const annulation = irrigations()[1];
    expect(annulation).toMatchObject({ remplace_sorte: 'annulation', remplace_evenement_id: origine?.id ?? '', date: AUJOURDHUI });
    expect(JSON.parse(String(annulation?.detail))).toEqual({ secteurIrrigationId: VANNE_12, dureeMinutes: 20 });
    expect(validerSaisie({ ...annulation }).ok).toBe(true);
    await toucher(bouton('Fermer', d));
    expect(fermetures).toBe(1);
  });
});

describe('T57 : point d’entrée dans l’écran Aujourd’hui', () => {
  it('le bouton « Irrigation » ouvre la saisie (chargée à la demande)', async () => {
    const ecran = (await import(/* @vite-ignore */ './index.ts')) as ModuleEcranAujourdhui;
    base = creerBaseMemoire(SCHEMA_LOCAL);
    await ecrireFermeDuJour(base, '2026-09-30');
    base.recevoir(`INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom, supprime_le) VALUES (?, ?, 7, 'V7', NULL)`, [VANNE_12, FERME_DU_JOUR]);
    porte = porteSur(base, UTILISATEUR_DU_JOUR, FERME_DU_JOUR);
    await act(async () => {
      racine.render(createElement(ecran.EcranAujourdhui, { porte, fermeId: FERME_DU_JOUR, aujourdhui: () => '2026-09-30' }));
      await Promise.resolve();
    });
    await attendre(() => document.querySelector('[data-testid="tache"]') !== null, 'écran prêt');
    await toucher(bouton('Irrigation'));
    await attendre(() => dialogue('Irrigation') !== undefined && document.querySelector(`[data-testid="${T.saisie}"] option[value="${VANNE_12}"]`) !== null, 'saisie ouverte avec V7');
  });
});
