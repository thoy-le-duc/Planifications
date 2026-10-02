/**
 * Saisies refusées par le serveur (T10i), dans l'onglet Ferme : pour chaque refus, ce qui était
 * saisi, quand, pourquoi (le message du serveur, tel quel) et quoi faire. Contrat :
 * ./test/refus.ts.
 *
 * Ce que le téléphone sait d'un refus (table refus_synchro) : la table visée, l'opération, le code
 * du motif, le message en français écrit par le serveur et l'heure du refus. Les données de la
 * saisie refusée ne descendent pas : ni la culture ni la date de la saisie ne sont lisibles, d'où
 * un type de saisie (« Événement du journal ») et la date du refus.
 *
 * Jamais à l'écran : le code du motif, le nom brut de la table, les identifiants. La ligne
 * récapitulative d'un envoi trop gros (table 'lot', T10f) a sa propre phrase : son message
 * serveur parle d'« écritures » et de « tables permises », du jargon.
 *
 * Les REFUS_PAR_PAGE plus récents d'abord, puis un bouton pour voir les suivants : 100 refus ne
 * ralentissent pas l'ouverture de l'onglet.
 */
import { useState, type CSSProperties } from 'react';
import type { RefusSynchro } from '@planif/sync';
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

/** Ce que l'écran dit d'un refus. */
export interface RefusLisible {
  readonly titre: string;
  readonly message: string;
  readonly action: string;
}

export function refusLisible(r: RefusSynchro): RefusLisible {
  if (r.nomTable === 'lot') return ENVOI_TROP_GROS;
  const type = TYPE_SAISIE[r.nomTable] ?? 'Saisie';
  return {
    titre: `${type} · ${OPERATION[r.operation]}`,
    message: r.message,
    action: ACTION[r.motif] ?? ACTION_GENERALE,
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
  const { titre, message, action } = refusLisible(refus);
  return (
    <li data-testid="refus" data-refus={refus.id} style={REFUS}>
      <div style={ENTETE_REFUS}>
        <strong style={{ fontSize: 17, color: 'var(--couleur-encre)' }}>{titre}</strong>{' '}
        <span style={{ fontFamily: 'var(--police-code)', fontSize: 13, color: 'var(--couleur-secondaire)' }}>
          {dateDuRefus(refus.creeLe, maintenant)}
        </span>
      </div>
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
