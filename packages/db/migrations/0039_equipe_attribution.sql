CREATE TABLE "attribution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"personne_id" uuid NOT NULL,
	"cle_tache" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "attribution_cle_tache" CHECK (length("attribution"."cle_tache") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "personne" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"prenom" text NOT NULL,
	"membre_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "personne_prenom" CHECK (length(btrim("personne"."prenom")) BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "attribution" ADD CONSTRAINT "attribution_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution" ADD CONSTRAINT "attribution_personne_id_personne_id_fk" FOREIGN KEY ("personne_id") REFERENCES "public"."personne"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personne" ADD CONSTRAINT "personne_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personne" ADD CONSTRAINT "personne_membre_id_membre_id_fk" FOREIGN KEY ("membre_id") REFERENCES "public"."membre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribution_ferme_cle_idx" ON "attribution" USING btree ("ferme_id","cle_tache");--> statement-breakpoint
CREATE INDEX "attribution_personne_idx" ON "attribution" USING btree ("personne_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personne_membre_actif_idx" ON "personne" USING btree ("membre_id") WHERE "personne"."supprime_le" IS NULL AND "personne"."membre_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "personne_ferme_idx" ON "personne" USING btree ("ferme_id");--> statement-breakpoint
-- T60 : l'équipe et les attributions descendent sur les téléphones (règles de synchro : celles
-- de la ferme à ses membres actifs, même découpage que zone). Seule retouche du fichier généré.
ALTER PUBLICATION powersync ADD TABLE personne, attribution;
