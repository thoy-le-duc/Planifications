/**
 * T32b — qui a le feuillage après la récolte (Q33) : seul le profil par défaut de l'asperge, reconnu par
 * identité. Une copie réglée par la ferme suit son seul cycle annuel (comme T32a) ; le type du profil
 * et la base ne changent pas.
 */
import { describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { croissancePerenneA, profilEffectif, profilParDefaut } from './index.ts';
import { feuillageApresRecolte } from './defauts.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
const SANS_DATES = { annee: 2027, debutRecolte: null, finRecolte: null };

describe('T32b : feuillageApresRecolte', () => {
  it('seule l’asperge de la bibliothèque l’a ; sa copie lue de la base, non', () => {
    for (const nom of ['Kiwi', 'Pivoine', 'Fraisier', 'Fraise', 'Tomate', 'Laitue', 'Espèce inconnue']) expect(feuillageApresRecolte(profilParDefaut(nom).profil), nom).toBe(false);
    const asperge = profilParDefaut('Asperge').profil;
    expect(feuillageApresRecolte(asperge)).toBe(true);
    expect(feuillageApresRecolte(profilEffectif({ nom: 'Asperge', profilCroissance: null }))).toBe(true);
    expect(feuillageApresRecolte({ ...asperge })).toBe(false);
    expect(feuillageApresRecolte(profilEffectif({ nom: 'Asperge', profilCroissance: JSON.stringify(asperge) }))).toBe(false);
  });

  it('une asperge réglée par la ferme monte dès le débourrement (comportement de T32a)', () => {
    const copie = { ...profilParDefaut('Asperge').profil };
    const avril = croissancePerenneA({ plantation: PLANTATION, campagne: SANS_DATES }, copie, ajouterJours(d('2027-04-01'), 20));
    expect(avril.hauteurM).toBeGreaterThan(0);
    const defaut = croissancePerenneA({ plantation: PLANTATION, campagne: SANS_DATES }, profilParDefaut('Asperge').profil, ajouterJours(d('2027-04-01'), 20));
    expect(defaut.hauteurM).toBe(0);
  });
});
