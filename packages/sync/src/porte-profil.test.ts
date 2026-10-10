/**
 * Tests d'acceptation T32c — la porte écrit le profil de croissance d'une espèce
 * (docs/backlog/T32c-reglage-profils.md ; Q35 : gérant seulement), côté téléphone, sans réseau,
 * sur un SQLite en mémoire. Contrat : ./test/contrat-profil.ts.
 *
 * La porte rejoue ce que le serveur refuserait (droits du gérant, règles du cœur, espèce de la
 * ferme), pour que le maraîcher le sache tout de suite, au champ, hors ligne ; le serveur reste
 * l'arbitre (apps/api/src/sync/profil-droits.integration.test.ts).
 */
import type { Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees } from './test/contrat.ts';
import { exigerReglerProfil, SEUL_LE_GERANT_PROFIL } from './test/contrat-profil.ts';

const GERANT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b10' as Id<'Utilisateur'>;
const EQUIPIER = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b11' as Id<'Utilisateur'>;
const RETIRE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b12' as Id<'Utilisateur'>;
const INVITE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b13' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b20' as Id<'Ferme'>;
const VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b21';
const FAMILLE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b30';
const TOMATE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b40';
const ASPERGE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b41';
const TOMATE_VOISINE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b42';
const TOMATE_BIBLIOTHEQUE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b43';
const INCONNUE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c6b44';
const CREE = '2026-10-01T08:00:00.000Z';
const INSTANT = new Date('2026-10-10T06:00:00.000Z');

const TOMATE_1_8 = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 90 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;

const ASPERGE_REGLEE = {
  forme: 'touffe',
  hauteurMaxM: 1.3,
  duree: { en: 'jours', jours: 100 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: { debourrement: '04-01', repos: '11-15' },
  fougereApresRecolte: true,
} as const;

interface LigneEspece {
  id: string;
  ferme_id: string | null;
  nom: string;
  unite_recolte: string;
  profil_croissance: string | null;
  cree_le: string;
  modifie_le: string;
}

describe('T32c : porte.reglerProfilCroissance', () => {
  let sync: ModuleSync;
  let base: BaseMemoire;
  let transactions: number;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  beforeEach(() => {
    base = creerBaseMemoire(sync.SCHEMA_LOCAL);
    transactions = 0;
    const r = (sql: string, p: readonly unknown[]) => {
      base.recevoir(sql, p);
    };
    r(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES (?, 'Jardins de Garonne', 'Europe/Paris')`, [FERME]);
    r(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES (?, 'Ferme voisine', 'Europe/Paris')`, [VOISINE]);
    const membre = (id: string, u: string, f: string, role: string, etat: string, supprime: string | null) => {
      r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES (?, ?, ?, ?, ?, ?)`, [id, u, f, role, etat, supprime]);
    };
    membre('m1', GERANT, FERME, 'gerant', 'accepte', null);
    membre('m2', EQUIPIER, FERME, 'equipier', 'accepte', null);
    // L'équipier est gérant de la voisine : cela ne lui donne rien sur la ferme de la porte.
    membre('m3', EQUIPIER, VOISINE, 'gerant', 'accepte', null);
    membre('m4', RETIRE, FERME, 'gerant', 'accepte', CREE);
    membre('m5', INVITE, FERME, 'gerant', 'invite', null);
    membre('m6', GERANT, VOISINE, 'gerant', 'accepte', null);
    r(`INSERT INTO famille (id, ferme_id, nom) VALUES (?, ?, 'Solanacées')`, [FAMILLE, FERME]);
    const espece = (id: string, ferme: string | null, nom: string, profil: string | null) => {
      r(
        `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, profil_croissance, cree_le, modifie_le, supprime_le)
         VALUES (?, ?, ?, ?, 'legume', 0, 'kg', ?, ?, ?, NULL)`,
        [id, ferme, FAMILLE, nom, profil, CREE, CREE],
      );
    };
    espece(TOMATE, FERME, 'Tomate', null);
    espece(ASPERGE, FERME, 'Asperge', null);
    espece(TOMATE_VOISINE, VOISINE, 'Tomate', null);
    espece(TOMATE_BIBLIOTHEQUE, null, 'Tomate', null);
  });

  afterEach(() => {
    base.fermer();
  });

  function porte(utilisateurId: Id<'Utilisateur'> = GERANT): PorteDonnees {
    const compteuse: BaseLocale = {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: (fn) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: (g, o) => base.onChange(g, o),
    };
    return sync.creerPorte(compteuse, { utilisateurId, fermeId: FERME, maintenant: () => INSTANT });
  }

  const regler = (especeId: string, profil: unknown, utilisateurId: Id<'Utilisateur'> = GERANT): Promise<void> => exigerReglerProfil(porte(utilisateurId))(especeId, profil);

  const espece = (id: string): LigneEspece | undefined => base.lireDirect<LigneEspece>('SELECT * FROM espece WHERE id = ?', [id])[0];
  const profilDe = (id: string): unknown => {
    const p = espece(id)?.profil_croissance;
    return typeof p === 'string' ? (JSON.parse(p) as unknown) : p;
  };
  const toutes = (): unknown => base.lireDirect('SELECT * FROM espece ORDER BY id');

  /** Rejet attendu : rien d'écrit dans la base locale. */
  async function rejete(especeId: string, profil: unknown, attendu: RegExp | string, utilisateurId: Id<'Utilisateur'> = GERANT): Promise<void> {
    const avant = toutes();
    const ecritures = base.ecritures.length;
    await expect(regler(especeId, profil, utilisateurId)).rejects.toThrow(attendu);
    expect(toutes(), 'rien d’écrit').toEqual(avant);
    expect(base.ecritures.length, 'aucun ordre d’écriture exécuté').toBe(ecritures);
  }

  describe('le gérant', () => {
    it('règle la tomate à 1,8 m : une transaction, un UPDATE espece (profil, modifie_le), rien d’autre', async () => {
      const ecritures = base.ecritures.length;
      await regler(TOMATE, TOMATE_1_8);
      expect(transactions).toBe(1);
      expect(profilDe(TOMATE)).toEqual(TOMATE_1_8);
      const l = espece(TOMATE);
      expect(l?.modifie_le).toBe(INSTANT.toISOString());
      expect(l?.nom).toBe('Tomate');
      expect(l?.unite_recolte).toBe('kg');
      expect(l?.cree_le).toBe(CREE);
      const ordres = base.ecritures.slice(ecritures);
      expect(ordres).toHaveLength(1);
      expect(ordres[0]).toMatch(/^UPDATE\s+["`]?espece["`]?\s+SET\b/i);
      expect(ordres.join('\n')).not.toMatch(/\bmodification\b/i);
    });

    it('le texte écrit est la forme normalisée du cœur (cycleAnnuel null s’il manquait)', async () => {
      const sansCycle = Object.fromEntries(Object.entries(TOMATE_1_8).filter(([c]) => c !== 'cycleAnnuel'));
      await regler(TOMATE, sansCycle);
      expect(profilDe(TOMATE)).toEqual(TOMATE_1_8);
    });

    it('asperge : le champ fougereApresRecolte est écrit avec le profil', async () => {
      await regler(ASPERGE, ASPERGE_REGLEE);
      expect(profilDe(ASPERGE)).toEqual(ASPERGE_REGLEE);
    });

    it('« Rétablir la valeur par défaut » : null écrit NULL', async () => {
      await regler(TOMATE, TOMATE_1_8);
      await regler(TOMATE, null);
      expect(espece(TOMATE)?.profil_croissance).toBeNull();
    });

    it('profil hors bornes (7 m) : rejet avec le message du cœur, rien d’écrit', async () => {
      await rejete(TOMATE, { ...TOMATE_1_8, hauteurMaxM: 7 }, /hauteur/i);
    });

    it('durée nulle, forme inconnue : rejet, rien d’écrit', async () => {
      await rejete(TOMATE, { ...TOMATE_1_8, duree: { en: 'jours', jours: 0 } }, /durée/i);
      await rejete(TOMATE, { ...TOMATE_1_8, forme: 'arbre' }, /forme/i);
    });

    it('espèce d’une autre ferme (même gérant), de la bibliothèque, ou introuvable : rejet, rien d’écrit', async () => {
      await rejete(TOMATE_VOISINE, TOMATE_1_8, /./);
      await rejete(TOMATE_BIBLIOTHEQUE, TOMATE_1_8, /./);
      await rejete(INCONNUE, TOMATE_1_8, /./);
    });
  });

  describe('pas gérant actif de la ferme : rejet « Seul le gérant… », rien d’écrit', () => {
    it.each([
      ['un équipier (gérant d’une autre ferme)', EQUIPIER],
      ['un gérant retiré', RETIRE],
      ['un gérant invité, pas encore accepté', INVITE],
    ])('%s règle un profil', async (_cas, u) => {
      await rejete(TOMATE, TOMATE_1_8, SEUL_LE_GERANT_PROFIL, u);
    });

    it('un équipier rétablit la valeur par défaut : rejeté aussi', async () => {
      await regler(TOMATE, TOMATE_1_8);
      await rejete(TOMATE, null, SEUL_LE_GERANT_PROFIL, EQUIPIER);
      expect(profilDe(TOMATE)).toEqual(TOMATE_1_8);
    });
  });
});
