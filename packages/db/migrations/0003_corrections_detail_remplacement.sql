-- Généré par drizzle-kit ; seule retouche : l'UNIQUE (ferme_id, id) est posé avant la clé
-- étrangère composée qui s'y appuie (drizzle-kit les émettait dans l'ordre inverse).
ALTER TABLE "evenement" DROP CONSTRAINT "evenement_detail_recolte";--> statement-breakpoint
ALTER TABLE "evenement" DROP CONSTRAINT "evenement_detail_realise";--> statement-breakpoint
ALTER TABLE "evenement" DROP CONSTRAINT "evenement_detail_intervention";--> statement-breakpoint
ALTER TABLE "evenement" DROP CONSTRAINT "evenement_detail_traitement";--> statement-breakpoint
ALTER TABLE "evenement" DROP CONSTRAINT "evenement_remplace_evenement_id_evenement_id_fk";
--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_ferme_id_id_unique" UNIQUE("ferme_id","id");--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_remplace_meme_ferme_fk" FOREIGN KEY ("ferme_id","remplace_evenement_id") REFERENCES "public"."evenement"("ferme_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_detail_irrigation" CHECK ("evenement"."type" <> 'irrigation' OR (("evenement"."detail" ->> 'secteurIrrigationId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND (CASE WHEN jsonb_typeof("evenement"."detail" -> 'dureeMinutes') = 'number' THEN ("evenement"."detail" -> 'dureeMinutes')::numeric >= 0 ELSE false END)) IS TRUE);--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_detail_observation" CHECK ("evenement"."type" <> 'observation' OR ("evenement"."detail" ->> 'nature' IN ('ravageur', 'maladie', 'stade', 'autre')) IS TRUE);--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_detail_recolte" CHECK ("evenement"."type" <> 'recolte' OR ((CASE WHEN jsonb_typeof("evenement"."detail" -> 'quantite') = 'number' THEN ("evenement"."detail" -> 'quantite')::numeric > 0 ELSE false END)
        AND "evenement"."detail" ->> 'unite' IN ('kg', 'botte', 'piece', 'barquette')
        AND coalesce(jsonb_typeof("evenement"."detail" -> 'categorie'), 'null') IN ('null', 'string')) IS TRUE);--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_detail_realise" CHECK ("evenement"."type" <> 'realise' OR ("evenement"."detail" ->> 'etape' IN ('semis_pepiniere', 'semis_direct', 'plantation', 'arrachage')
        AND coalesce(jsonb_typeof("evenement"."detail" -> 'quantiteReelle'), 'null') IN ('null', 'number')) IS TRUE);--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_detail_intervention" CHECK ("evenement"."type" <> 'intervention' OR ("evenement"."detail" ->> 'categorie' IN ('travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien')
        AND jsonb_typeof("evenement"."detail" -> 'type') = 'string'
        AND coalesce(jsonb_typeof("evenement"."detail" -> 'outil'), 'null') IN ('null', 'string')
        AND coalesce(jsonb_typeof("evenement"."detail" -> 'dureeOccupationJours'), 'null') IN ('null', 'number')
        AND coalesce(jsonb_typeof("evenement"."detail" -> 'quantite' -> 'valeur'), 'null') IN ('null', 'number')
        AND ("evenement"."detail" ->> 'categorie' NOT IN ('fertilisation', 'amendement')
          OR (jsonb_typeof("evenement"."detail" -> 'quantite' -> 'valeur') = 'number'
            AND jsonb_typeof("evenement"."detail" -> 'produit') = 'string'))) IS TRUE);--> statement-breakpoint
ALTER TABLE "evenement" ADD CONSTRAINT "evenement_detail_traitement" CHECK ("evenement"."type" <> 'traitement' OR (("evenement"."detail" ->> 'produitPhytoId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND est_date_calendaire("evenement"."detail" ->> 'recolteAutoriseeLe')
        AND (CASE WHEN jsonb_typeof("evenement"."detail" -> 'dose' -> 'valeur') = 'number' THEN ("evenement"."detail" -> 'dose' -> 'valeur')::numeric >= 0 ELSE false END)
        AND jsonb_typeof("evenement"."detail" -> 'dose' -> 'unite') = 'string'
        AND (CASE WHEN jsonb_typeof("evenement"."detail" -> 'surfaceTraiteeM2') = 'number' THEN ("evenement"."detail" -> 'surfaceTraiteeM2')::numeric >= 0 ELSE false END)) IS TRUE);