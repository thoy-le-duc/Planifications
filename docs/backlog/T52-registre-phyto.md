# T52 — Traitements phyto : saisie au champ, délai avant récolte, registre

**Objectif** : demande de Théophane (2026-10-19) : « penser aux engrais, phyto et traitements ». Le registre phytosanitaire est une **obligation légale** (et un point de contrôle bio). Le schéma existe déjà (table `produit_phyto`, événement `traitement`, vue `traitements`, synchro) : il manque l'usage. Ce ticket rend possible de **saisir un traitement en moins de 30 s au champ**, de **bloquer la récolte tant que le délai avant récolte (DAR) court**, et de **sortir le registre** en un clic.

**Dépend de** : T08 (schéma), T10 (journal), T15 (export), Aujourd'hui
**Périmètre** : `packages/core` (règle du DAR, validation), `apps/api/src/sync/**` (validation serveur si manquante), `apps/web/src/ecrans/ferme/**` (produits de la ferme), `apps/web/src/ecrans/aujourdhui/**` (saisie, alerte), `apps/web/src/ecrans/export/**` (registre), tests, `docs/modele-donnees.md`
**Priorité** : haute. **Modèle** : Opus (règle métier, synchro).

## Règles

1. **Produits de la ferme** (onglet Ferme, carte « Produits phyto ») : nom commercial, n° AMM, substance active, DAR (jours), utilisable en bio, dose maximale (facultative). Créer, modifier, archiver. Saisie manuelle dans ce ticket ; l'import depuis la base publique e-phy est T53.
2. **Saisir un traitement** depuis Aujourd'hui (bouton « Traitement ») ou une série : produit (liste de la ferme), date (aujourd'hui par défaut), emplacements (ceux de la série par défaut), dose et unité, surface traitée (calculée depuis les emplacements, modifiable), cible (texte court), opérateur (facultatif). Au doigt, hors ligne.
3. **Calcul déterministe** (cœur, testé) : `recolteAutoriseeLe = date du traitement + DAR du produit`. Le DAR utilisé est **figé dans l'événement** : modifier le produit plus tard ne change pas un traitement passé. Plusieurs traitements sur un même emplacement : la date la plus tardive l'emporte. Une correction ou une annulation du traitement recalcule.
4. **Alerte** : dans Aujourd'hui, une récolte prévue ou une saisie de récolte sur un emplacement sous DAR affiche « Récolte interdite jusqu'au JJ/MM (Produit, traité le JJ/MM) ». La saisie de récolte reste **possible**, avec une confirmation explicite (le maraîcher reste maître), et l'avertissement est gardé dans la note de l'événement.
5. **Dose maximale** : une dose au-dessus de la dose maximale déclarée affiche un avertissement, non bloquant.
6. **Registre** : dans l'onglet Ferme, « Registre phyto » liste les traitements de la saison (date, produit, AMM, dose, surface, emplacements, culture, cible, opérateur, récolte autorisée le), et l'export CSV/JSON existant gagne un fichier `registre-phyto.csv` (colonnes en français). Filtre « bio uniquement » / « non bio » utile au contrôle.

## Critères d'acceptation

- [ ] Tests cœur : DAR 3 j, traitement le 10/05 → récolte autorisée le 13/05 ; deux traitements, la plus tardive l'emporte ; annulation → l'emplacement redevient libre ; produit modifié après coup → date inchangée.
- [ ] Test : dose au-dessus du maximum → avertissement, pas de refus.
- [ ] Tests d'écran : saisie d'un traitement au doigt hors ligne, visible dans le registre ; alerte affichée sur une récolte d'un emplacement traité, confirmation exigée.
- [ ] Test serveur : un traitement sans produit, avec dose négative ou date invalide est refusé (si pas déjà couvert).
- [ ] Export : `registre-phyto.csv` présent, une ligne par traitement en vigueur, sans les annulés.
- [ ] Aujourd'hui garde son budget de temps (e2e) ; `pnpm verif` passe.
