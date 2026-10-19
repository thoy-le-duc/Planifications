/**
 * Tests d'acceptation T41, serveur — la bibliothèque commune de départ (migration
 * `0032_bibliotheque_depart` de @planif/db, lignes à ferme_id nul) face à POST /sync/upload :
 *
 *   - « Adapter à ma ferme » : la copie d'un itinéraire de la bibliothèque dans la ferme (nouvel
 *     id, mêmes paramètres) est acceptée, sur l'espèce de la bibliothèque ou sur la copie de
 *     l'espèce faite par la ferme (T32g) ; la ligne de la bibliothèque ne change pas ;
 *   - une série créée directement sur un itinéraire de la bibliothèque est acceptée, avec
 *     l'instantané de ses paramètres ;
 *   - une ligne de la bibliothèque (famille, espèce, itinéraire) n'est jamais écrite par un
 *     téléphone : PATCH et suppression refusés, rien ne change.
 *
 * Exécution comme itineraire.integration.test.ts : DATABASE_URL (Postgres avec CREATEDB).
 */
import { calculerDatesSerie, creerGenerateurId, type DateCalendaire } from '@planif/core';
import { convertirBibliotheque, idBibliotheque, lireBibliothequeDepart } from '@planif/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2026-10-17T06:00:00Z');
const SUPPRIME_LE = '2026-10-17T06:30:00.000Z';

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

type Ligne = Record<string, unknown>;

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

const TOMATE = 'tomate';
const TOMATE_SERRE = 'Tomate sous serre, plant greffé deux têtes';
const CAROTTE = 'Carotte de conservation, semis direct';

decrireAvecBase('T41')('T41 : la bibliothèque de départ face aux écritures des téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let jeton: string;
  let ferme: string;
  let saison: string;
  const bibliotheque = convertirBibliotheque(lireBibliothequeDepart());
  const itineraireDe = (nom: string) => {
    const i = bibliotheque.itineraires.find((l) => l.nom === nom);
    if (i === undefined) throw new Error(`itinéraire « ${nom} » absent de la bibliothèque de départ`);
    return i;
  };

  beforeAll(async () => {
    base = await creerBaseJetable('t41_bibliotheque');
    cles = { active: await genererCleSignature('cle-t41'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Ferme neuve T41');
    const u = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, u.id, ferme, { role: 'gerant' });
    jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, u.id, MAINTENANT);
    saison = randomUUID();
    await base.pool.query(`INSERT INTO saison (id, ferme_id, nom, debut, fin) VALUES ($1, $2, '2027', '2027-01-01', '2027-12-31')`, [saison, ferme]);
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[]): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  async function accepte(ecritures: readonly EcritureEnvoyee[]): Promise<void> {
    expect(await lot(ecritures)).toEqual({ refus: [] });
  }

  async function ligne(table: string, id: string): Promise<Ligne | null> {
    const r = await base.pool.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE id = $1`, [id]);
    return r.rows[0]?.l ?? null;
  }

  /** PUT de la copie de l'itinéraire `nom` de la bibliothèque dans la ferme, sur l'espèce `especeId`. */
  function copie(nom: string, especeId: string): EcritureEnvoyee {
    const i = itineraireDe(nom);
    return {
      op: 'PUT',
      table: 'itineraire',
      id: nouvelId<'Itineraire'>(),
      donnees: { ferme_id: ferme, espece_id: especeId, variete_id: null, nom: `${nom} (ma ferme)`, mode: i.mode, parametres: JSON.stringify(i.parametres) },
    };
  }

  describe('la bibliothèque est en base, à ferme_id nul, dès les migrations', () => {
    // T51 : 0038 ajoute Rosacées, fraise et « Fraise hors-sol en gouttière ».
    it('47 itinéraires, 36 espèces, 11 familles : ce qu’une ferme neuve reçoit (flux *_reference de powersync/sync-config.yaml)', async () => {
      const n = async (table: string) => (await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ferme_id IS NULL AND supprime_le IS NULL`)).rows[0]?.n;
      expect(await n('itineraire')).toBe(47);
      expect(await n('espece')).toBe(36);
      expect(await n('famille')).toBe(11);
    });
  });

  describe('« Adapter à ma ferme » : la copie dans la ferme', () => {
    it('sur l’espèce de la bibliothèque : acceptée, mêmes paramètres ; l’original ne change pas', async () => {
      const original = itineraireDe(TOMATE_SERRE);
      const avant = await ligne('itineraire', original.id);
      const c = copie(TOMATE_SERRE, idBibliotheque('espece', TOMATE));
      await accepte([c]);
      const l = await ligne('itineraire', c.id);
      expect(l).toMatchObject({ ferme_id: ferme, espece_id: idBibliotheque('espece', TOMATE), variete_id: null, mode: 'plant_achete' });
      expect(l?.parametres).toEqual(original.parametres);
      expect(await ligne('itineraire', original.id)).toEqual(avant);
    });

    it('sur la copie de l’espèce faite par la ferme (T32g, famille de la bibliothèque) : acceptée', async () => {
      const espece: EcritureEnvoyee = {
        op: 'PUT',
        table: 'espece',
        id: randomUUID(),
        donnees: {
          ferme_id: ferme,
          famille_id: idBibliotheque('famille', 'Solanacées'),
          nom: TOMATE,
          categorie: 'legume',
          perenne: 0,
          unite_recolte: 'kg',
          delai_retour_minimal_ans: null,
          delai_retour_conseille_ans: null,
          profil_croissance: null,
        },
      };
      await accepte([espece]);
      const c = copie(TOMATE_SERRE, espece.id);
      await accepte([c]);
      expect(await ligne('itineraire', c.id)).toMatchObject({ ferme_id: ferme, espece_id: espece.id });
    });
  });

  describe('une série créée directement sur un itinéraire de la bibliothèque', () => {
    it.each([
      [TOMATE_SERRE, TOMATE, 'plantation'],
      [CAROTTE, 'carotte', 'semis'],
    ] as const)('%s : acceptée, instantané = paramètres de la bibliothèque', async (nom, espece, ancre) => {
      const i = itineraireDe(nom);
      const d = calculerDatesSerie(i.parametres, { type: ancre, date: '2027-04-05' as DateCalendaire });
      const s: EcritureEnvoyee = {
        op: 'PUT',
        table: 'serie',
        id: nouvelId<'Serie'>(),
        donnees: {
          ferme_id: ferme,
          saison_id: saison,
          espece_id: idBibliotheque('espece', espece),
          variete_id: null,
          itineraire_id: i.id,
          parametres: JSON.stringify(i.parametres),
          ancre_type: ancre,
          ancre_date: '2027-04-05',
          prevu_semis_pepiniere: d.semisPepiniere ?? null,
          prevu_mise_en_place: d.miseEnPlace,
          prevu_debut_recolte: d.debutRecolte,
          prevu_fin_recolte: d.finRecolte,
          longueur_m: 30,
          nombre_plants: null,
          statut: 'prevue',
          rotation_acceptee: null,
        },
      };
      await accepte([s]);
      const l = await ligne('serie', s.id);
      expect(l).toMatchObject({ ferme_id: ferme, itineraire_id: i.id, espece_id: idBibliotheque('espece', espece) });
      expect(l?.parametres).toEqual(i.parametres);
    });
  });

  describe('une ligne de la bibliothèque n’est jamais écrite par un téléphone', () => {
    const cas = (): [string, string, Record<string, unknown>][] => [
      ['itineraire', itineraireDe(TOMATE_SERRE).id, { nom: 'Ma tomate' }],
      ['itineraire', itineraireDe(TOMATE_SERRE).id, { ferme_id: ferme }],
      ['itineraire', itineraireDe(TOMATE_SERRE).id, { supprime_le: SUPPRIME_LE }],
      ['espece', idBibliotheque('espece', TOMATE), { nom: 'Tomate cerise' }],
      ['espece', idBibliotheque('espece', TOMATE), { supprime_le: SUPPRIME_LE }],
      ['famille', idBibliotheque('famille', 'Solanacées'), { delai_retour_minimal_ans: 1 }],
    ];

    it('PATCH (nom, ferme, suppression douce) d’un itinéraire, d’une espèce, d’une famille : refusé, rien ne change', async () => {
      for (const [table, id, donnees] of cas()) {
        const avant = await ligne(table, id);
        expect(avant, `${table} ${id} en base`).not.toBeNull();
        const r = await lot([{ op: 'PATCH', table, id, donnees }]);
        expect(r.refus.filter((x) => x.id === id), `${table} ${JSON.stringify(donnees)} refusé`).toHaveLength(1);
        expect(await ligne(table, id), `${table} ${id} inchangée`).toEqual(avant);
      }
    });

    it('PUT qui reprend l’id d’un itinéraire de la bibliothèque : refusé, l’original ne change pas', async () => {
      const original = itineraireDe(TOMATE_SERRE);
      const avant = await ligne('itineraire', original.id);
      const c = { ...copie(TOMATE_SERRE, idBibliotheque('espece', TOMATE)), id: original.id };
      const r = await lot([c]);
      expect(r.refus.filter((x) => x.id === original.id)).toHaveLength(1);
      expect(await ligne('itineraire', original.id)).toEqual(avant);
    });
  });
});
