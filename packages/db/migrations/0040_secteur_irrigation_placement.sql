-- T57 : position des vannes sur le plan (repère de la ferme, mètres ; les deux nulles : en tête de
-- leur première planche), numéro de vanne de 1 à 9 999 et unique par ferme parmi les vannes non
-- supprimées. Numéro 0040 : 0037 et 0038 sont prises par T51, 0039 était réservée à T52.
ALTER TABLE "secteur_irrigation" ADD COLUMN "placement_x_m" numeric;--> statement-breakpoint
ALTER TABLE "secteur_irrigation" ADD COLUMN "placement_y_m" numeric;--> statement-breakpoint
CREATE UNIQUE INDEX "secteur_irrigation_numero_actif_idx" ON "secteur_irrigation" USING btree ("ferme_id","numero_vanne") WHERE "secteur_irrigation"."supprime_le" IS NULL;--> statement-breakpoint
ALTER TABLE "secteur_irrigation" ADD CONSTRAINT "secteur_irrigation_numero_valide" CHECK ("secteur_irrigation"."numero_vanne" >= 1 AND "secteur_irrigation"."numero_vanne" <= 9999);--> statement-breakpoint
ALTER TABLE "secteur_irrigation" ADD CONSTRAINT "secteur_irrigation_placement_tout_ou_rien" CHECK (("secteur_irrigation"."placement_x_m" IS NULL) = ("secteur_irrigation"."placement_y_m" IS NULL));--> statement-breakpoint
ALTER TABLE "secteur_irrigation" ADD CONSTRAINT "secteur_irrigation_placement_distance" CHECK ("secteur_irrigation"."placement_x_m" IS NULL OR "secteur_irrigation"."placement_y_m" IS NULL OR "secteur_irrigation"."placement_x_m" * "secteur_irrigation"."placement_x_m" + "secteur_irrigation"."placement_y_m" * "secteur_irrigation"."placement_y_m" <= 25000000);