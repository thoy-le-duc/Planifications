/**
 * T25 — remplissage de la base locale de la démo avec les jeux de test existants, datés par
 * rapport au jour du téléphone : la ferme du jour (avec ses travaux prévus), la ferme des
 * itinéraires, la ferme du plan (dates fixes, rapprochées de l'année du téléphone) et quelques
 * refus de synchro. Tous rattachés à l'utilisateur et à la ferme de la démo (./fusion.ts).
 *
 * Chargé à la demande par ./index.tsx, au premier lancement et après « Réinitialiser la démo »
 * seulement : les jeux n'alourdissent pas les lancements suivants. Comme la page d'amorçage des
 * tests (src/donnees/amorcer.ts), la synchro n'est jamais branchée et la file d'envoi est vidée
 * après le remplissage : les lignes de la démo ne comptent pas comme saisies en attente.
 *
 * Les jeux viennent des dossiers test/ : permis pour ce build seulement (`vite build --mode
 * demo`) ; le build de production n'en contient rien (scripts/demo.test.ts).
 */
import { TABLES_LOCALES, type NomTableLocale } from '@planif/sync';
import { fermeDuJour } from '../ecrans/aujourdhui/test/ferme-du-jour.ts';
import { FERME_REFUS, refusDuJeu, UTILISATEUR_REFUS } from '../ecrans/ferme/test/refus.ts';
import { fermeItineraires } from '../ecrans/itineraires/test/ferme-itineraires.ts';
import { fermeSerie } from '../ecrans/serie/test/ferme-serie.ts';
import { nomBaseLocale, supprimerBaseIndexedDb } from '../donnees/effacer.ts';
import { ouvrirBaseLocale } from '../donnees/ouvrir.ts';
import { decalerAnnees, fusionnerJeux, type Jeu, type Ligne } from './fusion.ts';
import { FERME_DEMO, NOM_FERME_DEMO, NOM_UTILISATEUR_DEMO, UTILISATEUR_DEMO } from './identite.ts';

/** Année du jour des tests de la ferme du plan (2026-09-30), dont les dates sont fixes. */
const ANNEE_DU_JEU_PLAN = 2026;

/** Refus de synchro montrés dans la démo (écran Ferme) : quelques-uns, pas la centaine de l'e2e. */
const REFUS_DE_LA_DEMO = 3;

function estTable(nom: string): nom is NomTableLocale {
  return Object.hasOwn(TABLES_LOCALES, nom);
}

/** Les lignes de la démo, par table, pour le jour `jour` ('AAAA-MM-JJ') et l'instant `maintenant`. */
export function lignesDeLaDemo(jour: string, maintenant: Date): Map<string, Ligne[]> {
  const plan = fermeSerie();
  const refus: Ligne[] = refusDuJeu(maintenant)
    .filter((r) => r.utilisateur_id === UTILISATEUR_REFUS && r.nom_table !== 'lot')
    .slice(0, REFUS_DE_LA_DEMO)
    .map((r) => ({
      id: r.id,
      utilisateur_id: r.utilisateur_id,
      ferme_id: r.ferme_id,
      nom_table: r.nom_table,
      ligne_id: r.ligne_id,
      operation: r.operation,
      motif: r.motif,
      message: r.message,
      cree_le: r.cree_le,
    }));
  const jeux: Jeu[] = [
    fermeDuJour(jour, { travaux: true }),
    fermeItineraires(jour),
    { ...plan, lignes: decalerAnnees(plan.lignes, Number(jour.slice(0, 4)) - ANNEE_DU_JEU_PLAN) },
    { utilisateurId: UTILISATEUR_REFUS, fermeId: FERME_REFUS, lignes: { refus_synchro: refus } },
  ];
  return fusionnerJeux(jeux, { utilisateurId: UTILISATEUR_DEMO, fermeId: FERME_DEMO, nomUtilisateur: NOM_UTILISATEUR_DEMO, nomFerme: NOM_FERME_DEMO });
}

/**
 * Efface la base locale de la démo (si elle existe) et la remplit à nouveau. À appeler base
 * fermée : l'appli ne l'a pas encore ouverte.
 */
export async function remplirDemo(jour: string, maintenant: Date): Promise<void> {
  const tables = lignesDeLaDemo(jour, maintenant);
  await supprimerBaseIndexedDb(nomBaseLocale(UTILISATEUR_DEMO));
  const { base, fermer } = ouvrirBaseLocale(UTILISATEUR_DEMO);
  try {
    await base.writeTransaction(async (tx) => {
      for (const [table, lignes] of tables) {
        if (!estTable(table)) throw new Error(`démo : table inconnue « ${table} »`);
        const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
        const sql = `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`;
        for (const l of lignes) await tx.execute(sql, colonnes.map((c) => l[c] ?? null));
      }
      // Les lignes de la démo ne sont pas des saisies : rien à envoyer, rien « en attente ».
      await tx.execute('DELETE FROM ps_crud');
    });
  } finally {
    await fermer();
  }
}
