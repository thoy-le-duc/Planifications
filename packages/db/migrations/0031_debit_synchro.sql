CREATE TABLE "securite"."debit_synchro" (
	"utilisateur_id" uuid PRIMARY KEY NOT NULL,
	"instants" timestamp with time zone[] NOT NULL,
	"maj_le" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "debit_synchro_maj_idx" ON "securite"."debit_synchro" USING btree ("maj_le");