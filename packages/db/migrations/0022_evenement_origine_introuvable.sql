-- T10h, décision 1 du chef après la relecture (B1) : origine introuvable à l'insertion
-- (migration personnalisée, drizzle-kit generate --custom). Remplace la fonction de 0020 sans
-- toucher à 0020, que des bases ont peut-être déjà jouée.
--
-- Si l'événement remplacé n'est pas lisible par le déclencheur (absent, ou pas encore validé par
-- une autre transaction), on lève une erreur de référence (23503) au lieu de retomber sur le
-- parent : sinon, dans un INSERT … SELECT où la clé étrangère (vérifiée en fin d'instruction)
-- finit par voir le parent validé entre-temps, la ligne serait écrite avec origine_id = parent et
-- formerait une chaîne à part (deux lignes en vigueur pour la même récolte). L'API refuse comme
-- pour un parent absent ; le téléphone renverra.
--
-- Décision 5 (N4) : toute future migration qui touche à `evenement_ajout_seul` (par exemple pour
-- réécrire des lignes de `evenement`) doit recalculer `interne.chaine_evenement` dans la même
-- migration (comme la reprise de 0020), sinon la vue evenements_en_vigueur ment.

CREATE OR REPLACE FUNCTION remplir_origine_evenement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origine uuid;
BEGIN
  IF NEW.remplace_evenement_id IS NULL THEN
    NEW.origine_id := NEW.id;
    RETURN NEW;
  END IF;
  SELECT e.origine_id INTO origine FROM evenement e WHERE e.id = NEW.remplace_evenement_id;
  IF origine IS NULL THEN
    RAISE EXCEPTION 'événement % : l''événement remplacé % est introuvable', NEW.id, NEW.remplace_evenement_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.origine_id := origine;
  RETURN NEW;
END;
$$;
