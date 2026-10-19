ALTER TABLE "emplacement" DROP CONSTRAINT "emplacement_places_de_gouttiere";--> statement-breakpoint
ALTER TABLE "emplacement" ADD COLUMN "nombre_pains" integer;--> statement-breakpoint
-- T51 (retouche, avant les CHECK) : une gouttière existante reçoit 1 pain par mètre, longueur
-- arrondie (au moins 1) ; son ancien nombre de places est gardé, en lecture seule.
UPDATE "emplacement" SET "nombre_pains" = GREATEST(1, round("longueur_m"))::integer WHERE "sorte" = 'gouttiere';--> statement-breakpoint
-- T51 : une occupation de gouttière se compte désormais en pains, la même part de la gouttière
-- (60 places sur 120, gouttière de 30 pains → 15 pains). Les occupations de planche ne sont pas touchées.
UPDATE "occupation" o
   SET "nombre_places" = GREATEST(1, LEAST(e."nombre_pains", round(o."nombre_places"::numeric * e."nombre_pains" / e."nombre_places")))::integer
  FROM "emplacement" e
 WHERE o."emplacement_id" = e."id" AND e."sorte" = 'gouttiere' AND o."nombre_places" IS NOT NULL AND e."nombre_places" IS NOT NULL
   AND o."nombre_places" <> GREATEST(1, LEAST(e."nombre_pains", round(o."nombre_places"::numeric * e."nombre_pains" / e."nombre_places")))::integer;--> statement-breakpoint
ALTER TABLE "emplacement" ADD CONSTRAINT "emplacement_pains_de_gouttiere" CHECK (("emplacement"."sorte" = 'gouttiere') = ("emplacement"."nombre_pains" IS NOT NULL) AND ("emplacement"."nombre_pains" IS NULL OR "emplacement"."nombre_pains" > 0));--> statement-breakpoint
ALTER TABLE "emplacement" ADD CONSTRAINT "emplacement_places_de_gouttiere" CHECK ("emplacement"."nombre_places" IS NULL OR ("emplacement"."sorte" = 'gouttiere' AND "emplacement"."nombre_places" > 0));