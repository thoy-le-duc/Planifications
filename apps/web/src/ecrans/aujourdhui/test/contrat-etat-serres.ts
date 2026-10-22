/**
 * Contrat de l'état des serres sur le téléphone (T58, docs/backlog/T58-etat-serres.md, règles 2
 * et 4) : changement d'état en UN tap, hors ligne, depuis l'écran Aujourd'hui et depuis la 3D ;
 * rappel du soir. Modèle de données : voir packages/core/src/abris/test/contrat.ts (événement
 * `etat_abri`, détail { zoneId, equipement, actif } ; liste d'équipements facultative
 * `zone.equipements_abri`).
 *
 * ── Panneau `../EtatSerres.tsx` (export `EtatSerres`), chargé à la demande ───────────────────
 *
 * Propriétés : ProprietesEtatSerres. Lit (en surveillant la base) les zones et les événements
 * `etat_abri` EN VIGUEUR de LA ferme (`ferme_id` = `fermeId`) ; n'écrit que par le tap.
 *   - dialogue `data-testid="etat-serres"` (role="dialog"), nommé « État des serres » ;
 *   - une section `data-testid="serre-etat"` (`data-zone` = id) par zone abritée non supprimée de
 *     la ferme qui a au moins un équipement déclaré (`equipementsDeZone` du cœur ; plein champ :
 *     jamais), titrée de son nom, triées par nom (ordre naturel français) ;
 *   - dans chaque section, un bouton par équipement déclaré, ordre canonique :
 *     `data-testid="equipement-abri"`, `data-zone`, `data-equipement`, `aria-pressed` « true » si
 *     l'équipement est actif (ouverts, allumé, posé), « false » sinon (fermé, éteint, retiré, ou
 *     état inconnu : `data-etat` vaut alors « inconnu », sinon « actif » / « inactif »), 44 px de
 *     côté au moins ; son texte dit l'état courant par `phraseEtat` du cœur (« ouvrants latéraux
 *     fermés ») et son nom accessible commence par le nom de la zone (« Serre 1 : … ») ;
 *   - UN tap sur un bouton = UN événement `etat_abri` dans le journal du téléphone, en UNE
 *     transaction, avec le contraire de l'état courant (état inconnu : actif vrai) : date = jour du
 *     téléphone, source 'tap', sans culture ni emplacement, accepté par `validerSaisie` ; pas
 *     d'écran de confirmation (saisie manuelle, comme l'irrigation) mais « Annuler » ;
 *   - une fois écrit : `data-testid="etat-abri-enregistre"` (role="status") « Serre 1 : ouvrants
 *     latéraux ouverts » avec « Annuler », qui écrit l'annulation (même type, même détail,
 *     `remplace_sorte` 'annulation' vers l'événement) en une transaction ; le bouton retrouve
 *     alors son état d'avant ; le bandeau disparaît ;
 *   - « Fermer » ferme le dialogue (`surFermer`). Aucun réseau (aucun appel à fetch).
 *
 * ── Écran Aujourd'hui ───────────────────────────────────────────────────────────────────────
 *
 * Un bouton « Serres » dans la barre d'actions ouvre le panneau (chargé au premier tap, hors du
 * morceau de l'écran). `EcranAujourdhui` reçoit une propriété de plus, `maintenant?: () => Date`
 * (défaut : l'horloge du téléphone). À partir de 18 h 00 dans le fuseau de la ferme
 * (`ferme.fuseau_horaire`), s'il y a des abris encore ouverts (`rappelDuSoir` du cœur), l'écran
 * montre `data-testid="rappel-serres"` (role="status") : « 2 serres encore ouvertes », avec un
 * bouton « Voir les serres » qui ouvre le panneau. Avant 18 h, ou sans abri ouvert : rien dans le
 * DOM. Le rappel suit la base (refermer une serre dans le panneau le met à jour, sans recharger).
 *
 * ── Fiche de la ferme de test ───────────────────────────────────────────────────────────────
 * Voir `ecrireSerres` : Serre 1 (serre, équipements par défaut), Serre 2 (serre, liste
 * ouvrants latéraux + portes), Tunnel 3 (tunnel, défaut), Plein champ, une serre supprimée, et la
 * serre d'une AUTRE ferme (même base locale : utilisateur membre de deux fermes).
 */
import { TABLES_LOCALES } from '@planif/sync';
import type { PorteDonnees } from '@planif/sync';
import type { ComponentType } from 'react';

/** Relatif aux tests qui l'importent (aujourdhui/*.test.tsx), pas à ce fichier. */
export const CHEMIN_ETAT_SERRES = './EtatSerres.tsx';

export interface ProprietesEtatSerres {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

export interface ModuleEtatSerres {
  readonly EtatSerres: ComponentType<ProprietesEtatSerres>;
}

export const TESTID_SERRES = {
  panneau: 'etat-serres',
  serre: 'serre-etat',
  equipement: 'equipement-abri',
  enregistre: 'etat-abri-enregistre',
  rappel: 'rappel-serres',
} as const;

const id = (n: number) => `0192f0c1-5858-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const SERRE_1 = id(0x20);
export const SERRE_2 = id(0x21);
export const TUNNEL_3 = id(0x22);
export const CHAMP = id(0x23);
export const SERRE_SUPPRIMEE = id(0x24);
export const SERRE_VOISINE = id(0x25);
export const AUTRE_FERME = id(0x2f);
const CREE = '2026-01-01T08:00:00.000Z';

interface BaseEcriture {
  recevoir(sql: string, parametres?: readonly unknown[]): void;
}

/**
 * Zones de la ferme des serres (après `ecrireFermeNeuve` ou `ecrireFermeDuJour`). Tant que le
 * schéma local n'a pas `zone.equipements_abri`, la liste de « Serre 2 » est ignorée (les tests qui
 * la demandent échouent alors sur leurs attentes, pas sur l'amorçage).
 */
export function ecrireSerres(base: BaseEcriture, fermeId: string): void {
  const aLaColonne = Object.hasOwn((TABLES_LOCALES as unknown as Record<string, Record<string, string>>).zone ?? {}, 'equipements_abri');
  const zone = (zid: string, ferme: string, nom: string, typeAbri: string, equipements: readonly string[] | null, supprimee = false) => {
    const colonnes = ['id', 'ferme_id', 'nom', 'zone_parente_id', 'type_abri', 'surface_m2', 'contour', 'cree_le', 'modifie_le', 'supprime_le'];
    const valeurs: unknown[] = [zid, ferme, nom, null, typeAbri, 300, null, CREE, CREE, supprimee ? CREE : null];
    if (aLaColonne) {
      colonnes.push('equipements_abri');
      valeurs.push(equipements === null ? null : JSON.stringify(equipements));
    }
    base.recevoir(`INSERT INTO zone (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, valeurs);
  };
  zone(SERRE_1, fermeId, 'Serre 1', 'serre', null);
  zone(SERRE_2, fermeId, 'Serre 2', 'serre', ['ouvrants_lateraux', 'portes']);
  zone(TUNNEL_3, fermeId, 'Tunnel 3', 'tunnel', null);
  zone(CHAMP, fermeId, 'Plein champ des serres', 'plein_champ', null);
  zone(SERRE_SUPPRIMEE, fermeId, 'Serre démontée', 'serre', null, true);
  base.recevoir(`INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan, unites, cree_le, modifie_le, supprime_le) VALUES (?, 'Ferme voisine', 'Europe/Paris', NULL, NULL, '{}', ?, ?, NULL)`, [AUTRE_FERME, CREE, CREE]);
  zone(SERRE_VOISINE, AUTRE_FERME, 'Serre du voisin', 'serre', null);
}

let compteur = 0;

/** Un changement d'état déjà dans le journal (ligne locale), à l'instant ISO donné. */
export function ecrireEtat(
  base: BaseEcriture,
  o: { fermeId: string; zoneId: string; equipement: string; actif: boolean; horodatage: string; auteurId: string; remplace?: { sorte: 'correction' | 'annulation'; evenementId: string } },
): string {
  compteur += 1;
  const eid = id(0x9000 + compteur);
  base.recevoir(
    `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id, emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail, cree_le, origine_id)
     VALUES (?, ?, 'etat_abri', ?, ?, ?, 'tap', NULL, NULL, '[]', NULL, '[]', ?, ?, ?, ?, NULL)`,
    [eid, o.fermeId, o.horodatage.slice(0, 10), o.horodatage, o.auteurId, o.remplace?.sorte ?? null, o.remplace?.evenementId ?? null, JSON.stringify({ zoneId: o.zoneId, equipement: o.equipement, actif: o.actif }), o.horodatage],
  );
  return eid;
}
