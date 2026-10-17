/**
 * Bibliothèque commune de départ (T41, Q43) : familles, espèces et itinéraires de
 * `packages/db/bibliotheque/depart.json` (sources publiques citées, valeurs « à vérifier » que
 * chaque ferme adapte), convertis vers les lignes de la base à `ferme_id` nul.
 *
 * La migration de données `0032_bibliotheque_depart` est le texte de `sqlBibliotheque` appliqué
 * à ces lignes (bibliotheque.test.ts le vérifie) ; `pnpm --filter @planif/db bibliotheque`
 * l'écrit. Les sources et la note « à vérifier » restent dans le JSON du dépôt, pas en base.
 * Une mise à jour future des valeurs passe par une NOUVELLE migration.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  readonly delaiRetourMinAnnees: number;
  readonly delaiRetourConseilleAnnees: number;
  readonly remarque?: string;
}

export interface SourceEspece {
  readonly nom: string;
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

/** Lignes de la base (snake_case, `ferme_id` nul), dans l'ordre du JSON. */
export function convertirBibliotheque(source: SourceBibliotheque): LignesBibliotheque {
  return {
    familles: source.familles.map((f) => ({
      id: idBibliotheque('famille', f.nom),
      ferme_id: null,
      nom: f.nom,
      delai_retour_minimal_ans: f.delaiRetourMinAnnees,
      delai_retour_conseille_ans: f.delaiRetourConseilleAnnees,
    })),
    especes: source.especes.map((e) => ({
      id: idBibliotheque('espece', e.nom),
      ferme_id: null,
      famille_id: idBibliotheque('famille', e.famille),
      nom: e.nom,
      categorie: e.categorie,
      perenne: e.perenne ?? false,
      unite_recolte: e.uniteRecolte,
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      profil_croissance: null,
    })),
    itineraires: source.itineraires.map((i) => ({
      id: idBibliotheque('itineraire', `${i.espece}:${i.nom}`),
      ferme_id: null,
      espece_id: idBibliotheque('espece', i.espece),
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
