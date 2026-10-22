// @vitest-environment happy-dom
/**
 * Tests d'acceptation T58 — les serres dans la vue 3D, composant (plan3d/Abris3d.tsx) : repères
 * des abris avec leurs ouvrants ouverts (attributs de test), filtre « Serres », et le changement
 * d'état en un tap HORS LIGNE depuis la 3D (base mémoire du téléphone, aucun réseau), annulable.
 * Le composant n'importe pas three. Contrat : ./test/contrat-abris.ts.
 */
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { validerSaisie, type Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, dialogueOuEchec, nomAccessible, texte, toucher } from '../itineraires/test/outils.ts';
import { ecrireFermeNeuve, FERME, UTILISATEUR } from '../parcellaire/test/ferme-neuve.ts';
import { AUTRE_FERME, CHAMP, ecrireEtat, ecrireSerres, SERRE_1, SERRE_2, SERRE_VOISINE, TESTID_SERRES, TUNNEL_3 } from '../aujourdhui/test/contrat-etat-serres.ts';
import { appliquerFiltres, COULEUR_ESTOMPEE, FILTRES_TOUT, type BatimentScene, type Scene } from './scene.ts';
import { CHEMIN_COMPOSANT_ABRIS_3D, TESTID_ABRIS_3D as T, type EtatAbris3d, type ModuleComposantAbris3d } from './test/contrat-abris.ts';

const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');

let m: ModuleComposantAbris3d;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_COMPOSANT_ABRIS_3D)) as ModuleComposantAbris3d;
});

const bat = (id: string, nom: string, zoneId: string | null, x: number): BatimentScene => ({
  id,
  nom,
  type: zoneId === null ? 'hangar' : 'serre_chapelle',
  zoneId,
  x,
  z: -10,
  largeur: 8,
  profondeur: 40,
  hauteur: 3.5,
  angle: 0,
  forme: 'tunnel',
  arceaux: [],
  nefs: 1,
  opacite: 0.4,
  couleur: '#cccccc',
});
// Trouvés dans un ordre qui n'est pas celui des noms : la couche trie par nom de zone.
const B_TUNNEL = bat('b-t3', 'Tunnel 3', TUNNEL_3, 40);
const B_SERRE_2 = bat('b-s2', 'Serre 2', SERRE_2, 20);
const B_SERRE_1 = bat('b-s1', 'Serre 1', SERRE_1, 0);
const B_HANGAR = bat('b-h', 'Hangar', null, 60);
const B_CHAMP = bat('b-pc', 'Abri de jardin', CHAMP, 80);
const B_VOISIN = bat('b-v', 'Serre du voisin', SERRE_VOISINE, 100);
const BATIMENTS = [B_TUNNEL, B_SERRE_2, B_SERRE_1, B_HANGAR, B_CHAMP, B_VOISIN];
const SCENE: Scene = {
  semaine: 0,
  libelleSemaine: 'S40',
  socles: [],
  batiments: BATIMENTS,
  volumes: [{ id: 'p1', code: 'P1', zoneId: SERRE_1, x: 0, z: -10, longueur: 30, largeur: 0.8, hauteur: 0.3, angle: 0, placee: true, couleur: '#336633', cleFamille: null, culture: 'Fraise', occupationId: null }],
};

let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;
let etatsVus: EtatAbris3d[];
let espionFetch: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  etatsVus = [];
  transactions = 0;
  espionFetch = vi.fn(() => Promise.reject(new Error('hors ligne')));
  vi.stubGlobal('fetch', espionFetch);
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeNeuve(base);
  ecrireSerres(base, FERME);
  // Serre 1 : ouvrants latéraux ouverts depuis 7 h, chauffage allumé ; Serre 2 : portes ouvertes puis fermées ;
  // Tunnel 3 : voile posé. Une serre du voisin ouverte, et une écriture d'une autre ferme qui vise Serre 2.
  ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_1, equipement: 'ouvrants_lateraux', actif: true, horodatage: '2026-09-30T05:00:00.000Z', auteurId: UTILISATEUR });
  ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_1, equipement: 'chauffage', actif: true, horodatage: '2026-09-30T04:00:00.000Z', auteurId: UTILISATEUR });
  ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_2, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:30:00.000Z', auteurId: UTILISATEUR });
  ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_2, equipement: 'portes', actif: false, horodatage: '2026-09-30T07:00:00.000Z', auteurId: UTILISATEUR });
  ecrireEtat(base, { fermeId: FERME, zoneId: TUNNEL_3, equipement: 'voile', actif: true, horodatage: '2026-09-30T04:30:00.000Z', auteurId: UTILISATEUR });
  ecrireEtat(base, { fermeId: AUTRE_FERME, zoneId: SERRE_VOISINE, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:00:00.000Z', auteurId: UTILISATEUR });
  ecrireEtat(base, { fermeId: AUTRE_FERME, zoneId: SERRE_2, equipement: 'portes', actif: true, horodatage: '2026-09-30T08:00:00.000Z', auteurId: UTILISATEUR });
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  vi.unstubAllGlobals();
  base.fermer();
});

async function rendre(): Promise<void> {
  const couche = createRef<HTMLDivElement>();
  await act(async () => {
    racine.render(
      createElement(m.Abris3d, {
        porte,
        fermeId: FERME,
        batiments: BATIMENTS,
        couche,
        surEtat: (e: EtatAbris3d) => {
          etatsVus.push(e);
        },
        aujourdhui: () => AUJOURDHUI,
        maintenant: () => MAINTENANT,
      }),
    );
    await Promise.resolve();
  });
  await attendre(() => reperes().length > 0, 'repères affichés');
  expect(couche.current?.dataset.testid).toBe(T.couche);
}

const reperes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.repere}"]`)];
const repere = (batiment: string): HTMLElement => {
  const r = reperes().find((x) => x.dataset.batiment === batiment);
  if (r === undefined) throw new Error(`repère ${batiment} absent`);
  return r;
};
const dernier = (): EtatAbris3d => {
  const e = etatsVus.at(-1);
  if (e === undefined) throw new Error('surEtat jamais appelé');
  return e;
};
const fiche = (): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${T.fiche}"]`);
const equipement = (zone: string, nom: string): HTMLElement => {
  const b = [...document.querySelectorAll<HTMLElement>(`[data-testid="${TESTID_SERRES.equipement}"]`)].find((x) => x.dataset.zone === zone && x.dataset.equipement === nom);
  if (b === undefined) throw new Error(`bouton ${nom} absent`);
  return b;
};
type Ligne = Record<string, string | null>;
const nouveaux = (): Ligne[] => base.lireDirect<Ligne>(`SELECT * FROM evenement WHERE type = 'etat_abri' AND ferme_id = ? AND horodatage >= '2026-09-30T10' ORDER BY horodatage, id`, [FERME]);

describe('T58 : repères des serres dans la 3D, ouvrants ouverts visibles', () => {
  it('un repère par abri de la ferme, par nom : Serre 1, Serre 2, Tunnel 3 ; ni hangar, ni plein champ, ni serre du voisin', async () => {
    await rendre();
    expect(reperes().map((r) => texte(r))).toEqual(['Serre 1', 'Serre 2', 'Tunnel 3']);
    expect(reperes().map((r) => r.dataset.batiment)).toEqual(['b-s1', 'b-s2', 'b-t3']);
    expect(reperes().every((r) => r.tagName === 'BUTTON')).toBe(true);
    expect(dernier().reperes.map((r) => [r.pastille.x, r.pastille.z])).toEqual([
      [0, -10],
      [20, -10],
      [40, -10],
    ]);
  });

  it('attributs de test : Serre 1 a ses ouvrants latéraux ouverts et le chauffage allumé ; Serre 2 est refermée ; le tunnel a son voile', async () => {
    await rendre();
    const s1 = repere('b-s1');
    expect([s1.dataset.ouvert, s1.dataset.ouverts, s1.dataset.chauffage, s1.dataset.voile, s1.dataset.zone]).toEqual(['oui', 'ouvrants_lateraux', 'oui', 'non', SERRE_1]);
    expect(nomAccessible(s1)).toBe('Serre 1 : ouverte');
    const s2 = repere('b-s2');
    // La porte ouverte à 5 h 30, refermée à 7 h ; l'écriture de l'autre ferme n'y change rien.
    expect([s2.dataset.ouvert, s2.dataset.ouverts, s2.dataset.chauffage]).toEqual(['non', '', 'non']);
    expect(nomAccessible(s2)).toBe('Serre 2 : fermée');
    const t3 = repere('b-t3');
    expect([t3.dataset.ouvert, t3.dataset.ouverts, t3.dataset.voile]).toEqual(['non', '', 'oui']);
  });

  it('surEtat donne à la vue de quoi dessiner : ouvertures de chaque bâtiment posées dans la scène', async () => {
    await rendre();
    expect(dernier().etats.get('b-s1')?.ouvertures).toEqual({ lateraux: true, faitage: false, portes: false, chauffage: true, voile: false });
    const scene = dernier().poser(SCENE);
    const ouvertures = Object.fromEntries(scene.batiments.map((b) => [b.id, (b as BatimentScene & { ouvertures?: unknown }).ouvertures]));
    expect(ouvertures['b-s1']).toEqual({ lateraux: true, faitage: false, portes: false, chauffage: true, voile: false });
    expect(ouvertures['b-h']).toBeUndefined();
  });

  it('les boutons ont la taille d’un doigt (44 px au moins)', async () => {
    await rendre();
    for (const r of reperes()) {
      const rect = r.getBoundingClientRect();
      expect(Math.max(rect.height, Number.parseFloat(r.style.minHeight || '0'))).toBeGreaterThanOrEqual(44);
      expect(Math.max(rect.width, Number.parseFloat(r.style.minWidth || '0'))).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('T58 : filtre « Serres »', () => {
  it('bascule « Serres » : légende « Ouverte / Fermée » ; Serre 1 en couleur vive, les autres abris en fermé, le reste estompé', async () => {
    await rendre();
    const filtre = document.querySelector<HTMLElement>(`[data-testid="${T.filtre}"]`);
    if (filtre === null) throw new Error('filtre absent');
    expect(texte(filtre)).toContain('Serres');
    expect(filtre.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector(`[data-testid="${T.legende}"]`)).toBeNull();
    expect(dernier().filtre).toBe(false);
    await toucher(filtre);
    expect(filtre.getAttribute('aria-pressed')).toBe('true');
    expect(dernier().filtre).toBe(true);
    const legende = texte(document.querySelector(`[data-testid="${T.legende}"]`));
    expect(legende).toContain('Ouverte');
    expect(legende).toContain('Fermée');
    const filtree = dernier().colorer(appliquerFiltres(SCENE, FILTRES_TOUT));
    const c = Object.fromEntries(filtree.batiments.map((b) => [b.id, b.couleur]));
    expect(new Set([c['b-s1'], c['b-s2'], c['b-h']]).size).toBe(3);
    expect(c['b-s2']).toBe(c['b-t3']);
    expect(c['b-h']).toBe(COULEUR_ESTOMPEE);
    expect(filtree.volumes[0]?.estompe).toBe(false);
  });

  it('filtre éteint de nouveau : la scène revient telle quelle', async () => {
    await rendre();
    const filtre = document.querySelector<HTMLElement>(`[data-testid="${T.filtre}"]`);
    if (filtre === null) throw new Error('filtre absent');
    await toucher(filtre);
    await toucher(filtre);
    const filtree = appliquerFiltres(SCENE, FILTRES_TOUT);
    expect(dernier().colorer(filtree)).toBe(filtree);
  });
});

describe('T58 : changement d’état en un tap depuis la 3D, hors ligne', () => {
  it('tap sur Serre 2 : la fiche liste ses équipements (ouvrants latéraux, portes : sa liste à elle)', async () => {
    await rendre();
    await toucher(repere('b-s2'));
    const f = fiche();
    expect(f?.getAttribute('role')).toBe('dialog');
    dialogueOuEchec('Serre 2');
    const boutons = [...(f?.querySelectorAll<HTMLElement>(`[data-testid="${TESTID_SERRES.equipement}"]`) ?? [])];
    expect(boutons.map((b) => b.dataset.equipement)).toEqual(['ouvrants_lateraux', 'portes']);
    await toucher(repere('b-s2'));
    expect(fiche()).toBeNull();
  });

  it('« portes » de Serre 2 : un tap écrit l’événement dans la base du téléphone, en une transaction, sans réseau ; le repère passe à ouvert', async () => {
    await rendre();
    await toucher(repere('b-s2'));
    transactions = 0;
    await toucher(equipement(SERRE_2, 'portes'));
    await attendre(() => nouveaux().length === 1, 'événement écrit');
    expect(transactions).toBe(1);
    expect(espionFetch).not.toHaveBeenCalled();
    const e = nouveaux()[0] ?? {};
    expect(e).toMatchObject({ type: 'etat_abri', source: 'tap', date: AUJOURDHUI, ferme_id: FERME, serie_id: null, campagne_id: null });
    expect(JSON.parse(String(e.detail))).toEqual({ zoneId: SERRE_2, equipement: 'portes', actif: true });
    expect(validerSaisie({ ...e }).ok).toBe(true);
    await attendre(() => repere('b-s2').dataset.ouvert === 'oui', 'repère passé à ouvert');
    expect(repere('b-s2').dataset.ouverts).toBe('portes');
    expect(dernier().etats.get('b-s2')?.ouvertures.portes).toBe(true);
    expect(texte(document.querySelector(`[data-testid="${TESTID_SERRES.enregistre}"]`))).toContain('Serre 2 : portes ouvertes');
  });

  it('refermer les ouvrants de Serre 1 : le contraire de l’état courant ; « Annuler » les rouvre', async () => {
    await rendre();
    await toucher(repere('b-s1'));
    await toucher(equipement(SERRE_1, 'ouvrants_lateraux'));
    await attendre(() => repere('b-s1').dataset.ouvert === 'non', 'Serre 1 fermée');
    expect(JSON.parse(String(nouveaux()[0]?.detail))).toEqual({ zoneId: SERRE_1, equipement: 'ouvrants_lateraux', actif: false });
    transactions = 0;
    await toucher(bouton('Annuler', document.querySelector<HTMLElement>(`[data-testid="${TESTID_SERRES.enregistre}"]`) ?? document));
    await attendre(() => repere('b-s1').dataset.ouvert === 'oui', 'Serre 1 rouverte');
    expect(transactions).toBe(1);
    expect(nouveaux()[1]).toMatchObject({ remplace_sorte: 'annulation', remplace_evenement_id: nouveaux()[0]?.id ?? '' });
    expect(validerSaisie({ ...nouveaux()[1] }).ok).toBe(true);
  });

  it('« Fermer » ferme la fiche', async () => {
    await rendre();
    await toucher(repere('b-t3'));
    await toucher(bouton('Fermer', fiche() ?? document));
    expect(fiche()).toBeNull();
  });
});
