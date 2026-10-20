/**
 * Équipe de la ferme et attribution des travaux du jour (T60, Q36 et Q44). Contrat :
 * ./test/contrat.ts. Module pur : ni base, ni réseau, ni horloge ; rien ne lève.
 *
 * Une personne de l'équipe a un prénom et, facultativement, un compte (son membre) : un ouvrier
 * sans téléphone n'en a pas. Une attribution dit « ce travail est pour cette personne » ; le
 * travail est désigné par la clé de la tâche de l'écran Aujourd'hui. Un travail attribué à
 * personne est pour tout le monde (« Mes travaux » le montre à chacun).
 */
import type { Id, Instant } from '../domaine/index.ts';
import { absent, colonnesConnues, echec, erreur, id, idOuNul, lu, sansException, supprimeLe, type Lu, type Objet, type ResultatLigne } from '../saisies/lignes.ts';
import { texteInterdit } from '../saisies/travaux.ts';

export const LIMITES_EQUIPE = { prenomCaracteres: 60, cleTacheCaracteres: 200 } as const;

export interface PersonneEcrite {
  readonly id: Id<'Personne'>;
  readonly fermeId: Id<'Ferme'>;
  readonly prenom: string;
  readonly membreId: Id<'Membre'> | null;
  readonly supprimeLe: Instant | null;
}

export interface AttributionEcrite {
  readonly id: Id<'Attribution'>;
  readonly fermeId: Id<'Ferme'>;
  readonly personneId: Id<'Personne'>;
  readonly cleTache: string;
  readonly supprimeLe: Instant | null;
}

const HORODATAGES = ['cree_le', 'modifie_le'] as const;
const COLONNES_PERSONNE: ReadonlySet<string> = /* @__PURE__ */ new Set(['id', 'ferme_id', 'prenom', 'membre_id', 'supprime_le', ...HORODATAGES]);
const COLONNES_ATTRIBUTION: ReadonlySet<string> = /* @__PURE__ */ new Set(['id', 'ferme_id', 'personne_id', 'cle_tache', 'supprime_le', ...HORODATAGES]);

function prenom(v: unknown): Lu<string> {
  const champ = 'prenom';
  if (absent(v)) return echec(erreur('champ_manquant', champ, 'prénom manquant'));
  if (typeof v !== 'string') return echec(erreur('champ_invalide', champ, 'prénom : texte attendu'));
  const t = v.trim();
  if (t === '') return echec(erreur('champ_manquant', champ, 'prénom manquant'));
  if (t.length > LIMITES_EQUIPE.prenomCaracteres) return echec(erreur('trop_long', champ, `prénom : ${String(LIMITES_EQUIPE.prenomCaracteres)} caractères au plus`));
  if (texteInterdit(t)) return echec(erreur('champ_invalide', champ, 'prénom : caractère invalide'));
  return lu(t);
}

/** Clé de tâche : texte tel quel (pas de retouche : elle doit égaler celle de l'écran). */
function cleTache(v: unknown): Lu<string> {
  const champ = 'cle_tache';
  if (absent(v)) return echec(erreur('champ_manquant', champ, 'travail manquant'));
  if (typeof v !== 'string') return echec(erreur('champ_invalide', champ, 'travail : texte attendu'));
  if (v === '') return echec(erreur('champ_manquant', champ, 'travail manquant'));
  if (v.length > LIMITES_EQUIPE.cleTacheCaracteres) return echec(erreur('trop_long', champ, `travail : ${String(LIMITES_EQUIPE.cleTacheCaracteres)} caractères au plus`));
  if (v.trim() !== v || texteInterdit(v)) return echec(erreur('champ_invalide', champ, 'travail : clé invalide'));
  return lu(v);
}

function lirePersonne(l: Objet): Lu<PersonneEcrite> {
  const inconnue = colonnesConnues(l, COLONNES_PERSONNE);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', 'identifiant de la personne');
  if (!identifiant.ok) return identifiant;
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const p = prenom(l.prenom);
  if (!p.ok) return p;
  const membre = idOuNul(l.membre_id, 'membre_id', 'compte');
  if (!membre.ok) return membre;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;
  return lu({
    id: identifiant.valeur as Id<'Personne'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    prenom: p.valeur,
    membreId: membre.valeur as Id<'Membre'> | null,
    supprimeLe: suppression.valeur,
  });
}

function lireAttribution(l: Objet): Lu<AttributionEcrite> {
  const inconnue = colonnesConnues(l, COLONNES_ATTRIBUTION);
  if (inconnue !== null) return echec(inconnue);
  const identifiant = id(l.id, 'id', 'identifiant de l’attribution');
  if (!identifiant.ok) return identifiant;
  const ferme = id(l.ferme_id, 'ferme_id', 'ferme');
  if (!ferme.ok) return ferme;
  const personne = id(l.personne_id, 'personne_id', 'personne');
  if (!personne.ok) return personne;
  const cle = cleTache(l.cle_tache);
  if (!cle.ok) return cle;
  const suppression = supprimeLe(l.supprime_le);
  if (!suppression.ok) return suppression;
  return lu({
    id: identifiant.valeur as Id<'Attribution'>,
    fermeId: ferme.valeur as Id<'Ferme'>,
    personneId: personne.valeur as Id<'Personne'>,
    cleTache: cle.valeur,
    supprimeLe: suppression.valeur,
  });
}

/** Valide une ligne `personne` (format PowerSync, avec son `id`) ; rend la première règle violée. */
export function validerPersonne(entree: unknown): ResultatLigne<PersonneEcrite> {
  return sansException(entree, lirePersonne);
}

/** Valide une ligne `attribution` (format PowerSync, avec son `id`) ; rend la première règle violée. */
export function validerAttribution(entree: unknown): ResultatLigne<AttributionEcrite> {
  return sansException(entree, lireAttribution);
}

// ── Lecture et écriture des attributions ─────────────────────────────────────────────────────

/** Une attribution telle que lue de la base locale. */
export interface AttributionLue {
  readonly id: string;
  readonly cleTache: string;
  readonly personneId: string;
  readonly supprimee: boolean;
}

/** Personnes (ids en minuscules, sans doublon, triées) de chaque travail qui en a au moins une active. */
export function personnesParTache(attributions: readonly AttributionLue[]): ReadonlyMap<string, readonly string[]> {
  const ensembles = new Map<string, Set<string>>();
  for (const a of attributions) {
    if (a.supprimee) continue;
    let s = ensembles.get(a.cleTache);
    if (s === undefined) {
      s = new Set();
      ensembles.set(a.cleTache, s);
    }
    s.add(a.personneId.toLowerCase());
  }
  return new Map([...ensembles].map(([cle, s]) => [cle, [...s].sort()]));
}

/** Le travail `cle` est-il pour la personne ? Oui s'il lui est attribué, ou s'il n'est attribué à personne. */
export function estPourPersonne(parTache: ReadonlyMap<string, readonly string[]>, cle: string, personneId: string): boolean {
  const qui = parTache.get(cle);
  return qui === undefined || qui.length === 0 || qui.includes(personneId.toLowerCase());
}

/** « Mes travaux » : les tâches qui sont pour la personne, dans l'ordre reçu. */
export function travauxDe<T extends { readonly cle: string }>(taches: readonly T[], parTache: ReadonlyMap<string, readonly string[]>, personneId: string): T[] {
  return taches.filter((t) => estPourPersonne(parTache, t.cle, personneId));
}

/** Écritures d'une attribution : créer, rétablir (supprime_le remis à nul), retirer (suppression douce). */
export interface PlanAttribution {
  readonly creer: readonly { readonly cleTache: string; readonly personneId: string }[];
  readonly retablir: readonly string[];
  readonly retirer: readonly string[];
}

/** Les écritures qui donnent à chaque clé de `voulues` exactement ses personnes ; les autres clés ne changent pas. */
export function planAttribution(existantes: readonly AttributionLue[], voulues: ReadonlyMap<string, readonly string[]>): PlanAttribution {
  const creer: { cleTache: string; personneId: string }[] = [];
  const retablir: string[] = [];
  const retirer: string[] = [];
  const parCle = new Map<string, AttributionLue[]>();
  for (const a of existantes) {
    if (!voulues.has(a.cleTache)) continue;
    const l = parCle.get(a.cleTache);
    if (l === undefined) parCle.set(a.cleTache, [a]);
    else l.push(a);
  }
  for (const [cle, personnes] of voulues) {
    const lignes = parCle.get(cle) ?? [];
    const voulu = new Set(personnes.map((p) => p.toLowerCase()));
    const actives = new Set(lignes.filter((a) => !a.supprimee).map((a) => a.personneId.toLowerCase()));
    const vues = new Set<string>();
    for (const p of personnes) {
      const pm = p.toLowerCase();
      if (vues.has(pm) || actives.has(pm)) continue;
      vues.add(pm);
      const retiree = lignes
        .filter((a) => a.supprimee && a.personneId.toLowerCase() === pm)
        .map((a) => a.id)
        .sort()[0];
      if (retiree === undefined) creer.push({ cleTache: cle, personneId: p });
      else retablir.push(retiree);
    }
    for (const a of lignes) if (!a.supprimee && !voulu.has(a.personneId.toLowerCase())) retirer.push(a.id);
  }
  return { creer, retablir, retirer };
}
