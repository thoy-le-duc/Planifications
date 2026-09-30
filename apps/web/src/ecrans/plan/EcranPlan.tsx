/**
 * Écran « Planches » (T11, maquette Plan) : toutes les planches en lignes, les semaines en
 * colonnes, chaque culture en barre, les conflits de T03 en évidence. Lecture seule : toucher une
 * barre ouvre le détail. Contrat : ./test/contrat.ts (section « Écran (DOM) »).
 *
 * Chargé à la demande par App ; reçoit la porte (jamais PowerSync). Seules les lignes visibles
 * (plus une marge) sont dans le DOM : le défilement reste fluide sur 400 planches.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PorteDonnees } from '@planif/sync';
import './plan.css';
import { obtenirDebutDePlan, obtenirPlan, obtenirSaisons, planEnCache, saisonsEnCache, surChangement, type PlanLu } from './cache.ts';
import {
  fenetreVisible,
  HAUTEUR_LIGNE_PX,
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
}

/** Marque de performance posée quand les premières lignes sont dessinées (e2e/plan.e2e.ts). */
export const MARQUE_PLAN_AFFICHE = 'planif:plan-affiche';

/** Largeur d'une semaine et de la colonne des codes, en px. */
const LARGEUR_SEMAINE = 36;
const LARGEUR_ETIQUETTE = 92;
const HAUTEUR_ENTETE = 28;
const PX_PAR_JOUR = LARGEUR_SEMAINE / 7;
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
  const style: CSSProperties = {
    left: LARGEUR_ETIQUETTE + barre.debutJour * PX_PAR_JOUR,
    width: Math.max(PX_PAR_JOUR, (barre.finJour - barre.debutJour) * PX_PAR_JOUR),
  };
  const etat = barre.etat === 'reel' ? 'en place' : 'prévu';
  return (
    <button
      type="button"
      data-testid="barre"
      data-occupation={barre.occupationId}
      data-etat={barre.etat}
      data-famille={barre.cleFamille ?? ''}
      data-conflit={barre.enConflit ? 'oui' : undefined}
      className={`barre barre-${barre.etat} famille-${barre.cleFamille ?? 'neutre'}${barre.enConflit ? ' barre-conflit' : ''}`}
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
      <div data-testid="ligne-plan" data-sorte={ligne.sorte} data-id={ligne.id} className={`plan-ligne plan-ligne-${ligne.sorte}`} style={style}>
        <span className="plan-etiquette plan-etiquette-zone">{ligne.nom}</span>
      </div>
    );
  }
  const sortes = sortesDe(ligne.conflits);
  const enConflit = sortes.length > 0;
  // Plus de deux libellés : l'étiquette peut dépasser sur la ligne suivante plutôt que de rogner.
  const classe = `plan-ligne${enConflit ? ' plan-ligne-conflit' : ''}${sortes.length > 2 ? ' plan-ligne-conflits-nombreux' : ''}`;
  return (
    <div data-testid="ligne-plan" data-sorte="emplacement" data-id={ligne.id} data-conflit={enConflit ? 'oui' : undefined} className={classe} style={style}>
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
            {sortes.map((s) => (
              <span key={s} data-testid="conflit" data-sorte={s} className="plan-conflit">
                {LIBELLES_COURTS_CONFLITS[s]}
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

const cleConflit = (c: ConflitPlan) => `${c.sorte}-${c.du}-${c.occupations.join('-')}`;

/** Feuille en bas de l'écran : titre, contenu, un seul bouton « Fermer » (Échap ferme aussi). */
function Feuille({ titre, surFermer, children }: { readonly titre: string; readonly surFermer: () => void; readonly children: ReactNode }) {
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
        <button ref={fermer} type="button" className="plan-fermer" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </div>
  );
}

function DetailSerie({ ligne, barre, surFermer }: { readonly ligne: LigneEmplacementPlan; readonly barre: BarrePlan; readonly surFermer: () => void }) {
  const conflits = ligne.conflits.filter((c) => c.occupations.includes(barre.occupationId));
  const nature = barre.serieId !== null ? 'Série' : barre.plantationId !== null ? 'Plantation' : 'Couverture';
  return (
    <Feuille titre="Détail de la série" surFermer={surFermer}>
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

export function EcranPlan({ porte, fermeId, aujourdhui = jourDuTelephone }: ProprietesEcranPlan) {
  const [jour] = useState(aujourdhui);
  const [version, setVersion] = useState(0);
  const [saisons, setSaisons] = useState<SaisonPlan[] | null>(() => saisonsEnCache(porte, fermeId));
  const [saisonId, setSaisonId] = useState<string | null>(() => (saisons === null ? null : (saisonParDefaut(saisons, jour)?.id ?? null)));
  const saison = saisons?.find((s) => s.id === saisonId) ?? null;
  const [lu, setLu] = useState<PlanLu | null>(() => (saison === null ? null : planEnCache(porte, fermeId, saison, jour)));
  const plan = lu?.plan ?? null;
  const [echec, setEchec] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const defilement = useRef<HTMLDivElement>(null);
  const total = plan?.lignes.length ?? 0;
  const [vue, setVue] = useState(() => fenetre(null, total));
  const idSaison = useId();

  // Plan complet déjà affiché : une relecture ne repasse jamais par le début (retour en haut).
  const completAffiche = useRef(false);
  completAffiche.current = lu?.complet === true;

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

  // Une marque par ouverture de l'écran, quand les premières lignes sont dessinées.
  const marquee = useRef(false);
  useEffect(() => {
    if (plan === null || marquee.current) return;
    marquee.current = true;
    performance.mark(MARQUE_PLAN_AFFICHE);
  }, [plan]);

  const surBarre = useCallback((ligne: LigneEmplacementPlan, barre: BarrePlan) => {
    setDetail({ sorte: 'serie', ligne, barre });
  }, []);
  const surConflits = useCallback((ligne: LigneEmplacementPlan) => {
    setDetail({ sorte: 'conflits', ligne });
  }, []);
  const fermerDetail = useCallback(() => {
    setDetail(null);
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
  // Début du plan affiché : une ligne de plus dit que la suite arrive.
  const suite = lu !== null && !lu.complet;
  const hauteur = HAUTEUR_ENTETE + (total + (suite ? 1 : 0)) * HAUTEUR_LIGNE_PX;
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
      </div>
      <div data-testid="plan-defilement" ref={defilement} className="plan-defilement">
        <div className="plan-grille" style={{ width: largeur, height: hauteur }}>
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
      <Legende />
      {detail?.sorte === 'serie' && <DetailSerie ligne={detail.ligne} barre={detail.barre} surFermer={fermerDetail} />}
      {detail?.sorte === 'conflits' && <DetailConflits ligne={detail.ligne} surFermer={fermerDetail} />}
    </div>
  );
}
