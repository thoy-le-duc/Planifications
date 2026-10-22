# T82 — Modifier les équipements d'une serre (écran)

**Objectif** : suite de la relecture de T58. Chaque zone abritée reçoit une liste d'équipements par défaut selon son type (tunnel et hors-sol : ouvrants latéraux, portes, voile ; serre : les cinq). La règle 1 de T58 la dit « modifiable », mais aucun écran ne permet de la changer : un tunnel sans voile, ou des gouttières hors-sol en plein air, affichent des ouvrants qui n'existent pas.

**Dépend de** : T58
**Périmètre** : `apps/web/src/ecrans/ferme/**` (ou l'écran des zones de T49), tests
**Priorité** : moyenne. **Domaine critique** : non (la colonne `zone.equipements_abri`, son contrôle serveur et sa synchro existent déjà depuis T58 ; ce ticket n'ajoute qu'un écran).

## Règles

1. Dans la fiche d'une zone (onglet Ferme, zones), une section « Équipements » propose cinq cases : ouvrants latéraux, ouvrants de faîtage, portes, chauffage, voile ou filet. Elles sont pré-cochées selon la liste en vigueur (la liste par défaut si la colonne est nulle).
2. « Revenir aux équipements par défaut » remet la colonne à nulle.
3. Un équipement décoché disparaît du panneau « Serres », de la 3D et du rappel du soir. Ses événements passés restent dans le journal et l'export.
4. Une zone de plein champ n'a pas cette section.

## Critères d'acceptation

- [ ] Test d'écran : décocher « voile » sur un tunnel → `equipements_abri` = liste sans voile ; le panneau Serres ne montre plus la voile.
- [ ] Test : « Revenir aux équipements par défaut » → colonne nulle.
- [ ] Test : zone de plein champ sans section Équipements.
- [ ] `pnpm verif` passe.
