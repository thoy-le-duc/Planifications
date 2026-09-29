-- T10 : refus de synchro dans la publication PowerSync.
--
-- refus_synchro descend sur le téléphone de son seul auteur (règles de synchro, flux filtré sur
-- utilisateur_id) : le maraîcher voit pourquoi une saisie n'est pas passée.
ALTER PUBLICATION powersync ADD TABLE refus_synchro;
--> statement-breakpoint

-- PowerSync (1.26 et suivants) exige que la publication transmette aussi les TRUNCATE
-- (erreur PSYNC_S1142 au démarrage de la réplication sinon). Les tables en ajout seul
-- (evenement, mouvement_stock) refusent toujours TRUNCATE par déclencheur.
ALTER PUBLICATION powersync SET (publish = 'insert, update, delete, truncate');
