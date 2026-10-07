CREATE TABLE "batiment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"type" text NOT NULL,
	"longueur_m" numeric NOT NULL,
	"largeur_m" numeric NOT NULL,
	"hauteur_m" numeric NOT NULL,
	"centre_x_m" numeric NOT NULL,
	"centre_y_m" numeric NOT NULL,
	"orientation_deg" numeric NOT NULL,
	"zone_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "batiment_type" CHECK ("batiment"."type" IN ('serre_tunnel', 'serre_chapelle', 'hangar', 'magasin', 'autre')),
	CONSTRAINT "batiment_longueur" CHECK ("batiment"."longueur_m" > 0 AND "batiment"."longueur_m" <= 500),
	CONSTRAINT "batiment_largeur" CHECK ("batiment"."largeur_m" > 0 AND "batiment"."largeur_m" <= 200),
	CONSTRAINT "batiment_hauteur" CHECK ("batiment"."hauteur_m" > 0 AND "batiment"."hauteur_m" <= 30),
	CONSTRAINT "batiment_orientation" CHECK ("batiment"."orientation_deg" >= 0 AND "batiment"."orientation_deg" < 360),
	CONSTRAINT "batiment_distance" CHECK ("batiment"."centre_x_m" * "batiment"."centre_x_m" + "batiment"."centre_y_m" * "batiment"."centre_y_m" <= 25000000)
);
--> statement-breakpoint
ALTER TABLE "emplacement" ADD COLUMN "placement_x_m" numeric;--> statement-breakpoint
ALTER TABLE "emplacement" ADD COLUMN "placement_y_m" numeric;--> statement-breakpoint
ALTER TABLE "emplacement" ADD COLUMN "orientation_deg" numeric;--> statement-breakpoint
ALTER TABLE "ferme" ADD COLUMN "origine_plan" jsonb;--> statement-breakpoint
ALTER TABLE "zone" ADD COLUMN "contour" jsonb;--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_zone_meme_ferme_fk" FOREIGN KEY ("ferme_id","zone_id") REFERENCES "public"."zone"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batiment_ferme_idx" ON "batiment" USING btree ("ferme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batiment_zone_actif_idx" ON "batiment" USING btree ("zone_id") WHERE "batiment"."supprime_le" IS NULL;--> statement-breakpoint
ALTER TABLE "emplacement" ADD CONSTRAINT "emplacement_placement_tout_ou_rien" CHECK (("emplacement"."placement_x_m" IS NULL) = ("emplacement"."placement_y_m" IS NULL) AND ("emplacement"."placement_y_m" IS NULL) = ("emplacement"."orientation_deg" IS NULL));--> statement-breakpoint
ALTER TABLE "emplacement" ADD CONSTRAINT "emplacement_orientation" CHECK ("emplacement"."orientation_deg" IS NULL OR ("emplacement"."orientation_deg" >= 0 AND "emplacement"."orientation_deg" < 360));--> statement-breakpoint
ALTER TABLE "emplacement" ADD CONSTRAINT "emplacement_placement_distance" CHECK ("emplacement"."placement_x_m" IS NULL OR "emplacement"."placement_y_m" IS NULL OR "emplacement"."placement_x_m" * "emplacement"."placement_x_m" + "emplacement"."placement_y_m" * "emplacement"."placement_y_m" <= 25000000);--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_contour_valide" CHECK (contour_zone_valide("zone"."contour"));