ALTER TABLE "batiment" ADD COLUMN "nb_chapelles" integer;--> statement-breakpoint
ALTER TABLE "batiment" ADD COLUMN "nb_troncons" integer;--> statement-breakpoint
ALTER TABLE "batiment" ADD COLUMN "largeur_allee_m" numeric;--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_nb_chapelles" CHECK ("batiment"."nb_chapelles" >= 1 AND "batiment"."nb_chapelles" <= 100);--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_nb_troncons" CHECK ("batiment"."nb_troncons" >= 1 AND "batiment"."nb_troncons" <= 50);--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_largeur_allee" CHECK ("batiment"."largeur_allee_m" >= 0 AND "batiment"."largeur_allee_m" <= 500 AND "batiment"."largeur_allee_m" = round("batiment"."largeur_allee_m", 3));--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_grille" CHECK ("batiment"."longueur_m" - (coalesce("batiment"."nb_troncons", 1) - 1) * coalesce("batiment"."largeur_allee_m", 0) > 0);