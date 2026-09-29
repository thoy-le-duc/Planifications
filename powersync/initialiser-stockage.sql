-- Premier démarrage du Postgres de docker-compose.yml : base où le service PowerSync range ses
-- buckets, à part de la base de l'API (planif). Développement local seulement.
CREATE DATABASE powersync_stockage;
