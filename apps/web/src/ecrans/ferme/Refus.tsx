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
 *
 * T10l : « Archiver » sur chaque carte (nom accessible : titre et date de la carte), « Tout
 * archiver (N) » après la liste, dès deux refus affichés, pour ceux-là seulement (pas ceux encore
 * cachés derrière « voir plus »). Sans confirmation : archiver ne supprime rien, la ligne reste
 * sur le téléphone et le serveur ; elle sort seulement de la liste (porte.surveillerRefus), sur
 * tous les téléphones de l'utilisateur.
 *
 * T10n : un tap de travers ne fait rien perdre de vue. « Archiver » et « Tout archiver » cachent
 * les refus tout de suite, mais rien n'est écrit tant qu'on peut annuler : un bandeau « N refus
 * archivés — Annuler » reste DELAI_ANNULATION_ARCHIVAGE_MS ; un second archivage le rejoint et
 * repousse le délai. À la fin du délai, un seul appel à `archiver` avec tous les ids. Quitter
 * l'écran (démontage), fermer la page (pagehide) ou passer en arrière-plan (visibilitychange
 * hidden) écrit tout de suite ce qui attend, une seule fois : rien n'est perdu. Aucune règle
 * serveur nouvelle.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { RefusSynchro, ResumeSaisie } from '@planif/sync';
import { CARTE } from '../../ui/elements.tsx';
import './refus.css';

/** Refus montrés d'un coup, et ajoutés à chaque « voir plus ». */
export const REFUS_PAR_PAGE = 20;

/** T10n : durée du bandeau « Annuler » après un archivage ; rien n'est écrit avant. */
export const DELAI_ANNULATION_ARCHIVAGE_MS = 5_000;

/** Ce qui était saisi, selon la table visée (tables écrites depuis le téléphone, apps/api/src/sync/upload.ts). */
const TYPE_SAISIE: Readonly<Record<string, string>> = {
  evenement: 'Événement du journal',
  serie: 'Série de culture',
  occupation: 'Place d’une série',
  mouvement_stock: 'Mouvement de stock',
  article_stock: 'Article de stock',
  itineraire: 'Itinéraire',
  type_intervention: 'Type d’intervention',
  refus_synchro: 'Archivage d’un refus',
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

/**
 * T10l : le refus d'un archivage (table refus_synchro). Rien n'a changé sur la ferme et personne
 * d'autre n'y peut rien : seul ce message reste à archiver.
 */
const ACTION_ARCHIVAGE = 'Ce refus n’a pas pu être archivé ; rien n’a changé sur la ferme. Vous pouvez archiver ce message.';

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
    action: r.nomTable === 'refus_synchro' ? ACTION_ARCHIVAGE : (ACTION_PAR_TABLE[r.nomTable]?.[r.motif] ?? ACTION[r.motif] ?? ACTION_GENERALE),
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

/** T10l : « Archiver » d'une carte, discret mais assez grand pour un doigt ganté (56 px). */
const ARCHIVER: CSSProperties = {
  justifySelf: 'end',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 56,
  marginTop: 4,
  padding: '0 18px',
  border: '2px solid var(--couleur-foret)',
  borderRadius: 'var(--rayon-bouton)',
  background: 'var(--couleur-surface)',
  color: 'var(--couleur-foret)',
  fontWeight: 700,
  fontSize: 16,
};

/** T10l : « Tout archiver (N) », après la liste, en bouton secondaire (contour) sur toute la largeur. */
const TOUT_ARCHIVER: CSSProperties = {
  ...ARCHIVER,
  justifyContent: 'center',
  width: 'calc(100% - 32px)',
  margin: '12px 16px 16px',
  fontSize: 17,
};

/** Boîte d'archive (trait), sans texte : le libellé du bouton reste « Archiver ». */
function IconeArchive() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

function UnRefus({
  refus,
  maintenant,
  archiver,
}: {
  readonly refus: RefusSynchro;
  readonly maintenant: Date;
  readonly archiver: (() => void) | undefined;
}) {
  const { titre, message, action, culture, details } = refusLisible(refus, maintenant);
  const date = dateDuRefus(refus.creeLe, maintenant);
  return (
    <li data-testid="refus" data-refus={refus.id} style={REFUS}>
      <div style={ENTETE_REFUS}>
        <strong style={{ fontSize: 17, color: 'var(--couleur-encre)' }}>{titre}</strong>{' '}
        <span style={{ fontFamily: 'var(--police-code)', fontSize: 13, color: 'var(--couleur-secondaire)' }}>
          {date}
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
      {archiver !== undefined && (
        <button type="button" data-testid="refus-archiver" aria-label={`Archiver : ${titre}${date === '' ? '' : `, ${date}`}`} style={ARCHIVER} onClick={archiver}>
          <IconeArchive />
          Archiver
        </button>
      )}
    </li>
  );
}

/** « Voir les 20 suivants (encore 80) », « Voir les 3 derniers », « Voir le dernier ». */
function libelleVoirPlus(restants: number): string {
  if (restants === 1) return 'Voir le dernier refus';
  if (restants <= REFUS_PAR_PAGE) return `Voir les ${String(restants)} derniers refus`;
  return `Voir les ${String(REFUS_PAR_PAGE)} suivants (encore ${String(restants)})`;
}

/** T10n : « 1 refus archivé », « 3 refus archivés ». */
function libelleArchives(n: number): string {
  return n === 1 ? '1 refus archivé' : `${String(n)} refus archivés`;
}

/**
 * T10n : archivages en attente d'écriture. `archiverPlusTard` cache les ids et (re)lance le délai ;
 * `annuler` les rend ; `ecrireMaintenant` envoie tout ce qui attend encore dans la liste, une seule
 * fois. Les ids envoyés restent cachés jusqu'à ce que la liste ne les contienne plus
 * (porte.surveillerRefus), ou reviennent si l'écriture échoue. Un id en attente qui sort de la
 * liste (archivé ailleurs, par la synchro) est oublié : il ne compte plus et n'est pas réécrit.
 * Plus de porte (`archiver` absente) pendant le délai : l'attente est abandonnée sans écrire, et
 * `surEchec` le dit ; rien ne part en douce quand la porte revient.
 */
function useArchivageDiffere(
  refus: readonly RefusSynchro[],
  archiver: ((ids: readonly string[]) => Promise<void>) | undefined,
  surEchec: () => void,
) {
  const [enAttente, setEnAttente] = useState<readonly string[]>([]);
  const [envoyes, setEnvoyes] = useState<ReadonlySet<string>>(() => new Set());
  const attente = useRef<readonly string[]>([]);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Écritures parties et pas encore terminées : la déconnexion les attend. */
  const enCours = useRef(new Set<Promise<void>>());
  // Derniers refus et fonctions reçus : l'écriture au démontage ou sur pagehide part avec eux.
  const derniers = useRef({ refus, archiver, surEchec });
  useEffect(() => {
    derniers.current = { refus, archiver, surEchec };
  });

  const arreterMinuteur = useCallback(() => {
    if (minuteur.current !== null) {
      clearTimeout(minuteur.current);
      minuteur.current = null;
    }
  }, []);

  const vider = useCallback((): readonly string[] => {
    arreterMinuteur();
    const ids = attente.current;
    attente.current = [];
    if (ids.length > 0) setEnAttente([]);
    return ids;
  }, [arreterMinuteur]);

  const ecrireMaintenant = useCallback((): void => {
    const presents = new Set(derniers.current.refus.map((r) => r.id));
    const ids = vider().filter((id) => presents.has(id));
    if (ids.length === 0) return;
    const { archiver: ecrire, surEchec: echec } = derniers.current;
    if (ecrire === undefined) {
      echec();
      return;
    }
    setEnvoyes((avant) => new Set([...avant, ...ids]));
    const ecriture = ecrire(ids).catch((erreur: unknown) => {
      console.error('archivage des refus en échec', erreur);
      setEnvoyes((avant) => new Set([...avant].filter((id) => !ids.includes(id))));
      echec();
    });
    enCours.current.add(ecriture);
    void ecriture.finally(() => enCours.current.delete(ecriture));
  }, [vider]);

  /** Écrit ce qui attend et résout quand toutes les écritures parties sont terminées (déconnexion). */
  const ecrireEtAttendre = useCallback(async (): Promise<void> => {
    ecrireMaintenant();
    await Promise.all([...enCours.current]);
  }, [ecrireMaintenant]);

  // Démontage, page fermée ou appli en arrière-plan : ce qui attend part tout de suite.
  useEffect(() => {
    const surVisibilite = () => {
      if (document.visibilityState === 'hidden') ecrireMaintenant();
    };
    window.addEventListener('pagehide', ecrireMaintenant);
    document.addEventListener('visibilitychange', surVisibilite);
    return () => {
      window.removeEventListener('pagehide', ecrireMaintenant);
      document.removeEventListener('visibilitychange', surVisibilite);
      ecrireMaintenant();
    };
  }, [ecrireMaintenant]);

  // Plus de porte pendant le délai : on abandonne, sans écrire, en le disant.
  const sansPorte = archiver === undefined;
  useEffect(() => {
    if (sansPorte && vider().length > 0) surEchec();
  }, [sansPorte, vider, surEchec]);

  // Liste changée (synchro) : on oublie les ids qui n'y sont plus.
  useEffect(() => {
    const presents = new Set(refus.map((r) => r.id));
    if (attente.current.some((id) => !presents.has(id))) {
      attente.current = attente.current.filter((id) => presents.has(id));
      setEnAttente(attente.current);
      if (attente.current.length === 0) arreterMinuteur();
    }
    setEnvoyes((avant) => ([...avant].every((id) => presents.has(id)) ? avant : new Set([...avant].filter((id) => presents.has(id)))));
  }, [refus, arreterMinuteur]);

  function archiverPlusTard(ids: readonly string[]): void {
    const nouveaux = ids.filter((id) => !attente.current.includes(id));
    attente.current = [...attente.current, ...nouveaux];
    setEnAttente(attente.current);
    arreterMinuteur();
    minuteur.current = setTimeout(ecrireMaintenant, DELAI_ANNULATION_ARCHIVAGE_MS);
  }

  function annuler(): void {
    vider();
  }

  return { enAttente, envoyes, archiverPlusTard, annuler, ecrireEtAttendre };
}

/** T10n : « Annuler » du bandeau, 56 px pour un doigt ganté (en ligne : la hauteur se vérifie sans feuille de style). */
const ANNULER: CSSProperties = {
  flexShrink: 0,
  minWidth: 96,
  minHeight: 56,
  padding: '0 16px',
  border: 0,
  borderRadius: 'var(--rayon-case)',
  background: 'var(--couleur-surface)',
  color: 'var(--couleur-foret)',
  fontWeight: 700,
  fontSize: 17,
};

/**
 * T10n : bandeau « N refus archivés — Annuler », en bas de l'écran, au-dessus des onglets. Il
 * s'affiche dans la zone d'annonce (role="status"), toujours présente, vide hors attente : un
 * lecteur d'écran n'annonce que ce qui arrive dans une zone déjà là.
 */
function BandeauAnnulation({ nombre, surAnnuler, numero }: { readonly nombre: number; readonly surAnnuler: () => void; readonly numero: number }) {
  return (
    <div className="refus-bandeau">
      <span className="refus-bandeau-icone">
        <IconeArchive />
      </span>
      <span className="refus-bandeau-texte">
        <strong>{libelleArchives(nombre)}</strong>
        <span>Ils sortent de la liste ; rien n’est perdu.</span>
      </span>
      <button type="button" data-testid="refus-annuler" style={ANNULER} aria-label={`Annuler l’archivage de ${String(nombre)} refus`} onClick={surAnnuler}>
        Annuler
      </button>
      {/* Repart à chaque archivage : le délai a été repoussé. */}
      <span key={numero} aria-hidden="true" className="refus-bandeau-temps" />
    </div>
  );
}

/** T10n : écrit l'archivage en attente et résout quand il est terminé (déconnexion). */
export type VidangeArchivage = () => Promise<void>;

/**
 * Carte « Saisies refusées » ; pas de carte si aucun refus affiché, seulement la zone d'annonce du
 * bandeau (vide hors attente). `archiver` (T10l, porte.archiverRefus) : sans elle, pas de bouton
 * d'archivage. `vidangeRef` (T10n) : reçoit, tant que la carte est là, de quoi écrire et attendre
 * l'archivage en attente (« Se déconnecter » l'appelle avant de fermer la base).
 */
export function SaisiesRefusees({
  refus,
  archiver,
  vidangeRef,
}: {
  readonly refus: readonly RefusSynchro[];
  readonly archiver?: ((ids: readonly string[]) => Promise<void>) | undefined;
  readonly vidangeRef?: RefObject<VidangeArchivage | null> | undefined;
}) {
  const [montres, setMontres] = useState(REFUS_PAR_PAGE);
  const [echec, setEchec] = useState(false);
  const [numeroArchivage, setNumeroArchivage] = useState(0);
  const signalerEchec = useCallback(() => {
    setEchec(true);
  }, []);
  const { enAttente, envoyes, archiverPlusTard, annuler, ecrireEtAttendre } = useArchivageDiffere(refus, archiver, signalerEchec);
  useEffect(() => {
    if (vidangeRef === undefined) return undefined;
    vidangeRef.current = ecrireEtAttendre;
    return () => {
      if (vidangeRef.current === ecrireEtAttendre) vidangeRef.current = null;
    };
  }, [vidangeRef, ecrireEtAttendre]);
  const caches = enAttente.length === 0 && envoyes.size === 0 ? null : new Set([...enAttente, ...envoyes]);
  const visibles = caches === null ? refus : refus.filter((r) => !caches.has(r.id));
  // Seuls comptent les refus en attente encore dans la liste (un autre a pu être archivé ailleurs).
  const enAttenteListes = enAttente.length === 0 ? 0 : refus.filter((r) => enAttente.includes(r.id)).length;
  // Zone d'annonce à une seule place de l'arbre : le même nœud, que la carte soit là ou non.
  const zone = (
    <div data-testid="refus-annulation" role="status">
      {enAttenteListes > 0 && (
        <BandeauAnnulation
          nombre={enAttenteListes}
          numero={numeroArchivage}
          surAnnuler={() => {
            annuler();
          }}
        />
      )}
    </div>
  );
  if (visibles.length === 0) {
    return (
      <>
        {/* Place de la carte, vide : la zone garde sa position dans l'arbre, donc son nœud. */}
        {null}
        {zone}
      </>
    );
  }
  const maintenant = new Date();
  const restants = visibles.length - montres;
  const affiches = visibles.slice(0, montres);
  const lancer =
    archiver === undefined
      ? undefined
      : (ids: readonly string[]) => () => {
          setEchec(false);
          setNumeroArchivage((n) => n + 1);
          archiverPlusTard(ids);
        };
  const titre = visibles.length === 1 ? '1 saisie refusée' : `${String(visibles.length)} saisies refusées`;
  return (
    <>
      <section aria-label="Saisies refusées par le serveur" style={CARTE}>
        <h2 style={TITRE_CARTE}>{titre}</h2>
        <p style={{ padding: '0 16px 12px', fontSize: 15, color: 'var(--couleur-secondaire)' }}>
          Le serveur n’a pas enregistré ces saisies. Les autres sont parties normalement.
        </p>
        {echec && (
          <p role="alert" style={{ padding: '0 16px 12px', fontSize: 15, fontWeight: 700, color: 'var(--couleur-texte-orange)' }}>
            L’archivage n’a pas abouti. Réessayez.
          </p>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {affiches.map((r) => (
            <UnRefus key={r.id} refus={r} maintenant={maintenant} archiver={lancer?.([r.id])} />
          ))}
        </ul>
        {/* Seulement à partir de deux refus affichés : pour un seul, « Archiver » suffit. */}
        {lancer !== undefined && affiches.length >= 2 && (
          <button type="button" data-testid="refus-tout-archiver" style={TOUT_ARCHIVER} onClick={lancer(affiches.map((r) => r.id))}>
            <IconeArchive />
            {`Tout archiver (${String(affiches.length)})`}
          </button>
        )}
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
      {zone}
    </>
  );
}
