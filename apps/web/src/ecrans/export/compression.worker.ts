/**
 * Worker de compression de l'export (T16b) : deflate brut (`CompressionStream('deflate-raw')`)
 * hors du fil principal. Mesuré dans le navigateur (hors ligne, CPU ×4, ferme de T07) : la
 * compression faite sur le fil principal y prenait ≈ 4,5 s sur ≈ 8 s de construction de
 * l'archive ; ici, elle se fait pendant que le fil principal écrit les CSV suivants.
 *
 * Protocole (./compression.ts) : chaque entrée de l'archive est un flux numéroté.
 *   reçu  { type: 'bonjour' } | { id, type: 'morceau', octets } | { id, type: 'fin' } | { id, type: 'abandon' }
 *   rendu { type: 'pret' } (réponse à « bonjour » : le script est chargé)
 *         | { id, type: 'recu', taille } (morceau reçu pris par le flux : contre-pression, T15c)
 *         | { id, type: 'morceau', octets } (tampon transféré) | { id, type: 'fin' } | { id, type: 'erreur', message }
 *
 * T47 : le même script construit aussi toute l'archive (./construction.ts) : sur « exporter »,
 * `exporterFerme` tourne ici, avec une porte distante qui demande chaque page à la page
 * (« lire » → « page ») et la compression par défaut (`CompressionStream`, dans ce worker). Le
 * tas de la construction (lignes, CSV, morceaux compressés) vit ici, hors du fil principal.
 */
import { exporterFerme, type PorteDonnees } from '@planif/sync/export';
import type { MessageCompression, ReponseCompression } from './compression.ts';
import type { MessageConstruction, ReponseConstruction } from './construction.ts';

interface Flux {
  readonly ecrivain: WritableStreamDefaultWriter<BufferSource>;
  readonly lecteur: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
}

const flux = new Map<number, Flux>();
/** Flux abandonnés : un message en retard ne les rouvre pas. */
const abandonnes = new Set<number>();

function repondre(r: ReponseCompression): void {
  if (r.type === 'morceau') self.postMessage(r, { transfer: [r.octets.buffer] });
  else self.postMessage(r);
}

/** Lit la sortie compressée d'un flux et la renvoie, morceau par morceau. */
async function renvoyer(id: number, lecteur: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>): Promise<void> {
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      repondre({ id, type: 'morceau', octets: value });
    }
    repondre({ id, type: 'fin' });
  } catch (erreur: unknown) {
    // Abandon demandé : le lecteur est annulé, rien à dire.
    if (flux.has(id)) repondre({ id, type: 'erreur', message: erreur instanceof Error ? erreur.message : String(erreur) });
  } finally {
    flux.delete(id);
  }
}

function ouvrir(id: number): Flux {
  const existant = flux.get(id);
  if (existant !== undefined) return existant;
  const compression = new CompressionStream('deflate-raw');
  const f: Flux = { ecrivain: compression.writable.getWriter(), lecteur: compression.readable.getReader() };
  flux.set(id, f);
  void renvoyer(id, f.lecteur);
  return f;
}

// ── Construction de l'archive (T47) ──────────────────────────────────────────────────────────

/** Lectures demandées à la page et pas encore rendues. */
const lectures = new Map<number, { readonly ok: (lignes: readonly unknown[]) => void; readonly ko: (erreur: unknown) => void }>();
let numeroLecture = 0;
let construction: AbortController | undefined;

function dire(r: ReponseConstruction): void {
  if (r.type === 'archive') self.postMessage(r, { transfer: [r.octets.buffer] });
  else self.postMessage(r);
}

const interdit = (nom: string) => () => {
  throw new Error(`l’export ne doit pas appeler porte.${nom}`);
};

/** Porte de l'export dans le worker : lecture seule, chaque page demandée à la page. */
const porteDistante: PorteDonnees = {
  lire: <T>(sql: string, parametres?: readonly unknown[]) =>
    new Promise<T[]>((ok, ko) => {
      const n = numeroLecture++;
      lectures.set(n, {
        ok: (lignes) => {
          ok(lignes as T[]);
        },
        ko,
      });
      dire({ type: 'lire', n, sql, parametres: parametres ?? [] });
    }),
  ecrire: interdit('ecrire'),
  ecrireEnsemble: interdit('ecrireEnsemble'),
  surveiller: interdit('surveiller'),
  saisirEvenement: interdit('saisirEvenement'),
  preparerSaisie: interdit('preparerSaisie'),
  surveillerRefus: interdit('surveillerRefus'),
  archiverRefus: interdit('archiverRefus'),
  placer: interdit('placer'),
  reglerProfilCroissance: interdit('reglerProfilCroissance'),
  personnaliserEspece: interdit('personnaliserEspece'),
};

async function construire(fermeId: string, genereLe: string, jour: string): Promise<void> {
  if (construction !== undefined) return;
  const ctrl = new AbortController();
  construction = ctrl;
  try {
    const archive = await exporterFerme(porteDistante, {
      fermeId,
      genereLe,
      jour,
      signal: ctrl.signal,
      avancement: ({ fait, total }) => {
        dire({ type: 'avancement', fait, total });
      },
    });
    // creerZip écrit dans un ArrayBuffer ordinaire, à sa taille : il part tel quel (transféré).
    dire({ type: 'archive', nomFichier: archive.nomFichier, octets: archive.octets as Uint8Array<ArrayBuffer>, lignes: archive.lignes });
  } catch (erreur: unknown) {
    if (!ctrl.signal.aborted) dire({ type: 'echec', message: erreur instanceof Error ? erreur.message : String(erreur) });
  }
}

function surConstruction(m: MessageConstruction): void {
  switch (m.type) {
    case 'exporter':
      void construire(m.fermeId, m.genereLe, m.jour);
      return;
    case 'page': {
      const l = lectures.get(m.n);
      lectures.delete(m.n);
      l?.ok(m.lignes);
      return;
    }
    case 'page-echec': {
      const l = lectures.get(m.n);
      lectures.delete(m.n);
      l?.ko(new Error('lecture de la base impossible'));
      return;
    }
    case 'annuler':
      construction?.abort();
      return;
  }
}

const TYPES_CONSTRUCTION: ReadonlySet<string> = new Set<MessageConstruction['type']>(['exporter', 'page', 'page-echec', 'annuler']);

function estConstruction(m: MessageCompression | MessageConstruction): m is MessageConstruction {
  return TYPES_CONSTRUCTION.has(m.type);
}

// ── Messages ─────────────────────────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<MessageCompression | MessageConstruction>) => {
  const d = e.data;
  if (d.type === 'bonjour') {
    repondre({ type: 'pret' });
    return;
  }
  if (estConstruction(d)) {
    surConstruction(d);
    return;
  }
  const m = d;
  // Accusé de réception d'un morceau : il libère sa place côté page (contre-pression, T15c).
  const recu = () => {
    if (m.type === 'morceau') repondre({ id: m.id, type: 'recu', taille: m.octets.byteLength });
  };
  if (abandonnes.has(m.id)) {
    recu();
    return;
  }
  if (m.type === 'abandon') {
    abandonnes.add(m.id);
    const f = flux.get(m.id);
    flux.delete(m.id);
    f?.lecteur.cancel().catch(() => undefined);
    f?.ecrivain.abort().catch(() => undefined);
    return;
  }
  const f = ouvrir(m.id);
  // Écritures mises en file dans l'ordre ; une erreur arrive par le lecteur (renvoyer).
  // Reçu par clonage structuré : toujours un ArrayBuffer ordinaire (jamais partagé).
  // L'accusé part quand le flux a pris le morceau : la contre-pression va jusqu'au deflate.
  if (m.type === 'morceau') f.ecrivain.write(m.octets as Uint8Array<ArrayBuffer>).then(recu, recu);
  else f.ecrivain.close().catch(() => undefined);
};
