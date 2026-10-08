/**
 * Tests d'acceptation T10u — refus d'une ferme quittée effacés du téléphone
 * (docs/backlog/T10u-refus-ferme-quittee.md, Q25), contre le VRAI service PowerSync (Docker) et un
 * vrai Postgres. Exécution et règle de saut : comme regles-synchro.integration.test.ts
 * (DATABASE_URL en wal_level=logical, Docker, POWERSYNC_IMAGE ; échec clair en CI, saut signalé
 * en local).
 *
 * ── Contrat (conçu par le testeur) ──────────────────────────────────────────────────────────
 *
 * Q25 : rien d'une ferme ne reste chez quelqu'un qui n'en fait plus partie, refus de synchro
 * compris (avec leur résumé : nom de culture, date, quantité…).
 *
 * Mécanisme retenu : c'est la SYNCHRO qui efface, pas le téléphone. Le flux `refus_synchro` de
 * powersync/sync-config.yaml ne sert à son auteur que les refus d'une ferme dont il est membre
 * actif (`fermes_actives` : adhésion acceptée, non supprimée, ferme non supprimée), plus ceux qui
 * ne visent aucune ferme (ferme_id NULL : rien d'une ferme à protéger). À la perte de l'adhésion,
 * PowerSync retire du téléphone les lignes qui ne lui reviennent plus (bucket absent du point de
 * contrôle suivant, ou REMOVE) : le téléphone hors ligne au moment du retrait les perd à sa
 * prochaine synchro, sans rien écrire.
 *
 * Pourquoi pas un effacement par le téléphone : un DELETE local sur refus_synchro partirait vers
 * le serveur (file d'envoi de PowerSync), qui le refuse ('table_interdite', T10l) et enregistre
 * un refus de plus ; PowerSync remettrait ensuite la ligne, toujours servie par le flux. Et un
 * téléphone dont l'adhésion n'est pas encore descendue effacerait à tort.
 *
 * Vérifié ici :
 *   1. témoin : membre de A et de B, l'utilisateur reçoit ses refus de A (archivé compris), de B
 *      et sans ferme ;
 *   2. retiré de A : un téléphone neuf ne reçoit plus aucun refus de A, ni son résumé (le nom de
 *      culture n'apparaît nulle part dans le flux) ; ceux de B et sans ferme restent, résumé
 *      compris ;
 *   3. téléphone hors ligne au moment du retrait : il se reconnecte avec ses positions de buckets
 *      d'avant ; en appliquant ce que PowerSync lui envoie (buckets absents du point de contrôle,
 *      REMOVE, CLEAR), il ne garde aucun refus de A et garde ceux de B et sans ferme ;
 *   4. ferme supprimée (en douceur) : ses refus ne descendent plus, même à son gérant ;
 *   5. un collègue resté membre de A garde ses refus de A (le filtre ne déborde pas) ;
 *   6. aucune écriture serveur : les lignes de refus_synchro en base sont intactes (l'historique
 *      reste côté serveur), aucun refus créé.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emettreJetonAcces, genererCleSignature, jwksPublic, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, EN_CI, URL_BASE, type BaseJetable } from './test/base-jetable.ts';
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

/** Résumés reconnaissables : ils ne doivent plus apparaître nulle part après le retrait. */
const CULTURE_A = 'Tomate Cœur de bœuf';
const CULTURE_B = 'Fraise Mara des bois';
const CULTURE_SUPPRIMEE = 'Pivoine Sarah Bernhardt';

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
    describe('T10u : refus d’une ferme quittée (PowerSync)', () => {
      it('prérequis réunis en CI', () => {
        throw new Error(`Prérequis manquants en CI : ${manques.join(', ')}. Les règles de synchro se testent contre le vrai service.`);
      });
    });
  } else {
    console.warn(`[T10u] refus d’une ferme quittée sautés : ${manques.join(', ')}.`);
  }
}

const decrire = manques.length > 0 ? describe.skip : describe;

// ── Mini-client du protocole de synchro (POST /sync/stream), avec positions de buckets ─────────

interface OpRecue {
  readonly op: string;
  readonly op_id?: string;
  readonly object_type?: string;
  readonly object_id?: string;
  readonly data?: string | null;
}

interface MessageFlux {
  readonly checkpoint?: { readonly last_op_id: string; readonly buckets: readonly { readonly bucket: string }[] };
  readonly checkpoint_diff?: unknown;
  readonly checkpoint_complete?: unknown;
  readonly data?: { readonly bucket: string; readonly next_after?: string; readonly data?: readonly OpRecue[] };
}

/** Ce qu'un téléphone garde : lignes par bucket (clé `table:id`) et position de chaque bucket. */
interface EtatTelephone {
  readonly lignes: ReadonlyMap<string, ReadonlyMap<string, LigneRecue>>;
  readonly positions: ReadonlyMap<string, string>;
}

const TELEPHONE_NEUF: EtatTelephone = { lignes: new Map(), positions: new Map() };

/**
 * Une synchro d'un téléphone qui repart de `avant` (ses buckets et leurs positions), jusqu'au
 * premier `checkpoint_complete` ; rend l'état du téléphone après application, comme le client
 * PowerSync : un bucket absent du point de contrôle est retiré avec toutes ses lignes ; PUT
 * ajoute ou remplace, REMOVE retire, CLEAR vide le bucket.
 */
async function synchroniser(url: string, jeton: string, avant: EtatTelephone): Promise<EtatTelephone> {
  const res = await fetch(`${url}/sync/stream`, {
    method: 'POST',
    headers: { authorization: `Token ${jeton}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      buckets: [...avant.positions].map(([name, after]) => ({ name, after })),
      include_checksum: true,
      raw_data: true,
      client_id: randomUUID(),
      streams: { include_defaults: true, subscriptions: [] },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 200 || res.body === null) throw new Error(`synchro refusée : ${String(res.status)} ${await res.text()}`);
  const lignes = new Map<string, Map<string, LigneRecue>>([...avant.lignes].map(([b, l]) => [b, new Map(l)]));
  const positions = new Map(avant.positions);
  let pointDeControle: ReadonlySet<string> | null = null;
  const lecteur = (res.body as ReadableStream<Uint8Array>).getReader();
  const decodeur = new TextDecoder();
  let tampon = '';
  try {
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) throw new Error('flux de synchro terminé avant checkpoint_complete');
      tampon += decodeur.decode(value, { stream: true });
      let fin = tampon.indexOf('\n');
      while (fin >= 0) {
        const texte = tampon.slice(0, fin).trim();
        tampon = tampon.slice(fin + 1);
        fin = tampon.indexOf('\n');
        if (texte === '') continue;
        const message = JSON.parse(texte) as MessageFlux;
        if (message.checkpoint_diff !== undefined) {
          throw new Error('checkpoint_diff reçu à l’ouverture : le mini-client ne sait pas l’appliquer (à compléter)');
        }
        if (message.checkpoint !== undefined) {
          pointDeControle = new Set(message.checkpoint.buckets.map((b) => b.bucket));
        }
        if (message.data !== undefined) {
          const { bucket } = message.data;
          const duBucket = lignes.get(bucket) ?? new Map<string, LigneRecue>();
          lignes.set(bucket, duBucket);
          for (const op of message.data.data ?? []) {
            const cle = `${op.object_type ?? ''}:${op.object_id ?? ''}`;
            if (op.op === 'PUT' && op.object_type !== undefined && op.object_id !== undefined) {
              const donnees = typeof op.data === 'string' ? (JSON.parse(op.data) as Record<string, unknown>) : {};
              duBucket.set(cle, { table: op.object_type, id: op.object_id, donnees });
            } else if (op.op === 'REMOVE') {
              duBucket.delete(cle);
            } else if (op.op === 'CLEAR') {
              duBucket.clear();
            }
          }
          if (message.data.next_after !== undefined) positions.set(bucket, message.data.next_after);
        }
        if (message.checkpoint_complete !== undefined) {
          if (pointDeControle === null) throw new Error('checkpoint_complete sans checkpoint');
          const garde = pointDeControle;
          for (const b of [...lignes.keys()]) if (!garde.has(b)) lignes.delete(b);
          for (const b of [...positions.keys()]) if (!garde.has(b)) positions.delete(b);
          return { lignes, positions };
        }
      }
    }
  } finally {
    await lecteur.cancel().catch(() => undefined);
  }
}

/** Toutes les lignes que le téléphone garde, sans doublon (une ligne peut venir de deux buckets). */
function lignesDu(t: EtatTelephone): LigneRecue[] {
  const vues = new Map<string, LigneRecue>();
  for (const duBucket of t.lignes.values()) for (const [cle, l] of duBucket) vues.set(cle, l);
  return [...vues.values()];
}

const refusDe = (lignes: readonly LigneRecue[]): string[] =>
  lignes
    .filter((l) => l.table === 'refus_synchro')
    .map((l) => l.id)
    .sort();

decrire('T10u : refus d’une ferme quittée (Sync Streams contre le service PowerSync)', { timeout: 90_000 }, () => {
  let source: BaseJetable | undefined;
  let stockage: BaseJetable | undefined;
  let jwks: Awaited<ReturnType<typeof servirJwks>> | undefined;
  let service: ServicePowerSync | undefined;
  let cles: TrousseauCles;

  const ids = {
    fermeA: '',
    fermeB: '',
    fermeSupprimee: '',
    refusA: randomUUID(),
    refusAArchive: randomUUID(),
    refusB: randomUUID(),
    refusSansFerme: randomUUID(),
    refusSupprimee: randomUUID(),
    refusCollegueA: randomUUID(),
  };
  const gens = {
    /** Membre de A et de B ; retiré de A au test 2. */
    partant: { id: '', jeton: '' },
    /** Membre de A, y reste. */
    collegue: { id: '', jeton: '' },
    /** Gérant d'une ferme supprimée en douceur. */
    gerant: { id: '', jeton: '' },
  };
  /** Téléphone de `partant` synchronisé AVANT le retrait, puis resté hors ligne. */
  let telephoneHorsLigne: EtatTelephone = TELEPHONE_NEUF;
  /** Lignes de refus_synchro en base avant le retrait (aucune écriture serveur attendue). */
  let refusEnBaseAvant: unknown[] = [];

  async function refus(
    pool: pg.Pool,
    id: string,
    utilisateurId: string,
    fermeId: string | null,
    culture: string | null,
    archive = false,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO refus_synchro (id, utilisateur_id, ferme_id, nom_table, ligne_id, operation, motif, message, donnees,
                                  saisie_type, saisie_culture, saisie_date, saisie_quantite, saisie_unite, cree_le, archive_le)
       VALUES ($1, $2, $3, 'evenement', $4, 'PUT', 'recolte_annulee', 'Cette récolte ne peut plus être enregistrée.', NULL,
               'recolte', $5, '2026-10-01', 3, 'kg', '2026-10-01T06:00:00Z', $6)`,
      [id, utilisateurId, fermeId, randomUUID(), culture, archive ? '2026-10-02T06:00:00Z' : null],
    );
  }

  async function lireRefusEnBase(): Promise<Record<string, unknown>[]> {
    if (source === undefined) throw new Error('base source absente');
    const r = await source.pool.query<Record<string, unknown>>(
      `SELECT id, utilisateur_id, ferme_id, saisie_culture, archive_le, motif FROM refus_synchro ORDER BY id`,
    );
    return r.rows;
  }

  beforeAll(async () => {
    const s = await creerBaseJetable('t10u_flux');
    source = s;
    const st = await creerBaseJetable('t10u_flux_ps', false);
    stockage = st;
    const p = s.pool;

    ids.fermeA = await creerFerme(p, 'Ferme quittée');
    ids.fermeB = await creerFerme(p, 'Ferme gardée');
    ids.fermeSupprimee = await creerFerme(p, 'Ferme fermée');
    for (const nom of Object.keys(gens) as (keyof typeof gens)[]) {
      gens[nom].id = (await creerUtilisateur(p, `t10u-${nom}-${randomUUID().slice(0, 8)}@ferme.fr`)).id;
    }
    await ajouterMembre(p, gens.partant.id, ids.fermeA, { role: 'equipier' });
    await ajouterMembre(p, gens.partant.id, ids.fermeB, { role: 'gerant' });
    await ajouterMembre(p, gens.collegue.id, ids.fermeA, { role: 'gerant' });
    await ajouterMembre(p, gens.gerant.id, ids.fermeSupprimee, { role: 'gerant' });

    await refus(p, ids.refusA, gens.partant.id, ids.fermeA, CULTURE_A);
    await refus(p, ids.refusAArchive, gens.partant.id, ids.fermeA, CULTURE_A, true);
    await refus(p, ids.refusB, gens.partant.id, ids.fermeB, CULTURE_B);
    await refus(p, ids.refusSansFerme, gens.partant.id, null, null);
    await refus(p, ids.refusCollegueA, gens.collegue.id, ids.fermeA, CULTURE_A);
    await refus(p, ids.refusSupprimee, gens.gerant.id, ids.fermeSupprimee, CULTURE_SUPPRIMEE);
    await p.query(`UPDATE ferme SET supprime_le = '2026-10-03T00:00:00Z' WHERE id = $1`, [ids.fermeSupprimee]);

    cles = { active: await genererCleSignature('cle-t10u-flux'), precedentes: [] };
    for (const g of Object.values(gens)) g.jeton = await emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, g.id, new Date());
    jwks = await servirJwks(await jwksPublic(cles));
    service = await demarrerPowerSync({ urlSource: s.url, urlStockage: st.url, jwksUri: jwks.url, audience: AUDIENCE });

    // Réplication rattrapée : le partant reçoit sa ferme B et son refus sans ferme.
    await attendreSynchro(
      service.url,
      gens.partant.jeton,
      (l) => l.some((x) => x.table === 'ferme' && x.id === ids.fermeB) && l.some((x) => x.id === ids.refusSansFerme),
      60_000,
    );
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

  function url(): string {
    if (service === undefined) throw new Error('service PowerSync non démarré');
    return service.url;
  }

  it('1. témoin : membre de A et de B, il reçoit ses refus de A (archivé compris), de B et sans ferme, résumé compris', async () => {
    telephoneHorsLigne = await synchroniser(url(), gens.partant.jeton, TELEPHONE_NEUF);
    const lignes = lignesDu(telephoneHorsLigne);
    expect(refusDe(lignes)).toEqual([ids.refusA, ids.refusAArchive, ids.refusB, ids.refusSansFerme].sort());
    expect(lignes.find((l) => l.id === ids.refusA)?.donnees).toMatchObject({ ferme_id: ids.fermeA, saisie_culture: CULTURE_A });
    expect(lignes.some((l) => l.table === 'ferme' && l.id === ids.fermeA)).toBe(true);
    // Témoin du mini-client : un téléphone qui repart de ses positions garde tout tant que rien ne change.
    const encore = await synchroniser(url(), gens.partant.jeton, telephoneHorsLigne);
    expect(refusDe(lignesDu(encore))).toEqual(refusDe(lignes));
    refusEnBaseAvant = await lireRefusEnBase();
  });

  it('2. retiré de A : plus aucun refus de A ni son résumé ; ceux de B et sans ferme restent', async () => {
    if (source === undefined) throw new Error('base source absente');
    // Le téléphone du partant est hors ligne : seule la base change.
    await source.pool.query(`UPDATE membre SET supprime_le = now() WHERE utilisateur_id = $1 AND ferme_id = $2`, [gens.partant.id, ids.fermeA]);
    // Témoin de réplication : la ferme A elle-même ne descend plus (règle déjà en place, T10).
    await attendreSynchro(url(), gens.partant.jeton, (l) => !l.some((x) => x.table === 'ferme' && x.id === ids.fermeA));

    const neuf = await lireSynchro(url(), gens.partant.jeton);
    expect(refusDe(neuf), 'téléphone neuf : refus de B et sans ferme seulement').toEqual([ids.refusB, ids.refusSansFerme].sort());
    expect(JSON.stringify(neuf), 'aucun résumé d’un refus de A').not.toContain(CULTURE_A);
    expect(neuf.find((l) => l.id === ids.refusB)?.donnees).toMatchObject({ ferme_id: ids.fermeB, saisie_culture: CULTURE_B });
    expect(neuf.some((l) => l.donnees.ferme_id === ids.fermeA), 'rien de la ferme A').toBe(false);
  });

  it('3. hors ligne au moment du retrait : à la synchro suivante, le téléphone perd les refus de A et garde les autres', async () => {
    expect(refusDe(lignesDu(telephoneHorsLigne)), 'avant la reconnexion, il les avait').toContain(ids.refusA);
    const apres = await synchroniser(url(), gens.partant.jeton, telephoneHorsLigne);
    const lignes = lignesDu(apres);
    expect(refusDe(lignes)).toEqual([ids.refusB, ids.refusSansFerme].sort());
    expect(JSON.stringify(lignes), 'aucun résumé d’un refus de A ne reste sur le téléphone').not.toContain(CULTURE_A);
    expect(lignes.some((l) => l.donnees.ferme_id === ids.fermeA), 'rien de la ferme A ne reste').toBe(false);
    expect(lignes.find((l) => l.id === ids.refusB)?.donnees).toMatchObject({ saisie_culture: CULTURE_B });
  });

  it('4. ferme supprimée : ses refus ne descendent plus, même à son gérant', async () => {
    const lignes = await lireSynchro(url(), gens.gerant.jeton);
    expect(refusDe(lignes)).toEqual([]);
    expect(JSON.stringify(lignes)).not.toContain(CULTURE_SUPPRIMEE);
  });

  it('5. un collègue resté membre de A garde ses refus de A, résumé compris', async () => {
    const lignes = await lireSynchro(url(), gens.collegue.jeton);
    expect(refusDe(lignes)).toEqual([ids.refusCollegueA]);
    expect(lignes.find((l) => l.id === ids.refusCollegueA)?.donnees).toMatchObject({ saisie_culture: CULTURE_A });
  });

  it('6. aucune écriture serveur : les refus en base sont intacts, aucun refus créé', async () => {
    expect(refusEnBaseAvant, 'lu au test 1').toHaveLength(6);
    expect(await lireRefusEnBase()).toEqual(refusEnBaseAvant);
  });
});
