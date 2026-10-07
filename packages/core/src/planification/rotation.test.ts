/**
 * Tests d'acceptation T04 — alertes de rotation.
 *
 * API attendue, exportée par `packages/core/src/planification/rotation.ts` :
 *
 *   type NiveauAlerteRotation = 'rouge' | 'orange'
 *
 *   interface CulturePrevue {
 *     readonly espece: Pick<Espece, 'id' | 'familleId' | 'delaisRetour'>;
 *     readonly famille: Pick<Famille, 'id' | 'delaiRetourMinimalAns' | 'delaiRetourConseilleAns'> | null;
 *   }
 *     `famille` est celle de l'espèce (`espece.familleId`), ou `null` si l'appelant ne la connaît pas.
 *
 *   interface OccupationHistorique {
 *     readonly occupation: Pick<Occupation, 'id' | 'emplacementId' | 'prevuDu' | 'prevuAu' | 'reel' | 'supprimeLe'>;
 *     readonly especeId: Id<'Espece'>;     // espèce de l'occupant (série ou plantation)
 *     readonly familleId: Id<'Famille'>;   // famille de cette espèce
 *   }
 *
 *   interface HistoriqueRotation {
 *     readonly occupations: readonly OccupationHistorique[];
 *     readonly assolements: readonly Assolement[];       // toutes natures ; le 'prevu' est ignoré
 *     readonly saisons: readonly Pick<Saison, 'id' | 'fin'>[];
 *   }
 *
 *   interface HierarchieParcellaire {
 *     readonly zones: readonly Pick<Zone, 'id' | 'zoneParenteId'>[];
 *     readonly emplacements: readonly Pick<Emplacement, 'id' | 'zoneId' | 'remplace'>[];
 *   }
 *
 *   type SourceLigneRotation =
 *     | { readonly sorte: 'occupation'; readonly occupationId: Id<'Occupation'> }
 *     | { readonly sorte: 'assolement'; readonly assolementId: Id<'Assolement'> }
 *
 *   interface LigneEnCause {
 *     readonly niveau: NiveauAlerteRotation;
 *     readonly source: SourceLigneRotation;
 *     readonly culture: { readonly familleId: Id<'Famille'>; readonly especeId: Id<'Espece'> | null };
 *     readonly annee: number;          // année retenue pour la ligne (voir règles)
 *     readonly ecartAns: number;       // anneeMiseEnPlace − annee, toujours ≥ 0
 *     readonly lieu: CibleAssolement;  // { sorte: 'emplacement', emplacementId } | { sorte: 'zone', zoneId }
 *   }
 *
 *   interface AlerteRotation {
 *     readonly niveau: NiveauAlerteRotation;          // le plus grave de ses lignes
 *     readonly delais: DelaisRetour;                  // délais appliqués { minimalAns, conseilleAns }
 *     readonly origineDelais: 'espece' | 'famille';
 *     readonly lignes: readonly LigneEnCause[];       // jamais vide, la plus grave d'abord
 *   }
 *
 *   alertesRotation(
 *     culturePrevue: CulturePrevue,
 *     emplacement: Pick<Emplacement, 'id' | 'zoneId' | 'remplace'>,   // E
 *     anneeMiseEnPlace: number,
 *     historique: HistoriqueRotation,
 *     hierarchie: HierarchieParcellaire,
 *     exclure?: ReadonlySet<Id<'Occupation'>>,   // défaut : ensemble vide
 *   ): readonly AlerteRotation[]        (pure : aucune donnée lue ailleurs, entrées jamais modifiées)
 *     Renvoie [] ou UNE seule alerte qui regroupe toutes les lignes en cause.
 *
 *   `anneeMiseEnPlace` est l'année civile de la date de mise en place prévue de la culture.
 *   `exclure` : occupations qui ne comptent pas. Sert à ne pas comparer une série à elle-même
 *   quand on revérifie une culture déjà placée : l'appelant y met ses propres occupations.
 *
 * Règles :
 *   - Délais : `espece.delaisRetour` s'il est rempli (origine 'espece'), sinon ceux de `famille`
 *     (origine 'famille'). Ni l'un ni l'autre : [] (pas d'alerte, pas d'erreur).
 *     Délais applicables incohérents (minimal > conseillé) : RangeError, c'est une erreur de
 *     saisie à corriger, pas un cas à deviner. Minimal = conseillé est permis (jamais d'orange).
 *   - Culture prévue : `famille` non nulle dont l'id diffère de `espece.familleId` : RangeError.
 *   - Lieux pris en compte pour E :
 *       emplacements : E, puis les emplacements que E remplace, de proche en proche (A remplace B,
 *       B remplace C… : A, B, C). Un emplacement absent de `hierarchie.emplacements` compte avec
 *       son propre id, mais on ne peut pas remonter plus loin depuis lui ;
 *       zones : la zone de E (`E.zoneId`, sa chapelle) ET la zone de chaque emplacement remplacé
 *       connu de la hiérarchie, puis toutes leurs parentes par `zoneParenteId` jusqu'à la racine.
 *       C'est le même sol : on préfère une alerte en trop à une alerte manquée. Une zone absente
 *       de `hierarchie.zones` compte avec son propre id, sans remonter plus loin.
 *     Les deux parcours se protègent des cycles (A remplace B qui remplace A ; zone parente
 *     d'elle-même) : chaque lieu est visité une fois, pas de boucle infinie, pas de doublon.
 *   - Occupations : celles dont `emplacementId` est l'un des emplacements retenus, hors `exclure`.
 *     L'historique comprend toutes les occupations fournies antérieures à l'année prévue (ou en
 *     place cette année-là), y compris celles qui sont prévues mais pas encore réalisées.
 *     Assolement : les lignes 'passe_saisi' et 'passe_importe' dont la cible est l'un des
 *     emplacements retenus (E ou un emplacement qu'il remplace) ou l'une des zones retenues.
 *     L'assolement 'prevu' est ignoré. Toute ligne avec `supprimeLe !== null` est ignorée.
 *   - Même famille seulement : `ligne.familleId === culturePrevue.espece.familleId`. Sur une ligne
 *     d'assolement, `familleId` fait foi quelle que soit son `especeId` (jamais relue).
 *   - Année d'une occupation : période lue par `periodeOccupation` (réel prioritaire sur le prévu,
 *     DATE_SANS_FIN → au null). `au` est le jour où l'emplacement se libère (exclu) : l'année de
 *     fin est celle du DERNIER JOUR OCCUPÉ, au − 1 jour (au = 2026-01-01 → 2025).
 *       · occupation en cours (réel commencé, réel.au null) : fin prévue (`prevuAu`), c'est ce
 *         que rend periodeOccupation ;
 *       · pérenne sans fin (au null) : toujours en place, année = anneeMiseEnPlace, écart 0 ;
 *       · fin postérieure à l'année prévue alors que la ligne a commencé au plus tard cette
 *         année-là : la culture est encore en place, année ramenée à anneeMiseEnPlace (écart 0) ;
 *       · occupation qui COMMENCE après l'année prévue : ignorée (ce n'est pas de l'historique ;
 *         l'alerte viendra quand cette culture-là sera vérifiée).
 *     Année d'un assolement : année civile de la `fin` de sa saison, choix prudent (comme l'année
 *     de fin d'occupation, elle rapproche la ligne de l'année prévue ; une
 *     saison 2025-09-01 → 2026-08-31 compte pour 2026). Saison postérieure à l'année prévue :
 *     ignorée. Saison introuvable dans `historique.saisons` : ligne ignorée.
 *     Bilan : un écart n'est jamais négatif.
 *   - Écart = anneeMiseEnPlace − année de la ligne. Rouge si écart < minimal ; orange si
 *     minimal ≤ écart < conseillé ; rien sinon.
 *   - Tri des lignes : rouge avant orange, puis écart croissant (la plus récente d'abord), puis
 *     occupations avant assolements, puis id croissant (ordre des chaînes). Déterministe.
 *   - `culture` : pour une occupation { familleId, especeId } de l'historique ; pour un
 *     assolement { familleId, especeId } de la ligne (especeId peut être null).
 *     `lieu` : pour une occupation { sorte: 'emplacement', emplacementId } (l'emplacement remplacé
 *     s'il y a lieu) ; pour un assolement, sa cible telle quelle.
 *   - RangeError si anneeMiseEnPlace n'est pas un entier.
 */
import { describe, expect, it } from 'vitest';
import { analyserDate } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import type {
  Assolement,
  CibleAssolement,
  Emplacement,
  Espece,
  Famille,
  Id,
  IntervalleDates,
  NatureAssolement,
  NomEntite,
  Saison,
  Zone,
} from '../domaine/index.ts';
import { DATE_SANS_FIN } from './occupations.ts';
import { alertesRotation } from './rotation.ts';
import type {
  AlerteRotation,
  CulturePrevue,
  HierarchieParcellaire,
  HistoriqueRotation,
  LigneEnCause,
  OccupationHistorique,
} from './rotation.ts';

// ---------------------------------------------------------------------------------------------
// Fabriques de test
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

// Familles et espèces --------------------------------------------------------------------------

function famille(nom: string, minimal: number, conseille: number): Famille {
  return {
    id: id<'Famille'>(nom),
    fermeId: FERME,
    supprimeLe: null,
    nom,
    delaiRetourMinimalAns: minimal,
    delaiRetourConseilleAns: conseille,
  };
}

const BRASSICACEES = famille('brassicacees', 3, 4);
const SOLANACEES = famille('solanacees', 3, 4);

function espece(nom: string, fam: Famille, delais: { minimalAns: number; conseilleAns: number } | null): Espece {
  return {
    id: id<'Espece'>(nom),
    fermeId: FERME,
    supprimeLe: null,
    nom,
    familleId: fam.id,
    categorie: 'legume',
    perenne: false,
    uniteRecolte: 'kg',
    delaisRetour: delais,
  };
}

const CHOU = espece('chou', BRASSICACEES, { minimalAns: 4, conseilleAns: 6 });
const RADIS = espece('radis', BRASSICACEES, null);
const CHOU_PERPETUEL = espece('chou-perpetuel', BRASSICACEES, null);
const TOMATE = espece('tomate', SOLANACEES, null);

const CHOUX_PREVUS: CulturePrevue = { espece: CHOU, famille: BRASSICACEES };
const RADIS_PREVUS: CulturePrevue = { espece: RADIS, famille: BRASSICACEES };

// Parcellaire : serre multichapelle → chapelles C2, C3 → planches -------------------------------

function zone(nom: string, parente: string | null): Zone {
  return {
    id: id<'Zone'>(nom),
    fermeId: FERME,
    supprimeLe: null,
    nom,
    zoneParenteId: parente === null ? null : id<'Zone'>(parente),
    typeAbri: 'serre',
    surfaceM2: null,
    contour: null,
  };
}

const SERRE = zone('serre', null);
const C2 = zone('C2', 'serre');
const C3 = zone('C3', 'serre');

function planche(code: string, zoneId: Id<'Zone'>, remplace: readonly string[] = []): Emplacement {
  return {
    id: id<'Emplacement'>(code),
    fermeId: FERME,
    supprimeLe: null,
    zoneId,
    code,
    sorte: 'planche',
    longueurM: 30,
    largeurM: 0.8,
    actifDu: d('2020-01-01'),
    actifAu: null,
    remplace: remplace.map((r) => id<'Emplacement'>(r)),
    placementXM: null,
    placementYM: null,
    orientationDeg: null,
  };
}

/** C3-P02 d'aujourd'hui, redessinée en 2024 à partir de C3-P02-2019, elle-même issue de C3-P02-2015. */
const C3_P02_2015 = planche('C3-P02-2015', C3.id);
const C3_P02_2019 = planche('C3-P02-2019', C3.id, ['C3-P02-2015']);
const C3_P02 = planche('C3-P02', C3.id, ['C3-P02-2019']);
const C3_P01 = planche('C3-P01', C3.id);
const C2_P01 = planche('C2-P01', C2.id);

const HIERARCHIE: HierarchieParcellaire = {
  zones: [SERRE, C2, C3],
  emplacements: [C3_P02_2015, C3_P02_2019, C3_P02, C3_P01, C2_P01],
};

// Saisons : années civiles 2015 à 2030 -----------------------------------------------------------

function saison(annee: number): Saison {
  return {
    id: id<'Saison'>(String(annee)),
    fermeId: FERME,
    supprimeLe: null,
    nom: String(annee),
    debut: d(`${String(annee)}-01-01`),
    fin: d(`${String(annee)}-12-31`),
  };
}

const SAISONS: readonly Saison[] = Array.from({ length: 16 }, (_, i) => saison(2015 + i));

// Historique ------------------------------------------------------------------------------------

function surZone(z: Zone): CibleAssolement {
  return { sorte: 'zone', zoneId: z.id };
}

function surEmplacement(e: Emplacement): CibleAssolement {
  return { sorte: 'emplacement', emplacementId: e.id };
}

function assolement(
  nom: string,
  nature: NatureAssolement,
  cible: CibleAssolement,
  fam: Famille,
  annee: number,
  options: { readonly especeId?: Id<'Espece'>; readonly supprimeLe?: number; readonly saisonId?: Id<'Saison'> } = {},
): Assolement {
  const commun = {
    id: id<'Assolement'>(nom),
    fermeId: FERME,
    supprimeLe: options.supprimeLe ?? null,
    saisonId: options.saisonId ?? id<'Saison'>(String(annee)),
    cible,
    familleId: fam.id,
    especeId: options.especeId ?? null,
  };
  switch (nature) {
    case 'prevu':
      return { ...commun, nature: 'prevu' };
    case 'passe_saisi':
      return { ...commun, nature: 'passe_saisi' };
    case 'passe_importe':
      return { ...commun, nature: 'passe_importe', sourceImport: 'elzeard.csv' };
  }
}

function occupation(
  nom: string,
  emplacement: Emplacement,
  esp: Espece,
  prevuDu: string,
  prevuAu: string,
  options: { readonly reel?: IntervalleDates; readonly supprimeLe?: number } = {},
): OccupationHistorique {
  return {
    occupation: {
      id: id<'Occupation'>(nom),
      emplacementId: emplacement.id,
      prevuDu: d(prevuDu),
      prevuAu: prevuAu === DATE_SANS_FIN ? DATE_SANS_FIN : d(prevuAu),
      reel: options.reel ?? null,
      supprimeLe: options.supprimeLe ?? null,
    },
    especeId: esp.id,
    familleId: esp.familleId,
  };
}

function historique(
  occupations: readonly OccupationHistorique[],
  assolements: readonly Assolement[],
  saisons: readonly Saison[] = SAISONS,
): HistoriqueRotation {
  return { occupations, assolements, saisons };
}

/** Assolement de référence du ticket : brassicacées sur toute la chapelle C3 en 2023. */
const BRASSICACEES_C3_2023 = assolement('brassicacees-C3-2023', 'passe_saisi', surZone(C3), BRASSICACEES, 2023);

function ligneAssolement(
  a: Assolement,
  annee: number,
  ecartAns: number,
  niveau: 'rouge' | 'orange',
): LigneEnCause {
  return {
    niveau,
    source: { sorte: 'assolement', assolementId: a.id },
    culture: { familleId: a.familleId, especeId: a.especeId },
    annee,
    ecartAns,
    lieu: a.cible,
  };
}

function ligneOccupation(
  o: OccupationHistorique,
  annee: number,
  ecartAns: number,
  niveau: 'rouge' | 'orange',
): LigneEnCause {
  return {
    niveau,
    source: { sorte: 'occupation', occupationId: o.occupation.id },
    culture: { familleId: o.familleId, especeId: o.especeId },
    annee,
    ecartAns,
    lieu: { sorte: 'emplacement', emplacementId: o.occupation.emplacementId },
  };
}

/** Raccourci : choux prévus sur C3-P02. */
function alertesChoux(annee: number, h: HistoriqueRotation): readonly AlerteRotation[] {
  return alertesRotation(CHOUX_PREVUS, C3_P02, annee, h, HIERARCHIE);
}

/** Niveaux et années des lignes de l'unique alerte, pour des assertions compactes. */
function resume(alertes: readonly AlerteRotation[]): readonly string[] {
  expect(alertes).toHaveLength(1);
  const [alerte] = alertes;
  if (alerte === undefined) {
    throw new Error('alerte attendue');
  }
  return alerte.lignes.map((l) => `${l.niveau} ${String(l.annee)} écart ${String(l.ecartAns)}`);
}

// ---------------------------------------------------------------------------------------------
// Exemple de référence du ticket
// ---------------------------------------------------------------------------------------------

describe('exemple du ticket : choux (4/6 ans) sur C3-P02, brassicacées sur la chapelle C3 en 2023', () => {
  const h = historique([], [BRASSICACEES_C3_2023]);
  const delaisChou = { minimalAns: 4, conseilleAns: 6 };

  it('2026 : écart 3, rouge', () => {
    expect(alertesChoux(2026, h)).toEqual([
      {
        niveau: 'rouge',
        delais: delaisChou,
        origineDelais: 'espece',
        lignes: [ligneAssolement(BRASSICACEES_C3_2023, 2023, 3, 'rouge')],
      },
    ]);
  });

  it('2027 : écart 4, orange', () => {
    expect(alertesChoux(2027, h)).toEqual([
      {
        niveau: 'orange',
        delais: delaisChou,
        origineDelais: 'espece',
        lignes: [ligneAssolement(BRASSICACEES_C3_2023, 2023, 4, 'orange')],
      },
    ]);
  });

  it('2028 : écart 5, orange', () => {
    expect(alertesChoux(2028, h)).toEqual([
      {
        niveau: 'orange',
        delais: delaisChou,
        origineDelais: 'espece',
        lignes: [ligneAssolement(BRASSICACEES_C3_2023, 2023, 5, 'orange')],
      },
    ]);
  });

  it('2029 : écart 6, aucune alerte', () => {
    expect(alertesChoux(2029, h)).toEqual([]);
  });

  it('assolement importé : même résultat que saisi', () => {
    const importe = assolement('importe-C3-2023', 'passe_importe', surZone(C3), BRASSICACEES, 2023);
    expect(resume(alertesChoux(2026, historique([], [importe])))).toEqual(['rouge 2023 écart 3']);
  });

  it('fonction pure : entrées non modifiées, même résultat à chaque appel', () => {
    const avant = JSON.stringify({ h, HIERARCHIE, CHOUX_PREVUS, C3_P02 });
    const premier = alertesChoux(2026, h);
    expect(alertesChoux(2026, h)).toEqual(premier);
    expect(JSON.stringify({ h, HIERARCHIE, CHOUX_PREVUS, C3_P02 })).toBe(avant);
  });
});

// ---------------------------------------------------------------------------------------------
// Délais applicables
// ---------------------------------------------------------------------------------------------

describe('délais : espèce sinon famille', () => {
  const h = historique([], [BRASSICACEES_C3_2023]);

  it('radis sans délais propres : ceux des brassicacées (3/4) s’appliquent', () => {
    expect(alertesRotation(RADIS_PREVUS, C3_P02, 2025, h, HIERARCHIE)).toEqual([
      {
        niveau: 'rouge',
        delais: { minimalAns: 3, conseilleAns: 4 },
        origineDelais: 'famille',
        lignes: [ligneAssolement(BRASSICACEES_C3_2023, 2023, 2, 'rouge')],
      },
    ]);
    expect(resume(alertesRotation(RADIS_PREVUS, C3_P02, 2026, h, HIERARCHIE))).toEqual(['orange 2023 écart 3']);
    expect(alertesRotation(RADIS_PREVUS, C3_P02, 2027, h, HIERARCHIE)).toEqual([]);
  });

  it('les délais de l’espèce priment : choux en 2027 orange alors que la famille dirait « rien »', () => {
    expect(resume(alertesChoux(2027, h))).toEqual(['orange 2023 écart 4']);
  });

  it('famille inconnue et espèce sans délais : pas d’alerte', () => {
    expect(alertesRotation({ espece: RADIS, famille: null }, C3_P02, 2024, h, HIERARCHIE)).toEqual([]);
  });

  it('famille inconnue mais délais propres à l’espèce : ils s’appliquent', () => {
    const alertes = alertesRotation({ espece: CHOU, famille: null }, C3_P02, 2026, h, HIERARCHIE);
    expect(resume(alertes)).toEqual(['rouge 2023 écart 3']);
    expect(alertes[0]?.origineDelais).toBe('espece');
  });
});

// ---------------------------------------------------------------------------------------------
// Occupations passées
// ---------------------------------------------------------------------------------------------

describe('occupations passées', () => {
  it('radis (brassicacée) en 2025 sur C3-P02 : alerte rouge pour des choux en 2027', () => {
    const radis = occupation('radis-2025', C3_P02, RADIS, '2025-04-01', '2025-05-20');
    expect(alertesChoux(2027, historique([radis], []))).toEqual([
      {
        niveau: 'rouge',
        delais: { minimalAns: 4, conseilleAns: 6 },
        origineDelais: 'espece',
        lignes: [ligneOccupation(radis, 2025, 2, 'rouge')],
      },
    ]);
  });

  it('les dates réelles priment sur le prévu (periodeOccupation)', () => {
    const radis = occupation('radis', C3_P02, RADIS, '2025-10-01', '2026-02-01', {
      reel: { du: d('2025-09-01'), au: d('2025-11-15') },
    });
    expect(resume(alertesChoux(2030, historique([radis], [])))).toEqual(['orange 2025 écart 5']);
  });

  it('fin exclue : libérée le 2026-01-01, la culture compte pour 2025', () => {
    const chou = occupation('chou-hiver', C3_P02, CHOU, '2025-09-01', '2026-01-01');
    expect(resume(alertesChoux(2030, historique([chou], [])))).toEqual(['orange 2025 écart 5']);
  });

  it('occupation en cours (réel commencé, sans fin réelle) : sa fin prévue fait foi', () => {
    const chou = occupation('chou-en-cours', C3_P02, CHOU, '2026-08-01', '2026-12-15', {
      reel: { du: d('2026-08-10'), au: null },
    });
    expect(resume(alertesChoux(2027, historique([chou], [])))).toEqual(['rouge 2026 écart 1']);
  });

  it('pérenne sans fin (chou perpétuel en place) : écart 0, rouge', () => {
    const perpetuel = occupation('perpetuel', C3_P02, CHOU_PERPETUEL, '2020-04-01', DATE_SANS_FIN);
    expect(alertesChoux(2027, historique([perpetuel], []))).toEqual([
      {
        niveau: 'rouge',
        delais: { minimalAns: 4, conseilleAns: 6 },
        origineDelais: 'espece',
        lignes: [ligneOccupation(perpetuel, 2027, 0, 'rouge')],
      },
    ]);
  });

  it('culture commencée avant et finissant après l’année prévue : année ramenée à l’année prévue, écart 0', () => {
    const chou = occupation('chou-long', C3_P02, CHOU, '2026-10-01', '2028-03-01');
    expect(resume(alertesChoux(2027, historique([chou], [])))).toEqual(['rouge 2027 écart 0']);
  });

  it('culture qui commence après l’année prévue : ignorée (pas d’écart négatif)', () => {
    const chou = occupation('chou-futur', C3_P02, CHOU, '2028-04-01', '2028-07-01');
    expect(alertesChoux(2027, historique([chou], []))).toEqual([]);
  });

  it('occupation supprimée (suppression douce) : ignorée', () => {
    const radis = occupation('radis-supprime', C3_P02, RADIS, '2025-04-01', '2025-05-20', { supprimeLe: 1 });
    expect(alertesChoux(2027, historique([radis], []))).toEqual([]);
  });

  it('occupation d’une autre planche, même de la même chapelle : ignorée', () => {
    const radis = occupation('radis-P01', C3_P01, RADIS, '2025-04-01', '2025-05-20');
    expect(alertesChoux(2027, historique([radis], []))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Lieux : hiérarchie des zones et lien « remplace »
// ---------------------------------------------------------------------------------------------

describe('lieux pris en compte', () => {
  it('ligne posée sur une autre chapelle (C2) : ignorée', () => {
    const surC2 = assolement('brassicacees-C2', 'passe_saisi', surZone(C2), BRASSICACEES, 2025);
    const surC2P01 = assolement('brassicacees-C2-P01', 'passe_saisi', surEmplacement(C2_P01), BRASSICACEES, 2025);
    expect(alertesChoux(2027, historique([], [surC2, surC2P01]))).toEqual([]);
  });

  it('ligne posée sur une planche voisine de la même chapelle : ignorée', () => {
    const surP01 = assolement('brassicacees-C3-P01', 'passe_saisi', surEmplacement(C3_P01), BRASSICACEES, 2025);
    expect(alertesChoux(2027, historique([], [surP01]))).toEqual([]);
  });

  it('ligne posée sur la planche elle-même : prise en compte', () => {
    const surP02 = assolement('brassicacees-C3-P02', 'passe_saisi', surEmplacement(C3_P02), BRASSICACEES, 2024);
    expect(resume(alertesChoux(2027, historique([], [surP02])))).toEqual(['rouge 2024 écart 3']);
  });

  it('ligne posée sur la serre entière (zone parente de la chapelle) : prise en compte', () => {
    const surSerre = assolement('brassicacees-serre', 'passe_saisi', surZone(SERRE), BRASSICACEES, 2022);
    expect(alertesChoux(2027, historique([], [surSerre]))).toEqual([
      {
        niveau: 'orange',
        delais: { minimalAns: 4, conseilleAns: 6 },
        origineDelais: 'espece',
        lignes: [ligneAssolement(surSerre, 2022, 5, 'orange')],
      },
    ]);
  });

  it('planche redessinée : occupation de la planche qu’elle remplace héritée', () => {
    const radis = occupation('radis-ancienne', C3_P02_2019, RADIS, '2024-04-01', '2024-05-20');
    expect(alertesChoux(2027, historique([radis], []))).toEqual([
      {
        niveau: 'rouge',
        delais: { minimalAns: 4, conseilleAns: 6 },
        origineDelais: 'espece',
        lignes: [ligneOccupation(radis, 2024, 3, 'rouge')],
      },
    ]);
  });

  it('« remplace » sur deux niveaux : occupation de la planche de 2015 héritée', () => {
    const chou = occupation('chou-2022', C3_P02_2015, CHOU, '2022-03-01', '2022-07-01');
    expect(resume(alertesChoux(2027, historique([chou], [])))).toEqual(['orange 2022 écart 5']);
  });

  it('assolement posé sur une planche remplacée : hérité aussi', () => {
    const surAncienne = assolement('brassicacees-ancienne', 'passe_importe', surEmplacement(C3_P02_2015), BRASSICACEES, 2024);
    expect(resume(alertesChoux(2027, historique([], [surAncienne])))).toEqual(['rouge 2024 écart 3']);
  });

  it('le lien ne vaut que dans un sens : la planche remplacée n’hérite pas de la nouvelle', () => {
    const radis = occupation('radis-nouvelle', C3_P02, RADIS, '2025-04-01', '2025-05-20');
    const h = historique([radis], []);
    // Même zone C3 : seule la ligne d'occupation de C3-P02 pourrait remonter, elle ne doit pas.
    expect(alertesRotation(CHOUX_PREVUS, C3_P02_2019, 2027, h, HIERARCHIE)).toEqual([]);
  });

  it('emplacement remplacé absent de la hiérarchie : ses occupations comptent quand même', () => {
    const fantome = planche('C3-P02-disparue', C3.id);
    const e = planche('C3-P02-bis', C3.id, ['C3-P02-disparue']);
    const radis = occupation('radis-fantome', fantome, RADIS, '2025-04-01', '2025-05-20');
    const hierarchie: HierarchieParcellaire = { zones: HIERARCHIE.zones, emplacements: [e] };
    expect(resume(alertesRotation(CHOUX_PREVUS, e, 2027, historique([radis], []), hierarchie))).toEqual([
      'rouge 2025 écart 2',
    ]);
  });

  it('cycle dans « remplace » : pas de boucle infinie, chaque ligne une seule fois', () => {
    const a = planche('A', C3.id, ['B']);
    const b = planche('B', C3.id, ['C']);
    const c = planche('C', C3.id, ['A', 'B']);
    const hierarchie: HierarchieParcellaire = { zones: HIERARCHIE.zones, emplacements: [a, b, c] };
    const surB = occupation('radis-B', b, RADIS, '2025-04-01', '2025-05-20');
    const surC = occupation('chou-C', c, CHOU, '2022-04-01', '2022-07-01');
    const alertes = alertesRotation(CHOUX_PREVUS, a, 2027, historique([surC, surB], []), hierarchie);
    expect(resume(alertes)).toEqual(['rouge 2025 écart 2', 'orange 2022 écart 5']);
  });

  it('emplacement qui se remplace lui-même : pas de boucle infinie', () => {
    const e = planche('E', C3.id, ['E']);
    const hierarchie: HierarchieParcellaire = { zones: HIERARCHIE.zones, emplacements: [e] };
    const radis = occupation('radis-E', e, RADIS, '2025-04-01', '2025-05-20');
    expect(resume(alertesRotation(CHOUX_PREVUS, e, 2027, historique([radis], []), hierarchie))).toEqual([
      'rouge 2025 écart 2',
    ]);
  });

  it('cycle dans les zones parentes : pas de boucle infinie', () => {
    const x = zone('X', 'Y');
    const y = zone('Y', 'X');
    const e = planche('X-P01', x.id);
    const hierarchie: HierarchieParcellaire = { zones: [x, y], emplacements: [e] };
    const surY = assolement('brassicacees-Y', 'passe_saisi', surZone(y), BRASSICACEES, 2024);
    expect(resume(alertesRotation(CHOUX_PREVUS, e, 2027, historique([], [surY]), hierarchie))).toEqual([
      'rouge 2024 écart 3',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Assolement : nature, saison, suppression
// ---------------------------------------------------------------------------------------------

describe('assolement', () => {
  it('assolement prévu : ignoré', () => {
    const prevu = assolement('prevu-C3-2025', 'prevu', surZone(C3), BRASSICACEES, 2025);
    const prevuP02 = assolement('prevu-P02-2026', 'prevu', surEmplacement(C3_P02), BRASSICACEES, 2026);
    expect(alertesChoux(2027, historique([], [prevu, prevuP02]))).toEqual([]);
  });

  it('assolement supprimé : ignoré', () => {
    const supprime = assolement('supprime', 'passe_saisi', surZone(C3), BRASSICACEES, 2025, { supprimeLe: 1 });
    expect(alertesChoux(2027, historique([], [supprime]))).toEqual([]);
  });

  it('saison à cheval sur deux années : compte pour l’année de sa fin', () => {
    const hiver: Saison = {
      ...saison(2026),
      id: id<'Saison'>('hiver-2025-2026'),
      debut: d('2025-09-01'),
      fin: d('2026-08-31'),
    };
    const ligne = assolement('hiver', 'passe_saisi', surZone(C3), BRASSICACEES, 0, { saisonId: hiver.id });
    expect(resume(alertesChoux(2030, historique([], [ligne], [...SAISONS, hiver])))).toEqual([
      'orange 2026 écart 4',
    ]);
  });

  it('saison postérieure à l’année prévue : ignorée', () => {
    const futur = assolement('passe-2028', 'passe_saisi', surZone(C3), BRASSICACEES, 2028);
    expect(alertesChoux(2027, historique([], [futur]))).toEqual([]);
  });

  it('même année que la mise en place prévue : écart 0, rouge', () => {
    const memeAnnee = assolement('passe-2027', 'passe_saisi', surZone(C3), BRASSICACEES, 2027);
    expect(resume(alertesChoux(2027, historique([], [memeAnnee])))).toEqual(['rouge 2027 écart 0']);
  });

  it('saison introuvable : ligne ignorée', () => {
    const orpheline = assolement('orpheline', 'passe_saisi', surZone(C3), BRASSICACEES, 0, {
      saisonId: id<'Saison'>('inconnue'),
    });
    expect(alertesChoux(2027, historique([], [orpheline]))).toEqual([]);
  });

  it('l’espèce précisée sur la ligne est recopiée dans la culture en cause', () => {
    const ligne = assolement('choux-C3-2024', 'passe_saisi', surZone(C3), BRASSICACEES, 2024, { especeId: CHOU.id });
    const [alerte] = alertesChoux(2027, historique([], [ligne]));
    expect(alerte?.lignes[0]?.culture).toEqual({ familleId: BRASSICACEES.id, especeId: CHOU.id });
  });
});

// ---------------------------------------------------------------------------------------------
// Famille
// ---------------------------------------------------------------------------------------------

describe('même famille seulement', () => {
  it('tomates (solanacées) sur la planche et la chapelle : ignorées pour des choux', () => {
    const tomate = occupation('tomate-2026', C3_P02, TOMATE, '2026-04-15', '2026-10-15');
    const solanacees = assolement('solanacees-C3', 'passe_saisi', surZone(C3), SOLANACEES, 2025);
    expect(alertesChoux(2027, historique([tomate], [solanacees]))).toEqual([]);
  });

  it('seules les lignes de la même famille remontent dans un historique mêlé', () => {
    const tomate = occupation('tomate-2026', C3_P02, TOMATE, '2026-04-15', '2026-10-15');
    const radis = occupation('radis-2025', C3_P02, RADIS, '2025-04-01', '2025-05-20');
    expect(resume(alertesChoux(2027, historique([tomate, radis], [])))).toEqual(['rouge 2025 écart 2']);
  });
});

// ---------------------------------------------------------------------------------------------
// Regroupement et tri
// ---------------------------------------------------------------------------------------------

describe('plusieurs lignes en cause', () => {
  it('une seule alerte, la plus grave d’abord', () => {
    const surSerre = assolement('brassicacees-serre-2022', 'passe_saisi', surZone(SERRE), BRASSICACEES, 2022);
    const radis = occupation('radis-2025', C3_P02, RADIS, '2025-04-01', '2025-05-20');
    const h = historique([radis], [surSerre, BRASSICACEES_C3_2023]);
    expect(alertesChoux(2027, h)).toEqual([
      {
        niveau: 'rouge',
        delais: { minimalAns: 4, conseilleAns: 6 },
        origineDelais: 'espece',
        lignes: [
          ligneOccupation(radis, 2025, 2, 'rouge'),
          ligneAssolement(BRASSICACEES_C3_2023, 2023, 4, 'orange'),
          ligneAssolement(surSerre, 2022, 5, 'orange'),
        ],
      },
    ]);
  });

  it('niveau de l’alerte : orange si toutes les lignes sont orange', () => {
    const surSerre = assolement('brassicacees-serre-2022', 'passe_saisi', surZone(SERRE), BRASSICACEES, 2022);
    const alertes = alertesChoux(2027, historique([], [surSerre, BRASSICACEES_C3_2023]));
    expect(alertes[0]?.niveau).toBe('orange');
    expect(resume(alertes)).toEqual(['orange 2023 écart 4', 'orange 2022 écart 5']);
  });

  it('à écart égal : occupations avant assolements, puis id croissant', () => {
    const zeta = assolement('zeta', 'passe_saisi', surZone(C3), BRASSICACEES, 2025);
    const alpha = assolement('alpha', 'passe_saisi', surEmplacement(C3_P02), BRASSICACEES, 2025);
    const radis = occupation('radis-2025', C3_P02, RADIS, '2025-04-01', '2025-05-20');
    const [alerte] = alertesChoux(2027, historique([radis], [zeta, alpha]));
    expect(alerte?.lignes.map((l) => l.source)).toEqual([
      { sorte: 'occupation', occupationId: radis.occupation.id },
      { sorte: 'assolement', assolementId: alpha.id },
      { sorte: 'assolement', assolementId: zeta.id },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Entrées invalides
// ---------------------------------------------------------------------------------------------

describe('entrées invalides', () => {
  it('année de mise en place non entière : RangeError', () => {
    const h = historique([], [BRASSICACEES_C3_2023]);
    expect(() => alertesChoux(2026.5, h)).toThrow(RangeError);
    expect(() => alertesChoux(Number.NaN, h)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Décisions de relecture
// ---------------------------------------------------------------------------------------------

describe('série comparée à elle-même : paramètre `exclure`', () => {
  const propre = occupation('choux-2027', C3_P02, CHOU, '2027-03-01', '2027-07-01');

  it('sans exclusion, la propre occupation des choux 2027 donne une alerte rouge (écart 0)', () => {
    expect(resume(alertesChoux(2027, historique([propre], [])))).toEqual(['rouge 2027 écart 0']);
  });

  it('exclue, elle ne compte pas : aucune alerte', () => {
    const exclure: ReadonlySet<Id<'Occupation'>> = new Set([propre.occupation.id]);
    expect(alertesRotation(CHOUX_PREVUS, C3_P02, 2027, historique([propre], []), HIERARCHIE, exclure)).toEqual([]);
  });

  it('l’exclusion ne touche que les occupations désignées', () => {
    const radis = occupation('radis-2025', C3_P02, RADIS, '2025-04-01', '2025-05-20');
    const exclure: ReadonlySet<Id<'Occupation'>> = new Set([propre.occupation.id]);
    const alertes = alertesRotation(CHOUX_PREVUS, C3_P02, 2027, historique([propre, radis], []), HIERARCHIE, exclure);
    expect(resume(alertes)).toEqual(['rouge 2025 écart 2']);
  });
});

describe('zones des emplacements remplacés', () => {
  const champ = zone('champ', null);
  const ilot = zone('ILOT', 'champ');
  const ancienne = planche('OLD', ilot.id);
  const p02 = planche('P02', C3.id, ['OLD']);
  const hierarchie: HierarchieParcellaire = {
    zones: [SERRE, C3, ilot, champ],
    emplacements: [ancienne, p02],
  };

  it('P02 (zone C3) remplace OLD (zone ILOT) : brassicacées sur ILOT en 2025 → alerte pour des choux en 2027', () => {
    const surIlot = assolement('brassicacees-ILOT', 'passe_saisi', surZone(ilot), BRASSICACEES, 2025);
    expect(alertesRotation(CHOUX_PREVUS, p02, 2027, historique([], [surIlot]), hierarchie)).toEqual([
      {
        niveau: 'rouge',
        delais: { minimalAns: 4, conseilleAns: 6 },
        origineDelais: 'espece',
        lignes: [ligneAssolement(surIlot, 2025, 2, 'rouge')],
      },
    ]);
  });

  it('les parentes de la zone d’un emplacement remplacé comptent aussi', () => {
    const surChamp = assolement('brassicacees-champ', 'passe_saisi', surZone(champ), BRASSICACEES, 2024);
    expect(resume(alertesRotation(CHOUX_PREVUS, p02, 2027, historique([], [surChamp]), hierarchie))).toEqual([
      'rouge 2024 écart 3',
    ]);
  });
});

describe('zone de E absente de la hiérarchie', () => {
  const e = planche('Z-P01', id<'Zone'>('zone-inconnue'));
  const hierarchie: HierarchieParcellaire = { zones: HIERARCHIE.zones, emplacements: [e] };

  it('les lignes posées sur cette zone comptent, sans remonter plus haut ni lever', () => {
    const surZoneInconnue = assolement('brassicacees-inconnue', 'passe_saisi', { sorte: 'zone', zoneId: e.zoneId }, BRASSICACEES, 2024);
    const surSerre = assolement('brassicacees-serre', 'passe_saisi', surZone(SERRE), BRASSICACEES, 2024);
    expect(resume(alertesRotation(CHOUX_PREVUS, e, 2027, historique([], [surZoneInconnue, surSerre]), hierarchie))).toEqual([
      'rouge 2024 écart 3',
    ]);
  });
});

describe('familles : `familleId` fait foi', () => {
  it('ligne d’assolement brassicacées précisée « tomate » : comptée comme brassicacée', () => {
    const ligne = assolement('incoherente-1', 'passe_saisi', surZone(C3), BRASSICACEES, 2025, { especeId: TOMATE.id });
    expect(resume(alertesChoux(2027, historique([], [ligne])))).toEqual(['rouge 2025 écart 2']);
  });

  it('ligne d’assolement solanacées précisée « chou » : ignorée pour des choux', () => {
    const ligne = assolement('incoherente-2', 'passe_saisi', surZone(C3), SOLANACEES, 2025, { especeId: CHOU.id });
    expect(alertesChoux(2027, historique([], [ligne]))).toEqual([]);
  });

  it('culture prévue dont la famille n’est pas celle de l’espèce : RangeError', () => {
    const h = historique([], [BRASSICACEES_C3_2023]);
    expect(() => alertesRotation({ espece: CHOU, famille: SOLANACEES }, C3_P02, 2027, h, HIERARCHIE)).toThrow(RangeError);
    expect(() => alertesRotation({ espece: RADIS, famille: SOLANACEES }, C3_P02, 2027, h, HIERARCHIE)).toThrow(RangeError);
  });
});

describe('occupations : compléments', () => {
  it('pérenne arrachée (réel.au rempli) : l’année vient de l’arrachage', () => {
    const perpetuel = occupation('perpetuel-arrache', C3_P02, CHOU_PERPETUEL, '2018-04-01', DATE_SANS_FIN, {
      reel: { du: d('2018-04-01'), au: d('2024-11-01') },
    });
    expect(alertesChoux(2027, historique([perpetuel], []))).toEqual([
      {
        niveau: 'rouge',
        delais: { minimalAns: 4, conseilleAns: 6 },
        origineDelais: 'espece',
        lignes: [ligneOccupation(perpetuel, 2024, 3, 'rouge')],
      },
    ]);
  });

  it('occupation prévue mais pas encore réalisée, antérieure à l’année prévue : comptée', () => {
    const prevue = occupation('radis-prevu-2026', C3_P02, RADIS, '2026-09-01', '2026-10-20');
    expect(resume(alertesChoux(2027, historique([prevue], [])))).toEqual(['rouge 2026 écart 1']);
  });
});

describe('délais incohérents', () => {
  const h = historique([], [BRASSICACEES_C3_2023]);

  it('délais de l’espèce minimal > conseillé : RangeError', () => {
    const bizarre = espece('chou-bizarre', BRASSICACEES, { minimalAns: 6, conseilleAns: 4 });
    expect(() => alertesRotation({ espece: bizarre, famille: BRASSICACEES }, C3_P02, 2027, h, HIERARCHIE)).toThrow(
      RangeError,
    );
  });

  it('délais de la famille minimal > conseillé, appliqués faute de délais d’espèce : RangeError', () => {
    const familleBizarre = famille('brassicacees', 5, 2);
    expect(() => alertesRotation({ espece: RADIS, famille: familleBizarre }, C3_P02, 2027, h, HIERARCHIE)).toThrow(
      RangeError,
    );
  });

  it('minimal = conseillé : permis, rouge en dessous, jamais d’orange', () => {
    const net = espece('chou-net', BRASSICACEES, { minimalAns: 4, conseilleAns: 4 });
    const culture: CulturePrevue = { espece: net, famille: BRASSICACEES };
    expect(resume(alertesRotation(culture, C3_P02, 2026, h, HIERARCHIE))).toEqual(['rouge 2023 écart 3']);
    expect(alertesRotation(culture, C3_P02, 2027, h, HIERARCHIE)).toEqual([]);
  });
});
