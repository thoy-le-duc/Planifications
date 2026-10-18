-- Mise à jour de la bibliothèque commune (ferme_id nul), migration 0033_bibliotheque_melon_plein_champ (procédure T41b).
--
-- Généré depuis packages/db/bibliotheque/depart.json par `pnpm --filter @planif/db bibliotheque 0033_bibliotheque_melon_plein_champ`
-- (packages/db/src/bibliotheque.ts) : ne pas modifier à la main, bibliotheque-suites.test.ts vérifie ce
-- texte. INSERT … ON CONFLICT (id) DO UPDATE réservé aux lignes à ferme_id nul, qui ne réécrit pas une
-- ligne déjà juste ; une ligne retirée du JSON est marquée supprimée (supprime_le), jamais effacée.
-- Les copies faites par les fermes ne changent pas.
--
-- Changements :
-- « Melon, plein champ (chenille conseillée) » (itineraire) : modifiée
INSERT INTO itineraire (id, ferme_id, espece_id, variete_id, nom, mode, parametres) VALUES
  ('708c2f94-7351-39b2-fc6a-c605090f5802'::uuid, NULL, '0ef6d80b-b3dc-dc45-d459-42b041eb1911'::uuid, NULL, 'Melon, plein champ (chenille conseillée)', 'plant_maison', '{"mode":"plant_maison","periodeUsage":{"semaineDebut":18,"semaineFin":23},"typeAbri":"plein_champ","dureeAvantRecolteJours":75,"fenetreRecolteJours":30,"margeSecurite":15,"rendementAttendu":{"par":"plant","quantite":2.5,"unite":"kg"},"perenne":null,"densite":{"facon":"ecartement","rangsParPlanche":1,"ecartementSurRangCm":60},"dureePepiniereJours":25,"grainesParMotte":1,"plantsParMotte":1,"pertePepiniere":10,"alveolesParPlaque":40}'::jsonb)
ON CONFLICT (id) DO UPDATE SET espece_id = EXCLUDED.espece_id, variete_id = EXCLUDED.variete_id, nom = EXCLUDED.nom, mode = EXCLUDED.mode, parametres = EXCLUDED.parametres, supprime_le = NULL, modifie_le = now()
WHERE itineraire.ferme_id IS NULL AND (itineraire.espece_id, itineraire.variete_id, itineraire.nom, itineraire.mode, itineraire.parametres, itineraire.supprime_le) IS DISTINCT FROM (EXCLUDED.espece_id, EXCLUDED.variete_id, EXCLUDED.nom, EXCLUDED.mode, EXCLUDED.parametres, NULL::timestamptz);
