-- Mise à jour de la bibliothèque commune (ferme_id nul), migration 0038_bibliotheque_fraise_hors_sol (procédure T41b).
--
-- Généré depuis packages/db/bibliotheque/depart.json par `pnpm --filter @planif/db bibliotheque 0038_bibliotheque_fraise_hors_sol`
-- (packages/db/src/bibliotheque.ts) : ne pas modifier à la main, bibliotheque-suites.test.ts vérifie ce
-- texte. INSERT … ON CONFLICT (id) DO UPDATE réservé aux lignes à ferme_id nul, qui ne réécrit pas une
-- ligne déjà juste ; une ligne retirée du JSON est marquée supprimée (supprime_le), jamais effacée.
-- Les copies faites par les fermes ne changent pas.
--
-- Changements :
-- « Rosacées » (famille) : ajoutée
-- « fraise » (espece) : ajoutée
-- « Fraise hors-sol en gouttière » (itineraire) : ajoutée
INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES
  ('f4c69405-51a7-88eb-ef5d-3c662efb5e94'::uuid, NULL, 'Rosacées', 3, 4)
ON CONFLICT (id) DO UPDATE SET nom = EXCLUDED.nom, delai_retour_minimal_ans = EXCLUDED.delai_retour_minimal_ans, delai_retour_conseille_ans = EXCLUDED.delai_retour_conseille_ans, supprime_le = NULL, modifie_le = now()
WHERE famille.ferme_id IS NULL AND (famille.nom, famille.delai_retour_minimal_ans, famille.delai_retour_conseille_ans, famille.supprime_le) IS DISTINCT FROM (EXCLUDED.nom, EXCLUDED.delai_retour_minimal_ans, EXCLUDED.delai_retour_conseille_ans, NULL::timestamptz);
--> statement-breakpoint
INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, delai_retour_minimal_ans, delai_retour_conseille_ans, profil_croissance) VALUES
  ('2aa0c687-1d08-139a-7ac3-0c14c2cdea5e'::uuid, NULL, 'f4c69405-51a7-88eb-ef5d-3c662efb5e94'::uuid, 'fraise', 'petit_fruit', false, 'kg', NULL, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET famille_id = EXCLUDED.famille_id, nom = EXCLUDED.nom, categorie = EXCLUDED.categorie, perenne = EXCLUDED.perenne, unite_recolte = EXCLUDED.unite_recolte, delai_retour_minimal_ans = EXCLUDED.delai_retour_minimal_ans, delai_retour_conseille_ans = EXCLUDED.delai_retour_conseille_ans, profil_croissance = EXCLUDED.profil_croissance, supprime_le = NULL, modifie_le = now()
WHERE espece.ferme_id IS NULL AND (espece.famille_id, espece.nom, espece.categorie, espece.perenne, espece.unite_recolte, espece.delai_retour_minimal_ans, espece.delai_retour_conseille_ans, espece.profil_croissance, espece.supprime_le) IS DISTINCT FROM (EXCLUDED.famille_id, EXCLUDED.nom, EXCLUDED.categorie, EXCLUDED.perenne, EXCLUDED.unite_recolte, EXCLUDED.delai_retour_minimal_ans, EXCLUDED.delai_retour_conseille_ans, EXCLUDED.profil_croissance, NULL::timestamptz);
--> statement-breakpoint
INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres) VALUES
  ('f8197690-04a0-0fc9-22b5-24bb5ec917fc'::uuid, NULL, '2aa0c687-1d08-139a-7ac3-0c14c2cdea5e'::uuid, NULL, 'Fraise hors-sol en gouttière', 'plant_achete', '{"mode":"plant_achete","periodeUsage":{"semaineDebut":2,"semaineFin":10},"typeAbri":"hors_sol","dureeAvantRecolteJours":65,"fenetreRecolteJours":75,"margeSecurite":5,"rendementAttendu":{"par":"plant","quantite":0.5,"unite":"kg"},"perenne":null,"travauxPrevus":[{"categorie":"entretien","type":"taille","repere":"mise_en_place","decalageJours":14,"repetition":{"tousLesJours":14,"repereFin":"fin_recolte"},"outil":"sécateur","produit":null,"tempsEstime":null},{"categorie":"entretien","type":"effeuillage","repere":"debut_recolte","decalageJours":0,"repetition":{"tousLesJours":21,"repereFin":"fin_recolte"},"outil":"sécateur","produit":null,"tempsEstime":null}],"densite":{"facon":"contenants","trousParContenant":12}}'::jsonb)
ON CONFLICT (id) DO UPDATE SET espece_id = EXCLUDED.espece_id, variete_id = EXCLUDED.variete_id, nom = EXCLUDED.nom, mode = EXCLUDED.mode, parametres = EXCLUDED.parametres, supprime_le = NULL, modifie_le = now()
WHERE itineraire.ferme_id IS NULL AND (itineraire.espece_id, itineraire.variete_id, itineraire.nom, itineraire.mode, itineraire.parametres, itineraire.supprime_le) IS DISTINCT FROM (EXCLUDED.espece_id, EXCLUDED.variete_id, EXCLUDED.nom, EXCLUDED.mode, EXCLUDED.parametres, NULL::timestamptz);
