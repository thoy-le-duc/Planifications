/**
 * T25 — mode démo (build `vite build --mode demo`, apps/web/dist-demo/, servi par Vercel). Chargé
 * à la demande par src/main.tsx, seulement dans ce build : le build de production n'en contient
 * rien (scripts/demo.test.ts).
 *
 *   - Pas d'écran de connexion : la session de l'utilisateur fictif de la démo est posée sur le
 *     téléphone avant le premier rendu de l'appli (aucun jeton réel : la synchro n'est jamais
 *     branchée, le build n'a ni VITE_API_URL ni VITE_POWERSYNC_URL).
 *   - Premier lancement (ou après « Réinitialiser la démo ») : la base locale est remplie avec la
 *     ferme fictive (./remplir.ts, chargé à la demande), datée par rapport au jour du téléphone.
 *     Ensuite, l'appli s'ouvre directement sur la base gardée : les saisies restent sur le
 *     téléphone.
 *   - Aucune requête vers l'API ni vers une autre origine : `fetch` les refuse (ceinture et
 *     bretelles, l'appli n'en lance pas sans URL de synchro).
 *   - Bandeau « Démo — données fictives » et bouton « Réinitialiser la démo » (./Bandeau.tsx).
 */
import './demo.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App.tsx';
import { enregistrerSession, stockageNavigateur, type SessionConnexion } from '../connexion/session.ts';
import { baseLocaleExiste } from '../donnees/effacer.ts';
import { BandeauDemo } from './Bandeau.tsx';
import { CLE_REMPLIE, UTILISATEUR_DEMO } from './identite.ts';

/** Session fictive : aucun jeton réel, jamais envoyée (la synchro n'est pas branchée). */
const SESSION_DEMO: SessionConnexion = {
  utilisateurId: UTILISATEUR_DEMO,
  email: 'visiteur@demo',
  jetonAcces: 'demo',
  jetonRenouvellement: 'demo',
};

/** Préfixe des clés de l'appli dans le localStorage (session, ferme active, refus vus…). */
const PREFIXE_CLES = 'planif.';

/** 'AAAA-MM-JJ' du téléphone (heure locale). */
function jourDuTelephone(): string {
  const d = new Date();
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Refuse toute requête `fetch` vers l'API (/api) ou une autre origine. */
function garderLeReseau(): void {
  const natif = window.fetch.bind(window);
  window.fetch = (entree, init) => {
    const brute = entree instanceof Request ? entree.url : entree instanceof URL ? entree.href : entree;
    const url = new URL(brute, location.href);
    if (url.origin !== location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return Promise.reject(new TypeError(`Démo : aucune requête vers un serveur (${url.origin}${url.pathname})`));
    }
    return natif(entree, init);
  };
}

let preparation: Promise<void> | null = null;

/** Session de la démo posée, base remplie si besoin. Une seule fois par page. */
function preparer(): Promise<void> {
  return (preparation ??= (async () => {
    const stockage = stockageNavigateur();
    enregistrerSession(stockage, SESSION_DEMO);
    let remplie: string | null = null;
    try {
      remplie = stockage.getItem(CLE_REMPLIE);
    } catch {
      // Stockage indisponible : la base est remplie à chaque lancement.
    }
    if (remplie !== null && (await baseLocaleExiste(UTILISATEUR_DEMO))) return;
    const { remplirDemo } = await import('./remplir.ts');
    const jour = jourDuTelephone();
    await remplirDemo(jour, new Date());
    try {
      stockage.setItem(CLE_REMPLIE, jour);
    } catch {
      // Rien à retenir : la prochaine ouverture remplira de nouveau.
    }
  })());
}

/** Efface ce que la démo a gardé sur le téléphone puis recharge : la base est remplie à nouveau. */
function reinitialiser(): void {
  try {
    const cles: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i);
      if (cle?.startsWith(PREFIXE_CLES) === true) cles.push(cle);
    }
    for (const cle of cles) localStorage.removeItem(cle);
  } catch {
    // Stockage indisponible : la base est de toute façon remplie à chaque lancement.
  }
  location.reload();
}

type Etat = 'preparation' | 'prete' | 'echec';

function Demo() {
  const [etat, setEtat] = useState<Etat>('preparation');
  useEffect(() => {
    let actif = true;
    preparer().then(
      () => {
        if (actif) setEtat('prete');
      },
      (erreur: unknown) => {
        console.error('Démo impossible à préparer', erreur);
        if (actif) setEtat('echec');
      },
    );
    return () => {
      actif = false;
    };
  }, []);
  return (
    <>
      <BandeauDemo surReinitialiser={reinitialiser} />
      {etat === 'prete' ? (
        <App />
      ) : (
        <div className="demo-attente" data-etat={etat} role="status">
          <h1>Planifications</h1>
          <p>
            {etat === 'echec'
              ? 'La ferme de démonstration n’a pas pu se préparer. Rechargez la page ; si cela recommence, réinitialisez la démo.'
              : 'Préparation de la ferme de démonstration…'}
          </p>
        </div>
      )}
    </>
  );
}

/** Lance l'appli en mode démo dans `racine`. */
export function demarrerDemo(racine: HTMLElement): void {
  garderLeReseau();
  createRoot(racine).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  );
}
