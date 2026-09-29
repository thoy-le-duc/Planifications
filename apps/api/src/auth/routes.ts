/**
 * Routes de connexion : code à 6 chiffres par e-mail (Q9), jetons, JWKS.
 * Contrat : auth.integration.test.ts.
 */
import { utilisateur, codeConnexion, jetonRenouvellement, membre } from '@planif/db';
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { Contexte } from '../dependances.ts';
import { lireCorps, normaliserEmail } from '../http.ts';
import { libreSelonFenetre, secondesAvant } from '../limites.ts';
import { jwksPublic } from './cles.ts';
import { adresseClient, enregistrerDemandeIp, type ActionLimitee } from './limite-ip.ts';
import { emettreJetonAcces } from './jetons.ts';
import { codeCorrespond, empreinteCode, empreinteJeton, tirerCode, tirerJetonRenouvellement } from './secrets.ts';

const MINUTE = 60_000;
const JOUR = 24 * 60 * MINUTE;

/** Un code vaut 10 minutes, 5 tentatives, une seule fois. */
export const DUREE_CODE_MS = 10 * MINUTE;
export const TENTATIVES_MAX = 5;
/** Au plus un envoi par minute, cinq par heure et dix par 24 h glissantes pour une même adresse. */
export const INTERVALLE_ENVOI_MS = MINUTE;
export const ENVOIS_PAR_HEURE = 5;
export const ENVOIS_PAR_JOUR = 10;
/**
 * Force brute par adresse : à partir de ECHECS_PAR_JOUR échecs sur 24 h glissantes, tous codes
 * confondus, toute vérification échoue (même réponse), jusqu'à ce que les échecs sortent de la
 * fenêtre.
 */
export const ECHECS_PAR_JOUR = 10;
/**
 * Jeton de renouvellement : glissant sur 90 jours (au moins 30 jours hors ligne, exigence T09),
 * plafonné à 365 jours après la connexion : un code par an au plus, et jamais 400 jours.
 */
export const DUREE_RENOUVELLEMENT_MS = 90 * JOUR;
export const DUREE_MAX_SESSION_MS = 365 * JOUR;
/**
 * Rotation (T09b) : un jeton de renouvellement déjà utilisé reste accepté DELAI_GRACE_MS après son
 * premier usage (réponse perdue au champ) ; présenté plus tard, c'est un rejeu : toute sa famille
 * est révoquée.
 */
export const DELAI_GRACE_MS = 2 * MINUTE;

type Refus = { readonly erreur: 'trop_de_demandes'; readonly apresS: number } | null;

export function routesAuth(ctx: Contexte): Hono {
  const { db } = ctx;
  const routes = new Hono();

  routes.get('/.well-known/jwks.json', async (c) => {
    c.header('cache-control', 'public, max-age=300');
    return c.json(await jwksPublic(ctx.cles));
  });

  /** 429 si l'adresse IP du client a atteint sa limite ; null sinon (demande enregistrée). */
  async function limiteIp(c: Context, action: ActionLimitee): Promise<Response | null> {
    const ip = adresseClient(c, ctx.proxyDeConfiance);
    if (ip === null) return null;
    const apresS = await enregistrerDemandeIp(ctx, action, ip);
    if (apresS === null) return null;
    c.header('retry-after', String(apresS));
    return c.json({ erreur: 'trop_de_demandes' }, 429);
  }

  routes.post('/auth/code', async (c) => {
    const tropParIp = await limiteIp(c, 'code');
    if (tropParIp !== null) return tropParIp;
    const email = normaliserEmail((await lireCorps(c))?.email);
    if (email === null) return c.json({ erreur: 'email_invalide' }, 400);

    const code = tirerCode();
    const maintenant = ctx.maintenant();
    const refus: Refus = await db.transaction(async (tx) => {
      // Sérialise les demandes d'une même adresse : la limite ne se contourne pas en parallèle.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`code:${email}`}))`);
      const t = maintenant.getTime();
      const recents = (
        await tx
          .select({ creeLe: codeConnexion.creeLe })
          .from(codeConnexion)
          .where(and(eq(codeConnexion.email, email), gt(codeConnexion.creeLe, new Date(t - JOUR))))
          .orderBy(asc(codeConnexion.creeLe))
      ).map((l) => l.creeLe.getTime());
      const libreA = Math.max(
        libreSelonFenetre(recents, 1, INTERVALLE_ENVOI_MS, t),
        libreSelonFenetre(recents, ENVOIS_PAR_HEURE, 60 * MINUTE, t),
        libreSelonFenetre(recents, ENVOIS_PAR_JOUR, JOUR, t),
      );
      if (libreA > t) {
        return { erreur: 'trop_de_demandes', apresS: secondesAvant(libreA, t) };
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
    // Avant toute lecture du code : une vérification refusée ici ne compte pas de tentative.
    const tropParIp = await limiteIp(c, 'verifier');
    if (tropParIp !== null) return tropParIp;
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

      // Force brute par adresse. Les échecs sont les tentatives des codes de l'adresse créés dans
      // les 24 h : un échec suit toujours la création de son code, et un échec sur un code créé
      // plus tôt visait un code expiré (10 minutes), sans chance d'aboutir.
      const [echecs] = await tx
        .select({ n: sql<number>`coalesce(sum(${codeConnexion.tentatives}), 0)::int` })
        .from(codeConnexion)
        .where(and(eq(codeConnexion.email, email), gt(codeConnexion.creeLe, new Date(maintenant.getTime() - JOUR))));
      const bloque = (echecs?.n ?? 0) >= ECHECS_PAR_JOUR;

      const valable =
        !bloque && ligne.expireLe.getTime() > maintenant.getTime() && ligne.tentatives < TENTATIVES_MAX;
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

      // Une connexion réussie vaut acceptation des invitations en attente, faites avant elle.
      await tx
        .update(membre)
        .set({ etat: 'accepte', modifieLe: maintenant })
        .where(
          and(
            eq(membre.utilisateurId, compte.id),
            eq(membre.etat, 'invite'),
            isNull(membre.supprimeLe),
            lte(membre.inviteLe, maintenant),
          ),
        );

      // Dans la même transaction : un code n'est consommé que si la session est bien créée.
      // Premier jeton d'une nouvelle famille (la connexion) : famille_id = son propre id.
      const idJeton = ctx.nouvelId();
      await tx.insert(jetonRenouvellement).values({
        id: idJeton,
        utilisateurId: compte.id,
        jetonHache: empreinteJeton(jetonRenouvellementNeuf),
        expireLe: new Date(maintenant.getTime() + DUREE_RENOUVELLEMENT_MS),
        creeLe: maintenant,
        familleId: idJeton,
        connexionLe: maintenant,
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

  /** Révoque toute la famille (même connexion) : `famille_id`, ou l'id pour une ligne écrite hors API. */
  async function revoquerFamille(executeur: Pick<typeof db, 'update'>, famille: string, maintenant: Date): Promise<void> {
    await executeur
      .update(jetonRenouvellement)
      .set({ revoqueLe: maintenant })
      .where(
        and(
          or(eq(jetonRenouvellement.familleId, famille), eq(jetonRenouvellement.id, famille)),
          isNull(jetonRenouvellement.revoqueLe),
        ),
      );
  }

  // Ne demande PAS de jeton d'accès valide : c'est ce qui permet aux écritures faites hors
  // ligne de partir au retour du réseau, même après expiration du jeton d'accès.
  routes.post('/auth/renouveler', async (c) => {
    const jeton = (await lireCorps(c))?.jetonRenouvellement;
    const refuse = () => c.json({ erreur: 'jeton_invalide' }, 401);
    if (typeof jeton !== 'string' || jeton === '') return refuse();

    const maintenant = ctx.maintenant();
    const t = maintenant.getTime();
    const jetonNeuf = tirerJetonRenouvellement();
    const utilisateurId = await db.transaction(async (tx) => {
      // Verrouillé : des renouvellements simultanés du même jeton passent l'un après l'autre.
      const [ligne] = await tx
        .select({
          id: jetonRenouvellement.id,
          utilisateurId: jetonRenouvellement.utilisateurId,
          expireLe: jetonRenouvellement.expireLe,
          revoqueLe: jetonRenouvellement.revoqueLe,
          creeLe: jetonRenouvellement.creeLe,
          familleId: jetonRenouvellement.familleId,
          connexionLe: jetonRenouvellement.connexionLe,
          utiliseLe: jetonRenouvellement.utiliseLe,
          supprimeLe: utilisateur.supprimeLe,
        })
        .from(jetonRenouvellement)
        .innerJoin(utilisateur, eq(utilisateur.id, jetonRenouvellement.utilisateurId))
        .where(eq(jetonRenouvellement.jetonHache, empreinteJeton(jeton)))
        .limit(1)
        .for('update', { of: jetonRenouvellement });
      if (ligne?.revoqueLe !== null || ligne.supprimeLe !== null || ligne.expireLe.getTime() <= t) return null;

      const famille = ligne.familleId ?? ligne.id;
      if (ligne.utiliseLe !== null && t - ligne.utiliseLe.getTime() > DELAI_GRACE_MS) {
        // Rejeu d'un jeton déjà remplacé : volé, ou copié sur un autre téléphone. On ne sait pas
        // lequel est légitime : toute la session tombe, l'utilisateur se reconnecte par code.
        await revoquerFamille(tx, famille, maintenant);
        return null;
      }
      if (ligne.utiliseLe === null) {
        await tx.update(jetonRenouvellement).set({ utiliseLe: maintenant }).where(eq(jetonRenouvellement.id, ligne.id));
      }

      // Jeton neuf de la même famille ; échéance glissante, plafonnée à 365 jours après la connexion.
      const connexionLe = ligne.connexionLe ?? ligne.creeLe;
      await tx.insert(jetonRenouvellement).values({
        id: ctx.nouvelId(),
        utilisateurId: ligne.utilisateurId,
        jetonHache: empreinteJeton(jetonNeuf),
        expireLe: new Date(Math.min(t + DUREE_RENOUVELLEMENT_MS, connexionLe.getTime() + DUREE_MAX_SESSION_MS)),
        creeLe: maintenant,
        familleId: famille,
        connexionLe,
      });
      return ligne.utilisateurId;
    });
    if (utilisateurId === null) return refuse();

    return c.json({
      jetonAcces: await emettreJetonAcces(ctx, utilisateurId, maintenant),
      jetonRenouvellement: jetonNeuf,
    });
  });

  // Déconnexion : sans jeton d'accès (il a pu expirer). Révoque toute la famille du jeton
  // présenté ; un jeton d'accès déjà émis reste valable jusqu'à son exp (1 h au plus).
  routes.post('/auth/deconnexion', async (c) => {
    const jeton = (await lireCorps(c))?.jetonRenouvellement;
    if (typeof jeton !== 'string' || jeton === '') return c.json({ erreur: 'requete_invalide' }, 400);

    const maintenant = ctx.maintenant();
    const [ligne] = await db
      .select({
        id: jetonRenouvellement.id,
        familleId: jetonRenouvellement.familleId,
        revoqueLe: jetonRenouvellement.revoqueLe,
        expireLe: jetonRenouvellement.expireLe,
      })
      .from(jetonRenouvellement)
      .where(eq(jetonRenouvellement.jetonHache, empreinteJeton(jeton)))
      .limit(1);
    // Inconnu, déjà révoqué ou expiré : même réponse, rien ne change (rejouer est sans risque).
    if (ligne?.revoqueLe === null && ligne.expireLe.getTime() > maintenant.getTime()) {
      await revoquerFamille(db, ligne.familleId ?? ligne.id, maintenant);
    }
    return c.body(null, 204);
  });

  return routes;
}
