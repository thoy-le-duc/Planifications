/**
 * T10c — section « Récolte d'une série » de la page de diagnostic de la synchro
 * (`/diagnostic/synchro.html?ferme=<id>&serie=<id>`) : une récolte et son annulation, chacune
 * avec son effet sur le stock, en UNE transaction de la porte (`ecrireEnsemble`), donc un seul
 * envoi au serveur, accepté ou refusé en entier. Contrat : en-tête de e2e-synchro/stock.e2e.ts.
 *
 * Tout passe par la porte de @planif/sync ; ne dépend pas de l'écran « Aujourd'hui » (T13).
 */
import { mouvementAttendu } from '@planif/core';
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';
import { cleHorodatageSql } from '@planif/sync/fait-unique';

export interface OptionsSectionSerie {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly serieId: string;
  readonly auteurId: string;
  /** Jour calendaire à la ferme ('AAAA-MM-JJ'). */
  readonly aujourdhui: () => string;
  readonly afficherErreur: (message: string) => void;
}

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
type ColonneEvenement = (typeof COLONNES_EVENEMENT)[number];

const SQL_EVENEMENT = `INSERT INTO evenement (${COLONNES_EVENEMENT.join(', ')}) VALUES (${COLONNES_EVENEMENT.map(() => '?').join(', ')})`;
const SQL_ARTICLE = 'INSERT INTO article_stock (id, ferme_id, espece_id, variete_id, unite, categorie) VALUES (?, ?, ?, ?, ?, NULL)';
const SQL_MOUVEMENT = "INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif, recolte_id) VALUES (?, ?, ?, ?, ?, 'recolte', ?)";

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`élément #${id} absent`);
  return e;
}

function nombreOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function texteOuVide(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** `detail.quantite` d'une ligne locale (texte JSON), ou null. */
function quantiteDuDetail(detail: unknown): number | null {
  try {
    const d: unknown = typeof detail === 'string' ? JSON.parse(detail) : null;
    return typeof d === 'object' && d !== null ? nombreOuNull((d as Record<string, unknown>).quantite) : null;
  } catch {
    return null;
  }
}

function ligneListe(testid: string, donnees: Readonly<Record<string, string>>, texte: string): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.testid = testid;
  for (const [cle, valeur] of Object.entries(donnees)) li.dataset[cle] = valeur;
  li.textContent = texte;
  return li;
}

export function brancherSectionSerie(o: OptionsSectionSerie): void {
  const { porte, fermeId, serieId } = o;
  element('section-serie', HTMLElement).hidden = false;

  const listeEvenements = element('evenements-serie', HTMLUListElement);
  porte.surveiller<Readonly<Record<string, unknown>>>(
    {
      // T13q : ordre canonique (instant, id), jamais le texte de l'horodatage.
      sql: `SELECT id, detail, remplace_sorte, remplace_evenement_id FROM evenement WHERE serie_id = ? ORDER BY ${cleHorodatageSql('horodatage', 'id')}`,
      parametres: [serieId],
      tables: ['evenement'],
    },
    (lignes) => {
      listeEvenements.replaceChildren(
        ...lignes.map((l) => {
          const quantite = String(quantiteDuDetail(l.detail));
          const sorte = texteOuVide(l.remplace_sorte);
          return ligneListe(
            'evenement-serie',
            { id: String(l.id), quantite, remplaceSorte: sorte, remplaceId: texteOuVide(l.remplace_evenement_id) },
            `${sorte === '' ? 'récolte' : sorte} ${quantite} kg`,
          );
        }),
      );
    },
  );

  const listeMouvements = element('mouvements', HTMLUListElement);
  porte.surveiller<Readonly<Record<string, unknown>>>(
    {
      sql: 'SELECT id, article_stock_id, quantite, motif, recolte_id FROM mouvement_stock WHERE ferme_id = ? ORDER BY id',
      parametres: [fermeId],
      tables: ['mouvement_stock'],
    },
    (lignes) => {
      listeMouvements.replaceChildren(
        ...lignes.map((l) => {
          const quantite = String(nombreOuNull(l.quantite));
          return ligneListe(
            'mouvement',
            {
              id: String(l.id),
              article: texteOuVide(l.article_stock_id),
              quantite,
              motif: texteOuVide(l.motif),
              recolte: texteOuVide(l.recolte_id),
            },
            `${quantite} (${texteOuVide(l.motif)})`,
          );
        }),
      );
    },
  );

  const listeStocks = element('stocks', HTMLUListElement);
  porte.surveiller<Readonly<Record<string, unknown>>>(
    {
      sql: `SELECT a.id, coalesce((SELECT sum(m.quantite) FROM mouvement_stock m WHERE m.article_stock_id = a.id), 0) AS quantite
            FROM article_stock a WHERE a.ferme_id = ? ORDER BY a.id`,
      parametres: [fermeId],
      tables: ['article_stock', 'mouvement_stock'],
    },
    (lignes) => {
      listeStocks.replaceChildren(
        ...lignes.map((l) => {
          // Somme de réels : arrondie au millionième pour l'affichage (12 + −12 = 0, jamais 1e-15).
          const somme = Math.round((nombreOuNull(l.quantite) ?? 0) * 1_000_000) / 1_000_000 + 0;
          return ligneListe('stock', { article: String(l.id), quantite: String(somme) }, `${String(somme)} kg`);
        }),
      );
    },
  );

  const ecrire = (ordres: readonly OrdreEcriture[], quoi: string): void => {
    // Une saisie = UNE transaction de la porte (jamais plusieurs `ecrire`).
    porte.ecrireEnsemble(ordres).catch((erreur: unknown) => {
      o.afficherErreur(`${quoi} impossible : ${String(erreur)}`);
    });
  };

  const champ = element('quantite-serie', HTMLInputElement);
  element('saisie-serie', HTMLFormElement).addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const quantite = Number(champ.value);
    if (!Number.isFinite(quantite) || quantite <= 0) return;
    void ordresRecolte(o, quantite)
      .then((ordres) => {
        if (ordres === null) {
          o.afficherErreur('Série ou espèce introuvable dans la base locale.');
          return;
        }
        champ.value = '';
        ecrire(ordres, 'Récolte');
      })
      .catch((erreur: unknown) => {
        o.afficherErreur(`Récolte impossible : ${String(erreur)}`);
      });
  });

  element('annuler-serie', HTMLButtonElement).addEventListener('click', () => {
    void ordresAnnulation(o)
      .then((ordres) => {
        if (ordres !== null) ecrire(ordres, 'Annulation');
      })
      .catch((erreur: unknown) => {
        o.afficherErreur(`Annulation impossible : ${String(erreur)}`);
      });
  });
}

/** Colonnes d'un événement, dans l'ordre de SQL_EVENEMENT. */
function valeursEvenement(v: Readonly<Record<ColonneEvenement, unknown>>): unknown[] {
  return COLONNES_EVENEMENT.map((c) => v[c]);
}

/**
 * Récolte de `quantite` sur la série : l'article (espèce et variété de la série, unité de
 * récolte de l'espèce) s'il n'existe pas encore, l'événement, le mouvement +quantite.
 */
async function ordresRecolte(o: OptionsSectionSerie, quantite: number): Promise<OrdreEcriture[] | null> {
  const [serie] = await o.porte.lire<{ espece_id: string; variete_id: string | null; unite_recolte: string | null }>(
    `SELECT s.espece_id, s.variete_id, e.unite_recolte FROM serie s LEFT JOIN espece e ON e.id = s.espece_id WHERE s.id = ?`,
    [o.serieId],
  );
  if (serie?.unite_recolte == null) return null;
  const [article] = await o.porte.lire<{ id: string }>(
    `SELECT id FROM article_stock
     WHERE ferme_id = ? AND espece_id = ? AND variete_id IS ? AND unite = ? AND categorie IS NULL AND supprime_le IS NULL
     ORDER BY id LIMIT 1`,
    [o.fermeId, serie.espece_id, serie.variete_id, serie.unite_recolte],
  );
  const ordres: OrdreEcriture[] = [];
  const articleId = article?.id ?? crypto.randomUUID();
  if (article === undefined) {
    ordres.push({ sql: SQL_ARTICLE, parametres: [articleId, o.fermeId, serie.espece_id, serie.variete_id, serie.unite_recolte] });
  }
  const recolteId = crypto.randomUUID();
  const jour = o.aujourdhui();
  ordres.push({
    sql: SQL_EVENEMENT,
    parametres: valeursEvenement({
      id: recolteId,
      ferme_id: o.fermeId,
      type: 'recolte',
      date: jour,
      horodatage: new Date().toISOString(),
      auteur_id: o.auteurId,
      source: 'tap',
      serie_id: o.serieId,
      campagne_id: null,
      emplacement_ids: '[]',
      note: null,
      photos: '[]',
      remplace_sorte: null,
      remplace_evenement_id: null,
      detail: JSON.stringify({ quantite, unite: serie.unite_recolte, categorie: null }),
    }),
  });
  ordres.push({ sql: SQL_MOUVEMENT, parametres: [crypto.randomUUID(), o.fermeId, articleId, jour, quantite, recolteId] });
  return ordres;
}

/**
 * Annulation de la dernière récolte de la série pas encore annulée (ordre canonique instant, id :
 * `cleHorodatageSql`, T13q) : l'événement d'annulation (mêmes colonnes et même détail, horodatage
 * neuf) et, sur chaque article, le mouvement inverse rattaché à l'annulation (−somme des
 * mouvements de la récolte : `mouvementAttendu` du cœur).
 */
async function ordresAnnulation(o: OptionsSectionSerie): Promise<OrdreEcriture[] | null> {
  const [recolte] = await o.porte.lire<Readonly<Record<ColonneEvenement, unknown>>>(
    `SELECT ${COLONNES_EVENEMENT.join(', ')} FROM evenement r
     WHERE r.serie_id = ? AND r.type = 'recolte' AND r.remplace_sorte IS NULL
       AND NOT EXISTS (SELECT 1 FROM evenement a WHERE a.remplace_evenement_id = r.id AND a.remplace_sorte = 'annulation')
     ORDER BY ${cleHorodatageSql('r.horodatage', 'r.id')} DESC LIMIT 1`,
    [o.serieId],
  );
  if (recolte === undefined) return null;
  const annulationId = crypto.randomUUID();
  const ordres: OrdreEcriture[] = [
    {
      sql: SQL_EVENEMENT,
      parametres: valeursEvenement({
        ...recolte,
        id: annulationId,
        horodatage: new Date().toISOString(),
        remplace_sorte: 'annulation',
        remplace_evenement_id: recolte.id,
      }),
    },
  ];
  const sommes = await o.porte.lire<{ article_stock_id: string; somme: number }>(
    'SELECT article_stock_id, sum(quantite) AS somme FROM mouvement_stock WHERE recolte_id = ? GROUP BY article_stock_id ORDER BY article_stock_id',
    [recolte.id],
  );
  const jour = o.aujourdhui();
  for (const { article_stock_id: articleId, somme } of sommes) {
    const inverse = mouvementAttendu({ remplaceSorte: 'annulation', quantite: 0 }, somme);
    if (inverse === null || inverse === 0) continue;
    ordres.push({ sql: SQL_MOUVEMENT, parametres: [crypto.randomUUID(), o.fermeId, articleId, jour, inverse, annulationId] });
  }
  return ordres;
}
