/**
 * Tests d'acceptation T09b (3e relecture) — un autre onglet se déconnecte : cet onglet le sait.
 *
 * Sans cela, un onglet resté ouvert (ou la page de diagnostic) garde l'appli du compte déconnecté
 * à l'écran et accepte encore des saisies, alors que la session n'existe plus nulle part.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/connexion/session.ts (réexporté par connexion/index.ts), sans PowerSync ni jose :
 *
 *   surveillerSession(options: {
 *     readonly cible: Pick<Window, 'addEventListener' | 'removeEventListener'>;  // window
 *     readonly stockage: Pick<Storage, 'getItem'>;                                // localStorage
 *     readonly utilisateurId: string;          // l'utilisateur connecté dans cet onglet
 *     readonly surFin: () => void;             // bascule sur l'écran de connexion
 *   }): () => void                              // arrête la surveillance
 *
 *   - écoute l'événement `storage` de `cible` (le navigateur ne l'envoie qu'aux AUTRES onglets) ;
 *   - un événement dont `key` vaut CLE_SESSION ('planif.session'), ou null (localStorage.clear()),
 *     fait relire la session (lireSession(stockage) ; `newValue` de l'événement concorde) :
 *       · session absente ou illisible (déconnexion ailleurs) → surFin() ;
 *       · session d'un AUTRE utilisateur → surFin() ;
 *       · même utilisateur (jetons tournés par l'autre onglet, écart d'horloge…) → rien ;
 *   - un événement sur une autre clé → rien ;
 *   - surFin est appelé une fois au plus ; après l'arrêt (fonction rendue), plus rien.
 *
 * App (apps/web/src/App.tsx) : tant qu'une session est affichée, surveillerSession(window,
 * localStorage, session.utilisateurId, …) ; surFin → la session en mémoire est oubliée, l'écran
 * de connexion s'affiche, plus aucune saisie du compte (bouton « Se déconnecter » compris).
 * Vérifié à deux pages dans e2e/deconnexion.e2e.ts.
 */
import { describe, expect, it } from 'vitest';
import { CLE_SESSION, type SessionConnexion } from './index.ts';

interface OptionsSurveillance {
  readonly cible: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly stockage: Pick<Storage, 'getItem'>;
  readonly utilisateurId: string;
  readonly surFin: () => void;
}

/** Ajout de la 3e relecture, lu à part : son absence fait échouer ces tests, pas le typage. */
async function surveillerSession(options: OptionsSurveillance): Promise<() => void> {
  const module: Readonly<Record<string, unknown>> = await import('./index.ts');
  const f = module.surveillerSession;
  if (typeof f !== 'function') throw new Error('surveillerSession absente de connexion/index.ts');
  return (f as (o: OptionsSurveillance) => () => void)(options);
}

const SESSION: SessionConnexion = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

/** Fenêtre et localStorage simulés : `ecrireAilleurs` imite une écriture faite par un autre onglet. */
function deuxOnglets(initiale: SessionConnexion | null = SESSION) {
  const cible = new EventTarget();
  const valeurs = new Map<string, string>();
  if (initiale !== null) valeurs.set(CLE_SESSION, JSON.stringify(initiale));
  let ecouteurs = 0;
  const fenetre: Pick<Window, 'addEventListener' | 'removeEventListener'> = {
    addEventListener: (type: string, ecouteur: EventListenerOrEventListenerObject | null) => {
      if (type === 'storage') ecouteurs += 1;
      cible.addEventListener(type, ecouteur);
    },
    removeEventListener: (type: string, ecouteur: EventListenerOrEventListenerObject | null) => {
      if (type === 'storage') ecouteurs -= 1;
      cible.removeEventListener(type, ecouteur);
    },
  } as Pick<Window, 'addEventListener' | 'removeEventListener'>;
  const stockage = { getItem: (c: string) => valeurs.get(c) ?? null };

  /** L'autre onglet écrit (ou efface : null) `cle` ; cet onglet reçoit l'événement `storage`. */
  function ecrireAilleurs(cle: string | null, valeur: string | null): void {
    const ancienne = cle === null ? null : (valeurs.get(cle) ?? null);
    if (cle === null) valeurs.clear();
    else if (valeur === null) valeurs.delete(cle);
    else valeurs.set(cle, valeur);
    cible.dispatchEvent(Object.assign(new Event('storage'), { key: cle, oldValue: ancienne, newValue: valeur }));
  }

  return { fenetre, stockage, ecrireAilleurs, ecouteurs: () => ecouteurs };
}

async function surveiller(o: ReturnType<typeof deuxOnglets>) {
  let fins = 0;
  const arreter = await surveillerSession({
    cible: o.fenetre,
    stockage: o.stockage,
    utilisateurId: SESSION.utilisateurId,
    surFin: () => {
      fins += 1;
    },
  });
  return { arreter, fins: () => fins };
}

describe('T09b, 3e relecture : déconnexion dans un autre onglet', () => {
  it('écoute l’événement storage, et arrête d’écouter quand on le lui demande', async () => {
    const o = deuxOnglets();
    const s = await surveiller(o);
    expect(o.ecouteurs()).toBe(1);
    s.arreter();
    expect(o.ecouteurs()).toBe(0);
  });

  it('session effacée dans un autre onglet (déconnexion) → surFin, une seule fois', async () => {
    const o = deuxOnglets();
    const s = await surveiller(o);
    o.ecrireAilleurs(CLE_SESSION, null);
    expect(s.fins()).toBe(1);
    // Événements suivants (reconnexion puis nouvelle déconnexion ailleurs) : pas de second appel.
    o.ecrireAilleurs(CLE_SESSION, JSON.stringify({ ...SESSION, utilisateurId: 'autre' }));
    o.ecrireAilleurs(CLE_SESSION, null);
    expect(s.fins()).toBe(1);
  });

  it('localStorage vidé ailleurs (clear : key null) → surFin', async () => {
    const o = deuxOnglets();
    const s = await surveiller(o);
    o.ecrireAilleurs(null, null);
    expect(s.fins()).toBe(1);
  });

  it('un autre utilisateur se connecte dans un autre onglet → surFin', async () => {
    const o = deuxOnglets();
    const s = await surveiller(o);
    o.ecrireAilleurs(CLE_SESSION, JSON.stringify({ ...SESSION, utilisateurId: '0192f0c1-0000-7000-8000-000000000002', email: 'autre@ferme.fr' }));
    expect(s.fins()).toBe(1);
  });

  it('session devenue illisible ou incomplète → surFin', async () => {
    for (const valeur of ['{pas du json', JSON.stringify({ utilisateurId: SESSION.utilisateurId })]) {
      const o = deuxOnglets();
      const s = await surveiller(o);
      o.ecrireAilleurs(CLE_SESSION, valeur);
      expect(s.fins(), valeur).toBe(1);
    }
  });

  it('même utilisateur, jetons tournés par l’autre onglet (renouvellement) → rien', async () => {
    const o = deuxOnglets();
    const s = await surveiller(o);
    o.ecrireAilleurs(CLE_SESSION, JSON.stringify({ ...SESSION, jetonAcces: 'x.y.z', jetonRenouvellement: 'n'.repeat(43), ecartHorlogeMs: 1200 }));
    expect(s.fins()).toBe(0);
  });

  it('autre clé (marqueur d’effacement, clé étrangère) → rien', async () => {
    const o = deuxOnglets();
    const s = await surveiller(o);
    o.ecrireAilleurs('planif.effacement-en-attente', JSON.stringify(['x']));
    o.ecrireAilleurs('autre.cle', null);
    expect(s.fins()).toBe(0);
  });

  it('après l’arrêt, une déconnexion ailleurs ne déclenche plus rien', async () => {
    const o = deuxOnglets();
    const s = await surveiller(o);
    s.arreter();
    o.ecrireAilleurs(CLE_SESSION, null);
    expect(s.fins()).toBe(0);
  });
});
