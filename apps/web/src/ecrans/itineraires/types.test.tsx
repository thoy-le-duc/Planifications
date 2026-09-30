// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24 — les types d'intervention de la ferme : ajouter, renommer, masquer
 * (docs/backlog/T24-ecran-itineraires.md ; règles du serveur : T23, décisions 3, 5, 10 et 11 du
 * chef). Un type utilisé ne se renomme pas, il se masque ; libellé normalisé (espaces, NFC) et
 * doublon sans casse refusés AVANT l'envoi ; la liste de départ n'est pas modifiable (décision du
 * chef pour T24). Ferme des itinéraires au 2026-09-30. Contrat : ./test/contrat.ts.
 */
import { describe, expect, it } from 'vitest';
import { FERME, ITINERAIRE, NOMS_ITINERAIRES, TYPE, TYPES_DEPART, typeDepart } from './test/ferme-itineraires.ts';
import { ajouterTravail, bandeau, enregistrer, formulaire, harnais, optionsType, ouvrirFormulaire, travail, travaux } from './test/harnais.ts';
import {
  aBouton,
  attendre,
  bouton,
  boutons,
  champ,
  desactive,
  dialogue,
  dialogueOuEchec,
  etat,
  ISO,
  itineraire,
  itineraireValide,
  liste,
  MOTIF_UUID_V7,
  region,
  remplir,
  texte,
  toucher,
  typeIntervention,
  typesIntervention,
  typeValide,
  unTour,
  verifierOrdres,
  type Ligne,
} from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

const REGION = /^Types d.intervention$/;
const types = (): HTMLElement => region(REGION);

function elementType(id: string): HTMLElement {
  const el = types().querySelector<HTMLElement>(`[data-testid="type-intervention"][data-type="${id}"]`);
  expect(el, `type ${id} dans la liste`).not.toBeNull();
  if (el === null) throw new Error(`type ${id} absent`);
  return el;
}

const connus = new Set<string>([...TYPES_DEPART.map((t) => t.id), ...Object.values(TYPE)]);
const nouveauxTypes = (): Ligne[] => typesIntervention(b()).filter((l) => !connus.has(String(l.id)));

/** Remplit « Catégorie » et « Nouveau type », touche « Ajouter le type ». */
async function ajouterType(categorie: string, libelle: string): Promise<void> {
  const r = types();
  await remplir(liste('Catégorie', r), categorie);
  await remplir(champ('Nouveau type', r), libelle);
  await toucher(bouton('Ajouter le type', r));
}

const alerte = (dans: ParentNode): string => texte(dans.querySelector('[role="alert"]'));

describe('T24 : la liste des types d’intervention', () => {
  it('types de la ferme et de la liste de départ ; masqué, utilisé ; la liste de départ est en lecture seule', async () => {
    await h.ouvrir();
    const r = types();
    const tous = [...r.querySelectorAll<HTMLElement>('[data-testid="type-intervention"]')];
    expect(tous.map((t) => t.dataset.type).sort()).toEqual([...connus].sort());
    for (const t of TYPES_DEPART) {
      const el = elementType(t.id);
      expect(el.dataset.origine).toBe('depart');
      expect(texte(el)).toContain(t.libelle);
      expect(boutons(el).map((x) => x.textContent), `départ « ${t.libelle} » : aucun bouton`).toEqual([]);
    }

    const binette = elementType(TYPE.binette);
    expect(binette.dataset.origine).toBe('ferme');
    expect(binette.dataset.utilise, 'binette : dans les travaux de Batavia de la ferme').toBe('oui');
    expect(binette.dataset.masque).toBe('non');
    expect(texte(binette)).toMatch(/utilisé/i);
    expect(aBouton(/^Renommer/, binette), 'un type utilisé ne se renomme pas').toBe(false);
    expect(aBouton('Masquer binette', binette)).toBe(true);

    const voile = elementType(TYPE.voile);
    expect(voile.dataset.utilise, 'cité par un itinéraire SUPPRIMÉ seulement : pas utilisé').toBe('non');
    expect(aBouton('Renommer voile anti-insectes', voile)).toBe(true);
    expect(aBouton('Masquer voile anti-insectes', voile)).toBe(true);

    const rouleau = elementType(TYPE.rouleau);
    expect(rouleau.dataset.masque).toBe('oui');
    expect(aBouton('Afficher rouleau', rouleau)).toBe(true);
    expect(aBouton('Masquer rouleau', rouleau)).toBe(false);
  });
});

describe('T24 : ajouter un type', () => {
  it('libellé normalisé (NFC, espaces insécables rognés), une transaction, ligne acceptée par validerTypeIntervention ; proposé ensuite dans les travaux', async () => {
    await h.ouvrir();
    b().remiseAZero();
    // « écimage » avec un « e » + accent combinant (NFD), entouré d'espaces insécables.
    await ajouterType('entretien', ' écimage  ');
    await attendre(() => b().transactions() === 1, 'type ajouté en une transaction');
    verifierOrdres(b());
    const n = nouveauxTypes();
    expect(n).toHaveLength(1);
    const l = n[0];
    expect(String(l?.id)).toMatch(MOTIF_UUID_V7);
    expect(l?.ferme_id).toBe(FERME);
    expect(l?.categorie).toBe('entretien');
    expect(l?.libelle, 'NFC et rogné').toBe('écimage');
    expect(l?.masque).toBe(0);
    expect(l?.cree_le).toBe(ISO);
    expect(l?.supprime_le).toBeNull();
    typeValide(l);
    await attendre(() => types().querySelector(`[data-type="${String(l?.id)}"]`) !== null, 'le nouveau type est dans la liste');
    expect(texte(bandeau())).toContain('écimage');

    await ouvrirFormulaire(ITINERAIRE.chouAutomne, `Modifier ${NOMS_ITINERAIRES.chouAutomne}`);
    await toucher(bouton('Ajouter un travail', formulaire()));
    await attendre(() => travaux().length === 1, 'un travail');
    expect(optionsType(travail(0)).map((o) => o.value)).toContain(String(l?.id));
  });

  it('doublon sans tenir compte de la casse, dans la même catégorie (départ, ferme, masqué compris) : refusé avant l’envoi, message clair', async () => {
    await h.ouvrir();
    b().remiseAZero();
    for (const [categorie, libelle] of [
      ['travail_sol', ' Grelinette'],
      ['entretien', 'BINETTE'],
      ['travail_sol', 'Rouleau'],
      ['couverture', 'Voile Anti-Insectes'],
    ] as const) {
      await ajouterType(categorie, libelle);
      await attendre(() => alerte(types()).includes('existe déjà'), `« ${libelle} » (${categorie}) : message « existe déjà » (vu : « ${alerte(types())} »)`);
      await unTour();
      expect(b().transactions(), `« ${libelle} » (${categorie}) : rien n’est envoyé`).toBe(0);
    }
    await unTour();
    expect(b().transactions(), 'rien n’est envoyé').toBe(0);
    expect(nouveauxTypes()).toEqual([]);

    // Même libellé, autre catégorie : accepté.
    await ajouterType('entretien', 'grelinette');
    await attendre(() => b().transactions() === 1, 'autre catégorie : ajouté');
    expect(nouveauxTypes().map((l) => [l.categorie, l.libelle])).toEqual([['entretien', 'grelinette']]);
  });

  it('caractère de largeur nulle, libellé trop long ou vide : refusés sans rien écrire', async () => {
    await h.ouvrir();
    b().remiseAZero();
    await ajouterType('entretien', 'bi​nage');
    await attendre(() => /caractère/i.test(alerte(types())), `largeur nulle : message « caractère » (vu : « ${alerte(types())} »)`);
    await ajouterType('entretien', 'x'.repeat(31));
    await attendre(() => alerte(types()).includes('30'), `31 caractères : message qui dit 30 (vu : « ${alerte(types())} »)`);
    await remplir(champ('Nouveau type', types()), '   ');
    expect(desactive(bouton('Ajouter le type', types())), 'vide : bouton désactivé').toBe(true);
    await unTour();
    expect(b().transactions()).toBe(0);
    expect(nouveauxTypes()).toEqual([]);
  });

  it('annuler un ajout : suppression douce, une transaction', async () => {
    await h.ouvrir();
    await ajouterType('couverture', 'bâche tissée');
    await attendre(() => bandeau() !== null && nouveauxTypes().length === 1, 'ajouté, bandeau');
    const id = String(nouveauxTypes()[0]?.id);
    b().remiseAZero();
    await toucher(bouton('Annuler', bandeau() ?? document));
    await attendre(() => b().transactions() === 1, 'annulé');
    verifierOrdres(b());
    expect(typeIntervention(b(), id)?.supprime_le).toBe(ISO);
    typeValide(typeIntervention(b(), id));
    await attendre(() => types().querySelector(`[data-type="${id}"]`) === null, 'le type annulé quitte la liste');
  });
});

describe('T24 : renommer un type', () => {
  it('type non utilisé : UPDATE du libellé normalisé, une transaction', async () => {
    await h.ouvrir();
    await toucher(bouton('Renommer voile anti-insectes', elementType(TYPE.voile)));
    const d = dialogueOuEchec(/^Renommer/);
    expect(champ('Libellé', d).value).toBe('voile anti-insectes');
    await remplir(champ('Libellé', d), ' filet anti-insectes ');
    b().remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => b().transactions() === 1, 'renommé');
    verifierOrdres(b());
    const l = typeIntervention(b(), TYPE.voile);
    expect(l?.libelle).toBe('filet anti-insectes');
    expect(l?.categorie).toBe('couverture');
    expect(l?.modifie_le).toBe(ISO);
    typeValide(l);
    await attendre(() => dialogue(/^Renommer/) === undefined, 'dialogue fermé');
  });

  it('renommer en doublon (sans casse) d’un type de départ : refusé avant l’envoi, le dialogue reste ouvert', async () => {
    await h.ouvrir();
    await toucher(bouton('Renommer voile anti-insectes', elementType(TYPE.voile)));
    const d = dialogueOuEchec(/^Renommer/);
    await remplir(champ('Libellé', d), 'PAILLAGE');
    b().remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => alerte(d).includes('existe déjà'), `message « existe déjà » (vu : « ${alerte(d)} »)`);
    await unTour();
    expect(b().transactions()).toBe(0);
    expect(typeIntervention(b(), TYPE.voile)?.libelle).toBe('voile anti-insectes');
    expect(dialogue(/^Renommer/)).toBeDefined();
  });

  it('changer la casse de son propre libellé n’est pas un doublon', async () => {
    await h.ouvrir();
    await toucher(bouton('Renommer voile anti-insectes', elementType(TYPE.voile)));
    const d = dialogueOuEchec(/^Renommer/);
    await remplir(champ('Libellé', d), 'Voile anti-insectes');
    b().remiseAZero();
    await toucher(bouton('Enregistrer', d));
    await attendre(() => b().transactions() === 1, 'renommé');
    expect(typeIntervention(b(), TYPE.voile)?.libelle).toBe('Voile anti-insectes');
  });
});

describe('T24 : masquer un type (un type utilisé se masque)', () => {
  it('masquer « binette » (utilisé) : UPDATE masque 1 ; il quitte les nouveaux travaux mais reste sur le travail qui l’a ; l’itinéraire s’enregistre toujours', async () => {
    await h.ouvrir();
    b().remiseAZero();
    await toucher(bouton('Masquer binette', elementType(TYPE.binette)));
    await attendre(() => b().transactions() === 1, 'masqué en une transaction');
    verifierOrdres(b());
    const l = typeIntervention(b(), TYPE.binette);
    expect(l?.masque).toBe(1);
    expect(l?.libelle).toBe('binette');
    expect(l?.supprime_le).toBeNull();
    typeValide(l);
    await attendre(() => elementType(TYPE.binette).dataset.masque === 'oui', 'affiché masqué');
    expect(aBouton('Afficher binette', elementType(TYPE.binette))).toBe(true);

    await ouvrirFormulaire(ITINERAIRE.bataviaFerme, `Modifier ${NOMS_ITINERAIRES.bataviaFerme}`);
    expect(liste('Type', travail(1)).value, 'le travail existant garde son type masqué').toBe(TYPE.binette);
    await ajouterTravail({ categorie: 'travail_sol', libelle: 'grelinette', jours: 10, sens: 'avant', repere: 'mise_en_place' });
    expect(optionsType(travail(2)).map((o) => o.value), 'un type masqué n’est plus proposé').not.toContain(TYPE.binette);
    b().remiseAZero();
    await enregistrer();
    await attendre(() => dialogue(/^Appliquer/) !== undefined, 'confirmation des séries à venir');
    await toucher(bouton('Itinéraire seul', dialogue(/^Appliquer/)));
    await attendre(() => b().transactions() === 1, 'itinéraire enregistré');
    itineraireValide(b(), itineraire(b(), ITINERAIRE.bataviaFerme));
  });

  it('« Afficher » un type masqué : masque 0 ; annuler un masquage le rétablit', async () => {
    await h.ouvrir();
    b().remiseAZero();
    await toucher(bouton('Afficher rouleau', elementType(TYPE.rouleau)));
    await attendre(() => b().transactions() === 1, 'affiché');
    expect(typeIntervention(b(), TYPE.rouleau)?.masque).toBe(0);

    const avant = etat(typeIntervention(b(), TYPE.voile));
    await attendre(() => aBouton('Masquer voile anti-insectes', elementType(TYPE.voile)), 'bouton « Masquer »');
    await toucher(bouton('Masquer voile anti-insectes', elementType(TYPE.voile)));
    await attendre(() => typeIntervention(b(), TYPE.voile)?.masque === 1, 'masqué');
    await attendre(() => bandeau() !== null, 'bandeau');
    b().remiseAZero();
    await toucher(bouton('Annuler', bandeau() ?? document));
    await attendre(() => b().transactions() === 1, 'annulé');
    verifierOrdres(b());
    expect(etat(typeIntervention(b(), TYPE.voile))).toEqual(avant);
    expect(typeIntervention(b(), typeDepart('entretien', 'désherbage'))?.ferme_id, 'la liste de départ n’est jamais écrite').toBeNull();
  });
});
