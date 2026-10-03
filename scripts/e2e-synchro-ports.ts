/**
 * Ports par défaut du banc e2e:synchro (T26). Module sans effet de bord, importable par les tests.
 *
 * Tous sous 32768 : au-dessus commence la plage des ports éphémères de Linux (32768–60999), où une
 * connexion sortante quelconque peut occuper le port juste avant que Docker ne le lie. Distincts
 * des ports courants (5432, 8080, 3000) et entre eux.
 */
export const PORTS_PAR_DEFAUT = {
  postgres: 15_432,
  powersync: 18_080,
  api: 13_100,
  page: 14_174,
} as const;
