/**
 * Écritures de « Ma ferme » (T49) : saisons, zones, planches, toutes par la porte. Une saisie =
 * UNE transaction locale (`porte.ecrireEnsemble`), donc un envoi, accepté ou refusé en entier ;
 * hors ligne compris. Ce que le serveur refuserait (apps/api/src/sync/structure.ts, T10s) est
 * refusé ici, avant d'écrire, avec un message clair : règles de ligne (./regles.ts), code unique
 * dans sa zone (Q27) et ce qui retient une suppression, revérifiés DANS la transaction
 * (`verifier`), sûrs même entre deux onglets.
 *
 * Jamais de DELETE ni d'écriture dans `modification` (le serveur l'écrit) : une suppression pose
 * `supprime_le`. Chaque écriture rend de quoi l'annuler (bandeau « Annuler ») : une création se
 * défait par une suppression douce, une modification ou une suppression en remettant les valeurs
 * d'avant, en une transaction, avec les mêmes vérifications.
 */
import { creerGenerateurId } from '@planif/core';
import type { OrdreEcriture, PorteDonnees, VerificationEcriture } from '@planif/sync';
import { ordreInsertion } from '@planif/sync/import';
import { cleCode, type EmplacementVerifie, type LotVerifie, type SaisieSaison, type SaisieZone } from './regles.ts';

/** Écriture refusée avant l'envoi (règle du serveur), avec un message clair. */
export class EcritureRefusee extends Error {}

export interface ContexteParcellaire {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant: () => Date;
  /** Jour du téléphone, 'AAAA-MM-JJ'. */
  readonly aujourdhui: string;
}

/** Ce qu'une écriture a fait, et comment la défaire. */
export interface Enregistrement {
  readonly texte: string;
  readonly annuler: () => Promise<void>;
}

type Table = 'saison' | 'zone' | 'emplacement';
type Valeur = string | number | null;
type Ligne = Readonly<Record<string, Valeur>>;
type Lire = Parameters<VerificationEcriture>[0];

const COLONNES: Readonly<Record<Table, readonly string[]>> = {
  saison: ['id', 'ferme_id', 'nom', 'debut', 'fin', 'cree_le', 'modifie_le', 'supprime_le'],
  zone: ['id', 'ferme_id', 'nom', 'zone_parente_id', 'type_abri', 'surface_m2', 'contour', 'cree_le', 'modifie_le', 'supprime_le'],
  emplacement: [
    'id',
    'ferme_id',
    'zone_id',
    'code',
    'sorte',
    'longueur_m',
    'largeur_m',
    'nombre_places',
    'actif_du',
    'actif_au',
    'remplace',
    'placement_x_m',
    'placement_y_m',
    'orientation_deg',
    'cree_le',
    'modifie_le',
    'supprime_le',
  ],
};

/** Un générateur par horloge : des identifiants croissants d'un geste à l'autre (ordre de création gardé). */
const generateurs = new WeakMap<() => Date, () => string>();
function nouvelId(ctx: ContexteParcellaire): () => string {
  let g = generateurs.get(ctx.maintenant);
  if (g === undefined) {
    const generer = creerGenerateurId({ horloge: () => ctx.maintenant().getTime(), aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
    g = () => generer<'Zone'>();
    generateurs.set(ctx.maintenant, g);
  }
  return g;
}

const pluriel = (n: number, un: string, plusieurs: string) => `${String(n)} ${n > 1 ? plusieurs : un}`;

function enumerer(parties: readonly string[]): string {
  if (parties.length <= 1) return parties.join('');
  return `${parties.slice(0, -1).join(', ')} et ${parties[parties.length - 1] ?? ''}`;
}

async function compter(lire: Lire, sql: string, p: readonly unknown[]): Promise<number> {
  const l = await lire<{ n: unknown }>(sql, p);
  return Number(l[0]?.n ?? 0);
}

async function lireLigne(ctx: ContexteParcellaire, table: Table, id: string): Promise<Ligne> {
  const l = await ctx.porte.lire<Ligne>(`SELECT * FROM ${table} WHERE id = ? AND ferme_id = ?`, [id, ctx.fermeId]);
  const ligne = l[0];
  if (ligne === undefined) throw new EcritureRefusee('cette ligne n’existe plus sur ce téléphone');
  return ligne;
}

function miseAJour(table: Table, id: string, valeurs: Readonly<Record<string, Valeur>>, iso: string): OrdreEcriture {
  const cles = Object.keys(valeurs);
  return { sql: `UPDATE ${table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, parametres: [...cles.map((c) => valeurs[c] ?? null), iso, id] };
}

/** Colonnes de `valeurs` qui changent par rapport à `avant`. */
function changees(avant: Ligne, valeurs: Readonly<Record<string, Valeur>>): Record<string, Valeur> {
  const r: Record<string, Valeur> = {};
  for (const [c, v] of Object.entries(valeurs)) if ((avant[c] ?? null) !== v) r[c] = v;
  return r;
}

// ── Vérifications dans la transaction ────────────────────────────────────────────────────────

/** Les codes `codes` sont libres dans la zone (emplacements non supprimés, en service), hors `sauf`. */
async function verifierCodesLibres(lire: Lire, fermeId: string, zoneId: string, codes: readonly string[], sauf: readonly string[]): Promise<void> {
  const pris = await lire<{ id: string; code: string }>(
    'SELECT id, code FROM emplacement WHERE ferme_id = ? AND zone_id = ? AND supprime_le IS NULL AND actif_au IS NULL',
    [fermeId, zoneId],
  );
  const cles = new Set(pris.filter((p) => !sauf.includes(p.id)).map((p) => cleCode(p.code)));
  const double = codes.find((c) => cles.has(cleCode(c)));
  if (double !== undefined) throw new EcritureRefusee(`le code « ${double.trim()} » existe déjà dans cette zone`);
}

/** Ce qui retient une saison (règle du serveur) : séries prévues ou en cours, assolements actifs. */
async function verifierSaisonLibre(lire: Lire, fermeId: string, id: string): Promise<void> {
  const series = await compter(lire, `SELECT COUNT(*) AS n FROM serie WHERE ferme_id = ? AND saison_id = ? AND supprime_le IS NULL AND statut IN ('prevue', 'en_cours')`, [fermeId, id]);
  const assolements = await compter(lire, 'SELECT COUNT(*) AS n FROM assolement WHERE ferme_id = ? AND saison_id = ? AND supprime_le IS NULL', [fermeId, id]);
  const parties = [...(series > 0 ? [pluriel(series, 'série', 'séries')] : []), ...(assolements > 0 ? [pluriel(assolements, 'assolement', 'assolements')] : [])];
  if (parties.length > 0) throw new EcritureRefusee(`cette saison a encore ${enumerer(parties)} : supprimez-les ou changez-les de saison d’abord`);
}

/** Ce qui retient une zone : planches, sous-zones, bâtiment qui l'abrite, assolements d'une saison pas terminée. */
async function verifierZoneVide(lire: Lire, fermeId: string, id: string, aujourdhui: string): Promise<void> {
  const planches = await compter(lire, 'SELECT COUNT(*) AS n FROM emplacement WHERE ferme_id = ? AND zone_id = ? AND supprime_le IS NULL', [fermeId, id]);
  const sousZones = await compter(lire, 'SELECT COUNT(*) AS n FROM zone WHERE ferme_id = ? AND zone_parente_id = ? AND supprime_le IS NULL', [fermeId, id]);
  const batiments = await compter(lire, 'SELECT COUNT(*) AS n FROM batiment WHERE ferme_id = ? AND zone_id = ? AND supprime_le IS NULL', [fermeId, id]);
  const assolements = await compter(
    lire,
    'SELECT COUNT(*) AS n FROM assolement a JOIN saison s ON s.id = a.saison_id WHERE a.ferme_id = ? AND a.zone_id = ? AND a.supprime_le IS NULL AND s.fin >= ?',
    [fermeId, id, aujourdhui],
  );
  const parties = [
    ...(planches > 0 ? [pluriel(planches, 'planche', 'planches')] : []),
    ...(sousZones > 0 ? [pluriel(sousZones, 'sous-zone', 'sous-zones')] : []),
    ...(batiments > 0 ? [pluriel(batiments, 'bâtiment', 'bâtiments')] : []),
    ...(assolements > 0 ? [pluriel(assolements, 'assolement', 'assolements')] : []),
  ];
  if (parties.length > 0) throw new EcritureRefusee(`cette zone a encore ${enumerer(parties)} : videz-la d’abord`);
}

/** Ce qui retient une planche : une série prévue ou en cours, ou une plantation en place, qui l'occupe. */
async function verifierEmplacementLibre(lire: Lire, fermeId: string, ids: readonly string[], aujourdhui: string): Promise<void> {
  if (ids.length === 0) return;
  const marques = ids.map(() => '?').join(', ');
  const n = await compter(
    lire,
    `SELECT COUNT(*) AS n FROM occupation o
       LEFT JOIN serie s ON s.id = o.serie_id
       LEFT JOIN plantation p ON p.id = o.plantation_id
     WHERE o.ferme_id = ? AND o.emplacement_id IN (${marques}) AND o.supprime_le IS NULL
       AND ((s.id IS NOT NULL AND s.supprime_le IS NULL AND s.statut IN ('prevue', 'en_cours'))
         OR (p.id IS NOT NULL AND p.supprime_le IS NULL AND (p.date_arrachage IS NULL OR p.date_arrachage > ?)))`,
    [fermeId, ...ids, aujourdhui],
  );
  if (n > 0) throw new EcritureRefusee(`${ids.length > 1 ? 'ces planches portent' : 'cette planche porte'} encore ${pluriel(n, 'culture', 'cultures')} : déplacez ou supprimez la série d’abord`);
}

/** La zone `id` existe, non supprimée, dans la ferme. */
async function verifierZoneActive(lire: Lire, fermeId: string, id: string): Promise<void> {
  if ((await compter(lire, 'SELECT COUNT(*) AS n FROM zone WHERE id = ? AND ferme_id = ? AND supprime_le IS NULL', [id, fermeId])) === 0) {
    throw new EcritureRefusee('cette zone a été supprimée entre-temps');
  }
}

/** Zone parente : active, et ni la zone elle-même ni l'une de ses sous-zones (pas de boucle). */
async function verifierParente(lire: Lire, fermeId: string, zoneId: string, parenteId: string | null): Promise<void> {
  if (parenteId === null) return;
  await verifierZoneActive(lire, fermeId, parenteId);
  const zones = await lire<{ id: string; zone_parente_id: string | null }>('SELECT id, zone_parente_id FROM zone WHERE ferme_id = ?', [fermeId]);
  const parente = new Map(zones.map((z) => [z.id, z.zone_parente_id]));
  let courante: string | null = parenteId;
  for (let k = 0; courante !== null && k <= zones.length; k++) {
    if (courante === zoneId) throw new EcritureRefusee('une zone ne peut pas être rangée dans elle-même ni dans l’une de ses sous-zones');
    courante = parente.get(courante) ?? null;
  }
}

/**
 * Écrit `ordres` si `verifier` passe : vérifié d'abord sur la base telle qu'elle est (un refus
 * n'ouvre aucune transaction), puis de nouveau DANS la transaction (deux onglets, la synchro).
 */
async function ecrireVerifie(ctx: ContexteParcellaire, ordres: readonly OrdreEcriture[], verifier: VerificationEcriture): Promise<void> {
  await verifier((sql, p) => ctx.porte.lire(sql, p));
  await ctx.porte.ecrireEnsemble(ordres, verifier);
}

// ── Défaire ──────────────────────────────────────────────────────────────────────────────────

/** Remet les colonnes `avant` de la ligne (une transaction), après `verifier`. */
function remettre(ctx: ContexteParcellaire, table: Table, id: string, avant: Readonly<Record<string, Valeur>>, verifier?: VerificationEcriture): () => Promise<void> {
  return async () => {
    if (Object.keys(avant).length === 0) return;
    const ordres = [miseAJour(table, id, avant, ctx.maintenant().toISOString())];
    await (verifier === undefined ? ctx.porte.ecrireEnsemble(ordres) : ecrireVerifie(ctx, ordres, verifier));
  };
}

/** Défait une création : suppression douce des lignes `ids` (une transaction), après `verifier`. */
function supprimerCreees(ctx: ContexteParcellaire, table: Table, ids: readonly string[], verifier?: VerificationEcriture): () => Promise<void> {
  return async () => {
    const iso = ctx.maintenant().toISOString();
    const ordres = ids.map((id) => miseAJour(table, id, { supprime_le: iso }, iso));
    await (verifier === undefined ? ctx.porte.ecrireEnsemble(ordres) : ecrireVerifie(ctx, ordres, verifier));
  };
}

// ── Saisons ──────────────────────────────────────────────────────────────────────────────────

export async function creerSaison(ctx: ContexteParcellaire, s: SaisieSaison): Promise<Enregistrement> {
  const iso = ctx.maintenant().toISOString();
  const id = nouvelId(ctx)();
  await ctx.porte.ecrireEnsemble([
    ordreInsertion('saison', COLONNES.saison, { id, ferme_id: ctx.fermeId, nom: s.nom, debut: s.debut, fin: s.fin, cree_le: iso, modifie_le: iso, supprime_le: null }),
  ]);
  return { texte: `Saison ${s.nom} créée`, annuler: supprimerCreees(ctx, 'saison', [id], (lire) => verifierSaisonLibre(lire, ctx.fermeId, id)) };
}

export async function modifierSaison(ctx: ContexteParcellaire, id: string, s: SaisieSaison): Promise<Enregistrement | null> {
  const avant = await lireLigne(ctx, 'saison', id);
  const valeurs = changees(avant, { nom: s.nom, debut: s.debut, fin: s.fin });
  if (Object.keys(valeurs).length === 0) return null;
  await ctx.porte.ecrireEnsemble([miseAJour('saison', id, valeurs, ctx.maintenant().toISOString())]);
  const anciennes = Object.fromEntries(Object.keys(valeurs).map((c) => [c, avant[c] ?? null]));
  return { texte: `Saison ${s.nom} modifiée`, annuler: remettre(ctx, 'saison', id, anciennes) };
}

export async function supprimerSaison(ctx: ContexteParcellaire, id: string): Promise<Enregistrement> {
  const avant = await lireLigne(ctx, 'saison', id);
  const iso = ctx.maintenant().toISOString();
  const verifier: VerificationEcriture = (lire) => verifierSaisonLibre(lire, ctx.fermeId, id);
  await ecrireVerifie(ctx, [miseAJour('saison', id, { supprime_le: iso }, iso)], verifier);
  return { texte: `Saison ${String(avant.nom)} supprimée`, annuler: remettre(ctx, 'saison', id, { supprime_le: null }) };
}

// ── Zones ────────────────────────────────────────────────────────────────────────────────────

export async function creerZone(ctx: ContexteParcellaire, z: SaisieZone): Promise<Enregistrement & { readonly id: string }> {
  const iso = ctx.maintenant().toISOString();
  const id = nouvelId(ctx)();
  await ecrireVerifie(
    ctx,
    [
      ordreInsertion('zone', COLONNES.zone, {
        id,
        ferme_id: ctx.fermeId,
        nom: z.nom,
        zone_parente_id: z.parenteId,
        type_abri: z.typeAbri,
        surface_m2: null,
        contour: null,
        cree_le: iso,
        modifie_le: iso,
        supprime_le: null,
      }),
    ],
    (lire) => verifierParente(lire, ctx.fermeId, id, z.parenteId),
  );
  return { id, texte: `Zone ${z.nom} créée`, annuler: supprimerCreees(ctx, 'zone', [id], (lire) => verifierZoneVide(lire, ctx.fermeId, id, ctx.aujourdhui)) };
}

export async function modifierZone(ctx: ContexteParcellaire, id: string, z: SaisieZone): Promise<Enregistrement | null> {
  const avant = await lireLigne(ctx, 'zone', id);
  const valeurs = changees(avant, { nom: z.nom, type_abri: z.typeAbri, zone_parente_id: z.parenteId });
  if (Object.keys(valeurs).length === 0) return null;
  await ecrireVerifie(ctx, [miseAJour('zone', id, valeurs, ctx.maintenant().toISOString())], (lire) => verifierParente(lire, ctx.fermeId, id, z.parenteId));
  const anciennes = Object.fromEntries(Object.keys(valeurs).map((c) => [c, avant[c] ?? null]));
  const parente = typeof avant.zone_parente_id === 'string' ? avant.zone_parente_id : null;
  return { texte: `Zone ${z.nom} modifiée`, annuler: remettre(ctx, 'zone', id, anciennes, (lire) => verifierParente(lire, ctx.fermeId, id, parente)) };
}

export async function supprimerZone(ctx: ContexteParcellaire, id: string): Promise<Enregistrement> {
  const avant = await lireLigne(ctx, 'zone', id);
  const iso = ctx.maintenant().toISOString();
  await ecrireVerifie(ctx, [miseAJour('zone', id, { supprime_le: iso }, iso)], (lire) => verifierZoneVide(lire, ctx.fermeId, id, ctx.aujourdhui));
  const parente = typeof avant.zone_parente_id === 'string' ? avant.zone_parente_id : null;
  return { texte: `Zone ${String(avant.nom)} supprimée`, annuler: remettre(ctx, 'zone', id, { supprime_le: null }, (lire) => verifierParente(lire, ctx.fermeId, id, parente)) };
}

// ── Planches ─────────────────────────────────────────────────────────────────────────────────

/**
 * En service depuis : le début de la plus ancienne saison de la ferme, ou le 1er janvier de
 * l'année (une planche ajoutée en octobre sert aussi au plan de la saison commencée en janvier).
 */
async function actifDepuis(ctx: ContexteParcellaire): Promise<string> {
  const janvier = `${ctx.aujourdhui.slice(0, 4)}-01-01`;
  const l = await ctx.porte.lire<{ debut: string | null }>('SELECT MIN(debut) AS debut FROM saison WHERE ferme_id = ? AND supprime_le IS NULL', [ctx.fermeId]);
  const debut = l[0]?.debut ?? null;
  return debut !== null && debut < janvier && debut >= '1900-01-01' ? debut : janvier;
}

/** « Ajouter des planches » : le lot en UNE transaction ; les codes sont revérifiés dans la transaction. */
export async function ajouterPlanches(ctx: ContexteParcellaire, zoneId: string, lot: LotVerifie): Promise<Enregistrement> {
  const iso = ctx.maintenant().toISOString();
  const generer = nouvelId(ctx);
  const du = await actifDepuis(ctx);
  const ids = lot.codes.map(() => generer());
  const ordres = lot.codes.map((code, i) =>
    ordreInsertion('emplacement', COLONNES.emplacement, {
      id: ids[i] ?? null,
      ferme_id: ctx.fermeId,
      zone_id: zoneId,
      code,
      sorte: 'planche',
      longueur_m: lot.longueurM,
      largeur_m: lot.largeurM,
      nombre_places: null,
      actif_du: du,
      actif_au: null,
      remplace: '[]',
      placement_x_m: null,
      placement_y_m: null,
      orientation_deg: null,
      cree_le: iso,
      modifie_le: iso,
      supprime_le: null,
    }),
  );
  await ecrireVerifie(ctx, ordres, async (lire) => {
    await verifierZoneActive(lire, ctx.fermeId, zoneId);
    await verifierCodesLibres(lire, ctx.fermeId, zoneId, lot.codes, []);
  });
  const premier = lot.codes[0] ?? '';
  const dernier = lot.codes[lot.codes.length - 1] ?? '';
  return {
    texte: lot.codes.length === 1 ? `Planche ${premier} ajoutée` : `${String(lot.codes.length)} planches ajoutées, ${premier} à ${dernier}`,
    annuler: supprimerCreees(ctx, 'emplacement', ids, (lire) => verifierEmplacementLibre(lire, ctx.fermeId, ids, ctx.aujourdhui)),
  };
}

/** Vérifie, dans la transaction, que le code de la ligne une fois écrite est libre dans sa zone (si elle est en service). */
function codeLibreApres(ctx: ContexteParcellaire, avant: Ligne, valeurs: Readonly<Record<string, Valeur>>): VerificationEcriture {
  const apres = { ...avant, ...valeurs };
  // Comme le serveur : seul un changement de code, une remise en service ou un rétablissement revérifie le code.
  const touche = ['code', 'actif_au', 'supprime_le'].some((c) => c in valeurs);
  return async (lire) => {
    if (!touche || apres.supprime_le !== null || apres.actif_au !== null) return;
    await verifierCodesLibres(lire, ctx.fermeId, String(apres.zone_id), [String(apres.code)], [String(avant.id)]);
  };
}

export async function modifierEmplacement(ctx: ContexteParcellaire, id: string, e: EmplacementVerifie): Promise<Enregistrement | null> {
  const avant = await lireLigne(ctx, 'emplacement', id);
  const valeurs = changees(avant, { code: e.code, sorte: e.sorte, longueur_m: e.longueurM, largeur_m: e.largeurM, nombre_places: e.nombrePlaces });
  if (Object.keys(valeurs).length === 0) return null;
  await ecrireVerifie(ctx, [miseAJour('emplacement', id, valeurs, ctx.maintenant().toISOString())], codeLibreApres(ctx, avant, valeurs));
  const anciennes = Object.fromEntries(Object.keys(valeurs).map((c) => [c, avant[c] ?? null]));
  return { texte: `${e.code} modifiée`, annuler: remettre(ctx, 'emplacement', id, anciennes, codeLibreApres(ctx, { ...avant, ...valeurs }, anciennes)) };
}

/** Mise hors service (aujourd'hui, ou son premier jour s'il est à venir) ou remise en service. */
export async function changerService(ctx: ContexteParcellaire, id: string, enService: boolean): Promise<Enregistrement | null> {
  const avant = await lireLigne(ctx, 'emplacement', id);
  const du = String(avant.actif_du ?? ctx.aujourdhui);
  const valeurs = changees(avant, { actif_au: enService ? null : du > ctx.aujourdhui ? du : ctx.aujourdhui });
  if (Object.keys(valeurs).length === 0) return null;
  await ecrireVerifie(ctx, [miseAJour('emplacement', id, valeurs, ctx.maintenant().toISOString())], codeLibreApres(ctx, avant, valeurs));
  const code = String(avant.code);
  return {
    texte: enService ? `${code} remise en service` : `${code} hors service`,
    annuler: remettre(ctx, 'emplacement', id, { actif_au: avant.actif_au ?? null }, codeLibreApres(ctx, { ...avant, ...valeurs }, { actif_au: avant.actif_au ?? null })),
  };
}

export async function supprimerEmplacement(ctx: ContexteParcellaire, id: string): Promise<Enregistrement> {
  const avant = await lireLigne(ctx, 'emplacement', id);
  const iso = ctx.maintenant().toISOString();
  await ecrireVerifie(ctx, [miseAJour('emplacement', id, { supprime_le: iso }, iso)], (lire) => verifierEmplacementLibre(lire, ctx.fermeId, [id], ctx.aujourdhui));
  const zone = String(avant.zone_id);
  return {
    texte: `${String(avant.code)} supprimée`,
    annuler: remettre(ctx, 'emplacement', id, { supprime_le: null }, async (lire) => {
      await verifierZoneActive(lire, ctx.fermeId, zone);
      await codeLibreApres(ctx, { ...avant, supprime_le: iso }, { supprime_le: null })(lire);
    }),
  };
}
