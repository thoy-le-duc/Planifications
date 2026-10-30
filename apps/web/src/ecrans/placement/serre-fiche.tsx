/**
 * T89 : la fiche « Serre ou tunnel » (docs/backlog/T89-ajouter-serre.md), chargée à la demande (au toucher de « Ajouter » ou de
 * « Placer la serre ») : elle n'alourdit pas le morceau de l'éditeur (budget.json). Contrat du DOM : ./test/contrat-serre.ts.
 *
 * Une fiche sur un écran : nom, chapelles, tronçons, allées, préfixe des zones, planches par zone, et le résumé calculé par le cœur
 * (`resumeSerre`). « Créer » n'écrit rien : il rend au brouillon de l'éditeur le bâtiment (au centre de la vue, grille de T88), la
 * zone abritée, une sous-zone par case et leurs planches rangées dans leur case (règle de T86/T88). Depuis une zone existante
 * (« Placer la serre »), ses sous-zones et ses planches sont reprises : seules les manquantes sont créées. Un seul « Enregistrer »
 * de l'éditeur écrit tout, par `porte.placer` (`avecCreation`).
 *
 * Aucun import du morceau de l'éditeur (scripts/placement.test.ts) : des types, le cœur, React et bandes-serre.ts.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type { ChangementPlacement } from '@planif/sync';
import { DEFAUTS_SERRE, defautsSerre, rangerDansBande, erreurFicheSerre, nombrePlanchesParDefaut, nomsDesZones, resumeSerre, typeDeSerre, type FicheSerre, type MesuresSerre } from '@planif/core/placement';
import { bandesDeLaZone, decouperSerres, rangerDansBandes } from './bandes-serre.ts';
import type { Batiment, EmplacementEnService, Planche, Zone } from './donnees.ts';
import type { Point } from './tuiles.ts';

/** Écritures au plus par enregistrement (ECRITURES_MAX_PAR_LOT du cœur, comme brouillon.ts : le cœur entier n'entre pas ici). */
const ECRITURES_MAX = 500;
/** Hauteur d'une serre créée par la fiche (m), comme « Nouveau bâtiment ». */
const HAUTEUR_M = 3.5;

const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const cle = (texte: string): string => texte.trim().toLowerCase();

// ── Ce que « Créer » met au brouillon ────────────────────────────────────────────────────────────

/** Une planche créée par la fiche (son placement est celui que le brouillon de l'éditeur garde). */
export interface PlancheCreee {
  readonly id: string;
  readonly zoneId: string;
  readonly code: string;
  readonly longueurM: number;
  readonly largeurM: number;
}

export interface GrilleCreee {
  readonly nb_chapelles: number;
  readonly nb_troncons: number;
  readonly largeur_allee_m: number | null;
}

/** Les lignes que la fiche crée (une ou plusieurs serres avant « Enregistrer »), et la grille de chaque bâtiment créé. */
export interface CreationSerre {
  readonly grilles: Readonly<Record<string, GrilleCreee>>;
  /** Zones abritées (si elles sont nouvelles) et sous-zones créées. */
  readonly zones: readonly Zone[];
  readonly surfaces: Readonly<Record<string, number>>;
  readonly planches: readonly PlancheCreee[];
  /** Planches existantes rangées dans leur case : leur placement s'écrit avec la serre. */
  readonly reprises: readonly string[];
}

/** Une serre de plus au brouillon (une autre fiche avant « Enregistrer »). */
export function ajouterCreation(a: CreationSerre | null, b: CreationSerre): CreationSerre {
  if (a === null) return b;
  return { grilles: { ...a.grilles, ...b.grilles }, zones: [...a.zones, ...b.zones], surfaces: { ...a.surfaces, ...b.surfaces }, planches: [...a.planches, ...b.planches], reprises: [...a.reprises, ...b.reprises] };
}

export interface ResultatFiche {
  readonly creation: CreationSerre;
  /** Au brouillon, sélectionné. */
  readonly batiment: Batiment;
  /** Les planches rangées dans leur case : créées, et existantes reprises. */
  readonly planches: readonly Planche[];
}

/** Les zones lues, et celles du brouillon de la fiche (sans doublon : après l'enregistrement, la base les a). */
export function zonesAvec(lues: readonly Zone[], c: CreationSerre): Zone[] {
  return [...lues, ...c.zones.filter((z) => !lues.some((l) => l.id === z.id))];
}

/**
 * Les changements du brouillon, créations en tête : zones (la serre, puis ses sous-zones), planches créées (après leur zone), puis
 * le reste du brouillon, dont le bâtiment (qui reçoit sa grille) et le placement des planches reprises. Le placement d'une planche
 * créée est celui du brouillon (elle a pu être déplacée).
 */
export function avecCreation(c: CreationSerre, changements: readonly ChangementPlacement[], brouillonPlanches: ReadonlyMap<string, Planche>): ChangementPlacement[] {
  const creees = new Set(c.planches.map((p) => p.id));
  const zones = c.zones.map(
    (z): ChangementPlacement => ({
      sorte: 'zone_creation',
      id: z.id,
      valeurs: { nom: z.nom, zone_parente_id: z.parenteId ?? null, type_abri: z.typeAbri ?? null, surface_m2: c.surfaces[z.id] ?? null },
    }),
  );
  const planches = c.planches.map((p): ChangementPlacement => {
    const place = brouillonPlanches.get(p.id)?.placement;
    return {
      sorte: 'emplacement_creation',
      id: p.id,
      valeurs: {
        zone_id: p.zoneId,
        code: p.code,
        sorte: 'planche',
        longueur_m: p.longueurM,
        largeur_m: p.largeurM,
        placement: place === undefined ? null : { x: mm(place.x), y: mm(place.y), orientation_deg: mm((((place.orientation_deg % 360) + 360) % 360) % 360) },
      },
    };
  });
  // Les planches reprises : leur placement du brouillon, une seule fois (la règle des bandes l'écrit déjà pour une sous-zone).
  const reprises = c.reprises.flatMap((id): ChangementPlacement[] => {
    const place = brouillonPlanches.get(id)?.placement;
    return place === undefined ? [] : [{ sorte: 'emplacement', id, placement: { x: mm(place.x), y: mm(place.y), orientation_deg: mm((((place.orientation_deg % 360) + 360) % 360) % 360) } }];
  });
  const ecrites = new Set(reprises.map((ch) => (ch.sorte === 'emplacement' ? ch.id : '')));
  const reste = changements
    .filter((ch) => !(ch.sorte === 'emplacement' && (creees.has(ch.id) || ecrites.has(ch.id))))
    .map((ch) => {
      const grille = ch.sorte === 'batiment' ? c.grilles[ch.id] : undefined;
      return ch.sorte === 'batiment' && grille !== undefined ? { ...ch, valeurs: { ...ch.valeurs, ...grille } } : ch;
    });
  return [...zones, ...planches, ...reste, ...reprises];
}

/** Ce que l'éditeur affiche tant que le brouillon contient des créations (et les compte, pour les tests). */
export function BrouillonSerre({ c }: { readonly c: CreationSerre }): ReactElement {
  const zones = c.zones.filter((z) => z.parenteId == null).length;
  const sousZones = c.zones.length - zones;
  return (
    <p role="status" data-testid="brouillon-serre" data-batiments={Object.keys(c.grilles).length} data-zones={zones} data-sous-zones={sousZones} data-emplacements={c.planches.length} className="pl-message pl-message-info">
      {`Au brouillon : ${Object.keys(c.grilles).length > 1 ? 'les serres' : 'la serre'}, ${String(c.zones.length)} zone${c.zones.length > 1 ? 's' : ''} et ${String(c.planches.length)} planche${c.planches.length > 1 ? 's' : ''} à créer. Glissez à sa place, puis « Enregistrer ».`}
    </p>
  );
}

// ── Valeurs de départ ────────────────────────────────────────────────────────────────────────────

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Mesures de la dernière serre créée sur la ferme (décision du chef) : bâtiment non supprimé de type serre, à grille (nb_chapelles
 * non nul), le plus récent par `cree_le`. Chapelle = largeur ÷ chapelles ; tronçon = (longueur − (tronçons − 1) × allée) ÷ tronçons.
 */
export function derniereSerre(batiments: readonly Batiment[]): MesuresSerre | null {
  let meilleure: { readonly b: Batiment; readonly creeLe: string; readonly c: number } | null = null;
  for (const b of batiments) {
    const c = nombre(b.ligne?.nb_chapelles);
    if ((b.type !== 'serre_tunnel' && b.type !== 'serre_chapelle') || b.nouveau || c === null || c < 1 || b.ligne?.supprime_le != null) continue;
    const creeLe = typeof b.ligne?.cree_le === 'string' ? b.ligne.cree_le : '';
    if (meilleure === null || creeLe > meilleure.creeLe) meilleure = { b, creeLe, c };
  }
  if (meilleure === null) return null;
  const { b, c } = meilleure;
  const t = Math.max(1, nombre(b.ligne?.nb_troncons) ?? 1);
  const allee = nombre(b.ligne?.largeur_allee_m);
  return {
    largeurChapelleM: mm(b.largeurM / c),
    nbChapelles: c,
    longueurTronconM: mm((b.longueurM - (t - 1) * (allee ?? 0)) / t),
    nbTroncons: t,
    largeurAlleeM: t > 1 && allee !== null ? allee : DEFAUTS_SERRE.largeurAlleeM,
  };
}

// ── Préparer la création (pur) ───────────────────────────────────────────────────────────────────

export interface ContexteFiche {
  readonly zones: readonly Zone[];
  readonly batiments: readonly Batiment[];
  /** Emplacements en service de la ferme (placés ou non). */
  readonly emplacements: readonly EmplacementEnService[];
  /** La zone existante dont on place la serre, ou null pour une serre neuve. */
  readonly zoneId: string | null;
  /** Centre de la vue, repère de la ferme. */
  readonly centre: Point;
  readonly nouvelId: () => string;
}

const sousZonesDe = (zones: readonly Zone[], zoneId: string | null): Zone[] => (zoneId === null ? [] : zones.filter((z) => z.parenteId === zoneId));
/**
 * Une zone existante sans sous-zone, sous une serre d'une seule case (un tunnel simple) : la zone elle-même est la case, ses planches
 * sont reprises et rangées dans tout le tunnel, aucune sous-zone n'est créée.
 */
const zoneSeule = (ctx: Pick<ContexteFiche, 'zones' | 'zoneId'>, cases: number): boolean => ctx.zoneId !== null && cases === 1 && sousZonesDe(ctx.zones, ctx.zoneId).length === 0;
/** Les zones existantes dont les planches sont reprises : les sous-zones, ou la zone seule. */
const porteuses = (ctx: Pick<ContexteFiche, 'zones' | 'zoneId'>, cases: number): Zone[] =>
  zoneSeule(ctx, cases) ? ctx.zones.filter((z) => z.id === ctx.zoneId) : sousZonesDe(ctx.zones, ctx.zoneId);
const typeAbri = (nbChapelles: number): string => (typeDeSerre(nbChapelles) === 'serre_tunnel' ? 'tunnel' : 'serre');

/** Écritures d'un enregistrement de la fiche : zones et planches créées, planches reprises à placer, et le bâtiment. */
function ecritures(f: FicheSerre, ctx: Pick<ContexteFiche, 'zones' | 'emplacements' | 'zoneId'>): number {
  const cases = f.nbChapelles * f.nbTroncons;
  const existantes = porteuses(ctx, cases);
  const planches = existantes.map((z) => ctx.emplacements.filter((e) => e.zoneId === z.id).length);
  const reprises = planches.reduce((n, k) => n + Math.max(k, f.planches.nombre), 0);
  const nouvelles = zoneSeule(ctx, cases) ? 0 : Math.max(0, cases - existantes.length);
  return (ctx.zoneId === null ? 1 : 0) + nouvelles * (1 + f.planches.nombre) + reprises + 1;
}

/** Pourquoi « Créer » est refusé, ou null. */
export function raisonFiche(f: FicheSerre, ctx: Pick<ContexteFiche, 'zones' | 'emplacements' | 'zoneId'>): string | null {
  const erreur = erreurFicheSerre(f);
  if (erreur !== null) return erreur;
  const existantes = sousZonesDe(ctx.zones, ctx.zoneId).length;
  if (f.nbChapelles * f.nbTroncons < existantes) return `La zone a déjà ${String(existantes)} sous-zones : il faut au moins ${String(existantes)} cases (chapelles × tronçons).`;
  const n = ecritures(f, ctx);
  if (n > ECRITURES_MAX) {
    return `Cette serre demande ${String(n)} écritures en un seul enregistrement, ${String(ECRITURES_MAX)} au plus : réduisez le nombre de zones ou de planches par zone.`;
  }
  return null;
}

/** Ce que « Créer » met au brouillon (la fiche est valide : `raisonFiche` est null). */
export function preparerCreation(f: FicheSerre, ctx: ContexteFiche): ResultatFiche {
  const r = resumeSerre(f);
  const type = typeDeSerre(f.nbChapelles);
  const abri = typeAbri(f.nbChapelles);
  const cases = r.nbZones;
  const racineId = ctx.zoneId ?? ctx.nouvelId();
  const creees: Zone[] = ctx.zoneId === null ? [{ id: racineId, nom: f.nom.trim(), contour: null, parenteId: null, typeAbri: abri }] : [];
  const surfaces: Record<string, number> = ctx.zoneId === null ? { [racineId]: mm(r.largeurM * r.longueurM) } : {};
  // Sous-zones : les existantes d'abord ; les manquantes prennent les noms libres « préfixe 1 », « préfixe 2 »…
  const seule = zoneSeule(ctx, cases);
  const existantes = porteuses(ctx, cases);
  const pris = new Set(existantes.map((z) => cle(z.nom)));
  const manquantes = seule ? 0 : Math.max(0, cases - existantes.length);
  for (let k = 1; creees.length - (ctx.zoneId === null ? 1 : 0) < manquantes && k <= cases + existantes.length; k++) {
    const nom = nomsDesZones(f.prefixeZones, k).at(-1) ?? '';
    if (pris.has(cle(nom))) continue;
    pris.add(cle(nom));
    const id = ctx.nouvelId();
    creees.push({ id, nom, contour: null, parenteId: racineId, typeAbri: abri });
    surfaces[id] = mm(f.largeurChapelleM * f.longueurTronconM);
  }
  const grille: GrilleCreee = { nb_chapelles: f.nbChapelles, nb_troncons: f.nbTroncons, largeur_allee_m: f.nbTroncons > 1 ? f.largeurAlleeM : null };
  const batiment: Batiment = {
    id: ctx.nouvelId(),
    nom: f.nom.trim(),
    type,
    centre: { x: mm(ctx.centre.x), y: mm(ctx.centre.y) },
    orientationDeg: 0,
    longueurM: r.longueurM,
    largeurM: r.largeurM,
    hauteurM: HAUTEUR_M,
    zoneId: racineId,
    nouveau: true,
    ligne: { ...grille },
  };
  // Planches : celles des sous-zones existantes sont reprises ; il en manque jusqu'au nombre voulu, codées P1, P2… (codes libres).
  const sousZones = [...existantes, ...creees.filter((z) => z.parenteId === racineId)];
  const nouvelles: PlancheCreee[] = [];
  const enService: EmplacementEnService[] = [];
  for (const z of sousZones) {
    const siennes = ctx.emplacements.filter((e) => e.zoneId === z.id);
    enService.push(...siennes);
    const codes = new Set(siennes.map((e) => cle(e.code)));
    for (let k = 1, manque = f.planches.nombre - siennes.length; manque > 0; k++) {
      const code = `P${String(k)}`;
      if (codes.has(cle(code))) continue;
      const p: PlancheCreee = { id: ctx.nouvelId(), zoneId: z.id, code, longueurM: f.planches.longueurM, largeurM: mm(f.planches.largeurCm / 100) };
      nouvelles.push(p);
      enService.push({ ...p, placement: null });
      manque--;
    }
  }
  const reprises = enService.filter((e) => !nouvelles.some((p) => p.id === e.id)).map((e) => e.id);
  let rangees: readonly Planche[];
  if (seule) {
    // Tout le tunnel est la case de la zone (repère du bâtiment, centre en 0).
    const tunnel = { id: racineId, nom: f.nom, rang: 1, total: 1, centre: { x: 0, y: 0 }, longueurM: r.longueurM, largeurM: r.largeurM };
    const parId = new Map(enService.map((e) => [e.id, e]));
    rangees = (rangerDansBande(tunnel, enService, f.planches.passePiedCm)?.planches ?? []).map((p) => ({
      id: p.id,
      zoneId: racineId,
      code: parId.get(p.id)?.code ?? p.code,
      longueurM: p.longueurM,
      largeurM: p.largeurM,
      placement: { x: mm(p.centre.x), y: mm(p.centre.y), orientation_deg: 0 },
    }));
  } else {
    const bandes = bandesDeLaZone(decouperSerres([...ctx.zones, ...creees], [batiment]).bandes, racineId);
    rangees = rangerDansBandes(bandes, enService, f.planches.passePiedCm, false)?.planches ?? [];
  }
  return { creation: { grilles: { [batiment.id]: grille }, zones: creees, surfaces, planches: nouvelles, reprises }, batiment, planches: rangees };
}

// ── La fiche ─────────────────────────────────────────────────────────────────────────────────────

type Champ = 'nom' | 'chapelle' | 'chapelles' | 'troncon' | 'troncons' | 'allee' | 'prefixe' | 'planches' | 'largeur' | 'longueur' | 'passePied';
type Saisie = Readonly<Record<Champ, string>>;

const ETIQUETTES: Readonly<Record<Champ, string>> = {
  nom: 'Nom',
  chapelle: 'Largeur d’une chapelle (m)',
  chapelles: 'Nombre de chapelles',
  troncon: 'Longueur d’un tronçon (m)',
  troncons: 'Nombre de tronçons',
  allee: 'Allée entre tronçons (m)',
  prefixe: 'Préfixe du nom des zones',
  planches: 'Planches par zone',
  largeur: 'Largeur des planches (cm)',
  longueur: 'Longueur des planches (m)',
  passePied: 'Passe-pied (cm)',
};

/** Un nombre saisi (virgule ou point) ; vide ou illisible : NaN. */
const lu = (texte: string): number => (texte.trim() === '' ? Number.NaN : Number(texte.trim().replace(',', '.')));

function lire(s: Saisie): FicheSerre {
  return {
    nom: s.nom,
    largeurChapelleM: lu(s.chapelle),
    nbChapelles: lu(s.chapelles),
    longueurTronconM: lu(s.troncon),
    nbTroncons: lu(s.troncons),
    largeurAlleeM: lu(s.allee),
    prefixeZones: s.prefixe,
    planches: { nombre: lu(s.planches), largeurCm: lu(s.largeur), longueurM: lu(s.longueur), passePiedCm: lu(s.passePied) },
  };
}

/** Les valeurs de départ : la dernière serre de la ferme, et pour une zone existante son nom, ses sous-zones et ses planches. */
function depart(ctx: ContexteFiche): { readonly saisie: Saisie; readonly planchesManuelles: boolean } {
  const d = defautsSerre(derniereSerre(ctx.batiments));
  const zone = ctx.zoneId === null ? undefined : ctx.zones.find((z) => z.id === ctx.zoneId);
  const sous = sousZonesDe(ctx.zones, ctx.zoneId);
  // Sans sous-zone, ce sont les planches de la zone elle-même (un tunnel simple).
  const plus = Math.max(0, ...porteuses(ctx, Math.max(1, sous.length)).map((z) => ctx.emplacements.filter((e) => e.zoneId === z.id).length));
  const nom = zone?.nom ?? '';
  return {
    saisie: {
      nom,
      chapelle: String(d.largeurChapelleM),
      chapelles: String(zone === undefined ? d.nbChapelles : Math.max(1, sous.length)),
      troncon: String(d.longueurTronconM),
      troncons: String(zone === undefined ? d.nbTroncons : 1),
      allee: String(d.largeurAlleeM),
      prefixe: nom,
      planches: String(plus > 0 ? plus : d.planches.nombre),
      largeur: String(d.planches.largeurCm),
      longueur: String(d.planches.longueurM),
      passePied: String(d.planches.passePiedCm),
    },
    planchesManuelles: plus > 0,
  };
}

export interface ProprietesFicheSerre extends ContexteFiche {
  readonly surCreer: (r: ResultatFiche) => void;
  readonly surFermer: () => void;
}

const FOCALISABLES = 'button:not([disabled]), input:not([disabled])';

/** La fiche « Serre ou tunnel », sur un seul écran. */
export function FicheSerre(p: ProprietesFicheSerre): ReactElement {
  const idTitre = useId();
  const idAide = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [{ saisie: initiale, planchesManuelles }] = useState(() => depart(p));
  const [s, setS] = useState<Saisie>(initiale);
  // Ce qui suit une autre valeur tant qu'on ne l'a pas changé à la main : le préfixe suit le nom, les planches suivent la serre.
  const [manuels, setManuels] = useState<ReadonlySet<Champ>>(() => new Set<Champ>(planchesManuelles ? ['planches'] : []));
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input')?.focus();
  }, []);

  const f = lire(s);
  const raison = raisonFiche(f, p);
  const resume = [f.largeurChapelleM, f.nbChapelles, f.longueurTronconM, f.nbTroncons, f.planches.nombre].every(Number.isFinite) && (f.nbTroncons <= 1 || Number.isFinite(f.largeurAlleeM)) ? resumeSerre(f).texte : '';

  function changer(c: Champ, texte: string): void {
    const n: Record<Champ, string> = { ...s, [c]: texte };
    if (c === 'nom' && !manuels.has('prefixe')) n.prefixe = texte;
    const g = lire(n);
    if ((c === 'chapelle' || c === 'largeur' || c === 'passePied') && !manuels.has('planches') && [g.largeurChapelleM, g.planches.largeurCm, g.planches.passePiedCm].every(Number.isFinite)) {
      n.planches = String(nombrePlanchesParDefaut(g.largeurChapelleM, g.planches.largeurCm, g.planches.passePiedCm));
    }
    if (c === 'troncon' && !manuels.has('longueur') && g.longueurTronconM > DEFAUTS_SERRE.retraitPlancheM) n.longueur = String(mm(g.longueurTronconM - DEFAUTS_SERRE.retraitPlancheM));
    if (c === 'prefixe' || c === 'planches' || c === 'longueur') setManuels(new Set(manuels).add(c));
    setS(n);
  }

  const champ = (c: Champ, texte: boolean): ReactElement => (
    <label key={c} className="pl-champ">
      <span>{ETIQUETTES[c]}</span>
      <input
        aria-label={ETIQUETTES[c]}
        type={texte ? 'text' : 'number'}
        step={texte ? undefined : 'any'}
        inputMode={texte ? undefined : 'decimal'}
        autoComplete="off"
        value={s[c]}
        onChange={(e) => {
          changer(c, e.target.value);
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
        data-testid="fiche-serre"
        className="pl-modale"
        onKeyDown={(e) => {
          if (e.key === 'Escape') p.surFermer();
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
        <h3 id={idTitre}>Serre ou tunnel</h3>
        {champ('nom', true)}
        {champ('chapelle', false)}
        {champ('chapelles', false)}
        {champ('troncon', false)}
        {champ('troncons', false)}
        {f.nbTroncons > 1 && champ('allee', false)}
        {champ('prefixe', true)}
        <fieldset className="pl-champs-planches">
          <legend>Planches de chaque zone, dans la longueur de la serre</legend>
          {champ('planches', false)}
          {champ('largeur', false)}
          {champ('longueur', false)}
          {champ('passePied', false)}
        </fieldset>
        <p data-testid="resume-serre" className="pl-resume-serre">
          {resume}
        </p>
        {raison !== null && (
          <p id={idAide} data-testid="aide-serre" className="pl-aide">
            {raison}
          </p>
        )}
        <div className="pl-modale-actions">
          <button
            type="button"
            className="pl-bouton pl-principal"
            disabled={raison !== null}
            aria-describedby={raison === null ? undefined : idAide}
            onClick={() => {
              if (raison === null) p.surCreer(preparerCreation(f, p));
            }}
          >
            Créer
          </button>
          <button type="button" className="pl-bouton" onClick={p.surFermer}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
