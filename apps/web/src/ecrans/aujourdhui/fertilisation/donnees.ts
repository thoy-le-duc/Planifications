/**
 * Saisie d'un apport (T54) : lectures (planches actives, produits fertilisants de la ferme) et
 * écriture par la porte, en ajout seul. Une saisie = UNE transaction ; la ligne est vérifiée par
 * les règles du serveur (`validerSaisie`) avant d'être écrite. Le détail vient du cœur
 * (`detailApport`) : produit de la ferme désigné par son id, ou texte libre (sans bilan).
 */
import { detailApport, validerSaisie, type DateCalendaire, type Id, type Quantite } from '@planif/core';
import type { PorteDonnees, SaisieEvenement } from '@planif/sync';

/** Écriture refusée avant l'envoi (règle du serveur), avec un message clair. */
export class ApportRefuse extends Error {}

export interface PlancheActive {
  readonly id: string;
  readonly code: string;
}

export interface ProduitChoisissable {
  readonly id: string;
  readonly nom: string;
  readonly unite: string;
}

/** Paramètres : ferme, jour, jour. */
const SQL_PLANCHES = `SELECT id, code FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL AND actif_du <= ? AND (actif_au IS NULL OR actif_au > ?)`;

const SQL_PRODUITS = `SELECT id, nom, unite FROM produit_fertilisant WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY nom, id`;

export async function lirePlanches(porte: PorteDonnees, fermeId: string, jour: string): Promise<PlancheActive[]> {
  const l = await porte.lire<{ id: string; code: string }>(SQL_PLANCHES, [fermeId, jour, jour]);
  return l.map((x) => ({ id: x.id, code: x.code })).sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }) || a.id.localeCompare(b.id));
}

export async function lireProduits(porte: PorteDonnees, fermeId: string): Promise<ProduitChoisissable[]> {
  const l = await porte.lire<{ id: string; nom: string; unite: string }>(SQL_PRODUITS, [fermeId]);
  return l.map((x) => ({ id: x.id, nom: x.nom, unite: x.unite }));
}

export interface SaisieApport {
  readonly date: string;
  readonly emplacementIds: readonly string[];
  readonly categorie: 'fertilisation' | 'amendement';
  readonly produit: { readonly id: string | null; readonly nom: string };
  readonly quantite: Quantite;
}

/** Écrit l'apport (une transaction) ; rend l'id de l'événement. */
export async function ecrireApport(porte: PorteDonnees, s: SaisieApport): Promise<string> {
  const saisie: SaisieEvenement = {
    type: 'intervention',
    date: s.date as DateCalendaire,
    source: 'tap',
    culture: null,
    emplacementIds: s.emplacementIds as Id<'Emplacement'>[],
    note: null,
    photos: [],
    remplaceEvenement: null,
    detail: detailApport(s.categorie, s.produit, s.quantite),
  };
  const e = porte.preparerSaisie(saisie);
  const r = validerSaisie(e.ligne);
  if (!r.ok) throw new ApportRefuse(r.erreur.message);
  await porte.ecrireEnsemble([e.ordre]);
  return e.id;
}
