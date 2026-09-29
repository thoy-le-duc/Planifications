/**
 * Lecture d'un événement reçu du téléphone (PUT de POST /sync/upload) : ligne SQLite de
 * PowerSync (texte, nombre ou null ; jsonb et tableaux en texte JSON) → ligne Postgres typée.
 *
 * Tout ce qui ne colle pas au modèle (T01, @planif/core) est refusé ici avec une explication en
 * français, avant d'atteindre la base ; les CHECK de la base restent le dernier rempart (voir
 * upload.ts). La ferme et l'auteur sont vérifiés par l'appelant, avec l'utilisateur du jeton.
 */
import { estDateValide, type Evenement, type Id } from '@planif/core';
import {
  CATEGORIES_INTERVENTION,
  ETAPES_REALISEES,
  NATURES_OBSERVATION,
  SORTES_REMPLACEMENT,
  SOURCES_SAISIE,
  TYPES_EVENEMENT,
  UNITES_RECOLTE,
  type LigneEvenement,
} from '@planif/db';
import { estUuid } from '../auth/jetons.ts';

export type Lecture<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly raison: string };

const refuser = (raison: string): { ok: false; raison: string } => ({ ok: false, raison });
const accepter = <T>(valeur: T): { ok: true; valeur: T } => ({ ok: true, valeur });

/** Colonnes qu'un téléphone peut envoyer pour un événement (hors id). */
const COLONNES = new Set([
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
  // Remplie par le serveur ; ignorée si le téléphone l'envoie.
  'cree_le',
]);

/** Limites de taille (relecture T10, C2) : un téléphone ne remplit pas la base avec n'importe quoi. */
export const LIMITES = {
  noteCaracteres: 4_000,
  photos: 20,
  photoCaracteres: 2_000,
  /** Emplacements d'un même événement (relecture T10, R1). */
  emplacements: 200,
  /** Octets UTF-8 de JSON.stringify(detail). */
  detailOctets: 8_192,
} as const;

/** Dates plausibles (relecture T10, M7) : bornes comprises. */
const DATE_MIN = '2000-01-01';
const DATE_MAX = '2100-12-31';
const INSTANT_MIN = Date.parse('2000-01-01T00:00:00.000Z');
const INSTANT_MAX = Date.parse('2100-12-31T23:59:59.999Z');

/** Clés de chaque Detail* de T01 : toute autre clé est refusée. */
const CLES_DETAIL: Readonly<Record<Evenement['type'], readonly string[]>> = {
  realise: ['etape', 'quantiteReelle'],
  recolte: ['quantite', 'unite', 'categorie'],
  intervention: ['categorie', 'type', 'outil', 'dureeOccupationJours', 'produit', 'quantite'],
  irrigation: ['secteurIrrigationId', 'dureeMinutes'],
  traitement: ['produitPhytoId', 'dose', 'surfaceTraiteeM2', 'cible', 'operateur', 'recolteAutoriseeLe'],
  observation: ['nature', 'gravite'],
};

/** Clés propres à chaque catégorie d'intervention (DetailIntervention de T01). */
const CLES_INTERVENTION: Readonly<Record<string, readonly string[]>> = {
  couverture: ['dureeOccupationJours'],
  fertilisation: ['produit', 'quantite'],
  amendement: ['produit', 'quantite'],
};

const CLES_QUANTITE = new Set(['valeur', 'unite']);

const octetsUtf8 = (texte: string): number => new TextEncoder().encode(texte).length;

/**
 * JSON.stringify qui ne lève jamais (relecture T10, R2) : une valeur imbriquée sur des dizaines
 * de milliers de niveaux dépasse la pile (RangeError). null si la valeur ne s'écrit pas.
 */
export function jsonSansErreur(valeur: unknown): string | null {
  try {
    const texte: unknown = JSON.stringify(valeur);
    return typeof texte === 'string' ? texte : null;
  } catch {
    return null;
  }
}

/** Instant ISO 8601 complet, avec fuseau (Z ou ±hh:mm). */
const MOTIF_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function parmi<T extends string>(valeurs: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (valeurs as readonly string[]).includes(v);
}

function uuidOuNul(v: unknown): Lecture<string | null> {
  if (v === undefined || v === null) return accepter(null);
  return estUuid(v) ? accepter(v.toLowerCase()) : refuser('identifiant invalide');
}

/** Texte JSON (format de PowerSync), ou déjà la valeur. */
function json(v: unknown): Lecture<unknown> {
  if (typeof v !== 'string') return accepter(v);
  try {
    return accepter(JSON.parse(v) as unknown);
  } catch {
    return refuser('texte JSON illisible');
  }
}

function tableau(v: unknown, nom: string): Lecture<readonly unknown[]> {
  if (v === undefined || v === null) return accepter([]);
  const lu = json(v);
  if (!lu.ok || !Array.isArray(lu.valeur)) return refuser(`${nom} : tableau attendu`);
  return accepter(lu.valeur);
}

function objet(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const estNombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nombreOuNul = (v: unknown): boolean => v === undefined || v === null || estNombre(v);
const texteOuNul = (v: unknown): boolean => v === undefined || v === null || typeof v === 'string';
const texteNonVide = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** Première clé du détail qui n'appartient pas au Detail* du type, ou null. */
function cleInconnue(type: Evenement['type'], d: Readonly<Record<string, unknown>>): string | null {
  const communes = type === 'intervention' ? ['categorie', 'type', 'outil'] : CLES_DETAIL[type];
  const propres = type === 'intervention' && typeof d.categorie === 'string' ? (CLES_INTERVENTION[d.categorie] ?? []) : [];
  for (const cle of Object.keys(d)) {
    if (!communes.includes(cle) && !propres.includes(cle)) return cle;
  }
  for (const q of [d.dose, d.quantite]) {
    if (objet(q)) {
      const cle = Object.keys(q).find((c) => !CLES_QUANTITE.has(c));
      if (cle !== undefined) return cle;
    }
  }
  return null;
}

/** Texte court pour un message : un nom de clé reçu peut faire 10 000 caractères. */
const extrait = (texte: string): string => (texte.length > 40 ? `${texte.slice(0, 40)}…` : texte);

/** Règles du détail selon le type (T01) : ce que la base vérifie aussi, avec un message lisible. */
function erreurDetail(type: Evenement['type'], d: Readonly<Record<string, unknown>>): string | null {
  switch (type) {
    case 'recolte':
      if (!estNombre(d.quantite) || d.quantite <= 0) return 'la quantité récoltée doit être un nombre positif';
      if (!parmi(UNITES_RECOLTE, d.unite)) return 'unité de récolte inconnue';
      return texteOuNul(d.categorie) ? null : 'catégorie invalide';
    case 'realise':
      if (!parmi(ETAPES_REALISEES, d.etape)) return 'étape réalisée inconnue';
      return nombreOuNul(d.quantiteReelle) ? null : 'quantité réelle invalide';
    case 'intervention': {
      if (!parmi(CATEGORIES_INTERVENTION, d.categorie)) return "catégorie d'intervention inconnue";
      if (!texteNonVide(d.type)) return "type d'intervention manquant";
      if (!texteOuNul(d.outil)) return 'outil invalide';
      const engrais = d.categorie === 'fertilisation' || d.categorie === 'amendement';
      const quantite = objet(d.quantite) ? d.quantite : null;
      if (engrais && (!texteNonVide(d.produit) || quantite === null || !estNombre(quantite.valeur))) {
        return 'produit et quantité obligatoires pour une fertilisation ou un amendement';
      }
      return nombreOuNul(d.dureeOccupationJours) ? null : "durée d'occupation invalide";
    }
    case 'irrigation':
      if (!estUuid(d.secteurIrrigationId)) return "secteur d'irrigation manquant";
      return estNombre(d.dureeMinutes) && d.dureeMinutes >= 0 ? null : "durée d'irrigation invalide";
    case 'traitement': {
      if (!estUuid(d.produitPhytoId)) return 'produit phytosanitaire manquant';
      const dose = objet(d.dose) ? d.dose : null;
      if (dose === null || !estNombre(dose.valeur) || dose.valeur < 0 || typeof dose.unite !== 'string') return 'dose invalide';
      if (!estNombre(d.surfaceTraiteeM2) || d.surfaceTraiteeM2 < 0) return 'surface traitée invalide';
      if (typeof d.recolteAutoriseeLe !== 'string' || !estDateValide(d.recolteAutoriseeLe)) {
        return 'date de récolte autorisée invalide';
      }
      return null;
    }
    case 'observation':
      return parmi(NATURES_OBSERVATION, d.nature) ? null : "nature d'observation inconnue";
  }
}

/**
 * Données d'un PUT sur `evenement` → ligne à insérer (hors horodatages remplis par le serveur),
 * ou la raison du refus.
 */
export function lireEvenement(id: string, donnees: Readonly<Record<string, unknown>>): Lecture<LigneEvenement> {
  if (!estUuid(id)) return refuser("identifiant de l'événement invalide");
  for (const cle of Object.keys(donnees)) {
    if (!COLONNES.has(cle)) return refuser(`colonne inconnue : ${extrait(cle)}`);
  }
  const d = donnees;
  const fermeId = uuidOuNul(d.ferme_id);
  const auteurId = uuidOuNul(d.auteur_id);
  if (!fermeId.ok || fermeId.valeur === null) return refuser('ferme manquante');
  if (!auteurId.ok || auteurId.valeur === null) return refuser('auteur manquant');
  if (!parmi(TYPES_EVENEMENT, d.type)) return refuser("type d'événement inconnu");
  if (typeof d.date !== 'string' || !estDateValide(d.date)) return refuser('date invalide (AAAA-MM-JJ)');
  if (d.date < DATE_MIN || d.date > DATE_MAX) return refuser(`date hors de ${DATE_MIN} … ${DATE_MAX}`);
  const instant = typeof d.horodatage === 'string' && MOTIF_INSTANT.test(d.horodatage) ? Date.parse(d.horodatage) : Number.NaN;
  if (Number.isNaN(instant)) return refuser('horodatage invalide (ISO 8601)');
  if (instant < INSTANT_MIN || instant > INSTANT_MAX) return refuser('horodatage hors de 2000 … 2100');
  if (!parmi(SOURCES_SAISIE, d.source)) return refuser('source de saisie inconnue');
  const serieId = uuidOuNul(d.serie_id);
  const campagneId = uuidOuNul(d.campagne_id);
  if (!serieId.ok || !campagneId.ok) return refuser('série ou campagne invalide');
  if (serieId.valeur !== null && campagneId.valeur !== null) return refuser('une série ou une campagne, pas les deux');
  if (!texteOuNul(d.note)) return refuser('note invalide');
  if (typeof d.note === 'string' && d.note.length > LIMITES.noteCaracteres) {
    return refuser(`note trop longue (${String(LIMITES.noteCaracteres)} caractères au plus)`);
  }

  const emplacements = tableau(d.emplacement_ids, 'emplacements');
  if (!emplacements.ok) return emplacements;
  if (emplacements.valeur.length > LIMITES.emplacements) {
    return refuser(`trop d'emplacements (${String(LIMITES.emplacements)} au plus)`);
  }
  if (!emplacements.valeur.every(estUuid)) return refuser('emplacement invalide');
  const listeEmplacements = emplacements.valeur.map((e) => e.toLowerCase() as Id<'Emplacement'>);
  if (new Set(listeEmplacements).size !== listeEmplacements.length) return refuser('emplacement en double');
  const photos = tableau(d.photos, 'photos');
  if (!photos.ok) return photos;
  const listePhotos = photos.valeur.filter((p): p is string => typeof p === 'string');
  if (listePhotos.length !== photos.valeur.length) return refuser('photo invalide');
  if (listePhotos.length > LIMITES.photos) return refuser(`trop de photos (${String(LIMITES.photos)} au plus)`);
  if (listePhotos.some((p) => p.length > LIMITES.photoCaracteres)) {
    return refuser(`adresse de photo trop longue (${String(LIMITES.photoCaracteres)} caractères au plus)`);
  }

  const remplaceSorte = d.remplace_sorte ?? null;
  const remplaceId = uuidOuNul(d.remplace_evenement_id);
  if (remplaceSorte !== null && !parmi(SORTES_REMPLACEMENT, remplaceSorte)) return refuser('remplacement inconnu');
  if (!remplaceId.ok || (remplaceSorte === null) !== (remplaceId.valeur === null)) {
    return refuser('remplacement incomplet (sorte et événement remplacé vont ensemble)');
  }
  if (remplaceId.valeur === id.toLowerCase()) return refuser('un événement ne se remplace pas lui-même');

  const detail = json(d.detail);
  if (!detail.ok || !objet(detail.valeur)) return refuser('détail manquant ou illisible');
  const texteDetail = jsonSansErreur(detail.valeur);
  if (texteDetail === null) return refuser('détail illisible');
  if (octetsUtf8(texteDetail) > LIMITES.detailOctets) return refuser('détail trop volumineux (8 Kio au plus)');
  const inconnue = cleInconnue(d.type, detail.valeur);
  if (inconnue !== null) return refuser(`clé inconnue dans le détail : ${extrait(inconnue)}`);
  const erreur = erreurDetail(d.type, detail.valeur);
  if (erreur !== null) return refuser(erreur);

  return accepter({
    id: id.toLowerCase() as Id<'Evenement'>,
    fermeId: fermeId.valeur as Id<'Ferme'>,
    type: d.type,
    date: d.date,
    horodatage: new Date(instant),
    auteurId: auteurId.valeur as Id<'Utilisateur'>,
    source: d.source,
    serieId: serieId.valeur as Id<'Serie'> | null,
    campagneId: campagneId.valeur as Id<'Campagne'> | null,
    emplacementIds: listeEmplacements,
    note: (d.note ?? null) as string | null,
    photos: listePhotos,
    remplaceSorte: remplaceSorte,
    remplaceEvenementId: remplaceId.valeur as Id<'Evenement'> | null,
    // Le détail a la forme de son type (vérifiée ci-dessus) : c'est le Detail* de T01 tel quel.
    detail: detail.valeur as unknown as Evenement['detail'],
  });
}
