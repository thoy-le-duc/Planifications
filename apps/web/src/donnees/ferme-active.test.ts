/**
 * Tests d'acceptation T11 — ferme active de l'appli (docs/backlog/T11-vue-2d.md, « Ouverture de
 * la base locale »). Une fois connecté, l'appli ouvre la base locale de l'utilisateur et en
 * choisit la ferme active ; les écrans reçoivent une porte de @planif/sync sur cette ferme.
 *
 * ── Contrat : apps/web/src/donnees/ferme-active.ts ──────────────────────────────────────────
 * Chargé à la demande avec l'ouverture de la base (il importe @planif/sync), jamais au démarrage.
 *
 * interface FermeDisponible { readonly id: string; readonly nom: string }
 *
 * lireFermes(base: Pick<BaseLocale, 'getAll'>, utilisateurId): Promise<FermeDisponible[]>
 *   Fermes dont l'utilisateur est membre actif dans la base locale : ligne `membre` de cet
 *   utilisateur, etat 'accepte', non supprimée ; ferme non supprimée (règle de
 *   powersync/sync-config.yaml). Ordre : adhésion la plus ancienne d'abord (membre.cree_le),
 *   puis id de la ferme. Sans doublon.
 *
 * choisirFermeActive(fermes, memorisee: string | null): string | null
 *   La ferme mémorisée si elle est encore parmi `fermes` ; sinon la première ; aucune → null.
 *
 * Choix mémorisé, par utilisateur (deux comptes sur un téléphone ne se mélangent pas) :
 *   clé localStorage `planif.ferme-active.<utilisateurId>`, valeur = id de la ferme (texte brut).
 *   lireFermeMemorisee(stockage, utilisateurId): string | null  — ne lève jamais ;
 *   memoriserFerme(stockage, utilisateurId, fermeId): void      — ne lève jamais.
 *   (L'écran qui change de ferme viendra plus tard : ce ticket fixe la règle et la mémoire.)
 *
 * suivreFermeActive(base: BaseLocale, o: { utilisateurId; stockage }, rappel): () => void
 *   Appelle `rappel` avec l'état de la ferme active dès qu'il est connu, puis à chaque changement
 *   (tables `membre` et `ferme`, écriture locale ou arrivée par la synchro : base.onChange) :
 *     { etat: 'sans-ferme' }                  — aucune ferme (première synchro pas encore faite) ;
 *     { etat: 'prete', fermeId, fermes, porte } — porte = creerPorte(base, { utilisateurId, fermeId }).
 *   Pas de second rappel si la ferme active ne change pas. Rend le désabonnement.
 *
 * ── Contrat : apps/web/src/donnees/libelle-synchro.ts (JavaScript de démarrage : aucun import
 *    de @planif/sync ni de PowerSync) ──────────────────────────────────────────────────────────
 * libelleSynchro(etat: EtatSynchro, enAttente: number): string — texte de l'indicateur de la
 *   coquille (data-testid="etat-synchro", role="status", visible sur chaque onglet) :
 *     'session-expiree' → « Session expirée » (prime sur tout) ;
 *     'hors-ligne'      → « Hors ligne », ou « Hors ligne · N saisies en attente » si N > 0 ;
 *     'synchronise'     → « À jour », ou « N saisies en attente » si N > 0 ;
 *     'connexion'       → « Connexion… », ou « N saisies en attente » si N > 0.
 *   Singulier : « 1 saisie en attente ».
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import type { PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../packages/sync/src/test/base-memoire.ts';
import type { EtatSynchro } from './connecteur.ts';

interface FermeDisponible {
  readonly id: string;
  readonly nom: string;
}

type FermeActive =
  | { readonly etat: 'sans-ferme' }
  | { readonly etat: 'prete'; readonly fermeId: string; readonly fermes: readonly FermeDisponible[]; readonly porte: PorteDonnees };

type Stockage = Pick<Storage, 'getItem' | 'setItem'>;

interface ModuleFermeActive {
  lireFermes(base: BaseMemoire, utilisateurId: string): Promise<FermeDisponible[]>;
  choisirFermeActive(fermes: readonly FermeDisponible[], memorisee: string | null): string | null;
  lireFermeMemorisee(stockage: Pick<Storage, 'getItem'>, utilisateurId: string): string | null;
  memoriserFerme(stockage: Pick<Storage, 'setItem'>, utilisateurId: string, fermeId: string): void;
  suivreFermeActive(base: BaseMemoire, o: { readonly utilisateurId: string; readonly stockage: Stockage }, rappel: (e: FermeActive) => void): () => void;
}

interface ModuleLibelle {
  libelleSynchro(etat: EtatSynchro, enAttente: number): string;
}

/** Chemins tenus dans des variables : le typage ne dépend pas des modules pas encore écrits. */
const CHEMIN_FERME = './ferme-active.ts';
const CHEMIN_LIBELLE = './libelle-synchro.ts';

let f: ModuleFermeActive;
let l: ModuleLibelle;

beforeAll(async () => {
  f = (await import(/* @vite-ignore */ CHEMIN_FERME)) as ModuleFermeActive;
  l = (await import(/* @vite-ignore */ CHEMIN_LIBELLE)) as ModuleLibelle;
});

const MOI = '0192f0c1-0000-7000-8000-0000000000a1';
const AUTRE = '0192f0c1-0000-7000-8000-0000000000a2';
const F1 = '0192f0c1-0000-7000-8000-0000000000f1';
const F2 = '0192f0c1-0000-7000-8000-0000000000f2';
const F3 = '0192f0c1-0000-7000-8000-0000000000f3';
const F4 = '0192f0c1-0000-7000-8000-0000000000f4';
const F5 = '0192f0c1-0000-7000-8000-0000000000f5';

let bases: BaseMemoire[] = [];
afterEach(() => {
  for (const b of bases) b.fermer();
  bases = [];
});

function nouvelleBase(): BaseMemoire {
  const b = creerBaseMemoire(SCHEMA_LOCAL);
  bases.push(b);
  return b;
}

let n = 0;
function ferme(base: BaseMemoire, id: string, nom: string, supprimee = false): void {
  base.recevoir('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, supprime_le) VALUES (?, ?, ?, ?, ?)', [
    id,
    nom,
    'Europe/Paris',
    '2026-01-01T00:00:00.000Z',
    supprimee ? '2026-02-01T00:00:00.000Z' : null,
  ]);
}
function membre(base: BaseMemoire, utilisateur: string, fermeId: string, creeLe: string, etat = 'accepte', supprime = false): void {
  n++;
  base.recevoir('INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, cree_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    `0192f0c1-0000-7000-8000-${n.toString(16).padStart(12, '0')}`,
    utilisateur,
    fermeId,
    'proprietaire',
    etat,
    creeLe,
    supprime ? '2026-03-01T00:00:00.000Z' : null,
  ]);
}

/** Stockage en mémoire ; `casse` : chaque accès lève (navigation privée, quota). */
function stockage(casse = false): Stockage & { readonly valeurs: Map<string, string> } {
  const valeurs = new Map<string, string>();
  return {
    valeurs,
    getItem: (k) => {
      if (casse) throw new Error('stockage indisponible');
      return valeurs.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (casse) throw new Error('stockage indisponible');
      valeurs.set(k, v);
    },
  };
}

async function attendre(condition: () => boolean): Promise<void> {
  for (let k = 0; k < 100 && !condition(); k++) await new Promise((r) => setTimeout(r, 0));
}

describe('T11 : fermes de l’utilisateur dans la base locale', () => {
  it('membre accepté et non supprimé, ferme non supprimée ; adhésion la plus ancienne d’abord', async () => {
    const base = nouvelleBase();
    ferme(base, F1, 'Ferme B');
    ferme(base, F2, 'Ferme A');
    ferme(base, F3, 'Invitée');
    ferme(base, F4, 'Supprimée', true);
    ferme(base, F5, 'Quittée');
    membre(base, MOI, F1, '2026-03-01T00:00:00.000Z');
    membre(base, MOI, F2, '2026-01-10T00:00:00.000Z');
    membre(base, MOI, F3, '2025-01-01T00:00:00.000Z', 'invite');
    membre(base, MOI, F4, '2025-01-01T00:00:00.000Z');
    membre(base, MOI, F5, '2025-01-01T00:00:00.000Z', 'accepte', true);
    membre(base, AUTRE, F1, '2020-01-01T00:00:00.000Z');
    expect(await f.lireFermes(base, MOI)).toEqual([
      { id: F2, nom: 'Ferme A' },
      { id: F1, nom: 'Ferme B' },
    ]);
    expect(await f.lireFermes(base, AUTRE)).toEqual([{ id: F1, nom: 'Ferme B' }]);
    expect(await f.lireFermes(base, '0192f0c1-0000-7000-8000-0000000000ff')).toEqual([]);
  });

  it('même date d’adhésion : ordre des id', async () => {
    const base = nouvelleBase();
    ferme(base, F2, 'Deux');
    ferme(base, F1, 'Un');
    membre(base, MOI, F2, '2026-01-01T00:00:00.000Z');
    membre(base, MOI, F1, '2026-01-01T00:00:00.000Z');
    expect((await f.lireFermes(base, MOI)).map((x) => x.id)).toEqual([F1, F2]);
  });
});

describe('T11 : choix de la ferme active', () => {
  const FERMES = [
    { id: F1, nom: 'Un' },
    { id: F2, nom: 'Deux' },
  ];

  it('la mémorisée si elle existe encore, sinon la première, sinon null', () => {
    expect(f.choisirFermeActive(FERMES, null)).toBe(F1);
    expect(f.choisirFermeActive(FERMES, F2)).toBe(F2);
    expect(f.choisirFermeActive(FERMES, F3)).toBe(F1);
    expect(f.choisirFermeActive([], F2)).toBeNull();
    expect(f.choisirFermeActive([], null)).toBeNull();
  });

  it('mémoire par utilisateur, clé planif.ferme-active.<id> ; stockage cassé : ni exception ni choix', () => {
    const s = stockage();
    expect(f.lireFermeMemorisee(s, MOI)).toBeNull();
    f.memoriserFerme(s, MOI, F2);
    expect(s.valeurs.get(`planif.ferme-active.${MOI}`)).toBe(F2);
    expect(f.lireFermeMemorisee(s, MOI)).toBe(F2);
    expect(f.lireFermeMemorisee(s, AUTRE)).toBeNull();
    const casse = stockage(true);
    expect(() => {
      f.memoriserFerme(casse, MOI, F2);
    }).not.toThrow();
    expect(f.lireFermeMemorisee(casse, MOI)).toBeNull();
  });
});

describe('T11 : suivre la ferme active (base locale ouverte)', () => {
  it('sans ferme, puis prête quand la synchro apporte la ferme ; porte sur cette ferme', async () => {
    const base = nouvelleBase();
    const etats: FermeActive[] = [];
    const arreter = f.suivreFermeActive(base, { utilisateurId: MOI, stockage: stockage() }, (e) => etats.push(e));
    await attendre(() => etats.length > 0);
    expect(etats.map((e) => e.etat)).toEqual(['sans-ferme']);

    // Première synchro : la ferme et l'adhésion arrivent.
    ferme(base, F1, 'Ferme de Benoît');
    membre(base, MOI, F1, '2026-01-01T00:00:00.000Z');
    base.recevoir('INSERT INTO zone (id, ferme_id, nom) VALUES (?, ?, ?)', ['0192f0c1-0000-7000-8000-0000000000c1', F1, 'Tunnel 1']);
    await attendre(() => etats.at(-1)?.etat === 'prete');
    const derniere = etats.at(-1);
    expect(derniere?.etat).toBe('prete');
    if (derniere?.etat !== 'prete') return;
    expect(derniere.fermeId).toBe(F1);
    expect(derniere.fermes).toEqual([{ id: F1, nom: 'Ferme de Benoît' }]);
    const zones = await derniere.porte.lire<{ nom: string }>('SELECT nom FROM zone WHERE ferme_id = ?', [derniere.fermeId]);
    expect(zones).toEqual([{ nom: 'Tunnel 1' }]);
    // La porte écrit pour cette ferme et cet utilisateur.
    await derniere.porte.saisirEvenement({
      type: 'note',
      date: '2026-09-30',
      source: 'tap',
      culture: null,
      emplacementIds: [],
      note: 'essai',
      photos: [],
      remplaceEvenement: null,
      detail: {},
    } as unknown as Parameters<PorteDonnees['saisirEvenement']>[0]);
    expect(base.lireDirect('SELECT ferme_id, auteur_id FROM evenement')).toEqual([{ ferme_id: F1, auteur_id: MOI }]);

    // Un changement qui ne touche pas la ferme active : pas de nouveau rappel.
    const avant = etats.length;
    base.recevoir("UPDATE ferme SET nom = 'Ferme de Benoît' WHERE id = ?", [F1]);
    await attendre(() => false);
    expect(etats.length).toBe(avant);
    arreter();
  });

  it('plusieurs fermes : la mémorisée ; sans mémoire, la plus ancienne adhésion', async () => {
    const base = nouvelleBase();
    ferme(base, F1, 'Récente');
    ferme(base, F2, 'Ancienne');
    membre(base, MOI, F1, '2026-05-01T00:00:00.000Z');
    membre(base, MOI, F2, '2024-05-01T00:00:00.000Z');

    const sansMemoire: FermeActive[] = [];
    const a = f.suivreFermeActive(base, { utilisateurId: MOI, stockage: stockage() }, (e) => sansMemoire.push(e));
    await attendre(() => sansMemoire.length > 0);
    expect(sansMemoire.at(-1)).toMatchObject({ etat: 'prete', fermeId: F2 });
    a();

    const s = stockage();
    f.memoriserFerme(s, MOI, F1);
    const avecMemoire: FermeActive[] = [];
    const b = f.suivreFermeActive(base, { utilisateurId: MOI, stockage: s }, (e) => avecMemoire.push(e));
    await attendre(() => avecMemoire.length > 0);
    expect(avecMemoire.at(-1)).toMatchObject({ etat: 'prete', fermeId: F1 });

    // La ferme mémorisée disparaît (adhésion retirée par la synchro) : on passe à l'autre.
    base.recevoir("UPDATE membre SET supprime_le = '2026-09-30T00:00:00.000Z' WHERE ferme_id = ?", [F1]);
    await attendre(() => avecMemoire.at(-1)?.etat === 'prete' && (avecMemoire.at(-1) as { fermeId: string }).fermeId === F2);
    expect(avecMemoire.at(-1)).toMatchObject({ etat: 'prete', fermeId: F2 });
    b();
  });

  it('après désabonnement, plus aucun rappel', async () => {
    const base = nouvelleBase();
    const etats: FermeActive[] = [];
    const arreter = f.suivreFermeActive(base, { utilisateurId: MOI, stockage: stockage() }, (e) => etats.push(e));
    await attendre(() => etats.length > 0);
    arreter();
    const avant = etats.length;
    ferme(base, F1, 'Tard');
    membre(base, MOI, F1, '2026-01-01T00:00:00.000Z');
    await attendre(() => false);
    expect(etats.length).toBe(avant);
  });
});

describe('T11 : libellé de l’état de la synchro (indicateur de la coquille)', () => {
  it('À jour, saisies en attente, hors ligne, session expirée', () => {
    expect(l.libelleSynchro('synchronise', 0)).toBe('À jour');
    expect(l.libelleSynchro('synchronise', 1)).toBe('1 saisie en attente');
    expect(l.libelleSynchro('synchronise', 3)).toBe('3 saisies en attente');
    expect(l.libelleSynchro('connexion', 0)).toBe('Connexion…');
    expect(l.libelleSynchro('connexion', 2)).toBe('2 saisies en attente');
    expect(l.libelleSynchro('hors-ligne', 0)).toBe('Hors ligne');
    expect(l.libelleSynchro('hors-ligne', 1)).toBe('Hors ligne · 1 saisie en attente');
    expect(l.libelleSynchro('hors-ligne', 12)).toBe('Hors ligne · 12 saisies en attente');
    expect(l.libelleSynchro('session-expiree', 0)).toBe('Session expirée');
    expect(l.libelleSynchro('session-expiree', 5)).toBe('Session expirée');
  });
});
