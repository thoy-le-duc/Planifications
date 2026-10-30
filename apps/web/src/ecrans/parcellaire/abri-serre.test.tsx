// @vitest-environment happy-dom
/**
 * Tests d'acceptation T92, règle 3 (docs/backlog/T92-nettoyage-anciens-chemins.md) — le type d'abri d'une zone abritée suit son
 * bâtiment : dans « Ma ferme », la fiche d'une zone abritée par une serre ne propose plus de le changer (« Défini par la serre X »).
 * Vrai écran (happy-dom), base mémoire de la ferme neuve (./test/ferme-neuve.ts).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleParcellaire, ProprietesEcranParcellaire } from './test/contrat.ts';
import { FERME } from './test/ferme-neuve.ts';
import { actifs, AUJOURDHUI, creerBanc, MAINTENANT, zones, type Banc } from './test/outils.ts';
import { aChamp, attendre, bouton, champ, dialogue, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';

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

async function ouvrir(): Promise<void> {
  const proprietes: ProprietesEcranParcellaire = { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined, surImporter: () => undefined };
  await act(async () => {
    racine.render(createElement(m.EcranParcellaire, proprietes));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Ma ferme') !== undefined, 'dialogue « Ma ferme »');
  await attendre(() => document.querySelector('[data-testid="parcellaire-pret"]') !== null, 'listes lues');
}

async function creerZone(nom: string, type: string, parente = ''): Promise<string> {
  await toucher(bouton('Nouvelle zone'));
  const d = dialogueOuEchec('Nouvelle zone');
  await remplir(champ('Nom', d), nom);
  await remplir(liste('Type d’abri', d), type);
  if (parente !== '') await remplir(liste('Dans la zone', d), parente);
  await toucher(bouton('Enregistrer', d));
  await attendre(() => dialogue('Nouvelle zone') === undefined, 'zone enregistrée');
  const z = actifs(zones(b)).find((x) => x.nom === nom);
  if (z === undefined) throw new Error(`zone ${nom} absente`);
  return String(z.id);
}

function serre(zoneId: string, nom: string, type = 'serre_tunnel'): void {
  b.base.recevoir(
    `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, ?, 30, 8, 3.5, 0, 0, 0, ?, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)`,
    [`0192f0c1-4949-7000-8000-0000000000${zoneId.slice(-2)}`, FERME, nom, type, zoneId],
  );
}

async function modifierZone(nom: string): Promise<HTMLElement> {
  await toucher(bouton(`Ouvrir ${nom}`));
  await attendre(() => dialogue(nom) !== undefined, `dialogue de la zone ${nom}`);
  await toucher(bouton('Modifier la zone', dialogueOuEchec(nom)));
  return dialogueOuEchec('Modifier la zone');
}

describe('T92 règle 3 : le type d’abri suit la serre', () => {
  it('zone sans bâtiment : « Type d’abri » reste proposé', async () => {
    await ouvrir();
    await creerZone('Tunnel libre', 'tunnel');
    const f = await modifierZone('Tunnel libre');
    expect(aChamp('Type d’abri', f)).toBe(true);
    expect(texte(f)).not.toContain('Défini par la serre');
  });

  it('zone abritée par une serre : plus de « Type d’abri », « Défini par la serre Serre M1 » ; enregistrer le nom garde le type', async () => {
    await ouvrir();
    const id = await creerZone('Tunnel 1', 'tunnel');
    serre(id, 'Serre M1');
    const f = await modifierZone('Tunnel 1');
    await attendre(() => !aChamp('Type d’abri', f), 'liste du type retirée');
    expect(texte(f)).toContain('Défini par la serre Serre M1');
    await remplir(champ('Nom', f), 'Tunnel 1 bis');
    await toucher(bouton('Enregistrer', f));
    await attendre(() => dialogue('Modifier la zone') === undefined, 'zone enregistrée');
    expect(actifs(zones(b)).find((z) => z.id === id)).toMatchObject({ nom: 'Tunnel 1 bis', type_abri: 'tunnel' });
  });

  it('sous-zone d’une zone abritée (bande de la serre) : de même', async () => {
    await ouvrir();
    const id = await creerZone('Tri-tunnel', 'tunnel');
    serre(id, 'Serre Tri');
    await creerZone('Manon 1', 'tunnel', id);
    const f = await modifierZone('Manon 1');
    await attendre(() => !aChamp('Type d’abri', f), 'liste du type retirée');
    expect(texte(f)).toContain('Défini par la serre Serre Tri');
  });

  it('serre supprimée en douceur : la zone redevient libre de son type', async () => {
    await ouvrir();
    const id = await creerZone('Tunnel 2', 'tunnel');
    serre(id, 'Serre morte');
    b.base.recevoir("UPDATE batiment SET supprime_le = '2026-10-01T08:00:00.000Z' WHERE zone_id = ?", [id]);
    const f = await modifierZone('Tunnel 2');
    expect(aChamp('Type d’abri', f)).toBe(true);
  });
});
