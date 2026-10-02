/**
 * T10j — ce qu'un message de refus de synchro ne doit jamais contenir (il s'affiche tel quel sur
 * le téléphone : apps/web/src/ecrans/ferme/Refus.tsx). Utilisé par ../messages-refus.test.ts
 * (textes du code) et ../messages-refus.integration.test.ts (refus réellement enregistrés).
 *
 * Le détail technique (colonne, contrainte, code SQL, seuil) va dans le journal du serveur, pas
 * dans le message.
 */
import { ECRITURES_MAX_PAR_LOT } from '@planif/core';
import * as schema from '@planif/db';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { PROFONDEUR_MAX_CHAINE } from '../references.ts';

/** Codes de motif (refus_synchro.motif) : jamais dans un message. Tenu complet par messages-refus.test.ts. */
export const MOTIFS = [
  'ferme_interdite',
  'auteur_invalide',
  'ajout_seul',
  'table_interdite',
  'ecriture_invalide',
  'lot_trop_gros',
  'recolte_annulee',
] as const;

/**
 * Mots et tournures interdits (motif → règle). Proposition du testeur, à amender par le chef :
 * vocabulaire de la base ou du code, formats techniques, seuils de l'envoi, anglais.
 */
export const MOTS_INTERDITS: readonly (readonly [string, RegExp])[] = [
  ['colonne', /colonnes?/iu],
  ['table', /(?<![\p{L}])tables?(?![\p{L}])/iu],
  ['contrainte', /contraintes?/iu],
  ['règle de la base', /r[èe]gles? de la base/iu],
  ['base de données', /base de donn[ée]es/iu],
  ['SQL', /SQL/u],
  ['SQLSTATE (code d’erreur de Postgres)', /(?<![\p{N}])2[23][0-9A-Z]{3}(?![\p{N}\p{L}])/u],
  ['Postgres', /postgres/iu],
  ['uuid', /uuid/iu],
  ['écriture(s) (vocabulaire de la synchro)', /[ée]critures?/iu],
  ['ligne(s) (vocabulaire de la base)', /(?<![\p{L}])lignes?(?![\p{L}])/iu],
  ['lot (vocabulaire de la synchro)', /(?<![\p{L}])lots?(?![\p{L}])/iu],
  ['transaction', /transactions?/iu],
  ['verrou', /verrou/iu],
  ['clé', /(?<![\p{L}])cl[ée]s?(?![\p{L}])/iu],
  ['JSON', /json/iu],
  ['ISO 8601', /ISO\s*8601/iu],
  ['objet attendu', /objet attendu/iu],
  ['imbriqué', /imbriqu/iu],
  ['Mio, Kio, Mo, Ko, octets', /(?<![\p{L}])(?:Mio|Kio|Mo|Ko|octets?)(?![\p{L}])/u],
  [`seuil de l’envoi (${String(ECRITURES_MAX_PAR_LOT)})`, seuil(ECRITURES_MAX_PAR_LOT)],
  [`seuil des corrections (${String(PROFONDEUR_MAX_CHAINE)})`, seuil(PROFONDEUR_MAX_CHAINE)],
  ['opération de la synchro (PUT, PATCH, DELETE)', /(?<![\p{L}])(?:PUT|PATCH|DELETE)(?![\p{L}])/u],
  ['valeur du code (null, undefined, NaN, [object …])', /(?<![\p{L}])(?:null|undefined|NaN)(?![\p{L}])|\[object/u],
  ['identifiant du code (camelCase)', /\p{Ll}\p{Lu}/u],
  ['anglais', /(?<![\p{L}])(?:error|invalid|unknown|column|row|not found|failed|missing)(?![\p{L}])/iu],
];

/** Nombre `n` écrit comme un humain ou un programme l'écrirait (500, 1000, 1 000, 1 000). */
function seuil(n: number): RegExp {
  const chiffres = String(n);
  const groupes = chiffres.replace(/\B(?=(\d{3})+(?!\d))/gu, '[\\s\\u00a0\\u202f]?');
  return new RegExp(`(?<![\\p{N}])${groupes}(?![\\p{N}])`, 'u');
}

/**
 * Noms de tables et de colonnes de @planif/db qui ne sont pas des mots français écrits pareil :
 * tous ceux qui ont un « _ » (ferme_id, supprime_le, refus_synchro…), et les mots d'un seul tenant
 * sans leurs accents ou sans sens pour le maraîcher (serie, evenement, quantite, horodatage, id…).
 * Les mots français identiques au nom de la colonne restent permis (date, note, campagne…).
 */
const MOTS_FRANCAIS_DU_SCHEMA = new Set([
  'assolement',
  'au',
  'avant',
  'campagne',
  'changements',
  'code',
  'date',
  'du',
  'emplacement',
  'famille',
  'ferme',
  'fin',
  'fournisseur',
  'masque',
  'membre',
  'message',
  'mode',
  'modification',
  'motif',
  'nature',
  'nom',
  'note',
  'occupation',
  'photos',
  'plantation',
  'position',
  'proposition',
  'remplace',
  'saison',
  'sorte',
  'source',
  'statut',
  'tentatives',
  'type',
  'utilisateur',
  'zone',
]);

/** Noms techniques du schéma (tables et colonnes), lus dans @planif/db. */
export const NOMS_DU_SCHEMA: readonly string[] = (() => {
  const noms = new Set<string>();
  for (const valeur of Object.values(schema) as unknown[]) {
    if (!(valeur instanceof PgTable)) continue;
    const config = getTableConfig(valeur);
    noms.add(config.name);
    for (const c of config.columns) noms.add(c.name);
  }
  return [...noms].filter((n) => !MOTS_FRANCAIS_DU_SCHEMA.has(n)).sort();
})();

const echapper = (texte: string): string => texte.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const motEntier = (mot: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])${echapper(mot)}(?![\\p{L}\\p{N}_])`, 'u');

const REGLES: readonly (readonly [string, RegExp])[] = [
  ...MOTS_INTERDITS,
  ...MOTIFS.map((m) => [`code de motif « ${m} »`, motEntier(m)] as const),
  ...NOMS_DU_SCHEMA.map((n) => [`nom du schéma « ${n} »`, motEntier(n)] as const),
];

/** Jargon trouvé dans `message` (vide : le message est propre). */
export function jargon(message: string): string[] {
  return REGLES.filter(([, r]) => r.test(message)).map(([nom]) => nom);
}

/**
 * Forme stable d'un message affiché : non vide, commence par une majuscule, finit par un point
 * (un seul), sans « : . » ni espace avant le point. Vide : la forme est bonne.
 */
export function defautsDeForme(message: string): string[] {
  const defauts: string[] = [];
  if (message.trim() === '') return ['message vide'];
  if (!/^\p{Lu}/u.test(message)) defauts.push('ne commence pas par une majuscule');
  if (!message.endsWith('.')) defauts.push('ne finit pas par un point');
  if (message.endsWith('..') && !message.endsWith('...')) defauts.push('finit par deux points');
  if (/\s\.$|:\s*\.$/u.test(message)) defauts.push('point final mal placé');
  if (message !== message.trim()) defauts.push('espaces en bord de message');
  return defauts;
}
