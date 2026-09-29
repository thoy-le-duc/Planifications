ALTER TABLE "jeton_renouvellement" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "jeton_renouvellement" ADD COLUMN "remplace_le" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "jeton_renouvellement_parent_idx" ON "jeton_renouvellement" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "jeton_renouvellement_expire_idx" ON "jeton_renouvellement" USING btree ("expire_le");--> statement-breakpoint
CREATE INDEX "jeton_renouvellement_revoque_idx" ON "jeton_renouvellement" USING btree ("revoque_le");