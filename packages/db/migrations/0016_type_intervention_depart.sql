-- T23 : types d'intervention dans la publication PowerSync, et liste de départ.
--
-- type_intervention descend sur les téléphones (règles de synchro : les types de la ferme à ses
-- membres, la liste de départ à tous).
ALTER PUBLICATION powersync ADD TABLE type_intervention;
--> statement-breakpoint

-- Liste de départ (modèle de données, section 5) : TYPES_INTERVENTION_PAR_DEFAUT de @planif/core,
-- une ligne à ferme_id nul par couple (catégorie, libellé), en lecture seule comme la
-- bibliothèque (l'API refuse toute écriture du téléphone sur ces lignes). Identifiant tiré du
-- couple (md5) : le même sur toutes les bases, et rejouer l'insertion n'ajoute rien.
-- type-intervention.integration.test.ts vérifie l'accord avec @planif/core.
INSERT INTO type_intervention (id, ferme_id, categorie, libelle)
SELECT md5('type_intervention:' || d.categorie || ':' || d.libelle)::uuid, NULL, d.categorie, d.libelle
FROM (VALUES
  ('travail_sol', 'labour'),
  ('travail_sol', 'décompactage'),
  ('travail_sol', 'grelinette'),
  ('travail_sol', 'rotobêche'),
  ('travail_sol', 'herse'),
  ('travail_sol', 'buttage'),
  ('travail_sol', 'préparation de planche'),
  ('travail_sol', 'faux semis'),
  ('couverture', 'paillage'),
  ('couverture', 'bâchage ou occultation'),
  ('couverture', 'solarisation'),
  ('fertilisation', 'engrais'),
  ('amendement', 'compost'),
  ('amendement', 'fumier'),
  ('entretien', 'désherbage'),
  ('entretien', 'taille'),
  ('entretien', 'palissage'),
  ('entretien', 'effeuillage'),
  ('entretien', 'éclaircissage'),
  ('entretien', 'autre')
) AS d (categorie, libelle)
ON CONFLICT (id) DO NOTHING;
