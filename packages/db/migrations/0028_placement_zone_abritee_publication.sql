-- T28a : une zone abritée par un bâtiment n'a pas de contour à elle (Q31), et batiment dans la
-- publication PowerSync.
--
-- La forme d'une zone abritée est le rectangle de son bâtiment : un bâtiment non supprimé ne
-- peut pas viser une zone qui a un contour, et une zone abritée ne peut pas recevoir de contour.
-- L'écran (T28b) efface le contour, avec confirmation, avant de rattacher le bâtiment.
-- Refus en check_violation (23514), comme les autres règles rejouées par la base.
--
-- Concurrence (relecture B1) : le bâtiment pose TOUJOURS un verrou partagé sur la ligne de sa
-- zone (FOR SHARE), quel que soit son contour, avant de lire ce contour.
--   - Contour en cours de modification (non validé) : le verrou attend la fin de cette
--     transaction, puis relit la version validée de la ligne (READ COMMITTED) : contour vu, refus.
--   - Bâtiment rattaché (non validé) : son verrou partagé fait attendre l'UPDATE du contour, dont
--     le déclencheur s'exécute ensuite avec un nouvel instantané et voit le bâtiment validé : refus.
-- Les deux écritures ne peuvent donc pas passer ensemble, dans un ordre comme dans l'autre.
-- (Un verrou conditionné par « contour IS NOT NULL » ne verrouillait rien quand le contour
-- n'était pas encore validé : c'était la faille.)

CREATE FUNCTION verifier_batiment_zone_sans_contour() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a_contour boolean;
BEGIN
  IF NEW.zone_id IS NOT NULL AND NEW.supprime_le IS NULL THEN
    -- Verrou sans condition sur la zone, puis lecture de la version validée de son contour.
    SELECT contour IS NOT NULL INTO a_contour FROM zone WHERE id = NEW.zone_id FOR SHARE;
    IF a_contour THEN
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
    -- La ligne de la zone est déjà verrouillée par cet UPDATE : un bâtiment en cours de
    -- rattachement l'a verrouillée en partage avant (l'UPDATE l'a attendu) ou l'attendra (son
    -- déclencheur verra alors ce contour). Nouvel instantané : les bâtiments validés sont vus.
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
