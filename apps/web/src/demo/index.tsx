/**
 * T25 — mode démo (build `vite build --mode demo`, apps/web/dist-demo/, servi par Vercel). Chargé
 * à la demande par src/main.tsx, seulement dans ce build : le build de production n'en contient
 * rien (scripts/demo.test.ts).
 *
 *   - Pas d'écran de connexion : la session de l'utilisateur fictif de la démo est posée sur le
 *     téléphone avant le premier rendu de l'appli (aucun jeton réel : la synchro n'est jamais
 *     branchée, le build n'a ni VITE_API_URL ni VITE_POWERSYNC_URL). Un vrai compte déjà connecté
 *     dans ce navigateur (même origine) n'est jamais remplacé : la démo le dit et s'arrête là,
 *     sans remplir de base (./session.ts).
 *   - Premier lancement (ou après « Réinitialiser la démo ») : la base locale est remplie avec la
 *     ferme fictive (./remplir.ts, chargé à la demande), datée par rapport au jour du téléphone.
 *     Ensuite, l'appli s'ouvre directement sur la base gardée : les saisies restent sur le
 *     téléphone.
 *   - Aucune requête vers l'API ni vers une autre origine : `fetch` les refuse (ceinture et
 *     bretelles, l'appli n'en lance pas sans URL de synchro).
 *   - Bandeau « Démo — données fictives » et bouton « Réinitialiser la démo » (./Bandeau.tsx).
 */
import './demo.css';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App.tsx';
import { stockageNavigateur } from '../connexion/session.ts';
import { baseLocaleExiste } from '../donnees/effacer.ts';
import { BandeauDemo, ConfirmationDemo } from './Bandeau.tsx';
import { CLE_REMPLIE, UTILISATEUR_DEMO } from './identite.ts';
import { poserSessionDemo, reinitialiserStockage } from './session.ts';

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

/** Un vrai compte est connecté dans ce navigateur : la démo ne démarre pas. */
class AutreCompte extends Error {}

/**
 * Session de la démo posée, base remplie si besoin. Une seule fois par page. Session d'un autre
 * compte déjà rangée : rien n'est écrit, aucune base remplie (AutreCompte).
 */
function preparer(): Promise<void> {
  return (preparation ??= (async () => {
    const stockage = stockageNavigateur();
    if (poserSessionDemo(stockage) === 'autre-compte') throw new AutreCompte();
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
  reinitialiserStockage(stockageNavigateur());
  location.reload();
}

type Etat = 'preparation' | 'prete' | 'echec' | 'autre-compte';

const MESSAGES: Readonly<Record<Exclude<Etat, 'prete'>, string>> = {
  preparation: 'Préparation de la ferme de démonstration…',
  echec: 'La ferme de démonstration n’a pas pu se préparer. Rechargez la page ; si cela recommence, réinitialisez la démo.',
  'autre-compte':
    'Ce navigateur est déjà connecté à un compte Planifications : la démo ne le remplace pas. Ouvrez la démo dans une fenêtre de navigation privée.',
};

function Demo() {
  const [etat, setEtat] = useState<Etat>('preparation');
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const aRendre = useRef(false);

  useEffect(() => {
    let actif = true;
    preparer().then(
      () => {
        if (actif) setEtat('prete');
      },
      (erreur: unknown) => {
        if (erreur instanceof AutreCompte) {
          if (actif) setEtat('autre-compte');
          return;
        }
        console.error('Démo impossible à préparer', erreur);
        if (actif) setEtat('echec');
      },
    );
    return () => {
      actif = false;
    };
  }, []);

  // Confirmation fermée : le focus revient au bouton « Réinitialiser la démo » (page de nouveau active).
  useEffect(() => {
    if (confirmer || !aRendre.current) return;
    aRendre.current = false;
    bouton.current?.focus();
  }, [confirmer]);

  const fermer = useCallback(() => {
    aRendre.current = true;
    setConfirmer(false);
  }, []);

  return (
    <div className="demo-cadre">
      <div className="demo-page" inert={confirmer}>
        <BandeauDemo
          bouton={bouton}
          enCours={enCours || etat === 'autre-compte'}
          surOuvrir={() => {
            setConfirmer(true);
          }}
        />
        <div className="demo-contenu">
          {etat === 'prete' ? (
            <App />
          ) : (
            <div className="demo-attente" data-etat={etat} role={etat === 'preparation' ? 'status' : 'alert'}>
              <h1>Planifications</h1>
              <p>{MESSAGES[etat]}</p>
            </div>
          )}
        </div>
      </div>
      {confirmer && (
        <ConfirmationDemo
          surAnnuler={fermer}
          surConfirmer={() => {
            setConfirmer(false);
            setEnCours(true);
            reinitialiser();
          }}
        />
      )}
    </div>
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
