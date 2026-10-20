// @vitest-environment happy-dom
/**
 * Tests d'acceptation T60 — l'équipe de la ferme (docs/backlog/T60-consignes-par-ouvrier.md,
 * règle 1 : « les membres existants de la ferme, avec un prénom affiché ; un ouvrier sans
 * téléphone peut être ajouté sans compte, prénom seul »). Vrai écran dans un DOM simulé, base
 * mémoire de @planif/sync, sans réseau.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Module apps/web/src/ecrans/ferme/equipe/index.ts, chargé à la demande depuis l'écran Ferme
 * (carte « Équipe »), exporte `EcranEquipe` :
 *   { porte, fermeId, utilisateurId, maintenant?: () => Date, surFermer }.
 * Dialogue « Équipe » (role="dialog") :
 *   - [data-testid="mon-code"] : le code de MON compte dans cette ferme, les 4 derniers
 *     caractères de l'id de mon membre, en majuscules (le gérant le demande pour me lier) ;
 *   - une ligne [data-testid="personne"][data-personne=<id>] par personne active, avec son
 *     prénom ; liée à un compte : le texte « a un compte » ;
 *   - gérant seulement : champ « Prénom » + « Ajouter » (personne sans compte, membre nul, UNE
 *     transaction) ; par personne, liste « Compte de <prénom> » (« Sans compte », puis chaque
 *     membre actif de la ferme : « Gérant · code XXXX » / « Équipier · code XXXX », gérants
 *     d'abord puis par code, ceux déjà liés à une autre personne exceptés) et bouton « Retirer <prénom> » (suppression douce). Chaque
 *     écriture affiche [data-testid="equipe-annulable"] (role="status") avec « Annuler », qui
 *     remet l'état d'avant (une transaction) ;
 *   - équipier : la liste seule (ni « Ajouter », ni « Retirer », ni « Compte de »).
 * Jamais de DELETE : retirer pose supprime_le.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR } from '../aujourdhui/test/ferme-du-jour.ts';
import { aBouton, aChamp, attendre, bouton, champ, dialogueOuEchec, liste, remplir, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN = './equipe/index.ts';
const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T08:00:00.000Z');

interface ProprietesEcranEquipe {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly utilisateurId: string;
  readonly maintenant?: () => Date;
  readonly surFermer: () => void;
}
interface ModuleEquipeEcran {
  readonly EcranEquipe: (p: ProprietesEcranEquipe) => ReactNode;
}

const id = (n: number) => `0192f0c1-6060-7000-8000-${n.toString(16).padStart(12, '0')}`;
const EQUIPIER = id(0x1);
const MEMBRE_EQUIPIER = id(0x2a3b);
const MEMBRE_GERANT = '0192f0c1-1313-7000-8000-000000000003';
const PAUL = id(0x11);

let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
let conteneur: HTMLDivElement;
let racine: Root;

const horo = { cree_le: '2026-09-01T08:00:00.000Z', modifie_le: '2026-09-01T08:00:00.000Z' };

interface LignePersonne {
  readonly id: string;
  readonly ferme_id: string;
  readonly prenom: string;
  readonly membre_id: string | null;
  readonly supprime_le: string | null;
}
const personnes = (): LignePersonne[] => base.lireDirect<LignePersonne>('SELECT id, ferme_id, prenom, membre_id, supprime_le FROM personne ORDER BY prenom, id');

async function preparer(utilisateurId: string): Promise<void> {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeDuJour(base, AUJOURDHUI);
  await base.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, invite_par, invite_le, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, 'equipier', 'accepte', NULL, NULL, ?, ?, NULL)`,
      [MEMBRE_EQUIPIER, EQUIPIER, FERME, horo.cree_le, horo.modifie_le],
    );
    await tx.execute('INSERT INTO personne (id, ferme_id, prenom, membre_id, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, NULL, ?, ?, NULL)', [PAUL, FERME, 'Paul', horo.cree_le, horo.modifie_le]);
  });
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: utilisateurId as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  vi.stubGlobal('fetch', () => Promise.reject(new Error('hors ligne : aucun appel réseau attendu')));
  transactions = 0;
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  base.fermer();
  vi.unstubAllGlobals();
});

async function rendre(utilisateurId: string): Promise<HTMLElement> {
  const m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEquipeEcran;
  const Ecran = m.EcranEquipe;
  await act(async () => {
    racine.render(<Ecran porte={porte} fermeId={FERME} utilisateurId={utilisateurId} maintenant={() => MAINTENANT} surFermer={() => undefined} />);
    await Promise.resolve();
  });
  await attendre(() => conteneur.querySelector('[data-testid="personne"]') !== null, 'l’équipe est lue');
  return dialogueOuEchec('Équipe');
}

const ligne = (personneId: string): HTMLElement | null => conteneur.querySelector<HTMLElement>(`[data-testid="personne"][data-personne="${personneId}"]`);
const bandeau = (): HTMLElement | null => conteneur.querySelector<HTMLElement>('[data-testid="equipe-annulable"]');

describe('T60 : l’équipe de la ferme (règle 1)', () => {
  it('gérant : ajouter un ouvrier sans compte, prénom seul, en une transaction ; Annuler le retire', async () => {
    await preparer(UTILISATEUR);
    const d = await rendre(UTILISATEUR);
    expect(texte(d.querySelector('[data-testid="mon-code"]'))).toBe('0003');
    await remplir(champ('Prénom', d), '  Marie ');
    transactions = 0;
    await toucher(bouton('Ajouter', d));
    await attendre(() => personnes().some((p) => p.prenom === 'Marie'), 'Marie est écrite');
    expect(transactions).toBe(1);
    const marie = personnes().find((p) => p.prenom === 'Marie');
    expect(marie).toMatchObject({ ferme_id: FERME, membre_id: null, supprime_le: null });
    await attendre(() => ligne(marie?.id ?? '') !== null, 'Marie est listée');
    expect(bandeau()?.getAttribute('role')).toBe('status');
    await toucher(bouton('Annuler', bandeau() ?? conteneur));
    await attendre(() => personnes().find((p) => p.prenom === 'Marie')?.supprime_le !== null, 'Annuler retire Marie (suppression douce)');
    await attendre(() => ligne(marie?.id ?? '') === null, 'Marie n’est plus listée');
  });

  it('gérant : lier Paul au compte de l’équipier par son code, puis le retirer et l’annuler', async () => {
    await preparer(UTILISATEUR);
    const d = await rendre(UTILISATEUR);
    const compte = liste('Compte de Paul', d);
    const options = [...compte.options].map((o) => texte(o));
    expect(options).toEqual(['Sans compte', 'Gérant · code 0003', 'Équipier · code 2A3B']);
    expect([...compte.options].map((o) => o.value)).toEqual(['', MEMBRE_GERANT, MEMBRE_EQUIPIER]);
    transactions = 0;
    await remplir(compte, MEMBRE_EQUIPIER);
    await attendre(() => personnes().find((p) => p.id === PAUL)?.membre_id === MEMBRE_EQUIPIER, 'Paul est lié au compte');
    expect(transactions).toBe(1);
    await attendre(() => texte(ligne(PAUL)).includes('a un compte'), 'la ligne le dit');
    await toucher(bouton('Retirer Paul', d));
    await attendre(() => personnes().find((p) => p.id === PAUL)?.supprime_le !== null, 'Paul retiré en douceur');
    expect(personnes().find((p) => p.id === PAUL)).toBeDefined();
    await toucher(bouton('Annuler', bandeau() ?? conteneur));
    await attendre(() => personnes().find((p) => p.id === PAUL)?.supprime_le === null, 'Annuler le rétablit');
    await attendre(() => ligne(PAUL) !== null, 'Paul est de nouveau listé');
  });

  it('équipier : la liste et son code seulement, rien à modifier', async () => {
    await preparer(EQUIPIER);
    const d = await rendre(EQUIPIER);
    expect(texte(d.querySelector('[data-testid="mon-code"]'))).toBe('2A3B');
    expect(texte(ligne(PAUL))).toContain('Paul');
    expect(aBouton('Ajouter', d)).toBe(false);
    expect(aBouton('Retirer Paul', d)).toBe(false);
    expect(aChamp('Compte de Paul', d)).toBe(false);
  });
});
