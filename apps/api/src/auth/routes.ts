/**
 * Routes de connexion : code à 6 chiffres par e-mail (Q9), jetons, JWKS.
 * Contrat : auth.integration.test.ts.
 */
import { utilisateur, codeConnexion, jetonRenouvellement } from '@planif/db';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Contexte } from '../dependances.ts';
import { lireCorps, normaliserEmail } from '../http.ts';
import { jwksPublic } from './cles.ts';
import { emettreJetonAcces } from './jetons.ts';
import { codeCorrespond, empreinteCode, empreinteJeton, tirerCode, tirerJetonRenouvellement } from './secrets.ts';

const MINUTE = 60_000;
const JOUR = 24 * 60 * MINUTE;

/** Un code vaut 10 minutes, 5 tentatives, une seule fois. */
export const DUREE_CODE_MS = 10 * MINUTE;
export const TENTATIVES_MAX = 5;
/** Au plus un envoi par minute et cinq par heure pour une même adresse. */
export const INTERVALLE_ENVOI_MS = MINUTE;
export const ENVOIS_PAR_HEURE = 5;
/**
 * Jeton de renouvellement : glissant sur 90 jours (au moins 30 jours hors ligne, exigence T09),
 * plafonné à 365 jours après la connexion : un code par an au plus, et jamais 400 jours.
 */
export const DUREE_RENOUVELLEMENT_MS = 90 * JOUR;
export const DUREE_MAX_SESSION_MS = 365 * JOUR;

type Refus = { readonly erreur: 'trop_de_demandes'; readonly apresS: number } | null;

export function routesAuth(ctx: Contexte): Hono {
  const { db } = ctx;
  const routes = new Hono();

  routes.get('/.well-known/jwks.json', async (c) => {
    c.header('cache-control', 'public, max-age=300');
    return c.json(await jwksPublic(ctx.cles));
  });

  routes.post('/auth/code', async (c) => {
    const email = normaliserEmail((await lireCorps(c))?.email);
    if (email === null) return c.json({ erreur: 'email_invalide' }, 400);

    const code = tirerCode();
    const maintenant = ctx.maintenant();
    const refus: Refus = await db.transaction(async (tx) => {
      // Sérialise les demandes d'une même adresse : la limite ne se contourne pas en parallèle.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`code:${email}`}))`);
      const recents = await tx
        .select({ creeLe: codeConnexion.creeLe })
        .from(codeConnexion)
        .where(and(eq(codeConnexion.email, email), gt(codeConnexion.creeLe, new Date(maintenant.getTime() - 60 * MINUTE))))
        .orderBy(asc(codeConnexion.creeLe));
      const dernier = recents.at(-1)?.creeLe.getTime();
      const premier = recents[0]?.creeLe.getTime();
      let libreA = 0;
      if (dernier !== undefined) libreA = Math.max(libreA, dernier + INTERVALLE_ENVOI_MS);
      if (premier !== undefined && recents.length >= ENVOIS_PAR_HEURE) libreA = Math.max(libreA, premier + 60 * MINUTE);
      if (libreA > maintenant.getTime()) {
        return { erreur: 'trop_de_demandes', apresS: Math.max(1, Math.ceil((libreA - maintenant.getTime()) / 1000)) };
      }
      await tx.insert(codeConnexion).values({
        id: ctx.nouvelId(),
        email,
        codeHache: empreinteCode(code),
        expireLe: new Date(maintenant.getTime() + DUREE_CODE_MS),
        creeLe: maintenant,
      });
      return null;
    });
    if (refus !== null) {
      c.header('retry-after', String(refus.apresS));
      return c.json({ erreur: refus.erreur }, 429);
    }

    // Même message que le compte existe ou non : rien n'est révélé.
    await ctx.expediteur.envoyer({
      a: email,
      sujet: `Votre code de connexion : ${code}`,
      texte: `Votre code de connexion à Planifications : ${code}\n\nIl est valable 10 minutes. Si vous n'avez rien demandé, ignorez ce message.`,
    });
    return c.json({ ok: true }, 202);
  });

  routes.post('/auth/verifier', async (c) => {
    const corps = await lireCorps(c);
    const email = normaliserEmail(corps?.email);
    const code = corps?.code;
    const refuse = () => c.json({ erreur: 'code_invalide' }, 401);
    if (email === null || typeof code !== 'string') return refuse();

    const maintenant = ctx.maintenant();
    const jetonRenouvellementNeuf = tirerJetonRenouvellement();
    const utilisateurId = await db.transaction(async (tx) => {
      // Seul le dernier code demandé pour cette adresse compte ; verrouillé pour que deux
      // vérifications simultanées ne dépassent pas la limite de tentatives.
      const [ligne] = await tx
        .select()
        .from(codeConnexion)
        .where(eq(codeConnexion.email, email))
        .orderBy(desc(codeConnexion.creeLe), desc(codeConnexion.id))
        .limit(1)
        .for('update');
      if (ligne === undefined) return null;
      if (ligne.utiliseLe !== null) return null; // déjà utilisé
      const valable = ligne.expireLe.getTime() > maintenant.getTime() && ligne.tentatives < TENTATIVES_MAX;
      if (!valable || !codeCorrespond(code, ligne.codeHache)) {
        // Chaque échec compte une tentative.
        await tx
          .update(codeConnexion)
          .set({ tentatives: sql`${codeConnexion.tentatives} + 1` })
          .where(eq(codeConnexion.id, ligne.id));
        return null;
      }
      await tx.update(codeConnexion).set({ utiliseLe: maintenant }).where(eq(codeConnexion.id, ligne.id));

      // Compte créé à la première connexion.
      await tx
        .insert(utilisateur)
        .values({ id: ctx.nouvelId<'Utilisateur'>(), email, creeLe: maintenant, modifieLe: maintenant })
        .onConflictDoNothing({ target: utilisateur.email });
      const [compte] = await tx
        .select({ id: utilisateur.id, supprimeLe: utilisateur.supprimeLe })
        .from(utilisateur)
        .where(eq(utilisateur.email, email));
      if (compte === undefined) return null;
      if (compte.supprimeLe !== null) return null; // compte supprimé

      // Dans la même transaction : un code n'est consommé que si la session est bien créée.
      await tx.insert(jetonRenouvellement).values({
        id: ctx.nouvelId(),
        utilisateurId: compte.id,
        jetonHache: empreinteJeton(jetonRenouvellementNeuf),
        expireLe: new Date(maintenant.getTime() + DUREE_RENOUVELLEMENT_MS),
        creeLe: maintenant,
      });
      return compte.id;
    });
    if (utilisateurId === null) return refuse();

    return c.json({
      utilisateurId,
      jetonAcces: await emettreJetonAcces(ctx, utilisateurId, maintenant),
      jetonRenouvellement: jetonRenouvellementNeuf,
    });
  });

  // Ne demande PAS de jeton d'accès valide : c'est ce qui permet aux écritures faites hors
  // ligne de partir au retour du réseau, même après expiration du jeton d'accès.
  routes.post('/auth/renouveler', async (c) => {
    const jeton = (await lireCorps(c))?.jetonRenouvellement;
    const refuse = () => c.json({ erreur: 'jeton_invalide' }, 401);
    if (typeof jeton !== 'string' || jeton === '') return refuse();

    const maintenant = ctx.maintenant();
    const [ligne] = await db
      .select({
        id: jetonRenouvellement.id,
        utilisateurId: jetonRenouvellement.utilisateurId,
        creeLe: jetonRenouvellement.creeLe,
      })
      .from(jetonRenouvellement)
      .innerJoin(utilisateur, eq(utilisateur.id, jetonRenouvellement.utilisateurId))
      .where(
        and(
          eq(jetonRenouvellement.jetonHache, empreinteJeton(jeton)),
          isNull(jetonRenouvellement.revoqueLe),
          gt(jetonRenouvellement.expireLe, maintenant),
          isNull(utilisateur.supprimeLe),
        ),
      )
      .limit(1);
    if (ligne === undefined) return refuse();

    // Pas de rotation stricte : une réponse perdue sur un réseau faible ne déconnecte pas.
    // Le même jeton reste valable, son échéance glisse (plafonnée à DUREE_MAX_SESSION_MS).
    const expireLe = Math.min(
      maintenant.getTime() + DUREE_RENOUVELLEMENT_MS,
      ligne.creeLe.getTime() + DUREE_MAX_SESSION_MS,
    );
    await db
      .update(jetonRenouvellement)
      .set({ expireLe: new Date(expireLe) })
      .where(eq(jetonRenouvellement.id, ligne.id));
    return c.json({
      jetonAcces: await emettreJetonAcces(ctx, ligne.utilisateurId, maintenant),
      jetonRenouvellement: jeton,
    });
  });

  return routes;
}
