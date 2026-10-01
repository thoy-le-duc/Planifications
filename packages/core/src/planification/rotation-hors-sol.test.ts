/**
 * Tests d'acceptation T04b — pas d'alerte de rotation sur le hors-sol (réponse à Q17).
 *
 * Règle : une culture prévue sur un emplacement hors-sol ne déclenche AUCUNE alerte de rotation,
 * quel que soit son historique. Un emplacement est hors-sol si :
 *   - sa sorte est 'gouttiere' (quelle que soit l'abri de sa zone) ;
 *   - OU sa zone (`emplacement.zoneId`, retrouvée dans `hierarchie.zones`) a `typeAbri` 'hors_sol'
 *     (quelle que soit sa sorte : planche, rang ou gouttière).
 * Le type d'abri est porté par la zone (modèle v1) : c'est l'abri ACTUEL de la zone de E qui
 * décide. Zone de E absente de `hierarchie.zones` : abri inconnu, l'alerte est gardée (mieux vaut
 * une alerte en trop qu'une alerte manquée, comme pour T04).
 * Pleine terre (plein champ, tunnel, serre) : règles de T04 inchangées.
 *
 * API : `alertesRotation` garde sa signature. Pour décider, le moteur lit en plus :
 *   - `sorte` sur l'emplacement E passé en deuxième argument ;
 *   - `typeAbri` sur les zones de `hierarchie.zones`.
 * Les tests passent des `Emplacement` et des `Zone` complets : ils compilent que ces champs
 * deviennent obligatoires ou facultatifs dans les types d'entrée (choix du développeur).
 *
 * Exemple du ticket : fraisier (Rosacées, délais de famille 4 / 5 ans, sans délais propres),
 * fraisiers en 2025, fraisiers prévus en 2026 au même endroit (écart 1).
 */
import { describe, expect, it } from 'vitest';
import { analyserDate } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import type { Assolement, Emplacement, Espece, Famille, Id, NomEntite, Saison, TypeAbri, Zone } from '../domaine/index.ts';
import { DATE_SANS_FIN } from './occupations.ts';
import { alertesRotation } from './rotation.ts';
import type { CulturePrevue, HierarchieParcellaire, HistoriqueRotation, OccupationHistorique } from './rotation.ts';

// ---------------------------------------------------------------------------------------------
// Fabriques
// ---------------------------------------------------------------------------------------------

function d(saisie: string): DateCalendaire {
  const resultat = analyserDate(saisie);
  if (!resultat.ok) {
    throw new Error(`date de test invalide : ${saisie}`);
  }
  return resultat.date;
}

function id<E extends NomEntite>(nom: string): Id<E> {
  return nom as Id<E>;
}

const FERME = id<'Ferme'>('ferme');

const ROSACEES: Famille = {
  id: id<'Famille'>('rosacees'),
  fermeId: FERME,
  supprimeLe: null,
  nom: 'Rosacées',
  delaiRetourMinimalAns: 4,
  delaiRetourConseilleAns: 5,
};

const FRAISIER: Espece = {
  id: id<'Espece'>('fraisier'),
  fermeId: FERME,
  supprimeLe: null,
  nom: 'Fraisier',
  familleId: ROSACEES.id,
  categorie: 'petit_fruit',
  perenne: true,
  uniteRecolte: 'barquette',
  delaisRetour: null,
};

const FRAISIERS_PREVUS: CulturePrevue = { espece: FRAISIER, famille: ROSACEES };

function zone(nom: string, typeAbri: TypeAbri, parente: Zone | null = null): Zone {
  return {
    id: id<'Zone'>(nom),
    fermeId: FERME,
    supprimeLe: null,
    nom,
    zoneParenteId: parente?.id ?? null,
    typeAbri,
    surfaceM2: null,
  };
}

const commun = (code: string, z: Zone, remplace: readonly Emplacement[]) => ({
  id: id<'Emplacement'>(code),
  fermeId: FERME,
  supprimeLe: null,
  zoneId: z.id,
  code,
  longueurM: 30,
  largeurM: 0.8,
  actifDu: d('2020-01-01'),
  actifAu: null,
  remplace: remplace.map((r) => r.id),
});

function planche(code: string, z: Zone, remplace: readonly Emplacement[] = []): Emplacement {
  return { ...commun(code, z, remplace), sorte: 'planche' };
}

function rang(code: string, z: Zone): Emplacement {
  return { ...commun(code, z, []), sorte: 'rang' };
}

function gouttiere(code: string, z: Zone, remplace: readonly Emplacement[] = []): Emplacement {
  return { ...commun(code, z, remplace), sorte: 'gouttiere', nombrePlaces: 120 };
}

const SAISONS: readonly Saison[] = [2024, 2025, 2026].map((annee) => ({
  id: id<'Saison'>(String(annee)),
  fermeId: FERME,
  supprimeLe: null,
  nom: String(annee),
  debut: d(`${String(annee)}-01-01`),
  fin: d(`${String(annee)}-12-31`),
}));

/** Fraisiers de mars à novembre 2025 sur `e` : la ligne d'historique de référence. */
function fraisiers2025(e: Emplacement, nom = `fraisiers-2025-${e.code}`): OccupationHistorique {
  return {
    occupation: {
      id: id<'Occupation'>(nom),
      emplacementId: e.id,
      prevuDu: d('2025-03-01'),
      prevuAu: d('2025-12-01'),
      reel: null,
      supprimeLe: null,
    },
    especeId: FRAISIER.id,
    familleId: ROSACEES.id,
  };
}

/** Rosacées en assolement passé saisi sur la zone `z`, saison 2025. */
function rosacees2025Sur(z: Zone): Assolement {
  return {
    id: id<'Assolement'>(`rosacees-2025-${z.nom}`),
    fermeId: FERME,
    supprimeLe: null,
    saisonId: id<'Saison'>('2025'),
    cible: { sorte: 'zone', zoneId: z.id },
    familleId: ROSACEES.id,
    especeId: null,
    nature: 'passe_saisi',
  };
}

function historique(occupations: readonly OccupationHistorique[], assolements: readonly Assolement[] = []): HistoriqueRotation {
  return { occupations, assolements, saisons: SAISONS };
}

function hierarchie(zones: readonly Zone[], emplacements: readonly Emplacement[]): HierarchieParcellaire {
  return { zones, emplacements };
}

/** Fraisiers prévus en 2026 sur `e`, avec ses fraisiers de 2025 (et l'assolement Rosacées de sa zone). */
function fraisiersDeuxAnsDeSuite(e: Emplacement, z: Zone, autresZones: readonly Zone[] = []) {
  return alertesRotation(
    FRAISIERS_PREVUS,
    e,
    2026,
    historique([fraisiers2025(e)], [rosacees2025Sur(z)]),
    hierarchie([z, ...autresZones], [e]),
  );
}

// ---------------------------------------------------------------------------------------------
// Témoin : pleine terre, la règle de T04 ne change pas
// ---------------------------------------------------------------------------------------------

describe('T04b : en pleine terre, l’alerte Rosacées 4 / 5 ans reste inchangée', () => {
  it.each<TypeAbri>(['plein_champ', 'tunnel', 'serre'])(
    'fraisiers sur une planche (abri %s) en 2025 puis en 2026 : alerte rouge, délais de la famille, deux lignes en cause',
    (typeAbri) => {
      const z = zone(`zone-${typeAbri}`, typeAbri);
      const p = planche(`P-${typeAbri}`, z);
      const occ = fraisiers2025(p);
      const asso = rosacees2025Sur(z);
      expect(alertesRotation(FRAISIERS_PREVUS, p, 2026, historique([occ], [asso]), hierarchie([z], [p]))).toEqual([
        {
          niveau: 'rouge',
          delais: { minimalAns: 4, conseilleAns: 5 },
          origineDelais: 'famille',
          lignes: [
            {
              niveau: 'rouge',
              source: { sorte: 'occupation', occupationId: occ.occupation.id },
              culture: { familleId: ROSACEES.id, especeId: FRAISIER.id },
              annee: 2025,
              ecartAns: 1,
              lieu: { sorte: 'emplacement', emplacementId: p.id },
            },
            {
              niveau: 'rouge',
              source: { sorte: 'assolement', assolementId: asso.id },
              culture: { familleId: ROSACEES.id, especeId: null },
              annee: 2025,
              ecartAns: 1,
              lieu: { sorte: 'zone', zoneId: z.id },
            },
          ],
        },
      ]);
    },
  );

  it('fraisiers sur un rang de plein champ deux années de suite : alerte rouge', () => {
    const z = zone('champ', 'plein_champ');
    const r = rang('R-01', z);
    expect(fraisiersDeuxAnsDeSuite(r, z).map((a) => a.niveau)).toEqual(['rouge']);
  });

  it('pleine terre : écart 4 → orange, écart 5 → rien (4 / 5 ans)', () => {
    const z = zone('champ', 'plein_champ');
    const p = planche('P-01', z);
    const h = historique([fraisiers2025(p)]);
    expect(alertesRotation(FRAISIERS_PREVUS, p, 2029, h, hierarchie([z], [p])).map((a) => a.niveau)).toEqual(['orange']);
    expect(alertesRotation(FRAISIERS_PREVUS, p, 2030, h, hierarchie([z], [p]))).toEqual([]);
  });

  it('zone de la planche absente de la hiérarchie : abri inconnu, l’alerte est gardée', () => {
    const z = zone('inconnue', 'hors_sol');
    const p = planche('P-01', z);
    const alertes = alertesRotation(FRAISIERS_PREVUS, p, 2026, historique([fraisiers2025(p)]), hierarchie([], [p]));
    expect(alertes.map((a) => a.niveau)).toEqual(['rouge']);
  });
});

// ---------------------------------------------------------------------------------------------
// Gouttière : jamais d'alerte
// ---------------------------------------------------------------------------------------------

describe('T04b : fraisiers sur une gouttière, aucune alerte', () => {
  it.each<TypeAbri>(['serre', 'tunnel', 'plein_champ', 'hors_sol'])(
    'gouttière dans une zone %s, fraisiers en 2025 puis en 2026 (occupation et assolement de la zone) : []',
    (typeAbri) => {
      const z = zone(`zone-${typeAbri}`, typeAbri);
      expect(fraisiersDeuxAnsDeSuite(gouttiere(`G-${typeAbri}`, z), z)).toEqual([]);
    },
  );

  it('fraisiers en place sans fin (pérenne) sur la gouttière : []', () => {
    const z = zone('serre', 'serre');
    const g = gouttiere('G-01', z);
    const enPlace: OccupationHistorique = {
      ...fraisiers2025(g),
      occupation: { ...fraisiers2025(g).occupation, prevuDu: d('2024-03-01'), prevuAu: DATE_SANS_FIN },
    };
    expect(alertesRotation(FRAISIERS_PREVUS, g, 2026, historique([enPlace]), hierarchie([z], [g]))).toEqual([]);
  });

  it('gouttière dont la zone est absente de la hiérarchie : [] (la sorte suffit)', () => {
    const z = zone('inconnue', 'serre');
    const g = gouttiere('G-01', z);
    expect(alertesRotation(FRAISIERS_PREVUS, g, 2026, historique([fraisiers2025(g)]), hierarchie([], [g]))).toEqual([]);
  });

  it('pleine terre et gouttière dans la même serre : l’alerte reste sur la planche, aucune sur la gouttière', () => {
    const serre = zone('serre', 'serre');
    const p = planche('S-P01', serre);
    const g = gouttiere('S-G01', serre);
    const h = historique([fraisiers2025(p), fraisiers2025(g)], [rosacees2025Sur(serre)]);
    const hi = hierarchie([serre], [p, g]);
    expect(alertesRotation(FRAISIERS_PREVUS, p, 2026, h, hi).map((a) => a.niveau)).toEqual(['rouge']);
    expect(alertesRotation(FRAISIERS_PREVUS, g, 2026, h, hi)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Abri hors-sol : jamais d'alerte, quelle que soit la sorte
// ---------------------------------------------------------------------------------------------

describe('T04b : emplacement dont la zone a l’abri hors_sol, aucune alerte', () => {
  const horsSol = zone('hors-sol', 'hors_sol');

  it('planche en zone hors_sol, fraisiers deux années de suite : []', () => {
    expect(fraisiersDeuxAnsDeSuite(planche('HS-P01', horsSol), horsSol)).toEqual([]);
  });

  it('rang en zone hors_sol, fraisiers deux années de suite : []', () => {
    expect(fraisiersDeuxAnsDeSuite(rang('HS-R01', horsSol), horsSol)).toEqual([]);
  });

  it('gouttière en zone hors_sol : []', () => {
    expect(fraisiersDeuxAnsDeSuite(gouttiere('HS-G01', horsSol), horsSol)).toEqual([]);
  });

  it('chapelle hors_sol dans une serre : l’abri de la zone de l’emplacement décide, même si l’assolement est posé sur la serre', () => {
    const serre = zone('serre', 'serre');
    const chapelle = zone('C-HS', 'hors_sol', serre);
    const p = planche('CHS-P01', chapelle);
    const h = historique([fraisiers2025(p)], [rosacees2025Sur(serre), rosacees2025Sur(chapelle)]);
    expect(alertesRotation(FRAISIERS_PREVUS, p, 2026, h, hierarchie([serre, chapelle], [p]))).toEqual([]);
  });

  it('aussi pour une autre famille : choux (Brassicacées 4 / 6) sur planche hors_sol après des choux : []', () => {
    const brassicacees: Famille = { ...ROSACEES, id: id<'Famille'>('brassicacees'), nom: 'Brassicacées', delaiRetourMinimalAns: 4, delaiRetourConseilleAns: 6 };
    const chou: Espece = { ...FRAISIER, id: id<'Espece'>('chou'), nom: 'Chou', familleId: brassicacees.id, categorie: 'legume', perenne: false, delaisRetour: { minimalAns: 4, conseilleAns: 6 } };
    const p = planche('HS-P02', horsSol);
    const choux2025: OccupationHistorique = { ...fraisiers2025(p, 'choux-2025'), especeId: chou.id, familleId: brassicacees.id };
    expect(alertesRotation({ espece: chou, famille: brassicacees }, p, 2026, historique([choux2025]), hierarchie([horsSol], [p]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Historique mixte : l'emplacement d'aujourd'hui remplace un emplacement de pleine terre
// ---------------------------------------------------------------------------------------------

describe('T04b : historique mixte (lien « remplace »)', () => {
  it('gouttière posée en 2026 à la place d’une planche de pleine terre où étaient des fraisiers en 2025 : [] sur la gouttière', () => {
    const serre = zone('serre', 'serre');
    const ancienne = planche('S-P01-2025', serre);
    const g = gouttiere('S-G01', serre, [ancienne]);
    const h = historique([fraisiers2025(ancienne)], [rosacees2025Sur(serre)]);
    const hi = hierarchie([serre], [ancienne, g]);
    expect(alertesRotation(FRAISIERS_PREVUS, g, 2026, h, hi)).toEqual([]);
    // Témoin : la planche d'origine, elle, garde son alerte.
    expect(alertesRotation(FRAISIERS_PREVUS, ancienne, 2026, h, hi).map((a) => a.niveau)).toEqual(['rouge']);
  });

  it('planche d’une zone passée en hors_sol, qui remplace une planche de plein champ (fraisiers 2025) : []', () => {
    const champ = zone('champ', 'plein_champ');
    const horsSol = zone('hors-sol', 'hors_sol');
    const ancienne = planche('CH-P01', champ);
    const nouvelle = planche('HS-P01', horsSol, [ancienne]);
    const h = historique([fraisiers2025(ancienne)], [rosacees2025Sur(champ)]);
    expect(alertesRotation(FRAISIERS_PREVUS, nouvelle, 2026, h, hierarchie([champ, horsSol], [ancienne, nouvelle]))).toEqual([]);
  });
});
