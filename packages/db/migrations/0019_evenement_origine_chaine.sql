CREATE SCHEMA "interne";
--> statement-breakpoint
CREATE TABLE "interne"."chaine_evenement" (
	"origine_id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"en_vigueur_id" uuid NOT NULL,
	"en_vigueur_horodatage" timestamp with time zone NOT NULL,
	"annulee" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evenement" ADD COLUMN "origine_id" uuid;--> statement-breakpoint
ALTER TABLE "interne"."chaine_evenement" ADD CONSTRAINT "chaine_evenement_origine_fk" FOREIGN KEY ("ferme_id","origine_id") REFERENCES "public"."evenement"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interne"."chaine_evenement" ADD CONSTRAINT "chaine_evenement_en_vigueur_fk" FOREIGN KEY ("ferme_id","en_vigueur_id") REFERENCES "public"."evenement"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chaine_evenement_ferme_idx" ON "interne"."chaine_evenement" USING btree ("ferme_id");--> statement-breakpoint
CREATE INDEX "chaine_evenement_en_vigueur_idx" ON "interne"."chaine_evenement" USING btree ("en_vigueur_id");