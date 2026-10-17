/**
 * T40 — bandeau discret d'Aujourd'hui : « Installer l'appli », une seule fois. Fermé (ou
 * l'installation demandée), il ne revient plus sur ce téléphone ; jamais pendant une saisie, ni
 * quand l'appli tourne installée. Posé au-dessus de la barre d'onglets, sans pousser les cartes :
 * une place vide de sa hauteur, en bas de l'écran, garde la dernière carte accessible.
 * Styles en ligne : pas de feuille de style de plus à charger avec Aujourd'hui.
 */
import { useState, type CSSProperties } from 'react';
import { bandeauFerme, fermerBandeau } from './installation.ts';
import { useInstallation } from './Installer.tsx';

export interface ProprietesBandeauInstallation {
  /** Saisie en cours (dialogue ouvert, écriture, « Annuler » affiché) : pas de bandeau. */
  readonly enSaisie: boolean;
}

const BANDEAU: CSSProperties = {
  position: 'fixed',
  zIndex: 15,
  left: 12,
  right: 12,
  bottom: 'calc(88px + env(safe-area-inset-bottom))',
  maxWidth: 560,
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 8px 8px 14px',
  border: '1px solid var(--couleur-trait)',
  borderRadius: 'var(--rayon-carte)',
  background: 'var(--couleur-surface)',
  boxShadow: 'var(--ombre-carte)',
};

const TEXTE: CSSProperties = { flex: '1 1 auto', minWidth: 0, fontSize: 15, color: 'var(--couleur-secondaire)', overflowWrap: 'anywhere' };

const INSTALLER: CSSProperties = {
  flexShrink: 0,
  minHeight: 56,
  padding: '0 14px',
  border: 0,
  borderRadius: 'var(--rayon-case)',
  background: 'var(--couleur-foret)',
  color: 'var(--couleur-sur-foret)',
  fontWeight: 700,
  fontSize: 16,
};

const FERMER: CSSProperties = {
  flexShrink: 0,
  width: 56,
  height: 56,
  border: 0,
  borderRadius: 'var(--rayon-case)',
  background: 'transparent',
  color: 'var(--couleur-secondaire)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function BandeauInstallation({ enSaisie }: ProprietesBandeauInstallation) {
  const { moyen, installer, aide } = useInstallation();
  const [ferme, setFerme] = useState(bandeauFerme);
  const fermer = () => {
    fermerBandeau();
    setFerme(true);
  };
  if (ferme || enSaisie || moyen === 'aucun') return aide;
  return (
    <>
      <div aria-hidden="true" style={{ height: 104 }} />
      <div data-testid="bandeau-installation" role="region" aria-label="Installer l’appli" style={BANDEAU}>
        <span style={TEXTE}>Installez l’appli : une icône, plein écran, même sans réseau.</span>
        <button
          type="button"
          style={INSTALLER}
          onClick={() => {
            fermer();
            installer();
          }}
        >
          Installer l’appli
        </button>
        <button type="button" style={FERMER} aria-label="Fermer le bandeau d’installation" onClick={fermer}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {aide}
    </>
  );
}
