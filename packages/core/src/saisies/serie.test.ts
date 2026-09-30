/**
 * Tests d'acceptation T10e, côté cœur — règles d'une série et de ses occupations écrites par un
 * téléphone, et exports attendus par T12 (docs/backlog/T10e-series-synchro.md, règles 3, 6 et 7).
 *
 * Contrat (entrées, sorties, codes, plafonds) : ./test/contrat-serie.ts. Aucune base, aucun
 * réseau. Les tests côté serveur (Postgres) sont dans apps/api/src/sync/serie.integration.test.ts.
 *
 * Exemple chiffré : la batavia de T02 (plant maison, pépinière 28 j, avant récolte 49 j,
 * fenêtre 14 j), ancrée sur le début de récolte en semaine 22 de 2027 (lundi 2027-05-31) :
 * semis 2027-03-15, plantation 2027-04-12, récolte du 2027-05-31 au 2027-06-14.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { besoinsSerie } from '../planification/besoins.ts';
import { calculerDatesSerie } from '../planification/dates-serie.ts';
import { alertesRotation } from '../planification/rotation.ts';
import { chargerCoeurSeries, chargerSeries, type CodeErreur, type ModuleSeries, type ResultatLigne, type SerieLue } from './test/contrat-serie.ts';

let m: ModuleSeries;

beforeAll(async () => {
  m = await chargerSeries();
});

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

const SERIE = uuid(1);
const FERME = uuid(2);
const SAISON = uuid(3);
const ESPECE = uuid(4);
const ITINERAIRE = uuid(5);
const VARIETE = uuid(6);
const OCCUPATION = uuid(7);
const PLANCHE = uuid(8);
const FAMILLE = uuid(9);

/** Instantané complet de l'itinéraire batavia (T01, plant maison). */
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

/** Radis en semis direct (28 j avant récolte, 7 j de fenêtre) : pas de semis en pépinière. */
const RADIS = {
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
};

/** Plant acheté (tomate greffée) : pas de semis à la ferme. */
const TOMATE_ACHETEE = {
  mode: 'plant_achete',
  densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50 },
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 70,
  fenetreRecolteJours: 90,
  margeSecurite: 5,
  rendementAttendu: null,
  perenne: null,
};

/** Ligne `serie` telle que le téléphone l'envoie : la batavia ancrée sur la récolte S22 2027. */
const serie = (autres: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SERIE,
  ferme_id: FERME,
  saison_id: SAISON,
  espece_id: ESPECE,
  variete_id: null,
  itineraire_id: ITINERAIRE,
  parametres: JSON.stringify(BATAVIA),
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
  ...autres,
});

const occupation = (autres: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: OCCUPATION,
  ferme_id: FERME,
  emplacement_id: PLANCHE,
  serie_id: SERIE,
  plantation_id: null,
  evenement_id: null,
  longueur_m: 30,
  nombre_places: null,
  position_m: null,
  prevu_du: '2027-04-12',
  prevu_au: '2027-06-14',
  reel_du: null,
  reel_au: null,
  ...autres,
});

const ROTATION = { famille: FAMILLE, delai_ans: 4, le: '2026-10-01T05:58:00.000Z' };

function code<T>(r: ResultatLigne<T>): CodeErreur | null {
  return r.ok ? null : r.erreur.code;
}

function champ<T>(r: ResultatLigne<T>): string | null {
  return r.ok ? null : r.erreur.champ;
}

/** La série de référence, validée (pour validerOccupation). */
function serieValidee(autres: Record<string, unknown> = {}): SerieLue {
  const r = m.validerSerie(serie(autres));
  if (!r.ok) throw new Error(`série de référence refusée : ${r.erreur.message}`);
  return r.valeur;
}

const REFUS_PLAFOND: readonly CodeErreur[] = ['champ_invalide', 'hors_bornes', 'plafond_depasse'];

// ── Exports pour T12 (règle 7) ─────────────────────────────────────────────────────────────────

describe('exports du cœur attendus par T12', () => {
  it('@planif/core exporte calculerDatesSerie (T02), besoinsSerie (T05) et alertesRotation (T04), les fonctions du moteur elles-mêmes', async () => {
    const coeur = await chargerCoeurSeries();
    expect(coeur.calculerDatesSerie).toBe(calculerDatesSerie);
    expect(coeur.besoinsSerie).toBe(besoinsSerie);
    expect(coeur.alertesRotation).toBe(alertesRotation);
  });

  it('@planif/core exporte validerSerie, validerOccupation et PLAFONDS_SERIE', async () => {
    const coeur = await chargerCoeurSeries();
    expect(typeof coeur.validerSerie).toBe('function');
    expect(typeof coeur.validerOccupation).toBe('function');
    expect(coeur.PLAFONDS_SERIE).toBeDefined();
  });

  it('calculerDatesSerie, lu par @planif/core, donne les dates de la batavia de T02', () => {
    expect(m.calculerDatesSerie(BATAVIA, { type: 'debut_recolte', date: '2027-05-31' })).toStrictEqual({
      semisPepiniere: '2027-03-15',
      miseEnPlace: '2027-04-12',
      debutRecolte: '2027-05-31',
      finRecolte: '2027-06-14',
    });
  });

  it('PLAFONDS_SERIE : des plafonds contre la faute de frappe, pas contre une grande série', () => {
    const p = m.PLAFONDS_SERIE;
    expect(Number.isFinite(p.longueurM)).toBe(true);
    expect(p.longueurM).toBeGreaterThanOrEqual(1_000);
    expect(p.longueurM).toBeLessThanOrEqual(1_000_000);
    expect(Number.isSafeInteger(p.nombrePlants)).toBe(true);
    expect(p.nombrePlants).toBeGreaterThanOrEqual(100_000);
    expect(p.nombrePlants).toBeLessThanOrEqual(100_000_000);
  });
});

// ── validerSerie ─────────────────────────────────────────────────────────────────────────────

describe('validerSerie : une série juste est acceptée', () => {
  it('batavia ancrée sur la récolte S22 : acceptée, rendue en Serie de T01', () => {
    const r = m.validerSerie(serie({ id: SERIE.toUpperCase(), variete_id: VARIETE, cree_le: '2026-10-01T05:58:00.000Z', modifie_le: null }));
    expect(r.ok, r.ok ? '' : r.erreur.message).toBe(true);
    expect(r.ok && r.valeur).toMatchObject({
      id: SERIE,
      fermeId: FERME,
      saisonId: SAISON,
      especeId: ESPECE,
      varieteId: VARIETE,
      itineraireId: ITINERAIRE,
      ancre: { type: 'debut_recolte', date: '2027-05-31' },
      datesPrevues: { semisPepiniere: '2027-03-15', miseEnPlace: '2027-04-12', debutRecolte: '2027-05-31', finRecolte: '2027-06-14' },
      taille: { unite: 'longueur', longueurM: 60 },
      statut: 'prevue',
    });
  });

  it('parametres déjà en objet (et non en texte JSON) : accepté', () => {
    expect(m.validerSerie(serie({ parametres: BATAVIA })).ok).toBe(true);
  });

  it('ancre sur la plantation 2027-04-05 (ligne 1 de T02) : acceptée avec ses dates', () => {
    const r = m.validerSerie(
      serie({
        ancre_type: 'plantation',
        ancre_date: '2027-04-05',
        prevu_semis_pepiniere: '2027-03-08',
        prevu_mise_en_place: '2027-04-05',
        prevu_debut_recolte: '2027-05-24',
        prevu_fin_recolte: '2027-06-07',
      }),
    );
    expect(r.ok, r.ok ? '' : r.erreur.message).toBe(true);
  });

  it('ancre sur le semis, en semis direct : pas de semis en pépinière (null), datesPrevues sans la clé', () => {
    const r = m.validerSerie(
      serie({
        parametres: JSON.stringify(RADIS),
        ancre_type: 'semis',
        ancre_date: '2027-03-01',
        prevu_semis_pepiniere: null,
        prevu_mise_en_place: '2027-03-01',
        prevu_debut_recolte: '2027-03-29',
        prevu_fin_recolte: '2027-04-05',
      }),
    );
    expect(r.ok, r.ok ? '' : r.erreur.message).toBe(true);
    expect(r.ok && r.valeur.datesPrevues).toStrictEqual({ miseEnPlace: '2027-03-01', debutRecolte: '2027-03-29', finRecolte: '2027-04-05' });
  });

  it('en nombre de plants (et non en longueur) : accepté', () => {
    const r = m.validerSerie(serie({ longueur_m: null, nombre_plants: 600 }));
    expect(r.ok && r.valeur.taille).toStrictEqual({ unite: 'plants', nombrePlants: 600 });
  });

  it.each(['prevue', 'en_cours', 'terminee', 'abandonnee'])('statut %s : accepté', (statut) => {
    expect(m.validerSerie(serie({ statut })).ok).toBe(true);
  });

  it('supprimée en douceur (supprime_le instant ISO) : acceptée, c’est la ligne d’un PATCH de suppression', () => {
    expect(m.validerSerie(serie({ supprime_le: '2026-10-01T06:00:00.000Z' })).ok).toBe(true);
  });

  it('rotation_acceptee (alerte rouge acceptée) en texte JSON ou en objet : acceptée', () => {
    expect(m.validerSerie(serie({ rotation_acceptee: JSON.stringify(ROTATION) })).ok).toBe(true);
    expect(m.validerSerie(serie({ rotation_acceptee: ROTATION })).ok).toBe(true);
  });
});

describe('validerSerie : colonnes, identifiants, ancre et statut', () => {
  it.each([
    ['colonne inconnue', { prix: 3 }, 'colonne_inconnue', 'prix'],
    ['id glissé mal formé', { id: 'x' }, 'champ_invalide', 'id'],
    ['ferme absente', { ferme_id: null }, 'champ_manquant', 'ferme_id'],
    ['saison absente', { saison_id: null }, 'champ_manquant', 'saison_id'],
    ['espèce mal formée', { espece_id: 'tomate' }, 'champ_invalide', 'espece_id'],
    ['itinéraire absent', { itineraire_id: null }, 'champ_manquant', 'itineraire_id'],
    ['variété mal formée', { variete_id: 12 }, 'champ_invalide', 'variete_id'],
    ['ancre inconnue', { ancre_type: 'recolte' }, 'champ_invalide', 'ancre_type'],
    ['ancre absente', { ancre_type: null }, 'champ_manquant', 'ancre_type'],
    ['date d’ancre inexistante', { ancre_date: '2027-02-30' }, 'champ_invalide', 'ancre_date'],
    ['statut inconnu', { statut: 'annulee' }, 'champ_invalide', 'statut'],
    ['statut absent', { statut: null }, 'champ_manquant', 'statut'],
  ])('%s : refusé', (_cas, autres, attendu, colonne) => {
    const r = m.validerSerie(serie(autres));
    expect(code(r)).toBe(attendu);
    expect(champ(r)).toBe(colonne);
  });

  it('date d’ancre hors de [2000-01-01, 2100-12-31] : refusée', () => {
    const r = m.validerSerie(serie({ ancre_date: '1999-12-31' }));
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe('ancre_date');
  });

  it('entrée illisible : refusée sans lever', () => {
    for (const entree of [null, undefined, 42, 'serie', [], new Proxy({}, { ownKeys: () => { throw new Error('piège'); } })]) {
      expect(code(m.validerSerie(entree))).toBe('entree_invalide');
    }
  });
});

describe('validerSerie : longueur XOR nombre de plants, positif et plafonné', () => {
  it('les deux : incohérent', () => {
    expect(code(m.validerSerie(serie({ longueur_m: 30, nombre_plants: 300 })))).toBe('incoherent');
  });

  it('aucun des deux : manquant', () => {
    expect(code(m.validerSerie(serie({ longueur_m: null, nombre_plants: null })))).toBe('champ_manquant');
  });

  it.each([
    ['longueur nulle', { longueur_m: 0 }, 'longueur_m'],
    ['longueur négative', { longueur_m: -30 }, 'longueur_m'],
    ['longueur en texte', { longueur_m: '30' }, 'longueur_m'],
    ['longueur infinie', { longueur_m: Number.POSITIVE_INFINITY }, 'longueur_m'],
    ['longueur NaN', { longueur_m: Number.NaN }, 'longueur_m'],
    ['plants nuls', { longueur_m: null, nombre_plants: 0 }, 'nombre_plants'],
    ['plants non entiers', { longueur_m: null, nombre_plants: 12.5 }, 'nombre_plants'],
  ])('%s : refusé', (_cas, autres, colonne) => {
    const r = m.validerSerie(serie(autres));
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe(colonne);
  });

  it('plafonds compris, au-delà refusés', () => {
    const { longueurM, nombrePlants } = m.PLAFONDS_SERIE;
    expect(m.validerSerie(serie({ longueur_m: longueurM })).ok).toBe(true);
    expect(m.validerSerie(serie({ longueur_m: null, nombre_plants: nombrePlants })).ok).toBe(true);
    const long = m.validerSerie(serie({ longueur_m: longueurM + 1 }));
    expect(REFUS_PLAFOND).toContain(code(long));
    expect(champ(long)).toBe('longueur_m');
    const nombreux = m.validerSerie(serie({ longueur_m: null, nombre_plants: nombrePlants + 1 }));
    expect(REFUS_PLAFOND).toContain(code(nombreux));
    expect(champ(nombreux)).toBe('nombre_plants');
    expect(REFUS_PLAFOND).toContain(code(m.validerSerie(serie({ longueur_m: 1e308 }))));
  });
});

describe('validerSerie : parametres (instantané de l’itinéraire) lisibles', () => {
  const sans = (cle: string): Record<string, unknown> => Object.fromEntries(Object.entries(BATAVIA).filter(([c]) => c !== cle));

  it('texte JSON illisible : json_illisible', () => {
    const r = m.validerSerie(serie({ parametres: '{"mode":' }));
    expect(code(r)).toBe('json_illisible');
    expect(champ(r)).toBe('parametres');
  });

  it.each([
    ['tableau', '[1,2]'],
    ['nombre', 12],
    ['texte JSON d’un nombre', '12'],
  ])('%s : pas un objet, refusé', (_cas, parametres) => {
    const r = m.validerSerie(serie({ parametres }));
    expect(code(r)).toBe('champ_invalide');
    expect(champ(r)).toBe('parametres');
  });

  it('absents : manquants', () => {
    const r = m.validerSerie(serie({ parametres: null }));
    expect(code(r)).toBe('champ_manquant');
    expect(champ(r)).toBe('parametres');
  });

  it('plus de 8 192 octets de JSON : trop_volumineux', () => {
    const r = m.validerSerie(serie({ parametres: JSON.stringify({ ...BATAVIA, note: 'x'.repeat(10_000) }) }));
    expect(code(r)).toBe('trop_volumineux');
  });

  it.each([
    ['mode inconnu', { ...BATAVIA, mode: 'bouture' }, 'parametres.mode'],
    ['mode absent', sans('mode'), 'parametres.mode'],
    ['durée avant récolte absente', sans('dureeAvantRecolteJours'), 'parametres.dureeAvantRecolteJours'],
    ['durée avant récolte négative', { ...BATAVIA, dureeAvantRecolteJours: -1 }, 'parametres.dureeAvantRecolteJours'],
    ['durée avant récolte non entière', { ...BATAVIA, dureeAvantRecolteJours: 49.5 }, 'parametres.dureeAvantRecolteJours'],
    ['durée avant récolte en texte', { ...BATAVIA, dureeAvantRecolteJours: '49' }, 'parametres.dureeAvantRecolteJours'],
    ['fenêtre de récolte absente', sans('fenetreRecolteJours'), 'parametres.fenetreRecolteJours'],
    ['pépinière absente en plant maison', sans('dureePepiniereJours'), 'parametres.dureePepiniereJours'],
  ])('%s : refusé, champ %s', (_cas, parametres, attendu) => {
    const r = m.validerSerie(serie({ parametres: JSON.stringify(parametres) }));
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe(attendu);
  });

  it('durées démesurées (dates au-delà de 2100) : refusé sans lever', () => {
    const r = m.validerSerie(serie({ parametres: JSON.stringify({ ...BATAVIA, fenetreRecolteJours: 1_000_000_000 }) }));
    expect(r.ok).toBe(false);
  });
});

describe('validerSerie : les dates prévues sont celles du cœur (T02), jamais crues sur parole', () => {
  it.each([
    ['semis en pépinière décalé d’un jour', { prevu_semis_pepiniere: '2027-03-16' }, 'prevu_semis_pepiniere'],
    ['semis en pépinière absent en plant maison', { prevu_semis_pepiniere: null }, 'prevu_semis_pepiniere'],
    ['mise en place fausse', { prevu_mise_en_place: '2027-04-13' }, 'prevu_mise_en_place'],
    ['début de récolte faux', { prevu_debut_recolte: '2027-06-01' }, 'prevu_debut_recolte'],
    ['fin de récolte fausse', { prevu_fin_recolte: '2027-06-21' }, 'prevu_fin_recolte'],
  ])('%s : incohérent, champ %s', (_cas, autres, colonne) => {
    const r = m.validerSerie(serie(autres));
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe(colonne);
  });

  it('ancre déplacée d’une semaine sans recalculer les dates : refusé', () => {
    const r = m.validerSerie(serie({ ancre_date: '2027-06-07' }));
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('prevu_semis_pepiniere');
  });

  it('ancre déplacée d’une semaine avec les dates recalculées : acceptée', () => {
    const r = m.validerSerie(
      serie({
        ancre_date: '2027-06-07',
        prevu_semis_pepiniere: '2027-03-22',
        prevu_mise_en_place: '2027-04-19',
        prevu_debut_recolte: '2027-06-07',
        prevu_fin_recolte: '2027-06-21',
      }),
    );
    expect(r.ok, r.ok ? '' : r.erreur.message).toBe(true);
  });

  it('semis direct avec un semis en pépinière : incohérent', () => {
    const r = m.validerSerie(
      serie({
        parametres: JSON.stringify(RADIS),
        ancre_type: 'semis',
        ancre_date: '2027-03-01',
        prevu_semis_pepiniere: '2027-03-01',
        prevu_mise_en_place: '2027-03-01',
        prevu_debut_recolte: '2027-03-29',
        prevu_fin_recolte: '2027-04-05',
      }),
    );
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('prevu_semis_pepiniere');
  });

  it('paramètres changés (pépinière 35 j) sans recalculer : incohérent', () => {
    const r = m.validerSerie(serie({ parametres: JSON.stringify({ ...BATAVIA, dureePepiniereJours: 35 }) }));
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe('prevu_semis_pepiniere');
  });

  it('plant acheté ancré sur un semis (impossible en T02) : refusé sans lever, champ ancre_type', () => {
    const r = m.validerSerie(
      serie({
        parametres: JSON.stringify(TOMATE_ACHETEE),
        ancre_type: 'semis',
        ancre_date: '2027-03-01',
        prevu_semis_pepiniere: null,
        prevu_mise_en_place: '2027-03-01',
        prevu_debut_recolte: '2027-05-10',
        prevu_fin_recolte: '2027-08-08',
      }),
    );
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe('ancre_type');
  });

  it('dates prévues mal écrites : refusé', () => {
    expect(m.validerSerie(serie({ prevu_mise_en_place: '12/04/2027' })).ok).toBe(false);
    expect(m.validerSerie(serie({ prevu_fin_recolte: null })).ok).toBe(false);
  });
});

describe('validerSerie : rotation_acceptee (décision sur une alerte rouge)', () => {
  it.each([
    ['texte illisible', '{"famille":', 'json_illisible'],
    ['clé inconnue', { ...ROTATION, motif: 'pas le choix' }, 'cle_inconnue'],
  ])('%s : %s', (_cas, rotation, attendu) => {
    const r = m.validerSerie(serie({ rotation_acceptee: rotation }));
    expect(code(r)).toBe(attendu);
    expect(champ(r)?.startsWith('rotation_acceptee')).toBe(true);
  });

  it.each([
    ['pas un objet', [1]],
    ['famille absente', { delai_ans: 4, le: ROTATION.le }],
    ['famille mal formée', { ...ROTATION, famille: 'choux' }],
    ['délai négatif', { ...ROTATION, delai_ans: -1 }],
    ['délai non entier', { ...ROTATION, delai_ans: 2.5 }],
    ['délai en texte', { ...ROTATION, delai_ans: '4' }],
    ['délai au-delà de 100 ans', { ...ROTATION, delai_ans: 101 }],
    ['délai absent', { famille: FAMILLE, le: ROTATION.le }],
    ['instant illisible', { ...ROTATION, le: 'hier' }],
    ['instant inexistant', { ...ROTATION, le: '2027-02-30T08:00:00.000Z' }],
    ['instant absent', { famille: FAMILLE, delai_ans: 4 }],
  ])('%s : refusé', (_cas, rotation) => {
    const r = m.validerSerie(serie({ rotation_acceptee: rotation }));
    expect(r.ok).toBe(false);
    expect(champ(r)?.startsWith('rotation_acceptee')).toBe(true);
  });

  it('délai 0 et 100 compris', () => {
    expect(m.validerSerie(serie({ rotation_acceptee: { ...ROTATION, delai_ans: 0 } })).ok).toBe(true);
    expect(m.validerSerie(serie({ rotation_acceptee: { ...ROTATION, delai_ans: 100 } })).ok).toBe(true);
  });
});

// ── validerOccupation ────────────────────────────────────────────────────────────────────────

describe('validerOccupation : une occupation de la série, cohérente avec elle', () => {
  it('planche de 30 m, de la plantation à la fin de récolte : acceptée, rendue en Occupation de T01', () => {
    const r = m.validerOccupation(occupation({ id: OCCUPATION.toUpperCase(), cree_le: '2026-10-01T05:58:00.000Z' }), serieValidee());
    expect(r.ok, r.ok ? '' : r.erreur.message).toBe(true);
    expect(r.ok && r.valeur).toMatchObject({
      id: OCCUPATION,
      fermeId: FERME,
      emplacementId: PLANCHE,
      occupant: { sorte: 'serie', serieId: SERIE },
      place: { unite: 'longueur', longueurM: 30 },
      positionM: null,
      prevuDu: '2027-04-12',
      prevuAu: '2027-06-14',
      reel: null,
    });
  });

  it('en places (gouttière), avec position nulle ; tronçon avec position : acceptées', () => {
    expect(m.validerOccupation(occupation({ longueur_m: null, nombre_places: 40 }), serieValidee()).ok).toBe(true);
    expect(m.validerOccupation(occupation({ longueur_m: 15, position_m: 15 }), serieValidee()).ok).toBe(true);
  });

  it('supprimée en douceur : acceptée', () => {
    expect(m.validerOccupation(occupation({ supprime_le: '2026-10-01T06:00:00.000Z' }), serieValidee()).ok).toBe(true);
  });

  it('dates de la série décalée d’une semaine : l’occupation suit', () => {
    const decalee = serieValidee({
      ancre_date: '2027-06-07',
      prevu_semis_pepiniere: '2027-03-22',
      prevu_mise_en_place: '2027-04-19',
      prevu_debut_recolte: '2027-06-07',
      prevu_fin_recolte: '2027-06-21',
    });
    expect(m.validerOccupation(occupation({ prevu_du: '2027-04-19', prevu_au: '2027-06-21' }), decalee).ok).toBe(true);
    const restee = m.validerOccupation(occupation(), decalee);
    expect(code(restee)).toBe('incoherent');
    expect(champ(restee)).toBe('prevu_du');
  });

  it.each([
    ['début avant la plantation (la pépinière n’occupe pas la planche)', { prevu_du: '2027-03-15' }, 'prevu_du'],
    ['fin avant la fin de récolte', { prevu_au: '2027-06-13' }, 'prevu_au'],
    ['fin après la fin de récolte', { prevu_au: '2027-06-15' }, 'prevu_au'],
  ])('%s : incohérent', (_cas, autres, colonne) => {
    const r = m.validerOccupation(occupation(autres), serieValidee());
    expect(code(r)).toBe('incoherent');
    expect(champ(r)).toBe(colonne);
  });

  it('une autre série, ou une autre ferme, que celle passée : incohérent', () => {
    expect(code(m.validerOccupation(occupation({ serie_id: uuid(99) }), serieValidee()))).toBe('incoherent');
    expect(code(m.validerOccupation(occupation({ ferme_id: uuid(98) }), serieValidee()))).toBe('incoherent');
  });

  it.each([
    ['plantation pérenne', { plantation_id: uuid(50) }, 'plantation_id'],
    ['couverture (événement)', { evenement_id: uuid(51) }, 'evenement_id'],
  ])('%s sur une occupation de série : refusé', (_cas, autres, colonne) => {
    const r = m.validerOccupation(occupation(autres), serieValidee());
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe(colonne);
  });

  it.each([
    ['colonne inconnue', { couleur: 'vert' }, 'colonne_inconnue', 'couleur'],
    ['emplacement absent', { emplacement_id: null }, 'champ_manquant', 'emplacement_id'],
    ['emplacement mal formé', { emplacement_id: 'T2-P03' }, 'champ_invalide', 'emplacement_id'],
    ['longueur et places', { nombre_places: 40 }, 'incoherent', null],
    ['ni longueur ni places', { longueur_m: null }, 'champ_manquant', null],
  ])('%s : refusé', (_cas, autres, attendu, colonne) => {
    const r = m.validerOccupation(occupation(autres), serieValidee());
    expect(code(r)).toBe(attendu);
    if (colonne !== null) expect(champ(r)).toBe(colonne);
  });

  it.each([
    ['longueur nulle', { longueur_m: 0 }, 'longueur_m'],
    ['longueur négative', { longueur_m: -1 }, 'longueur_m'],
    ['longueur en texte', { longueur_m: '30' }, 'longueur_m'],
    ['places non entières', { longueur_m: null, nombre_places: 2.5 }, 'nombre_places'],
    ['position négative', { position_m: -1 }, 'position_m'],
    ['position infinie', { position_m: Number.POSITIVE_INFINITY }, 'position_m'],
  ])('%s : refusé', (_cas, autres, colonne) => {
    const r = m.validerOccupation(occupation(autres), serieValidee());
    expect(r.ok).toBe(false);
    expect(champ(r)).toBe(colonne);
  });

  it('plafonds de la série appliqués à l’occupation', () => {
    const { longueurM, nombrePlants } = m.PLAFONDS_SERIE;
    expect(m.validerOccupation(occupation({ longueur_m: longueurM }), serieValidee()).ok).toBe(true);
    expect(REFUS_PLAFOND).toContain(code(m.validerOccupation(occupation({ longueur_m: longueurM + 1 }), serieValidee())));
    expect(REFUS_PLAFOND).toContain(code(m.validerOccupation(occupation({ longueur_m: null, nombre_places: nombrePlants + 1 }), serieValidee())));
  });

  it('dates réelles : fin sans début, ou avant lui, refusées', () => {
    expect(m.validerOccupation(occupation({ reel_du: '2027-04-14', reel_au: null }), serieValidee()).ok).toBe(true);
    expect(m.validerOccupation(occupation({ reel_du: null, reel_au: '2027-06-10' }), serieValidee()).ok).toBe(false);
    expect(m.validerOccupation(occupation({ reel_du: '2027-04-14', reel_au: '2027-04-13' }), serieValidee()).ok).toBe(false);
  });

  it('entrée illisible : refusée sans lever', () => {
    for (const entree of [null, 7, [], 'occupation']) {
      expect(code(m.validerOccupation(entree, serieValidee()))).toBe('entree_invalide');
    }
  });
});
