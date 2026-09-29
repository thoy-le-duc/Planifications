/**
 * Limite par adresse IP sur /auth/code et /auth/verifier (T09b), en plus des limites par adresse
 * e-mail de T09. Comptée en base (`securite.demande_ip`) : partagée entre processus d'API, sans
 * perte au redémarrage. Contrat : durcissement.integration.test.ts (section 3).
 *
 * Donnée personnelle : une adresse IP n'est gardée que 24 heures (CONSERVATION_IP_MS), effacée à
 * chaque demande, acceptée ou refusée, sans tâche planifiée. Une adresse IPv6 est comptée (et
 * gardée) par son préfixe /64.
 */
import { demandeIp, type ACTIONS_LIMITEES_IP } from '@planif/db/securite';
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { getConnInfo } from '@hono/node-server/conninfo';
import { isIP } from 'node:net';
import type { Context } from 'hono';
import type { Contexte } from '../dependances.ts';
import { libreSelonFenetre, secondesAvant } from '../limites.ts';

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

/** Demandes de code par IP et par heure glissante : un magasin derrière une même IP garde de la marge. */
export const CODES_PAR_IP_PAR_HEURE = 30;
/** Vérifications (réussies ou non) par IP et par heure glissante. */
export const VERIFICATIONS_PAR_IP_PAR_HEURE = 60;
export const FENETRE_IP_MS = HEURE;
/** Durée de conservation d'une adresse IP en base. */
export const CONSERVATION_IP_MS = 24 * HEURE;

export type ActionLimitee = (typeof ACTIONS_LIMITEES_IP)[number];

const MAXIMUMS: Readonly<Record<ActionLimitee, number>> = {
  code: CODES_PAR_IP_PAR_HEURE,
  verifier: VERIFICATIONS_PAR_IP_PAR_HEURE,
};

/** Adresse de la socket, telle que @hono/node-server la fournit ; null sans socket (app.request). */
function adresseSocket(c: Context): string | null {
  try {
    const adresse = getConnInfo(c).remote.address;
    return typeof adresse === 'string' && adresse !== '' ? adresse : null;
  } catch {
    return null;
  }
}

/** Groupes (8 × 16 bits) d'une adresse IPv6 valide (net.isIP), forme compressée ou IPv4 finale comprise. */
function groupesIpv6(adresse: string): number[] {
  let a = adresse;
  // IPv4 finale (« ::ffff:192.0.2.1 ») : deux groupes de 16 bits.
  const ipv4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (ipv4 !== null) {
    const [o1 = 0, o2 = 0, o3 = 0, o4 = 0] = ipv4.slice(1).map(Number);
    a = `${a.slice(0, ipv4.index)}${((o1 << 8) | o2).toString(16)}:${((o3 << 8) | o4).toString(16)}`;
  }
  const [tete = '', queue] = a.split('::');
  const lire = (partie: string): number[] => (partie === '' ? [] : partie.split(':').map((g) => Number.parseInt(g, 16)));
  const debut = lire(tete);
  if (queue === undefined) return debut;
  const fin = lire(queue);
  return [...debut, ...new Array<number>(8 - debut.length - fin.length).fill(0), ...fin];
}

/**
 * Clé de comptage d'une adresse, ou null si ce n'est pas une adresse IP : IPv4 telle quelle ;
 * IPv4 vue par une socket IPv6 (::ffff:a.b.c.d) comme a.b.c.d ; IPv6 réduite à son préfixe /64
 * (un client en a des milliards), quelle que soit son écriture.
 */
export function cleAdresse(brute: string): string | null {
  const adresse = brute.trim().toLowerCase().replace(/%.*$/, '');
  const version = isIP(adresse);
  if (version === 4) return adresse;
  if (version !== 6) return null;
  const g = groupesIpv6(adresse);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const [h = 0, b = 0] = g.slice(6);
    return [h >> 8, h & 0xff, b >> 8, b & 0xff].join('.');
  }
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`;
}

/**
 * Adresse du client : celle de la socket ; derrière le proxy de confiance, la DERNIÈRE valeur de
 * X-Forwarded-For (celle que notre proxy ajoute ; les précédentes viennent du client), si c'est
 * une adresse IP valide (sinon, la socket : jamais une valeur précédente, falsifiable). Null si
 * inconnue : pas de limite par IP.
 */
export function adresseClient(c: Context, proxyDeConfiance: boolean): string | null {
  if (proxyDeConfiance) {
    const derniere = (c.req.header('x-forwarded-for') ?? '').split(',').at(-1) ?? '';
    const cle = cleAdresse(derniere);
    if (cle !== null) return cle;
  }
  const socket = adresseSocket(c);
  return socket === null ? null : cleAdresse(socket);
}

/**
 * Enregistre la demande si la limite le permet et rend null ; sinon rend le délai (secondes,
 * Retry-After) sans rien enregistrer : un client refusé ne prolonge pas son propre blocage.
 */
export async function enregistrerDemandeIp(ctx: Contexte, action: ActionLimitee, ip: string): Promise<number | null> {
  const maintenant = ctx.maintenant();
  const t = maintenant.getTime();
  return ctx.db.transaction(async (tx) => {
    // Sérialise les demandes d'une même adresse : la limite ne se contourne pas en parallèle.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ip:${action}:${ip}`}))`);
    const recentes = (
      await tx
        .select({ creeLe: demandeIp.creeLe })
        .from(demandeIp)
        .where(and(eq(demandeIp.action, action), eq(demandeIp.ip, ip), gt(demandeIp.creeLe, new Date(t - FENETRE_IP_MS))))
        .orderBy(asc(demandeIp.creeLe))
    ).map((l) => l.creeLe.getTime());
    // Conservation limitée : rien au-delà de 24 heures, que la demande soit acceptée ou refusée.
    await tx.delete(demandeIp).where(lt(demandeIp.creeLe, new Date(t - CONSERVATION_IP_MS)));
    const libreA = libreSelonFenetre(recentes, MAXIMUMS[action], FENETRE_IP_MS, t);
    if (libreA > t) return secondesAvant(libreA, t);

    await tx.insert(demandeIp).values({ id: ctx.nouvelId(), ip, action, creeLe: maintenant });
    return null;
  });
}
