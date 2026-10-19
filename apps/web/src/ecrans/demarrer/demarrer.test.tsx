// @vitest-environment happy-dom
/**
 * Tests d'acceptation T49 — parcours guidé « Démarrer votre ferme » et états vides qui guident
 * (docs/backlog/T49-demarrer-sa-ferme.md, règles 4 et 5). Contrat : ./test/contrat.ts.
 *
 * Bandeau, écrans Planches et Aujourd'hui, et onglet Ferme rendus pour de vrai dans un DOM
 * simulé (happy-dom), porte sur la base mémoire d'une ferme neuve (../parcellaire/test/ferme-neuve.ts),
 * remplie au fil du test comme par la synchro (`recevoir`).
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionConnexion } from '../../connexion/session.ts';
import { ContexteFerme } from '../../donnees/contexte.ts';
import type { EtatBase, PoigneeDonnees } from '../../donnees/etat-appli.ts';
import type { CibleDemarrage, ModuleBandeau, ModuleEtapes } from './test/contrat.ts';
import { ESPECE_BIBLIOTHEQUE, FERME, ITINERAIRE_BIBLIOTHEQUE, PARAMETRES_BIBLIOTHEQUE, UTILISATEUR } from '../parcellaire/test/ferme-neuve.ts';
import { AUJOURDHUI, creerBanc, MAINTENANT, type Banc } from '../parcellaire/test/outils.ts';
import { aBouton, attendre, bouton, dialogue, region, texte, toucher } from '../itineraires/test/outils.ts';

const CHEMIN_ETAPES = './etapes.ts';
const CHEMIN_BANDEAU = './BandeauDemarrer.tsx';
const CHEMIN_PLAN = '../plan/index.ts';
const CHEMIN_AUJOURDHUI = '../aujourdhui/index.ts';
const CHEMIN_FERME = '../ferme/EcranFerme.tsx';

type Onglet = 'ferme' | 'planches';
interface ProprietesEcran {
  readonly porte: Banc['porte'];
  readonly fermeId: string;
  readonly aujourdhui?: () => string;
  readonly surOnglet?: (o: Onglet) => void;
}
interface ModulePlan {
  readonly EcranPlan: (p: ProprietesEcran) => ReactElement;
}
interface ModuleAujourdhui {
  readonly EcranAujourdhui: (p: ProprietesEcran) => ReactElement;
}
interface ModuleFerme {
  readonly default: (p: { session: SessionConnexion; baseLocale: PoigneeDonnees; surDeconnecte: (e: string | null) => void; etatBase: EtatBase }) => ReactElement;
}

let etapes: ModuleEtapes;
let bandeauM: ModuleBandeau;
let plan: ModulePlan;
let aujourdhui: ModuleAujourdhui;
let ferme: ModuleFerme;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;
let allers: CibleDemarrage[];
let onglets: Onglet[];

beforeAll(async () => {
  etapes = (await import(/* @vite-ignore */ CHEMIN_ETAPES)) as ModuleEtapes;
  bandeauM = (await import(/* @vite-ignore */ CHEMIN_BANDEAU)) as ModuleBandeau;
  plan = (await import(/* @vite-ignore */ CHEMIN_PLAN)) as ModulePlan;
  aujourdhui = (await import(/* @vite-ignore */ CHEMIN_AUJOURDHUI)) as ModuleAujourdhui;
  ferme = (await import(/* @vite-ignore */ CHEMIN_FERME)) as ModuleFerme;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  allers = [];
  onglets = [];
  etapes.prendreDemande('saisons', 'zones', 'itineraires', 'serie', 'import');
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
});

async function rendre(e: ReactElement): Promise<void> {
  await act(async () => {
    racine.render(e);
    await Promise.resolve();
  });
}

const ISO = MAINTENANT.toISOString();
const id = (n: number) => `0192f0c1-4949-7000-8000-${n.toString(16).padStart(12, '0')}`;
const SAISON = id(0xc0);
const ZONE = id(0xc1);
const PLANCHE = id(0xc2);

function recevoirSaison(): void {
  b.base.recevoir(`INSERT INTO saison (id, ferme_id, nom, debut, fin, cree_le, modifie_le, supprime_le) VALUES (?, ?, '2026', '2026-01-01', '2026-12-31', ?, ?, NULL)`, [SAISON, FERME, ISO, ISO]);
}
function recevoirPlanche(): void {
  b.base.recevoir(`INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Tunnel 1', NULL, 'tunnel', NULL, NULL, ?, ?, NULL)`, [ZONE, FERME, ISO, ISO]);
  b.base.recevoir(
    `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_places, actif_du, actif_au, remplace, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, 'P1', 'planche', 30, 0.8, NULL, '2026-01-01', NULL, '[]', ?, ?, NULL)`,
    [PLANCHE, FERME, ZONE, ISO, ISO],
  );
}
function recevoirItineraire(): void {
  b.base.recevoir(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, NULL, 'Batavia de la ferme', 'plant_maison', ?, ?, ?, NULL)`,
    [id(0xc3), FERME, ESPECE_BIBLIOTHEQUE, JSON.stringify(PARAMETRES_BIBLIOTHEQUE), ISO, ISO],
  );
}
function recevoirSerie(): void {
  b.base.recevoir(
    `INSERT INTO serie (id, ferme_id, saison_id, espece_id, variete_id, itineraire_id, parametres, ancre_type, ancre_date, longueur_m, statut, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 'plantation', '2026-10-19', 30, 'prevue', ?, ?, NULL)`,
    [id(0xc4), FERME, SAISON, ESPECE_BIBLIOTHEQUE, ITINERAIRE_BIBLIOTHEQUE, JSON.stringify(PARAMETRES_BIBLIOTHEQUE), ISO, ISO],
  );
}

const bandeau = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="demarrer-ferme"]');
const etape = (cle: string): HTMLElement | null => bandeau()?.querySelector<HTMLElement>(`[data-testid="etape-demarrage"][data-etape="${cle}"]`) ?? null;
const faites = (): string[] =>
  [...(bandeau()?.querySelectorAll<HTMLElement>('[data-testid="etape-demarrage"]') ?? [])].filter((e) => e.dataset.faite === 'oui').map((e) => e.dataset.etape ?? '');

const surAller = (c: CibleDemarrage) => {
  allers.push(c);
};
const surOnglet = (o: Onglet) => {
  onglets.push(o);
};

describe('T49 : étapes (pur)', () => {
  it('quatre étapes dans l’ordre, cochées selon l’état réel ; visible tant qu’aucune série', () => {
    const vide = etapes.etapesDemarrage({ saisons: 0, planches: 0, itineraires: 0, series: 0 });
    expect(vide.etapes.map((e) => [e.cle, e.cible, e.faite])).toEqual([
      ['saison', 'saisons', false],
      ['planches', 'zones', false],
      ['itineraires', 'itineraires', false],
      ['serie', 'serie', false],
    ]);
    expect(vide.visible).toBe(true);
    expect(vide.prochaine?.cle).toBe('saison');
    for (const e of vide.etapes) expect(e.titre.length).toBeGreaterThan(5);

    const deux = etapes.etapesDemarrage({ saisons: 1, planches: 12, itineraires: 0, series: 0 });
    expect(deux.etapes.map((e) => e.faite)).toEqual([true, true, false, false]);
    expect(deux.prochaine?.cle).toBe('itineraires');
    expect(etapes.etapesDemarrage({ saisons: 0, planches: 3, itineraires: 2, series: 0 }).prochaine?.cle).toBe('saison');

    const fini = etapes.etapesDemarrage({ saisons: 1, planches: 1, itineraires: 0, series: 1 });
    expect(fini.visible, 'une série existe : le bandeau disparaît').toBe(false);
  });

  it('demande de navigation : prise une seule fois, par l’écran qu’elle concerne', () => {
    etapes.demander('saisons');
    expect(etapes.prendreDemande('serie')).toBeNull();
    expect(etapes.prendreDemande('saisons', 'zones')).toBe('saisons');
    expect(etapes.prendreDemande('saisons', 'zones')).toBeNull();
  });
});

describe('T49 : bandeau « Démarrer votre ferme »', () => {
  it('ferme neuve : 4 étapes à faire ; chaque étape et l’import mènent à leur écran', async () => {
    await rendre(createElement(bandeauM.BandeauDemarrer, { porte: b.porte, fermeId: FERME, surAller }));
    await attendre(() => bandeau() !== null, 'bandeau affiché');
    expect(region('Démarrer votre ferme')).toBe(bandeau());
    expect(faites()).toEqual([]);
    for (const cle of ['saison', 'planches', 'itineraires', 'serie']) {
      const e = etape(cle);
      expect(e, cle).not.toBeNull();
      if (e !== null) await toucher(e);
    }
    expect(texte(bandeau())).toMatch(/déjà un tableur/);
    await toucher(bouton('Importer un tableur', bandeau() ?? document));
    expect(allers).toEqual(['saisons', 'zones', 'itineraires', 'serie', 'import']);
    expect(b.transactions(), 'le bandeau n’écrit rien').toBe(0);
  });

  it('étapes cochées au fil de l’état réel (synchro comprise) ; disparaît quand une série existe', async () => {
    await rendre(createElement(bandeauM.BandeauDemarrer, { porte: b.porte, fermeId: FERME, surAller }));
    await attendre(() => bandeau() !== null, 'bandeau affiché');
    recevoirSaison();
    await attendre(() => faites().join() === 'saison', 'saison cochée');
    recevoirPlanche();
    await attendre(() => faites().join() === 'saison,planches', 'planches cochées');
    recevoirItineraire();
    await attendre(() => faites().join() === 'saison,planches,itineraires', 'itinéraires cochés');
    recevoirSerie();
    await attendre(() => bandeau() === null, 'le bandeau disparaît');
  });
});

describe('T49 : Planches — états vides qui guident', () => {
  const rendrePlan = (avecOnglet = true) =>
    rendre(createElement(plan.EcranPlan, { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, ...(avecOnglet ? { surOnglet } : {}) }));

  it('sans saison : le dire, « Créer la saison » mène à l’onglet Ferme (saisons) ; bandeau présent', async () => {
    await rendrePlan();
    await attendre(() => texte(conteneur).includes('Aucune saison'), 'état vide sans saison');
    expect(bandeau(), 'bandeau sur Planches').not.toBeNull();
    await toucher(bouton('Créer la saison', conteneur));
    expect(onglets).toEqual(['ferme']);
    expect(etapes.prendreDemande('saisons', 'zones')).toBe('saisons');
  });

  it('une saison, aucune planche : « Ajouter des planches » mène aux zones', async () => {
    recevoirSaison();
    await rendrePlan();
    await attendre(() => texte(conteneur).includes('Aucune planche'), 'état vide sans planche');
    await toucher(bouton('Ajouter des planches', conteneur));
    expect(onglets).toEqual(['ferme']);
    expect(etapes.prendreDemande('saisons', 'zones')).toBe('zones');
  });

  it('saison et planches : l’étape « première série » ouvre « Nouvelle série » sur place', async () => {
    recevoirSaison();
    recevoirPlanche();
    await rendrePlan();
    await attendre(() => etape('serie') !== null, 'bandeau');
    const e = etape('serie');
    if (e !== null) await toucher(e);
    await attendre(() => dialogue('Nouvelle série') !== undefined, 'formulaire de série ouvert', 600);
    expect(onglets).toEqual([]);
  });

  it('une demande « serie » prise à l’ouverture ouvre le formulaire', async () => {
    recevoirSaison();
    recevoirPlanche();
    etapes.demander('serie');
    await rendrePlan();
    await attendre(() => dialogue('Nouvelle série') !== undefined, 'formulaire de série ouvert', 600);
    expect(etapes.prendreDemande('serie')).toBeNull();
  });

  it('sans surOnglet (comme avant T49) : ni bandeau ni bouton', async () => {
    await rendrePlan(false);
    await attendre(() => texte(conteneur).includes('Aucune saison'), 'état vide');
    expect(bandeau()).toBeNull();
    expect(aBouton('Créer la saison', conteneur)).toBe(false);
  });
});

describe('T49 : Aujourd’hui — sans série, dire quoi faire', () => {
  const rendreJour = () => rendre(createElement(aujourdhui.EcranAujourdhui, { porte: b.porte, fermeId: FERME, aujourdhui: () => AUJOURDHUI, surOnglet }));

  it('ferme neuve : « Aucune série », bouton vers la prochaine étape (la saison) ; bandeau présent', async () => {
    await rendreJour();
    await attendre(() => texte(conteneur).includes('Aucune série'), 'état vide sans série');
    expect(bandeau()).not.toBeNull();
    await toucher(bouton('Créer la saison', conteneur));
    expect(onglets).toEqual(['ferme']);
    expect(etapes.prendreDemande('saisons')).toBe('saisons');
  });

  it('saison et planches prêtes : « Planifier une série » mène à Planches, formulaire demandé', async () => {
    recevoirSaison();
    recevoirPlanche();
    await rendreJour();
    await attendre(() => aBouton('Planifier une série', conteneur), 'bouton vers la série');
    await toucher(bouton('Planifier une série', conteneur));
    expect(onglets).toEqual(['planches']);
    expect(etapes.prendreDemande('serie')).toBe('serie');
  });

  it('une étape du bandeau mène à son onglet (itinéraires → Ferme)', async () => {
    await rendreJour();
    await attendre(() => etape('itineraires') !== null, 'bandeau');
    const e = etape('itineraires');
    if (e !== null) await toucher(e);
    expect(onglets).toEqual(['ferme']);
    expect(etapes.prendreDemande('itineraires')).toBe('itineraires');
  });
});

describe('T49 : onglet Ferme — la demande ouvre l’écran qui fait l’étape', () => {
  const SESSION: SessionConnexion = { utilisateurId: UTILISATEUR, email: 't@ferme.fr', jetonAcces: 'a.b.c', jetonRenouvellement: 'r'.repeat(43) };
  const POIGNEE: PoigneeDonnees = { compterEnAttente: () => Promise.resolve(0), fermer: () => Promise.resolve() };
  const rendreFerme = () =>
    rendre(
      createElement(
        ContexteFerme,
        { value: { porte: b.porte, fermeId: FERME } },
        createElement(ferme.default, { session: SESSION, baseLocale: POIGNEE, surDeconnecte: () => undefined, etatBase: 'prete' }),
      ),
    );

  it('« saisons » : « Ma ferme » s’ouvre ; la ligne « Saisons, zones et planches » l’ouvre aussi', async () => {
    etapes.demander('saisons');
    await rendreFerme();
    await attendre(() => dialogue('Ma ferme') !== undefined, '« Ma ferme » ouvert par la demande', 2000);
    expect(etapes.prendreDemande('saisons')).toBeNull();
    const fermer = [...(dialogue('Ma ferme')?.querySelectorAll('button') ?? [])].find((x) => (x.getAttribute('aria-label') ?? x.textContent).trim() === 'Fermer');
    if (fermer !== undefined) await toucher(fermer);
    await attendre(() => dialogue('Ma ferme') === undefined, 'fermé');
    await toucher(bouton('Saisons, zones et planches', conteneur));
    await attendre(() => dialogue('Ma ferme') !== undefined, '« Ma ferme » ouvert par la ligne', 2000);
  });

  it('« itineraires » : « Mes itinéraires » s’ouvre', async () => {
    etapes.demander('itineraires');
    await rendreFerme();
    await attendre(() => dialogue('Mes itinéraires') !== undefined, '« Mes itinéraires » ouvert par la demande', 2000);
  });

  it('« import » : « Importer un tableur » s’ouvre', async () => {
    etapes.demander('import');
    await rendreFerme();
    await attendre(() => dialogue('Importer un tableur') !== undefined, 'import ouvert par la demande', 2000);
  });
});
