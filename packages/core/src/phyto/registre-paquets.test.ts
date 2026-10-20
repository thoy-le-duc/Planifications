/**
 * T63 : le registre phyto calculé par paquets (générateur, utilisé par l'export) rend exactement
 * les lignes de `lignesRegistrePhyto` (écran Registre) : mêmes lignes, même ordre, mêmes
 * traitements en vigueur, corrections et annulations comprises, au-delà d'un paquet.
 */
import { describe, expect, it } from 'vitest';
import { ligneCsvRegistre, lignesRegistrePhyto, lignesRegistrePhytoParPaquets, type LigneLocaleRegistre } from './index.ts';

const uuid = (n: number): string => `0192f0c1-5252-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const AUTRE_FERME = uuid(2);
const PRODUIT = uuid(0x10);
const N = 700;

function evenement(n: number, autres: Record<string, string | number | null> = {}): LigneLocaleRegistre {
  const jour = String(1 + (n % 28)).padStart(2, '0');
  return {
    id: uuid(0x1000 + n),
    ferme_id: FERME,
    type: 'traitement',
    date: `2027-05-${jour}`,
    horodatage: `2027-05-${jour}T08:${String(n % 60).padStart(2, '0')}:${String(Math.floor(n / 60)).padStart(2, '0')}.000Z`,
    serie_id: null,
    campagne_id: null,
    emplacement_ids: JSON.stringify([uuid(0x2000 + (n % 600)), uuid(0x2000 + ((n * 7) % 600))]),
    remplace_sorte: null,
    remplace_evenement_id: null,
    detail: JSON.stringify({ produitPhytoId: PRODUIT, dose: { valeur: 1 + (n % 5), unite: 'L/ha' }, surfaceTraiteeM2: n, cible: `cible ${String(n)}`, operateur: 'Théo', recolteAutoriseeLe: `2027-06-${jour}` }),
    ...autres,
  };
}

function tables(): Record<string, LigneLocaleRegistre[]> {
  const evenements: LigneLocaleRegistre[] = [];
  const attendus = new Set<string>();
  for (let n = 0; n < N; n++) {
    evenements.push(evenement(n));
    attendus.add(uuid(0x1000 + n));
  }
  // Annulations (un sur sept) et corrections (un sur onze), dans le désordre de la table.
  for (let n = 0; n < N; n++) {
    if (n % 7 === 0) {
      evenements.push(evenement(N + n, { remplace_sorte: 'annulation', remplace_evenement_id: uuid(0x1000 + n) }));
      attendus.delete(uuid(0x1000 + n));
    } else if (n % 11 === 0) {
      evenements.push(evenement(N + n, { remplace_sorte: 'correction', remplace_evenement_id: uuid(0x1000 + n), serie_id: null }));
      attendus.delete(uuid(0x1000 + n));
      attendus.add(uuid(0x1000 + N + n));
    }
  }
  evenements.reverse();
  evenements.push({ ...evenement(5000), ferme_id: AUTRE_FERME }, { ...evenement(5001), type: 'recolte' });
  const emplacements: LigneLocaleRegistre[] = [];
  for (let i = 0; i < 600; i++) emplacements.push({ id: uuid(0x2000 + i), ferme_id: i % 50 === 0 ? AUTRE_FERME : FERME, code: `P${String(i).padStart(3, '0')}` });
  return {
    evenement: evenements,
    produit_phyto: [{ id: PRODUIT, ferme_id: FERME, nom_commercial: 'Bouillie', numero_amm: '9300417', substance_active: 'cuivre', utilisable_en_bio: 1 }],
    emplacement: emplacements,
  };
}

function deroule<T>(g: Generator<void, T, undefined>): { readonly valeur: T; readonly arrets: number } {
  let arrets = 0;
  for (;;) {
    const r = g.next();
    if (r.done === true) return { valeur: r.value, arrets };
    arrets++;
  }
}

describe('T63 : registre phyto par paquets', () => {
  it('rend les mêmes lignes, dans le même ordre, que lignesRegistrePhyto (annulations et corrections au-delà d’un paquet)', () => {
    const t = tables();
    const attendu = lignesRegistrePhyto(t, FERME);
    const { valeur, arrets } = deroule(lignesRegistrePhytoParPaquets(t, FERME));
    expect(valeur).toEqual(attendu);
    expect(valeur.map(ligneCsvRegistre)).toEqual(attendu.map(ligneCsvRegistre));
    expect(attendu.length).toBeGreaterThan(256);
    expect(arrets).toBeGreaterThan(3);
  });

  it('ne garde que les traitements en vigueur : ni annulés, ni remplacés, ni autre ferme', () => {
    const ids = lignesRegistrePhyto(tables(), FERME).map((l) => l.evenementId);
    const attendus = new Set<string>();
    for (let n = 0; n < N; n++) {
      if (n % 7 === 0) continue;
      attendus.add(n % 11 === 0 ? uuid(0x1000 + N + n) : uuid(0x1000 + n));
    }
    expect(new Set(ids)).toEqual(attendus);
    expect(ids.length).toBe(attendus.size);
    expect(ids).not.toContain(uuid(0x1000 + 5000));
  });

  it('chaque générateur est indépendant : deux déroulements donnent le même registre, tables inchangées', () => {
    const t = tables();
    const avant = JSON.stringify(t);
    const a = deroule(lignesRegistrePhytoParPaquets(t, FERME)).valeur;
    const b = deroule(lignesRegistrePhytoParPaquets(t, FERME)).valeur;
    expect(b).toEqual(a);
    expect(JSON.stringify(t)).toBe(avant);
  });

  it('sans traitement : registre vide', () => {
    expect(deroule(lignesRegistrePhytoParPaquets({ evenement: [] }, FERME)).valeur).toEqual([]);
    expect(lignesRegistrePhyto({}, FERME)).toEqual([]);
  });
});
