/**
 * Contrat de T10i — les refus de synchro s'affichent sur le téléphone
 * (docs/backlog/T10i-refus-affiches.md). Constantes, jeu de refus et écriture seuls : utilisé par
 * les tests d'écran (../refus.test.tsx), de la coquille (src/App.refus.test.tsx), l'amorçage
 * (src/donnees/amorcer.ts, `?jeu=refus`) et l'e2e (e2e/refus.e2e.ts). Aucun import de Node : la
 * page d'amorçage le charge dans le navigateur.
 *
 * ── Données disponibles (lues, pas inventées) ───────────────────────────────────────────────
 *
 * La table locale `refus_synchro` (packages/sync/src/schema.ts) ne porte que : utilisateur_id,
 * ferme_id, nom_table, ligne_id, operation, motif (CODE stable, ex. 'recolte_annulee'), message
 * (TEXTE en français, écrit par le serveur : MESSAGES d'apps/api/src/sync, suivi de
 * « : <précision>. » quand il y en a une) et cree_le (instant ISO du refus, horloge du serveur).
 * Les données de la saisie refusée (`donnees`, jsonb côté serveur) ne descendent JAMAIS
 * (powersync/sync-config.yaml) : ni le type d'événement (récolte, note…), ni la culture, ni la
 * date de la saisie ne sont lisibles sur le téléphone. La porte les expose par
 * `porte.surveillerRefus` (RefusSynchro : id, nomTable, ligneId, operation, motif, message,
 * creeLe), filtrés sur l'utilisateur de la porte, du plus récent au plus ancien.
 *
 * ── Écran Ferme (ecrans/ferme/EcranFerme.tsx) ────────────────────────────────────────────────
 *
 *   - Une région (role="region" ou <section aria-label>) dont le nom contient « refus »
 *     (ex. « Saisies refusées ») ; dedans, un élément data-testid="refus", data-refus=<id du
 *     refus>, par refus de l'utilisateur, du plus récent au plus ancien. Aucun refus : aucun
 *     élément data-testid="refus" (la région peut être absente).
 *   - Chaque refus d'une saisie (nom_table ≠ 'lot') montre :
 *       · ce qui était saisi : le TYPE de saisie en français, tiré de nom_table (evenement →
 *         « saisie »/« événement »/« journal », serie → « série », mouvement_stock → « stock »…),
 *         jamais le nom brut de la table (evenement, mouvement_stock, serie) ni l'id de la ligne ;
 *       · la date du refus (cree_le), jour et mois en français (ex. « 14 sept. », « 14 septembre ») ;
 *       · le motif EN FRANÇAIS : le `message` reçu, tel quel ; jamais le code brut
 *         (ajout_seul, recolte_annulee…), même pour un code que l'appli ne connaît pas ;
 *       · quoi faire : un élément data-testid="refus-action", une phrase (10 caractères au
 *         moins), autre chose que le message ; aussi pour un code inconnu (phrase générale).
 *   - La ligne récapitulative d'un lot trop gros (nom_table 'lot', T10f) : une phrase
 *     compréhensible sur l'ENVOI (« Un envoi était trop gros… ») et quoi faire
 *     (data-testid="refus-action") ; ni « lot », ni « lot_trop_gros », ni « Saisie non
 *     enregistrée » (ce n'est pas une saisie), ni le jargon de la précision du serveur
 *     (« écritures », « tables permises »).
 *   - Un refus qui arrive pendant que l'écran est ouvert s'y ajoute (porte.surveillerRefus).
 *   - Jamais un refus d'un autre utilisateur présent dans la base locale.
 *   - Marque de performance MARQUE_REFUS_AFFICHES_ATTENDUE (exportée par EcranFerme.tsx sous le
 *     nom MARQUE_REFUS_AFFICHES), UNE fois par ouverture de l'écran, quand la liste des refus est
 *     lue et dessinée (même vide). L'e2e mesure tap sur l'onglet « Ferme » → marque.
 *
 * ── Coquille (App.tsx, barre du bas) ─────────────────────────────────────────────────────────
 *
 *   - Un refus de l'utilisateur pas encore vu : une pastille data-testid="pastille-refus" DANS
 *     le bouton de l'onglet « Ferme », et le bouton le dit (texte ou aria-label contenant
 *     « refus »). Aucun refus non vu : ni pastille, ni « refus » dans le bouton.
 *   - Ouvrir l'onglet Ferme marque les refus affichés comme vus : la pastille disparaît, et ne
 *     revient ni en changeant d'onglet ni en relançant l'appli (état « vu » gardé sur le
 *     téléphone, localStorage).
 *   - Un nouveau refus la fait revenir, même si son cree_le (horloge du SERVEUR) est antérieur à
 *     l'instant où le maraîcher a ouvert l'onglet (horloge du téléphone) : « vu » se compare aux
 *     refus vus, pas à l'heure du téléphone.
 *   - Un refus qui arrive pendant que l'onglet Ferme est ouvert est vu : pas de pastille après.
 *   - Les refus d'un autre utilisateur ne l'allument jamais.
 *   - JavaScript de démarrage : rien de @planif/sync (la porte vient de l'état des données).
 *
 * ── Amorçage (e2e) ───────────────────────────────────────────────────────────────────────────
 *
 * /diagnostic/amorcer.html?jeu=refus&date=AAAA-MM-JJ : la ferme du jour
 * (../../aujourdhui/test/ferme-du-jour.ts) et les refus de `refusDuJeu(maintenant)` (maintenant :
 * l'heure du navigateur), dans la base de l'utilisateur de test ; `lignes` annoncées :
 * fermeDuJour(date).total + REFUS_DU_JEU_TOTAL. File d'envoi vidée, comme les autres jeux.
 */
import type { BaseLocale } from '@planif/sync';
import { UTILISATEUR, FERME } from '../../aujourdhui/test/ferme-du-jour.ts';

export const MARQUE_REFUS_AFFICHES_ATTENDUE = 'planif:refus-affiches';

/**
 * Messages du serveur, recopiés d'apps/api/src/sync (MESSAGES, upload.ts aujourd'hui) : l'appli
 * web n'importe pas l'API. ../refus.test.tsx vérifie qu'ils y sont toujours, mot pour mot.
 *
 * T10j (messages sans jargon) : lot_trop_gros ne cite plus de seuil technique (« plus de 500
 * saisies ou de 6 Mio ») ; texte proposé par le testeur de T10j, que le serveur reprend mot pour mot.
 */
export const MESSAGES_SERVEUR = {
  ferme_interdite: "Saisie non enregistrée : elle vise une ferme dont vous n'êtes pas (ou plus) membre.",
  auteur_invalide: "Saisie non enregistrée : elle porte le nom d'une autre personne que vous.",
  ajout_seul: 'Un événement enregistré ne se modifie pas et ne se supprime pas : saisissez plutôt une correction ou une annulation.',
  table_interdite: 'Modification refusée : cette donnée ne se modifie pas depuis le téléphone.',
  ecriture_invalide: 'Saisie non enregistrée, données invalides',
  lot_trop_gros: 'Saisie non enregistrée : envoi trop volumineux. Ressaisissez-la.',
  recolte_annulee: 'Cette récolte a été annulée : elle ne se corrige plus. Pour la rétablir, saisissez une nouvelle récolte.',
} as const;

export type CodeMotif = keyof typeof MESSAGES_SERVEUR;

/** Ligne de refus_synchro telle que la synchro la range (colonnes du schéma local). */
export interface LigneRefusLocale {
  readonly id: string;
  readonly utilisateur_id: string;
  readonly ferme_id: string | null;
  readonly nom_table: string;
  readonly ligne_id: string;
  readonly operation: 'PUT' | 'PATCH' | 'DELETE';
  readonly motif: string;
  readonly message: string;
  readonly cree_le: string;
}

const COLONNES = ['id', 'utilisateur_id', 'ferme_id', 'nom_table', 'ligne_id', 'operation', 'motif', 'message', 'cree_le'] as const;

/** Ordre SQL d'insertion d'un refus et ses paramètres (base mémoire : `base.recevoir(sql, params)`). */
export const SQL_INSERER_REFUS = `INSERT INTO refus_synchro (${COLONNES.join(', ')}) VALUES (${COLONNES.map(() => '?').join(', ')})`;
export const parametresRefus = (l: LigneRefusLocale): (string | null)[] => COLONNES.map((c) => l[c]);

/**
 * T10k (docs/backlog/T10k-refus-saisie.md) : résumé de la saisie refusée, calculé par le serveur
 * et synchronisé (colonnes nullables saisie_* de refus_synchro ; contrat complet en tête
 * d'apps/api/src/sync/resume-refus.integration.test.ts). La porte l'expose en
 * `RefusSynchro.saisie` ({ type, culture, date, quantite, unite }), absent quand tout est nul.
 *
 * Écran : la carte d'un refus qui a un résumé montre ce qui avait été saisi — le type
 * d'événement EN FRANÇAIS (« Récolte », jamais le code 'recolte'), la culture telle quelle, le
 * JOUR de la saisie (jour et mois en français, distinct de la date du refus, qui reste affichée)
 * et, pour une récolte, la quantité au format français avec son unité lisible (« 12,5 kg »,
 * « 30 pièces », jamais le code 'piece'). Un champ absent ne s'affiche pas (ni « null », ni
 * « undefined », ni « NaN ») ; un refus sans résumé s'affiche comme en T10i.
 */
export interface ResumeSaisieLocal {
  readonly saisie_type: string | null;
  readonly saisie_culture: string | null;
  readonly saisie_date: string | null;
  readonly saisie_quantite: number | null;
  readonly saisie_unite: string | null;
}

const COLONNES_RESUME = ['saisie_type', 'saisie_culture', 'saisie_date', 'saisie_quantite', 'saisie_unite'] as const;

/** Insertion d'un refus avec son résumé (T10k). */
export const SQL_INSERER_REFUS_RESUME = `INSERT INTO refus_synchro (${[...COLONNES, ...COLONNES_RESUME].join(', ')}) VALUES (${[
  ...COLONNES,
  ...COLONNES_RESUME,
]
  .map(() => '?')
  .join(', ')})`;
export const parametresRefusResume = (l: LigneRefusLocale & ResumeSaisieLocal): (string | number | null)[] => [
  ...parametresRefus(l),
  ...COLONNES_RESUME.map((c) => l[c]),
];

/**
 * T10l (docs/backlog/T10l-refus-archives.md) : archiver un refus vu. Colonne `archive_le` de
 * refus_synchro (instant ISO, nulle tant que le refus n'est pas archivé), synchronisée : un refus
 * archivé sur un téléphone l'est sur tous ceux de l'utilisateur. La porte : `archiverRefus(ids)`
 * (contrat : packages/sync/src/porte-archiver.test.ts) ; `surveillerRefus` ne rend plus les archivés.
 *
 * Écran Ferme, carte « Saisies refusées » :
 *   - chaque refus affiché (data-testid="refus") contient un bouton data-testid="refus-archiver",
 *     de texte « Archiver » (56 px de haut au moins : au champ, avec des gants) ; un tap archive CE
 *     refus (porte.archiverRefus([id])) : il disparaît de la liste, le titre se recompte ;
 *   - un bouton data-testid="refus-tout-archiver", de texte contenant « Tout archiver » (56 px au
 *     moins), archive les refus AFFICHÉS (pas ceux encore cachés derrière « voir plus ») ;
 *   - pas de confirmation exigée : archiver ne supprime rien, la ligne reste dans la base ;
 *   - un refus archivé (archive_le non nul, arrivé par la synchro) ne s'affiche pas ; plus aucun
 *     refus non archivé : la carte disparaît (aucun data-testid="refus"), le reste de l'écran reste ;
 *   - le refus d'un archivage refusé par le serveur (nom_table 'refus_synchro') s'affiche comme les
 *     autres, sans jamais montrer le nom brut de la table.
 * Coquille : la pastille ne compte jamais un refus archivé.
 *
 * Relecture T10l :
 *   - « Tout archiver » n'apparaît qu'à partir de 2 refus affichés, avec leur nombre :
 *     « Tout archiver (N) » ; il est placé APRÈS la liste des cartes (ordre du DOM) ;
 *   - chaque bouton « Archiver » a un nom accessible (aria-label, sinon son texte) DISTINCT, qui
 *     commence par « Archiver » et contient le titre de sa carte (ex. « Archiver : Récolte ·
 *     ajout, 14 sept. à 14:00 ») ; le texte visible reste « Archiver » ;
 *   - le refus d'un archivage refusé (nom_table 'refus_synchro') a sa propre action : une phrase
 *     qui dit que ce refus n'a pas pu être archivé (« Ce refus n’a pas pu être archivé… »), jamais
 *     « responsable de la ferme » (personne d'autre n'y peut rien).
 */
export const SQL_INSERER_REFUS_ARCHIVE = `INSERT INTO refus_synchro (${[...COLONNES, 'archive_le'].join(', ')}) VALUES (${[...COLONNES, 'archive_le']
  .map(() => '?')
  .join(', ')})`;
export const parametresRefusArchive = (l: LigneRefusLocale, archiveLe: string | null): (string | null)[] => [...parametresRefus(l), archiveLe];
/** Archivage arrivé par la synchro (autre téléphone de l'utilisateur). */
export const SQL_ARCHIVER_PAR_SYNCHRO = 'UPDATE refus_synchro SET archive_le = ? WHERE id = ?';

/** Message tel que le serveur l'écrit (upload.ts : précision ajoutée après « : »). */
export function messageServeur(motif: CodeMotif, precision?: string): string {
  return precision === undefined ? MESSAGES_SERVEUR[motif] : `${MESSAGES_SERVEUR[motif]} : ${precision}.`;
}

/** Utilisateur de test (celui de la ferme du jour) et un autre, dont la base garde un refus. */
export const UTILISATEUR_REFUS = UTILISATEUR;
export const FERME_REFUS = FERME;
export const AUTRE_UTILISATEUR = '0192f0c1-1010-7000-8000-00000000a0a0';

const idRefus = (n: number) => `0192f0c1-1010-7000-9000-${n.toString(16).padStart(12, '0')}`;
const idLigne = (n: number) => `0192f0c1-1010-7000-a000-${n.toString(16).padStart(12, '0')}`;

/** Refus de l'utilisateur dans le jeu de l'e2e. */
export const REFUS_DU_JEU = 100;
/** Lignes de refus_synchro écrites par le jeu : les 100 de l'utilisateur, 1 d'un autre. */
export const REFUS_DU_JEU_TOTAL = REFUS_DU_JEU + 1;
/** Le plus récent de l'utilisateur (premier affiché), et celui de l'autre utilisateur (jamais affiché). */
export const REFUS_PLUS_RECENT = idRefus(1);
export const REFUS_AUTRE_UTILISATEUR = idRefus(0xfff);

const TABLES: readonly string[] = ['evenement', 'evenement', 'mouvement_stock', 'serie', 'evenement'];
const MOTIFS: readonly CodeMotif[] = ['ajout_seul', 'recolte_annulee', 'ecriture_invalide', 'table_interdite', 'auteur_invalide', 'ferme_interdite'];

/**
 * Jeu de l'e2e : REFUS_DU_JEU refus de l'utilisateur, une minute d'écart (le n-ième a n minutes),
 * motifs et tables variés, un récapitulatif de lot ; plus le refus d'un AUTRE utilisateur, le plus
 * récent de tous (affiché en tête s'il fuyait).
 */
export function refusDuJeu(maintenant: Date): LigneRefusLocale[] {
  const il = (minutes: number) => new Date(maintenant.getTime() - minutes * 60_000).toISOString();
  const lignes: LigneRefusLocale[] = [];
  for (let n = 1; n <= REFUS_DU_JEU; n++) {
    if (n === 7) {
      lignes.push({
        id: idRefus(n),
        utilisateur_id: UTILISATEUR_REFUS,
        ferme_id: null,
        nom_table: 'lot',
        ligne_id: idLigne(n),
        operation: 'PUT',
        motif: 'lot_trop_gros',
        // Précision d'un serveur d'avant T10j, gardée exprès : les refus déjà descendus restent dans
        // la base du téléphone, et l'écran ne doit pas en montrer le jargon.
        message: messageServeur('lot_trop_gros', '12 autres écritures illisibles, en double ou hors des tables permises'),
        cree_le: il(n),
      });
      continue;
    }
    const motif = MOTIFS[n % MOTIFS.length] ?? 'ajout_seul';
    lignes.push({
      id: idRefus(n),
      utilisateur_id: UTILISATEUR_REFUS,
      ferme_id: FERME_REFUS,
      nom_table: TABLES[n % TABLES.length] ?? 'evenement',
      ligne_id: idLigne(n),
      operation: motif === 'ajout_seul' || motif === 'table_interdite' ? 'PATCH' : 'PUT',
      motif,
      message: motif === 'ecriture_invalide' ? messageServeur(motif, 'quantité négative') : messageServeur(motif),
      cree_le: il(n),
    });
  }
  lignes.push({
    id: REFUS_AUTRE_UTILISATEUR,
    utilisateur_id: AUTRE_UTILISATEUR,
    ferme_id: FERME_REFUS,
    nom_table: 'evenement',
    ligne_id: idLigne(0xfff),
    operation: 'PATCH',
    motif: 'ajout_seul',
    message: 'Refus d’un autre compte (ne doit jamais s’afficher).',
    cree_le: il(0),
  });
  return lignes;
}

/** Écrit des refus dans `base` (PowerSync dans la page d'amorçage), en une transaction. */
export async function ecrireRefus(base: Pick<BaseLocale, 'writeTransaction'>, lignes: readonly LigneRefusLocale[]): Promise<void> {
  await base.writeTransaction(async (tx) => {
    for (const l of lignes) await tx.execute(SQL_INSERER_REFUS, parametresRefus(l));
  });
}
