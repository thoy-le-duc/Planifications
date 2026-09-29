/**
 * La porte d'accès aux données (T10) : seule façon pour l'appli web de lire et d'écrire la base
 * locale. Aucun réseau ici : une écriture change l'écran tout de suite, et part dans la file
 * d'envoi de PowerSync (voir envoi.ts) au retour du réseau.
 */
import { creerGenerateurId, type Id } from '@planif/core';
import type { BaseLocale, OptionsPorte, PorteDonnees, RefusSynchro, RequeteSurveillee, SaisieEvenement } from './types.ts';

const COLONNES_EVENEMENT = [
  'id',
  'ferme_id',
  'type',
  'date',
  'horodatage',
  'auteur_id',
  'source',
  'serie_id',
  'campagne_id',
  'emplacement_ids',
  'note',
  'photos',
  'remplace_sorte',
  'remplace_evenement_id',
  'detail',
] as const;

const SQL_SAISIE = `INSERT INTO evenement (${COLONNES_EVENEMENT.join(', ')}) VALUES (${COLONNES_EVENEMENT.map(() => '?').join(', ')})`;

const SQL_REFUS = `SELECT id, nom_table, ligne_id, operation, motif, message, cree_le
  FROM refus_synchro WHERE utilisateur_id = ? ORDER BY cree_le DESC, id DESC`;

interface LigneRefus {
  readonly id: string;
  readonly nom_table: string;
  readonly ligne_id: string;
  readonly operation: RefusSynchro['operation'];
  readonly motif: string;
  readonly message: string;
  readonly cree_le: string;
}

function refusDepuisLigne(l: LigneRefus): RefusSynchro {
  return {
    id: l.id,
    nomTable: l.nom_table,
    ligneId: l.ligne_id,
    operation: l.operation,
    motif: l.motif,
    message: l.message,
    creeLe: l.cree_le,
  };
}

export function creerPorte(base: BaseLocale, options: OptionsPorte): PorteDonnees {
  const maintenant = options.maintenant ?? (() => new Date());
  const nouvelId =
    options.nouvelId ??
    creerGenerateurId({
      horloge: () => maintenant().getTime(),
      aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)),
    });

  function surveiller<T>(requete: RequeteSurveillee<T>, rappel: (lignes: T[]) => void): () => void {
    let actif = true;
    let enCours = false;
    /** Changements signalés : une lecture n'est à jour que si aucun n'est arrivé pendant qu'elle tournait. */
    let changements = 0;
    const convertir = requete.convertir;

    // Une seule lecture à la fois ; un changement arrivé pendant la lecture en relance une.
    async function relire(): Promise<void> {
      changements++;
      if (enCours) return;
      enCours = true;
      try {
        for (;;) {
          const vus = changements;
          const lignes = await base.getAll<Readonly<Record<string, unknown>>>(requete.sql, requete.parametres ?? []);
          if (!actif) return;
          rappel(convertir === undefined ? (lignes as T[]) : lignes.map(convertir));
          if (changements === vus) return;
        }
      } catch (erreur) {
        console.error('lecture surveillée en échec', erreur);
      } finally {
        enCours = false;
      }
    }

    const arreter = base.onChange({ onChange: () => relire() }, { tables: requete.tables });
    void relire();
    return () => {
      actif = false;
      arreter();
    };
  }

  return {
    lire: <T>(sql: string, parametres?: readonly unknown[]) => base.getAll<T>(sql, parametres ?? []),

    async ecrire(sql, parametres) {
      await base.writeTransaction(async (tx) => {
        await tx.execute(sql, parametres ?? []);
      });
    },

    surveiller,

    async saisirEvenement(saisie: SaisieEvenement): Promise<Id<'Evenement'>> {
      const id = nouvelId<'Evenement'>();
      const valeurs: Record<(typeof COLONNES_EVENEMENT)[number], string | null> = {
        id,
        ferme_id: options.fermeId,
        type: saisie.type,
        date: saisie.date,
        horodatage: maintenant().toISOString(),
        auteur_id: options.utilisateurId,
        source: saisie.source,
        serie_id: saisie.culture?.sorte === 'serie' ? saisie.culture.serieId : null,
        campagne_id: saisie.culture?.sorte === 'campagne' ? saisie.culture.campagneId : null,
        emplacement_ids: JSON.stringify(saisie.emplacementIds),
        note: saisie.note,
        photos: JSON.stringify(saisie.photos),
        remplace_sorte: saisie.remplaceEvenement?.sorte ?? null,
        remplace_evenement_id: saisie.remplaceEvenement?.evenementId ?? null,
        detail: JSON.stringify(saisie.detail),
      };
      await base.writeTransaction(async (tx) => {
        await tx.execute(
          SQL_SAISIE,
          COLONNES_EVENEMENT.map((c) => valeurs[c]),
        );
      });
      return id;
    },

    surveillerRefus(rappel) {
      return surveiller<RefusSynchro>(
        {
          sql: SQL_REFUS,
          parametres: [options.utilisateurId],
          tables: ['refus_synchro'],
          convertir: (l) => refusDepuisLigne(l as unknown as LigneRefus),
        },
        rappel,
      );
    },
  };
}
