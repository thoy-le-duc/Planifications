/**
 * T23 — section « Itinéraires » de la page de diagnostic de la synchro
 * (`/diagnostic/synchro.html?ferme=<id>&espece=<especeId>`) : créer un type d'intervention et un
 * itinéraire qui l'utilise (duplication du premier itinéraire local de l'espèce), puis masquer
 * ce type, chaque fois en UNE transaction de la porte (`ecrireEnsemble`), donc un seul envoi au
 * serveur, accepté ou refusé en entier. Contrat : en-tête de e2e-synchro/itineraire.e2e.ts.
 *
 * Tout passe par la porte de @planif/sync ; ne dépend pas de l'écran de T24.
 */
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';
import { cleHorodatageSql } from '@planif/sync/fait-unique';

export interface OptionsSectionItineraires {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly especeId: string;
  readonly afficherErreur: (message: string) => void;
}

type LigneLocale = Readonly<Record<string, unknown>>;

const SQL_TYPE = `INSERT INTO type_intervention (id, ferme_id, categorie, libelle, masque) VALUES (?, ?, 'entretien', ?, 0)`;
const SQL_ITINERAIRE = `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres) VALUES (?, ?, ?, NULL, ?, ?, ?)`;
const SQL_MASQUER = 'UPDATE type_intervention SET masque = 1 WHERE id = ?';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`élément #${id} absent`);
  return e;
}

const texteOuVide = (v: unknown): string => (typeof v === 'string' ? v : '');

function ligneListe(testid: string, donnees: Readonly<Record<string, string>>, texte: string): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.testid = testid;
  for (const [cle, valeur] of Object.entries(donnees)) li.dataset[cle] = valeur;
  li.textContent = texte;
  return li;
}

/** Objet JSON lu dans un texte de la base locale, ou null. */
function objetJson(texte: unknown): Record<string, unknown> | null {
  try {
    const v: unknown = typeof texte === 'string' ? JSON.parse(texte) : null;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** « categorie/type » de chaque travail prévu, dans l'ordre ; [] sans travaux. */
function travaux(parametres: unknown): string[] {
  const liste = objetJson(parametres)?.travauxPrevus;
  if (!Array.isArray(liste)) return [];
  return (liste as unknown[]).map((t) => {
    const o = typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : {};
    return `${texteOuVide(o.categorie)}/${texteOuVide(o.type)}`;
  });
}

/** Booléen de SQLite (0 / 1), ou de JSON. */
const masque = (v: unknown): '0' | '1' => (v === 1 || v === true || v === '1' ? '1' : '0');

export function brancherSectionItineraires(o: OptionsSectionItineraires): void {
  const { porte, fermeId, especeId } = o;
  element('section-itineraires', HTMLElement).hidden = false;

  const listeTypes = element('types-intervention', HTMLUListElement);
  porte.surveiller<LigneLocale>(
    {
      sql: `SELECT id, ferme_id, categorie, libelle, masque FROM type_intervention
            WHERE supprime_le IS NULL AND (ferme_id = ? OR ferme_id IS NULL) ORDER BY categorie, libelle, id`,
      parametres: [fermeId],
      tables: ['type_intervention'],
    },
    (lignes) => {
      listeTypes.replaceChildren(
        ...lignes.map((l) =>
          ligneListe(
            'type-intervention',
            { id: String(l.id), categorie: texteOuVide(l.categorie), libelle: texteOuVide(l.libelle), ferme: texteOuVide(l.ferme_id), masque: masque(l.masque) },
            `${texteOuVide(l.categorie)} : ${texteOuVide(l.libelle)}`,
          ),
        ),
      );
    },
  );

  const listeItineraires = element('itineraires', HTMLUListElement);
  porte.surveiller<LigneLocale>(
    {
      sql: 'SELECT id, nom, supprime_le, parametres FROM itineraire WHERE ferme_id = ? AND espece_id = ? ORDER BY id',
      parametres: [fermeId, especeId],
      tables: ['itineraire'],
    },
    (lignes) => {
      listeItineraires.replaceChildren(
        ...lignes.map((l) =>
          ligneListe(
            'itineraire',
            { id: String(l.id), nom: texteOuVide(l.nom), supprime: l.supprime_le == null ? 'non' : 'oui', travaux: JSON.stringify(travaux(l.parametres)) },
            texteOuVide(l.nom),
          ),
        ),
      );
    },
  );

  const listeHistorique = element('historique-itineraires', HTMLUListElement);
  porte.surveiller<LigneLocale>(
    {
      sql: `SELECT id, nom_table, ligne_id, operation FROM modification
            WHERE (nom_table = 'Itineraire' AND ligne_id IN (SELECT id FROM itineraire WHERE ferme_id = ? AND espece_id = ?))
               OR (nom_table = 'TypeIntervention' AND ligne_id IN (SELECT id FROM type_intervention WHERE supprime_le IS NULL AND (ferme_id = ? OR ferme_id IS NULL)))
            ORDER BY ${cleHorodatageSql('horodatage', 'id')}`,
      parametres: [fermeId, especeId, fermeId],
      tables: ['modification', 'itineraire', 'type_intervention'],
    },
    (lignes) => {
      listeHistorique.replaceChildren(
        ...lignes.map((l) =>
          ligneListe(
            'historique-itineraire',
            { table: texteOuVide(l.nom_table), ligne: texteOuVide(l.ligne_id), operation: texteOuVide(l.operation) },
            `${texteOuVide(l.nom_table)} ${texteOuVide(l.operation)}`,
          ),
        ),
      );
    },
  );

  const ecrire = (ordres: readonly OrdreEcriture[], quoi: string): Promise<boolean> =>
    // Une saisie = UNE transaction de la porte (jamais plusieurs `ecrire`).
    porte.ecrireEnsemble(ordres).then(
      () => true,
      (erreur: unknown) => {
        o.afficherErreur(`${quoi} impossible : ${String(erreur)}`);
        return false;
      },
    );

  /** Dernier type créé par la section. */
  let dernierType: string | null = null;

  const champType = element('nouveau-type-intervention', HTMLInputElement);
  const champNom = element('nom-nouvel-itineraire', HTMLInputElement);
  element('creation-itineraire', HTMLFormElement).addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const libelle = champType.value.trim();
    const nom = champNom.value.trim();
    if (libelle === '' || nom === '') {
      o.afficherErreur('Type d’intervention et nom de l’itinéraire : à remplir.');
      return;
    }
    void ordresCreation(o, libelle, nom)
      .then(async (creation) => {
        if (creation === null) return;
        if (await ecrire(creation.ordres, 'Création du type et de l’itinéraire')) dernierType = creation.typeId;
      })
      .catch((erreur: unknown) => {
        o.afficherErreur(`Création du type et de l’itinéraire impossible : ${String(erreur)}`);
      });
  });

  element('masquer-type', HTMLButtonElement).addEventListener('click', () => {
    if (dernierType === null) return;
    void ecrire([{ sql: SQL_MASQUER, parametres: [dernierType] }], 'Masquage du type');
  });
}

/**
 * Création : le type d'intervention (entretien) et un itinéraire qui DUPLIQUE le premier
 * itinéraire local de l'espèce (mode et paramètres), avec deux travaux prévus : la grelinette de
 * la liste de départ, et le nouveau type tous les 14 jours de la mise en place au début de récolte.
 */
async function ordresCreation(o: OptionsSectionItineraires, libelle: string, nom: string): Promise<{ typeId: string; ordres: OrdreEcriture[] } | null> {
  const [modele] = await o.porte.lire<LigneLocale>(
    `SELECT mode, parametres FROM itineraire
     WHERE espece_id = ? AND (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL ORDER BY id LIMIT 1`,
    [o.especeId, o.fermeId],
  );
  const parametres = objetJson(modele?.parametres);
  if (modele === undefined || parametres === null) {
    o.afficherErreur('Itinéraire de l’espèce introuvable dans la base locale.');
    return null;
  }
  const typeId = crypto.randomUUID();
  const travauxPrevus = [
    { categorie: 'travail_sol', type: 'grelinette', repere: 'mise_en_place', decalageJours: -10 },
    { categorie: 'entretien', type: libelle, repere: 'mise_en_place', decalageJours: 0, repetition: { tousLesJours: 14, repereFin: 'debut_recolte' } },
  ];
  return {
    typeId,
    ordres: [
      { sql: SQL_TYPE, parametres: [typeId, o.fermeId, libelle] },
      {
        sql: SQL_ITINERAIRE,
        parametres: [crypto.randomUUID(), o.fermeId, o.especeId, nom, modele.mode, JSON.stringify({ ...parametres, travauxPrevus })],
      },
    ],
  };
}
