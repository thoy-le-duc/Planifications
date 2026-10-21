# T53 — Produits phyto : chercher dans la base publique e-phy

**Objectif** : ne pas recopier à la main l'AMM, la substance et le DAR. La base **e-phy de l'ANSES** est publiée en données ouvertes (data.gouv.fr, Licence Ouverte 2.0, citer la source). On en tire un catalogue de recherche : taper « Success » ou « soufre » propose les produits autorisés ; un tap remplit la fiche du produit de la ferme (T52), modifiable.

**Dépend de** : T52
**Périmètre** : `packages/db` (outil d'extraction et données du catalogue), `apps/web/src/ecrans/ferme/**` (recherche), tests, `docs/modele-donnees.md`
**Priorité** : moyenne. **Modèle** : Opus (volume de données, poids).

## Règles

1. Un script sous `packages/db` lit le fichier e-phy publié (téléchargé à la main, jamais à l'exécution de l'appli) et produit un catalogue réduit : nom commercial, AMM, substances, mention bio (« utilisable en agriculture biologique »), état (autorisé / retiré), et les **usages** (culture × cible) avec dose et DAR.
2. Le DAR dépend de l'usage : à la sélection, l'appli propose l'usage qui correspond à l'espèce de la série (correspondance d'espèces simple et testée), sinon demande de choisir. Le DAR retenu va dans la fiche de la ferme.
3. Le catalogue se charge **à la demande** (pas dans le JavaScript de démarrage) et marche hors ligne une fois chargé. Budget de poids à fixer dans la PR, avec justification.
4. Produits retirés : affichés avec la mention « retiré le JJ/MM/AAAA », sélection déconseillée.
5. Source et date de la base affichées sous la recherche.

## Critères d'acceptation

- [ ] Tests de l'extraction sur un petit extrait figé (fixtures) : produit, usages, DAR, mention bio, retrait.
- [ ] Test : correspondance espèce → usage (tomate, fraise, laitue au moins).
- [ ] Test d'écran : recherche au doigt, sélection → fiche remplie et modifiable.
- [ ] Budget de démarrage inchangé ; `pnpm verif` passe.

## Format de la base publiée (relevé le 2026-10-21)

Sources :

- Jeu de données [« Données ouvertes du catalogue E-Phy… »](https://www.data.gouv.fr/fr/datasets/donnees-ouvertes-du-catalogue-e-phy-des-produits-phytopharmaceutiques-matieres-fertilisantes-et-supports-de-culture-adjuvants-produits-mixtes-et-melanges/) (Anses, Licence Ouverte 2.0, mise à jour chaque semaine dans la nuit du mardi au mercredi) : trois archives ZIP, « decisionamm-intrant-format-CSV-UTF-8 » (ressource `98f7cac6-6b29-4859-8739-51b825196959`), la même en Windows-1252, et du XML avec ses XSD. L'archive CSV contient notamment `produits`, `produits_usages`, `usages_des_produits_autorises`, `substance_active`, `produits_condition_emploi`.
- En-têtes et lignes réelles : fichiers source de la version d'octobre 2020 conservés par le projet [d2kab/E-Phy-Ontology](https://github.com/d2kab/E-Phy-Ontology) (`produits_v3_utf8.csv`, `produits_usages_v3_utf8.csv`). Séparateur « ; », CRLF, UTF-8, champs entre guillemets possibles, listes « | », dates JJ/MM/AAAA, nombres à point.
  - `produits` : `type produit`, `numero AMM`, `nom produit`, `seconds noms commerciaux`, `mentions autorisees` (dont « Utilisable en agriculture biologique »), `Substances actives` (« spinosad (Spinosad) 480.0 g/L »), `Etat d’autorisation` (AUTORISE / RETIRE), `Date de retrait du produit`… (préfixés « (produit) » dans cette version).
  - `produits_usages` : `numero AMM`, `identifiant usage` (« Tomate*Trt Part.Aer.*Thrips »), `etat usage` (Autorisé, Autorisé (Provisoire), Retrait), `dose retenue`, `dose retenue unite`, `delai avant recolte jour`, `delai avant recolte bbch`…
- Recoupé avec un tableau de la DRAAF PACA tiré d'e-phy (colonnes « dose retenue », « delai avant recolte (jours) », seconds noms séparés par « | »).

Le conteneur de développement ne joint pas data.gouv.fr : le fichier de 2026 n'a pas été vu. Le script repère les colonnes par leur nom (sans casse, accents, préfixe ni « _ ») et s'arrête avec un message qui nomme la colonne absente. **Le premier lancement réel du workflow « Catalogue e-phy » validera le format.**
