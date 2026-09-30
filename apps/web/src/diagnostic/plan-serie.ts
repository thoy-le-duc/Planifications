/**
 * T10e — section « Série de batavias » de la page de diagnostic de la synchro
 * (`/diagnostic/synchro.html?ferme=<id>&plan=<itineraireId>&saison=<saisonId>&planches=<id>,<id>`) :
 * créer une série sur des planches, la décaler d'une semaine, puis annuler ce décalage, chaque
 * fois en UNE transaction de la porte (`ecrireEnsemble`), donc un seul envoi au serveur, accepté
 * ou refusé en entier. Contrat : en-tête de e2e-synchro/serie.e2e.ts.
 *
 * Tout passe par la porte de @planif/sync ; ne dépend pas de l'écran de T12. Les dates viennent du
 * cœur (`calculerDatesSerie`, T02), jamais d'un calcul refait ici.
 */
import { ajouterJours, calculerDatesSerie, estDateValide, type DateCalendaire, type DatesSerie, type ParametresDatesSerie } from '@planif/core';
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';

export interface OptionsSectionPlanSerie {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly itineraireId: string;
  readonly saisonId: string;
  readonly planches: readonly string[];
  readonly afficherErreur: (message: string) => void;
}

type LigneLocale = Readonly<Record<string, unknown>>;

/** Dates d'une série et de ses occupations, gardées pour « Annuler » (comme le bandeau de T12, hors ligne). */
interface EtatSerie {
  readonly serieId: string;
  readonly ancreDate: string;
  readonly dates: DatesSerie;
  readonly occupations: readonly string[];
}

const SQL_SERIE = `INSERT INTO serie (id, ferme_id, saison_id, espece_id, variete_id, itineraire_id, parametres, ancre_type, ancre_date,
  prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte, longueur_m, nombre_plants, statut, rotation_acceptee)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'debut_recolte', ?, ?, ?, ?, ?, ?, NULL, 'prevue', ?)`;
const SQL_OCCUPATION = `INSERT INTO occupation (id, ferme_id, emplacement_id, serie_id, plantation_id, evenement_id, longueur_m, nombre_places,
  position_m, prevu_du, prevu_au, reel_du, reel_au) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, NULL, NULL)`;
const SQL_DATES_SERIE = `UPDATE serie SET ancre_date = ?, prevu_semis_pepiniere = ?, prevu_mise_en_place = ?, prevu_debut_recolte = ?,
  prevu_fin_recolte = ? WHERE id = ?`;
const SQL_DATES_OCCUPATION = 'UPDATE occupation SET prevu_du = ?, prevu_au = ? WHERE id = ?';

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

/** Paramètres de l'itinéraire (texte JSON de la base locale), lus pour le calcul des dates. */
function parametresDates(texte: unknown): ParametresDatesSerie | null {
  try {
    const p: unknown = typeof texte === 'string' ? JSON.parse(texte) : null;
    return typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as ParametresDatesSerie) : null;
  } catch {
    return null;
  }
}

/** Les quatre dates prévues dans l'ordre des colonnes (semis en pépinière NULL s'il est sans objet). */
const valeursDates = (d: DatesSerie): unknown[] => [d.semisPepiniere ?? null, d.miseEnPlace, d.debutRecolte, d.finRecolte];

export function brancherSectionPlanSerie(o: OptionsSectionPlanSerie): void {
  const { porte, fermeId, itineraireId } = o;
  element('section-plan-serie', HTMLElement).hidden = false;

  const listeSeries = element('series', HTMLUListElement);
  porte.surveiller<LigneLocale>(
    {
      sql: `SELECT id, ancre_date, prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte, supprime_le,
                   rotation_acceptee
            FROM serie WHERE ferme_id = ? AND itineraire_id = ? ORDER BY id`,
      parametres: [fermeId, itineraireId],
      tables: ['serie'],
    },
    (lignes) => {
      listeSeries.replaceChildren(
        ...lignes.map((l) =>
          ligneListe(
            'serie',
            {
              id: String(l.id),
              ancreDate: texteOuVide(l.ancre_date),
              prevuSemis: texteOuVide(l.prevu_semis_pepiniere),
              prevuMiseEnPlace: texteOuVide(l.prevu_mise_en_place),
              prevuDebutRecolte: texteOuVide(l.prevu_debut_recolte),
              prevuFinRecolte: texteOuVide(l.prevu_fin_recolte),
              supprimee: l.supprime_le == null ? 'non' : 'oui',
              rotationAcceptee: texteOuVide(l.rotation_acceptee),
            },
            `récolte à partir du ${texteOuVide(l.prevu_debut_recolte)}`,
          ),
        ),
      );
    },
  );

  const listeOccupations = element('occupations', HTMLUListElement);
  porte.surveiller<LigneLocale>(
    {
      sql: `SELECT o.id, o.serie_id, o.emplacement_id, o.longueur_m, o.prevu_du, o.prevu_au, o.supprime_le
            FROM occupation o JOIN serie s ON s.id = o.serie_id
            WHERE s.ferme_id = ? AND s.itineraire_id = ? ORDER BY o.id`,
      parametres: [fermeId, itineraireId],
      tables: ['occupation', 'serie'],
    },
    (lignes) => {
      listeOccupations.replaceChildren(
        ...lignes.map((l) =>
          ligneListe(
            'occupation',
            {
              id: String(l.id),
              serie: texteOuVide(l.serie_id),
              emplacement: texteOuVide(l.emplacement_id),
              longueur: String(l.longueur_m),
              prevuDu: texteOuVide(l.prevu_du),
              prevuAu: texteOuVide(l.prevu_au),
              supprimee: l.supprime_le == null ? 'non' : 'oui',
            },
            `${String(l.longueur_m)} m du ${texteOuVide(l.prevu_du)} au ${texteOuVide(l.prevu_au)}`,
          ),
        ),
      );
    },
  );

  const listeHistorique = element('historique', HTMLUListElement);
  porte.surveiller<LigneLocale>(
    {
      sql: `SELECT id, nom_table, ligne_id, operation FROM modification
            WHERE ligne_id IN (SELECT id FROM serie WHERE ferme_id = ? AND itineraire_id = ?)
               OR ligne_id IN (SELECT o.id FROM occupation o JOIN serie s ON s.id = o.serie_id WHERE s.ferme_id = ? AND s.itineraire_id = ?)
            ORDER BY horodatage, id`,
      parametres: [fermeId, itineraireId, fermeId, itineraireId],
      tables: ['modification', 'serie', 'occupation'],
    },
    (lignes) => {
      listeHistorique.replaceChildren(
        ...lignes.map((l) =>
          ligneListe(
            'historique',
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

  /** Dernière série créée par la section, et les dates d'avant la dernière modification. */
  let derniere: string | null = null;
  let avant: EtatSerie | null = null;

  const champ = element('debut-recolte-serie', HTMLInputElement);
  element('creation-serie', HTMLFormElement).addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const debut = champ.value.trim();
    if (!estDateValide(debut)) {
      o.afficherErreur('Début de récolte : date AAAA-MM-JJ attendue.');
      return;
    }
    void ordresCreation(o, debut)
      .then(async (creation) => {
        if (creation === null) return;
        if (await ecrire(creation.ordres, 'Création de la série')) {
          derniere = creation.serieId;
          avant = null;
        }
      })
      .catch((erreur: unknown) => {
        o.afficherErreur(`Création de la série impossible : ${String(erreur)}`);
      });
  });

  element('decaler-serie', HTMLButtonElement).addEventListener('click', () => {
    if (derniere === null) return;
    const serieId = derniere;
    void etatSerie(porte, serieId)
      .then(async (etat) => {
        if (etat === null) {
          o.afficherErreur('Série introuvable dans la base locale.');
          return;
        }
        const ancre = ajouterJours(etat.ancreDate as DateCalendaire, 7);
        const dates = calculerDatesSerie(etat.parametres, { type: 'debut_recolte', date: ancre });
        if (await ecrire(ordresDates({ ...etat, ancreDate: ancre, dates }), 'Décalage de la série')) avant = etat;
      })
      .catch((erreur: unknown) => {
        o.afficherErreur(`Décalage de la série impossible : ${String(erreur)}`);
      });
  });

  element('annuler-modification-serie', HTMLButtonElement).addEventListener('click', () => {
    const etat = avant;
    if (etat === null) return;
    void ecrire(ordresDates(etat), 'Annulation de la modification').then((ok) => {
      if (ok) avant = null;
    });
  });
}

/** UPDATE de la série (ancre et dates prévues) et de chaque occupation (de la mise en place à la fin de récolte). */
function ordresDates(etat: EtatSerie): OrdreEcriture[] {
  return [
    { sql: SQL_DATES_SERIE, parametres: [etat.ancreDate, ...valeursDates(etat.dates), etat.serieId] },
    ...etat.occupations.map((id) => ({ sql: SQL_DATES_OCCUPATION, parametres: [etat.dates.miseEnPlace, etat.dates.finRecolte, id] })),
  ];
}

/** La série locale : ancre, dates, paramètres, et ses occupations non supprimées. */
async function etatSerie(porte: PorteDonnees, serieId: string): Promise<(EtatSerie & { readonly parametres: ParametresDatesSerie }) | null> {
  const [s] = await porte.lire<LigneLocale>(
    `SELECT ancre_date, parametres, prevu_semis_pepiniere, prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte
     FROM serie WHERE id = ?`,
    [serieId],
  );
  const parametres = parametresDates(s?.parametres);
  if (s === undefined || parametres === null) return null;
  const occupations = await porte.lire<{ id: string }>('SELECT id FROM occupation WHERE serie_id = ? AND supprime_le IS NULL ORDER BY id', [serieId]);
  const semis = texteOuVide(s.prevu_semis_pepiniere);
  const dates: DatesSerie = {
    ...(semis === '' ? {} : { semisPepiniere: semis as DateCalendaire }),
    miseEnPlace: texteOuVide(s.prevu_mise_en_place) as DateCalendaire,
    debutRecolte: texteOuVide(s.prevu_debut_recolte) as DateCalendaire,
    finRecolte: texteOuVide(s.prevu_fin_recolte) as DateCalendaire,
  };
  return { serieId, ancreDate: texteOuVide(s.ancre_date), dates, occupations: occupations.map((l) => l.id), parametres };
}

/**
 * Création : la série (espèce, variété et paramètres de l'itinéraire local, dates du cœur,
 * longueur = somme des planches, alerte rouge acceptée sur la famille de l'espèce) et une
 * occupation par planche, de la mise en place à la fin de récolte.
 */
async function ordresCreation(o: OptionsSectionPlanSerie, debut: DateCalendaire): Promise<{ serieId: string; ordres: OrdreEcriture[] } | null> {
  const [itineraire] = await o.porte.lire<LigneLocale>(
    `SELECT i.espece_id, i.variete_id, i.parametres, f.id AS famille_id, f.delai_retour_minimal_ans
     FROM itineraire i JOIN espece e ON e.id = i.espece_id JOIN famille f ON f.id = e.famille_id WHERE i.id = ?`,
    [o.itineraireId],
  );
  const parametres = parametresDates(itineraire?.parametres);
  if (itineraire === undefined || parametres === null) {
    o.afficherErreur('Itinéraire, espèce ou famille introuvable dans la base locale.');
    return null;
  }
  const places = o.planches.map(() => '?').join(', ');
  const planches = await o.porte.lire<{ id: string; longueur_m: number }>(
    `SELECT id, longueur_m FROM emplacement WHERE id IN (${places}) ORDER BY id`,
    [...o.planches],
  );
  if (planches.length !== o.planches.length || planches.some((p) => typeof p.longueur_m !== 'number')) {
    o.afficherErreur('Planche introuvable dans la base locale.');
    return null;
  }
  const dates = calculerDatesSerie(parametres, { type: 'debut_recolte', date: debut });
  const serieId = crypto.randomUUID();
  const rotation = JSON.stringify({ famille: itineraire.famille_id, delai_ans: itineraire.delai_retour_minimal_ans, le: new Date().toISOString() });
  const longueur = planches.reduce((somme, p) => somme + p.longueur_m, 0);
  return {
    serieId,
    ordres: [
      {
        sql: SQL_SERIE,
        parametres: [
          serieId,
          o.fermeId,
          o.saisonId,
          itineraire.espece_id,
          itineraire.variete_id ?? null,
          o.itineraireId,
          itineraire.parametres,
          debut,
          ...valeursDates(dates),
          longueur,
          rotation,
        ],
      },
      ...planches.map((p) => ({
        sql: SQL_OCCUPATION,
        parametres: [crypto.randomUUID(), o.fermeId, p.id, serieId, p.longueur_m, dates.miseEnPlace, dates.finRecolte],
      })),
    ],
  };
}
