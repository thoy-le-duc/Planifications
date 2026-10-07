/**
 * Écran « Importer un tableur » (T14b), habillé comme la maquette « Import » : déposer un fichier,
 * dire ce qu'il contient, faire correspondre les colonnes puis les valeurs, aperçu, importer.
 * Chargé à la demande depuis l'onglet Ferme ; il reçoit la porte (ni PowerSync, ni src/donnees).
 * Contrat : ./test/contrat.ts.
 *
 * Le calcul est celui du moteur de T14, dans un Web Worker (./preparateur.ts). Le lecteur Excel
 * se charge au dépôt d'un .xlsx seulement. Rien n'est écrit avant « Importer » ; l'import s'écrit
 * en lots d'au plus 500 écritures (un envoi chacun), annulable depuis « Imports récents ».
 */
import { startTransition, useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react';
import {
  CHAMPS_IMPORT,
  creerModele,
  proposerCorrespondance,
  type ChoixValeur,
  type CleChamp,
  type ColonneAssociee,
  type Correspondance,
  type DecisionPrise,
  type TypeContenu,
} from '@planif/core';
import type { PorteDonnees } from '@planif/sync';
import './import.css';
import { lireContexte } from './contexte-base.ts';
import { annulerImport, importsDeLaFerme, noterImport, type ImportPasse } from './historique.ts';
import { modeleQuiConvient, rangerModele } from './modeles.ts';
import { creerPreparateur } from './preparateur.ts';
import { enFrancais, PLAFOND_VALEURS_A_RAPPROCHER } from './constantes.ts';
import type { Analyse, Apercu, ContexteBase, DecisionAffichee, LigneApercu, Preparateur, ResultatLecture } from './types.ts';

export interface ProprietesEcranImport {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  /** Horloge (horodatages, année de saison proposée) ; défaut () => new Date(). */
  readonly maintenant?: () => Date;
}

type Etape = 'depot' | 'type' | 'colonnes' | 'valeurs' | 'apercu' | 'fini';

const NUMERO: Readonly<Record<Etape, number>> = { depot: 1, type: 2, colonnes: 3, valeurs: 4, apercu: 5, fini: 5 };
const TITRE: Readonly<Record<Etape, string>> = {
  depot: 'Déposer un fichier',
  type: 'Ce qu’il contient',
  colonnes: 'Colonnes',
  valeurs: 'Valeurs',
  apercu: 'Aperçu',
  fini: 'Importé',
};

const TYPES: readonly { readonly valeur: TypeContenu; readonly libelle: string; readonly detail: string }[] = [
  { valeur: 'parcellaire', libelle: 'Parcellaire', detail: 'Zones, planches, rangs, gouttières' },
  { valeur: 'cultures', libelle: 'Cultures et itinéraires', detail: 'Cultures, familles, durées, densités' },
  { valeur: 'series', libelle: 'Séries', detail: 'Ce qui est prévu : cultures, planches, dates' },
  { valeur: 'assolement', libelle: 'Assolement passé', detail: 'Ce qui a poussé où, les années passées' },
];

const ZONE_PROPOSEE = 'Ma ferme';
/** Colonnes dessinées par tranche à l'étape 3. */
const TRANCHE_COLONNES = 10;
const CROIX = 'M18 6 6 18M6 6l12 12';
const CHEVRON = 'M15 18l-6-6 6-6';

const maintenantParDefaut = () => new Date();

/** Mois (0 = janvier) à partir duquel l'année proposée est celle de la saison suivante : à l'automne, on prépare la suivante. */
const MOIS_SAISON_SUIVANTE = 8;

/** Année de saison proposée : celle de maintenant, ou la suivante à partir de septembre (modifiable). */
function anneeProposee(d: Date): number {
  return d.getMonth() >= MOIS_SAISON_SUIVANTE ? d.getFullYear() + 1 : d.getFullYear();
}

const lignesImportees = (n: number): string => `${enFrancais(n)} ${n === 1 ? 'ligne importée' : 'lignes importées'}`;

function Icone({ chemin }: { readonly chemin: string }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={chemin} />
    </svg>
  );
}

/** Clé d'une décision de valeur. */
const cleDecision = (champ: string, valeur: string): string => `${champ}\u0001${valeur}`;

const dateCourte = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};

interface EtatFichier {
  readonly analyse: Analyse;
  /** Modèle de la ferme qui convient aux en-têtes. */
  readonly modele: { readonly correspondance: Correspondance; readonly choix: readonly ChoixValeur[] } | null;
}

export function EcranImport({ porte, fermeId, surFermer, maintenant = maintenantParDefaut }: ProprietesEcranImport): ReactElement {
  const idTitre = useId();
  const [etape, setEtape] = useState<Etape>('depot');
  const [occupe, setOccupe] = useState(false);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [historique, setHistorique] = useState<readonly ImportPasse[]>(() => importsDeLaFerme(fermeId));
  const [fichier, setFichier] = useState<EtatFichier | null>(null);
  const [type, setType] = useState<TypeContenu | null>(null);
  const [annee, setAnnee] = useState(() => String(anneeProposee(maintenant())));
  const [correspondance, setCorrespondance] = useState<Correspondance | null>(null);
  const [modeleApplique, setModeleApplique] = useState(false);
  const [zoneParDefaut, setZoneParDefaut] = useState(ZONE_PROPOSEE);
  const [contexte, setContexte] = useState<ContexteBase | null>(null);
  const [decisions, setDecisions] = useState<readonly DecisionAffichee[]>([]);
  const [choixPris, setChoixPris] = useState<Readonly<Record<string, string>>>({});
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [fini, setFini] = useState<{ readonly passe: ImportPasse; readonly annule: boolean } | null>(null);
  const [avancement, setAvancement] = useState<string | null>(null);
  // Étape 3 : les colonnes se dessinent par tranches (aucune tâche de plus de 50 ms, CPU lent).
  const [colonnesVisibles, setColonnesVisibles] = useState(TRANCHE_COLONNES);
  const toutesVisibles = etape !== 'colonnes' || colonnesVisibles >= (fichier?.analyse.entetes.length ?? 0);
  useEffect(() => {
    if (toutesVisibles) return undefined;
    const minuterie = setTimeout(() => {
      setColonnesVisibles((n) => n + TRANCHE_COLONNES);
    }, 0);
    return () => {
      clearTimeout(minuterie);
    };
  }, [toutesVisibles, colonnesVisibles]);

  // Moteur de préparation : un par écran ouvert (Worker arrêté à la fermeture).
  const preparateur = useRef<Preparateur | null>(null);
  const obtenirPreparateur = (): Preparateur => {
    preparateur.current ??= creerPreparateur();
    return preparateur.current;
  };
  useEffect(
    () => () => {
      preparateur.current?.fermer();
      preparateur.current = null;
    },
    [],
  );

  const corps = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (corps.current !== null) corps.current.scrollTop = 0;
  }, [etape]);

  const entetes = useMemo(() => fichier?.analyse.entetes ?? [], [fichier]);
  const champs = type === null ? [] : CHAMPS_IMPORT[type];
  const zoneAssociee = correspondance?.colonnes.some((c) => c.champ === 'zone') ?? false;
  const demandeZone = type === 'parcellaire' && !zoneAssociee;
  const refusModele = useMemo(() => {
    if (correspondance === null) return null;
    const r = creerModele(entetes, correspondance, []);
    return r.ok ? null : r.message;
  }, [entetes, correspondance]);

  // ── Étape 1 : déposer ────────────────────────────────────────────────────────────────────────

  function recommencer(): void {
    setEtape('depot');
    setFichier(null);
    setType(null);
    setCorrespondance(null);
    setModeleApplique(false);
    setZoneParDefaut(ZONE_PROPOSEE);
    setContexte(null);
    setDecisions([]);
    setChoixPris({});
    setApercu(null);
    setFini(null);
    setAlerte(null);
    setAvancement(null);
    setHistorique(importsDeLaFerme(fermeId));
  }

  async function lireFichier(f: File): Promise<void> {
    if (occupe) return;
    setOccupe(true);
    setAlerte(null);
    try {
      const octets = new Uint8Array(await f.arrayBuffer());
      const p = obtenirPreparateur();
      let lu: ResultatLecture;
      const classeur = /\.xlsx$/i.test(f.name) || (octets[0] === 0x50 && octets[1] === 0x4b && octets[2] === 0x03 && octets[3] === 0x04);
      if (classeur) {
        // Lecteur Excel chargé ici seulement, au dépôt d'un classeur.
        const { lecteurXlsx } = await import('@planif/core/import-xlsx');
        const r = await lecteurXlsx.lire(octets);
        if (!r.ok) {
          setAlerte(r.message);
          return;
        }
        const feuille = r.feuilles.find((x) => x.lignes.length > 0) ?? r.feuilles[0];
        if (feuille === undefined) {
          setAlerte('Ce classeur ne contient aucune feuille lisible.');
          return;
        }
        lu = await p.lireFeuille(f.name, { lignes: feuille.lignes, systemeDates: feuille.systemeDates });
      } else {
        lu = await p.lireOctets(f.name, octets);
      }
      if (!lu.ok) {
        setAlerte(lu.message);
        return;
      }
      const a = lu.analyse;
      const m = modeleQuiConvient(fermeId, a.entetes);
      setFichier({ analyse: a, modele: m === null ? null : { correspondance: m.correspondance, choix: m.modele.choix } });
      setType(m?.correspondance.type ?? a.typePropose);
      setCorrespondance(null);
      setModeleApplique(false);
      setEtape('type');
    } catch (e) {
      console.error('Lecture du fichier impossible', e);
      setAlerte('Ce fichier n’a pas pu être lu. Enregistrez-le en CSV ou en .xlsx et réessayez.');
    } finally {
      setOccupe(false);
    }
  }

  function surChoixFichier(liste: FileList | null): void {
    const f = liste?.[0];
    if (f !== undefined) void lireFichier(f);
  }

  // ── Étape 2 : type ──────────────────────────────────────────────────────────────────────────

  function versColonnes(): void {
    if (fichier === null || type === null) return;
    const m = fichier.modele;
    if (m !== null && m.correspondance.type === type) {
      setCorrespondance(m.correspondance);
      setModeleApplique(true);
    } else {
      setCorrespondance(proposerCorrespondance(entetes, type));
      setModeleApplique(false);
    }
    setAlerte(null);
    // Rendu interruptible (CPU lent) : la liste des colonnes se dessine par tranches.
    setColonnesVisibles(TRANCHE_COLONNES);
    startTransition(() => {
      setEtape('colonnes');
    });
  }

  // ── Étape 3 : colonnes ──────────────────────────────────────────────────────────────────────

  const proposee = useMemo(() => (type === null ? null : proposerCorrespondance(entetes, type)), [entetes, type]);

  function associer(i: number, champ: CleChamp | null): void {
    if (correspondance === null) return;
    const colonnes: ColonneAssociee[] = correspondance.colonnes.map((c, j) => {
      if (j === i) {
        const unite = proposee?.colonnes[i]?.unite ?? null;
        return { champ, unite: champ === null ? null : unite };
      }
      // Un champ déplacé ailleurs : la colonne qui le portait n'est pas libérée en silence
      // (creerModele le signale), sauf une unité qui ne convient plus.
      return c;
    });
    let nouvelle: Correspondance = { type: correspondance.type, colonnes };
    const r = creerModele(entetes, nouvelle, []);
    if (!r.ok && r.code === 'unite_refusee' && r.colonne === i) {
      nouvelle = { type: correspondance.type, colonnes: colonnes.map((c, j) => (j === i ? { champ: c.champ, unite: null } : c)) };
    }
    setCorrespondance(nouvelle);
    setModeleApplique(false);
  }

  const anneeSaison = (() => {
    const n = Number(annee);
    return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
  })();

  /** Choix de valeurs : ceux du modèle de la ferme, puis ceux pris à l'étape 4. */
  function choixCourants(liste: readonly DecisionAffichee[], pris: Readonly<Record<string, string>>): ChoixValeur[] {
    const modele = fichier?.modele?.correspondance.type === type ? fichier.modele.choix : [];
    const pr: ChoixValeur[] = [];
    for (const d of liste) {
      const v = pris[cleDecision(d.champ, d.valeur)] ?? '';
      if (v === '') continue;
      const decision: DecisionPrise = v === 'nouvelle' ? { sorte: 'nouvelle', nom: d.valeur } : { sorte: 'existante', id: v };
      pr.push({ champ: d.champ, valeur: d.valeur, decision });
    }
    return [...pr, ...modele];
  }

  async function preparer(liste: readonly DecisionAffichee[], pris: Readonly<Record<string, string>>, relire: boolean): Promise<void> {
    if (fichier === null || correspondance === null || occupe) return;
    setOccupe(true);
    setAlerte(null);
    try {
      // La base est relue en quittant les colonnes ; l'étape des valeurs garde la même lecture.
      const ctx = !relire && contexte !== null ? contexte : await lireContexte(porte, fermeId);
      setContexte(ctx);
      const r = await obtenirPreparateur().preparer({
        correspondance,
        anneeSaison,
        choix: choixCourants(liste, pris),
        zoneParDefaut: demandeZone ? zoneParDefaut.trim() : null,
        contexte: ctx,
        maintenant: maintenant().toISOString(),
        nomFichier: fichier.analyse.nomFichier,
        plafondValeurs: PLAFOND_VALEURS_A_RAPPROCHER,
      });
      if (r.sorte === 'plafond') {
        setAlerte(
          `Ce fichier nomme ${enFrancais(r.nombre)} cultures ou familles différentes : au-delà de ${enFrancais(PLAFOND_VALEURS_A_RAPPROCHER)}, l’appli ne peut pas les rapprocher une à une. Vérifiez la colonne choisie pour « Culture », ou découpez le fichier.`,
        );
        return;
      }
      if (r.sorte === 'decisions') {
        const nouveaux: Record<string, string> = { ...pris };
        for (const d of r.decisions) {
          const k = cleDecision(d.champ, d.valeur);
          nouveaux[k] ??= d.propositions[0]?.id ?? '';
        }
        setDecisions(r.decisions);
        setChoixPris(nouveaux);
        setEtape('valeurs');
        return;
      }
      setApercu(r.apercu);
      setEtape('apercu');
    } catch (e) {
      console.error('Préparation de l’import impossible', e);
      setAlerte('La préparation de l’import a échoué. Réessayez ; si cela recommence, signalez-le.');
    } finally {
      setOccupe(false);
    }
  }

  // ── Étape 5 : importer ──────────────────────────────────────────────────────────────────────

  async function importer(): Promise<void> {
    if (fichier === null || correspondance === null || apercu === null || occupe) return;
    setOccupe(true);
    setAlerte(null);
    const instant = maintenant().toISOString();
    const passe: ImportPasse = {
      id: crypto.randomUUID(),
      fichier: fichier.analyse.nomFichier,
      type: correspondance.type,
      lignes: apercu.valides,
      le: instant,
      etat: 'actif',
      creees: apercu.creees,
    };
    // Le modèle validé est gardé pour la ferme (même si l'import est annulé ensuite).
    const modele = creerModele(entetes, correspondance, choixCourants(decisions, choixPris));
    if (modele.ok) rangerModele(fermeId, modele.modele);
    // Noté avant d'écrire : un import interrompu s'annule aussi depuis l'historique.
    noterImport(fermeId, passe);
    let faits = 0;
    try {
      for (let i = 0; i < apercu.lots; i++) {
        if (apercu.lots > 1) setAvancement(`Envoi ${enFrancais(i + 1)} sur ${enFrancais(apercu.lots)}…`);
        const ordres = await obtenirPreparateur().lot(i);
        await porte.ecrireEnsemble(ordres);
        faits++;
      }
      setFini({ passe, annule: false });
      setEtape('fini');
    } catch (e) {
      console.error('Import interrompu', e);
      setAlerte(
        faits === 0
          ? 'Rien n’a été importé : la base du téléphone a refusé l’écriture.'
          : `Import interrompu après ${enFrancais(faits)} envois sur ${enFrancais(apercu.lots)}. Ce qui est écrit s’annule depuis « Imports récents ».`,
      );
    } finally {
      setAvancement(null);
      setOccupe(false);
    }
  }

  async function annuler(passe: ImportPasse): Promise<void> {
    if (occupe) return;
    setOccupe(true);
    setAlerte(null);
    try {
      await annulerImport(porte, fermeId, passe, maintenant().toISOString());
      if (fini?.passe.id === passe.id) setFini({ passe, annule: true });
    } catch (e) {
      console.error('Annulation de l’import impossible', e);
      setAlerte('L’import n’a pas pu être annulé entièrement. Réessayez.');
    } finally {
      setHistorique(importsDeLaFerme(fermeId));
      setOccupe(false);
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────────────────────────

  function retour(): void {
    setAlerte(null);
    if (etape === 'type') recommencer();
    else if (etape === 'colonnes') setEtape('type');
    else if (etape === 'valeurs') setEtape('colonnes');
    else if (etape === 'apercu') setEtape(decisions.length > 0 ? 'valeurs' : 'colonnes');
  }

  const valeursCompletes = decisions.every((d) => (choixPris[cleDecision(d.champ, d.valeur)] ?? '') !== '');
  let continuerActif = false;
  let surContinuer: () => void = () => undefined;
  let aideContinuer = '';
  if (etape === 'type') {
    continuerActif = type !== null && !occupe;
    surContinuer = versColonnes;
    aideContinuer = type === null ? 'Choisissez ce que contient le fichier.' : 'Rien n’est écrit avant « Importer ».';
  } else if (etape === 'colonnes') {
    continuerActif = !occupe && toutesVisibles && refusModele === null && (!demandeZone || zoneParDefaut.trim() !== '');
    surContinuer = () => {
      setDecisions([]);
      void preparer([], {}, true);
    };
    aideContinuer = 'Rien n’est écrit avant « Importer ». Correspondance gardée pour le prochain fichier.';
  } else if (etape === 'valeurs') {
    continuerActif = !occupe && valeursCompletes;
    surContinuer = () => void preparer(decisions, choixPris, false);
    aideContinuer = valeursCompletes ? 'Vos choix sont gardés pour le prochain fichier.' : 'Choisissez une culture pour chaque valeur.';
  }

  // ── Rendu ───────────────────────────────────────────────────────────────────────────────────

  const nomFichier = fichier?.analyse.nomFichier ?? '';
  const resumeFichier =
    fichier === null
      ? ''
      : [
          type === null ? 'type à choisir' : (TYPES.find((t) => t.valeur === type)?.libelle ?? ''),
          `${enFrancais(fichier.analyse.lignesDonnees)} lignes`,
          `en-têtes en ligne ${String(fichier.analyse.ligneEntete + 1)}`,
        ].join(' · ');

  function deposerGlisse(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    surChoixFichier(e.dataTransfer.files);
  }

  return (
    <div className="imp-voile">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Importer un tableur"
        aria-describedby={idTitre}
        data-testid="ecran-import"
        data-etape={etape}
        className="imp-feuille"
        onKeyDown={(e) => {
          if (e.key === 'Escape') surFermer();
        }}
      >
        <header className="imp-tete">
          {etape !== 'depot' && etape !== 'fini' ? (
            <button type="button" aria-label="Retour" className="imp-bouton-rond" onClick={retour} disabled={occupe}>
              <Icone chemin={CHEVRON} />
            </button>
          ) : null}
          <span className="imp-tete-textes">
            <span className="imp-surtitre">
              Import · étape {NUMERO[etape]} sur 5
            </span>
            <h2 id={idTitre}>{TITRE[etape]}</h2>
          </span>
          <button type="button" aria-label="Fermer" className="imp-bouton-rond" onClick={surFermer}>
            <Icone chemin={CROIX} />
          </button>
        </header>
        <div className="imp-progression" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((n) => (
            <i key={n} className={n <= NUMERO[etape] ? 'imp-fait' : undefined} />
          ))}
        </div>

        <div className="imp-corps" ref={corps}>
          {fichier !== null && etape !== 'depot' && (
            <div className="imp-carte imp-fichier">
              <span className="imp-format">{fichier.analyse.format === 'xlsx' ? 'XLSX' : 'CSV'}</span>
              <span className="imp-fichier-textes">
                <strong>{nomFichier}</strong>{' '}
                <span>{resumeFichier}</span>
              </span>
            </div>
          )}

          {alerte !== null && (
            <p role="alert" className="imp-alerte">
              {alerte}
            </p>
          )}

          {etape === 'depot' && (
            <>
              <label
                className="imp-depot"
                data-testid="depot-fichier"
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={deposerGlisse}
              >
                <span className="imp-depot-icone" aria-hidden="true">
                  ↑
                </span>
                <strong>{occupe ? 'Lecture du fichier…' : 'Choisir un fichier'}</strong>
                <span>CSV, TSV ou Excel (.xlsx) : parcellaire, cultures, séries ou assolement passé.</span>
                <input
                  type="file"
                  aria-label="Choisir un fichier"
                  accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={occupe}
                  className="imp-invisible"
                  onChange={(e) => {
                    surChoixFichier(e.currentTarget.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <section aria-label="Imports récents" className="imp-section">
                <h3 className="imp-etiquette">Imports récents</h3>
                {historique.length === 0 ? (
                  <p className="imp-aide">Aucun import pour l’instant.</p>
                ) : (
                  <ul className="imp-liste">
                    {historique.map((i) => (
                      <li key={i.id} data-testid="import-passe" data-import={i.id} data-etat={i.etat} className="imp-carte imp-passe">
                        <span className="imp-passe-textes">
                          <strong>{i.fichier}</strong>{' '}
                          <span>
                            {lignesImportees(i.lignes)} · {dateCourte(i.le)}
                            {i.etat === 'annule' ? ' · annulé' : ''}
                          </span>
                        </span>
                        {i.etat === 'actif' && (
                          <button type="button" className="imp-bouton-secondaire" disabled={occupe} onClick={() => void annuler(i)}>
                            Annuler cet import
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {etape === 'type' && (
            <>
              <div role="radiogroup" aria-label="Ce fichier contient" className="imp-types">
                {TYPES.map((t) => (
                  <label key={t.valeur} className={`imp-carte imp-type${type === t.valeur ? ' imp-choisi' : ''}`}>
                    <input
                      type="radio"
                      name="type-import"
                      value={t.valeur}
                      aria-label={t.libelle}
                      checked={type === t.valeur}
                      onChange={() => {
                        setType(t.valeur);
                      }}
                    />
                    <span className="imp-type-textes">
                      <strong>{t.libelle}</strong>
                      <span>{t.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
              {fichier !== null && fichier.modele !== null && fichier.modele.correspondance.type === type && <p className="imp-note">Même forme que votre dernier fichier : sa correspondance sera reprise.</p>}
              <label className="imp-champ-bloc">
                <span className="imp-etiquette">Année de la saison</span>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="Année de la saison"
                  className="imp-champ"
                  min={2000}
                  max={2100}
                  value={annee}
                  onChange={(e) => {
                    setAnnee(e.currentTarget.value);
                  }}
                />
                <span className="imp-aide">Pour les dates écrites en semaines (S14, sem 14).</span>
              </label>
            </>
          )}

          {etape === 'colonnes' && correspondance !== null && (
            <>
              {modeleApplique && (
                <p data-testid="modele-applique" className="imp-note">
                  Correspondance reprise de votre dernier fichier.
                </p>
              )}
              {refusModele !== null && (
                <p role="alert" className="imp-alerte">
                  {refusModele}
                </p>
              )}
              <ul className="imp-liste">
                {entetes.slice(0, colonnesVisibles).map((entete, i) => {
                  const champ = correspondance.colonnes[i]?.champ ?? null;
                  const exemples = fichier?.analyse.exemples[i] ?? [];
                  const etat = champ === null ? 'ignoree' : proposee?.colonnes[i]?.champ === champ ? 'reconnue' : 'choisie';
                  return (
                    <li key={i} data-testid="colonne-import" data-colonne={i} className="imp-carte imp-colonne">
                      <span className="imp-colonne-source">
                        <span className="imp-code">{entete === '' ? `Colonne ${String(i + 1)}` : entete}</span>
                        <span className="imp-exemples">{exemples.length === 0 ? 'vide' : `${exemples.join(', ')}…`}</span>
                      </span>
                      <span className={`imp-pastille imp-pastille-${etat}`} aria-hidden="true">
                        {etat === 'ignoree' ? '–' : '✓'}
                      </span>
                      <select
                        aria-label={`Champ pour « ${entete} »`}
                        className="imp-champ imp-liste-deroulante"
                        value={champ ?? ''}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          associer(i, v === '' ? null : (champs.find((c) => c.cle === v)?.cle ?? null));
                        }}
                      >
                        <option value="">Ignorée</option>
                        {champs.map((c) => (
                          <option key={c.cle} value={c.cle}>
                            {c.libelle}
                            {c.obligatoire ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
              {demandeZone && (
                <label className="imp-champ-bloc">
                  <span className="imp-etiquette">Zone par défaut</span>
                  <input
                    type="text"
                    aria-label="Zone par défaut"
                    className="imp-champ"
                    value={zoneParDefaut}
                    maxLength={200}
                    onChange={(e) => {
                      setZoneParDefaut(e.currentTarget.value);
                    }}
                  />
                  <span className="imp-aide">Le fichier n’a pas de colonne de zone : toutes ses lignes y seront rangées (une zone existante de même nom est reprise).</span>
                </label>
              )}
            </>
          )}

          {etape === 'valeurs' && (
            <>
              <p className="imp-note imp-note-orange">
                {decisions.length === 1 ? '1 valeur à rapprocher' : `${enFrancais(decisions.length)} valeurs à rapprocher`} de votre bibliothèque.
              </p>
              <ul className="imp-liste">
                {decisions.map((d) => {
                  const k = cleDecision(d.champ, d.valeur);
                  const liste = d.champ === 'espece' ? (contexte?.especes ?? []) : (contexte?.familles ?? []);
                  const tries = [...liste].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
                  const proposes = new Set(d.propositions.map((p) => p.id));
                  return (
                    <li key={k} data-testid="decision-valeur" data-champ={d.champ} data-valeur={d.valeur} className="imp-carte imp-decision">
                      <span className="imp-colonne-source">
                        <span className="imp-code">{d.valeur}</span>
                        <span className="imp-exemples">
                          {d.lignes === 1 ? '1 ligne' : `${enFrancais(d.lignes)} lignes`}
                          {d.propositions[0] !== undefined ? ` · proposé : ${d.propositions[0].nom}` : ' · aucune proposition'}
                        </span>
                      </span>
                      <select
                        aria-label={`${d.champ === 'espece' ? 'Culture' : 'Famille'} pour « ${d.valeur} »`}
                        className="imp-champ imp-liste-deroulante"
                        value={choixPris[k] ?? ''}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setChoixPris((p) => ({ ...p, [k]: v }));
                        }}
                      >
                        <option value="">À choisir</option>
                        {d.propositions.map((p) => (
                          <option key={`p-${p.id}`} value={p.id}>
                            {p.nom} (proposé)
                          </option>
                        ))}
                        {tries
                          .filter((x) => !proposes.has(x.id))
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.nom}
                            </option>
                          ))}
                        <option value="nouvelle">Créer « {d.valeur} »</option>
                      </select>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {etape === 'apercu' && apercu !== null && <VueApercu apercu={apercu} />}

          {etape === 'fini' && fini !== null && (
            <div className="imp-carte imp-fin">
              <p role="status" className="imp-statut">
                {fini.annule ? `Import annulé : les ${lignesImportees(fini.passe.lignes)} sont retirées.` : `${lignesImportees(fini.passe.lignes)}.`}
              </p>
              {!fini.annule && <p className="imp-aide">Annulable à tout moment depuis « Imports récents ». La synchronisation l’enverra dès que le réseau revient.</p>}
            </div>
          )}
        </div>

        <footer className="imp-pied">
          {avancement !== null && (
            <p className="imp-aide" aria-live="polite">
              {avancement}
            </p>
          )}
          {(etape === 'type' || etape === 'colonnes' || etape === 'valeurs') && (
            <>
              <button type="button" className="imp-bouton-principal" disabled={!continuerActif} onClick={surContinuer}>
                Continuer
              </button>
              <span className="imp-aide imp-centre">{occupe ? 'Préparation…' : aideContinuer}</span>
            </>
          )}
          {etape === 'apercu' && apercu !== null && (
            <>
              <button type="button" className="imp-bouton-principal" disabled={apercu.valides === 0 || occupe} onClick={() => void importer()}>
                {apercu.valides === 0 ? 'Importer : rien à écrire' : `Importer ${lignesImportees(apercu.valides).replace(/ importées?$/, '')}`}
              </button>
              <span className="imp-aide imp-centre">Les lignes en erreur et en doublon ne sont pas écrites.</span>
            </>
          )}
          {etape === 'fini' && fini !== null && (
            <div className="imp-actions">
              {!fini.annule && (
                <button type="button" className="imp-bouton-secondaire" disabled={occupe} onClick={() => void annuler(fini.passe)}>
                  Annuler cet import
                </button>
              )}
              <button type="button" className="imp-bouton-principal" disabled={occupe} onClick={recommencer}>
                Importer un autre fichier
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

const STATUTS: Readonly<Record<string, string>> = { erreur: 'Erreur', doublon: 'Doublon', valide: 'À importer', a_decider: 'À décider' };

function VueApercu({ apercu }: { readonly apercu: Apercu }): ReactElement {
  const montrees = apercu.lignes.filter((l) => l.statut !== 'valide' || l.avertissements.length > 0);
  return (
    <div data-testid="apercu-import" className="imp-apercu">
      <div className="imp-compteurs">
        <p data-testid="compteur-valides" className="imp-compteur imp-compteur-valides">
          <strong>{enFrancais(apercu.valides)}</strong> à importer
        </p>
        {apercu.avertissements > 0 && (
          <p data-testid="compteur-avertissements" className="imp-compteur imp-compteur-avertis">
            <strong>{enFrancais(apercu.avertissements)}</strong> à vérifier
          </p>
        )}
        <p data-testid="compteur-erreurs" className="imp-compteur imp-compteur-erreurs">
          <strong>{enFrancais(apercu.erreurs)}</strong> en erreur
        </p>
        <p data-testid="compteur-doublons" className="imp-compteur">
          <strong>{enFrancais(apercu.doublons)}</strong> doublons
        </p>
      </div>
      {apercu.lots > 1 && (
        <p className="imp-note imp-note-orange">
          Import en {enFrancais(apercu.lots)} envois ({enFrancais(apercu.ecritures)} écritures) : le serveur accepte ou refuse chaque envoi à part. Un envoi refusé apparaît dans « Saisies refusées » ; « Annuler cet import » retire tout.
        </p>
      )}
      {apercu.sansTaille > 0 && (
        <p className="imp-note imp-note-orange">
          {apercu.sansTaille === 1 ? '1 série' : `${enFrancais(apercu.sansTaille)} séries`} sans longueur, sans nombre de plants ni planche : comptées pour 1 m, à compléter dans la série.
        </p>
      )}
      {apercu.ignorees > 0 && <p className="imp-aide">{apercu.ignorees === 1 ? '1 ligne vide ou de total ignorée.' : `${enFrancais(apercu.ignorees)} lignes vides ou de total ignorées.`}</p>}
      {montrees.length > 0 && (
        <ul className="imp-liste">
          {montrees.map((l) => (
            <LigneVue key={l.ligne} l={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LigneVue({ l }: { readonly l: LigneApercu }): ReactElement {
  return (
    <li data-testid="ligne-import" data-ligne={l.ligne} data-statut={l.statut} className={`imp-carte imp-ligne imp-ligne-${l.statut}`}>
      <span className="imp-ligne-tete">
        <span className="imp-code">Ligne {l.ligne}</span>
        <span className={`imp-etat imp-etat-${l.statut}`}>{l.avertissements.length > 0 ? 'À vérifier' : STATUTS[l.statut]}</span>
      </span>
      {l.resume !== '' && <span className="imp-exemples">{l.resume}</span>}
      {l.erreurs.map((x, i) => (
        <span key={i} className="imp-erreur">
          <span data-testid="erreur-import">{x.message}</span>
          {x.cellule !== null && (
            <>
              {' '}
              <span className="imp-cellule-cadre">
                cellule : « <span data-testid="cellule-fautive" className="imp-cellule">{x.cellule}</span> »
              </span>
            </>
          )}
        </span>
      ))}
      {l.statut === 'doublon' && (
        <span className="imp-aide">{l.doublonDe === null || l.doublonDe === undefined ? 'Doublon : déjà dans la ferme, pas réécrit.' : `Doublon de la ligne ${String(l.doublonDe)} du fichier.`}</span>
      )}
      {l.avertissements.map((a, i) => (
        <span key={i} data-testid="avertissement-import" className="imp-avertissement">
          {a}
        </span>
      ))}
    </li>
  );
}

export default EcranImport;
