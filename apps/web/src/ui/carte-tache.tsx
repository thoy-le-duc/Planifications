/**
 * Carte de tâche (T16, maquette « Aujourd'hui ») : à part des composants du démarrage, elle ne
 * pèse que dans les écrans qui l'utilisent.
 */
import { CARTE } from './elements.tsx';

export type Bande = 'salades' | 'solanacees' | 'cruciferes' | 'racines' | 'retard';

export interface ProprietesCarteTache {
  readonly titre: string;
  readonly detail?: string;
  /** Code de planche, « T2-P03 ». */
  readonly planche?: string;
  readonly bande: Bande;
  /** « 7 jours de retard ». */
  readonly retard?: string;
  readonly action?: { readonly libelle: string; readonly nomAccessible: string; readonly surAction: () => void };
}


/** Code de planche en mono, sur une étiquette. Seul dans son élément : lu tel quel par les tests. */
function CodePlanche({ code }: { readonly code: string }) {
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        marginTop: 4,
        fontFamily: 'var(--police-code)',
        fontWeight: 600,
        fontSize: 14,
        background: 'var(--couleur-fond)',
        padding: '4px 8px',
        borderRadius: 'var(--rayon-etiquette)',
      }}
    >
      {code}
    </span>
  );
}

function TexteRetard({ texte }: { readonly texte: string }) {
  return <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--couleur-texte-orange)' }}>{texte}</span>;
}

/** Tâche : bande de famille à gauche, texte, gros bouton d'action à droite. */
export function CarteTache({ titre, detail, planche, bande, retard, action }: ProprietesCarteTache) {
  return (
    <div data-testid="carte-tache" style={{ ...CARTE, display: 'flex', alignItems: 'stretch' }}>
      <div
        data-testid="bande-famille"
        style={{ width: 8, flexShrink: 0, background: bande === 'retard' ? 'var(--couleur-orange)' : `var(--famille-${bande})` }}
      />
      <div style={{ flexGrow: 1, padding: '14px 12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{titre}</span>
        {detail !== undefined && <span style={{ fontSize: 15, color: 'var(--couleur-secondaire)' }}>{detail}</span>}
        {planche !== undefined && retard !== undefined ? (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <CodePlanche code={planche} />
            <TexteRetard texte={retard} />
          </span>
        ) : planche !== undefined ? (
          <CodePlanche code={planche} />
        ) : (
          retard !== undefined && <TexteRetard texte={retard} />
        )}
      </div>
      {action !== undefined && (
        <button
          type="button"
          aria-label={action.nomAccessible}
          onClick={action.surAction}
          style={{
            width: 76,
            flexShrink: 0,
            border: 0,
            background: 'var(--couleur-foret)',
            color: 'var(--couleur-sur-foret)',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {action.libelle}
        </button>
      )}
    </div>
  );
}

