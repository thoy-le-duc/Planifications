/**
 * Tests d'acceptation T22 (1/2) — validation des travaux prévus d'un itinéraire, et leur passage
 * dans l'instantané d'une série validé par `validerSerie` (T10e).
 *
 * Contrat complet : ../planification/test/contrat-travaux.ts. Règles de Théophane (Q22,
 * 2026-09-30) : un travail prévu = un type d'intervention de la ferme, un repère et un décalage
 * en jours, une répétition facultative (tous les N jours jusqu'à un repère), outil, produit et
 * quantité facultatifs, temps estimé facultatif (minutes par 100 m ou par planche).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerTravaux, type ModuleTravaux, type ResultatLigne } from '../planification/test/contrat-travaux.ts';
import { octetsUtf8 } from './outils.ts';

let m: ModuleTravaux;

beforeAll(async () => {
  m = await chargerTravaux();
});

function code<T>(r: ResultatLigne<T>): string | null {
  return r.ok ? null : r.erreur.code;
}

function champ<T>(r: ResultatLigne<T>): string | null {
  return r.ok ? null : r.erreur.champ;
}

/** « Grelinette 10 jours avant la mise en place », rien de facultatif. */
const GRELINETTE = { categorie: 'travail_sol', type: 'grelinette', repere: 'mise_en_place', decalageJours: -10 };

/** Travail complet : compost 3 semaines avant la plantation, avec produit, outil et temps. */
const COMPOST = {
  categorie: 'amendement',
  type: 'compost',
  repere: 'mise_en_place',
  decalageJours: -21,
  repetition: null,
  outil: 'épandeur',
  produit: { nom: 'compost de déchets verts', quantite: { valeur: 3, unite: 'kg/m²' } },
  tempsEstime: { minutes: 20, par: 'cent_metres' },
};

/** Désherbage tous les 14 jours, de 14 jours après la mise en place jusqu'au début de récolte. */
const DESHERBAGE = {
  categorie: 'entretien',
  type: 'désherbage',
  repere: 'mise_en_place',
  decalageJours: 14,
  repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
  outil: 'binette',
  produit: null,
  tempsEstime: { minutes: 30, par: 'planche' },
};

const REFUS_VALEUR = ['champ_invalide', 'hors_bornes', 'plafond_depasse'];

// ── Travail valide ─────────────────────────────────────────────────────────────────────────────

describe('validerTravailPrevu : un travail valide', () => {
  it('grelinette −10 j de la mise en place : clés facultatives absentes → null', () => {
    const r = m.validerTravailPrevu(GRELINETTE);
    expect(r).toStrictEqual({
      ok: true,
      valeur: {
        categorie: 'travail_sol',
        type: 'grelinette',
        repere: 'mise_en_place',
        decalageJours: -10,
        repetition: null,
        outil: null,
        produit: null,
        tempsEstime: null,
      },
    });
  });

  it('travail complet (outil, produit et quantité, temps par 100 m) : rendu tel quel', () => {
    expect(m.validerTravailPrevu(COMPOST)).toStrictEqual({ ok: true, valeur: COMPOST });
  });

  it('répétition tous les 14 j jusqu’au début de récolte, temps par planche', () => {
    expect(m.validerTravailPrevu(DESHERBAGE)).toStrictEqual({ ok: true, valeur: DESHERBAGE });
  });

  it.each(['semis_pepiniere', 'mise_en_place', 'debut_recolte', 'fin_recolte'])('repère %s accepté', (repere) => {
    expect(m.validerTravailPrevu({ ...GRELINETTE, repere }).ok).toBe(true);
  });

  it.each(['travail_sol', 'couverture', 'entretien'])('catégorie %s acceptée', (categorie) => {
    expect(m.validerTravailPrevu({ ...GRELINETTE, categorie }).ok).toBe(true);
  });

  it.each(['fertilisation', 'amendement'])('catégorie %s acceptée avec son produit', (categorie) => {
    expect(m.validerTravailPrevu({ ...COMPOST, categorie }).ok).toBe(true);
  });

  it('décalage nul ou positif accepté (repère 0 j, 5 j après le début de récolte)', () => {
    expect(m.validerTravailPrevu({ ...GRELINETTE, decalageJours: 0 }).ok).toBe(true);
    expect(m.validerTravailPrevu({ ...GRELINETTE, repere: 'debut_recolte', decalageJours: 5 }).ok).toBe(true);
  });

  it('répétition jusqu’au même repère avec un décalage négatif ou nul : acceptée', () => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, decalageJours: -21, repetition: { tousLesJours: 7, repereFin: 'mise_en_place' } });
    expect(r.ok).toBe(true);
  });

  it('plafonds atteints exactement : acceptés (bornes comprises)', () => {
    const p = m.PLAFONDS_TRAVAUX;
    const r = m.validerTravailPrevu({
      ...DESHERBAGE,
      type: 'd'.repeat(p.texte),
      repere: 'fin_recolte',
      decalageJours: -p.decalageJours,
      repetition: { tousLesJours: p.tousLesJours, repereFin: 'fin_recolte' },
      outil: 'o'.repeat(p.texte),
      tempsEstime: { minutes: p.minutes, par: 'cent_metres' },
    });
    expect(r.ok).toBe(true);
    expect(m.validerTravailPrevu({ ...GRELINETTE, decalageJours: p.decalageJours }).ok).toBe(true);
  });
});

// ── Valeurs refusées ──────────────────────────────────────────────────────────────────────────

describe('validerTravailPrevu : valeurs refusées, sans jamais lever', () => {
  it.each([null, 'grelinette', 42, [GRELINETTE]])('entrée %j : entree_invalide', (entree) => {
    const r = m.validerTravailPrevu(entree);
    expect(code(r)).toBe('entree_invalide');
  });

  it('clé inconnue : cle_inconnue', () => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, frequence: 'souvent' });
    expect(code(r)).toBe('cle_inconnue');
    expect(champ(r)).toBe('frequence');
  });

  it.each(['categorie', 'type', 'repere', 'decalageJours'])('%s manquant : champ_manquant', (nom) => {
    const entree = Object.fromEntries(Object.entries(GRELINETTE).filter(([cle]) => cle !== nom));
    const r = m.validerTravailPrevu(entree);
    expect(code(r)).toBe('champ_manquant');
    expect(champ(r)).toBe(nom);
  });

  it.each([
    ['catégorie inconnue', { categorie: 'arrosage' }, 'categorie'],
    ['type vide', { type: '   ' }, 'type'],
    ['type pas un texte', { type: 12 }, 'type'],
    ['repère inconnu', { repere: 'floraison' }, 'repere'],
    ['repère en camelCase', { repere: 'miseEnPlace' }, 'repere'],
  ])('%s : champ_invalide', (_cas, autres, attendu) => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, ...autres });
    expect(code(r)).toBe('champ_invalide');
    expect(champ(r)).toBe(attendu);
  });

  it('type au-delà de PLAFONDS_TRAVAUX.texte caractères : refusé', () => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, type: 'g'.repeat(m.PLAFONDS_TRAVAUX.texte + 1) });
    expect(['trop_long', ...REFUS_VALEUR]).toContain(code(r));
    expect(champ(r)).toBe('type');
  });

  it.each([
    ['non entier', 1.5],
    ['texte', '-10'],
    ['NaN', Number.NaN],
    ['infini', Number.NEGATIVE_INFINITY],
    ['null', null],
  ])('décalage %s : refusé', (_cas, decalageJours) => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, decalageJours });
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe('decalageJours');
  });

  it('décalage au-delà du plafond, dans les deux sens : refusé', () => {
    const p = m.PLAFONDS_TRAVAUX.decalageJours;
    for (const decalageJours of [p + 1, -p - 1]) {
      const r = m.validerTravailPrevu({ ...GRELINETTE, decalageJours });
      expect(REFUS_VALEUR).toContain(code(r));
      expect(champ(r)).toBe('decalageJours');
    }
  });

  it.each([
    ['N = 0', 0],
    ['N négatif', -14],
    ['N non entier', 3.5],
    ['N en texte', '14'],
  ])('répétition %s : refusée', (_cas, tousLesJours) => {
    const r = m.validerTravailPrevu({ ...DESHERBAGE, repetition: { tousLesJours, repereFin: 'debut_recolte' } });
    expect(REFUS_VALEUR).toContain(code(r));
    expect(champ(r)).toBe('repetition.tousLesJours');
  });

  it('répétition au-delà du plafond de jours : refusée', () => {
    const r = m.validerTravailPrevu({
      ...DESHERBAGE,
      repetition: { tousLesJours: m.PLAFONDS_TRAVAUX.tousLesJours + 1, repereFin: 'debut_recolte' },
    });
    expect(REFUS_VALEUR).toContain(code(r));
    expect(champ(r)).toBe('repetition.tousLesJours');
  });

  it('répétition sans repère de fin, ou repère de fin inconnu : refusée', () => {
    const sansFin = m.validerTravailPrevu({ ...DESHERBAGE, repetition: { tousLesJours: 14 } });
    expect(code(sansFin)).toBe('champ_manquant');
    expect(champ(sansFin)).toBe('repetition.repereFin');
    const inconnu = m.validerTravailPrevu({ ...DESHERBAGE, repetition: { tousLesJours: 14, repereFin: 'floraison' } });
    expect(code(inconnu)).toBe('champ_invalide');
    expect(champ(inconnu)).toBe('repetition.repereFin');
  });

  it('répétition : clé inconnue refusée', () => {
    const r = m.validerTravailPrevu({ ...DESHERBAGE, repetition: { tousLesJours: 14, repereFin: 'debut_recolte', fois: 3 } });
    expect(code(r)).toBe('cle_inconnue');
  });

  it('répétition dont la fin est avant le début (fin de repère antérieur) : incoherent', () => {
    const r = m.validerTravailPrevu({ ...DESHERBAGE, repere: 'debut_recolte', repetition: { tousLesJours: 7, repereFin: 'mise_en_place' } });
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('repetition.repereFin');
  });

  it('répétition jusqu’au même repère avec un décalage positif (fin avant le début) : incoherent', () => {
    const r = m.validerTravailPrevu({ ...DESHERBAGE, decalageJours: 3, repetition: { tousLesJours: 7, repereFin: 'mise_en_place' } });
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('repetition.repereFin');
  });

  it.each([
    ['temps négatif', -20],
    ['temps nul', 0],
    ['temps non entier', 12.5],
    ['temps en texte', '20'],
  ])('%s : refusé', (_cas, minutes) => {
    const r = m.validerTravailPrevu({ ...COMPOST, tempsEstime: { minutes, par: 'cent_metres' } });
    expect(REFUS_VALEUR).toContain(code(r));
    expect(champ(r)).toBe('tempsEstime.minutes');
  });

  it('temps au-delà du plafond : refusé', () => {
    const r = m.validerTravailPrevu({ ...COMPOST, tempsEstime: { minutes: m.PLAFONDS_TRAVAUX.minutes + 1, par: 'planche' } });
    expect(REFUS_VALEUR).toContain(code(r));
    expect(champ(r)).toBe('tempsEstime.minutes');
  });

  it('temps par une unité inconnue (par m², par heure) : refusé', () => {
    for (const par of ['metre_carre', 'heure', null]) {
      const r = m.validerTravailPrevu({ ...COMPOST, tempsEstime: { minutes: 20, par } });
      expect(r.ok).toBe(false);
      expect(champ(r)).toBe('tempsEstime.par');
    }
  });

  it('outil vide : refusé', () => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, outil: '' });
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe('outil');
  });

  it('produit sans quantité, quantité nulle ou négative, unité vide : refusé', () => {
    const cas: readonly [unknown, string][] = [
      [{ nom: 'compost' }, 'produit.quantite'],
      [{ nom: 'compost', quantite: { valeur: 0, unite: 'kg/m²' } }, 'produit.quantite.valeur'],
      [{ nom: 'compost', quantite: { valeur: -3, unite: 'kg/m²' } }, 'produit.quantite.valeur'],
      [{ nom: 'compost', quantite: { valeur: 3, unite: '' } }, 'produit.quantite.unite'],
      [{ nom: '', quantite: { valeur: 3, unite: 'kg/m²' } }, 'produit.nom'],
    ];
    for (const [produit, attendu] of cas) {
      const r = m.validerTravailPrevu({ ...COMPOST, produit });
      expect(r.ok, JSON.stringify(produit)).toBe(false);
      expect(champ(r)).toBe(attendu);
    }
  });

  it('produit sur une catégorie qui n’en a pas (travail du sol) : incoherent', () => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, produit: COMPOST.produit });
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('produit');
  });

  it.each(['fertilisation', 'amendement'])('%s sans produit : champ_manquant (l’intervention écrite par « Fait » l’exige, validerSaisie)', (categorie) => {
    for (const produit of [undefined, null]) {
      const entree = produit === undefined ? { ...GRELINETTE, categorie } : { ...GRELINETTE, categorie, produit };
      const r = m.validerTravailPrevu(entree);
      expect(code(r)).toBe('champ_manquant');
      expect(champ(r)).toBe('produit');
    }
  });

  it('produit sur une fertilisation : accepté', () => {
    const r = m.validerTravailPrevu({ ...COMPOST, categorie: 'fertilisation', type: 'engrais' });
    expect(r.ok).toBe(true);
  });

  it('jamais d’exception, même sur des entrées hostiles', () => {
    const cyclique: Record<string, unknown> = { ...GRELINETTE };
    cyclique.repetition = cyclique;
    const hostiles: unknown[] = [
      undefined,
      cyclique,
      { ...GRELINETTE, repetition: [] },
      { ...GRELINETTE, produit: 'compost' },
      { ...GRELINETTE, tempsEstime: 20 },
      Object.create(null) as unknown,
    ];
    for (const entree of hostiles) {
      expect(() => m.validerTravailPrevu(entree)).not.toThrow();
      expect(m.validerTravailPrevu(entree).ok).toBe(false);
    }
  });

  it('message d’erreur en français, 200 caractères au plus', () => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, decalageJours: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreur.message.length).toBeGreaterThan(0);
      expect(r.erreur.message.length).toBeLessThanOrEqual(200);
    }
  });
});

// ── Repère et mode de l'itinéraire ─────────────────────────────────────────────────────────────

describe('validerTravailPrevu : repère absent pour le mode (refusé à l’écriture)', () => {
  it.each(['semis_direct', 'plant_achete'] as const)('semis en pépinière d’un itinéraire %s : incoherent', (mode) => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, repere: 'semis_pepiniere', decalageJours: -3 }, { mode });
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('repere');
  });

  it('répétition du semis en pépinière au semis en pépinière : acceptée en plant maison seulement', () => {
    const r = m.validerTravailPrevu(
      { ...GRELINETTE, repere: 'semis_pepiniere', decalageJours: -7, repetition: { tousLesJours: 2, repereFin: 'semis_pepiniere' } },
      { mode: 'plant_maison' },
    );
    expect(r.ok).toBe(true);
    const r2 = m.validerTravailPrevu(
      { ...GRELINETTE, repere: 'semis_pepiniere', decalageJours: -7, repetition: { tousLesJours: 2, repereFin: 'semis_pepiniere' } },
      { mode: 'semis_direct' },
    );
    expect(code(r2)).toBe('incoherent');
  });

  it('semis en pépinière d’un plant maison : accepté', () => {
    const r = m.validerTravailPrevu({ ...GRELINETTE, repere: 'semis_pepiniere', decalageJours: -3 }, { mode: 'plant_maison' });
    expect(r.ok).toBe(true);
  });

  it('sans mode donné : le repère seul est vérifié', () => {
    expect(m.validerTravailPrevu({ ...GRELINETTE, repere: 'semis_pepiniere' }).ok).toBe(true);
  });
});

describe('validerTravailPrevu : type choisi parmi les types de la ferme (pour T23)', () => {
  const TYPES = [
    { categorie: 'travail_sol', type: 'grelinette' },
    { categorie: 'entretien', type: 'désherbage' },
  ];

  it('type de la ferme : accepté', () => {
    expect(m.validerTravailPrevu(GRELINETTE, { typesIntervention: TYPES }).ok).toBe(true);
  });

  it('type absent de la liste, ou dans une autre catégorie : refusé sur « type »', () => {
    for (const autres of [{ type: 'rotobêche' }, { categorie: 'entretien' }]) {
      const r = m.validerTravailPrevu({ ...GRELINETTE, ...autres }, { typesIntervention: TYPES });
      expect(['champ_invalide', 'incoherent']).toContain(code(r));
      expect(champ(r)).toBe('type');
    }
  });
});

// ── Liste des travaux d'un itinéraire ──────────────────────────────────────────────────────────

describe('validerTravauxPrevus : la liste d’un itinéraire', () => {
  it('liste vide ou de trois travaux : acceptée, normalisée', () => {
    expect(m.validerTravauxPrevus([])).toStrictEqual({ ok: true, valeur: [] });
    const r = m.validerTravauxPrevus([GRELINETTE, COMPOST, DESHERBAGE], { mode: 'plant_maison' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valeur).toHaveLength(3);
      expect(r.valeur[0]?.repetition).toBeNull();
      expect(r.valeur[2]).toStrictEqual(DESHERBAGE);
    }
  });

  it('pas un tableau : champ_invalide', () => {
    for (const entree of [GRELINETTE, 'grelinette', null]) {
      expect(code(m.validerTravauxPrevus(entree))).toBe('champ_invalide');
    }
  });

  it('travail invalide : l’erreur désigne son indice', () => {
    const r = m.validerTravauxPrevus([GRELINETTE, COMPOST, { ...DESHERBAGE, decalageJours: 1.5 }]);
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe('2.decalageJours');
  });

  it('le mode s’applique à chaque travail', () => {
    const r = m.validerTravauxPrevus([GRELINETTE, { ...GRELINETTE, repere: 'semis_pepiniere' }], { mode: 'semis_direct' });
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('1.repere');
  });

  it('au-delà de PLAFONDS_TRAVAUX.nombre travaux : trop_nombreux', () => {
    const n = m.PLAFONDS_TRAVAUX.nombre;
    expect(m.validerTravauxPrevus(Array.from({ length: n }, () => GRELINETTE)).ok).toBe(true);
    expect(code(m.validerTravauxPrevus(Array.from({ length: n + 1 }, () => GRELINETTE)))).toBe('trop_nombreux');
  });
});

// ── Plafonds et limite de 8 Kio de l'instantané ─────────────────────────────────────────────────

/** Instantané de la batavia de T02 (T10e), plant maison. */
const BATAVIA = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

/** Ligne `serie` de T10e : la batavia ancrée sur la récolte S22 2027. */
const serie = (parametres: unknown): Record<string, unknown> => ({
  id: uuid(1),
  ferme_id: uuid(2),
  saison_id: uuid(3),
  espece_id: uuid(4),
  variete_id: null,
  itineraire_id: uuid(5),
  parametres: JSON.stringify(parametres),
  ancre_type: 'debut_recolte',
  ancre_date: '2027-05-31',
  prevu_semis_pepiniere: '2027-03-15',
  prevu_mise_en_place: '2027-04-12',
  prevu_debut_recolte: '2027-05-31',
  prevu_fin_recolte: '2027-06-14',
  longueur_m: 60,
  nombre_plants: null,
  statut: 'prevue',
  rotation_acceptee: null,
});

describe('PLAFONDS_TRAVAUX', () => {
  it('arrêtent une faute de frappe, pas une vraie ferme', () => {
    const p = m.PLAFONDS_TRAVAUX;
    for (const v of Object.values(p)) expect(Number.isInteger(v)).toBe(true);
    expect(p.nombre).toBeGreaterThanOrEqual(12);
    expect(p.texte).toBeGreaterThanOrEqual(30);
    expect(p.decalageJours).toBeGreaterThanOrEqual(180);
    expect(p.tousLesJours).toBeGreaterThanOrEqual(30);
    expect(p.minutes).toBeGreaterThanOrEqual(240);
  });

  it('le pire itinéraire valide tient dans l’instantané d’une série (PARAMETRES_SERIE_OCTETS)', () => {
    const p = m.PLAFONDS_TRAVAUX;
    // Caractère de 3 octets en UTF-8 pour une seule unité de longueur JavaScript : le pire cas.
    const long = '€'.repeat(p.texte);
    const pire = {
      categorie: 'amendement',
      type: long,
      repere: 'semis_pepiniere',
      decalageJours: -p.decalageJours,
      repetition: { tousLesJours: p.tousLesJours, repereFin: 'fin_recolte' },
      outil: long,
      produit: { nom: long, quantite: { valeur: 1.234567890123456e-300, unite: long } },
      tempsEstime: { minutes: p.minutes, par: 'cent_metres' },
    };
    const travaux = Array.from({ length: p.nombre }, () => pire);
    const liste = m.validerTravauxPrevus(travaux, { mode: 'plant_maison' });
    expect(liste.ok).toBe(true);

    const parametres = { ...BATAVIA, travauxPrevus: travaux };
    expect(octetsUtf8(JSON.stringify(parametres))).toBeLessThanOrEqual(m.PARAMETRES_SERIE_OCTETS);
    const r = m.validerSerie(serie(parametres));
    expect(r.ok ? null : r.erreur).toBeNull();
  });
});

// ── L'instantané d'une série (T10e) ─────────────────────────────────────────────────────────────

describe('validerSerie : les travaux prévus de l’instantané', () => {
  it('instantané sans travaux prévus (séries d’avant T22) : toujours accepté', () => {
    const r = m.validerSerie(serie(BATAVIA));
    expect(r.ok).toBe(true);
  });

  it('travaux prévus valides : acceptés et gardés dans valeur.parametres', () => {
    const travauxPrevus = [{ ...GRELINETTE, repetition: null, outil: null, produit: null, tempsEstime: null }, COMPOST, DESHERBAGE];
    const r = m.validerSerie(serie({ ...BATAVIA, travauxPrevus }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valeur.parametres.travauxPrevus).toStrictEqual(travauxPrevus);
  });

  it('travail invalide dans l’instantané : refusé, champ préfixé', () => {
    const r = m.validerSerie(serie({ ...BATAVIA, travauxPrevus: [GRELINETTE, { ...DESHERBAGE, repetition: { tousLesJours: 0, repereFin: 'debut_recolte' } }] }));
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe('parametres.travauxPrevus.1.repetition.tousLesJours');
  });

  it('travauxPrevus qui n’est pas un tableau : refusé', () => {
    const r = m.validerSerie(serie({ ...BATAVIA, travauxPrevus: GRELINETTE }));
    expect(code(r)).toBe('champ_invalide');
    expect(champ(r)).toBe('parametres.travauxPrevus');
  });

  it('semis en pépinière dans l’instantané d’un semis direct : refusé (le mode vient des paramètres)', () => {
    const radis = {
      mode: 'semis_direct',
      densite: { facon: 'metre_lineaire', rangsParPlanche: 6, grainesParMetre: 60 },
      grainesParPoquet: null,
      periodeUsage: null,
      typeAbri: null,
      dureeAvantRecolteJours: 28,
      fenetreRecolteJours: 7,
      margeSecurite: 10,
      rendementAttendu: null,
      perenne: null,
      travauxPrevus: [{ ...GRELINETTE, repere: 'semis_pepiniere' }],
    };
    const r = m.validerSerie({
      ...serie(radis),
      ancre_type: 'debut_recolte',
      ancre_date: '2027-05-31',
      prevu_semis_pepiniere: null,
      prevu_mise_en_place: '2027-05-03',
      prevu_debut_recolte: '2027-05-31',
      prevu_fin_recolte: '2027-06-07',
    });
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('parametres.travauxPrevus.0.repere');
  });

  it('un type masqué ou inconnu de la ferme n’invalide pas une série : pas de liste de types ici', () => {
    const r = m.validerSerie(serie({ ...BATAVIA, travauxPrevus: [{ ...GRELINETTE, type: 'vieux type masqué' }] }));
    expect(r.ok).toBe(true);
  });
});

// ── Relecture : la limite de taille s'applique à l'instantané NORMALISÉ ─────────────────────────

/**
 * Correctif de relecture (T22, problème 2) : `validerSerie` mesurait `parametres` AVANT de
 * normaliser `travauxPrevus`. La normalisation ajoute les clés facultatives absentes à `null`
 * (« repetition », « outil », « produit », « tempsEstime » : environ 60 octets par travail), si
 * bien qu'une série acceptée pouvait être rangée avec plus de PARAMETRES_SERIE_OCTETS. Propriété
 * attendue : tout `parametres` accepté, une fois normalisé (`valeur.parametres`), tient dans la
 * limite. Refus : 'trop_volumineux', champ 'parametres' (le code existant de T10e).
 */
describe('validerSerie : la limite de 8 192 octets vaut pour l’instantané normalisé (relecture)', () => {
  /** 12 travaux sans aucune clé facultative : la normalisation en ajoute 4 à chacun. */
  const minimaux = Array.from({ length: 12 }, () => GRELINETTE);
  const octets = (v: unknown): number => octetsUtf8(JSON.stringify(v));

  /** Paramètres de la batavia avec les travaux minimaux, bourrés à `taille` octets par une clé libre. */
  function bourres(taille: number): Record<string, unknown> {
    const base = { ...BATAVIA, travauxPrevus: minimaux, bourrage: '' };
    return { ...base, bourrage: 'x'.repeat(Math.max(0, taille - octets(base))) };
  }

  it('sous la limite avant normalisation, au-dessus après : refusé (trop_volumineux)', () => {
    const parametres = bourres(m.PARAMETRES_SERIE_OCTETS - 100);
    expect(octets(parametres), 'le jeu tient dans la limite tel qu’il est écrit').toBeLessThanOrEqual(m.PARAMETRES_SERIE_OCTETS);
    const normalise = { ...parametres, travauxPrevus: minimaux.map((t) => ({ repetition: null, outil: null, produit: null, tempsEstime: null, ...t })) };
    expect(octets(normalise), 'mais la normalisation le fait dépasser').toBeGreaterThan(m.PARAMETRES_SERIE_OCTETS);

    const r = m.validerSerie(serie(parametres));
    expect(r.ok ? `acceptée, instantané rangé de ${String(octets(r.valeur.parametres))} octets` : null).toBeNull();
    expect(code(r)).toBe('trop_volumineux');
    expect(champ(r)).toBe('parametres');
  });

  it('propriété : tout instantané accepté tient, normalisé, dans PARAMETRES_SERIE_OCTETS', () => {
    const trop: string[] = [];
    for (let taille = m.PARAMETRES_SERIE_OCTETS - 1_000; taille <= m.PARAMETRES_SERIE_OCTETS; taille += 20) {
      const r = m.validerSerie(serie(bourres(taille)));
      if (r.ok && octets(r.valeur.parametres) > m.PARAMETRES_SERIE_OCTETS) trop.push(`${String(taille)} → ${String(octets(r.valeur.parametres))}`);
    }
    expect(trop, 'écrit → rangé (octets)').toEqual([]);
  });
});
