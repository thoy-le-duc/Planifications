/**
 * Utilitaires de test (T10) : démarrer le vrai service PowerSync dans Docker avec la
 * configuration du dépôt (`powersync/`), et lire ce qu'il envoie à un téléphone.
 *
 * ── Ce que le test attend de `powersync/` ───────────────────────────────────────────────────
 *
 * - `powersync/powersync.yaml` : configuration du service, lue telle quelle (montée en
 *   lecture seule sur /config, POWERSYNC_CONFIG_PATH=/config/powersync.yaml). Tout ce qui
 *   dépend de l'environnement passe par `!env` :
 *     PS_DATA_SOURCE_URI  base Postgres répliquée (replication.connections[0].uri)
 *     PS_STORAGE_URI      base Postgres du stockage des buckets (storage.type: postgresql)
 *     PS_SSLMODE          `sslmode` des deux connexions ('disable' en local et en test ;
 *                         PowerSync l'ignore dans l'URI)
 *     PS_PORT             port HTTP du service
 *     PS_JWKS_URI         client_auth.jwks_uri (GET /.well-known/jwks.json de l'API)
 *     PS_JWT_AUDIENCE     client_auth.audience (celle de JWT_AUDIENCE de l'API)
 * - `powersync/sync-config.yaml` (référencé par sync_config.path) : les Sync Streams. Tous les
 *   flux en `auto_subscribe: true` : le téléphone les reçoit sans abonnement explicite.
 *
 * Le conteneur tourne en `--network host` (Linux : CI GitHub, conteneur de la boucle) : il
 * joint Postgres et le serveur JWKS du test sur localhost.
 *
 * Image : POWERSYNC_IMAGE, par défaut `journeyapps/powersync-service:1.26.1` (Docker Hub, CI).
 * Dans le conteneur de la boucle : POWERSYNC_IMAGE=mirror.gcr.io/journeyapps/powersync-service:1.26.1.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

export const IMAGE_POWERSYNC = process.env.POWERSYNC_IMAGE ?? 'journeyapps/powersync-service:1.26.1';
export const DOSSIER_CONFIG = fileURLToPath(new URL('../../../../../powersync/', import.meta.url));
export const FICHIER_SERVICE = `${DOSSIER_CONFIG}powersync.yaml`;
export const FICHIER_FLUX = `${DOSSIER_CONFIG}sync-config.yaml`;

export function dockerDisponible(): boolean {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0;
}

function docker(args: readonly string[]): string {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`docker ${args.join(' ')} : ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

export async function portLibre(): Promise<number> {
  return new Promise((ok, echec) => {
    const s = createServer();
    s.once('error', echec);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => {
        ok(port);
      });
    });
  });
}

/** Petit serveur HTTP qui sert un JWKS public (celui de l'API) au service PowerSync. */
export async function servirJwks(jwks: unknown): Promise<{ url: string; fermer(): Promise<void> }> {
  const serveur: Server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(jwks));
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const { port } = serveur.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/.well-known/jwks.json`,
    fermer: () =>
      new Promise((ok) => {
        serveur.close(() => {
          ok();
        });
      }),
  };
}

export interface OptionsPowerSync {
  readonly urlSource: string;
  readonly urlStockage: string;
  readonly jwksUri: string;
  readonly audience: string;
}

export interface ServicePowerSync {
  readonly url: string;
  journal(): string;
  arreter(): void;
}

async function pause(ms: number): Promise<void> {
  await new Promise((fin) => setTimeout(fin, ms));
}

/** Démarre le service et attend qu'il réponde (sondes /probes/*). */
export async function demarrerPowerSync(o: OptionsPowerSync): Promise<ServicePowerSync> {
  if (!existsSync(FICHIER_SERVICE) || !existsSync(FICHIER_FLUX)) {
    throw new Error(`configuration PowerSync absente : ${FICHIER_SERVICE} et ${FICHIER_FLUX} sont attendus (T10).`);
  }
  const port = await portLibre();
  const nom = `planif-t10-powersync-${randomUUID().slice(0, 8)}`;
  docker([
    'run',
    '-d',
    '--name',
    nom,
    '--network',
    'host',
    '-v',
    `${DOSSIER_CONFIG}:/config:ro`,
    '-e',
    'POWERSYNC_CONFIG_PATH=/config/powersync.yaml',
    '-e',
    `PS_DATA_SOURCE_URI=${o.urlSource}`,
    '-e',
    `PS_STORAGE_URI=${o.urlStockage}`,
    '-e',
    'PS_SSLMODE=disable',
    '-e',
    `PS_PORT=${String(port)}`,
    '-e',
    `PS_JWKS_URI=${o.jwksUri}`,
    '-e',
    `PS_JWT_AUDIENCE=${o.audience}`,
    IMAGE_POWERSYNC,
    'start',
    '-r',
    'unified',
  ]);
  const service: ServicePowerSync = {
    url: `http://127.0.0.1:${String(port)}`,
    journal: () => spawnSync('docker', ['logs', '--tail', '80', nom], { encoding: 'utf8' }).stdout,
    arreter: () => {
      spawnSync('docker', ['rm', '-f', nom], { encoding: 'utf8' });
    },
  };
  const fin = Date.now() + 90_000;
  for (;;) {
    try {
      const r = await fetch(`${service.url}/probes/liveness`);
      if (r.ok) return service;
    } catch {
      // Pas encore prêt.
    }
    const etat = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', nom], { encoding: 'utf8' }).stdout.trim();
    if (etat !== 'true' || Date.now() > fin) {
      const journal = service.journal();
      service.arreter();
      throw new Error(`le service PowerSync n'a pas démarré :\n${journal}`);
    }
    await pause(500);
  }
}

/** Une ligne reçue par le téléphone. */
export interface LigneRecue {
  readonly table: string;
  readonly id: string;
  readonly donnees: Record<string, unknown>;
}

interface MessageSynchro {
  readonly checkpoint_complete?: unknown;
  readonly data?: {
    readonly data?: readonly {
      readonly op: string;
      readonly object_type?: string;
      readonly object_id?: string;
      readonly data?: string | null;
    }[];
  };
}

/**
 * Ce qu'un téléphone neuf reçoit avec ce jeton : ouvre le flux de synchro (protocole HTTP de
 * PowerSync, POST /sync/stream, lignes JSON), lit jusqu'au premier `checkpoint_complete` et
 * rend les lignes PUT reçues. Les flux `auto_subscribe` sont inclus.
 */
export async function lireSynchro(url: string, jeton: string): Promise<LigneRecue[]> {
  const res = await fetch(`${url}/sync/stream`, {
    method: 'POST',
    headers: { authorization: `Token ${jeton}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      buckets: [],
      include_checksum: true,
      raw_data: true,
      client_id: randomUUID(),
      streams: { include_defaults: true, subscriptions: [] },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 200 || res.body === null) {
    throw new Error(`synchro refusée : ${String(res.status)} ${await res.text()}`);
  }
  const lignes: LigneRecue[] = [];
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
        const message = JSON.parse(texte) as MessageSynchro;
        if (message.checkpoint_complete !== undefined) return lignes;
        for (const op of message.data?.data ?? []) {
          if (op.op !== 'PUT' || op.object_type === undefined || op.object_id === undefined) continue;
          const donnees = typeof op.data === 'string' ? (JSON.parse(op.data) as Record<string, unknown>) : {};
          lignes.push({ table: op.object_type, id: op.object_id, donnees });
        }
      }
    }
  } finally {
    await lecteur.cancel().catch(() => undefined);
  }
}

/** Relit la synchro jusqu'à ce que `condition` soit vraie (réplication en cours), ou échoue. */
export async function attendreSynchro(
  url: string,
  jeton: string,
  condition: (lignes: readonly LigneRecue[]) => boolean,
  delaiMs = 30_000,
): Promise<LigneRecue[]> {
  const fin = Date.now() + delaiMs;
  let derniere: LigneRecue[] = [];
  let erreur: unknown = null;
  while (Date.now() < fin) {
    try {
      derniere = await lireSynchro(url, jeton);
      erreur = null;
      if (condition(derniere)) return derniere;
    } catch (e) {
      erreur = e;
    }
    await pause(500);
  }
  throw new Error(
    `synchro jamais conforme en ${String(delaiMs)} ms ; dernière erreur : ${String(erreur)} ; reçu : ${JSON.stringify(derniere).slice(0, 2000)}`,
  );
}
