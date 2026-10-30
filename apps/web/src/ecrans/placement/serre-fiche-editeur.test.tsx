// @vitest-environment happy-dom
/**
 * Tests d'acceptation T89 — « Ajouter une serre ou un tunnel » : une fiche, un tap, tout est en place (docs/backlog/T89-ajouter-serre.md,
 * règles 1 à 6, critères d'acceptation 2, 3 et 4), rendu pour de vrai (happy-dom), base mémoire, vraie porte. Contrat de l'écran :
 * ./test/contrat-serre.ts (à lire en premier) ; du cœur : packages/core/src/placement/serre-fiche.test.ts ; de la porte :
 * packages/sync/src/placement-creation.test.ts.
 *
 * Ferme de test : celle du placement (avec `origine`) : « Serre M1 » (tunnel 30 × 8 m SANS grille : ne compte pas comme « dernière serre
 * créée ») ; pour les tests de « Placer la serre », l'option `triTunnel` : zone « Tri-tunnel » (ZONE_TRI, la « Tunnel Manon » du ticket),
 * sous-zones « Manon 1 » à « Manon 3 » avec 2, 4 et 1 planches (M1-1…M3-1), une planche directe « T-1 » ; son bâtiment est retiré pour que la zone
 * soit « sans bâtiment ».
 *
 * Serre à légumes (calcul à la main) : 6 chapelles de 9,6 m, 3 tronçons de 40 m, allées de 4,40 m → 57,6 × 128,8 m (3 × 40 + 2 × 4,4), 18 zones,
 * 18 × 8 = 144 planches ; planches de 38 m (40 − 2), pas de 1,20 m (75 cm + 45 cm de passe-pied), donc 7 × 1,20 = 8,40 m entre la première
 * et la dernière dans une case de 9,6 m.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { versLocal, type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { aBouton, aChamp, attendre, bouton, champ, desactive, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { TESTID_CASES as TK } from './test/contrat-cases.ts';
import { BOUTONS_SERRE as B, CHAMPS_SERRE as C, TESTID_SERRE as TS } from './test/contrat-serre.ts';
import { deverrouiller } from './test/deverrouiller.ts';
import { ecrireFermePlacement, FERME, HANGAR, MANON, MANON_PLANCHES, POSITION, SERRE, TRI_TUNNEL, UTILISATEUR, ZONE_CHAMP, ZONE_TRI } from './test/ferme-placement.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-30T08:00:00.000Z');
const HORO = '2026-01-01T08:00:00.000Z';
const MOTIF_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  readonly placements: (readonly ChangementPlacement[])[];
}
interface Options {
  readonly role?: 'gerant' | 'equipier';
  readonly origine?: boolean;
  readonly triTunnel?: boolean;
  readonly avant?: (b: BaseMemoire) => void;
}
type Ligne = Readonly<Record<string, string | number | null>>;
type Appel = readonly { readonly sorte: string; readonly id: string; readonly valeurs?: Record<string, unknown> }[];

async function creerBanc(o: Options): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: o.origine ?? true, ...(o.triTunnel === true ? { triTunnel: true } : {}), ...(o.role === undefined ? {} : { role: o.role }) });
  if (o.triTunnel === true && (o.origine ?? true)) base.recevoir('DELETE FROM batiment WHERE id = ?', [TRI_TUNNEL]);
  o.avant?.(base);
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  const porte: PorteDonnees = {
    ...reelle,
    placer: (changements) => {
      placements.push(structuredClone(changements));
      return reelle.placer(changements);
    },
  };
  return { base, porte, placements };
}

const lignes = (b: Banc, sql: string, p: readonly unknown[] = []): Ligne[] => b.base.lireDirect<Ligne>(sql, p);
const compte = (b: Banc, sql: string, p: readonly unknown[] = []): number => Number(lignes(b, sql, p)[0]?.n ?? -1);
const zonesVivantes = (b: Banc): number => compte(b, 'SELECT count(*) AS n FROM zone WHERE ferme_id = ? AND supprime_le IS NULL', [FERME]);
const emplacementsVivants = (b: Banc): number => compte(b, 'SELECT count(*) AS n FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL', [FERME]);
const batimentsVivants = (b: Banc): number => compte(b, 'SELECT count(*) AS n FROM batiment WHERE ferme_id = ? AND supprime_le IS NULL', [FERME]);
const sortes = (appel: Appel, sorte: string): Appel => appel.filter((c) => c.sorte === sorte);

let conteneur: HTMLDivElement;
let racine: Root;
let bancCourant: Banc | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  bancCourant?.base.fermer();
  bancCourant = null;
});

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const zoneChoix = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${id}"]`);
const nombre = (el: Element, attribut: string): number => Number(el.getAttribute(attribut));
const nouveaux = (): HTMLElement[] => tous(T.batiment).filter((el) => ![SERRE, HANGAR, TRI_TUNNEL].includes(el.getAttribute('data-id') ?? ''));
const fiche = (): HTMLElement => {
  const f = un(TS.fiche);
  expect(f, 'la fiche « Serre ou tunnel » est ouverte').not.toBeNull();
  if (f === null) throw new Error('fiche absente');
  return f;
};
const valeur = (nom: string): number => Number(champ(nom, fiche()).value);
const resume = (): string => texte(un(TS.resume));

async function ouvrir(o: Options = {}): Promise<Banc> {
  const b = await creerBanc(o);
  bancCourant = b;
  const proprietes: ProprietesEditeurPlacement = { porte: b.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await deverrouiller();
  await attendre(() => zoneChoix(ZONE_CHAMP) !== null, 'liste des zones affichée');
  return b;
}

async function ouvrirLaFiche(): Promise<void> {
  await toucher(bouton(B.ajouter));
  await toucher(bouton(B.serreOuTunnel));
  await attendre(() => un(TS.fiche) !== null, 'fiche « Serre ou tunnel »');
}

/** La serre à légumes de la fiche : 6 chapelles, 3 tronçons, le reste par défaut. */
async function remplirLegumes(): Promise<void> {
  await remplir(champ(C.nom, fiche()), 'Serre à légumes');
  await remplir(champ(C.nbChapelles, fiche()), '6');
  await remplir(champ(C.nbTroncons, fiche()), '3');
}
async function enregistrer(): Promise<void> {
  await toucher(bouton(B.enregistrer));
  await unTour();
}

describe('T89 : « Ajouter » propose trois chemins', () => {
  it('« Ajouter » ouvre « Serre ou tunnel », « Parcelle de plein champ » et « Bâtiment »', async () => {
    await ouvrir();
    await toucher(bouton(B.ajouter));
    expect(aBouton(B.serreOuTunnel)).toBe(true);
    expect(aBouton(B.parcelle)).toBe(true);
    expect(aBouton(B.batiment)).toBe(true);
  });

  it('équipier : pas de « Ajouter »', async () => {
    await ouvrir({ role: 'equipier' });
    expect(aBouton(B.ajouter)).toBe(false);
  });

  it('plan verrouillé (avant « Modifier le plan ») : pas de « Ajouter »', async () => {
    const b = await creerBanc({});
    bancCourant = b;
    await act(async () => {
      racine.render(createElement(m.EditeurPlacement, { porte: b.porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true }));
      await Promise.resolve();
    });
    await attendre(() => un(T.editeur) !== null, 'éditeur affiché');
    expect(aBouton(B.ajouter)).toBe(false);
  });

  it('« Bâtiment » ouvre « Nouveau bâtiment » sans les types serre (règle 6)', async () => {
    await ouvrir();
    await toucher(bouton(B.ajouter));
    await toucher(bouton(B.batiment));
    const types = [...liste('Type').options].map((o) => o.value);
    expect(types).toContain('hangar');
    expect(types).not.toContain('serre_tunnel');
    expect(types).not.toContain('serre_chapelle');
  });
});

describe('T89 : la fiche et ses valeurs par défaut (critère 4)', () => {
  it('ferme sans serre créée : 9,6 m, 1 chapelle, 40 m, 1 tronçon, 8 planches de 75 cm × 38 m, passe-pied 45 cm — la « Serre M1 » sans grille ne compte pas', async () => {
    await ouvrir();
    await ouvrirLaFiche();
    expect(valeur(C.largeurChapelle)).toBe(9.6);
    expect(valeur(C.nbChapelles)).toBe(1);
    expect(valeur(C.longueurTroncon)).toBe(40);
    expect(valeur(C.nbTroncons)).toBe(1);
    expect(valeur(C.nbPlanches)).toBe(8);
    expect(valeur(C.largeurPlanche)).toBe(75);
    expect(valeur(C.longueurPlanche)).toBe(38);
    expect(valeur(C.passePied)).toBe(45);
    expect(champ(C.nom, fiche()).value).toBe('');
  });

  it('l’allée n’est affichée que s’il y a plus d’un tronçon (4,40 m par défaut)', async () => {
    await ouvrir();
    await ouvrirLaFiche();
    expect(aChamp(C.allee, fiche())).toBe(false);
    await remplir(champ(C.nbTroncons, fiche()), '2');
    expect(aChamp(C.allee, fiche())).toBe(true);
    expect(valeur(C.allee)).toBe(4.4);
    await remplir(champ(C.nbTroncons, fiche()), '1');
    expect(aChamp(C.allee, fiche())).toBe(false);
  });

  it('les champs sont dans l’ordre du ticket : nom, chapelle, chapelles, tronçon, tronçons, préfixe, planches', async () => {
    await ouvrir();
    await ouvrirLaFiche();
    await remplir(champ(C.nbTroncons, fiche()), '2');
    const noms = [...fiche().querySelectorAll('input')].map((i) => i.getAttribute('aria-label') ?? texte(i.closest('label')));
    const attendus = [C.nom, C.largeurChapelle, C.nbChapelles, C.longueurTroncon, C.nbTroncons, C.allee, C.prefixe, C.nbPlanches, C.largeurPlanche, C.longueurPlanche, C.passePied];
    expect(noms).toEqual(attendus);
  });

  it('les défauts reprennent la dernière serre créée sur la ferme (4 chapelles de 8 m, 2 tronçons de 30 m, allée 3 m)', async () => {
    await ouvrir({
      avant: (base) => {
        const serre = (id: string, creeLe: string, grille: [number, number, number], mesures: [number, number], supprimee: string | null = null): void => {
          base.recevoir(
            `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, nb_chapelles, nb_troncons, largeur_allee_m, cree_le, modifie_le, supprime_le)
             VALUES (?, ?, 'Serre créée', 'serre_chapelle', ?, ?, 4, 300, 300, 0, NULL, ?, ?, ?, ?, ?, ?)`,
            [id, FERME, mesures[0], mesures[1], grille[0], grille[1], grille[2], creeLe, creeLe, supprimee],
          );
        };
        // Ancienne (3 chapelles), récente (4 × 2, allée 3 : 63 × 32 m), plus récente mais supprimée (2 chapelles), qui ne compte pas.
        serre('0192f0c1-28b0-7000-8000-00000000a001', '2026-06-01T08:00:00.000Z', [3, 1, 0], [40, 28.8]);
        serre('0192f0c1-28b0-7000-8000-00000000a002', '2026-09-01T08:00:00.000Z', [4, 2, 3], [63, 32]);
        serre('0192f0c1-28b0-7000-8000-00000000a003', '2026-10-01T08:00:00.000Z', [2, 1, 0], [40, 19.2], '2026-10-02T08:00:00.000Z');
      },
    });
    await ouvrirLaFiche();
    expect(valeur(C.largeurChapelle)).toBe(8);
    expect(valeur(C.nbChapelles)).toBe(4);
    expect(valeur(C.longueurTroncon)).toBe(30);
    expect(valeur(C.nbTroncons)).toBe(2);
    expect(valeur(C.allee)).toBe(3);
    // 8 m de chapelle : 7 planches (7 × 0,75 + 6 × 0,45 = 7,95), longueur 30 − 2 = 28.
    expect(valeur(C.nbPlanches)).toBe(7);
    expect(valeur(C.longueurPlanche)).toBe(28);
  });

  it('le préfixe des zones suit le nom ; modifié à la main, il ne suit plus', async () => {
    await ouvrir();
    await ouvrirLaFiche();
    await remplir(champ(C.nom, fiche()), 'Serre à légumes');
    expect(champ(C.prefixe, fiche()).value).toBe('Serre à légumes');
    await remplir(champ(C.prefixe, fiche()), 'SL');
    await remplir(champ(C.nom, fiche()), 'Serre des légumes');
    expect(champ(C.prefixe, fiche()).value).toBe('SL');
  });

  it('résumé calculé : serre à légumes « 57,6 × 128,8 m, 18 zones, 144 planches »', async () => {
    await ouvrir();
    await ouvrirLaFiche();
    await remplirLegumes();
    expect(resume()).toContain('57,6 × 128,8 m, 18 zones, 144 planches');
  });

  it('résumé recalculé à chaque saisie (un tunnel de 3 chapelles : 28,8 × 40 m, 3 zones)', async () => {
    await ouvrir();
    await ouvrirLaFiche();
    await remplir(champ(C.nbChapelles, fiche()), '3');
    expect(resume()).toContain('28,8 × 40 m, 3 zones');
  });

  it.each([
    ['nom vide', C.nom, ''],
    ['0 chapelle', C.nbChapelles, '0'],
    ['2,5 chapelles', C.nbChapelles, '2.5'],
    ['101 chapelles', C.nbChapelles, '101'],
    ['0 tronçon', C.nbTroncons, '0'],
    ['51 tronçons', C.nbTroncons, '51'],
    ['chapelle de largeur nulle', C.largeurChapelle, '0'],
    ['tronçon de longueur négative', C.longueurTroncon, '-3'],
    ['champ vidé', C.longueurTroncon, ''],
  ])('%s : « Créer » est désactivé et dit pourquoi, rien n’est écrit', async (_cas, nomChamp, saisie) => {
    const b = await ouvrir();
    await ouvrirLaFiche();
    await remplir(champ(C.nom, fiche()), 'Serre à légumes');
    await remplir(champ(nomChamp, fiche()), saisie);
    expect(desactive(bouton(B.creer, fiche()))).toBe(true);
    expect(texte(un(TS.aide)).length).toBeGreaterThan(0);
    expect(b.placements).toEqual([]);
  });

  it('allée trop large pour la longueur : « Créer » désactivé', async () => {
    await ouvrir();
    await ouvrirLaFiche();
    await remplir(champ(C.nom, fiche()), 'Serre');
    await remplir(champ(C.nbTroncons, fiche()), '2');
    await remplir(champ(C.allee, fiche()), '80');
    expect(desactive(bouton(B.creer, fiche()))).toBe(true);
  });
});

describe('T89 : « Créer » met la serre à légumes au brouillon (critère 2)', () => {
  async function creerLegumes(): Promise<Banc> {
    const b = await ouvrir();
    await ouvrirLaFiche();
    await remplirLegumes();
    await toucher(bouton(B.creer, fiche()));
    return b;
  }

  it('la fiche se ferme ; un bâtiment au brouillon : 128,8 × 57,6 m, cap 0°, sélectionné, au centre de la vue ; rien d’écrit', async () => {
    const b = await creerLegumes();
    expect(un(TS.fiche)).toBeNull();
    const serre = nouveaux()[0];
    expect(nouveaux()).toHaveLength(1);
    expect(serre, 'serre au plan').toBeDefined();
    if (serre === undefined) return;
    expect(serre.getAttribute('data-id')).toMatch(MOTIF_UUID_V7);
    expect(serre.getAttribute('aria-pressed')).toBe('true');
    expect(serre.getAttribute('aria-label') ?? '').toMatch(/^Serre à légumes/);
    expect(nombre(serre, 'data-longueur')).toBeCloseTo(128.8, 3);
    expect(nombre(serre, 'data-largeur')).toBeCloseTo(57.6, 3);
    expect(nombre(serre, 'data-orientation')).toBeCloseTo(0, 3);
    const [lat, lon] = (un(T.editeur)?.getAttribute('data-centre') ?? '0,0').split(',').map(Number);
    const centre = versLocal(POSITION, { latitude: lat ?? 0, longitude: lon ?? 0 });
    expect(Math.abs(nombre(serre, 'data-x') - centre.x)).toBeLessThan(2);
    expect(Math.abs(nombre(serre, 'data-y') - centre.y)).toBeLessThan(2);
    expect(tous(T.poigneeRotation)).toHaveLength(1);
    expect(b.placements, 'créer n’écrit rien').toEqual([]);
    expect(zonesVivantes(b)).toBe(2);
    expect(emplacementsVivants(b)).toBe(1);
    expect(batimentsVivants(b)).toBe(2);
  });

  it('le brouillon compte 1 bâtiment, 1 zone, 18 sous-zones, 144 emplacements', async () => {
    await creerLegumes();
    const brouillon = un(TS.brouillon);
    expect(brouillon, 'élément brouillon-serre').not.toBeNull();
    expect([nombre(brouillon ?? document.body, 'data-batiments'), nombre(brouillon ?? document.body, 'data-zones'), nombre(brouillon ?? document.body, 'data-sous-zones'), nombre(brouillon ?? document.body, 'data-emplacements')]).toEqual([1, 1, 18, 144]);
  });

  it('18 cases « Serre à légumes 1 » à « 18 » dans l’ordre (tronçon par tronçon), 144 planches placées de plus', async () => {
    await creerLegumes();
    const cases = tous(TK.casesSerre).sort((a, c) => nombre(a, 'data-troncon') - nombre(c, 'data-troncon') || nombre(a, 'data-chapelle') - nombre(c, 'data-chapelle'));
    expect(cases).toHaveLength(18);
    expect(cases.map((c) => texte(c))).toEqual(Array.from({ length: 18 }, (_x, i) => `Serre à légumes ${String(i + 1)}`));
    expect(tous(T.planche), 'PC-01 + 144 planches du brouillon').toHaveLength(145);
  });

  it('« Abandonner les changements » : plus rien au brouillon, rien d’écrit', async () => {
    const b = await creerLegumes();
    await toucher(bouton(B.abandonner));
    expect(nouveaux()).toHaveLength(0);
    expect(un(TS.brouillon)).toBeNull();
    expect(tous(TK.casesSerre)).toHaveLength(0);
    expect(tous(T.planche)).toHaveLength(1);
    expect(b.placements).toEqual([]);
    expect(zonesVivantes(b)).toBe(2);
  });
});

describe('T89 : « Enregistrer » écrit tout en un seul enregistrement, « Annuler » ne laisse rien (critère 2)', () => {
  async function creerEtEnregistrer(): Promise<Banc> {
    const b = await ouvrir();
    await ouvrirLaFiche();
    await remplirLegumes();
    await toucher(bouton(B.creer, fiche()));
    await enregistrer();
    await attendre(() => b.placements.length === 1 && batimentsVivants(b) === 3, 'serre écrite');
    return b;
  }

  it('un seul porte.placer de 164 changements : 19 zone_creation, 144 emplacement_creation, 1 bâtiment', async () => {
    const b = await creerEtEnregistrer();
    expect(b.placements).toHaveLength(1);
    const appel = (b.placements[0] ?? []) as Appel;
    expect(appel).toHaveLength(164);
    expect(sortes(appel, 'zone_creation')).toHaveLength(19);
    expect(sortes(appel, 'emplacement_creation')).toHaveLength(144);
    expect(sortes(appel, 'batiment')).toHaveLength(1);
  });

  it('ordre d’écriture : la serre, ses sous-zones, les planches après leur sous-zone, le bâtiment après la zone qu’il abrite', async () => {
    const b = await creerEtEnregistrer();
    const appel = (b.placements[0] ?? []) as Appel;
    const rang = (id: string): number => appel.findIndex((c) => c.id === id);
    const racineZone = sortes(appel, 'zone_creation').find((c) => c.valeurs?.zone_parente_id == null);
    expect(racineZone, 'la zone de la serre (sans parente)').toBeDefined();
    const batiment = sortes(appel, 'batiment')[0];
    expect(batiment?.valeurs?.zone_id).toBe(racineZone?.id);
    expect(rang(racineZone?.id ?? '')).toBeLessThan(rang(batiment?.id ?? ''));
    for (const z of sortes(appel, 'zone_creation').filter((c) => c.id !== racineZone?.id)) {
      expect(z.valeurs?.zone_parente_id).toBe(racineZone?.id);
      expect(rang(z.id)).toBeGreaterThan(rang(racineZone?.id ?? ''));
    }
    for (const e of sortes(appel, 'emplacement_creation')) {
      expect(rang(String(e.valeurs?.zone_id)), `la zone de ${e.id} est écrite avant`).toBeLessThan(rang(e.id));
    }
  });

  it('en base : le bâtiment (dimensions totales, grille, serre_chapelle), la zone, 18 sous-zones nommées, 144 planches P1…P8 placées', async () => {
    const b = await creerEtEnregistrer();
    const zone = lignes(b, "SELECT * FROM zone WHERE nom = 'Serre à légumes' AND ferme_id = ? AND supprime_le IS NULL", [FERME]);
    expect(zone).toHaveLength(1);
    const zoneId = String(zone[0]?.id);
    expect(zone[0]).toMatchObject({ zone_parente_id: null, contour: null });
    const serre = lignes(b, 'SELECT * FROM batiment WHERE zone_id = ? AND supprime_le IS NULL', [zoneId]);
    expect(serre).toHaveLength(1);
    expect(serre[0]).toMatchObject({ ferme_id: FERME, nom: 'Serre à légumes', type: 'serre_chapelle', longueur_m: 128.8, largeur_m: 57.6, orientation_deg: 0, nb_chapelles: 6, nb_troncons: 3, largeur_allee_m: 4.4 });
    expect(Number(serre[0]?.hauteur_m)).toBeGreaterThan(0);
    const sous = lignes(b, 'SELECT * FROM zone WHERE zone_parente_id = ? AND supprime_le IS NULL', [zoneId]);
    expect(sous.map((z) => z.nom).sort((x, y) => String(x).localeCompare(String(y), 'fr', { numeric: true }))).toEqual(Array.from({ length: 18 }, (_x, i) => `Serre à légumes ${String(i + 1)}`));
    expect(emplacementsVivants(b)).toBe(1 + 144);
    for (const z of sous) {
      const planches = lignes(b, 'SELECT * FROM emplacement WHERE zone_id = ? AND supprime_le IS NULL', [String(z.id)]);
      expect(planches.map((p) => p.code).sort(), `planches de ${String(z.nom)}`).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
      for (const p of planches) {
        expect(p).toMatchObject({ ferme_id: FERME, sorte: 'planche', longueur_m: 38, largeur_m: 0.75 });
        expect(p.placement_x_m, `${String(z.nom)} ${String(p.code)} placée`).not.toBeNull();
        expect(p.placement_y_m).not.toBeNull();
        expect(p.orientation_deg).not.toBeNull();
      }
    }
  });

  it('les 8 planches d’une sous-zone sont rangées dans leur case : alignées, pas de 1,20 m (75 cm + passe-pied 45 cm), 8,40 m de la première à la dernière', async () => {
    const b = await creerEtEnregistrer();
    const premiere = lignes(b, "SELECT id FROM zone WHERE nom = 'Serre à légumes 1' AND supprime_le IS NULL")[0];
    const p = lignes(b, 'SELECT placement_x_m AS x, placement_y_m AS y FROM emplacement WHERE zone_id = ? AND supprime_le IS NULL', [String(premiere?.id)]);
    expect(p).toHaveLength(8);
    const etendue = (axe: 'x' | 'y'): number => Math.max(...p.map((l) => Number(l[axe]))) - Math.min(...p.map((l) => Number(l[axe])));
    expect(Math.min(etendue('x'), etendue('y'))).toBeCloseTo(0, 3);
    expect(Math.max(etendue('x'), etendue('y'))).toBeCloseTo(8.4, 3);
  });

  it('« Annuler » après l’enregistrement : un second appel, plus aucune zone, planche ni serre créées', async () => {
    const b = await creerEtEnregistrer();
    await attendre(() => un(T.annuler) !== null, '« Annuler » après l’enregistrement');
    const a = un(T.annuler);
    if (a !== null) await toucher(a);
    await attendre(() => batimentsVivants(b) === 2, 'serre retirée');
    expect(b.placements, 'l’annulation est un second appel, pas 164').toHaveLength(2);
    expect(zonesVivantes(b)).toBe(2);
    expect(emplacementsVivants(b)).toBe(1);
    expect(compte(b, "SELECT count(*) AS n FROM zone WHERE nom LIKE 'Serre à légumes%' AND supprime_le IS NULL")).toBe(0);
    expect(nouveaux()).toHaveLength(0);
  });

  it('un rejet de la porte (gérant devenu équipier avant d’enregistrer) garde le brouillon, affiche le message et n’écrit rien', async () => {
    const b = await ouvrir();
    await ouvrirLaFiche();
    await remplirLegumes();
    await toucher(bouton(B.creer, fiche()));
    b.base.recevoir("UPDATE membre SET role = 'equipier' WHERE utilisateur_id = ?", [UTILISATEUR]);
    await enregistrer();
    await attendre(() => document.querySelector('[role="alert"]') !== null, 'message de refus');
    expect(texte(document.querySelector('[role="alert"]'))).toContain('Seul le gérant peut placer les éléments de la ferme');
    expect(nouveaux(), 'brouillon gardé').toHaveLength(1);
    expect(zonesVivantes(b)).toBe(2);
    expect(emplacementsVivants(b)).toBe(1);
    expect(batimentsVivants(b)).toBe(2);
  });
});

describe('T89 : « Placer la serre » depuis « Tunnel Manon » (critère 3)', () => {
  async function placerLaSerre(): Promise<Banc> {
    const b = await ouvrir({ triTunnel: true });
    const z = zoneChoix(ZONE_TRI);
    if (z === null) throw new Error('zone Tri-tunnel absente');
    await toucher(z);
    await toucher(bouton(B.placerSerre));
    await attendre(() => un(TS.fiche) !== null, 'fiche « Serre ou tunnel »');
    return b;
  }
  const doublons = (b: Banc, table: 'zone' | 'emplacement', colonne: string): Ligne[] =>
    lignes(b, `SELECT ${colonne} AS cle, count(*) AS n FROM ${table} WHERE ferme_id = ? AND supprime_le IS NULL GROUP BY ${colonne}, ${table === 'emplacement' ? 'zone_id' : '1'} HAVING count(*) > 1`, [FERME]);

  it('ouvre la même fiche, préremplie : nom et préfixe « Tri-tunnel », 3 chapelles (les 3 sous-zones), 1 tronçon, résumé 28,8 × 40 m, 3 zones', async () => {
    const b = await placerLaSerre();
    expect(champ(C.nom, fiche()).value).toBe('Tri-tunnel');
    expect(champ(C.prefixe, fiche()).value).toBe('Tri-tunnel');
    expect(valeur(C.nbChapelles)).toBe(3);
    expect(valeur(C.nbTroncons)).toBe(1);
    expect(valeur(C.largeurChapelle)).toBe(9.6);
    expect(resume()).toContain('28,8 × 40 m, 3 zones');
    expect(b.placements, 'ouvrir la fiche n’écrit rien').toEqual([]);
  });

  it('nombre de planches par zone prérempli : le plus grand nombre de planches d’une sous-zone existante (4)', async () => {
    await placerLaSerre();
    expect(valeur(C.nbPlanches)).toBe(4);
  });

  it('« Créer » : la serre à 3 cases « Manon 1 » à « Manon 3 » dans l’ordre naturel, aucune zone ni planche en double au brouillon', async () => {
    const b = await placerLaSerre();
    await toucher(bouton(B.creer, fiche()));
    const cases = tous(TK.casesSerre).sort((x, y) => nombre(x, 'data-chapelle') - nombre(y, 'data-chapelle'));
    expect(cases.map((c) => texte(c))).toEqual(['Manon 1', 'Manon 2', 'Manon 3']);
    expect(cases.map((c) => c.getAttribute('data-id'))).toEqual([...MANON]);
    expect(nouveaux()).toHaveLength(1);
    const brouillon = un(TS.brouillon);
    // Seul le bâtiment est nouveau, plus 5 planches manquantes (Manon 1 : 2, Manon 2 : 0, Manon 3 : 3) ; ni zone ni sous-zone.
    expect([nombre(brouillon ?? document.body, 'data-batiments'), nombre(brouillon ?? document.body, 'data-zones'), nombre(brouillon ?? document.body, 'data-sous-zones'), nombre(brouillon ?? document.body, 'data-emplacements')]).toEqual([1, 0, 0, 5]);
    expect(b.placements).toEqual([]);
  });

  it('« Enregistrer » : un seul appel sans zone_creation, 5 emplacement_creation, le bâtiment abrite « Tri-tunnel » ; zones existantes intactes', async () => {
    const b = await placerLaSerre();
    const avantZones = zonesVivantes(b);
    const avantPlanches = emplacementsVivants(b);
    await toucher(bouton(B.creer, fiche()));
    await enregistrer();
    await attendre(() => b.placements.length === 1 && batimentsVivants(b) === 3, 'serre écrite');
    const appel = (b.placements[0] ?? []) as Appel;
    expect(sortes(appel, 'zone_creation'), 'les zones existantes sont reprises, pas recréées').toHaveLength(0);
    expect(sortes(appel, 'emplacement_creation')).toHaveLength(5);
    const serre = sortes(appel, 'batiment')[0];
    expect(serre?.valeurs).toMatchObject({ zone_id: ZONE_TRI, nb_chapelles: 3, nb_troncons: 1, type: 'serre_chapelle', longueur_m: 40, largeur_m: 28.8 });
    expect(zonesVivantes(b)).toBe(avantZones);
    expect(emplacementsVivants(b)).toBe(avantPlanches + 5);
    expect(doublons(b, 'zone', 'nom')).toEqual([]);
    expect(doublons(b, 'emplacement', 'code')).toEqual([]);
  });

  it('les planches existantes gardent leur identifiant et sont placées ; chaque Manon a 4 planches, toutes placées', async () => {
    const b = await placerLaSerre();
    await toucher(bouton(B.creer, fiche()));
    await enregistrer();
    await attendre(() => b.placements.length === 1 && batimentsVivants(b) === 3, 'serre écrite');
    for (const id of MANON_PLANCHES.flat()) {
      const l = lignes(b, 'SELECT * FROM emplacement WHERE id = ?', [id])[0];
      expect(l?.supprime_le, `planche ${id} reprise`).toBeNull();
      expect(l?.placement_x_m, `planche ${id} placée`).not.toBeNull();
    }
    for (const z of MANON) {
      const planches = lignes(b, 'SELECT * FROM emplacement WHERE zone_id = ? AND supprime_le IS NULL', [z]);
      expect(planches, `planches de ${z}`).toHaveLength(4);
      expect(planches.every((p) => p.placement_x_m !== null)).toBe(true);
      expect(new Set(planches.map((p) => p.code)).size, 'codes distincts dans la zone').toBe(4);
    }
  });

  it('« Annuler » : retire le bâtiment et les 5 planches créées, rend les planches reprises à leur état d’avant (non placées)', async () => {
    const b = await placerLaSerre();
    const avantPlanches = emplacementsVivants(b);
    await toucher(bouton(B.creer, fiche()));
    await enregistrer();
    await attendre(() => b.placements.length === 1 && batimentsVivants(b) === 3, 'serre écrite');
    await attendre(() => un(T.annuler) !== null, '« Annuler » après l’enregistrement');
    const a = un(T.annuler);
    if (a !== null) await toucher(a);
    await attendre(() => batimentsVivants(b) === 2, 'serre retirée');
    expect(emplacementsVivants(b)).toBe(avantPlanches);
    for (const id of MANON_PLANCHES.flat()) expect(lignes(b, 'SELECT placement_x_m AS x FROM emplacement WHERE id = ?', [id])[0]?.x).toBeNull();
  });

  it('pas de « Placer la serre » sur une zone qui a déjà son bâtiment', async () => {
    await ouvrir({ triTunnel: true, avant: (base) => {
      base.recevoir(
        `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id, cree_le, modifie_le, supprime_le)
         VALUES (?, ?, 'Tri-tunnel', 'serre_tunnel', 40, 28.8, 4, 200, 60, 0, ?, ?, ?, NULL)`,
        [TRI_TUNNEL, FERME, ZONE_TRI, HORO, HORO],
      );
    } });
    const z = zoneChoix(ZONE_TRI);
    if (z !== null) await toucher(z);
    expect(aBouton(B.placerSerre)).toBe(false);
  });
});
