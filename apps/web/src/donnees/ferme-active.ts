/**
 * Ferme active de l'appli (T11) : une fois la base locale ouverte, la ferme dont les écrans
 * montrent les données. Contrat : en-tête de ferme-active.test.ts.
 *
 * Chargé à la demande avec l'ouverture de la base (il importe @planif/sync), jamais au démarrage.
 * Le choix mémorisé (./ferme-memorisee.ts) est rangé par utilisateur : deux comptes sur un téléphone
 * ne se mélangent pas.
 *
 * T13g : la ferme active est mémorisée à chaque fois qu'elle est connue (aucune ferme : mémoire
 * vidée). Au lancement suivant, avant l'ouverture de la base, l'écran Aujourd'hui ne montre
 * l'instantané de la journée que s'il est de cette ferme : jamais celui d'une ferme que la base
 * n'a plus désignée comme active (adhésion retirée, autre ferme choisie).
 */
import type { Id } from '@planif/core';
import { creerPorte, type BaseLocale, type PorteDonnees } from '@planif/sync';
import { lireFermeMemorisee, memoriserFerme } from './ferme-memorisee.ts';

export { lireFermeMemorisee, memoriserFerme };

export interface FermeDisponible {
  readonly id: string;
  readonly nom: string;
}

export type FermeActive =
  | { readonly etat: 'sans-ferme' }
  | { readonly etat: 'prete'; readonly fermeId: string; readonly fermes: readonly FermeDisponible[]; readonly porte: PorteDonnees };

/**
 * Fermes dont l'utilisateur est membre actif (règle de powersync/sync-config.yaml) : adhésion
 * acceptée et non supprimée, ferme non supprimée. La plus ancienne adhésion d'abord, puis l'id.
 */
const SQL_FERMES = `SELECT f.id AS id, f.nom AS nom, MIN(m.cree_le) AS adhesion
  FROM membre m JOIN ferme f ON f.id = m.ferme_id
  WHERE m.utilisateur_id = ? AND m.etat = 'accepte' AND m.supprime_le IS NULL AND f.supprime_le IS NULL
  GROUP BY f.id, f.nom
  ORDER BY adhesion, f.id`;

interface LigneFerme {
  readonly id: string;
  readonly nom: string | null;
}

export async function lireFermes(base: Pick<BaseLocale, 'getAll'>, utilisateurId: string): Promise<FermeDisponible[]> {
  const lignes = await base.getAll<LigneFerme>(SQL_FERMES, [utilisateurId]);
  return lignes.map((l) => ({ id: l.id, nom: l.nom ?? '' }));
}

/** La ferme mémorisée si elle est encore parmi `fermes` ; sinon la première ; aucune → null. */
export function choisirFermeActive(fermes: readonly FermeDisponible[], memorisee: string | null): string | null {
  if (memorisee !== null && fermes.some((f) => f.id === memorisee)) return memorisee;
  return fermes[0]?.id ?? null;
}

/**
 * Suit la ferme active : `rappel` dès qu'elle est connue, puis à chaque changement des tables
 * `membre` et `ferme` (écriture locale ou synchro). Pas de second rappel pour la même ferme.
 * Lecture en échec : `surEchec` (l'appli le dit au lieu d'attendre sans fin) ; un changement
 * suivant relit, et une lecture réussie rappelle `rappel` même pour la ferme déjà signalée.
 * Rend le désabonnement.
 */
export function suivreFermeActive(
  base: BaseLocale,
  o: { readonly utilisateurId: string; readonly stockage: Pick<Storage, 'getItem' | 'setItem'> },
  rappel: (e: FermeActive) => void,
  surEchec?: (erreur: unknown) => void,
): () => void {
  let actif = true;
  let enCours = false;
  let changements = 0;
  /** Dernière ferme signalée : undefined = rien encore, '' = sans ferme. */
  let signalee: string | undefined;

  async function evaluer(): Promise<void> {
    const fermes = await lireFermes(base, o.utilisateurId);
    if (!actif) return;
    const fermeId = choisirFermeActive(fermes, lireFermeMemorisee(o.stockage, o.utilisateurId));
    const cle = fermeId ?? '';
    if (cle === signalee) return;
    signalee = cle;
    // '' : lu comme « aucune ferme » (lireFermeMemorisee).
    memoriserFerme(o.stockage, o.utilisateurId, cle);
    rappel(
      fermeId === null
        ? { etat: 'sans-ferme' }
        : {
            etat: 'prete',
            fermeId,
            fermes,
            porte: creerPorte(base, { utilisateurId: o.utilisateurId as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'> }),
          },
    );
  }

  // Une évaluation à la fois ; un changement arrivé pendant qu'elle tourne en relance une.
  async function relancer(): Promise<void> {
    changements++;
    if (enCours) return;
    enCours = true;
    try {
      for (;;) {
        const vus = changements;
        await evaluer();
        if (!actif || changements === vus) return;
      }
    } catch (erreur) {
      console.error('ferme active illisible', erreur);
      if (actif) {
        signalee = undefined;
        surEchec?.(erreur);
      }
    } finally {
      enCours = false;
    }
  }

  const arreter = base.onChange({ onChange: () => relancer() }, { tables: ['membre', 'ferme'] });
  void relancer();
  return () => {
    actif = false;
    arreter();
  };
}
