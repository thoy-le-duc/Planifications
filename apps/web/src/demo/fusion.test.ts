/**
 * T25 — fusion des jeux de test en une ferme de démonstration (./fusion.ts) : rattachement à
 * l'utilisateur et à la ferme de la démo, doublons écartés, références (y compris dans le JSON)
 * renvoyées vers la ligne gardée, années d'un jeu décalé en jours (dates : ./decalage.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { decalerJours, fusionnerJeux, type Jeu } from './fusion.ts';

const id = (prefixe: string, n: number) => `0192f0c1-${prefixe}-7000-8000-${n.toString(16).padStart(12, '0')}`;
const CIBLE = { utilisateurId: id('de00', 1), fermeId: id('de00', 2), nomUtilisateur: 'Visiteur', nomFerme: 'Ferme de démo' };

function jeu(prefixe: string, zone: string, code: string): Jeu {
  const u = id(prefixe, 1);
  const f = id(prefixe, 2);
  return {
    utilisateurId: u,
    fermeId: f,
    lignes: {
      // Ordre volontairement désordonné : la planche avant sa zone, la ferme avant l'utilisateur.
      emplacement: [{ id: id(prefixe, 0x20), ferme_id: f, zone_id: id(prefixe, 0x10), code }],
      ferme: [{ id: f, nom: `Ferme ${prefixe} (tests)` }],
      utilisateur: [{ id: u, nom: `Théophane ${prefixe}` }],
      membre: [{ id: id(prefixe, 3), utilisateur_id: u, ferme_id: f }],
      zone: [{ id: id(prefixe, 0x10), ferme_id: f, nom: zone, zone_parente_id: null, supprime_le: null }],
      serie: [{ id: id(prefixe, 0x30), ferme_id: f, parametres: JSON.stringify({ emplacementId: id(prefixe, 0x20) }) }],
    },
  };
}

describe('T25 : fusion des jeux de la démo', () => {
  const sortie = fusionnerJeux([jeu('1313', 'Tunnel 2', 'T2-P01'), jeu('1212', 'Tunnel 2', 'T2-P01'), jeu('2424', 'Tunnel 1', 'T1-P01')], CIBLE);

  it('un seul utilisateur, une seule ferme, une seule adhésion : ceux de la démo, renommés', () => {
    expect(sortie.get('utilisateur')).toEqual([{ id: CIBLE.utilisateurId, nom: 'Visiteur' }]);
    expect(sortie.get('ferme')).toEqual([{ id: CIBLE.fermeId, nom: 'Ferme de démo' }]);
    expect(sortie.get('membre')).toEqual([{ id: id('1313', 3), utilisateur_id: CIBLE.utilisateurId, ferme_id: CIBLE.fermeId }]);
  });

  it('zone et planche en double : la première gardée, les références du jeu suivant renvoyées vers elle', () => {
    expect(sortie.get('zone')?.map((z) => z.nom)).toEqual(['Tunnel 2', 'Tunnel 1']);
    expect(sortie.get('emplacement')?.map((e) => [e.code, e.id, e.zone_id])).toEqual([
      ['T2-P01', id('1313', 0x20), id('1313', 0x10)],
      ['T1-P01', id('2424', 0x20), id('2424', 0x10)],
    ]);
    const parametres = sortie.get('serie')?.map((s) => JSON.parse(String(s.parametres)) as { emplacementId: string });
    expect(parametres?.map((p) => p.emplacementId)).toEqual([id('1313', 0x20), id('1313', 0x20), id('2424', 0x20)]);
  });

  it('chaque ligne gardée est rattachée à la ferme de la démo', () => {
    for (const [table, lignes] of sortie) {
      for (const l of lignes) if ('ferme_id' in l) expect(l.ferme_id, table).toBe(CIBLE.fermeId);
    }
  });

  it('les tables référencées sont écrites d’abord', () => {
    expect([...sortie.keys()]).toEqual(['utilisateur', 'ferme', 'membre', 'zone', 'emplacement', 'serie']);
  });

  it('une ligne supprimée n’est jamais prise pour modèle', () => {
    const a = jeu('1313', 'Tunnel 2', 'T2-P01');
    const zoneSupprimee = { id: id('1313', 0x10), ferme_id: a.fermeId, nom: 'Tunnel 2', zone_parente_id: null, supprime_le: '2026-01-01T00:00:00.000Z' };
    const s = fusionnerJeux([{ ...a, lignes: { ...a.lignes, zone: [zoneSupprimee] } }, jeu('1212', 'Tunnel 2', 'T2-P09')], CIBLE);
    expect(s.get('zone')?.map((z) => z.id)).toEqual([id('1313', 0x10), id('1212', 0x10)]);
  });
});

describe('T25 : années d’un jeu décalé en jours', () => {
  it('saison d’année civile et colonne annee : l’année où tombe le milieu de leur année', () => {
    const lignes = decalerJours(
      {
        saison: [
          { id: 's', nom: '2026', debut: '2026-01-01', fin: '2026-12-31' },
          { id: 'p', nom: 'Printemps', debut: '2026-03-01', fin: '2026-06-30' },
        ],
        campagne: [{ id: 'c', annee: 2026, debut_recolte_prevu: '2026-06-01' }],
      },
      200,
    );
    expect(lignes.saison).toEqual([
      { id: 's', nom: '2027', debut: '2027-01-01', fin: '2027-12-31' },
      { id: 'p', nom: 'Printemps', debut: '2026-09-17', fin: '2027-01-16' },
    ]);
    expect(lignes.campagne).toEqual([{ id: 'c', annee: 2027, debut_recolte_prevu: '2026-12-18' }]);
    expect(decalerJours({ saison: [{ id: 's', nom: '2026', debut: '2026-01-01', fin: '2026-12-31' }] }, 138).saison?.[0]?.nom).toBe('2026');
  });
});
