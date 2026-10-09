/**
 * Hauteur et stade d'une culture à une date (T32a, Q32), d'après son profil de croissance.
 * Déterministe : le jour est un argument, les écarts se comptent en jours entiers (dates
 * calendaires, sans fuseau). La hauteur ILLUSTRE la culture dans le jumeau numérique : ce n'est
 * ni une prévision de rendement ni une date de récolte.
 *
 * Règles et exemples chiffrés : en-tête de test/contrat.ts.
 */
import { ajouterJours, ecartEnJours, type DateCalendaire } from '../dates/index.ts';
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
 * débourrement, pleine végétation, repos, sur la campagne de l'année du jour.
 */
export function croissancePerenneA(entree: EntreePerenne, profil: ProfilCroissance, jour: DateCalendaire): EtatCroissance {
  const { datePlantation, dateArrachage } = entree.plantation;
  if (jour < datePlantation || (dateArrachage !== null && jour >= dateArrachage)) return RIEN;
  // Dates du cycle manquantes : repli « touffe haute fixe », plutôt que d'inventer une repousse.
  if (profil.cycleAnnuel === null) return etat('pleine_vegetation', profil, 1);
  const annee = Number(jour.slice(0, 4));
  const campagne = entree.campagne;
  if (campagne?.annee !== annee) return REPOS;

  let debut = dansLAnnee(annee, profil.cycleAnnuel.debourrement);
  let repos = dansLAnnee(annee, profil.cycleAnnuel.repos);
  // La récolte de la campagne, hors de la fenêtre du profil, l'élargit.
  if (campagne.debutRecolte !== null && campagne.debutRecolte < debut) debut = campagne.debutRecolte;
  if (campagne.finRecolte !== null && campagne.finRecolte >= repos) repos = ajouterJours(campagne.finRecolte, 1);
  // L'année de plantation, la végétation part du jour de plantation.
  if (Number(datePlantation.slice(0, 4)) === annee && datePlantation > debut) debut = datePlantation;
  if (jour < debut || jour >= repos) return REPOS;

  // Q33 (asperge) : turions seuls pendant la récolte, la fougère part de 0 le lendemain de sa fin.
  let depart = debut;
  if (profil.feuillageApresRecolte === true) {
    const finRecolte = campagne.finRecolte ?? dansLAnnee(annee, FIN_RECOLTE_PAR_DEFAUT);
    depart = ajouterJours(finRecolte, 1);
    if (jour < depart) return etat('debourrement', profil, 0);
  }
  const dmax = profil.duree.en === 'jours' ? profil.duree.jours : profil.duree.fraction * ecartEnJours(depart, repos);
  const x = avancement(ecartEnJours(depart, jour), dmax);
  return etat(x < 1 ? 'debourrement' : 'pleine_vegetation', profil, courbe(profil.allure, x));
}
