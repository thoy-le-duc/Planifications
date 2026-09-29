CREATE TABLE "article_stock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"espece_id" uuid NOT NULL,
	"variete_id" uuid,
	"unite" text NOT NULL,
	"categorie" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "article_stock_unite" CHECK ("article_stock"."unite" IN ('kg', 'botte', 'piece', 'barquette'))
);
--> statement-breakpoint
CREATE TABLE "assolement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"zone_id" uuid,
	"emplacement_id" uuid,
	"famille_id" uuid NOT NULL,
	"espece_id" uuid,
	"nature" text NOT NULL,
	"source_import" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "assolement_nature" CHECK ("assolement"."nature" IN ('prevu', 'passe_saisi', 'passe_importe')),
	CONSTRAINT "assolement_une_cible" CHECK (num_nonnulls("assolement"."zone_id", "assolement"."emplacement_id") = 1),
	CONSTRAINT "assolement_source_import" CHECK ("assolement"."source_import" IS NULL OR "assolement"."nature" = 'passe_importe')
);
--> statement-breakpoint
CREATE TABLE "campagne" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"plantation_id" uuid NOT NULL,
	"annee" integer NOT NULL,
	"debut_recolte_prevu" date,
	"fin_recolte_prevue" date,
	"rendement_prevu" jsonb,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "campagne_recolte_prevue" CHECK ("campagne"."fin_recolte_prevue" IS NULL OR "campagne"."debut_recolte_prevu" IS NULL OR "campagne"."fin_recolte_prevue" >= "campagne"."debut_recolte_prevu")
);
--> statement-breakpoint
CREATE TABLE "emplacement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"code" text NOT NULL,
	"sorte" text NOT NULL,
	"longueur_m" numeric NOT NULL,
	"largeur_m" numeric,
	"nombre_places" integer,
	"actif_du" date NOT NULL,
	"actif_au" date,
	"remplace" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "emplacement_sorte" CHECK ("emplacement"."sorte" IN ('planche', 'rang', 'gouttiere')),
	CONSTRAINT "emplacement_longueur_positive" CHECK ("emplacement"."longueur_m" > 0),
	CONSTRAINT "emplacement_largeur_positive" CHECK ("emplacement"."largeur_m" IS NULL OR "emplacement"."largeur_m" > 0),
	CONSTRAINT "emplacement_places_de_gouttiere" CHECK (("emplacement"."sorte" = 'gouttiere') = ("emplacement"."nombre_places" IS NOT NULL) AND ("emplacement"."nombre_places" IS NULL OR "emplacement"."nombre_places" > 0)),
	CONSTRAINT "emplacement_periode_active" CHECK ("emplacement"."actif_au" IS NULL OR "emplacement"."actif_au" >= "emplacement"."actif_du")
);
--> statement-breakpoint
CREATE TABLE "espece" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid,
	"famille_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"categorie" text NOT NULL,
	"perenne" boolean NOT NULL,
	"unite_recolte" text NOT NULL,
	"delai_retour_minimal_ans" integer,
	"delai_retour_conseille_ans" integer,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "espece_categorie" CHECK ("espece"."categorie" IN ('legume', 'petit_fruit', 'fruit', 'fleur', 'aromatique', 'engrais_vert')),
	CONSTRAINT "espece_unite_recolte" CHECK ("espece"."unite_recolte" IN ('kg', 'botte', 'piece', 'barquette')),
	CONSTRAINT "espece_delais_retour" CHECK (("espece"."delai_retour_minimal_ans" IS NULL AND "espece"."delai_retour_conseille_ans" IS NULL)
        OR ("espece"."delai_retour_minimal_ans" >= 0 AND "espece"."delai_retour_conseille_ans" >= "espece"."delai_retour_minimal_ans"))
);
--> statement-breakpoint
CREATE TABLE "evenement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"type" text NOT NULL,
	"date" date NOT NULL,
	"horodatage" timestamp with time zone NOT NULL,
	"auteur_id" uuid NOT NULL,
	"source" text NOT NULL,
	"serie_id" uuid,
	"campagne_id" uuid,
	"emplacement_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"note" text,
	"photos" text[] DEFAULT '{}'::text[] NOT NULL,
	"remplace_sorte" text,
	"remplace_evenement_id" uuid,
	"detail" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evenement_type" CHECK ("evenement"."type" IN ('realise', 'recolte', 'intervention', 'irrigation', 'traitement', 'observation')),
	CONSTRAINT "evenement_source" CHECK ("evenement"."source" IN ('tap', 'voix', 'agent', 'photo', 'import')),
	CONSTRAINT "evenement_remplace_sorte" CHECK ("evenement"."remplace_sorte" IS NULL OR "evenement"."remplace_sorte" IN ('correction', 'annulation')),
	CONSTRAINT "evenement_au_plus_une_culture" CHECK (num_nonnulls("evenement"."serie_id", "evenement"."campagne_id") <= 1),
	CONSTRAINT "evenement_remplacement_complet" CHECK (("evenement"."remplace_sorte" IS NULL) = ("evenement"."remplace_evenement_id" IS NULL)),
	CONSTRAINT "evenement_ne_se_remplace_pas" CHECK ("evenement"."remplace_evenement_id" IS DISTINCT FROM "evenement"."id"),
	CONSTRAINT "evenement_detail_objet" CHECK (jsonb_typeof("evenement"."detail") = 'object'),
	CONSTRAINT "evenement_detail_recolte" CHECK (CASE WHEN "evenement"."type" <> 'recolte' THEN true
        WHEN jsonb_typeof("evenement"."detail" -> 'quantite') <> 'number' THEN false
        ELSE ("evenement"."detail" ->> 'quantite')::numeric > 0 AND "evenement"."detail" ->> 'unite' IN ('kg', 'botte', 'piece', 'barquette') END),
	CONSTRAINT "evenement_detail_realise" CHECK ("evenement"."type" <> 'realise' OR "evenement"."detail" ->> 'etape' IN ('semis_pepiniere', 'semis_direct', 'plantation', 'arrachage')),
	CONSTRAINT "evenement_detail_intervention" CHECK ("evenement"."type" <> 'intervention' OR "evenement"."detail" ->> 'categorie' IN ('travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien')),
	CONSTRAINT "evenement_detail_traitement" CHECK ("evenement"."type" <> 'traitement' OR (
        ("evenement"."detail" ->> 'produitPhytoId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND ("evenement"."detail" ->> 'recolteAutoriseeLe') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND jsonb_typeof("evenement"."detail" -> 'dose' -> 'valeur') = 'number'
        AND jsonb_typeof("evenement"."detail" -> 'surfaceTraiteeM2') = 'number'))
);
--> statement-breakpoint
CREATE TABLE "famille" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid,
	"nom" text NOT NULL,
	"delai_retour_minimal_ans" integer NOT NULL,
	"delai_retour_conseille_ans" integer NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "famille_delais_retour" CHECK ("famille"."delai_retour_minimal_ans" >= 0 AND "famille"."delai_retour_conseille_ans" >= "famille"."delai_retour_minimal_ans")
);
--> statement-breakpoint
CREATE TABLE "ferme" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"fuseau_horaire" text NOT NULL,
	"position" jsonb,
	"unites" jsonb DEFAULT '{"longueur": "m", "masse": "kg"}'::jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "itineraire" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid,
	"espece_id" uuid NOT NULL,
	"variete_id" uuid,
	"nom" text NOT NULL,
	"mode" text NOT NULL,
	"parametres" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "itineraire_mode" CHECK ("itineraire"."mode" IN ('semis_direct', 'plant_maison', 'plant_achete')),
	CONSTRAINT "itineraire_parametres_du_mode" CHECK ("itineraire"."parametres" ->> 'mode' = "itineraire"."mode")
);
--> statement-breakpoint
CREATE TABLE "modification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom_table" text NOT NULL,
	"ligne_id" uuid NOT NULL,
	"auteur_id" uuid NOT NULL,
	"horodatage" timestamp with time zone NOT NULL,
	"operation" text NOT NULL,
	"avant" jsonb,
	"apres" jsonb,
	"proposition_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "modification_nom_table" CHECK ("modification"."nom_table" IN ('Ferme', 'Zone', 'Emplacement', 'SecteurIrrigation', 'SecteurEmplacement', 'Famille', 'Espece', 'Variete', 'Itineraire', 'Saison', 'Serie', 'Plantation', 'Campagne', 'Occupation', 'Assolement', 'Evenement', 'ArticleStock', 'MouvementStock', 'ProduitPhyto', 'Proposition')),
	CONSTRAINT "modification_operation" CHECK ("modification"."operation" IN ('creation', 'modification', 'suppression'))
);
--> statement-breakpoint
CREATE TABLE "mouvement_stock" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"article_stock_id" uuid NOT NULL,
	"date" date NOT NULL,
	"quantite" numeric NOT NULL,
	"motif" text NOT NULL,
	"recolte_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mouvement_stock_motif" CHECK ("mouvement_stock"."motif" IN ('recolte', 'vente', 'perte', 'ajustement')),
	CONSTRAINT "mouvement_stock_quantite_non_nulle" CHECK ("mouvement_stock"."quantite" <> 0),
	CONSTRAINT "mouvement_stock_recolte_liee" CHECK (("mouvement_stock"."motif" = 'recolte') = ("mouvement_stock"."recolte_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "occupation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"emplacement_id" uuid NOT NULL,
	"serie_id" uuid,
	"plantation_id" uuid,
	"evenement_id" uuid,
	"longueur_m" numeric,
	"nombre_places" integer,
	"position_m" numeric,
	"prevu_du" date NOT NULL,
	"prevu_au" date NOT NULL,
	"reel_du" date,
	"reel_au" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "occupation_un_occupant" CHECK (num_nonnulls("occupation"."serie_id", "occupation"."plantation_id", "occupation"."evenement_id") = 1),
	CONSTRAINT "occupation_une_place" CHECK (num_nonnulls("occupation"."longueur_m", "occupation"."nombre_places") = 1),
	CONSTRAINT "occupation_place_positive" CHECK (("occupation"."longueur_m" IS NULL OR "occupation"."longueur_m" > 0) AND ("occupation"."nombre_places" IS NULL OR "occupation"."nombre_places" > 0)),
	CONSTRAINT "occupation_position_positive" CHECK ("occupation"."position_m" IS NULL OR "occupation"."position_m" >= 0),
	CONSTRAINT "occupation_periode_prevue" CHECK ("occupation"."prevu_au" >= "occupation"."prevu_du"),
	CONSTRAINT "occupation_periode_reelle" CHECK (("occupation"."reel_du" IS NOT NULL OR "occupation"."reel_au" IS NULL) AND ("occupation"."reel_au" IS NULL OR "occupation"."reel_au" >= "occupation"."reel_du"))
);
--> statement-breakpoint
CREATE TABLE "plantation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"espece_id" uuid NOT NULL,
	"variete_id" uuid,
	"date_plantation" date NOT NULL,
	"nombre_plants" integer NOT NULL,
	"date_arrachage" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "plantation_nombre_plants_positif" CHECK ("plantation"."nombre_plants" > 0),
	CONSTRAINT "plantation_arrachage_apres_plantation" CHECK ("plantation"."date_arrachage" IS NULL OR "plantation"."date_arrachage" >= "plantation"."date_plantation")
);
--> statement-breakpoint
CREATE TABLE "produit_phyto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid,
	"nom_commercial" text NOT NULL,
	"numero_amm" text NOT NULL,
	"substance_active" text NOT NULL,
	"delai_avant_recolte_jours" integer NOT NULL,
	"utilisable_en_bio" boolean NOT NULL,
	"dose_maximale" jsonb,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "produit_phyto_delai_avant_recolte" CHECK ("produit_phyto"."delai_avant_recolte_jours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "proposition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"source" text NOT NULL,
	"auteur_id" uuid NOT NULL,
	"statut" text NOT NULL,
	"decide_le" timestamp with time zone,
	"changements" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "proposition_source" CHECK ("proposition"."source" IN ('voix', 'agent', 'photo')),
	CONSTRAINT "proposition_statut" CHECK ("proposition"."statut" IN ('en_attente', 'validee', 'rejetee')),
	CONSTRAINT "proposition_decision" CHECK (("proposition"."statut" = 'en_attente') = ("proposition"."decide_le" IS NULL)),
	CONSTRAINT "proposition_changements" CHECK (jsonb_typeof("proposition"."changements") = 'array')
);
--> statement-breakpoint
CREATE TABLE "saison" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"debut" date NOT NULL,
	"fin" date NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "saison_periode" CHECK ("saison"."fin" >= "saison"."debut")
);
--> statement-breakpoint
CREATE TABLE "secteur_emplacement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"secteur_irrigation_id" uuid NOT NULL,
	"emplacement_id" uuid NOT NULL,
	"du" date NOT NULL,
	"au" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "secteur_emplacement_periode" CHECK ("secteur_emplacement"."au" IS NULL OR "secteur_emplacement"."au" >= "secteur_emplacement"."du")
);
--> statement-breakpoint
CREATE TABLE "secteur_irrigation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"numero_vanne" integer NOT NULL,
	"nom" text NOT NULL,
	"debit_litres_heure" numeric,
	"adresse_modbus" integer,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "secteur_irrigation_debit_positif" CHECK ("secteur_irrigation"."debit_litres_heure" IS NULL OR "secteur_irrigation"."debit_litres_heure" > 0)
);
--> statement-breakpoint
CREATE TABLE "serie" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"saison_id" uuid NOT NULL,
	"espece_id" uuid NOT NULL,
	"variete_id" uuid,
	"itineraire_id" uuid NOT NULL,
	"parametres" jsonb NOT NULL,
	"ancre_type" text NOT NULL,
	"ancre_date" date NOT NULL,
	"prevu_semis_pepiniere" date,
	"prevu_mise_en_place" date NOT NULL,
	"prevu_debut_recolte" date NOT NULL,
	"prevu_fin_recolte" date NOT NULL,
	"longueur_m" numeric,
	"nombre_plants" integer,
	"statut" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "serie_ancre_type" CHECK ("serie"."ancre_type" IN ('semis', 'plantation', 'debut_recolte')),
	CONSTRAINT "serie_statut" CHECK ("serie"."statut" IN ('prevue', 'en_cours', 'terminee', 'abandonnee')),
	CONSTRAINT "serie_parametres" CHECK (jsonb_typeof("serie"."parametres") = 'object'),
	CONSTRAINT "serie_une_taille" CHECK (num_nonnulls("serie"."longueur_m", "serie"."nombre_plants") = 1),
	CONSTRAINT "serie_taille_positive" CHECK (("serie"."longueur_m" IS NULL OR "serie"."longueur_m" > 0) AND ("serie"."nombre_plants" IS NULL OR "serie"."nombre_plants" > 0)),
	CONSTRAINT "serie_ordre_des_dates" CHECK ("serie"."prevu_fin_recolte" >= "serie"."prevu_debut_recolte" AND "serie"."prevu_debut_recolte" >= "serie"."prevu_mise_en_place"
        AND ("serie"."prevu_semis_pepiniere" IS NULL OR "serie"."prevu_mise_en_place" >= "serie"."prevu_semis_pepiniere"))
);
--> statement-breakpoint
CREATE TABLE "variete" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid,
	"espece_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"fournisseur" text,
	"poids_mille_graines_g" numeric,
	"taux_germination" integer,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "variete_pmg_positif" CHECK ("variete"."poids_mille_graines_g" IS NULL OR "variete"."poids_mille_graines_g" > 0),
	CONSTRAINT "variete_taux_germination" CHECK ("variete"."taux_germination" IS NULL OR "variete"."taux_germination" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "zone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ferme_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"zone_parente_id" uuid,
	"type_abri" text NOT NULL,
	"surface_m2" numeric,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	"supprime_le" timestamp with time zone,
	CONSTRAINT "zone_type_abri" CHECK ("zone"."type_abri" IN ('plein_champ', 'tunnel', 'serre', 'hors_sol')),
	CONSTRAINT "zone_surface_positive" CHECK ("zone"."surface_m2" IS NULL OR "zone"."surface_m2" > 0),
	CONSTRAINT "zone_pas_sa_propre_parente" CHECK ("zone"."zone_parente_id" IS DISTINCT FROM "zone"."id")
);
--> statement-breakpoint
ALTER TABLE "article_stock" ADD CONSTRAINT "article_stock_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_stock" ADD CONSTRAINT "article_stock_espece_id_espece_id_fk" FOREIGN KEY ("espece_id") REFERENCES "public"."espece"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_stock" ADD CONSTRAINT "article_stock_variete_id_variete_id_fk" FOREIGN KEY ("variete_id") REFERENCES "public"."variete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assolement" ADD CONSTRAINT "assolement_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assolement" ADD CONSTRAINT "assolement_saison_id_saison_id_fk" FOREIGN KEY ("saison_id") REFERENCES "public"."saison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assolement" ADD CONSTRAINT "assolement_zone_id_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assolement" ADD CONSTRAINT "assolement_emplacement_id_emplacement_id_fk" FOREIGN KEY ("emplacement_id") REFERENCES "public"."emplacement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assolement" ADD CONSTRAINT "assolement_famille_id_famille_id_fk" FOREIGN KEY ("famille_id") REFERENCES "public"."famille"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assolement" ADD CONSTRAINT "assolement_espece_id_espece_id_fk" FOREIGN KEY ("espece_id") REFERENCES "public"."espece"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campagne" ADD CONSTRAINT "campagne_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campagne" ADD CONSTRAINT "campagne_plantation_id_plantation_id_fk" FOREIGN KEY ("plantation_id") REFERENCES "public"."plantation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emplacement" ADD CONSTRAINT "emplacement_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emplacement" ADD CONSTRAINT "emplacement_zone_id_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "espece" ADD CONSTRAINT "espece_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "espece" ADD CONSTRAINT "espece_famille_id_famille_id_fk" FOREIGN KEY ("famille_id") REFERENCES "public"."famille"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_serie_id_serie_id_fk" FOREIGN KEY ("serie_id") REFERENCES "public"."serie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_campagne_id_campagne_id_fk" FOREIGN KEY ("campagne_id") REFERENCES "public"."campagne"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_remplace_evenement_id_evenement_id_fk" FOREIGN KEY ("remplace_evenement_id") REFERENCES "public"."evenement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "famille" ADD CONSTRAINT "famille_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itineraire" ADD CONSTRAINT "itineraire_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itineraire" ADD CONSTRAINT "itineraire_espece_id_espece_id_fk" FOREIGN KEY ("espece_id") REFERENCES "public"."espece"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itineraire" ADD CONSTRAINT "itineraire_variete_id_variete_id_fk" FOREIGN KEY ("variete_id") REFERENCES "public"."variete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification" ADD CONSTRAINT "modification_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modification" ADD CONSTRAINT "modification_proposition_id_proposition_id_fk" FOREIGN KEY ("proposition_id") REFERENCES "public"."proposition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvement_stock" ADD CONSTRAINT "mouvement_stock_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvement_stock" ADD CONSTRAINT "mouvement_stock_article_stock_id_article_stock_id_fk" FOREIGN KEY ("article_stock_id") REFERENCES "public"."article_stock"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mouvement_stock" ADD CONSTRAINT "mouvement_stock_recolte_id_evenement_id_fk" FOREIGN KEY ("recolte_id") REFERENCES "public"."evenement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation" ADD CONSTRAINT "occupation_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation" ADD CONSTRAINT "occupation_emplacement_id_emplacement_id_fk" FOREIGN KEY ("emplacement_id") REFERENCES "public"."emplacement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation" ADD CONSTRAINT "occupation_serie_id_serie_id_fk" FOREIGN KEY ("serie_id") REFERENCES "public"."serie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation" ADD CONSTRAINT "occupation_plantation_id_plantation_id_fk" FOREIGN KEY ("plantation_id") REFERENCES "public"."plantation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation" ADD CONSTRAINT "occupation_evenement_id_evenement_id_fk" FOREIGN KEY ("evenement_id") REFERENCES "public"."evenement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantation" ADD CONSTRAINT "plantation_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantation" ADD CONSTRAINT "plantation_espece_id_espece_id_fk" FOREIGN KEY ("espece_id") REFERENCES "public"."espece"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantation" ADD CONSTRAINT "plantation_variete_id_variete_id_fk" FOREIGN KEY ("variete_id") REFERENCES "public"."variete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produit_phyto" ADD CONSTRAINT "produit_phyto_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposition" ADD CONSTRAINT "proposition_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saison" ADD CONSTRAINT "saison_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secteur_emplacement" ADD CONSTRAINT "secteur_emplacement_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secteur_emplacement" ADD CONSTRAINT "secteur_emplacement_secteur_irrigation_id_secteur_irrigation_id_fk" FOREIGN KEY ("secteur_irrigation_id") REFERENCES "public"."secteur_irrigation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secteur_emplacement" ADD CONSTRAINT "secteur_emplacement_emplacement_id_emplacement_id_fk" FOREIGN KEY ("emplacement_id") REFERENCES "public"."emplacement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secteur_irrigation" ADD CONSTRAINT "secteur_irrigation_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_saison_id_saison_id_fk" FOREIGN KEY ("saison_id") REFERENCES "public"."saison"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_espece_id_espece_id_fk" FOREIGN KEY ("espece_id") REFERENCES "public"."espece"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_variete_id_variete_id_fk" FOREIGN KEY ("variete_id") REFERENCES "public"."variete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_itineraire_id_itineraire_id_fk" FOREIGN KEY ("itineraire_id") REFERENCES "public"."itineraire"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variete" ADD CONSTRAINT "variete_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variete" ADD CONSTRAINT "variete_espece_id_espece_id_fk" FOREIGN KEY ("espece_id") REFERENCES "public"."espece"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_ferme_id_ferme_id_fk" FOREIGN KEY ("ferme_id") REFERENCES "public"."ferme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_zone_parente_id_zone_id_fk" FOREIGN KEY ("zone_parente_id") REFERENCES "public"."zone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assolement_zone_idx" ON "assolement" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "assolement_emplacement_idx" ON "assolement" USING btree ("emplacement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campagne_plantation_annee_idx" ON "campagne" USING btree ("plantation_id","annee") WHERE "campagne"."supprime_le" IS NULL;--> statement-breakpoint
CREATE INDEX "emplacement_ferme_code_idx" ON "emplacement" USING btree ("ferme_id","code");--> statement-breakpoint
CREATE INDEX "emplacement_zone_idx" ON "emplacement" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "espece_famille_idx" ON "espece" USING btree ("famille_id");--> statement-breakpoint
CREATE INDEX "evenement_ferme_date_idx" ON "evenement" USING btree ("ferme_id","date");--> statement-breakpoint
CREATE INDEX "evenement_serie_idx" ON "evenement" USING btree ("serie_id");--> statement-breakpoint
CREATE INDEX "evenement_campagne_idx" ON "evenement" USING btree ("campagne_id");--> statement-breakpoint
CREATE INDEX "evenement_remplace_idx" ON "evenement" USING btree ("remplace_evenement_id");--> statement-breakpoint
CREATE INDEX "itineraire_espece_idx" ON "itineraire" USING btree ("espece_id");--> statement-breakpoint
CREATE INDEX "modification_ligne_idx" ON "modification" USING btree ("nom_table","ligne_id");--> statement-breakpoint
CREATE INDEX "modification_proposition_idx" ON "modification" USING btree ("proposition_id");--> statement-breakpoint
CREATE INDEX "mouvement_stock_article_idx" ON "mouvement_stock" USING btree ("article_stock_id");--> statement-breakpoint
CREATE INDEX "mouvement_stock_recolte_idx" ON "mouvement_stock" USING btree ("recolte_id");--> statement-breakpoint
CREATE INDEX "occupation_vue_2d_idx" ON "occupation" USING btree ("emplacement_id","prevu_du","prevu_au");--> statement-breakpoint
CREATE INDEX "occupation_serie_idx" ON "occupation" USING btree ("serie_id");--> statement-breakpoint
CREATE INDEX "occupation_plantation_idx" ON "occupation" USING btree ("plantation_id");--> statement-breakpoint
CREATE INDEX "secteur_emplacement_secteur_idx" ON "secteur_emplacement" USING btree ("secteur_irrigation_id");--> statement-breakpoint
CREATE INDEX "secteur_emplacement_emplacement_idx" ON "secteur_emplacement" USING btree ("emplacement_id");--> statement-breakpoint
CREATE INDEX "serie_semainier_semis_idx" ON "serie" USING btree ("ferme_id","prevu_semis_pepiniere");--> statement-breakpoint
CREATE INDEX "serie_semainier_mise_en_place_idx" ON "serie" USING btree ("ferme_id","prevu_mise_en_place");--> statement-breakpoint
CREATE INDEX "serie_semainier_recolte_idx" ON "serie" USING btree ("ferme_id","prevu_debut_recolte","prevu_fin_recolte");--> statement-breakpoint
CREATE INDEX "serie_saison_idx" ON "serie" USING btree ("saison_id");--> statement-breakpoint
CREATE INDEX "variete_espece_idx" ON "variete" USING btree ("espece_id");