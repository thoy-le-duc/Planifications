/**
 * Profils de croissance par défaut de la bibliothèque commune (T32a, Q32 : valeurs par défaut
 * réglables par la ferme). Ce sont des ORDRES DE GRANDEUR pour illustrer la vue 3D, pas des
 * mesures : aucune n'a encore de référence publiée, chacune porte la mention « valeur usuelle à
 * vérifier » et Théophane les corrige à la revue (les dix plus visibles sont listées dans
 * docs/journal.md, entrée T32a).
 *
 * Ordres de grandeur de départ donnés par le ticket : tomate tuteurée 2 m, salade 0,25 m,
 * carotte 0,3 m, courgette 0,6 m (buisson), fraise 0,25 m, asperge 1,5 m en fougère.
 *
 * Durée : en jours depuis la mise en place pour les cultures qui « montent » puis produisent
 * longtemps (tomate, courgette…), en part du cycle (mise en place → fin de récolte) pour celles
 * qu'on récolte d'un coup (salade, carotte…). Pérennes : `cycleAnnuel` (débourrement, repos).
 *
 * Rien ne s'exécute au chargement qui ne soit marqué pur (`@__PURE__`) : un écran qui n'appelle
 * pas ce module ne l'embarque pas, même s'il importe @planif/core.
 */
import { MENTION_A_VERIFIER, validerProfilCroissance } from './profil.ts';
import type { AllureCroissance, CycleAnnuel, DureeCroissance, FinDeCycle, FormePlant, ProfilCroissance, ProfilParDefaut } from './types.ts';

const jours = (n: number): DureeCroissance => ({ en: 'jours', jours: n });
const part = (f: number): DureeCroissance => ({ en: 'fraction_cycle', fraction: f });
const cycle = (debourrement: string, repos: string): CycleAnnuel => ({ debourrement, repos });

function entree(
  espece: string,
  synonymes: readonly string[],
  forme: FormePlant,
  hauteurMaxM: number,
  duree: DureeCroissance,
  options: { readonly allure?: AllureCroissance; readonly finDeCycle?: FinDeCycle; readonly cycleAnnuel?: CycleAnnuel } = {},
): ProfilParDefaut {
  const cycleAnnuel = options.cycleAnnuel === undefined ? null : Object.freeze({ ...options.cycleAnnuel });
  const profil: ProfilCroissance = Object.freeze({
    forme,
    hauteurMaxM,
    duree: Object.freeze({ ...duree }),
    allure: options.allure ?? 'en-s',
    finDeCycle: options.finDeCycle ?? 'conservee',
    cycleAnnuel,
  });
  return Object.freeze({ espece, synonymes: Object.freeze([...synonymes]), profil, source: MENTION_A_VERIFIER });
}

const BAISSEE = { finDeCycle: 'baissee' } as const;

/** Une entrée par espèce de la bibliothèque commune ; `synonymes` : autres noms courants. */
export const PROFILS_PAR_DEFAUT: readonly ProfilParDefaut[] = /* @__PURE__ */ Object.freeze([
  // Solanacées
  /* @__PURE__ */ entree('Tomate', [], 'erige-tuteure', 2, jours(90)),
  /* @__PURE__ */ entree('Aubergine', [], 'buisson', 0.9, jours(90)),
  /* @__PURE__ */ entree('Poivron', ['Piment'], 'buisson', 0.7, jours(90)),
  /* @__PURE__ */ entree('Pomme de terre', ['Patate'], 'touffe', 0.6, jours(60), BAISSEE),
  // Cucurbitacées
  /* @__PURE__ */ entree('Courgette', [], 'buisson', 0.6, jours(50)),
  /* @__PURE__ */ entree('Concombre', [], 'erige-tuteure', 2, jours(70)),
  /* @__PURE__ */ entree('Melon', [], 'rampant', 0.3, jours(60), BAISSEE),
  /* @__PURE__ */ entree('Courge butternut', ['Courge', 'Butternut'], 'rampant', 0.5, jours(70), BAISSEE),
  /* @__PURE__ */ entree('Potimarron', [], 'rampant', 0.5, jours(70), BAISSEE),
  // Salades et feuilles
  /* @__PURE__ */ entree('Laitue', ['Salade'], 'rosette', 0.25, part(0.9)),
  /* @__PURE__ */ entree('Batavia', [], 'rosette', 0.25, part(0.9)),
  /* @__PURE__ */ entree('Chicorée frisée', ['Chicorée', 'Frisée'], 'rosette', 0.3, part(0.9)),
  /* @__PURE__ */ entree('Scarole', [], 'rosette', 0.3, part(0.9)),
  /* @__PURE__ */ entree('Mâche', [], 'rosette', 0.08, part(0.9)),
  /* @__PURE__ */ entree('Roquette', [], 'rosette', 0.25, part(0.8)),
  /* @__PURE__ */ entree('Épinard', [], 'rosette', 0.25, part(0.8)),
  /* @__PURE__ */ entree('Blette', ['Bette', 'Poirée'], 'rosette', 0.5, part(0.5)),
  /* @__PURE__ */ entree('Basilic', [], 'touffe', 0.4, part(0.6)),
  /* @__PURE__ */ entree('Persil', [], 'touffe', 0.3, part(0.6)),
  // Racines, bulbes
  /* @__PURE__ */ entree('Betterave', [], 'bulbe-ou-racine', 0.35, part(0.8)),
  /* @__PURE__ */ entree('Carotte', [], 'bulbe-ou-racine', 0.3, part(0.7)),
  /* @__PURE__ */ entree('Panais', [], 'bulbe-ou-racine', 0.4, part(0.7)),
  /* @__PURE__ */ entree('Radis', [], 'bulbe-ou-racine', 0.15, part(0.9)),
  /* @__PURE__ */ entree('Navet', [], 'bulbe-ou-racine', 0.3, part(0.8)),
  /* @__PURE__ */ entree('Céleri-rave', ['Céleri'], 'touffe', 0.5, part(0.8)),
  /* @__PURE__ */ entree('Fenouil', [], 'bulbe-ou-racine', 0.6, part(0.9)),
  /* @__PURE__ */ entree('Poireau', [], 'touffe', 0.6, part(0.8)),
  /* @__PURE__ */ entree('Oignon', [], 'bulbe-ou-racine', 0.5, part(0.7), BAISSEE),
  /* @__PURE__ */ entree('Ail', [], 'bulbe-ou-racine', 0.6, part(0.7), BAISSEE),
  /* @__PURE__ */ entree('Échalote', [], 'bulbe-ou-racine', 0.4, part(0.7), BAISSEE),
  // Choux
  /* @__PURE__ */ entree('Chou pommé', ['Chou'], 'rosette', 0.4, part(0.8)),
  /* @__PURE__ */ entree('Chou-fleur', [], 'rosette', 0.6, part(0.8)),
  /* @__PURE__ */ entree('Brocoli', [], 'buisson', 0.7, part(0.8)),
  /* @__PURE__ */ entree('Chou kale', ['Kale'], 'touffe', 0.8, part(0.5)),
  // Légumineuses, maïs
  /* @__PURE__ */ entree('Haricot vert', ['Haricot'], 'buisson', 0.5, jours(50)),
  /* @__PURE__ */ entree('Pois', [], 'erige-tuteure', 1.2, jours(60), BAISSEE),
  /* @__PURE__ */ entree('Fève', [], 'touffe', 1, jours(70), BAISSEE),
  /* @__PURE__ */ entree('Maïs doux', ['Maïs'], 'touffe', 1.8, jours(80)),
  // Pérennes (Q32 : cycle annuel simple, débourrement → repos)
  /* @__PURE__ */ entree('Artichaut', [], 'touffe', 1.2, jours(90), { cycleAnnuel: cycle('03-01', '10-31') }),
  /* @__PURE__ */ entree('Asperge', [], 'touffe', 1.5, jours(100), { cycleAnnuel: cycle('04-01', '11-15') }),
  /* @__PURE__ */ entree('Fraisier', ['Fraise'], 'touffe', 0.25, jours(45), { cycleAnnuel: cycle('03-01', '11-30') }),
  /* @__PURE__ */ entree('Kiwi', [], 'arbre-ou-liane', 2.5, jours(75), { cycleAnnuel: cycle('04-01', '11-20') }),
  /* @__PURE__ */ entree('Pivoine', [], 'touffe', 0.9, jours(50), { cycleAnnuel: cycle('03-15', '10-31') }),
]);

/**
 * Espèce inconnue de la bibliothèque : une touffe d'un demi-mètre, qui atteint sa hauteur aux
 * sept dixièmes du cycle, sans cycle annuel. Neutre à l'écran, à régler par la ferme.
 */
export const PROFIL_GENERIQUE: ProfilParDefaut = /* @__PURE__ */ entree('Espèce sans profil', [], 'touffe', 0.5, part(0.7));

/** Nom rapproché : sans casse, sans accents, espaces en trop retirés. */
function normaliser(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Index des noms et synonymes, construit au premier appel (rien ne s'exécute au chargement du module). */
let parNom: ReadonlyMap<string, ProfilParDefaut> | null = null;

/** Profil par défaut d'une espèce, par son nom ou un synonyme ; aucun : PROFIL_GENERIQUE. */
export function profilParDefaut(nomEspece: string): ProfilParDefaut {
  parNom ??= new Map(PROFILS_PAR_DEFAUT.flatMap((e) => [e.espece, ...e.synonymes].map((nom) => [normaliser(nom), e] as const)));
  return parNom.get(normaliser(nomEspece)) ?? PROFIL_GENERIQUE;
}

/**
 * L'adaptateur : le profil réglé par la ferme (objet, ou texte du téléphone) s'il suit les
 * règles, sinon (nul, absent, illisible, hors bornes) le profil par défaut de l'espèce. Ne lève
 * jamais.
 */
export function profilEffectif(espece: { readonly nom: string; readonly profilCroissance?: unknown }): ProfilCroissance {
  try {
    const r = validerProfilCroissance(espece.profilCroissance);
    if (r.ok && r.valeur !== null) return r.valeur;
    return profilParDefaut(espece.nom).profil;
  } catch {
    return PROFIL_GENERIQUE.profil;
  }
}
