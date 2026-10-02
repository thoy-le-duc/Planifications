/**
 * La porte d'accès aux données (T10) : seule façon pour l'appli web de lire et d'écrire la base
 * locale. Aucun réseau ici : une écriture change l'écran tout de suite, et part dans la file
 * d'envoi de PowerSync (voir envoi.ts) au retour du réseau.
 */
import { creerGenerateurId, ECRITURES_MAX_PAR_LOT, TAILLE_MAX_PAR_LOT, type Id } from '@planif/core';
import type {
  BaseLocale,
  EvenementPrepare,
  LigneEvenementLocale,
  OptionsPorte,
  OrdreEcriture,
  PorteDonnees,
  RefusSynchro,
  ResumeSaisie,
  RequeteSurveillee,
  SaisieEvenement,
} from './types.ts';

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

const SQL_REFUS = `SELECT id, nom_table, ligne_id, operation, motif, message, cree_le,
    saisie_type, saisie_culture, saisie_date, saisie_quantite, saisie_unite
  FROM refus_synchro WHERE utilisateur_id = ? AND archive_le IS NULL ORDER BY cree_le DESC, id DESC`;

/**
 * T10l : archive des refus de l'utilisateur (ids en fin de requête). Seule archive_le change : la
 * synchro l'envoie en PATCH { archive_le }, seule forme que le serveur accepte. Un refus déjà
 * archivé garde sa première date ; celui d'un autre utilisateur n'est jamais touché.
 */
const sqlArchiverRefus = (n: number): string =>
  `UPDATE refus_synchro SET archive_le = ? WHERE utilisateur_id = ? AND archive_le IS NULL AND id IN (${Array.from({ length: n }, () => '?').join(', ')})`;

interface LigneRefus {
  readonly id: string;
  readonly nom_table: string;
  readonly ligne_id: string;
  readonly operation: RefusSynchro['operation'];
  readonly motif: string;
  readonly message: string;
  readonly cree_le: string;
  // T10k : nulles pour un refus sans résumé (ou absentes, ligne reçue d'un serveur d'avant).
  readonly saisie_type?: string | null;
  readonly saisie_culture?: string | null;
  readonly saisie_date?: string | null;
  readonly saisie_quantite?: number | null;
  readonly saisie_unite?: string | null;
}

const texteOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nombreOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** T10k : résumé de la saisie, ou undefined quand le serveur n'en a calculé aucun. */
function resumeDepuisLigne(l: LigneRefus): ResumeSaisie | undefined {
  const resume: ResumeSaisie = {
    type: texteOuNul(l.saisie_type),
    culture: texteOuNul(l.saisie_culture),
    date: texteOuNul(l.saisie_date),
    quantite: nombreOuNul(l.saisie_quantite),
    unite: texteOuNul(l.saisie_unite),
  };
  return Object.values(resume).every((v) => v === null) ? undefined : resume;
}

function refusDepuisLigne(l: LigneRefus): RefusSynchro {
  const refus: RefusSynchro = {
    id: l.id,
    nomTable: l.nom_table,
    ligneId: l.ligne_id,
    operation: l.operation,
    motif: l.motif,
    message: l.message,
    creeLe: l.cree_le,
  };
  const saisie = resumeDepuisLigne(l);
  return saisie === undefined ? refus : { ...refus, saisie };
}

/**
 * Rejette une transaction locale plus lourde que TAILLE_MAX_PAR_LOT (octets UTF-8 de
 * `JSON.stringify(ordres)`), avant d'ouvrir quoi que ce soit. Le serveur refuse un corps de plus
 * de 6 Mio ('lot_trop_gros', saisie perdue) et coupe au-delà de 8 Mio (413, file bloquée) ; le
 * corps envoyé peut peser plus que les ordres (PowerSync y range toutes les colonnes de la
 * ligne) : la porte s'arrête donc à 5 Mio, pour garder la marge.
 */
function verifierTaille(ordres: readonly OrdreEcriture[]): void {
  const octets = new TextEncoder().encode(JSON.stringify(ordres)).length;
  if (octets > TAILLE_MAX_PAR_LOT) {
    throw new Error(`transaction de ${String(octets)} octets : ${String(TAILLE_MAX_PAR_LOT)} au plus`);
  }
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

  function preparerSaisie(saisie: SaisieEvenement): EvenementPrepare {
    const id = nouvelId<'Evenement'>();
    const ligne: LigneEvenementLocale = {
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
    return { id, ligne, ordre: { sql: SQL_SAISIE, parametres: COLONNES_EVENEMENT.map((c) => ligne[c]) } };
  }

  return {
    lire: <T>(sql: string, parametres?: readonly unknown[]) => base.getAll<T>(sql, parametres ?? []),

    async ecrire(sql, parametres) {
      verifierTaille([{ sql, parametres: parametres ?? [] }]);
      await base.writeTransaction(async (tx) => {
        await tx.execute(sql, parametres ?? []);
      });
    },

    async ecrireEnsemble(ordres: readonly OrdreEcriture[]) {
      // Liste vide : rien à écrire, aucune transaction (donc rien dans la file d'envoi).
      if (ordres.length === 0) return;
      // Une transaction trop grosse serait refusée par le serveur (400) et bloquerait la file
      // d'envoi : rejet avant d'ouvrir quoi que ce soit.
      if (ordres.length > ECRITURES_MAX_PAR_LOT) {
        throw new Error(`${String(ordres.length)} écritures en une transaction : ${String(ECRITURES_MAX_PAR_LOT)} au plus`);
      }
      // Même règle pour le poids (verifierTaille).
      verifierTaille(ordres);
      // Une seule transaction locale : PowerSync l'envoie en un seul lot, que le serveur accepte ou
      // refuse en entier. Un ordre qui échoue rejette la promesse et annule tout.
      await base.writeTransaction(async (tx) => {
        for (const ordre of ordres) await tx.execute(ordre.sql, ordre.parametres ?? []);
      });
    },

    surveiller,

    async saisirEvenement(saisie: SaisieEvenement): Promise<Id<'Evenement'>> {
      const { id, ordre } = preparerSaisie(saisie);
      verifierTaille([ordre]);
      await base.writeTransaction(async (tx) => {
        await tx.execute(ordre.sql, ordre.parametres);
      });
      return id;
    },

    preparerSaisie,

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

    async archiverRefus(ids: readonly string[]) {
      const uniques = [...new Set(ids)];
      // Au plus ECRITURES_MAX_PAR_LOT lignes par transaction locale : une transaction = un envoi,
      // que le serveur refuserait au-delà.
      for (let debut = 0; debut < uniques.length; debut += ECRITURES_MAX_PAR_LOT) {
        const lot = uniques.slice(debut, debut + ECRITURES_MAX_PAR_LOT);
        await base.writeTransaction(async (tx) => {
          await tx.execute(sqlArchiverRefus(lot.length), [maintenant().toISOString(), options.utilisateurId, ...lot]);
        });
      }
    },
  };
}
