// @vitest-environment happy-dom
/**
 * Tests d'acceptation T24 — modifier un itinéraire utilisé par des séries
 * (docs/backlog/T24-ecran-itineraires.md, « Modifier un itinéraire utilisé ») : les séries
 * passées, commencées ou terminées ne bougent jamais ; les séries à venir reçoivent le nouvel
 * instantané et leurs dates recalculées, après une confirmation explicite ; tout en une
 * transaction, annulable. Ferme des itinéraires au 2026-09-30 (./test/ferme-itineraires.ts :
 * séries à venir de « Batavia de la ferme » = aVenir1 et aVenir2). Contrat : ./test/contrat.ts.
 */
import { describe, expect, it } from 'vitest';
import { CODES, datesDe, ITINERAIRE, NOMS_ITINERAIRES, OCCUPATION, SERIE, seriesDuJeu } from './test/ferme-itineraires.ts';
import { bandeau, enregistrer, formulaire, formulaireOuvert, harnais, laisserFiler, ouvrirFormulaire } from './test/harnais.ts';
import {
  AUJOURDHUI,
  attendre,
  bouton,
  champ,
  dialogue,
  dialogueOuEchec,
  etat,
  ISO,
  itineraire,
  itineraireValide,
  itineraires,
  occupations,
  occupationsDe,
  occupationsValides,
  parametresDe,
  remplir,
  serie,
  series,
  serieValide,
  texte,
  toucher,
  verifierOrdres,
  type Ligne,
} from './test/outils.ts';

const h = harnais();
const b = () => h.banc();

const MODIFIER = `Modifier ${NOMS_ITINERAIRES.bataviaFerme}`;
const CONFIRMATION = /^Appliquer aux 2 séries à venir \?/;
const A_VENIR = [SERIE.aVenir1, SERIE.aVenir2] as const;
const INTACTES = [SERIE.passee, SERIE.commencee, SERIE.enRetard, SERIE.supprimee, SERIE.bibliotheque] as const;

/** Photographie complète (colonnes brutes, horodatages compris) de toutes les lignes touchables. */
function photo(): { itineraires: Ligne[]; series: Ligne[]; occupations: Ligne[] } {
  return { itineraires: itineraires(b()), series: series(b()), occupations: occupations(b()) };
}

const brute = (liste: readonly Ligne[], id: string): Ligne | undefined => liste.find((l) => l.id === id);

/** Ouvre « Batavia de la ferme », passe la durée avant récolte de 49 à 56 jours, touche « Enregistrer ». */
async function allongerEtEnregistrer(): Promise<void> {
  await h.ouvrir();
  await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER);
  await remplir(champ('Avant récolte (jours)', formulaire()), '56');
  b().remiseAZero();
  await enregistrer();
  await attendre(() => dialogue(CONFIRMATION) !== undefined, 'confirmation « Appliquer aux 2 séries à venir ? »');
}

describe('T24 : modifier un itinéraire utilisé — la proposition', () => {
  it('« Appliquer aux 2 séries à venir ? » liste les seules séries à venir, par mise en place ; rien n’est écrit avant de répondre', async () => {
    await allongerEtEnregistrer();
    const d = dialogueOuEchec(CONFIRMATION);
    expect(['dialog', 'alertdialog']).toContain(d.getAttribute('role'));
    expect(d.dataset.testid).toBe('confirmation-series');
    const listees = [...d.querySelectorAll<HTMLElement>('[data-testid="serie-a-venir"]')];
    expect(
      listees.map((l) => l.dataset.serie),
      'à venir : ni la terminée, ni la commencée (semis réalisé), ni celle dont le semis prévu est passé, ni la supprimée, ni celle d’un autre itinéraire',
    ).toEqual([...A_VENIR]);
    expect(texte(listees[0])).toContain('Batavia');
    expect(texte(listees[0])).toContain(CODES.t1p05);
    expect(texte(listees[1])).toContain(CODES.t1p06);
    expect(b().transactions(), 'rien d’écrit avant la réponse').toBe(0);
    for (const nom of ['Appliquer aux séries', 'Itinéraire seul', 'Revenir']) expect(bouton(nom, d)).toBeDefined();
  });

  it('« Revenir » : rien n’est écrit, le formulaire reste ouvert', async () => {
    await allongerEtEnregistrer();
    const avant = photo();
    await toucher(bouton('Revenir', dialogueOuEchec(CONFIRMATION)));
    await attendre(() => dialogue(CONFIRMATION) === undefined, 'confirmation fermée');
    expect(formulaireOuvert(), 'le formulaire reste ouvert').toBeDefined();
    expect(champ('Avant récolte (jours)', formulaire()).value).toBe('56');
    await laisserFiler();
    expect(b().transactions()).toBe(0);
    expect(photo()).toEqual(avant);
  });

  it('seul le nom change : pas de proposition, l’itinéraire seul, les séries intactes', async () => {
    await h.ouvrir();
    await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER);
    const avant = photo();
    await remplir(champ('Nom', formulaire()), 'Batavia maison');
    b().remiseAZero();
    await enregistrer();
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé sans confirmation');
    expect(dialogue(/^Appliquer/)).toBeUndefined();
    expect(b().transactions()).toBe(1);
    expect(itineraire(b(), ITINERAIRE.bataviaFerme)?.nom).toBe('Batavia maison');
    expect(series(b())).toEqual(avant.series);
    expect(occupations(b())).toEqual(avant.occupations);
  });
});

describe('T24 : « Appliquer aux séries » — une transaction, les séries passées ne bougent jamais', () => {
  it('séries à venir : instantané fidèle, dates recalculées depuis l’ancre inchangée, occupations suivies ; les autres lignes intactes', async () => {
    await allongerEtEnregistrer();
    const avant = photo();
    await toucher(bouton('Appliquer aux séries', dialogueOuEchec(CONFIRMATION)));
    await attendre(() => b().transactions() === 1, 'une seule transaction');
    await attendre(() => formulaireOuvert() === undefined, 'formulaire fermé');
    await laisserFiler();
    expect(b().transactions(), 'itinéraire, séries et occupations : une transaction').toBe(1);
    verifierOrdres(b());

    const it = itineraire(b(), ITINERAIRE.bataviaFerme);
    itineraireValide(b(), it);
    const nouveaux = parametresDe(it);
    expect(nouveaux.dureeAvantRecolteJours).toBe(56);

    const jeu = seriesDuJeu(AUJOURDHUI);
    for (const id of A_VENIR) {
      const cle = id === SERIE.aVenir1 ? 'aVenir1' : 'aVenir2';
      const s = serie(b(), id);
      const lue = serieValide(s);
      expect(s?.parametres, `${cle} : parametres = EXACTEMENT le texte de l’itinéraire (instantané fidèle)`).toBe(it?.parametres);
      const attendues = datesDe(nouveaux, jeu[cle].ancre);
      expect(s?.ancre_type, `${cle} : ancre inchangée`).toBe(jeu[cle].ancre.type);
      expect(s?.ancre_date).toBe(jeu[cle].ancre.date);
      expect(
        { semis: s?.prevu_semis_pepiniere, miseEnPlace: s?.prevu_mise_en_place, debut: s?.prevu_debut_recolte, fin: s?.prevu_fin_recolte },
        `${cle} : dates recalculées par le cœur`,
      ).toEqual({ semis: attendues.semisPepiniere ?? null, miseEnPlace: attendues.miseEnPlace, debut: attendues.debutRecolte, fin: attendues.finRecolte });
      expect(lue.datesPrevues.debutRecolte).toBe(attendues.debutRecolte);
      expect(s?.modifie_le).toBe(ISO);
      const avantSerie = brute(avant.series, id);
      for (const c of ['statut', 'saison_id', 'longueur_m', 'espece_id', 'itineraire_id', 'cree_le', 'supprime_le'] as const) expect(s?.[c], `${cle}.${c}`).toBe(avantSerie?.[c]);
      const occ = occupationsDe(b(), id);
      expect(occ).toHaveLength(1);
      expect(occ[0]?.id).toBe(OCCUPATION[cle]);
      expect(occ[0]?.prevu_du).toBe(attendues.miseEnPlace);
      expect(occ[0]?.prevu_au).toBe(attendues.finRecolte);
      occupationsValides(b(), id);
    }
    // Ancre « plantation » : la récolte recule de 7 jours ; ancre « récolte à partir de » : la mise en place avance de 7 jours.
    expect(serie(b(), SERIE.aVenir1)?.prevu_mise_en_place).toBe(brute(avant.series, SERIE.aVenir1)?.prevu_mise_en_place);
    expect(serie(b(), SERIE.aVenir2)?.prevu_debut_recolte).toBe(brute(avant.series, SERIE.aVenir2)?.prevu_debut_recolte);
    expect(serie(b(), SERIE.aVenir2)?.prevu_mise_en_place).not.toBe(brute(avant.series, SERIE.aVenir2)?.prevu_mise_en_place);

    for (const id of INTACTES) {
      expect(serie(b(), id), `série ${id} : jamais touchée (horodatages compris)`).toEqual(brute(avant.series, id));
      for (const o of occupationsDe(b(), id)) expect(o, `occupation de ${id}`).toEqual(brute(avant.occupations, String(o.id)));
    }
    for (const l of avant.itineraires) if (l.id !== ITINERAIRE.bataviaFerme) expect(itineraire(b(), String(l.id))).toEqual(l);
    expect(bandeau(), 'bandeau « Annuler »').not.toBeNull();
  });

  it('« Itinéraire seul » : l’itinéraire change, aucune série ni occupation ne bouge', async () => {
    await allongerEtEnregistrer();
    const avant = photo();
    await toucher(bouton('Itinéraire seul', dialogueOuEchec(CONFIRMATION)));
    await attendre(() => b().transactions() === 1, 'une transaction');
    await laisserFiler();
    expect(b().transactions()).toBe(1);
    verifierOrdres(b());
    expect(parametresDe(itineraire(b(), ITINERAIRE.bataviaFerme)).dureeAvantRecolteJours).toBe(56);
    expect(series(b())).toEqual(avant.series);
    expect(occupations(b())).toEqual(avant.occupations);
  });

  it('« Annuler » après l’application : une transaction, et l’itinéraire, les séries et les occupations reviennent exactement', async () => {
    await h.ouvrir();
    const avant = photo();
    await ouvrirFormulaire(ITINERAIRE.bataviaFerme, MODIFIER);
    await remplir(champ('Avant récolte (jours)', formulaire()), '56');
    await remplir(champ('Pépinière (jours)', formulaire()), '30');
    await enregistrer();
    await attendre(() => dialogue(CONFIRMATION) !== undefined, 'confirmation');
    await toucher(bouton('Appliquer aux séries', dialogueOuEchec(CONFIRMATION)));
    await attendre(() => bandeau() !== null, 'bandeau « Annuler »');
    expect(etat(serie(b(), SERIE.aVenir1))).not.toEqual(etat(brute(avant.series, SERIE.aVenir1)));

    b().remiseAZero();
    await toucher(bouton('Annuler', bandeau() ?? document));
    await attendre(() => b().transactions() === 1, 'annulation écrite');
    await laisserFiler();
    expect(b().transactions(), 'annuler : une transaction').toBe(1);
    verifierOrdres(b());
    for (const l of avant.itineraires) expect(etat(itineraire(b(), String(l.id))), `itinéraire ${String(l.id)}`).toEqual(etat(l));
    for (const s of avant.series) expect(etat(serie(b(), String(s.id))), `série ${String(s.id)}`).toEqual(etat(s));
    const apres = occupations(b());
    expect(apres.map(etat)).toEqual(avant.occupations.map(etat));
    for (const id of A_VENIR) {
      serieValide(serie(b(), id));
      occupationsValides(b(), id);
    }
  });
});
