// @vitest-environment happy-dom
/**
 * Tests d'acceptation T43, écran Série — l'instantané d'une série garde l'écart entre rangs de
 * l'itinéraire (docs/backlog/T43-ecart-entre-rangs.md, règle 3). Même banc et même parcours que
 * ./bibliotheque.test.tsx (T41) : une série créée directement depuis un itinéraire de la
 * bibliothèque commune, ici un itinéraire dont la densité porte `ecartEntreRangsCm`. L'instantané
 * écrit est l'itinéraire tel quel, écart entre rangs compris, et passe les règles du serveur.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calculerDatesSerie, type DateCalendaire } from '@planif/core';
import type { ModuleSerie } from './test/contrat.ts';
import { EMPLACEMENT, ESPECE, FERME, SAISON, SERIE_LAITUE } from './test/ferme-serie.ts';
import {
  aChamp,
  attendre,
  AUJOURDHUI,
  bouton,
  champ,
  creerBanc,
  dialogue,
  etat,
  MAINTENANT,
  occupationsDe,
  occupationsValides,
  remplir,
  liste,
  serieValide,
  series,
  toucher,
  verifierOrdres,
  type Banc,
  type Ligne,
} from './test/outils.ts';

const CHEMIN_SERIE = './index.ts';

/** Itinéraire de la bibliothèque commune sur la Mâche (ferme_id nul). */
const MACHE_BIBLIOTHEQUE = '7d3e1f20-9a4b-4c5d-8e6f-41a3f1c0b0a3';
const NOM_MACHE = 'Mâche d’automne, mottes multigraines';
const PARAMETRES_MACHE = {
  mode: 'plant_maison',
  periodeUsage: { semaineDebut: 10, semaineFin: 20 },
  typeAbri: 'tunnel',
  dureePepiniereJours: 28,
  grainesParMotte: 4,
  plantsParMotte: 3,
  pertePepiniere: 10,
  alveolesParPlaque: 104,
  dureeAvantRecolteJours: 45,
  fenetreRecolteJours: 21,
  margeSecurite: 15,
  rendementAttendu: { par: 'metre', quantite: 1.2, unite: 'kg' },
  perenne: null,
  densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 15, disposition: 'quinconce', ecartEntreRangsCm: 18 },
} as const;

let module: ModuleSerie;
let b: Banc;
let conteneur: HTMLDivElement;
let racine: Root;
let fermetures = 0;

beforeAll(async () => {
  module = (await import(/* @vite-ignore */ CHEMIN_SERIE)) as ModuleSerie;
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  b = await creerBanc();
  b.base.recevoir(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
     VALUES (?, NULL, ?, NULL, ?, 'plant_maison', ?, '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z', NULL)`,
    [MACHE_BIBLIOTHEQUE, ESPECE.mache, NOM_MACHE, JSON.stringify(PARAMETRES_MACHE)],
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

const formulaire = (): HTMLElement => {
  const d = dialogue('Nouvelle série');
  if (d === undefined) throw new Error('formulaire fermé');
  return d;
};

describe('T43 : l’instantané de la série garde l’écart entre rangs', () => {
  it('Mâche de la bibliothèque, rangs à 18 cm, plantée en S14 : l’instantané garde ecartEntreRangsCm, règles du serveur', async () => {
    const bibliothequeAvant = etat(b.base.lireDirect<Ligne>('SELECT * FROM itineraire WHERE id = ?', [MACHE_BIBLIOTHEQUE])[0]);
    await act(async () => {
      racine.render(
        <module.FormulaireSerie
          porte={b.porte}
          fermeId={FERME}
          depart={{ sorte: 'creation', emplacementId: EMPLACEMENT.t2p01, semaine: '2027-W14', saisonId: SAISON.s2027 }}
          surFermer={() => {
            fermetures++;
          }}
          aujourdhui={() => AUJOURDHUI}
          maintenant={() => MAINTENANT}
        />,
      );
      await Promise.resolve();
    });
    await attendre(() => dialogue('Nouvelle série') !== undefined && aChamp('Culture', formulaire()), 'formulaire de création');

    await remplir(champ('Culture', formulaire()), 'mache');
    const choix = () => formulaire().querySelector<HTMLElement>(`[data-testid="choix-culture"][data-espece="${ESPECE.mache}"]`);
    await attendre(() => choix() !== null, 'Mâche proposée');
    const c = choix();
    if (c === null) return;
    await toucher(c);
    await attendre(() => formulaire().querySelector('[data-testid="culture-choisie"]') !== null, 'culture choisie');

    const it = liste('Itinéraire', formulaire());
    expect(it.value, 'S14 : l’itinéraire de la bibliothèque est proposé').toBe(MACHE_BIBLIOTHEQUE);

    b.remiseAZero();
    await toucher(bouton(/^(Planifier la série|Enregistrer)$/, formulaire()));
    const nouvelles = (): Ligne[] => series(b).filter((s) => s.id !== SERIE_LAITUE);
    await attendre(() => nouvelles().length === 1, 'la série est écrite');
    await attendre(() => fermetures === 1, 'le formulaire se ferme');
    expect(b.transactions(), 'une saisie = une transaction').toBe(1);

    const s = nouvelles()[0];
    if (s === undefined) return;
    const d = calculerDatesSerie(PARAMETRES_MACHE, { type: 'plantation', date: '2027-04-05' as DateCalendaire });
    expect(s).toMatchObject({
      ferme_id: FERME,
      espece_id: ESPECE.mache,
      variete_id: null,
      itineraire_id: MACHE_BIBLIOTHEQUE,
      ancre_type: 'plantation',
      ancre_date: '2027-04-05',
      prevu_semis_pepiniere: d.semisPepiniere,
      prevu_mise_en_place: d.miseEnPlace,
      prevu_debut_recolte: d.debutRecolte,
      prevu_fin_recolte: d.finRecolte,
      statut: 'prevue',
    });
    expect(JSON.parse(String(s.parametres)), 'instantané fidèle de l’itinéraire de la bibliothèque').toEqual(PARAMETRES_MACHE);
    expect((JSON.parse(String(s.parametres)) as { densite: Record<string, unknown> }).densite.ecartEntreRangsCm, 'écart entre rangs recopié').toBe(18);
    serieValide(s);
    expect(occupationsDe(b, String(s.id))).toHaveLength(1);
    occupationsValides(b, String(s.id));
    verifierOrdres(b);
    expect(etat(b.base.lireDirect<Ligne>('SELECT * FROM itineraire WHERE id = ?', [MACHE_BIBLIOTHEQUE])[0]), 'la bibliothèque n’est pas écrite').toEqual(bibliothequeAvant);
  });
});
