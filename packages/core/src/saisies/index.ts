/**
 * Règles d'une saisie (événement du journal de terrain) : une seule définition, pure, utilisée
 * par le serveur à l'envoi (apps/api/src/sync/evenement.ts) et par le téléphone avant d'écrire.
 *
 * Ni base, ni réseau, ni horloge : une ligne `evenement` en entrée (format PowerSync, snake_case,
 * texte JSON ou valeurs), un `Evenement` de T01 ou la première règle violée en sortie. Ne lève
 * jamais. L'appartenance des références à la ferme reste à l'appelant (base de données).
 */
import { estDateValide } from '../dates/index.ts';
import type {
  CategorieIntervention,
  EtapeRealisee,
  Evenement,
  Id,
  NatureObservation,
  RemplacementEvenement,
  SourceSaisie,
  TypeEvenement,
  UniteRecolte,
} from '../domaine/index.ts';

// ── Types publics ────────────────────────────────────────────────────────────────────────────

export type CodeErreurSaisie =
  | 'entree_invalide'
  | 'colonne_inconnue'
  | 'champ_manquant'
  | 'champ_invalide'
  | 'hors_bornes'
  | 'trop_long'
  | 'trop_nombreux'
  | 'doublon'
  | 'incoherent'
  | 'json_illisible'
  | 'trop_volumineux'
  | 'cle_inconnue'
  | 'plafond_depasse';

export interface ErreurSaisie {
  readonly code: CodeErreurSaisie;
  /** Colonne reçue ('date', 'emplacement_ids'…) ou chemin dans le détail ('detail.quantite', 'detail.dose.valeur'). */
  readonly champ: string | null;
  /** Explication en français, 200 caractères au plus. */
  readonly message: string;
}

export type ResultatSaisie =
  | { readonly ok: true; readonly saisie: Evenement }
  | { readonly ok: false; readonly erreur: ErreurSaisie };

/** Limites de taille (relecture T10) : un téléphone ne remplit pas la base avec n'importe quoi. */
export const LIMITES_SAISIE = {
  noteCaracteres: 4_000,
  photos: 20,
  photoCaracteres: 2_000,
  emplacements: 200,
  /** Octets UTF-8 de JSON.stringify(detail). */
  detailOctets: 8_192,
} as const;

/**
 * Plafonds métier par saisie, bornes comprises. PROVISOIRES : à valider par Théophane
 * (docs/questions.md). Ils arrêtent une faute de frappe (1e308 kg), pas une grosse journée.
 */
export const PLAFONDS_PROVISOIRES = {
  /** recolte.quantite, quelle que soit l'unité. */
  recolteQuantite: 100_000,
  /** realise.quantiteReelle (graines ou plants). */
  realiseQuantite: 10_000_000,
  /** intervention fertilisation / amendement : quantite.valeur. */
  interventionQuantite: 1_000_000,
  /** intervention couverture : dureeOccupationJours (3 ans). */
  couvertureJours: 1_095,
  /** irrigation.dureeMinutes (24 h). */
  irrigationMinutes: 1_440,
  /** traitement.dose.valeur. */
  traitementDose: 100_000,
  /** traitement.surfaceTraiteeM2 (10 ha). */
  traitementSurfaceM2: 100_000,
} as const;

// ── Listes de valeurs (T01) ──────────────────────────────────────────────────────────────────

const TYPES = ['realise', 'recolte', 'intervention', 'irrigation', 'traitement', 'observation'] as const satisfies readonly TypeEvenement[];
const SOURCES = ['tap', 'voix', 'agent', 'photo', 'import'] as const satisfies readonly SourceSaisie[];
const SORTES_REMPLACEMENT = ['correction', 'annulation'] as const satisfies readonly RemplacementEvenement['sorte'][];
const UNITES_RECOLTE = ['kg', 'botte', 'piece', 'barquette'] as const satisfies readonly UniteRecolte[];
const ETAPES = ['semis_pepiniere', 'semis_direct', 'plantation', 'arrachage'] as const satisfies readonly EtapeRealisee[];
const CATEGORIES_INTERVENTION = [
  'travail_sol',
  'couverture',
  'fertilisation',
  'amendement',
  'entretien',
] as const satisfies readonly CategorieIntervention[];
const NATURES = ['ravageur', 'maladie', 'stade', 'autre'] as const satisfies readonly NatureObservation[];
const GRAVITES = ['faible', 'moyenne', 'forte'] as const;

/** Colonnes d'une ligne `evenement` ; `cree_le` (remplie par le serveur) est tolérée et ignorée. */
const COLONNES = new Set([
  'id',
  'ferme_id',
  'type',
  'date',
  'horodatage',
  'auteur_id',
  'source',
  'serie_id',
  'campagne_id',
  'emplacement_ids',
  'note',
  'photos',
  'remplace_sorte',
  'remplace_evenement_id',
  'detail',
  'cree_le',
]);

/** Clés de chaque Detail* de T01 (intervention : clés communes, puis celles de la catégorie). */
const CLES_DETAIL: Readonly<Record<TypeEvenement, readonly string[]>> = {
  realise: ['etape', 'quantiteReelle'],
  recolte: ['quantite', 'unite', 'categorie'],
  intervention: ['categorie', 'type', 'outil'],
  irrigation: ['secteurIrrigationId', 'dureeMinutes'],
  traitement: ['produitPhytoId', 'dose', 'surfaceTraiteeM2', 'cible', 'operateur', 'recolteAutoriseeLe'],
  observation: ['nature', 'gravite'],
};
const CLES_CATEGORIE: Readonly<Record<CategorieIntervention, readonly string[]>> = {
  travail_sol: [],
  couverture: ['dureeOccupationJours'],
  fertilisation: ['produit', 'quantite'],
  amendement: ['produit', 'quantite'],
  entretien: [],
};
const CLES_QUANTITE = ['valeur', 'unite'];

const DATE_MIN = '2000-01-01';
const DATE_MAX = '2100-12-31';
const INSTANT_MIN = Date.UTC(2000, 0, 1);
const INSTANT_MAX = Date.UTC(2100, 11, 31, 23, 59, 59, 999);

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instant ISO 8601 complet avec fuseau ; le jour est vérifié à part (pas de 30 février). */
const MOTIF_INSTANT = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

// ── Outils ───────────────────────────────────────────────────────────────────────────────────

type Objet = Readonly<Record<string, unknown>>;
type Lu<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurSaisie };

const erreur = (code: CodeErreurSaisie, champ: string | null, message: string): ErreurSaisie => ({ code, champ, message });
const echec = <T>(e: ErreurSaisie): Lu<T> => ({ ok: false, erreur: e });
const lu = <T>(valeur: T): Lu<T> => ({ ok: true, valeur });

const absent = (v: unknown): v is null | undefined => v === undefined || v === null;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);
const estUuid = (v: unknown): v is string => typeof v === 'string' && MOTIF_UUID.test(v);
const estNombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const parmi = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);

/** Texte court pour un message : un nom de clé reçu peut faire 10 000 caractères. */
const extrait = (texte: string): string => (texte.length > 40 ? `${texte.slice(0, 40)}…` : texte);

/** Octets UTF-8 d'un texte (sans TextEncoder : le cœur n'a ni DOM ni Node). */
function octetsUtf8(texte: string): number {
  let n = 0;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length) {
      const suivant = texte.charCodeAt(i + 1);
      if (suivant >= 0xdc00 && suivant <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** Texte JSON (format de PowerSync) ou déjà la valeur ; JSON.parse ne lève pas ici. */
function json(v: unknown, champ: string, libelle: string): Lu<unknown> {
  if (typeof v !== 'string') return lu(v);
  try {
    return lu(JSON.parse(v) as unknown);
  } catch {
    return echec(erreur('json_illisible', champ, `${libelle} : texte JSON illisible`));
  }
}

/**
 * JSON.stringify qui ne lève jamais : le texte, ou le motif de l'échec ('imbrique' : pile
 * dépassée, RangeError ; 'illisible' : BigInt, valeur qui ne s'écrit pas).
 */
function texteJson(v: unknown): { readonly texte: string } | { readonly echec: 'imbrique' | 'illisible' } {
  try {
    const texte: unknown = JSON.stringify(v);
    return typeof texte === 'string' ? { texte } : { echec: 'illisible' };
  } catch (e) {
    return { echec: e instanceof RangeError ? 'imbrique' : 'illisible' };
  }
}

/**
 * Copie des propriétés propres et énumérables (un niveau) : une valeur héritée par prototype est
 * absente, et modifier l'objet reçu après coup ne change rien. `Object.fromEntries` crée des
 * propriétés propres : une clé '__proto__' reste une clé (refusée ensuite), pas un prototype.
 */
const copiePropre = (o: Objet): Objet => Object.fromEntries(Object.keys(o).map((cle) => [cle, o[cle]]));


function idObligatoire(v: unknown, champ: string, libelle: string): Lu<string> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (!estUuid(v)) return echec(erreur('champ_invalide', champ, `${libelle} : identifiant invalide`));
  return lu(v.toLowerCase());
}

function idOuNul(v: unknown, champ: string, libelle: string): Lu<string | null> {
  if (absent(v)) return lu(null);
  if (!estUuid(v)) return echec(erreur('champ_invalide', champ, `${libelle} : identifiant invalide`));
  return lu(v.toLowerCase());
}

function valeurParmi<T extends string>(v: unknown, liste: readonly T[], champ: string, libelle: string): Lu<T> {
  if (absent(v)) return echec(erreur('champ_manquant', champ, `${libelle} manquant`));
  if (!parmi(liste, v)) return echec(erreur('champ_invalide', champ, `${libelle} inconnu`));
  return lu(v);
}

function tableau(v: unknown, champ: string, libelle: string): Lu<readonly unknown[]> {
  if (absent(v)) return lu([]);
  const valeur = json(v, champ, libelle);
  if (!valeur.ok) return valeur;
  if (!Array.isArray(valeur.valeur)) return echec(erreur('champ_invalide', champ, `${libelle} : liste attendue`));
  return lu(valeur.valeur);
}

// ── Détail ───────────────────────────────────────────────────────────────────────────────────

type Verif = ErreurSaisie | null;

interface RegleNombre {
  readonly libelle: string;
  readonly obligatoire: boolean;
  readonly plafond: number;
  /** Strictement positif (quantité récoltée) ; sinon positif ou nul. */
  readonly strictementPositif?: boolean;
  /** Entier (minutes, jours : T01). */
  readonly entier?: boolean;
}

function verifNombre(v: unknown, champ: string, r: RegleNombre): Verif {
  if (absent(v)) return r.obligatoire ? erreur('champ_manquant', champ, `${r.libelle} manquante`) : null;
  if (!estNombre(v)) return erreur('champ_invalide', champ, `${r.libelle} : nombre attendu`);
  if (r.entier === true && !Number.isInteger(v)) return erreur('champ_invalide', champ, `${r.libelle} : nombre entier attendu`);
  if (r.strictementPositif === true ? v <= 0 : v < 0) {
    return erreur('champ_invalide', champ, `${r.libelle} : nombre ${r.strictementPositif === true ? 'positif' : 'positif ou nul'} attendu`);
  }
  if (v > r.plafond) return erreur('plafond_depasse', champ, `${r.libelle} au-delà du plafond (${String(r.plafond)} au plus)`);
  return null;
}

function verifTexte(v: unknown, champ: string, libelle: string, o: { readonly obligatoire: boolean; readonly nonVide?: boolean }): Verif {
  if (absent(v)) return o.obligatoire ? erreur('champ_manquant', champ, `${libelle} manquant`) : null;
  if (typeof v !== 'string') return erreur('champ_invalide', champ, `${libelle} : texte attendu`);
  if (o.nonVide === true && v.trim() === '') return erreur('champ_manquant', champ, `${libelle} manquant`);
  return null;
}

function verifParmi(v: unknown, liste: readonly string[], champ: string, libelle: string, obligatoire: boolean): Verif {
  if (absent(v)) return obligatoire ? erreur('champ_manquant', champ, `${libelle} manquante`) : null;
  return parmi(liste, v) ? null : erreur('champ_invalide', champ, `${libelle} inconnue`);
}

/** Objet { valeur, unite } obligatoire (dose, quantité d'engrais). */
function verifQuantite(v: unknown, champ: string, libelle: string, plafond: number): Verif {
  if (absent(v)) return erreur('champ_manquant', champ, `${libelle} manquante`);
  if (!estObjet(v)) return erreur('champ_invalide', champ, `${libelle} : valeur et unité attendues`);
  return (
    verifNombre(v.valeur, `${champ}.valeur`, { libelle, obligatoire: true, plafond }) ??
    verifTexte(v.unite, `${champ}.unite`, `unité de ${libelle}`, { obligatoire: true })
  );
}

function verifUuid(v: unknown, champ: string, libelle: string): Verif {
  if (absent(v)) return erreur('champ_manquant', champ, `${libelle} manquant`);
  return estUuid(v) ? null : erreur('champ_invalide', champ, `${libelle} : identifiant invalide`);
}

/** Première clé hors du Detail* du type (ou d'une quantité/dose), ou null. */
function cleInconnue(type: TypeEvenement, d: Objet): Verif {
  const propres = type === 'intervention' && parmi(CATEGORIES_INTERVENTION, d.categorie) ? CLES_CATEGORIE[d.categorie] : [];
  const permises = CLES_DETAIL[type];
  for (const cle of Object.keys(d)) {
    if (!permises.includes(cle) && !propres.includes(cle)) {
      return erreur('cle_inconnue', `detail.${extrait(cle)}`, `clé inconnue dans le détail : ${extrait(cle)}`);
    }
  }
  for (const nom of ['dose', 'quantite']) {
    const q = d[nom];
    if (!estObjet(q) || !(type === 'traitement' || type === 'intervention')) continue;
    const cle = Object.keys(q).find((c) => !CLES_QUANTITE.includes(c));
    if (cle !== undefined) return erreur('cle_inconnue', `detail.${nom}.${extrait(cle)}`, `clé inconnue dans ${nom} : ${extrait(cle)}`);
  }
  return null;
}

const P = PLAFONDS_PROVISOIRES;

/** Valeurs du détail selon le type (Detail* de T01). */
function verifDetail(type: TypeEvenement, d: Objet): Verif {
  switch (type) {
    case 'recolte':
      return (
        verifNombre(d.quantite, 'detail.quantite', { libelle: 'quantité récoltée', obligatoire: true, plafond: P.recolteQuantite, strictementPositif: true }) ??
        verifParmi(d.unite, UNITES_RECOLTE, 'detail.unite', 'unité de récolte', true) ??
        verifTexte(d.categorie, 'detail.categorie', 'catégorie', { obligatoire: false })
      );
    case 'realise':
      return (
        verifParmi(d.etape, ETAPES, 'detail.etape', 'étape réalisée', true) ??
        verifNombre(d.quantiteReelle, 'detail.quantiteReelle', { libelle: 'quantité réelle', obligatoire: false, plafond: P.realiseQuantite })
      );
    case 'intervention': {
      const commun =
        verifParmi(d.categorie, CATEGORIES_INTERVENTION, 'detail.categorie', "catégorie d'intervention", true) ??
        verifTexte(d.type, 'detail.type', "type d'intervention", { obligatoire: true, nonVide: true }) ??
        verifTexte(d.outil, 'detail.outil', 'outil', { obligatoire: false });
      if (commun !== null) return commun;
      if (d.categorie === 'couverture') {
        return verifNombre(d.dureeOccupationJours, 'detail.dureeOccupationJours', {
          libelle: "durée d'occupation",
          obligatoire: false,
          plafond: P.couvertureJours,
          entier: true,
        });
      }
      if (d.categorie === 'fertilisation' || d.categorie === 'amendement') {
        return (
          verifTexte(d.produit, 'detail.produit', 'produit', { obligatoire: true, nonVide: true }) ??
          verifQuantite(d.quantite, 'detail.quantite', 'quantité', P.interventionQuantite)
        );
      }
      return null;
    }
    case 'irrigation':
      return (
        verifUuid(d.secteurIrrigationId, 'detail.secteurIrrigationId', "secteur d'irrigation") ??
        verifNombre(d.dureeMinutes, 'detail.dureeMinutes', {
          libelle: "durée d'irrigation",
          obligatoire: true,
          plafond: P.irrigationMinutes,
          entier: true,
        })
      );
    case 'traitement':
      return (
        verifUuid(d.produitPhytoId, 'detail.produitPhytoId', 'produit phytosanitaire') ??
        verifQuantite(d.dose, 'detail.dose', 'dose', P.traitementDose) ??
        verifNombre(d.surfaceTraiteeM2, 'detail.surfaceTraiteeM2', { libelle: 'surface traitée', obligatoire: true, plafond: P.traitementSurfaceM2 }) ??
        verifTexte(d.cible, 'detail.cible', 'cible', { obligatoire: true }) ??
        verifTexte(d.operateur, 'detail.operateur', 'opérateur', { obligatoire: true }) ??
        verifDateDetail(d.recolteAutoriseeLe)
      );
    case 'observation':
      return (
        verifParmi(d.nature, NATURES, 'detail.nature', "nature d'observation", true) ??
        verifParmi(d.gravite, GRAVITES, 'detail.gravite', 'gravité', false)
      );
  }
}

function verifDateDetail(v: unknown): Verif {
  const champ = 'detail.recolteAutoriseeLe';
  if (absent(v)) return erreur('champ_manquant', champ, 'date de récolte autorisée manquante');
  return typeof v === 'string' && estDateValide(v) ? null : erreur('champ_invalide', champ, 'date de récolte autorisée invalide (AAAA-MM-JJ)');
}

function lireDetail(type: TypeEvenement, v: unknown): Lu<Objet> {
  if (absent(v)) return echec(erreur('champ_manquant', 'detail', 'détail manquant'));
  const valeur = json(v, 'detail', 'détail');
  if (!valeur.ok) return valeur;
  if (!estObjet(valeur.valeur)) return echec(erreur('champ_invalide', 'detail', 'détail : objet attendu'));
  // Copie propre (quantite et dose copiées aussi) : c'est elle qui est vérifiée puis rendue.
  const d: Record<string, unknown> = { ...copiePropre(valeur.valeur) };
  for (const nom of ['dose', 'quantite']) {
    const q = d[nom];
    if (estObjet(q)) d[nom] = copiePropre(q);
  }
  const ecrit = texteJson(d);
  if ('echec' in ecrit) {
    const message = ecrit.echec === 'imbrique' ? 'détail illisible (trop imbriqué)' : 'détail illisible (valeur non JSON)';
    return echec(erreur('json_illisible', 'detail', message));
  }
  const texte = ecrit.texte;
  // Chaque caractère fait au moins un octet : inutile de compter un texte déjà trop long.
  if (texte.length > LIMITES_SAISIE.detailOctets || octetsUtf8(texte) > LIMITES_SAISIE.detailOctets) {
    return echec(erreur('trop_volumineux', 'detail', `détail trop volumineux (${String(LIMITES_SAISIE.detailOctets)} octets au plus)`));
  }
  const e = cleInconnue(type, d) ?? verifDetail(type, d);
  return e === null ? lu(d) : echec(e);
}

// ── Colonnes ─────────────────────────────────────────────────────────────────────────────────

function lireDate(v: unknown): Lu<string> {
  if (absent(v)) return echec(erreur('champ_manquant', 'date', 'date manquante'));
  if (typeof v !== 'string' || !estDateValide(v)) return echec(erreur('champ_invalide', 'date', 'date invalide (AAAA-MM-JJ)'));
  if (v < DATE_MIN || v > DATE_MAX) return echec(erreur('hors_bornes', 'date', `date hors de ${DATE_MIN} … ${DATE_MAX}`));
  return lu(v);
}

function lireHorodatage(v: unknown): Lu<number> {
  if (absent(v)) return echec(erreur('champ_manquant', 'horodatage', 'horodatage manquant'));
  const jour = typeof v === 'string' ? MOTIF_INSTANT.exec(v)?.[1] : undefined;
  const instant = typeof v === 'string' && jour !== undefined && estDateValide(jour) ? Date.parse(v) : Number.NaN;
  if (Number.isNaN(instant)) return echec(erreur('champ_invalide', 'horodatage', 'horodatage invalide (ISO 8601 avec fuseau)'));
  if (instant < INSTANT_MIN || instant > INSTANT_MAX) return echec(erreur('hors_bornes', 'horodatage', 'horodatage hors de 2000 … 2100'));
  return lu(instant);
}

function lireEmplacements(v: unknown): Lu<string[]> {
  const champ = 'emplacement_ids';
  const liste = tableau(v, champ, 'emplacements');
  if (!liste.ok) return liste;
  const max = LIMITES_SAISIE.emplacements;
  if (liste.valeur.length > max) return echec(erreur('trop_nombreux', champ, `trop d'emplacements (${String(max)} au plus)`));
  const ids: string[] = [];
  const vus = new Set<string>();
  for (const e of liste.valeur) {
    if (!estUuid(e)) return echec(erreur('champ_invalide', champ, 'emplacement : identifiant invalide'));
    const id = e.toLowerCase();
    if (vus.has(id)) return echec(erreur('doublon', champ, 'emplacement en double'));
    vus.add(id);
    ids.push(id);
  }
  return lu(ids);
}

function lirePhotos(v: unknown): Lu<string[]> {
  const champ = 'photos';
  const liste = tableau(v, champ, 'photos');
  if (!liste.ok) return liste;
  const photos: string[] = [];
  for (const p of liste.valeur) {
    if (typeof p !== 'string') return echec(erreur('champ_invalide', champ, 'photo : adresse (texte) attendue'));
    photos.push(p);
  }
  if (photos.length > LIMITES_SAISIE.photos) {
    return echec(erreur('trop_nombreux', champ, `trop de photos (${String(LIMITES_SAISIE.photos)} au plus)`));
  }
  if (photos.some((p) => p.length > LIMITES_SAISIE.photoCaracteres)) {
    return echec(erreur('trop_long', champ, `adresse de photo trop longue (${String(LIMITES_SAISIE.photoCaracteres)} caractères au plus)`));
  }
  return lu(photos);
}

function lireRemplacement(sorte: unknown, cible: unknown, id: string): Lu<RemplacementEvenement | null> {
  if (!absent(sorte) && !parmi(SORTES_REMPLACEMENT, sorte)) {
    return echec(erreur('champ_invalide', 'remplace_sorte', 'remplacement inconnu (correction ou annulation)'));
  }
  const evenementId = idOuNul(cible, 'remplace_evenement_id', 'événement remplacé');
  if (!evenementId.ok) return evenementId;
  if (absent(sorte) !== (evenementId.valeur === null)) {
    return echec(erreur('incoherent', 'remplace_evenement_id', 'remplacement incomplet (sorte et événement remplacé vont ensemble)'));
  }
  if (absent(sorte) || evenementId.valeur === null) return lu(null);
  if (evenementId.valeur === id) return echec(erreur('incoherent', 'remplace_evenement_id', 'un événement ne se remplace pas lui-même'));
  return lu({ sorte, evenementId: evenementId.valeur as Id<'Evenement'> });
}

function lire(l: Objet): Lu<Evenement> {
  for (const cle of Object.keys(l)) {
    if (!COLONNES.has(cle)) return echec(erreur('colonne_inconnue', extrait(cle), `colonne inconnue : ${extrait(cle)}`));
  }
  const id = idObligatoire(l.id, 'id', "identifiant de l'événement");
  if (!id.ok) return id;
  const fermeId = idObligatoire(l.ferme_id, 'ferme_id', 'ferme');
  if (!fermeId.ok) return fermeId;
  const auteurId = idObligatoire(l.auteur_id, 'auteur_id', 'auteur');
  if (!auteurId.ok) return auteurId;
  const type = valeurParmi(l.type, TYPES, 'type', "type d'événement");
  if (!type.ok) return type;
  const date = lireDate(l.date);
  if (!date.ok) return date;
  const horodatage = lireHorodatage(l.horodatage);
  if (!horodatage.ok) return horodatage;
  const source = valeurParmi(l.source, SOURCES, 'source', 'source de saisie');
  if (!source.ok) return source;

  const serieId = idOuNul(l.serie_id, 'serie_id', 'série');
  if (!serieId.ok) return serieId;
  const campagneId = idOuNul(l.campagne_id, 'campagne_id', 'campagne');
  if (!campagneId.ok) return campagneId;
  if (serieId.valeur !== null && campagneId.valeur !== null) {
    return echec(erreur('incoherent', 'campagne_id', 'une série ou une campagne, pas les deux'));
  }

  const note = l.note;
  if (!absent(note) && typeof note !== 'string') return echec(erreur('champ_invalide', 'note', 'note : texte attendu'));
  if (typeof note === 'string' && note.length > LIMITES_SAISIE.noteCaracteres) {
    return echec(erreur('trop_long', 'note', `note trop longue (${String(LIMITES_SAISIE.noteCaracteres)} caractères au plus)`));
  }

  const emplacements = lireEmplacements(l.emplacement_ids);
  if (!emplacements.ok) return emplacements;
  const photos = lirePhotos(l.photos);
  if (!photos.ok) return photos;
  const remplacement = lireRemplacement(l.remplace_sorte, l.remplace_evenement_id, id.valeur);
  if (!remplacement.ok) return remplacement;
  const detail = lireDetail(type.valeur, l.detail);
  if (!detail.ok) return detail;

  let culture: Evenement['culture'] = null;
  if (serieId.valeur !== null) culture = { sorte: 'serie', serieId: serieId.valeur as Id<'Serie'> };
  else if (campagneId.valeur !== null) culture = { sorte: 'campagne', campagneId: campagneId.valeur as Id<'Campagne'> };

  // Le détail (copie propre) a été vérifié clé par clé contre le Detail* de son type.
  const evenement = {
    id: id.valeur as Id<'Evenement'>,
    fermeId: fermeId.valeur as Id<'Ferme'>,
    type: type.valeur,
    date: date.valeur,
    horodatage: horodatage.valeur,
    auteurId: auteurId.valeur as Id<'Utilisateur'>,
    source: source.valeur,
    culture,
    emplacementIds: emplacements.valeur as Id<'Emplacement'>[],
    note: note ?? null,
    photos: photos.valeur,
    remplaceEvenement: remplacement.valeur,
    detail: detail.valeur,
  } as unknown as Evenement;
  return lu(evenement);
}

/**
 * Valide une ligne `evenement` (format PowerSync, avec son `id`) et la rend en `Evenement` de
 * T01, ou renvoie la première règle violée. Pure, ne lève jamais.
 */
export function validerSaisie(entree: unknown): ResultatSaisie {
  try {
    // Array.isArray lève sur un Proxy révoqué : tout le corps est dans le filet.
    if (!estObjet(entree)) return { ok: false, erreur: erreur('entree_invalide', null, 'saisie illisible : objet attendu') };
    // Seules les colonnes propres comptent : une valeur héritée par prototype est absente.
    const r = lire(copiePropre(entree));
    return r.ok ? { ok: true, saisie: r.valeur } : { ok: false, erreur: r.erreur };
  } catch {
    // Filet de sécurité (accesseur qui lève, Proxy…) : jamais d'exception vers l'appelant.
    return { ok: false, erreur: erreur('entree_invalide', null, 'saisie illisible') };
  }
}
