/**
 * L'équipe de la ferme (T60, règle 1) : les personnes et leur prénom, avec ou sans compte. Le
 * gérant ajoute un ouvrier sans téléphone (prénom seul), lie une personne au compte d'un membre
 * (l'équipier lui dit son code, affiché ici), la retire ; tout s'annule 10 s par le bandeau. Un
 * équipier voit la liste et son code. Chargé à la demande depuis l'onglet Ferme ; reçoit la
 * porte, marche hors ligne. Contrat : ../equipe.test.tsx.
 */
import { useEffect, useId, useState, type ReactElement } from 'react';
import type { PorteDonnees } from '@planif/sync';
import '../../parcellaire/parcellaire.css';
import { Feuille } from '../phyto/Feuille.tsx';
import { ajouterPersonne, changerPersonne, EquipeRefusee, lireEquipe, type ContexteEquipe, type EquipeLue, type Valeur } from './donnees.ts';

export interface ProprietesEcranEquipe {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly utilisateurId: string;
  readonly maintenant?: () => Date;
  readonly surFermer: () => void;
}

const DELAI_ANNULATION_MS = 10_000;

interface Annulable {
  readonly numero: number;
  readonly texte: string;
  readonly annuler: () => Promise<unknown>;
}

function messageEchec(e: unknown): string {
  return e instanceof EquipeRefusee ? `Non enregistré : ${e.message}.` : 'L’équipe n’a pas pu s’enregistrer sur ce téléphone. Réessayez ; si cela recommence, signalez-le.';
}

export function EcranEquipe({ porte, fermeId, utilisateurId, maintenant = () => new Date(), surFermer }: ProprietesEcranEquipe): ReactElement {
  const [equipe, setEquipe] = useState<EquipeLue | null>(null);
  const [prenom, setPrenom] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [annulable, setAnnulable] = useState<Annulable | null>(null);
  const idPrenom = useId();
  const ctx: ContexteEquipe = { porte, fermeId, utilisateurId, maintenant };

  useEffect(() => {
    let actif = true;
    let numero = 0;
    const lire = () => {
      const n = ++numero;
      lireEquipe(porte, fermeId, utilisateurId).then(
        (e) => {
          if (actif && n === numero) setEquipe(e);
        },
        (e: unknown) => {
          console.error('Équipe illisible', e);
        },
      );
    };
    const fin = porte.surveiller({ sql: 'SELECT 1 AS signal', tables: ['personne', 'membre'] }, lire);
    return () => {
      actif = false;
      fin();
    };
  }, [porte, fermeId, utilisateurId]);

  useEffect(() => {
    if (annulable === null) return undefined;
    const minuterie = setTimeout(() => {
      setAnnulable((a) => (a?.numero === annulable.numero ? null : a));
    }, DELAI_ANNULATION_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [annulable]);

  function faire(action: () => Promise<Annulable | null>): void {
    setErreur(null);
    action().then(
      (a) => {
        if (a !== null) setAnnulable(a);
      },
      (e: unknown) => {
        console.error('Équipe non enregistrée', e);
        setErreur(messageEchec(e));
      },
    );
  }

  /** Change la personne, et rend l'annulation (les valeurs d'avant). */
  const changer = (id: string, valeurs: Readonly<Record<string, Valeur>>, texte: string) => async (): Promise<Annulable | null> => {
    const avant = await changerPersonne(ctx, id, valeurs);
    if (Object.keys(avant).length === 0) return null;
    return { numero: Date.now(), texte, annuler: () => changerPersonne(ctx, id, avant) };
  };

  const gerant = equipe?.moi?.gerant === true;
  const libres = (personneId: string) => (equipe?.membres ?? []).filter((m) => !(equipe?.personnes ?? []).some((p) => p.membreId === m.id && p.id !== personneId));

  return (
    <Feuille titre="Équipe" surtitre="Ferme" surFermer={surFermer}>
      {equipe?.moi !== null && equipe?.moi !== undefined && (
        <p className="parc-aide">
          Mon code : <strong data-testid="mon-code">{equipe.moi.code}</strong>. Donnez-le au gérant pour voir vos travaux.
        </p>
      )}
      {equipe === null ? (
        <p className="parc-aide">Lecture de l’équipe…</p>
      ) : (
        <section className="parc-section" aria-label="Personnes de l’équipe">
          {equipe.personnes.length === 0 && <p className="parc-aide">Personne dans l’équipe pour l’instant.</p>}
          <ul className="parc-liste">
            {equipe.personnes.map((p) => (
              <li key={p.id} data-testid="personne" data-personne={p.id} className="parc-ligne">
                <span className="parc-ligne-textes">
                  <strong>{p.prenom}</strong>
                  <span>{p.membreId === null ? 'sans compte : consignes imprimées' : 'a un compte'}</span>
                </span>
                {gerant && (
                  <span className="parc-actions">
                    <select
                      aria-label={`Compte de ${p.prenom}`}
                      className="parc-champ"
                      value={p.membreId ?? ''}
                      onChange={(e) => {
                        const membre = e.target.value === '' ? null : e.target.value;
                        faire(changer(p.id, { membre_id: membre }, membre === null ? `${p.prenom} : sans compte` : `${p.prenom} : compte lié`));
                      }}
                    >
                      <option value="">Sans compte</option>
                      {libres(p.id).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.gerant ? 'Gérant' : 'Équipier'} · code {m.code}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Retirer ${p.prenom}`}
                      className="parc-bouton-secondaire"
                      onClick={() => {
                        faire(changer(p.id, { supprime_le: maintenant().toISOString() }, `${p.prenom} retiré de l’équipe`));
                      }}
                    >
                      Retirer
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {gerant && (
        <form
          className="parc-section"
          onSubmit={(e) => {
            e.preventDefault();
            const p = prenom.trim();
            if (p === '') return;
            faire(async () => {
              const id = await ajouterPersonne(ctx, p);
              setPrenom('');
              return { numero: Date.now(), texte: `${p} ajouté à l’équipe`, annuler: () => changerPersonne(ctx, id, { supprime_le: maintenant().toISOString() }) };
            });
          }}
        >
          <div className="parc-champ-bloc">
            <label className="parc-etiquette" htmlFor={idPrenom}>
              Prénom
            </label>
            <input
              id={idPrenom}
              className="parc-champ"
              autoComplete="off"
              maxLength={60}
              value={prenom}
              onChange={(e) => {
                setPrenom(e.target.value);
              }}
            />
          </div>
          <p className="parc-aide">Un ouvrier sans téléphone s’ajoute par son prénom : ses consignes s’impriment depuis « Fiche du jour ».</p>
          <button type="submit" className="parc-bouton-principal" disabled={prenom.trim() === ''}>
            Ajouter
          </button>
        </form>
      )}
      {erreur !== null && (
        <p role="alert" className="parc-erreur">
          {erreur}
        </p>
      )}
      {annulable !== null && (
        <div key={annulable.numero} data-testid="equipe-annulable" role="status" className="parc-bandeau">
          <span className="parc-bandeau-texte">
            <strong>Enregistré</strong>
            <span>{annulable.texte}</span>
          </span>
          <button
            type="button"
            className="parc-bandeau-annuler"
            onClick={() => {
              const a = annulable;
              setAnnulable(null);
              a.annuler().catch((e: unknown) => {
                console.error('Annulation impossible', e);
                setErreur(messageEchec(e));
              });
            }}
          >
            Annuler
          </button>
        </div>
      )}
    </Feuille>
  );
}
