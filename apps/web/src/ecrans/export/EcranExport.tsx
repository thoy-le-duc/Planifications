/**
 * Écran « Exporter toute ma ferme » (T15, principe 5) : un bouton, pensé pour des gants, qui
 * construit l'archive sur le téléphone depuis la base locale et la télécharge, même hors ligne.
 * Pendant l'export, une barre d'avancement et un bouton « Annuler » (T15b). Chargé par import dynamique seulement : hors
 * du JavaScript de démarrage. Habillage T16 : composants et jetons de src/ui.
 */
import { useRef, useState, type CSSProperties } from 'react';
import type { PorteDonnees } from '@planif/sync/export';
import { AlerteOrange, BoutonPrincipal, BoutonSecondaire } from '../../ui/elements.tsx';
import { lancerExport, telechargerDansLeNavigateur, type OptionsLancerExport } from './lancer.ts';

export interface ProprietesEcranExport {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant?: () => Date;
  readonly telecharger?: OptionsLancerExport['telecharger'];
}

const PILE: CSSProperties = { display: 'grid', gap: 16, maxWidth: 420, margin: '24px auto', padding: '0 16px' };
const BARRE: CSSProperties = { width: '100%', height: 16, accentColor: 'var(--couleur-foret)' };

const nombre = new Intl.NumberFormat('fr-FR');

type Etat = { etape: 'repos' } | { etape: 'en_cours'; fait: number; total: number } | { etape: 'fini'; message: string } | { etape: 'echec' } | { etape: 'annule' };

export function EcranExport({ porte, fermeId, maintenant = () => new Date(), telecharger = telechargerDansLeNavigateur }: ProprietesEcranExport) {
  const [etat, setEtat] = useState<Etat>({ etape: 'repos' });
  const controleur = useRef<AbortController | null>(null);

  async function exporter() {
    if (etat.etape === 'en_cours') return;
    const ctrl = new AbortController();
    controleur.current = ctrl;
    setEtat({ etape: 'en_cours', fait: 0, total: 0 });
    try {
      const archive = await lancerExport({
        porte,
        fermeId,
        maintenant,
        telecharger,
        signal: ctrl.signal,
        avancement: ({ fait, total }) => {
          if (!ctrl.signal.aborted) setEtat({ etape: 'en_cours', fait, total });
        },
      });
      const evenements = archive.lignes.evenement ?? 0;
      setEtat({ etape: 'fini', message: `Archive ${archive.nomFichier} prête : ${nombre.format(evenements)} événements exportés.` });
    } catch (erreur: unknown) {
      if (ctrl.signal.aborted) {
        setEtat({ etape: 'annule' });
        return;
      }
      console.error('Export de la ferme impossible', erreur);
      setEtat({ etape: 'echec' });
    } finally {
      if (controleur.current === ctrl) controleur.current = null;
    }
  }

  function annuler() {
    controleur.current?.abort();
    setEtat({ etape: 'annule' });
  }

  return (
    <section style={PILE}>
      <p>Toutes les données de la ferme, dans une archive ZIP : un fichier JSON complet et un tableau CSV par table, lisible dans Excel. Fonctionne sans réseau.</p>
      <BoutonPrincipal disabled={etat.etape === 'en_cours'} onClick={() => void exporter()}>
        {etat.etape === 'en_cours' ? 'Export en cours…' : 'Exporter toute ma ferme'}
      </BoutonPrincipal>
      {etat.etape === 'en_cours' &&
        (etat.total > 0 ? (
          <progress style={BARRE} max={etat.total} value={etat.fait} aria-label="Avancement de l’export" />
        ) : (
          <progress style={BARRE} aria-label="Avancement de l’export" />
        ))}
      {etat.etape === 'en_cours' && (
        <BoutonSecondaire onClick={annuler}>Annuler</BoutonSecondaire>
      )}
      {etat.etape === 'annule' && <p role="status">Export annulé.</p>}
      {etat.etape === 'fini' && <p role="status">{etat.message}</p>}
      {etat.etape === 'echec' && <AlerteOrange>L’export n’a pas pu se faire. Réessayez ; si cela recommence, signalez-le.</AlerteOrange>}
    </section>
  );
}
