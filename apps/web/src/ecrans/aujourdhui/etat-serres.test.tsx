// @vitest-environment happy-dom
/**
 * Tests d'acceptation T58 — état des serres sur le téléphone, depuis l'écran Aujourd'hui
 * (docs/backlog/T58-etat-serres.md, règles 2 et 4) : le panneau « État des serres »
 * (aujourdhui/EtatSerres.tsx) change l'état d'un équipement en UN tap, hors ligne, annulable ; le
 * rappel du soir de l'écran Aujourd'hui dit « 2 serres encore ouvertes » à partir de 18 h.
 * Contrat : ./test/contrat-etat-serres.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, dialogueOuEchec, nomAccessible, texte, toucher } from '../itineraires/test/outils.ts';
import { ecrireFermeNeuve, FERME, UTILISATEUR } from '../parcellaire/test/ferme-neuve.ts';
import { ecrireFermeDuJour, FERME as FERME_DU_JOUR, UTILISATEUR as UTILISATEUR_DU_JOUR } from './test/ferme-du-jour.ts';
import {
  AUTRE_FERME,
  CHAMP,
  CHEMIN_ETAT_SERRES,
  ecrireEtat,
  ecrireSerres,
  SERRE_1,
  SERRE_2,
  SERRE_SUPPRIMEE,
  SERRE_VOISINE,
  TESTID_SERRES as T,
  TUNNEL_3,
  type ModuleEtatSerres,
} from './test/contrat-etat-serres.ts';
import type { ModuleEcranAujourdhui } from './test/contrat.ts';

const AUJOURDHUI = '2026-09-30';
// 30 septembre 2026 : heure d'été (UTC+2). 18 h locales = 16 h UTC.
const MATIN = new Date('2026-09-30T07:00:00.000Z');
const DIX_SEPT_H_59 = new Date('2026-09-30T15:59:00.000Z');
const DIX_HUIT_H = new Date('2026-09-30T16:00:00.000Z');

let m: ModuleEtatSerres;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_ETAT_SERRES)) as ModuleEtatSerres;
});

let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let fermetures = 0;
let conteneur: HTMLDivElement;
let racine: Root;
let espionFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fermetures = 0;
  transactions = 0;
  espionFetch = vi.fn(() => Promise.reject(new Error('hors ligne')));
  vi.stubGlobal('fetch', espionFetch);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  base.fermer();
});

function porteSur(b: BaseMemoire, utilisateur: string, ferme: string, maintenant: Date): PorteDonnees {
  const compteuse: BaseLocale = {
    getAll: (sql, p) => b.getAll(sql, p),
    execute: (sql, p) => b.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return b.writeTransaction(fn);
    },
    onChange: (g, o) => b.onChange(g, o),
  };
  return creerPorte(compteuse, { utilisateurId: utilisateur as Id<'Utilisateur'>, fermeId: ferme as Id<'Ferme'>, maintenant: () => maintenant });
}

/** Ferme des serres : Serre 1 ouvrants latéraux ouverts depuis 7 h, portes ouvertes puis fermées. */
function amorcerEtats(ferme: string, auteur: string): void {
  ecrireEtat(base, { fermeId: ferme, zoneId: SERRE_1, equipement: 'ouvrants_lateraux', actif: true, horodatage: '2026-09-30T05:00:00.000Z', auteurId: auteur });
  ecrireEtat(base, { fermeId: ferme, zoneId: SERRE_1, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:30:00.000Z', auteurId: auteur });
  ecrireEtat(base, { fermeId: ferme, zoneId: SERRE_1, equipement: 'portes', actif: false, horodatage: '2026-09-30T06:00:00.000Z', auteurId: auteur });
  // Une écriture d'une AUTRE ferme qui vise une zone de celle-ci : elle ne compte jamais.
  ecrireEtat(base, { fermeId: AUTRE_FERME, zoneId: SERRE_1, equipement: 'voile', actif: true, horodatage: '2026-09-30T06:00:00.000Z', auteurId: auteur });
  ecrireEtat(base, { fermeId: AUTRE_FERME, zoneId: SERRE_VOISINE, equipement: 'portes', actif: true, horodatage: '2026-09-30T06:00:00.000Z', auteurId: auteur });
}

async function ouvrirPanneau(role: 'gerant' | 'equipier' = 'gerant', maintenant: Date = MATIN): Promise<HTMLElement> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeNeuve(base, { role });
  ecrireSerres(base, FERME);
  amorcerEtats(FERME, UTILISATEUR);
  departs = new Set(etats().map((e) => String(e.id)));
  porte = porteSur(base, UTILISATEUR, FERME, maintenant);
  await act(async () => {
    racine.render(
      createElement(m.EtatSerres, {
        porte,
        fermeId: FERME,
        surFermer: () => {
          fermetures++;
        },
        aujourdhui: () => AUJOURDHUI,
        maintenant: () => maintenant,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => document.querySelector(`[data-testid="${T.serre}"]`) !== null, 'serres affichées');
  transactions = 0;
  return dialogueOuEchec('État des serres');
}

const sections = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.serre}"]`)];
const boutons = (zone: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.equipement}"][data-zone="${zone}"]`)];
function equipement(zone: string, nom: string): HTMLElement {
  const b = boutons(zone).find((x) => x.dataset.equipement === nom);
  if (b === undefined) throw new Error(`bouton ${nom} absent de la zone ${zone}`);
  return b;
}

type Ligne = Record<string, string | null>;
const etats = (): Ligne[] => base.lireDirect<Ligne>(`SELECT * FROM evenement WHERE type = 'etat_abri' AND ferme_id = ? ORDER BY horodatage, id`, [FERME]);
/** Identifiants des événements de départ (amorcerEtats) : les nouveaux sont tous les autres, quelle que soit l'heure de la porte. */
let departs = new Set<string>();
const nouveaux = (): Ligne[] => etats().filter((e) => !departs.has(String(e.id)));

describe('T58 : panneau « État des serres »', () => {
  it('une section par abri de la ferme, par nom : Serre 1, Serre 2, Tunnel 3 ; ni plein champ, ni serre supprimée, ni serre du voisin', async () => {
    const d = await ouvrirPanneau();
    expect(d.getAttribute('role')).toBe('dialog');
    expect(sections().map((s) => s.dataset.zone)).toEqual([SERRE_1, SERRE_2, TUNNEL_3]);
    expect(sections().map((s) => texte(s.querySelector('h2, h3')))).toEqual(['Serre 1', 'Serre 2', 'Tunnel 3']);
    for (const absente of [CHAMP, SERRE_SUPPRIMEE, SERRE_VOISINE]) expect(sections().some((s) => s.dataset.zone === absente), absente).toBe(false);
  });

  it('équipements par défaut : serre = cinq boutons, tunnel = trois ; liste modifiée de Serre 2 = deux', async () => {
    await ouvrirPanneau();
    expect(boutons(SERRE_1).map((b) => b.dataset.equipement)).toEqual(['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile']);
    expect(boutons(TUNNEL_3).map((b) => b.dataset.equipement)).toEqual(['ouvrants_lateraux', 'portes', 'voile']);
    expect(boutons(SERRE_2).map((b) => b.dataset.equipement)).toEqual(['ouvrants_lateraux', 'portes']);
  });

  it('états d’après le journal : ouvrants ouverts, portes refermées, chauffage inconnu ; l’écriture d’une autre ferme ne compte pas', async () => {
    await ouvrirPanneau();
    const o = equipement(SERRE_1, 'ouvrants_lateraux');
    expect([o.getAttribute('aria-pressed'), o.dataset.etat]).toEqual(['true', 'actif']);
    expect(texte(o)).toMatch(/ouvrants latéraux ouverts/i);
    expect(nomAccessible(o)).toMatch(/^Serre 1 : /);
    const p = equipement(SERRE_1, 'portes');
    expect([p.getAttribute('aria-pressed'), p.dataset.etat]).toEqual(['false', 'inactif']);
    expect(texte(p)).toMatch(/portes fermées/i);
    const c = equipement(SERRE_1, 'chauffage');
    expect([c.getAttribute('aria-pressed'), c.dataset.etat]).toEqual(['false', 'inconnu']);
    expect(texte(c)).toMatch(/chauffage éteint/i);
    // Le voile de Serre 1 « posé » par l'autre ferme n'est pas à nous.
    expect(equipement(SERRE_1, 'voile').dataset.etat).toBe('inconnu');
    expect(boutons(SERRE_2).every((b) => b.dataset.etat === 'inconnu')).toBe(true);
  });

  it('les boutons ont la taille d’un doigt (44 px au moins)', async () => {
    await ouvrirPanneau();
    for (const b of boutons(SERRE_1)) {
      const r = b.getBoundingClientRect();
      const minHauteur = Number.parseFloat(b.style.minHeight || '0');
      const minLargeur = Number.parseFloat(b.style.minWidth || '0');
      expect(Math.max(r.height, minHauteur), b.dataset.equipement).toBeGreaterThanOrEqual(44);
      expect(Math.max(r.width, minLargeur), b.dataset.equipement).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('T58 : un tap, hors ligne', () => {
  it('Serre 1, faîtage, état inconnu : un tap écrit « ouvert », en une transaction, accepté par le cœur, sans réseau', async () => {
    await ouvrirPanneau();
    await toucher(equipement(SERRE_1, 'ouvrants_faitage'));
    await attendre(() => nouveaux().length === 1, 'événement écrit');
    expect(transactions).toBe(1);
    expect(espionFetch).not.toHaveBeenCalled();
    const e = nouveaux()[0] ?? {};
    expect(e).toMatchObject({ ferme_id: FERME, type: 'etat_abri', date: AUJOURDHUI, source: 'tap', auteur_id: UTILISATEUR, serie_id: null, campagne_id: null, remplace_sorte: null });
    expect(JSON.parse(String(e.emplacement_ids))).toEqual([]);
    expect(JSON.parse(String(e.detail))).toEqual({ zoneId: SERRE_1, equipement: 'ouvrants_faitage', actif: true });
    expect(validerSaisie({ ...e }).ok).toBe(true);
    await attendre(() => equipement(SERRE_1, 'ouvrants_faitage').getAttribute('aria-pressed') === 'true', 'bouton passé à ouvert');
    expect(texte(document.querySelector(`[data-testid="${T.enregistre}"]`))).toContain('Serre 1 : ouvrants de faîtage ouverts');
  });

  it('un tap sur un équipement déjà ouvert le ferme : le contraire de l’état courant', async () => {
    await ouvrirPanneau();
    await toucher(equipement(SERRE_1, 'ouvrants_lateraux'));
    await attendre(() => nouveaux().length === 1, 'événement écrit');
    expect(JSON.parse(String(nouveaux()[0]?.detail))).toEqual({ zoneId: SERRE_1, equipement: 'ouvrants_lateraux', actif: false });
    await attendre(() => equipement(SERRE_1, 'ouvrants_lateraux').getAttribute('aria-pressed') === 'false', 'bouton passé à fermé');
    expect(texte(document.querySelector(`[data-testid="${T.enregistre}"]`))).toContain('Serre 1 : ouvrants latéraux fermés');
  });

  it('chauffage, voile et portes : « chauffage allumé », « voile posé », « portes ouvertes »', async () => {
    await ouvrirPanneau();
    await toucher(equipement(TUNNEL_3, 'voile'));
    await attendre(() => texte(document.querySelector(`[data-testid="${T.enregistre}"]`)).includes('Tunnel 3 : voile posé'), 'voile posé');
    await toucher(equipement(SERRE_1, 'chauffage'));
    await attendre(() => texte(document.querySelector(`[data-testid="${T.enregistre}"]`)).includes('Serre 1 : chauffage allumé'), 'chauffage allumé');
    await toucher(equipement(SERRE_1, 'portes'));
    await attendre(() => texte(document.querySelector(`[data-testid="${T.enregistre}"]`)).includes('Serre 1 : portes ouvertes'), 'portes ouvertes');
  });

  it('« Annuler » écrit l’annulation (même détail), en une transaction, et le bouton retrouve son état', async () => {
    await ouvrirPanneau();
    await toucher(equipement(SERRE_1, 'ouvrants_faitage'));
    await attendre(() => document.querySelector(`[data-testid="${T.enregistre}"]`) !== null, 'enregistré');
    const origine = nouveaux()[0];
    transactions = 0;
    await toucher(bouton('Annuler', document.querySelector<HTMLElement>(`[data-testid="${T.enregistre}"]`) ?? document));
    await attendre(() => nouveaux().length === 2, 'annulation écrite');
    expect(transactions).toBe(1);
    const annulation = nouveaux()[1];
    expect(annulation).toMatchObject({ type: 'etat_abri', remplace_sorte: 'annulation', remplace_evenement_id: origine?.id ?? '', date: AUJOURDHUI });
    expect(JSON.parse(String(annulation?.detail))).toEqual({ zoneId: SERRE_1, equipement: 'ouvrants_faitage', actif: true });
    expect(validerSaisie({ ...annulation }).ok).toBe(true);
    await attendre(() => equipement(SERRE_1, 'ouvrants_faitage').dataset.etat === 'inconnu', 'état d’avant (inconnu)');
    expect(document.querySelector(`[data-testid="${T.enregistre}"]`)).toBeNull();
  });

  it('un équipier change l’état aussi (on ferme le soir sans être gérant)', async () => {
    await ouvrirPanneau('equipier');
    await toucher(equipement(TUNNEL_3, 'portes'));
    await attendre(() => nouveaux().length === 1, 'événement écrit');
    expect(JSON.parse(String(nouveaux()[0]?.detail))).toEqual({ zoneId: TUNNEL_3, equipement: 'portes', actif: true });
  });

  it('un événement écrit pour la zone d’une autre ferme n’est jamais produit : seules les zones de la ferme ont des boutons', async () => {
    await ouvrirPanneau();
    expect(boutons(SERRE_VOISINE)).toEqual([]);
    expect(base.lireDirect(`SELECT 1 FROM evenement WHERE type = 'etat_abri' AND ferme_id = ?`, [AUTRE_FERME]).length).toBe(2);
  });

  it('« Fermer » ferme le panneau', async () => {
    const d = await ouvrirPanneau();
    await toucher(bouton('Fermer', d));
    expect(fermetures).toBe(1);
  });
});

describe('T58 : depuis l’écran Aujourd’hui', () => {
  async function ouvrirEcran(maintenant: Date, auteur = UTILISATEUR_DU_JOUR): Promise<void> {
    const ecran = (await import(/* @vite-ignore */ './index.ts')) as ModuleEcranAujourdhui & { EcranAujourdhui: ModuleEcranAujourdhui['EcranAujourdhui'] };
    base = creerBaseMemoire(SCHEMA_LOCAL);
    await ecrireFermeDuJour(base, AUJOURDHUI);
    ecrireSerres(base, FERME_DU_JOUR);
    // Serre 1 : ouvrants latéraux ouverts ; Serre 2 : portes ouvertes ; Tunnel 3 : fermé ; une serre du voisin ouverte.
    ecrireEtat(base, { fermeId: FERME_DU_JOUR, zoneId: SERRE_1, equipement: 'ouvrants_lateraux', actif: true, horodatage: '2026-09-30T05:00:00.000Z', auteurId: auteur });
    ecrireEtat(base, { fermeId: FERME_DU_JOUR, zoneId: SERRE_2, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:10:00.000Z', auteurId: auteur });
    ecrireEtat(base, { fermeId: FERME_DU_JOUR, zoneId: TUNNEL_3, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:20:00.000Z', auteurId: auteur });
    ecrireEtat(base, { fermeId: FERME_DU_JOUR, zoneId: TUNNEL_3, equipement: 'portes', actif: false, horodatage: '2026-09-30T05:40:00.000Z', auteurId: auteur });
    ecrireEtat(base, { fermeId: AUTRE_FERME, zoneId: SERRE_VOISINE, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:00:00.000Z', auteurId: auteur });
    porte = porteSur(base, auteur, FERME_DU_JOUR, maintenant);
    await act(async () => {
      racine.render(createElement(ecran.EcranAujourdhui, { porte, fermeId: FERME_DU_JOUR, aujourdhui: () => AUJOURDHUI, maintenant: () => maintenant } as never));
      await Promise.resolve();
    });
    await attendre(() => document.querySelector('[data-testid="tache"]') !== null, 'écran prêt');
  }

  const rappel = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.rappel}"]`);

  it('le bouton « Serres » ouvre le panneau (chargé à la demande), avec les abris de la ferme', async () => {
    await ouvrirEcran(MATIN);
    await toucher(bouton('Serres'));
    await attendre(() => document.querySelector(`[data-testid="${T.panneau}"]`) !== null && sections().length > 0, 'panneau ouvert');
    expect(sections().map((s) => s.dataset.zone)).toContain(SERRE_1);
    expect(sections().some((s) => s.dataset.zone === SERRE_VOISINE)).toBe(false);
  });

  it('rappel du soir : à 18 h 00, « 2 serres encore ouvertes » (le tunnel refermé et la serre du voisin ne comptent pas)', async () => {
    await ouvrirEcran(DIX_HUIT_H);
    await attendre(() => rappel() !== null, 'rappel affiché');
    expect(rappel()?.getAttribute('role')).toBe('status');
    expect(texte(rappel())).toContain('2 serres encore ouvertes');
  });

  it('17 h 59 : pas de rappel ; le matin non plus', async () => {
    await ouvrirEcran(DIX_SEPT_H_59);
    await new Promise((r) => setTimeout(r, 50));
    expect(rappel()).toBeNull();
  });

  it('« Voir les serres » ouvre le panneau ; refermer les serres met le rappel à jour : 1 serre, puis plus rien', async () => {
    await ouvrirEcran(DIX_HUIT_H);
    await attendre(() => rappel() !== null, 'rappel affiché');
    await toucher(bouton('Voir les serres', rappel() ?? document));
    await attendre(() => document.querySelector(`[data-testid="${T.panneau}"]`) !== null && sections().length > 0, 'panneau ouvert');
    transactions = 0;
    await toucher(equipement(SERRE_2, 'portes'));
    await attendre(() => texte(rappel()).includes('1 serre encore ouverte') && !texte(rappel()).includes('1 serres'), 'une serre restante');
    expect(transactions).toBe(1);
    await toucher(equipement(SERRE_1, 'ouvrants_lateraux'));
    await attendre(() => rappel() === null, 'plus de rappel');
  });

  it('une serre refermée puis réouverte par erreur : l’annulation la remet dans le compte', async () => {
    await ouvrirEcran(DIX_HUIT_H);
    await attendre(() => rappel() !== null, 'rappel affiché');
    await toucher(bouton('Voir les serres', rappel() ?? document));
    await attendre(() => sections().length > 0, 'panneau ouvert');
    await toucher(equipement(SERRE_2, 'portes'));
    await attendre(() => texte(rappel()).includes('1 serre encore ouverte'), 'une serre restante');
    await toucher(bouton('Annuler', document.querySelector<HTMLElement>(`[data-testid="${T.enregistre}"]`) ?? document));
    await attendre(() => texte(rappel()).includes('2 serres encore ouvertes'), 'deux serres de nouveau');
  });
});
