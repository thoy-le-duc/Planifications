/**
 * T25 — remplissage de la base locale de la démo avec les jeux de test existants, datés par
 * rapport au jour du téléphone : la ferme du jour (avec ses travaux prévus), la ferme des
 * itinéraires, la ferme du plan (dates fixes, décalées d'autant de jours que le téléphone en a
 * depuis son jour de référence) et quelques
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
import { CAMPAGNE, fermeDuJour } from '../ecrans/aujourdhui/test/ferme-du-jour.ts';
import { FERME_REFUS, refusDuJeu, UTILISATEUR_REFUS } from '../ecrans/ferme/test/refus.ts';
import { fermeItineraires } from '../ecrans/itineraires/test/ferme-itineraires.ts';
import { fermeSerie } from '../ecrans/serie/test/ferme-serie.ts';
import { nomBaseLocale, supprimerBaseIndexedDb } from '../donnees/effacer.ts';
import { decalerJours, fusionnerJeux, type Jeu, type Ligne } from './fusion.ts';
import { placerLaDemo } from './placement-demo.ts';
import { FERME_DEMO, NOM_FERME_DEMO, NOM_UTILISATEUR_DEMO, UTILISATEUR_DEMO } from './identite.ts';

/** Jour de référence de la ferme du plan (« aujourd'hui » de ses tests), dont les dates sont fixes. */
const JOUR_DU_JEU_PLAN = '2026-09-30';

/** Jours de `de` à `a` ('AAAA-MM-JJ'), calculés en UTC. */
function joursEntre(de: string, a: string): number {
  const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(a) - utc(de)) / 86_400_000);
}

/** La veille de `jour` ('AAAA-MM-JJ'), calculée en UTC. */
function veilleDe(jour: string): string {
  const d = new Date(Date.UTC(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)) - 1, Number(jour.slice(8, 10)) - 1));
  return d.toISOString().slice(0, 10);
}

/** Refus de synchro montrés dans la démo (écran Ferme) : quelques-uns, pas la centaine de l'e2e. */
const REFUS_DE_LA_DEMO = 3;

function estTable(nom: string): nom is NomTableLocale {
  return Object.hasOwn(TABLES_LOCALES, nom);
}

/**
 * La ferme du jour de la démo. T37 : le début de récolte des fraises n'y est en retard que de 1 jour
 * (10 dans le jeu de test) : sa tâche passe après les travaux du jour des planches légères, de sorte
 * que le premier « Suivant » de la 3D ne mène pas devant la gouttière de fraises (plants par centaines),
 * dont le rendu de près dépasse les garde-fous de fluidité du téléphone (appels de dessin, triangles).
 */
function jeuDuJour(jour: string): Jeu {
  const duJour = fermeDuJour(jour, { travaux: true });
  const debut = veilleDe(jour);
  return { ...duJour, lignes: { ...duJour.lignes, campagne: (duJour.lignes.campagne ?? []).map((l) => (l.id === CAMPAGNE.fraise ? { ...l, debut_recolte_prevu: debut } : l)) } };
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
    jeuDuJour(jour),
    fermeItineraires(jour),
    { ...plan, lignes: decalerJours(plan.lignes, joursEntre(JOUR_DU_JEU_PLAN, jour)) },
    { utilisateurId: UTILISATEUR_REFUS, fermeId: FERME_REFUS, lignes: { refus_synchro: refus } },
  ];
  // T28c : la ferme est placée (origine du plan, serres, contour, planches) pour montrer le jumeau 3D.
  return placerLaDemo(fusionnerJeux(jeux, { utilisateurId: UTILISATEUR_DEMO, fermeId: FERME_DEMO, nomUtilisateur: NOM_UTILISATEUR_DEMO, nomFerme: NOM_FERME_DEMO }));
}

/**
 * Efface la base locale de la démo (si elle existe) et la remplit à nouveau. À appeler base
 * fermée : l'appli ne l'a pas encore ouverte.
 */
export async function remplirDemo(jour: string, maintenant: Date): Promise<void> {
  const tables = lignesDeLaDemo(jour, maintenant);
  await supprimerBaseIndexedDb(nomBaseLocale(UTILISATEUR_DEMO));
  // PowerSync à la demande : lignesDeLaDemo reste utilisable sans navigateur (tests sous Node).
  const { ouvrirBaseLocale } = await import('../donnees/ouvrir.ts');
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
