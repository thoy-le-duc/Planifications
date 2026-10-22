/**
 * T80 — règles pures du refus d'un traitement daté dans le futur (sans base) : jour du serveur à
 * Paris, limite jour + 1, message. Les envois réels : traitement-date-future.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { jourAParis } from '../dependances.ts';
import { messageRefus } from './messages.ts';
import { refusTraitementFutur } from './traitement-date.ts';
import { defautsDeForme, jargon } from './test/jargon.ts';

const FERME = '0190a000-0000-7000-8000-000000000001';
const traitement = (date: string) => ({ type: 'traitement', date, fermeId: FERME });

describe('jourAParis', () => {
  it('heure d’été (UTC+2) : 22:30 UTC le 30/06 est déjà le 01/07 à Paris', () => {
    expect(jourAParis(new Date('2026-06-30T21:59:59Z'))).toBe('2026-06-30');
    expect(jourAParis(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01');
  });

  it('heure d’hiver (UTC+1) : 23:00 UTC le 31/12 est le 01/01 à Paris', () => {
    expect(jourAParis(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31');
    expect(jourAParis(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
  });
});

describe('refusTraitementFutur', () => {
  it('jour du serveur et lendemain acceptés, surlendemain refusé', () => {
    expect(refusTraitementFutur(traitement('2026-10-21'), '2026-10-22')).toBeNull();
    expect(refusTraitementFutur(traitement('2026-10-22'), '2026-10-22')).toBeNull();
    expect(refusTraitementFutur(traitement('2026-10-23'), '2026-10-22')).toBeNull();
    expect(refusTraitementFutur(traitement('2026-10-24'), '2026-10-22')).toMatchObject({ motif: 'ecriture_invalide', fermeId: FERME });
  });

  it('la limite passe les fins de mois et d’année', () => {
    expect(refusTraitementFutur(traitement('2027-01-01'), '2026-12-31')).toBeNull();
    expect(refusTraitementFutur(traitement('2027-01-02'), '2026-12-31')).not.toBeNull();
    expect(refusTraitementFutur(traitement('2028-03-01'), '2028-02-28')).not.toBeNull();
    expect(refusTraitementFutur(traitement('2028-02-29'), '2028-02-28')).toBeNull();
  });

  it('seul le type traitement est visé', () => {
    expect(refusTraitementFutur({ type: 'recolte', date: '2030-01-01', fermeId: FERME }, '2026-10-22')).toBeNull();
  });

  it('message affiché : date en JJ/MM/AAAA, sans jargon', () => {
    const refus = refusTraitementFutur(traitement('2026-10-24'), '2026-10-22');
    expect(refus).not.toBeNull();
    if (refus === null) return;
    const message = messageRefus(refus);
    expect(message).toContain('traitement daté dans le futur (24/10/2026) : corrigez la date');
    expect(jargon(message)).toEqual([]);
    expect(defautsDeForme(message)).toEqual([]);
  });

  it('jour du serveur illisible : erreur, pas un refus', () => {
    expect(() => refusTraitementFutur(traitement('2026-10-24'), '22/10/2026')).toThrow();
  });
});
