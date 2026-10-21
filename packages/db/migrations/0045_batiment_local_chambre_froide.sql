-- T61 : batiment.type gagne 'local' et 'chambre_froide' (la contrainte est remplacée, aucune ligne
-- existante ne change), et (ferme_id, id) devient la cible de la clé étrangère composée de
-- lieu_rangement (0046), comme zone en 0026. Générée par drizzle-kit, sans retouche.
ALTER TABLE "batiment" DROP CONSTRAINT "batiment_type";--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_ferme_id_id_unique" UNIQUE("ferme_id","id");--> statement-breakpoint
ALTER TABLE "batiment" ADD CONSTRAINT "batiment_type" CHECK ("batiment"."type" IN ('serre_tunnel', 'serre_chapelle', 'hangar', 'local', 'chambre_froide', 'magasin', 'autre'));