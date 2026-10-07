/**
 * Calculs de la vue 2D planches × semaines (T11). Fonctions pures : ni React, ni PowerSync, ni
 * réseau, ni objet Date (dates calendaires de @planif/core, en jours entiers). Contrat :
 * ./test/contrat.ts.
 *
 * Les conflits viennent du moteur de T03 (`detecterConflits`), jamais d'une règle réécrite ici ;
 * la période d'une occupation, de `periodeOccupation` (le réel prime sur le prévu).
 */
import {
  ajouterJours,
  detecterConflits,
  jourAbsolu,
  lundiDeSemaine,
  periodeOccupation,
  semaineIso,
  type DateCalendaire,
  type Emplacement,
  type Id,
  type Instant,
  type Occupation,
  type OccupantEmplacement,
  type PlaceOccupee,
  type SorteConflit,
} from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import type { CleFamille } from '../../ui/jetons.ts';

// ── Types (contrat : ./test/contrat.ts) ──────────────────────────────────────────────────────

export type { CleFamille };
export type { SorteConflit };

/** Ligne de la base locale telle que la porte la lit (snake_case, valeurs SQLite). */
export type LigneLocale = Readonly<Record<string, string | number | null>>;

/** Lignes de la ferme lues par chargerPlan (bibliothèque de référence comprise : ferme_id nul). */
export interface DonneesPlan {
  readonly zone: readonly LigneLocale[];
  readonly emplacement: readonly LigneLocale[];
  readonly occupation: readonly LigneLocale[];
  readonly serie: readonly LigneLocale[];
  readonly plantation: readonly LigneLocale[];
  readonly espece: readonly LigneLocale[];
  readonly variete: readonly LigneLocale[];
  readonly famille: readonly LigneLocale[];
}

export interface SaisonPlan {
  readonly id: string;
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
}

export interface SemainePlan {
  readonly annee: number;
  readonly semaine: number;
  /** 'S01' … 'S53'. */
  readonly libelle: string;
  /** Lundi, 'AAAA-MM-JJ'. */
  readonly lundi: string;
}

export interface ConflitPlan {
  readonly sorte: SorteConflit;
  readonly nom: string;
  readonly occupations: readonly string[];
  readonly du: string;
  readonly au: string | null;
}

export interface BarrePlan {
  readonly occupationId: string;
  readonly serieId: string | null;
  readonly plantationId: string | null;
  readonly libelle: string;
  readonly famille: string | null;
  readonly cleFamille: CleFamille | null;
  readonly etat: 'reel' | 'prevu';
  readonly du: string;
  readonly au: string | null;
  readonly debutJour: number;
  readonly finJour: number;
  readonly enConflit: boolean;
}

export interface LigneZonePlan {
  readonly sorte: 'zone' | 'chapelle';
  readonly id: string;
  readonly nom: string;
}

export interface LigneEmplacementPlan {
  readonly sorte: 'emplacement';
  readonly id: string;
  readonly code: string;
  /** Zone racine. */
  readonly zoneId: string;
  /** Chapelle (sous-zone) de rattachement, null si l'emplacement est directement dans la zone. */
  readonly chapelleId: string | null;
  /** Longueur de l'emplacement (m), recopiée de la base (T27 : taille des volumes de la 3D). */
  readonly longueurM: number;
  /** Largeur de l'emplacement (m), nulle si non renseignée (T27). */
  readonly largeurM: number | null;
  readonly barres: readonly BarrePlan[];
  readonly conflits: readonly ConflitPlan[];
}

export type LignePlan = LigneZonePlan | LigneEmplacementPlan;

export interface Plan {
  readonly saison: SaisonPlan;
  readonly semaines: readonly SemainePlan[];
  readonly semaineCourante: number | null;
  readonly lignes: readonly LignePlan[];
}

export interface OptionsPlan {
  readonly saison: SaisonPlan;
  /** 'AAAA-MM-JJ'. */
  readonly aujourdhui: string;
}

// ── Constantes ───────────────────────────────────────────────────────────────────────────────

/**
 * Hauteur de chaque ligne : 48 px (la maquette Plan en dessinait 44), la cible de l'étiquette
 * d'une planche en conflit, touchable avec des gants.
 */
export const HAUTEUR_LIGNE_PX = 48;

/** Largeur d'une semaine sur le plan, en px (T12 : semaine sous le doigt d'un appui long). */
export const LARGEUR_SEMAINE_PX = 36;

/** Largeur de la colonne des codes, en px (T12 : un appui long dessus n'ouvre rien). */
export const LARGEUR_ETIQUETTE_PX = 92;

/** Nom de chaque sorte de conflit de T03, tel que l'écran le montre. */
export const NOMS_CONFLITS: Readonly<Record<SorteConflit, string>> = {
  chevauchement: 'Chevauchement',
  surcharge: 'Surcharge',
  depassement: 'Dépasse la planche',
  emplacement_inactif: 'Emplacement inactif',
  periode_invalide: 'Dates inversées',
};

/**
 * Libellé court de chaque sorte, tel que la colonne des codes le montre (relecture C1) : il tient
 * dans la colonne à 360 px ; le nom complet est dans le détail des conflits de la planche.
 */
export const LIBELLES_COURTS_CONFLITS: Readonly<Record<SorteConflit, string>> = {
  chevauchement: 'Chevauche',
  depassement: 'Trop long',
  surcharge: 'Surcharge',
  emplacement_inactif: 'Inactif',
  periode_invalide: 'Dates',
};

/** Tri « naturel » : « Tunnel 2 » avant « Tunnel 10 ». */
const COLLATEUR = new Intl.Collator('fr', { numeric: true });

// ── Lecture des lignes locales ───────────────────────────────────────────────────────────────

type Valeur = string | number | null | undefined;

const texte = (v: Valeur): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const texteOuNul = (v: Valeur): string | null => (v === null || v === undefined ? null : texte(v));
const nombre = (v: Valeur): number => (typeof v === 'number' ? v : Number(v));
const nombreOuNul = (v: Valeur): number | null => (v === null || v === undefined ? null : nombre(v));

/** Ligne `emplacement` locale → Emplacement de T01 (partagé avec le formulaire d'une série, T12). */
export function versEmplacement(l: LigneLocale): Emplacement {
  const commun = {
    id: texte(l.id) as Id<'Emplacement'>,
    fermeId: texte(l.ferme_id) as Id<'Ferme'>,
    supprimeLe: texteOuNul(l.supprime_le) as Instant | null,
    zoneId: texte(l.zone_id) as Id<'Zone'>,
    code: texte(l.code),
    longueurM: nombre(l.longueur_m),
    largeurM: nombreOuNul(l.largeur_m),
    actifDu: texte(l.actif_du) as DateCalendaire,
    actifAu: texteOuNul(l.actif_au) as DateCalendaire | null,
    remplace: [],
    // Placement dans le repère de la zone (T28a) : nul tant que la planche n'est pas placée.
    placementXM: nombreOuNul(l.placement_x_m),
    placementYM: nombreOuNul(l.placement_y_m),
    orientationDeg: nombreOuNul(l.orientation_deg),
  };
  if (l.sorte === 'gouttiere') return { ...commun, sorte: 'gouttiere', nombrePlaces: nombre(l.nombre_places) };
  return { ...commun, sorte: l.sorte === 'rang' ? 'rang' : 'planche' };
}

/** Ligne `occupation` locale → Occupation de T01, sur son emplacement (partagé avec T12). */
export function versOccupation(l: LigneLocale, emplacement: Emplacement): Occupation {
  const serieId = texteOuNul(l.serie_id);
  const plantationId = texteOuNul(l.plantation_id);
  const occupant: OccupantEmplacement =
    serieId !== null
      ? { sorte: 'serie', serieId: serieId as Id<'Serie'> }
      : plantationId !== null
        ? { sorte: 'plantation', plantationId: plantationId as Id<'Plantation'> }
        : { sorte: 'couverture', evenementId: texte(l.evenement_id) as Id<'Evenement'> };
  const place: PlaceOccupee =
    emplacement.sorte === 'gouttiere'
      ? { unite: 'places', nombrePlaces: nombre(l.nombre_places) }
      : { unite: 'longueur', longueurM: nombre(l.longueur_m) };
  const reelDu = texteOuNul(l.reel_du);
  return {
    id: texte(l.id) as Id<'Occupation'>,
    fermeId: texte(l.ferme_id) as Id<'Ferme'>,
    supprimeLe: texteOuNul(l.supprime_le) as Instant | null,
    emplacementId: emplacement.id,
    occupant,
    place,
    positionM: nombreOuNul(l.position_m),
    prevuDu: texte(l.prevu_du) as DateCalendaire,
    prevuAu: texte(l.prevu_au) as DateCalendaire,
    reel: reelDu === null ? null : { du: reelDu as DateCalendaire, au: texteOuNul(l.reel_au) as DateCalendaire | null },
  };
}

function parId(lignes: readonly LigneLocale[]): Map<string, LigneLocale> {
  const m = new Map<string, LigneLocale>();
  for (const l of lignes) m.set(texte(l.id), l);
  return m;
}

// ── Saisons, semaines ────────────────────────────────────────────────────────────────────────

function comparerSaisons(a: SaisonPlan, b: SaisonPlan): number {
  return a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Saison affichée par défaut : celle qui contient aujourd'hui ; sinon la plus récente commencée
 * avant aujourd'hui ; sinon la première ; aucune → null. Dates 'AAAA-MM-JJ' : l'ordre du texte
 * est celui des jours.
 */
export function saisonParDefaut(saisons: readonly SaisonPlan[], aujourdhui: string): SaisonPlan | null {
  const triees = [...saisons].sort(comparerSaisons);
  let contient: SaisonPlan | null = null;
  let commencee: SaisonPlan | null = null;
  for (const s of triees) {
    if (s.debut <= aujourdhui && aujourdhui <= s.fin) contient = s;
    if (s.debut <= aujourdhui) commencee = s;
  }
  return contient ?? commencee ?? triees[0] ?? null;
}

function semainesDe(saison: SaisonPlan): SemainePlan[] {
  const premiere = semaineIso(saison.debut as DateCalendaire);
  const derniere = semaineIso(saison.fin as DateCalendaire);
  const lundiFin = lundiDeSemaine(derniere.annee, derniere.semaine);
  const semaines: SemainePlan[] = [];
  // Sept jours entre deux lundis : on avance semaine par semaine, sans trou.
  for (let lundi = lundiDeSemaine(premiere.annee, premiere.semaine); lundi <= lundiFin; lundi = ajouterJours(lundi, 7)) {
    const s = semaineIso(lundi);
    semaines.push({ annee: s.annee, semaine: s.semaine, libelle: `S${String(s.semaine).padStart(2, '0')}`, lundi });
  }
  return semaines;
}

// ── Familles ─────────────────────────────────────────────────────────────────────────────────

/** Nom sans accents ni casse : « Astéracées » → 'asteracees'. */
function normaliser(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Clé de couleur de la famille (jetons FAMILLES, T27b) : les 4 de T16 (Astéracées = salades,
 * Brassicacées ou Crucifères = cruciferes, Apiacées = racines), les autres familles de la
 * bibliothèque commune sous leur nom sans accents, et « autre » pour tout le reste (famille propre
 * à la ferme, inconnue, absente).
 */
const CLES_PAR_NOM: ReadonlyMap<string, CleFamille> = new Map<string, CleFamille>([
  ['asteracees', 'salades'],
  ['brassicacees', 'cruciferes'],
  ['cruciferes', 'cruciferes'],
  ['apiacees', 'racines'],
  ...(
    ['solanacees', 'alliacees', 'amaranthacees', 'asparagacees', 'convolvulacees', 'cucurbitacees', 'fabacees', 'lamiacees', 'paeoniacees', 'poacees', 'polygonacees', 'rosacees', 'valerianacees'] as const
  ).map((cle) => [cle, cle] as const),
]);

export function cleFamille(nomFamille: string | null): CleFamille {
  return (nomFamille === null ? undefined : CLES_PAR_NOM.get(normaliser(nomFamille))) ?? 'autre';
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────

/** Emplacement actif sur la saison : [actif_du, actif_au[ recoupe la saison. */
function actifSurSaison(l: LigneLocale, saison: SaisonPlan): boolean {
  if (l.supprime_le !== null && l.supprime_le !== undefined) return false;
  const du = texte(l.actif_du);
  const au = texteOuNul(l.actif_au);
  return du <= saison.fin && (au === null || au > saison.debut);
}

/** [du, au[ recoupe [début, fin + 1 jour[ de la saison ? (au nul : sans fin.) */
function recoupe(du: string, au: string | null, saison: SaisonPlan): boolean {
  return du <= saison.fin && (au === null || au > saison.debut);
}

interface Culture {
  readonly libelle: string;
  readonly famille: string | null;
  readonly cleFamille: CleFamille;
}

const COUVERTURE: Culture = { libelle: 'Couverture', famille: null, cleFamille: 'autre' };

/**
 * Libellé et famille de chaque occupation : série ou plantation → espèce, variété, famille.
 * Calculés à la demande (barres de la saison, noms des conflits) et retenus par série ou
 * plantation : le plan en lit quelques centaines, pas les 3 000 occupations.
 */
function cultures(donnees: DonneesPlan): (occupation: LigneLocale) => Culture {
  const series = parId(donnees.serie);
  const plantations = parId(donnees.plantation);
  const especes = parId(donnees.espece);
  const varietes = parId(donnees.variete);
  const familles = parId(donnees.famille);
  const parOccupant = new Map<string, Culture>();

  function depuis(occupant: LigneLocale | undefined): Culture {
    const especeId = occupant === undefined ? null : texteOuNul(occupant.espece_id);
    const varieteId = occupant === undefined ? null : texteOuNul(occupant.variete_id);
    const espece = especeId === null ? undefined : especes.get(especeId);
    const variete = varieteId === null ? undefined : varietes.get(varieteId);
    const nomEspece = espece === undefined ? 'Culture' : texte(espece.nom);
    const familleId = espece === undefined ? null : texteOuNul(espece.famille_id);
    const ligneFamille = familleId === null ? undefined : familles.get(familleId);
    const famille = ligneFamille === undefined ? null : texte(ligneFamille.nom);
    return { libelle: variete === undefined ? nomEspece : `${nomEspece} ${texte(variete.nom)}`, famille, cleFamille: cleFamille(famille) };
  }

  function retenue(id: string, table: ReadonlyMap<string, LigneLocale>): Culture {
    let c = parOccupant.get(id);
    if (c === undefined) {
      c = depuis(table.get(id));
      parOccupant.set(id, c);
    }
    return c;
  }

  return (o) => {
    const serieId = texteOuNul(o.serie_id);
    if (serieId !== null) return retenue(serieId, series);
    const plantationId = texteOuNul(o.plantation_id);
    if (plantationId !== null) return retenue(plantationId, plantations);
    return COUVERTURE;
  };
}

function comparerTexte(a: string, ida: string, b: string, idb: string): number {
  return COLLATEUR.compare(a, b) || (ida < idb ? -1 : ida > idb ? 1 : 0);
}

/**
 * Lignes groupées : zone racine, ses emplacements directs, puis ses chapelles (sous-zones),
 * chacune suivie de ses emplacements ; une sous-zone plus profonde se range sous sa chapelle.
 */
function grouper(donnees: DonneesPlan, actifs: readonly LigneLocale[]): { zoneId: string; chapelleId: string | null; lignes: LigneLocale[] }[] {
  const zones = parId(donnees.zone);
  /** Zone racine et chapelle de chaque zone (null pour une racine). */
  const rattachement = new Map<string, { racine: string; chapelle: string | null }>();
  function rattacher(zoneId: string): { racine: string; chapelle: string | null } | null {
    const connu = rattachement.get(zoneId);
    if (connu !== undefined) return connu;
    // Remonte jusqu'à la racine ; la chapelle est la zone juste sous elle.
    const chemin: string[] = [];
    let courante: string | null = zoneId;
    const vues = new Set<string>();
    while (courante !== null) {
      if (vues.has(courante)) return null; // Boucle dans les zones : ligne ignorée.
      vues.add(courante);
      const z = zones.get(courante);
      if (z === undefined) return null;
      chemin.push(courante);
      courante = texteOuNul(z.zone_parente_id);
    }
    const racine = chemin[chemin.length - 1] ?? zoneId;
    const chapelle = chemin.length >= 2 ? (chemin[chemin.length - 2] ?? null) : null;
    const r = { racine, chapelle };
    rattachement.set(zoneId, r);
    return r;
  }

  const groupes = new Map<string, { zoneId: string; chapelleId: string | null; lignes: LigneLocale[] }>();
  for (const e of actifs) {
    const r = rattacher(texte(e.zone_id));
    if (r === null) continue;
    const cle = `${r.racine}|${r.chapelle ?? ''}`;
    let g = groupes.get(cle);
    if (g === undefined) {
      g = { zoneId: r.racine, chapelleId: r.chapelle, lignes: [] };
      groupes.set(cle, g);
    }
    g.lignes.push(e);
  }
  const nom = (id: string) => texte(zones.get(id)?.nom);
  return [...groupes.values()].sort(
    (a, b) =>
      comparerTexte(nom(a.zoneId), a.zoneId, nom(b.zoneId), b.zoneId) ||
      // Emplacements directs de la zone d'abord, puis les chapelles.
      (a.chapelleId === null ? (b.chapelleId === null ? 0 : -1) : b.chapelleId === null ? 1 : comparerTexte(nom(a.chapelleId), a.chapelleId, nom(b.chapelleId), b.chapelleId)),
  );
}

/** Le plan de la saison : semaines en colonnes, lignes groupées, barres et conflits de T03. */
export function construirePlan(donnees: DonneesPlan, options: OptionsPlan): Plan {
  const { saison, aujourdhui } = options;
  const semaines = semainesDe(saison);
  const jour0 = semaines[0] === undefined ? 0 : jourAbsolu(semaines[0].lundi as DateCalendaire);
  const joursTotal = 7 * semaines.length;
  const jourAujourdhui = jourAbsolu(aujourdhui as DateCalendaire) - jour0;
  const indexCourant = Math.floor(jourAujourdhui / 7);
  const semaineCourante = jourAujourdhui >= 0 && indexCourant < semaines.length ? indexCourant : null;
  const borner = (j: number) => Math.min(joursTotal, Math.max(0, j));

  const actifs = donnees.emplacement.filter((e) => actifSurSaison(e, saison));
  const occupationsPar = new Map<string, LigneLocale[]>();
  for (const o of donnees.occupation) {
    if (o.supprime_le !== null && o.supprime_le !== undefined) continue;
    const cle = texte(o.emplacement_id);
    const liste = occupationsPar.get(cle);
    if (liste === undefined) occupationsPar.set(cle, [o]);
    else liste.push(o);
  }
  const culture = cultures(donnees);
  const zones = parId(donnees.zone);

  function ligneEmplacement(e: LigneLocale, zoneId: string, chapelleId: string | null): LigneEmplacementPlan {
    const emplacement = versEmplacement(e);
    const siennes = occupationsPar.get(emplacement.id) ?? [];
    const occupations = siennes.map((o) => versOccupation(o, emplacement));

    const trouves = detecterConflits(emplacement, occupations).filter((c) => recoupe(c.du, c.au, saison));
    let conflits: ConflitPlan[] = [];
    if (trouves.length > 0) {
      const lignesParId = new Map(siennes.map((o) => [texte(o.id), o]));
      const libelle = (id: string) => {
        const o = lignesParId.get(id);
        return o === undefined ? '' : culture(o).libelle;
      };
      conflits = trouves.map((c) => ({
        sorte: c.sorte,
        nom: `${NOMS_CONFLITS[c.sorte]} : ${c.occupations.map(libelle).join(' et ')}`,
        occupations: c.occupations,
        du: c.du,
        au: c.au,
      }));
    }
    const enCause = new Set(conflits.flatMap((c) => c.occupations));

    const barres: BarrePlan[] = [];
    for (let i = 0; i < occupations.length; i++) {
      const o = occupations[i];
      const ligne = siennes[i];
      if (o === undefined || ligne === undefined) continue;
      const { du, au } = periodeOccupation(o);
      // Période vide ou inversée : pas de barre (T03 la signale en « période invalide »).
      if ((au !== null && au <= du) || !recoupe(du, au, saison)) continue;
      const c = culture(ligne);
      barres.push({
        occupationId: o.id,
        serieId: o.occupant.sorte === 'serie' ? o.occupant.serieId : null,
        plantationId: o.occupant.sorte === 'plantation' ? o.occupant.plantationId : null,
        libelle: c.libelle,
        famille: c.famille,
        cleFamille: c.cleFamille,
        etat: o.reel === null ? 'prevu' : 'reel',
        du,
        au,
        debutJour: borner(jourAbsolu(du) - jour0),
        finJour: au === null ? joursTotal : borner(jourAbsolu(au) - jour0),
        enConflit: enCause.has(o.id),
      });
    }
    barres.sort((a, b) => a.debutJour - b.debutJour || (a.occupationId < b.occupationId ? -1 : a.occupationId > b.occupationId ? 1 : 0));
    return {
      sorte: 'emplacement',
      id: emplacement.id,
      code: emplacement.code,
      zoneId,
      chapelleId,
      longueurM: emplacement.longueurM,
      largeurM: emplacement.largeurM,
      barres,
      conflits,
    };
  }

  const lignes: LignePlan[] = [];
  let zoneCourante: string | null = null;
  for (const g of grouper(donnees, actifs)) {
    if (g.zoneId !== zoneCourante) {
      zoneCourante = g.zoneId;
      lignes.push({ sorte: 'zone', id: g.zoneId, nom: texte(zones.get(g.zoneId)?.nom) });
    }
    if (g.chapelleId !== null) lignes.push({ sorte: 'chapelle', id: g.chapelleId, nom: texte(zones.get(g.chapelleId)?.nom) });
    const tries = [...g.lignes].sort((a, b) => comparerTexte(texte(a.code), texte(a.id), texte(b.code), texte(b.id)));
    for (const e of tries) lignes.push(ligneEmplacement(e, g.zoneId, g.chapelleId));
  }

  return { saison, semaines, semaineCourante, lignes };
}

// ── Lecture par la porte ─────────────────────────────────────────────────────────────────────

/** Saisons de la ferme, non supprimées, triées par début. */
export async function chargerSaisons(porte: PorteDonnees, fermeId: string): Promise<SaisonPlan[]> {
  const lignes = await porte.lire<LigneLocale>(
    'SELECT id, nom, debut, fin FROM saison WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY debut, id',
    [fermeId],
  );
  return lignes.map((l) => ({ id: texte(l.id), nom: texte(l.nom), debut: texte(l.debut), fin: texte(l.fin) })).sort(comparerSaisons);
}

/** Lignes qui décrivent la ferme : zones, emplacements, bibliothèque (espèces, variétés, familles). */
type StructurePlan = Pick<DonneesPlan, 'zone' | 'emplacement' | 'espece' | 'variete' | 'famille'>;
/** Ce qui occupe les emplacements : occupations, et les séries et plantations qu'elles portent. */
type OccupationsPlan = Pick<DonneesPlan, 'occupation' | 'serie' | 'plantation'>;

/** Colonnes lues : seules celles dont le plan se sert (moins de données à faire passer du worker). */
const COLONNES = {
  zone: 'id, nom, zone_parente_id',
  emplacement: 'id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_places, actif_du, actif_au, supprime_le',
  occupation:
    'id, ferme_id, emplacement_id, serie_id, plantation_id, evenement_id, longueur_m, nombre_places, position_m, prevu_du, prevu_au, reel_du, reel_au, supprime_le',
  occupant: 'id, espece_id, variete_id',
  reference: 'id, nom',
} as const;

/** Zones, emplacements et bibliothèque de la ferme (référence commune comprise : ferme_id nul). */
async function lireStructure(porte: PorteDonnees, fermeId: string): Promise<StructurePlan> {
  const [zone, emplacement, espece, variete, famille] = await Promise.all([
    porte.lire<LigneLocale>(`SELECT ${COLONNES.zone} FROM zone WHERE ferme_id = ?`, [fermeId]),
    porte.lire<LigneLocale>(`SELECT ${COLONNES.emplacement} FROM emplacement WHERE ferme_id = ?`, [fermeId]),
    porte.lire<LigneLocale>(`SELECT ${COLONNES.reference}, famille_id FROM espece WHERE ferme_id = ? OR ferme_id IS NULL`, [fermeId]),
    porte.lire<LigneLocale>(`SELECT ${COLONNES.reference} FROM variete WHERE ferme_id = ? OR ferme_id IS NULL`, [fermeId]),
    porte.lire<LigneLocale>(`SELECT ${COLONNES.reference} FROM famille WHERE ferme_id = ? OR ferme_id IS NULL`, [fermeId]),
  ]);
  return { zone, emplacement, espece, variete, famille };
}

const marques = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * Occupations non supprimées de la ferme, toutes saisons confondues (les conflits de T03 se
 * calculent sur toutes), avec leurs séries et plantations.
 */
async function lireOccupations(porte: PorteDonnees, fermeId: string): Promise<OccupationsPlan> {
  const [occupation, serie, plantation] = await Promise.all([
    porte.lire<LigneLocale>(`SELECT ${COLONNES.occupation} FROM occupation WHERE ferme_id = ? AND supprime_le IS NULL`, [fermeId]),
    porte.lire<LigneLocale>(`SELECT ${COLONNES.occupant} FROM serie WHERE ferme_id = ?`, [fermeId]),
    porte.lire<LigneLocale>(`SELECT ${COLONNES.occupant} FROM plantation WHERE ferme_id = ?`, [fermeId]),
  ]);
  return { occupation, serie, plantation };
}

/**
 * Occupations de ces emplacements (toutes saisons), avec l'espèce et la variété de leur série ou
 * plantation, en une seule requête (index sur l'emplacement, jointures sur l'id).
 */
async function lireOccupationsDesEmplacements(porte: PorteDonnees, fermeId: string, emplacementIds: readonly string[]): Promise<OccupationsPlan> {
  if (emplacementIds.length === 0) return { occupation: [], serie: [], plantation: [] };
  const lignes = await porte.lire<LigneLocale>(
    `SELECT ${COLONNES.occupation.split(', ').map((c) => `o.${c}`).join(', ')},
       s.espece_id AS s_espece_id, s.variete_id AS s_variete_id, p.espece_id AS p_espece_id, p.variete_id AS p_variete_id
     FROM occupation o
     LEFT JOIN serie s ON s.id = o.serie_id
     LEFT JOIN plantation p ON p.id = o.plantation_id
     WHERE o.emplacement_id IN (${marques(emplacementIds.length)})`,
    [...emplacementIds],
  );
  const occupation: LigneLocale[] = [];
  const serie = new Map<string, LigneLocale>();
  const plantation = new Map<string, LigneLocale>();
  for (const l of lignes) {
    if (l.ferme_id !== fermeId || (l.supprime_le !== null && l.supprime_le !== undefined)) continue;
    const { s_espece_id, s_variete_id, p_espece_id, p_variete_id, ...o } = l;
    occupation.push(o);
    const serieId = texteOuNul(o.serie_id);
    if (serieId !== null) serie.set(serieId, { id: serieId, espece_id: s_espece_id ?? null, variete_id: s_variete_id ?? null });
    const plantationId = texteOuNul(o.plantation_id);
    if (plantationId !== null) plantation.set(plantationId, { id: plantationId, espece_id: p_espece_id ?? null, variete_id: p_variete_id ?? null });
  }
  return { occupation, serie: [...serie.values()], plantation: [...plantation.values()] };
}

/** Toutes les lignes de la ferme dont le plan se sert, quelle que soit la saison. */
export async function lireDonneesPlan(porte: PorteDonnees, fermeId: string): Promise<DonneesPlan> {
  const [structure, occupations] = await Promise.all([lireStructure(porte, fermeId), lireOccupations(porte, fermeId)]);
  return { ...structure, ...occupations };
}

/** Lit les lignes de la ferme par la porte, puis construit le plan. */
export async function chargerPlan(porte: PorteDonnees, fermeId: string, options: OptionsPlan): Promise<Plan> {
  return construirePlan(await lireDonneesPlan(porte, fermeId), options);
}

/** Début du plan, et la structure de toute la ferme (zones et emplacements, sans occupation). */
export interface DonneesDebutDePlan extends DonneesPlan {
  /**
   * Toutes les zones et tous les emplacements, sans occupation : le plan construit dessus a
   * exactement les lignes du plan complet (elles ne dépendent pas des occupations), de quoi
   * réserver sa hauteur avant qu'il soit lu.
   */
  readonly structure: DonneesPlan;
}

/**
 * Lignes du début du plan, pour le premier affichage : celles des premières zones seulement
 * (dans l'ordre du plan), jusqu'à au moins `emplacements` emplacements, avec toutes leurs
 * occupations : le plan construit dessus est exact pour ces lignes-là (les conflits d'un
 * emplacement ne dépendent que des siennes). Peu de lignes à lire : il s'affiche vite, le plan
 * complet le remplace ensuite. Indépendantes de la saison.
 */
export async function lireDebutDePlan(porte: PorteDonnees, fermeId: string, emplacements: number): Promise<DonneesDebutDePlan> {
  // Peu de requêtes : chacune coûte un aller-retour vers le worker de la base.
  const [petites, tous] = await Promise.all([
    porte.lire<LigneLocale>(
      `SELECT 'zone' AS t, id, nom, zone_parente_id AS lien FROM zone WHERE ferme_id = ?1
       UNION ALL SELECT 'espece', id, nom, famille_id FROM espece WHERE ferme_id = ?1 OR ferme_id IS NULL
       UNION ALL SELECT 'variete', id, nom, NULL FROM variete WHERE ferme_id = ?1 OR ferme_id IS NULL
       UNION ALL SELECT 'famille', id, nom, NULL FROM famille WHERE ferme_id = ?1 OR ferme_id IS NULL`,
      [fermeId],
    ),
    porte.lire<LigneLocale>(`SELECT ${COLONNES.emplacement} FROM emplacement WHERE ferme_id = ?`, [fermeId]),
  ]);
  const de = (t: string) => petites.filter((l) => l.t === t);
  const zones = de('zone').map((l) => ({ id: l.id ?? null, nom: l.nom ?? null, zone_parente_id: l.lien ?? null }));
  const espece = de('espece').map((l) => ({ id: l.id ?? null, nom: l.nom ?? null, famille_id: l.lien ?? null }));
  const variete = de('variete').map((l) => ({ id: l.id ?? null, nom: l.nom ?? null }));
  const famille = de('famille').map((l) => ({ id: l.id ?? null, nom: l.nom ?? null }));

  const emplacementsDe = new Map<string, LigneLocale[]>();
  for (const e of tous) {
    const z = texte(e.zone_id);
    emplacementsDe.set(z, [...(emplacementsDe.get(z) ?? []), e]);
  }
  const enfants = new Map<string, string[]>();
  for (const z of zones) {
    const parente = texteOuNul(z.zone_parente_id);
    if (parente !== null) enfants.set(parente, [...(enfants.get(parente) ?? []), texte(z.id)]);
  }
  const racines = zones
    .filter((z) => texteOuNul(z.zone_parente_id) === null)
    .sort((a, b) => comparerTexte(texte(a.nom), texte(a.id), texte(b.nom), texte(b.id)));
  // Premières zones racines (avec leurs sous-zones) jusqu'au nombre d'emplacements voulu.
  const vues = new Set<string>();
  const emplacement: LigneLocale[] = [];
  for (const racine of racines) {
    if (emplacement.length >= emplacements) break;
    const pile = [texte(racine.id)];
    while (pile.length > 0) {
      const id = pile.pop();
      if (id === undefined || vues.has(id)) continue;
      vues.add(id);
      emplacement.push(...(emplacementsDe.get(id) ?? []));
      pile.push(...(enfants.get(id) ?? []));
    }
  }
  const occupations = await lireOccupationsDesEmplacements(
    porte,
    fermeId,
    emplacement.map((e) => texte(e.id)),
  );
  const bibliotheque = { zone: zones, espece, variete, famille };
  return {
    ...bibliotheque,
    emplacement,
    ...occupations,
    structure: { ...bibliotheque, emplacement: tous, occupation: [], serie: [], plantation: [] },
  };
}

// ── Virtualisation ───────────────────────────────────────────────────────────────────────────

/**
 * Lignes à dessiner : [debut, fin[ couvre toutes celles qui recoupent la vue, plus au plus
 * `marge` de chaque côté, borné à [0, total].
 */
export function fenetreVisible(o: {
  readonly defilement: number;
  readonly hauteurVue: number;
  readonly hauteurLigne: number;
  readonly total: number;
  readonly marge: number;
}): { readonly debut: number; readonly fin: number } {
  if (o.total <= 0 || o.hauteurLigne <= 0) return { debut: 0, fin: 0 };
  const borner = (n: number) => Math.min(o.total, Math.max(0, n));
  const premiere = borner(Math.floor(o.defilement / o.hauteurLigne));
  const derniere = borner(Math.ceil((o.defilement + Math.max(0, o.hauteurVue)) / o.hauteurLigne));
  const debut = borner(premiere - o.marge);
  return { debut, fin: Math.max(debut, borner(derniere + o.marge)) };
}
