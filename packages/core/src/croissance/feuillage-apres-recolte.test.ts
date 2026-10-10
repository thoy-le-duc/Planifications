/**
 * T32b — qui a le feuillage après la récolte (Q33). Depuis T32c, la règle est portée par le champ
 * `fougereApresRecolte` du profil (et non plus par l'identité de l'objet par défaut) : une copie qui
 * garde le champ garde la règle ; un profil sans le champ suit son seul cycle annuel (comme T32a).
 */
import { describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { croissancePerenneA, profilEffectif, profilParDefaut } from './index.ts';
import { feuillageApresRecolte } from './defauts.ts';
import type { ProfilCroissance } from './types.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
const SANS_DATES = { annee: 2027, debutRecolte: null, finRecolte: null };

/** Le profil sans le champ `fougereApresRecolte`. */
function sansChamp(p: ProfilCroissance): ProfilCroissance {
  return Object.fromEntries(Object.entries(p).filter(([cle]) => cle !== 'fougereApresRecolte')) as unknown as ProfilCroissance;
}

describe('T32b : feuillageApresRecolte', () => {
  it('seule l’asperge de la bibliothèque l’a ; sa copie qui garde le champ aussi, un profil sans le champ non', () => {
    for (const nom of ['Kiwi', 'Pivoine', 'Fraisier', 'Fraise', 'Tomate', 'Laitue', 'Espèce inconnue']) expect(feuillageApresRecolte(profilParDefaut(nom).profil), nom).toBe(false);
    const asperge = profilParDefaut('Asperge').profil;
    expect(feuillageApresRecolte(asperge)).toBe(true);
    expect(feuillageApresRecolte(profilEffectif({ nom: 'Asperge', profilCroissance: null }))).toBe(true);
    expect(feuillageApresRecolte({ ...asperge })).toBe(true);
    expect(feuillageApresRecolte(profilEffectif({ nom: 'Asperge', profilCroissance: JSON.stringify(asperge) }))).toBe(true);
    expect(feuillageApresRecolte(sansChamp(asperge))).toBe(false);
    expect(feuillageApresRecolte(profilEffectif({ nom: 'Asperge', profilCroissance: JSON.stringify(sansChamp(asperge)) }))).toBe(false);
  });

  it('une asperge réglée par la ferme sans le champ monte dès le débourrement (comportement de T32a)', () => {
    const copie = sansChamp(profilParDefaut('Asperge').profil);
    const avril = croissancePerenneA({ plantation: PLANTATION, campagne: SANS_DATES }, copie, ajouterJours(d('2027-04-01'), 20));
    expect(avril.hauteurM).toBeGreaterThan(0);
    const avecChamp = { ...profilParDefaut('Asperge').profil };
    const defaut = croissancePerenneA({ plantation: PLANTATION, campagne: SANS_DATES }, avecChamp, ajouterJours(d('2027-04-01'), 20));
    expect(defaut.hauteurM).toBe(0);
  });
});
