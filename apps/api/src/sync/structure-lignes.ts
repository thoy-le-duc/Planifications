/**
 * Règles d'une ligne du parcellaire et du catalogue de la ferme écrite par le téléphone (T10s) :
 * zone, emplacement, famille, espèce, variété, saison, assolement. Pures : ni base, ni horloge,
 * ne lèvent jamais. Ce que la base doit relire (références, ce qui sert encore) est dans
 * structure.ts.
 *
 * Le cœur (@planif/core) n'a pas de règle d'écriture pour ces tables : celles-ci reprennent
 * celles du modèle (docs/modele-donnees.md) et toutes les contraintes CHECK du schéma
 * (packages/db/src/schema.ts), avec les listes fermées de @planif/db, la lecture des dates du
 * cœur (`estDateValide`) et ses limites (`LIMITES_SAISIE.emplacements` pour `remplace`). Une
 * erreur prend la forme d'une erreur du cœur (`ErreurSaisie`) : messages.ts la traduit en
 * français, son code et son champ vont au journal.
 *
 * T28s : le placement réel (contour d'une zone, placement d'un emplacement, bâtiment) suit les
 * règles du cœur, `validerContour` et `validerPlacement`, rejouées ici sur la ligne complète ; le
 * contour reçu est borné en taille avant d'être lu.
 *
 * T32a : le profil de croissance d'une espèce de la ferme (`profil_croissance`, texte JSON ou nul)
 * suit `validerProfilCroissance` du cœur, les mêmes bornes que la base du téléphone ; il est
 * écrit sous la forme rendue par le cœur. Le régler suit les droits d'écriture d'une espèce.
 *
 * Format reçu : celui de PowerSync (packages/sync/src/schema.ts : booléen en entier 0/1, numeric
 * en nombre, dates 'AAAA-MM-JJ', tableau d'identifiants `remplace` en texte JSON) ou celui de
 * Postgres (`to_jsonb`, pour la ligne existante d'une modification) : les deux sont lus.
 */
import {
  estDateValide,
  identifiantNormalise,
  instantNormalise,
  LIMITES_SAISIE,
  TYPES_BATIMENT,
  validerContour,
  validerPlacement,
  validerProfilCroissance,
  type CodeErreurSaisie,
  type ErreurCroissance,
  type ErreurPlacement,
  type ErreurSaisie,
} from '@planif/core';
import { CATEGORIES_ESPECE, NATURES_ASSOLEMENT, SORTES_EMPLACEMENT, TYPES_ABRI, UNITES_RECOLTE } from '@planif/db';

/** Tables du parcellaire et du catalogue de T10s. */
export type TableStructure = 'zone' | 'emplacement' | 'famille' | 'espece' | 'variete' | 'saison' | 'assolement';
/** Tables écrites par le téléphone par cette voie : celles de T10s, et les bâtiments (T28s). */
export type TableEcrite = TableStructure | 'batiment';

/** Tables du parcellaire et du catalogue ouvertes au téléphone (T10s), et les bâtiments (T28s). */
export const TABLES_STRUCTURE: ReadonlySet<string> = new Set<TableEcrite>(['zone', 'emplacement', 'famille', 'espece', 'variete', 'saison', 'assolement', 'batiment']);

export const estTableStructure = (table: string): table is TableEcrite => TABLES_STRUCTURE.has(table);

/**
 * Contour reçu (texte JSON) : au plus ce nombre de caractères, vérifié AVANT de le lire (T28s) ;
 * c'est aussi la borne de la base (contour_zone_valide, migration 0025).
 */
export const CONTOUR_CARACTERES_MAX = 16_384;

/** Colonnes du placement réel (T28a, Q31) : les écrire est réservé au gérant (T28s). */
export const COLONNES_PLACEMENT_EMPLACEMENT = ['placement_x_m', 'placement_y_m', 'orientation_deg'] as const;

/** Colonnes écrites (sans cree_le ni modifie_le, remplies par le serveur). */
export const COLONNES_STRUCTURE: Readonly<Record<TableEcrite, readonly string[]>> = {
  zone: ['id', 'ferme_id', 'nom', 'zone_parente_id', 'type_abri', 'surface_m2', 'contour', 'supprime_le'],
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
    ...COLONNES_PLACEMENT_EMPLACEMENT,
    'supprime_le',
  ],
  famille: ['id', 'ferme_id', 'nom', 'delai_retour_minimal_ans', 'delai_retour_conseille_ans', 'supprime_le'],
  espece: [
    'id',
    'ferme_id',
    'famille_id',
    'nom',
    'categorie',
    'perenne',
    'unite_recolte',
    'delai_retour_minimal_ans',
    'delai_retour_conseille_ans',
    'profil_croissance',
    'supprime_le',
  ],
  variete: ['id', 'ferme_id', 'espece_id', 'nom', 'fournisseur', 'poids_mille_graines_g', 'taux_germination', 'supprime_le'],
  saison: ['id', 'ferme_id', 'nom', 'debut', 'fin', 'supprime_le'],
  assolement: ['id', 'ferme_id', 'saison_id', 'zone_id', 'emplacement_id', 'famille_id', 'espece_id', 'nature', 'source_import', 'supprime_le'],
  batiment: ['id', 'ferme_id', 'nom', 'type', 'longueur_m', 'largeur_m', 'hauteur_m', 'centre_x_m', 'centre_y_m', 'orientation_deg', 'zone_id', 'supprime_le'],
};

/** Colonnes tolérées et ignorées (remplies par le serveur). */
const COLONNES_IGNOREES = ['cree_le', 'modifie_le'];

/**
 * Plafonds d'une ligne de structure, bornes comprises : ils arrêtent une faute de frappe (1e308 m),
 * pas une grande ferme. Le texte suit la cellule de l'import (T14 : 200 caractères au plus).
 */
export const PLAFONDS_STRUCTURE = {
  texteCaracteres: 200,
  /** Longueur d'un emplacement (10 km). */
  longueurM: 10_000,
  /** Largeur d'un emplacement. */
  largeurM: 1_000,
  /** Surface d'une zone (1 000 ha). */
  surfaceM2: 10_000_000,
  /** Places d'une gouttière. */
  nombrePlaces: 1_000_000,
  /** Délai de retour d'une famille ou d'une espèce (années). */
  delaiRetourAns: 100,
  /** Poids de mille graines (g). */
  poidsMilleGrainesG: 100_000,
  /** Emplacements remplacés : autant que les emplacements d'un événement. */
  remplace: LIMITES_SAISIE.emplacements,
} as const;

/** Dates d'un emplacement ou d'une saison : un passé importé peut remonter loin. */
const DATE_MIN = '1900-01-01';
const DATE_MAX = '2100-12-31';

export type Ligne = Readonly<Record<string, unknown>>;

/**
 * Ligne relue, ou la première erreur. `placement` : l'erreur d'une règle du placement réel
 * (validerPlacement, validerContour de @planif/core), `croissance` : celle d'une règle du profil
 * de croissance (validerProfilCroissance, T32a) ; leur message affiché est plus précis
 * (messages.ts) ; `erreur` en garde alors le code et le champ pour le journal.
 */
export type ResultatStructure =
  | { readonly ok: true; readonly ligne: Ligne }
  | { readonly ok: false; readonly erreur: ErreurSaisie; readonly placement?: ErreurPlacement; readonly croissance?: ErreurCroissance };

/** Levée par un lecteur pour arrêter la lecture : l'erreur de la ligne. */
class Refusee extends Error {
  readonly erreur: ErreurSaisie;
  readonly placement: ErreurPlacement | undefined;
  readonly croissance: ErreurCroissance | undefined;
  constructor(erreur: ErreurSaisie, precise?: { readonly placement?: ErreurPlacement; readonly croissance?: ErreurCroissance }) {
    super(erreur.message);
    this.erreur = erreur;
    this.placement = precise?.placement;
    this.croissance = precise?.croissance;
  }
}

function arreter(code: CodeErreurSaisie, champ: string | null, message: string): never {
  throw new Refusee({ code, champ, message });
}

/** Arrête la lecture sur une règle du placement réel (code du cœur gardé pour le journal). */
function arreterPlacement(erreur: ErreurPlacement): never {
  throw new Refusee({ code: 'champ_invalide', champ: erreur.champ ?? 'placement', message: erreur.message }, { placement: erreur });
}

/** Arrête la lecture sur une règle du profil de croissance (T32a ; code du cœur gardé pour le journal). */
function arreterCroissance(c: string, erreur: ErreurCroissance): never {
  throw new Refusee({ code: 'champ_invalide', champ: erreur.champ === null ? c : `${c}.${erreur.champ}`, message: erreur.message }, { croissance: erreur });
}

const absent = (v: unknown): v is null | undefined => v === undefined || v === null;

/** Lecteurs d'une ligne reçue : chacun rend la valeur à écrire, ou arrête la lecture. */
function lecteurs(l: Ligne) {
  const brut = (c: string): unknown => l[c];

  function id(c: string, obligatoire: boolean): string | null {
    const v = brut(c);
    if (absent(v)) return obligatoire ? arreter('champ_manquant', c, `${c} manquant`) : null;
    return identifiantNormalise(v) ?? arreter('champ_invalide', c, `${c} : identifiant invalide`);
  }

  /** Texte : obligatoire et non blanc, ou facultatif (blanc lu comme absent). */
  function texte(c: string, obligatoire: boolean): string | null {
    const v = brut(c);
    if (typeof v === 'string' && v.includes('\u0000')) return arreter('champ_invalide', c, `${c} : caractère interdit`);
    if (absent(v) || (typeof v === 'string' && v.trim() === '')) return obligatoire ? arreter('champ_manquant', c, `${c} manquant`) : null;
    if (typeof v !== 'string') return arreter('champ_invalide', c, `${c} : texte attendu`);
    if (v.length > PLAFONDS_STRUCTURE.texteCaracteres) return arreter('trop_long', c, `${c} trop long`);
    return v;
  }

  function choix(c: string, liste: readonly string[]): string {
    const v = brut(c);
    if (absent(v)) return arreter('champ_manquant', c, `${c} manquant`);
    if (typeof v !== 'string' || !liste.includes(v)) return arreter('champ_invalide', c, `${c} inconnu`);
    return v;
  }

  /** Nombre strictement positif, au plus `max`. */
  function positif(c: string, obligatoire: boolean, max: number): number | null {
    const v = brut(c);
    if (absent(v)) return obligatoire ? arreter('champ_manquant', c, `${c} manquant`) : null;
    if (typeof v !== 'number' || !Number.isFinite(v)) return arreter('champ_invalide', c, `${c} : nombre attendu`);
    if (v <= 0) return arreter('hors_bornes', c, `${c} : doit être positif`);
    if (v > max) return arreter('plafond_depasse', c, `${c} : au plus ${String(max)}`);
    return v;
  }

  function entier(c: string, obligatoire: boolean, min: number, max: number): number | null {
    const v = brut(c);
    if (absent(v)) return obligatoire ? arreter('champ_manquant', c, `${c} manquant`) : null;
    if (typeof v !== 'number' || !Number.isInteger(v)) return arreter('champ_invalide', c, `${c} : nombre entier attendu`);
    if (v < min || v > max) return arreter('hors_bornes', c, `${c} : de ${String(min)} à ${String(max)}`);
    return v;
  }

  /** Booléen : true/false (Postgres) ou 1/0 (PowerSync). */
  function booleen(c: string): boolean {
    const v = brut(c);
    if (absent(v)) return arreter('champ_manquant', c, `${c} manquant`);
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    return arreter('champ_invalide', c, `${c} : oui ou non attendu`);
  }

  function date(c: string, obligatoire: boolean): string | null {
    const v = brut(c);
    if (absent(v)) return obligatoire ? arreter('champ_manquant', c, `${c} manquant`) : null;
    if (typeof v !== 'string' || !estDateValide(v)) return arreter('champ_invalide', c, `${c} : date invalide`);
    if (v < DATE_MIN || v > DATE_MAX) return arreter('hors_bornes', c, `${c} : de ${DATE_MIN} à ${DATE_MAX}`);
    return v;
  }

  /** Suppression douce : instant complet avec fuseau, rendu en ISO (UTC), ou null. */
  function instant(c: string): string | null {
    const v = brut(c);
    if (absent(v)) return null;
    // Format partagé avec la porte du téléphone (@planif/core, T28s) : pas de 30 février.
    return instantNormalise(v) ?? arreter('champ_invalide', c, `${c} : instant invalide`);
  }

  /** Liste d'identifiants : texte JSON (PowerSync) ou tableau (Postgres), sans doublon. */
  function identifiants(c: string, max: number): string[] {
    let v = brut(c);
    if (absent(v)) return [];
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v) as unknown;
      } catch {
        return arreter('json_illisible', c, `${c} illisible`);
      }
    }
    if (!Array.isArray(v)) return arreter('champ_invalide', c, `${c} : liste attendue`);
    if (v.length > max) return arreter('trop_nombreux', c, `${c} : ${String(max)} au plus`);
    const ids = v.map((x: unknown) => identifiantNormalise(x) ?? arreter('champ_invalide', c, `${c} : identifiant invalide`));
    if (new Set(ids).size !== ids.length) return arreter('doublon', c, `${c} : identifiant en double`);
    return ids;
  }

  /**
   * Contour d'une zone (T28s) : texte JSON (PowerSync ; la ligne existante d'une modification y
   * est remise par structure.ts) de CONTOUR_CARACTERES_MAX caractères au plus, mesuré avant de le
   * lire ; tout autre forme (tableau forgé…) est refusée sans être parcourue. Puis validerContour
   * du cœur : rendu en sens antihoraire, x et y seulement. null : zone pas placée.
   */
  function contour(c: string): unknown {
    const v = brut(c);
    if (absent(v)) return null;
    if (typeof v !== 'string') return arreter('champ_invalide', c, `${c} : texte attendu`);
    if (v.length > CONTOUR_CARACTERES_MAX) return arreter('trop_volumineux', c, `${c} trop volumineux`);
    let lu: unknown;
    try {
      lu = JSON.parse(v) as unknown;
    } catch {
      return arreter('json_illisible', c, `${c} illisible`);
    }
    const r = validerContour(lu);
    if (!r.ok) return arreterPlacement({ ...r.erreur, champ: c });
    return r.valeur;
  }

  /**
   * Profil de croissance d'une espèce (T32a) : texte JSON (PowerSync ; la ligne existante d'une
   * modification y est remise par structure.ts), ou nul (profil par défaut). Tout le reste, la
   * longueur (mesurée avant de le lire) et les bornes, est la règle du cœur.
   */
  function profilCroissance(c: string): unknown {
    const v = brut(c);
    if (absent(v)) return null;
    if (typeof v !== 'string') return arreter('champ_invalide', c, `${c} : texte attendu`);
    const r = validerProfilCroissance(v);
    if (!r.ok) return arreterCroissance(c, r.erreur);
    return r.valeur;
  }

  return { id, texte, choix, positif, entier, booleen, date, instant, identifiants, contour, profilCroissance };
}

type Lecteurs = ReturnType<typeof lecteurs>;

/** Délais de retour (minimal ≤ conseillé), obligatoires (famille) ou ensemble ou pas du tout (espèce). */
function delais(lire: Lecteurs, obligatoires: boolean): { readonly minimal: number | null; readonly conseille: number | null } {
  const max = PLAFONDS_STRUCTURE.delaiRetourAns;
  const minimal = lire.entier('delai_retour_minimal_ans', obligatoires, 0, max);
  const conseille = lire.entier('delai_retour_conseille_ans', obligatoires, 0, max);
  if ((minimal === null) !== (conseille === null)) return arreter('incoherent', 'delai_retour_conseille_ans', 'délais de retour : les deux ou aucun');
  if (minimal !== null && conseille !== null && conseille < minimal) {
    return arreter('incoherent', 'delai_retour_conseille_ans', 'délai conseillé plus court que le minimal');
  }
  return { minimal, conseille };
}

/** Colonnes propres à chaque table, lues sur la ligne complète (sans id, ferme_id ni supprime_le). */
const LIRE: Readonly<Record<TableEcrite, (lire: Lecteurs, id: string, entree: Ligne) => Record<string, unknown>>> = {
  zone: (lire, id) => {
    const parente = lire.id('zone_parente_id', false);
    if (parente === id) arreter('incoherent', 'zone_parente_id', 'une zone ne se contient pas elle-même');
    return {
      nom: lire.texte('nom', true),
      zone_parente_id: parente,
      type_abri: lire.choix('type_abri', TYPES_ABRI),
      surface_m2: lire.positif('surface_m2', false, PLAFONDS_STRUCTURE.surfaceM2),
      // T28s : la règle « zone abritée sans contour » demande la base (structure.ts).
      contour: lire.contour('contour'),
    };
  },
  emplacement: (lire, id, entree) => {
    const sorte = lire.choix('sorte', SORTES_EMPLACEMENT);
    const places = lire.entier('nombre_places', false, 1, PLAFONDS_STRUCTURE.nombrePlaces);
    if ((sorte === 'gouttiere') !== (places !== null)) arreter('incoherent', 'nombre_places', 'nombre de places : pour une gouttière, et seulement elle');
    const du = lire.date('actif_du', true);
    const au = lire.date('actif_au', false);
    if (du !== null && au !== null && au < du) arreter('incoherent', 'actif_au', 'fin d’activité avant son début');
    const remplace = lire.identifiants('remplace', PLAFONDS_STRUCTURE.remplace);
    if (remplace.includes(id)) arreter('incoherent', 'remplace', 'un emplacement ne se remplace pas lui-même');
    return {
      zone_id: lire.id('zone_id', true),
      code: lire.texte('code', true),
      sorte,
      longueur_m: lire.positif('longueur_m', true, PLAFONDS_STRUCTURE.longueurM),
      largeur_m: lire.positif('largeur_m', false, PLAFONDS_STRUCTURE.largeurM),
      nombre_places: places,
      actif_du: du,
      actif_au: au,
      remplace,
      // T28s : placement dans le repère de sa zone, les trois ou aucun (validerPlacement du cœur).
      ...placement(validerPlacement({ table: 'emplacement', ligne: entree })),
    };
  },
  famille: (lire) => {
    const d = delais(lire, true);
    return { nom: lire.texte('nom', true), delai_retour_minimal_ans: d.minimal, delai_retour_conseille_ans: d.conseille };
  },
  espece: (lire) => {
    const d = delais(lire, false);
    return {
      famille_id: lire.id('famille_id', true),
      nom: lire.texte('nom', true),
      categorie: lire.choix('categorie', CATEGORIES_ESPECE),
      perenne: lire.booleen('perenne'),
      unite_recolte: lire.choix('unite_recolte', UNITES_RECOLTE),
      delai_retour_minimal_ans: d.minimal,
      delai_retour_conseille_ans: d.conseille,
      profil_croissance: lire.profilCroissance('profil_croissance'),
    };
  },
  variete: (lire) => ({
    espece_id: lire.id('espece_id', true),
    nom: lire.texte('nom', true),
    fournisseur: lire.texte('fournisseur', false),
    poids_mille_graines_g: lire.positif('poids_mille_graines_g', false, PLAFONDS_STRUCTURE.poidsMilleGrainesG),
    taux_germination: lire.entier('taux_germination', false, 0, 100),
  }),
  saison: (lire) => {
    const debut = lire.date('debut', true);
    const fin = lire.date('fin', true);
    if (debut !== null && fin !== null && fin < debut) arreter('incoherent', 'fin', 'la saison finit avant de commencer');
    return { nom: lire.texte('nom', true), debut, fin };
  },
  assolement: (lire) => {
    const zone = lire.id('zone_id', false);
    const emplacement = lire.id('emplacement_id', false);
    if ((zone === null) === (emplacement === null)) arreter('incoherent', 'emplacement_id', 'assolement : une zone ou un emplacement, pas les deux');
    const nature = lire.choix('nature', NATURES_ASSOLEMENT);
    const source = lire.texte('source_import', false);
    if (source !== null && nature !== 'passe_importe') arreter('incoherent', 'source_import', 'origine d’import pour un assolement importé seulement');
    return {
      saison_id: lire.id('saison_id', true),
      zone_id: zone,
      emplacement_id: emplacement,
      famille_id: lire.id('famille_id', true),
      espece_id: lire.id('espece_id', false),
      nature,
      source_import: source,
    };
  },
  // T28s : un bâtiment, toujours placé (validerPlacement du cœur : dimensions, centre, orientation).
  batiment: (lire, _id, entree) => ({
    nom: lire.texte('nom', true),
    type: lire.choix('type', TYPES_BATIMENT),
    ...placement(validerPlacement({ table: 'batiment', ligne: entree })),
    zone_id: lire.id('zone_id', false),
  }),
};

/** Valeur d'une règle du placement (cœur), ou arrêt de la lecture sur son erreur. */
function placement<T>(r: { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurPlacement }): T {
  return r.ok ? r.valeur : arreterPlacement(r.erreur);
}

/**
 * Ligne complète `entree` (pour une modification : ligne existante + colonnes reçues) de `table`
 * relue et rendue aux colonnes de Postgres (COLONNES_STRUCTURE), ou la première erreur.
 */
export function validerStructure(table: TableEcrite, entree: Ligne): ResultatStructure {
  try {
    const autorisees = new Set([...COLONNES_STRUCTURE[table], ...COLONNES_IGNOREES]);
    const inconnue = Object.keys(entree).find((c) => !autorisees.has(c));
    if (inconnue !== undefined) arreter('colonne_inconnue', inconnue.slice(0, 40), 'colonne inconnue');
    const lire = lecteurs(entree);
    const id = lire.id('id', true) ?? '';
    const fermeId = lire.id('ferme_id', true);
    const propres = LIRE[table](lire, id, entree);
    const supprimeLe = lire.instant('supprime_le');
    return { ok: true, ligne: { id, ferme_id: fermeId, ...propres, supprime_le: supprimeLe } };
  } catch (e) {
    if (e instanceof Refusee) {
      if (e.placement !== undefined) return { ok: false, erreur: e.erreur, placement: e.placement };
      if (e.croissance !== undefined) return { ok: false, erreur: e.erreur, croissance: e.croissance };
      return { ok: false, erreur: e.erreur };
    }
    return { ok: false, erreur: { code: 'entree_invalide', champ: null, message: 'ligne illisible' } };
  }
}
