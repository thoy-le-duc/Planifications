-- T61 : chemins, points du plan, lieux de rangement, places et outils (docs/modele-donnees.md).
-- Générée par drizzle-kit ; seule retouche : l'ajout à la publication, en fin de fichier.
CREATE TABLE "chemin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text,
	"points" jsonb NOT NULL,
	"largeur_m" numeric NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "chemin_nom" CHECK ("chemin"."nom" IS NULL OR length(btrim("chemin"."nom")) BETWEEN 1 AND 80),
	CONSTRAINT "chemin_points_valides" CHECK (chemin_points_valides("chemin"."points")),
	CONSTRAINT "chemin_largeur" CHECK ("chemin"."largeur_m" > 0 AND "chemin"."largeur_m" <= 20)
);
--> statement-breakpoint
CREATE TABLE "lieu_rangement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"batiment_id" uuid,
	"point_plan_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "lieu_rangement_ferme_id_id_unique" UNIQUE("ferme_id","id"),
	CONSTRAINT "lieu_rangement_un_element" CHECK (("lieu_rangement"."batiment_id" IS NULL) <> ("lieu_rangement"."point_plan_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "outil" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"lieu_rangement_id" uuid NOT NULL,
	"place_rangement_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "outil_nom" CHECK (length(btrim("outil"."nom")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "place_rangement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"lieu_rangement_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "place_rangement_id_lieu_unique" UNIQUE("id","lieu_rangement_id"),
	CONSTRAINT "place_rangement_nom" CHECK (length(btrim("place_rangement"."nom")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "point_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"sorte" text NOT NULL,
	"x_m" numeric NOT NULL,
	"y_m" numeric NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "point_plan_ferme_id_id_unique" UNIQUE("ferme_id","id"),
	CONSTRAINT "point_plan_nom" CHECK (length(btrim("point_plan"."nom")) BETWEEN 1 AND 80),
	CONSTRAINT "point_plan_sorte" CHECK ("point_plan"."sorte" IN ('point_eau', 'repere')),
	CONSTRAINT "point_plan_distance" CHECK ("point_plan"."x_m" * "point_plan"."x_m" + "point_plan"."y_m" * "point_plan"."y_m" <= 25000000)
);
--> statement-breakpoint
ALTER TABLE "chemin" ADD CONSTRAINT "chemin_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lieu_rangement" ADD CONSTRAINT "lieu_rangement_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lieu_rangement" ADD CONSTRAINT "lieu_rangement_batiment_meme_ferme_fk" FOREIGN KEY ("ferme_id","batiment_id") REFERENCES "public"."batiment"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lieu_rangement" ADD CONSTRAINT "lieu_rangement_point_plan_meme_ferme_fk" FOREIGN KEY ("ferme_id","point_plan_id") REFERENCES "public"."point_plan"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outil" ADD CONSTRAINT "outil_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outil" ADD CONSTRAINT "outil_lieu_meme_ferme_fk" FOREIGN KEY ("ferme_id","lieu_rangement_id") REFERENCES "public"."lieu_rangement"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outil" ADD CONSTRAINT "outil_place_du_lieu_fk" FOREIGN KEY ("place_rangement_id","lieu_rangement_id") REFERENCES "public"."place_rangement"("id","lieu_rangement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_rangement" ADD CONSTRAINT "place_rangement_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_rangement" ADD CONSTRAINT "place_rangement_lieu_meme_ferme_fk" FOREIGN KEY ("ferme_id","lieu_rangement_id") REFERENCES "public"."lieu_rangement"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_plan" ADD CONSTRAINT "point_plan_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chemin_ferme_idx" ON "chemin" USING btree ("ferme_id");--> statement-breakpoint
CREATE INDEX "lieu_rangement_ferme_idx" ON "lieu_rangement" USING btree ("ferme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lieu_rangement_batiment_actif_idx" ON "lieu_rangement" USING btree ("batiment_id") WHERE "lieu_rangement"."supprime_le" IS NULL AND "lieu_rangement"."batiment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lieu_rangement_point_plan_actif_idx" ON "lieu_rangement" USING btree ("point_plan_id") WHERE "lieu_rangement"."supprime_le" IS NULL AND "lieu_rangement"."point_plan_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outil_ferme_idx" ON "outil" USING btree ("ferme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outil_nom_actif_idx" ON "outil" USING btree ("ferme_id",lower(btrim("nom"))) WHERE "outil"."supprime_le" IS NULL;--> statement-breakpoint
CREATE INDEX "place_rangement_ferme_idx" ON "place_rangement" USING btree ("ferme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "place_rangement_nom_actif_idx" ON "place_rangement" USING btree ("lieu_rangement_id",lower(btrim("nom"))) WHERE "place_rangement"."supprime_le" IS NULL;--> statement-breakpoint
CREATE INDEX "point_plan_ferme_idx" ON "point_plan" USING btree ("ferme_id");--> statement-breakpoint
-- T61 : les cinq tables descendent sur les téléphones (règles de synchro : celles de la ferme à ses
-- membres actifs, même découpage que batiment). Seule retouche du fichier généré.
ALTER PUBLICATION powersync ADD TABLE chemin, point_plan, lieu_rangement, place_rangement, outil;
