/**
 * Composants de la coquille (T16), repris des maquettes validées (docs/maquettes/) : en-tête,
 * pastilles, barre de navigation. Les seuls du JavaScript de démarrage ; les autres (boutons,
 * cartes, alerte : ./elements.tsx) arrivent avec les écrans chargés à la demande.
 *
 * CSS et React seuls. Styles en ligne : les dimensions qui comptent pour les gants en px, les
 * couleurs, polices, rayons et ombres par les variables CSS des jetons (./jetons.ts).
 */
import type { ReactNode } from 'react';

// ── En-tête et pastilles ─────────────────────────────────────────────────────────────────────

export interface ProprietesEnTete {
  readonly titre: string;
  /** Ligne au-dessus du titre (date, nom de la ferme), en capitales mono. */
  readonly surtitre?: string;
  /** Pastilles. */
  readonly children?: ReactNode;
}

/** En-tête vert de chaque écran. */
export function EnTete({ titre, surtitre, children }: ProprietesEnTete) {
  return (
    <header
      style={{
        background: 'var(--couleur-foret)',
        color: 'var(--couleur-sur-foret)',
        padding: '22px 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {surtitre !== undefined && (
        <span style={{ fontFamily: 'var(--police-code)', fontSize: 13, letterSpacing: '.06em', color: 'var(--couleur-sur-foret-doux)' }}>
          {surtitre}
        </span>
      )}
      <h1 style={{ fontFamily: 'var(--police-titre)', fontWeight: 800, fontSize: 34, lineHeight: 1.02 }}>{titre}</h1>
      {children !== undefined && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>}
    </header>
  );
}

export interface ProprietesPastille {
  readonly children: ReactNode;
  readonly ton?: 'urgent' | 'normal';
}

/** Compteur posé sur l'en-tête : orange si ça presse. */
export function Pastille({ children, ton = 'normal' }: ProprietesPastille) {
  const urgent = ton === 'urgent';
  return (
    <span
      style={{
        background: urgent ? 'var(--couleur-orange)' : 'var(--couleur-foret-clair)',
        color: urgent ? 'var(--couleur-sur-orange)' : 'var(--couleur-sur-foret)',
        fontWeight: 700,
        fontSize: 14,
        padding: '7px 12px',
        borderRadius: 'var(--rayon-pastille)',
      }}
    >
      {children}
    </span>
  );
}

// ── Barre de navigation ──────────────────────────────────────────────────────────────────────

export type Onglet = 'aujourdhui' | 'planches' | 'dicter' | 'ferme';

export const ONGLETS: readonly { readonly id: Onglet; readonly libelle: string }[] = [
  { id: 'aujourdhui', libelle: 'Aujourd’hui' },
  { id: 'planches', libelle: 'Planches' },
  { id: 'dicter', libelle: 'Dicter' },
  { id: 'ferme', libelle: 'Ferme' },
];

/** Tracés des icônes (maquettes), 24 × 24, trait de la couleur du texte. */
const ICONES: Readonly<Record<Onglet, ReactNode>> = {
  aujourdhui: (
    <>
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  planches: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="18" height="4" rx="1" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
    </>
  ),
  dicter: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  ferme: <path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6" />,
};

export interface ProprietesBarreNavigation {
  readonly actif: Onglet;
  readonly surChoix: (onglet: Onglet) => void;
}

/** Barre basse : quatre onglets de 64 px de haut, l'actif en forêt. */
export function BarreNavigation({ actif, surChoix }: ProprietesBarreNavigation) {
  return (
    <nav
      aria-label="Navigation principale"
      style={{
        background: 'var(--couleur-surface)',
        borderTop: '1px solid var(--couleur-trait)',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '6px 8px max(10px, env(safe-area-inset-bottom))',
      }}
    >
      {ONGLETS.map(({ id, libelle }) => {
        const courant = id === actif;
        return (
          <button
            key={id}
            type="button"
            aria-current={courant ? 'page' : undefined}
            onClick={() => {
              surChoix(id);
            }}
            style={{
              minWidth: 72,
              minHeight: 60,
              border: 0,
              background: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 13,
              fontWeight: 700,
              color: courant ? 'var(--couleur-foret)' : 'var(--couleur-tertiaire)',
            }}
          >
            <svg
              aria-hidden="true"
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {ICONES[id]}
            </svg>
            {libelle}
          </button>
        );
      })}
    </nav>
  );
}
