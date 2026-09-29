/**
 * Limite par adresse IP sur /auth/code et /auth/verifier (T09b), en plus des limites par adresse
 * e-mail de T09. Comptée en base (`securite.demande_ip`) : partagée entre processus d'API, sans
 * perte au redémarrage. Contrat : durcissement.integration.test.ts (section 3).
 *
 * Donnée personnelle : une adresse IP n'est gardée que 24 heures (CONSERVATION_IP_MS), effacée à
 * chaque nouvelle demande enregistrée, sans tâche planifiée.
 */
import { demandeIp, type ACTIONS_LIMITEES_IP } from '@planif/db/securite';
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { getConnInfo } from '@hono/node-server/conninfo';
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

/** « ::ffff:192.0.2.1 » (IPv4 vue par une socket IPv6) → « 192.0.2.1 ». */
function normaliser(adresse: string): string {
  const a = adresse.trim().toLowerCase();
  return a.startsWith('::ffff:') && a.includes('.') ? a.slice('::ffff:'.length) : a;
}

/**
 * Adresse du client : celle de la socket ; derrière le proxy de confiance, la DERNIÈRE valeur de
 * X-Forwarded-For (celle que notre proxy ajoute ; les précédentes viennent du client). Null si
 * inconnue : pas de limite par IP.
 */
export function adresseClient(c: Context, proxyDeConfiance: boolean): string | null {
  if (proxyDeConfiance) {
    const derniere = (c.req.header('x-forwarded-for') ?? '').split(',').at(-1)?.trim() ?? '';
    if (derniere !== '') return normaliser(derniere);
  }
  const socket = adresseSocket(c);
  return socket === null ? null : normaliser(socket);
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
    const libreA = libreSelonFenetre(recentes, MAXIMUMS[action], FENETRE_IP_MS, t);
    if (libreA > t) return secondesAvant(libreA, t);

    await tx.insert(demandeIp).values({ id: ctx.nouvelId(), ip, action, creeLe: maintenant });
    // Conservation limitée : rien au-delà de 24 heures.
    await tx.delete(demandeIp).where(lt(demandeIp.creeLe, new Date(t - CONSERVATION_IP_MS)));
    return null;
  });
}
