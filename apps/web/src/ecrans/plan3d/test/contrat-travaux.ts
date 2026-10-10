/**
 * Contrat de T37 — vue 3D : les travaux du jour, numérotés sur les planches, pour les ouvriers
 * (docs/backlog/T37-travaux-du-jour-3d.md, Q36). Complète ./contrat.ts, ./contrat-camera.ts (T29) et
 * ./contrat-jumeau.ts, qui ne changent pas. Types et constantes seulement : les tests chargent les
 * modules par import dynamique (chemin tenu dans une variable).
 *
 * ── Même source, même ordre que l'écran Aujourd'hui (pas de calcul dupliqué) ─────────────────
 *
 * Les « travaux du jour » de la 3D sont les tâches que l'écran Aujourd'hui affiche (étapes de
 * séries et de campagnes, et travaux prévus de T22), dans le MÊME ordre : en retard d'abord, puis
 * la semaine, chacun dans l'ordre du moteur (packages/core/src/planification/semainier.ts).
 *   - Lecture : `lireJournee` puis `calculerJournee` (apps/web/src/ecrans/aujourdhui/calculs.ts),
 *     inchangées, EXACTEMENT les fonctions de l'écran Aujourd'hui. Lecture seule.
 *   - Ordre : `tachesDeLEcran(taches)`, à EXPORTER de apps/web/src/ecrans/aujourdhui/vues.ts, tirée
 *     de `vueDeJournee` (EcranAujourdhui.tsx) qui l'appelle à son tour : les tâches en retard
 *     d'abord, puis les autres, l'ordre relatif de chaque groupe conservé (partition stable), sans
 *     la limite de 25 par groupe (la 3D les montre toutes). Entrée jamais modifiée.
 *   Le test compare l'ordre de l'adaptateur à celui des cartes DESSINÉES par EcranAujourdhui
 *   (data-cle des `tache`) : un seul ordre dans le code, pas deux qui se ressemblent.
 *
 * ── Module pur (apps/web/src/ecrans/plan3d/travaux.ts) ───────────────────────────────────────
 *
 * Ni React, ni three, ni DOM, ni horloge, ni écriture. Importe de ../aujourdhui/ (calculs.ts,
 * vues.ts) ; n'importe pas three. Chargé avec la vue 3D (hors du JavaScript de démarrage).
 *
 * `travauxDuJour3d(taches, scene, aujourdhui)` → { travaux, pastilles } :
 *   - `taches` : `TacheJour[]` dans l'ordre du moteur (celui de `calculerJournee(...).taches`) ;
 *     l'adaptateur les met dans l'ordre de l'écran par `tachesDeLEcran` (partition stable : il ne
 *     retrie pas, l'ordre relatif de l'entrée est conservé). `scene` : seul
 *     `volumes` compte. `aujourdhui` : 'AAAA-MM-JJ' (pour les textes datés de vueCarte).
 *   - `travaux` : un `Travail3d` par tâche, `rang` 1, 2, 3… dans l'ordre de l'écran ;
 *   - `texte` : « <rang>. <phrase> — <lieu> » :
 *       phrase = la phrase de la carte, en capitale : étape → verbe + espèce en minuscules
 *       (« Planter chou pointu », « Semer en pépinière batavia », « Récolter fraise »),
 *       travail prévu → libellé + espèce (« Grelinette batavia », « Désherbage tomate ») ;
 *       lieu = « <zone du premier emplacement>, <codesEmplacements(emplacements)> »
 *       (« Tunnel 2, T2-P03 » ; deux emplacements « Tunnel 2, T2-P01 · T2-P03 » ; trois ou plus
 *       « Tunnel 2, T2-P01 +2 ») ; sans emplacement : « sans planche » (« 8. Semer radis — sans planche »).
 *     Le séparateur est le tiret cadratin « — » entouré d'espaces insécables ou non (le test
 *     normalise les espaces) ;
 *   - `planche` : l'id du PREMIER emplacement de la tâche (ordre de la tâche) dont le volume de la
 *     scène est `placee` ; sinon null (planche absente de la scène, ou non placée : listé quand même) ;
 *   - `enRetard` : `tache.enRetard`, `cle` : `TacheJour.cle`.
 *   - `pastilles` : une `Pastille3d` par planche portant au moins un travail, dans l'ordre de leur
 *     premier numéro ; `numeros` = rangs des travaux dont `planche` est cette planche, croissants ;
 *     `x`, `z` = ceux du volume ; `libelle` = numeros.join(' · ') (« 2 · 6 · 7 »). Aucune pastille
 *     pour un travail sans planche placée (il garde sa ligne).
 *   - Pure : même entrée, même sortie, entrées jamais modifiées.
 *
 * `travailSuivant(travaux, actif)` → rang | null : le rang du travail à montrer après `actif` (null :
 *   aucun encore) ; ne retient que les travaux qui ont une planche ; passe au suivant dans l'ordre,
 *   et revient au premier après le dernier ; null s'il n'y a aucun travail avec planche.
 *   Un `actif` inconnu repart du premier.
 *
 * `lireTachesDuJour(porte, fermeId, aujourdhui, maintenant?)` → Promise<TacheJour[]> :
 *   `tachesDeLEcran(calculerJournee(await lireJournee(porte, fermeId, aujourdhui, maintenant), aujourdhui).taches)`.
 *   Lecture seule : aucune écriture (ni execute, ni writeTransaction) sur la base.
 *
 * ── Panneau « Travaux du jour » (React, plan3d/PanneauTravaux.tsx) ───────────────────────────
 *
 * `PanneauTravaux3d({ travaux, actif, surChoisir, replieDepart? })` — export nommé, composant
 * de présentation (aucune lecture, aucune écriture) :
 *   `actif` : rang du travail mis en évidence, ou null ; `surChoisir(rang)` : appelé au tap d'une
 *   ligne et à « Suivant » ; `replieDepart` : replié à l'ouverture (faux par défaut).
 *   Aucun travail → le composant ne dessine rien.
 *   DOM (data-testid de TESTID_3D_TRAVAUX) :
 *     `travaux-du-jour-3d`  racine, role « region », nom accessible « Travaux du jour » ; attributs
 *                           data-nombre (nombre de travaux), data-replie ('oui' | 'non'),
 *                           data-actif (rang, ou '') ;
 *     `travaux-replier-3d`  bouton, aria-expanded ('true' déplié), nom « Replier les travaux du jour »
 *                           / « Déplier les travaux du jour » ; bascule data-replie ;
 *     `travaux-liste-3d`    liste `ul` des lignes, HIDDEN (attribut hidden) quand le panneau est replié ;
 *     `travail-3d`          un `li` par travail, dans l'ordre : data-rang, data-cle, data-planche (id
 *                           ou ''), aria-current="true" sur le travail actif seulement ;
 *     `aller-travail-3d`    le bouton de la ligne, texte = `texte` du travail (« 2. Grelinette batavia
 *                           — Tunnel 2, T2-P01 ») ; sans planche : disabled ; le tap d'une ligne avec
 *                           planche appelle `surChoisir(rang)` ;
 *     `travail-suivant-3d`  bouton « Suivant » (nom accessible « Suivant »), VISIBLE même replié ;
 *                           appelle `surChoisir(travailSuivant(travaux, actif))` ; disabled si aucun
 *                           travail n'a de planche.
 *   Zones tactiles : chaque bouton fait au moins 48 px de haut (lu par l'e2e du téléphone).
 *
 * ── Vue 3D (DOM), lue par apps/web/e2e/vue-3d-travaux.e2e.ts ─────────────────────────────────
 *
 * Le panneau est dans `vue-3d`, replié au téléphone d'un tap, ouvert au départ, en bas de l'écran.
 * Il est alimenté par `lireTachesDuJour(porte, fermeId, …)` avec la `porte` et la `fermeId` déjà
 * reçues par la vue (T32b), au jour du téléphone, et redessiné quand la base change. Pas de porte :
 * pas de panneau, `data-travaux` = 0.
 * `toile-3d` gagne :
 *   `data-travaux`        nombre de travaux du jour (lignes du panneau), 0 s'il n'y en a pas ;
 *   `data-pastilles`      JSON `[{"planche","x","z","numeros":[…]}]`, une entrée par pastille, dans
 *                         l'ordre de `pastilles` (x, z de la scène, nombres complets) ; '[]' sinon ;
 *   `data-travail-actif`  rang du travail choisi, ou '' ;
 *   `data-planche-active` id de la planche du travail choisi (mise en évidence dans la scène), ou ''.
 * Un tap sur la ligne d'un travail avec planche : `data-travail-actif` = son rang,
 * `data-planche-active` = sa planche, et la caméra vole vers CETTE planche (T29 :
 * `cadrage(boiteDe(scene, { sorte: 'planche', id }))`, sens de la caméra conservé, mêmes durées,
 * `data-vols` + 1, mouvement réduit respecté) ; la ligne porte aria-current="true".
 * « Suivant » : même effet pour le travail suivant. Ni le tap ni « Suivant » n'écrivent quoi que ce
 * soit (aucune requête, aucune écriture en base) ; le panneau marche hors ligne.
 * La pastille : un disque numéroté au-dessus de chaque planche concernée, instancié (un seul appel
 * de dessin pour toutes), lisible de loin ; les garde-fous de fluidité de T29b tiennent (appels et
 * triangles de BORNES_DEMO, relevés par e2e/fluidite-3d.ts).
 */
import type { TacheJour } from '../../aujourdhui/calculs.ts';
import type { PorteDonnees } from '@planif/sync';

export interface Travail3d {
  /** 1, 2, 3… dans l'ordre de l'écran Aujourd'hui. */
  readonly rang: number;
  /** TacheJour.cle. */
  readonly cle: string;
  /** « 2. Grelinette batavia — Tunnel 2, T2-P01 ». */
  readonly texte: string;
  /** Id de la planche placée visée, ou null. */
  readonly planche: string | null;
  readonly enRetard: boolean;
}

export interface Pastille3d {
  readonly planche: string;
  readonly x: number;
  readonly z: number;
  /** Rangs des travaux de la planche, croissants. */
  readonly numeros: readonly number[];
  /** « 2 · 6 · 7 ». */
  readonly libelle: string;
}

export interface TravauxDuJour3d {
  readonly travaux: readonly Travail3d[];
  readonly pastilles: readonly Pastille3d[];
}

/** Ce que travaux.ts exporte (la scène : seuls les volumes comptent). */
export interface ModuleTravaux3d {
  travauxDuJour3d(taches: readonly TacheJour[], scene: { readonly volumes: readonly unknown[] }, aujourdhui: string): TravauxDuJour3d;
  travailSuivant(travaux: readonly Travail3d[], actif: number | null): number | null;
  lireTachesDuJour(porte: PorteDonnees, fermeId: string, aujourdhui: string, maintenant?: Date): Promise<TacheJour[]>;
}

/** Ce que aujourdhui/vues.ts exporte de plus (réutilisé, pas dupliqué). */
export interface ModuleVuesAujourdhui {
  tachesDeLEcran(taches: readonly TacheJour[]): TacheJour[];
}

export interface ProprietesPanneauTravaux3d {
  readonly travaux: readonly Travail3d[];
  readonly actif: number | null;
  readonly surChoisir: (rang: number) => void;
  readonly replieDepart?: boolean;
}

export const TESTID_3D_TRAVAUX = {
  panneau: 'travaux-du-jour-3d',
  replier: 'travaux-replier-3d',
  liste: 'travaux-liste-3d',
  ligne: 'travail-3d',
  aller: 'aller-travail-3d',
  suivant: 'travail-suivant-3d',
} as const;

export const TEXTES_3D_TRAVAUX = {
  titre: 'Travaux du jour',
  replier: 'Replier les travaux du jour',
  deplier: 'Déplier les travaux du jour',
  suivant: 'Suivant',
} as const;

/** Hauteur minimale d'un bouton du panneau (px), lue par l'e2e du téléphone. */
export const HAUTEUR_BOUTON_MIN_PX = 48;
