/**
 * T64 (développeur) : un « Fait » écrit quitte l'instantané rangé tout de suite (`retirerDeInstantane`),
 * sans attendre la journée relue. Compteurs tenus, saisie en tête de l'historique (une fois),
 * « Fait » en attente gardés ; rien pour un autre compte ni une autre ferme.
 */
import { describe, expect, it } from 'vitest';
import { CLE_SESSION } from '../../connexion/session.ts';
import { cleInstantane } from './cle-instantane.ts';
import { lireFaitsEnAttente, lireInstantane, noterFaitsEnAttente, remettreDansInstantane, retirerDeInstantane, VERSION_INSTANTANE, type StockageInstantane } from './instantane.ts';
import type { CarteVue, SaisieVue } from './vues.ts';

const U = 'u-1';
const ids = { utilisateurId: U, fermeId: 'f' };
const attendu = { ...ids, jour: '2026-09-30' };

function stockage(connecte: string): StockageInstantane & { readonly valeurs: Map<string, string> } {
  const valeurs = new Map<string, string>([
    [CLE_SESSION, JSON.stringify({ utilisateurId: connecte, email: 'a@b.fr', jetonAcces: 'a.b.c', jetonRenouvellement: 'r'.repeat(43) })],
  ]);
  return {
    valeurs,
    getItem: (c) => valeurs.get(c) ?? null,
    setItem: (c, v) => {
      valeurs.set(c, v);
    },
    removeItem: (c) => {
      valeurs.delete(c);
    },
  };
}

const carte = (cle: string, retard: boolean, travail: boolean, minutes: number | null): CarteVue => ({
  cle,
  retard,
  joursRetard: retard ? 2 : 0,
  surtitre: 'S',
  titre: 'T',
  detail: 'D',
  codes: null,
  minutes,
  bande: 'legume',
  travail,
  peser: false,
  action: 'semer',
});
const saisie = (id: string): SaisieVue => ({ id, type: 'realise', quoi: 'Semis', culture: 'Carotte', quand: 'Aujourd’hui', nom: 'Semis carotte', retiree: false });

const instantane = {
  version: VERSION_INSTANTANE,
  ...attendu,
  semaine: 40,
  taches: [carte('a:semis_direct', true, false, null), carte('b:travail:1:2026-09-30', false, true, 30), carte('c:plantation', false, false, null)],
  retard: 1,
  cetteSemaine: 2,
  recoltes: 0,
  charge: 30,
  historique: [saisie('e-1')],
  saisies: 1,
};

function avec(connecte = U) {
  const s = stockage(connecte);
  s.setItem(cleInstantane(U), JSON.stringify(instantane));
  return s;
}

describe('T64 : « Fait » écrit retiré de l’instantané rangé', () => {
  it('tâche en retard : retirée, compteur « en retard » décompté, saisie en tête', () => {
    const s = avec();
    retirerDeInstantane(s, ids, 'a:semis_direct', saisie('e-2'), 20);
    const i = lireInstantane(s, attendu);
    expect(i?.taches.map((c) => c.cle)).toEqual(['b:travail:1:2026-09-30', 'c:plantation']);
    expect([i?.retard, i?.cetteSemaine, i?.charge]).toEqual([0, 2, 30]);
    expect(i?.historique.map((h) => h.id)).toEqual(['e-2', 'e-1']);
    expect(i?.saisies).toBe(2);
  });

  it('travail de la semaine : sa charge part aussi ; historique borné à `max`', () => {
    const s = avec();
    retirerDeInstantane(s, ids, 'b:travail:1:2026-09-30', saisie('e-2'), 1);
    const i = lireInstantane(s, attendu);
    expect([i?.retard, i?.cetteSemaine, i?.charge]).toEqual([1, 1, 0]);
    expect(i?.historique.map((h) => h.id)).toEqual(['e-2']);
  });

  it('déjà noté (aucune saisie) : retirée, historique inchangé ; saisie déjà là : pas en double', () => {
    const s = avec();
    retirerDeInstantane(s, ids, 'c:plantation', null, 20);
    retirerDeInstantane(s, ids, 'a:semis_direct', saisie('e-1'), 20);
    const i = lireInstantane(s, attendu);
    expect(i?.taches.map((c) => c.cle)).toEqual(['b:travail:1:2026-09-30']);
    expect(i?.historique.map((h) => h.id)).toEqual(['e-1']);
    expect(i?.saisies).toBe(1);
  });

  it('garde les « Fait » d’avant la base encore en attente', () => {
    const s = avec();
    noterFaitsEnAttente(s, U, 2);
    retirerDeInstantane(s, ids, 'a:semis_direct', saisie('e-2'), 20);
    expect(lireFaitsEnAttente(s, U)).toBe(2);
  });

  it('rien pour un autre compte connecté, une autre ferme, une tâche absente ou un instantané illisible', () => {
    const brut = JSON.stringify(instantane);
    const autreCompte = avec('u-2');
    retirerDeInstantane(autreCompte, ids, 'a:semis_direct', saisie('e-2'), 20);
    expect(autreCompte.getItem(cleInstantane(U))).toBe(brut);
    const s = avec();
    retirerDeInstantane(s, { utilisateurId: U, fermeId: 'autre' }, 'a:semis_direct', saisie('e-2'), 20);
    retirerDeInstantane(s, ids, 'z:semis_direct', null, 20);
    expect(s.getItem(cleInstantane(U))).toBe(brut);
    s.setItem(cleInstantane(U), '{pas du json');
    retirerDeInstantane(s, ids, 'a:semis_direct', saisie('e-2'), 20);
    expect(s.getItem(cleInstantane(U))).toBe('{pas du json');
  });
});

describe('T64 (relecture) : stockage plein, « Fait » annulé', () => {
  it('plein : la carte part quand même (l’enregistrement raccourcit), sans la saisie en tête', () => {
    const s = avec();
    const ecrire = s.setItem;
    const brut = s.getItem(cleInstantane(U)) ?? '';
    // Quota : refuse tout enregistrement plus long que l'actuel.
    s.setItem = (c, v) => {
      if (v.length > brut.length) throw new DOMException('plein', 'QuotaExceededError');
      ecrire(c, v);
    };
    retirerDeInstantane(s, ids, 'a:semis_direct', saisie('e-2'.repeat(200)), 20);
    const i = lireInstantane(s, attendu);
    expect(i?.taches.map((c) => c.cle)).toEqual(['b:travail:1:2026-09-30', 'c:plantation']);
    expect(i?.historique.map((h) => h.id)).toEqual(['e-1']);
    expect(i?.saisies).toBe(1);
  });

  it('refusé : aucune exception, l’instantané reste lisible', () => {
    const s = avec();
    s.setItem = () => {
      throw new DOMException('refusé', 'SecurityError');
    };
    expect(() => {
      retirerDeInstantane(s, ids, 'a:semis_direct', saisie('e-2'), 20);
    }).not.toThrow();
    expect(lireInstantane(s, attendu)?.taches).toHaveLength(3);
  });

  it('annulé : la carte retirée revient à sa place, compteurs et historique rétablis', () => {
    const s = avec();
    const retiree = retirerDeInstantane(s, ids, 'b:travail:1:2026-09-30', saisie('e-2'), 20);
    expect(retiree?.carte.cle).toBe('b:travail:1:2026-09-30');
    if (retiree === null) return;
    remettreDansInstantane(s, ids, retiree, 'e-2');
    const i = lireInstantane(s, attendu);
    expect(i?.taches.map((c) => c.cle)).toEqual(['a:semis_direct', 'b:travail:1:2026-09-30', 'c:plantation']);
    expect([i?.retard, i?.cetteSemaine, i?.charge]).toEqual([1, 2, 30]);
    expect(i?.historique.map((h) => h.id)).toEqual(['e-1']);
    expect(i?.saisies).toBe(1);
  });

  it('annulé : rien si la carte est déjà revenue (journée relue), autre compte ou autre ferme', () => {
    const s = avec();
    const retiree = retirerDeInstantane(s, ids, 'a:semis_direct', null, 20);
    if (retiree === null) throw new Error('carte retirée attendue');
    s.setItem(cleInstantane(U), JSON.stringify(instantane));
    remettreDansInstantane(s, ids, retiree, null);
    expect(lireInstantane(s, attendu)?.taches).toHaveLength(3);
    remettreDansInstantane(s, { utilisateurId: U, fermeId: 'autre' }, { ...retiree, carte: { ...retiree.carte, cle: 'x:semis_direct' } }, null);
    expect(lireInstantane(s, attendu)?.taches).toHaveLength(3);
    const autre = avec('u-2');
    remettreDansInstantane(autre, ids, { ...retiree, carte: { ...retiree.carte, cle: 'x:semis_direct' } }, null);
    expect(autre.getItem(cleInstantane(U))).toBe(JSON.stringify(instantane));
  });
});
