/**
 * T90 : « Dupliquer » une serre ou une parcelle de plein champ (docs/backlog/T90-dupliquer.md), chargé à la demande avec la fiche de la
 * serre (./serre-fiche.tsx le ré-exporte) : il n'alourdit pas le morceau de l'éditeur (budget.json). Contrat du DOM :
 * ./test/contrat-dupliquer.ts.
 *
 * Une fiche : nombre de copies (1 à 20) et écart (m). « Dupliquer » n'écrit rien : il met les copies au brouillon de l'éditeur, comme la
 * fiche de T89 (zones, sous-zones et planches à créer, bâtiment ou contour), alignées du côté x positif de l'original (cœur,
 * `positionsDesCopies`). Un seul « Enregistrer » les écrit par `porte.placer` ; « Abandonner » et « Annuler » les retirent toutes.
 *
 * Une copie reprend tout ce qui est placé : dimensions, grille, sous-zones, planches et leur place dans la zone (le repère d'une serre
 * est son bâtiment, celui d'une parcelle son contour : les deux se déplacent ensemble, les places ne changent pas). Aucune série,
 * culture ni occupation n'est copiée. Seules les planches placées sont reprises : ce sont les seules que l'éditeur connaît comme telles.
 *
 * N'importe ni le morceau de l'éditeur ni la fiche : des types, React, le morceau de la zone (./zone-ecran.tsx) et ./creation-serre.ts.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
// Le calcul (cœur) vient du morceau de la zone, déjà chargé avec l'éditeur : pas de morceau partagé de plus à citer (comme serre-fiche.tsx).
import { ajouterCreation, comparerNoms, decouperSerres, COPIES_MAX, COPIES_PAR_DEFAUT, ECART_PAR_DEFAUT_M, erreurDuplication, largeurDuContour, nomsDesCopies, positionsDesCopies, repereZone } from './zone-ecran.tsx';
import type { RepereZone } from '@planif/core/placement';
import type { PorteDonnees } from '@planif/sync';
import type { InfoBande } from './bandes-serre.ts';
import type { CreationSerre, GrilleCreee, PlancheCreee } from './creation-serre.ts';
import type { Batiment, Planche, Zone } from './donnees.ts';
import type { Point } from './tuiles.ts';

/** Écritures au plus par enregistrement (ECRITURES_MAX_PAR_LOT du cœur, comme serre-fiche.tsx). */
const ECRITURES_MAX = 500;

const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const nombreOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const estSerre = (b: Batiment): boolean => b.type === 'serre_tunnel' || b.type === 'serre_chapelle';
const pluriel = (n: number, un: string, plusieurs = `${un}s`): string => `${String(n)} ${n > 1 ? plusieurs : un}`;

/** Une zone telle que l'éditeur l'affiche (seul ce que la duplication en lit). */
interface ZoneLue {
  readonly zone: Zone;
  readonly abritee: boolean;
  readonly affiche: readonly Point[] | null;
}

/** Un emplacement en service lu en base, avec ce que la copie en reprend : sa sorte, ses mesures et sa place dans la zone (nulle s'il n'est pas placé). */
export interface LigneEmplacement {
  readonly id: string;
  readonly zoneId: string;
  readonly code: string;
  readonly sorte: string;
  readonly longueurM: number;
  readonly largeurM: number | null;
  readonly placement: { readonly x: number; readonly y: number; readonly orientation_deg: number } | null;
}

type LigneBrute = Readonly<Record<string, unknown>>;
const texteOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Tous les emplacements en service de la ferme de la zone `racineId` (placés ou non, toutes sortes), lus en base : l'éditeur ne
 * connaît que les planches placées. Une ligne illisible est écartée.
 */
export async function lireEmplacements(porte: Pick<PorteDonnees, 'lire'>, racineId: string): Promise<LigneEmplacement[]> {
  const lignes = await porte.lire<LigneBrute>(
    `SELECT id, zone_id, code, sorte, longueur_m, largeur_m, placement_x_m, placement_y_m, orientation_deg FROM emplacement
      WHERE supprime_le IS NULL AND actif_au IS NULL AND ferme_id = (SELECT ferme_id FROM zone WHERE id = ?)`,
    [racineId],
  );
  return lignes.flatMap((l): LigneEmplacement[] => {
    const [id, zoneId, code, sorte] = [texteOuNul(l.id), texteOuNul(l.zone_id), texteOuNul(l.code), texteOuNul(l.sorte)];
    const [x, y, o] = [nombreOuNul(l.placement_x_m), nombreOuNul(l.placement_y_m), nombreOuNul(l.orientation_deg)];
    if (id === null || zoneId === null || code === null || sorte === null) return [];
    return [{ id, zoneId, code, sorte, longueurM: nombreOuNul(l.longueur_m) ?? 0, largeurM: nombreOuNul(l.largeur_m), placement: x === null || y === null || o === null ? null : { x, y, orientation_deg: o } }];
  });
}

export interface ContexteDuplication {
  /** Les bâtiments affichés (brouillon compris), les planches placées affichées (brouillon compris). */
  readonly batiments: readonly Batiment[];
  readonly planches: readonly Planche[];
  /** Les emplacements en service lus en base (`lireEmplacements`) : ceux du brouillon n'y sont pas, les planches affichées les complètent. */
  readonly emplacements: readonly LigneEmplacement[];
  /** Les zones affichées (celles du brouillon comprises), par identifiant. */
  readonly infos: ReadonlyMap<string, ZoneLue>;
  /** La zone à dupliquer : la zone abritée par une serre, ou une zone de plein champ avec contour. */
  readonly racineId: string;
}

/** Ce qu'on duplique : les zones (la racine d'abord, parents avant enfants), le bâtiment s'il y en a un, tous les emplacements. */
interface Source {
  readonly zones: readonly Zone[];
  /** Toutes les zones de la ferme (les noms pris) et la surface de chaque bande de la serre. */
  readonly toutes: readonly Zone[];
  readonly surfaces: ReadonlyMap<string, number>;
  readonly batiment: Batiment | null;
  readonly emplacements: readonly LigneEmplacement[];
  /** Repère de l'original et sa largeur (selon x') : la serre, ou le contour de la parcelle. */
  readonly repere: RepereZone;
  readonly largeurM: number;
  /** Écritures d'une copie : zones, emplacements, bâtiment, contours. */
  readonly ecrituresParCopie: number;
}

const aire = (c: readonly Point[]): number => Math.abs(c.reduce((s, p, i) => s + p.x * (c[(i + 1) % c.length]?.y ?? 0) - (c[(i + 1) % c.length]?.x ?? 0) * p.y, 0)) / 2;

/** La source d'une duplication, ou la raison pour laquelle elle n'est pas possible. */
export function analyserSource(c: ContexteDuplication): Source | string {
  const toutes = [...c.infos.values()].map((i) => i.zone);
  const racine = c.infos.get(c.racineId)?.zone;
  if (racine === undefined) return 'Cet élément n’existe plus.';
  // Les filles de chaque zone dans l'ordre naturel des noms (« Z 9 » avant « Z 10 ») : les copies prennent leurs noms dans cet ordre.
  const zones: Zone[] = [racine];
  for (const z of zones) zones.push(...toutes.filter((f) => f.parenteId === z.id && !zones.includes(f)).sort(comparerNoms));
  const ids = new Set(zones.map((z) => z.id));
  const batiment = c.batiments.find((b) => b.zoneId === racine.id && estSerre(b)) ?? null;
  if (c.batiments.some((b) => b.zoneId !== null && b.id !== batiment?.id && ids.has(b.zoneId))) return 'Cet élément contient un autre bâtiment : dupliquez-le d’abord seul.';
  // Tous les emplacements de la base, la place affichée (brouillon) faisant foi ; puis les planches du brouillon, absentes de la base.
  const affichees = new Map(c.planches.map((p) => [p.id, p]));
  const lus = new Set(c.emplacements.map((e) => e.id));
  const emplacements: LigneEmplacement[] = [
    ...c.emplacements.filter((e) => ids.has(e.zoneId)).map((e) => ({ ...e, placement: affichees.get(e.id)?.placement ?? e.placement })),
    ...c.planches.filter((p) => ids.has(p.zoneId) && !lus.has(p.id)).map((p): LigneEmplacement => ({ id: p.id, zoneId: p.zoneId, code: p.code, sorte: 'planche', longueurM: p.longueurM, largeurM: p.largeurM, placement: p.placement })),
  ];
  if (emplacements.some((e) => (e.sorte !== 'planche' && e.sorte !== 'rang') || !(e.longueurM > 0))) return 'Cet élément contient des emplacements qui ne se dupliquent pas encore (gouttière, ou longueur inconnue).';
  const contourRacine = batiment === null ? (c.infos.get(racine.id)?.affiche ?? null) : null;
  let repere: RepereZone | null;
  let largeurM: number;
  if (batiment !== null) {
    repere = { centre: batiment.centre, orientationDeg: batiment.orientationDeg };
    largeurM = batiment.largeurM;
  } else {
    repere = contourRacine === null ? null : repereZone({ contour: contourRacine });
    largeurM = repere === null || contourRacine === null ? 0 : largeurDuContour(contourRacine, repere.orientationDeg);
  }
  if (repere === null || !(largeurM > 0)) return 'Seule une serre ou une parcelle avec son contour se duplique.';
  const contours = batiment === null ? zones.filter((z) => (c.infos.get(z.id)?.affiche ?? null) !== null).length : 0;
  const bandes = batiment === null ? new Map<string, InfoBande>() : decouperSerres(toutes, c.batiments).bandes;
  const surfaces = new Map([...bandes].map(([id, b]): [string, number] => [id, mm(b.bande.largeurM * b.bande.longueurM)]));
  return { zones, toutes, surfaces, batiment, emplacements, repere, largeurM, ecrituresParCopie: zones.length + emplacements.length + (batiment === null ? 0 : 1) + contours };
}

/** Pourquoi « Dupliquer » est refusé, ou null. `deja` : changements déjà au brouillon, comptés avec ceux des copies. */
export function raisonDuplication(s: Source | string, d: { readonly nombre: number; readonly ecartM: number }, deja: number): string | null {
  if (typeof s === 'string') return s;
  const erreur = erreurDuplication(d);
  if (erreur !== null) return erreur;
  const total = d.nombre * s.ecrituresParCopie + deja;
  if (total <= ECRITURES_MAX) return null;
  return deja > 0
    ? `Avec les changements déjà au brouillon, ${pluriel(d.nombre, 'copie')} demanderaient ${String(total)} écritures, ${String(ECRITURES_MAX)} au plus : enregistrez d’abord, ou réduisez le nombre de copies.`
    : `${pluriel(d.nombre, 'copie')} demanderaient ${String(total)} écritures en un seul enregistrement, ${String(ECRITURES_MAX)} au plus : réduisez le nombre de copies.`;
}

export interface ResultatDuplication {
  readonly creation: CreationSerre;
  readonly batiments: readonly Batiment[];
  readonly planches: readonly Planche[];
  /** Contour de chaque zone copiée qui en a un (parcelle), par identifiant. */
  readonly contours: ReadonlyMap<string, readonly Point[]>;
  /** Le bâtiment de la première copie, à choisir. */
  readonly premier: string | null;
}

/** Les copies (la demande est valide : `raisonDuplication` est null). */
export function preparerDuplication(c: ContexteDuplication, s: Source, d: { readonly nombre: number; readonly ecartM: number }, nouvelId: () => string): ResultatDuplication {
  const zonesNoms = new Set(s.toutes.map((z) => z.nom.trim().toLowerCase()));
  const batimentsNoms = new Set(c.batiments.map((b) => b.nom.trim().toLowerCase()));
  const suivant = (nom: string, pris: Set<string>): string => {
    const [rendu = nom] = nomsDesCopies(nom, [...pris], 1);
    pris.add(rendu.trim().toLowerCase());
    return rendu;
  };
  const grille = ((l: Batiment['ligne']): GrilleCreee => ({ nb_chapelles: nombreOuNul(l?.nb_chapelles), nb_troncons: nombreOuNul(l?.nb_troncons), largeur_allee_m: nombreOuNul(l?.largeur_allee_m) }))(s.batiment?.ligne);
  const zones: Zone[] = [];
  const surfaces: Record<string, number> = {};
  const creees: PlancheCreee[] = [];
  const grilles: Record<string, GrilleCreee> = {};
  const batiments: Batiment[] = [];
  const planches: Planche[] = [];
  const contours = new Map<string, readonly Point[]>();
  const racine = s.zones[0];
  for (const copie of positionsDesCopies(s.repere, s.largeurM, d.ecartM, d.nombre)) {
    const nouvelle = new Map(s.zones.map((z) => [z.id, nouvelId()]));
    for (const z of s.zones) {
      const id = nouvelle.get(z.id) ?? '';
      zones.push({ id, nom: suivant(z.nom, zonesNoms), contour: null, parenteId: z === racine ? (z.parenteId ?? null) : (nouvelle.get(z.parenteId ?? '') ?? null), typeAbri: z.typeAbri ?? null });
      const contour = s.batiment === null ? (c.infos.get(z.id)?.affiche ?? null) : null;
      if (contour !== null) {
        contours.set(id, contour.map((p) => ({ x: mm(p.x + copie.decalage.x), y: mm(p.y + copie.decalage.y) })));
        surfaces[id] = mm(aire(contour));
      } else if (s.batiment !== null) {
        const surface = z === racine ? mm(s.batiment.largeurM * s.batiment.longueurM) : s.surfaces.get(z.id);
        if (surface !== undefined) surfaces[id] = surface;
      }
    }
    if (s.batiment !== null) {
      const b = { ...s.batiment, id: nouvelId(), nom: suivant(s.batiment.nom, batimentsNoms), centre: copie.centre, zoneId: nouvelle.get(racine?.id ?? '') ?? null, nouveau: true, ligne: { ...grille } };
      batiments.push(b);
      grilles[b.id] = grille;
    }
    for (const e of s.emplacements) {
      const id = nouvelId();
      const zoneId = nouvelle.get(e.zoneId) ?? '';
      creees.push({ id, zoneId, code: e.code, longueurM: e.longueurM, largeurM: e.largeurM, sorte: e.sorte });
      // Un emplacement non placé reste non placé ; un placé garde sa place dans la zone (largeur d'affichage 0,8 m s'il n'en a pas).
      if (e.placement !== null) planches.push({ id, zoneId, code: e.code, longueurM: e.longueurM, largeurM: e.largeurM ?? 0.8, placement: { ...e.placement } });
    }
  }
  return { creation: { grilles, zones, surfaces, planches: creees, reprises: [] }, batiments, planches, contours, premier: batiments[0]?.id ?? null };
}

// ── La fiche ─────────────────────────────────────────────────────────────────────────────────────

type Etat<T> = (maj: (avant: T) => T) => void;

/**
 * Ce que la fiche fait dans l'éditeur, dans cet ordre (un tableau : il pèse moins dans le morceau de l'éditeur) : se fermer ; à
 * « Dupliquer », poser au brouillon les bâtiments, les planches, la création et les contours ; choisir la première copie ; les
 * changements déjà au brouillon, comptés avec ceux des copies contre 500.
 */
export type EditeurDeLaDuplication = readonly [
  fermer: (fermee: undefined) => void,
  batiments: Etat<ReadonlyMap<string, Batiment>>,
  planches: Etat<ReadonlyMap<string, Planche>>,
  creation: Etat<CreationSerre | null>,
  choisir: (id: string) => void,
  deja: number,
  contours: Etat<ReadonlyMap<string, readonly Point[]>>,
];

export interface ProprietesFicheDuplication extends ContexteDuplication {
  readonly nouvelId: () => string;
  readonly editeur: EditeurDeLaDuplication;
}

const FOCALISABLES = 'button:not([disabled]), input:not([disabled])';

/** Un nombre saisi (virgule ou point) ; vide ou illisible : NaN. */
const lu = (texte: string): number => (texte.trim() === '' ? Number.NaN : Number(texte.trim().replace(',', '.')));

/** La fiche « Dupliquer » : nombre de copies et écart. */
export function FicheDuplication(p: ProprietesFicheDuplication): ReactElement {
  const [fermer, batiments, planches, creation, choisir, deja, contours] = p.editeur;
  const idAide = useId();
  const idTitre = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus();
  }, []);
  const [saisie, setSaisie] = useState({ nombre: String(COPIES_PAR_DEFAUT), ecart: String(ECART_PAR_DEFAUT_M) });
  const source = analyserSource(p);
  const demande = { nombre: lu(saisie.nombre), ecartM: lu(saisie.ecart) };
  const raison = raisonDuplication(source, demande, deja);
  const resume = typeof source === 'string' || erreurDuplication(demande) !== null ? '' : `${pluriel(demande.nombre, 'copie')} : ${pluriel(demande.nombre * source.zones.length, 'zone')}, ${pluriel(demande.nombre * source.emplacements.length, 'emplacement')}${source.batiment === null ? '' : `, ${pluriel(demande.nombre, 'bâtiment')}`}`;

  const champ = (cle: 'nombre' | 'ecart', etiquette: string): ReactElement => (
    <label className="pl-champ">
      <span>{etiquette}</span>
      <input
        aria-label={etiquette}
        type="number"
        step={cle === 'nombre' ? 1 : 'any'}
        inputMode={cle === 'nombre' ? 'numeric' : 'decimal'}
        autoComplete="off"
        value={saisie[cle]}
        onChange={(e) => {
          setSaisie({ ...saisie, [cle]: e.target.value });
        }}
      />
    </label>
  );

  return (
    <div className="pl-voile-modale">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        data-testid="fiche-duplication"
        className="pl-modale"
        onKeyDown={(e) => {
          if (e.key === 'Escape') fermer(undefined);
          if (e.key === 'Tab') {
            const tous = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCALISABLES)];
            const bout = e.shiftKey ? tous[0] : tous.at(-1);
            if (bout !== undefined && document.activeElement === bout) {
              e.preventDefault();
              (e.shiftKey ? tous.at(-1) : tous[0])?.focus();
            }
          }
          // Rien de ce qui se tape dans la fiche n'atteint l'éditeur (Ctrl+Z, Entrée).
          e.stopPropagation();
        }}
      >
        <h3 id={idTitre}>Dupliquer</h3>
        {champ('nombre', 'Nombre de copies')}
        {champ('ecart', 'Écart (m)')}
        <p data-testid="resume-duplication" className="pl-resume-serre">
          {resume}
        </p>
        {raison !== null && (
          <p id={idAide} data-testid="aide-duplication" className="pl-aide">
            {raison}
          </p>
        )}
        <p className="pl-aide">{`Les copies se posent à côté, ${String(COPIES_MAX)} au plus. Elles reprennent les zones et les planches, pas les cultures.`}</p>
        <div className="pl-modale-actions">
          <button
            type="button"
            className="pl-bouton pl-principal"
            disabled={raison !== null}
            aria-describedby={raison === null ? undefined : idAide}
            onClick={() => {
              if (raison !== null || typeof source === 'string') return;
              const r = preparerDuplication(p, source, demande, p.nouvelId);
              fermer(undefined);
              batiments((avant) => new Map([...avant, ...r.batiments.map((b): [string, Batiment] => [b.id, b])]));
              planches((avant) => new Map([...avant, ...r.planches.map((x): [string, Planche] => [x.id, x])]));
              creation((avant) => ajouterCreation(avant, r.creation));
              contours((avant) => new Map([...avant, ...r.contours]));
              if (r.premier !== null) choisir(r.premier);
            }}
          >
            Dupliquer
          </button>
          <button
            type="button"
            className="pl-bouton"
            onClick={() => {
              fermer(undefined);
            }}
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
