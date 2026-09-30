// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24 — la liste des itinéraires, le formulaire d'un itinéraire, son aperçu
 * en direct et ses écritures, rendus pour de vrai dans un DOM simulé (happy-dom), sur la ferme des
 * itinéraires (./test/ferme-itineraires.ts, aujourd'hui = 2026-09-30) lue et écrite par la porte
 * (base mémoire de @planif/sync). Contrat : ./test/contrat.ts. Séries à venir : ./series.test.tsx ;
 * types d'intervention : ./types.test.tsx ; mise en page, temps et hors-ligne :
 * apps/web/e2e/itineraires.e2e.ts.
 */
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { datesTravailPrevu, validerTravauxPrevus, type DatesSerie, type TravailPrevu } from '@planif/core';
import { DELAI_ANNULATION_ITINERAIRE_MS, MARQUE_ITINERAIRES_AFFICHES_ATTENDUE, MARQUE_ITINERAIRE_AFFICHE_ATTENDUE } from './test/contrat.ts';
import { ESPECE, FERME, ITINERAIRE, NOMS_ITINERAIRES, PARAMETRES, TYPE, TYPES_DEPART, typeDepart } from './test/ferme-itineraires.ts';
import {
  ajouterTravail,
  bandeau,
  choisirType,
  datesApercu,
  elementItineraire,
  enregistrer,
  etapesApercu,
  formulaire,
  formulaireOuvert,
  harnais,
  itineraireOuEchec,
  laisserFiler,
  NOM_FORMULAIRE,
  optionsType,
  ouvrirFormulaire,
  travail,
  travaux,
} from './test/harnais.ts';
import {
  aBouton,
  aChamp,
  attendre,
  bouton,
  boutons,
  champ,
  coche,
  desactive,
  dialogue,
  dialogues,
  etat,
  ISO,
  itineraire,
  itineraireValide,
  itineraires,
  itinerairesDeLaFerme,
  liste,
  MOTIF_UUID_V7,
  nomAccessible,
  parametresDe,
  radio,
  region,
  remplir,
  texte,
  toucher,
  unTour,
  verifierOrdres,
} from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

const MODIFIER = (id: keyof typeof ITINERAIRE) => `Modifier ${NOMS_ITINERAIRES[id]}`;
const VOIR = (id: keyof typeof ITINERAIRE) => `Voir ${NOMS_ITINERAIRES[id]}`;
const ADAPTER = /^Adapter pour ma ferme/;

/** Travail prévu normalisé (clés facultatives à null), comme le range validerTravauxPrevus. */
function normalise(t: Partial<TravailPrevu> & Pick<TravailPrevu, 'categorie' | 'type' | 'repere' | 'decalageJours'>): TravailPrevu {
  return { repetition: null, outil: null, produit: null, tempsEstime: null, ...t };
}

/** Nouvelle ligne `itineraire` de la ferme (création), s'il y en a exactement une. */
function nouvelItineraire(): Readonly<Record<string, string | number | null>> {
  const connus = new Set<string>(Object.values(ITINERAIRE));
  const nouveaux = itinerairesDeLaFerme(b()).filter((l) => !connus.has(String(l.id)));
  expect(nouveaux, 'exactement un itinéraire créé').toHaveLength(1);
  const n = nouveaux[0];
  if (n === undefined) throw new Error('aucun itinéraire créé');
  return n;
}

describe('T24 : la liste des itinéraires, par culture', () => {
  it('écran « Mes itinéraires » : par culture, ceux de la ferme puis ceux de la bibliothèque ; jamais un itinéraire supprimé', async () => {
    const e = await h.ouvrir();
    expect(e.getAttribute('aria-modal')).toBe('true');
    expect(e.dataset.testid).toBe('ecran-itineraires');
    const r = region('Itinéraires', e);
    const cultures = [...r.querySelectorAll<HTMLElement>('[data-testid="culture-itineraires"]')];
    expect(cultures.map((c) => c.dataset.espece), 'Batavia puis Chou ; Radis n’a pas d’itinéraire').toEqual([ESPECE.batavia, ESPECE.chou]);
    expect(texte(cultures[0])).toMatch(/^Batavia/);
    expect(texte(cultures[1])).toMatch(/^Chou/);
    const dans = (c: HTMLElement | undefined) =>
      [...(c?.querySelectorAll<HTMLElement>('[data-testid="itineraire"]') ?? [])].map((i) => [i.dataset.itineraire, i.dataset.origine]);
    expect(dans(cultures[0])).toEqual([
      [ITINERAIRE.bataviaFerme, 'ferme'],
      [ITINERAIRE.batavia, 'bibliotheque'],
    ]);
    expect(dans(cultures[1])).toEqual([[ITINERAIRE.chouAutomne, 'ferme']]);
    expect(elementItineraire(ITINERAIRE.ancien), 'itinéraire supprimé jamais montré').toBeNull();
    expect(texte(itineraireOuEchec(ITINERAIRE.bataviaFerme))).toContain(NOMS_ITINERAIRES.bataviaFerme);
    expect(aBouton('Nouvel itinéraire', r)).toBe(true);
  });

  it('ferme : « Modifier <nom> » ; bibliothèque : « Voir <nom> » et « Adapter pour ma ferme », jamais « Modifier »', async () => {
    await h.ouvrir();
    const ferme = itineraireOuEchec(ITINERAIRE.bataviaFerme);
    expect(aBouton(MODIFIER('bataviaFerme'), ferme)).toBe(true);
    expect(aBouton(ADAPTER, ferme)).toBe(false);
    const bib = itineraireOuEchec(ITINERAIRE.batavia);
    expect(aBouton(VOIR('batavia'), bib)).toBe(true);
    expect(aBouton(ADAPTER, bib)).toBe(true);
    expect(boutons(bib).some((x) => nomAccessible(x).startsWith('Modifier')), 'la bibliothèque ne se modifie pas').toBe(false);
  });

  it('marque de performance posée quand les listes sont dessinées ; « Fermer » appelle surFermer sans rien écrire', async () => {
    performance.clearMarks(MARQUE_ITINERAIRES_AFFICHES_ATTENDUE);
    const e = await h.ouvrir();
    await attendre(() => performance.getEntriesByName(MARQUE_ITINERAIRES_AFFICHES_ATTENDUE, 'mark').length > 0, `marque ${MARQUE_ITINERAIRES_AFFICHES_ATTENDUE}`);
    expect(h.module().MARQUE_ITINERAIRES_AFFICHES).toBe(MARQUE_ITINERAIRES_AFFICHES_ATTENDUE);
    expect(h.module().MARQUE_ITINERAIRE_AFFICHE).toBe(MARQUE_ITINERAIRE_AFFICHE_ATTENDUE);
    b().remiseAZero();
    const fermer = boutons(e).filter((x) => nomAccessible(x) === 'Fermer');
    expect(fermer.length).toBeGreaterThan(0);
    const f = fermer[fermer.length - 1];
    if (f === undefined) return;
    await toucher(f);
    expect(h.fermetures()).toBe(1);
    expect(b().transactions()).toBe(0);
  });
});

describe('T24 : le formulaire d’un itinéraire', () => {
  it('« Voir » un itinéraire de la bibliothèque : lecture seule, sans « Enregistrer », avec « Adapter pour ma ferme »', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.batavia, VOIR('batavia'));
    expect(nomAccessible(f)).toBe('Itinéraire de la bibliothèque');
    expect(f.dataset.testid).toBe('formulaire-itineraire');
    expect(aBouton('Enregistrer', f)).toBe(false);
    const champs = [...f.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')];
    expect(champs.length).toBeGreaterThan(0);
    expect(champs.filter((c) => !c.disabled).map(nomAccessible), 'tous les champs désactivés').toEqual([]);
    expect(aBouton(ADAPTER, f)).toBe(true);
    expect(f.querySelectorAll('[data-testid="apercu-etape"]').length).toBeGreaterThan(0);
  });

  it('« Modifier » : champs préremplis (mode, durées, densité, travaux avec produit, outil et temps), espèce affichée mais pas modifiable', async () => {
    performance.clearMarks(MARQUE_ITINERAIRE_AFFICHE_ATTENDUE);
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER('bataviaFerme'));
    await attendre(() => performance.getEntriesByName(MARQUE_ITINERAIRE_AFFICHE_ATTENDUE, 'mark').length > 0, `marque ${MARQUE_ITINERAIRE_AFFICHE_ATTENDUE}`);
    expect(nomAccessible(f)).toMatch(/^Modifier l.itinéraire$/);
    expect(f.getAttribute('aria-modal')).toBe('true');
    expect(champ('Nom', f).value).toBe(NOMS_ITINERAIRES.bataviaFerme);
    expect(aChamp('Culture', f), 'l’espèce d’un itinéraire ne change pas').toBe(false);
    expect(texte(f.querySelector('[data-testid="culture-itineraire"]'))).toContain('Batavia');
    expect(coche(radio('Plant maison', f))).toBe(true);
    expect(coche(radio('Semis direct', f))).toBe(false);
    expect(coche(radio('Plant acheté', f))).toBe(false);
    expect(champ('Pépinière (jours)', f).value).toBe('28');
    expect(champ('Avant récolte (jours)', f).value).toBe('49');
    expect(champ('Récolte (jours)', f).value).toBe('14');
    expect(champ('Rangs par planche', f).value).toBe('3');
    expect(champ('Écartement sur le rang (cm)', f).value).toBe('30');

    expect(travaux()).toHaveLength(2);
    const compost = travail(0);
    expect(nomAccessible(compost)).toBe('Travail 1');
    expect(compost.getAttribute('role')).toBe('group');
    expect(liste('Type', compost).value).toBe(typeDepart('amendement', 'compost'));
    expect(champ('Jours', compost).value).toBe('15');
    expect(liste('Avant ou après', compost).value).toBe('avant');
    expect(liste('Repère', compost).value).toBe('mise_en_place');
    expect(coche(champ('Répéter', compost))).toBe(false);
    expect(champ('Produit', compost).value).toBe('compost');
    expect(champ('Quantité', compost).value).toBe('2');
    expect(champ('Unité', compost).value).toBe('kg/m²');

    const binette = travail(1);
    expect(liste('Type', binette).value).toBe(TYPE.binette);
    expect(champ('Jours', binette).value).toBe('7');
    expect(liste('Avant ou après', binette).value).toBe('apres');
    expect(champ('Temps estimé (min)', binette).value).toBe('20');
    expect(liste('Par', binette).value).toBe('cent_metres');
    expect(champ('Outil', binette).value).toBe('houe');
    expect(aChamp('Produit', binette), 'pas de produit hors fertilisation et amendement').toBe(false);
  });

  it('types proposés : ceux de la liste de départ et ceux, visibles, de la ferme ; jamais un type masqué', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await toucher(bouton('Ajouter un travail', formulaire()));
    await attendre(() => travaux().length === 1, 'un travail ajouté');
    const g = travail(0);
    expect(liste('Type', g).value, 'nouveau travail : sans type').toBe('');
    const valeurs = optionsType(g).map((o) => o.value).sort();
    const attendues = [...TYPES_DEPART.map((t) => t.id), TYPE.binette, TYPE.voile].sort();
    expect(valeurs).toEqual(attendues);
    const binette = optionsType(g).find((o) => o.value === TYPE.binette);
    expect(binette?.dataset.categorie).toBe('entretien');
    expect(binette?.dataset.libelle).toBe('binette');
    expect(desactive(bouton('Enregistrer', formulaire())), 'un travail sans type empêche d’enregistrer').toBe(true);
  });

  it('repère « semis en pépinière » : proposé en plant maison seulement', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await toucher(bouton('Ajouter un travail', formulaire()));
    await attendre(() => travaux().length === 1, 'un travail ajouté');
    const reperes = (g: HTMLElement) => [...liste('Repère', g).options].map((o) => o.value);
    expect(reperes(travail(0))).toEqual(['mise_en_place', 'debut_recolte', 'fin_recolte']);
    await toucher(radio('Plant maison', formulaire()));
    await attendre(() => reperes(travail(0)).includes('semis_pepiniere'), 'plant maison : le semis en pépinière devient un repère');
    expect(aChamp('Pépinière (jours)', formulaire())).toBe(true);
  });

  it('aperçu en direct, sans bouton « calculer » : la batavia de la bibliothèque, mise en place d’exemple le 2027-05-03 (S18)', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.batavia, ADAPTER);
    expect(boutons(f).some((x) => /calculer/i.test(nomAccessible(x))), 'pas de bouton « calculer »').toBe(false);
    const apercu = f.querySelector<HTMLElement>('[data-testid="apercu-itineraire"]');
    expect(apercu?.dataset.miseEnPlace).toBe('2027-05-03');
    expect(etapesApercu()).toEqual({ semisPepiniere: '2027-04-12', miseEnPlace: '2027-05-03', debutRecolte: '2027-05-31', finRecolte: '2027-06-14' });

    // « grelinette 10 jours avant la mise en place » (T22) → 2027-04-23.
    await ajouterTravail({ categorie: 'travail_sol', libelle: 'grelinette', jours: 10, sens: 'avant', repere: 'mise_en_place' });
    await attendre(() => datesApercu(0) === '2027-04-23', `grelinette le 2027-04-23 (aperçu : ${String(datesApercu(0))})`);
    expect(texte(f.querySelector('[data-testid="apercu-travail"][data-indice="0"]'))).toContain('grelinette');

    // « désherbage tous les 14 jours de la mise en place au début de récolte », à +14 → 05-17 et 05-31 (repère de fin compris).
    await ajouterTravail({
      categorie: 'entretien',
      libelle: 'désherbage',
      jours: 14,
      sens: 'apres',
      repere: 'mise_en_place',
      repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
    });
    await attendre(() => datesApercu(1) === '2027-05-17,2027-05-31', `désherbage les 17 et 31 mai (aperçu : ${String(datesApercu(1))})`);

    // Durée avant récolte 28 → 42 : le début de récolte recule, une occurrence de plus ; rien à toucher d'autre.
    await remplir(champ('Avant récolte (jours)', f), '42');
    await attendre(() => etapesApercu().debutRecolte === '2027-06-14', `début de récolte recalculé (${JSON.stringify(etapesApercu())})`);
    await attendre(() => datesApercu(1) === '2027-05-17,2027-05-31,2027-06-14', `désherbage recalculé (aperçu : ${String(datesApercu(1))})`);
    expect(datesApercu(0), 'la grelinette ne bouge pas (repère : mise en place)').toBe('2027-04-23');

    // Mêmes dates que le cœur (datesTravailPrevu), pas une règle réécrite.
    const dates: DatesSerie = { semisPepiniere: '2027-04-12', miseEnPlace: '2027-05-03', debutRecolte: '2027-06-14', finRecolte: '2027-06-28' } as DatesSerie;
    const desherbage = normalise({ categorie: 'entretien', type: 'désherbage', repere: 'mise_en_place', decalageJours: 14, repetition: { tousLesJours: 14, repereFin: 'debut_recolte' } });
    expect(datesApercu(1)).toBe(datesTravailPrevu(desherbage, dates).join(','));
    expect(b().transactions(), 'l’aperçu n’écrit rien').toBe(0);
  });

  it('un travail qui ne tombe jamais est signalé (+60 j après la mise en place, répété jusqu’au début de récolte à +28 j), sans bloquer', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.batavia, ADAPTER);
    const g = await ajouterTravail({
      categorie: 'entretien',
      libelle: 'désherbage',
      jours: 60,
      sens: 'apres',
      repere: 'mise_en_place',
      repetition: { tousLesJours: 7, repereFin: 'debut_recolte' },
    });
    await attendre(() => g.querySelector('[data-testid="travail-jamais"]') !== null, 'signal « ne tombe jamais » dans le travail');
    expect(texte(g.querySelector('[data-testid="travail-jamais"]'))).toMatch(/jamais/i);
    expect(datesApercu(0)).toBe('');

    await remplir(champ('Jours', g), '7');
    await attendre(() => g.querySelector('[data-testid="travail-jamais"]') === null, 'le signal disparaît quand le travail retombe');
    expect(datesApercu(0)).toBe('2027-05-10,2027-05-17,2027-05-24,2027-05-31');

    await remplir(champ('Jours', g), '60');
    await attendre(() => g.querySelector('[data-testid="travail-jamais"]') !== null, 'signal revenu');
    b().remiseAZero();
    expect(desactive(bouton('Enregistrer', formulaire())), 'le cœur l’accepte : l’écran signale, il ne bloque pas').toBe(false);
    await enregistrer();
    await attendre(() => b().transactions() === 1, 'enregistré en une transaction');
    itineraireValide(b(), nouvelItineraire());
  });

  it('« Nom » vide : « Enregistrer » désactivé ; « Fermer » n’écrit rien', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await remplir(champ('Nom', f), '   ');
    expect(desactive(bouton('Enregistrer', f))).toBe(true);
    b().remiseAZero();
    await toucher(bouton('Fermer', f));
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    expect(b().transactions()).toBe(0);
    expect(dialogue('Mes itinéraires'), 'l’écran reste ouvert').toBeDefined();
  });
});

describe('T24 : écritures d’un itinéraire (une transaction, règles du serveur)', () => {
  it('« Adapter pour ma ferme » n’écrit rien ; l’enregistrement crée la copie avec la grelinette et le désherbage (le scénario du ticket)', async () => {
    await h.ouvrir();
    const bibliothequeAvant = etat(itineraire(b(), ITINERAIRE.batavia));
    b().remiseAZero();
    const f = await ouvrirFormulaire(ITINERAIRE.batavia, ADAPTER);
    expect(nomAccessible(f)).toBe('Nouvel itinéraire');
    expect(b().transactions(), 'adapter ouvre le formulaire, sans écrire').toBe(0);
    expect(champ('Nom', f).value).toBe('Batavia (ma ferme)');
    expect(texte(f.querySelector('[data-testid="culture-itineraire"]'))).toContain('Batavia');
    expect(champ('Avant récolte (jours)', f).value).toBe('28');

    await ajouterTravail({ categorie: 'travail_sol', libelle: 'grelinette', jours: 10, sens: 'avant', repere: 'mise_en_place' });
    await ajouterTravail({
      categorie: 'entretien',
      libelle: 'désherbage',
      jours: 14,
      sens: 'apres',
      repere: 'mise_en_place',
      repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
      minutes: 15,
      par: 'cent_metres',
    });
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé après l’enregistrement');
    expect(b().transactions(), 'une saisie = une transaction').toBe(1);
    verifierOrdres(b());

    const l = nouvelItineraire();
    expect(String(l.id)).toMatch(MOTIF_UUID_V7);
    expect(l.ferme_id).toBe(FERME);
    expect(l.espece_id).toBe(ESPECE.batavia);
    expect(l.variete_id).toBeNull();
    expect(l.nom).toBe('Batavia (ma ferme)');
    expect(l.mode).toBe('plant_maison');
    expect(l.cree_le).toBe(ISO);
    expect(l.modifie_le).toBe(ISO);
    expect(l.supprime_le).toBeNull();
    itineraireValide(b(), l);
    const p = parametresDe(l);
    const { travauxPrevus, ...reste } = p;
    expect(reste, 'les paramètres de la bibliothèque, recopiés').toEqual(PARAMETRES.batavia);
    expect(travauxPrevus).toEqual([
      normalise({ categorie: 'travail_sol', type: 'grelinette', repere: 'mise_en_place', decalageJours: -10 }),
      normalise({
        categorie: 'entretien',
        type: 'désherbage',
        repere: 'mise_en_place',
        decalageJours: 14,
        repetition: { tousLesJours: 14, repereFin: 'debut_recolte' },
        tempsEstime: { minutes: 15, par: 'cent_metres' },
      }),
    ]);
    const r = validerTravauxPrevus(travauxPrevus);
    expect(r.ok && r.valeur, 'rangés normalisés (sortie de validerTravauxPrevus)').toEqual(travauxPrevus);
    expect(etat(itineraire(b(), ITINERAIRE.batavia)), 'la bibliothèque n’est jamais écrite').toEqual(bibliothequeAvant);

    // La copie apparaît dans la liste, côté ferme.
    await attendre(() => elementItineraire(String(l.id)) !== null, 'la copie est dans la liste');
    expect(elementItineraire(String(l.id))?.dataset.origine).toBe('ferme');
    expect(bandeau(), 'bandeau « Annuler »').not.toBeNull();
    expect(texte(bandeau())).toContain('Batavia (ma ferme)');
  });

  it('« Nouvel itinéraire » : culture choisie, semis direct à la volée ; ligne acceptée par validerItineraire', async () => {
    const e = await h.ouvrir();
    b().remiseAZero();
    await toucher(bouton('Nouvel itinéraire', e));
    await attendre(() => formulaireOuvert() !== undefined, 'formulaire ouvert');
    const f = formulaire();
    expect(nomAccessible(f)).toBe('Nouvel itinéraire');
    const culture = liste('Culture', f);
    expect([...culture.options].map((o) => o.value)).toEqual(expect.arrayContaining([ESPECE.batavia, ESPECE.chou, ESPECE.radis]));
    await remplir(champ('Nom', f), '  Radis de printemps ');
    await remplir(culture, ESPECE.radis);
    await toucher(radio('Semis direct', f));
    await attendre(() => aChamp('Façon', f), 'semis direct : « Façon »');
    expect(aChamp('Pépinière (jours)', f), 'pas de pépinière en semis direct').toBe(false);
    await remplir(liste('Façon', f), 'volee');
    await attendre(() => aChamp('Dose (g/m²)', f), 'volée : « Dose (g/m²) »');
    await remplir(champ('Largeur semée (cm)', f), '80');
    await remplir(champ('Dose (g/m²)', f), '2');
    await remplir(champ('Avant récolte (jours)', f), '30');
    await remplir(champ('Récolte (jours)', f), '14');
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    expect(b().transactions()).toBe(1);
    verifierOrdres(b());
    const l = nouvelItineraire();
    expect(l.nom, 'nom rogné').toBe('Radis de printemps');
    expect(l.espece_id).toBe(ESPECE.radis);
    expect(l.variete_id).toBeNull();
    expect(l.mode).toBe('semis_direct');
    const valide = itineraireValide(b(), l);
    expect(valide.parametres).toMatchObject({
      mode: 'semis_direct',
      dureeAvantRecolteJours: 30,
      fenetreRecolteJours: 14,
      densite: { facon: 'volee', largeurSemeeCm: 80, doseGParM2: 2 },
      grainesParPoquet: null,
    });
  });

  it('changer de mode (plant maison → plant acheté) retire les clés de la pépinière et garde le reste', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.batavia, ADAPTER);
    await toucher(radio('Plant acheté', f));
    await attendre(() => !aChamp('Pépinière (jours)', f), 'plus de pépinière en plant acheté');
    await attendre(() => !('semisPepiniere' in etapesApercu()), 'l’aperçu n’a plus de semis en pépinière');
    b().remiseAZero();
    await enregistrer();
    await attendre(() => b().transactions() === 1, 'enregistré');
    const l = nouvelItineraire();
    expect(l.mode).toBe('plant_achete');
    itineraireValide(b(), l);
    const p = parametresDe(l);
    for (const cle of ['dureePepiniereJours', 'grainesParMotte', 'plantsParMotte', 'pertePepiniere', 'alveolesParPlaque']) expect(p, cle).not.toHaveProperty(cle);
    expect(p).toMatchObject({
      mode: 'plant_achete',
      periodeUsage: PARAMETRES.batavia.periodeUsage,
      dureeAvantRecolteJours: 28,
      fenetreRecolteJours: 14,
      margeSecurite: 10,
      densite: PARAMETRES.batavia.densite,
    });
  });

  it('modifier un itinéraire sans série (Chou d’automne) : UPDATE en une transaction, sans confirmation ; clés non montrées gardées', async () => {
    await h.ouvrir();
    const avant = itineraire(b(), ITINERAIRE.chouAutomne);
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await remplir(champ('Nom', f), 'Chou d’hiver');
    await remplir(champ('Rangs par planche', f), '3');
    b().remiseAZero();
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    expect(dialogues().filter((d) => /séries? à venir/.test(nomAccessible(d))), 'aucune série : pas de confirmation').toEqual([]);
    expect(b().transactions()).toBe(1);
    verifierOrdres(b());
    expect(b().base.ecritures.slice(b().ecrituresAvant()).every((sql) => /^\s*UPDATE\s+["`]?itineraire\b/i.test(sql)), 'un UPDATE de l’itinéraire, rien d’autre').toBe(true);
    const l = itineraire(b(), ITINERAIRE.chouAutomne);
    itineraireValide(b(), l);
    expect(l?.nom).toBe('Chou d’hiver');
    expect(l?.espece_id).toBe(avant?.espece_id);
    expect(l?.ferme_id).toBe(FERME);
    expect(l?.cree_le).toBe(avant?.cree_le);
    expect(l?.modifie_le).toBe(ISO);
    expect(parametresDe(l)).toEqual({ ...PARAMETRES.chouAutomne, densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 40 } });
    expect(itineraires(b())).toHaveLength(4);
  });

  it('modifier un travail existant garde son outil et son produit ; retirer un travail le retire', async () => {
    await h.ouvrir();
    const f = await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER('bataviaFerme'));
    await remplir(champ('Jours', travail(1)), '10');
    await toucher(bouton('Retirer ce travail', travail(0)));
    await attendre(() => travaux().length === 1, 'le compost est retiré');
    expect(liste('Type', travail(0)).value).toBe(TYPE.binette);
    await remplir(champ('Nom', f), 'Batavia de la ferme');
    b().remiseAZero();
    await enregistrer();
    // Des séries à venir utilisent cet itinéraire : « Itinéraire seul » (les séries sont l'objet de series.test.tsx).
    await attendre(() => dialogue(/^Appliquer/) !== undefined, 'confirmation des séries à venir');
    await toucher(bouton('Itinéraire seul', dialogue(/^Appliquer/)));
    await attendre(() => b().transactions() === 1, 'enregistré');
    const l = itineraire(b(), ITINERAIRE.bataviaFerme);
    itineraireValide(b(), l);
    expect(parametresDe(l).travauxPrevus).toEqual([
      normalise({ categorie: 'entretien', type: 'binette', repere: 'mise_en_place', decalageJours: 10, outil: 'houe', tempsEstime: { minutes: 20, par: 'cent_metres' } }),
    ]);
  });

  it('un amendement exige son produit : « Enregistrer » désactivé tant que produit, quantité ou unité manquent', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.batavia, ADAPTER);
    await toucher(bouton('Ajouter un travail', formulaire()));
    await attendre(() => travaux().length === 1, 'un travail');
    const g = travail(0);
    await choisirType(g, 'amendement', 'fumier');
    await attendre(() => aChamp('Produit', g), 'amendement : « Produit »');
    expect(desactive(bouton('Enregistrer', formulaire()))).toBe(true);
    await remplir(champ('Produit', g), 'fumier de cheval');
    await remplir(champ('Quantité', g), '3');
    await remplir(champ('Unité', g), 't/ha');
    await attendre(() => !desactive(bouton('Enregistrer', formulaire())), '« Enregistrer » actif une fois le produit complet');
    b().remiseAZero();
    await enregistrer();
    await attendre(() => b().transactions() === 1, 'enregistré');
    const l = nouvelItineraire();
    itineraireValide(b(), l);
    expect(parametresDe(l).travauxPrevus).toEqual([
      normalise({ categorie: 'amendement', type: 'fumier', repere: 'mise_en_place', decalageJours: 0, produit: { nom: 'fumier de cheval', quantite: { valeur: 3, unite: 't/ha' } } }),
    ]);
  });
});

describe('T24 : « Annuler » pendant 10 s', () => {
  it('le bandeau reste 10 s puis disparaît', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await remplir(champ('Nom', formulaire()), 'Chou tardif');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    await enregistrer();
    await attendre(() => bandeau() !== null, 'bandeau affiché après l’enregistrement');
    expect(bandeau()?.getAttribute('role')).toBe('status');
    expect(aBouton('Annuler', bandeau() ?? document)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAI_ANNULATION_ITINERAIRE_MS - 200);
    });
    expect(bandeau(), 'encore là à 9,8 s').not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await unTour();
    expect(bandeau(), 'disparu après 10 s').toBeNull();
  });

  it('annuler une création : suppression douce en une transaction ; la copie quitte la liste', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.batavia, ADAPTER);
    await enregistrer();
    await attendre(() => bandeau() !== null, 'bandeau');
    const l = nouvelItineraire();
    b().remiseAZero();
    await toucher(bouton('Annuler', bandeau() ?? document));
    await attendre(() => b().transactions() === 1, 'annulation écrite');
    verifierOrdres(b());
    const apres = itineraire(b(), String(l.id));
    expect(apres?.supprime_le).toBe(ISO);
    itineraireValide(b(), apres);
    await attendre(() => elementItineraire(String(l.id)) === null, 'la copie annulée quitte la liste');
    expect(bandeau()).toBeNull();
  });

  it('annuler une modification : l’itinéraire revient exactement à ses valeurs d’avant', async () => {
    await h.ouvrir();
    const avant = etat(itineraire(b(), ITINERAIRE.chouAutomne));
    const f = await ouvrirFormulaire(ITINERAIRE.chouAutomne, MODIFIER('chouAutomne'));
    await remplir(champ('Nom', f), 'Chou tardif');
    await remplir(champ('Avant récolte (jours)', f), '100');
    await enregistrer();
    await attendre(() => bandeau() !== null, 'bandeau');
    expect(etat(itineraire(b(), ITINERAIRE.chouAutomne))).not.toEqual(avant);
    b().remiseAZero();
    await toucher(bouton('Annuler', bandeau() ?? document));
    await attendre(() => b().transactions() === 1, 'annulation écrite');
    verifierOrdres(b());
    expect(etat(itineraire(b(), ITINERAIRE.chouAutomne))).toEqual(avant);
    await laisserFiler();
    expect(dialogues().some((d) => NOM_FORMULAIRE.test(nomAccessible(d)))).toBe(false);
  });
});
