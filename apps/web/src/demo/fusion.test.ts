/**
 * T25 — fusion des jeux de test en une ferme de démonstration (./fusion.ts) : rattachement à
 * l'utilisateur et à la ferme de la démo, doublons écartés, références (y compris dans le JSON)
 * renvoyées vers la ligne gardée, années décalées.
 */
import { describe, expect, it } from 'vitest';
import { decalerAnnees, fusionnerJeux, type Jeu } from './fusion.ts';

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

describe('T25 : années d’un jeu à dates fixes', () => {
  it('dates, horodatages, JSON, colonne annee et noms de saison décalés ; 29 février ramené au 28', () => {
    const lignes = decalerAnnees(
      {
        saison: [{ id: 's', nom: '2026', debut: '2026-01-01', fin: '2026-12-31' }],
        serie: [{ id: 'x', parametres: '{"miseEnPlace":"2027-04-05"}', cree_le: '2025-01-01T08:00:00.000Z' }],
        campagne: [{ id: 'c', annee: 2024, debut_recolte_prevu: '2024-02-29' }],
      },
      1,
    );
    expect(lignes.saison).toEqual([{ id: 's', nom: '2027', debut: '2027-01-01', fin: '2027-12-31' }]);
    expect(lignes.serie).toEqual([{ id: 'x', parametres: '{"miseEnPlace":"2028-04-05"}', cree_le: '2026-01-01T08:00:00.000Z' }]);
    expect(lignes.campagne).toEqual([{ id: 'c', annee: 2025, debut_recolte_prevu: '2025-02-28' }]);
  });

  it('décalage nul : le jeu tel quel', () => {
    const l = { saison: [{ id: 's', nom: '2026' }] };
    expect(decalerAnnees(l, 0)).toBe(l);
  });
});
