/**
 * T13s : une entrée d'historique au format de Postgres (`+00`, espace) est annulable comme une
 * entrée en `Z` : `instant` se lit comme dans le reste de l'appli (`instantHorodatage`), et un
 * horodatage illisible reste non annulable (instant NaN).
 */
import { describe, expect, it } from 'vitest';
import { entreeAnnulable, versModification } from './donnees.ts';

const entree = (horodatage: string) => versModification({ id: 'm1', nom_table: 'Serie', ligne_id: 's1', operation: 'modification', horodatage, avant: '{"a":1}', apres: '{"a":2}' });

describe('T13s : instant des entrées de l’historique', () => {
  it.each(['2026-10-01T10:00:00.123Z', '2026-10-01 10:00:00.123+00', '2026-10-01 10:00:00.123456+00:00', '2026-10-01 12:00:00.123+02'])('%s est annulable, au même instant', (h) => {
    const m = entree(h);
    expect(m.instant).toBe(Date.parse('2026-10-01T10:00:00.123Z'));
    expect(entreeAnnulable(m)).toBe(true);
  });

  // Date.parse tronque les microsecondes, SQLite arrondit à la milliseconde : même règle partout.
  it.each([
    ['2026-10-01T10:00:00.0005Z', '2026-10-01T10:00:00.001Z'],
    ['2026-10-01 10:00:00.999999+00', '2026-10-01T10:00:00.999Z'],
    ['2026-10-01 10:00:00.1236+00:00', '2026-10-01T10:00:00.124Z'],
    ['2026-10-01 10:00:00.5+00', '2026-10-01T10:00:00.500Z'],
  ])('%s est lu à %s (arrondi comme SQLite)', (h, attendu) => {
    const m = entree(h);
    expect(m.instant).toBe(Date.parse(attendu));
    expect(entreeAnnulable(m)).toBe(true);
  });

  it('un horodatage illisible n’est pas annulable', () => {
    expect(entreeAnnulable(entree('hier soir'))).toBe(false);
  });
});
