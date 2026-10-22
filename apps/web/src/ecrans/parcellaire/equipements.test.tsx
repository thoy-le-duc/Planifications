// @vitest-environment happy-dom
/**
 * Tests d'acceptation T82 — équipements d'une serre, dans la fiche de zone de « Ma ferme »
 * (docs/backlog/T82-equipements-abri-ecran.md). Vrai écran dans un DOM simulé (happy-dom), ferme
 * neuve de T49. La colonne `zone.equipements_abri` est un tableau JSON (texte) ; nulle : liste par
 * défaut du type d'abri. Le panneau « État des serres » d'Aujourd'hui (T58) est rendu sur la même
 * base pour vérifier qu'un équipement décoché disparaît. Chaque geste = UNE transaction locale.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EtatSerres } from '../aujourdhui/EtatSerres.tsx';
import type { ModuleParcellaire, ProprietesEcranParcellaire } from './test/contrat.ts';
import { FERME } from './test/ferme-neuve.ts';
import { actifs, AUJOURDHUI, creerBanc, lire, MAINTENANT, zones, type Banc } from './test/outils.ts';
import { attendre, bouton, champ, coche, dialogue, dialogueOuEchec, liste, nomAccessible, region, remplir, toucher, aBouton } from '../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModuleParcellaire;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleParcellaire;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
});

async function ouvrir(p: Partial<ProprietesEcranParcellaire> = {}): Promise<HTMLElement> {
  const proprietes: ProprietesEcranParcellaire = {
    porte: b.porte,
    fermeId: FERME,
    aujourdhui: () => AUJOURDHUI,
    maintenant: () => MAINTENANT,
    surFermer: () => undefined,
    surImporter: () => undefined,
    ...p,
  };
  await act(async () => {
    racine.render(createElement(m.EcranParcellaire, proprietes));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Ma ferme') !== undefined, 'dialogue « Ma ferme »');
  await attendre(() => document.querySelector('[data-testid="parcellaire-pret"]') !== null || aBouton(/^Créer la saison/) || aBouton('Nouvelle saison'), 'listes lues');
  return dialogueOuEchec('Ma ferme');
}

const bandeau = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="saisie-annulable"]');

async function creerZone(nom: string, type: string, parente = ''): Promise<string> {
  await toucher(bouton('Nouvelle zone'));
  const d = dialogueOuEchec('Nouvelle zone');
  await remplir(champ('Nom', d), nom);
  await remplir(liste('Type d’abri', d), type);
  if (parente !== '') await remplir(liste('Dans la zone', d), parente);
  b.remiseAZero();
  await toucher(bouton('Enregistrer', d));
  await attendre(() => dialogue('Nouvelle zone') === undefined, 'zone enregistrée');
  const z = actifs(zones(b)).find((x) => x.nom === nom);
  if (z === undefined) throw new Error(`zone ${nom} absente`);
  return String(z.id);
}

async function ouvrirZone(nom: string): Promise<HTMLElement> {
  await toucher(bouton(`Ouvrir ${nom}`));
  await attendre(() => dialogue(nom) !== undefined, `dialogue de la zone ${nom}`);
  return dialogueOuEchec(nom);
}


let panneau: HTMLDivElement | null = null;
let racinePanneau: Root | null = null;

afterEach(() => {
  if (racinePanneau !== null) {
    const r = racinePanneau;
    act(() => {
      r.unmount();
    });
  }
  panneau?.remove();
  panneau = null;
  racinePanneau = null;
});

/** Le panneau « État des serres » d'Aujourd'hui, sur la même base. */
async function ouvrirPanneau(): Promise<HTMLElement> {
  panneau = document.createElement('div');
  document.body.append(panneau);
  racinePanneau = createRoot(panneau);
  const r = racinePanneau;
  await act(async () => {
    r.render(createElement(EtatSerres, { porte: b.porte, fermeId: FERME, surFermer: () => undefined, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT }));
    await Promise.resolve();
  });
  await attendre(() => dialogue('État des serres') !== undefined, 'panneau Serres');
  return dialogueOuEchec('État des serres');
}

const equipementsDe = (zoneId: string): unknown => {
  const v = lire(b, 'SELECT equipements_abri FROM zone WHERE id = ?', [zoneId])[0]?.equipements_abri;
  return typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
};
const NOMS = ['ouvrants latéraux', 'ouvrants de faîtage', 'portes', 'chauffage', 'voile ou filet'] as const;
const section = (d: HTMLElement): HTMLElement => region('Équipements', d);
const caseDe = (d: HTMLElement, nom: string): HTMLInputElement => champ(nom, section(d));
const cochees = (d: HTMLElement): string[] => NOMS.filter((n) => coche(caseDe(d, n)));
const boutonsPanneau = (p: HTMLElement): string[] => [...p.querySelectorAll('button')].map(nomAccessible);

describe('T82 : équipements d’une serre', () => {
  it('section Équipements : cinq cases, pré-cochées selon le défaut du type (tunnel, serre)', async () => {
    await ouvrir();
    await creerZone('Tunnel 1', 'tunnel');
    await creerZone('Serre A', 'serre');
    const t = await ouvrirZone('Tunnel 1');
    expect(NOMS.map((n) => nomAccessible(caseDe(t, n)))).toEqual([...NOMS]);
    expect(cochees(t)).toEqual(['ouvrants latéraux', 'portes', 'voile ou filet']);
    await toucher(bouton('Fermer', t));
    await attendre(() => dialogue('Tunnel 1') === undefined, 'fiche fermée');
    const s = await ouvrirZone('Serre A');
    expect(cochees(s)).toEqual([...NOMS]);
  });

  it('décocher « voile ou filet » sur un tunnel : liste sans voile (une transaction) ; le panneau Serres ne montre plus la voile', async () => {
    await ouvrir();
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const d = await ouvrirZone('Tunnel 1');
    b.remiseAZero();
    await toucher(caseDe(d, 'voile ou filet'));
    await attendre(() => equipementsDe(tunnel) !== null, 'liste écrite');
    expect(equipementsDe(tunnel)).toEqual(['ouvrants_lateraux', 'portes']);
    expect(b.transactions()).toBe(1);
    expect(cochees(d)).toEqual(['ouvrants latéraux', 'portes']);
    expect(lire(b, "SELECT COUNT(*) AS n FROM evenement WHERE type = 'etat_abri'")[0]?.n, 'le journal n’est pas touché').toBe(0);
    const p = await ouvrirPanneau();
    await attendre(() => boutonsPanneau(p).some((n) => n.includes('portes')), 'équipements du tunnel');
    expect(boutonsPanneau(p).some((n) => n.includes('voile'))).toBe(false);
    expect(boutonsPanneau(p).some((n) => n.includes('ouvrants latéraux'))).toBe(true);
  });

  it('cocher un équipement en plus (chauffage) : liste en ordre canonique ; tout décocher : liste vide, plus rien au panneau', async () => {
    await ouvrir();
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const d = await ouvrirZone('Tunnel 1');
    await toucher(caseDe(d, 'chauffage'));
    await attendre(() => equipementsDe(tunnel) !== null, 'liste écrite');
    expect(equipementsDe(tunnel)).toEqual(['ouvrants_lateraux', 'portes', 'chauffage', 'voile']);
    for (const n of cochees(d)) await toucher(caseDe(d, n));
    await attendre(() => (equipementsDe(tunnel) as unknown[]).length === 0, 'liste vide');
    expect(equipementsDe(tunnel)).toEqual([]);
    const p = await ouvrirPanneau();
    expect(texte0(p)).toMatch(/Aucune serre ni tunnel avec des équipements/);
  });

  it('« Revenir aux équipements par défaut » remet la colonne à nulle ; « Annuler » rend la liste d’avant', async () => {
    await ouvrir();
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const d = await ouvrirZone('Tunnel 1');
    await toucher(caseDe(d, 'voile ou filet'));
    await attendre(() => equipementsDe(tunnel) !== null, 'liste écrite');
    b.remiseAZero();
    await toucher(bouton('Revenir aux équipements par défaut', d));
    await attendre(() => equipementsDe(tunnel) === null, 'colonne nulle');
    expect(lire(b, 'SELECT equipements_abri FROM zone WHERE id = ?', [tunnel])[0]?.equipements_abri).toBeNull();
    expect(b.transactions()).toBe(1);
    expect(cochees(d)).toEqual(['ouvrants latéraux', 'portes', 'voile ou filet']);
    const ba = bandeau();
    expect(ba, 'bandeau « Annuler »').not.toBeNull();
    if (ba !== null) await toucher(bouton('Annuler', ba));
    await attendre(() => equipementsDe(tunnel) !== null, 'liste d’avant rétablie');
    expect(equipementsDe(tunnel)).toEqual(['ouvrants_lateraux', 'portes']);
  });

  it('deux taps rapides (sans attendre la base ni l’écran) : les deux changements sont dans la colonne', async () => {
    await ouvrir();
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const d = await ouvrirZone('Tunnel 1');
    await act(async () => {
      caseDe(d, 'voile ou filet').click();
      caseDe(d, 'chauffage').click();
      await Promise.resolve();
    });
    await attendre(() => (equipementsDe(tunnel) as unknown[] | null)?.length === 3, 'les deux changements écrits');
    expect(equipementsDe(tunnel)).toEqual(['ouvrants_lateraux', 'portes', 'chauffage']);
    expect(cochees(d)).toEqual(['ouvrants latéraux', 'portes', 'chauffage']);
  });

  it('zone de plein champ : pas de section Équipements ; elle apparaît quand on passe la zone en tunnel', async () => {
    await ouvrir();
    await creerZone('Îlot', 'plein_champ');
    const d = await ouvrirZone('Îlot');
    expect(d.querySelector('section[aria-label="Équipements"]')).toBeNull();
    expect(aBouton('Revenir aux équipements par défaut', d)).toBe(false);
    await toucher(bouton('Modifier la zone', d));
    const f = dialogueOuEchec('Modifier la zone');
    await remplir(liste('Type d’abri', f), 'tunnel');
    await toucher(bouton('Enregistrer', f));
    await attendre(() => dialogue('Modifier la zone') === undefined, 'zone enregistrée');
    expect(cochees(dialogueOuEchec('Îlot'))).toEqual(['ouvrants latéraux', 'portes', 'voile ou filet']);
    expect(actifs(zones(b))[0]).toMatchObject({ type_abri: 'tunnel', equipements_abri: null });
  });
});

const texte0 = (el: Element): string => el.textContent.replace(/\s+/g, ' ');
