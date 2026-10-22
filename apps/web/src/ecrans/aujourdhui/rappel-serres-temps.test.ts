// @vitest-environment happy-dom
/**
 * Tests d'acceptation T58 (contre-relecture) — le rappel du soir (rappel-serres.ts) suit le temps :
 * un événement « fermé » daté de 18 h 05, déjà reçu à 18 h 01, fait disparaître le rappel quand
 * 18 h 05 est passé, SANS autre changement du journal (le temps simulé avance, l'horloge de
 * relecture de la minute fait le reste). Témoins : avant 18 h 05 le rappel est là ; une serre
 * ouverte à 18 h 03 (reçue à 18 h 01) n'est pas comptée avant 18 h 03 et l'est ensuite.
 * Banc : ferme neuve + serres (./test/contrat-etat-serres.ts), base mémoire, aucune horloge réelle
 * pour la relecture (setInterval simulé), 30 septembre 2026 (heure d'été : 18 h = 16 h UTC).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { RappelDuSoir } from '@planif/core/abris';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { ecrireFermeNeuve, FERME, UTILISATEUR } from '../parcellaire/test/ferme-neuve.ts';
import { suivreRappelSerres } from './rappel-serres.ts';
import { ecrireEtat, ecrireSerres, SERRE_1, SERRE_2 } from './test/contrat-etat-serres.ts';

const heure = (hhmm: string): Date => new Date(`2026-09-30T${String(Number(hhmm.slice(0, 2)) - 2).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`);

let base: BaseMemoire;
let porte: PorteDonnees;
let maintenant: Date;
let arret: (() => void) | null = null;
let vus: (RappelDuSoir | null)[];

async function laisserPasserLaBase(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

async function demarrer(debut: string): Promise<void> {
  maintenant = heure(debut);
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeNeuve(base);
  ecrireSerres(base, FERME);
  porte = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
  vus = [];
  arret = suivreRappelSerres(porte, FERME, () => maintenant, (r) => {
    vus.push(r);
  });
  await laisserPasserLaBase();
}

/** Avance le temps simulé d'une minute à la fois (l'écran relit l'heure chaque minute). */
async function avancerJusqua(hhmm: string): Promise<void> {
  const cible = heure(hhmm);
  while (maintenant.getTime() < cible.getTime()) {
    maintenant = new Date(maintenant.getTime() + 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await laisserPasserLaBase();
  }
}

const rappel = (): RappelDuSoir | null => vus.at(-1) ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  arret?.();
  arret = null;
  vi.useRealTimers();
  base.fermer();
});

describe('T58 : le rappel du soir suit le temps, sans autre changement du journal', () => {
  it('« fermé » daté de 18 h 05, reçu à 18 h 01 : le rappel disparaît une fois 18 h 05 passé', async () => {
    await demarrer('17:58');
    // Serre 1 ouverte le matin ; Serre 2 : portes ouvertes le matin et refermées à 18 h 05 (écrit d'avance).
    ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_1, equipement: 'ouvrants_lateraux', actif: true, horodatage: '2026-09-30T05:00:00.000Z', auteurId: UTILISATEUR });
    ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_2, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:10:00.000Z', auteurId: UTILISATEUR });
    await avancerJusqua('18:01');
    expect(rappel()?.phrase, 'à 18 h 01 : deux serres ouvertes').toBe('2 serres encore ouvertes');
    // L'événement « fermé » de 18 h 05 (16 h 05 UTC) arrive à 18 h 01 : il est encore dans le futur.
    ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_2, equipement: 'portes', actif: false, horodatage: '2026-09-30T16:05:00.000Z', auteurId: UTILISATEUR });
    await avancerJusqua('18:04');
    expect(rappel()?.phrase, 'à 18 h 04 : l’événement n’a pas encore eu lieu').toBe('2 serres encore ouvertes');
    await avancerJusqua('18:05');
    await avancerJusqua('18:07');
    expect(rappel()?.phrase, 'à 18 h 07 : Serre 2 est refermée depuis 18 h 05').toBe('1 serre encore ouverte');
    expect(rappel()?.zones.map((z) => z.zoneId)).toEqual([SERRE_1]);
  });

  it('le dernier « fermé » daté dans le futur fait tomber le rappel à zéro quand son heure est passée', async () => {
    await demarrer('18:00');
    ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_1, equipement: 'portes', actif: true, horodatage: '2026-09-30T05:00:00.000Z', auteurId: UTILISATEUR });
    await avancerJusqua('18:01');
    expect(rappel()?.nombre).toBe(1);
    ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_1, equipement: 'portes', actif: false, horodatage: '2026-09-30T16:05:00.000Z', auteurId: UTILISATEUR });
    await avancerJusqua('18:06');
    expect(rappel()).toBeNull();
  });

  it('une ouverture datée de 18 h 03, reçue à 18 h 01, entre dans le compte une fois 18 h 03 passé', async () => {
    await demarrer('18:00');
    await avancerJusqua('18:01');
    expect(rappel()).toBeNull();
    ecrireEtat(base, { fermeId: FERME, zoneId: SERRE_1, equipement: 'portes', actif: true, horodatage: '2026-09-30T16:03:00.000Z', auteurId: UTILISATEUR });
    await avancerJusqua('18:02');
    expect(rappel()).toBeNull();
    await avancerJusqua('18:05');
    expect(rappel()?.phrase).toBe('1 serre encore ouverte');
  });
});
