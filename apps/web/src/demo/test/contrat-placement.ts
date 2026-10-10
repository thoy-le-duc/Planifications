/**
 * Contrat de T28i — la démo permet d'essayer le placement d'une serre sur une vraie photo
 * (docs/backlog/T28i-demo-placement.md, Q36). Fichier de test : lu par ../origine.test.ts,
 * ../reseau.test.ts, ../politique-contenu.test.ts, ../../ecrans/placement/demo-editeur.test.tsx et
 * e2e/demo-placement.e2e.ts ; le code de production ne l'importe jamais.
 *
 * ── Origine du plan de la démo (src/demo/placement-demo.ts) ──────────────────────────────────
 * `ferme.origine_plan` de la démo = texte JSON {latitude, longitude}, coordonnées FIXES dans le code
 * (aucun appel réseau, aucune aléa), dans un lieu agricole réel et plausible, en France
 * métropolitaine (couverte par l'orthophoto IGN) :
 *   - arrondies à 3 décimales au plus (~100 m : on ne désigne aucune ferme réelle) ;
 *   - dans l'emprise BORNES_FRANCE ;
 *   - à plus de DISTANCE_MIN_CENTRE_RODEZ_M du centre de Rodez (44,3506 N ; 2,575 E), où tombait
 *     l'ancienne origine : une ville, pas un champ ;
 *   - à moins de DISTANCE_MAX_POSITION_M de `ferme.position` (la position météo) : la météo de la
 *     démo et la photo parlent du même endroit (le développeur déplace `position` avec l'origine,
 *     dans les jeux de la démo, sans toucher aux jeux de test partagés).
 * Aucun nom de ferme réelle dans la démo : NOM_FERME_DEMO (identite.ts) reste fictif. La ferme de
 * démo garde ses serres et planches posées (T28c) : elles restent valides pour le moteur.
 *
 * ── Réseau de la démo (src/demo/reseau.ts, pur, utilisé par `garderLeReseau` de index.tsx) ───
 *   reseauAutorise(url: URL, origineApp: string): boolean
 * Vrai pour une requête `fetch` de la démo :
 *   - même origine que l'appli, sauf /api et /api/… (toujours refusés) ;
 *   - ET SEULEMENT la recherche d'adresse (T28h) : https://data.geopf.fr/geocodage/… (origine
 *     exactement https://data.geopf.fr, chemin commençant par /geocodage/) ;
 *   - tout le reste est refusé : autre hôte, sous-domaine ou hôte ressemblant
 *     (data.geopf.fr.evil.test), http au lieu de https, autre port, autre chemin de data.geopf.fr
 *     (/wmts : les tuiles passent par des <img>, jamais par fetch).
 * La synchro n'est toujours jamais branchée : aucune requête vers /api ni PowerSync.
 *
 * ── Politique de contenu de la démo ──────────────────────────────────────────────────────────
 * La balise CSP de dist-demo/index.html (comme celle de l'appli) contient
 * `img-src 'self' https://data.geopf.fr` et `connect-src` avec 'self' et https://data.geopf.fr,
 * rien de plus large. Si apps/web/vercel.json pose un en-tête Content-Security-Policy, il garde ces deux
 * origines (les en-têtes s'ajoutent à la balise : le plus strict gagne).
 *
 * ── Invitation (en démo seulement) ───────────────────────────────────────────────────────────
 * `invitation-demo` : TEXTE_INVITATION exactement (texte visible, un seul élément par écran),
 *   - DANS `editeur-placement` (toute largeur d'écran, gérant) ;
 *   - DANS `vue-3d` (vue 3D de la démo), y compris ferme déjà placée (l'encart `encart-placement`
 *     de T28f reste absent : T28f, vue-3d-editeur.e2e.ts, ne change pas).
 * L'éditeur la reçoit par la propriété `invitationDemo?: boolean` (défaut : faux → rien n'est rendu,
 * le build de production n'affiche jamais ce texte) ; l'appli la passe à vrai seulement quand
 * `import.meta.env.MODE === 'demo'`. Le texte vit sous src/demo/ ou est inclus uniquement dans le
 * build de démo : dist/ ne le contient pas.
 *
 * ── Parcours du visiteur (e2e démo, réseau simulé par page.route) ────────────────────────────
 * Gérant d'emblée. Vue 3D → « Modifier le plan » (ou Ferme → « Placer sur la photo aérienne ») :
 * en ligne `data-fond="photo"`, tuiles demandées autour de `data-origine`, « © IGN » ; recherche
 * d'adresse qui répond ; « Nouveau bâtiment » + « Poser » + clic + « Enregistrer » ; « Fermer » :
 * la 3D compte un bâtiment de plus. Hors ligne : `data-fond="neutre"`, aucune tuile, aucune erreur
 * (ni `pageerror`, ni `console.error`), placement toujours possible. « Réinitialiser la démo »
 * (confirmer) : la serre ajoutée a disparu.
 */

export const TEXTE_INVITATION = 'Essayez : ajoutez une serre et posez-la sur la photo';

export const TESTID_DEMO_PLACEMENT = {
  invitation: 'invitation-demo',
} as const;

/** France métropolitaine (emprise large). */
export const BORNES_FRANCE = { latMin: 41.3, latMax: 51.2, lonMin: -5.2, lonMax: 9.7 } as const;
export const CENTRE_RODEZ = { latitude: 44.3506, longitude: 2.575 } as const;
export const DISTANCE_MIN_CENTRE_RODEZ_M = 3_000;
export const DISTANCE_MAX_POSITION_M = 3_000;

export interface ModuleReseauDemo {
  reseauAutorise(url: URL, origineApp: string): boolean;
}
