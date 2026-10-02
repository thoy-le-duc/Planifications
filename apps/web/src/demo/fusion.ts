/**
 * T25 — fusion des jeux de test en une seule ferme de démonstration. Fonctions pures, sans base :
 * src/demo/remplir.ts les applique aux jeux existants puis écrit le résultat dans la base locale.
 *
 * Chaque jeu (ferme du jour, ferme des itinéraires, ferme du plan, refus) a son utilisateur et sa
 * ferme de test : ils sont rattachés à l'utilisateur et à la ferme de la démo. Ce que deux jeux
 * décrivent tous les deux (la même zone, la même planche, la même espèce…) n'est gardé qu'une
 * fois : la ligne du jeu suivant est écartée et ses références renvoient vers la première. Les
 * identifiants sont remplacés partout, y compris dans les textes JSON (paramètres d'une série).
 */

type Valeur = string | number | null;
export type Ligne = Readonly<Record<string, Valeur>>;
export type Lignes = Readonly<Partial<Record<string, readonly Ligne[]>>>;

export interface Jeu {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: Lignes;
}

export interface Cible {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly nomUtilisateur: string;
  readonly nomFerme: string;
}

const MOTIF_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Clé de doublon d'une ligne (valeurs déjà rattachées), ou null si la table n'est jamais
 * dédoublonnée. Une ligne supprimée n'est ni écartée ni prise pour modèle.
 */
function cleDoublon(table: string, l: Ligne): string | null {
  if (l.supprime_le !== undefined && l.supprime_le !== null) return null;
  const v = (c: string) => String(l[c] ?? '');
  switch (table) {
    case 'utilisateur':
    case 'ferme':
      return v('id');
    case 'membre':
      return `${v('utilisateur_id')}|${v('ferme_id')}`;
    case 'saison':
    case 'famille':
    case 'espece':
      return v('nom');
    case 'zone':
      return `${v('nom')}|${v('zone_parente_id')}`;
    case 'emplacement':
      return v('code');
    case 'variete':
      return `${v('espece_id')}|${v('nom')}`;
    default:
      return null;
  }
}

/** Tables d'abord traitées, dans cet ordre : celles que les suivantes référencent. */
const ORDRE: readonly string[] = ['utilisateur', 'ferme', 'membre', 'saison', 'zone', 'famille', 'espece', 'variete', 'emplacement'];

function tablesDans(lignes: Lignes): string[] {
  const presentes = Object.keys(lignes);
  return [...ORDRE.filter((t) => presentes.includes(t)), ...presentes.filter((t) => !ORDRE.includes(t))];
}

/**
 * Fusionne les jeux, dans l'ordre (le premier l'emporte sur un doublon). Rend les lignes à écrire,
 * par table, dans l'ordre d'écriture.
 */
export function fusionnerJeux(jeux: readonly Jeu[], cible: Cible): Map<string, Ligne[]> {
  const sortie = new Map<string, Ligne[]>();
  const vus = new Map<string, string>();
  const remplacer = new Map<string, string>();
  const rattacher = (valeur: Valeur): Valeur => (typeof valeur === 'string' ? valeur.replace(MOTIF_ID, (id) => remplacer.get(id) ?? id) : valeur);

  for (const jeu of jeux) {
    remplacer.set(jeu.utilisateurId, cible.utilisateurId);
    remplacer.set(jeu.fermeId, cible.fermeId);
    for (const table of tablesDans(jeu.lignes)) {
      const lignes = [...(jeu.lignes[table] ?? [])];
      // Zones : les racines avant leurs sous-zones (une sous-zone désigne sa racine rattachée).
      if (table === 'zone') lignes.sort((a, b) => Number(a.zone_parente_id !== null) - Number(b.zone_parente_id !== null));
      for (const brute of lignes) {
        const ligne: Record<string, Valeur> = {};
        for (const [c, v] of Object.entries(brute)) ligne[c] = rattacher(v);
        if (table === 'ferme' && ligne.id === cible.fermeId) ligne.nom = cible.nomFerme;
        if (table === 'utilisateur' && ligne.id === cible.utilisateurId) ligne.nom = cible.nomUtilisateur;
        const cle = cleDoublon(table, ligne);
        const modele = cle === null ? undefined : vus.get(`${table}:${cle}`);
        if (modele !== undefined) {
          const id = ligne.id;
          if (typeof id === 'string' && id !== modele) remplacer.set(String(brute.id), modele);
          continue;
        }
        if (cle !== null && typeof ligne.id === 'string') vus.set(`${table}:${cle}`, ligne.id);
        let liste = sortie.get(table);
        if (liste === undefined) {
          liste = [];
          sortie.set(table, liste);
        }
        liste.push(ligne);
      }
    }
  }
  return sortie;
}

const MOTIF_DATE = /\b(\d{4})-(\d{2})-(\d{2})/g;

const JOUR_MS = 86_400_000;

/** 'AAAA-MM-JJ' + `jours` jours civils, calculé en UTC (aucun fuseau, aucune heure d'été). */
function plusJours(annee: number, mois: number, jour: number, jours: number): string {
  return new Date(Date.UTC(annee, mois - 1, jour) + jours * JOUR_MS).toISOString().slice(0, 10);
}

/** Année où tombe le milieu de l'année `annee` (1er juillet) une fois décalé de `jours` jours. */
function anneeDecalee(annee: number, jours: number): number {
  return Number(plusJours(annee, 7, 1, jours).slice(0, 4));
}

/**
 * Décale de `jours` jours civils (négatif : recule) toutes les dates AAAA-MM-JJ d'un jeu à dates
 * fixes (seules, en tête d'un horodatage ou dans un texte JSON), pour garder son écart au jour du
 * téléphone à la journée près. Les années restent cohérentes : la colonne `annee` et une saison
 * d'année civile (nom AAAA, du 1er janvier au 31 décembre) passent à l'année où tombe le milieu
 * de leur année une fois décalé ; la saison reste une année civile (deux saisons qui tombent la
 * même année sont fusionnées par `fusionnerJeux`).
 */
export function decalerJours(lignes: Lignes, jours: number): Lignes {
  if (jours === 0) return lignes;
  const decalerTexte = (v: string): string =>
    v.replace(MOTIF_DATE, (_, a: string, m: string, j: string) => plusJours(Number(a), Number(m), Number(j), jours));
  const sortie: Partial<Record<string, Ligne[]>> = {};
  for (const [table, liste] of Object.entries(lignes)) {
    sortie[table] = (liste ?? []).map((l) => {
      const nom = l.nom;
      if (table === 'saison' && typeof nom === 'string' && /^\d{4}$/.test(nom) && l.debut === `${nom}-01-01` && l.fin === `${nom}-12-31`) {
        const annee = String(anneeDecalee(Number(nom), jours));
        const d: Record<string, Valeur> = {};
        for (const [c, v] of Object.entries(l)) d[c] = typeof v === 'string' ? decalerTexte(v) : v;
        return { ...d, nom: annee, debut: `${annee}-01-01`, fin: `${annee}-12-31` };
      }
      const d: Record<string, Valeur> = {};
      for (const [c, v] of Object.entries(l)) {
        d[c] = typeof v === 'string' ? decalerTexte(v) : typeof v === 'number' && c === 'annee' ? anneeDecalee(v, jours) : v;
      }
      return d;
    });
  }
  return sortie;
}
