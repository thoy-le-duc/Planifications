/** T40 — `beforeinstallprompt` (Chromium) : pas encore dans les types du DOM. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed'; readonly platform: string }>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}

interface Window {
  /** Invitation retenue par ./capture.ts ; vidée une fois servie. */
  __planifInvitation?: BeforeInstallPromptEvent | null;
}

interface Navigator {
  /** Safari iOS : vrai quand l'appli est ouverte depuis l'écran d'accueil. */
  readonly standalone?: boolean;
}
