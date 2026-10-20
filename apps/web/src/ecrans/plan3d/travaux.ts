/**
 * Vue 3D (T37) — les travaux du jour, numérotés sur les planches, pour les ouvriers (Q36).
 * Module pur, sans React ni three : mêmes tâches et même ordre que l'écran « Aujourd'hui » (ses
 * fonctions `lireJournee`, `calculerJournee` et `tachesDeLEcran`, jamais un second calcul).
 * Lecture seule : aucune écriture.
 *
 * T60 : pour une personne de l'équipe (« Mes travaux » dans l'écran Aujourd'hui, l'équipier par
 * défaut), seuls ses travaux et ceux de personne sont numérotés ; une planche qui ne porte que des
 * travaux des autres a une pastille grisée, sans numéro.
 *
 * T55 : les traitements phyto en vigueur datés du jour s'ajoutent aux travaux numérotés, après les
 * cartes dessinées par l'écran (la carte n° i reste le travail n° i). Ils se lisent par
 * ../aujourdhui/dar.ts (même lecture que l'écran) ; les chaînes (corrections, annulations) par le cœur.
 */
import type { PorteDonnees } from '@planif/sync';
import { estPourPersonne, type Id } from '@planif/core';
import type { Equipe } from '../aujourdhui/equipe/donnees.ts';
import {
  calculerJournee,
  capitale,
  codesEmplacements,
  jourDuTelephone,
  lireJournee,
  marquerEcriture,
  masquesDe,
  modeEquipeDe,
  phraseDeTache,
  suivreMasques,
  TACHES_PAR_GROUPE,
  toutVoirDe,
  tachesDeLEcran,
  type Masques,
  type ModeEquipe,
  type TacheJour,
} from '../aujourdhui/index.ts';
import { travailSuivant, type Travail3d } from './choix-travail.ts';
import type { TraitementDuJour3d } from './traitements-jour.ts';

export { jourDuTelephone, masquesDe, modeEquipeDe, suivreMasques, toutVoirDe, travailSuivant, type TraitementDuJour3d, type Travail3d };

/** Une pastille numérotée au-dessus d'une planche. */
export interface Pastille3d {
  readonly planche: string;
  readonly x: number;
  readonly z: number;
  /** Rangs des travaux de la planche, croissants. */
  readonly numeros: readonly number[];
  /** « 2 · 6 · 7 ». */
  readonly libelle: string;
  /** T60 : la planche ne porte que des travaux des autres (pastille grisée, sans numéro) ; absent sans personne. */
  readonly autre?: boolean;
}

/** T60 : la personne dont la 3D numérote les travaux, et les attributions du jour. */
export interface PourPersonne {
  readonly parTache: ReadonlyMap<string, readonly string[]>;
  readonly personneId: string;
}

export interface TravauxDuJour3d {
  readonly travaux: readonly Travail3d[];
  readonly pastilles: readonly Pastille3d[];
}

interface VolumeCherche {
  readonly id: string;
  readonly code?: string;
  readonly x: number;
  readonly z: number;
  readonly placee: boolean;
}

/** Un travail du jour : une carte de l'écran Aujourd'hui, ou un traitement du jour (T55). */
export type TravailDuJour = TacheJour | TraitementDuJour3d;

const estTraitement = (t: TravailDuJour): t is TraitementDuJour3d => 'traitement' in t;

/** Ids des planches d'un travail, dans son ordre. */
function planchesDe(t: TravailDuJour): readonly string[] {
  return estTraitement(t) ? t.traitement.emplacementIds : t.tache.emplacements.map((e) => e.id);
}

/** T55 : « T2-P01 · T2-P03 », « PC-P01 +2 » (comme les cartes), ou « sans planche ». */
function lieuDuTraitement(t: TraitementDuJour3d, codes: ReadonlyMap<string, string>): string {
  const connus = t.traitement.emplacementIds.flatMap((id) => {
    const code = codes.get(id.toLowerCase());
    return code === undefined ? [] : [{ id: id as Id<'Emplacement'>, code, zone: '' }];
  });
  return codesEmplacements(connus) ?? 'sans planche';
}

/** « Tunnel 2, T2-P01 · T2-P03 », ou « sans planche ». */
function lieuDe(t: TacheJour): string {
  const codes = codesEmplacements(t.tache.emplacements);
  const zone = t.tache.emplacements[0]?.zone;
  return codes === null ? 'sans planche' : zone === undefined || zone === '' ? codes : `${zone}, ${codes}`;
}

/**
 * Les travaux du jour (rang 1, 2, 3… dans l'ordre reçu, celui de `lireTachesDuJour`) et une pastille
 * par planche placée qui en porte au moins un : une tâche sur plusieurs planches placées a une
 * pastille sur chacune (T37b) ; le vol de la caméra va à la première. Un travail dont aucune planche
 * n'est placée est listé, sans pastille.
 */
export function travauxDuJour3d(toutes: readonly TravailDuJour[], scene: { readonly volumes: readonly unknown[] }, personne: PourPersonne | string | null = null): TravauxDuJour3d {
  // Une chaîne (le jour, que le contrat de T37 passait en troisième argument) ne désigne personne.
  const pour = typeof personne === 'string' ? null : personne;
  const placees = new Map<string, VolumeCherche>();
  const codes = new Map<string, string>();
  for (const v of scene.volumes as readonly VolumeCherche[]) {
    if (v.placee) placees.set(v.id, v);
    if (v.code !== undefined) codes.set(v.id.toLowerCase(), v.code);
  }
  const parPlanche = new Map<string, number[]>();
  // T60 : les travaux de la personne seulement ; les planches des autres, grisées.
  const taches = pour === null ? toutes : toutes.filter((t) => estPourPersonne(pour.parTache, t.cle, pour.personneId));
  const autres = new Set<string>();
  const siennes = new Set(taches);
  if (pour !== null) for (const t of toutes) if (!siennes.has(t)) for (const id of planchesDe(t)) if (placees.has(id)) autres.add(id);
  const travaux: Travail3d[] = taches.map((t, i) => {
    const rang = i + 1;
    let planche: string | null = null;
    for (const id of planchesDe(t)) {
      if (!placees.has(id)) continue;
      planche ??= id;
      const numeros = parPlanche.get(id);
      if (numeros === undefined) parPlanche.set(id, [rang]);
      else if (numeros[numeros.length - 1] !== rang) numeros.push(rang);
    }
    // « fait » : un traitement du journal est déjà passé (aucun traitement prévu n'est une carte de
    // l'écran) ; sans ce mot, le travail numéroté se lirait « à faire » et inviterait à retraiter.
    if (estTraitement(t)) return { rang, cle: t.cle, texte: `${String(rang)}. Traitement fait : ${t.traitement.produit} — ${lieuDuTraitement(t, codes)}`, planche, enRetard: false };
    return { rang, cle: t.cle, texte: `${String(rang)}. ${capitale(phraseDeTache(t))} — ${lieuDe(t)}`, planche, enRetard: t.tache.enRetard };
  });
  const pastilles: Pastille3d[] = [];
  for (const [planche, numeros] of parPlanche) {
    const v = placees.get(planche);
    if (v !== undefined) pastilles.push({ planche, x: v.x, z: v.z, numeros, libelle: numeros.join(' · '), ...(pour === null ? {} : { autre: false }) });
  }
  for (const planche of autres) {
    const v = placees.get(planche);
    if (v !== undefined && !parPlanche.has(planche)) pastilles.push({ planche, x: v.x, z: v.z, numeros: [], libelle: '', autre: true });
  }
  return { travaux, pastilles };
}

/** Sans utilisateur : personne, donc tous les travaux (T37). */
const SANS_EQUIPE: Equipe = { personnes: [], moi: null, gerant: false, parTache: new Map() };

/** Une lecture de la journée par la 3D : ses tâches dans l'ordre du moteur, et le numéro de la lecture (masques). */
export interface LectureTravaux {
  readonly taches: readonly TacheJour[];
  readonly numero: number;
  /** T60 : l'équipe vue par l'utilisateur (moi, gérant, attributions). */
  readonly equipe: Equipe;
  /** T55 : traitements en vigueur datés du jour, dans l'ordre de leur saisie. */
  readonly traitements?: readonly TraitementDuJour3d[];
}

/**
 * T60 : pour qui la 3D numérote, d'après le mode de l'écran Aujourd'hui (`modeEquipeDe`) : « Mes
 * travaux », ou rien de choisi pour un équipier → sa personne ; sinon (« Tous », gérant par
 * défaut, pas de personne) → null, tous les travaux comme T37.
 */
export function pourDe(lecture: LectureTravaux, mode: ModeEquipe | null): PourPersonne | null {
  const { moi, gerant, parTache } = lecture.equipe;
  if (moi === null) return null;
  return (mode ?? (gerant ? 'tous' : 'mes')) === 'mes' ? { parTache, personneId: moi } : null;
}

/**
 * La tâche `cle` est-elle masquée pour une lecture de numéro `numero` ? Comme l'écran (cache.ts,
 * `estMasquee`) : écriture en cours, ou écriture finie après le début de la lecture (elle n'a pas pu la voir).
 */
function masqueePour(masques: Masques, numero: number, cle: string): boolean {
  const m = masques.get(cle);
  return m !== undefined && (m === 'attente' || numero < m);
}

/** Relit la journée, comme l'écran Aujourd'hui (mêmes fonctions). Lecture seule (aucune écriture en base). */
export async function lireTravaux(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant: Date = new Date(), utilisateurId?: string): Promise<LectureTravaux> {
  // Le numéro de la lecture est pris à l'horloge des lectures et des écritures de l'écran (cache.ts), au début de la lecture.
  const numero = marquerEcriture();
  // T60 : l'équipe se lit par son propre morceau (chargé à la demande, comme celui de l'écran).
  const [lignes, equipe, traitements] = await Promise.all([
    lireJournee(porte, fermeId, aujourdhui, maintenant),
    utilisateurId === undefined ? SANS_EQUIPE : import('../aujourdhui/equipe/donnees.ts').then((m) => m.lireEquipe(porte, fermeId, utilisateurId)),
    traitementsDuJour(porte, fermeId, aujourdhui),
  ]);
  return { taches: calculerJournee(lignes, aujourdhui).taches, numero, equipe, traitements };
}

/**
 * T55 : les traitements du jour (./traitements-jour.ts, chargé à la demande). Une lecture qui
 * échoue ne retire pas les autres travaux : aucun traitement, et l'erreur à la console.
 */
async function traitementsDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string): Promise<TraitementDuJour3d[]> {
  try {
    return await (await import('./traitements-jour.ts')).lireTraitementsDuJour(porte, fermeId, aujourdhui);
  } catch (e: unknown) {
    console.error('Traitements du jour 3D : lecture impossible', e);
    return [];
  }
}

/**
 * Les tâches telles que l'écran Aujourd'hui les dessine (T37b) : sans celles marquées faites et pas
 * encore relues (ses masques, lus à l'appel), en retard d'abord puis la semaine ; les cartes visibles
 * de chaque groupe (25 au plus) d'abord, puis celles cachées derrière « Voir les autres ». La carte
 * n° i de l'écran est donc la tâche n° i ici. `masques` : ceux de la ferme (`masquesDe`), au moment de l'appel.
 * T37c : écran déplié (`toutVoir`, « Voir les autres » : `toutVoirDe`), tout le retard puis toute la semaine,
 * comme les cartes de l'écran déplié.
 * T55 : les traitements du jour (`lecture.traitements`) suivent les cartes dessinées.
 */
export function tachesVisibles(lecture: LectureTravaux, masques: Masques, toutVoir = false): TravailDuJour[] {
  const { dessinees, cachees } = cartes(lecture, masques, toutVoir);
  // T55 : les traitements du jour juste après les cartes dessinées (petits numéros, cartes inchangées).
  return [...dessinees, ...(lecture.traitements ?? []), ...cachees];
}

/** Les cartes de l'écran : celles qu'il dessine, puis celles cachées derrière « Voir les autres ». */
function cartes(lecture: LectureTravaux, masques: Masques, toutVoir: boolean): { readonly dessinees: TacheJour[]; readonly cachees: TacheJour[] } {
  const taches = tachesDeLEcran(masques.size === 0 ? lecture.taches : lecture.taches.filter((t) => !masqueePour(masques, lecture.numero, t.cle)));
  const retard = taches.filter((t) => t.tache.enRetard);
  const semaine = taches.filter((t) => !t.tache.enRetard);
  if (toutVoir) return { dessinees: [...retard, ...semaine], cachees: [] };
  return { dessinees: [...retard.slice(0, TACHES_PAR_GROUPE), ...semaine.slice(0, TACHES_PAR_GROUPE)], cachees: [...retard.slice(TACHES_PAR_GROUPE), ...semaine.slice(TACHES_PAR_GROUPE)] };
}

/** Les tâches de l'écran Aujourd'hui pour `aujourdhui`, dans l'ordre de ses cartes (sans les traitements, T55). Lecture seule. */
export async function lireTachesDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant: Date = new Date()): Promise<TacheJour[]> {
  const lecture = await lireTravaux(porte, fermeId, aujourdhui, maintenant);
  const { dessinees, cachees } = cartes(lecture, masquesDe(porte, fermeId), toutVoirDe(porte, fermeId));
  return [...dessinees, ...cachees];
}
