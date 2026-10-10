/**
 * Hauteur et stade d'une culture à une date (T32a, Q32), d'après son profil de croissance.
 * Déterministe : le jour est un argument, les écarts se comptent en jours entiers (dates
 * calendaires, sans fuseau). La hauteur ILLUSTRE la culture dans le jumeau numérique : ce n'est
 * ni une prévision de rendement ni une date de récolte.
 *
 * Règles et exemples chiffrés : en-tête de test/contrat.ts.
 */
import { ajouterJours, ecartEnJours, type DateCalendaire } from '../dates/index.ts';
import { feuillageApresRecolte } from './defauts.ts';
import { campagneEnCours, JOURS_FORMATION_FRUITS } from './recolte.ts';
import type { AllureCroissance, DateRepere, DatesCroissance, EntreePerenne, EtatCroissance, ProfilCroissance, StadeCroissance } from './types.ts';

/** Fin de la levée : tant que la hauteur reste sous cette part de la hauteur maximale. */
export const FRACTION_FIN_LEVEE = 0.1;
/** Hauteur « baissée » en fin de cycle : cette part de la hauteur atteinte à la fin de récolte. */
export const FRACTION_HAUTEUR_FIN_BAISSEE = 0.5;
/** Durée en part du cycle, sans fin de récolte ni arrachage : la hauteur maximale est atteinte en ce nombre de jours (aucune fin inventée). */
export const JOURS_REPLI_SANS_FIN = 60;

const RIEN: EtatCroissance = /* @__PURE__ */ Object.freeze({ stade: 'aucun', hauteurM: 0, fraction: 0 });
const REPOS: EtatCroissance = /* @__PURE__ */ Object.freeze({ stade: 'repos', hauteurM: 0, fraction: 0 });

/** Courbe de hauteur : x dans [0, 1] → part de la hauteur maximale, dans [0, 1], monotone. */
function courbe(allure: AllureCroissance, x: number): number {
  const b = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return allure === 'en-s' ? b * b * (3 - 2 * b) : b;
}

/** Avancement vers la hauteur maximale, après `ecoules` jours sur `dmax` ; dmax ≤ 0 : atteint. */
const avancement = (ecoules: number, dmax: number): number => (dmax > 0 ? Math.min(Math.max(ecoules / dmax, 0), 1) : 1);

const etat = (stade: StadeCroissance, profil: ProfilCroissance, fraction: number): EtatCroissance => ({
  stade,
  hauteurM: profil.hauteurMaxM * fraction,
  fraction,
});

/** La date réelle, si elle est remplie, remplace la prévue. */
const repere = (r: DateRepere): DateCalendaire | null => r.reelle ?? r.prevue;

/** Culture annuelle (occupation d'une série) : stade et hauteur au jour `jour`. */
export function croissanceA(dates: DatesCroissance, profil: ProfilCroissance, jour: DateCalendaire): EtatCroissance {
  const m = repere(dates.miseEnPlace);
  if (m === null || jour < m) return RIEN;
  const a = repere(dates.arrachage);
  if (a !== null && jour >= a) return RIEN;
  const b = repere(dates.debutRecolte);
  const f = repere(dates.finRecolte);

  let dmax: number;
  if (profil.duree.en === 'jours') dmax = profil.duree.jours;
  else if (f !== null) dmax = profil.duree.fraction * ecartEnJours(m, f);
  else if (a !== null) dmax = profil.duree.fraction * ecartEnJours(m, a);
  else dmax = JOURS_REPLI_SANS_FIN;

  const part = (j: DateCalendaire): number => courbe(profil.allure, avancement(ecartEnJours(m, j), dmax));

  if (f !== null && jour >= f) {
    const atteinte = part(f);
    return etat('fin', profil, profil.finDeCycle === 'baissee' ? atteinte * FRACTION_HAUTEUR_FIN_BAISSEE : atteinte);
  }
  const x = avancement(ecartEnJours(m, jour), dmax);
  const fraction = courbe(profil.allure, x);
  if ((b !== null && jour >= b) || x >= 1) return etat('pleine_production', profil, fraction);
  return etat(fraction < FRACTION_FIN_LEVEE ? 'levee' : 'croissance', profil, fraction);
}

/** Fin de récolte par défaut des pérennes dont le feuillage monte après la récolte (Q33, asperge) : 15 juin. */
const FIN_RECOLTE_PAR_DEFAUT = '06-15';

/** Jour 'MM-JJ' d'un cycle annuel dans l'année `annee` (jour valide de toute année). */
const dansLAnnee = (annee: number, mmjj: string): DateCalendaire => `${String(annee).padStart(4, '0')}-${mmjj}` as DateCalendaire;

/**
 * Plantation pérenne (kiwi, asperge, pivoine, fraisier conservé) : cycle annuel simple (Q32),
 * débourrement, pleine végétation, repos. La campagne vaut pour l'année du jour, ou, quelle que soit
 * son année de rattachement, quand elle contient le jour ou commence dans les 28 jours (T32f) : la
 * plante reste alors en végétation (pas de « repos » sans structure sous des fruits ou une balise).
 * Au repos 28 jours avant le début de récolte, elle repousse sur ces 28 jours (Q41, T32i), y compris
 * quand J−28 tombe l'année précédente (T32j) ; la récolte ne prolonge la végétation dans l'année
 * suivante que si la campagne est « en cours » le 31 décembre (T32j) : aucune chute à 0 m au 1er janvier.
 */
export function croissancePerenneA(entree: EntreePerenne, profil: ProfilCroissance, jour: DateCalendaire): EtatCroissance {
  const { datePlantation, dateArrachage } = entree.plantation;
  if (jour < datePlantation || (dateArrachage !== null && jour >= dateArrachage)) return RIEN;
  // Dates du cycle manquantes : repli « touffe haute fixe », plutôt que d'inventer une repousse.
  const cycle = profil.cycleAnnuel;
  if (cycle === null) return etat('pleine_vegetation', profil, 1);
  const annee = Number(jour.slice(0, 4));
  const campagne = entree.campagne;
  if (campagne === null) return REPOS;
  // Campagne rattachée à une autre année : elle ne compte que si elle est en cours, et tient alors la plante en végétation.
  const autre = campagne.annee !== annee;
  if (autre && !campagneEnCours(campagne, jour)) return REPOS;

  /** Fenêtre de végétation du cycle de l'année `an` : celle du profil, élargie par la récolte de la campagne. */
  const fenetre = (an: number): readonly [DateCalendaire, DateCalendaire, boolean] => {
    let debut = dansLAnnee(an, cycle.debourrement);
    let repos = dansLAnnee(an, cycle.repos);
    let rampe = false;
    const b = campagne.debutRecolte;
    if (b !== null) {
      // Q41 (T32i) : au repos 28 jours avant la récolte, la plante redémarre à J−28 et atteint sa pleine hauteur au début de récolte (sauf Q33, asperge).
      const j28 = ajouterJours(b, -JOURS_FORMATION_FRUITS);
      if (j28 < debut && !feuillageApresRecolte(profil)) [debut, rampe] = [j28, true];
      else if (b < debut) debut = b;
    }
    // La récolte prolonge la végétation, dans l'année suivante seulement si la campagne est « en cours » le 31 décembre (T32j, option i).
    const fin = campagne.finRecolte;
    const finAn = dansLAnnee(an, '12-31');
    if (fin !== null && fin >= repos && (fin <= finAn || campagneEnCours(campagne, finAn))) repos = ajouterJours(fin, 1);
    // L'année de plantation, la végétation part du jour de plantation.
    if (Number(datePlantation.slice(0, 4)) === an && datePlantation > debut) [debut, rampe] = [datePlantation, false];
    return [debut, autre && jour >= repos ? ajouterJours(jour, 1) : repos, rampe];
  };
  // Cycle qui porte le jour :
  // - T32j : rampe de Q41 commencée en décembre pour une campagne de l'année suivante (fraisier d'hiver, kiwi de fin janvier) : cycle suivant ;
  // - avant le débourrement de l'année (début d'hiver, janvier) : la végétation de l'année précédente se prolonge. Elle se prolonge aussi (T32f)
  //   quand la campagne était déjà « en cours » le 31 décembre précédent, sauf si la rampe de la campagne de l'année a commencé (T32j).
  const rampeDeLAnnee = campagne.annee === annee && jour >= fenetre(annee)[0];
  const an =
    campagne.annee === annee + 1 && jour >= fenetre(annee + 1)[0]
      ? annee + 1
      : (autre && jour < fenetre(annee)[0]) ||
          (!rampeDeLAnnee && jour < dansLAnnee(annee, cycle.debourrement) && campagneEnCours(campagne, dansLAnnee(annee - 1, '12-31')) && jour < fenetre(annee - 1)[1])
        ? annee - 1
        : annee;
  const [debut, repos, rampe] = fenetre(an);
  if (jour < debut || jour >= repos) return REPOS;

  // Q33 (asperge) : turions seuls pendant la récolte, la fougère part de 0 le lendemain de sa fin.
  let depart = debut;
  if (feuillageApresRecolte(profil)) {
    const finRecolte = campagne.finRecolte ?? dansLAnnee(an, FIN_RECOLTE_PAR_DEFAUT);
    depart = ajouterJours(finRecolte, 1);
    if (jour < depart) return etat('debourrement', profil, 0);
  }
  // Repousse de Q41 : rampe régulière (linéaire) sur les 28 jours, pleine hauteur au premier jour de récolte.
  const dmax = rampe ? JOURS_FORMATION_FRUITS : profil.duree.en === 'jours' ? profil.duree.jours : profil.duree.fraction * ecartEnJours(depart, repos);
  const x = avancement(ecartEnJours(depart, jour), dmax);
  return etat(x < 1 ? 'debourrement' : 'pleine_vegetation', profil, rampe ? x : courbe(profil.allure, x));
}
