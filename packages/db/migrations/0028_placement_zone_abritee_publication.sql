-- T28a : une zone abritée par un bâtiment n'a pas de contour à elle (Q31), et batiment dans la
-- publication PowerSync.
--
-- La forme d'une zone abritée est le rectangle de son bâtiment : un bâtiment non supprimé ne
-- peut pas viser une zone qui a un contour, et une zone abritée ne peut pas recevoir de contour.
-- L'écran (T28b) efface le contour, avec confirmation, avant de rattacher le bâtiment.
-- Refus en check_violation (23514), comme les autres règles rejouées par la base.
--
-- Concurrence : le bâtiment pose un verrou partagé sur la ligne de sa zone (FOR SHARE), qui
-- attend une modification en cours du contour ; chaque requête du déclencheur relit l'état
-- validé (READ COMMITTED). Les deux écritures ne peuvent donc pas passer ensemble.

CREATE FUNCTION verifier_batiment_zone_sans_contour() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.zone_id IS NOT NULL AND NEW.supprime_le IS NULL THEN
    PERFORM 1 FROM zone WHERE id = NEW.zone_id AND contour IS NOT NULL FOR SHARE;
    IF FOUND THEN
      RAISE EXCEPTION 'la zone % a un contour : effacer le contour avant de la faire abriter par un bâtiment', NEW.zone_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER batiment_zone_sans_contour
BEFORE INSERT OR UPDATE OF zone_id, supprime_le ON batiment
FOR EACH ROW EXECUTE FUNCTION verifier_batiment_zone_sans_contour();
--> statement-breakpoint

CREATE FUNCTION verifier_zone_abritee_sans_contour() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contour IS NOT NULL THEN
    PERFORM 1 FROM batiment WHERE zone_id = NEW.id AND supprime_le IS NULL;
    IF FOUND THEN
      RAISE EXCEPTION 'la zone % est abritée par un bâtiment : elle n''a pas de contour à elle', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER zone_abritee_sans_contour
BEFORE INSERT OR UPDATE OF contour ON zone
FOR EACH ROW EXECUTE FUNCTION verifier_zone_abritee_sans_contour();
--> statement-breakpoint

-- batiment descend sur les téléphones (règles de synchro : les bâtiments de la ferme à ses
-- membres, même découpage que zone).
ALTER PUBLICATION powersync ADD TABLE batiment;
