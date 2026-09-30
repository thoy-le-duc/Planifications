-- T10g (Q20, décision 4 du chef) : « en vigueur » suit toute la chaîne d'un événement
-- (migration personnalisée, drizzle-kit generate --custom).
--
-- Chaîne : l'origine (sans remplace_evenement_id), ses corrections, les corrections de ses
-- corrections, et toutes leurs annulations. Même règle que lireChaine (apps/api/src/sync) et que
-- enVigueur du téléphone (apps/web/src/ecrans/aujourdhui/calculs.ts) :
--   - la chaîne contient une annulation (de l'origine ou de n'importe quelle correction) :
--     rien n'est en vigueur ;
--   - sinon UNE seule ligne : la correction la plus récente de TOUTE la chaîne (horodatage, puis
--     id le plus grand), à défaut l'origine. Une chaîne ramifiée (deux corrections de l'origine,
--     une correction d'une correction) n'a donc qu'une ligne en vigueur, celle du stock.
-- Avant (0002), la plus récente se cherchait parmi les corrections d'un même événement : une
-- chaîne ramifiée montrait plusieurs lignes, et l'annulation d'une correction laissait ses sœurs.
--
-- Mêmes colonnes, même ordre (e.*) : CREATE OR REPLACE garde les vues qui en dépendent
-- (recoltes, interventions, traitements). Profondeur bornée comme PROFONDEUR_MAX_CHAINE.
CREATE OR REPLACE VIEW evenements_en_vigueur AS
WITH RECURSIVE chaine(id, origine, profondeur) AS (
  SELECT o.id, o.id, 0 FROM evenement o WHERE o.remplace_evenement_id IS NULL
  UNION ALL
  SELECT e.id, c.origine, c.profondeur + 1
  FROM evenement e JOIN chaine c ON e.remplace_evenement_id = c.id
  WHERE c.profondeur < 1000
),
classement AS (
  SELECT e.id,
    bool_or(e.remplace_sorte IS NOT DISTINCT FROM 'annulation') OVER (PARTITION BY c.origine) AS annulee,
    row_number() OVER (
      PARTITION BY c.origine
      ORDER BY (e.remplace_sorte = 'correction') IS TRUE DESC, e.horodatage DESC, e.id DESC
    ) AS rang
  FROM chaine c JOIN evenement e ON e.id = c.id
)
SELECT e.*
FROM evenement e
JOIN classement k ON k.id = e.id
WHERE k.rang = 1 AND NOT k.annulee;
