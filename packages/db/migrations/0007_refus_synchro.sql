CREATE TABLE "refus_synchro" (
	"id" uuid PRIMARY KEY NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"ferme_id" uuid,
	"nom_table" text NOT NULL,
	"ligne_id" text NOT NULL,
	"operation" text NOT NULL,
	"motif" text NOT NULL,
	"message" text NOT NULL,
	"donnees" jsonb,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refus_synchro_operation" CHECK ("refus_synchro"."operation" IN ('PUT', 'PATCH', 'DELETE'))
);
--> statement-breakpoint
ALTER TABLE "refus_synchro" ADD CONSTRAINT "refus_synchro_utilisateur_id_utilisateur_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refus_synchro_utilisateur_idx" ON "refus_synchro" USING btree ("utilisateur_id","cree_le");