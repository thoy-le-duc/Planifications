-- T28a : bornes simples du contour d'une zone (docs/modele-donnees.md, v1.x ; Q31).
--
-- Utilisée par la contrainte CHECK `zone_contour_valide` (migration suivante, générée) : un
-- tableau jsonb de 3 à 200 sommets, chacun un objet dont x et y sont des nombres, à 5 000 m au
-- plus de l'origine du plan ; texte jsonb de 16 384 caractères au plus (taille bornée). Les
-- règles géométriques (sommets confondus, auto-intersection, aire, sens) restent au serveur,
-- qui appelle validerContour de @planif/core (T28s). Un contour nul est accepté (zone pas
-- placée, ou abritée par un bâtiment).
--
-- IMMUTABLE : ne lit que son argument. Ne lève jamais : faux pour toute entrée mal formée.
CREATE FUNCTION contour_zone_valide(contour jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  sommet jsonb;
BEGIN
  IF contour IS NULL THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(contour) <> 'array' THEN
    RETURN false;
  END IF;
  IF length(contour::text) > 16384 OR jsonb_array_length(contour) NOT BETWEEN 3 AND 200 THEN
    RETURN false;
  END IF;
  FOR sommet IN SELECT jsonb_array_elements(contour) LOOP
    IF jsonb_typeof(sommet) <> 'object'
      OR jsonb_typeof(sommet -> 'x') IS DISTINCT FROM 'number'
      OR jsonb_typeof(sommet -> 'y') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    IF (sommet ->> 'x')::numeric * (sommet ->> 'x')::numeric + (sommet ->> 'y')::numeric * (sommet ->> 'y')::numeric > 25000000 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
