# T16 — Identité visuelle : système de design et habillage de l'appli

**Objectif** : que l'appli ressemble aux maquettes validées par Théophane (https://claude.ai/artifact/CkYjAD2qX9mxw3FNLT9miP), avec des briques réutilisables, avant les premiers vrais écrans (T11, T13).

**Dépend de** : T09b
**Périmètre** : `apps/web/src/ui/**` (jetons et composants), `apps/web/src/App.tsx`, `apps/web/src/connexion/**` (habillage seulement), `apps/web/src/ecrans/export/**` (habillage seulement), `apps/web/public/polices/**`, `apps/web/index.html`, `apps/web/e2e/**`

## Règles

- **Jetons** (variables CSS, une seule source) repris des maquettes :
  - couleurs : fond `#EEF1E8`, encre `#15201A`, forêt `#1F4D3A` (tout ce qui se touche), orange `#E0701F` / texte `#9A4A0F` réservés à ce qui presse, texte secondaire `#4B5A50` ; couleurs de familles botaniques (bandes des cartes et du plan) ;
  - polices : Archivo (titres, largeur 112 %), Atkinson Hyperlegible (texte), IBM Plex Mono (codes de planche) ;
  - rayons, ombres, espacements.
- **Polices hébergées avec l'appli** (pas de Google Fonts : la CSP l'interdit et l'appli doit marcher hors ligne), en woff2 sous-ensemble latin, `font-display: swap`, mises en cache par le service worker. Elles ne comptent pas dans le budget de JavaScript mais ne doivent pas retarder le premier affichage.
- **Composants** : bouton principal (au moins 56 px, ombre basse), bouton secondaire, carte de tâche avec bande de famille et gros bouton d'action à droite, en-tête vert, pastille, barre de navigation basse (Aujourd'hui, Planches, Dicter, Ferme) avec cibles d'au moins 48 px, alerte orange, confirmation en un tap.
- **Habillage** : écran de connexion comme la maquette « Connexion » ; coquille de l'appli avec la barre de navigation ; écran Ferme minimal qui porte l'export (T15) et la déconnexion (T09b), comme la maquette « Ferme ». Les autres onglets affichent un écran d'attente propre (« Bientôt : … »).
- **Lisible au soleil** : contraste AA au minimum (4,5:1 pour le texte, 3:1 pour les grands textes et les contours de boutons), vérifié par test.
- **Pas de nouvelle bibliothèque** d'interface : CSS et React seuls.

## Critères d'acceptation

- [ ] Captures e2e (Playwright, téléphone 390 × 844) des écrans connexion, Ferme et coquille, comparées aux maquettes par le relecteur.
- [ ] Test de contraste sur toutes les paires de jetons texte / fond utilisées.
- [ ] Test : aucune requête vers un domaine tiers (polices comprises) ; l'appli hors ligne affiche les bonnes polices.
- [ ] Budget de démarrage : **au plus 70 Kio** (70,9 aujourd'hui) — regagner de la marge avant T11 et T13 ; temps d’affichage e2e inchangé (300 ms, 1000 ms à froid (première visite)).
- [ ] Les tests e2e existants (connexion, déconnexion, CSP, synchro) passent, sélecteurs adaptés si besoin et justifiés.

**Hors périmètre** : vue des planches (T11), saisie (T13), dictée (phase 2), mode sombre (plus tard), écran d'ordinateur (plus tard).
