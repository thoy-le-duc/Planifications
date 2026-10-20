CREATE TABLE "recette_fertirrigation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"taux_injection" double precision,
	"engrais" jsonb NOT NULL,
	"ec_cible" double precision,
	"ph_cible" double precision,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "recette_fertirrigation_nom" CHECK (length(btrim("recette_fertirrigation"."nom")) BETWEEN 1 AND 200),
	CONSTRAINT "recette_fertirrigation_taux_injection" CHECK ("recette_fertirrigation"."taux_injection" IS NULL OR ("recette_fertirrigation"."taux_injection" > 0 AND "recette_fertirrigation"."taux_injection" <= 100)),
	CONSTRAINT "recette_fertirrigation_engrais" CHECK (jsonb_typeof("recette_fertirrigation"."engrais") = 'array'),
	CONSTRAINT "recette_fertirrigation_ec_cible" CHECK ("recette_fertirrigation"."ec_cible" IS NULL OR "recette_fertirrigation"."ec_cible" BETWEEN 0 AND 20),
	CONSTRAINT "recette_fertirrigation_ph_cible" CHECK ("recette_fertirrigation"."ph_cible" IS NULL OR "recette_fertirrigation"."ph_cible" BETWEEN 0 AND 14)
);
--> statement-breakpoint
ALTER TABLE "modification" DROP CONSTRAINT "modification_nom_table";--> statement-breakpoint
ALTER TABLE "recette_fertirrigation" ADD CONSTRAINT "recette_fertirrigation_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recette_fertirrigation_ferme_idx" ON "recette_fertirrigation" USING btree ("ferme_id");--> statement-breakpoint
ALTER TABLE "modification" ADD CONSTRAINT "modification_nom_table" CHECK ("modification"."nom_table" IN ('Ferme', 'Zone', 'Emplacement', 'SecteurIrrigation', 'SecteurEmplacement', 'Famille', 'Espece', 'Variete', 'Itineraire', 'Saison', 'Serie', 'Plantation', 'Campagne', 'Occupation', 'Assolement', 'Evenement', 'ArticleStock', 'MouvementStock', 'ProduitPhyto', 'ProduitFertilisant', 'RecetteFertirrigation', 'Proposition', 'TypeIntervention', 'Batiment'));--> statement-breakpoint
-- T56 : les recettes de fertirrigation descendent sur les téléphones (règles de synchro : celles
-- de la ferme à ses membres actifs, comme produit_fertilisant). Seule retouche du fichier généré.
ALTER PUBLICATION powersync ADD TABLE recette_fertirrigation;
