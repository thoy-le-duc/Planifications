// @vitest-environment happy-dom
/**
 * Tests d'acceptation T12 — le formulaire d'une série (création et modification), rendu pour de
 * vrai dans un DOM simulé (happy-dom), sur la ferme du plan (./test/ferme-serie.ts, aujourd'hui
 * = 2026-09-30) lue et écrite par la porte (base mémoire de @planif/sync). Contrat :
 * ./test/contrat.ts. L'appui long, le bandeau « Annuler » et le détail d'une barre sont dans
 * ./plan.test.tsx ; la mise en page réelle, les temps (300 ms, 100 ms) et le hors-ligne dans
 * apps/web/e2e/serie.e2e.ts.
 *
 * Chaque test a sa propre base (ils écrivent). La porte est posée sur une enveloppe qui compte
 * les transactions d'écriture : une saisie = une transaction. Les lignes `modification` que le
 * serveur renverrait sont simulées par base.recevoir (comme une synchro), au format de Postgres
 * (to_jsonb).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  besoinsSerie,
  calculerDatesSerie,
  semaineIso,
  type DateCalendaire,
  type ItineraireBesoins,
  type ParametresDatesSerie,
} from '@planif/core';
import { MARQUE_SERIE_AFFICHEE_ATTENDUE, type DepartSerie, type ModuleSerie, type SaisieSerieAnnulable } from './test/contrat.ts';
import {
  ATTENDU,
  EMPLACEMENT,
  ESPECE,
  FAMILLE,
  FERME,
  ITINERAIRE,
  OCCUPATION_FRAISE,
  OCCUPATION_LAITUE,
  PARAMETRES,
  SAISON,
  SERIE_LAITUE,
  VARIETE,
} from './test/ferme-serie.ts';
import {
  aBouton,
  aChamp,
  attendre,
  AUJOURDHUI,
  bouton,
  champ,
  liste,
  coche,
  creerBanc,
  desactive,
  dialogue,
  dialogueOuEchec,
  etat,
  MAINTENANT,
  MOTIF_UUID_V7,
  nomAccessible,
  occupationsDe,
  occupationsValides,
  radio,
  remplir,
  serie,
  serieValide,
  series,
  texte,
  toucher,
  toutesOccupations,
  unTour,
  verifierOrdres,
  type Banc,
  type Ligne,
} from './test/outils.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_SERIE = './index.ts';

let module: ModuleSerie;

beforeAll(async () => {
  module = (await import(/* @vite-ignore */ CHEMIN_SERIE)) as ModuleSerie;
});

let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;
let fermetures = 0;
let enregistrees: SaisieSerieAnnulable[] = [];

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fermetures = 0;
  enregistrees = [];
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
});

const ISO = MAINTENANT.toISOString();
const NOM_CREATION = 'Nouvelle série';
const NOM_MODIFICATION = 'Modifier la série';

/** Ouvre le formulaire et attend qu'il soit utilisable. */
async function ouvrir(depart: DepartSerie): Promise<HTMLElement> {
  await act(async () => {
    racine.render(
      <module.FormulaireSerie
        porte={b.porte}
        fermeId={FERME}
        depart={depart}
        surFermer={() => {
          fermetures++;
        }}
        surEnregistree={(s) => {
          enregistrees.push(s);
        }}
        aujourdhui={() => AUJOURDHUI}
        maintenant={() => MAINTENANT}
      />,
    );
    await Promise.resolve();
  });
  const nom = depart.sorte === 'creation' ? NOM_CREATION : NOM_MODIFICATION;
  await attendre(() => dialogue(nom) !== undefined, `formulaire role="dialog" nommé « ${nom} »`);
  const d = dialogueOuEchec(nom);
  if (depart.sorte === 'creation') await attendre(() => aChamp('Culture', d), 'champ « Culture »');
  else await attendre(() => d.querySelector('[data-testid="date-serie"]') !== null, 'dates de la série affichées');
  return d;
}

const formulaire = (): HTMLElement => {
  const d = dialogue(NOM_CREATION) ?? dialogue(NOM_MODIFICATION);
  if (d === undefined) throw new Error('formulaire fermé');
  return d;
};

const choix = (): HTMLElement[] => [...formulaire().querySelectorAll<HTMLElement>('[data-testid="choix-culture"]')];

/** Tape `recherche` dans « Culture » puis touche le choix (espèce, variété ou '' sans variété). */
async function choisirCulture(recherche: string, especeId: string, varieteId: string): Promise<void> {
  await remplir(champ('Culture', formulaire()), recherche);
  const trouver = () => choix().find((c) => c.dataset.espece === especeId && (c.dataset.variete ?? '') === varieteId);
  await attendre(() => trouver() !== undefined, `choix de culture ${especeId}/${varieteId} après « ${recherche} »`);
  const c = trouver();
  if (c === undefined) return;
  await toucher(c);
  await attendre(() => formulaire().querySelector('[data-testid="culture-choisie"]') !== null, 'culture choisie affichée');
}

type Dates = Partial<Record<'semisPepiniere' | 'miseEnPlace' | 'debutRecolte' | 'finRecolte', string>>;

function datesAffichees(): Dates {
  const r: Record<string, string> = {};
  for (const el of formulaire().querySelectorAll<HTMLElement>('[data-testid="date-serie"]')) r[el.dataset.etape ?? '?'] = el.dataset.date ?? '';
  return r;
}

const memesDates = (a: Dates, attendues: Dates) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(attendues).sort());

async function attendreDates(attendues: Dates, message: string): Promise<void> {
  await attendre(() => memesDates(datesAffichees(), attendues), `${message} (affichées : ${JSON.stringify(datesAffichees())})`);
}

function besoinsAffiches(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const el of formulaire().querySelectorAll<HTMLElement>('[data-testid="besoin"]')) r[el.dataset.cle ?? '?'] = Number(el.dataset.valeur);
  return r;
}

const alertes = (): HTMLElement[] => [...formulaire().querySelectorAll<HTMLElement>('[data-testid="alerte-rotation"]')];
const conflits = (): HTMLElement[] => [...formulaire().querySelectorAll<HTMLElement>('[data-testid="conflit-serie"]')];
const emplacementsChoisis = (): string[] =>
  [...formulaire().querySelectorAll<HTMLElement>('[data-testid="emplacement-serie"]')].map((e) => e.dataset.emplacement ?? '');
const boutonEnregistrer = (): HTMLElement => bouton(/^(Planifier la série|Enregistrer)$/, formulaire());
const semaine = (): HTMLInputElement => champ('Semaine', formulaire());

/** Dates de T02 au format d'affichage (étapes présentes seulement). */
function datesT02(parametres: Readonly<Record<string, unknown>>, ancre: { type: 'semis' | 'plantation' | 'debut_recolte'; date: string }): Dates {
  return { ...calculerDatesSerie(parametres as unknown as ParametresDatesSerie, { type: ancre.type, date: ancre.date as DateCalendaire }) };
}

/** Ligne au format de Postgres (to_jsonb) : jsonb en objets, instants avec « +00:00 ». */
function versJsonb(l: Ligne | undefined): Record<string, unknown> {
  if (l === undefined) throw new Error('ligne absente');
  const r: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(l)) {
    if ((c === 'parametres' || c === 'rotation_acceptee') && typeof v === 'string') r[c] = JSON.parse(v) as unknown;
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) r[c] = v.replace(/\.(\d{3})Z$/, '.$1+00:00');
    else r[c] = v;
  }
  return r;
}

let prochaineModification = 0x900;

/** Simule une ligne `modification` écrite par le serveur et redescendue par la synchro. */
function recevoirModification(m: {
  readonly table: 'Serie' | 'Occupation';
  readonly ligneId: string;
  readonly operation: 'creation' | 'modification' | 'suppression';
  readonly horodatage: string;
  readonly avant: Record<string, unknown> | null;
  readonly apres: Record<string, unknown>;
}): string {
  const id = `0192f0c1-1212-7000-8000-${(prochaineModification++).toString(16).padStart(12, '0')}`;
  b.base.recevoir(
    `INSERT INTO modification (id, ferme_id, nom_table, ligne_id, auteur_id, horodatage, operation, avant, apres, proposition_id, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    [
      id,
      FERME,
      m.table,
      m.ligneId,
      '0192f0c1-1212-7000-8000-000000000001',
      m.horodatage,
      m.operation,
      m.avant === null ? null : JSON.stringify(m.avant),
      JSON.stringify(m.apres),
      m.horodatage,
      m.horodatage,
    ],
  );
  return id;
}

/** La région « Historique » du formulaire. */
async function historique(): Promise<HTMLElement> {
  const trouver = () =>
    [...formulaire().querySelectorAll<HTMLElement>('[role="region"], section[aria-label], section[aria-labelledby]')].find((r) => nomAccessible(r) === 'Historique');
  await attendre(() => trouver() !== undefined, 'région « Historique » du formulaire de modification');
  const h = trouver();
  if (h === undefined) throw new Error('historique absent');
  return h;
}

const entrees = (h: HTMLElement): HTMLElement[] => [...h.querySelectorAll<HTMLElement>('[data-testid="modification-historique"]')];

const nouvellesSeries = (): Ligne[] => series(b).filter((s) => s.id !== SERIE_LAITUE);

/** La plantation (occupation hors série) n'est jamais touchée. */
function verifierPlantationIntacte(avant: Ligne | undefined): void {
  const apres = toutesOccupations(b).find((o) => o.id === OCCUPATION_FRAISE);
  expect(apres, 'occupation de la plantation de fraises intacte').toEqual(avant);
}

// ── Formulaire : culture, itinéraire, ancre, emplacements ────────────────────────────────────

describe('T12 : formulaire de création', () => {
  it('s’ouvre prérempli (planche, semaine), focus dedans, marque de performance ; rien d’enregistrable sans culture', async () => {
    performance.clearMarks(MARQUE_SERIE_AFFICHEE_ATTENDUE);
    const d = await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14', saisonId: SAISON.s2027 });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.dataset.testid).toBe('formulaire-serie');
    expect(emplacementsChoisis()).toEqual([EMPLACEMENT.t2p01]);
    expect(texte(d.querySelector(`[data-testid="emplacement-serie"][data-emplacement="${EMPLACEMENT.t2p01}"]`))).toContain('T2-P01');
    expect(champ('Longueur T2-P01', d).value).toBe('30');
    expect(semaine().value).toBe('2027-W14');
    expect(d.contains(document.activeElement), 'le focus est dans le formulaire').toBe(true);
    expect(desactive(boutonEnregistrer()), 'enregistrer désactivé sans culture').toBe(true);
    expect(aBouton(/calculer/i, d), 'pas de bouton « calculer »').toBe(false);
    await attendre(() => performance.getEntriesByName(MARQUE_SERIE_AFFICHEE_ATTENDUE, 'mark').length > 0, `marque ${MARQUE_SERIE_AFFICHEE_ATTENDUE}`);
    expect(module.MARQUE_SERIE_AFFICHEE).toBe(MARQUE_SERIE_AFFICHEE_ATTENDUE);
    expect(module.default).toBe(module.FormulaireSerie);
  });

  it('culture cherchée dans la bibliothèque de la ferme : sans accents ni casse, espèce seule ou avec sa variété, jamais une espèce supprimée', async () => {
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14' });
    const culture = champ('Culture', formulaire());
    const cherche = async (q: string): Promise<string[]> => {
      await remplir(culture, q);
      await unTour();
      return choix().map((c) => `${c.dataset.espece ?? ''}/${c.dataset.variete ?? ''}`).sort();
    };
    expect(await cherche('bat')).toEqual([`${ESPECE.batavia}/`, `${ESPECE.batavia}/${VARIETE.grenobloise}`].sort());
    expect(texte(choix().find((c) => c.dataset.variete === VARIETE.grenobloise))).toMatch(/Batavia.*Grenobloise/);
    expect(await cherche('CHO')).toEqual([`${ESPECE.chou}/`, `${ESPECE.chou}/${VARIETE.filderkraut}`].sort());
    expect(await cherche('gren')).toEqual([`${ESPECE.batavia}/${VARIETE.grenobloise}`]);
    expect(await cherche('mache'), 'bibliothèque commune, sans accent').toEqual([`${ESPECE.mache}/`]);
    expect(await cherche('ble'), 'Blette est supprimée').toEqual([]);
  });

  it('itinéraire proposé selon la culture et la période ; seuls ceux de l’espèce', async () => {
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14' });
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    const it = liste('Itinéraire', formulaire());
    expect(it.value, 'S14 : batavia de printemps (S08–S20)').toBe(ITINERAIRE.bataviaPrintemps);
    expect([...it.options].map((o) => o.value).filter((v) => v !== '').sort()).toEqual([ITINERAIRE.bataviaPrintemps, ITINERAIRE.bataviaEte].sort());
    expect(texte(formulaire().querySelector('[data-testid="culture-choisie"]'))).toMatch(/Batavia.*Grenobloise.*Astéracées/);

    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W26' });
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    expect(liste('Itinéraire', formulaire()).value, 'S26 : batavia d’été (S21–S35)').toBe(ITINERAIRE.bataviaEte);
  });

  it('ancre : plantation en S14 → dates de T02 (ligne 1) ; « récolte à partir de » garde les dates (S21) ; S22 → T02 (ligne 2)', async () => {
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14' });
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    expect(coche(radio('Plantation', formulaire())), 'plant maison : ancre sur la plantation').toBe(true);
    await attendreDates(ATTENDU.bataviaPlantationS14, 'dates de T02, ligne 1');
    for (const el of formulaire().querySelectorAll<HTMLElement>('[data-testid="date-serie"]')) {
      const s = semaineIso((el.dataset.date ?? '') as DateCalendaire);
      expect(texte(el), `semaine affichée pour ${String(el.dataset.etape)}`).toContain(`S${String(s.semaine).padStart(2, '0')}`);
    }

    await toucher(radio('Récolte à partir de', formulaire()));
    expect(semaine().value, 'changer d’ancre garde les dates : récolte en S21').toBe('2027-W21');
    await attendreDates(ATTENDU.bataviaPlantationS14, 'dates inchangées');

    await remplir(semaine(), '2027-W22');
    await attendreDates(ATTENDU.bataviaRecolteS22, 'dates de T02, ligne 2, sans bouton « calculer »');
  });

  it('besoins de T05 affichés et recalculés quand la longueur change', async () => {
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14' });
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    const entree: ItineraireBesoins = {
      mode: 'plant_maison',
      densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
      grainesParMotte: 1,
      plantsParMotte: 1,
      germination: 90,
      pertePepiniere: 5,
      alveolesParPlaque: 104,
      margeSecurite: 10,
      pmgMg: null,
    };
    const attendus = (cm: number): Record<string, number> => {
      const r: Record<string, unknown> = { ...besoinsSerie(entree, cm) };
      delete r.mode;
      delete r.facon;
      return r as Record<string, number>;
    };
    const memes = (a: Record<string, number>, c: Record<string, number>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(c).sort());
    await attendre(() => memes(besoinsAffiches(), attendus(3000)), `besoins sur 30 m (affichés : ${JSON.stringify(besoinsAffiches())})`);
    expect(besoinsAffiches()).toEqual({ ...ATTENDU.besoinsBatavia30m });
    await remplir(champ('Longueur T2-P01', formulaire()), '15');
    await attendre(
      () => memes(besoinsAffiches(), attendus(1500)),
      `besoins sur 15 m (affichés : ${JSON.stringify(besoinsAffiches())})`,
    );
  });

  it('conflits de T03 : ajouter T2-P02, déjà occupée aux mêmes dates, affiche la surcharge ; la retirer l’efface', async () => {
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14' });
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    await attendreDates(ATTENDU.bataviaPlantationS14, 'dates');
    expect(conflits(), 'T2-P01 est libre').toEqual([]);

    await remplir(liste('Ajouter une planche', formulaire()), EMPLACEMENT.t2p02);
    await attendre(() => emplacementsChoisis().includes(EMPLACEMENT.t2p02), 'T2-P02 ajoutée');
    expect(champ('Longueur T2-P02', formulaire()).value, 'longueur de la planche par défaut').toBe('30');
    await attendre(() => conflits().length > 0, 'conflit affiché');
    const c = conflits()[0];
    expect(c?.dataset.sorte).toBe('surcharge');
    expect(c?.dataset.emplacement).toBe(EMPLACEMENT.t2p02);
    expect(texte(c)).toContain('T2-P02');
    expect(texte(c)).toMatch(/Batavia/);
    expect(conflits().every((x) => x.dataset.emplacement === EMPLACEMENT.t2p02)).toBe(true);

    await toucher(bouton('Retirer T2-P02', formulaire()));
    await attendre(() => conflits().length === 0, 'plus de conflit une fois T2-P02 retirée');
    expect(emplacementsChoisis()).toEqual([EMPLACEMENT.t2p01]);
  });

  it('« Fermer » ne rien écrit', async () => {
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14' });
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    b.remiseAZero();
    await toucher(bouton('Fermer', formulaire()));
    expect(fermetures).toBe(1);
    expect(b.transactions()).toBe(0);
    expect(nouvellesSeries()).toEqual([]);
  });
});

// ── Enregistrer, annuler ─────────────────────────────────────────────────────────────────────

describe('T12 : créer une série', () => {
  it('batavia de T02 (récolte à partir de S22) : une transaction, série puis occupation, conformes aux règles du serveur ; annuler la supprime doucement', async () => {
    const fraise = toutesOccupations(b).find((o) => o.id === OCCUPATION_FRAISE);
    await ouvrir({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14', saisonId: SAISON.s2027 });
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    await toucher(radio('Récolte à partir de', formulaire()));
    await remplir(semaine(), '2027-W22');
    await attendreDates(ATTENDU.bataviaRecolteS22, 'dates de T02, ligne 2');
    expect(alertes(), 'aucune alerte de rotation sur T2-P01').toEqual([]);
    b.remiseAZero();
    const ordresAvant = b.base.ecritures.length;
    expect(nomAccessible(boutonEnregistrer())).toBe('Planifier la série');
    await toucher(boutonEnregistrer());
    await attendre(() => nouvellesSeries().length === 1, 'la série est écrite');
    await attendre(() => fermetures === 1, 'le formulaire se ferme après l’enregistrement');

    expect(b.transactions(), 'une saisie = une transaction').toBe(1);
    const s = nouvellesSeries()[0];
    if (s === undefined) return;
    expect(String(s.id)).toMatch(MOTIF_UUID_V7);
    const d = ATTENDU.bataviaRecolteS22;
    expect(s).toMatchObject({
      ferme_id: FERME,
      saison_id: SAISON.s2027,
      espece_id: ESPECE.batavia,
      variete_id: VARIETE.grenobloise,
      itineraire_id: ITINERAIRE.bataviaPrintemps,
      ancre_type: 'debut_recolte',
      ancre_date: '2027-05-31',
      prevu_semis_pepiniere: d.semisPepiniere,
      prevu_mise_en_place: d.miseEnPlace,
      prevu_debut_recolte: d.debutRecolte,
      prevu_fin_recolte: d.finRecolte,
      longueur_m: 30,
      nombre_plants: null,
      statut: 'prevue',
      rotation_acceptee: null,
      supprime_le: null,
      cree_le: ISO,
    });
    expect(JSON.parse(String(s.parametres)), 'instantané fidèle de l’itinéraire').toEqual(PARAMETRES.bataviaPrintemps);
    serieValide(s);

    const occ = occupationsDe(b, String(s.id));
    expect(occ).toHaveLength(1);
    const o = occ[0];
    expect(String(o?.id)).toMatch(MOTIF_UUID_V7);
    expect(o).toMatchObject({
      ferme_id: FERME,
      emplacement_id: EMPLACEMENT.t2p01,
      serie_id: s.id,
      plantation_id: null,
      evenement_id: null,
      longueur_m: 30,
      nombre_places: null,
      position_m: null,
      prevu_du: d.miseEnPlace,
      prevu_au: d.finRecolte,
      reel_du: null,
      reel_au: null,
      supprime_le: null,
    });
    occupationsValides(b, String(s.id));

    const ordres = b.base.ecritures.slice(ordresAvant);
    const iSerie = ordres.findIndex((q) => /^\s*INSERT\b[^;]*\bINTO\s+["`]?serie\b/i.test(q));
    const iOccupation = ordres.findIndex((q) => /^\s*INSERT\b[^;]*\bINTO\s+["`]?occupation\b/i.test(q));
    expect(iSerie, 'INSERT de la série').toBeGreaterThanOrEqual(0);
    expect(iOccupation, 'la série est écrite avant ses occupations').toBeGreaterThan(iSerie);
    verifierOrdres(b);

    expect(enregistrees).toHaveLength(1);
    const saisie = enregistrees[0];
    expect(saisie?.texte).toMatch(/Batavia/);
    b.remiseAZero();
    await act(async () => {
      await saisie?.annuler();
    });
    expect(b.transactions(), 'annuler = une transaction').toBe(1);
    expect(serie(b, String(s.id))?.supprime_le, 'série supprimée doucement').toBe(ISO);
    expect(occupationsDe(b, String(s.id)).map((x) => x.supprime_le), 'ses occupations aussi').toEqual([ISO]);
    serieValide(serie(b, String(s.id)) ?? {});
    verifierOrdres(b);
    verifierPlantationIntacte(fraise);
  });
});

describe('T12 : alertes de rotation (jeu de T04, chapelle C3)', () => {
  const chouSur = (emplacementId: string, semaineIsoTexte: string, saisonId: string): DepartSerie => ({
    sorte: 'creation',
    emplacementId,
    semaine: semaineIsoTexte,
    saisonId,
  });

  it('choux sur C3-P02 : rouge en 2026 (écart 3), orange en 2027 (4), rien en 2029 (6), recalculé à chaque changement', async () => {
    await ouvrir(chouSur(EMPLACEMENT.c3p02, '2026-W42', SAISON.s2026));
    await choisirCulture('chou', ESPECE.chou, VARIETE.filderkraut);
    expect(liste('Itinéraire', formulaire()).value).toBe(ITINERAIRE.chouAutomne);
    expect(coche(radio('Plantation', formulaire())), 'plant acheté : ancre sur la plantation').toBe(true);
    expect(desactive(radio('Semis', formulaire())), 'pas de semis à la ferme pour un plant acheté').toBe(true);
    await attendreDates(datesT02(PARAMETRES.chouAutomne, { type: 'plantation', date: '2026-10-12' }), 'dates du chou');

    await attendre(() => alertes().length > 0, 'alerte de rotation affichée');
    const rouge = alertes()[0];
    expect(rouge?.dataset.niveau).toBe('rouge');
    expect(rouge?.dataset.emplacement).toBe(EMPLACEMENT.c3p02);
    expect(texte(rouge)).toContain('Brassicacées');
    expect(texte(rouge)).toContain('2023');
    expect(texte(rouge)).toContain('C3');

    await remplir(semaine(), '2027-W02');
    await attendre(() => alertes()[0]?.dataset.niveau === 'orange', 'orange en 2027 (écart 4, entre 4 et 6)');
    await remplir(semaine(), '2029-W02');
    await attendre(() => alertes().length === 0, 'aucune alerte en 2029 (écart 6)');
  });

  it('choux sur C2-P01 (autre chapelle) : aucune alerte', async () => {
    await ouvrir(chouSur(EMPLACEMENT.c2p01, '2026-W42', SAISON.s2026));
    await choisirCulture('chou', ESPECE.chou, VARIETE.filderkraut);
    await attendreDates(datesT02(PARAMETRES.chouAutomne, { type: 'plantation', date: '2026-10-12' }), 'dates du chou');
    await unTour();
    expect(alertes()).toEqual([]);
  });

  it('rouge : enregistrer demande une confirmation ; « Revenir » n’écrit rien ; « Planifier quand même » garde la décision, visible dans l’historique', async () => {
    await ouvrir(chouSur(EMPLACEMENT.c3p02, '2026-W42', SAISON.s2026));
    await choisirCulture('chou', ESPECE.chou, VARIETE.filderkraut);
    await attendre(() => alertes()[0]?.dataset.niveau === 'rouge', 'alerte rouge');
    b.remiseAZero();

    await toucher(boutonEnregistrer());
    await attendre(() => dialogue('Alerte de rotation') !== undefined, 'confirmation nommée « Alerte de rotation… »');
    const confirmation = dialogueOuEchec('Alerte de rotation');
    expect(texte(confirmation)).toContain('Brassicacées');
    expect(texte(confirmation)).toContain('2023');
    expect(b.transactions(), 'rien d’écrit avant la confirmation').toBe(0);
    await toucher(bouton('Revenir', confirmation));
    await attendre(() => dialogue('Alerte de rotation') === undefined, 'confirmation fermée');
    expect(b.transactions(), '« Revenir » n’écrit rien').toBe(0);
    expect(nouvellesSeries()).toEqual([]);
    expect(fermetures, 'le formulaire reste ouvert').toBe(0);

    await toucher(boutonEnregistrer());
    await attendre(() => dialogue('Alerte de rotation') !== undefined, 'confirmation rouverte');
    await toucher(bouton('Planifier quand même', dialogueOuEchec('Alerte de rotation')));
    await attendre(() => nouvellesSeries().length === 1, 'la série est écrite après confirmation');
    expect(b.transactions()).toBe(1);
    const s = nouvellesSeries()[0];
    if (s === undefined) return;
    expect(s).toMatchObject({ espece_id: ESPECE.chou, variete_id: VARIETE.filderkraut, itineraire_id: ITINERAIRE.chouAutomne, saison_id: SAISON.s2026 });
    expect(JSON.parse(String(s.rotation_acceptee)), 'décision gardée : famille, délai minimal, instant').toEqual({
      famille: FAMILLE.brassicacees,
      delai_ans: 4,
      le: ISO,
    });
    serieValide(s);
    occupationsValides(b, String(s.id));
    verifierOrdres(b);

    // Le serveur inscrit la création dans l'historique, décision comprise (apres = la ligne).
    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);
    recevoirModification({ table: 'Serie', ligneId: String(s.id), operation: 'creation', horodatage: '2026-09-30T08:00:02.000Z', avant: null, apres: versJsonb(s) });
    await ouvrir({ sorte: 'modification', serieId: String(s.id) });
    const h = await historique();
    await attendre(() => entrees(h).length === 1, 'l’entrée de création dans l’historique');
    expect(entrees(h)[0]?.dataset.operation).toBe('creation');
    expect(texte(entrees(h)[0])).toMatch(/alerte de rotation acceptée/i);
  });

  it('orange seule : aucune confirmation, rotation_acceptee reste nul', async () => {
    await ouvrir(chouSur(EMPLACEMENT.c3p02, '2027-W02', SAISON.s2027));
    await choisirCulture('chou', ESPECE.chou, VARIETE.filderkraut);
    await attendre(() => alertes()[0]?.dataset.niveau === 'orange', 'alerte orange');
    await toucher(boutonEnregistrer());
    await attendre(() => nouvellesSeries().length === 1, 'écrite sans confirmation');
    expect(dialogue('Alerte de rotation')).toBeUndefined();
    expect(nouvellesSeries()[0]?.rotation_acceptee ?? null).toBeNull();
  });
});

// ── Modifier, annuler ────────────────────────────────────────────────────────────────────────

describe('T12 : modifier une série, puis annuler', () => {
  /** Ouvre SERIE_LAITUE, décale la plantation en S16 et réduit à 20 m, enregistre. */
  async function modifierLaitue(): Promise<void> {
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    await remplir(semaine(), '2027-W16');
    await remplir(champ('Longueur T2-P02', formulaire()), '20');
    const attendues = datesT02(PARAMETRES.bataviaPrintemps, { type: 'plantation', date: '2027-04-19' });
    await attendreDates(attendues, 'dates recalculées');
    await toucher(boutonEnregistrer());
    await attendre(() => serie(b, SERIE_LAITUE)?.ancre_date === '2027-04-19', 'la modification est écrite');
    await attendre(() => fermetures === 1, 'le formulaire se ferme');
  }

  it('formulaire prérempli depuis la série ; ses propres occupations ne comptent ni en conflit ni en rotation', async () => {
    const d = await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    expect(texte(d.querySelector('[data-testid="culture-choisie"]'))).toMatch(/Batavia.*Grenobloise/);
    expect(liste('Itinéraire', d).value).toBe(ITINERAIRE.bataviaPrintemps);
    expect(coche(radio('Plantation', d))).toBe(true);
    expect(semaine().value).toBe('2027-W14');
    expect(emplacementsChoisis()).toEqual([EMPLACEMENT.t2p02]);
    expect(champ('Longueur T2-P02', d).value).toBe('30');
    await attendreDates(ATTENDU.bataviaPlantationS14, 'dates de la série');
    expect(nomAccessible(boutonEnregistrer())).toBe('Enregistrer');
    await unTour();
    expect(conflits(), 'la série ne se chevauche pas elle-même').toEqual([]);
    expect(alertes(), 'la série ne se compte pas dans sa propre rotation').toEqual([]);
  });

  it('modifier : une transaction, UPDATE de la série puis de son occupation, conformes ; annuler (bandeau) restaure l’état initial', async () => {
    const serieInitiale = etat(serie(b, SERIE_LAITUE));
    const occupationsInitiales = occupationsDe(b, SERIE_LAITUE).map(etat);
    const fraise = toutesOccupations(b).find((o) => o.id === OCCUPATION_FRAISE);
    const nbSeries = series(b).length;
    b.remiseAZero();
    await modifierLaitue();

    expect(b.transactions(), 'une saisie = une transaction').toBe(1);
    expect(series(b), 'aucune nouvelle série').toHaveLength(nbSeries);
    const s = serie(b, SERIE_LAITUE);
    const d = datesT02(PARAMETRES.bataviaPrintemps, { type: 'plantation', date: '2027-04-19' });
    expect(s).toMatchObject({
      ancre_type: 'plantation',
      ancre_date: '2027-04-19',
      prevu_semis_pepiniere: d.semisPepiniere,
      prevu_mise_en_place: d.miseEnPlace,
      prevu_debut_recolte: d.debutRecolte,
      prevu_fin_recolte: d.finRecolte,
      longueur_m: 20,
      supprime_le: null,
      modifie_le: ISO,
    });
    expect(JSON.parse(String(s?.parametres))).toEqual(PARAMETRES.bataviaPrintemps);
    const occ = occupationsDe(b, SERIE_LAITUE);
    expect(occ.map((o) => o.id), 'la même occupation, modifiée').toEqual([OCCUPATION_LAITUE]);
    expect(occ[0]).toMatchObject({ emplacement_id: EMPLACEMENT.t2p02, longueur_m: 20, prevu_du: d.miseEnPlace, prevu_au: d.finRecolte, supprime_le: null });
    occupationsValides(b, SERIE_LAITUE);
    verifierOrdres(b);
    expect(b.base.ecritures.some((q) => /^\s*UPDATE\s+["`]?serie\b/i.test(q)), 'UPDATE de la série').toBe(true);

    expect(enregistrees).toHaveLength(1);
    b.remiseAZero();
    await act(async () => {
      await enregistrees[0]?.annuler();
    });
    expect(b.transactions(), 'annuler = une transaction').toBe(1);
    expect(etat(serie(b, SERIE_LAITUE)), 'série revenue à son état initial').toEqual(serieInitiale);
    expect(occupationsDe(b, SERIE_LAITUE).map(etat), 'occupation revenue à son état initial').toEqual(occupationsInitiales);
    occupationsValides(b, SERIE_LAITUE);
    verifierOrdres(b);
    verifierPlantationIntacte(fraise);
  });

  it('annuler depuis l’historique (lignes du serveur) : la série et son occupation reviennent à leur état d’avant la modification', async () => {
    const initiale = serie(b, SERIE_LAITUE);
    const occupationInitiale = occupationsDe(b, SERIE_LAITUE)[0];
    await modifierLaitue();
    // Ce que le serveur écrit en recevant ce lot (T10e), redescendu par la synchro.
    recevoirModification({
      table: 'Serie',
      ligneId: SERIE_LAITUE,
      operation: 'creation',
      horodatage: '2025-01-01T08:00:00.000Z',
      avant: null,
      apres: versJsonb(initiale),
    });
    const m1 = recevoirModification({
      table: 'Serie',
      ligneId: SERIE_LAITUE,
      operation: 'modification',
      horodatage: '2026-09-30T08:00:05.000Z',
      avant: versJsonb(initiale),
      apres: versJsonb(serie(b, SERIE_LAITUE)),
    });
    recevoirModification({
      table: 'Occupation',
      ligneId: OCCUPATION_LAITUE,
      operation: 'modification',
      horodatage: '2026-09-30T08:00:05.004Z',
      avant: versJsonb(occupationInitiale),
      apres: versJsonb(occupationsDe(b, SERIE_LAITUE)[0]),
    });

    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    const h = await historique();
    await attendre(() => entrees(h).length === 2, 'deux entrées : la création et la modification');
    expect(entrees(h).map((e) => e.dataset.operation), 'la plus récente d’abord').toEqual(['modification', 'creation']);
    expect(entrees(h)[0]?.dataset.modification).toBe(m1);
    expect(texte(entrees(h)[0])).toMatch(/Modification/);
    expect(texte(entrees(h)[1])).toMatch(/Création/);

    b.remiseAZero();
    const entree = entrees(h)[0];
    if (entree === undefined) return;
    await toucher(bouton(/^Annuler/, entree));
    await attendre(() => serie(b, SERIE_LAITUE)?.ancre_date === '2027-04-05', 'la série revient à son ancre d’origine');
    expect(b.transactions(), 'une transaction').toBe(1);
    expect(etat(serie(b, SERIE_LAITUE))).toEqual(etat(initiale));
    expect(occupationsDe(b, SERIE_LAITUE).map(etat)).toEqual([etat(occupationInitiale)]);
    occupationsValides(b, SERIE_LAITUE);
    verifierOrdres(b);
  });

  it('annuler une création depuis l’historique : suppression douce de la série et de ses occupations', async () => {
    const initiale = serie(b, SERIE_LAITUE);
    recevoirModification({ table: 'Serie', ligneId: SERIE_LAITUE, operation: 'creation', horodatage: '2025-01-01T08:00:00.000Z', avant: null, apres: versJsonb(initiale) });
    recevoirModification({
      table: 'Occupation',
      ligneId: OCCUPATION_LAITUE,
      operation: 'creation',
      horodatage: '2025-01-01T08:00:00.003Z',
      avant: null,
      apres: versJsonb(occupationsDe(b, SERIE_LAITUE)[0]),
    });
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    const h = await historique();
    await attendre(() => entrees(h).length === 1, 'l’entrée de création');
    b.remiseAZero();
    const entree = entrees(h)[0];
    if (entree === undefined) return;
    await toucher(bouton(/^Annuler/, entree));
    await attendre(() => serie(b, SERIE_LAITUE)?.supprime_le !== null, 'série supprimée doucement');
    expect(b.transactions()).toBe(1);
    expect(serie(b, SERIE_LAITUE)?.supprime_le).toBe(ISO);
    expect(occupationsDe(b, SERIE_LAITUE).map((o) => o.supprime_le)).toEqual([ISO]);
    serieValide(serie(b, SERIE_LAITUE) ?? {});
    verifierOrdres(b);
  });
});
