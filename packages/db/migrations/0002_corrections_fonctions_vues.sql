-- Corrections après relecture (migration personnalisée, drizzle-kit generate --custom).
--   1. est_date_calendaire(text) : date 'AAAA-MM-JJ' qui existe au calendrier, sans lever
--      d'erreur (les CHECK du détail jsonb, migration suivante, s'en servent).
--   2. Un remplacement (correction, annulation) est du même type que l'événement remplacé.
--      La même ferme est garantie par la clé étrangère composée (migration suivante).
--   3. evenements_en_vigueur : d'un événement corrigé plusieurs fois, seule la correction la
--      plus récente (horodatage, puis id le plus grand) reste ; une correction dont l'origine
--      est annulée disparaît aussi.

CREATE FUNCTION est_date_calendaire(t text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
BEGIN
  IF t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN false;
  END IF;
  RETURN to_char(make_date(substr(t, 1, 4)::int, substr(t, 6, 2)::int, substr(t, 9, 2)::int), 'YYYY-MM-DD') = t;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION verifier_remplacement_evenement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  type_remplace text;
BEGIN
  IF NEW.remplace_evenement_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT e.type INTO type_remplace FROM evenement e WHERE e.id = NEW.remplace_evenement_id;
  -- Événement absent : la clé étrangère le refusera (23503).
  IF FOUND AND type_remplace <> NEW.type THEN
    RAISE EXCEPTION 'événement % : un événement de type % ne remplace pas un événement de type %',
      NEW.id, NEW.type, type_remplace
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evenement_remplacement_meme_type
  BEFORE INSERT ON evenement
  FOR EACH ROW EXECUTE FUNCTION verifier_remplacement_evenement();
--> statement-breakpoint
CREATE OR REPLACE VIEW evenements_en_vigueur AS
SELECT e.*
FROM evenement e
WHERE e.remplace_sorte IS DISTINCT FROM 'annulation'
  -- Ni annulé ni corrigé.
  AND NOT EXISTS (SELECT 1 FROM evenement r WHERE r.remplace_evenement_id = e.id)
  -- Correction : aucune correction plus récente du même événement, et origine non annulée.
  AND NOT EXISTS (
    SELECT 1 FROM evenement s
    WHERE e.remplace_sorte = 'correction'
      AND s.remplace_evenement_id = e.remplace_evenement_id
      AND (s.remplace_sorte = 'annulation'
           OR (s.horodatage, s.id) > (e.horodatage, e.id))
  );
