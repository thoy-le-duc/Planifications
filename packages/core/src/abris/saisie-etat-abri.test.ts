/**
 * Tests d'acceptation T58 — règle 2 : un changement d'état est un événement du journal de type
 * `etat_abri` (docs/backlog/T58-etat-serres.md). Le cœur (`validerSaisie`, la même règle sur le
 * téléphone et sur le serveur) l'accepte avec son détail typé { zoneId, equipement, actif } et
 * refuse le reste. Une correction ou une annulation porte le même type et le même détail.
 */
import { describe, expect, it } from 'vitest';
import { validerSaisie } from '../saisies/index.ts';

const uuid = (n: number): string => `0192f0c1-5858-7000-8000-${n.toString(16).padStart(12, '0')}`;
const ZONE = uuid(0xa1);

function ligne(detail: unknown, autres: Record<string, unknown> = {}): Record<string, unknown> {
  const l: Record<string, unknown> = {
    id: uuid(1),
    ferme_id: uuid(2),
    type: 'etat_abri',
    date: '2026-10-22',
    horodatage: '2026-10-22T07:00:00.000Z',
    auteur_id: uuid(3),
    source: 'tap',
    serie_id: null,
    campagne_id: null,
    emplacement_ids: '[]',
    note: null,
    photos: '[]',
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  };
  for (const [cle, valeur] of Object.entries(autres)) {
    if (valeur === undefined) Reflect.deleteProperty(l, cle);
    else l[cle] = valeur;
  }
  return l;
}

const BON = { zoneId: ZONE, equipement: 'ouvrants_lateraux', actif: true };

function refuse(entree: Record<string, unknown>, code: string, champ: string): void {
  const r = validerSaisie(entree);
  expect(r.ok, 'aurait dû être refusé').toBe(false);
  if (r.ok) return;
  expect({ code: r.erreur.code, champ: r.erreur.champ }).toEqual({ code, champ });
}

describe('T58 : validerSaisie et le type etat_abri', () => {
  it('« ouvrants latéraux ouverts » : accepté, détail rendu tel quel', () => {
    const r = validerSaisie(ligne(BON));
    expect(r.ok ? null : r.erreur).toBeNull();
    if (!r.ok) return;
    expect(r.saisie.type).toBe('etat_abri');
    expect(r.saisie.detail).toEqual(BON);
    expect(r.saisie.culture).toBeNull();
    expect(r.saisie.emplacementIds).toEqual([]);
  });

  it.each(['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile'])('équipement %s, ouvert ou fermé : accepté', (equipement) => {
    for (const actif of [true, false]) expect(validerSaisie(ligne({ zoneId: ZONE, equipement, actif })).ok).toBe(true);
  });

  it('annulation et correction : acceptées avec le même détail', () => {
    const origine = uuid(9);
    expect(validerSaisie(ligne(BON, { remplace_sorte: 'annulation', remplace_evenement_id: origine })).ok).toBe(true);
    expect(validerSaisie(ligne({ ...BON, actif: false }, { remplace_sorte: 'correction', remplace_evenement_id: origine })).ok).toBe(true);
  });

  it('zone absente ou pas un identifiant : refusée', () => {
    refuse(ligne({ equipement: 'portes', actif: true }), 'champ_manquant', 'detail.zoneId');
    refuse(ligne({ ...BON, zoneId: 'serre-1' }), 'champ_invalide', 'detail.zoneId');
    refuse(ligne({ ...BON, zoneId: null }), 'champ_manquant', 'detail.zoneId');
  });

  it('équipement absent ou hors liste : refusé', () => {
    refuse(ligne({ zoneId: ZONE, actif: true }), 'champ_manquant', 'detail.equipement');
    refuse(ligne({ ...BON, equipement: 'arrosage' }), 'champ_invalide', 'detail.equipement');
    refuse(ligne({ ...BON, equipement: 'Portes' }), 'champ_invalide', 'detail.equipement');
  });

  it('état absent ou pas un booléen (« ouvert », 1, « true ») : refusé', () => {
    refuse(ligne({ zoneId: ZONE, equipement: 'portes' }), 'champ_manquant', 'detail.actif');
    for (const mauvais of ['ouvert', 1, 'true', 0]) refuse(ligne({ ...BON, actif: mauvais }), 'champ_invalide', 'detail.actif');
  });

  it('clé inconnue dans le détail : refusée', () => {
    refuse(ligne({ ...BON, duree: 5 }), 'cle_inconnue', 'detail.duree');
  });

  it('un autre type ne peut pas porter ce détail (observation avec zoneId)', () => {
    refuse(ligne(BON, { type: 'observation' }), 'cle_inconnue', 'detail.zoneId');
  });
});
