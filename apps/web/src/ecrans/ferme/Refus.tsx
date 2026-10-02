/**
 * Saisies refusées par le serveur (T10i), dans l'onglet Ferme : pour chaque refus, ce qui était
 * saisi, quand, pourquoi (le message du serveur, tel quel) et quoi faire. Contrat :
 * ./test/refus.ts.
 *
 * Ce que le téléphone sait d'un refus (table refus_synchro) : la table visée, l'opération, le code
 * du motif, le message en français écrit par le serveur, l'heure du refus et, depuis T10k, un
 * court résumé de la saisie calculé par le serveur (`RefusSynchro.saisie` : type d'événement,
 * culture, jour de la saisie, quantité et unité d'une récolte). Les données reçues elles-mêmes ne
 * descendent toujours pas (ni la note, ni le reste) : seul ce résumé descend. Sans résumé (serveur
 * d'avant T10k, autre table que le journal, écriture illisible), la carte montre le type de
 * saisie (« Événement du journal ») et la date du refus, comme en T10i ; un champ du résumé qui
 * manque ne s'affiche pas.
 *
 * Jamais à l'écran : le code du motif, le nom brut de la table, les identifiants. La ligne
 * récapitulative d'un envoi trop gros (table 'lot', T10f) a sa propre phrase : son message
 * serveur parle d'« écritures » et de « tables permises », du jargon.
 *
 * Les REFUS_PAR_PAGE plus récents d'abord, puis un bouton pour voir les suivants : 100 refus ne
 * ralentissent pas l'ouverture de l'onglet.
 */
import { useState, type CSSProperties } from 'react';
import type { RefusSynchro, ResumeSaisie } from '@planif/sync';
import { CARTE } from '../../ui/elements.tsx';

/** Refus montrés d'un coup, et ajoutés à chaque « voir plus ». */
export const REFUS_PAR_PAGE = 20;

/** Ce qui était saisi, selon la table visée (tables écrites depuis le téléphone, apps/api/src/sync/upload.ts). */
const TYPE_SAISIE: Readonly<Record<string, string>> = {
  evenement: 'Événement du journal',
  serie: 'Série de culture',
  occupation: 'Place d’une série',
  mouvement_stock: 'Mouvement de stock',
  article_stock: 'Article de stock',
  itineraire: 'Itinéraire',
  type_intervention: 'Type d’intervention',
};

/** Type d'événement d'un refus qui a un résumé (T10k), à la place de « Événement du journal ». */
const TYPE_EVENEMENT: Readonly<Record<string, string>> = {
  realise: 'Étape réalisée',
  recolte: 'Récolte',
  intervention: 'Intervention',
  irrigation: 'Irrigation',
  traitement: 'Traitement',
  observation: 'Observation',
};

/** Unité de récolte lisible : [singulier, pluriel]. */
const UNITE: Readonly<Record<string, readonly [string, string]>> = {
  kg: ['kg', 'kg'],
  botte: ['botte', 'bottes'],
  piece: ['pièce', 'pièces'],
  barquette: ['barquette', 'barquettes'],
};

const OPERATION: Readonly<Record<RefusSynchro['operation'], string>> = { PUT: 'ajout', PATCH: 'modification', DELETE: 'suppression' };

/** Quoi faire, selon le motif (codes stables d'apps/api/src/sync/upload.ts). */
const ACTION: Readonly<Record<string, string>> = {
  ferme_interdite:
    'Vérifiez que vous êtes toujours membre de cette ferme ; sinon, demandez au responsable de vous y inviter, puis refaites la saisie.',
  auteur_invalide: 'Vérifiez que vous êtes connecté avec votre propre compte, puis refaites la saisie.',
  ajout_seul: 'Retrouvez la saisie dans l’historique d’Aujourd’hui et corrigez-la ou annulez-la de là.',
  table_interdite: 'Rien n’a changé sur la ferme. Si ce changement est nécessaire, demandez au responsable de la ferme.',
  ecriture_invalide: 'Vérifiez ce qui a été saisi (quantité, date, culture) et refaites la saisie.',
  lot_trop_gros: 'Refaites cette saisie : elle est partie avec trop d’autres en une seule fois.',
  recolte_annulee: 'Si la récolte a bien eu lieu, saisissez-la de nouveau comme une nouvelle récolte.',
};

/**
 * Quoi faire, quand cela dépend aussi de la table : un mouvement de stock n'est pas dans
 * l'historique d'Aujourd'hui, il se corrige par un nouveau mouvement.
 */
const ACTION_PAR_TABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  mouvement_stock: {
    ajout_seul: 'Le stock se corrige par une nouvelle saisie, pas en modifiant l’ancienne : saisissez l’entrée ou la sortie qui rétablit la quantité.',
  },
};

/** Quoi faire pour un motif que l'appli ne connaît pas encore. */
const ACTION_GENERALE = 'Vérifiez cette saisie et refaites-la ; si le refus recommence, signalez-le.';

/** La ligne récapitulative d'un envoi trop gros (T10f) : pas une saisie, un envoi. */
const ENVOI_TROP_GROS = {
  titre: 'Envoi trop gros',
  message: 'Un envoi était trop gros pour le serveur : une partie des saisies de ce moment-là n’a pas été enregistrée.',
  action: 'Vérifiez vos saisies de ce jour-là dans l’historique d’Aujourd’hui et refaites celles qui manquent.',
};

let formatJour: Intl.DateTimeFormat | null = null;
let formatJourAnnee: Intl.DateTimeFormat | null = null;
let formatHeure: Intl.DateTimeFormat | null = null;

/** « 14 sept. à 09:12 » (heure du téléphone) ; l'année seulement si ce n'est pas l'année en cours. */
export function dateDuRefus(creeLe: string, maintenant = new Date()): string {
  const d = new Date(creeLe);
  if (Number.isNaN(d.getTime())) return '';
  const memeAnnee = d.getFullYear() === maintenant.getFullYear();
  const jour = memeAnnee
    ? (formatJour ??= new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }))
    : (formatJourAnnee ??= new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }));
  const heure = (formatHeure ??= new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  return `${jour.format(d)} à ${heure.format(d)}`;
}

let formatJourSaisie: Intl.DateTimeFormat | null = null;
let formatJourSaisieAnnee: Intl.DateTimeFormat | null = null;
let formatQuantite: Intl.NumberFormat | null = null;

/** Jour de la saisie 'AAAA-MM-JJ' : « 28 sept. » (l'année si ce n'est pas l'année en cours) ; '' si illisible. */
export function jourDeLaSaisie(date: string, maintenant = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return '';
  const format =
    d.getUTCFullYear() === maintenant.getFullYear()
      ? (formatJourSaisie ??= new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }))
      : (formatJourSaisieAnnee ??= new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
  return format.format(d);
}

/** « 12,5 kg », « 30 pièces », « 1 barquette » ; '' sans quantité lisible. */
export function quantiteSaisie(quantite: number | null, unite: string | null): string {
  if (quantite === null || !Number.isFinite(quantite)) return '';
  const nombre = (formatQuantite ??= new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 })).format(quantite);
  const formes = unite !== null && Object.hasOwn(UNITE, unite) ? UNITE[unite] : undefined;
  if (formes === undefined) return nombre;
  return `${nombre}\u00a0${Math.abs(quantite) >= 2 ? formes[1] : formes[0]}`;
}

/** Ce que l'écran dit d'un refus. */
export interface RefusLisible {
  readonly titre: string;
  readonly message: string;
  readonly action: string;
  /** T10k : la culture saisie, si le serveur l'a résumée. */
  readonly culture?: string;
  /** T10k : jour et quantité de la saisie (« Saisie du 28 sept. · 12,5 kg »), si connus. */
  readonly details?: string;
}

/** T10k : culture et détails lisibles du résumé ; rien de ce qui manque. */
function saisieLisible(s: ResumeSaisie, maintenant: Date): Pick<RefusLisible, 'culture' | 'details'> {
  const jour = s.date === null ? '' : jourDeLaSaisie(s.date, maintenant);
  const morceaux = [jour === '' ? '' : `Saisie du ${jour}`, quantiteSaisie(s.quantite, s.unite)].filter((m) => m !== '');
  const culture = s.culture?.trim() ?? '';
  return {
    ...(culture === '' ? {} : { culture }),
    ...(morceaux.length === 0 ? {} : { details: morceaux.join(' · ') }),
  };
}

export function refusLisible(r: RefusSynchro, maintenant = new Date()): RefusLisible {
  if (r.nomTable === 'lot') return ENVOI_TROP_GROS;
  const codeType = r.nomTable === 'evenement' ? r.saisie?.type : undefined;
  const typeEvenement = typeof codeType === 'string' && Object.hasOwn(TYPE_EVENEMENT, codeType) ? TYPE_EVENEMENT[codeType] : undefined;
  const type = typeEvenement ?? TYPE_SAISIE[r.nomTable] ?? 'Saisie';
  return {
    titre: `${type} · ${OPERATION[r.operation]}`,
    message: r.message,
    action: ACTION_PAR_TABLE[r.nomTable]?.[r.motif] ?? ACTION[r.motif] ?? ACTION_GENERALE,
    ...(r.saisie === undefined ? {} : saisieLisible(r.saisie, maintenant)),
  };
}

const TITRE_CARTE: CSSProperties = {
  padding: '12px 16px 6px',
  fontFamily: 'var(--police-texte)',
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--couleur-texte-orange)',
};

const REFUS: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 16px 16px 14px',
  borderTop: '1px solid var(--couleur-fond)',
  borderLeft: '6px solid var(--couleur-orange)',
  overflowWrap: 'anywhere',
};

const ENTETE_REFUS: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '2px 12px' };

/** T10k : ce qui avait été saisi, sous le titre. */
const SAISIE: CSSProperties = { fontSize: 16, lineHeight: 1.35, color: 'var(--couleur-secondaire)' };

const ACTION_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 4,
  padding: '10px 12px',
  borderRadius: 'var(--rayon-case)',
  background: 'var(--couleur-fond)',
  color: 'var(--couleur-encre)',
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 1.35,
};

const VOIR_PLUS: CSSProperties = {
  width: '100%',
  minHeight: 64,
  border: 0,
  borderTop: '1px solid var(--couleur-fond)',
  background: 'var(--couleur-surface)',
  color: 'var(--couleur-foret)',
  fontWeight: 700,
  fontSize: 17,
};

function UnRefus({ refus, maintenant }: { readonly refus: RefusSynchro; readonly maintenant: Date }) {
  const { titre, message, action, culture, details } = refusLisible(refus, maintenant);
  return (
    <li data-testid="refus" data-refus={refus.id} style={REFUS}>
      <div style={ENTETE_REFUS}>
        <strong style={{ fontSize: 17, color: 'var(--couleur-encre)' }}>{titre}</strong>{' '}
        <span style={{ fontFamily: 'var(--police-code)', fontSize: 13, color: 'var(--couleur-secondaire)' }}>
          {dateDuRefus(refus.creeLe, maintenant)}
        </span>
      </div>
      {(culture !== undefined || details !== undefined) && (
        <p data-testid="refus-saisie" style={SAISIE}>
          {culture !== undefined && <strong style={{ color: 'var(--couleur-encre)' }}>{culture}</strong>}
          {culture !== undefined && details !== undefined && ' · '}
          {details !== undefined && <span>{details}</span>}
        </p>
      )}
      {/* Espace (ignorée par la grille) : le texte de la carte, lu à la suite, garde ses mots séparés. */}{' '}
      <p style={{ fontSize: 16, lineHeight: 1.4, color: 'var(--couleur-encre)' }}>{message}</p>
      <p data-testid="refus-action" style={ACTION_STYLE}>
        <span aria-hidden="true" style={{ color: 'var(--couleur-foret)' }}>
          →
        </span>
        <span>{action}</span>
      </p>
    </li>
  );
}

/** « Voir les 20 suivants (encore 80) », « Voir les 3 derniers », « Voir le dernier ». */
function libelleVoirPlus(restants: number): string {
  if (restants === 1) return 'Voir le dernier refus';
  if (restants <= REFUS_PAR_PAGE) return `Voir les ${String(restants)} derniers refus`;
  return `Voir les ${String(REFUS_PAR_PAGE)} suivants (encore ${String(restants)})`;
}

/** Carte « Saisies refusées » ; rien si aucun refus. */
export function SaisiesRefusees({ refus }: { readonly refus: readonly RefusSynchro[] }) {
  const [montres, setMontres] = useState(REFUS_PAR_PAGE);
  if (refus.length === 0) return null;
  const maintenant = new Date();
  const restants = refus.length - montres;
  const titre = refus.length === 1 ? '1 saisie refusée' : `${String(refus.length)} saisies refusées`;
  return (
    <section aria-label="Saisies refusées par le serveur" style={CARTE}>
      <h2 style={TITRE_CARTE}>{titre}</h2>
      <p style={{ padding: '0 16px 12px', fontSize: 15, color: 'var(--couleur-secondaire)' }}>
        Le serveur n’a pas enregistré ces saisies. Les autres sont parties normalement.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {refus.slice(0, montres).map((r) => (
          <UnRefus key={r.id} refus={r} maintenant={maintenant} />
        ))}
      </ul>
      {restants > 0 && (
        <button
          type="button"
          className="ligne-carte"
          style={VOIR_PLUS}
          onClick={() => {
            setMontres((n) => n + REFUS_PAR_PAGE);
          }}
        >
          {libelleVoirPlus(restants)}
        </button>
      )}
    </section>
  );
}
