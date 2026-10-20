// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
/**
 * T66 — aide de préchargement de l'appli (./aide.ts, ./complet.ts), servie par vite.config.ts à la
 * place de celle de Vite. Même comportement que l'aide de Vite 8 :
 *   - sans dépendance : l'import tel quel, aucun lien posé ;
 *   - avec dépendances : un lien par fichier, une seule fois par page (modulepreload pour le
 *     JavaScript, stylesheet pour une feuille de style, attendue avant l'import), rien pour un
 *     fichier déjà cité par la page ;
 *   - tout échec lance `vite:preloadError` (annulable, l'erreur dans `payload`) : annulé, l'import
 *     rend `undefined` (la page se recharge, rechargement.ts) ; sinon l'erreur suit son cours.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prechargerLeger, signalerEchec } from './aide.ts';

/**
 * Liens posés par l'aide (`document.head.appendChild`), retenus ici sans être attachés : happy-dom
 * chargerait la feuille de style aussitôt ; le test décide quand elle se charge, ou échoue.
 */
let poses: HTMLLinkElement[] = [];
beforeEach(() => {
  poses = [];
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(n: T): T => {
    if (n instanceof HTMLLinkElement) poses.push(n);
    return n;
  });
});

const ecoutes: ((e: Event) => void)[] = [];
function ecouter(f: (e: Event) => void): void {
  ecoutes.push(f);
  window.addEventListener('vite:preloadError', f);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const f of ecoutes.splice(0)) window.removeEventListener('vite:preloadError', f);
  for (const l of document.head.querySelectorAll('link')) l.remove();
});

const liens = (): { rel: string; href: string; as: string; crossOrigin: string | null }[] =>
  poses.map((l) => ({ rel: l.rel, href: new URL(l.href).pathname, as: l.as, crossOrigin: l.crossOrigin }));

/** Les feuilles de style posées se chargent (ou échouent). */
function chargerFeuilles(evenement: 'load' | 'error'): void {
  for (const l of poses) if (l.rel === 'stylesheet') l.dispatchEvent(new Event(evenement));
}

describe('sans dépendance', () => {
  it('l’import part tel quel, sans lien posé', async () => {
    const charger = vi.fn(() => Promise.resolve({ ok: 1 }));
    await expect(prechargerLeger(charger, [])).resolves.toEqual({ ok: 1 });
    await expect(prechargerLeger(charger)).resolves.toEqual({ ok: 1 });
    expect(charger).toHaveBeenCalledTimes(2);
    expect(liens()).toEqual([]);
  });

  it('échec : vite:preloadError lancé avec l’erreur ; non annulé, l’erreur suit son cours', async () => {
    const recus: unknown[] = [];
    ecouter((e) => recus.push((e as Event & { payload?: unknown }).payload));
    const erreur = new TypeError('Failed to fetch dynamically imported module');
    await expect(prechargerLeger(() => Promise.reject(erreur), [])).rejects.toBe(erreur);
    expect(recus).toEqual([erreur]);
  });

  it('échec annulé (la page se recharge) : l’import rend undefined', async () => {
    ecouter((e) => {
      e.preventDefault();
    });
    await expect(prechargerLeger(() => Promise.reject(new Error('absent')), [])).resolves.toBeUndefined();
  });

  it('signalerEchec : l’événement est annulable', () => {
    let annulable = false;
    ecouter((e) => {
      annulable = e.cancelable;
      e.preventDefault();
    });
    signalerEchec(new Error('x'));
    expect(annulable).toBe(true);
  });
});

describe('avec dépendances (aide complète)', () => {
  it('modulepreload pour le JavaScript, stylesheet pour le CSS ; l’import attend la feuille de style', async () => {
    let importe = false;
    const promesse = prechargerLeger(
      () => {
        importe = true;
        return Promise.resolve('écran');
      },
      ['assets/ecran-a.js', 'assets/commun-b.js', 'assets/ecran-a.css'],
    );
    await vi.waitFor(() => {
      expect(liens().length).toBe(3);
    });
    expect(liens()).toEqual([
      { rel: 'modulepreload', href: '/assets/ecran-a.js', as: 'script', crossOrigin: '' },
      { rel: 'modulepreload', href: '/assets/commun-b.js', as: 'script', crossOrigin: '' },
      { rel: 'stylesheet', href: '/assets/ecran-a.css', as: '', crossOrigin: '' },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    expect(importe, 'import lancé avant la feuille de style').toBe(false);
    chargerFeuilles('load');
    await expect(promesse).resolves.toBe('écran');
  });

  it('un fichier déjà demandé, ou déjà cité par la page, n’a pas de second lien', async () => {
    const present = document.createElement('link');
    present.rel = 'stylesheet';
    present.href = '/assets/index-x.css';
    // Attachée pour de bon (méthode du prototype, hors de l'espion) : citée par la page.
    Node.prototype.appendChild.call(document.head, present);
    const p1 = prechargerLeger(() => Promise.resolve(1), ['assets/page-c.js', 'assets/index-x.css']);
    await expect(p1).resolves.toBe(1);
    const p2 = prechargerLeger(() => Promise.resolve(2), ['assets/page-c.js']);
    await expect(p2).resolves.toBe(2);
    expect(liens().map((l) => l.href), 'seul page-c.js est demandé, une fois').toEqual(['/assets/page-c.js']);
  });

  it('feuille de style introuvable : vite:preloadError ; non annulé, l’import échoue sans être lancé', async () => {
    const recus: unknown[] = [];
    ecouter((e) => recus.push((e as Event & { payload?: unknown }).payload));
    const charger = vi.fn(() => Promise.resolve('écran'));
    const promesse = prechargerLeger(charger, ['assets/ecran-d.css']);
    await vi.waitFor(() => {
      expect(liens().length).toBe(1);
    });
    chargerFeuilles('error');
    await expect(promesse).rejects.toThrow(/ecran-d\.css/);
    expect(recus).toHaveLength(1);
    expect(charger).not.toHaveBeenCalled();
  });

  it('import qui échoue après les préchargements : vite:preloadError, annulé → undefined', async () => {
    ecouter((e) => {
      e.preventDefault();
    });
    await expect(prechargerLeger(() => Promise.reject(new Error('absent')), ['assets/ecran-e.js'])).resolves.toBeUndefined();
  });
});
