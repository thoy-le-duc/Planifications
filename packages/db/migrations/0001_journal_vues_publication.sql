-- Migration SQL personnalisée (drizzle-kit generate --custom) : ce que Drizzle ne décrit pas.
--   1. Journal en ajout seul : evenement et mouvement_stock refusent UPDATE, DELETE et TRUNCATE.
--   2. Vues recoltes, interventions, traitements (Q10) : le détail jsonb des événements en
--      colonnes, pour les exports et le registre phyto. Seule la version en vigueur apparaît.
--   3. Publication « powersync » pour la réplication logique vers le service PowerSync.

-- 1. Ajout seul ------------------------------------------------------------------------------

CREATE FUNCTION refuser_modification_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % en ajout seul : % refusé', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Corriger ou annuler par une nouvelle ligne qui désigne l''ancienne.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evenement_ajout_seul
  BEFORE UPDATE OR DELETE ON evenement
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_journal();
--> statement-breakpoint
CREATE TRIGGER evenement_ajout_seul_truncate
  BEFORE TRUNCATE ON evenement
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification_journal();
--> statement-breakpoint
CREATE TRIGGER mouvement_stock_ajout_seul
  BEFORE UPDATE OR DELETE ON mouvement_stock
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_journal();
--> statement-breakpoint
CREATE TRIGGER mouvement_stock_ajout_seul_truncate
  BEFORE TRUNCATE ON mouvement_stock
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification_journal();
--> statement-breakpoint

-- 2. Vues -------------------------------------------------------------------------------------

-- Événements en vigueur : ni une annulation, ni un événement annulé ou corrigé par un autre.
-- Une correction reste visible tant qu'elle n'est pas elle-même corrigée ou annulée.
CREATE VIEW evenements_en_vigueur AS
SELECT e.*
FROM evenement e
WHERE e.remplace_sorte IS DISTINCT FROM 'annulation'
  AND NOT EXISTS (SELECT 1 FROM evenement r WHERE r.remplace_evenement_id = e.id);
--> statement-breakpoint
CREATE VIEW recoltes AS
SELECT e.id,
       e.ferme_id,
       e.date,
       e.serie_id,
       e.campagne_id,
       e.emplacement_ids,
       (e.detail ->> 'quantite')::numeric AS quantite,
       e.detail ->> 'unite' AS unite,
       e.detail ->> 'categorie' AS categorie,
       e.note
FROM evenements_en_vigueur e
WHERE e.type = 'recolte';
--> statement-breakpoint
CREATE VIEW interventions AS
SELECT e.id,
       e.ferme_id,
       e.date,
       e.serie_id,
       e.campagne_id,
       e.emplacement_ids,
       e.detail ->> 'categorie' AS categorie,
       e.detail ->> 'type' AS type_intervention,
       e.detail ->> 'outil' AS outil,
       e.detail ->> 'produit' AS produit,
       (e.detail -> 'quantite' ->> 'valeur')::numeric AS quantite_valeur,
       e.detail -> 'quantite' ->> 'unite' AS quantite_unite,
       (e.detail ->> 'dureeOccupationJours')::numeric AS duree_occupation_jours,
       e.note
FROM evenements_en_vigueur e
WHERE e.type = 'intervention';
--> statement-breakpoint
CREATE VIEW traitements AS
SELECT e.id,
       e.ferme_id,
       e.date,
       e.serie_id,
       e.campagne_id,
       e.emplacement_ids,
       (e.detail ->> 'produitPhytoId')::uuid AS produit_phyto_id,
       p.nom_commercial,
       p.numero_amm,
       p.substance_active,
       (e.detail -> 'dose' ->> 'valeur')::numeric AS dose_valeur,
       e.detail -> 'dose' ->> 'unite' AS dose_unite,
       (e.detail ->> 'surfaceTraiteeM2')::numeric AS surface_traitee_m2,
       e.detail ->> 'cible' AS cible,
       e.detail ->> 'operateur' AS operateur,
       (e.detail ->> 'recolteAutoriseeLe')::date AS recolte_autorisee_le,
       e.note
FROM evenements_en_vigueur e
LEFT JOIN produit_phyto p ON p.id = (e.detail ->> 'produitPhytoId')::uuid
WHERE e.type = 'traitement';
--> statement-breakpoint

-- 3. Publication PowerSync --------------------------------------------------------------------

-- Liste explicite plutôt que FOR ALL TABLES : pas besoin d'être superutilisateur (hébergeurs
-- Postgres gérés), et la table de suivi des migrations (schéma drizzle) n'est pas publiée.
-- Toute nouvelle table synchronisée s'ajoute dans sa migration :
--   ALTER PUBLICATION powersync ADD TABLE … ;
CREATE PUBLICATION powersync FOR TABLE
  ferme, zone, emplacement, secteur_irrigation, secteur_emplacement,
  famille, espece, variete, itineraire,
  saison, serie, plantation, campagne, occupation, assolement,
  evenement, article_stock, mouvement_stock, produit_phyto,
  proposition, modification
  WITH (publish = 'insert, update, delete');
