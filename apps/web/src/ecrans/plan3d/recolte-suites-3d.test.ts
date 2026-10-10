/**
 * Tests d'acceptation T32f — la balise pendant la fin de récolte (Q38 : balise pâle jusqu'au bout) et
 * les pérennes à cheval sur deux années, vus de la 3D : adaptateur (plants.ts, recolte.ts,
 * donnees-plants.ts) et rendu des instances (plants-rendu.ts), sans navigateur ni WebGL. Écrits AVANT
 * le code. Contrat : ./test/contrat-recolte-suites.ts. Les tests de T32e (recolte-3d.test.ts) ne
 * changent pas ; deux d'entre eux attendent encore « pas de balise en fin de récolte » (voir le rapport
 * du testeur et le contrat) : le chef tranche.
 */
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { ajouterJours, type DateCalendaire } from '@planif/core';
import { profilParDefaut, type DatesCroissance } from '@planif/core/croissance';
import { beforeAll, describe, expect, it } from 'vitest';
import { COULEUR_FEUILLAGE_3D } from '../../ui/jetons.ts';
import { construireCultures, cultureAu, type LignesPlants } from './donnees-plants.ts';
import { appliquerFiltres, COULEUR_ESTOMPEE, FILTRES_TOUT, type FiltresScene, type Scene, type VolumeScene } from './scene.ts';
import { plantsDePlanche, type CultureDePlanche, type PlantsPlanche } from './plants.ts';
import type { BilanPlants, RenduPlants } from './plants-rendu.ts';
import { JETON_BALISE_FIN_RECOLTE, MENTION_DERNIERES_RECOLTES, type ModuleRecolteSuites, type PhaseRecolte3d } from './test/contrat-recolte-suites.ts';

// ── Modules chargés par import dynamique (chemin tenu dans une variable) ─────────────────────
interface ModuleRecolteWeb extends ModuleRecolteSuites {
  planchesARecolter(plants: readonly (PlantsPlanche | null)[], filtree: ReturnType<typeof appliquerFiltres>): readonly string[];
  phrasePlanchesARecolter(n: number): string;
  aBalise(p: PlantsPlanche | null, filtre: { readonly estompe: boolean } | undefined): boolean;
}
interface RenduT32f extends RenduPlants {
  lierFruits(m: InstancedMesh | null): void;
  lierBalises(m: InstancedMesh | null): void;
  geometrieFruit(): InstancedMesh['geometry'];
  geometrieBalise(): InstancedMesh['geometry'];
  poser(scene: Scene, filtree: ReturnType<typeof appliquerFiltres>, plants: readonly (PlantsPlanche | null)[]): BilanPlants & { readonly fruits: number; readonly balises: number };
}
interface ModuleRendu {
  readonly RenduPlants: new () => RenduT32f;
}
type Jetons = Readonly<Record<string, string | undefined>>;
const CHEMIN_RECOLTE = './recolte.ts';
const CHEMIN_RENDU = './plants-rendu.ts';
const CHEMIN_JETONS = '../../ui/jetons.ts';
let rc: ModuleRecolteWeb;
let r: ModuleRendu;
let jetons: Jetons;
beforeAll(async () => {
  rc = (await import(/* @vite-ignore */ CHEMIN_RECOLTE)) as ModuleRecolteWeb;
  r = (await import(/* @vite-ignore */ CHEMIN_RENDU)) as ModuleRendu;
  jetons = (await import(/* @vite-ignore */ CHEMIN_JETONS)) as Jetons;
});

/** Le jeton de la balise pâle, ou une erreur claire tant qu'il n'existe pas. */
function jetonFin(): string {
  const v = jetons[JETON_BALISE_FIN_RECOLTE];
  if (typeof v !== 'string') throw new Error(`src/ui/jetons.ts n'exporte pas encore ${JETON_BALISE_FIN_RECOLTE} (T32f)`);
  return v;
}

const NOM_JETON_VIF = 'COULEUR_BALISE_RECOLTE_3D';
const jetonVif = (): string => jetons[NOM_JETON_VIF] ?? '#FF6A00';

// ── Données ──────────────────────────────────────────────────────────────────────────────────
const d = (s: string): DateCalendaire => s as DateCalendaire;
const HAUTEUR_ECRAN = 800;
const PROCHE = { x: 3, y: 3, z: 5 };
const LOIN = { x: 3, y: 5_000, z: 5 };
const B = d('2027-07-01');
const F = d('2027-09-15');
const A = d('2027-10-15');
const avant = (jour: DateCalendaire, n: number): DateCalendaire => ajouterJours(jour, -n);
const datesCourgette: DatesCroissance = {
  miseEnPlace: { prevue: d('2027-04-01'), reelle: null },
  debutRecolte: { prevue: B, reelle: null },
  finRecolte: { prevue: F, reelle: null },
  arrachage: { prevue: A, reelle: null },
};
/** Une salade récoltée sur 10 jours : du 1er au 11 juillet, arrachée le 20. */
const datesCourtes: DatesCroissance = {
  miseEnPlace: { prevue: d('2027-05-20'), reelle: null },
  debutRecolte: { prevue: B, reelle: null },
  finRecolte: { prevue: d('2027-07-11'), reelle: null },
  arrachage: { prevue: d('2027-07-20'), reelle: null },
};

type Espece = 'Courgette' | 'Tomate' | 'Laitue';
const CLE_FAMILLE: Record<Espece, VolumeScene['cleFamille']> = { Courgette: 'cucurbitacees', Tomate: 'solanacees', Laitue: 'salades' };
const ECARTEMENT: Record<Espece, number> = { Courgette: 0.6, Tomate: 0.5, Laitue: 0.3 };
const SEULEMENT_COURGETTES: FiltresScene = { familles: new Set(['cucurbitacees']), cultures: null, zones: null };

function culture(espece: Espece, dates: DatesCroissance = datesCourgette): CultureDePlanche {
  return { espece, profil: profilParDefaut(espece).profil, croissance: { sorte: 'annuelle', dates }, ecartementM: ECARTEMENT[espece] };
}
const volume = (i: number, espece: Espece): VolumeScene => ({ id: `p${String(i)}`, code: `P${String(i)}`, zoneId: 'z', x: 3 * i, z: 0, longueur: 12, largeur: 1, hauteur: 0.3, angle: 0, placee: true, couleur: '#C0392B', cleFamille: CLE_FAMILLE[espece], culture: espece, occupationId: `o${String(i)}` });

interface Planche {
  readonly espece: Espece;
  readonly dates?: DatesCroissance | undefined;
}
function ferme(planches: readonly Planche[], jour: DateCalendaire): { scene: Scene; plants: (PlantsPlanche | null)[] } {
  const volumes = planches.map((p, i) => volume(i, p.espece));
  const plants = volumes.map((v, i) => plantsDePlanche({ volume: v, culture: culture(planches[i]?.espece ?? 'Tomate', planches[i]?.dates), jour, horsSol: false }));
  return { scene: { semaine: 0, libelleSemaine: 'S01', socles: [], volumes, batiments: [] }, plants };
}
const unePlanche = (espece: Espece, jour: DateCalendaire, dates?: DatesCroissance) => ferme([{ espece, dates }], jour);

/** Pose la scène depuis la caméra `cam` ; les mailles (fruits, balises) sont liées comme dans la vue. */
function poser(scene: Scene, plants: readonly (PlantsPlanche | null)[], cam = LOIN, filtres: FiltresScene = FILTRES_TOUT) {
  const filtree = appliquerFiltres(scene, filtres);
  const rendu = new r.RenduPlants();
  for (const forme of ['erige-tuteure', 'rosette', 'touffe', 'rampant', 'buisson', 'arbre-ou-liane', 'bulbe-ou-racine'] as const) rendu.lierMaillage(forme, new InstancedMesh(rendu.geometrie(forme), new MeshBasicMaterial(), 2048));
  rendu.lierTuteurs(new InstancedMesh(rendu.geometrieTuteur(), new MeshBasicMaterial(), 2048));
  const fruits = new InstancedMesh(rendu.geometrieFruit(), new MeshBasicMaterial(), 4096);
  const balises = new InstancedMesh(rendu.geometrieBalise(), new MeshBasicMaterial(), 2048);
  rendu.lierFruits(fruits);
  rendu.lierBalises(balises);
  rendu.choisirDetail(scene, plants, cam.x, cam.y, cam.z, HAUTEUR_ECRAN);
  const bilan = rendu.poser(scene, filtree, plants);
  return { fruits, balises, bilan, filtree };
}
function couleurs(m: InstancedMesh): string[] {
  const c = new Color();
  return Array.from({ length: m.count }, (_, i) => {
    m.getColorAt(i, c);
    return `#${c.getHexString().toUpperCase()}`;
  });
}
const hex = (s: string): string => `#${new Color(s).getHexString().toUpperCase()}`;
const phaseDe = (espece: Espece, jour: DateCalendaire, dates?: DatesCroissance): PhaseRecolte3d | undefined => unePlanche(espece, jour, dates).plants[0]?.recolte.phase;

// ── Le jeton de la balise pâle ───────────────────────────────────────────────────────────────
describe('T32f : jeton de la balise « dernières récoltes » (Q38)', () => {
  it('COULEUR_BALISE_FIN_RECOLTE_3D existe dans jetons.ts, en hexadécimal #RRGGBB', () => {
    expect(jetonFin()).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('plus pâle que la balise vive (moins saturée ou plus claire), et pourtant distincte', () => {
    const vive = { h: 0, s: 0, l: 0 };
    const pale = { h: 0, s: 0, l: 0 };
    new Color(jetonVif()).getHSL(vive);
    new Color(jetonFin()).getHSL(pale);
    expect(pale.s < vive.s - 0.05 || pale.l > vive.l + 0.05, 'plus pâle : saturation plus basse ou clarté plus haute').toBe(true);
    expect(hex(jetonFin())).not.toBe(hex(jetonVif()));
  });

  it('distincte du feuillage, de l’estompé et de chaque fruit mûr ; encore visible sur le fond estompé', () => {
    const pale = hex(jetonFin());
    expect(pale).not.toBe(hex(COULEUR_FEUILLAGE_3D));
    expect(pale).not.toBe(hex(COULEUR_ESTOMPEE));
    for (const nom of ['COULEUR_COURGETTE_MURE_3D', 'COULEUR_TOMATE_MURE_3D', 'COULEUR_FRAISE_MURE_3D', 'COULEUR_FRUIT_GENERIQUE_MUR_3D', 'COULEUR_FRUIT_VERT_3D']) {
      const autre = jetons[nom];
      if (autre !== undefined) expect(pale, nom).not.toBe(hex(autre));
    }
    const a = new Color(pale);
    const b = new Color(COULEUR_ESTOMPEE);
    expect(Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b), 'écart avec la couleur estompée').toBeGreaterThan(0.1);
  });
});

// ── La mention de la liste ───────────────────────────────────────────────────────────────────
describe('T32f : la ligne de la liste dit « dernières récoltes »', () => {
  it('mentionRecolte : la fin de récolte dit « dernières récoltes », les autres phases gardent leur mention', () => {
    expect(rc.mentionRecolte('fin-de-recolte')).toBe(MENTION_DERNIERES_RECOLTES);
    expect(rc.mentionRecolte('a-recolter')).toBe('à récolter');
    expect(rc.mentionRecolte('fruits-en-formation')).toBe('récolte proche');
    expect(rc.mentionRecolte('aucune')).toBeNull();
  });
});

// ── Planches comptées ────────────────────────────────────────────────────────────────────────
describe('T32f : une planche en fin de récolte est comptée dans « N planches à récolter »', () => {
  const jour = avant(F, 3);
  it('planchesARecolter : « à récolter » et « fin de récolte », dans l’ordre de la scène, sans les null ni les autres phases', () => {
    // Au 10 août 2027 : p0 en fin de récolte, p1 à récolter (courgette de T32e), p2 en formation, p3 pas encore plantée, p4 en fin de récolte.
    const jourAout = d('2027-08-10');
    const enFin: DatesCroissance = { miseEnPlace: { prevue: d('2027-06-01'), reelle: null }, debutRecolte: { prevue: d('2027-07-25'), reelle: null }, finRecolte: { prevue: d('2027-08-12'), reelle: null }, arrachage: { prevue: d('2027-09-01'), reelle: null } };
    const enFormation: DatesCroissance = { miseEnPlace: { prevue: d('2027-06-01'), reelle: null }, debutRecolte: { prevue: d('2027-08-20'), reelle: null }, finRecolte: { prevue: d('2027-09-30'), reelle: null }, arrachage: { prevue: d('2027-10-15'), reelle: null } };
    const pasPlantee: DatesCroissance = { miseEnPlace: { prevue: d('2027-09-01'), reelle: null }, debutRecolte: { prevue: d('2027-10-20'), reelle: null }, finRecolte: { prevue: d('2027-11-20'), reelle: null }, arrachage: { prevue: d('2027-12-01'), reelle: null } };
    const { scene, plants } = ferme([{ espece: 'Courgette', dates: enFin }, { espece: 'Courgette' }, { espece: 'Courgette', dates: enFormation }, { espece: 'Courgette', dates: pasPlantee }, { espece: 'Tomate', dates: enFin }], jourAout);
    expect(plants.map((p) => p?.recolte.phase)).toEqual(['fin-de-recolte', 'a-recolter', 'fruits-en-formation', undefined, 'fin-de-recolte']);
    const filtree = appliquerFiltres(scene, FILTRES_TOUT);
    expect(rc.planchesARecolter(plants, filtree)).toEqual(['p0', 'p1', 'p4']);
    expect(rc.planchesARecolter([null, null], filtree)).toEqual([]);
    expect(rc.phrasePlanchesARecolter(3)).toBe('3 planches à récolter');
  });

  it('une seule planche en fin de récolte : « 1 planche à récolter »', () => {
    const { scene, plants } = unePlanche('Courgette', jour);
    expect(plants[0]?.recolte.phase).toBe('fin-de-recolte');
    const ids = rc.planchesARecolter(plants, appliquerFiltres(scene, FILTRES_TOUT));
    expect(ids).toEqual(['p0']);
    expect(rc.phrasePlanchesARecolter(ids.length)).toBe('1 planche à récolter');
  });

  it('une planche en fin de récolte estompée par un filtre (T27b) n’est pas comptée', () => {
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate' }], jour);
    expect(plants.map((p) => p?.recolte.phase)).toEqual(['fin-de-recolte', 'fin-de-recolte']);
    expect(rc.planchesARecolter(plants, appliquerFiltres(scene, SEULEMENT_COURGETTES))).toEqual(['p0']);
    expect(rc.planchesARecolter(plants, appliquerFiltres(scene, FILTRES_TOUT))).toEqual(['p0', 'p1']);
  });

  it('aBalise : vrai en fin de récolte (non estompée), faux si estompée, faux sans planche', () => {
    const p = unePlanche('Courgette', jour).plants[0] ?? null;
    expect(rc.aBalise(p, { estompe: false })).toBe(true);
    expect(rc.aBalise(p, { estompe: true })).toBe(false);
    expect(rc.aBalise(null, { estompe: false })).toBe(false);
  });
});

// ── Rendu : la balise pâle ───────────────────────────────────────────────────────────────────
describe('T32f : balise pâle pendant la fin de récolte, vive pendant « à récolter »', () => {
  it('fin de récolte : une balise, couleur du jeton pâle, différente de la balise vive', () => {
    const { scene, plants } = unePlanche('Courgette', avant(F, 3));
    const { balises, bilan } = poser(scene, plants);
    expect(bilan.balises).toBe(1);
    expect(balises.count).toBe(1);
    expect(couleurs(balises)).toEqual([hex(jetonFin())]);
    const vive = poser(...Object.values(unePlanche('Courgette', ajouterJours(B, 10))) as [Scene, (PlantsPlanche | null)[]]);
    expect(couleurs(vive.balises)).toHaveLength(1);
    expect(couleurs(vive.balises)[0]).not.toBe(hex(jetonFin()));
  });

  it('une planche à récolter et une en fin de récolte : deux balises, deux couleurs différentes', () => {
    const jour = ajouterJours(B, 40);
    // p0 : dates de la courgette (à récolter au 10 août) ; p1 : récolte courte de 10 jours décalée pour être en fin de récolte au même jour.
    const fin: DatesCroissance = { miseEnPlace: { prevue: d('2027-06-01'), reelle: null }, debutRecolte: { prevue: d('2027-07-25'), reelle: null }, finRecolte: { prevue: d('2027-08-12'), reelle: null }, arrachage: { prevue: d('2027-09-01'), reelle: null } };
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate', dates: fin }], jour);
    expect(plants.map((p) => p?.recolte.phase)).toEqual(['a-recolter', 'fin-de-recolte']);
    const { balises, bilan, filtree } = poser(scene, plants);
    expect(bilan.balises).toBe(2);
    expect(balises.count).toBe(2);
    expect(rc.planchesARecolter(plants, filtree)).toEqual(['p0', 'p1']);
    const cs = couleurs(balises);
    expect(new Set(cs).size, 'deux teintes').toBe(2);
    expect(cs).toContain(hex(jetonFin()));
    expect(cs).toContain(hex(jetonVif()));
  });

  it('la balise pâle est posée comme l’autre : au-dessus de la planche, lisible de loin', () => {
    const { scene, plants } = unePlanche('Courgette', avant(F, 3));
    const { balises } = poser(scene, plants);
    const v = scene.volumes[0];
    if (v === undefined) throw new Error('planche attendue');
    const mat = new Matrix4();
    const pos = new Vector3();
    const ech = new Vector3();
    balises.getMatrixAt(0, mat);
    mat.decompose(pos, new Quaternion(), ech);
    expect(Math.abs(pos.x - v.x), 'dans l’emprise (x)').toBeLessThanOrEqual(v.longueur / 2 + 1e-6);
    expect(Math.abs(pos.z - v.z), 'dans l’emprise (z)').toBeLessThanOrEqual(v.largeur / 2 + 1e-6);
    expect(pos.y, 'au-dessus de la planche').toBeGreaterThan(v.hauteur);
    expect(Math.max(ech.x, ech.y, ech.z), 'lisible de loin').toBeGreaterThanOrEqual(0.5);
  });

  it('en détail comme de loin : la balise pâle reste, les fruits ne reviennent pas', () => {
    const { scene, plants } = unePlanche('Courgette', avant(F, 3));
    const pres = poser(scene, plants, PROCHE);
    expect(pres.bilan.balises).toBe(1);
    expect(pres.bilan.fruits).toBe(0);
    expect(poser(scene, plants, LOIN).bilan.balises).toBe(1);
  });

  it('planche filtrée (T27b) en fin de récolte : estompée, sans balise', () => {
    const { scene, plants } = ferme([{ espece: 'Courgette' }, { espece: 'Tomate' }], avant(F, 3));
    expect(poser(scene, plants, LOIN, FILTRES_TOUT).bilan.balises).toBe(2);
    const filtre = poser(scene, plants, LOIN, SEULEMENT_COURGETTES);
    expect(filtre.bilan.balises).toBe(1);
    expect(filtre.balises.count).toBe(1);
    expect(poser(scene, plants, LOIN, { familles: new Set<string>(), cultures: null, zones: null }).bilan.balises).toBe(0);
  });

  it('bilan.balises = nombre de planches annoncées par planchesARecolter, à récolter ou en fin de récolte', () => {
    const { scene, plants } = ferme(Array.from({ length: 12 }, () => ({ espece: 'Courgette' as const })), avant(F, 3));
    const { bilan, balises, filtree } = poser(scene, plants);
    expect(bilan.balises).toBe(12);
    expect(balises.count).toBe(12);
    expect(rc.planchesARecolter(plants, filtree)).toHaveLength(12);
  });

  it('après l’arrachage : plus de planche, plus de balise ; la veille, encore une (récolte courte comprise)', () => {
    const veille = unePlanche('Courgette', avant(A, 1));
    expect(poser(veille.scene, veille.plants).bilan.balises).toBeLessThanOrEqual(1);
    const apres = unePlanche('Courgette', A);
    expect(apres.plants).toEqual([null]);
    const { balises, bilan } = poser(apres.scene, apres.plants);
    expect(bilan.balises).toBe(0);
    expect(balises.count).toBe(0);
    const plusTard = unePlanche('Courgette', ajouterJours(A, 20));
    expect(poser(plusTard.scene, plusTard.plants).bilan.balises).toBe(0);
  });

  it('avant la formation des fruits : pas de balise du tout', () => {
    const { scene, plants } = unePlanche('Courgette', d('2027-05-10'));
    expect(poser(scene, plants).bilan.balises).toBe(0);
  });
});

describe('T32f : récolte courte de 10 jours (une salade) : une balise vive, puis une balise pâle', () => {
  it('« à récolter » du 1er au 5 juillet (balise vive), « fin de récolte » dès le 6 (balise pâle), plus rien le 20', () => {
    const vive = hex(jetonVif());
    const pale = hex(jetonFin());
    for (const [jour, phase, couleur] of [
      ['2027-07-01', 'a-recolter', vive],
      ['2027-07-05', 'a-recolter', vive],
      ['2027-07-06', 'fin-de-recolte', pale],
      ['2027-07-11', 'fin-de-recolte', pale],
    ] as const) {
      expect(phaseDe('Laitue', d(jour), datesCourtes), jour).toBe(phase);
      const { scene, plants } = unePlanche('Laitue', d(jour), datesCourtes);
      const { balises, bilan } = poser(scene, plants);
      expect(bilan.balises, jour).toBe(1);
      expect(couleurs(balises), jour).toEqual([couleur]);
    }
    const { scene, plants } = unePlanche('Laitue', d('2027-07-20'), datesCourtes);
    expect(poser(scene, plants).bilan.balises).toBe(0);
  });
});

// ── Pérennes à cheval sur deux années (adaptateur) ───────────────────────────────────────────
describe('T32f : pérennes à cheval sur deux années, de la lecture des campagnes à la phase de récolte', () => {
  // Un fraisier qui garde son feuillage toute l'année (sans cycle annuel) : la 3D le dessine aussi en hiver, donc on lit sa phase.
  const PROFIL_TOUTE_L_ANNEE = JSON.stringify({ forme: 'touffe', hauteurMaxM: 0.25, duree: { en: 'jours', jours: 45 }, allure: 'lineaire', finDeCycle: 'baissee', cycleAnnuel: null });
  const fraisier = { id: 'f', plantation_id: 'p1', prevu_du: '2020-03-01', prevu_au: '2040-01-01', reel_du: null, reel_au: null, p_plantation: '2020-03-01', p_arrachage: null, e_nom: 'Fraisier', e_profil: PROFIL_TOUTE_L_ANNEE };
  const VIDE: LignesPlants = { occupations: [], campagnes: [], zones: [], emplacements: [] };
  const volumeFraise = { id: 'v', x: 0, z: 0, longueur: 20, largeur: 2, angle: 0, couleur: '#000' };
  const campagne = (annee: number, debut: string, fin: string) => ({ plantation_id: 'p1', annee, debut_recolte_prevu: debut, fin_recolte_prevue: fin });

  function phaseAu(campagnes: readonly ReturnType<typeof campagne>[], jour: string): PhaseRecolte3d | undefined {
    const { parOccupation } = construireCultures({ ...VIDE, occupations: [fraisier], campagnes });
    const c = parOccupation.get('f');
    if (c === undefined) throw new Error('culture absente');
    return plantsDePlanche({ volume: volumeFraise, culture: cultureAu(c, d(jour)), jour: d(jour), horsSol: false })?.recolte.phase;
  }

  it('fraise d’hiver (10 janvier – 20 mars 2027) : le 20 décembre 2026 → fruits en formation', () => {
    expect(phaseAu([campagne(2027, '2027-01-10', '2027-03-20')], '2026-12-20')).toBe('fruits-en-formation');
  });

  it('fraise d’hiver : à récolter en février, dernières récoltes en mars, rien en été', () => {
    const hiver = [campagne(2027, '2027-01-10', '2027-03-20')];
    expect(phaseAu(hiver, '2027-02-01')).toBe('a-recolter');
    expect(phaseAu(hiver, '2027-03-10')).toBe('fin-de-recolte');
    expect(phaseAu(hiver, '2027-07-12')).toBe('aucune');
  });

  it('plusieurs années de campagnes : le 20 décembre 2026, c’est la campagne de 2027 qui s’annonce (celle de 2026 est finie)', () => {
    const deux = [campagne(2026, '2026-01-10', '2026-03-20'), campagne(2027, '2027-01-10', '2027-03-20')];
    expect(phaseAu(deux, '2026-12-20')).toBe('fruits-en-formation');
    expect(phaseAu(deux, '2026-02-01')).toBe('a-recolter');
    expect(phaseAu(deux, '2027-02-01')).toBe('a-recolter');
  });

  it('campagne du 1er décembre 2026 au 15 février 2027 (rattachée à 2026) : à récolter le 10 janvier 2027', () => {
    const cheval = [campagne(2026, '2026-12-01', '2027-02-15')];
    expect(phaseAu(cheval, '2027-01-10')).toBe('a-recolter');
    expect(phaseAu(cheval, '2026-12-20')).toBe('a-recolter');
    expect(phaseAu(cheval, '2026-11-10')).toBe('fruits-en-formation');
    expect(phaseAu(cheval, '2027-02-10')).toBe('fin-de-recolte');
  });

  it('campagne à cheval rattachée à l’année de sa fin (2027) : même résultat le 10 janvier 2027 et le 20 décembre 2026', () => {
    const cheval = [campagne(2027, '2026-12-01', '2027-02-15')];
    expect(phaseAu(cheval, '2027-01-10')).toBe('a-recolter');
    expect(phaseAu(cheval, '2026-12-20')).toBe('a-recolter');
  });

  it('une campagne de printemps de l’année du jour : comme avant (formation, récolte, hors saison)', () => {
    const printemps = [campagne(2027, '2027-05-10', '2027-06-30')];
    expect(phaseAu(printemps, '2027-05-03')).toBe('fruits-en-formation');
    expect(phaseAu(printemps, '2027-05-20')).toBe('a-recolter');
    expect(phaseAu(printemps, '2027-03-15')).toBe('aucune');
  });
});
