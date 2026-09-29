/**
 * Boutons, carte blanche et alerte (T16), repris des maquettes validées (docs/maquettes/). Hors
 * du JavaScript de démarrage : seuls les écrans chargés à la demande s'en servent.
 *
 * CSS et React seuls. Styles en ligne : les dimensions qui comptent pour les gants en px, les
 * couleurs, polices, rayons et ombres par les variables CSS des jetons (./jetons.ts).
 */
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

// ── Boutons ──────────────────────────────────────────────────────────────────────────────────

const BOUTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  minHeight: 60,
  padding: '0 20px',
  borderRadius: 'var(--rayon-bouton)',
  fontWeight: 700,
  fontSize: 17,
  textAlign: 'center',
};

const BOUTON_PRINCIPAL: CSSProperties = {
  ...BOUTON,
  minHeight: 64,
  border: 0,
  background: 'var(--couleur-foret)',
  color: 'var(--couleur-sur-foret)',
  fontFamily: 'var(--police-titre)',
  fontWeight: 800,
  fontSize: 19,
  boxShadow: 'var(--ombre-basse)',
};

const BOUTON_SECONDAIRE: CSSProperties = {
  ...BOUTON,
  border: '2px solid var(--couleur-foret)',
  background: 'var(--couleur-surface)',
  color: 'var(--couleur-foret)',
};

/** Action principale de l'écran : 64 px de haut, forêt, ombre basse. */
export function BoutonPrincipal({ type = 'button', style, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} style={{ ...BOUTON_PRINCIPAL, ...style }} {...props} />;
}

/** Action d'appoint : 60 px, fond blanc, bord et texte forêt. */
export function BoutonSecondaire({ type = 'button', style, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} style={{ ...BOUTON_SECONDAIRE, ...style }} {...props} />;
}

/** Carte blanche des maquettes : coins de 16 px, trait dessous. */
export const CARTE: CSSProperties = {
  background: 'var(--couleur-surface)',
  borderRadius: 'var(--rayon-carte)',
  boxShadow: 'var(--ombre-carte)',
  overflow: 'hidden',
};

// ── Alerte ───────────────────────────────────────────────────────────────────────────────

export interface ProprietesAlerteOrange {
  readonly children: ReactNode;
  readonly titre?: string;
}

/** Ce qui presse ou ce qui a échoué : carte blanche, bande orange, annoncée aux lecteurs d'écran. */
export function AlerteOrange({ children, titre }: ProprietesAlerteOrange) {
  return (
    <div role="alert" style={{ ...CARTE, borderLeft: '8px solid var(--couleur-orange)', padding: '12px 14px', fontSize: 16 }}>
      {titre !== undefined && <strong style={{ display: 'block', color: 'var(--couleur-texte-orange)' }}>{titre}</strong>}
      {children}
    </div>
  );
}
