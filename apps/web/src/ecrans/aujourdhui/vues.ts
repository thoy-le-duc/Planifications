/**
 * Ce que l'écran « Aujourd'hui » dessine d'une tâche et d'une saisie de l'historique, en textes
 * prêts à afficher (T13d). Les cartes de la journée relue et celles de l'instantané passent par
 * les mêmes vues : l'instantané (./instantane.ts) ne garde que ces textes, rien de plus que ce
 * que l'écran montre.
 */
import {
  capitale,
  codesEmplacements,
  dateCourte,
  ETAPES_FAITES,
  LIBELLES_CATEGORIES,
  nombreFrancais,
  nomCulture,
  phraseDeTache,
  quand,
  quantiteAvecUnite,
  VERBES,
  type EntreeHistorique,
  type EvenementLu,
  type TacheJour,
} from './calculs.ts';

// Définis dans calculs.ts (morceau partagé avec la vue 3D, T37) ; exportés d'ici, où l'écran les cherche.
export { phraseDeTache, tachesDeLEcran } from './calculs.ts';

/** Carte d'une tâche, telle que dessinée. */
export interface CarteVue {
  /** data-cle (id de la série ou de la campagne, étape, occurrence d'un travail). */
  readonly cle: string;
  readonly retard: boolean;
  readonly joursRetard: number;
  /** Verbe de l'étape, ou catégorie d'un travail. */
  readonly surtitre: string;
  readonly titre: string;
  readonly detail: string;
  readonly codes: string | null;
  /** Temps estimé d'un travail, en minutes (compté dans la charge de la semaine). */
  readonly minutes: number | null;
  /** Suffixe de la classe de la bande de couleur (famille, travail, retard). */
  readonly bande: string;
  readonly travail: boolean;
  /** Début de récolte : « Peser » au lieu de « Fait ». */
  readonly peser: boolean;
  /** Nom accessible du bouton (« Marquer fait : planter chou pointu »). */
  readonly action: string;
}

export type TypeSaisie = EvenementLu['detail']['type'];

/** Saisie de l'historique, telle que dessinée. */
export interface SaisieVue {
  /** Id de l'événement en vigueur (data-evenement). */
  readonly id: string;
  readonly type: TypeSaisie;
  readonly quoi: string;
  /** Culture nommée, ou « Culture retirée ». */
  readonly culture: string;
  /** Quand, et les codes des emplacements. */
  readonly quand: string;
  /** Ce que nomment ses boutons (« Récolte 12 kg, Tomate, aujourd'hui »), unique dans la liste. */
  readonly nom: string;
  readonly retiree: boolean;
}

/** Libellé de l'étape faite, pour le bandeau et l'historique. */
export function libelleEvenement(e: EvenementLu): string {
  const d = e.detail;
  switch (d.type) {
    case 'realise':
      return ETAPES_FAITES[d.etape];
    case 'recolte':
      return `Récolte · ${quantiteAvecUnite(d.quantite, d.unite)}`;
    case 'intervention':
      return capitale(d.libelle);
  }
}

/** Ce que nomme une saisie : « Récolte 12 kg, Tomate Cœur de bœuf, aujourd'hui ». */
function nomSaisie(h: EntreeHistorique, aujourdhui: string): string {
  const e = h.evenement;
  const quoi = e.detail.type === 'recolte' ? `Récolte ${quantiteAvecUnite(e.detail.quantite, e.detail.unite)}` : libelleEvenement(e);
  return `${quoi}, ${h.culture === null ? 'culture retirée' : nomCulture(h.culture)}, ${quand(e.date, aujourdhui)}`;
}

function detailTache(t: TacheJour, aujourdhui: string): string {
  const { tache, culture } = t;
  const morceaux: string[] = [];
  if (tache.etape === 'travail') {
    // Un travail se lit par son libellé : la culture vient ensuite, avec le produit à épandre.
    morceaux.push(nomCulture(culture));
    const produit = tache.travail.produit;
    if (produit !== null) {
      const dose = `${nombreFrancais(produit.quantite.valeur)} ${produit.quantite.unite}`;
      morceaux.push(produit.nom.toLocaleLowerCase('fr') === tache.travail.type.toLocaleLowerCase('fr') ? dose : `${produit.nom} ${dose}`);
    }
  } else if (tache.variete !== null) morceaux.push(tache.variete);
  if (tache.taille.unite === 'longueur') morceaux.push(`${String(tache.taille.longueurM).replace('.', ',')} m`);
  else if (tache.taille.nombrePlants > 0) morceaux.push(`${String(tache.taille.nombrePlants)} plants`);
  morceaux.push(tache.enRetard ? `prévu le ${dateCourte(tache.datePrevue)}` : quand(tache.datePrevue, aujourdhui));
  return morceaux.join(' · ');
}

/** Carte d'une tâche de la journée (maquette Main). */
export function vueCarte(t: TacheJour, aujourdhui: string): CarteVue {
  const { tache, culture } = t;
  const travail = tache.etape === 'travail' ? tache : null;
  const surtitre = tache.etape === 'travail' ? LIBELLES_CATEGORIES[tache.travail.categorie] : VERBES[tache.etape];
  const peser = tache.etape === 'debut_recolte';
  const phrase = phraseDeTache(t);
  return {
    cle: t.cle,
    retard: tache.enRetard,
    joursRetard: tache.joursDeRetard,
    surtitre,
    titre: travail === null ? culture.espece : capitale(travail.travail.type),
    detail: detailTache(t, aujourdhui),
    codes: codesEmplacements(tache.emplacements),
    minutes: travail?.tempsEstimeMinutes ?? null,
    bande: tache.enRetard ? 'retard' : travail !== null ? 'travail' : (culture.famille ?? 'neutre'),
    travail: travail !== null,
    peser,
    action: peser ? `Saisir une récolte : ${culture.espece.toLowerCase()}` : `Marquer fait : ${phrase}`,
  };
}

/**
 * Saisies de l'historique, dans l'ordre donné. Deux saisies identiques gardent des noms distincts
 * (« (2) » ajouté à la seconde) : le rang ne compte que les saisies qui la précèdent.
 */
export function vuesHistorique(entrees: readonly EntreeHistorique[], aujourdhui: string): SaisieVue[] {
  const deja = new Map<string, number>();
  return entrees.map((h) => {
    const e = h.evenement;
    const base = nomSaisie(h, aujourdhui);
    const rang = deja.get(base) ?? 0;
    deja.set(base, rang + 1);
    const codes = h.culture === null ? null : codesEmplacements(h.culture.emplacements);
    return {
      id: e.id,
      type: e.detail.type,
      quoi: libelleEvenement(e),
      culture: h.culture === null ? 'Culture retirée' : nomCulture(h.culture),
      quand: [quand(e.date, aujourdhui), codes].filter((x) => x !== null).join(' · '),
      nom: rang === 0 ? base : `${base} (${String(rang + 1)})`,
      retiree: h.culture === null,
    };
  });
}
