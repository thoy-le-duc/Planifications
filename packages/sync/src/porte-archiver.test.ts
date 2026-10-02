/**
 * Tests d'acceptation T10l — archiver un refus vu (docs/backlog/T10l-refus-archives.md), côté
 * porte du téléphone (`@planif/sync`), sans réseau.
 *
 * Contrat (conçu par le chef d'équipe, précisé par le testeur) :
 *
 *   porte.archiverRefus(ids: readonly string[]): Promise<void>
 *
 * - Pour chaque refus `ids` de l'utilisateur de la porte, encore non archivé : la ligne locale
 *   refus_synchro reçoit `archive_le` = `maintenant().toISOString()`, et RIEN d'autre ne change
 *   dans la ligne (PowerSync l'envoie alors en PATCH `{ archive_le }`, seule forme que le serveur
 *   accepte : apps/api/src/sync/archiver-refus.integration.test.ts). La ligne n'est jamais
 *   supprimée : un refus archivé reste dans la base.
 * - Un id inconnu, d'un autre utilisateur ou déjà archivé : ignoré, sans erreur. Déjà archivé :
 *   la PREMIÈRE date d'archivage est gardée (décision du testeur, comme le serveur).
 * - Liste vide : aucune transaction.
 * - Au plus ECRITURES_MAX_PAR_LOT lignes modifiées par transaction locale (une transaction
 *   PowerSync = un lot envoyé, que le serveur refuse au-delà) ; jusqu'à ECRITURES_MAX_PAR_LOT
 *   refus, UNE seule transaction (un seul envoi).
 * - `surveillerRefus` ne rend que les refus non archivés : la liste change dès l'archivage local,
 *   et aussi quand l'archivage arrive par la synchro (autre téléphone de l'utilisateur).
 *
 * À ajouter au type `PorteDonnees` (packages/sync/src/types.ts).
 */
import { ECRITURES_MAX_PAR_LOT, type Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees, type RefusSynchro } from './test/contrat.ts';

const UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const AUTRE_UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b11';
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const PREMIER_INSTANT = new Date('2026-10-01T06:00:00.000Z');
const SECOND_INSTANT = new Date('2026-10-02T08:30:00.000Z');

type PorteArchive = PorteDonnees & { archiverRefus?: (ids: readonly string[]) => Promise<void> };

interface LigneRefus {
  id: string;
  utilisateur_id: string;
  ferme_id: string | null;
  nom_table: string;
  ligne_id: string;
  operation: string;
  motif: string;
  message: string;
  cree_le: string;
  saisie_type: string | null;
  saisie_culture: string | null;
  saisie_date: string | null;
  saisie_quantite: number | null;
  saisie_unite: string | null;
  archive_le: string | null;
}

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

describe('T10l : la porte archive un refus vu', () => {
  let sync: ModuleSync;
  let base: BaseMemoire;
  let porte: PorteArchive;
  let instant: Date;
  /** Lignes archivées par chaque transaction d'écriture, dans l'ordre. */
  let archiveesParTransaction: number[];

  beforeAll(async () => {
    sync = await chargerSync();
  });

  const compterArchives = (): number =>
    base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM refus_synchro WHERE archive_le IS NOT NULL')[0]?.n ?? -1;

  beforeEach(() => {
    base = creerBaseMemoire(sync.SCHEMA_LOCAL);
    instant = PREMIER_INSTANT;
    archiveesParTransaction = [];
    const compteuse: BaseLocale = {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: async (fn) => {
        const avant = compterArchives();
        const r = await base.writeTransaction(fn);
        archiveesParTransaction.push(compterArchives() - avant);
        return r;
      },
      onChange: (g, o) => base.onChange(g, o),
    };
    porte = sync.creerPorte(compteuse, { utilisateurId: UTILISATEUR, fermeId: FERME, maintenant: () => instant });
  });

  afterEach(() => {
    base.fermer();
  });

  function archiver(ids: readonly string[]): Promise<void> {
    expect(typeof porte.archiverRefus, 'porte.archiverRefus (T10l)').toBe('function');
    return porte.archiverRefus?.(ids) ?? Promise.reject(new Error('porte.archiverRefus absente'));
  }

  /** Un refus arrivé par la synchro (avec résumé T10k, pour vérifier que rien d'autre ne bouge). */
  function recevoirRefus(id: string, o: { utilisateur?: string; creeLe?: string; archiveLe?: string | null } = {}): void {
    base.recevoir(
      `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, cree_le,
                                  saisie_type, saisie_culture, saisie_date, saisie_quantite, saisie_unite, archive_le)
       VALUES (?, ?, ?, 'evenement', ?, 'PUT', 'recolte_annulee', ?, ?, 'recolte', 'Laitue', '2026-09-28', 12.5, 'kg', ?)`,
      [id, o.utilisateur ?? UTILISATEUR, FERME, `ligne-${id}`, `Message ${id}`, o.creeLe ?? '2026-09-30T06:00:00.000Z', o.archiveLe ?? null],
    );
  }

  const ligne = (id: string): LigneRefus | undefined => base.lireDirect<LigneRefus>('SELECT * FROM refus_synchro WHERE id = ?', [id])[0];
  const compterLignes = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM refus_synchro')[0]?.n ?? -1;

  it('archive un refus : archive_le à l’instant de la porte (ISO UTC), rien d’autre ne change, la ligne reste', async () => {
    recevoirRefus('r1');
    recevoirRefus('r2');
    const avant = ligne('r1');
    expect(avant?.archive_le, 'colonne archive_le dans le schéma local, nulle à l’arrivée').toBeNull();

    await archiver(['r1']);

    expect(ligne('r1')).toEqual({ ...avant, archive_le: '2026-10-01T06:00:00.000Z' });
    expect(ligne('r2')?.archive_le, 'les autres refus ne bougent pas').toBeNull();
    expect(compterLignes(), 'jamais supprimé : le refus archivé reste dans la base').toBe(2);
    expect(archiveesParTransaction, 'une seule transaction locale').toEqual([1]);
  });

  it('surveillerRefus : le refus archivé sort de la liste tout de suite', async () => {
    recevoirRefus('r1', { creeLe: '2026-09-30T06:00:01.000Z' });
    recevoirRefus('r2', { creeLe: '2026-09-30T06:00:02.000Z' });
    const vus: RefusSynchro[][] = [];
    const arreter = porte.surveillerRefus((r) => vus.push(r));
    await jusqua(() => vus.at(-1)?.length === 2);

    await archiver(['r2']);
    await jusqua(() => vus.at(-1)?.length === 1);
    expect(vus.at(-1)?.map((r) => r.id)).toEqual(['r1']);
    arreter();
  });

  it('archivé sur un autre téléphone (archive_le arrivé par la synchro) : absent de la liste, aussi pendant qu’elle est ouverte', async () => {
    recevoirRefus('r-deja', { archiveLe: '2026-09-30T07:00:00.000Z', creeLe: '2026-09-30T06:00:03.000Z' });
    recevoirRefus('r1', { creeLe: '2026-09-30T06:00:01.000Z' });
    recevoirRefus('r2', { creeLe: '2026-09-30T06:00:02.000Z' });
    const vus: RefusSynchro[][] = [];
    const arreter = porte.surveillerRefus((r) => vus.push(r));
    await jusqua(() => vus.length > 0);
    await attendre();
    expect(vus.at(-1)?.map((r) => r.id), 'un refus déjà archivé ne s’affiche pas').toEqual(['r2', 'r1']);

    // L'autre téléphone archive r1 : la synchro met à jour la ligne locale.
    base.recevoir('UPDATE refus_synchro SET archive_le = ? WHERE id = ?', ['2026-10-01T05:00:00.000Z', 'r1']);
    await jusqua(() => vus.at(-1)?.length === 1);
    expect(vus.at(-1)?.map((r) => r.id)).toEqual(['r2']);
    arreter();
  });

  it('déjà archivé : la première date d’archivage est gardée', async () => {
    recevoirRefus('r1');
    await archiver(['r1']);
    instant = SECOND_INSTANT;
    await archiver(['r1']);
    expect(ligne('r1')?.archive_le).toBe('2026-10-01T06:00:00.000Z');
    expect(archiveesParTransaction.reduce((a, b) => a + b, 0), 'une seule ligne archivée en tout').toBe(1);
  });

  it('archivé par la synchro puis « Archiver » ici : la date reçue est gardée', async () => {
    recevoirRefus('r1', { archiveLe: '2026-09-30T07:00:00.000Z' });
    await archiver(['r1']);
    expect(ligne('r1')?.archive_le).toBe('2026-09-30T07:00:00.000Z');
  });

  it('le refus d’un autre utilisateur présent dans la base : jamais archivé, même avec son id', async () => {
    recevoirRefus('r-moi');
    recevoirRefus('r-autre', { utilisateur: AUTRE_UTILISATEUR });
    await archiver(['r-moi', 'r-autre']);
    expect(ligne('r-moi')?.archive_le).toBe('2026-10-01T06:00:00.000Z');
    expect(ligne('r-autre')?.archive_le, 'refus d’un autre compte : intact').toBeNull();
  });

  it('id inconnu : ignoré, sans erreur ; liste vide : aucune transaction', async () => {
    recevoirRefus('r1');
    await archiver(['inconnu']);
    expect(ligne('r1')?.archive_le).toBeNull();
    expect(compterLignes(), 'aucune ligne créée').toBe(1);

    archiveesParTransaction = [];
    await archiver([]);
    expect(archiveesParTransaction, 'liste vide : aucune transaction').toEqual([]);
  });

  it(`« Tout archiver » : ${String(ECRITURES_MAX_PAR_LOT)} refus en UNE transaction ; au-delà, plusieurs, jamais plus de ${String(ECRITURES_MAX_PAR_LOT)} lignes chacune`, async () => {
    const ids = Array.from({ length: ECRITURES_MAX_PAR_LOT * 2 + 3 }, (_, n) => `r-${String(n).padStart(5, '0')}`);
    for (const id of ids) recevoirRefus(id);

    await archiver(ids.slice(0, ECRITURES_MAX_PAR_LOT));
    expect(archiveesParTransaction, `${String(ECRITURES_MAX_PAR_LOT)} refus : un seul envoi`).toEqual([ECRITURES_MAX_PAR_LOT]);

    archiveesParTransaction = [];
    await archiver(ids);
    expect(compterArchives(), 'tous archivés').toBe(ids.length);
    for (const n of archiveesParTransaction) expect(n, 'lignes modifiées par transaction locale').toBeLessThanOrEqual(ECRITURES_MAX_PAR_LOT);
    expect(archiveesParTransaction.reduce((a, b) => a + b, 0)).toBe(ids.length - ECRITURES_MAX_PAR_LOT);
  });
});
