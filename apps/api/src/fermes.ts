/**
 * Comptes et fermes (T09) : /moi, création de ferme, lecture, renommage, invitation.
 *
 * Isolement : pour une ferme dont l'utilisateur n'est pas membre actif, qui n'existe pas, ou
 * dont l'id n'est pas un UUID, toutes les routes /fermes/:id… répondent 404 ferme_introuvable
 * et n'écrivent rien. Le rôle est relu en base à chaque requête (roleDansLaFerme).
 */
import type { Id } from '@planif/core';
import { ferme, membre, roleDansLaFerme, utilisateur, type RoleMembre } from '@planif/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { garde, type VariablesAuthentifiees } from './auth/garde.ts';
import { estUuid } from './auth/jetons.ts';
import type { Contexte } from './dependances.ts';
import { lireCorps, normaliserEmail } from './http.ts';

const FUSEAU_PAR_DEFAUT = 'Europe/Paris';

interface Env {
  Variables: VariablesAuthentifiees;
}

interface FermeVue {
  readonly id: string;
  readonly nom: string;
  readonly fuseauHoraire: string;
  readonly role: RoleMembre;
}

function nomValide(v: unknown): string | null {
  if (typeof v !== 'string') return null;
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
      .where(and(eq(membre.utilisateurId, id), isNull(membre.supprimeLe), isNull(ferme.supprimeLe)))
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
    const { fermeId } = droit;
    const resultat = await db.transaction(async (tx) => {
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
        return { utilisateurId: invite.id, role: existant.role, nouveau: false };
      }
      if (existant === undefined) {
        await tx.insert(membre).values({
          id: ctx.nouvelId(),
          utilisateurId: invite.id,
          fermeId,
          role: 'equipier',
          creeLe: maintenant,
          modifieLe: maintenant,
        });
      } else {
        // Membre retiré puis réinvité : il revient en équipier.
        await tx
          .update(membre)
          .set({ role: 'equipier', supprimeLe: null, modifieLe: maintenant })
          .where(eq(membre.id, existant.id));
      }
      return { utilisateurId: invite.id, role: 'equipier' as const, nouveau: true };
    });

    const reponse = { utilisateurId: resultat.utilisateurId, email, role: resultat.role };
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
