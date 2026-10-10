/**
 * Contrat de T32g, porte du téléphone (docs/backlog/T32g-personnaliser-espece.md ; Q39) :
 * « Personnaliser » une espèce de la bibliothèque commune = en faire une copie propre à la ferme,
 * que le gérant règle ensuite (porte.reglerProfilCroissance, ./contrat-profil.ts). Proposé par le
 * testeur ; l'écran Itinéraires culturaux (apps/web/src/ecrans/itineraires) s'en sert.
 *
 *   porte.personnaliserEspece(especeBibliothequeId: string): Promise<string>
 *
 * Méthode de `PorteDonnees` (packages/sync/src/types.ts), chargée à la demande comme
 * `reglerProfilCroissance` si besoin. Les tests la cherchent sur la porte rendue par `creerPorte`
 * et échouent clairement tant qu'elle manque. Rend l'id de la copie (UUID v7 du générateur de la
 * porte).
 *
 * ── Ce qui s'écrit ───────────────────────────────────────────────────────────────────────────
 *
 * UNE transaction locale par appel (un envoi au serveur, tout ou rien) ; dedans, exactement UN
 * `INSERT INTO espece (...)`, rien d'autre : ni UPDATE ni DELETE d'aucune ligne (l'espèce de la
 * bibliothèque, ses itinéraires, variétés, séries, plantations, assolements, articles de stock
 * restent tels quels et toujours liés à l'espèce d'origine : rien n'est réécrit en silence, Q39) ;
 * jamais d'écriture dans `modification` (le serveur l'écrit). La copie :
 *   - id : nouvel id ; ferme_id : la ferme de la porte ;
 *   - famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans,
 *     delai_retour_conseille_ans : ceux de l'espèce de la bibliothèque (la famille reste celle de
 *     la bibliothèque, permise pour une espèce de la ferme : docs/modele-donnees.md, Isolement) ;
 *   - profil_croissance : le texte JSON du profil EFFECTIF de l'espèce d'origine
 *     (`profilEffectif` de @planif/core : la bibliothèque n'en porte pas, c'est donc le profil par
 *     défaut de son nom, `fougereApresRecolte: true` compris pour l'asperge, Q33) — jamais nul ;
 *   - cree_le = modifie_le = maintenant de la porte (ISO UTC) ; supprime_le NULL.
 *
 * ── Origine de la copie (décision du testeur, à confirmer par le chef) ───────────────────────
 *
 * AUCUNE colonne nouvelle, aucune migration : la copie retient son origine par son NOM, qui est
 * celui de l'espèce d'origine. C'est déjà par le nom que le cœur retrouve le profil par défaut
 * (`profilParDefaut`), donc « Rétablir la valeur par défaut » sur la copie rend bien celui de la
 * Tomate. « Déjà personnalisée » = la ferme de la porte a une espèce NON SUPPRIMÉE de même nom,
 * rapproché comme le cœur rapproche les noms (sans casse, sans accents, espaces en trop retirés).
 * Une espèce d'une autre ferme ne compte pas ; une copie supprimée (supprime_le non nul) non plus.
 * Limite assumée : une espèce « Tomate » créée à la main par la ferme bloque aussi la
 * personnalisation de la Tomate de la bibliothèque (une seule « Tomate » dans la ferme).
 *
 * ── Rejets (promesse rejetée, RIEN d'écrit) ──────────────────────────────────────────────────
 *
 *   - l'utilisateur de la porte n'est pas gérant actif de la ferme de la porte (ligne locale
 *     `membre` : role 'gerant', etat 'accepte', non supprimée) → message EXACTEMENT
 *     SEUL_LE_GERANT_PERSONNALISER ;
 *   - déjà personnalisée → message qui contient « <nom> est déjà personnalisée » (nom de l'espèce
 *     de la bibliothèque, « Tomate est déjà personnalisée ») ;
 *   - espèce introuvable, supprimée, ou qui n'est pas de la bibliothèque commune (espèce de la
 *     ferme, ou d'une autre ferme) → rejet (message libre, en français).
 */
import type { PorteDonnees } from './contrat.ts';

export const SEUL_LE_GERANT_PERSONNALISER = 'Seul le gérant peut personnaliser une espèce.';

/** Le message de la deuxième personnalisation d'une même espèce (Q39). */
export const dejaPersonnalisee = (nom: string): string => `${nom} est déjà personnalisée`;

export type PortePersonnaliser = PorteDonnees & { personnaliserEspece?: (especeBibliothequeId: string) => Promise<string> };

/** La méthode de T32g, ou une erreur claire tant qu'elle n'existe pas. */
export function exigerPersonnaliser(porte: PorteDonnees): (especeBibliothequeId: string) => Promise<string> {
  const p = porte as PortePersonnaliser;
  const f = p.personnaliserEspece;
  if (typeof f !== 'function') throw new Error('la porte n’a pas encore personnaliserEspece (T32g)');
  return (especeBibliothequeId) => f.call(p, especeBibliothequeId);
}
