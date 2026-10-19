/**
 * Saisie d'une irrigation (T57, règle 4) : vanne et durée, depuis l'écran Aujourd'hui ou depuis
 * le repère d'une vanne dans la vue 3D. Fichier chargé à la demande (ni dans le morceau
 * d'Aujourd'hui, ni dans celui de la 3D). Contrat : ./test/contrat-irrigation.ts.
 *
 * Une irrigation est un événement du journal, en ajout seul : écrite dans la base du téléphone
 * (hors ligne compris) en une transaction, vérifiée d'abord par les règles du serveur
 * (`validerSaisie` du cœur), annulable par un événement d'annulation. Aucun calcul : la vanne et
 * la durée sont celles que le maraîcher a tapées.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { PLAFONDS_SAISIES, validerSaisie, type DateCalendaire, type Id } from '@planif/core';
import type { PorteDonnees, SaisieEvenement } from '@planif/sync';
import { useFocusDuDialogue } from './dialogue.ts';
import './irrigation.css';

export interface ProprietesSaisieIrrigation {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  /** Vanne choisie d'avance (repère 3D), ou nulle. */
  readonly vanneId?: string | null;
  readonly surFermer: () => void;
  /** Jour du téléphone, 'AAAA-MM-JJ'. */
  readonly aujourdhui?: () => string;
}

interface VanneLue {
  readonly id: string;
  readonly nom: string;
}

/** Boutons rapides : libellé, minutes. */
const RAPIDES: readonly (readonly [string, number])[] = [
  ['10 min', 10],
  ['20 min', 20],
  ['30 min', 30],
  ['1 h', 60],
];

const deux = (n: number) => String(n).padStart(2, '0');
function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** « 20 min », « 1 h », « 1 h 30 ». */
export function texteDureeIrrigation(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${deux(m)}`;
}

/** Durée tapée, en minutes entières de 1 à 24 h ; sinon le message à montrer. */
function lireDuree(texte: string): { readonly ok: true; readonly minutes: number } | { readonly ok: false; readonly message: string } {
  const t = texte.trim();
  if (!/^\d+$/.test(t)) return { ok: false, message: 'Indiquez la durée en minutes entières (par exemple 20).' };
  const minutes = Number(t);
  if (minutes < 1) return { ok: false, message: 'La durée doit être d’au moins 1 minute.' };
  if (minutes > PLAFONDS_SAISIES.irrigationMinutes) return { ok: false, message: 'La durée ne peut pas dépasser 24 h (1 440 min).' };
  return { ok: true, minutes };
}

interface Notee {
  readonly id: string;
  readonly vanneId: string;
  readonly minutes: number;
  readonly texte: string;
  readonly annulee: boolean;
}

export function SaisieIrrigation({ porte, fermeId, vanneId = null, surFermer, aujourdhui = jourDuTelephone }: ProprietesSaisieIrrigation): ReactElement {
  const idVanne = useId();
  const idDuree = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const garderFocus = useFocusDuDialogue();
  const [vannes, setVannes] = useState<readonly VanneLue[] | null>(null);
  const [choisie, setChoisie] = useState<string>(vanneId ?? '');
  const [duree, setDuree] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [notee, setNotee] = useState<Notee | null>(null);

  useEffect(() => {
    titre.current?.focus();
  }, []);

  useEffect(
    () =>
      porte.surveiller<VanneLue>(
        {
          sql: 'SELECT id, nom FROM secteur_irrigation WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY numero_vanne, id',
          parametres: [fermeId],
          tables: ['secteur_irrigation'],
          convertir: (l) => ({ id: typeof l.id === 'string' ? l.id : '', nom: typeof l.nom === 'string' ? l.nom : '' }),
        },
        (l) => {
          setVannes(l);
          // Sans vanne donnée (ou disparue), la première est proposée.
          setChoisie((c) => (l.some((v) => v.id === c) ? c : (l[0]?.id ?? '')));
        },
      ),
    [porte, fermeId],
  );

  /** Écrit l'événement préparé, en une transaction, après les règles du serveur. */
  async function ecrire(saisie: SaisieEvenement): Promise<string> {
    const e = porte.preparerSaisie(saisie);
    const r = validerSaisie(e.ligne);
    if (!r.ok) throw new Error(r.erreur.message);
    await porte.ecrireEnsemble([e.ordre]);
    return e.id;
  }

  async function enregistrer(): Promise<void> {
    if (occupe) return;
    const vanne = vannes?.find((v) => v.id === choisie);
    if (vanne === undefined) {
      setMessage('Choisissez la vanne.');
      return;
    }
    const d = lireDuree(duree);
    if (!d.ok) {
      setMessage(d.message);
      return;
    }
    setOccupe(true);
    setMessage(null);
    try {
      const id = await ecrire({
        type: 'irrigation',
        date: aujourdhui() as DateCalendaire,
        source: 'tap',
        culture: null,
        emplacementIds: [],
        note: null,
        photos: [],
        remplaceEvenement: null,
        detail: { secteurIrrigationId: vanne.id as Id<'SecteurIrrigation'>, dureeMinutes: d.minutes },
      });
      setNotee({ id, vanneId: vanne.id, minutes: d.minutes, texte: `Irrigation notée : ${vanne.nom}, ${texteDureeIrrigation(d.minutes)}`, annulee: false });
    } catch (e) {
      console.error('Irrigation non enregistrée', e);
      setMessage('Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');
    } finally {
      setOccupe(false);
    }
  }

  async function annuler(n: Notee): Promise<void> {
    if (occupe) return;
    setOccupe(true);
    try {
      await ecrire({
        type: 'irrigation',
        date: aujourdhui() as DateCalendaire,
        source: 'tap',
        culture: null,
        emplacementIds: [],
        note: null,
        photos: [],
        remplaceEvenement: { sorte: 'annulation', evenementId: n.id as Id<'Evenement'> },
        detail: { secteurIrrigationId: n.vanneId as Id<'SecteurIrrigation'>, dureeMinutes: n.minutes },
      });
      setNotee({ ...n, texte: 'Irrigation annulée', annulee: true });
    } catch (e) {
      console.error('Irrigation non annulée', e);
      setMessage('L’irrigation n’a pas pu être annulée : la base du téléphone a refusé l’écriture.');
    } finally {
      setOccupe(false);
    }
  }

  return (
    <div
      className="irr-voile"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          surFermer();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Irrigation" data-testid="saisie-irrigation" className="irr-feuille" onKeyDown={garderFocus}>
        <h2 ref={titre} tabIndex={-1} className="irr-titre">
          Irrigation
        </h2>
        <label htmlFor={idVanne} className="irr-libelle">
          Vanne
        </label>
        <select
          id={idVanne}
          className="irr-champ"
          value={choisie}
          disabled={vannes === null || vannes.length === 0}
          onChange={(e) => {
            setChoisie(e.target.value);
            setMessage(null);
          }}
        >
          {(vannes ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.nom}
            </option>
          ))}
        </select>
        {vannes !== null && vannes.length === 0 && <p className="irr-libelle">Aucune vanne : déclarez-les dans Ferme, « Saisons, zones et planches ».</p>}
        <label htmlFor={idDuree} className="irr-libelle">
          Durée (min)
        </label>
        <input
          id={idDuree}
          className="irr-champ"
          inputMode="numeric"
          autoComplete="off"
          value={duree}
          onChange={(e) => {
            setDuree(e.target.value);
            setMessage(null);
          }}
        />
        <div className="irr-rapides">
          {RAPIDES.map(([libelle, minutes]) => (
            <button
              key={libelle}
              type="button"
              className="irr-bouton"
              onClick={() => {
                setDuree(String(minutes));
                setMessage(null);
              }}
            >
              {libelle}
            </button>
          ))}
        </div>
        {message !== null && (
          <p role="alert" className="irr-erreur">
            {message}
          </p>
        )}
        <button type="button" className="irr-principal" disabled={occupe} onClick={() => void enregistrer()}>
          Enregistrer
        </button>
        {notee !== null && (
          <div data-testid="irrigation-enregistree" role="status" className="irr-notee">
            <span>{notee.texte}</span>
            {!notee.annulee && (
              <button type="button" className="irr-bouton" disabled={occupe} onClick={() => void annuler(notee)}>
                Annuler
              </button>
            )}
          </div>
        )}
        <button type="button" className="irr-bouton" onClick={surFermer}>
          Fermer
        </button>
      </div>
    </div>
  );
}

export default SaisieIrrigation;
