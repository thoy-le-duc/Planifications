-- T10h : « en vigueur » sans récursion (migration personnalisée, drizzle-kit generate --custom).
--
-- Relecture T10g : la récursion de 0018 partait de toutes les origines de toutes les fermes, et
-- un filtre par ferme ou par id ne descendait pas (4,2 s pour `WHERE id = …`, 1,4 s pour une
-- ferme vide, sur 200 000 événements). La base tient désormais elle-même, à chaque insertion,
-- quel que soit l'écrivain (API, SQL brut) :
--   1. evenement.origine_id (colonne de 0019) : l'événement lui-même s'il ne remplace rien, sinon
--      l'origine de l'événement remplacé. Le journal est en ajout seul et un remplacement vise un
--      événement déjà écrit (clé étrangère non différée) : l'origine ne change jamais après coup.
--   2. interne.chaine_evenement (table de 0019) : une ligne par chaîne, avec la règle de T10g
--      (décision 4) déjà appliquée, la même que lireChaine (apps/api) et enVigueur (téléphone) :
--        - la chaîne contient une annulation (de l'origine ou de n'importe quelle correction) :
--          rien n'est en vigueur (annulee) ;
--        - sinon UNE seule ligne : la correction la plus récente de TOUTE la chaîne (horodatage,
--          puis id le plus grand), à défaut l'origine (en_vigueur_id).
--      Tenue par un déclencheur AFTER INSERT : une ligne écartée par ON CONFLICT DO NOTHING (renvoi
--      d'un lot) ne la touche pas. Deux remplacements simultanés d'une même chaîne passent l'un
--      après l'autre sur le verrou de sa ligne, et le second relit la ligne à jour (UPDATE … WHERE
--      réévalué) : la plus récente gagne quel que soit l'ordre d'arrivée.
--   3. Les lignes déjà écrites sont reprises une fois, ici.
--   4. evenements_en_vigueur lit la chaîne tenue : par ferme comme par id, quelques ms.

-- 1 et 2. Déclencheurs -------------------------------------------------------------------------

CREATE FUNCTION remplir_origine_evenement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origine uuid;
BEGIN
  IF NEW.remplace_evenement_id IS NULL THEN
    NEW.origine_id := NEW.id;
    RETURN NEW;
  END IF;
  SELECT e.origine_id INTO origine FROM evenement e WHERE e.id = NEW.remplace_evenement_id;
  -- Événement remplacé absent : la clé étrangère refusera la ligne (23503) ; une valeur non
  -- nulle ici évite qu'evenement_origine_remplie ne réponde à sa place (23514).
  NEW.origine_id := coalesce(origine, NEW.remplace_evenement_id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evenement_origine
  BEFORE INSERT ON evenement
  FOR EACH ROW EXECUTE FUNCTION remplir_origine_evenement();
--> statement-breakpoint
CREATE FUNCTION tenir_chaine_evenement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.remplace_sorte IS NULL THEN
    INSERT INTO interne.chaine_evenement (origine_id, ferme_id, en_vigueur_id, en_vigueur_horodatage)
    VALUES (NEW.id, NEW.ferme_id, NEW.id, NEW.horodatage);
  ELSIF NEW.remplace_sorte = 'annulation' THEN
    UPDATE interne.chaine_evenement SET annulee = true
    WHERE origine_id = NEW.origine_id AND NOT annulee;
  ELSE
    -- Correction : elle passe devant l'origine, et devant toute correction plus ancienne.
    UPDATE interne.chaine_evenement SET en_vigueur_id = NEW.id, en_vigueur_horodatage = NEW.horodatage
    WHERE origine_id = NEW.origine_id
      AND (en_vigueur_id = origine_id OR (en_vigueur_horodatage, en_vigueur_id) < (NEW.horodatage, NEW.id));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evenement_chaine
  AFTER INSERT ON evenement
  FOR EACH ROW EXECUTE FUNCTION tenir_chaine_evenement();
--> statement-breakpoint

-- 3. Lignes existantes ------------------------------------------------------------------------
-- Aucune écriture concurrente pendant la reprise. La mise à jour passe outre l'ajout seul, le
-- temps de cette migration seulement.

LOCK TABLE evenement IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE evenement DISABLE TRIGGER evenement_ajout_seul;
--> statement-breakpoint
WITH RECURSIVE chaine(id, origine) AS (
  SELECT o.id, o.id FROM evenement o WHERE o.remplace_evenement_id IS NULL
  UNION ALL
  SELECT e.id, c.origine FROM evenement e JOIN chaine c ON e.remplace_evenement_id = c.id
)
UPDATE evenement e SET origine_id = c.origine
FROM chaine c
WHERE e.id = c.id AND e.origine_id IS DISTINCT FROM c.origine;
--> statement-breakpoint
ALTER TABLE evenement ENABLE TRIGGER evenement_ajout_seul;
--> statement-breakpoint
INSERT INTO interne.chaine_evenement (origine_id, ferme_id, en_vigueur_id, en_vigueur_horodatage, annulee)
SELECT k.origine_id, k.ferme_id, k.id, k.horodatage, k.annulee
FROM (
  SELECT e.origine_id, e.ferme_id, e.id, e.horodatage,
    bool_or(e.remplace_sorte IS NOT DISTINCT FROM 'annulation') OVER (PARTITION BY e.origine_id) AS annulee,
    row_number() OVER (
      PARTITION BY e.origine_id
      -- Corrections d'abord (la plus récente), sinon l'origine, jamais une annulation.
      ORDER BY (e.remplace_sorte = 'correction') IS TRUE DESC, e.remplace_sorte IS NULL DESC, e.horodatage DESC, e.id DESC
    ) AS rang
  FROM evenement e
) k
WHERE k.rang = 1
ON CONFLICT (origine_id) DO NOTHING;
--> statement-breakpoint

-- 4. Vue ----------------------------------------------------------------------------------------
-- Mêmes colonnes, même ordre que 0018 (les colonnes de evenement avant origine_id, nommées) :
-- CREATE OR REPLACE garde les vues qui en dépendent (recoltes, interventions, traitements), et la
-- lecture d'une ferme n'a pas une colonne de plus à transmettre. `k.ferme_id = e.ferme_id` (vrai
-- par la clé étrangère composée) laisse un filtre par ferme descendre dans la table des chaînes.

CREATE OR REPLACE VIEW evenements_en_vigueur AS
SELECT e.id, e.ferme_id, e.type, e.date, e.horodatage, e.auteur_id, e.source, e.serie_id, e.campagne_id,
  e.emplacement_ids, e.note, e.photos, e.remplace_sorte, e.remplace_evenement_id, e.detail, e.cree_le
FROM evenement e
JOIN interne.chaine_evenement k ON k.en_vigueur_id = e.id AND k.ferme_id = e.ferme_id
WHERE NOT k.annulee;
