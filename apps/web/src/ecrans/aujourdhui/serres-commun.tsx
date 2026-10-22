/**
 * T58 — état des serres, ce que partagent le panneau « État des serres » d'Aujourd'hui
 * (./EtatSerres.tsx), le rappel du soir (./rappel-serres.ts) et les repères de la vue 3D
 * (../plan3d/Abris3d.tsx) : lecture des abris et des changements d'état de LA ferme (base locale
 * surveillée), bouton d'un équipement, un tap = un événement `etat_abri`, « Annuler ». Contrat :
 * ./test/contrat-etat-serres.ts. Les règles (équipements déclarés, état courant) sont celles du
 * cœur (@planif/core/abris) ; rien ici ne les réécrit. Aucun réseau.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { comparerAbris, equipementsDeZone, phraseEtat, validerEquipementsAbri, EQUIPEMENTS_ABRI, type EtatEquipement, type EvenementEtatAbri, type ZoneAbri } from '@planif/core/abris';
import type { DateCalendaire, EquipementAbri, Id, TypeAbri } from '@planif/core';
import type { PorteDonnees, SaisieEvenement } from '@planif/sync';

type L = Readonly<Record<string, unknown>>;
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const TYPES_ABRI: readonly string[] = ['plein_champ', 'tunnel', 'serre', 'hors_sol'];
const estEquipement = (v: unknown): v is EquipementAbri => typeof v === 'string' && (EQUIPEMENTS_ABRI as readonly string[]).includes(v);

/** Une zone lue de la base locale (liste illisible : celle de son type d'abri, comme une liste nulle). */
function zoneDeLigne(l: L): ZoneAbri {
  const brute = l.equipements_abri;
  const liste = brute === null || brute === undefined ? null : validerEquipementsAbri(brute);
  const typeAbri = TYPES_ABRI.includes(txt(l.type_abri)) ? (txt(l.type_abri) as TypeAbri) : 'plein_champ';
  return { id: txt(l.id), nom: txt(l.nom), typeAbri, equipementsAbri: liste?.ok === true ? liste.valeur : null };
}

/** Un changement d'état lu du journal local ; null si son détail est illisible. */
function evenementDeLigne(l: L): EvenementEtatAbri | null {
  const equipement = l.equipement;
  const zoneId = txt(l.zone).toLowerCase();
  if (!estEquipement(equipement) || zoneId === '') return null;
  const sorte = l.remplace_sorte;
  return {
    id: txt(l.id),
    zoneId,
    equipement,
    // json_extract rend 1 ou 0 pour un booléen JSON.
    actif: l.actif === 1 || l.actif === true,
    horodatage: txt(l.horodatage),
    remplaceSorte: sorte === 'correction' || sorte === 'annulation' ? sorte : null,
    remplaceEvenementId: typeof l.remplace_evenement_id === 'string' ? l.remplace_evenement_id : null,
  };
}

/** Abris de LA ferme, non supprimés, qui déclarent au moins un équipement ; triés par nom. */
export function abrisDeclares(zones: readonly ZoneAbri[]): ZoneAbri[] {
  return zones.filter((z) => equipementsDeZone(z).length > 0).sort(comparerAbris);
}

/** Surveille les zones non supprimées de la ferme (avec leur liste d'équipements). */
export function surveillerZonesAbri(porte: PorteDonnees, fermeId: string, rappel: (zones: ZoneAbri[]) => void): () => void {
  return porte.surveiller<ZoneAbri>(
    {
      sql: 'SELECT id, nom, type_abri, equipements_abri FROM zone WHERE ferme_id = ? AND supprime_le IS NULL',
      parametres: [fermeId],
      tables: ['zone'],
      convertir: zoneDeLigne,
    },
    rappel,
  );
}

/** Surveille les changements d'état des abris écrits dans LA ferme (chaînes comprises : le cœur juge ce qui est en vigueur). */
export function surveillerEtatsAbri(porte: PorteDonnees, fermeId: string, rappel: (evenements: EvenementEtatAbri[]) => void): () => void {
  return porte.surveiller<EvenementEtatAbri | null>(
    {
      sql: `SELECT id, horodatage, remplace_sorte, remplace_evenement_id,
                   json_extract(detail, '$.zoneId') AS zone, json_extract(detail, '$.equipement') AS equipement, json_extract(detail, '$.actif') AS actif
            FROM evenement WHERE ferme_id = ? AND type = 'etat_abri' AND json_valid(detail)`,
      parametres: [fermeId],
      tables: ['evenement'],
      convertir: evenementDeLigne,
    },
    (lignes) => {
      rappel(lignes.filter((e): e is EvenementEtatAbri => e !== null));
    },
  );
}

/** Zones et changements d'état de la ferme, suivis dans la base ; null tant qu'ils ne sont pas lus. */
export function useAbris(porte: PorteDonnees, fermeId: string): { readonly zones: readonly ZoneAbri[] | null; readonly evenements: readonly EvenementEtatAbri[] | null } {
  const [zones, setZones] = useState<readonly ZoneAbri[] | null>(null);
  const [evenements, setEvenements] = useState<readonly EvenementEtatAbri[] | null>(null);
  useEffect(() => surveillerZonesAbri(porte, fermeId, setZones), [porte, fermeId]);
  useEffect(() => surveillerEtatsAbri(porte, fermeId, setEvenements), [porte, fermeId]);
  return { zones, evenements };
}

const deux = (n: number): string => String(n).padStart(2, '0');
export function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Ce que le dernier tap a écrit, annulable. */
export interface EtatEnregistre {
  readonly evenementId: string;
  readonly phrase: string;
  readonly detail: { readonly zoneId: string; readonly equipement: EquipementAbri; readonly actif: boolean };
}

function saisie(date: string, detail: EtatEnregistre['detail'], remplace: SaisieEvenement['remplaceEvenement']): SaisieEvenement {
  return { type: 'etat_abri', date: date as DateCalendaire, source: 'tap', culture: null, emplacementIds: [], note: null, photos: [], remplaceEvenement: remplace, detail: { ...detail, zoneId: detail.zoneId as Id<'Zone'> } };
}

/**
 * Un tap = un événement `etat_abri` (le contraire de l'état courant ; état inconnu : actif),
 * écrit hors ligne en une transaction ; « Annuler » écrit son annulation, même détail.
 */
export function useChangerEtat(porte: PorteDonnees, aujourdhui: () => string) {
  const [enregistre, setEnregistre] = useState<EtatEnregistre | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const enCours = useRef(false);
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const ecrire = useCallback(
    async (action: () => Promise<void>) => {
      if (enCours.current) return;
      enCours.current = true;
      setOccupe(true);
      setErreur(null);
      try {
        await action();
      } catch (e) {
        console.error('État des serres : écriture impossible', e);
        if (monte.current) setErreur('Rien n’a été enregistré : réessayez.');
      } finally {
        enCours.current = false;
        if (monte.current) setOccupe(false);
      }
    },
    [],
  );

  const changer = useCallback(
    (zone: ZoneAbri, equipement: EquipementAbri, etat: EtatEquipement | null) =>
      ecrire(async () => {
        const detail = { zoneId: zone.id, equipement, actif: etat === null ? true : !etat.actif };
        const id = await porte.saisirEvenement(saisie(aujourdhui(), detail, null));
        if (monte.current) setEnregistre({ evenementId: id, phrase: `${zone.nom} : ${phraseEtat(equipement, detail.actif)}`, detail });
      }),
    [ecrire, porte, aujourdhui],
  );

  const annuler = useCallback(
    () =>
      ecrire(async () => {
        if (enregistre === null) return;
        await porte.saisirEvenement(saisie(aujourdhui(), enregistre.detail, { sorte: 'annulation', evenementId: enregistre.evenementId as Id<'Evenement'> }));
        if (monte.current) setEnregistre(null);
      }),
    [ecrire, porte, aujourdhui, enregistre],
  );

  return { enregistre, occupe, erreur, changer, annuler };
}

/** 44 px de côté au moins (un doigt, avec des gants). */
const TAILLE_DOIGT = { minHeight: 44, minWidth: 44 } as const;

/** Bouton d'un équipement : son état courant dit en clair, un tap le change. */
export function BoutonEquipement({
  zone,
  equipement,
  etat,
  occupe,
  surTap,
}: {
  readonly zone: ZoneAbri;
  readonly equipement: EquipementAbri;
  readonly etat: EtatEquipement | null;
  readonly occupe: boolean;
  readonly surTap: (zone: ZoneAbri, equipement: EquipementAbri, etat: EtatEquipement | null) => void;
}): ReactElement {
  const actif = etat?.actif === true;
  const phrase = phraseEtat(equipement, actif);
  return (
    <button
      type="button"
      data-testid="equipement-abri"
      data-zone={zone.id}
      data-equipement={equipement}
      data-etat={etat === null ? 'inconnu' : actif ? 'actif' : 'inactif'}
      aria-pressed={actif}
      aria-label={`${zone.nom} : ${phrase}`}
      disabled={occupe}
      className={actif ? 'serres-equipement serres-equipement-actif' : 'serres-equipement'}
      style={TAILLE_DOIGT}
      onClick={() => {
        surTap(zone, equipement, etat);
      }}
    >
      {phrase}
    </button>
  );
}

/** Bandeau de ce qui vient d'être écrit, avec « Annuler » ; l'erreur d'écriture s'il y en a une. */
export function StatutEtat({ enregistre, erreur, occupe, surAnnuler }: { readonly enregistre: EtatEnregistre | null; readonly erreur: string | null; readonly occupe: boolean; readonly surAnnuler: () => void }): ReactElement | null {
  if (erreur !== null) {
    return (
      <p role="alert" className="serres-erreur">
        {erreur}
      </p>
    );
  }
  if (enregistre === null) return null;
  return (
    <div data-testid="etat-abri-enregistre" role="status" className="serres-statut">
      <span>{enregistre.phrase}</span>
      <button type="button" className="serres-annuler" disabled={occupe} style={TAILLE_DOIGT} onClick={surAnnuler}>
        Annuler
      </button>
    </div>
  );
}
