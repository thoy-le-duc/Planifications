// @vitest-environment happy-dom
/**
 * T13u — le préchargement du plan cède à une saisie en cours.
 *
 * La base locale n'a qu'une connexion : une lecture partie passe devant tout ce qui arrive après
 * elle. Au lancement, le préchargement du plan de Planches (`prechargerPlan`, lancé par App.tsx
 * dès la base ouverte) tenait la base pendant le premier « Fait » d'Aujourd'hui. Désormais :
 *
 *   1. `cederAuxSaisies` attend qu'aucune écriture ne soit en cours (compteur global de
 *      `donnees/ecritures-en-cours.ts`, lu sur <html data-saisie-en-cours>), CESSION_MAX_MS au
 *      plus ;
 *   2. `porteQuiCede` : au plus LECTURES_EN_VOL lectures parties à la fois, chacune après
 *      `ceder()` ; pressée, plus aucune attente ni limite ;
 *   3. `prechargerPlan` lit par cette porte, en petites requêtes (DECOUPE_FOND) : aucune lecture
 *      ne part tant qu'une écriture est en cours ; l'écran Planches qui attend le début du plan
 *      presse le préchargement (il n'attend pas la fin de l'écriture) ;
 *   4. la découpe ne change pas les données lues.
 *
 * Banc : la ferme de T07 (400 emplacements, 3 000 occupations) dans la base mémoire de
 * @planif/sync, lue par une porte espion (chaque test a la sienne : le cache du plan est par
 * porte).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07, type JeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import { commencerEcriture } from '../../donnees/ecritures-en-cours.ts';
import {
  CESSION_MAX_MS,
  cederAuxSaisies,
  EMPLACEMENTS_DU_DEBUT,
  LECTURES_EN_VOL,
  obtenirDebutDePlan,
  obtenirSaisons,
  planEnCache,
  porteQuiCede,
  prechargerPlan,
} from './cache.ts';
import { DECOUPE_FOND, lireDebutDePlan, saisonParDefaut, type DonneesDebutDePlan } from './calculs.ts';

const AUJOURDHUI = '2026-09-30';

let base: BaseMemoire;
let porte: PorteDonnees;
let jeu: JeuT07;
const fins: (() => void)[] = [];

beforeAll(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  jeu = await remplirJeuT07(base);
  porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
}, 120_000);

afterAll(() => {
  base.fermer();
});

afterEach(() => {
  for (const fin of fins.splice(0)) fin();
  vi.useRealTimers();
});

/** Écriture comptée par le compteur global, terminée au plus tard à la fin du test. */
function ecriture(): () => void {
  const fin = commencerEcriture();
  fins.push(fin);
  return fin;
}

interface Espion {
  readonly porte: PorteDonnees;
  /** Requêtes parties vers la base, dans l'ordre. */
  readonly parties: string[];
  /** Plus grand nombre de lectures parties et pas encore rendues. */
  maxEnVol: number;
}

/** Porte espion sur la porte du banc ; `retard` : ms avant de lire (lectures qui durent). */
function espion(retard = 0): Espion {
  const e: Espion = {
    parties: [],
    maxEnVol: 0,
    porte: {
      ...porte,
      lire: async <T>(sql: string, parametres?: readonly unknown[]) => {
        e.parties.push(sql.replace(/\s+/g, ' ').trim());
        enVol += 1;
        e.maxEnVol = Math.max(e.maxEnVol, enVol);
        try {
          if (retard > 0) await attendre(retard);
          return await porte.lire<T>(sql, parametres);
        } finally {
          enVol -= 1;
        }
      },
    },
  };
  let enVol = 0;
  return e;
}

const attendre = (ms: number) =>
  new Promise<void>((tenir) => {
    setTimeout(tenir, ms);
  });

/** Laisse passer les promesses en cours (plusieurs tours de la boucle). */
const laisserPasser = () => attendre(30);

/** Données comparables quel que soit l'ordre de lecture : id triés de chaque table. */
function comparables(d: DonneesDebutDePlan): Record<string, string[]> {
  const ids = (l: readonly Readonly<Record<string, unknown>>[]) => l.map((x) => String(x.id)).sort();
  return {
    zone: ids(d.zone),
    emplacement: ids(d.emplacement),
    structure: ids(d.structure.emplacement),
    occupation: ids(d.occupation),
    serie: ids(d.serie),
    plantation: ids(d.plantation),
    batiment: ids(d.batiment ?? []),
    espece: ids(d.espece),
    variete: ids(d.variete),
    famille: ids(d.famille),
  };
}

describe('T13u : cederAuxSaisies', () => {
  it('rend la main tout de suite quand aucune écriture n’est en cours', async () => {
    let rendu = false;
    void cederAuxSaisies().then(() => {
      rendu = true;
    });
    await Promise.resolve();
    expect(rendu).toBe(true);
  });

  it('attend la fin de l’écriture en cours, puis rend la main', async () => {
    const fin = ecriture();
    let rendu = false;
    void cederAuxSaisies().then(() => {
      rendu = true;
    });
    await laisserPasser();
    expect(rendu, 'écriture en cours : le préchargement attend').toBe(false);
    fin();
    await laisserPasser();
    expect(rendu, 'écriture terminée : il reprend').toBe(true);
  });

  it('une écriture qui ne se termine jamais ne le retient pas plus de CESSION_MAX_MS', async () => {
    vi.useFakeTimers();
    ecriture();
    let rendu = false;
    void cederAuxSaisies().then(() => {
      rendu = true;
    });
    await vi.advanceTimersByTimeAsync(CESSION_MAX_MS - 1);
    expect(rendu).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(rendu).toBe(true);
  });
});

describe('T13u : porteQuiCede', () => {
  it(`au plus ${String(LECTURES_EN_VOL)} lectures parties à la fois, chacune après ceder()`, async () => {
    const e = espion(5);
    let cessions = 0;
    const lecteur = porteQuiCede(e.porte, () => {
      cessions += 1;
      return Promise.resolve();
    });
    const lus = await Promise.all(Array.from({ length: 6 }, () => lecteur.porte.lire<{ n: number }>('SELECT 1 AS n')));
    expect(lus.map((l) => l[0]?.n)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(e.parties).toHaveLength(6);
    expect(cessions, 'une cession par lecture').toBe(6);
    expect(e.maxEnVol).toBe(LECTURES_EN_VOL);
  });

  it('rien ne part tant que ceder() ne rend pas la main ; pressée, tout part sans attendre', async () => {
    const e = espion();
    const lecteur = porteQuiCede(e.porte, () => new Promise<void>(() => undefined));
    const lus = Promise.all(Array.from({ length: 4 }, () => lecteur.porte.lire('SELECT 1 AS n')));
    await laisserPasser();
    expect(e.parties, 'cession sans fin : aucune lecture partie').toEqual([]);
    expect(lecteur.pressee()).toBe(false);
    lecteur.presser();
    expect(lecteur.pressee()).toBe(true);
    await lus;
    expect(e.parties).toHaveLength(4);
    await lecteur.porte.lire('SELECT 2 AS n');
    expect(e.parties).toHaveLength(5);
  });

  it('une lecture en échec rend son erreur et libère sa place', async () => {
    const lecteur = porteQuiCede(porte, () => Promise.resolve(), 1);
    await expect(lecteur.porte.lire('SELECT * FROM table_absente')).rejects.toThrow();
    expect(await lecteur.porte.lire<{ n: number }>('SELECT 3 AS n')).toEqual([{ n: 3 }]);
  });
});

describe('T13u : prechargerPlan cède à une écriture en cours', () => {
  it('aucune lecture ne part pendant l’écriture ; le début du plan est prêt après elle', async () => {
    const e = espion();
    const fin = ecriture();
    const precharge = prechargerPlan(e.porte, jeu.principale.fermeId, AUJOURDHUI);
    await laisserPasser();
    expect(e.parties, 'écriture en cours : le préchargement n’envoie rien à la base').toEqual([]);
    fin();
    await precharge;
    expect(e.parties.length).toBeGreaterThan(0);
    const saison = saisonParDefaut(await obtenirSaisons(e.porte, jeu.principale.fermeId), AUJOURDHUI);
    if (saison === null) throw new Error('aucune saison');
    const lu = planEnCache(e.porte, jeu.principale.fermeId, saison, AUJOURDHUI);
    expect(lu, 'début du plan préparé').not.toBeNull();
    expect(lu?.plan.lignes.length).toBeGreaterThan(0);
  });

  it('une écriture commencée en route : le reste attend sa fin, au plus LECTURES_EN_VOL lectures déjà parties', async () => {
    const e = espion(5);
    const precharge = prechargerPlan(e.porte, jeu.principale.fermeId, AUJOURDHUI);
    // Laisse partir les premières lectures, puis une saisie commence.
    while (e.parties.length === 0) await attendre(1);
    const fin = ecriture();
    const partiesAvant = e.parties.length;
    await attendre(60);
    expect(e.parties.length - partiesAvant, 'aucune lecture de plus pendant l’écriture').toBe(0);
    expect(partiesAvant).toBeLessThanOrEqual(LECTURES_EN_VOL);
    fin();
    await precharge;
    expect(e.parties.length).toBeGreaterThan(partiesAvant);
    expect(e.maxEnVol).toBeLessThanOrEqual(LECTURES_EN_VOL);
  });

  it('l’écran Planches qui attend le début du plan presse le préchargement : il n’attend pas la fin de l’écriture', async () => {
    const e = espion();
    ecriture();
    const precharge = prechargerPlan(e.porte, jeu.principale.fermeId, AUJOURDHUI);
    await laisserPasser();
    expect(e.parties).toEqual([]);
    // Ce que fait l'écran à l'ouverture : saisons, puis début du plan de la saison.
    const debutEcran = Date.now();
    const saison = saisonParDefaut(await obtenirSaisons(e.porte, jeu.principale.fermeId), AUJOURDHUI);
    if (saison === null) throw new Error('aucune saison');
    const lu = await obtenirDebutDePlan(e.porte, jeu.principale.fermeId, saison, AUJOURDHUI);
    expect(Date.now() - debutEcran, 'sans attendre CESSION_MAX_MS').toBeLessThan(CESSION_MAX_MS);
    expect(lu.plan.lignes.length).toBeGreaterThan(0);
    await precharge;
  });
});

describe('T13u : découpe du début du plan', () => {
  it('petites requêtes : pages d’emplacements et lots d’occupations bornés', async () => {
    const e = espion();
    await lireDebutDePlan(e.porte, jeu.principale.fermeId, EMPLACEMENTS_DU_DEBUT, () => DECOUPE_FOND);
    const pages = e.parties.filter((sql) => sql.includes('FROM emplacement WHERE'));
    expect(pages.length, '400 emplacements : plusieurs pages').toBeGreaterThan(1);
    for (const sql of pages) expect(sql).toContain(`LIMIT ${String(DECOUPE_FOND.emplacementsParPage)}`);
    const lots = e.parties.filter((sql) => sql.includes('FROM occupation o'));
    expect(lots.length, 'plusieurs lots d’occupations').toBeGreaterThan(1);
    for (const sql of lots) expect((sql.match(/\?/g) ?? []).length).toBeLessThanOrEqual(DECOUPE_FOND.emplacementsParLot);
  });

  it('les mêmes données qu’en une requête de chaque', async () => {
    const decoupe = await lireDebutDePlan(porte, jeu.principale.fermeId, EMPLACEMENTS_DU_DEBUT, () => DECOUPE_FOND);
    const entier = await lireDebutDePlan(porte, jeu.principale.fermeId, EMPLACEMENTS_DU_DEBUT);
    expect(comparables(decoupe)).toEqual(comparables(entier));
    expect(entier.structure.emplacement.length).toBe(decoupe.structure.emplacement.length);
  });
});
