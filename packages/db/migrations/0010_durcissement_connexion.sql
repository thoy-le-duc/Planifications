CREATE SCHEMA "securite";
--> statement-breakpoint
CREATE TABLE "securite"."demande_ip" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"action" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demande_ip_action" CHECK ("securite"."demande_ip"."action" IN ('code', 'verifier'))
);
--> statement-breakpoint
ALTER TABLE "jeton_renouvellement" ADD COLUMN "famille_id" uuid;--> statement-breakpoint
ALTER TABLE "jeton_renouvellement" ADD COLUMN "connexion_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jeton_renouvellement" ADD COLUMN "utilise_le" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "demande_ip_action_ip_cree_idx" ON "securite"."demande_ip" USING btree ("action","ip","cree_le");--> statement-breakpoint
CREATE INDEX "demande_ip_cree_idx" ON "securite"."demande_ip" USING btree ("cree_le");--> statement-breakpoint
CREATE INDEX "jeton_renouvellement_famille_idx" ON "jeton_renouvellement" USING btree ("famille_id");--> statement-breakpoint
-- Retouche manuelle (T09b) : les sessions ouvertes avant la rotation forment chacune leur famille.
UPDATE "jeton_renouvellement" SET "famille_id" = "id", "connexion_le" = "cree_le" WHERE "famille_id" IS NULL;
