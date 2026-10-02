/**
 * Tests d'acceptation T10 — la porte d'accès aux données (`@planif/sync`), sans réseau.
 *
 * Contrat complet : src/test/contrat.ts. La base locale est un SQLite en mémoire
 * (src/test/base-memoire.ts) créé depuis `SCHEMA_LOCAL` : la porte ne doit utiliser que
 * `getAll`, `execute`, `writeTransaction` et `onChange` de la base.
 */
import { creerGenerateurId, type DateCalendaire, type Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type ModuleSync, type PorteDonnees, type RefusSynchro } from './test/contrat.ts';

const UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const AUTRE_UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b11' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const EMPLACEMENT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b30' as Id<'Emplacement'>;
const SERIE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b40' as Id<'Serie'>;
const MAINTENANT = new Date('2026-10-01T06:00:00.000Z');
const JOUR = '2026-10-01' as DateCalendaire;
const LENDEMAIN = '2026-10-02' as DateCalendaire;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface LigneEvenement {
  id: string;
  ferme_id: string;
  type: string;
  date: string;
  horodatage: string;
  auteur_id: string;
  source: string;
  serie_id: string | null;
  campagne_id: string | null;
  emplacement_ids: string;
  note: string | null;
  photos: string;
  remplace_sorte: string | null;
  remplace_evenement_id: string | null;
  detail: string;
}

/** Laisse passer les rappels asynchrones (promesses et minuteries à 0 ms). */
async function attendre(ms = 20): Promise<void> {
  await new Promise((fin) => setTimeout(fin, ms));
}

async function jusqua(condition: () => boolean, delaiMs = 1000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (!condition()) {
    if (Date.now() > fin) throw new Error('condition jamais remplie');
    await attendre(5);
  }
}

describe('T10 : porte d’accès aux données (@planif/sync)', () => {
  let sync: ModuleSync;
  let base: BaseMemoire;
  let porte: PorteDonnees;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  beforeEach(() => {
    base = creerBaseMemoire(sync.SCHEMA_LOCAL);
    let t = MAINTENANT.getTime();
    const nouvelId = creerGenerateurId({ horloge: () => t++, aleatoire: (n) => new Uint8Array(n).fill(7) });
    porte = sync.creerPorte(base, { utilisateurId: UTILISATEUR, fermeId: FERME, maintenant: () => MAINTENANT, nouvelId });
  });

  afterEach(() => {
    base.fermer();
  });

  function recolte(quantite: number, note: string | null = null) {
    return {
      type: 'recolte' as const,
      date: JOUR,
      source: 'tap' as const,
      culture: { sorte: 'serie' as const, serieId: SERIE },
      emplacementIds: [EMPLACEMENT],
      note,
      photos: [],
      remplaceEvenement: null,
      detail: { quantite, unite: 'kg' as const, categorie: 'I' },
    };
  }

  describe('schéma local', () => {
    it('contient au moins evenement et refus_synchro, avec les colonnes de Postgres', () => {
      const tables = new Map(sync.SCHEMA_LOCAL.tables.map((t) => [t.name, t.columns.map((c) => c.name)]));
      expect(tables.get('evenement')).toEqual(
        expect.arrayContaining([
          'ferme_id',
          'type',
          'date',
          'horodatage',
          'auteur_id',
          'source',
          'serie_id',
          'campagne_id',
          'emplacement_ids',
          'note',
          'photos',
          'remplace_sorte',
          'remplace_evenement_id',
          'detail',
        ]),
      );
      expect(tables.get('refus_synchro')).toEqual(
        expect.arrayContaining(['utilisateur_id', 'ferme_id', 'nom_table', 'ligne_id', 'operation', 'motif', 'message', 'cree_le']),
      );
    });

    it('ne contient aucune table de secrets', () => {
      const noms = sync.SCHEMA_LOCAL.tables.map((t) => t.name);
      expect(noms).not.toContain('code_connexion');
      expect(noms).not.toContain('jeton_renouvellement');
      for (const t of sync.SCHEMA_LOCAL.tables) {
        expect(t.columns.map((c) => c.name), t.name).not.toContain('jeton_hache');
        expect(t.columns.map((c) => c.name), t.name).not.toContain('code_hache');
      }
    });
  });

  describe('saisirEvenement', () => {
    it('écrit la récolte dans la base locale, complétée (id v7, ferme, auteur, horodatage), au format Postgres', async () => {
      const id = await porte.saisirEvenement(recolte(12.5, 'belle récolte'));
      expect(id).toMatch(UUID_V7);

      const lignes = base.lireDirect<LigneEvenement>('SELECT * FROM evenement');
      expect(lignes).toHaveLength(1);
      const l = lignes[0];
      expect(l).toMatchObject({
        id,
        ferme_id: FERME,
        type: 'recolte',
        date: '2026-10-01',
        horodatage: MAINTENANT.toISOString(),
        auteur_id: UTILISATEUR,
        source: 'tap',
        serie_id: SERIE,
        campagne_id: null,
        note: 'belle récolte',
        remplace_sorte: null,
        remplace_evenement_id: null,
      });
      expect(JSON.parse(l?.emplacement_ids ?? 'null')).toEqual([EMPLACEMENT]);
      expect(JSON.parse(l?.photos ?? 'null')).toEqual([]);
      expect(JSON.parse(l?.detail ?? 'null')).toEqual({ quantite: 12.5, unite: 'kg', categorie: 'I' });
    });

    it('deux saisies donnent deux ids distincts et croissants', async () => {
      const a = await porte.saisirEvenement(recolte(1));
      const b = await porte.saisirEvenement(recolte(2));
      expect(a).not.toBe(b);
      expect(a < b).toBe(true);
      expect(base.lireDirect('SELECT id FROM evenement')).toHaveLength(2);
    });

    it('n’écrit jamais un événement déjà existant : ajout seul, pas d’UPDATE ni de DELETE', async () => {
      await porte.saisirEvenement(recolte(1));
      await porte.saisirEvenement(recolte(2));
      for (const ordre of base.ecritures) {
        expect(ordre).toMatch(/^INSERT/i);
      }
    });

    it('une correction désigne l’événement corrigé, sans le modifier', async () => {
      const premier = await porte.saisirEvenement(recolte(10));
      const correction = await porte.saisirEvenement({
        ...recolte(12),
        remplaceEvenement: { sorte: 'correction', evenementId: premier },
      });
      const lignes = base.lireDirect<LigneEvenement>('SELECT * FROM evenement ORDER BY id');
      expect(lignes.map((l) => l.id)).toEqual([premier, correction]);
      expect(JSON.parse(lignes[0]?.detail ?? 'null')).toMatchObject({ quantite: 10 });
      expect(lignes[1]).toMatchObject({ remplace_sorte: 'correction', remplace_evenement_id: premier });
    });
  });

  describe('lire et ecrire', () => {
    it('lit avec des paramètres liés', async () => {
      await porte.saisirEvenement(recolte(3));
      await porte.saisirEvenement({ ...recolte(4), date: LENDEMAIN });
      const lignes = await porte.lire<{ date: string }>('SELECT date FROM evenement WHERE date >= ? ORDER BY date', [
        '2026-10-02',
      ]);
      expect(lignes).toEqual([{ date: '2026-10-02' }]);
    });

    it('écrit du SQL brut dans une transaction, et une erreur n’écrit rien', async () => {
      await porte.ecrire(`INSERT INTO evenement (id, ferme_id, type) VALUES (?, ?, 'observation')`, [
        '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b99',
        FERME,
      ]);
      expect(base.lireDirect('SELECT id FROM evenement')).toHaveLength(1);
      await expect(porte.ecrire('INSERT INTO table_qui_n_existe_pas (id) VALUES (?)', ['x'])).rejects.toThrow();
      expect(base.lireDirect('SELECT id FROM evenement')).toHaveLength(1);
    });
  });

  describe('surveiller', () => {
    it('donne le résultat tout de suite, puis après chaque écriture sur les tables surveillées', async () => {
      const resultats: { n: number }[][] = [];
      const arreter = porte.surveiller<{ n: number }>(
        { sql: 'SELECT count(*) AS n FROM evenement', tables: ['evenement'] },
        (lignes) => resultats.push(lignes),
      );
      await jusqua(() => resultats.length >= 1);
      expect(resultats.at(-1)).toEqual([{ n: 0 }]);

      await porte.saisirEvenement(recolte(5));
      await jusqua(() => resultats.at(-1)?.[0]?.n === 1);

      // Une ligne arrivée par la synchro (écrite par un autre téléphone) relance aussi la requête.
      base.recevoir(`INSERT INTO evenement (id, ferme_id, type) VALUES (?, ?, 'recolte')`, [
        '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b98',
        FERME,
      ]);
      await jusqua(() => resultats.at(-1)?.[0]?.n === 2);

      arreter();
      const avant = resultats.length;
      await porte.saisirEvenement(recolte(6));
      await attendre(50);
      expect(resultats).toHaveLength(avant);
    });

    it('ignore les écritures sur les autres tables', async () => {
      let appels = 0;
      const arreter = porte.surveiller({ sql: 'SELECT count(*) AS n FROM evenement', tables: ['evenement'] }, () => {
        appels++;
      });
      await jusqua(() => appels === 1);
      base.recevoir(
        `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, cree_le)
         VALUES ('r0', ?, ?, 'evenement', 'x', 'PATCH', 'ajout_seul', 'm', '2026-10-01T06:00:00.000Z')`,
        [UTILISATEUR, FERME],
      );
      await attendre(50);
      expect(appels).toBe(1);
      arreter();
    });
  });

  describe('surveillerRefus', () => {
    function recevoirRefus(id: string, utilisateurId: string, motif: string, creeLe: string): void {
      base.recevoir(
        `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, cree_le)
         VALUES (?, ?, ?, 'evenement', ?, 'PATCH', ?, ?, ?)`,
        [id, utilisateurId, FERME, `ligne-${id}`, motif, `Message ${id}`, creeLe],
      );
    }

    it('montre les refus de l’utilisateur, du plus récent au plus ancien, dès qu’ils arrivent', async () => {
      const vus: RefusSynchro[][] = [];
      const arreter = porte.surveillerRefus((refus) => vus.push(refus));
      await jusqua(() => vus.length >= 1);
      expect(vus.at(-1)).toEqual([]);

      recevoirRefus('r1', UTILISATEUR, 'ajout_seul', '2026-10-01T06:00:01.000Z');
      recevoirRefus('r2', AUTRE_UTILISATEUR, 'ajout_seul', '2026-10-01T06:00:02.000Z');
      recevoirRefus('r3', UTILISATEUR, 'ferme_interdite', '2026-10-01T06:00:03.000Z');
      await jusqua(() => vus.at(-1)?.length === 2);

      expect(vus.at(-1)).toEqual([
        {
          id: 'r3',
          nomTable: 'evenement',
          ligneId: 'ligne-r3',
          operation: 'PATCH',
          motif: 'ferme_interdite',
          message: 'Message r3',
          creeLe: '2026-10-01T06:00:03.000Z',
        },
        {
          id: 'r1',
          nomTable: 'evenement',
          ligneId: 'ligne-r1',
          operation: 'PATCH',
          motif: 'ajout_seul',
          message: 'Message r1',
          creeLe: '2026-10-01T06:00:01.000Z',
        },
      ]);
      arreter();
    });

    it('T10k : le résumé de la saisie refusée (colonnes saisie_*), absent quand le serveur n’en a pas', async () => {
      base.recevoir(
        `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, cree_le,
                                    saisie_type, saisie_culture, saisie_date, saisie_quantite, saisie_unite)
         VALUES (?, ?, ?, 'evenement', 'ligne-r5', 'PUT', 'recolte_annulee', 'Message r5', ?, ?, ?, ?, ?, ?)`,
        ['r5', UTILISATEUR, FERME, '2026-10-01T06:00:05.000Z', 'recolte', 'Laitue Batavia blonde', '2026-09-28', 12.5, 'kg'],
      );
      base.recevoir(
        `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, cree_le,
                                    saisie_type, saisie_culture, saisie_date, saisie_quantite, saisie_unite)
         VALUES (?, ?, ?, 'evenement', 'ligne-r6', 'PUT', 'auteur_invalide', 'Message r6', ?, ?, NULL, ?, NULL, NULL)`,
        ['r6', UTILISATEUR, FERME, '2026-10-01T06:00:04.000Z', 'realise', '2026-08-05'],
      );
      recevoirRefus('r7', UTILISATEUR, 'ajout_seul', '2026-10-01T06:00:03.000Z');
      const vus: RefusSynchro[][] = [];
      const arreter = porte.surveillerRefus((refus) => vus.push(refus));
      await jusqua(() => vus.at(-1)?.length === 3);
      const [r5, r6, r7] = vus.at(-1) ?? [];
      expect(r5?.saisie).toEqual({ type: 'recolte', culture: 'Laitue Batavia blonde', date: '2026-09-28', quantite: 12.5, unite: 'kg' });
      expect(r6?.saisie).toEqual({ type: 'realise', culture: null, date: '2026-08-05', quantite: null, unite: null });
      expect(r7?.saisie, 'aucun résumé : pas de champ saisie').toBeUndefined();
      expect(r7).toEqual({
        id: 'r7',
        nomTable: 'evenement',
        ligneId: 'ligne-r7',
        operation: 'PATCH',
        motif: 'ajout_seul',
        message: 'Message r7',
        creeLe: '2026-10-01T06:00:03.000Z',
      });
      arreter();
    });
  });
});
