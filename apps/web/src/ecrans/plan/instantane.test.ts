/**
 * Tests d'acceptation T11g, critère 2 — instantané du début du plan
 * (docs/backlog/T11g-plan-avant-base.md). Écrits par le testeur AVANT le module : ils sont rouges
 * tant que `./instantane.ts` et `./cle-instantane.ts` n'existent pas.
 *
 * API attendue, symétrique de l'instantané d'Aujourd'hui (../aujourdhui/instantane.ts, T13d,
 * T13l) :
 *
 *   ./cle-instantane.ts (seule dans son fichier : la déconnexion l'efface sans charger l'écran)
 *     cleInstantanePlan(utilisateurId: string): string
 *       — une clé par utilisateur, distincte de celle d'Aujourd'hui.
 *
 *   ./instantane.ts
 *     VERSION_INSTANTANE_PLAN: number
 *     type StockageInstantane = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
 *     interface VuePlan { readonly plan: Plan; readonly totalLignes: number }
 *       — le début du plan dessiné (PlanLu de ./cache.ts sans `complet`).
 *     interface InstantanePlan extends VuePlan { version; utilisateurId; fermeId }
 *     lireInstantanePlan(stockage, { utilisateurId, fermeId }): InstantanePlan | null
 *       — null si absent, illisible, autre version, autre ferme, autre utilisateur, session rangée
 *         d'un autre compte, stockage refusé ; ne lève jamais.
 *     garderInstantanePlan(stockage, { utilisateurId, fermeId }, vue: VuePlan): void
 *       — rien d'écrit si la session rangée n'est pas celle de cet utilisateur ; stockage plein ou
 *         refusé : ne lève pas.
 *
 *   connexion/deconnexion.ts : `deconnecter` retire aussi cleInstantanePlan(id), que l'API réponde
 *   ou non, même si l'effacement de la base échoue ; les clés d'un autre compte restent.
 *
 * Les tests ne supposent rien du format rangé, sinon que c'est un texte JSON.
 *
 *   P1  Témoin : gardé puis relu pour le même utilisateur et la même ferme, à l'identique.
 *   P2  Jamais pour une autre ferme.
 *   P3  Jamais pour un autre utilisateur : ni relu par lui, ni relu quand sa session est rangée,
 *       ni écrit quand la session rangée n'est pas la sienne, ni accepté recopié sous sa clé.
 *   P4  Illisible, autre version, stockage refusé ou plein : ignoré sans lever.
 *   P5  Remplacé par le plan relu : le dernier gardé gagne.
 *   P6  Effacé à la déconnexion (API joignable ou non, base qui refuse de s'effacer).
 */
import { describe, expect, it } from 'vitest';
import { deconnecter } from '../../connexion/deconnexion.ts';
import { CLE_SESSION, type SessionConnexion } from '../../connexion/session.ts';
import { cleInstantane } from '../aujourdhui/cle-instantane.ts';
import type { Plan } from './calculs.ts';
import { cleInstantanePlan } from './cle-instantane.ts';
import { garderInstantanePlan, lireInstantanePlan, type StockageInstantane, type VuePlan } from './instantane.ts';

const UTILISATEUR = '0192f0c1-11a0-7000-8000-000000000001';
const AUTRE_UTILISATEUR = '0192f0c1-11a0-7000-8000-00000000a001';
const FERME = '0192f0c1-11a0-7000-8000-0000000000f1';
const AUTRE_FERME = '0192f0c1-11a0-7000-8000-00000000a0f2';

const session = (utilisateurId: string): SessionConnexion => ({
  utilisateurId,
  email: `${utilisateurId.slice(-4)}@ferme.fr`,
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
});

interface StockageTest extends StockageInstantane {
  readonly valeurs: Map<string, string>;
}

/** Stockage en mémoire, de la forme de localStorage, avec la session de `connecte` rangée. */
function stockage(connecte: string | null = UTILISATEUR): StockageTest {
  const valeurs = new Map<string, string>();
  if (connecte !== null) valeurs.set(CLE_SESSION, JSON.stringify(session(connecte)));
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

function connecter(s: StockageTest, utilisateurId: string): void {
  s.valeurs.set(CLE_SESSION, JSON.stringify(session(utilisateurId)));
}

/** Début de plan : une zone, deux planches, une barre. */
function vue(libelle = 'Tomate Cœur de bœuf'): VuePlan {
  const plan: Plan = {
    saison: { id: '0192f0c1-11a0-7000-8000-0000000000s1', nom: '2026', debut: '2026-01-01', fin: '2026-12-31' },
    semaines: [
      { annee: 2026, semaine: 41, libelle: 'S41', lundi: '2026-10-05' },
      { annee: 2026, semaine: 42, libelle: 'S42', lundi: '2026-10-12' },
    ],
    semaineCourante: 42,
    lignes: [
      { sorte: 'zone', id: 'z1', nom: 'Serre 1' },
      {
        sorte: 'emplacement',
        id: 'e1',
        code: 'S1-P01',
        zoneId: 'z1',
        chapelleId: null,
        longueurM: 30,
        largeurM: 0.8,
        barres: [
          {
            occupationId: 'o1',
            serieId: 's1',
            plantationId: null,
            libelle,
            famille: 'Solanacées',
            cleFamille: null,
            etat: 'prevu',
            du: '2026-10-05',
            au: '2026-10-25',
            debutJour: 0,
            finJour: 20,
            enConflit: false,
          },
        ],
        conflits: [],
      },
      { sorte: 'emplacement', id: 'e2', code: 'S1-P02', zoneId: 'z1', chapelleId: null, longueurM: 30, largeurM: null, barres: [], conflits: [] },
    ],
  };
  return { plan, totalLignes: 400 };
}

const ids = { utilisateurId: UTILISATEUR, fermeId: FERME } as const;

describe('T11g P1 — témoin', () => {
  it('gardé puis relu pour le même utilisateur et la même ferme : le même début de plan', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    const lu = lireInstantanePlan(s, ids);
    expect(lu).not.toBeNull();
    expect(lu?.plan).toEqual(vue().plan);
    expect(lu?.totalLignes).toBe(400);
    expect(lu?.utilisateurId).toBe(UTILISATEUR);
    expect(lu?.fermeId).toBe(FERME);
  });

  it('rien de gardé : null', () => {
    expect(lireInstantanePlan(stockage(), ids)).toBeNull();
  });

  it('une clé par utilisateur, distincte de celle d’Aujourd’hui', () => {
    expect(cleInstantanePlan(UTILISATEUR)).not.toBe(cleInstantane(UTILISATEUR));
    expect(cleInstantanePlan(UTILISATEUR)).not.toBe(cleInstantanePlan(AUTRE_UTILISATEUR));
    expect(cleInstantanePlan(UTILISATEUR)).toContain(UTILISATEUR);
  });

  it('garder le plan ne touche pas l’instantané d’Aujourd’hui', () => {
    const s = stockage();
    s.valeurs.set(cleInstantane(UTILISATEUR), '{"version":1}');
    garderInstantanePlan(s, ids, vue());
    expect(s.valeurs.get(cleInstantane(UTILISATEUR))).toBe('{"version":1}');
  });
});

describe('T11g P2 — jamais pour une autre ferme', () => {
  it('gardé pour une ferme, demandé pour une autre : null', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    expect(lireInstantanePlan(s, { utilisateurId: UTILISATEUR, fermeId: AUTRE_FERME })).toBeNull();
  });
});

describe('T11g P3 — jamais montré à un autre utilisateur', () => {
  it('gardé par un utilisateur, demandé par un autre (sa session rangée) : null', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    connecter(s, AUTRE_UTILISATEUR);
    expect(lireInstantanePlan(s, { utilisateurId: AUTRE_UTILISATEUR, fermeId: FERME })).toBeNull();
  });

  it('session rangée d’un autre compte (connecté dans un autre onglet) : l’instantané du premier n’est plus rendu', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    connecter(s, AUTRE_UTILISATEUR);
    expect(lireInstantanePlan(s, ids)).toBeNull();
  });

  it('aucune session rangée (déconnecté) : null', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    s.valeurs.delete(CLE_SESSION);
    expect(lireInstantanePlan(s, ids)).toBeNull();
  });

  it('session rangée d’un autre compte : rien n’est écrit', () => {
    const s = stockage(AUTRE_UTILISATEUR);
    garderInstantanePlan(s, ids, vue());
    expect([...s.valeurs.keys()]).toEqual([CLE_SESSION]);
  });

  it('instantané d’un utilisateur recopié sous la clé d’un autre : refusé', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    const brut = s.valeurs.get(cleInstantanePlan(UTILISATEUR));
    expect(brut).toBeDefined();
    s.valeurs.set(cleInstantanePlan(AUTRE_UTILISATEUR), brut ?? '');
    connecter(s, AUTRE_UTILISATEUR);
    expect(lireInstantanePlan(s, { utilisateurId: AUTRE_UTILISATEUR, fermeId: FERME })).toBeNull();
  });
});

describe('T11g P4 — illisible, autre version, stockage refusé ou plein', () => {
  it('texte illisible, JSON qui n’est pas un objet, champs manquants : null sans lever', () => {
    for (const brut of ['{pas du json', 'null', '[]', '42', '{}', JSON.stringify({ utilisateurId: UTILISATEUR, fermeId: FERME })]) {
      const s = stockage();
      s.valeurs.set(cleInstantanePlan(UTILISATEUR), brut);
      expect(lireInstantanePlan(s, ids), brut).toBeNull();
    }
  });

  it('autre version de format : ignoré', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    const lu: unknown = JSON.parse(s.valeurs.get(cleInstantanePlan(UTILISATEUR)) ?? 'null');
    expect(typeof lu === 'object' && lu !== null && 'version' in lu).toBe(true);
    const autre = { ...(lu as Record<string, unknown>), version: 9_999 };
    s.valeurs.set(cleInstantanePlan(UTILISATEUR), JSON.stringify(autre));
    expect(lireInstantanePlan(s, ids)).toBeNull();
  });

  it('lignes abîmées (barre sans occupation) : ignoré', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    const brut = s.valeurs.get(cleInstantanePlan(UTILISATEUR)) ?? '';
    s.valeurs.set(cleInstantanePlan(UTILISATEUR), brut.replace('"occupationId":"o1"', '"occupationId":17'));
    expect(lireInstantanePlan(s, ids)).toBeNull();
  });

  it('stockage qui lève partout : ni lecture ni écriture ne lèvent', () => {
    const leve = (): never => {
      throw new Error('SecurityError');
    };
    const s: StockageInstantane = { getItem: leve, setItem: leve, removeItem: leve };
    expect(() => {
      garderInstantanePlan(s, ids, vue());
    }).not.toThrow();
    expect(lireInstantanePlan(s, ids)).toBeNull();
  });

  it('stockage plein : garder ne lève pas, et l’ancien instantané n’est plus rendu périmé', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue('Ancien'));
    const plein: StockageInstantane = {
      getItem: s.getItem,
      removeItem: s.removeItem,
      setItem: (c, v) => {
        if (c === cleInstantanePlan(UTILISATEUR)) throw new Error('QuotaExceededError');
        s.setItem(c, v);
      },
    };
    expect(() => {
      garderInstantanePlan(plein, ids, vue('Nouveau'));
    }).not.toThrow();
    const lu = lireInstantanePlan(s, ids);
    expect(lu === null || JSON.stringify(lu.plan).includes('Nouveau')).toBe(true);
  });
});

describe('T11g P5 — remplacé par le plan relu', () => {
  it('le dernier début gardé (plan relu) remplace le précédent', () => {
    const s = stockage();
    garderInstantanePlan(s, ids, vue('Avant relecture'));
    garderInstantanePlan(s, ids, vue('Après relecture'));
    const lu = lireInstantanePlan(s, ids);
    expect(lu?.plan).toEqual(vue('Après relecture').plan);
    expect(JSON.stringify(lu)).not.toContain('Avant relecture');
  });
});

describe('T11g P6 — effacé à la déconnexion', () => {
  const reponse = (): Promise<Response> => Promise.resolve(new Response(null, { status: 204 }));
  const horsLigne = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

  async function deconnexion(o: { readonly fetch: () => Promise<Response>; readonly echecBase?: boolean }): Promise<StockageTest> {
    const s = stockage();
    garderInstantanePlan(s, ids, vue());
    // Instantané de l'autre compte du téléphone, rangé directement (sa session n'est pas active).
    s.valeurs.set(cleInstantanePlan(AUTRE_UTILISATEUR), '{"version":1}');
    expect(s.valeurs.has(cleInstantanePlan(UTILISATEUR))).toBe(true);
    const fin = deconnecter(session(UTILISATEUR), {
      urlApi: 'https://api',
      fetch: () => o.fetch(),
      stockage: s,
      effacerBaseLocale: () => (o.echecBase === true ? Promise.reject(new Error('base locale verrouillée')) : Promise.resolve()),
      delaiMs: 50,
    });
    if (o.echecBase === true) await expect(fin).rejects.toThrow();
    else await fin;
    return s;
  }

  it('API joignable : l’instantané du plan est effacé', async () => {
    const s = await deconnexion({ fetch: reponse });
    expect(s.valeurs.has(cleInstantanePlan(UTILISATEUR))).toBe(false);
  });

  it('hors ligne : effacé quand même', async () => {
    const s = await deconnexion({ fetch: horsLigne });
    expect(s.valeurs.has(cleInstantanePlan(UTILISATEUR))).toBe(false);
  });

  it('effacement de la base en échec : effacé quand même', async () => {
    const s = await deconnexion({ fetch: reponse, echecBase: true });
    expect(s.valeurs.has(cleInstantanePlan(UTILISATEUR))).toBe(false);
  });

  it('après déconnexion, plus rien n’est rendu pour cet utilisateur', async () => {
    const s = await deconnexion({ fetch: reponse });
    expect(lireInstantanePlan(s, ids)).toBeNull();
  });

  it('l’instantané d’un autre compte du téléphone n’est pas touché', async () => {
    const s = await deconnexion({ fetch: reponse });
    expect(s.valeurs.get(cleInstantanePlan(AUTRE_UTILISATEUR))).toBe('{"version":1}');
  });
});
