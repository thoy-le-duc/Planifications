/**
 * Bandeau « Démarrer votre ferme » (T49) : sur Aujourd'hui et Planches tant que la ferme n'a
 * aucune série, quatre étapes cochées selon l'état réel (requête surveillée : une écriture ici ou
 * par la synchro le met à jour), chacune menant à l'écran qui la fait ; l'import en raccourci.
 * Léger : une requête de quatre EXISTS, aucun autre module que ./etapes.ts. Contrat : ./test/contrat.ts.
 */
import { useEffect, useId, useState } from 'react';
import type { PorteDonnees } from '@planif/sync';
import './demarrer.css';
import { demander, etapesDemarrage, SQL_DEMARRAGE, TABLES_DEMARRAGE, type CibleDemarrage, type EtatDemarrage } from './etapes.ts';

const oui = (v: unknown): number => (v === 1 || v === true || v === '1' ? 1 : 0);

/**
 * État du parcours, tenu à jour ; null tant qu'il n'est pas lu, ou sans porte, ou `actif` faux.
 * Lu après l'affichage de l'écran (il ne dispute pas la base à la journée ou au plan).
 */
export function useDemarrage(porte: PorteDonnees | null, fermeId: string, actif = true): EtatDemarrage | null {
  const [lu, setLu] = useState<{ readonly porte: PorteDonnees; readonly fermeId: string; readonly etat: EtatDemarrage } | null>(null);
  useEffect(() => {
    if (porte === null || !actif) return undefined;
    let fin: (() => void) | null = null;
    let arrete = false;
    const minuterie = setTimeout(() => {
      if (arrete) return;
      fin = porte.surveiller(
        {
          sql: SQL_DEMARRAGE,
          parametres: [fermeId, fermeId, fermeId, fermeId],
          tables: TABLES_DEMARRAGE,
          convertir: (l) => etapesDemarrage({ saisons: oui(l.saisons), planches: oui(l.planches), itineraires: oui(l.itineraires), series: oui(l.series) }),
        },
        (l) => {
          const etat = l[0];
          if (etat !== undefined) setLu({ porte, fermeId, etat });
        },
      );
    }, 0);
    return () => {
      arrete = true;
      clearTimeout(minuterie);
      fin?.();
    };
  }, [porte, fermeId, actif]);
  return lu !== null && lu.porte === porte && lu.fermeId === fermeId ? lu.etat : null;
}

const COCHE = 'M5 12.5l4.5 4.5L19 7.5';

/** T65 : replié ou déplié, retenu par ferme dans le stockage local de ce téléphone. */
const CLE_REPLI = 'planif.demarrer.replie.';

/** Le choix retenu pour la ferme ; sans choix (ou stockage refusé) : replié sous 600 px de large. */
function lireRepli(fermeId: string): boolean {
  try {
    const v = localStorage.getItem(CLE_REPLI + fermeId);
    if (v === 'oui' || v === 'non') return v === 'oui';
  } catch {
    // Stockage indisponible (navigation privée…) : le défaut.
  }
  return window.innerWidth < 600;
}

function ecrireRepli(fermeId: string, replie: boolean): void {
  try {
    localStorage.setItem(CLE_REPLI + fermeId, replie ? 'oui' : 'non');
  } catch {
    // Stockage refusé : le choix vaut pour cet affichage seulement.
  }
}

export interface ProprietesBandeauDemarrer {
  readonly etat: EtatDemarrage;
  /** T65 : la ferme dont le choix replié / déplié est retenu. */
  readonly fermeId: string;
  readonly surAller: (c: CibleDemarrage) => void;
}

/**
 * Le bandeau, d'après un état déjà lu (`useDemarrage`) ; rien quand il n'est plus visible.
 * T65 : replié (titre, compte, prochaine étape) ou déplié (les 4 étapes, au plus 40 % de l'écran,
 * la liste défile à l'intérieur) ; les autres étapes restent dans la page, le CSS les cache.
 */
export function Bandeau({ etat, fermeId, surAller }: ProprietesBandeauDemarrer) {
  const idTitre = useId();
  const [choix, setChoix] = useState<{ readonly fermeId: string; readonly replie: boolean } | null>(null);
  if (!etat.visible) return null;
  const replie = choix !== null && choix.fermeId === fermeId ? choix.replie : lireRepli(fermeId);
  const faites = etat.etapes.filter((e) => e.faite).length;
  return (
    <section data-testid="demarrer-ferme" data-replie={replie ? 'oui' : 'non'} aria-labelledby={idTitre} className="dem">
      <div className="dem-tete">
        <h2 id={idTitre}>Démarrer votre ferme</h2>
        <span className="dem-compte">
          {faites}/{etat.etapes.length}
        </span>
        <button
          type="button"
          className="dem-bascule"
          aria-expanded={!replie}
          aria-controls={`${idTitre}c`}
          onClick={() => {
            setChoix({ fermeId, replie: !replie });
            ecrireRepli(fermeId, !replie);
          }}
        >
          {replie ? 'Voir les étapes' : 'Replier'}
        </button>
      </div>
      <div id={`${idTitre}c`} className="dem-corps">
        <ol className="dem-etapes">
          {etat.etapes.map((e, i) => (
            <li key={e.cle}>
              <button
                type="button"
                data-testid="etape-demarrage"
                data-etape={e.cle}
                data-faite={e.faite ? 'oui' : 'non'}
                className={e.faite ? 'dem-etape dem-etape-faite' : e === etat.prochaine ? 'dem-etape dem-etape-prochaine' : 'dem-etape'}
                onClick={() => {
                  surAller(e.cible);
                }}
              >
                <span aria-hidden="true" className="dem-pastille">
                  {e.faite ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <path d={COCHE} />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="dem-textes">
                  <strong>{e.titre}</strong>
                  <span>{e.faite ? 'Fait' : e.detail}</span>
                </span>
                <span aria-hidden="true" className="dem-chevron">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="dem-import">
          <span>Vous avez déjà un tableur ?</span>
          <button
            type="button"
            className="dem-bouton-import"
            onClick={() => {
              surAller('import');
            }}
          >
            Importer un tableur
          </button>
        </div>
      </div>
    </section>
  );
}

/** Le bandeau avec sa lecture : pour un écran qui n'a pas besoin de l'état par ailleurs. */
export function BandeauDemarrer({ porte, fermeId, surAller }: { readonly porte: PorteDonnees; readonly fermeId: string; readonly surAller: (c: CibleDemarrage) => void }) {
  const etat = useDemarrage(porte, fermeId);
  return etat === null ? null : <Bandeau etat={etat} fermeId={fermeId} surAller={surAller} />;
}

/** État vide qui guide (T49, règle 5) : ce qui manque, et un bouton qui y mène. */
export function EtatVide({ texte, bouton, surTap }: { readonly texte: string; readonly bouton: string; readonly surTap: () => void }) {
  return (
    <div className="dem-vide">
      <p>{texte}</p>
      <button type="button" className="dem-bouton-vide" onClick={surTap}>
        {bouton}
      </button>
    </div>
  );
}

/** Libellé du bouton d'un état vide qui mène à l'étape `cle`. */
export const BOUTON_ETAPE: Readonly<Record<'saison' | 'planches' | 'itineraires' | 'serie', string>> = {
  saison: 'Créer la saison',
  planches: 'Ajouter des planches',
  itineraires: 'Choisir vos itinéraires',
  serie: 'Planifier une série',
};

/**
 * Aller à `c` depuis un écran qui n'est pas celui d'arrivée : la demande est notée (./etapes.ts),
 * puis l'onglet change ; l'écran d'arrivée la prend à son ouverture.
 */
export function allerVers(c: CibleDemarrage, surOnglet: (o: 'ferme' | 'planches') => void): void {
  demander(c);
  surOnglet(c === 'serie' ? 'planches' : 'ferme');
}
