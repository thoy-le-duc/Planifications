/**
 * Contrat de T14e — import : suites de T14b (docs/backlog/T14e-import-series.md). Constantes
 * seules ; tests : ../suites.test.tsx (vrai écran, DOM simulé, base mémoire de ./harnais.ts).
 * Le reste du contrat de l'écran est dans ./contrat.ts (T14b), inchangé.
 *
 * ── Critère 1 : une annulation refusée par le serveur, montrée dans l'historique de l'import ──
 *
 * Comment le refus arrive au téléphone (rien de nouveau côté serveur) : « Annuler cet import »
 * écrit des suppressions douces (UPDATE … SET supprime_le) ; PowerSync les envoie en PATCH ; le
 * serveur (apps/api/src/sync/structure.ts, serie.ts) refuse la suppression d'une ligne qui sert
 * encore (planche occupée par une série posée depuis un autre téléphone…), tout le lot ensemble
 * (tout ou rien), et enregistre un refus par écriture du lot dans `refus_synchro`, qui redescend
 * par la synchro : nom_table, ligne_id (la ligne de l'import), operation 'PATCH', motif
 * 'ecriture_invalide', message en français (la fautive dit pourquoi ; les autres disent
 * « une autre partie de cette saisie est refusée »). Le serveur gardant les lignes, la synchro
 * les fait aussi revenir actives sur le téléphone. La porte les expose par `porte.surveillerRefus`
 * (refus de l'utilisateur, non archivés, en direct).
 *
 * Écran, étape 'depot', région « Imports récents » : sur l'élément data-testid="import-passe"
 * d'un import dont l'annulation a été refusée (un refus PATCH visant une ligne créée par un lot
 * que ce téléphone a annulé) :
 *   - un élément data-testid=ATTRIBUT_ANNULATION_REFUSEE, DANS cet élément, dont le texte :
 *       · dit le refus (contient « refus », sans casse) ;
 *       · dit pourquoi, en reprenant la raison donnée par le serveur pour la ligne fautive (ici
 *         « occupé par une culture »), pas celle des autres lignes du lot ;
 *       · nomme la ligne fautive comme le maraîcher la connaît (le code de la planche, « N1 ») ;
 *       · ne montre ni code de motif (ecriture_invalide), ni opération (PATCH), ni identifiant ;
 *   - l'import n'est plus présenté comme annulé : data-etat ≠ 'annule', et le bouton « Annuler
 *     cet import » est de nouveau là ; le toucher retire VRAIMENT les lignes revenues (de
 *     nouvelles suppressions douces sont écrites, même pour les lots déjà annulés une fois) ;
 *   - le refus s'affiche aussi quand il arrive pendant que l'écran est ouvert (surveillerRefus),
 *     et après avoir fermé et rouvert l'écran ;
 *   - rien sur un import jamais annulé (un refus PATCH sur une de ses lignes n'est pas un refus
 *     d'annulation), ni pour un refus qui vise une ligne qui n'est pas de l'import.
 *
 * ── Critère 2 : historique gardé en localStorage (décision du chef, écrite au journal) ─────────
 *
 * Navigateur plein (setItem lève QuotaExceededError) au moment de noter l'import : l'import est
 * écrit quand même (lignes en base, « N lignes importées ») et un role="alert" le dit en clair
 * (stockage plein, l'import est fait).
 *
 * ── Critère 3 : dates déduites montrées à l'aperçu ─────────────────────────────────────────────
 *
 * Étape 'apercu', des éléments data-testid=ATTRIBUT_DATE_DEDUITE (dans un encart de son choix,
 * absent quand il n'y en a aucun) :
 *   - data-deduite="actif-du" : un par date `actif_du` distincte des emplacements que l'import
 *     va créer ; texte = la date en français (jour, mois en lettres, année : « 1 janv. 2027 »,
 *     « 1er janvier 2027 »), jamais AAAA-MM-JJ, et le nombre d'emplacements créés avec cette date ;
 *   - data-deduite="saison", data-saison=<nom de la saison> : un par saison que l'import va
 *     créer (pas les saisons déjà dans la ferme) ; texte = son nom, sa date de début et sa date
 *     de fin, en français comme ci-dessus ;
 *   - la date montrée est celle qui sera écrite (vérifié en base après « Importer »).
 */

export const ATTRIBUT_ANNULATION_REFUSEE = 'annulation-refusee';
export const ATTRIBUT_DATE_DEDUITE = 'date-deduite';

/**
 * Messages enregistrés par le serveur, recopiés d'apps/api/src/sync (MESSAGES.ecriture_invalide
 * de messages.ts, suivi de « : <précision>. » ; précisions de structure.ts et upload.ts) :
 * l'appli web n'importe pas l'API.
 */
export const MESSAGE_PLANCHE_OCCUPEE =
  'Saisie non enregistrée, données invalides : cet emplacement est occupé par une culture prévue, en cours ou en place : libérez-le avant de le supprimer.';
export const MESSAGE_AUTRE_PARTIE_REFUSEE = 'Saisie non enregistrée, données invalides : une autre partie de cette saisie est refusée, rien n’a été enregistré.';
