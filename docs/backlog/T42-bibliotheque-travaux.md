# T42 — Bibliothèque : travaux prévus et écartements partout

**Objectif** : retour de Théophane (2026-10-19), après avoir reçu la bibliothèque (T41) : « ce n'est pas complet, ça ne note pas les travaux à faire ; pour les carottes, etc., on n'a pas les écartements ».

**Dépend de** : T41, T41b (mise à jour par nouvelle migration), T22 (travaux prévus), T23 (types d'intervention)
**Périmètre** : `packages/db/bibliotheque/depart.json`, nouvelle migration de bibliothèque (`pnpm --filter @planif/db bibliotheque 0034_…`), `packages/db/src/bibliotheque*.ts` si la conversion des travaux manque, `apps/web/src/ecrans/itineraires/**` (affichage), tests, `docs/modele-donnees.md`
**Priorité** : haute (retour d'usage).

## Règle

1. **Travaux prévus pour chacun des 46 itinéraires** (`travauxPrevus`, T22), conduite maraîchère bio sur planches permanentes, valeurs usuelles « à vérifier », issues de sources **publiques** (fiches ITAB, GRAB, chambres d'agriculture, Agrobio, semenciers) — **jamais** la Masterclass / Institut Jardinier-Maraîcher. Catégories et libellés de la liste de départ (`TYPES_INTERVENTION_PAR_DEFAUT` : travail du sol, couverture, fertilisation, amendement, entretien). Typiquement : préparation de planche ou grelinette avant la mise en place, amendement (compost, avec produit et quantité obligatoires), fertilisation si la culture est exigeante (produit et quantité), paillage ou bâchage selon la culture, désherbage / binage répété jusqu'à la fermeture du couvert, éclaircissage (carotte, betterave, navet), buttage (pomme de terre, poireau), palissage, taille, effeuillage (tomate, concombre, aubergine, poivron sous abri), protection (« autre » : filet anti-insectes sur choux, carottes, navets, radis). Repères et décalages en jours ; répétitions tous les N jours jusqu'à un repère de fin. Temps estimé quand une source le permet, sinon absent. Sources ajoutées au champ `sources` de chaque itinéraire.
2. **Écartements partout** : les semis directs de graines « comptables » (carotte, radis, navet, épinard, haricot, pois, betterave si concernée) passent à la densité **à l'écartement** (rangs par planche, écartement sur le rang en cm, graines par poquet) ; les fines graines semées en ligne continue (mesclun, roquette, aneth, coriandre) restent au mètre linéaire.
3. **Affichage** : l'écran Itinéraires montre pour toute densité les rangs par planche et l'écart entre rangs (planche de 75 cm, ou largeur de planche de la ferme si connue) ; au mètre linéaire, aussi l'écart moyen équivalent entre graines sur le rang (« ≈ 2 cm »).
4. Tout passe par une **nouvelle migration** de bibliothèque (mécanique de T41b), rejouable, qui ne touche aucune ligne de ferme ni les copies déjà faites par une ferme.

## Critères d'acceptation

- [x] Test : les 46 itinéraires ont au moins 3 travaux prévus, tous valides pour le cœur (produit et quantité en fertilisation et amendement, repères connus, libellés de la liste de départ).
- [x] Test : carotte, radis, navet, épinard, haricot, pois sont à l'écartement avec rangs, écartement et graines par poquet.
- [x] Test d'intégration : la migration met à jour la bibliothèque, aucune ligne de ferme touchée, rejouable.
- [x] Test d'écran : l'écart entre rangs et l'écart équivalent sur le rang s'affichent.
- [x] Aucune trace de Masterclass ; `pnpm verif` passe.
