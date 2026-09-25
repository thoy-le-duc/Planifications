/**
 * Tests d'acceptation T01 — génération des identifiants UUID v7 (RFC 9562).
 *
 * API attendue, exportée par `packages/core/src/domaine/index.ts`
 * (et ré-exportée par `packages/core/src/index.ts`) :
 *
 *   interface SourcesId {
 *     readonly horloge: () => number;                          // millisecondes depuis l'époque Unix
 *     readonly aleatoire: (nombreOctets: number) => Uint8Array; // renvoie exactement nombreOctets octets
 *   }
 *   type GenerateurId = <E extends …>() => Id<E>;             // appel : generer<'Serie'>()
 *   creerGenerateurId(sources: SourcesId): GenerateurId
 *
 * Aucun accès direct à Date.now ni à crypto dans le moteur : l'appli injecte les vraies sources.
 *
 * Exigences :
 *   - format canonique en minuscules : xxxxxxxx-xxxx-7xxx-[89ab]xxx-xxxxxxxxxxxx ;
 *   - les 48 premiers bits sont l'horodatage en millisecondes (big-endian) ;
 *   - déterministe : mêmes sources injectées → même suite d'identifiants ;
 *   - strictement croissant (ordre des chaînes) pour un même générateur, y compris quand
 *     l'horloge ne bouge pas ou recule (compteur monotone, méthode 1 ou 3 de la RFC 9562 §6.2) :
 *     c'est ce qui garde l'ordre de création des lignes créées hors ligne sur un téléphone ;
 *   - quand le compteur de rand_a (12 bits) déborde, l'horodatage avance d'une milliseconde ;
 *   - rand_b (62 bits) vient de l'aléa injecté, derrière la variante 10 : aléa à 0x00 → fin
 *     '8000-000000000000', aléa à 0xff → fin 'bfff-ffffffffffff'.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { creerGenerateurId } from './index.ts';
import type { GenerateurId, Id, SourcesId } from './index.ts';
import * as racine from '../index.ts';

const FORMAT_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Exemple de la RFC 9562 (annexe A.6) : 2022-02-22T19:22:22Z = 0x017F22E279B0 ms. */
const INSTANT_RFC = 1_645_557_742_000;

function octetsConstants(valeur: number): (nombreOctets: number) => Uint8Array {
  return (nombreOctets) => new Uint8Array(nombreOctets).fill(valeur);
}

/** Pseudo-aléa déterministe (xorshift32) pour les tests. */
function aleaGraine(graine: number): (nombreOctets: number) => Uint8Array {
  let etat = graine >>> 0 || 1;
  return (nombreOctets) => {
    const octets = new Uint8Array(nombreOctets);
    for (let i = 0; i < nombreOctets; i++) {
      etat ^= etat << 13;
      etat >>>= 0;
      etat ^= etat >>> 17;
      etat ^= etat << 5;
      etat >>>= 0;
      octets[i] = etat & 0xff;
    }
    return octets;
  };
}

/** Horloge qui avance d'un pas fixe à chaque lecture. */
function horlogeQuiAvance(depart: number, pas: number): () => number {
  let t = depart - pas;
  return () => {
    t += pas;
    return t;
  };
}

function horodatage(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

describe('creerGenerateurId', () => {
  it('produit un UUID v7 canonique : version 7, variante 10xx, minuscules', () => {
    const generer = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: aleaGraine(42) });
    for (let i = 0; i < 200; i++) {
      const id = generer<'Serie'>();
      expect(id).toMatch(FORMAT_UUID_V7);
    }
  });

  it('le format tient aussi avec un aléa tout à zéro ou tout à 0xff', () => {
    for (const valeur of [0x00, 0xff]) {
      const generer = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: octetsConstants(valeur) });
      expect(generer<'Serie'>()).toMatch(FORMAT_UUID_V7);
      expect(generer<'Serie'>()).toMatch(FORMAT_UUID_V7);
    }
  });

  it('encode l’horodatage en millisecondes dans les 48 premiers bits', () => {
    const generer = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: aleaGraine(7) });
    const id = generer<'Serie'>();
    expect(id.startsWith('017f22e2-79b0-7')).toBe(true);
    expect(horodatage(id)).toBe(INSTANT_RFC);

    const aZero = creerGenerateurId({ horloge: () => 0, aleatoire: aleaGraine(7) });
    expect(aZero<'Serie'>().startsWith('00000000-0000-7')).toBe(true);
  });

  it('est déterministe : mêmes sources, même suite', () => {
    const a = creerGenerateurId({ horloge: horlogeQuiAvance(INSTANT_RFC, 3), aleatoire: aleaGraine(123) });
    const b = creerGenerateurId({ horloge: horlogeQuiAvance(INSTANT_RFC, 3), aleatoire: aleaGraine(123) });
    const suiteA = Array.from({ length: 50 }, () => a<'Serie'>());
    const suiteB = Array.from({ length: 50 }, () => b<'Serie'>());
    expect(suiteA).toEqual(suiteB);
  });

  it('utilise l’aléa injecté : deux aléas différents donnent deux identifiants différents', () => {
    const a = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: aleaGraine(1) });
    const b = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: aleaGraine(2) });
    expect(a<'Serie'>()).not.toBe(b<'Serie'>());
  });

  it('suit l’horloge : un instant plus tard donne un identifiant plus grand', () => {
    const instants = [INSTANT_RFC, INSTANT_RFC + 1, INSTANT_RFC + 1_000, INSTANT_RFC + 86_400_000];
    let i = 0;
    const generer = creerGenerateurId({
      horloge: () => instants[Math.min(i++, instants.length - 1)] ?? INSTANT_RFC,
      aleatoire: aleaGraine(9),
    });
    const ids = instants.map(() => generer<'Serie'>());
    expect(ids.map(horodatage)).toEqual(instants);
    expect([...ids].sort()).toEqual(ids);
  });

  it('reste strictement croissant et sans doublon quand l’horloge ne bouge pas', () => {
    const generer = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: octetsConstants(0x5a) });
    const ids = Array.from({ length: 2_000 }, () => generer<'Serie'>());
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      const precedent = ids[i - 1] ?? '';
      const courant = ids[i] ?? '';
      if (!(precedent < courant)) {
        expect.unreachable(`ordre rompu à ${String(i)} : ${precedent} ≥ ${courant}`);
      }
      if (!FORMAT_UUID_V7.test(courant)) {
        expect.unreachable(`format rompu à ${String(i)} : ${courant}`);
      }
    }
  });

  it('déborde proprement : au-delà de 4 096 identifiants dans la même milliseconde, l’horodatage avance', () => {
    const generer = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: octetsConstants(0xff) });
    const ids = Array.from({ length: 5_000 }, () => generer<'Serie'>());
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      const precedent = ids[i - 1] ?? '';
      const courant = ids[i] ?? '';
      if (!(precedent < courant) || !FORMAT_UUID_V7.test(courant)) {
        expect.unreachable(`ordre ou format rompu à ${String(i)} : ${precedent} → ${courant}`);
      }
    }
    expect(horodatage(ids[0] ?? '')).toBe(INSTANT_RFC);
    expect(horodatage(ids[ids.length - 1] ?? '')).toBeGreaterThan(INSTANT_RFC);
  });

  it('rand_b vient de l’aléa injecté, derrière la variante 10', () => {
    const zero = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: octetsConstants(0x00) });
    const plein = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: octetsConstants(0xff) });
    expect(zero<'Serie'>().slice(-17)).toBe('8000-000000000000');
    expect(plein<'Serie'>().slice(-17)).toBe('bfff-ffffffffffff');
  });

  it('reste strictement croissant quand l’horloge recule', () => {
    const instants = [INSTANT_RFC + 5_000, INSTANT_RFC, INSTANT_RFC - 60_000, INSTANT_RFC + 5_000];
    let i = 0;
    const generer = creerGenerateurId({
      horloge: () => instants[Math.min(i++, instants.length - 1)] ?? INSTANT_RFC,
      aleatoire: aleaGraine(5),
    });
    const ids = instants.map(() => generer<'Serie'>());
    for (const id of ids) {
      expect(id).toMatch(FORMAT_UUID_V7);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('typage : le générateur renvoie l’Id de l’entité demandée', () => {
    expectTypeOf(creerGenerateurId).parameter(0).toEqualTypeOf<SourcesId>();
    expectTypeOf(creerGenerateurId).returns.toEqualTypeOf<GenerateurId>();
    const generer = creerGenerateurId({ horloge: () => INSTANT_RFC, aleatoire: aleaGraine(3) });
    const idSerie = generer<'Serie'>();
    expectTypeOf(idSerie).toEqualTypeOf<Id<'Serie'>>();
    expectTypeOf(generer<'Emplacement'>()).toEqualTypeOf<Id<'Emplacement'>>();
    expectTypeOf(idSerie).not.toExtend<Id<'Emplacement'>>();
  });

  it('est ré-exporté par la racine du paquet', () => {
    expect(racine.creerGenerateurId).toBe(creerGenerateurId);
  });
});
