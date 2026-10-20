// @vitest-environment happy-dom
/**
 * Tests d'acceptation T57 — l'écran « Vannes » (docs/backlog/T57-vannes-irrigation.md, règle 1) :
 * créer 60 vannes en lot aux codes uniques, dire ce que chacune arrose (plusieurs zones possibles),
 * changer le réseau en gardant l'historique (lien daté), annuler. Rendu dans un DOM simulé, sur la
 * ferme des vannes (./test/ferme-vannes.ts) lue et écrite par la vraie porte, hors ligne (base
 * mémoire, aucun réseau). Contrat : ./test/contrat-vannes.ts.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, dialogueOuEchec, nomAccessible, remplir, texte, toucher } from '../itineraires/test/outils.ts';
import { CHEMIN_VANNES, TESTID_VANNES as T, type ModuleVannes } from './test/contrat-vannes.ts';
import { ecrireFermeVannes, FERME, LIEN_12_P3, LIEN_12_P4, P3, P4, P5, PC1, UTILISATEUR, VANNE_12, type OptionsFermeVannes } from './test/ferme-vannes.ts';

const AUJOURDHUI = '2026-10-19';
const MAINTENANT = new Date('2026-10-19T08:00:00.000Z');

type Ligne = Readonly<Record<string, string | number | null>>;

let m: ModuleVannes;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_VANNES)) as ModuleVannes;
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
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
});

async function ouvrir(options: OptionsFermeVannes = {}): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeVannes(base, options);
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
  await act(async () => {
    racine.render(createElement(m.EcranVannes, { porte, fermeId: FERME, surFermer: () => undefined, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT }));
    await Promise.resolve();
  });
  await attendre(() => document.querySelector(`[data-testid="${T.pret}"]`) !== null, 'écran des vannes prêt');
  transactions = 0;
}

const lire = (sql: string, p: readonly unknown[] = []): Ligne[] => base.lireDirect<Ligne>(sql, p);
const vannes = (): Ligne[] => lire('SELECT * FROM secteur_irrigation WHERE supprime_le IS NULL ORDER BY numero_vanne');
const liens = (vanne: string): Ligne[] => lire('SELECT * FROM secteur_emplacement WHERE secteur_irrigation_id = ? ORDER BY du, emplacement_id', [vanne]);
const lignesListe = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${T.vanne}"]`)];
const caseDe = (emplacement: string): HTMLInputElement => {
  const c = document.querySelector<HTMLInputElement>(`[data-testid="${T.plancheArrosee}"][data-emplacement="${emplacement}"]`);
  if (c === null) throw new Error(`case de ${emplacement} absente`);
  return c;
};

/**
 * La règle de ligne du serveur importe @planif/db, qui ne se charge pas sous happy-dom : elle est
 * rejouée sur les mêmes écritures par ./vannes-ecritures.test.ts (environnement node). Ici, ce qui
 * se vérifie sans elle : l'adresse Modbus n'est jamais écrite.
 */
function accepteesParLeServeur(_table: 'secteur_irrigation' | 'secteur_emplacement', lignes: readonly Ligne[]): void {
  expect(lignes.length).toBeGreaterThan(0);
  for (const l of lignes) expect(l.adresse_modbus ?? null, 'adresse Modbus jamais écrite').toBeNull();
}

async function cocher(emplacement: string): Promise<void> {
  await toucher(caseDe(emplacement));
}

describe('T57 : créer des vannes en lot', () => {
  it('« 60 vannes, V1 à V60 » en un tap : 60 lignes en UNE transaction, numéros uniques, acceptées par le serveur', async () => {
    await ouvrir();
    const ecran = document.querySelector<HTMLElement>(`[data-testid="${T.ecran}"]`);
    expect(ecran?.getAttribute('role')).toBe('dialog');
    expect(nomAccessible(ecran ?? document.body)).toMatch(/Vannes d’irrigation/);
    await remplir(champ('Nombre de vannes'), '60');
    expect(champ('Préfixe du nom').value).toBe('V');
    expect(texte(document.body)).toContain('V1 à V60');
    await toucher(bouton('Ajouter les vannes'));
    await attendre(() => vannes().length === 60, '60 vannes écrites');
    expect(transactions).toBe(1);
    const lues = vannes();
    expect(lues.map((v) => v.numero_vanne)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(lues.map((v) => v.nom)).toEqual(Array.from({ length: 60 }, (_, i) => `V${String(i + 1)}`));
    expect(new Set(lues.map((v) => v.id)).size).toBe(60);
    accepteesParLeServeur('secteur_irrigation', lues);
    await attendre(() => lignesListe().length === 60, 'les 60 vannes listées');
    expect(lignesListe()[11]?.dataset.numero).toBe('12');
  });

  it('un second lot continue sans doublon : V61 à V65', async () => {
    await ouvrir();
    await remplir(champ('Nombre de vannes'), '60');
    await toucher(bouton('Ajouter les vannes'));
    await attendre(() => vannes().length === 60, '60 vannes');
    await remplir(champ('Nombre de vannes'), '5');
    expect(texte(document.body)).toContain('V61 à V65');
    await toucher(bouton('Ajouter les vannes'));
    await attendre(() => vannes().length === 65, '65 vannes');
    expect(new Set(vannes().map((v) => v.numero_vanne)).size).toBe(65);
    expect(vannes().slice(60).map((v) => v.nom)).toEqual(['V61', 'V62', 'V63', 'V64', 'V65']);
  });

  it('« Annuler » retire tout le lot (suppression douce, une transaction)', async () => {
    await ouvrir();
    await remplir(champ('Nombre de vannes'), '3');
    await toucher(bouton('Ajouter les vannes'));
    await attendre(() => vannes().length === 3, '3 vannes');
    transactions = 0;
    const bandeau = document.querySelector<HTMLElement>(`[data-testid="${T.annulable}"]`);
    expect(bandeau).not.toBeNull();
    await toucher(bouton('Annuler', bandeau ?? document));
    await attendre(() => vannes().length === 0, 'lot annulé');
    expect(transactions).toBe(1);
    expect(lire('SELECT COUNT(*) AS n FROM secteur_irrigation')[0]?.n, 'jamais de DELETE').toBe(3);
  });
});

describe('T57 : ce que chaque vanne arrose', () => {
  it('une vanne qui arrose deux zones : P5 (Tunnel 2) et PC-01 (Plein champ) cochées, deux liens du jour, une transaction', async () => {
    await ouvrir({ vannes: true });
    await remplir(champ('Nombre de vannes'), '1');
    await toucher(bouton('Ajouter les vannes'));
    await attendre(() => vannes().length === 4, 'V1 ajoutée');
    const v1 = vannes().find((v) => v.nom === 'V1');
    await toucher(bouton('Modifier V1'));
    const fiche = dialogueOuEchec('V1');
    expect(nomAccessible(caseDe(P5))).toBe('Tunnel 2 P5');
    expect(nomAccessible(caseDe(PC1))).toBe('Plein champ PC-01');
    expect(caseDe(P5).checked).toBe(false);
    await cocher(P5);
    await cocher(PC1);
    transactions = 0;
    await toucher(bouton('Enregistrer', fiche));
    await attendre(() => liens(String(v1?.id)).length === 2, 'deux liens écrits');
    expect(transactions).toBe(1);
    const l = liens(String(v1?.id));
    expect(l.map((x) => [x.emplacement_id, x.du, x.au]).sort()).toEqual([
      [P5, AUJOURDHUI, null],
      [PC1, AUJOURDHUI, null],
    ].sort());
    accepteesParLeServeur('secteur_emplacement', l);
    await attendre(() => texte(lignesListe().find((x) => x.dataset.vanne === v1?.id)).includes('2 planches'), 'la liste dit « 2 planches »');
  });

  it('changer le réseau garde l’historique : P3 décochée est fermée la veille, P5 cochée part du jour ; « Annuler » remet tout', async () => {
    await ouvrir({ vannes: true });
    await toucher(bouton('Modifier V12'));
    const fiche = dialogueOuEchec('V12');
    expect(caseDe(P3).checked).toBe(true);
    expect(caseDe(P4).checked).toBe(true);
    await cocher(P3);
    await cocher(P5);
    transactions = 0;
    await toucher(bouton('Enregistrer', fiche));
    await attendre(() => liens(VANNE_12).length === 3, 'un lien de plus');
    expect(transactions).toBe(1);
    const apres = liens(VANNE_12);
    expect(apres.find((x) => x.id === LIEN_12_P3)).toMatchObject({ emplacement_id: P3, du: '2026-01-01', au: '2026-10-18', supprime_le: null });
    expect(apres.find((x) => x.id === LIEN_12_P4)).toMatchObject({ emplacement_id: P4, au: null });
    const nouveau = apres.find((x) => x.emplacement_id === P5);
    expect(nouveau).toMatchObject({ du: AUJOURDHUI, au: null, supprime_le: null });
    accepteesParLeServeur('secteur_emplacement', apres);

    transactions = 0;
    await toucher(bouton('Annuler', document.querySelector<HTMLElement>(`[data-testid="${T.annulable}"]`) ?? document));
    await attendre(() => liens(VANNE_12).find((x) => x.id === LIEN_12_P3)?.au === null, 'P3 rouverte');
    expect(transactions).toBe(1);
    expect(liens(VANNE_12).find((x) => x.emplacement_id === P5)?.supprime_le).not.toBeNull();
  });

  it('numéro déjà pris : refusé avec un message, rien n’est écrit', async () => {
    await ouvrir({ vannes: true });
    await toucher(bouton('Modifier V12'));
    const fiche = dialogueOuEchec('V12');
    await remplir(champ('Numéro', fiche), '13');
    const avant = JSON.stringify(lire('SELECT * FROM secteur_irrigation ORDER BY id'));
    transactions = 0;
    await toucher(bouton('Enregistrer', fiche));
    await attendre(() => fiche.querySelector('[role="alert"]') !== null, 'message d’erreur');
    expect(texte(fiche.querySelector('[role="alert"]'))).toMatch(/existe déjà/);
    expect(transactions).toBe(0);
    expect(JSON.stringify(lire('SELECT * FROM secteur_irrigation ORDER BY id'))).toBe(avant);
  });

  it('une vanne qui arrose encore ne se supprime pas ; décochée, elle se supprime (en douceur)', async () => {
    await ouvrir({ vannes: true });
    await toucher(bouton('Modifier V12'));
    let fiche = dialogueOuEchec('V12');
    await toucher(bouton('Supprimer la vanne', fiche));
    await attendre(() => fiche.querySelector('[role="alert"]') !== null, 'refus');
    expect(texte(fiche.querySelector('[role="alert"]'))).toMatch(/arrose encore/);
    await cocher(P3);
    await cocher(P4);
    await toucher(bouton('Enregistrer', fiche));
    await attendre(() => liens(VANNE_12).every((x) => x.au === '2026-10-18'), 'liens fermés');
    await toucher(bouton('Modifier V12'));
    fiche = dialogueOuEchec('V12');
    await toucher(bouton('Supprimer la vanne', fiche));
    await attendre(() => vannes().every((v) => v.id !== VANNE_12), 'V12 supprimée');
    expect(lire('SELECT supprime_le FROM secteur_irrigation WHERE id = ?', [VANNE_12])[0]?.supprime_le).not.toBeNull();
  });
});

describe('T57 : « Saisons, zones et planches » → « Vannes »', () => {
  it('le bouton « Vannes » de l’écran du parcellaire ouvre l’écran des vannes (chargé à la demande)', async () => {
    const parcellaire = (await import(/* @vite-ignore */ './index.ts')) as { EcranParcellaire: (p: { porte: PorteDonnees; fermeId: string; surFermer: () => void; aujourdhui: () => string; maintenant: () => Date }) => ReturnType<typeof createElement> };
    base = creerBaseMemoire(SCHEMA_LOCAL);
    await ecrireFermeVannes(base, { vannes: true });
    porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
    await act(async () => {
      racine.render(createElement(parcellaire.EcranParcellaire, { porte, fermeId: FERME, surFermer: () => undefined, aujourdhui: () => AUJOURDHUI, maintenant: () => MAINTENANT }));
      await Promise.resolve();
    });
    await attendre(() => document.querySelector('[data-testid="parcellaire-pret"]') !== null, 'parcellaire prêt');
    await toucher(bouton(/^Vannes/));
    await attendre(() => document.querySelector(`[data-testid="${T.pret}"]`) !== null, 'écran des vannes ouvert');
    expect(lignesListe().map((l) => l.dataset.numero)).toEqual(['12', '13', '14']);
  });
});
