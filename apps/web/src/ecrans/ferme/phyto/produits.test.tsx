// @vitest-environment happy-dom
/**
 * Tests d'acceptation T52 — produits phyto de la ferme (docs/backlog/T52-registre-phyto.md, règle 1).
 * Vrai écran dans un DOM simulé (happy-dom), porte sur la base mémoire d'une ferme neuve
 * (../../parcellaire/test/ferme-neuve.ts). Contrat : ./test/contrat.ts.
 *
 * Créer, modifier, archiver, rétablir : une transaction par enregistrement, la ligne écrite est
 * acceptée par la règle du serveur (validerProduitPhyto), jamais de DELETE. Un refus ne passe
 * rien à la base. Tout se fait sans réseau.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as coeur from '@planif/core';
import type { ModulePhyto, ProprietesEcranPhyto } from './test/contrat.ts';
import { FERME } from '../../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, lire, MAINTENANT, type Banc, type Ligne } from '../../parcellaire/test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, remplir, texte, toucher } from '../../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModulePhyto;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;

/** Règle du serveur (T52, @planif/core) ; lue sans dépendre de son type tant qu'elle n'existe pas. */
let validerProduitPhyto: (l: unknown) => { readonly ok: true } | { readonly ok: false; readonly erreur: { readonly message: string } };

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModulePhyto;
  const v = (coeur as unknown as Record<string, unknown>).validerProduitPhyto;
  if (typeof v !== 'function') throw new Error('@planif/core n’exporte pas validerProduitPhyto (T52)');
  validerProduitPhyto = v as typeof validerProduitPhyto;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  // Hors ligne : aucun appel réseau n'est permis.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
  vi.unstubAllGlobals();
});

const produits = (): Ligne[] => lire(b, 'SELECT * FROM produit_phyto WHERE ferme_id = ? ORDER BY cree_le, id', [FERME]);
const lignes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="produit-phyto"]')];

function valide(l: Ligne | undefined): void {
  if (l === undefined) throw new Error('produit absent');
  const r = validerProduitPhyto({ ...l });
  expect(r.ok, r.ok ? '' : `validerProduitPhyto refuse : ${r.erreur.message}`).toBe(true);
}

function sansDelete(): void {
  const interdits = b.base.ecritures.filter((sql) => /^\s*(DELETE|REPLACE|INSERT\s+OR\s+REPLACE)\b/i.test(sql) && /produit_phyto/i.test(sql));
  expect(interdits, 'jamais de DELETE ni de REPLACE sur produit_phyto').toEqual([]);
}

async function ouvrir(): Promise<HTMLElement> {
  const p: ProprietesEcranPhyto = { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT, surFermer: () => undefined };
  await act(async () => {
    racine.render(createElement(m.EcranProduitsPhyto, p));
    await Promise.resolve();
  });
  await attendre(() => dialogue('Produits phyto') !== undefined, 'dialogue « Produits phyto »');
  return dialogueOuEchec('Produits phyto');
}

async function nouveau(valeurs: { nom: string; amm?: string; substance?: string; dar: string; bio?: boolean; dose?: string; unite?: string }): Promise<HTMLElement> {
  await toucher(bouton('Nouveau produit'));
  const d = dialogueOuEchec('Nouveau produit');
  await remplir(champ('Nom commercial', d), valeurs.nom);
  if (valeurs.amm !== undefined) await remplir(champ('N° AMM', d), valeurs.amm);
  if (valeurs.substance !== undefined) await remplir(champ('Substance active', d), valeurs.substance);
  await remplir(champ('Délai avant récolte (jours)', d), valeurs.dar);
  if (valeurs.bio === true) await toucher(champ('Utilisable en bio', d));
  if (valeurs.dose !== undefined) await remplir(champ('Dose maximale', d), valeurs.dose);
  if (valeurs.unite !== undefined) await remplir(champ('Unité de la dose', d), valeurs.unite);
  b.remiseAZero();
  await toucher(bouton('Enregistrer', d));
  return d;
}

describe('T52 : produits phyto de la ferme', () => {
  it('créer un produit : une transaction, ligne acceptée par le serveur, visible dans la liste', async () => {
    await ouvrir();
    expect(lignes()).toHaveLength(0);
    await nouveau({ nom: 'Bouillie bordelaise RSR', amm: '9300417', substance: 'cuivre (sulfate)', dar: '3', bio: true, dose: '3,5', unite: 'kg/ha' });
    await attendre(() => dialogue('Nouveau produit') === undefined, 'dialogue refermé après Enregistrer');
    expect(b.transactions()).toBe(1);
    const [p] = produits();
    valide(p);
    expect(p).toMatchObject({ ferme_id: FERME, nom_commercial: 'Bouillie bordelaise RSR', numero_amm: '9300417', delai_avant_recolte_jours: 3, utilisable_en_bio: 1, supprime_le: null });
    expect(JSON.parse(String(p?.dose_maximale))).toEqual({ valeur: 3.5, unite: 'kg/ha' });
    await attendre(() => lignes().length === 1, 'produit affiché');
    const l = lignes()[0];
    expect(l?.dataset.produit).toBe(p?.id);
    expect(texte(l)).toContain('Bouillie bordelaise RSR');
    expect(texte(l)).toContain('9300417');
    expect(texte(l)).toMatch(/3 j/);
    sansDelete();
  });

  it('sans dose maximale ni AMM (purin) : accepté, dose maximale nulle', async () => {
    await ouvrir();
    await nouveau({ nom: 'Purin d’ortie', dar: '0' });
    await attendre(() => produits().length === 1, 'produit écrit');
    const [p] = produits();
    valide(p);
    expect(p).toMatchObject({ numero_amm: '', dose_maximale: null, utilisable_en_bio: 0, delai_avant_recolte_jours: 0 });
  });

  it('refus (DAR illisible, nom vide) : message dans le dialogue, rien d’écrit', async () => {
    await ouvrir();
    const d = await nouveau({ nom: 'Bouillie', dar: '400' });
    expect(dialogue('Nouveau produit')).toBeDefined();
    expect(d.querySelector('[role="alert"]')).not.toBeNull();
    expect(b.transactions()).toBe(0);
    await remplir(champ('Délai avant récolte (jours)', d), 'trois');
    await toucher(bouton('Enregistrer', d));
    expect(b.transactions()).toBe(0);
    await remplir(champ('Délai avant récolte (jours)', d), '3');
    await remplir(champ('Nom commercial', d), '   ');
    await toucher(bouton('Enregistrer', d));
    expect(b.transactions()).toBe(0);
    expect(produits()).toHaveLength(0);
  });

  it('modifier le DAR, puis archiver et rétablir : une transaction chacun, supprime_le posé puis retiré', async () => {
    await ouvrir();
    await nouveau({ nom: 'Success 4', amm: '2010513', substance: 'spinosad', dar: '3' });
    await attendre(() => lignes().length === 1, 'produit affiché');
    const id = String(produits()[0]?.id);

    await toucher(bouton('Modifier Success 4'));
    const d = dialogueOuEchec('Modifier le produit');
    expect(champ('Délai avant récolte (jours)', d).value).toBe('3');
    await remplir(champ('Délai avant récolte (jours)', d), '7');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => dialogue('Modifier le produit') === undefined, 'dialogue refermé');
    expect(b.transactions()).toBe(1);
    valide(produits()[0]);
    expect(produits()[0]?.delai_avant_recolte_jours).toBe(7);

    await toucher(bouton('Modifier Success 4'));
    b.remiseAZero();
    await toucher(bouton('Archiver le produit', dialogueOuEchec('Modifier le produit')));
    await attendre(() => lignes().length === 0, 'produit archivé retiré de la liste');
    expect(b.transactions()).toBe(1);
    expect(produits()[0]?.supprime_le).not.toBeNull();
    expect(produits()[0]?.id).toBe(id);

    b.remiseAZero();
    await toucher(bouton('Rétablir Success 4'));
    await attendre(() => lignes().length === 1, 'produit rétabli');
    expect(b.transactions()).toBe(1);
    expect(produits()[0]?.supprime_le).toBeNull();
    valide(produits()[0]);
    sansDelete();
  });
});
