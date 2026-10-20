// @vitest-environment happy-dom
/**
 * Tests d'acceptation T51 — une série de fraises hors-sol sur des gouttières, nombre de plants
 * calculé (docs/backlog/T51-hors-sol-pains.md, règles 3 et 5). Même banc que ./ecran.test.tsx
 * (ferme du plan, aujourd'hui = 2026-09-30), plus deux gouttières G1 et G2 de 30 pains dans la
 * serre et l'itinéraire « Fraise en gouttière » (plant acheté, 12 trous par pain).
 *
 * ── Contrat (en plus de ./test/contrat.ts) ──────────────────────────────────────────────────
 *
 * Itinéraire en contenants : le formulaire propose les GOUTTIÈRES (liste « Ajouter une
 * gouttière »), pas les planches. Chaque gouttière choisie a son champ « Pains <code> »
 * (clavier numérique), proposé à son nombre de pains. Les besoins (data-testid="besoin") sont
 * ceux du cœur pour Σ pains : `plants` = Σ pains × trous × plants par trou, affiché « N plants ».
 * Enregistré : la série porte `nombre_plants` (plants calculés) et pas de longueur ; chaque
 * occupation `nombre_places` = pains occupés, `longueur_m` nul ; lignes conformes aux règles du
 * serveur (validerSerie, validerOccupation).
 * Itinéraire en contenants sur une planche : rien d'enregistrable, message clair qui dit
 * « gouttière » (verifierDensiteSurEmplacement du cœur).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DepartSerie, ModuleSerie } from './test/contrat.ts';
import { EMPLACEMENT, ESPECE, FERME, SAISON, ZONE } from './test/ferme-serie.ts';
import {
  aChamp,
  attendre,
  AUJOURDHUI,
  bouton,
  champ,
  creerBanc,
  desactive,
  dialogue,
  dialogueOuEchec,
  liste,
  MAINTENANT,
  occupationsDe,
  occupationsValides,
  remplir,
  serieValide,
  series,
  texte,
  toucher,
  type Banc,
} from './test/outils.ts';

const CHEMIN_SERIE = './index.ts';
let module: ModuleSerie;

beforeAll(async () => {
  module = (await import(/* @vite-ignore */ CHEMIN_SERIE)) as ModuleSerie;
});

const id = (n: number) => `0192f0c1-5151-7000-8000-${n.toString(16).padStart(12, '0')}`;
const G1 = id(1);
const G2 = id(2);
const ITINERAIRE_FRAISE = id(3);
const CREE = '2025-01-01T08:00:00.000Z';
const FRAISE = {
  mode: 'plant_achete',
  densite: { facon: 'contenants', trousParContenant: 12 },
  periodeUsage: null,
  typeAbri: 'hors_sol',
  dureeAvantRecolteJours: 60,
  fenetreRecolteJours: 70,
  margeSecurite: 0,
  rendementAttendu: null,
  perenne: null,
};

let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;
let fermetures = 0;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  for (const [g, code] of [
    [G1, 'G1'],
    [G2, 'G2'],
  ] as const) {
    await b.base.execute(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, nombre_pains, nombre_places, actif_du, actif_au, remplace, cree_le, modifie_le, supprime_le)
       VALUES (?, ?, ?, ?, 'gouttiere', 30, 0.3, 30, NULL, '2020-01-01', NULL, '[]', ?, ?, NULL)`,
      [g, FERME, ZONE.serre, code, CREE, CREE],
    );
  }
  await b.base.execute(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, NULL, 'Fraise en gouttière', 'plant_achete', ?, ?, ?, NULL)`,
    [ITINERAIRE_FRAISE, FERME, ESPECE.fraise, JSON.stringify(FRAISE), CREE, CREE],
  );
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
  fermetures = 0;
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  b.base.fermer();
});

const NOM = 'Nouvelle série';
const formulaire = (): HTMLElement => dialogueOuEchec(NOM);

async function ouvrirEtChoisirFraise(emplacementId: string): Promise<void> {
  const depart: DepartSerie = { sorte: 'creation', emplacementId, semaine: '2027-W06', saisonId: SAISON.s2027 };
  await act(async () => {
    racine.render(
      <module.FormulaireSerie
        porte={b.porte}
        fermeId={FERME}
        depart={depart}
        surFermer={() => {
          fermetures++;
        }}
        aujourdhui={() => AUJOURDHUI}
        maintenant={() => MAINTENANT}
      />,
    );
    await Promise.resolve();
  });
  await attendre(() => dialogue(NOM) !== undefined, 'formulaire');
  await attendre(() => aChamp('Culture', formulaire()), 'champ « Culture »');
  await remplir(champ('Culture', formulaire()), 'fraise');
  const choix = () => [...formulaire().querySelectorAll<HTMLElement>('[data-testid="choix-culture"]')].find((c) => c.dataset.espece === ESPECE.fraise && (c.dataset.variete ?? '') === '');
  await attendre(() => choix() !== undefined, 'choix « Fraise »');
  const c = choix();
  if (c === undefined) return;
  await toucher(c);
  await attendre(() => liste('Itinéraire', formulaire()).value === ITINERAIRE_FRAISE, 'itinéraire en gouttière choisi');
}

function besoins(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const el of formulaire().querySelectorAll<HTMLElement>('[data-testid="besoin"]')) r[el.dataset.cle ?? '?'] = Number(el.dataset.valeur);
  return r;
}

const nouvelles = () => series(b).filter((s) => s.cree_le !== CREE && s.espece_id === ESPECE.fraise);

describe('T51 : série de fraises sur des gouttières', () => {
  it('G1 (30 pains × 12 trous) : 360 plants ; G2 ajoutée : 720 plants ; G2 à 20 pains : 600', async () => {
    await ouvrirEtChoisirFraise(G1);
    const pains = champ('Pains G1', formulaire());
    expect(pains.value).toBe('30');
    expect(pains.getAttribute('inputmode')).toBe('numeric');
    await attendre(() => besoins().plants === 360, `360 plants (affichés : ${JSON.stringify(besoins())})`);
    expect(texte(formulaire().querySelector('[data-testid="besoins-serie"]'))).toMatch(/360 plants/);

    await remplir(liste('Ajouter une gouttière', formulaire()), G2);
    await attendre(() => besoins().plants === 720, `720 plants (affichés : ${JSON.stringify(besoins())})`);
    expect(texte(formulaire().querySelector('[data-testid="besoins-serie"]'))).toMatch(/720 plants/);

    await remplir(champ('Pains G2', formulaire()), '20');
    await attendre(() => besoins().plants === 600, `600 plants (affichés : ${JSON.stringify(besoins())})`);
  });

  it('les planches ne sont pas proposées pour un itinéraire en contenants', async () => {
    await ouvrirEtChoisirFraise(G1);
    const proposees = [...liste('Ajouter une gouttière', formulaire()).options].map((o) => o.value).filter((v) => v !== '');
    expect(proposees).toEqual([G2]);
  });

  it('enregistrée : nombre de plants calculé sur la série, pains sur chaque occupation, conformes aux règles du serveur', async () => {
    await ouvrirEtChoisirFraise(G1);
    await remplir(liste('Ajouter une gouttière', formulaire()), G2);
    await attendre(() => besoins().plants === 720, '720 plants');
    await toucher(bouton(/^(Planifier la série|Enregistrer)$/, formulaire()));
    await attendre(() => nouvelles().length === 1, 'série écrite');
    const s = nouvelles()[0];
    if (s === undefined) return;
    expect(s).toMatchObject({ itineraire_id: ITINERAIRE_FRAISE, nombre_plants: 720, longueur_m: null });
    serieValide(s);
    const occ = occupationsDe(b, String(s.id));
    expect(occ.map((o) => [o.emplacement_id, o.nombre_places, o.longueur_m]).sort()).toEqual(
      [
        [G1, 30, null],
        [G2, 30, null],
      ].sort(),
    );
    occupationsValides(b, String(s.id));
    expect(fermetures).toBe(1);
  });

  it('itinéraire en contenants sur une planche : rien d’enregistrable, message qui dit « gouttière »', async () => {
    await ouvrirEtChoisirFraise(EMPLACEMENT.t2p01);
    await attendre(() => /trous par pain[^.]*gouttière/i.test(texte(formulaire())), 'message « … trous par pain … gouttière »');
    expect(desactive(bouton(/^(Planifier la série|Enregistrer)$/, formulaire()))).toBe(true);
  });
});
