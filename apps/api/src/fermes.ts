/**
 * Comptes et fermes (T09) : /moi, création de ferme, lecture, renommage, invitation.
 *
 * Isolement : pour une ferme dont l'utilisateur n'est pas membre actif, qui n'existe pas, ou
 * dont l'id n'est pas un UUID, toutes les routes /fermes/:id… répondent 404 ferme_introuvable
 * et n'écrivent rien. Le rôle est relu en base à chaque requête (roleDansLaFerme).
 */
import type { Id } from '@planif/core';
import { ferme, membre, roleDansLaFerme, utilisateur, type RoleMembre } from '@planif/db';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { garde, type VariablesAuthentifiees } from './auth/garde.ts';
import { estUuid } from './auth/jetons.ts';
import type { Contexte } from './dependances.ts';
import { lireCorps, normaliserEmail } from './http.ts';
import { libreSelonFenetre, secondesAvant } from './limites.ts';

const FUSEAU_PAR_DEFAUT = 'Europe/Paris';
const HEURE = 60 * 60_000;
/** Au plus 20 invitations par gérant et par heure glissante, toutes fermes confondues. */
export const INVITATIONS_PAR_HEURE = 20;

interface Env {
  Variables: VariablesAuthentifiees;
}

interface FermeVue {
  readonly id: string;
  readonly nom: string;
  readonly fuseauHoraire: string;
  readonly role: RoleMembre;
}

/**
 * Caractères de contrôle (\r, \n, \t, \u0000…) et de format (U+202E inversion de sens, espace
 * sans chasse…) : le nom de ferme finit dans le sujet des e-mails d'invitation et à l'écran, où
 * ils serviraient à injecter un en-tête ou à maquiller le nom. Refusés, même en bord de chaîne.
 */
const CARACTERE_INTERDIT = /[\p{Cc}\p{Cf}]/u;

function nomValide(v: unknown): string | null {
  if (typeof v !== 'string' || CARACTERE_INTERDIT.test(v)) return null;
  const nom = v.trim();
  return nom === '' || nom.length > 200 ? null : nom;
}

function fuseauValide(v: unknown): string | null {
  if (v === undefined) return FUSEAU_PAR_DEFAUT;
  if (typeof v !== 'string' || v === '') return null;
  try {
    new Intl.DateTimeFormat('fr', { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

const introuvable = (c: Context) => c.json({ erreur: 'ferme_introuvable' }, 404);
const requeteInvalide = (c: Context) => c.json({ erreur: 'requete_invalide' }, 400);

export function routesFermes(ctx: Contexte): Hono<Env> {
  const { db } = ctx;
  const routes = new Hono<Env>();
  routes.use('/moi', garde(ctx));
  routes.use('/fermes', garde(ctx));
  routes.use('/fermes/*', garde(ctx));

  /** Rôle de l'utilisateur dans la ferme `:id`, ou null (non membre, inexistante, id invalide). */
  async function roleDe(c: Context<Env>): Promise<{ fermeId: Id<'Ferme'>; role: RoleMembre } | null> {
    const id = c.req.param('id');
    if (!estUuid(id)) return null;
    const fermeId = id.toLowerCase() as Id<'Ferme'>;
    const role = await roleDansLaFerme(db, c.get('utilisateurId'), fermeId);
    return role === null ? null : { fermeId, role };
  }

  async function vueFerme(fermeId: Id<'Ferme'>, role: RoleMembre): Promise<FermeVue | null> {
    const [f] = await db
      .select({ id: ferme.id, nom: ferme.nom, fuseauHoraire: ferme.fuseauHoraire })
      .from(ferme)
      .where(eq(ferme.id, fermeId));
    return f === undefined ? null : { ...f, role };
  }

  routes.get('/moi', async (c) => {
    const id = c.get('utilisateurId');
    const [moi] = await db
      .select({ id: utilisateur.id, email: utilisateur.email })
      .from(utilisateur)
      .where(and(eq(utilisateur.id, id), isNull(utilisateur.supprimeLe)));
    if (moi === undefined) return c.json({ erreur: 'non_authentifie' }, 401);
    const fermes = await db
      .select({ id: ferme.id, nom: ferme.nom, role: membre.role })
      .from(membre)
      .innerJoin(ferme, eq(ferme.id, membre.fermeId))
      .where(
        and(
          eq(membre.utilisateurId, id),
          eq(membre.etat, 'accepte'),
          isNull(membre.supprimeLe),
          isNull(ferme.supprimeLe),
        ),
      )
      .orderBy(asc(ferme.nom), asc(ferme.id));
    return c.json({ ...moi, fermes });
  });

  routes.post('/fermes', async (c) => {
    const corps = await lireCorps(c);
    const nom = nomValide(corps?.nom);
    const fuseauHoraire = fuseauValide(corps?.fuseauHoraire);
    const idFourni = corps?.id;
    if (nom === null || fuseauHoraire === null || (idFourni !== undefined && !estUuid(idFourni))) {
      return requeteInvalide(c);
    }
    const id = (idFourni === undefined ? ctx.nouvelId<'Ferme'>() : idFourni.toLowerCase()) as Id<'Ferme'>;
    const maintenant = ctx.maintenant();
    const creee = await db.transaction(async (tx) => {
      const [f] = await tx
        .insert(ferme)
        .values({ id, nom, fuseauHoraire, creeLe: maintenant, modifieLe: maintenant })
        .onConflictDoNothing({ target: ferme.id })
        .returning({ id: ferme.id });
      if (f === undefined) return false;
      // Le créateur devient gérant.
      await tx.insert(membre).values({
        id: ctx.nouvelId(),
        utilisateurId: c.get('utilisateurId'),
        fermeId: id,
        role: 'gerant',
        creeLe: maintenant,
        modifieLe: maintenant,
      });
      return true;
    });
    if (!creee) return c.json({ erreur: 'ferme_existante' }, 409);
    return c.json({ id, nom, fuseauHoraire, role: 'gerant' } satisfies FermeVue, 201);
  });

  routes.get('/fermes/:id', async (c) => {
    const droit = await roleDe(c);
    if (droit === null) return introuvable(c);
    const vue = await vueFerme(droit.fermeId, droit.role);
    return vue === null ? introuvable(c) : c.json(vue);
  });

  routes.patch('/fermes/:id', async (c) => {
    const droit = await roleDe(c);
    if (droit === null) return introuvable(c);
    if (droit.role !== 'gerant') return c.json({ erreur: 'reserve_au_gerant' }, 403);
    const nom = nomValide((await lireCorps(c))?.nom);
    if (nom === null) return requeteInvalide(c);
    await db.update(ferme).set({ nom, modifieLe: ctx.maintenant() }).where(eq(ferme.id, droit.fermeId));
    const vue = await vueFerme(droit.fermeId, droit.role);
    return vue === null ? introuvable(c) : c.json(vue);
  });

  // Invitation d'un équipier par le gérant.
  routes.post('/fermes/:id/membres', async (c) => {
    const droit = await roleDe(c);
    if (droit === null) return introuvable(c);
    if (droit.role !== 'gerant') return c.json({ erreur: 'reserve_au_gerant' }, 403);
    const email = normaliserEmail((await lireCorps(c))?.email);
    if (email === null) return c.json({ erreur: 'email_invalide' }, 400);

    const maintenant = ctx.maintenant();
    const t = maintenant.getTime();
    const gerantId = c.get('utilisateurId');
    const { fermeId } = droit;
    const resultat = await db.transaction(async (tx) => {
      // Limite par gérant, sérialisée : elle ne se contourne pas en parallèle.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invitation:${gerantId}`}))`);
      const recentes = (
        await tx
          .select({ inviteLe: membre.inviteLe })
          .from(membre)
          .where(and(eq(membre.invitePar, gerantId), gt(membre.inviteLe, new Date(t - HEURE))))
          .orderBy(asc(membre.inviteLe))
      ).flatMap((l) => (l.inviteLe === null ? [] : [l.inviteLe.getTime()]));
      const libreA = libreSelonFenetre(recentes, INVITATIONS_PAR_HEURE, HEURE, t);
      if (libreA > t) return { refus: true as const, apresS: secondesAvant(libreA, t) };

      await tx
        .insert(utilisateur)
        .values({ id: ctx.nouvelId<'Utilisateur'>(), email, creeLe: maintenant, modifieLe: maintenant })
        .onConflictDoNothing({ target: utilisateur.email });
      const [invite] = await tx.select({ id: utilisateur.id }).from(utilisateur).where(eq(utilisateur.email, email));
      if (invite === undefined) throw new Error('utilisateur invité introuvable après insertion');
      const [existant] = await tx
        .select({ id: membre.id, role: membre.role, supprimeLe: membre.supprimeLe })
        .from(membre)
        .where(and(eq(membre.utilisateurId, invite.id), eq(membre.fermeId, fermeId)))
        .for('update');
      if (existant?.supprimeLe === null) {
        return { refus: false as const, role: existant.role, nouveau: false };
      }
      // Invité, pas encore membre actif : il le devient à sa prochaine connexion réussie.
      const invitation = { etat: 'invite', invitePar: gerantId, inviteLe: maintenant } as const;
      if (existant === undefined) {
        await tx.insert(membre).values({
          id: ctx.nouvelId(),
          utilisateurId: invite.id,
          fermeId,
          role: 'equipier',
          ...invitation,
          creeLe: maintenant,
          modifieLe: maintenant,
        });
      } else {
        // Membre retiré puis réinvité : il revient en équipier, invité.
        await tx
          .update(membre)
          .set({ role: 'equipier', ...invitation, supprimeLe: null, modifieLe: maintenant })
          .where(eq(membre.id, existant.id));
      }
      return { refus: false as const, role: 'equipier' as const, nouveau: true };
    });
    if (resultat.refus) {
      c.header('retry-after', String(resultat.apresS));
      return c.json({ erreur: 'trop_de_demandes' }, 429);
    }

    // Ni identifiant ni autre indice : la réponse ne dit pas si le compte existait.
    const reponse = { email, role: resultat.role };
    if (!resultat.nouveau) return c.json(reponse, 200);

    const vue = await vueFerme(fermeId, droit.role);
    const nomFerme = vue?.nom ?? 'une ferme';
    await ctx.expediteur.envoyer({
      a: email,
      sujet: `Invitation : ${nomFerme}`,
      texte:
        `Vous êtes invité à rejoindre « ${nomFerme} » sur Planifications.\n\n` +
        `Ouvrez l'appli et saisissez cette adresse : vous recevrez un code de connexion.`,
    });
    return c.json(reponse, 201);
  });

  return routes;
}
