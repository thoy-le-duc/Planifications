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
    if (!COLONNES.has(cle)) return refuser(`colonne inconnue : ${cle}`);
  }
  const d = donnees;
  const fermeId = uuidOuNul(d.ferme_id);
  const auteurId = uuidOuNul(d.auteur_id);
  if (!fermeId.ok || fermeId.valeur === null) return refuser('ferme manquante');
  if (!auteurId.ok || auteurId.valeur === null) return refuser('auteur manquant');
  if (!parmi(TYPES_EVENEMENT, d.type)) return refuser("type d'événement inconnu");
  if (typeof d.date !== 'string' || !estDateValide(d.date)) return refuser('date invalide (AAAA-MM-JJ)');
  if (typeof d.horodatage !== 'string' || !MOTIF_INSTANT.test(d.horodatage) || Number.isNaN(Date.parse(d.horodatage))) {
    return refuser('horodatage invalide (ISO 8601)');
  }
  if (!parmi(SOURCES_SAISIE, d.source)) return refuser('source de saisie inconnue');
  const serieId = uuidOuNul(d.serie_id);
  const campagneId = uuidOuNul(d.campagne_id);
  if (!serieId.ok || !campagneId.ok) return refuser('série ou campagne invalide');
  if (serieId.valeur !== null && campagneId.valeur !== null) return refuser('une série ou une campagne, pas les deux');
  if (!texteOuNul(d.note)) return refuser('note invalide');

  const emplacements = tableau(d.emplacement_ids, 'emplacements');
  if (!emplacements.ok) return emplacements;
  if (!emplacements.valeur.every(estUuid)) return refuser('emplacement invalide');
  const photos = tableau(d.photos, 'photos');
  if (!photos.ok) return photos;
  if (!photos.valeur.every((p) => typeof p === 'string')) return refuser('photo invalide');

  const remplaceSorte = d.remplace_sorte ?? null;
  const remplaceId = uuidOuNul(d.remplace_evenement_id);
  if (remplaceSorte !== null && !parmi(SORTES_REMPLACEMENT, remplaceSorte)) return refuser('remplacement inconnu');
  if (!remplaceId.ok || (remplaceSorte === null) !== (remplaceId.valeur === null)) {
    return refuser('remplacement incomplet (sorte et événement remplacé vont ensemble)');
  }
  if (remplaceId.valeur === id.toLowerCase()) return refuser('un événement ne se remplace pas lui-même');

  const detail = json(d.detail);
  if (!detail.ok || !objet(detail.valeur)) return refuser('détail manquant ou illisible');
  const erreur = erreurDetail(d.type, detail.valeur);
  if (erreur !== null) return refuser(erreur);

  return accepter({
    id: id.toLowerCase() as Id<'Evenement'>,
    fermeId: fermeId.valeur as Id<'Ferme'>,
    type: d.type,
    date: d.date,
    horodatage: new Date(d.horodatage),
    auteurId: auteurId.valeur as Id<'Utilisateur'>,
    source: d.source,
    serieId: serieId.valeur as Id<'Serie'> | null,
    campagneId: campagneId.valeur as Id<'Campagne'> | null,
    emplacementIds: (emplacements.valeur as string[]).map((e) => e.toLowerCase() as Id<'Emplacement'>),
    note: (d.note ?? null) as string | null,
    photos: photos.valeur as string[],
    remplaceSorte: remplaceSorte,
    remplaceEvenementId: remplaceId.valeur as Id<'Evenement'> | null,
    // Le détail a la forme de son type (vérifiée ci-dessus) : c'est le Detail* de T01 tel quel.
    detail: detail.valeur as unknown as Evenement['detail'],
  });
}
