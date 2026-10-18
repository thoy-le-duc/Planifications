/**
 * Bibliothèque commune de départ (T41, Q43) : familles, espèces et itinéraires de
 * `packages/db/bibliotheque/depart.json` (sources publiques citées, valeurs « à vérifier » que
 * chaque ferme adapte), convertis vers les lignes de la base à `ferme_id` nul.
 *
 * La migration de données `0032_bibliotheque_depart` est figée (T41b) : son texte est celui de
 * `sqlBibliotheque` appliqué à son état, `bibliotheque/etats/0032_bibliotheque_depart.json`, et
 * ne change plus jamais. Toute correction du JSON passe par une NOUVELLE migration de
 * bibliothèque, écrite par `pnpm --filter @planif/db bibliotheque <NNNN_nom>` : les
 * `INSERT … ON CONFLICT (id) DO UPDATE` des lignes changées (`ferme_id` nul seulement), le
 * marquage `supprime_le` des lignes retirées, et l'état qui suit (`sqlMiseAJourBibliotheque`,
 * `preparerMigrationBibliotheque`). `verifierBibliotheque` (tests) exige que le JSON courant
 * soit égal au dernier état. Les sources et la note « à vérifier » restent dans le JSON du
 * dépôt, pas en base.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type {
  CategorieEspece,
  DensiteEcartement,
  Densite,
  ModeItineraire,
  ParametresItineraire,
  RendementAttendu,
  TypeAbri,
  UniteRecolte,
} from '@planif/core';

/** Tag (drizzle-kit) de la migration qui insère la bibliothèque de départ. */
export const MIGRATION_BIBLIOTHEQUE_DEPART = '0032_bibliotheque_depart';

/** Chemin du JSON du dépôt. */
export const FICHIER_BIBLIOTHEQUE_DEPART = new URL('../bibliotheque/depart.json', import.meta.url);

// ── Le JSON du dépôt ─────────────────────────────────────────────────────────────────────────

export interface SourceFamille {
  readonly nom: string;
  /** Nom sous lequel la famille est entrée dans la bibliothèque, si elle a été renommée depuis : l'identifiant en dérive. */
  readonly nomInitial?: string;
  readonly delaiRetourMinAnnees: number;
  readonly delaiRetourConseilleAnnees: number;
  readonly remarque?: string;
}

export interface SourceEspece {
  readonly nom: string;
  /** Nom sous lequel l'espèce est entrée dans la bibliothèque, si elle a été renommée depuis : l'identifiant en dérive. */
  readonly nomInitial?: string;
  readonly famille: string;
  readonly categorie: CategorieEspece;
  readonly uniteRecolte: UniteRecolte;
  /** Absent : annuelle. */
  readonly perenne?: boolean;
}

export type SourceDensite =
  | {
      readonly facon: 'ecartement';
      readonly rangsParPlanche: number;
      readonly ecartementCm: number;
      readonly disposition?: 'alignee' | 'quinconce';
    }
  | { readonly facon: 'metre_lineaire'; readonly rangsParPlanche: number; readonly grainesParMetre: number }
  | { readonly facon: 'volee'; readonly largeurSemeeCm: number; readonly doseGParM2: number };

export interface SourceItineraire {
  readonly espece: string;
  readonly famille: string;
  readonly categorie: CategorieEspece;
  readonly nom: string;
  /** Nom sous lequel l'itinéraire est entré dans la bibliothèque, s'il a été renommé depuis : l'identifiant en dérive (T41b). */
  readonly nomInitial?: string;
  readonly mode: ModeItineraire;
  readonly typeAbri: TypeAbri | null;
  readonly periodeUsage: { readonly debutSemaine: number; readonly finSemaine: number } | null;
  readonly dureePepiniereJours: number | null;
  readonly alveolesParPlaque: number | null;
  readonly grainesParMotte: number | null;
  readonly plantsParMotte: number | null;
  readonly pertePepinierePct: number | null;
  readonly densite: SourceDensite;
  readonly grainesParPoquet: number | null;
  readonly dureeAvantRecolteJours: number;
  readonly fenetreRecolteJours: number;
  readonly margeSecuritePct: number;
  readonly rendementAttendu: { readonly par: 'metre' | 'plant'; readonly kg: number } | null;
  readonly sources: readonly { readonly titre: string; readonly url: string }[];
  readonly aVerifier: string;
}

export interface SourceBibliotheque {
  readonly meta: Readonly<Record<string, unknown>>;
  readonly familles: readonly SourceFamille[];
  readonly especes: readonly SourceEspece[];
  readonly itineraires: readonly SourceItineraire[];
}

/** Le JSON du dépôt, tel quel. */
export function lireBibliothequeDepart(): SourceBibliotheque {
  return JSON.parse(readFileSync(FICHIER_BIBLIOTHEQUE_DEPART, 'utf8')) as SourceBibliotheque;
}

// ── Lignes de la base ────────────────────────────────────────────────────────────────────────

export interface LigneFamilleBibliotheque {
  readonly id: string;
  readonly ferme_id: null;
  readonly nom: string;
  readonly delai_retour_minimal_ans: number;
  readonly delai_retour_conseille_ans: number;
}

export interface LigneEspeceBibliotheque {
  readonly id: string;
  readonly ferme_id: null;
  readonly famille_id: string;
  readonly nom: string;
  readonly categorie: CategorieEspece;
  readonly perenne: boolean;
  readonly unite_recolte: UniteRecolte;
  readonly delai_retour_minimal_ans: null;
  readonly delai_retour_conseille_ans: null;
  readonly profil_croissance: null;
}

export interface LigneItineraireBibliotheque {
  readonly id: string;
  readonly ferme_id: null;
  readonly espece_id: string;
  readonly variete_id: null;
  readonly nom: string;
  readonly mode: ModeItineraire;
  readonly parametres: ParametresItineraire;
}

export interface LignesBibliotheque {
  readonly familles: readonly LigneFamilleBibliotheque[];
  readonly especes: readonly LigneEspeceBibliotheque[];
  readonly itineraires: readonly LigneItineraireBibliotheque[];
}

/**
 * Identifiant fixe dérivé du nom : md5(`${sorte}:${cle}`) écrit en UUID, comme `md5(…)::uuid` de
 * Postgres (migration 0016). Le même sur toutes les bases : rejouer l'insertion n'ajoute rien.
 */
export function idBibliotheque(sorte: 'famille' | 'espece' | 'itineraire', cle: string): string {
  const h = createHash('md5').update(`${sorte}:${cle}`, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function obligatoire(v: number | null, champ: string, nom: string): number {
  if (v === null) throw new Error(`bibliothèque de départ : ${champ} manquant pour « ${nom} »`);
  return v;
}

/** Densité à l'écartement du cœur : la disposition n'est écrite qu'en quinconce sur plusieurs rangs (T35a, comme le formulaire). */
function ecartement(d: Extract<SourceDensite, { facon: 'ecartement' }>): DensiteEcartement {
  const base = { facon: 'ecartement', rangsParPlanche: d.rangsParPlanche, ecartementSurRangCm: d.ecartementCm } as const;
  return d.disposition === 'quinconce' && d.rangsParPlanche > 1 ? { ...base, disposition: 'quinconce' } : base;
}

function densite(d: SourceDensite): Densite {
  switch (d.facon) {
    case 'ecartement':
      return ecartement(d);
    case 'metre_lineaire':
      return { facon: 'metre_lineaire', rangsParPlanche: d.rangsParPlanche, grainesParMetre: d.grainesParMetre };
    case 'volee':
      return { facon: 'volee', largeurSemeeCm: d.largeurSemeeCm, doseGParM2: d.doseGParM2 };
  }
}

function densiteEcartement(d: SourceDensite, nom: string): DensiteEcartement {
  if (d.facon !== 'ecartement') throw new Error(`bibliothèque de départ : « ${nom} » (plant) doit être à l'écartement`);
  return ecartement(d);
}

function parametres(i: SourceItineraire): ParametresItineraire {
  const rendement: RendementAttendu | null = i.rendementAttendu === null ? null : { par: i.rendementAttendu.par, quantite: i.rendementAttendu.kg, unite: 'kg' };
  const communs = {
    periodeUsage: i.periodeUsage === null ? null : { semaineDebut: i.periodeUsage.debutSemaine, semaineFin: i.periodeUsage.finSemaine },
    typeAbri: i.typeAbri,
    dureeAvantRecolteJours: i.dureeAvantRecolteJours,
    fenetreRecolteJours: i.fenetreRecolteJours,
    margeSecurite: i.margeSecuritePct,
    rendementAttendu: rendement,
    perenne: null,
  };
  switch (i.mode) {
    case 'semis_direct': {
      const d = densite(i.densite);
      return { mode: 'semis_direct', ...communs, densite: d, grainesParPoquet: d.facon === 'ecartement' ? i.grainesParPoquet : null };
    }
    case 'plant_maison':
      return {
        mode: 'plant_maison',
        ...communs,
        densite: densiteEcartement(i.densite, i.nom),
        dureePepiniereJours: obligatoire(i.dureePepiniereJours, 'dureePepiniereJours', i.nom),
        grainesParMotte: obligatoire(i.grainesParMotte, 'grainesParMotte', i.nom),
        plantsParMotte: obligatoire(i.plantsParMotte, 'plantsParMotte', i.nom),
        pertePepiniere: obligatoire(i.pertePepinierePct, 'pertePepinierePct', i.nom),
        alveolesParPlaque: i.alveolesParPlaque,
      };
    case 'plant_achete':
      return { mode: 'plant_achete', ...communs, densite: densiteEcartement(i.densite, i.nom) };
  }
}

/**
 * Lignes de la base (snake_case, `ferme_id` nul), dans l'ordre du JSON. L'identifiant dérive du
 * nom initial (`nomInitial`) quand la ligne a été renommée : il ne change jamais.
 */
export function convertirBibliotheque(source: SourceBibliotheque): LignesBibliotheque {
  const idFamille = new Map(source.familles.map((f) => [f.nom, idBibliotheque('famille', f.nomInitial ?? f.nom)] as const));
  const cleEspece = new Map(source.especes.map((e) => [e.nom, e.nomInitial ?? e.nom] as const));
  const famille = (nom: string): string => idFamille.get(nom) ?? idBibliotheque('famille', nom);
  const espece = (nom: string): string => cleEspece.get(nom) ?? nom;
  return {
    familles: source.familles.map((f) => ({
      id: famille(f.nom),
      ferme_id: null,
      nom: f.nom,
      delai_retour_minimal_ans: f.delaiRetourMinAnnees,
      delai_retour_conseille_ans: f.delaiRetourConseilleAnnees,
    })),
    especes: source.especes.map((e) => ({
      id: idBibliotheque('espece', espece(e.nom)),
      ferme_id: null,
      famille_id: famille(e.famille),
      nom: e.nom,
      categorie: e.categorie,
      perenne: e.perenne ?? false,
      unite_recolte: e.uniteRecolte,
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      profil_croissance: null,
    })),
    itineraires: source.itineraires.map((i) => ({
      id: idBibliotheque('itineraire', `${espece(i.espece)}:${i.nomInitial ?? i.nom}`),
      ferme_id: null,
      espece_id: idBibliotheque('espece', espece(i.espece)),
      variete_id: null,
      nom: i.nom,
      mode: i.mode,
      parametres: parametres(i),
    })),
  };
}

// ── Texte de la migration ────────────────────────────────────────────────────────────────────

/** Littéral SQL : texte entre apostrophes doublées, nombre, booléen, NULL. */
function litteral(v: string | number | boolean | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`bibliothèque de départ : nombre invalide (${String(v)})`);
    return String(v);
  }
  return `'${v.replaceAll("'", "''")}'`;
}

function insertion(table: string, colonnes: readonly string[], lignes: readonly (readonly string[])[]): string {
  const valeurs = lignes.map((l) => `  (${l.join(', ')})`).join(',\n');
  return `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES\n${valeurs}\nON CONFLICT (id) DO NOTHING;`;
}

const ENTETE = `-- T41 : bibliothèque commune de départ (familles, espèces, itinéraires), ferme_id nul.
--
-- Généré depuis packages/db/bibliotheque/depart.json par \`pnpm --filter @planif/db bibliotheque\`
-- (packages/db/src/bibliotheque.ts) : ne pas modifier à la main, bibliotheque.test.ts vérifie
-- que ce texte est celui de la conversion du JSON. Valeurs usuelles tirées de sources publiques
-- citées dans le JSON, à vérifier et à adapter par chaque ferme (copie : « Adapter pour ma ferme »).
-- Identifiants fixes, md5 du nom : le même sur toutes les bases ; ON CONFLICT (id) DO NOTHING :
-- rejouer n'ajoute ni ne réécrit rien. Une mise à jour des valeurs passe par une nouvelle migration.
`;

/** Texte de la migration : un INSERT rejouable par table, familles, espèces puis itinéraires. */
export function sqlBibliotheque(lignes: LignesBibliotheque): string {
  const familles = insertion(
    'famille',
    ['id', 'ferme_id', 'nom', 'delai_retour_minimal_ans', 'delai_retour_conseille_ans'],
    lignes.familles.map((f) => [`${litteral(f.id)}::uuid`, 'NULL', litteral(f.nom), litteral(f.delai_retour_minimal_ans), litteral(f.delai_retour_conseille_ans)]),
  );
  const especes = insertion(
    'espece',
    ['id', 'ferme_id', 'famille_id', 'nom', 'categorie', 'perenne', 'unite_recolte'],
    lignes.especes.map((e) => [
      `${litteral(e.id)}::uuid`,
      'NULL',
      `${litteral(e.famille_id)}::uuid`,
      litteral(e.nom),
      litteral(e.categorie),
      litteral(e.perenne),
      litteral(e.unite_recolte),
    ]),
  );
  const itineraires = insertion(
    'itineraire',
    ['id', 'ferme_id', 'espece_id', 'variete_id', 'nom', 'mode', 'parametres'],
    lignes.itineraires.map((i) => [
      `${litteral(i.id)}::uuid`,
      'NULL',
      `${litteral(i.espece_id)}::uuid`,
      'NULL',
      litteral(i.nom),
      litteral(i.mode),
      `${litteral(JSON.stringify(i.parametres))}::jsonb`,
    ]),
  );
  return `${ENTETE}${[familles, especes, itineraires].join('\n--> statement-breakpoint\n')}\n`;
}

// ── Mise à jour par nouvelle migration (T41b) ──────────────────────────────────────────────

/** Dossier des états : un `<migration>.json` par migration de bibliothèque, les lignes actives après elle. */
export const DOSSIER_ETATS_BIBLIOTHEQUE = new URL('../bibliotheque/etats/', import.meta.url);

/** Dossier des migrations (relu ici pour ne pas dépendre de migrations.ts). */
const DOSSIER_MIGRATIONS_BIBLIOTHEQUE = new URL('../migrations/', import.meta.url);

/** Lignes actives de la bibliothèque après la migration `migration`. */
export interface EtatBibliotheque {
  readonly migration: string;
  readonly lignes: LignesBibliotheque;
}

export type TableBibliotheque = 'famille' | 'espece' | 'itineraire';

export interface ChangementBibliotheque {
  readonly table: TableBibliotheque;
  readonly id: string;
  readonly nom: string;
  readonly sorte: 'ajoutee' | 'modifiee' | 'retiree';
}

export interface EntreeJournalDrizzle {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

/** `migrations/meta/_journal.json` de drizzle-kit. */
export interface JournalDrizzle {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly EntreeJournalDrizzle[];
}

/** Ce que le dépôt contient pour la bibliothèque ; remplaçable dans les tests. */
export interface DepotBibliotheque {
  readonly journal: JournalDrizzle;
  /** Triés par migration. */
  readonly etats: readonly EtatBibliotheque[];
  /** Texte de `migrations/<migration>.sql`, null s'il n'existe pas. */
  readonly sqlDe: (migration: string) => string | null;
  /** Texte de `migrations/meta/<idx>_snapshot.json`, null s'il n'existe pas. */
  readonly instantaneDe: (idx: number) => string | null;
  /** Conversion du JSON courant. */
  readonly courant: LignesBibliotheque;
}

const TABLES: readonly TableBibliotheque[] = ['famille', 'espece', 'itineraire'];

type LigneBibliotheque = LigneFamilleBibliotheque | LigneEspeceBibliotheque | LigneItineraireBibliotheque;

function lignesDe(l: LignesBibliotheque, table: TableBibliotheque): readonly LigneBibliotheque[] {
  switch (table) {
    case 'famille':
      return l.familles;
    case 'espece':
      return l.especes;
    case 'itineraire':
      return l.itineraires;
  }
}

/** JSON aux clés triées : deux lignes égales ont le même texte, quel que soit l'ordre des clés. */
function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Texte d'un état (`bibliotheque/etats/<migration>.json`). */
export function texteEtatBibliotheque(migration: string, lignes: LignesBibliotheque): string {
  return `${JSON.stringify({ migration, familles: lignes.familles, especes: lignes.especes, itineraires: lignes.itineraires }, null, 2)}\n`;
}

/** Les états du dépôt, triés par migration. */
export function lireEtatsBibliotheque(): EtatBibliotheque[] {
  if (!existsSync(DOSSIER_ETATS_BIBLIOTHEQUE)) return [];
  return readdirSync(DOSSIER_ETATS_BIBLIOTHEQUE)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const e = JSON.parse(readFileSync(new URL(f, DOSSIER_ETATS_BIBLIOTHEQUE), 'utf8')) as { migration: string } & LignesBibliotheque;
      if (`${e.migration}.json` !== f) throw new Error(`bibliothèque : l'état ${f} annonce la migration ${e.migration}`);
      return { migration: e.migration, lignes: { familles: e.familles, especes: e.especes, itineraires: e.itineraires } };
    });
}

function lireSiPresent(url: URL): string | null {
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
}

/** Le journal, les états, les migrations et le JSON courant, lus dans le dépôt. */
export function depotBibliotheque(): DepotBibliotheque {
  return {
    journal: JSON.parse(readFileSync(new URL('meta/_journal.json', DOSSIER_MIGRATIONS_BIBLIOTHEQUE), 'utf8')) as JournalDrizzle,
    etats: lireEtatsBibliotheque(),
    sqlDe: (migration) => lireSiPresent(new URL(`${migration}.sql`, DOSSIER_MIGRATIONS_BIBLIOTHEQUE)),
    instantaneDe: (idx) => lireSiPresent(new URL(`meta/${String(idx).padStart(4, '0')}_snapshot.json`, DOSSIER_MIGRATIONS_BIBLIOTHEQUE)),
    courant: convertirBibliotheque(lireBibliothequeDepart()),
  };
}

/** Ce qui change de `avant` à `apres`, par identifiant : familles, espèces puis itinéraires. */
export function changementsBibliotheque(avant: LignesBibliotheque, apres: LignesBibliotheque): ChangementBibliotheque[] {
  const changements: ChangementBibliotheque[] = [];
  for (const table of TABLES) {
    const anciennes = new Map(lignesDe(avant, table).map((l) => [l.id, l] as const));
    const nouvelles = new Set<string>();
    for (const l of lignesDe(apres, table)) {
      nouvelles.add(l.id);
      const a = anciennes.get(l.id);
      if (a === undefined) changements.push({ table, id: l.id, nom: l.nom, sorte: 'ajoutee' });
      else if (canonique(a) !== canonique(l)) changements.push({ table, id: l.id, nom: l.nom, sorte: 'modifiee' });
    }
    for (const l of lignesDe(avant, table)) if (!nouvelles.has(l.id)) changements.push({ table, id: l.id, nom: l.nom, sorte: 'retiree' });
  }
  return changements;
}

const SORTES: Readonly<Record<ChangementBibliotheque['sorte'], string>> = { ajoutee: 'ajoutée', modifiee: 'modifiée', retiree: 'retirée' };

const decrire = (c: ChangementBibliotheque): string => `« ${c.nom} » (${c.table}) : ${SORTES[c.sorte]}`;

/** Colonnes écrites par table (hors `ferme_id`, toujours nul), dans l'ordre de l'INSERT. */
const COLONNES: Readonly<Record<TableBibliotheque, readonly string[]>> = {
  famille: ['nom', 'delai_retour_minimal_ans', 'delai_retour_conseille_ans'],
  espece: ['famille_id', 'nom', 'categorie', 'perenne', 'unite_recolte', 'delai_retour_minimal_ans', 'delai_retour_conseille_ans', 'profil_croissance'],
  itineraire: ['espece_id', 'variete_id', 'nom', 'mode', 'parametres'],
};

const UUID = new Set(['id', 'famille_id', 'espece_id', 'variete_id']);
const JSONB = new Set(['parametres', 'profil_croissance']);

function valeurSql(colonne: string, v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (JSONB.has(colonne)) return `${litteral(JSON.stringify(v))}::jsonb`;
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new Error(`bibliothèque : valeur invalide pour ${colonne}`);
  return UUID.has(colonne) ? `${litteral(v)}::uuid` : litteral(v);
}

/** INSERT … ON CONFLICT (id) DO UPDATE des lignes de la bibliothèque ; une ligne de ferme n'est jamais écrite, une ligne déjà juste n'est pas réécrite. */
function upsert(table: TableBibliotheque, lignes: readonly LigneBibliotheque[]): string {
  const colonnes = COLONNES[table];
  const champ = (l: object, c: string): unknown => (l as Readonly<Record<string, unknown>>)[c];
  const valeurs = lignes.map((l) => `  (${[valeurSql('id', l.id), 'NULL', ...colonnes.map((c) => valeurSql(c, champ(l, c)))].join(', ')})`).join(',\n');
  const set = [...colonnes.map((c) => `${c} = EXCLUDED.${c}`), 'supprime_le = NULL', 'modifie_le = now()'].join(', ');
  const ici = [...colonnes.map((c) => `${table}.${c}`), `${table}.supprime_le`].join(', ');
  const voulu = [...colonnes.map((c) => `EXCLUDED.${c}`), 'NULL::timestamptz'].join(', ');
  return (
    `INSERT INTO ${table} (${['id', 'ferme_id', ...colonnes].join(', ')}) VALUES\n${valeurs}\n` +
    `ON CONFLICT (id) DO UPDATE SET ${set}\n` +
    `WHERE ${table}.ferme_id IS NULL AND (${ici}) IS DISTINCT FROM (${voulu});`
  );
}

/** Marque supprimées (jamais effacées : des séries peuvent les référencer) des lignes de la bibliothèque. */
function retrait(table: TableBibliotheque, ids: readonly string[]): string {
  return `UPDATE ${table} SET supprime_le = now(), modifie_le = now() WHERE ferme_id IS NULL AND supprime_le IS NULL AND id IN (${ids.map((id) => valeurSql('id', id)).join(', ')});`;
}

/**
 * Texte d'une migration de bibliothèque qui mène de l'état `avant` à l'état `apres` ; null si rien
 * ne change. Rejouable sans effet ; n'écrit que des lignes à `ferme_id` nul ; jamais de DELETE.
 */
export function sqlMiseAJourBibliotheque(migration: string, avant: LignesBibliotheque, apres: LignesBibliotheque): string | null {
  const changements = changementsBibliotheque(avant, apres);
  if (changements.length === 0) return null;
  const instructions: string[] = [];
  for (const table of TABLES) {
    const ids = new Set(changements.filter((c) => c.table === table && c.sorte !== 'retiree').map((c) => c.id));
    const lignes = lignesDe(apres, table).filter((l) => ids.has(l.id));
    if (lignes.length > 0) instructions.push(upsert(table, lignes));
  }
  for (const table of [...TABLES].reverse()) {
    const ids = changements.filter((c) => c.table === table && c.sorte === 'retiree').map((c) => c.id);
    if (ids.length > 0) instructions.push(retrait(table, ids));
  }
  const entete = [
    `-- Mise à jour de la bibliothèque commune (ferme_id nul), migration ${migration} (procédure T41b).`,
    '--',
    `-- Généré depuis packages/db/bibliotheque/depart.json par \`pnpm --filter @planif/db bibliotheque ${migration}\``,
    '-- (packages/db/src/bibliotheque.ts) : ne pas modifier à la main, bibliotheque-suites.test.ts vérifie ce',
    "-- texte. INSERT … ON CONFLICT (id) DO UPDATE réservé aux lignes à ferme_id nul, qui ne réécrit pas une",
    '-- ligne déjà juste ; une ligne retirée du JSON est marquée supprimée (supprime_le), jamais effacée.',
    '-- Les copies faites par les fermes ne changent pas.',
    '--',
    '-- Changements :',
    ...changements.map((c) => `-- ${decrire(c)}`),
  ].join('\n');
  return `${entete}\n${instructions.join('\n--> statement-breakpoint\n')}\n`;
}

/**
 * Erreurs (vide = à jour) : 0032 figée et conforme à son état, chaque migration de bibliothèque
 * au journal et conforme à « état précédent → son état », et le JSON courant égal au dernier état.
 */
export function verifierBibliotheque(depot: DepotBibliotheque): string[] {
  const erreurs: string[] = [];
  const { etats } = depot;
  if (etats[0]?.migration !== MIGRATION_BIBLIOTHEQUE_DEPART) {
    erreurs.push(`bibliothèque : le premier état doit être bibliotheque/etats/${MIGRATION_BIBLIOTHEQUE_DEPART}.json`);
    return erreurs;
  }
  const tags = new Set(depot.journal.entries.map((e) => e.tag));
  etats.forEach((e, k) => {
    const m = e.migration;
    if (!tags.has(m)) erreurs.push(`bibliothèque : la migration ${m} (bibliotheque/etats/${m}.json) est absente du journal de drizzle (migrations/meta/_journal.json)`);
    const sql = depot.sqlDe(m);
    if (sql === null) {
      erreurs.push(`bibliothèque : le fichier migrations/${m}.sql est absent`);
      return;
    }
    const precedent = etats[k - 1];
    const attendu = precedent === undefined ? sqlBibliotheque(e.lignes) : sqlMiseAJourBibliotheque(m, precedent.lignes, e.lignes);
    if (attendu === null) erreurs.push(`bibliothèque : la migration ${m} ne change rien par rapport à ${precedent?.migration ?? ''} : retirer son état`);
    else if (sql !== attendu) {
      erreurs.push(
        precedent === undefined
          ? `bibliothèque : ${m} est figée, son SQL ne doit plus jamais changer ; une correction passe par une nouvelle migration`
          : `bibliothèque : le SQL de migrations/${m}.sql ne correspond pas à son état (bibliotheque/etats/${m}.json) ; s'il n'est pas encore fusionné, le réécrire avec \`pnpm --filter @planif/db bibliotheque ${m}\``,
      );
    }
  });
  const dernier = etats[etats.length - 1];
  if (dernier !== undefined) {
    const changements = changementsBibliotheque(dernier.lignes, depot.courant);
    if (changements.length > 0) {
      erreurs.push(
        `bibliothèque : depart.json a changé depuis la dernière migration de bibliothèque (${dernier.migration}) sans nouvelle migration : ` +
          `${changements.map(decrire).join(' ; ')}. Écrire la migration avec \`pnpm --filter @planif/db bibliotheque <NNNN_nom>\` ` +
          '(numéro suivant du journal) ; une migration fusionnée ne se réécrit jamais.',
      );
    }
  }
  return erreurs;
}

export interface FichierBibliotheque {
  /** Relatif à packages/db. */
  readonly chemin: string;
  readonly contenu: string;
}

export type PreparationBibliotheque = { readonly ok: true; readonly fichiers: readonly FichierBibliotheque[] } | { readonly ok: false; readonly erreur: string };

const MOTIF_MIGRATION = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Migration drizzle-kit `--custom` encore vide (commentaires seulement). */
const estVide = (sql: string | null): boolean => sql !== null && sql.replace(/^\s*--.*$/gm, '').trim() === '';

/**
 * Les fichiers qu'écrit `pnpm --filter @planif/db bibliotheque <migration>` : le SQL et l'état ;
 * pour une migration nouvelle, aussi l'entrée du journal et l'instantané (copie du précédent,
 * comme `drizzle-kit generate --custom`). Une migration existante ne se réécrit que si c'est la
 * dernière du journal et la dernière de bibliothèque (pas encore fusionnée), ou une migration
 * `--custom` encore vide.
 */
export function preparerMigrationBibliotheque(
  migration: string,
  depot: DepotBibliotheque,
  options: { readonly maintenant: number; readonly nouvelId: () => string },
): PreparationBibliotheque {
  const refus = (erreur: string): PreparationBibliotheque => ({ ok: false, erreur });
  const motif = MOTIF_MIGRATION.exec(migration);
  if (migration === MIGRATION_BIBLIOTHEQUE_DEPART) return refus(`${migration} est figée : une correction de la bibliothèque passe par une nouvelle migration.`);
  if (motif === null) return refus(`nom de migration attendu : NNNN_nom_en_minuscules (par exemple 0034_bibliotheque_correction), reçu « ${migration} ».`);
  const entrees = depot.journal.entries;
  const derniere = entrees[entrees.length - 1];
  if (derniere === undefined) return refus('journal de drizzle vide.');
  const suivant = String(derniere.idx + 1).padStart(4, '0');
  const existante = entrees.find((e) => e.tag === migration);
  const dernierEtat = depot.etats[depot.etats.length - 1];
  let precedent: EtatBibliotheque | undefined;
  if (existante !== undefined) {
    const derniereDeBibliotheque = dernierEtat?.migration === migration;
    if (existante !== derniere || !(derniereDeBibliotheque || estVide(depot.sqlDe(migration)))) {
      return refus(`${migration} existe déjà et n'est pas la dernière migration de bibliothèque : une migration fusionnée ne se réécrit jamais ; en créer une nouvelle (${suivant}_…).`);
    }
    precedent = derniereDeBibliotheque ? depot.etats[depot.etats.length - 2] : dernierEtat;
  } else {
    if (motif[1] !== suivant) return refus(`numéro attendu : ${suivant} (la dernière migration du journal est ${derniere.tag}).`);
    precedent = dernierEtat;
  }
  if (precedent === undefined) return refus('aucun état de bibliothèque précédent (bibliotheque/etats/).');
  const sql = sqlMiseAJourBibliotheque(migration, precedent.lignes, depot.courant);
  if (sql === null) return refus(`rien à écrire : depart.json ne change aucune ligne de la base par rapport à ${precedent.migration}.`);
  const fichiers: FichierBibliotheque[] = [
    { chemin: `migrations/${migration}.sql`, contenu: sql },
    { chemin: `bibliotheque/etats/${migration}.json`, contenu: texteEtatBibliotheque(migration, depot.courant) },
  ];
  if (existante === undefined) {
    const texte = depot.instantaneDe(derniere.idx);
    if (texte === null) return refus(`instantané migrations/meta/${String(derniere.idx).padStart(4, '0')}_snapshot.json absent.`);
    const instantane = JSON.parse(texte) as { readonly id: string } & Readonly<Record<string, unknown>>;
    const entree: EntreeJournalDrizzle = { idx: derniere.idx + 1, version: derniere.version, when: options.maintenant, tag: migration, breakpoints: true };
    fichiers.push(
      { chemin: 'migrations/meta/_journal.json', contenu: JSON.stringify({ ...depot.journal, entries: [...entrees, entree] }, null, 2) },
      { chemin: `migrations/meta/${suivant}_snapshot.json`, contenu: JSON.stringify({ ...instantane, id: options.nouvelId(), prevId: instantane.id }, null, 2) },
    );
  }
  return { ok: true, fichiers };
}
