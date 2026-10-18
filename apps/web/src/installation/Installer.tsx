/**
 * T40 — le geste « Installer l'appli », commun à la carte de l'onglet Ferme et au bandeau
 * d'Aujourd'hui : fenêtre d'installation du navigateur (Android, Chrome), ou aide iPhone / aide du menu
 * du navigateur après un refus (./AideIos.tsx, ./AideAndroid.tsx, chargées à la demande).
 */
import { useState, type ComponentType, type ReactNode } from 'react';
import { ouvrirInvitation, useMoyenInstallation, type MoyenInstallation } from './installation.ts';

export interface ProprietesAide {
  readonly surFermer: () => void;
}

export interface Installation {
  readonly moyen: MoyenInstallation;
  readonly installer: () => void;
  /** L'aide iPhone, quand elle est ouverte (à dessiner même si le bouton disparaît). */
  readonly aide: ReactNode;
}

export function useInstallation(): Installation {
  const moyen = useMoyenInstallation();
  const [Aide, setAide] = useState<ComponentType<ProprietesAide> | null>(null);
  const installer = () => {
    if (moyen === 'invite') {
      void ouvrirInvitation();
    } else if (moyen === 'ios' || moyen === 'menu') {
      (moyen === 'ios' ? import('./AideIos.tsx') : import('./AideAndroid.tsx')).then(
        (m) => {
          setAide(() => m.default);
        },
        (e: unknown) => {
          console.error('Aide d’installation impossible à charger', e);
        },
      );
    }
  };
  const aide =
    Aide === null ? null : (
      <Aide
        surFermer={() => {
          setAide(null);
        }}
      />
    );
  return { moyen, installer, aide };
}
