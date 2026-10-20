CREATE TABLE "produit_fertilisant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"forme" text NOT NULL,
	"unite" text NOT NULL,
	"teneur_n" double precision,
	"teneur_p2o5" double precision,
	"teneur_k2o" double precision,
	"organique" boolean NOT NULL,
	"utilisable_en_bio" boolean NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "produit_fertilisant_nom" CHECK (length(btrim("produit_fertilisant"."nom")) BETWEEN 1 AND 200),
	CONSTRAINT "produit_fertilisant_forme" CHECK ("produit_fertilisant"."forme" IN ('solide', 'liquide')),
	CONSTRAINT "produit_fertilisant_unite" CHECK ("produit_fertilisant"."unite" IN ('kg', 't', 'L', 'm3')),
	CONSTRAINT "produit_fertilisant_teneur_n" CHECK ("produit_fertilisant"."teneur_n" IS NULL OR "produit_fertilisant"."teneur_n" BETWEEN 0 AND 100),
	CONSTRAINT "produit_fertilisant_teneur_p2o5" CHECK ("produit_fertilisant"."teneur_p2o5" IS NULL OR "produit_fertilisant"."teneur_p2o5" BETWEEN 0 AND 100),
	CONSTRAINT "produit_fertilisant_teneur_k2o" CHECK ("produit_fertilisant"."teneur_k2o" IS NULL OR "produit_fertilisant"."teneur_k2o" BETWEEN 0 AND 100),
	CONSTRAINT "produit_fertilisant_source" CHECK (length("produit_fertilisant"."source") <= 300)
);
--> statement-breakpoint
ALTER TABLE "modification" DROP CONSTRAINT "modification_nom_table";--> statement-breakpoint
ALTER TABLE "ferme" ADD COLUMN "zone_vulnerable_nitrates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "produit_fertilisant" ADD CONSTRAINT "produit_fertilisant_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "produit_fertilisant_ferme_idx" ON "produit_fertilisant" USING btree ("ferme_id");--> statement-breakpoint
ALTER TABLE "modification" ADD CONSTRAINT "modification_nom_table" CHECK ("modification"."nom_table" IN ('Ferme', 'Zone', 'Emplacement', 'SecteurIrrigation', 'SecteurEmplacement', 'Famille', 'Espece', 'Variete', 'Itineraire', 'Saison', 'Serie', 'Plantation', 'Campagne', 'Occupation', 'Assolement', 'Evenement', 'ArticleStock', 'MouvementStock', 'ProduitPhyto', 'ProduitFertilisant', 'Proposition', 'TypeIntervention', 'Batiment'));--> statement-breakpoint
-- T54 : les produits fertilisants descendent sur les téléphones (règles de synchro : ceux de la
-- ferme à ses membres actifs, même découpage que zone). Seule retouche du fichier généré.
ALTER PUBLICATION powersync ADD TABLE produit_fertilisant;
