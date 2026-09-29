/**
 * T10 — page de diagnostic de la synchro (hors navigation, hors service worker) :
 * `/diagnostic/synchro.html?ferme=<id>`. Sert au test de bout en bout (e2e-synchro/) et à
 * vérifier la synchro sur un vrai téléphone.
 *
 * Tout passe par la porte de @planif/sync, ouverte par src/donnees : la page n'importe jamais
 * PowerSync. Session : celle de l'appli (localStorage). API et service PowerSync :
 * VITE_API_URL et VITE_POWERSYNC_URL, figées au build, jamais lues dans l'URL (un lien piégé
 * enverrait le jeton ailleurs).
 */
import type { DateCalendaire, Id } from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import { urlApi } from '../connexion/client.ts';
import { deconnecterAvecConfirmation } from '../connexion/deconnexion.ts';
import { lireSession, stockageNavigateur } from '../connexion/session.ts';
import { ouvrirDonnees } from '../donnees/index.ts';

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUSEAU_PAR_DEFAUT = 'Europe/Paris';

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`élément #${id} absent`);
  return e;
}

function urlPowerSync(): string | null {
  const url: unknown = import.meta.env.VITE_POWERSYNC_URL;
  return typeof url === 'string' && url !== '' ? url.replace(/\/+$/, '') : null;
}

function afficherErreur(message: string): void {
  const e = element('erreur', HTMLParagraphElement);
  e.textContent = message;
  e.hidden = false;
}

/** Jour calendaire à `fuseau` (celui de la ferme) : 'AAAA-MM-JJ'. */
function aujourdhui(fuseau: string): DateCalendaire {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  ) as DateCalendaire;
}

interface Recolte {
  readonly id: string;
  readonly quantite: number | null;
  /** Colonne `note` de la ligne locale ('' si NULL) : montre qu'une modification refusée est défaite. */
  readonly note: string;
}

function recolteDepuisLigne(l: Readonly<Record<string, unknown>>): Recolte {
  let quantite: number | null = null;
  try {
    const detail: unknown = typeof l.detail === 'string' ? JSON.parse(l.detail) : null;
    const q = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>).quantite : null;
    quantite = typeof q === 'number' ? q : null;
  } catch {
    // Détail illisible : la ligne s'affiche sans quantité.
  }
  return { id: String(l.id), quantite, note: typeof l.note === 'string' ? l.note : '' };
}

function brancher(porte: PorteDonnees, fermeId: Id<'Ferme'>, auteurId: string): void {
  let fuseau = FUSEAU_PAR_DEFAUT;
  brancherPutInterdit(porte, auteurId, () => fuseau);
  porte.surveiller<string>(
    { sql: 'SELECT fuseau_horaire FROM ferme WHERE id = ?', parametres: [fermeId], tables: ['ferme'], convertir: (l) => String(l.fuseau_horaire) },
    (lignes) => {
      fuseau = lignes[0] ?? FUSEAU_PAR_DEFAUT;
    },
  );

  const liste = element('recoltes', HTMLUListElement);
  porte.surveiller<Recolte>(
    {
      sql: "SELECT id, detail, note FROM evenement WHERE ferme_id = ? AND type = 'recolte' ORDER BY id",
      parametres: [fermeId],
      tables: ['evenement'],
      convertir: recolteDepuisLigne,
    },
    (recoltes) => {
      liste.replaceChildren(
        ...recoltes.map((r) => {
          const li = document.createElement('li');
          li.dataset.testid = 'recolte';
          li.dataset.id = r.id;
          li.dataset.quantite = String(r.quantite);
          li.dataset.note = r.note;
          li.textContent = `${String(r.quantite)} kg`;
          return li;
        }),
      );
    },
  );

  // Toutes fermes confondues : une création refusée doit quitter la base locale après la synchro.
  const listeLocale = element('evenements-locaux', HTMLUListElement);
  porte.surveiller<string>(
    { sql: 'SELECT id FROM evenement ORDER BY id', tables: ['evenement'], convertir: (l) => String(l.id) },
    (ids) => {
      listeLocale.replaceChildren(
        ...ids.map((id) => {
          const li = document.createElement('li');
          li.dataset.testid = 'evenement-local';
          li.dataset.id = id;
          li.textContent = id;
          return li;
        }),
      );
    },
  );

  const listeRefus = element('refus', HTMLUListElement);
  porte.surveillerRefus((refus) => {
    listeRefus.replaceChildren(
      ...refus.map((r) => {
        const li = document.createElement('li');
        li.dataset.testid = 'refus';
        li.dataset.motif = r.motif;
        li.textContent = r.message;
        return li;
      }),
    );
  });

  let derniere: Id<'Evenement'> | null = null;
  const champ = element('quantite', HTMLInputElement);
  element('saisie', HTMLFormElement).addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const quantite = Number(champ.value);
    if (!Number.isFinite(quantite) || quantite <= 0) return;
    void porte
      .saisirEvenement({
        type: 'recolte',
        date: aujourdhui(fuseau),
        source: 'tap',
        culture: null,
        emplacementIds: [],
        note: null,
        photos: [],
        remplaceEvenement: null,
        detail: { quantite, unite: 'kg', categorie: null },
      })
      .then((id) => {
        derniere = id;
        champ.value = '';
      })
      .catch((erreur: unknown) => {
        afficherErreur(`Saisie impossible : ${String(erreur)}`);
      });
  });

  // Écriture interdite (le journal est en ajout seul) : le serveur la refuse, le motif redescend.
  element('modifier', HTMLButtonElement).addEventListener('click', () => {
    if (derniere === null) return;
    void porte.ecrire('UPDATE evenement SET note = ? WHERE id = ?', ['modifiée sur place', derniere]).catch((erreur: unknown) => {
      afficherErreur(`Écriture impossible : ${String(erreur)}`);
    });
  });
}

/**
 * Écriture que le serveur doit refuser (ferme_interdite) : une récolte valide en tout point, mais
 * pour une ferme dont l'utilisateur n'est pas membre (UUID neuf).
 */
function brancherPutInterdit(porte: PorteDonnees, auteurId: string, fuseau: () => string): void {
  const temoin = element('put-interdit', HTMLElement);
  element('autre-ferme', HTMLButtonElement).addEventListener('click', () => {
    const id = crypto.randomUUID();
    const detail = JSON.stringify({ quantite: 99, unite: 'kg', categorie: null });
    void porte
      .ecrire(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id,
           emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail)
         VALUES (?, ?, 'recolte', ?, ?, ?, 'tap', NULL, NULL, '[]', NULL, '[]', NULL, NULL, ?)`,
        [id, crypto.randomUUID(), aujourdhui(fuseau()), new Date().toISOString(), auteurId, detail],
      )
      .then(() => {
        temoin.dataset.id = id;
        temoin.textContent = id;
      })
      .catch((erreur: unknown) => {
        afficherErreur(`Écriture impossible : ${String(erreur)}`);
      });
  });
}

function demarrer(): void {
  const session = lireSession(stockageNavigateur());
  const ferme = new URLSearchParams(location.search).get('ferme') ?? '';
  const powersync = urlPowerSync();
  if (session === null || !MOTIF_UUID.test(ferme) || powersync === null) {
    afficherErreur(
      session === null
        ? 'Pas de session : connectez-vous dans l’appli.'
        : powersync === null
          ? 'VITE_POWERSYNC_URL absente au build.'
          : 'Paramètre ferme absent ou invalide.',
    );
    return;
  }
  const fermeId = ferme.toLowerCase() as Id<'Ferme'>;

  const donnees = ouvrirDonnees({ session, fermeId, urlApi: urlApi(), urlPowerSync: powersync, stockage: stockageNavigateur() });
  const etat = element('etat', HTMLElement);
  const LIBELLES = {
    connexion: 'connexion…',
    synchronise: 'synchronisé',
    'hors-ligne': 'hors ligne',
    'session-expiree': 'session expirée : reconnectez-vous',
  } as const;
  donnees.surveillerEtat((e) => {
    etat.dataset.etat = e;
    etat.textContent = LIBELLES[e];
  });
  brancher(donnees.porte, fermeId, session.utilisateurId);

  // T09b : déconnexion (jeton révoqué, session et base locale effacées), même hors ligne ;
  // confirmation d'abord si des saisies n'ont pas encore été envoyées.
  const bouton = element('deconnexion', HTMLButtonElement);
  bouton.addEventListener('click', () => {
    bouton.disabled = true;
    const envoyer: typeof fetch = (...args) => fetch(...args);
    deconnecterAvecConfirmation(session, {
      urlApi: urlApi(),
      fetch: envoyer,
      stockage: stockageNavigateur(),
      effacerBaseLocale: () => donnees.effacer(),
      compterEnAttente: () => donnees.ecrituresEnAttente(),
      confirmer,
    })
      .then((resultat) => {
        if (resultat === 'deconnecte') element('deconnecte', HTMLElement).hidden = false;
        else bouton.disabled = false;
      })
      .catch((erreur: unknown) => {
        afficherErreur(`Déconnexion : ${String(erreur)}`);
      });
  });
}

/** Écran de confirmation en un tap : vrai pour « Se déconnecter quand même », faux pour « Annuler ». */
function confirmer(message: string): Promise<boolean> {
  const boite = element('confirmation-deconnexion', HTMLDivElement);
  const oui = element('deconnexion-confirmee', HTMLButtonElement);
  const non = element('deconnexion-annulee', HTMLButtonElement);
  element('question-deconnexion', HTMLParagraphElement).textContent = message;
  boite.hidden = false;
  return new Promise<boolean>((repondre) => {
    const choisir = (choix: boolean) => () => {
      oui.removeEventListener('click', siOui);
      non.removeEventListener('click', siNon);
      boite.hidden = true;
      repondre(choix);
    };
    const siOui = choisir(true);
    const siNon = choisir(false);
    oui.addEventListener('click', siOui);
    non.addEventListener('click', siNon);
  });
}

demarrer();
