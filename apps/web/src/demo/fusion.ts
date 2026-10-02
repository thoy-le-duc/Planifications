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

function bissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

/**
 * Décale de `annees` toutes les dates (AAAA-MM-JJ, seules ou en tête d'un horodatage ou dans un
 * texte JSON), les années (colonne `annee`) et les noms de saison (AAAA) d'un jeu à dates fixes, pour le rapprocher du jour du
 * téléphone. Un 29 février d'une année non bissextile devient le 28.
 */
export function decalerAnnees(lignes: Lignes, annees: number): Lignes {
  if (annees === 0) return lignes;
  const decaler = (v: Valeur, table: string, colonne: string): Valeur => {
    if (typeof v === 'number') return colonne === 'annee' ? v + annees : v;
    if (v === null) return v;
    if (table === 'saison' && colonne === 'nom' && /^\d{4}$/.test(v)) return String(Number(v) + annees);
    return v.replace(MOTIF_DATE, (_, a: string, m: string, j: string) => {
      const annee = Number(a) + annees;
      const jour = m === '02' && j === '29' && !bissextile(annee) ? '28' : j;
      return `${String(annee).padStart(4, '0')}-${m}-${jour}`;
    });
  };
  const sortie: Partial<Record<string, Ligne[]>> = {};
  for (const [table, liste] of Object.entries(lignes)) {
    sortie[table] = (liste ?? []).map((l) => {
      const d: Record<string, Valeur> = {};
      for (const [c, v] of Object.entries(l)) d[c] = decaler(v, table, c);
      return d;
    });
  }
  return sortie;
}
