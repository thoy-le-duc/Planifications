-- T09 : comptes dans la publication PowerSync.
--
-- utilisateur (nom de l'auteur d'une saisie) et membre (lu par les règles de synchro de T10) sont
-- répliqués, filtrés par ferme par ces règles. Les données d'authentification (code_connexion,
-- jeton_renouvellement) ne le sont JAMAIS : elles restent sur le serveur.
ALTER PUBLICATION powersync ADD TABLE utilisateur, membre;
