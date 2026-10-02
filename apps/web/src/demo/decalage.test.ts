/**
 * Tests d'acceptation T25 (relecture) — dates de la ferme du plan, décalées en JOURS.
 *
 * Contrat pour le développeur :
 *   - `fusion.ts` exporte `decalerJours(lignes: Lignes, jours: number): Lignes`, qui remplace
 *     `decalerAnnees` : toute date AAAA-MM-JJ (seule, en tête d'un horodatage, ou dans un texte
 *     JSON) avance de `jours` jours civils (négatif : recule). Calcul sur des chaînes / en UTC,
 *     jamais une `Date` locale : le résultat ne dépend ni du fuseau ni du passage à l'heure d'été.
 *     `jours` = 0 rend l'objet tel quel. Les colonnes `annee` et les noms de saison restent
 *     cohérents avec les dates décalées (règle laissée au développeur, non testée ici).
 *   - `lignesDeLaDemo(jour, maintenant)` (remplir.ts) décale la ferme du plan du nombre de jours
 *     qui sépare son jour de référence (2026-09-30, « aujourd'hui » de ses tests) de `jour`, au lieu
 *     d'un nombre d'années : le jeu garde son écart au « jour J » à la journée près.
 */
import { describe, expect, it } from 'vitest';
import { fermeSerie } from '../ecrans/serie/test/ferme-serie.ts';
import { decalerJours } from './fusion.ts';
import { lignesDeLaDemo } from './remplir.ts';

/** Écart en jours entre 2026-09-30 et 2027-02-15 (31 + 30 + 31 + 31 + 15). */
const ECART_TEST = 138;

const MOTIF_DATE = /\d{4}-\d{2}-\d{2}/g;

/** Ajoute des jours à 'AAAA-MM-JJ' par calcul en UTC (aucun fuseau). */
function plusJours(date: string, jours: number): string {
  const [a, m, j] = date.split('-').map(Number);
  const d = new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, (j ?? 1) + jours));
  return d.toISOString().slice(0, 10);
}

describe('T25 : décalage du jeu du plan en jours', () => {
  it('2026-10-05 avec un téléphone au 2027-02-15 (référence 2026-09-30) tombe le 2027-02-20', () => {
    const l = decalerJours({ serie: [{ id: 's', parametres: '{"miseEnPlace":"2026-10-05"}', prevu_du: '2026-10-05' }] }, ECART_TEST);
    expect(l.serie).toEqual([{ id: 's', parametres: '{"miseEnPlace":"2027-02-20"}', prevu_du: '2027-02-20' }]);
  });

  it('dates seules, horodatages et JSON : changements de mois, d’année, 29 février', () => {
    const l = decalerJours(
      { t: [{ id: 'x', a: '2026-12-30', b: '2027-02-27T08:00:00.000Z', c: '{"d":"2028-02-28","e":"2026-01-01"}', n: 12, v: null }] },
      3,
    );
    expect(l.t).toEqual([{ id: 'x', a: '2027-01-02', b: '2027-03-02T08:00:00.000Z', c: '{"d":"2028-03-02","e":"2026-01-04"}', n: 12, v: null }]);
    expect(decalerJours({ t: [{ id: 'x', a: '2028-02-28' }] }, 1).t).toEqual([{ id: 'x', a: '2028-02-29' }]);
  });

  it('décalage négatif et nul', () => {
    expect(decalerJours({ t: [{ id: 'x', a: '2027-03-02' }] }, -3).t).toEqual([{ id: 'x', a: '2027-02-27' }]);
    const l = { t: [{ id: 'x', a: '2027-03-02' }] };
    expect(decalerJours(l, 0)).toBe(l);
  });

  it('indépendant du fuseau : pas de saut le jour du changement d’heure', () => {
    // 2027-03-28 : passage à l'heure d'été en Europe ; +1 jour doit donner le 29, quel que soit TZ.
    expect(decalerJours({ t: [{ id: 'x', a: '2027-03-27' }] }, 1).t).toEqual([{ id: 'x', a: '2027-03-28' }]);
    expect(decalerJours({ t: [{ id: 'x', a: '2027-03-28' }] }, 1).t).toEqual([{ id: 'x', a: '2027-03-29' }]);
    expect(decalerJours({ t: [{ id: 'x', a: '2027-10-30' }] }, 2).t).toEqual([{ id: 'x', a: '2027-11-01' }]);
  });

  it('lignesDeLaDemo : chaque date des séries du plan est celle du jeu d’origine + 138 jours (téléphone au 2027-02-15)', () => {
    const originales = fermeSerie().lignes.serie ?? [];
    expect(originales.length, 'séries du jeu du plan').toBeGreaterThan(0);
    const demo = lignesDeLaDemo('2027-02-15', new Date('2027-02-15T09:00:00Z')).get('serie') ?? [];
    let datesVerifiees = 0;
    for (const o of originales) {
      const d = demo.find((x) => x.id === o.id);
      expect(d, `série ${String(o.id)} dans la démo`).toBeDefined();
      if (d === undefined) continue;
      for (const [colonne, valeur] of Object.entries(o)) {
        if (typeof valeur !== 'string') continue;
        const attendues = (valeur.match(MOTIF_DATE) ?? []).map((x) => plusJours(x, ECART_TEST));
        const obtenues = String(d[colonne] ?? '').match(MOTIF_DATE) ?? [];
        expect(obtenues, `série ${String(o.id)}, colonne ${colonne}`).toEqual(attendues);
        datesVerifiees += attendues.length;
      }
    }
    expect(datesVerifiees, 'des dates ont bien été comparées').toBeGreaterThan(0);
  });
});
