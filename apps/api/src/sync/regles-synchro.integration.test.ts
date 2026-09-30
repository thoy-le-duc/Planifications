/**
 * Tests d'acceptation T10 — règles de synchro (Sync Streams de `powersync/`), contre le VRAI
 * service PowerSync (Docker) et un vrai Postgres.
 *
 * ── Exécution ───────────────────────────────────────────────────────────────────────────────
 *
 * - DATABASE_URL : Postgres où l'on peut créer des bases, avec `wal_level=logical` (réplication
 *   logique, exigée par PowerSync ; `docker compose up -d` la règle en local). Le test crée deux
 *   bases jetables : la base répliquée `t10_flux_…` (migrations appliquées) et celle du stockage
 *   des buckets `t10_flux_…_ps`, puis les supprime (slot de réplication compris).
 * - Docker, image POWERSYNC_IMAGE (voir test/powersync.ts), en `--network host`.
 * - Sans DATABASE_URL, sans Docker ou sans wal_level=logical : échec clair en CI, saut signalé
 *   en local. En CI il faut donc un Postgres en wal_level=logical (le service `postgres` de
 *   GitHub Actions ne prend pas d'options de commande : à lancer par `docker run … -c
 *   wal_level=logical` ou `docker compose up -d --wait postgres`).
 *
 * ── Ce qui est vérifié ──────────────────────────────────────────────────────────────────────
 *
 * Ce qu'un téléphone neuf reçoit avec un jeton d'accès de l'API (JWT RS256, `sub` = utilisateur,
 * vérifié par PowerSync via le JWKS de l'API) :
 * - un membre accepté reçoit les données de sa ferme (témoin : sans lui, « ne reçoit rien »
 *   ne prouverait rien) et la bibliothèque de référence (lignes à ferme_id nul, flux global) ;
 * - un utilisateur d'une autre ferme, un invité pas encore accepté (`membre.etat = 'invite'`),
 *   un membre retiré (`membre.supprime_le`) ne reçoivent aucune ligne de la ferme ;
 * - une ferme supprimée en douceur ne descend plus à personne ;
 * - aucune ligne de `code_connexion` ni de `jeton_renouvellement`, aucune colonne
 *   `code_hache` / `jeton_hache`, et jamais l'e-mail d'un autre utilisateur ;
 * - `refus_synchro` ne descend qu'à l'utilisateur concerné.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emettreJetonAcces, genererCleSignature, jwksPublic, type TrousseauCles } from '../auth/index.ts';
import {
  ajouterMembre,
  creerBaseJetable,
  creerFerme,
  creerUtilisateur,
  EN_CI,
  URL_BASE,
  type BaseJetable,
} from './test/base-jetable.ts';
import {
  attendreSynchro,
  demarrerPowerSync,
  dockerDisponible,
  lireSynchro,
  servirJwks,
  type LigneRecue,
  type ServicePowerSync,
} from './test/powersync.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';

async function walLevelLogique(): Promise<boolean> {
  const c = new pg.Client({ connectionString: URL_BASE });
  await c.connect();
  try {
    const r = await c.query<{ wal_level: string }>('SHOW wal_level');
    return r.rows[0]?.wal_level === 'logical';
  } finally {
    await c.end();
  }
}

const manques: string[] = [];
if (URL_BASE === '') manques.push('DATABASE_URL absente');
else if (!(await walLevelLogique())) manques.push('Postgres sans wal_level=logical');
if (!dockerDisponible()) manques.push('Docker indisponible');

if (manques.length > 0) {
  if (EN_CI) {
    describe('T10 : règles de synchro (PowerSync)', () => {
      it('prérequis réunis en CI', () => {
        throw new Error(`Prérequis manquants en CI : ${manques.join(', ')}. Les règles de synchro se testent contre le vrai service.`);
      });
    });
  } else {
    console.warn(`[T10] règles de synchro sautées : ${manques.join(', ')}.`);
  }
}

const decrire = manques.length > 0 ? describe.skip : describe;

decrire('T10 : règles de synchro (Sync Streams contre le service PowerSync)', { timeout: 60_000 }, () => {
  let source: BaseJetable | undefined;
  let stockage: BaseJetable | undefined;
  let jwks: Awaited<ReturnType<typeof servirJwks>> | undefined;
  let service: ServicePowerSync | undefined;
  let cles: TrousseauCles;

  const ids = {
    ferme: '',
    autreFerme: '',
    fermeSupprimee: '',
    evenementFerme: randomUUID(),
    evenementAutre: randomUUID(),
    evenementSupprimee: randomUUID(),
    familleGlobale: randomUUID(),
    familleFerme: randomUUID(),
    refusTheo: randomUUID(),
    refusCollegue: randomUUID(),
  };
  const gens = {
    theo: { id: '', email: '', jeton: '' },
    collegue: { id: '', email: '', jeton: '' },
    voisin: { id: '', email: '', jeton: '' },
    invite: { id: '', email: '', jeton: '' },
    retire: { id: '', email: '', jeton: '' },
  };

  async function jetonPour(utilisateurId: string): Promise<string> {
    return emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, utilisateurId, new Date());
  }

  async function evenement(pool: pg.Pool, id: string, fermeId: string, auteurId: string): Promise<void> {
    await pool.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, detail)
       VALUES ($1, $2, 'recolte', '2026-10-01', '2026-10-01T06:00:00Z', $3, 'tap', '{"quantite": 3, "unite": "kg", "categorie": null}')`,
      [id, fermeId, auteurId],
    );
  }

  async function refus(pool: pg.Pool, id: string, utilisateurId: string, fermeId: string): Promise<void> {
    await pool.query(
      `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, donnees, cree_le)
       VALUES ($1, $2, $3, 'evenement', $4, 'PATCH', 'ajout_seul', 'Un événement ne se modifie pas : saisissez une correction.', NULL, '2026-10-01T06:00:00Z')`,
      [id, utilisateurId, fermeId, randomUUID()],
    );
  }

  beforeAll(async () => {
    const s = await creerBaseJetable('t10_flux');
    source = s;
    const st = await creerBaseJetable('t10_flux_ps', false);
    stockage = st;
    const p = s.pool;

    ids.ferme = await creerFerme(p, 'Jardins de Garonne');
    ids.autreFerme = await creerFerme(p, 'Ferme voisine');
    ids.fermeSupprimee = await creerFerme(p, 'Ancienne ferme');
    await p.query(`UPDATE ferme SET supprime_le = '2026-09-30T00:00:00Z' WHERE id = $1`, [ids.fermeSupprimee]);

    for (const nom of Object.keys(gens) as (keyof typeof gens)[]) {
      const u = await creerUtilisateur(p, `${nom}-${randomUUID().slice(0, 8)}@ferme.fr`);
      gens[nom].id = u.id;
      gens[nom].email = u.email;
    }
    await ajouterMembre(p, gens.theo.id, ids.ferme, { role: 'gerant' });
    await ajouterMembre(p, gens.theo.id, ids.fermeSupprimee, { role: 'gerant' });
    await ajouterMembre(p, gens.collegue.id, ids.ferme, { role: 'equipier' });
    await ajouterMembre(p, gens.voisin.id, ids.autreFerme, { role: 'gerant' });
    await ajouterMembre(p, gens.invite.id, ids.ferme, { etat: 'invite', invitePar: gens.theo.id });
    await ajouterMembre(p, gens.retire.id, ids.ferme, { retire: true });

    await evenement(p, ids.evenementFerme, ids.ferme, gens.collegue.id);
    await evenement(p, ids.evenementAutre, ids.autreFerme, gens.voisin.id);
    await evenement(p, ids.evenementSupprimee, ids.fermeSupprimee, gens.theo.id);
    await p.query(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES
       ($1, NULL, 'Brassicacées', 4, 6), ($2, $3, 'Brassicacées (réglage ferme)', 5, 6)`,
      [ids.familleGlobale, ids.familleFerme, ids.ferme],
    );
    await p.query(
      `INSERT INTO code_connexion (id, email, code_hache, expire_le) VALUES ($1, $2, 'sel.empreinte-secrete', '2026-10-01T06:10:00Z')`,
      [randomUUID(), gens.theo.email],
    );
    await p.query(
      `INSERT INTO jeton_renouvellement (id, utilisateur_id, jeton_hache, expire_le) VALUES ($1, $2, 'empreinte-jeton-secrete', '2027-01-01T00:00:00Z')`,
      [randomUUID(), gens.theo.id],
    );
    await refus(p, ids.refusTheo, gens.theo.id, ids.ferme);
    await refus(p, ids.refusCollegue, gens.collegue.id, ids.ferme);

    cles = { active: await genererCleSignature('cle-t10-flux'), precedentes: [] };
    for (const g of Object.values(gens)) g.jeton = await jetonPour(g.id);
    jwks = await servirJwks(await jwksPublic(cles));
    service = await demarrerPowerSync({ urlSource: s.url, urlStockage: st.url, jwksUri: jwks.url, audience: AUDIENCE });

    // Témoin : la réplication a rattrapé les données quand Théophane reçoit l'événement de sa ferme.
    await attendreSynchro(service.url, gens.theo.jeton, (l) => l.some((x) => x.id === ids.evenementFerme), 60_000);
  }, 180_000);

  afterAll(async () => {
    if (service !== undefined) {
      if (process.env.T10_JOURNAL_POWERSYNC === '1') console.log(service.journal());
      service.arreter();
    }
    await jwks?.fermer();
    await source?.supprimer();
    await stockage?.supprimer();
  }, 60_000);

  function recu(url: string, qui: keyof typeof gens): Promise<LigneRecue[]> {
    return lireSynchro(url, gens[qui].jeton);
  }

  function url(): string {
    if (service === undefined) throw new Error('service PowerSync non démarré');
    return service.url;
  }

  /** Lignes qui appartiennent à la ferme `fermeId` (la ferme elle-même, ou ferme_id). */
  function deLaFerme(lignes: readonly LigneRecue[], fermeId: string): LigneRecue[] {
    return lignes.filter((l) => (l.table === 'ferme' && l.id === fermeId) || l.donnees.ferme_id === fermeId);
  }

  it('témoin : un membre accepté reçoit sa ferme, ses événements et la bibliothèque de référence', async () => {
    const lignes = await recu(url(), 'theo');
    const vues = new Set(lignes.map((l) => `${l.table}:${l.id}`));
    expect(vues).toContain(`ferme:${ids.ferme}`);
    expect(vues).toContain(`evenement:${ids.evenementFerme}`);
    expect(vues).toContain(`famille:${ids.familleFerme}`);
    expect(vues).toContain(`famille:${ids.familleGlobale}`);
    // Les colonnes arrivent sous leur nom Postgres.
    const ev = lignes.find((l) => l.id === ids.evenementFerme);
    expect(ev?.donnees).toMatchObject({ ferme_id: ids.ferme, type: 'recolte', auteur_id: gens.collegue.id });
  });

  it('un utilisateur d’une autre ferme ne reçoit rien de la ferme, mais reçoit la sienne et la bibliothèque', async () => {
    const lignes = await recu(url(), 'voisin');
    expect(deLaFerme(lignes, ids.ferme)).toEqual([]);
    expect(lignes.some((l) => l.id === ids.evenementFerme)).toBe(false);
    expect(lignes.some((l) => l.id === ids.evenementAutre)).toBe(true);
    expect(lignes.some((l) => l.id === ids.familleGlobale)).toBe(true);
    expect(lignes.some((l) => l.id === ids.familleFerme)).toBe(false);
  });

  it('un invité pas encore accepté ne reçoit rien de la ferme', async () => {
    const lignes = await recu(url(), 'invite');
    expect(deLaFerme(lignes, ids.ferme)).toEqual([]);
    expect(lignes.filter((l) => l.table === 'evenement')).toEqual([]);
  });

  it('un membre retiré ne reçoit rien de la ferme', async () => {
    const lignes = await recu(url(), 'retire');
    expect(deLaFerme(lignes, ids.ferme)).toEqual([]);
    expect(lignes.filter((l) => l.table === 'evenement')).toEqual([]);
  });

  it('une ferme supprimée ne descend plus, même à son gérant', async () => {
    const lignes = await recu(url(), 'theo');
    expect(deLaFerme(lignes, ids.fermeSupprimee)).toEqual([]);
  });

  it('aucun secret ne sort : ni code de connexion, ni jeton de renouvellement', async () => {
    for (const qui of Object.keys(gens) as (keyof typeof gens)[]) {
      const lignes = await recu(url(), qui);
      const tables = new Set(lignes.map((l) => l.table));
      expect(tables.has('code_connexion'), qui).toBe(false);
      expect(tables.has('jeton_renouvellement'), qui).toBe(false);
      const brut = JSON.stringify(lignes);
      expect(brut, qui).not.toContain('code_hache');
      expect(brut, qui).not.toContain('jeton_hache');
      expect(brut, qui).not.toContain('empreinte-secrete');
      expect(brut, qui).not.toContain('empreinte-jeton-secrete');
    }
  });

  it('jamais l’e-mail d’un autre utilisateur, même d’un collègue de la même ferme', async () => {
    for (const qui of Object.keys(gens) as (keyof typeof gens)[]) {
      const brut = JSON.stringify(await recu(url(), qui));
      for (const autre of Object.keys(gens) as (keyof typeof gens)[]) {
        if (autre !== qui) expect(brut, `${qui} reçoit l’e-mail de ${autre}`).not.toContain(gens[autre].email);
      }
    }
  });

  it('les refus ne descendent qu’à l’utilisateur concerné', async () => {
    const theo = await recu(url(), 'theo');
    const collegue = await recu(url(), 'collegue');
    const refusDe = (l: readonly LigneRecue[]) => l.filter((x) => x.table === 'refus_synchro').map((x) => x.id);
    expect(refusDe(theo)).toEqual([ids.refusTheo]);
    expect(refusDe(collegue)).toEqual([ids.refusCollegue]);
    const r = theo.find((x) => x.id === ids.refusTheo);
    expect(r?.donnees).toMatchObject({ utilisateur_id: gens.theo.id, motif: 'ajout_seul', operation: 'PATCH' });
    expect(String(r?.donnees.message)).not.toBe('');
  });

  it('une écriture en base arrive aux membres de la ferme, et à eux seuls', async () => {
    const nouvel = randomUUID();
    if (source === undefined) throw new Error('base source absente');
    await evenement(source.pool, nouvel, ids.ferme, gens.theo.id);
    await attendreSynchro(url(), gens.collegue.jeton, (l) => l.some((x) => x.id === nouvel));
    expect((await recu(url(), 'voisin')).some((x) => x.id === nouvel)).toBe(false);
    expect((await recu(url(), 'invite')).some((x) => x.id === nouvel)).toBe(false);
  });

  it('T23 : les types d’intervention de la ferme descendent à ses membres seuls, la liste de départ à tous', async () => {
    if (source === undefined) throw new Error('base source absente');
    const typeFerme = randomUUID();
    const typeVoisin = randomUUID();
    await source.pool.query(
      `INSERT INTO type_intervention (id, ferme_id, categorie, libelle) VALUES ($1, $2, 'entretien', 'binage'), ($3, $4, 'entretien', 'sarclage')`,
      [typeFerme, ids.ferme, typeVoisin, ids.autreFerme],
    );
    const depart = await source.pool.query<{ id: string }>(`SELECT id::text AS id FROM type_intervention WHERE ferme_id IS NULL`);
    expect(depart.rows.length, 'liste de départ en base (migration)').toBeGreaterThan(0);

    const theo = await attendreSynchro(url(), gens.theo.jeton, (l) => l.some((x) => x.id === typeFerme));
    const t = theo.find((x) => x.id === typeFerme);
    expect(t?.table).toBe('type_intervention');
    expect(t?.donnees).toMatchObject({ ferme_id: ids.ferme, categorie: 'entretien', libelle: 'binage' });
    expect(theo.some((x) => x.id === typeVoisin)).toBe(false);
    const recusParTheo = new Set(theo.filter((x) => x.table === 'type_intervention').map((x) => x.id));
    for (const l of depart.rows) expect(recusParTheo, `type de départ ${l.id}`).toContain(l.id);

    const voisin = await attendreSynchro(url(), gens.voisin.jeton, (l) => l.some((x) => x.id === typeVoisin));
    expect(voisin.some((x) => x.id === typeFerme)).toBe(false);
    for (const qui of ['invite', 'retire'] as const) expect((await recu(url(), qui)).some((x) => x.id === typeFerme), qui).toBe(false);
  });

  it('un jeton d’une autre clé ou d’une autre audience est refusé', async () => {
    const autreCle = { active: await genererCleSignature('cle-inconnue'), precedentes: [] };
    const etranger = await emettreJetonAcces({ cles: autreCle, emetteur: EMETTEUR, audience: AUDIENCE }, gens.theo.id, new Date());
    await expect(lireSynchro(url(), etranger)).rejects.toThrow(/synchro refusée : 401/);
    const autreAudience = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: 'autre' }, gens.theo.id, new Date());
    await expect(lireSynchro(url(), autreAudience)).rejects.toThrow(/synchro refusée : 401/);
  });
});
