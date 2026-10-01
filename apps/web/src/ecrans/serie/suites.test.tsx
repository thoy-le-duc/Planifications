// @vitest-environment happy-dom
/**
 * Tests d'acceptation T12b — suites de la relecture du formulaire de série
 * (docs/backlog/T12b-serie-suites.md ; contrat : ./test/contrat.ts, sections « T12b ») :
 *   - N8 : sélecteur de semaine maison à la place de <input type="week"> (libellés français,
 *     semaine précédente / suivante, choix rapide, nom accessible, clavier) ; tailles et 360 px
 *     dans apps/web/e2e/serie.e2e.ts ;
 *   - N1 : une ancre hors lundi est gardée tant que la semaine n'est pas touchée ;
 *   - N2 : une variété supprimée de la bibliothèque est gardée (interprétation du testeur) ;
 *   - N3 : rotation_acceptee effacé quand il ne correspond plus ;
 *   - N5 : « Annuler » (bandeau) ne passe pas par-dessus un autre téléphone (règle de T24,
 *     décision 9 : colonne par colonne, ligne laissée sinon, message « modifié entre-temps »).
 * Le message vu sur l'écran Planches est dans ./plan.test.tsx (dernier bloc).
 *
 * Même banc que ./ecran.test.tsx : ferme du plan (./test/ferme-serie.ts), base mémoire par test,
 * aujourd'hui = 2026-09-30. Les écritures « d'un autre téléphone » (ou d'un import) arrivent par
 * base.recevoir, comme la synchro.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calculerDatesSerie, type DateCalendaire, type ParametresDatesSerie } from '@planif/core';
import { type DepartSerie, type ModuleSerie, type SaisieSerieAnnulable } from './test/contrat.ts';
import {
  ATTENDU,
  EMPLACEMENT,
  ESPECE,
  FAMILLE,
  FERME,
  ITINERAIRE,
  OCCUPATION_LAITUE,
  PARAMETRES,
  SAISON,
  SERIE_LAITUE,
  VARIETE,
} from './test/ferme-serie.ts';
import {
  aChamp,
  attendre,
  AUJOURDHUI,
  bouton,
  champ,
  choisirSemaine,
  choixSemaines,
  creerBanc,
  dialogue,
  dialogueOuEchec,
  etat,
  liste,
  MAINTENANT,
  nomAccessible,
  occupationsDe,
  occupationsValides,
  remplir,
  selecteurSemaine,
  serie,
  serieValide,
  texte,
  toucher,
  unTour,
  valeurSemaine,
  verifierOrdres,
  type Banc,
  type Ligne,
} from './test/outils.ts';

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

const NOM_CREATION = 'Nouvelle série';
const NOM_MODIFICATION = 'Modifier la série';
/** Horodatage des écritures reçues d'ailleurs (autre téléphone, import). */
const AILLEURS = '2026-09-30T08:00:07.000Z';

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
const boutonEnregistrer = (): HTMLElement => bouton(/^(Planifier la série|Enregistrer)$/, formulaire());

function datesT02(parametres: Readonly<Record<string, unknown>>, ancre: { type: 'semis' | 'plantation' | 'debut_recolte'; date: string }): Dates {
  return { ...calculerDatesSerie(parametres as unknown as ParametresDatesSerie, { type: ancre.type, date: ancre.date as DateCalendaire }) };
}

/** UPDATE reçu par la synchro (autre téléphone, import). */
function recevoirUpdate(table: 'serie' | 'occupation' | 'variete', id: string, valeurs: Readonly<Record<string, string | number | null>>): void {
  const cles = Object.keys(valeurs);
  b.base.recevoir(`UPDATE ${table} SET ${cles.map((c) => `${c} = ?`).join(', ')}, modifie_le = ? WHERE id = ?`, [...cles.map((c) => valeurs[c] ?? null), AILLEURS, id]);
}

/** INSERT reçu par la synchro. */
function recevoirInsert(table: 'serie' | 'occupation', l: Ligne): void {
  const cles = Object.keys(l);
  b.base.recevoir(`INSERT INTO ${table} (${cles.join(', ')}) VALUES (${cles.map(() => '?').join(', ')})`, cles.map((c) => l[c] ?? null));
}

/** Enregistre puis attend la fermeture du formulaire. */
async function enregistrer(): Promise<void> {
  await toucher(boutonEnregistrer());
  await attendre(() => fermetures === 1, 'le formulaire se ferme après l’enregistrement');
}

// ── N8 : sélecteur de semaine maison ─────────────────────────────────────────────────────────

describe('T12b, N8 : sélecteur de semaine maison', () => {
  const nouvelle = (semaine: string): DepartSerie => ({ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine, saisonId: SAISON.s2027 });
  const libelle = (): string => texte(selecteurSemaine(formulaire()).querySelector('[data-testid="semaine-libelle"]'));

  it('plus aucun <input type="week"> ; un groupe nommé « Semaine », libellé français « S22 · 31 mai 2027 », annoncé (aria-live)', async () => {
    await ouvrir(nouvelle('2027-W22'));
    expect(document.querySelector('input[type="week"]'), 'aucun input[type=week] dans le DOM').toBeNull();
    const s = selecteurSemaine(formulaire());
    expect(s.getAttribute('role')).toBe('group');
    expect(nomAccessible(s)).toBe('Semaine');
    expect(valeurSemaine(formulaire())).toBe('2027-W22');
    const l = s.querySelector<HTMLElement>('[data-testid="semaine-libelle"]');
    expect(l, 'libellé data-testid="semaine-libelle"').not.toBeNull();
    expect(texte(l)).toBe('S22 · 31 mai 2027');
    expect(l?.getAttribute('aria-live')).toBe('polite');
  });

  it('commandes au clavier : trois vrais boutons (précédente, suivante, choix rapide), jamais hors de la tabulation', async () => {
    await ouvrir(nouvelle('2027-W22'));
    const s = selecteurSemaine(formulaire());
    const commandes = [bouton('Semaine précédente', s), bouton('Semaine suivante', s), bouton(/^Choisir la semaine/, s)];
    for (const c of commandes) {
      expect(c instanceof HTMLButtonElement, `« ${nomAccessible(c)} » est un <button>`).toBe(true);
      expect(c.getAttribute('type')).toBe('button');
      expect(c.getAttribute('tabindex'), `« ${nomAccessible(c)} » reste dans la tabulation`).not.toBe('-1');
    }
    const ouvrirChoix = bouton(/^Choisir la semaine/, s);
    expect(ouvrirChoix.getAttribute('aria-haspopup')).toBe('dialog');
    expect(ouvrirChoix.getAttribute('aria-expanded')).toBe('false');
  });

  it('semaine suivante / précédente, passage d’année compris (2026-S53 ↔ 2027-S01), libellé à jour', async () => {
    await ouvrir(nouvelle('2027-W22'));
    await toucher(bouton('Semaine suivante', selecteurSemaine(formulaire())));
    expect(valeurSemaine(formulaire())).toBe('2027-W23');
    expect(libelle()).toBe('S23 · 7 juin 2027');
    await toucher(bouton('Semaine précédente', selecteurSemaine(formulaire())));
    await toucher(bouton('Semaine précédente', selecteurSemaine(formulaire())));
    expect(valeurSemaine(formulaire())).toBe('2027-W21');

    act(() => {
      racine.unmount();
    });
    racine = createRoot(conteneur);
    await ouvrir(nouvelle('2026-W53'));
    expect(libelle()).toMatch(/^S53 · 28 déc\. 2026$/);
    await toucher(bouton('Semaine suivante', selecteurSemaine(formulaire())));
    expect(valeurSemaine(formulaire()), '2026 a 53 semaines ISO : la suivante est 2027-S01').toBe('2027-W01');
    expect(libelle()).toBe('S01 · 4 janv. 2027');
    await toucher(bouton('Semaine précédente', selecteurSemaine(formulaire())));
    expect(valeurSemaine(formulaire())).toBe('2026-W53');
  });

  it('choix rapide : une semaine par semaine ISO de l’année, la choisie en avant et focalisée, autre année, toucher choisit et ferme', async () => {
    await ouvrir(nouvelle('2027-W14'));
    const ouvrirChoix = bouton(/^Choisir la semaine/, selecteurSemaine(formulaire()));
    await toucher(ouvrirChoix);
    await attendre(() => choixSemaines() !== undefined, 'choix rapide ouvert (role="dialog" « Choisir la semaine… »)');
    expect(ouvrirChoix.getAttribute('aria-expanded')).toBe('true');
    let c = choixSemaines();
    if (c === undefined) return;
    expect(c.dataset.testid).toBe('choix-semaines');
    expect(c.dataset.annee, 'ouvert sur l’année de la semaine choisie').toBe('2027');
    const semaines = (): HTMLElement[] => [...(choixSemaines()?.querySelectorAll<HTMLElement>('[data-testid="choix-semaine"]') ?? [])];
    expect(semaines().map((x) => x.dataset.semaine)).toEqual(Array.from({ length: 52 }, (_, i) => `2027-W${String(i + 1).padStart(2, '0')}`));
    const courante = semaines().find((x) => x.dataset.semaine === '2027-W14');
    expect(courante?.getAttribute('aria-current')).toBe('true');
    expect(semaines().filter((x) => x.getAttribute('aria-current') === 'true')).toHaveLength(1);
    expect(document.activeElement, 'le focus va sur la semaine choisie').toBe(courante);
    expect(texte(courante)).toContain('S14');
    expect(texte(courante)).toContain('5 avr.');

    await toucher(bouton('Année précédente', c));
    c = choixSemaines();
    expect(c?.dataset.annee).toBe('2026');
    expect(semaines(), '2026 compte 53 semaines ISO').toHaveLength(53);
    await toucher(bouton('Année suivante', c ?? document));
    expect(choixSemaines()?.dataset.annee).toBe('2027');
    await toucher(bouton('Année précédente', choixSemaines() ?? document));

    const s40 = semaines().find((x) => x.dataset.semaine === '2026-W40');
    expect(s40, '2026-S40 proposée').toBeDefined();
    if (s40 === undefined) return;
    await toucher(s40);
    await attendre(() => choixSemaines() === undefined, 'le choix rapide se ferme');
    expect(valeurSemaine(formulaire())).toBe('2026-W40');
    expect(libelle()).toBe('S40 · 28 sept. 2026');
    const rouvrir = bouton(/^Choisir la semaine/, selecteurSemaine(formulaire()));
    expect(rouvrir.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement, 'le focus revient au bouton « Choisir la semaine »').toBe(rouvrir);
    expect(fermetures, 'le formulaire reste ouvert').toBe(0);
  });

  it('Échap ferme le choix rapide sans rien changer, et pas le formulaire', async () => {
    await ouvrir(nouvelle('2027-W14'));
    await toucher(bouton(/^Choisir la semaine/, selecteurSemaine(formulaire())));
    await attendre(() => choixSemaines() !== undefined, 'choix rapide ouvert');
    const cible = document.activeElement ?? choixSemaines();
    await act(async () => {
      cible?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await unTour();
    expect(choixSemaines(), 'choix rapide fermé').toBeUndefined();
    expect(fermetures, 'le formulaire n’est pas fermé').toBe(0);
    expect(dialogue(NOM_CREATION)).toBeDefined();
    expect(valeurSemaine(formulaire())).toBe('2027-W14');
  });

  it('changer de semaine recalcule les dates (batavia de T02 : récolte à partir de S22 par le choix rapide)', async () => {
    await ouvrir(nouvelle('2027-W14'));
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    await attendreDates(ATTENDU.bataviaPlantationS14, 'dates de T02, ligne 1');
    await choisirSemaine(formulaire(), '2027-W16');
    await attendreDates(datesT02(PARAMETRES.bataviaPrintemps, { type: 'plantation', date: '2027-04-19' }), 'plantation en S16');
  });
});

// ── N1 : ancre hors lundi ────────────────────────────────────────────────────────────────────

describe('T12b, N1 : une ancre qui n’est pas un lundi est gardée tant que la semaine n’est pas touchée', () => {
  /** Mercredi de la semaine 14 de 2027 : SERIE_LAITUE telle qu'un import l'aurait écrite. */
  const MERCREDI = '2027-04-07';
  const datesMercredi = datesT02(PARAMETRES.bataviaPrintemps, { type: 'plantation', date: MERCREDI });

  function importerAncreMercredi(): void {
    recevoirUpdate('serie', SERIE_LAITUE, {
      ancre_date: MERCREDI,
      prevu_semis_pepiniere: datesMercredi.semisPepiniere ?? null,
      prevu_mise_en_place: datesMercredi.miseEnPlace ?? null,
      prevu_debut_recolte: datesMercredi.debutRecolte ?? null,
      prevu_fin_recolte: datesMercredi.finRecolte ?? null,
    });
    recevoirUpdate('occupation', OCCUPATION_LAITUE, { prevu_du: datesMercredi.miseEnPlace ?? null, prevu_au: datesMercredi.finRecolte ?? null });
    occupationsValides(b, SERIE_LAITUE);
  }

  it('seule la longueur change : ancre_date et dates prévues restent celles du mercredi', async () => {
    importerAncreMercredi();
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    await attendreDates(datesMercredi, 'dates affichées : celles de l’ancre d’origine (mercredi), pas du lundi');
    expect(valeurSemaine(formulaire())).toBe('2027-W14');
    await remplir(champ('Longueur T2-P02', formulaire()), '20');
    b.remiseAZero();
    await enregistrer();
    const s = serie(b, SERIE_LAITUE);
    expect(s).toMatchObject({
      ancre_type: 'plantation',
      ancre_date: MERCREDI,
      prevu_semis_pepiniere: datesMercredi.semisPepiniere,
      prevu_mise_en_place: datesMercredi.miseEnPlace,
      prevu_debut_recolte: datesMercredi.debutRecolte,
      prevu_fin_recolte: datesMercredi.finRecolte,
      longueur_m: 20,
    });
    expect(occupationsDe(b, SERIE_LAITUE)[0]).toMatchObject({ longueur_m: 20, prevu_du: datesMercredi.miseEnPlace, prevu_au: datesMercredi.finRecolte });
    expect(b.base.ecritures.slice(b.ecrituresAvant()).some((q) => /^\s*UPDATE\s+serie\b[^;]*\b(ancre_date|prevu_mise_en_place)\s*=/i.test(q)), 'ni ancre_date ni prevu_* écrits').toBe(false);
    occupationsValides(b, SERIE_LAITUE);
    verifierOrdres(b);
  });

  it('semaine touchée : l’ancre passe au lundi de la semaine choisie (décision 4 de T12)', async () => {
    importerAncreMercredi();
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    await choisirSemaine(formulaire(), '2027-W15');
    await attendreDates(datesT02(PARAMETRES.bataviaPrintemps, { type: 'plantation', date: '2027-04-12' }), 'dates du lundi de S15');
    await enregistrer();
    expect(serie(b, SERIE_LAITUE)?.ancre_date).toBe('2027-04-12');
    occupationsValides(b, SERIE_LAITUE);
  });
});

// ── N2 : variété supprimée ───────────────────────────────────────────────────────────────────

describe('T12b, N2 : une série dont la variété a été supprimée la garde (interprétation à trancher)', () => {
  it('le formulaire montre « Grenobloise », compte sa germination (90 %) ; « Enregistrer » garde variete_id sans l’écrire', async () => {
    recevoirUpdate('variete', VARIETE.grenobloise, { supprime_le: AILLEURS });
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    expect(texte(formulaire().querySelector('[data-testid="culture-choisie"]')), 'la variété de la série reste affichée').toMatch(/Batavia.*Grenobloise/);
    await attendre(
      () => JSON.stringify(besoinsAffiches()) === JSON.stringify({ ...ATTENDU.besoinsBatavia30m }),
      `besoins de T05 avec la germination de la variété, 90 % (affichés : ${JSON.stringify(besoinsAffiches())})`,
    );
    await remplir(champ('Longueur T2-P02', formulaire()), '20');
    const avant = b.base.ecritures.length;
    await enregistrer();
    const s = serie(b, SERIE_LAITUE);
    expect(s?.longueur_m).toBe(20);
    expect(s?.variete_id, 'variété gardée, jamais remplacée par null').toBe(VARIETE.grenobloise);
    expect(b.base.ecritures.slice(avant).some((q) => /^\s*UPDATE\s+serie\b[^;]*\bvariete_id\s*=/i.test(q)), 'variete_id n’est pas réécrit').toBe(false);
    serieValide(s ?? {});
    verifierOrdres(b);
  });

  it('la variété supprimée n’est toujours pas proposée à la recherche de culture', async () => {
    recevoirUpdate('variete', VARIETE.grenobloise, { supprime_le: AILLEURS });
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    await toucher(bouton('Changer', formulaire()));
    await remplir(champ('Culture', formulaire()), 'bat');
    await attendre(() => choix().length > 0, 'Batavia proposée');
    expect(choix().map((c) => c.dataset.variete ?? '')).toEqual(['']);
  });
});

// ── N3 : décision de rotation périmée ────────────────────────────────────────────────────────

describe('T12b, N3 : rotation_acceptee effacé quand il ne correspond plus', () => {
  const SERIE_CHOU = '0192f0c1-1212-7000-8000-000000000a01';
  const OCCUPATION_CHOU = '0192f0c1-1212-7000-8000-000000000a02';
  const DECISION = JSON.stringify({ famille: FAMILLE.brassicacees, delai_ans: 4, le: '2026-09-29T08:00:00.000Z' });

  /** Choux plantés le 2026-10-12 sur C3-P02 (alerte rouge, Brassicacées en 2023), décision gardée. */
  function recevoirChouAccepte(): void {
    const d = datesT02(PARAMETRES.chouAutomne, { type: 'plantation', date: '2026-10-12' });
    const horo = { cree_le: AILLEURS, modifie_le: AILLEURS, supprime_le: null };
    recevoirInsert('serie', {
      id: SERIE_CHOU,
      ferme_id: FERME,
      saison_id: SAISON.s2026,
      espece_id: ESPECE.chou,
      variete_id: VARIETE.filderkraut,
      itineraire_id: ITINERAIRE.chouAutomne,
      parametres: JSON.stringify(PARAMETRES.chouAutomne),
      ancre_type: 'plantation',
      ancre_date: '2026-10-12',
      prevu_semis_pepiniere: d.semisPepiniere ?? null,
      prevu_mise_en_place: d.miseEnPlace ?? null,
      prevu_debut_recolte: d.debutRecolte ?? null,
      prevu_fin_recolte: d.finRecolte ?? null,
      longueur_m: 30,
      nombre_plants: null,
      statut: 'prevue',
      rotation_acceptee: DECISION,
      ...horo,
    });
    recevoirInsert('occupation', {
      id: OCCUPATION_CHOU,
      ferme_id: FERME,
      emplacement_id: EMPLACEMENT.c3p02,
      serie_id: SERIE_CHOU,
      plantation_id: null,
      evenement_id: null,
      longueur_m: 30,
      nombre_places: null,
      position_m: null,
      prevu_du: d.miseEnPlace ?? null,
      prevu_au: d.finRecolte ?? null,
      reel_du: null,
      reel_au: null,
      ...horo,
    });
    occupationsValides(b, SERIE_CHOU);
  }

  async function ouvrirChou(): Promise<void> {
    recevoirChouAccepte();
    await ouvrir({ sorte: 'modification', serieId: SERIE_CHOU });
    await attendre(() => alertes()[0]?.dataset.niveau === 'rouge', 'alerte rouge sur C3-P02');
  }

  it('culture changée (batavia) : la décision prise pour les choux est effacée', async () => {
    await ouvrirChou();
    await toucher(bouton('Changer', formulaire()));
    await choisirCulture('bat', ESPECE.batavia, VARIETE.grenobloise);
    await attendre(() => datesAffichees().miseEnPlace !== undefined, 'dates de la batavia');
    await enregistrer();
    const s = serie(b, SERIE_CHOU);
    expect(s?.espece_id).toBe(ESPECE.batavia);
    expect(s?.rotation_acceptee ?? null, 'rotation_acceptee effacé').toBeNull();
    serieValide(s ?? {});
  });

  it.each([
    ['planche changée pour C2-P01 (autre chapelle) : plus aucune alerte', 'planche'],
    ['plantation en 2027-S02 : alerte orange seulement', 'semaine'],
  ])('%s → la décision est effacée', async (_cas, sorte) => {
    await ouvrirChou();
    if (sorte === 'planche') {
      await remplir(liste('Ajouter une planche', formulaire()), EMPLACEMENT.c2p01);
      await toucher(bouton('Retirer C3-P02', formulaire()));
      await attendre(() => alertes().length === 0, 'plus d’alerte sur C2-P01');
    } else {
      await choisirSemaine(formulaire(), '2027-W02');
      await attendre(() => alertes().length > 0 && alertes().every((a) => a.dataset.niveau === 'orange'), 'alerte orange seule en 2027');
    }
    await enregistrer();
    expect(dialogue('Alerte de rotation'), 'aucune confirmation demandée').toBeUndefined();
    const s = serie(b, SERIE_CHOU);
    expect(s?.rotation_acceptee ?? null, 'rotation_acceptee effacé').toBeNull();
    serieValide(s ?? {});
    occupationsValides(b, SERIE_CHOU);
  });

  it('contrôle : l’alerte rouge de la même famille est toujours là (longueur seule changée) → décision gardée, sans nouvelle question', async () => {
    await ouvrirChou();
    await remplir(champ('Longueur C3-P02', formulaire()), '20');
    await enregistrer();
    expect(dialogue('Alerte de rotation')).toBeUndefined();
    const s = serie(b, SERIE_CHOU);
    expect(s?.longueur_m).toBe(20);
    expect(JSON.parse(String(s?.rotation_acceptee))).toEqual(JSON.parse(DECISION));
  });
});

// ── N5 : « Annuler » face à un autre téléphone ───────────────────────────────────────────────

describe('T12b, N5 : « Annuler » (bandeau) ne défait que ce que nous avons écrit, pas par-dessus un autre téléphone', () => {
  /** Ouvre SERIE_LAITUE, plantation en S16 et 20 m, enregistre ; rend la saisie annulable. */
  async function modifierLaitue(): Promise<SaisieSerieAnnulable> {
    await ouvrir({ sorte: 'modification', serieId: SERIE_LAITUE });
    await choisirSemaine(formulaire(), '2027-W16');
    await remplir(champ('Longueur T2-P02', formulaire()), '20');
    await attendreDates(datesT02(PARAMETRES.bataviaPrintemps, { type: 'plantation', date: '2027-04-19' }), 'dates recalculées');
    await enregistrer();
    await attendre(() => serie(b, SERIE_LAITUE)?.ancre_date === '2027-04-19', 'modification écrite');
    const saisie = enregistrees[0];
    expect(saisie, 'saisie annulable rendue à l’écran Planches').toBeDefined();
    if (saisie === undefined) throw new Error('aucune saisie annulable');
    return saisie;
  }

  async function annuler(saisie: SaisieSerieAnnulable): Promise<string | null> {
    b.remiseAZero();
    let message: string | null = null;
    await act(async () => {
      message = await saisie.annuler();
    });
    verifierOrdres(b);
    return message;
  }

  it('série supprimée ailleurs : pas ressuscitée, ni elle ni son occupation ne bougent ; message « modifié entre-temps »', async () => {
    const saisie = await modifierLaitue();
    recevoirUpdate('serie', SERIE_LAITUE, { supprime_le: AILLEURS });
    const recue = serie(b, SERIE_LAITUE);
    const occRecues = occupationsDe(b, SERIE_LAITUE);
    const message = await annuler(saisie);
    expect(message ?? '', 'annuler() rend le message').toContain('modifié entre-temps');
    expect(serie(b, SERIE_LAITUE)).toEqual(recue);
    expect(occupationsDe(b, SERIE_LAITUE), 'les occupations d’une série laissée restent aussi').toEqual(occRecues);
  });

  it('une colonne que nous avions écrite (longueur) changée ailleurs : la série et son occupation restent telles quelles ; message', async () => {
    const saisie = await modifierLaitue();
    recevoirUpdate('serie', SERIE_LAITUE, { longueur_m: 25 });
    recevoirUpdate('occupation', OCCUPATION_LAITUE, { longueur_m: 25 });
    const recue = serie(b, SERIE_LAITUE);
    const occRecues = occupationsDe(b, SERIE_LAITUE);
    const message = await annuler(saisie);
    expect(message ?? '').toContain('modifié entre-temps');
    expect(serie(b, SERIE_LAITUE), 'la série garde ce que l’autre téléphone a écrit').toEqual(recue);
    expect(occupationsDe(b, SERIE_LAITUE)).toEqual(occRecues);
    occupationsValides(b, SERIE_LAITUE);
  });

  it('colonne par colonne : statut changé ailleurs reste ; nos colonnes (ancre, dates, longueur) reviennent ; pas de message', async () => {
    const initiale = serie(b, SERIE_LAITUE);
    const occInitiales = occupationsDe(b, SERIE_LAITUE).map(etat);
    const saisie = await modifierLaitue();
    recevoirUpdate('serie', SERIE_LAITUE, { statut: 'en_cours' });
    const message = await annuler(saisie);
    expect(message, 'tout ce que nous avions écrit est défait : null').toBeNull();
    expect(b.transactions(), 'une transaction').toBe(1);
    expect(etat(serie(b, SERIE_LAITUE)), 'nos colonnes reviennent, celles de l’autre téléphone restent').toEqual({ ...etat(initiale), statut: 'en_cours' });
    expect(occupationsDe(b, SERIE_LAITUE).map(etat)).toEqual(occInitiales);
    occupationsValides(b, SERIE_LAITUE);
  });

  it('notre occupation changée ailleurs : elle reste telle quelle, message, et la série reste cohérente avec elle', async () => {
    const saisie = await modifierLaitue();
    recevoirUpdate('occupation', OCCUPATION_LAITUE, { longueur_m: 15 });
    const message = await annuler(saisie);
    expect(message ?? '').toContain('modifié entre-temps');
    expect(occupationsDe(b, SERIE_LAITUE)[0]?.longueur_m, 'la longueur venue d’ailleurs reste').toBe(15);
    occupationsValides(b, SERIE_LAITUE);
  });

  it('planche ajoutée ailleurs aux nouvelles dates : la série n’est pas ramenée (la planche ne collerait plus) ; tout reste valide ; message', async () => {
    const saisie = await modifierLaitue();
    const nouvelle = serie(b, SERIE_LAITUE);
    const modele = occupationsDe(b, SERIE_LAITUE)[0];
    if (nouvelle === undefined || modele === undefined) throw new Error('série absente');
    recevoirInsert('occupation', {
      ...modele,
      id: '0192f0c1-1212-7000-8000-000000000a11',
      emplacement_id: EMPLACEMENT.t2p01,
      longueur_m: 30,
      cree_le: AILLEURS,
      modifie_le: AILLEURS,
    });
    occupationsValides(b, SERIE_LAITUE);
    const occRecues = occupationsDe(b, SERIE_LAITUE);
    expect(occRecues).toHaveLength(2);
    const message = await annuler(saisie);
    expect(message ?? '').toContain('modifié entre-temps');
    expect(serie(b, SERIE_LAITUE), 'la série garde ses nouvelles dates').toEqual(nouvelle);
    expect(occupationsDe(b, SERIE_LAITUE), 'ses occupations restent telles quelles').toEqual(occRecues);
    occupationsValides(b, SERIE_LAITUE);
  });

  it('contrôle : rien n’a bougé ailleurs, tout est défait en une transaction, sans message', async () => {
    const initiale = etat(serie(b, SERIE_LAITUE));
    const occInitiales = occupationsDe(b, SERIE_LAITUE).map(etat);
    const saisie = await modifierLaitue();
    const message = await annuler(saisie);
    expect(message).toBeNull();
    expect(b.transactions()).toBe(1);
    expect(etat(serie(b, SERIE_LAITUE))).toEqual(initiale);
    expect(occupationsDe(b, SERIE_LAITUE).map(etat)).toEqual(occInitiales);
  });
});
