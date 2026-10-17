// @vitest-environment happy-dom
/**
 * Tests d'acceptation T41, écran — « Adapter pour ma ferme » un itinéraire de la bibliothèque de
 * départ (docs/backlog/T41-bibliotheque-depart.md). En plus de ./ecran.test.tsx (T24), qui reste
 * valable : « Adapter » ouvre le formulaire en création sur la copie, l'enregistrement l'écrit
 * (une transaction, annulable par le bandeau).
 *
 * Ce que T41 ajoute :
 *   - la copie garde EXACTEMENT les paramètres de la bibliothèque (plant acheté, rendement par
 *     plant, rangs en quinconce : un itinéraire du JSON de départ, tel que la migration le range) ;
 *   - l'espèce de la copie est celle de la FERME quand la ferme a personnalisé l'espèce de la
 *     bibliothèque (T32g : copie de même nom), sinon l'espèce de la bibliothèque ;
 *   - la copie se modifie ensuite comme tout itinéraire de la ferme ; la ligne de la bibliothèque
 *     n'est jamais écrite.
 *
 * Rendu dans un DOM simulé (happy-dom), sur la ferme des itinéraires (./test/ferme-itineraires.ts)
 * complétée de lignes de la bibliothèque de départ (ferme_id nul) reçues comme par la synchro.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FERME } from './test/ferme-itineraires.ts';
import { bandeau, elementItineraire, enregistrer, formulaire, formulaireOuvert, harnais, ouvrirFormulaire } from './test/harnais.ts';
import {
  attendre,
  bouton,
  champ,
  etat,
  ISO,
  itineraire,
  itineraireValide,
  itinerairesDeLaFerme,
  MOTIF_UUID_V7,
  nomAccessible,
  parametresDe,
  remplir,
  texte,
  toucher,
  type Ligne,
} from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

/** Lignes reçues de la bibliothèque (identifiants fixes, dans la forme de ceux de la migration 0032). */
const CREE_LE_BIBLIOTHEQUE = '2026-10-17T00:00:00.000Z';
const SOLANACEES = 'f2a0d6c3-1c55-6a3c-58e9-41a3f1c0b001';
const TOMATE_BIBLIOTHEQUE = 'a9e1c0e4-5b6f-3f7c-9d1e-41a3f1c0b002';
const TOMATE_SERRE = 'c3b7e2d1-0a9f-4e8d-b7c6-41a3f1c0b003';
const NOM_TOMATE_SERRE = 'Tomate sous serre, plant greffé deux têtes';
/** Copie de l'espèce faite par la ferme (T32g : même nom, famille de la bibliothèque). */
const TOMATE_FERME = '0192f0c1-4141-7000-8000-000000000010';

/** « Tomate sous serre, plant greffé deux têtes » du JSON de départ, converti (packages/db/src/bibliotheque.ts). */
const PARAMETRES_TOMATE = {
  mode: 'plant_achete',
  periodeUsage: { semaineDebut: 12, semaineFin: 16 },
  typeAbri: 'serre',
  dureeAvantRecolteJours: 70,
  fenetreRecolteJours: 110,
  margeSecurite: 10,
  rendementAttendu: { par: 'plant', quantite: 8, unite: 'kg' },
  perenne: null,
  densite: { facon: 'ecartement', rangsParPlanche: 1, ecartementSurRangCm: 50 },
} as const;

const ADAPTER = /^Adapter pour ma ferme/;

function recevoir(sql: string, p: readonly unknown[]): void {
  b().base.recevoir(sql, p);
}

function recevoirBibliotheque(): void {
  recevoir(
    `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans, cree_le, modifie_le, supprime_le)
     VALUES (?, NULL, 'Solanacées', 3, 4, ?, ?, NULL)`,
    [SOLANACEES, CREE_LE_BIBLIOTHEQUE, CREE_LE_BIBLIOTHEQUE],
  );
  recevoir(
    `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance, cree_le, modifie_le, supprime_le)
     VALUES (?, NULL, ?, 'tomate', 'legume', 0, 'kg', NULL, NULL, NULL, ?, ?, NULL)`,
    [TOMATE_BIBLIOTHEQUE, SOLANACEES, CREE_LE_BIBLIOTHEQUE, CREE_LE_BIBLIOTHEQUE],
  );
  recevoir(
    `INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres, cree_le, modifie_le, supprime_le)
     VALUES (?, NULL, ?, NULL, ?, 'plant_achete', ?, ?, ?, NULL)`,
    [TOMATE_SERRE, TOMATE_BIBLIOTHEQUE, NOM_TOMATE_SERRE, JSON.stringify(PARAMETRES_TOMATE), CREE_LE_BIBLIOTHEQUE, CREE_LE_BIBLIOTHEQUE],
  );
}

function recevoirTomateDeLaFerme(): void {
  recevoir(
    `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance, cree_le, modifie_le, supprime_le)
     VALUES (?, ?, ?, 'tomate', 'legume', 0, 'kg', NULL, NULL, NULL, ?, ?, NULL)`,
    [TOMATE_FERME, FERME, SOLANACEES, CREE_LE_BIBLIOTHEQUE, CREE_LE_BIBLIOTHEQUE],
  );
}

/** Les itinéraires de la ferme qui n'existaient pas avant. */
function copies(avant: readonly Ligne[]): Ligne[] {
  const connus = new Set(avant.map((l) => String(l.id)));
  return itinerairesDeLaFerme(b()).filter((l) => !connus.has(String(l.id)));
}

/** Adapter la tomate sous serre et enregistrer sans rien changer ; rend la copie écrite. */
async function adapterEtEnregistrer(): Promise<Ligne> {
  const avant = itinerairesDeLaFerme(b());
  b().remiseAZero();
  const f = await ouvrirFormulaire(TOMATE_SERRE, ADAPTER);
  expect(nomAccessible(f)).toBe('Nouvel itinéraire');
  expect(b().transactions(), 'adapter ouvre le formulaire, sans écrire').toBe(0);
  await enregistrer();
  await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé après l’enregistrement');
  expect(b().transactions(), 'une saisie = une transaction').toBe(1);
  const nouvelles = copies(avant);
  expect(nouvelles, 'exactement une copie écrite').toHaveLength(1);
  const c = nouvelles[0];
  if (c === undefined) throw new Error('aucune copie');
  return c;
}

beforeEach(() => {
  recevoirBibliotheque();
});

describe('T41 : « Adapter pour ma ferme » un itinéraire de la bibliothèque de départ', () => {
  it('espèce de la bibliothèque non personnalisée : copie de la ferme, mêmes paramètres, sur l’espèce de la bibliothèque ; la bibliothèque reste intacte', async () => {
    await h.ouvrir();
    await attendre(() => elementItineraire(TOMATE_SERRE) !== null, 'itinéraire de la bibliothèque affiché');
    expect(elementItineraire(TOMATE_SERRE)?.dataset.origine).toBe('bibliotheque');
    const bibliothequeAvant = etat(itineraire(b(), TOMATE_SERRE));

    const c = await adapterEtEnregistrer();
    expect(String(c.id)).toMatch(MOTIF_UUID_V7);
    expect(c).toMatchObject({ ferme_id: FERME, espece_id: TOMATE_BIBLIOTHEQUE, variete_id: null, mode: 'plant_achete', cree_le: ISO, supprime_le: null });
    expect(c.nom).toBe(`${NOM_TOMATE_SERRE} (ma ferme)`);
    expect(parametresDe(c), 'les paramètres de la bibliothèque, recopiés tels quels').toEqual(PARAMETRES_TOMATE);
    itineraireValide(b(), c);
    expect(etat(itineraire(b(), TOMATE_SERRE)), 'la bibliothèque n’est jamais écrite').toEqual(bibliothequeAvant);

    await attendre(() => elementItineraire(String(c.id)) !== null, 'la copie est dans la liste');
    expect(elementItineraire(String(c.id))?.dataset.origine).toBe('ferme');
    expect(elementItineraire(TOMATE_SERRE)?.dataset.origine, 'l’itinéraire de la bibliothèque reste affiché').toBe('bibliotheque');
  });

  it('espèce personnalisée par la ferme (T32g) : la copie est rattachée à l’espèce de la ferme', async () => {
    recevoirTomateDeLaFerme();
    await h.ouvrir();
    await attendre(() => elementItineraire(TOMATE_SERRE) !== null, 'itinéraire de la bibliothèque affiché');
    const bibliothequeAvant = etat(itineraire(b(), TOMATE_SERRE));
    const especeBibliothequeAvant = etat(b().base.lireDirect<Ligne>('SELECT * FROM espece WHERE id = ?', [TOMATE_BIBLIOTHEQUE])[0]);

    const c = await adapterEtEnregistrer();
    expect(c).toMatchObject({ ferme_id: FERME, espece_id: TOMATE_FERME, variete_id: null, mode: 'plant_achete' });
    expect(parametresDe(c)).toEqual(PARAMETRES_TOMATE);
    itineraireValide(b(), c);
    expect(etat(itineraire(b(), TOMATE_SERRE))).toEqual(bibliothequeAvant);
    expect(etat(b().base.lireDirect<Ligne>('SELECT * FROM espece WHERE id = ?', [TOMATE_BIBLIOTHEQUE])[0])).toEqual(especeBibliothequeAvant);
  });

  it('la copie se modifie ensuite comme un itinéraire de la ferme ; la bibliothèque ne bouge toujours pas', async () => {
    await h.ouvrir();
    await attendre(() => elementItineraire(TOMATE_SERRE) !== null, 'itinéraire de la bibliothèque affiché');
    const bibliothequeAvant = etat(itineraire(b(), TOMATE_SERRE));
    const c = await adapterEtEnregistrer();
    await attendre(() => elementItineraire(String(c.id)) !== null, 'la copie est dans la liste');

    b().remiseAZero();
    const f = await ouvrirFormulaire(String(c.id), /^Modifier/);
    expect(nomAccessible(f)).toMatch(/^Modifier l.itinéraire$/);
    expect(texte(f.querySelector('[data-testid="culture-itineraire"]'))).toMatch(/tomate/i);
    await remplir(champ('Avant récolte (jours)', formulaire()), '75');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé après la modification');
    expect(b().transactions()).toBe(1);
    const apres = itineraire(b(), String(c.id));
    expect(parametresDe(apres)).toEqual({ ...PARAMETRES_TOMATE, dureeAvantRecolteJours: 75 });
    itineraireValide(b(), apres);
    expect(etat(itineraire(b(), TOMATE_SERRE))).toEqual(bibliothequeAvant);
  });

  it('annulable : « Annuler » du bandeau retire la copie (suppression douce), la bibliothèque reste', async () => {
    await h.ouvrir();
    await attendre(() => elementItineraire(TOMATE_SERRE) !== null, 'itinéraire de la bibliothèque affiché');
    const bibliothequeAvant = etat(itineraire(b(), TOMATE_SERRE));
    const c = await adapterEtEnregistrer();
    await attendre(() => bandeau() !== null, 'bandeau « Annuler »');
    await toucher(bouton('Annuler', bandeau() ?? document));
    await attendre(() => itineraire(b(), String(c.id))?.supprime_le !== null, 'copie supprimée en douceur');
    expect(etat(itineraire(b(), TOMATE_SERRE))).toEqual(bibliothequeAvant);
  });
});
