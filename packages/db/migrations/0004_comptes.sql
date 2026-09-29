CREATE TABLE "code_connexion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hache" text NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"tentatives" integer DEFAULT 0 NOT NULL,
	"utilise_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_connexion_tentatives" CHECK ("code_connexion"."tentatives" >= 0)
);
--> statement-breakpoint
CREATE TABLE "jeton_renouvellement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"jeton_hache" text NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"revoque_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jeton_renouvellement_jeton_hache_unique" UNIQUE("jeton_hache")
);
--> statement-breakpoint
CREATE TABLE "membre" (
	"id" uuid PRIMARY KEY NOT NULL,
	"utilisateur_id" uuid NOT NULL,
	"ferme_id" uuid NOT NULL,
	"role" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "membre_utilisateur_ferme_unique" UNIQUE("utilisateur_id","ferme_id"),
	CONSTRAINT "membre_role" CHECK ("membre"."role" IN ('gerant', 'equipier'))
);
--> statement-breakpoint
CREATE TABLE "utilisateur" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nom" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "utilisateur_email_unique" UNIQUE("email"),
	CONSTRAINT "utilisateur_email_minuscules" CHECK ("utilisateur"."email" = lower("utilisateur"."email"))
);
--> statement-breakpoint
ALTER TABLE "jeton_renouvellement" ADD CONSTRAINT "jeton_renouvellement_utilisateur_id_utilisateur_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_utilisateur_id_utilisateur_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membre" ADD CONSTRAINT "membre_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_connexion_email_cree_idx" ON "code_connexion" USING btree ("email","cree_le");--> statement-breakpoint
CREATE INDEX "jeton_renouvellement_utilisateur_idx" ON "jeton_renouvellement" USING btree ("utilisateur_id");--> statement-breakpoint
CREATE INDEX "membre_ferme_idx" ON "membre" USING btree ("ferme_id");--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_auteur_id_utilisateur_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification" ADD CONSTRAINT "modification_auteur_id_utilisateur_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposition" ADD CONSTRAINT "proposition_auteur_id_utilisateur_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."utilisateur"("id") ON DELETE no action ON UPDATE no action;