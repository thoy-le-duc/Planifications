/**
 * Saisie d'une irrigation (T57, règle 4) et d'une fertirrigation (T56, règles 2 et 4) : vanne,
 * recette (facultative) et durée, depuis l'écran Aujourd'hui (« Irrigation » ou « Fertirrigation »)
 * ou depuis le repère d'une vanne dans la vue 3D. Fichier chargé à la demande (ni dans le morceau
 * d'Aujourd'hui, ni dans celui de la 3D). Contrats : ./test/contrat-irrigation.ts et
 * ./test/contrat-fertirrigation.ts.
 *
 * Une irrigation est un événement du journal, en ajout seul : écrite dans la base du téléphone
 * (hors ligne compris) en une transaction, vérifiée d'abord par les règles du serveur
 * (`validerSaisie` du cœur), annulable par un événement d'annulation. Avec une recette, le volume
 * (saisi, ou durée × débit de la vanne) et les doses injectées sont calculés par le cœur
 * (`volumeIrrigationM3`, `detailFertirrigation`) et figés dans le détail. « Recopier » refait une
 * irrigation de la veille, à l'identique, en un tap.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import {
  ajouterJours,
  detailFertirrigation,
  PLAFONDS_SAISIES,
  validerRecetteFertirrigation,
  validerSaisie,
  volumeIrrigationM3,
  type DateCalendaire,
  type DetailIrrigation,
  type Id,
  type RecetteFertirrigationEcrite,
} from '@planif/core';
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
  /** T56 : ouverte par « Fertirrigation » : la première recette est choisie d'avance. */
  readonly fertirrigation?: boolean;
}

interface VanneLue {
  readonly id: string;
  readonly nom: string;
  readonly debit: number | null;
}

interface RecetteLue {
  readonly id: string;
  readonly nom: string;
  readonly archivee: boolean;
  readonly recette: RecetteFertirrigationEcrite | null;
}

interface IrrigationDeLaVeille {
  readonly id: string;
  readonly detail: DetailIrrigation;
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

/** « 1,9 » ou « 1.9 » → 1.9 ; vide → null ; illisible → undefined. */
function lireNombre(texte: string): number | null | undefined {
  const t = texte.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : undefined;
}

function lireDetail(v: unknown): DetailIrrigation | null {
  try {
    const d = JSON.parse(String(v)) as unknown;
    return typeof d === 'object' && d !== null && typeof (d as { secteurIrrigationId?: unknown }).secteurIrrigationId === 'string' ? (d as DetailIrrigation) : null;
  } catch {
    return null;
  }
}

interface Notee {
  readonly id: string;
  readonly detail: DetailIrrigation;
  readonly texte: string;
  readonly annulee: boolean;
}

/** Une irrigation en vigueur de la veille : ni annulée, ni elle-même un remplacement. */
const SQL_VEILLE = `SELECT e.id, e.detail FROM evenement e
  WHERE e.ferme_id = ? AND e.type = 'irrigation' AND e.date = ? AND e.remplace_sorte IS NULL
    AND NOT EXISTS (SELECT 1 FROM evenement r WHERE r.ferme_id = e.ferme_id AND r.remplace_evenement_id = e.id)
  ORDER BY e.horodatage, e.id`;

export function SaisieIrrigation({ porte, fermeId, vanneId = null, surFermer, aujourdhui = jourDuTelephone, fertirrigation = false }: ProprietesSaisieIrrigation): ReactElement {
  const id = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const garderFocus = useFocusDuDialogue();
  const nomDialogue = fertirrigation ? 'Fertirrigation' : 'Irrigation';
  const [vannes, setVannes] = useState<readonly VanneLue[] | null>(null);
  const [recettes, setRecettes] = useState<readonly RecetteLue[]>([]);
  const [noms, setNoms] = useState<ReadonlyMap<string, string>>(new Map());
  const [veille, setVeille] = useState<readonly IrrigationDeLaVeille[]>([]);
  const [choisie, setChoisie] = useState<string>(vanneId ?? '');
  /** null : pas encore touchée (la première recette en « Fertirrigation », aucune sinon). */
  const [recetteTouchee, setRecetteTouchee] = useState<string | null>(null);
  const [duree, setDuree] = useState('');
  const [volume, setVolume] = useState('');
  const [ec, setEc] = useState('');
  const [ph, setPh] = useState('');
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
          sql: 'SELECT id, nom, debit_litres_heure FROM secteur_irrigation WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY numero_vanne, id',
          parametres: [fermeId],
          tables: ['secteur_irrigation'],
          convertir: (l) => ({
            id: typeof l.id === 'string' ? l.id : '',
            nom: typeof l.nom === 'string' ? l.nom : '',
            debit: typeof l.debit_litres_heure === 'number' ? l.debit_litres_heure : null,
          }),
        },
        (l) => {
          setVannes(l);
          // Sans vanne donnée (ou disparue), la première est proposée.
          setChoisie((c) => (l.some((v) => v.id === c) ? c : (l[0]?.id ?? '')));
        },
      ),
    [porte, fermeId],
  );

  useEffect(
    () =>
      porte.surveiller<RecetteLue>(
        {
          sql: 'SELECT id, ferme_id, nom, taux_injection, engrais, ec_cible, ph_cible, supprime_le FROM recette_fertirrigation WHERE ferme_id = ? ORDER BY nom, id',
          parametres: [fermeId],
          tables: ['recette_fertirrigation'],
          convertir: (l) => {
            const r = validerRecetteFertirrigation({ ...l });
            return { id: typeof l.id === 'string' ? l.id : '', nom: typeof l.nom === 'string' ? l.nom : '', archivee: l.supprime_le !== null && l.supprime_le !== undefined, recette: r.ok ? r.valeur : null };
          },
        },
        setRecettes,
      ),
    [porte, fermeId],
  );

  useEffect(
    () =>
      porte.surveiller<readonly [string, string]>(
        {
          sql: 'SELECT id, nom FROM produit_fertilisant WHERE ferme_id = ?',
          parametres: [fermeId],
          tables: ['produit_fertilisant'],
          convertir: (l) => [String(l.id).toLowerCase(), typeof l.nom === 'string' ? l.nom : ''] as const,
        },
        (l) => {
          setNoms(new Map(l));
        },
      ),
    [porte, fermeId],
  );

  const jour = aujourdhui();
  useEffect(() => {
    let hier: string;
    try {
      hier = ajouterJours(jour as DateCalendaire, -1);
    } catch {
      return undefined;
    }
    return porte.surveiller<IrrigationDeLaVeille | null>(
      {
        sql: SQL_VEILLE,
        parametres: [fermeId, hier],
        tables: ['evenement'],
        convertir: (l) => {
          const d = lireDetail(l.detail);
          return d === null || typeof l.id !== 'string' ? null : { id: l.id, detail: d };
        },
      },
      (l) => {
        setVeille(l.filter((x): x is IrrigationDeLaVeille => x !== null));
      },
    );
  }, [porte, fermeId, jour]);

  const proposees = recettes.filter((r) => !r.archivee && r.recette !== null);
  const recetteId = recetteTouchee ?? (fertirrigation ? (proposees[0]?.id ?? '') : '');
  const recette = proposees.find((r) => r.id === recetteId)?.recette ?? null;
  const vanne = vannes?.find((v) => v.id === choisie);

  const nomVanne = (vid: string): string => vannes?.find((v) => v.id.toLowerCase() === vid.toLowerCase())?.nom ?? 'vanne';
  const nomRecette = (rid: string | undefined): string | null => (rid === undefined ? null : (recettes.find((r) => r.id.toLowerCase() === rid.toLowerCase())?.nom ?? 'recette'));
  /** « V12, Fraise floraison, 20 min » ou « V13, 10 min ». */
  const resume = (d: DetailIrrigation): string => [nomVanne(d.secteurIrrigationId), nomRecette(d.recetteFertirrigationId), texteDureeIrrigation(d.dureeMinutes)].filter((x) => x !== null).join(', ');
  const texteNotee = (d: DetailIrrigation): string => `${d.recetteFertirrigationId === undefined ? 'Irrigation' : 'Fertirrigation'} notée : ${resume(d)}`;

  /** Écrit l'événement préparé, en une transaction, après les règles du serveur. */
  async function ecrire(saisie: SaisieEvenement): Promise<string> {
    const e = porte.preparerSaisie(saisie);
    const r = validerSaisie(e.ligne);
    if (!r.ok) throw new Error(r.erreur.message);
    await porte.ecrireEnsemble([e.ordre]);
    return e.id;
  }

  const saisieDe = (detail: DetailIrrigation, remplace: SaisieEvenement['remplaceEvenement']): SaisieEvenement => ({
    type: 'irrigation',
    date: aujourdhui() as DateCalendaire,
    source: 'tap',
    culture: null,
    emplacementIds: [],
    note: null,
    photos: [],
    remplaceEvenement: remplace,
    detail,
  });

  async function noter(detail: DetailIrrigation): Promise<void> {
    setOccupe(true);
    setMessage(null);
    try {
      const nouvel = await ecrire(saisieDe(detail, null));
      setNotee({ id: nouvel, detail, texte: texteNotee(detail), annulee: false });
    } catch (e) {
      console.error('Irrigation non enregistrée', e);
      setMessage('Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');
    } finally {
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    if (occupe) return;
    if (vanne === undefined) {
      setMessage('Choisissez la vanne.');
      return;
    }
    const d = lireDuree(duree);
    if (!d.ok) {
      setMessage(d.message);
      return;
    }
    if (recette === null) {
      void noter({ secteurIrrigationId: vanne.id as Id<'SecteurIrrigation'>, dureeMinutes: d.minutes });
      return;
    }
    const mesures = [lireNombre(volume), lireNombre(ec), lireNombre(ph)] as const;
    if (mesures.some((x) => x === undefined)) {
      setMessage('Volume, EC et pH : un nombre (virgule acceptée), ou rien.');
      return;
    }
    const volumeM3 = mesures[0] ?? volumeIrrigationM3(d.minutes, vanne.debit);
    if (volumeM3 === null || volumeM3 <= 0) {
      setMessage('Indiquez le volume d’eau (m³) : cette vanne n’a pas de débit enregistré.');
      return;
    }
    void noter(
      detailFertirrigation({ secteurIrrigationId: vanne.id, dureeMinutes: d.minutes, recette, noms, volumeM3, ecMesuree: mesures[1] ?? null, phMesure: mesures[2] ?? null }),
    );
  }

  async function annuler(n: Notee): Promise<void> {
    if (occupe) return;
    setOccupe(true);
    try {
      await ecrire(saisieDe(n.detail, { sorte: 'annulation', evenementId: n.id as Id<'Evenement'> }));
      setNotee({ ...n, texte: n.detail.recetteFertirrigationId === undefined ? 'Irrigation annulée' : 'Fertirrigation annulée', annulee: true });
    } catch (e) {
      console.error('Irrigation non annulée', e);
      setMessage('L’irrigation n’a pas pu être annulée : la base du téléphone a refusé l’écriture.');
    } finally {
      setOccupe(false);
    }
  }

  const dureeLue = lireDuree(duree);
  const volumeCalcule = recette !== null && vanne !== undefined && dureeLue.ok ? volumeIrrigationM3(dureeLue.minutes, vanne.debit) : null;
  const champMesure = (cle: string, libelle: string, valeur: string, changer: (v: string) => void, indication: string) => (
    <>
      <label htmlFor={`${id}-${cle}`} className="irr-libelle">
        {libelle}
      </label>
      <input
        id={`${id}-${cle}`}
        className="irr-champ"
        inputMode="decimal"
        autoComplete="off"
        placeholder={indication}
        value={valeur}
        onChange={(e) => {
          changer(e.target.value);
          setMessage(null);
        }}
      />
    </>
  );

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
      <div role="dialog" aria-modal="true" aria-label={nomDialogue} data-testid="saisie-irrigation" className="irr-feuille" onKeyDown={garderFocus}>
        <h2 ref={titre} tabIndex={-1} className="irr-titre">
          {nomDialogue}
        </h2>
        {veille.length > 0 && (
          <div className="irr-veille" role="group" aria-label="Recopier la veille">
            {veille.map((v) => (
              <button key={v.id} type="button" className="irr-bouton" disabled={occupe} onClick={() => void noter(v.detail)}>
                {`Recopier : ${resume(v.detail)}`}
              </button>
            ))}
          </div>
        )}
        <label htmlFor={`${id}-vanne`} className="irr-libelle">
          Vanne
        </label>
        <select
          id={`${id}-vanne`}
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
        <label htmlFor={`${id}-recette`} className="irr-libelle">
          Recette
        </label>
        <select
          id={`${id}-recette`}
          className="irr-champ"
          value={recetteId}
          onChange={(e) => {
            setRecetteTouchee(e.target.value);
            setMessage(null);
          }}
        >
          <option value="">Sans engrais</option>
          {proposees.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nom}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-duree`} className="irr-libelle">
          Durée (min)
        </label>
        <input
          id={`${id}-duree`}
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
        {recette !== null && (
          <>
            {champMesure('volume', 'Volume (m³)', volume, setVolume, volumeCalcule === null ? 'à saisir' : `${String(volumeCalcule).replace('.', ',')} (durée × débit)`)}
            {champMesure('ec', 'EC mesurée', ec, setEc, 'facultatif')}
            {champMesure('ph', 'pH mesuré', ph, setPh, 'facultatif')}
          </>
        )}
        {message !== null && (
          <p role="alert" className="irr-erreur">
            {message}
          </p>
        )}
        <button type="button" className="irr-principal" disabled={occupe} onClick={enregistrer}>
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
