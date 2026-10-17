/**
 * T40 — carte « Installer sur ce téléphone » de l'onglet Ferme : toujours là tant que l'appli
 * peut s'installer (invitation du navigateur, ou iPhone), jamais quand elle tourne installée.
 * Styles en ligne : pas de feuille de style de plus dans la table des dépendances du démarrage.
 */
import type { CSSProperties } from 'react';
import { BoutonPrincipal, CARTE } from '../ui/elements.tsx';
import { useInstallation } from './Installer.tsx';

const TITRE = 'Installer sur ce téléphone';

const STYLE_TITRE: CSSProperties = {
  padding: '12px 16px 6px',
  fontFamily: 'var(--police-texte)',
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--couleur-secondaire)',
};

const STYLE_CORPS: CSSProperties = {
  borderTop: '1px solid var(--couleur-fond)',
  padding: '12px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  fontSize: 16,
  color: 'var(--couleur-secondaire)',
};

export function CarteInstallation() {
  const { moyen, installer, aide } = useInstallation();
  if (moyen === 'aucun') return aide;
  return (
    <section aria-label={TITRE} style={CARTE}>
      <h2 style={STYLE_TITRE}>{TITRE}</h2>
      <div style={STYLE_CORPS}>
        <p>Une icône sur l’écran d’accueil : l’appli s’ouvre en plein écran, même sans réseau.</p>
        <BoutonPrincipal onClick={installer}>Installer l’appli</BoutonPrincipal>
      </div>
      {aide}
    </section>
  );
}
