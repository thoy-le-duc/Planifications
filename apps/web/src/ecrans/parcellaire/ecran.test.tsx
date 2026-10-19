// @vitest-environment happy-dom
/**
 * Tests d'acceptation T49 — « Ma ferme : saisons, zones, planches » (docs/backlog/T49-demarrer-sa-ferme.md).
 * Vrai écran dans un DOM simulé (happy-dom), porte sur la base mémoire d'une ferme NEUVE
 * (./test/ferme-neuve.ts : aucune saison, aucune zone, aucune planche). Contrat : ./test/contrat.ts.
 *
 * Chaque ligne écrite passe la règle de ligne du serveur (validerStructure, T10s) ; chaque
 * enregistrement est UNE transaction locale (un envoi, tout ou rien), annulable par le bandeau ;
 * un refus ne passe rien à la base.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleParcellaire, ProprietesEcranParcellaire } from './test/contrat.ts';
import { FERME } from './test/ferme-neuve.ts';
import { acceptePar, actifs, AUJOURDHUI, creerBanc, emplacements, lire, MAINTENANT, saisons, zones, type Banc } from './test/outils.ts';
import { attendre, bouton, champ, dialogue, dialogueOuEchec, liste, region, remplir, texte, toucher, aBouton } from '../itineraires/test/outils.ts';

const CHEMIN = './index.ts';
let m: ModuleParcellaire;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;
let fermetures = 0;
let imports = 0;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleParcellaire;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fermetures = 0;
  imports = 0;
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
    surFermer: () => {
      fermetures++;
    },
    surImporter: () => {
      imports++;
    },
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

async function annulerParLeBandeau(): Promise<void> {
  const ba = bandeau();
  expect(ba, 'bandeau « Annuler »').not.toBeNull();
  if (ba === null) return;
  b.remiseAZero();
  await toucher(bouton('Annuler', ba));
}

/** Ouvre « Nouvelle saison », remplit, enregistre ; rend le dialogue (encore ouvert s'il y a refus). */
async function saisirSaison(nomDialogue: string, valeurs: { nom?: string; debut?: string; fin?: string }): Promise<HTMLElement> {
  const d = dialogueOuEchec(nomDialogue);
  if (valeurs.nom !== undefined) await remplir(champ('Nom', d), valeurs.nom);
  if (valeurs.debut !== undefined) await remplir(champ('Début', d), valeurs.debut);
  if (valeurs.fin !== undefined) await remplir(champ('Fin', d), valeurs.fin);
  b.remiseAZero();
  await toucher(bouton('Enregistrer', d));
  return d;
}

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

async function ajouterPlanches(d: HTMLElement, nombre: string, prefixe: string, longueur: string, largeur: string): Promise<void> {
  await remplir(champ('Nombre de planches', d), nombre);
  await remplir(champ('Préfixe du code', d), prefixe);
  await remplir(champ('Longueur (m)', d), longueur);
  await remplir(champ('Largeur (m)', d), largeur);
  b.remiseAZero();
  await toucher(bouton('Ajouter les planches', d));
}

const codesActifs = (zoneId: string): string[] =>
  actifs(emplacements(b))
    .filter((e) => e.zone_id === zoneId)
    .map((e) => String(e.code));

describe('T49 : saisons', () => {
  it('ferme neuve : « Créer la saison 2026 » en un tap (1er janvier → 31 décembre), annulable', async () => {
    await ouvrir();
    const s = region('Saisons');
    expect(texte(s)).toMatch(/Aucune saison/);
    b.remiseAZero();
    await toucher(bouton('Créer la saison 2026', s));
    await attendre(() => saisons(b).length === 1, 'saison écrite');
    expect(b.transactions()).toBe(1);
    const [saison] = saisons(b);
    expect(saison).toMatchObject({ ferme_id: FERME, nom: '2026', debut: '2026-01-01', fin: '2026-12-31', supprime_le: null });
    await acceptePar('saison', saisons(b));
    await attendre(() => document.querySelector(`[data-testid="saison"][data-saison="${String(saison?.id)}"]`) !== null, 'saison listée');
    expect(aBouton('Créer la saison 2026'), 'la proposition disparaît').toBe(false);

    await annulerParLeBandeau();
    await attendre(() => saisons(b)[0]?.supprime_le !== null, 'annulée : suppression douce');
    expect(b.transactions()).toBe(1);
    expect(saisons(b)).toHaveLength(1);
  });

  it('« Nouvelle saison » : nom proposé, refus lisibles (nom vide, dates incohérentes) sans rien écrire, puis enregistrée', async () => {
    await ouvrir();
    await toucher(bouton('Créer la saison 2026'));
    await attendre(() => saisons(b).length === 1, 'saison 2026');
    await toucher(bouton('Nouvelle saison'));
    const d = dialogueOuEchec('Nouvelle saison');
    expect(champ('Nom', d).value, 'nom proposé : l’année suivante, 2026 étant pris').toBe('2027');
    expect(champ('Début', d).value).toBe('2027-01-01');
    expect(champ('Fin', d).value).toBe('2027-12-31');

    await saisirSaison('Nouvelle saison', { nom: '  ' });
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/nom/i);
    expect(b.transactions()).toBe(0);

    await saisirSaison('Nouvelle saison', { nom: '2027', debut: '2027-12-31', fin: '2027-01-01' });
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/finit avant de commencer/);
    expect(b.transactions()).toBe(0);
    expect(saisons(b)).toHaveLength(1);

    await saisirSaison('Nouvelle saison', { nom: 'Hiver 2027', debut: '2027-01-01', fin: '2027-03-31' });
    await attendre(() => dialogue('Nouvelle saison') === undefined, 'dialogue fermé');
    expect(b.transactions()).toBe(1);
    expect(saisons(b).find((x) => x.nom === 'Hiver 2027')).toMatchObject({ debut: '2027-01-01', fin: '2027-03-31', supprime_le: null });
    await acceptePar('saison', saisons(b));
  });

  it('modifier une saison (nom, fin) ; « Annuler » ramène les valeurs d’avant', async () => {
    await ouvrir();
    await toucher(bouton('Créer la saison 2026'));
    await attendre(() => saisons(b).length === 1, 'saison 2026');
    await toucher(bouton('Modifier la saison 2026'));
    await saisirSaison('Modifier la saison', { nom: 'Saison 2026', fin: '2027-02-28' });
    await attendre(() => dialogue('Modifier la saison') === undefined, 'dialogue fermé');
    expect(b.transactions()).toBe(1);
    expect(saisons(b)[0]).toMatchObject({ nom: 'Saison 2026', debut: '2026-01-01', fin: '2027-02-28' });
    await acceptePar('saison', saisons(b));
    await annulerParLeBandeau();
    await attendre(() => saisons(b)[0]?.nom === '2026', 'nom ramené');
    expect(saisons(b)[0]).toMatchObject({ nom: '2026', fin: '2026-12-31', supprime_le: null });
    expect(b.transactions()).toBe(1);
  });

  it('supprimer une saison : douce si elle n’a pas de série ; refusée (et rien d’écrit) tant qu’une série prévue y est', async () => {
    await ouvrir();
    await toucher(bouton('Créer la saison 2026'));
    await attendre(() => saisons(b).length === 1, 'saison 2026');
    const id = String(saisons(b)[0]?.id);
    // Une série prévue dans cette saison (reçue par la synchro).
    await b.base.execute(
      `INSERT INTO serie (id, ferme_id, saison_id, espece_id, variete_id, itineraire_id, parametres, ancre_type, ancre_date, longueur_m, statut, cree_le, modifie_le, supprime_le)
       VALUES ('0192f0c1-4949-7000-8000-0000000000f1', ?, ?, '0192f0c1-4949-7000-8000-000000000040', NULL, NULL, '{}', 'plantation', '2026-05-04', 30, 'prevue', ?, ?, NULL)`,
      [FERME, id, MAINTENANT.toISOString(), MAINTENANT.toISOString()],
    );
    await toucher(bouton('Modifier la saison 2026'));
    const d = dialogueOuEchec('Modifier la saison');
    b.remiseAZero();
    await toucher(bouton('Supprimer la saison', d));
    await attendre(() => d.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/1 série/);
    expect(b.transactions()).toBe(0);
    expect(saisons(b)[0]?.supprime_le).toBeNull();

    // La série supprimée ne retient plus la saison.
    await b.base.execute(`UPDATE serie SET supprime_le = ? WHERE id = '0192f0c1-4949-7000-8000-0000000000f1'`, [MAINTENANT.toISOString()]);
    b.remiseAZero();
    await toucher(bouton('Supprimer la saison', d));
    await attendre(() => saisons(b)[0]?.supprime_le !== null, 'saison supprimée (douce)');
    expect(b.transactions()).toBe(1);
    await acceptePar('saison', saisons(b));
    await annulerParLeBandeau();
    await attendre(() => saisons(b)[0]?.supprime_le === null, 'saison rétablie');
  });
});

describe('T49 : zones et planches', () => {
  it('créer une zone (nom, type d’abri) et une sous-zone ; refus du nom vide', async () => {
    await ouvrir();
    await toucher(bouton('Nouvelle zone'));
    const d = dialogueOuEchec('Nouvelle zone');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', d));
    expect(texte(d.querySelector('[role="alert"]'))).toMatch(/nom/i);
    expect(b.transactions()).toBe(0);
    await toucher(bouton('Fermer', d));

    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    expect(b.transactions()).toBe(1);
    expect(zones(b)[0]).toMatchObject({ id: tunnel, ferme_id: FERME, nom: 'Tunnel 1', type_abri: 'tunnel', zone_parente_id: null, supprime_le: null });
    const chapelle = await creerZone('Chapelle A', 'tunnel', tunnel);
    expect(zones(b).find((z) => z.id === chapelle)).toMatchObject({ zone_parente_id: tunnel });
    await acceptePar('zone', zones(b));
    expect(document.querySelector(`[data-testid="zone"][data-zone="${tunnel}"]`)).not.toBeNull();
  });

  it('10 planches « P » de 30 × 0,8 m en un geste (P1…P10, une transaction), puis 3 à la suite ; « Annuler » retire le lot', async () => {
    await ouvrir();
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const d = await ouvrirZone('Tunnel 1');
    await ajouterPlanches(d, '10', 'P', '30', '0,8');
    await attendre(() => codesActifs(tunnel).length === 10, '10 planches écrites');
    expect(b.transactions(), 'un geste, une transaction').toBe(1);
    expect(codesActifs(tunnel)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']);
    for (const e of actifs(emplacements(b))) {
      expect(e).toMatchObject({ ferme_id: FERME, zone_id: tunnel, sorte: 'planche', longueur_m: 30, largeur_m: 0.8, nombre_places: null, actif_au: null, remplace: '[]' });
      expect(String(e.actif_du) <= AUJOURDHUI, 'en service dès aujourd’hui').toBe(true);
    }
    await acceptePar('emplacement', emplacements(b));
    await attendre(() => d.querySelectorAll('[data-testid="planche"]').length === 10, '10 planches listées dans la zone');

    await ajouterPlanches(d, '3', 'P', '25', '1');
    await attendre(() => codesActifs(tunnel).length === 13, '3 de plus');
    expect(codesActifs(tunnel).slice(10)).toEqual(['P11', 'P12', 'P13']);

    await annulerParLeBandeau();
    await attendre(() => codesActifs(tunnel).length === 10, 'le dernier lot est retiré (suppression douce)');
    expect(b.transactions()).toBe(1);
    expect(emplacements(b)).toHaveLength(13);
  });

  it('modifier une planche : code en double dans la zone refusé (rien d’écrit) ; même code dans une autre zone permis ; gouttière, hors service', async () => {
    await ouvrir();
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const champ2 = await creerZone('Champ 2', 'plein_champ');
    let d = await ouvrirZone('Tunnel 1');
    await ajouterPlanches(d, '3', 'P', '30', '0,8');
    await attendre(() => codesActifs(tunnel).length === 3, '3 planches');
    const p3 = actifs(emplacements(b)).find((e) => e.code === 'P3');
    if (p3 === undefined) throw new Error('P3 absente');

    await toucher(bouton('Modifier P3', d));
    let f = dialogueOuEchec('Modifier P3');
    await remplir(champ('Code', f), ' p1 ');
    b.remiseAZero();
    await toucher(bouton('Enregistrer', f));
    expect(texte(f.querySelector('[role="alert"]'))).toMatch(/existe déjà dans cette zone/);
    expect(b.transactions()).toBe(0);

    await remplir(champ('Code', f), 'G1');
    await remplir(liste('Sorte', f), 'gouttiere');
    await remplir(champ('Nombre de places', f), '120');
    await toucher(bouton('Enregistrer', f));
    await attendre(() => actifs(emplacements(b)).some((e) => e.code === 'G1'), 'P3 devenue G1');
    expect(b.transactions()).toBe(1);
    expect(actifs(emplacements(b)).find((e) => e.id === p3.id)).toMatchObject({ code: 'G1', sorte: 'gouttiere', nombre_places: 120 });

    await toucher(bouton('Modifier G1', d));
    f = dialogueOuEchec('Modifier G1');
    b.remiseAZero();
    await toucher(bouton('Mettre hors service', f));
    await attendre(() => actifs(emplacements(b)).find((e) => e.id === p3.id)?.actif_au === AUJOURDHUI, 'hors service aujourd’hui');
    expect(b.transactions()).toBe(1);
    await acceptePar('emplacement', emplacements(b));

    // P1 dans une autre zone : permis.
    d = await ouvrirZone('Champ 2');
    await ajouterPlanches(d, '1', 'P', '50', '1,2');
    await attendre(() => codesActifs(champ2).length === 1, 'P1 du champ 2');
    expect(codesActifs(champ2)).toEqual(['P1']);
  });

  it('supprimer une zone : refusée tant qu’elle a des planches (rien d’écrit) ; vide : douce', async () => {
    await ouvrir();
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const d = await ouvrirZone('Tunnel 1');
    await ajouterPlanches(d, '2', 'P', '30', '0,8');
    await attendre(() => codesActifs(tunnel).length === 2, '2 planches');
    await toucher(bouton('Modifier la zone', d));
    const z = dialogueOuEchec('Modifier la zone');
    b.remiseAZero();
    await toucher(bouton('Supprimer la zone', z));
    await attendre(() => z.querySelector('[role="alert"]') !== null, 'refus affiché');
    expect(texte(z.querySelector('[role="alert"]'))).toMatch(/2 planches/);
    expect(b.transactions()).toBe(0);
    await toucher(bouton('Fermer', z));

    for (const code of ['P1', 'P2']) {
      await toucher(bouton(`Modifier ${code}`, d));
      const f = dialogueOuEchec(`Modifier ${code}`);
      await toucher(bouton('Supprimer la planche', f));
      await attendre(() => !codesActifs(tunnel).includes(code), `${code} supprimée`);
    }
    await toucher(bouton('Modifier la zone', dialogueOuEchec('Tunnel 1')));
    b.remiseAZero();
    await toucher(bouton('Supprimer la zone', dialogueOuEchec('Modifier la zone')));
    await attendre(() => zones(b)[0]?.supprime_le !== null, 'zone supprimée (douce)');
    expect(b.transactions()).toBe(1);
    await acceptePar('zone', zones(b));
    expect(lire(b, 'SELECT COUNT(*) AS n FROM zone')[0]?.n, 'jamais de DELETE').toBe(1);
  });

  it('un équipier aussi (droits de T10s : tout membre actif)', async () => {
    b.base.fermer();
    b = await creerBanc({ role: 'equipier' });
    await ouvrir();
    await toucher(bouton('Créer la saison 2026'));
    await attendre(() => saisons(b).length === 1, 'saison écrite par l’équipier');
    const tunnel = await creerZone('Tunnel 1', 'tunnel');
    const d = await ouvrirZone('Tunnel 1');
    await ajouterPlanches(d, '4', 'T1-P', '30', '0,8');
    await attendre(() => codesActifs(tunnel).length === 4, 'planches écrites par l’équipier');
  });

  it('« Importer un tableur » mène à l’import ; « Fermer » ferme', async () => {
    const e = await ouvrir();
    await toucher(bouton('Importer un tableur', e));
    expect(imports).toBe(1);
    await toucher(bouton('Fermer', e));
    expect(fermetures).toBe(1);
    expect(b.transactions()).toBe(0);
  });
});
