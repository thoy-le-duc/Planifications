-- T61 : bornes simples du tracé d'un chemin (table `chemin`, migration 0045), comme
-- contour_zone_valide (0025) pour les zones : tableau jsonb de 2 à 200 objets {x, y} numériques,
-- à 5 000 m au plus de l'origine du plan, texte de 16 384 caractères au plus. Un chemin est une
-- ligne ouverte : ni fermeture, ni auto-intersection, ni aire. Les points confondus et la
-- géométrie fine restent au serveur (validerChemin de @planif/core).
--
-- IMMUTABLE : ne lit que son argument. Ne lève jamais : faux pour toute entrée mal formée.
-- Migration écrite à la main (drizzle-kit generate --custom), avant la table qui l'utilise.
CREATE FUNCTION chemin_points_valides(points jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  point jsonb;
BEGIN
  IF points IS NULL THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(points) <> 'array' THEN
    RETURN false;
  END IF;
  IF length(points::text) > 16384 OR jsonb_array_length(points) NOT BETWEEN 2 AND 200 THEN
    RETURN false;
  END IF;
  FOR point IN SELECT jsonb_array_elements(points) LOOP
    IF jsonb_typeof(point) <> 'object'
      OR jsonb_typeof(point -> 'x') IS DISTINCT FROM 'number'
      OR jsonb_typeof(point -> 'y') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    IF (point ->> 'x')::numeric * (point ->> 'x')::numeric + (point ->> 'y')::numeric * (point ->> 'y')::numeric > 25000000 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
