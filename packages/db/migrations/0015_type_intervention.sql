CREATE TABLE "type_intervention" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid,
	"categorie" text NOT NULL,
	"libelle" text NOT NULL,
	"masque" boolean DEFAULT false NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "type_intervention_categorie" CHECK ("type_intervention"."categorie" IN ('travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien'))
);
--> statement-breakpoint
ALTER TABLE "modification" DROP CONSTRAINT "modification_nom_table";--> statement-breakpoint
ALTER TABLE "type_intervention" ADD CONSTRAINT "type_intervention_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "type_intervention_libelle_actif_idx" ON "type_intervention" USING btree ("ferme_id","categorie","libelle") WHERE "type_intervention"."supprime_le" IS NULL;--> statement-breakpoint
ALTER TABLE "modification" ADD CONSTRAINT "modification_nom_table" CHECK ("modification"."nom_table" IN ('Ferme', 'Zone', 'Emplacement', 'SecteurIrrigation', 'SecteurEmplacement', 'Famille', 'Espece', 'Variete', 'Itineraire', 'Saison', 'Serie', 'Plantation', 'Campagne', 'Occupation', 'Assolement', 'Evenement', 'ArticleStock', 'MouvementStock', 'ProduitPhyto', 'Proposition', 'TypeIntervention'));