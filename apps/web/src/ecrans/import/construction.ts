/**
 * Ce que l'import écrirait (T14b), à partir du plan du moteur de T14 et de ce que la base locale
 * sait déjà (ContexteBase) : lignes de la base, doublons contre la base, références de la ferme,
 * et les règles que le serveur rejoue à la synchro (même validation : `validerSerie`,
 * `validerOccupation`, `validerItineraire` du cœur ; colonnes obligatoires et plafonds du
 * parcellaire, T10s). Une ligne que le serveur refuserait est en erreur dans l'aperçu, jamais
 * écrite. Pur : identifiants UUID v7 tirés de l'instant de l'import.
 *
 * Ordre des écritures (références avant ceux qui s'y rapportent) : saisons, zones (parentes
 * d'abord), emplacements, familles, espèces, variétés, itinéraires, séries (chacune avec son
 * occupation, dans le même lot), assolements. Découpe en lots : @planif/sync/import.
 */
import {
  calculerDatesSerie,
  creerGenerateurId,
  ecartEnJours,
  FAMILLES_PAR_DEFAUT,
  validerItineraire,
  validerOccupation,
  validerSerie,
  type AncreSerie,
  type Cellule,
  type CleChamp,
  type DateCalendaire,
  type GenerateurId,
  type LigneBrute,
  type LignePlan,
  type ParametresDatesSerie,
  type PlanImport,
  type ReferenceImport,
  type ValeurImport,
} from '@planif/core';
import { decouperEnLots, ordreInsertion, type LigneAEcrire } from '@planif/sync/import';
import type { OrdreEcriture } from '@planif/sync';
import { normaliser } from './normaliser.ts';
import type { Apercu, DemandePreparation, EmplacementConnu, ErreurAffichee, ItineraireConnu, LigneApercu, StatutApercu } from './types.ts';

/** Colonnes écrites par table (schéma local, packages/sync/src/schema.ts). */
export const COLONNES: Readonly<Record<string, readonly string[]>> = {
  saison: ['id', 'ferme_id', 'nom', 'debut', 'fin', 'cree_le', 'modifie_le', 'supprime_le'],
  zone: ['id', 'ferme_id', 'nom', 'zone_parente_id', 'type_abri', 'surface_m2', 'cree_le', 'modifie_le', 'supprime_le'],
  emplacement: ['id', 'ferme_id', 'zone_id', 'code', 'sorte', 'longueur_m', 'largeur_m', 'nombre_places', 'actif_du', 'actif_au', 'remplace', 'cree_le', 'modifie_le', 'supprime_le'],
  famille: ['id', 'ferme_id', 'nom', 'delai_retour_minimal_ans', 'delai_retour_conseille_ans', 'cree_le', 'modifie_le', 'supprime_le'],
  espece: ['id', 'ferme_id', 'famille_id', 'nom', 'categorie', 'perenne', 'unite_recolte', 'delai_retour_minimal_ans', 'delai_retour_conseille_ans', 'cree_le', 'modifie_le', 'supprime_le'],
  variete: ['id', 'ferme_id', 'espece_id', 'nom', 'fournisseur', 'poids_mille_graines_g', 'taux_germination', 'cree_le', 'modifie_le', 'supprime_le'],
  itineraire: ['id', 'ferme_id', 'espece_id', 'variete_id', 'nom', 'mode', 'parametres', 'cree_le', 'modifie_le', 'supprime_le'],
  serie: [
    'id',
    'ferme_id',
    'saison_id',
    'espece_id',
    'variete_id',
    'itineraire_id',
    'parametres',
    'ancre_type',
    'ancre_date',
    'prevu_semis_pepiniere',
    'prevu_mise_en_place',
    'prevu_debut_recolte',
    'prevu_fin_recolte',
    'longueur_m',
    'nombre_plants',
    'statut',
    'rotation_acceptee',
    'cree_le',
    'modifie_le',
    'supprime_le',
  ],
  occupation: [
    'id',
    'ferme_id',
    'emplacement_id',
    'serie_id',
    'plantation_id',
    'evenement_id',
    'longueur_m',
    'nombre_places',
    'position_m',
    'prevu_du',
    'prevu_au',
    'reel_du',
    'reel_au',
    'cree_le',
    'modifie_le',
    'supprime_le',
  ],
  assolement: ['id', 'ferme_id', 'saison_id', 'zone_id', 'emplacement_id', 'famille_id', 'espece_id', 'nature', 'source_import', 'cree_le', 'modifie_le', 'supprime_le'],
};


/** Plafonds du parcellaire (serveur, T10s) et des séries (cœur, Q21). */
const PLAFONDS = { longueurM: 10_000, largeurM: 1_000, surfaceM2: 10_000_000, nombrePlaces: 1_000_000, texte: 200 } as const;

/** Délais de retour d'une famille créée par l'import, quand la bibliothèque n'en a pas de même nom (modifiables ensuite). */
const DELAIS_FAMILLE_NOUVELLE = { minimal: 3, conseille: 4 } as const;

/** Paramètres d'un itinéraire créé par l'import, au-delà de ce que dit le fichier (mêmes valeurs que le formulaire de T24). */
const PARAMETRES_COMMUNS = { periodeUsage: null, typeAbri: null, margeSecurite: 10, rendementAttendu: null, perenne: null } as const;
const DENSITE_PAR_DEFAUT = { rangsParPlanche: 1, ecartementSurRangCm: 30 } as const;
/** Longueur d'une série importée sans longueur, sans nombre de plants et sans emplacement. */
export const LONGUEUR_PAR_DEFAUT_M = 1;
const CLES_DU_MODE = ['dureePepiniereJours', 'grainesParMotte', 'plantsParMotte', 'pertePepiniere', 'alveolesParPlaque', 'grainesParPoquet'];

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Objet = Record<string, unknown>;
type Mode = 'semis_direct' | 'plant_maison' | 'plant_achete';

export interface EntreeConstruction {
  readonly demande: DemandePreparation;
  readonly lignes: readonly LigneBrute[];
  readonly ligneEntete: number;
  readonly colonneDe: ReadonlyMap<CleChamp, number>;
}

/** Une ligne du plan une fois relue contre la base. */
interface Issue {
  statut: StatutApercu;
  erreurs: ErreurAffichee[];
  avertissements: string[];
  doublonDe: number | null;
  resume: string;
}

class Refus extends Error {
  readonly champ: CleChamp | null;
  constructor(message: string, champ: CleChamp | null) {
    super(message);
    this.champ = champ;
  }
}

const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);

function lireJson(texte: string): Objet | null {
  try {
    const v: unknown = JSON.parse(texte);
    return estObjet(v) ? v : null;
  } catch {
    return null;
  }
}

const texte = (v: ValeurImport | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const nombreDe = (v: ValeurImport | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const reference = (v: ValeurImport | undefined): ReferenceImport | null => (typeof v === 'object' && v !== null ? v : null);
const date = (v: ValeurImport | undefined): DateCalendaire | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? (v as DateCalendaire) : null);

type SorteDefaut = Apercu['defauts'][number]['sorte'];

interface Defaut {
  readonly sorte: SorteDefaut;
  /** Texte de l'avertissement sur la ligne. */
  readonly surLaLigne: string;
  /** Texte dans l'encart « valeurs par défaut ». */
  readonly dansEncart: string;
}

interface Marques {
  readonly ecritures: number;
  readonly saisons: number;
  readonly especes: number;
  readonly familles: number;
  readonly varietes: number;
  readonly itineraires: number;
}

/** Tout ce que l'import crée, et dans quel ordre. */
class Ecritures {
  readonly saisons: OrdreEcriture[][] = [];
  readonly zones: { readonly profondeur: number; readonly ordre: OrdreEcriture }[] = [];
  readonly emplacements: OrdreEcriture[][] = [];
  readonly familles: OrdreEcriture[][] = [];
  readonly especes: OrdreEcriture[][] = [];
  readonly varietes: OrdreEcriture[][] = [];
  readonly itineraires: OrdreEcriture[][] = [];
  readonly paires: OrdreEcriture[][] = [];
  readonly seriesSeules: OrdreEcriture[][] = [];
  readonly assolements: OrdreEcriture[][] = [];
  readonly creees: Record<string, string[]> = {};
  ecritures = 0;

  /** Où en sont les listes que plusieurs lignes partagent (pour retirer ce qu'une ligne en erreur avait préparé). */
  marques(): Marques {
    return { ecritures: this.ecritures, saisons: this.saisons.length, especes: this.especes.length, familles: this.familles.length, varietes: this.varietes.length, itineraires: this.itineraires.length };
  }

  noter(table: string, id: string, n = 1): void {
    (this.creees[table] ??= []).push(id);
    this.ecritures += n;
  }

  groupes(): OrdreEcriture[][] {
    const zones = [...this.zones].sort((a, b) => a.profondeur - b.profondeur).map((z) => [z.ordre]);
    return [...this.saisons, ...zones, ...this.emplacements, ...this.familles, ...this.especes, ...this.varietes, ...this.itineraires, ...this.paires, ...this.seriesSeules, ...this.assolements];
  }
}

export function construire(plan: PlanImport, e: EntreeConstruction): { readonly apercu: Apercu; readonly lots: OrdreEcriture[][] } {
  const d = e.demande;
  const ctx = d.contexte;
  const ferme = ctx.fermeId;
  const instant = d.maintenant;
  const horloge = Date.parse(instant);
  const nouvelId: GenerateurId = creerGenerateurId({
    horloge: () => (Number.isFinite(horloge) ? horloge : Date.now()),
    aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
  });
  const horo = { cree_le: instant, modifie_le: instant, supprime_le: null };
  const ecr = new Ecritures();
  const inserer = (table: string, ligne: LigneAEcrire): OrdreEcriture => ordreInsertion(table, COLONNES[table] ?? [], { ...ligne, ...horo });

  // ── Cellule fautive (lignes[ligne − 1][colonne]) ; une zone reprise : la cellule où elle est écrite.
  const colZone = e.colonneDe.get('zone');
  const colSousZone = e.colonneDe.get('sous_zone');
  const celluleTexte = (c: Cellule | undefined): string => (c === null || c === undefined ? '' : String(c));
  function cellule(numero: number, colonne: number | null): string | null {
    if (colonne === null) return null;
    const ici = celluleTexte(e.lignes[numero - 1]?.[colonne]);
    if (ici.trim() !== '' || plan.type !== 'parcellaire' || (colonne !== colZone && colonne !== colSousZone)) return ici;
    for (let i = numero - 2; i > e.ligneEntete; i--) {
      const t = celluleTexte(e.lignes[i]?.[colonne]);
      if (t.trim() !== '') return t;
    }
    return ici;
  }
  const colonne = (champ: CleChamp | null): number | null => (champ === null ? null : (e.colonneDe.get(champ) ?? null));

  // ── Références de la base ───────────────────────────────────────────────────────────────────
  const especes = new Map(ctx.especes.map((x) => [x.id, x]));
  const famillesParNom = new Map(ctx.familles.map((x) => [normaliser(x.nom), x.id]));
  const nomEspece = (id: string): string => especes.get(id)?.nom ?? nouvellesEspeces.get(id)?.nom ?? '';

  // Saisons : par nom 'AAAA', sinon celle qui contient la date ; créées au besoin.
  const saisonsCreees = new Map<number, string>();
  function saisonDe(annee: number, jour: string): string {
    const existante = ctx.saisons.find((s) => s.nom.trim() === String(annee)) ?? ctx.saisons.find((s) => s.debut <= jour && jour <= s.fin);
    if (existante !== undefined) return existante.id;
    const deja = saisonsCreees.get(annee);
    if (deja !== undefined) return deja;
    const id = nouvelId<'Saison'>();
    saisonsCreees.set(annee, id);
    ecr.saisons.push([inserer('saison', { id, ferme_id: ferme, nom: String(annee), debut: `${String(annee)}-01-01`, fin: `${String(annee)}-12-31` })]);
    ecr.noter('saison', id);
    return id;
  }

  // Valeurs par défaut écrites par la ligne en cours (relecture B1) : montrées sur la ligne et
  // dans l'encart de l'aperçu, jamais en douce.
  let defautsLigne: Defaut[] = [];
  const encart = new Map<SorteDefaut, Set<string>>();
  const noterDefaut = (sorte: SorteDefaut, surLaLigne: string, dansEncart: string): void => {
    defautsLigne.push({ sorte, surLaLigne, dansEncart });
  };

  // Familles et espèces nouvelles (décision « Créer »), une par nom.
  const famillesCreees = new Map<string, string>();
  function familleDe(r: ReferenceImport | null): string | null {
    if (r === null || r.sorte === 'a_decider') return null;
    if (r.sorte === 'existante') return r.id;
    const k = normaliser(r.nom);
    const connue = famillesParNom.get(k);
    if (connue !== undefined) return connue;
    const deja = famillesCreees.get(k);
    if (deja !== undefined) return deja;
    const defaut = FAMILLES_PAR_DEFAUT.find((f) => normaliser(f.nom) === k);
    if (defaut === undefined) {
      const { minimal, conseille } = DELAIS_FAMILLE_NOUVELLE;
      noterDefaut(
        'delais-famille',
        `famille « ${r.nom.trim()} » : délais de retour ${String(minimal)} ans (minimal) et ${String(conseille)} ans (conseillé) par défaut`,
        `${r.nom.trim()} : ${String(minimal)} ans et ${String(conseille)} ans`,
      );
    }
    const id = nouvelId<'Famille'>();
    famillesCreees.set(k, id);
    ecr.familles.push([
      inserer('famille', {
        id,
        ferme_id: ferme,
        nom: r.nom.trim(),
        delai_retour_minimal_ans: defaut?.delaiRetourMinimalAns ?? DELAIS_FAMILLE_NOUVELLE.minimal,
        delai_retour_conseille_ans: defaut?.delaiRetourConseilleAns ?? DELAIS_FAMILLE_NOUVELLE.conseille,
      }),
    ]);
    ecr.noter('famille', id);
    return id;
  }

  const nouvellesEspeces = new Map<string, { readonly nom: string; readonly familleId: string }>();
  const attributsParNom = new Map(Object.entries(d.attributsEspeces).map(([nom, a]) => [normaliser(nom), a]));
  const especesParNom = new Map<string, string>();
  for (const x of ctx.especes) if (!especesParNom.has(normaliser(x.nom))) especesParNom.set(normaliser(x.nom), x.id);
  const especesCreees = new Map<string, string>();
  /** Espèce de la ligne ; une nouvelle est créée avec sa famille (obligatoire). */
  function especeDe(r: ReferenceImport | null, famille: ReferenceImport | null): string | null {
    if (r === null || r.sorte === 'a_decider') return null;
    if (r.sorte === 'existante') return r.id;
    const k = normaliser(r.nom);
    const deja = especesCreees.get(k) ?? especesParNom.get(k);
    if (deja !== undefined) return deja;
    const attributs = attributsParNom.get(k);
    if (attributs === undefined) throw new Refus(`Culture nouvelle « ${r.nom.trim()} » : choisissez sa catégorie, si elle est pérenne et son unité de récolte (étape « Valeurs »).`, 'espece');
    const familleId = familleDe(famille);
    if (familleId === null) throw new Refus(`Culture nouvelle « ${r.nom.trim()} » : il faut sa famille botanique (importez d’abord vos cultures avec une colonne Famille).`, 'espece');
    const id = nouvelId<'Espece'>();
    especesCreees.set(k, id);
    nouvellesEspeces.set(id, { nom: r.nom.trim(), familleId });
    ecr.especes.push([
      inserer('espece', {
        id,
        ferme_id: ferme,
        famille_id: familleId,
        nom: r.nom.trim(),
        categorie: attributs.categorie,
        perenne: attributs.perenne,
        unite_recolte: attributs.uniteRecolte,
        delai_retour_minimal_ans: null,
        delai_retour_conseille_ans: null,
      }),
    ]);
    ecr.noter('espece', id);
    return id;
  }

  // Variétés : reprises par nom (sans casse ni accents) pour l'espèce ; un identifiant n'est repris
  // que s'il existe ; sinon créées pour la ferme.
  const varietesCreees = new Map<string, string>();
  function varieteDe(nom: string | null, especeId: string, pmg: number | null): string | null {
    if (nom === null) return null;
    if (MOTIF_UUID.test(nom.trim())) {
      const v = ctx.varietes.find((x) => x.id.toLowerCase() === nom.trim().toLowerCase() && x.especeId === especeId);
      if (v === undefined) noterDefaut('variete-inconnue', `variété inconnue (identifiant ${nom.trim().slice(0, 13)}…) : série écrite sans variété`, `${nom.trim()} : sans variété`);
      return v?.id ?? null;
    }
    const k = normaliser(nom);
    const connue = ctx.varietes.find((x) => x.especeId === especeId && normaliser(x.nom) === k);
    if (connue !== undefined) return connue.id;
    const cle = `${especeId}\u0001${k}`;
    const deja = varietesCreees.get(cle);
    if (deja !== undefined) return deja;
    const id = nouvelId<'Variete'>();
    varietesCreees.set(cle, id);
    ecr.varietes.push([
      inserer('variete', { id, ferme_id: ferme, espece_id: especeId, nom: nom.trim(), fournisseur: null, poids_mille_graines_g: pmg, taux_germination: null }),
    ]);
    ecr.noter('variete', id);
    return id;
  }

  const caches = { saisonsCreees, especesCreees, nouvellesEspeces, famillesCreees, varietesCreees };

  // ── Emplacements et zones de la ferme ───────────────────────────────────────────────────────
  const emplacementsParCode = new Map<string, EmplacementConnu>();
  for (const x of ctx.emplacements) if (!emplacementsParCode.has(normaliser(x.code))) emplacementsParCode.set(normaliser(x.code), x);
  const zonesParCle = new Map<string, string>();
  const zonesParNom = new Map<string, string>();
  const profondeurDe = new Map<string, number>();
  for (const z of ctx.zones) {
    zonesParCle.set(`${z.parenteId ?? ''}\u0001${normaliser(z.nom)}`, z.id);
    if (!zonesParNom.has(normaliser(z.nom)) || z.parenteId === null) zonesParNom.set(normaliser(z.nom), z.id);
  }

  const issues = new Map<number, Issue>();
  const resumeDe = (l: LignePlan): string =>
    Object.values(l.valeurs)
      .map((v) => (v === null ? '' : typeof v === 'object' ? (v.sorte === 'existante' ? (especes.get(v.id)?.nom ?? ctx.familles.find((f) => f.id === v.id)?.nom ?? '') : v.sorte === 'nouvelle' ? v.nom : v.valeur) : String(v)))
      .filter((t) => t !== '')
      .slice(0, 5)
      .join(' · ');

  const erreurLigne = (l: LignePlan, r: Refus): void => {
    defautsLigne = [];
    issues.set(l.ligne, { statut: 'erreur', erreurs: [{ message: r.message, cellule: cellule(l.ligne, colonne(r.champ)) }], avertissements: [], doublonDe: null, resume: resumeDe(l) });
  };
  const doublonBase = (l: LignePlan, de: number | null = null): void => {
    defautsLigne = [];
    issues.set(l.ligne, { statut: 'doublon', erreurs: [], avertissements: [], doublonDe: de, resume: resumeDe(l) });
  };
  const valide = (l: LignePlan, avertissements: string[] = []): void => {
    const parDefaut = defautsLigne.map((x) => `${x.surLaLigne} : à vérifier`);
    for (const x of defautsLigne) {
      const liste = encart.get(x.sorte) ?? new Set<string>();
      liste.add(x.dansEncart);
      encart.set(x.sorte, liste);
    }
    defautsLigne = [];
    issues.set(l.ligne, { statut: 'valide', erreurs: [], avertissements: [...(l.avertissements ?? []).map((a) => a.message), ...avertissements, ...parDefaut], doublonDe: null, resume: resumeDe(l) });
  };

  const anneeImport = d.anneeSaison ?? new Date(Number.isFinite(horloge) ? horloge : Date.now()).getUTCFullYear();

  // ── Par type ────────────────────────────────────────────────────────────────────────────────
  const lignesValides = plan.lignes.filter((l) => l.statut === 'valide');

  if (plan.type === 'parcellaire') {
    const codesDuFichier = new Map<string, number>();
    /** Zone (reprise ou créée) de nom `nom` sous `parente`. */
    function zone(nom: string, parente: string | null, abri: string | null, surface: number | null, profondeur: number): string {
      const k = `${parente ?? ''}\u0001${normaliser(nom)}`;
      const connue = zonesParCle.get(k) ?? (parente === null ? zonesParNom.get(normaliser(nom)) : undefined);
      if (connue !== undefined) return connue;
      if (abri === null) noterDefaut('abri', `zone « ${nom.trim()} » : plein champ par défaut`, `${nom.trim()} : plein champ`);
      const id = nouvelId<'Zone'>();
      zonesParCle.set(k, id);
      profondeurDe.set(id, profondeur);
      ecr.zones.push({ profondeur, ordre: inserer('zone', { id, ferme_id: ferme, nom: nom.trim(), zone_parente_id: parente, type_abri: abri ?? 'plein_champ', surface_m2: surface }) });
      ecr.noter('zone', id);
      return id;
    }
    const zoneExiste = (nom: string, parente: string | null): string | undefined =>
      zonesParCle.get(`${parente ?? ''}\u0001${normaliser(nom)}`) ?? (parente === null ? zonesParNom.get(normaliser(nom)) : undefined);

    for (const l of lignesValides) {
      const v = l.valeurs;
      try {
        const nomZone = texte(v.zone);
        if (nomZone === null) throw new Refus('Zone : valeur obligatoire manquante.', 'zone');
        const sousZone = texte(v.sous_zone);
        const code = texte(v.emplacement);
        const sorte = texte(v.sorte) ?? 'planche';
        const longueur = nombreDe(v.longueur_m);
        const largeur = nombreDe(v.largeur_m);
        const places = nombreDe(v.nombre_places);
        const surface = nombreDe(v.surface_m2);
        const abri = texte(v.type_abri);
        if (surface !== null && surface > PLAFONDS.surfaceM2) throw new Refus(`Surface : au plus ${String(PLAFONDS.surfaceM2)} m².`, 'surface_m2');
        if (code !== null) {
          if (longueur === null) throw new Refus('Longueur : obligatoire pour un emplacement.', e.colonneDe.has('longueur_m') ? 'longueur_m' : 'emplacement');
          if (longueur > PLAFONDS.longueurM) throw new Refus(`Longueur : au plus ${String(PLAFONDS.longueurM)} m.`, 'longueur_m');
          if (largeur !== null && largeur > PLAFONDS.largeurM) throw new Refus(`Largeur : au plus ${String(PLAFONDS.largeurM)} m.`, 'largeur_m');
          if (places !== null && places > PLAFONDS.nombrePlaces) throw new Refus(`Nombre de places : au plus ${String(PLAFONDS.nombrePlaces)}.`, 'nombre_places');
          if (sorte === 'gouttiere' && places === null) throw new Refus('Nombre de places : obligatoire pour une gouttière.', e.colonneDe.has('nombre_places') ? 'nombre_places' : 'sorte');
          if (sorte !== 'gouttiere' && places !== null) throw new Refus('Nombre de places : seulement pour une gouttière.', 'nombre_places');
          const k = normaliser(code);
          if (emplacementsParCode.has(k)) {
            doublonBase(l);
            continue;
          }
          const premiere = codesDuFichier.get(k);
          if (premiere !== undefined) {
            doublonBase(l, premiere);
            continue;
          }
          codesDuFichier.set(k, l.ligne);
        } else {
          const parente = zoneExiste(nomZone, null);
          if (parente !== undefined && (sousZone === null || zoneExiste(sousZone, parente) !== undefined)) {
            doublonBase(l);
            continue;
          }
        }
        const haut = zone(nomZone, null, abri, sousZone === null ? surface : null, 0);
        const bas = sousZone === null ? haut : zone(sousZone, haut, abri, surface, 1);
        if (code !== null) {
          const id = nouvelId<'Emplacement'>();
          ecr.emplacements.push([
            inserer('emplacement', {
              id,
              ferme_id: ferme,
              zone_id: bas,
              code: code.trim(),
              sorte,
              longueur_m: longueur,
              largeur_m: largeur,
              nombre_places: places,
              actif_du: `${String(anneeImport)}-01-01`,
              actif_au: null,
              remplace: '[]',
            }),
          ]);
          ecr.noter('emplacement', id);
        }
        valide(l);
      } catch (x) {
        if (x instanceof Refus) erreurLigne(l, x);
        else throw x;
      }
    }
  }

  if (plan.type === 'cultures') {
    const itinerairesDuFichier = new Map<string, number>();
    for (const l of lignesValides) {
      const v = l.valeurs;
      const marques = ecr.marques();
      try {
        const especeRef = reference(v.espece);
        const familleRef = reference(v.famille);
        const avant = ecr.ecritures;
        const especeId = especeDe(especeRef, familleRef);
        if (especeId === null) throw new Refus('Culture : valeur obligatoire manquante.', 'espece');
        const pmg = nombreDe(v.poids_mille_graines_g);
        const varieteId = varieteDe(texte(v.variete), especeId, pmg);
        const modeLu = texte(v.mode) as Mode | null;
        const pepiniere = nombreDe(v.duree_pepiniere_jours);
        const avantRecolte = nombreDe(v.duree_avant_recolte_jours);
        const fenetre = nombreDe(v.fenetre_recolte_jours);
        const rangs = nombreDe(v.rangs_par_planche);
        const ecartement = nombreDe(v.ecartement_cm);
        // T35a : seul le quinconce est écrit ; alignés ou vide → densité sans disposition.
        const quinconce = texte(v.disposition) === 'quinconce';
        const porteItineraire = modeLu !== null || pepiniere !== null || avantRecolte !== null || fenetre !== null;
        if (porteItineraire) {
          const mode: Mode | null = modeLu ?? (pepiniere !== null ? 'plant_maison' : null);
          if (mode === null) throw new Refus('Mode d’implantation : obligatoire pour un itinéraire (semis direct, plant maison ou plant acheté).', e.colonneDe.has('mode') ? 'mode' : 'espece');
          if (mode === 'plant_maison' && pepiniere === null) throw new Refus('Durée en pépinière : obligatoire pour un plant maison.', e.colonneDe.has('duree_pepiniere_jours') ? 'duree_pepiniere_jours' : 'mode');
          if (avantRecolte === null) throw new Refus('Jours avant récolte : obligatoire pour un itinéraire.', e.colonneDe.has('duree_avant_recolte_jours') ? 'duree_avant_recolte_jours' : 'espece');
          if (fenetre === null) throw new Refus('Fenêtre de récolte : obligatoire pour un itinéraire.', e.colonneDe.has('fenetre_recolte_jours') ? 'fenetre_recolte_jours' : 'espece');
          const parametres = parametresNeufs(mode, avantRecolte, fenetre, pepiniere, rangs, ecartement, quinconce);
          const pourDefauts = nomEspece(especeId);
          const cle = `${especeId}\u0001${varieteId ?? ''}\u0001${JSON.stringify(parametres)}`;
          const memeEnBase = ctx.itineraires.some(
            (i) => i.deLaFerme && i.especeId === especeId && (i.varieteId ?? null) === varieteId && memesDurees(lireJson(i.parametres), parametres),
          );
          const premiere = itinerairesDuFichier.get(cle);
          if (memeEnBase || premiere !== undefined) {
            if (ecr.ecritures === avant) {
              doublonBase(l, premiere ?? null);
              continue;
            }
          } else {
            itinerairesDuFichier.set(cle, l.ligne);
            const nomVariete = texte(v.variete);
            const nom = `${nomEspece(especeId)}${nomVariete !== null && !MOTIF_UUID.test(nomVariete) ? ` ${nomVariete.trim()}` : ''}`.slice(0, 80);
            const ligne = { id: nouvelId<'Itineraire'>(), ferme_id: ferme, espece_id: especeId, variete_id: varieteId, nom, mode, parametres: JSON.stringify(parametres) };
            const r = validerItineraire({ ...ligne }, { typesIntervention: [] });
            if (!r.ok) throw new Refus(`Itinéraire refusé : ${r.erreur.message}.`, null);
            noterDefautsParametres(parametres, { rangs, ecartement }, pourDefauts, noterDefaut);
            ecr.itineraires.push([inserer('itineraire', ligne)]);
            ecr.noter('itineraire', ligne.id);
          }
        } else if (ecr.ecritures === avant) {
          doublonBase(l);
          continue;
        }
        valide(l);
      } catch (x) {
        if (!(x instanceof Refus)) throw x;
        retirerDepuis(ecr, marques, caches);
        erreurLigne(l, x);
      }
    }
  }

  if (plan.type === 'series') {
    const seriesBase = new Set(ctx.series.flatMap((s) => (s.emplacementIds.length === 0 ? [`${s.especeId}\u0001\u0001${s.miseEnPlace}`] : s.emplacementIds.map((x) => `${s.especeId}\u0001${x}\u0001${s.miseEnPlace}`))));
    const seriesFichier = new Map<string, number>();
    const itinerairesCrees = new Map<string, ItineraireConnu>();
    /** Itinéraire de l'espèce : de la ferme d'abord, puis de la bibliothèque, puis créé par l'import. */
    const itineraireDe = (especeId: string): ItineraireConnu | undefined =>
      itinerairesCrees.get(especeId) ??
      [...ctx.itineraires].filter((i) => i.especeId === especeId).sort((a, b) => Number(b.deLaFerme) - Number(a.deLaFerme) || (a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : 0))[0];

    for (const l of lignesValides) {
      const v = l.valeurs;
      const marques = ecr.marques();
      try {
        const especeId = especeDe(reference(v.espece), null);
        if (especeId === null) throw new Refus('Culture : valeur obligatoire manquante.', 'espece');
        // Emplacement : un code d'emplacement actif de la ferme.
        const code = texte(v.emplacement);
        let emplacement: EmplacementConnu | null = null;
        if (code !== null) {
          emplacement = emplacementsParCode.get(normaliser(code)) ?? null;
          if (emplacement === null) throw new Refus(`Emplacement inconnu : « ${code.trim()} » n’est pas un emplacement de la ferme (importez d’abord le parcellaire).`, 'emplacement');
        }
        const semis = date(v.date_semis);
        const plantation = date(v.date_plantation);
        const debut = date(v.date_debut_recolte);
        const fin = date(v.date_fin_recolte);
        const itin = itineraireDe(especeId);
        const p0 = itin === undefined ? null : lireJson(itin.parametres);
        const duree = (cle: string): number | null => {
          const x = p0?.[cle];
          return typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null;
        };
        const mode0 = p0?.mode === 'semis_direct' || p0?.mode === 'plant_maison' || p0?.mode === 'plant_achete' ? p0.mode : null;

        let mode: Mode;
        let pepiniere: number | null = null;
        if (semis !== null && plantation !== null) {
          mode = 'plant_maison';
          pepiniere = ecartEnJours(semis, plantation);
        } else if (plantation !== null) {
          mode = mode0 === 'plant_maison' && duree('dureePepiniereJours') !== null ? 'plant_maison' : 'plant_achete';
          if (mode === 'plant_maison') pepiniere = duree('dureePepiniereJours');
        } else if (semis !== null) {
          mode = 'semis_direct';
        } else {
          if (mode0 === null) throw new Refus('Il faut une date de semis ou de plantation, ou un itinéraire de cette culture.', 'espece');
          mode = mode0;
          if (mode === 'plant_maison') pepiniere = duree('dureePepiniereJours');
          if (mode === 'plant_maison' && pepiniere === null) throw new Refus('Durée en pépinière inconnue pour cette culture.', 'espece');
        }
        const miseEnPlaceConnue = plantation ?? (mode === 'semis_direct' ? semis : null);
        const avertissements: string[] = [];
        let avantRecolte: number | null = miseEnPlaceConnue !== null && debut !== null ? ecartEnJours(miseEnPlaceConnue, debut) : duree('dureeAvantRecolteJours');
        if (avantRecolte === null) {
          if (miseEnPlaceConnue === null) throw new Refus('Durée avant récolte inconnue pour cette culture : ajoutez la date de plantation ou de semis.', 'espece');
          if (fin !== null) throw new Refus('Début de récolte manquant, et aucun itinéraire de cette culture ne donne la durée avant récolte.', e.colonneDe.has('date_debut_recolte') ? 'date_debut_recolte' : 'espece');
          avantRecolte = 0;
          noterDefaut('duree-recolte', 'début de récolte inconnu : à la mise en place par défaut', `${nomEspece(especeId)} : récolte dès la mise en place`);
        }
        const ancre: AncreSerie =
          plantation !== null
            ? { type: 'plantation', date: plantation }
            : semis !== null
              ? { type: 'semis', date: semis }
              : { type: 'debut_recolte', date: debut ?? fin ?? ('' as DateCalendaire) };
        if (ancre.type === 'debut_recolte' && debut === null) throw new Refus('Il faut une date de semis, de plantation ou de début de récolte.', 'espece');
        let fenetre: number | null =
          fin === null ? null : debut !== null ? ecartEnJours(debut, fin) : miseEnPlaceConnue !== null ? ecartEnJours(miseEnPlaceConnue, fin) - avantRecolte : null;
        fenetre ??= duree('fenetreRecolteJours');
        if (fenetre === null) {
          fenetre = 0;
          noterDefaut('duree-recolte', 'fin de récolte inconnue : fenêtre de 0 jour par défaut', `${nomEspece(especeId)} : fenêtre de récolte de 0 jour`);
        }
        if (fenetre < 0) throw new Refus('Fin de récolte avant le début de récolte.', 'date_fin_recolte');

        const parametres = parametresSerie(p0, mode, avantRecolte, fenetre, pepiniere);
        // Ce que les paramètres de la série prennent par défaut (ni le fichier, ni l'itinéraire).
        noterDefautsParametres(parametres, p0 === null ? { rangs: null, ecartement: null } : null, nomEspece(especeId), noterDefaut, p0?.mode === mode ? p0 : null);
        const datesP = parametres as unknown as ParametresDatesSerie;
        const dates = calculerDatesSerie(datesP, ancre);
        const miseEnPlace = dates.miseEnPlace;

        // Doublons : une série active de même espèce, même emplacement, même mise en place.
        const cleDoublon = `${especeId}\u0001${emplacement?.id ?? ''}\u0001${miseEnPlace}`;
        if (seriesBase.has(cleDoublon)) {
          doublonBase(l);
          continue;
        }
        if (emplacement !== null) {
          const premiere = seriesFichier.get(cleDoublon);
          if (premiere !== undefined) {
            doublonBase(l, premiere);
            continue;
          }
        }

        const longueurFichier = nombreDe(v.longueur_m);
        const plants = nombreDe(v.nombre_plants);
        let longueur: number | null = longueurFichier;
        let nombrePlants: number | null = null;
        if (longueur === null) {
          if (plants !== null) nombrePlants = plants;
          else if (emplacement !== null && emplacement.longueurM !== null) longueur = emplacement.longueurM;
          else {
            // Ni longueur, ni plants, ni planche : le serveur exige une taille. 1 m, signalé dans
            // l'aperçu (à compléter dans la série).
            longueur = LONGUEUR_PAR_DEFAUT_M;
            noterDefaut('longueur-serie', `longueur ${String(LONGUEUR_PAR_DEFAUT_M)} m par défaut (ni longueur, ni plants, ni planche)`, `${nomEspece(especeId)} : ${String(LONGUEUR_PAR_DEFAUT_M)} m`);
          }
        }

        const annee = Number(miseEnPlace.slice(0, 4));
        const saisonId = saisonDe(annee, miseEnPlace);
        const varieteId = varieteDe(texte(v.variete), especeId, null);
        let itineraireId = itin?.id;
        let nouvelItineraire: OrdreEcriture | null = null;
        let itineraireNeuf: ItineraireConnu | null = null;
        if (itineraireId === undefined) {
          const ligneItin = {
            id: nouvelId<'Itineraire'>(),
            ferme_id: ferme,
            espece_id: especeId,
            variete_id: null,
            nom: nomEspece(especeId).slice(0, 80) || 'Itinéraire importé',
            mode,
            parametres: JSON.stringify(parametres),
          };
          const r = validerItineraire({ ...ligneItin }, { typesIntervention: [] });
          if (!r.ok) throw new Refus(`Itinéraire refusé : ${r.erreur.message}.`, null);
          itineraireId = ligneItin.id;
          nouvelItineraire = inserer('itineraire', ligneItin);
          itineraireNeuf = { id: ligneItin.id, especeId, varieteId: null, deLaFerme: true, nom: ligneItin.nom, mode, parametres: ligneItin.parametres };
        }

        const serie = {
          id: nouvelId<'Serie'>(),
          ferme_id: ferme,
          saison_id: saisonId,
          espece_id: especeId,
          variete_id: varieteId,
          itineraire_id: itineraireId,
          parametres: JSON.stringify(parametres),
          ancre_type: ancre.type,
          ancre_date: ancre.date,
          prevu_semis_pepiniere: dates.semisPepiniere ?? null,
          prevu_mise_en_place: dates.miseEnPlace,
          prevu_debut_recolte: dates.debutRecolte,
          prevu_fin_recolte: dates.finRecolte,
          longueur_m: longueur,
          nombre_plants: nombrePlants,
          statut: 'prevue',
          rotation_acceptee: null,
        };
        const rs = validerSerie({ ...serie });
        if (!rs.ok) throw new Refus(`Série refusée : ${rs.erreur.message}.`, null);
        const groupe: OrdreEcriture[] = [inserer('serie', serie)];
        if (emplacement !== null) {
          const gouttiere = emplacement.sorte === 'gouttiere' && emplacement.nombrePlaces !== null;
          const occupation = {
            id: nouvelId<'Occupation'>(),
            ferme_id: ferme,
            emplacement_id: emplacement.id,
            serie_id: serie.id,
            plantation_id: null,
            evenement_id: null,
            longueur_m: gouttiere ? null : (longueur ?? emplacement.longueurM),
            nombre_places: gouttiere ? (nombrePlants ?? emplacement.nombrePlaces) : null,
            position_m: null,
            prevu_du: dates.miseEnPlace,
            prevu_au: dates.finRecolte,
            reel_du: null,
            reel_au: null,
          };
          const ro = validerOccupation({ ...occupation }, rs.valeur);
          if (!ro.ok) throw new Refus(`Occupation refusée : ${ro.erreur.message}.`, null);
          groupe.push(inserer('occupation', occupation));
          ecr.paires.push(groupe);
          ecr.noter('serie', serie.id);
          ecr.noter('occupation', occupation.id);
          seriesFichier.set(cleDoublon, l.ligne);
        } else {
          ecr.seriesSeules.push(groupe);
          ecr.noter('serie', serie.id);
        }
        if (nouvelItineraire !== null && itineraireNeuf !== null) {
          ecr.itineraires.push([nouvelItineraire]);
          ecr.noter('itineraire', serie.itineraire_id);
          itinerairesCrees.set(especeId, itineraireNeuf);
        }
        valide(l, avertissements);
      } catch (x) {
        if (!(x instanceof Refus) && !(x instanceof RangeError)) throw x;
        // Ce que la ligne avait déjà préparé (saison, espèce, variété) reste si une autre ligne en
        // a besoin ; sinon on le retire.
        retirerDepuis(ecr, marques, caches);
        erreurLigne(l, x instanceof Refus ? x : new Refus(`Dates impossibles : ${x.message}.`, null));
      }
    }
  }

  if (plan.type === 'assolement') {
    const fichier = new Map<string, number>();
    for (const l of lignesValides) {
      const v = l.valeurs;
      const marques = ecr.marques();
      try {
        const annee = nombreDe(v.annee);
        if (annee === null) throw new Refus('Année : valeur obligatoire manquante.', 'annee');
        const code = texte(v.emplacement);
        const nomZone = texte(v.zone);
        let emplacementId: string | null = null;
        let zoneId: string | null = null;
        if (code !== null) {
          const x = emplacementsParCode.get(normaliser(code));
          if (x === undefined) throw new Refus(`Emplacement inconnu : « ${code.trim()} » n’est pas un emplacement de la ferme (importez d’abord le parcellaire).`, 'emplacement');
          emplacementId = x.id;
        } else if (nomZone !== null) {
          const z = zonesParNom.get(normaliser(nomZone));
          if (z === undefined) throw new Refus(`Zone inconnue : « ${nomZone.trim()} » n’est pas une zone de la ferme (importez d’abord le parcellaire).`, 'zone');
          zoneId = z;
        } else throw new Refus('Il faut une zone ou un emplacement.', null);
        const familleRef = reference(v.famille);
        const especeRef = reference(v.espece);
        const especeId = especeDe(especeRef, familleRef);
        const familleEspece = especeId === null ? null : (especes.get(especeId)?.familleId ?? nouvellesEspeces.get(especeId)?.familleId ?? null);
        const familleLue = familleDe(familleRef);
        const familleId = familleLue ?? familleEspece;
        if (familleId === null) throw new Refus('Famille botanique : inconnue pour cette culture, ajoutez une colonne Famille.', e.colonneDe.has('famille') ? 'famille' : 'espece');
        if (especeId !== null && familleEspece !== familleId) {
          throw new Refus(`« ${nomEspece(especeId)} » n’est pas rangée dans cette famille botanique dans la ferme.`, e.colonneDe.has('famille') ? 'famille' : 'espece');
        }
        const jour = `${String(annee)}-01-01`;
        const existante = ctx.saisons.find((s) => s.nom.trim() === String(annee)) ?? ctx.saisons.find((s) => s.debut <= jour && jour <= s.fin);
        const cle = `${String(annee)}\u0001${zoneId ?? ''}\u0001${emplacementId ?? ''}\u0001${familleId}\u0001${especeId ?? ''}`;
        const enBase =
          existante !== undefined &&
          ctx.assolements.some((a) => a.saisonId === existante.id && a.zoneId === zoneId && a.emplacementId === emplacementId && a.familleId === familleId && a.especeId === especeId);
        const premiere = fichier.get(cle);
        if (enBase || premiere !== undefined) {
          doublonBase(l, premiere ?? null);
          continue;
        }
        fichier.set(cle, l.ligne);
        const saisonId = saisonDe(annee, jour);
        const id = nouvelId<'Assolement'>();
        ecr.assolements.push([
          inserer('assolement', {
            id,
            ferme_id: ferme,
            saison_id: saisonId,
            zone_id: zoneId,
            emplacement_id: emplacementId,
            famille_id: familleId,
            espece_id: especeId,
            nature: 'passe_importe',
            source_import: d.nomFichier.slice(0, PLAFONDS.texte) || 'import',
          }),
        ]);
        ecr.noter('assolement', id);
        valide(l);
      } catch (x) {
        if (!(x instanceof Refus)) throw x;
        retirerDepuis(ecr, marques, caches);
        erreurLigne(l, x);
      }
    }
  }

  // ── Aperçu ──────────────────────────────────────────────────────────────────────────────────
  const finales: LigneApercu[] = [];
  let valides = 0;
  let erreurs = 0;
  let doublons = 0;
  let avertis = 0;
  const parSorte = { erreur: 0, doublon: 0, avertissement: 0, valide: 0 };
  for (const l of plan.lignes) {
    const issue: Issue =
      issues.get(l.ligne) ??
      (l.statut === 'erreur'
        ? { statut: 'erreur', erreurs: l.erreurs.map((x) => ({ message: x.message, cellule: cellule(l.ligne, x.colonne) })), avertissements: [], doublonDe: null, resume: resumeDe(l) }
        : l.statut === 'doublon'
          ? { statut: 'doublon', erreurs: [], avertissements: [], doublonDe: l.doublonDe ?? null, resume: resumeDe(l) }
          : { statut: l.statut, erreurs: [], avertissements: [], doublonDe: null, resume: resumeDe(l) });
    if (issue.statut === 'valide') valides++;
    else if (issue.statut === 'erreur') erreurs++;
    else if (issue.statut === 'doublon') doublons++;
    if (issue.statut === 'valide' && issue.avertissements.length > 0) avertis++;
    const sorte = issue.statut === 'valide' ? (issue.avertissements.length > 0 ? 'avertissement' : 'valide') : issue.statut === 'a_decider' ? 'erreur' : issue.statut;
    const max = sorte === 'valide' ? 20 : 100;
    if (parSorte[sorte] < max) {
      parSorte[sorte]++;
      finales.push({
        ligne: l.ligne,
        statut: issue.statut,
        resume: issue.resume,
        erreurs: issue.erreurs,
        avertissements: issue.statut === 'valide' ? issue.avertissements : [],
        ...(issue.statut === 'doublon' ? { doublonDe: issue.doublonDe } : {}),
      });
    }
  }
  const lots = decouperEnLots(ecr.groupes());
  const apercu: Apercu = {
    valides,
    erreurs,
    doublons,
    avertissements: avertis,
    ignorees: plan.resume.ignorees,
    lignes: finales,
    ecritures: ecr.ecritures,
    lots: lots.length,
    creees: ecr.creees,
    defauts: [...encart].map(([sorte, textes]) => ({ sorte, textes: [...textes].slice(0, 20), nombre: textes.size })),
    lotsCreees: lots.map((lot) => lot.flatMap((o) => {
      const table = /^INSERT INTO (\w+)/.exec(o.sql)?.[1];
      const id = o.parametres?.[0];
      return table !== undefined && typeof id === 'string' ? [`${table}:${id}`] : [];
    })),
  };
  return { apercu, lots };
}

/** Une ligne en erreur retire ce qu'elle seule avait préparé (saison, espèce, famille, variété). */
function retirerDepuis(
  ecr: Ecritures,
  marques: Marques,
  caches: {
    readonly saisonsCreees: Map<number, string>;
    readonly especesCreees: Map<string, string>;
    readonly nouvellesEspeces: Map<string, unknown>;
    readonly famillesCreees: Map<string, string>;
    readonly varietesCreees: Map<string, string>;
  },
): void {
  if (ecr.ecritures === marques.ecritures) return;
  const retirer = (liste: OrdreEcriture[][], depuis: number, table: string, cache: Map<unknown, string> | null): void => {
    const retires = liste.splice(depuis);
    for (const g of retires) {
      const brut = g[0]?.parametres?.[0];
      const id = typeof brut === 'string' ? brut : '';
      const ids = ecr.creees[table];
      if (ids !== undefined) {
        const i = ids.lastIndexOf(id);
        if (i >= 0) ids.splice(i, 1);
      }
      ecr.ecritures -= g.length;
      if (cache !== null) for (const [k, v] of cache) if (v === id) cache.delete(k);
      if (table === 'espece') caches.nouvellesEspeces.delete(id);
    }
  };
  retirer(ecr.saisons, marques.saisons, 'saison', caches.saisonsCreees);
  retirer(ecr.especes, marques.especes, 'espece', caches.especesCreees);
  retirer(ecr.familles, marques.familles, 'famille', caches.famillesCreees);
  retirer(ecr.varietes, marques.varietes, 'variete', caches.varietesCreees);
  retirer(ecr.itineraires, marques.itineraires, 'itineraire', null);
}

/** Paramètres d'un itinéraire créé depuis une ligne de cultures. */
function parametresNeufs(mode: Mode, avantRecolte: number, fenetre: number, pepiniere: number | null, rangs: number | null, ecartement: number | null, quinconce: boolean): Objet {
  const densite: Objet = { facon: 'ecartement', rangsParPlanche: rangs ?? DENSITE_PAR_DEFAUT.rangsParPlanche, ecartementSurRangCm: ecartement ?? DENSITE_PAR_DEFAUT.ecartementSurRangCm };
  // Comme le formulaire (T35a) : la disposition n'a de sens qu'à partir de 2 rangs.
  if (quinconce && (densite.rangsParPlanche as number) > 1) densite.disposition = 'quinconce';
  const p: Objet = {
    mode,
    ...PARAMETRES_COMMUNS,
    dureeAvantRecolteJours: avantRecolte,
    fenetreRecolteJours: fenetre,
    densite,
    travauxPrevus: [],
  };
  completerMode(p, mode, pepiniere);
  return p;
}

function completerMode(p: Objet, mode: Mode, pepiniere: number | null): void {
  if (mode === 'plant_maison') {
    p.dureePepiniereJours = pepiniere;
    p.grainesParMotte ??= 1;
    p.plantsParMotte ??= 1;
    p.pertePepiniere ??= 0;
    if (!('alveolesParPlaque' in p)) p.alveolesParPlaque = null;
  } else if (mode === 'semis_direct') {
    p.grainesParPoquet ??= 1;
  }
}

/**
 * Paramètres d'une série importée : ceux de l'itinéraire de l'espèce (densité, rendement…), avec
 * le mode et les durées tirés des dates du fichier (les dates prévues sont alors exactement
 * celles du fichier, comme le serveur l'exige : principe 2).
 */
function parametresSerie(p0: Objet | null, mode: Mode, avantRecolte: number, fenetre: number, pepiniere: number | null): Objet {
  const p: Objet = {};
  const memeMode = p0 !== null && p0.mode === mode;
  if (p0 !== null) for (const [k, v] of Object.entries(p0)) if (memeMode || !CLES_DU_MODE.includes(k)) p[k] = v;
  if (p0 === null) Object.assign(p, PARAMETRES_COMMUNS, { densite: { facon: 'ecartement', ...DENSITE_PAR_DEFAUT } });
  // Travaux prévus d'un autre mode (pépinière d'un plant maison…) : pas repris.
  if (!memeMode) p.travauxPrevus = [];
  p.mode = mode;
  p.dureeAvantRecolteJours = avantRecolte;
  p.fenetreRecolteJours = fenetre;
  completerMode(p, mode, pepiniere);
  if (mode !== 'plant_maison') delete p.dureePepiniereJours;
  return p;
}

function memesDurees(a: Objet | null, b: Objet): boolean {
  if (a === null) return false;
  return a.mode === b.mode && a.dureeAvantRecolteJours === b.dureeAvantRecolteJours && a.fenetreRecolteJours === b.fenetreRecolteJours && (a.dureePepiniereJours ?? null) === (b.dureePepiniereJours ?? null);
}

/**
 * Valeurs par défaut des paramètres d'un itinéraire ou d'une série (relecture B1) : densité et
 * marge quand `densiteLue` est donnée (null : la densité et la marge viennent d'un itinéraire),
 * pépinière ou poquet quand elles ne viennent pas de `source` (l'itinéraire de même mode).
 */
function noterDefautsParametres(
  p: Objet,
  densiteLue: { readonly rangs: number | null; readonly ecartement: number | null } | null,
  culture: string,
  noter: (sorte: SorteDefaut, surLaLigne: string, dansEncart: string) => void,
  source: Objet | null = null,
): void {
  if (densiteLue !== null) {
    if (densiteLue.rangs === null || densiteLue.ecartement === null) {
      const rangs = densiteLue.rangs ?? DENSITE_PAR_DEFAUT.rangsParPlanche;
      const ecart = densiteLue.ecartement ?? DENSITE_PAR_DEFAUT.ecartementSurRangCm;
      const texte = `${String(rangs)} rang${rangs > 1 ? 's' : ''} × ${String(ecart)} cm`;
      noter('densite', `densité ${texte} par défaut`, `${culture} : ${texte}`);
    }
    noter('marge', `marge de sécurité ${String(PARAMETRES_COMMUNS.margeSecurite)} % par défaut`, `${culture} : ${String(PARAMETRES_COMMUNS.margeSecurite)} %`);
  }
  if (source !== null) return;
  if (p.mode === 'plant_maison') {
    noter('pepiniere', 'pépinière : 1 graine et 1 plant par motte, 0 % de perte par défaut', `${culture} : 1 graine, 1 plant par motte, 0 % de perte`);
  } else if (p.mode === 'semis_direct') {
    noter('pepiniere', '1 graine par poquet par défaut', `${culture} : 1 graine par poquet`);
  }
}
