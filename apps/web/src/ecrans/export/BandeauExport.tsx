/**
 * Bandeau « Export en cours » (T15e, Q28) : en tête des autres onglets que Ferme pendant un export
 * de toute la ferme, avec son avancement et « Annuler ». Absent sur Ferme (l'écran a sa barre et
 * son « Annuler »), au repos et une fois l'export fini. Annulé depuis le bandeau : « Export
 * annulé » ; échoué pendant qu'on le suivait : l'alerte d'échec. Ces deux messages restent sur
 * l'onglet où on les a vus, jusqu'au prochain changement d'onglet.
 *
 * Monté par App (coquille connectée) dès que l'export est chargé, sur tous les onglets : son
 * démontage (fin de la session connectée, appli fermée) arrête l'export. Chargé à la demande avec
 * le reste de l'export : hors du JavaScript de démarrage.
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { AlerteOrange, BoutonSecondaire, CARTE } from '../../ui/elements.tsx';
import { exportEnFond } from './arriere-plan.ts';

export interface ProprietesBandeauExport {
  /** Onglet affiché par l'appli. */
  readonly onglet: string;
  /** Ferme active de l'appli (undefined : aucune) ; un export d'une autre ferme est arrêté (Q25). */
  readonly fermeId: string | undefined;
}

const BANDEAU: CSSProperties = {
  ...CARTE,
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: '8px 12px',
  padding: '10px 14px',
  borderLeft: '8px solid var(--couleur-foret)',
};
/** Pensé pour des gants : 48 px de haut, à droite du texte. */
const ANNULER: CSSProperties = { width: 'auto', minHeight: 48, padding: '0 16px' };
const BARRE: CSSProperties = { gridColumn: '1 / -1', display: 'block', width: '100%', height: 12, accentColor: 'var(--couleur-foret)' };

/** Bandeaux montés : le démontage arrête l'export, pas le double montage de StrictMode (développement). */
let montes = 0;

export function BandeauExport({ onglet, fermeId }: ProprietesBandeauExport) {
  // Petit rendu : lu directement (useSyncExternalStore), sans transition.
  const instant = useSyncExternalStore(exportEnFond.abonner, exportEnFond.lire);

  useEffect(() => {
    montes++;
    return () => {
      montes--;
      queueMicrotask(() => {
        if (montes === 0) exportEnFond.reinitialiser();
      });
    };
  }, []);

  // Changement de ferme active (adhésion retirée, ferme supprimée) : rien de l'ancienne ferme ne
  // sort (Q25). Comparé par ferme : une porte republiée pour la même ferme ne l'arrête pas.
  const exportAutreFerme = instant.actif && instant.fermeId !== (fermeId ?? null);
  useEffect(() => {
    if (exportAutreFerme) void exportEnFond.arreter();
  }, [exportAutreFerme]);

  // Export suivi sur cet onglet (vu en cours ici) : seul lui peut y laisser un message de fin.
  const [suivi, setSuivi] = useState<{ readonly id: number; readonly onglet: string } | null>(null);
  const { id, etat } = instant;
  if (onglet === 'ferme') {
    if (suivi !== null) setSuivi(null);
    return null;
  }
  const vu = suivi?.id === id && suivi.onglet === onglet;
  if (etat.etape === 'en_cours' && !vu) setSuivi({ id, onglet });

  if (etat.etape === 'en_cours') {
    return (
      <div data-testid="export-bandeau" role="status" style={BANDEAU}>
        <span>Export en cours…</span>
        <BoutonSecondaire onClick={() => void exportEnFond.arreter()} style={ANNULER}>
          Annuler
        </BoutonSecondaire>
        {etat.total > 0 ? (
          <progress style={BARRE} max={etat.total} value={etat.fait} aria-label="Avancement de l’export" />
        ) : (
          <progress style={BARRE} aria-label="Avancement de l’export" />
        )}
      </div>
    );
  }
  if (!vu) return null;
  if (etat.etape === 'annule') {
    return (
      <p role="status" style={{ ...CARTE, margin: 0, padding: '10px 14px' }}>
        Export annulé.
      </p>
    );
  }
  if (etat.etape === 'echec') return <AlerteOrange>L’export n’a pas pu se faire. Réessayez depuis l’onglet Ferme ; si cela recommence, signalez-le.</AlerteOrange>;
  return null;
}
