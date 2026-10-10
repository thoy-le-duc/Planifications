/**
 * Tests d'acceptation T32g — « Personnaliser » une espèce de la bibliothèque commune
 * (docs/backlog/T32g-personnaliser-espece.md ; Q39) : la porte écrit, en une transaction, une
 * espèce de la ferme qui copie l'espèce de la bibliothèque (nom, champs ; profil nul : le défaut,
 * règle de l'asperge comprise, est retrouvé par le nom), côté téléphone, sans réseau, sur un SQLite en mémoire.
 * Contrat : ./test/contrat-personnaliser.ts (dont la décision sur l'origine de la copie : son nom).
 *
 * Le serveur reste l'arbitre des droits (apps/api/src/sync/personnaliser-droits.integration.test.ts
 * et profil-droits.integration.test.ts).
 */
import { croissancePerenneA, profilEffectif, profilParDefaut, type DateCalendaire, type Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees } from './test/contrat.ts';
import { exigerReglerProfil } from './test/contrat-profil.ts';
import { dejaPersonnalisee, exigerPersonnaliser, SEUL_LE_GERANT_PERSONNALISER } from './test/contrat-personnaliser.ts';

const GERANT = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b10' as Id<'Utilisateur'>;
const EQUIPIER = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b11' as Id<'Utilisateur'>;
const RETIRE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b12' as Id<'Utilisateur'>;
const INVITE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b13' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b20' as Id<'Ferme'>;
const VOISINE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b21';
const SOLANACEES_BIBLIOTHEQUE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b30';
const ASPARAGACEES_BIBLIOTHEQUE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b31';
const FAMILLE_FERME = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b32';
const TOMATE_BIBLIOTHEQUE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b40';
const ASPERGE_BIBLIOTHEQUE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b41';
const AUBERGINE_BIBLIOTHEQUE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b42';
const POIVRON_SUPPRIME_BIBLIOTHEQUE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b43';
const RADIS_FERME = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b44';
const TOMATE_VOISINE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b45';
const INCONNUE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b46';
const ITINERAIRE_TOMATE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b50';
const VARIETE_TOMATE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b51';
const PLANTATION_ASPERGE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b52';
const SERIE_TOMATE = '0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b53';
const CREE = '2026-10-01T08:00:00.000Z';
const INSTANT = new Date('2026-10-10T06:00:00.000Z');
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOMATE_1_8 = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 90 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;

type Ligne = Record<string, unknown>;

describe('T32g : porte.personnaliserEspece', () => {
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
    r(`INSERT INTO famille (id, ferme_id, nom) VALUES (?, NULL, 'Solanacées')`, [SOLANACEES_BIBLIOTHEQUE]);
    r(`INSERT INTO famille (id, ferme_id, nom) VALUES (?, NULL, 'Asparagacées')`, [ASPARAGACEES_BIBLIOTHEQUE]);
    r(`INSERT INTO famille (id, ferme_id, nom) VALUES (?, ?, 'Brassicacées')`, [FAMILLE_FERME, FERME]);
    const espece = (
      id: string,
      ferme: string | null,
      famille: string,
      nom: string,
      o: { categorie?: string; perenne?: number; unite?: string; min?: number | null; conseille?: number | null; supprime?: string | null } = {},
    ) => {
      r(
        `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance, cree_le, modifie_le, supprime_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [id, ferme, famille, nom, o.categorie ?? 'legume', o.perenne ?? 0, o.unite ?? 'kg', o.min ?? null, o.conseille ?? null, CREE, CREE, o.supprime ?? null],
      );
    };
    espece(TOMATE_BIBLIOTHEQUE, null, SOLANACEES_BIBLIOTHEQUE, 'Tomate', { min: 3, conseille: 4 });
    espece(ASPERGE_BIBLIOTHEQUE, null, ASPARAGACEES_BIBLIOTHEQUE, 'Asperge', { perenne: 1, unite: 'botte' });
    espece(AUBERGINE_BIBLIOTHEQUE, null, SOLANACEES_BIBLIOTHEQUE, 'Aubergine');
    espece(POIVRON_SUPPRIME_BIBLIOTHEQUE, null, SOLANACEES_BIBLIOTHEQUE, 'Poivron', { supprime: CREE });
    espece(RADIS_FERME, FERME, FAMILLE_FERME, 'Radis', { unite: 'botte' });
    espece(TOMATE_VOISINE, VOISINE, SOLANACEES_BIBLIOTHEQUE, 'Tomate');
    // Ce que la ferme cultive déjà sur les espèces de la bibliothèque : doit rester lié à l'origine.
    r(
      `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, NULL, 'Tomate sous tunnel', 'plant_achete', '{}', ?, ?, NULL)`,
      [ITINERAIRE_TOMATE, FERME, TOMATE_BIBLIOTHEQUE, CREE, CREE],
    );
    r(`INSERT INTO variete (id, ferme_id, espece_id, nom, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, 'Cœur de bœuf', ?, ?, NULL)`, [
      VARIETE_TOMATE,
      FERME,
      TOMATE_BIBLIOTHEQUE,
      CREE,
      CREE,
    ]);
    r(`INSERT INTO serie (id, ferme_id, espece_id, itineraire_id, statut, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, ?, 'prevue', ?, ?, NULL)`, [
      SERIE_TOMATE,
      FERME,
      TOMATE_BIBLIOTHEQUE,
      ITINERAIRE_TOMATE,
      CREE,
      CREE,
    ]);
    r(
      `INSERT INTO plantation (id, ferme_id, espece_id, variete_id, date_plantation, nombre_plants, date_arrachage, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, NULL, '2020-03-01', 1200, NULL, ?, ?, NULL)`,
      [PLANTATION_ASPERGE, FERME, ASPERGE_BIBLIOTHEQUE, CREE, CREE],
    );
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

  const personnaliser = (especeId: string, utilisateurId: Id<'Utilisateur'> = GERANT): Promise<string> => exigerPersonnaliser(porte(utilisateurId))(especeId);

  const espece = (id: string): Ligne | undefined => base.lireDirect<Ligne>('SELECT * FROM espece WHERE id = ?', [id])[0];
  const profilDe = (id: string): unknown => {
    const p = espece(id)?.profil_croissance;
    return typeof p === 'string' ? (JSON.parse(p) as unknown) : p;
  };
  /** Toutes les lignes que la copie ne doit pas toucher. */
  const tout = (): unknown => ({
    espece: base.lireDirect('SELECT * FROM espece ORDER BY id'),
    itineraire: base.lireDirect('SELECT * FROM itineraire ORDER BY id'),
    variete: base.lireDirect('SELECT * FROM variete ORDER BY id'),
    serie: base.lireDirect('SELECT * FROM serie ORDER BY id'),
    plantation: base.lireDirect('SELECT * FROM plantation ORDER BY id'),
    modification: base.lireDirect('SELECT * FROM modification ORDER BY id'),
  });
  const especesDeLaFerme = (nom: string): Ligne[] => base.lireDirect<Ligne>('SELECT * FROM espece WHERE ferme_id = ? AND nom = ? ORDER BY id', [FERME, nom]);

  /** Rejet attendu : rien d'écrit dans la base locale. */
  async function rejete(especeId: string, attendu: RegExp | string, utilisateurId: Id<'Utilisateur'> = GERANT): Promise<void> {
    const avant = tout();
    const ecritures = base.ecritures.length;
    await expect(personnaliser(especeId, utilisateurId)).rejects.toThrow(attendu);
    expect(tout(), 'rien d’écrit').toEqual(avant);
    expect(base.ecritures.length, 'aucun ordre d’écriture exécuté').toBe(ecritures);
  }

  describe('le gérant personnalise une espèce de la bibliothèque', () => {
    it('Tomate : une transaction, un seul INSERT espece ; une « Tomate » de la ferme, copie des champs, profil nul (défaut retrouvé par le nom)', async () => {
      const ecritures = base.ecritures.length;
      const id = await personnaliser(TOMATE_BIBLIOTHEQUE);
      expect(transactions).toBe(1);
      expect(id).toMatch(UUID_V7);
      expect(id).not.toBe(TOMATE_BIBLIOTHEQUE);
      const ordres = base.ecritures.slice(ecritures);
      expect(ordres).toHaveLength(1);
      expect(ordres[0]).toMatch(/^INSERT\s+INTO\s+["`]?espece["`]?\s*\(/i);
      expect(ordres.join('\n')).not.toMatch(/\bmodification\b/i);
      expect(espece(id)).toMatchObject({
        id,
        ferme_id: FERME,
        famille_id: SOLANACEES_BIBLIOTHEQUE,
        nom: 'Tomate',
        categorie: 'legume',
        perenne: 0,
        unite_recolte: 'kg',
        delai_retour_minimal_ans: 3,
        delai_retour_conseille_ans: 4,
        cree_le: INSTANT.toISOString(),
        modifie_le: INSTANT.toISOString(),
        supprime_le: null,
      });
      expect(espece(id)?.profil_croissance, 'profil nul : le défaut n’est pas figé dans la copie').toBeNull();
      expect(profilEffectif({ nom: String(espece(id)?.nom), profilCroissance: espece(id)?.profil_croissance }), 'profil effectif : le défaut de la Tomate').toEqual(
        profilParDefaut('Tomate').profil,
      );
    });

    it('le profil effectif de la copie est celui de l’origine (profilEffectif du cœur, par le nom)', async () => {
      const origine = espece(AUBERGINE_BIBLIOTHEQUE);
      const id = await personnaliser(AUBERGINE_BIBLIOTHEQUE);
      expect(espece(id)?.profil_croissance).toBeNull();
      expect(profilEffectif({ nom: String(espece(id)?.nom), profilCroissance: espece(id)?.profil_croissance })).toEqual(
        profilEffectif({ nom: 'Aubergine', profilCroissance: origine?.profil_croissance ?? null }),
      );
    });

    it('la copie est ensuite réglable : le gérant la règle à 1,8 m par reglerProfilCroissance', async () => {
      const id = await personnaliser(TOMATE_BIBLIOTHEQUE);
      await exigerReglerProfil(porte())(id, TOMATE_1_8);
      expect(profilDe(id)).toEqual(TOMATE_1_8);
      expect(espece(TOMATE_BIBLIOTHEQUE)?.profil_croissance, 'la bibliothèque n’a toujours pas de profil').toBeNull();
    });

    it('« Rétablir la valeur par défaut » sur la copie réglée : profil de nouveau nul', async () => {
      const id = await personnaliser(TOMATE_BIBLIOTHEQUE);
      await exigerReglerProfil(porte())(id, TOMATE_1_8);
      await exigerReglerProfil(porte())(id, null);
      expect(espece(id)?.profil_croissance).toBeNull();
    });

    it('cultures et itinéraires existants inchangés : toujours liés à l’espèce d’origine ; l’origine elle-même intacte', async () => {
      const avant = {
        itineraire: base.lireDirect('SELECT * FROM itineraire ORDER BY id'),
        variete: base.lireDirect('SELECT * FROM variete ORDER BY id'),
        serie: base.lireDirect('SELECT * FROM serie ORDER BY id'),
        plantation: base.lireDirect('SELECT * FROM plantation ORDER BY id'),
        origine: espece(TOMATE_BIBLIOTHEQUE),
      };
      await personnaliser(TOMATE_BIBLIOTHEQUE);
      await personnaliser(ASPERGE_BIBLIOTHEQUE);
      expect(base.lireDirect('SELECT * FROM itineraire ORDER BY id')).toEqual(avant.itineraire);
      expect(base.lireDirect('SELECT * FROM variete ORDER BY id')).toEqual(avant.variete);
      expect(base.lireDirect('SELECT * FROM serie ORDER BY id')).toEqual(avant.serie);
      expect(base.lireDirect('SELECT * FROM plantation ORDER BY id')).toEqual(avant.plantation);
      expect(espece(TOMATE_BIBLIOTHEQUE)).toEqual(avant.origine);
      expect(base.lireDirect<Ligne>('SELECT espece_id FROM itineraire WHERE id = ?', [ITINERAIRE_TOMATE])[0]?.espece_id).toBe(TOMATE_BIBLIOTHEQUE);
      expect(base.lireDirect<Ligne>('SELECT espece_id FROM plantation WHERE id = ?', [PLANTATION_ASPERGE])[0]?.espece_id).toBe(ASPERGE_BIBLIOTHEQUE);
    });
  });

  describe('l’asperge personnalisée garde « pas de fougère pendant la récolte » (Q33)', () => {
    const d = (s: string): DateCalendaire => s as DateCalendaire;
    const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
    const CAMPAGNE = { annee: 2027, debutRecolte: d('2027-04-01'), finRecolte: d('2027-06-15') };

    it('copie à profil nul ; son profil effectif (par le nom) porte fougereApresRecolte: true et le cycle annuel de l’asperge', async () => {
      const id = await personnaliser(ASPERGE_BIBLIOTHEQUE);
      expect(espece(id)?.profil_croissance).toBeNull();
      const effectif = profilEffectif({ nom: String(espece(id)?.nom), profilCroissance: espece(id)?.profil_croissance });
      expect(effectif).toEqual(profilParDefaut('Asperge').profil);
      expect(effectif).toMatchObject({ fougereApresRecolte: true });
      expect(espece(id)).toMatchObject({ nom: 'Asperge', perenne: 1, unite_recolte: 'botte', famille_id: ASPARAGACEES_BIBLIOTHEQUE });
    });

    it('cœur : relu de la base, le profil de la copie ne fait pas monter la fougère pendant la récolte, seulement après', async () => {
      const id = await personnaliser(ASPERGE_BIBLIOTHEQUE);
      const profil = profilEffectif({ nom: String(espece(id)?.nom), profilCroissance: espece(id)?.profil_croissance });
      expect(profil.fougereApresRecolte).toBe(true);
      const pendant = croissancePerenneA({ plantation: PLANTATION, campagne: CAMPAGNE }, profil, d('2027-05-10'));
      expect(pendant.hauteurM, 'turions seuls pendant la récolte').toBe(0);
      const apres = croissancePerenneA({ plantation: PLANTATION, campagne: CAMPAGNE }, profil, d('2027-08-15'));
      expect(apres.hauteurM, 'la fougère monte après la fin de la récolte').toBeGreaterThan(0);
    });

    it('réglée ensuite par le gérant (hauteur 1,2 m, champ gardé) : toujours pas de fougère pendant la récolte', async () => {
      const id = await personnaliser(ASPERGE_BIBLIOTHEQUE);
      const reglee = { ...profilParDefaut('Asperge').profil, hauteurMaxM: 1.2 };
      await exigerReglerProfil(porte())(id, reglee);
      expect(profilDe(id), 'le premier réglage écrit le profil, champ de l’asperge gardé').toEqual(reglee);
      const profil = profilEffectif({ nom: String(espece(id)?.nom), profilCroissance: espece(id)?.profil_croissance });
      expect(croissancePerenneA({ plantation: PLANTATION, campagne: CAMPAGNE }, profil, d('2027-05-10')).hauteurM).toBe(0);
    });
  });

  describe('deux copies de la même espèce : refusées (Q39)', () => {
    it('deuxième personnalisation de la Tomate : « Tomate est déjà personnalisée », rien d’écrit', async () => {
      await personnaliser(TOMATE_BIBLIOTHEQUE);
      await rejete(TOMATE_BIBLIOTHEQUE, dejaPersonnalisee('Tomate'));
      expect(especesDeLaFerme('Tomate')).toHaveLength(1);
    });

    it('une espèce « tomate » de la ferme (nom rapproché sans casse ni accents) compte comme déjà personnalisée', async () => {
      base.recevoir(
        `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, profil_croissance, cree_le, modifie_le, supprime_le)
         VALUES ('0192f0c1-7a6e-7ccc-9b1e-3f6a2d4c6b60', ?, ?, ' TOMATE ', 'legume', 0, 'kg', NULL, ?, ?, NULL)`,
        [FERME, FAMILLE_FERME, CREE, CREE],
      );
      await rejete(TOMATE_BIBLIOTHEQUE, dejaPersonnalisee('Tomate'));
    });

    it('après suppression de la première copie : la personnalisation est de nouveau permise (nouvel id)', async () => {
      const premiere = await personnaliser(TOMATE_BIBLIOTHEQUE);
      base.recevoir('UPDATE espece SET supprime_le = ? WHERE id = ?', [INSTANT.toISOString(), premiere]);
      const seconde = await personnaliser(TOMATE_BIBLIOTHEQUE);
      expect(seconde).not.toBe(premiere);
      expect(espece(seconde)).toMatchObject({ ferme_id: FERME, nom: 'Tomate', supprime_le: null });
      expect(espece(premiere)?.supprime_le, 'la copie supprimée reste supprimée').toBe(INSTANT.toISOString());
    });

    it('la « Tomate » d’une autre ferme ne compte pas ; deux espèces différentes se personnalisent', async () => {
      const tomate = await personnaliser(TOMATE_BIBLIOTHEQUE);
      const aubergine = await personnaliser(AUBERGINE_BIBLIOTHEQUE);
      expect(tomate).not.toBe(aubergine);
      expect(especesDeLaFerme('Tomate')).toHaveLength(1);
      expect(especesDeLaFerme('Aubergine')).toHaveLength(1);
      expect(espece(TOMATE_VOISINE)?.ferme_id).toBe(VOISINE);
    });
  });

  describe('ce qui ne se personnalise pas : rejet, rien d’écrit', () => {
    it('espèce de la ferme, d’une autre ferme, supprimée de la bibliothèque, ou introuvable', async () => {
      await rejete(RADIS_FERME, /./);
      await rejete(TOMATE_VOISINE, /./);
      await rejete(POIVRON_SUPPRIME_BIBLIOTHEQUE, /./);
      await rejete(INCONNUE, /./);
    });
  });

  describe('pas gérant actif de la ferme : rejet « Seul le gérant… », rien d’écrit', () => {
    it.each([
      ['un équipier (gérant d’une autre ferme)', EQUIPIER],
      ['un gérant retiré', RETIRE],
      ['un gérant invité, pas encore accepté', INVITE],
    ])('%s personnalise la Tomate', async (_cas, u) => {
      await rejete(TOMATE_BIBLIOTHEQUE, SEUL_LE_GERANT_PERSONNALISER, u);
    });
  });
});
