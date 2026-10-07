/**
 * Écritures de l'écran « Aujourd'hui » (T13), toutes par la porte et en ajout seul : jamais
 * d'UPDATE ni de DELETE sur le journal ou le stock. Une saisie = UNE transaction
 * (`porte.ecrireEnsemble`) : l'événement, et pour une récolte le mouvement de stock (et l'article
 * s'il faut le créer). Contrat : ./test/contrat.ts (« Règles (écriture) »).
 *
 * Chaque ligne est vérifiée avant d'être écrite par les règles du serveur (@planif/core :
 * `validerSaisie`, `validerArticleStock`, `validerMouvementStock`) : une ligne que le serveur
 * refuserait n'entre jamais dans la file d'envoi. Le mouvement d'une annulation ou d'une
 * correction vient de `mouvementAttendu` (T10c), jamais d'une soustraction faite ici.
 */
import {
  creerGenerateurId,
  mouvementAttendu,
  validerArticleStock,
  validerMouvementStock,
  validerSaisie,
  type DateCalendaire,
  type DetailIntervention,
  type DetailRealise,
  type DetailRecolte,
  type EtapeRealisee,
  type Id,
  type RemplacementEvenement,
  type TravailPrevu,
  type UniteRecolte,
} from '@planif/core';
import type { EvenementPrepare, OrdreEcriture, PorteDonnees, SaisieEvenement, VerificationEcriture } from '@planif/sync';
import { chaineDe, DejaFait, type Lire } from '@planif/sync/fait-unique';
import { annoncerSaisie } from './cache.ts';
import { COLONNES_DETAIL, evenementLu, listeTextes, type Culture, type EvenementLu, type LigneJournal } from './calculs.ts';

const nouvelId = creerGenerateurId({
  horloge: () => Date.now(),
  aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

export interface ContexteEcriture {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** 'AAAA-MM-JJ'. */
  readonly aujourdhui: string;
}

/** Une ligne refusée par les règles du serveur : jamais écrite. */
export class SaisieRefusee extends Error {}

/**
 * T13h : « Fait » déjà noté (réalisé ou intervention en vigueur) : rien n'est écrit. T13i : la
 * classe de @planif/sync, la même que lève `porte.saisirEvenement` (voix, agent).
 */
export { DejaFait };

const SQL_ARTICLE = 'INSERT INTO article_stock (id, ferme_id, espece_id, variete_id, unite, categorie) VALUES (?, ?, ?, ?, ?, ?)';
const SQL_MOUVEMENT = 'INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif, recolte_id) VALUES (?, ?, ?, ?, ?, ?, ?)';

const SQL_TROUVER_ARTICLE = `SELECT id FROM article_stock
  WHERE ferme_id = ? AND espece_id = ? AND variete_id IS ? AND unite = ? AND categorie IS NULL AND supprime_le IS NULL
  ORDER BY id LIMIT 1`;

/**
 * Stock de la chaîne d'une récolte, par article : les mouvements rattachés à l'origine de la
 * chaîne (remontée par remplace_evenement_id), à ses corrections et à leurs annulations.
 * Profondeur bornée comme au serveur.
 */
const SQL_STOCK_CHAINE = `WITH RECURSIVE
  montee(id, parent, n) AS (
    SELECT id, remplace_evenement_id, 0 FROM evenement WHERE id = ?
    UNION ALL
    SELECT e.id, e.remplace_evenement_id, m.n + 1 FROM evenement e JOIN montee m ON e.id = m.parent WHERE m.n < 1000
  ),
  origine(id) AS (SELECT id FROM montee ORDER BY n DESC LIMIT 1),
  chaine(id) AS (
    SELECT id FROM origine
    UNION
    SELECT e.id FROM evenement e JOIN chaine c ON e.remplace_evenement_id = c.id
  )
  SELECT article_stock_id AS article, SUM(quantite) AS somme FROM mouvement_stock
  WHERE recolte_id IN (SELECT id FROM chaine)
  GROUP BY article_stock_id ORDER BY article_stock_id`;

/**
 * Prépare l'événement et le vérifie par les règles du serveur. T13j : pour un « Fait », la porte
 * rend aussi la vérification « déjà fait » (`verification`), à passer à l'écriture.
 */
function evenement(porte: PorteDonnees, saisie: SaisieEvenement): EvenementPrepare {
  const e = porte.preparerSaisie(saisie);
  const r = validerSaisie(e.ligne);
  if (!r.ok) throw new SaisieRefusee(r.erreur.message);
  return e;
}

function ordreArticle(ctx: ContexteEcriture, culture: Culture, unite: UniteRecolte): { readonly id: string; readonly ordre: OrdreEcriture } {
  const id = nouvelId<'ArticleStock'>();
  const ligne = { id, ferme_id: ctx.fermeId, espece_id: culture.especeId, variete_id: culture.varieteId, unite, categorie: null };
  const r = validerArticleStock(ligne);
  if (!r.ok) throw new SaisieRefusee(r.erreur.message);
  return { id, ordre: { sql: SQL_ARTICLE, parametres: [id, ctx.fermeId, culture.especeId, culture.varieteId, unite, null] } };
}

function ordreMouvement(ctx: ContexteEcriture, articleId: string, quantite: number, recolteId: string): OrdreEcriture {
  const id = nouvelId<'MouvementStock'>();
  const ligne = { id, ferme_id: ctx.fermeId, article_stock_id: articleId, date: ctx.aujourdhui, quantite, motif: 'recolte', recolte_id: recolteId };
  const r = validerMouvementStock(ligne);
  if (!r.ok) throw new SaisieRefusee(r.erreur.message);
  return { sql: SQL_MOUVEMENT, parametres: [id, ctx.fermeId, articleId, ctx.aujourdhui, quantite, 'recolte', recolteId] };
}

/**
 * Article de la ferme pour (espèce, variété, unité, catégorie nulle) : l'existant, sinon un
 * ordre qui le crée dans la même transaction.
 */
async function article(ctx: ContexteEcriture, culture: Culture, unite: UniteRecolte): Promise<{ readonly id: string; readonly ordres: OrdreEcriture[] }> {
  const existant = await ctx.porte.lire<{ id: string }>(SQL_TROUVER_ARTICLE, [ctx.fermeId, culture.especeId, culture.varieteId, unite]);
  const id = existant[0]?.id;
  if (id !== undefined) return { id, ordres: [] };
  const cree = ordreArticle(ctx, culture, unite);
  return { id: cree.id, ordres: [cree.ordre] };
}

const culturePour = (culture: Culture) => culture.cible;

/**
 * Écrit les ordres d'une saisie en UNE transaction, annoncée d'abord à la journée suivie (T13c) :
 * le changement qui suit ne relit que le journal de la culture touchée. `remplace` : la saisie
 * corrige ou annule une saisie (les chaînes du journal changent). Sans culture, rien n'est
 * annoncé : la journée sera relue en entier.
 */
async function ecrireSaisie(
  ctx: ContexteEcriture,
  culture: SaisieEvenement['culture'],
  remplace: boolean,
  ordres: readonly OrdreEcriture[],
  verifier?: VerificationEcriture,
): Promise<void> {
  const retirer = culture === null ? () => undefined : annoncerSaisie(ctx.porte, ctx.fermeId, culture, remplace);
  try {
    await ctx.porte.ecrireEnsemble(ordres, verifier);
  } catch (e) {
    retirer();
    throw e;
  }
}
const emplacementsDe = (culture: Culture) => culture.emplacements.map((e) => e.id);

/**
 * « Fait » : le réalisé de l'étape, à la date du jour. T13h : rejet DejaFait, rien d'écrit, si un
 * réalisé de cette étape est déjà en vigueur pour la culture (vérifié dans la transaction).
 */
export async function marquerFait(ctx: ContexteEcriture, culture: Culture, etape: EtapeRealisee): Promise<Id<'Evenement'>> {
  const detail: DetailRealise = { etape, quantiteReelle: null };
  const e = evenement(ctx.porte, {
    type: 'realise',
    date: ctx.aujourdhui as DateCalendaire,
    source: 'tap',
    culture: culturePour(culture),
    emplacementIds: emplacementsDe(culture),
    note: null,
    photos: [],
    remplaceEvenement: null,
    detail,
  });
  // Vérification « déjà fait » rendue par la porte (T13j), lue DANS la transaction d'écriture.
  await ecrireSaisie(ctx, culturePour(culture), false, [e.ordre], e.verification);
  return e.id;
}

/**
 * Détail de l'intervention qui solde un travail prévu (T22) : même catégorie, même libellé,
 * l'outil ; le produit et sa quantité en fertilisation et amendement (validerSaisie les exige) ;
 * l'occurrence visée, date prévue de la carte touchée (T22b, Q24 : elle solde cette occurrence
 * et les précédentes, jamais la suivante).
 */
export function detailDuTravail(travail: TravailPrevu, occurrenceVisee: DateCalendaire): DetailIntervention {
  const commun = { type: travail.type, outil: travail.outil, occurrenceVisee };
  switch (travail.categorie) {
    case 'fertilisation':
    case 'amendement': {
      const produit = travail.produit;
      if (produit === null) throw new SaisieRefusee('produit manquant pour ce travail prévu');
      return { ...commun, categorie: travail.categorie, produit: produit.nom, quantite: produit.quantite };
    }
    case 'couverture':
      return { ...commun, categorie: 'couverture', dureeOccupationJours: null };
    case 'travail_sol':
    case 'entretien':
      return { ...commun, categorie: travail.categorie };
  }
}

/**
 * « Fait » sur un travail prévu (T22) : l'intervention du même type, à la date du jour, qui porte
 * l'occurrence visée `datePrevue` (la date de la carte touchée, T22b). T13h : rejet DejaFait,
 * rien d'écrit, si une intervention de ce travail (libellé, catégorie) pour cette occurrence est déjà en vigueur.
 */
export async function marquerTravailFait(
  ctx: ContexteEcriture,
  culture: Culture,
  travail: TravailPrevu,
  datePrevue: DateCalendaire,
): Promise<Id<'Evenement'>> {
  const e = evenement(ctx.porte, {
    type: 'intervention',
    date: ctx.aujourdhui as DateCalendaire,
    source: 'tap',
    culture: culturePour(culture),
    emplacementIds: emplacementsDe(culture),
    note: null,
    photos: [],
    remplaceEvenement: null,
    detail: detailDuTravail(travail, datePrevue),
  });
  // Vérification « déjà fait » rendue par la porte (T13j) : libellé, catégorie, occurrence visée.
  await ecrireSaisie(ctx, culturePour(culture), false, [e.ordre], e.verification);
  return e.id;
}

/** Récolte : l'événement et son entrée en stock (+quantité), l'article créé s'il n'existe pas. */
export async function noterRecolte(ctx: ContexteEcriture, culture: Culture, quantite: number, unite: UniteRecolte): Promise<Id<'Evenement'>> {
  const detail: DetailRecolte = { quantite, unite, categorie: null };
  const e = evenement(ctx.porte, {
    type: 'recolte',
    date: ctx.aujourdhui as DateCalendaire,
    source: 'tap',
    culture: culturePour(culture),
    emplacementIds: emplacementsDe(culture),
    note: null,
    photos: [],
    remplaceEvenement: null,
    detail,
  });
  const a = await article(ctx, culture, unite);
  await ecrireSaisie(ctx, culturePour(culture), false, [...a.ordres, e.ordre, ordreMouvement(ctx, a.id, quantite, e.id)]);
  return e.id;
}

const SQL_ORIGINAL = 'SELECT emplacement_ids, note, photos, detail FROM evenement WHERE id = ?';

/**
 * Emplacements encore actifs le jour donné, parmi `ids` (le serveur refuse un emplacement
 * supprimé ; un emplacement retiré du plan ne se recopie pas).
 */
async function emplacementsActifs(ctx: ContexteEcriture, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const actifs = await ctx.porte.lire<{ id: string }>(
    `SELECT id FROM emplacement WHERE id IN (${ids.map(() => '?').join(', ')})
       AND supprime_le IS NULL AND actif_du <= ? AND (actif_au IS NULL OR actif_au > ?)`,
    [...ids, ctx.aujourdhui, ctx.aujourdhui],
  );
  const garder = new Set(actifs.map((l) => l.id.toLowerCase()));
  return ids.filter((id) => garder.has(id.toLowerCase()));
}

/**
 * Saisie qui remplace `ev` : même type, même culture, note et photos (relus dans la base),
 * détail repris ; ses emplacements encore actifs seulement (liste vide acceptée).
 */
async function remplacement(ctx: ContexteEcriture, ev: EvenementLu, sorte: RemplacementEvenement['sorte'], date: string): Promise<SaisieEvenement> {
  const original = (
    await ctx.porte.lire<{ emplacement_ids: string | null; note: string | null; photos: string | null; detail: string | null }>(SQL_ORIGINAL, [ev.id])
  )[0];
  if (original === undefined) throw new Error('saisie introuvable sur ce téléphone');
  const commun = {
    date: date as DateCalendaire,
    source: 'tap' as const,
    culture:
      ev.serieId !== null
        ? { sorte: 'serie' as const, serieId: ev.serieId as Id<'Serie'> }
        : ev.campagneId !== null
          ? { sorte: 'campagne' as const, campagneId: ev.campagneId as Id<'Campagne'> }
          : null,
    emplacementIds: (await emplacementsActifs(ctx, listeTextes(original.emplacement_ids))) as Id<'Emplacement'>[],
    note: original.note,
    photos: listeTextes(original.photos),
    remplaceEvenement: { sorte, evenementId: ev.id as Id<'Evenement'> },
  };
  const d = ev.detail;
  switch (d.type) {
    case 'realise':
      return { ...commun, type: 'realise', detail: { etape: d.etape, quantiteReelle: d.quantiteReelle } };
    case 'recolte':
      return { ...commun, type: 'recolte', detail: { quantite: d.quantite, unite: d.unite, categorie: d.categorie } };
    case 'intervention':
      // Le détail complet, relu tel qu'écrit (produit, quantité, outil…) ; validerSaisie le
      // vérifie avant toute écriture.
      return { ...commun, type: 'intervention', detail: JSON.parse(original.detail ?? 'null') as DetailIntervention };
  }
}

/**
 * Mouvement de stock d'un remplacement de récolte : `mouvementAttendu` sur la somme de la chaîne
 * (T10c). Rien si le mouvement attendu est nul (changement de date d'une récolte déjà en stock).
 */
async function mouvementDuRemplacement(
  ctx: ContexteEcriture,
  ev: EvenementLu,
  sorte: RemplacementEvenement['sorte'],
  remplacantId: string,
): Promise<{ readonly articles: OrdreEcriture[]; readonly mouvements: OrdreEcriture[] }> {
  const rien = { articles: [], mouvements: [] };
  if (ev.detail.type !== 'recolte') return rien;
  const stock = await ctx.porte.lire<{ article: string; somme: number | null }>(SQL_STOCK_CHAINE, [ev.id]);
  const chaine = stock.find((s) => (s.somme ?? 0) !== 0) ?? stock[0];
  const attendu = mouvementAttendu({ remplaceSorte: sorte, quantite: ev.detail.quantite }, chaine?.somme ?? 0);
  // Récolte sans aucune entrée en stock (saisie d'avant T13) : sa correction ou son annulation
  // ne touche pas au stock non plus.
  if (chaine === undefined || attendu === null || attendu === 0) return rien;
  return { articles: [], mouvements: [ordreMouvement(ctx, chaine.article, attendu, remplacantId)] };
}

/**
 * T13l : la saisie visée n'est plus en vigueur (sa chaîne est annulée, ici ou ailleurs ; ou, pour
 * changer la date, une autre saisie de la chaîne est en vigueur) : rien n'est écrit. Sinon une
 * chaîne annulée revivrait, et le stock d'une récolte avec elle.
 */
export class SaisiePlusEnVigueur extends Error {}

/**
 * Ligne en vigueur de la chaîne de `id` (`chaineDe`, la règle de la journée) ; lève
 * SaisiePlusEnVigueur si la chaîne est annulée.
 */
async function enVigueurDeLaChaine(lire: Lire, fermeId: string, id: string): Promise<string | null> {
  const c = await chaineDe(lire, fermeId, id);
  if (c.annulee) throw new SaisiePlusEnVigueur('cette saisie n’est plus en vigueur');
  return c.enVigueur;
}

/** Vérification dans la transaction : `ev` est toujours la ligne en vigueur de sa chaîne (T13l). */
function encoreEnVigueur(ctx: ContexteEcriture, ev: EvenementLu): VerificationEcriture {
  return async (lire) => {
    if ((await enVigueurDeLaChaine(lire, ctx.fermeId, ev.id)) !== ev.id) throw new SaisiePlusEnVigueur('cette saisie a déjà été corrigée');
  };
}

/**
 * La ligne `id` du journal lue comme l'écran la lit (`evenementLu` de ./calculs.ts) ; null si
 * absente ou écartée par l'écran (detail illisible, étape ou catégorie inconnue, libellé vide).
 */
async function evenementDuJournal(ctx: ContexteEcriture, id: string): Promise<EvenementLu | null> {
  const l = (
    await ctx.porte.lire<LigneJournal>(
      `SELECT id, type, date, horodatage, serie_id, campagne_id, remplace_sorte, remplace_evenement_id, ${COLONNES_DETAIL}
       FROM evenement WHERE id = ? AND +ferme_id = ? AND json_valid(detail)`,
      [id, ctx.fermeId],
    )
  )[0];
  return l === undefined ? null : evenementLu(l);
}

/**
 * Annule la chaîne de `ev` : événement d'annulation de sa ligne en vigueur (T13l : `ev` a pu être
 * corrigée depuis, le bandeau la garde) et, pour une récolte, le mouvement inverse. Chaîne déjà
 * annulée (ici ou ailleurs) : SaisiePlusEnVigueur, rien d'écrit (vérifié aussi dans la transaction).
 */
export async function annulerSaisie(ctx: ContexteEcriture, ev: EvenementLu): Promise<Id<'Evenement'>> {
  const tete = await enVigueurDeLaChaine((sql, p) => ctx.porte.lire(sql, p), ctx.fermeId, ev.id);
  const vise = tete === ev.id ? ev : tete === null ? null : await evenementDuJournal(ctx, tete);
  if (vise === null) throw new SaisiePlusEnVigueur('cette saisie n’est plus en vigueur sur ce téléphone');
  const saisie = await remplacement(ctx, vise, 'annulation', vise.date);
  const e = evenement(ctx.porte, saisie);
  const stock = await mouvementDuRemplacement(ctx, vise, 'annulation', e.id);
  await ecrireSaisie(ctx, saisie.culture, true, [...stock.articles, e.ordre, ...stock.mouvements], encoreEnVigueur(ctx, vise));
  return e.id;
}

/**
 * Change la date de `ev`, qui doit être la ligne en vigueur de sa chaîne (vérifié dans la
 * transaction, sinon SaisiePlusEnVigueur) : une correction, même détail, nouvelle date.
 */
export async function changerDate(ctx: ContexteEcriture, ev: EvenementLu, date: string): Promise<Id<'Evenement'>> {
  const saisie = await remplacement(ctx, ev, 'correction', date);
  const e = evenement(ctx.porte, saisie);
  const stock = await mouvementDuRemplacement(ctx, ev, 'correction', e.id);
  await ecrireSaisie(ctx, saisie.culture, true, [...stock.articles, e.ordre, ...stock.mouvements], encoreEnVigueur(ctx, ev));
  return e.id;
}
