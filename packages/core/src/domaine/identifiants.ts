/**
 * Identifiants des entités : UUID v7 (RFC 9562) marqués par le nom de l'entité.
 *
 * Générés sur le téléphone, hors ligne, sans collision ; l'horodatage en tête garde l'ordre
 * de création. Le moteur ne lit ni l'horloge ni l'aléa du système : l'appli les injecte.
 */

declare const marqueId: unique symbol;

/** Noms des entités du modèle v1 (docs/modele-donnees.md), plus l'utilisateur auteur des saisies. */
export type NomEntite =
  | 'Ferme'
  | 'Zone'
  | 'Emplacement'
  | 'SecteurIrrigation'
  | 'SecteurEmplacement'
  /** Bâtiment de la ferme : serre, hangar, magasin (T28a). */
  | 'Batiment'
  | 'Famille'
  | 'Espece'
  | 'Variete'
  | 'Itineraire'
  /** Type d'intervention de la ferme ou de la liste de départ (T23). */
  | 'TypeIntervention'
  | 'Saison'
  | 'Serie'
  | 'Plantation'
  | 'Campagne'
  | 'Occupation'
  | 'Assolement'
  | 'Evenement'
  | 'ArticleStock'
  | 'MouvementStock'
  | 'ProduitPhyto'
  | 'Proposition'
  | 'Modification'
  /** Compte d'une personne (défini avec les comptes, T09) ; auteur des événements. */
  | 'Utilisateur';

/**
 * Identifiant UUID v7 d'une entité : `Id<'Serie'>`, `Id<'Emplacement'>`…
 * Lisible comme une string ; ni une string brute ni l'Id d'une autre entité ne lui est assignable.
 */
export type Id<E extends NomEntite> = string & { readonly [marqueId]: E };

/** Sources injectées dans le générateur : horloge et aléa du système, ou simulés en test. */
export interface SourcesId {
  /** Millisecondes depuis l'époque Unix (instant UTC, pas une date calendaire). */
  readonly horloge: () => number;
  /** Renvoie exactement `nombreOctets` octets aléatoires. */
  readonly aleatoire: (nombreOctets: number) => Uint8Array;
}

// Le paramètre de type choisit la marque de l'Id renvoyé : generer<'Serie'>().
export type GenerateurId = <E extends NomEntite>() => Id<E>;

/** 2^48 : l'horodatage tient sur 48 bits. */
const HORODATAGE_MAX = 0x1000000000000;
/** Le compteur occupe les 12 bits de rand_a. */
const COMPTEUR_MAX = 0xfff;
/** À chaque nouvelle milliseconde, le compteur repart d'une valeur aléatoire sur 11 bits (RFC 9562 §6.2, méthode 1) : la moitié haute reste libre pour les incréments. */
const MASQUE_GRAINE_COMPTEUR = 0x7ff;
/** 2 octets pour la graine du compteur + 8 octets pour rand_b. */
const OCTETS_ALEATOIRES = 10;

function hex(octet: number): string {
  return octet.toString(16).padStart(2, '0');
}

/**
 * Crée un générateur d'UUID v7 monotone : chaque identifiant est strictement plus grand que le
 * précédent (ordre des chaînes), même quand l'horloge stagne ou recule.
 *
 * Disposition (RFC 9562 §5.7) : 48 bits d'horodatage en ms, version 7, rand_a (12 bits) utilisé
 * comme compteur, variante 10, rand_b (62 bits) aléatoire.
 */
export function creerGenerateurId(sources: SourcesId): GenerateurId {
  let dernierInstant = -1;
  let compteur = 0;

  function generer<E extends NomEntite>(): Id<E> {
    const instant = sources.horloge();
    if (!Number.isSafeInteger(instant) || instant < 0 || instant >= HORODATAGE_MAX) {
      throw new RangeError(`horloge invalide pour un UUID v7 : ${String(instant)}`);
    }
    const alea = sources.aleatoire(OCTETS_ALEATOIRES);
    if (alea.length !== OCTETS_ALEATOIRES) {
      throw new RangeError(`la source d'aléa doit renvoyer ${String(OCTETS_ALEATOIRES)} octets`);
    }
    const octet = (i: number): number => alea[i] ?? 0;

    if (instant > dernierInstant) {
      dernierInstant = instant;
      compteur = ((octet(0) << 8) | octet(1)) & MASQUE_GRAINE_COMPTEUR;
    } else if (compteur < COMPTEUR_MAX) {
      // Horloge immobile ou en recul : on garde le dernier instant et on incrémente.
      compteur += 1;
    } else {
      // Compteur épuisé : on avance l'horodatage d'une milliseconde.
      if (dernierInstant + 1 >= HORODATAGE_MAX) {
        throw new RangeError('horodatage UUID v7 épuisé');
      }
      dernierInstant += 1;
      compteur = ((octet(0) << 8) | octet(1)) & MASQUE_GRAINE_COMPTEUR;
    }

    const horodatage = dernierInstant.toString(16).padStart(12, '0');
    const randA = compteur.toString(16).padStart(3, '0');
    // Variante 10 dans les deux bits de poids fort de rand_b.
    const debutRandB = hex((octet(2) & 0x3f) | 0x80) + hex(octet(3));
    let finRandB = '';
    for (let i = 4; i < OCTETS_ALEATOIRES; i++) {
      finRandB += hex(octet(i));
    }
    return `${horodatage.slice(0, 8)}-${horodatage.slice(8, 12)}-7${randA}-${debutRandB}-${finRandB}` as Id<E>;
  }

  return generer;
}
