/**
 * Formulaire d'une série (T12) : créer ou modifier une série du plan de culture. À charger par
 * import dynamique seulement, depuis l'écran Planches : hors du JavaScript de démarrage et hors du
 * morceau du plan. N'importe ni PowerSync ni src/donnees : le formulaire reçoit la porte.
 * Contrat : ./test/contrat.ts.
 */
export {
  FormulaireSerie,
  FormulaireSerie as default,
  MARQUE_SERIE_AFFICHEE,
  type DepartSerie,
  type ProprietesFormulaireSerie,
  type SaisieSerieAnnulable,
} from './FormulaireSerie.tsx';
