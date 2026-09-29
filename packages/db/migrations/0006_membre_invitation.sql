ALTER TABLE "membre" ADD COLUMN "etat" text DEFAULT 'accepte' NOT NULL;--> statement-breakpoint
ALTER TABLE "membre" ADD COLUMN "invite_par" uuid;--> statement-breakpoint
ALTER TABLE "membre" ADD COLUMN "invite_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_invite_par_utilisateur_id_fk" FOREIGN KEY ("invite_par") REFERENCES "public"."utilisateur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membre_invite_par_idx" ON "membre" USING btree ("invite_par","invite_le");--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_etat" CHECK ("membre"."etat" IN ('invite', 'accepte'));--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_invitation" CHECK (("membre"."invite_par" IS NULL) = ("membre"."invite_le" IS NULL));--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_invite_date" CHECK ("membre"."etat" <> 'invite' OR "membre"."invite_le" IS NOT NULL);