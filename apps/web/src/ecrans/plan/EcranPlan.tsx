/**
 * Écran « Planches » (T11, maquette Plan) : toutes les planches en lignes, les semaines en
 * colonnes, chaque culture en barre, les conflits de T03 en évidence. Lecture seule : toucher une
 * barre ouvre le détail. Contrat : ./test/contrat.ts (section « Écran (DOM) »).
 *
 * Chargé à la demande par App ; reçoit la porte (jamais PowerSync). Seules les lignes visibles
 * (plus une marge) sont dans le DOM : le défilement reste fluide sur 400 planches.
 */
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as EvenementPointeur,
  type ReactNode,
} from 'react';
import type { PorteDonnees } from '@planif/sync';
import type { DepartSerie, SaisieSerieAnnulable } from '../serie/index.ts';
import { chargerVue3d, MARQUE_MODULE_3D, webglDisponible } from '../plan3d/entree.ts';
import type { ProprietesVue3d } from '../plan3d/index.ts';
import type { EditeurPlacementCharge } from '../ferme/EcranFerme.tsx';
import './plan.css';
import { obtenirDebutDePlan, obtenirPlan, obtenirSaisons, planEnCache, saisonsEnCache, surChangement, type PlanLu } from './cache.ts';
import {
  fenetreVisible,
  HAUTEUR_LIGNE_PX,
  LARGEUR_ETIQUETTE_PX,
  LARGEUR_SEMAINE_PX,
  LIBELLES_COURTS_CONFLITS,
  saisonParDefaut,
  type BarrePlan,
  type ConflitPlan,
  type LigneEmplacementPlan,
  type LignePlan,
  type SaisonPlan,
  type SemainePlan,
  type SorteConflit,
} from './calculs.ts';

export interface ProprietesEcranPlan {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Jour affiché comme « aujourd'hui », 'AAAA-MM-JJ' ; par défaut, celui du téléphone. */
  readonly aujourdhui?: () => string;
  /** T28f : l'utilisateur de la session ; sans lui, la vue 3D ne propose pas « Modifier le plan ». */
  readonly utilisateurId?: string;
}

/**
 * Formulaire d'une série (T12), chargé à la demande : ni dans le JavaScript de démarrage, ni
 * dans le morceau de cet écran.
 */
const chargerFormulaire = () => import('../serie/index.ts');
const FormulaireSerie = lazy(chargerFormulaire);

/** Appui long sur une case vide (T12) : durée, et déplacement toléré du doigt. */
const DELAI_APPUI_LONG_MS = 500;
const TOLERANCE_APPUI_PX = 10;
/** Durée du bandeau « Annuler » après l'enregistrement d'une série (comme T13). */
const DELAI_ANNULATION_MS = 10_000;

/** Vue 3D (T27) : messages du repli sur la 2D. */
const REPLI_SANS_WEBGL = 'La vue 3D n’est pas disponible sur cet appareil (WebGL absent ou désactivé) : le plan reste en 2D.';
const REPLI_CHARGEMENT = 'La vue 3D n’a pas pu se charger : le plan reste en 2D. Réessayez plus tard.';

/** Vue 3D : fermée, en cours de chargement (module), ou ouverte. */
type EtatVue3d = { readonly sorte: 'fermee' } | { readonly sorte: 'chargement' } | { readonly sorte: 'ouverte'; readonly Vue: ComponentType<ProprietesVue3d> };

/** Marque de performance posée quand les premières lignes sont dessinées (e2e/plan.e2e.ts). */
export const MARQUE_PLAN_AFFICHE = 'planif:plan-affiche';

/** Largeur d'une semaine et de la colonne des codes, en px (calculs.ts, partagées avec T12). */
const LARGEUR_SEMAINE = LARGEUR_SEMAINE_PX;
const LARGEUR_ETIQUETTE = LARGEUR_ETIQUETTE_PX;
const HAUTEUR_ENTETE = 28;
const PX_PAR_JOUR = LARGEUR_SEMAINE / 7;
/** En deçà (px), la marge intérieure de la barre (plan.css) la ferait plus large que ses dates. */
const LARGEUR_BARRE_ETROITE = 24;
/** Lignes dessinées au-delà de la vue, de chaque côté. */
const MARGE_LIGNES = 5;

const deux = (n: number) => String(n).padStart(2, '0');

/** Jour du téléphone, 'AAAA-MM-JJ' (heure locale, pas UTC). */
export function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** '2026-04-08' → '8 avril 2026', sans objet Date. */
function dateLisible(date: string): string {
  const [a, m, j] = date.split('-');
  return `${String(Number(j))} ${MOIS[Number(m) - 1] ?? ''} ${a ?? ''}`;
}

/** Hauteur de la vue : celle du conteneur, ou de la fenêtre si la mise en page n'est pas calculée. */
function hauteurVue(el: HTMLElement | null): number {
  const h = el?.clientHeight ?? 0;
  return h > 0 ? h : window.innerHeight;
}

function fenetre(el: HTMLElement | null, total: number): { debut: number; fin: number } {
  return fenetreVisible({
    defilement: Math.max(0, (el?.scrollTop ?? 0) - HAUTEUR_ENTETE),
    hauteurVue: hauteurVue(el),
    hauteurLigne: HAUTEUR_LIGNE_PX,
    total,
    marge: MARGE_LIGNES,
  });
}

// ── Lignes et barres ─────────────────────────────────────────────────────────────────────────

interface ProprietesLigne {
  readonly ligne: LignePlan;
  readonly index: number;
  readonly surBarre: (ligne: LigneEmplacementPlan, barre: BarrePlan) => void;
  readonly surConflits: (ligne: LigneEmplacementPlan) => void;
}

/** Sortes distinctes des conflits, dans l'ordre de leur première apparition. */
function sortesDe(conflits: readonly ConflitPlan[]): SorteConflit[] {
  const sortes: SorteConflit[] = [];
  for (const c of conflits) if (!sortes.includes(c.sorte)) sortes.push(c.sorte);
  return sortes;
}

function Barre({ ligne, barre, surBarre }: { readonly ligne: LigneEmplacementPlan; readonly barre: BarrePlan; readonly surBarre: ProprietesLigne['surBarre'] }) {
  const largeur = Math.max(PX_PAR_JOUR, (barre.finJour - barre.debutJour) * PX_PAR_JOUR);
  const style: CSSProperties = { left: LARGEUR_ETIQUETTE + barre.debutJour * PX_PAR_JOUR, width: largeur };
  const etat = barre.etat === 'reel' ? 'en place' : 'prévu';
  // Barre étroite : sans marge intérieure, sa largeur dessinée reste celle de ses dates.
  const etroite = largeur < LARGEUR_BARRE_ETROITE;
  return (
    <button
      type="button"
      data-testid="barre"
      data-occupation={barre.occupationId}
      data-etat={barre.etat}
      data-famille={barre.cleFamille ?? ''}
      data-conflit={barre.enConflit ? 'oui' : undefined}
      className={`barre barre-${barre.etat} famille-${barre.cleFamille ?? 'neutre'}${barre.enConflit ? ' barre-conflit' : ''}${etroite ? ' barre-etroite' : ''}`}
      style={style}
      aria-label={`${barre.libelle}, ${etat}${barre.enConflit ? ', en conflit' : ''}`}
      onClick={() => {
        surBarre(ligne, barre);
      }}
    >
      <span>{barre.libelle}</span>
    </button>
  );
}

const Ligne = memo(function Ligne({ ligne, index, surBarre, surConflits }: ProprietesLigne) {
  const style: CSSProperties = { transform: `translateY(${String(HAUTEUR_ENTETE + index * HAUTEUR_LIGNE_PX)}px)` };
  if (ligne.sorte !== 'emplacement') {
    return (
      <div data-testid="ligne-plan" data-sorte={ligne.sorte} data-id={ligne.id} tabIndex={-1} className={`plan-ligne plan-ligne-${ligne.sorte}`} style={style}>
        <span className="plan-etiquette plan-etiquette-zone">{ligne.nom}</span>
      </div>
    );
  }
  const sortes = sortesDe(ligne.conflits);
  const enConflit = sortes.length > 0;
  const classe = `plan-ligne${enConflit ? ' plan-ligne-conflit' : ''}`;
  // T11b : plus de deux sortes, un seul libellé (« Chevauche +2 ») : l'étiquette tient dans sa ligne.
  const libelles: readonly (readonly [SorteConflit, string])[] =
    sortes.length > 2 && sortes[0] !== undefined
      ? [[sortes[0], `${LIBELLES_COURTS_CONFLITS[sortes[0]]} +${String(sortes.length - 1)}`]]
      : sortes.map((s) => [s, LIBELLES_COURTS_CONFLITS[s]] as const);
  return (
    // tabIndex -1 : la ligne reçoit le focus rendu quand sa barre a disparu (T11b).
    <div data-testid="ligne-plan" data-sorte="emplacement" data-id={ligne.id} data-conflit={enConflit ? 'oui' : undefined} tabIndex={-1} className={classe} style={style}>
      {enConflit ? (
        <button
          type="button"
          data-testid="etiquette-conflit"
          aria-haspopup="dialog"
          className="plan-etiquette plan-etiquette-conflit"
          onClick={() => {
            surConflits(ligne);
          }}
        >
          <span className="plan-code">{ligne.code}</span>
          <span className="plan-conflits">
            {libelles.map(([s, texte]) => (
              <span key={s} data-testid="conflit" data-sorte={s} className="plan-conflit">
                {texte}
              </span>
            ))}
          </span>
        </button>
      ) : (
        <span className="plan-etiquette">
          <span className="plan-code">{ligne.code}</span>
        </span>
      )}
      {ligne.barres.map((b) => (
        <Barre key={b.occupationId} ligne={ligne} barre={b} surBarre={surBarre} />
      ))}
    </div>
  );
});

// ── Feuilles de détail (lecture seule) ───────────────────────────────────────────────────────

type Detail =
  | { readonly sorte: 'serie'; readonly ligne: LigneEmplacementPlan; readonly barre: BarrePlan }
  | { readonly sorte: 'conflits'; readonly ligne: LigneEmplacementPlan };

/**
 * T11b : ce qui a ouvert la feuille, noté au toucher (jamais lu dans document.activeElement : un
 * tap ne focalise pas le bouton sous Safari). Retrouvé par son identité à la fermeture : la
 * virtualisation a pu retirer la ligne puis en dessiner une nouvelle.
 */
interface OrigineFeuille {
  readonly ligneId: string;
  readonly occupationId: string | null;
}

/** Élément qui reçoit le focus à la fermeture : la barre ou l'étiquette, sinon la ligne, sinon la grille. */
function cibleDuFocus(grille: HTMLElement, origine: OrigineFeuille): HTMLElement {
  const ligne = [...grille.querySelectorAll<HTMLElement>('[data-testid="ligne-plan"]')].find((l) => l.dataset.id === origine.ligneId);
  if (ligne === undefined) return grille;
  const cible =
    origine.occupationId === null
      ? ligne.querySelector<HTMLElement>('[data-testid="etiquette-conflit"]')
      : [...ligne.querySelectorAll<HTMLElement>('[data-testid="barre"]')].find((b) => b.dataset.occupation === origine.occupationId);
  return cible ?? ligne;
}

const cleConflit = (c: ConflitPlan) => `${c.sorte}-${c.du}-${c.occupations.join('-')}`;

/** Feuille en bas de l'écran : titre, contenu, un seul bouton « Fermer » (Échap ferme aussi). */
function Feuille({ titre, surFermer, actions, children }: { readonly titre: string; readonly surFermer: () => void; readonly actions?: ReactNode; readonly children: ReactNode }) {
  const idTitre = useId();
  const fermer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fermer.current?.focus();
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermer();
    };
    addEventListener('keydown', touche);
    return () => {
      removeEventListener('keydown', touche);
    };
  }, [surFermer]);
  return (
    <div className="plan-voile">
      <div role="dialog" aria-modal="true" aria-labelledby={idTitre} className="plan-detail">
        <h2 id={idTitre}>{titre}</h2>
        {children}
        {actions}
        <button ref={fermer} type="button" className="plan-fermer" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </div>
  );
}

interface ProprietesDetailSerie {
  readonly ligne: LigneEmplacementPlan;
  readonly barre: BarrePlan;
  readonly surFermer: () => void;
  readonly surModifier: (serieId: string) => void;
}

/**
 * Détail d'une barre. Une série se modifie (T12, « Modifier la série ») ; une plantation ou une
 * couverture reste en lecture seule (le serveur refuse de les modifier depuis le téléphone).
 */
function DetailSerie({ ligne, barre, surFermer, surModifier }: ProprietesDetailSerie) {
  const conflits = ligne.conflits.filter((c) => c.occupations.includes(barre.occupationId));
  const nature = barre.serieId !== null ? 'Série' : barre.plantationId !== null ? 'Plantation' : 'Couverture';
  const serieId = barre.serieId;
  const actions =
    serieId === null ? undefined : (
      <button
        type="button"
        className="plan-modifier"
        onClick={() => {
          surModifier(serieId);
        }}
      >
        Modifier la série
      </button>
    );
  return (
    <Feuille titre="Détail de la série" surFermer={surFermer} actions={actions}>
      <p className="plan-detail-culture">{barre.libelle}</p>
      <dl>
        <dt>Emplacement</dt>
        <dd className="plan-code">{ligne.code}</dd>
        <dt>{nature}</dt>
        <dd>{barre.famille ?? 'Famille non renseignée'}</dd>
        <dt>{barre.etat === 'reel' ? 'En place' : 'Prévu'}</dt>
        <dd>
          du {dateLisible(barre.du)}
          {barre.au === null ? ', sans fin' : ` au ${dateLisible(barre.au)}`}
        </dd>
      </dl>
      {conflits.length > 0 && (
        <ul className="plan-detail-conflits">
          {conflits.map((c) => (
            <li key={cleConflit(c)}>{c.nom}</li>
          ))}
        </ul>
      )}
    </Feuille>
  );
}

/** Tous les conflits d'une planche, noms longs (cultures en cause), dans l'ordre de T03. */
function DetailConflits({ ligne, surFermer }: { readonly ligne: LigneEmplacementPlan; readonly surFermer: () => void }) {
  const n = ligne.conflits.length;
  return (
    <Feuille titre={`Conflits de ${ligne.code}`} surFermer={surFermer}>
      <p className="plan-detail-culture">
        {String(n)} conflit{n > 1 ? 's' : ''} sur cette planche
      </p>
      <ul className="plan-detail-conflits">
        {ligne.conflits.map((c) => (
          <li key={cleConflit(c)}>{c.nom}</li>
        ))}
      </ul>
    </Feuille>
  );
}

// ── Écran ────────────────────────────────────────────────────────────────────────────────────

/** T28i : build de la démo en ligne (constante du build, éliminée en production) : l'éditeur et la 3D y invitent à essayer. */
const DEMO = import.meta.env.MODE === 'demo';

const AUCUNE_SEMAINE: readonly SemainePlan[] = [];

const LEGENDE: readonly (readonly [string, string])[] = [
  ['salades', 'Salades'],
  ['solanacees', 'Solanacées'],
  ['cruciferes', 'Crucifères et feuilles'],
  ['racines', 'Racines'],
  ['neutre', 'Autres'],
];

/** En-tête des semaines : redessiné seulement quand la saison change, pas au défilement. */
const EnteteSemaines = memo(function EnteteSemaines({
  semaines,
  courante,
  largeur,
}: {
  readonly semaines: readonly SemainePlan[];
  readonly courante: number | null;
  readonly largeur: number;
}) {
  return (
    <div className="plan-semaines" style={{ width: largeur }}>
      <span className="plan-coin" />
      {semaines.map((s, i) => (
        <span key={s.lundi} data-testid="semaine" data-courante={i === courante ? 'oui' : undefined} className="plan-semaine">
          {s.libelle}
        </span>
      ))}
    </div>
  );
});

const Legende = memo(function Legende() {
  return (
    <ul className="plan-legende" aria-label="Légende">
      {LEGENDE.map(([cle, nom]) => (
        <li key={cle}>
          <i className={`famille-${cle}`} />
          {nom}
        </li>
      ))}
      <li>
        <i className="plan-legende-prevu" />
        Prévu
      </li>
    </ul>
  );
});

export function EcranPlan({ porte, fermeId, aujourdhui = jourDuTelephone, utilisateurId }: ProprietesEcranPlan) {
  const [jour] = useState(aujourdhui);
  const [version, setVersion] = useState(0);
  const [saisons, setSaisons] = useState<SaisonPlan[] | null>(() => saisonsEnCache(porte, fermeId));
  const [saisonId, setSaisonId] = useState<string | null>(() => (saisons === null ? null : (saisonParDefaut(saisons, jour)?.id ?? null)));
  const saison = saisons?.find((s) => s.id === saisonId) ?? null;
  const [lu, setLu] = useState<PlanLu | null>(() => (saison === null ? null : planEnCache(porte, fermeId, saison, jour)));
  const plan = lu?.plan ?? null;
  const [echec, setEchec] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [formulaire, setFormulaire] = useState<DepartSerie | null>(null);
  const [annulable, setAnnulable] = useState<(SaisieSerieAnnulable & { readonly numero: number }) | null>(null);
  const numeroAnnulable = useRef(0);
  /** Annulation par le bandeau refusée : ce qui n'a pas pu être défait (message affiché). */
  const [echecAnnulation, setEchecAnnulation] = useState<{ readonly titre: string; readonly texte: string } | null>(null);
  const [vue3d, setVue3d] = useState<EtatVue3d>({ sorte: 'fermee' });
  const [repli3d, setRepli3d] = useState<string | null>(null);
  const defilement = useRef<HTMLDivElement>(null);
  const total = plan?.lignes.length ?? 0;
  const [vue, setVue] = useState(() => fenetre(null, total));
  const idSaison = useId();

  // Plan complet déjà affiché : une relecture ne repasse jamais par le début (retour en haut).
  // Tenu à jour avant les effets de lecture ci-dessous (les effets passent dans l'ordre).
  const completAffiche = useRef(false);
  useEffect(() => {
    completAffiche.current = lu?.complet === true;
  }, [lu]);

  // Données changées (saisie, synchro) et ferme relue par le cache : on prend le plan relu.
  useEffect(
    () =>
      surChangement(porte, fermeId, () => {
        setVersion((v) => v + 1);
      }),
    [porte, fermeId],
  );

  useEffect(() => {
    let actif = true;
    obtenirSaisons(porte, fermeId).then(
      (s) => {
        if (!actif) return;
        setSaisons(s);
        setSaisonId((id) => (id !== null && s.some((x) => x.id === id) ? id : (saisonParDefaut(s, jour)?.id ?? null)));
      },
      (erreur: unknown) => {
        console.error('Saisons illisibles', erreur);
        if (actif) setEchec(true);
      },
    );
    return () => {
      actif = false;
    };
  }, [porte, fermeId, jour, version]);

  // Saison choisie : le plan en cache, sinon son début (premiers emplacements), vite lu ; si le
  // plan complet est déjà à l'écran, il y reste jusqu'à ce que le plan complet relu le remplace.
  useEffect(() => {
    if (saison === null) return undefined;
    const enCache = planEnCache(porte, fermeId, saison, jour);
    let actif = true;
    const lecture =
      enCache !== null
        ? Promise.resolve(enCache)
        : completAffiche.current
          ? obtenirPlan(porte, fermeId, saison, jour)
          : obtenirDebutDePlan(porte, fermeId, saison, jour);
    lecture.then(
      (p) => {
        if (actif) setLu(p);
      },
      (erreur: unknown) => {
        console.error('Plan illisible', erreur);
        if (actif) setEchec(true);
      },
    );
    return () => {
      actif = false;
    };
  }, [porte, fermeId, saison, jour, version]);

  // Début affiché : le plan complet se lit ensuite et le remplace.
  const debutAffiche = lu !== null && !lu.complet && saison !== null && lu.plan.saison.id === saison.id;
  useEffect(() => {
    if (!debutAffiche) return undefined;
    let actif = true;
    obtenirPlan(porte, fermeId, saison, jour).then(
      (p) => {
        if (actif) setLu(p);
      },
      (erreur: unknown) => {
        console.error('Plan illisible', erreur);
        if (actif) setEchec(true);
      },
    );
    return () => {
      actif = false;
    };
  }, [debutAffiche, porte, fermeId, saison, jour, version]);

  // Lignes à dessiner : recalculées au défilement, et quand le plan ou la vue change.
  useLayoutEffect(() => {
    const el = defilement.current;
    const recalculer = () => {
      const f = fenetre(el, total);
      setVue((v) => (v.debut === f.debut && v.fin === f.fin ? v : f));
    };
    recalculer();
    el?.addEventListener('scroll', recalculer, { passive: true });
    addEventListener('resize', recalculer);
    return () => {
      el?.removeEventListener('scroll', recalculer);
      removeEventListener('resize', recalculer);
    };
  }, [total]);

  // Nouvelle saison affichée : la semaine courante dans la vue, au tiers de la largeur.
  const saisonAffichee = plan?.saison.id;
  const semaineCourante = plan?.semaineCourante ?? null;
  useLayoutEffect(() => {
    const el = defilement.current;
    if (el === null || saisonAffichee === undefined) return;
    const utile = Math.max(0, el.clientWidth - LARGEUR_ETIQUETTE);
    el.scrollLeft = semaineCourante === null ? 0 : Math.max(0, semaineCourante * LARGEUR_SEMAINE - utile / 3);
  }, [saisonAffichee, semaineCourante]);

  // Une marque par ouverture de l'écran, quand les premières lignes sont dessinées ; le
  // formulaire d'une série se charge ensuite, au calme (T12 : il s'ouvre alors tout de suite).
  const marquee = useRef(false);
  useEffect(() => {
    if (plan === null || marquee.current) return;
    marquee.current = true;
    performance.mark(MARQUE_PLAN_AFFICHE);
    const precharger = () => {
      chargerFormulaire().catch((erreur: unknown) => {
        console.warn('Formulaire de série non préchargé', erreur);
      });
    };
    const minuterie = setTimeout(precharger, 1_000);
    return () => {
      clearTimeout(minuterie);
    };
  }, [plan]);

  // Message d'échec d'une annulation : affiché DELAI_ANNULATION_MS, ou jusqu'à « OK ».
  useEffect(() => {
    if (echecAnnulation === null) return undefined;
    const minuterie = setTimeout(() => {
      setEchecAnnulation(null);
    }, DELAI_ANNULATION_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [echecAnnulation]);

  // « Annuler » : DELAI_ANNULATION_MS après l'enregistrement d'une série.
  useEffect(() => {
    if (annulable === null) return undefined;
    const minuterie = setTimeout(() => {
      setAnnulable((a) => (a?.numero === annulable.numero ? null : a));
    }, DELAI_ANNULATION_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [annulable]);

  // Appui long sur une case vide (T12) : planche et semaine sous le doigt.
  const appui = useRef<{ readonly x: number; readonly y: number; readonly minuterie: ReturnType<typeof setTimeout> } | null>(null);
  const lacherAppui = useCallback(() => {
    if (appui.current !== null) clearTimeout(appui.current.minuterie);
    appui.current = null;
  }, []);
  useEffect(() => lacherAppui, [lacherAppui]);
  const semainesDuPlan = plan?.semaines ?? AUCUNE_SEMAINE;
  const saisonDuPlan = plan?.saison.id ?? null;
  const surPointeurBas = useCallback(
    (e: EvenementPointeur<HTMLDivElement>) => {
      lacherAppui();
      if (!e.isPrimary || e.button > 0 || !(e.target instanceof Element)) return;
      // Sur une barre ou sur l'étiquette (code de la planche) : pas de création.
      if (e.target.closest('[data-testid="barre"], .plan-etiquette') !== null) return;
      const ligne = e.target.closest<HTMLElement>('[data-testid="ligne-plan"][data-sorte="emplacement"]');
      const emplacementId = ligne?.dataset.id;
      if (ligne === null || emplacementId === undefined) return;
      const dx = e.clientX - ligne.getBoundingClientRect().left - LARGEUR_ETIQUETTE_PX;
      if (dx < 0) return;
      const semaine = semainesDuPlan[Math.floor(dx / LARGEUR_SEMAINE_PX)];
      if (semaine === undefined) return;
      const x = e.clientX;
      const y = e.clientY;
      const minuterie = setTimeout(() => {
        appui.current = null;
        setDetail(null);
        setFormulaire({
          sorte: 'creation',
          emplacementId,
          semaine: `${String(semaine.annee)}-W${String(semaine.semaine).padStart(2, '0')}`,
          ...(saisonDuPlan === null ? {} : { saisonId: saisonDuPlan }),
        });
      }, DELAI_APPUI_LONG_MS);
      appui.current = { x, y, minuterie };
    },
    [lacherAppui, semainesDuPlan, saisonDuPlan],
  );
  const surPointeurBouge = useCallback(
    (e: EvenementPointeur<HTMLDivElement>) => {
      const a = appui.current;
      if (a !== null && Math.hypot(e.clientX - a.x, e.clientY - a.y) > TOLERANCE_APPUI_PX) lacherAppui();
    },
    [lacherAppui],
  );

  const origine = useRef<OrigineFeuille | null>(null);
  const focusARendre = useRef(false);
  const grille = useRef<HTMLDivElement>(null);
  const surBarre = useCallback((ligne: LigneEmplacementPlan, barre: BarrePlan) => {
    origine.current = { ligneId: ligne.id, occupationId: barre.occupationId };
    setDetail({ sorte: 'serie', ligne, barre });
  }, []);
  const surConflits = useCallback((ligne: LigneEmplacementPlan) => {
    origine.current = { ligneId: ligne.id, occupationId: null };
    setDetail({ sorte: 'conflits', ligne });
  }, []);
  const fermerDetail = useCallback(() => {
    focusARendre.current = true;
    setDetail(null);
  }, []);
  // Feuille fermée (« Fermer » ou Échap) : le focus revient à ce qui l'a ouverte (T11b).
  useLayoutEffect(() => {
    if (detail !== null || !focusARendre.current) return;
    focusARendre.current = false;
    const o = origine.current;
    origine.current = null;
    if (o !== null && grille.current !== null) cibleDuFocus(grille.current, o).focus({ preventScroll: true });
  }, [detail]);
  const modifierSerie = useCallback((serieId: string) => {
    setDetail(null);
    setFormulaire({ sorte: 'modification', serieId });
  }, []);
  const fermerFormulaire = useCallback(() => {
    setFormulaire(null);
  }, []);
  const surEnregistree = useCallback((saisie: SaisieSerieAnnulable) => {
    numeroAnnulable.current++;
    setAnnulable({ texte: saisie.texte, annuler: () => saisie.annuler(), numero: numeroAnnulable.current });
  }, []);
  const annuler = useCallback((a: SaisieSerieAnnulable & { readonly numero: number }) => {
    setAnnulable((x) => (x?.numero === a.numero ? null : x));
    setEchecAnnulation(null);
    a.annuler().then(
      (laisse) => {
        if (laisse !== null) setEchecAnnulation({ titre: 'Annulation incomplète', texte: `${a.texte} : ${laisse}.` });
      },
      (erreur: unknown) => {
        console.error('Annulation impossible', erreur);
        setEchecAnnulation({ titre: 'Annulation impossible', texte: `${a.texte} reste enregistrée telle quelle. Réessaie depuis l’historique de la série.` });
      },
    );
  }, []);

  // Vue 3D (T27) : sans WebGL, rien n'est téléchargé et la 2D reste, avec un message.
  const ouvrir3d = useCallback(() => {
    setRepli3d(null);
    if (!webglDisponible()) {
      setRepli3d(REPLI_SANS_WEBGL);
      return;
    }
    setVue3d((v) => (v.sorte === 'fermee' ? { sorte: 'chargement' } : v));
    chargerVue3d().then(
      (m) => {
        performance.mark(MARQUE_MODULE_3D);
        setVue3d((v) => (v.sorte === 'chargement' ? { sorte: 'ouverte', Vue: m.Vue3d } : v));
      },
      (erreur: unknown) => {
        console.error('Vue 3D non chargée', erreur);
        setVue3d({ sorte: 'fermee' });
        setRepli3d(REPLI_CHARGEMENT);
      },
    );
  }, []);
  // T28f : « Modifier le plan » (gérant) ouvre l'éditeur de placement, par le chargeur d'EcranFerme (une seule façon
  // de l'ouvrir), importé au tap, jamais au démarrage. Le plan se relit à chaque écriture (surChangement) : la 3D
  // montre le placement enregistré au retour.
  const [gerant, setGerant] = useState(false);
  useEffect(() => {
    if (utilisateurId === undefined) return undefined;
    return porte.surveiller<string>(
      {
        sql: "SELECT role FROM membre WHERE ferme_id = ? AND utilisateur_id = ? AND etat = 'accepte' AND supprime_le IS NULL",
        parametres: [fermeId, utilisateurId],
        tables: ['membre'],
        convertir: (l) => (typeof l.role === 'string' ? l.role : ''),
      },
      (roles) => {
        setGerant(roles.includes('gerant'));
      },
    );
  }, [porte, fermeId, utilisateurId]);
  const [EditeurPlacement, setEditeurPlacement] = useState<EditeurPlacementCharge | null>(null);
  const modifierPlan = useCallback(() => {
    import('../ferme/EcranFerme.tsx')
      .then((m) => m.chargerPlacement())
      .then(
        ({ EditeurPlacement: composant }) => {
          setEditeurPlacement(() => composant);
        },
        (erreur: unknown) => {
          console.error('Éditeur de placement introuvable', erreur);
        },
      );
  }, []);
  // Focus rendu à la fermeture de l'éditeur (T28g) : posé après le rendu, sur le « Modifier le plan » du moment, sinon la toile.
  const rendreFocus = useRef(false);
  useLayoutEffect(() => {
    if (EditeurPlacement !== null || !rendreFocus.current) return;
    rendreFocus.current = false;
    (document.querySelector<HTMLElement>('[data-testid="modifier-plan"]') ?? document.querySelector<HTMLElement>('[data-testid="toile-3d"]'))?.focus();
  }, [EditeurPlacement]);
  const fermer3d = useCallback(() => {
    setVue3d({ sorte: 'fermee' });
  }, []);
  const echec3d = useCallback((message: string) => {
    setVue3d({ sorte: 'fermee' });
    setRepli3d(message);
  }, []);

  const lignesVisibles = useMemo(() => {
    if (plan === null) return [];
    const r: { ligne: LignePlan; index: number }[] = [];
    for (let i = vue.debut; i < Math.min(vue.fin, plan.lignes.length); i++) {
      const ligne = plan.lignes[i];
      if (ligne !== undefined) r.push({ ligne, index: i });
    }
    return r;
  }, [plan, vue]);

  if (echec) {
    return (
      <p role="alert" className="attente">
        Le plan n’a pas pu se lire sur ce téléphone. Rechargez l’appli ; si cela recommence, signalez-le.
      </p>
    );
  }
  if (saisons !== null && saisons.length === 0) {
    return <p className="attente">Aucune saison dans cette ferme pour l’instant : le plan s’affichera dès qu’il y en aura une.</p>;
  }

  const semaines = plan?.semaines ?? AUCUNE_SEMAINE;
  const largeur = LARGEUR_ETIQUETTE + semaines.length * LARGEUR_SEMAINE;
  // Début du plan affiché : une ligne de plus dit que la suite arrive, et la hauteur du plan
  // complet est réservée (le défilement ne bute pas sur la fin du début).
  const suite = lu !== null && !lu.complet;
  const hauteur = HAUTEUR_ENTETE + Math.max(total + (suite ? 1 : 0), lu?.totalLignes ?? 0) * HAUTEUR_LIGNE_PX;
  // La 2D reste montée sous la 3D (défilement et lignes visibles intacts au retour).
  const en3d = vue3d.sorte === 'ouverte' && plan !== null;
  return (
    <div className="plan">
      <div className="plan-outils">
        <label htmlFor={idSaison}>Saison</label>
        <select
          id={idSaison}
          value={saisonId ?? ''}
          onChange={(e) => {
            setSaisonId(e.target.value);
          }}
        >
          {(saisons ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.nom}
            </option>
          ))}
        </select>
        {!en3d && (
          <button
            type="button"
            data-testid="voir-en-3d"
            className="plan-voir-3d"
            disabled={plan === null}
            aria-busy={vue3d.sorte === 'chargement'}
            onClick={ouvrir3d}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9" />
            </svg>
            Voir en 3D
          </button>
        )}
        <button
          type="button"
          className="plan-nouvelle"
          onClick={() => {
            setFormulaire({ sorte: 'creation', ...(saisonId === null ? {} : { saisonId }) });
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nouvelle série
        </button>
      </div>
      {repli3d !== null && (
        <p data-testid="repli-2d" role="status" className="plan-repli-3d">
          {repli3d}
        </p>
      )}
      {en3d && <vue3d.Vue plan={plan} surRetour={fermer3d} surEchec={echec3d} gerant={gerant} invitationDemo={DEMO} surModifierPlan={modifierPlan} porte={porte} fermeId={fermeId} />}
      {EditeurPlacement !== null && utilisateurId !== undefined && (
        <EditeurPlacement
          key={fermeId}
          porte={porte}
          fermeId={fermeId}
          utilisateurId={utilisateurId}
          invitationDemo={DEMO}
          surFermer={() => {
            rendreFocus.current = true;
            setEditeurPlacement(null);
          }}
        />
      )}
      <div data-testid="plan-defilement" ref={defilement} className="plan-defilement" hidden={en3d}>
        <div
          ref={grille}
          tabIndex={-1}
          className="plan-grille"
          style={{ width: largeur, height: hauteur }}
          onPointerDown={surPointeurBas}
          onPointerMove={surPointeurBouge}
          onPointerUp={lacherAppui}
          onPointerCancel={lacherAppui}
          onPointerLeave={lacherAppui}
          onContextMenu={(e) => {
            // L'appui long crée une série : pas de menu du navigateur sur les lignes.
            if (e.target instanceof Element && e.target.closest('[data-testid="ligne-plan"]') !== null) e.preventDefault();
          }}
        >
          <EnteteSemaines semaines={semaines} courante={semaineCourante} largeur={largeur} />
          {semaineCourante !== null && (
            <div
              data-testid="semaine-courante"
              aria-hidden="true"
              className="plan-repere"
              style={{ left: LARGEUR_ETIQUETTE + (semaineCourante + 0.5) * LARGEUR_SEMAINE - 1, height: hauteur }}
            />
          )}
          {lignesVisibles.map(({ ligne, index }) => (
            <Ligne key={ligne.id} ligne={ligne} index={index} surBarre={surBarre} surConflits={surConflits} />
          ))}
          {suite && (
            <p className="plan-suite" style={{ transform: `translateY(${String(HAUTEUR_ENTETE + total * HAUTEUR_LIGNE_PX)}px)` }}>
              Lecture des autres planches…
            </p>
          )}
        </div>
      </div>
      {!en3d && <Legende />}
      {detail?.sorte === 'serie' && <DetailSerie ligne={detail.ligne} barre={detail.barre} surFermer={fermerDetail} surModifier={modifierSerie} />}
      {detail?.sorte === 'conflits' && <DetailConflits ligne={detail.ligne} surFermer={fermerDetail} />}
      {formulaire !== null && (
        <Suspense fallback={null}>
          <FormulaireSerie porte={porte} fermeId={fermeId} depart={formulaire} aujourdhui={() => jour} surFermer={fermerFormulaire} surEnregistree={surEnregistree} />
        </Suspense>
      )}
      {annulable !== null && (
        <div key={annulable.numero} data-testid="saisie-annulable" data-saisie-en-cours="oui" role="status" className="plan-bandeau">
          <span className="plan-bandeau-texte">
            <strong>Série enregistrée</strong>
            <span>{annulable.texte}</span>
          </span>
          <button
            type="button"
            className="plan-bandeau-annuler"
            onClick={() => {
              annuler(annulable);
            }}
          >
            Annuler
          </button>
          <span aria-hidden="true" className="plan-bandeau-temps" />
        </div>
      )}
      {echecAnnulation !== null && annulable === null && (
        <div role="alert" className="plan-bandeau plan-bandeau-echec">
          <span className="plan-bandeau-texte">
            <strong>{echecAnnulation.titre}</strong>
            <span>{echecAnnulation.texte}</span>
          </span>
          <button
            type="button"
            className="plan-bandeau-annuler"
            onClick={() => {
              setEchecAnnulation(null);
            }}
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}
