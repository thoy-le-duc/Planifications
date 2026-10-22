/**
 * Contrat de `packages/core/src/abris` (T58, docs/backlog/T58-etat-serres.md) : les règles
 * déterministes de l'état des serres et tunnels (ouvrants, portes, chauffage, voile), que l'écran
 * Aujourd'hui, la vue 3D, la porte du téléphone et le serveur rejouent. Module exposé par le
 * sous-chemin `@planif/core/abris` et réexporté par `@planif/core`. Pur : ni base, ni réseau, ni
 * horloge (l'instant est toujours un paramètre) ; aucune fonction ne lève.
 *
 * Le module est chargé dynamiquement (`chargerAbris`) : tant qu'il n'existe pas, les tests
 * échouent sur « n'existe pas encore » au lieu de casser le typage du dépôt.
 *
 * ── Modèle de données (choix du testeur, à suivre) ──────────────────────────────────────────
 * Pas de nouvelle table. Un changement d'état est un ÉVÉNEMENT du journal de type `etat_abri`
 * (nouveau membre de `TypeEvenement`), avec un détail typé :
 *     DetailEtatAbri = { zoneId: Id<'Zone'>, equipement: EquipementAbri, actif: boolean }
 * `actif` vrai = ouvrants ou portes OUVERTS, chauffage ALLUMÉ, voile POSÉ ; faux = fermés, éteint,
 * retiré. Sans culture ni emplacement. Une correction ou une annulation est un événement de même
 * type qui désigne l'original (`remplace_sorte` / `remplace_evenement_id`), comme partout (T10g).
 * La liste d'équipements d'une zone est la colonne facultative `zone.equipements_abri` (texte JSON
 * en synchro, jsonb en base, tableau de noms d'équipement) ; nulle = liste par défaut du type d'abri.
 *
 * ── Équipements ─────────────────────────────────────────────────────────────────────────────
 *
 *   EQUIPEMENTS_ABRI = ['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile']
 * (cet ordre est l'ordre canonique de toutes les listes rendues).
 *
 *   equipementsParDefaut(typeAbri): EquipementAbri[]
 *     tunnel      → ['ouvrants_lateraux', 'portes', 'voile']
 *     serre       → les cinq
 *     plein_champ → []
 *   (hors_sol : non précisé par le ticket, laissé au développeur.)
 *
 *   equipementsDeZone({ typeAbri, equipementsAbri }): EquipementAbri[]
 *     `equipementsAbri` nul ou absent : la liste par défaut ; sinon la liste de la zone, en ordre
 *     canonique (même donnée dans un autre ordre, même résultat).
 *
 *   validerEquipementsAbri(valeur): Resultat<EquipementAbri[]>
 *     tableau (ou texte JSON d'un tableau, format de la synchro) de noms connus, sans doublon ;
 *     vide permis (« rien de déclaré »). Rend la liste en ordre canonique. Refus (message en
 *     français, sans jargon) : pas un tableau, JSON illisible, nom inconnu, doublon.
 *
 *   libelleEquipement(e): string — « ouvrants latéraux », « ouvrants de faîtage », « portes »,
 *   « chauffage », « voile ».
 *   phraseEtat(e, actif): string — « ouvrants latéraux ouverts » / « ouvrants latéraux fermés »,
 *   « ouvrants de faîtage ouverts/fermés », « portes ouvertes/fermées », « chauffage allumé/éteint »,
 *   « voile posé/retiré ».
 *
 * ── État courant ────────────────────────────────────────────────────────────────────────────
 *
 *   EvenementEtatAbri = { id, zoneId, equipement, actif, horodatage (ISO), remplaceSorte
 *                         ('correction' | 'annulation' | null), remplaceEvenementId (string | null) }
 *
 *   etatCourant(evenements, zoneId, equipement, instant): EtatEquipement | null
 *     EtatEquipement = { actif: boolean, depuis: string (horodatage ISO), evenementId: string }
 *     Les événements EN VIGUEUR (mêmes chaînes que `enVigueurDesTraitements` : une annulation
 *     retire toute la chaîne, la correction la plus récente remplace l'original) de cette zone et de
 *     cet équipement dont l'heure est ≤ `instant` ; le dernier l'emporte (heure, puis id).
 *     Une correction PREND LA PLACE de l'événement qu'elle corrige : son `actif`, à l'HEURE de
 *     l'original (`depuis` = horodatage de l'original), même si elle est saisie plus tard.
 *     `null` : aucun événement en vigueur à cet instant (état inconnu).
 *
 *   etatsDeLaZone(evenements, zone, instant): { equipement, etat: EtatEquipement | null }[]
 *     zone = { id, nom, typeAbri, equipementsAbri }. Un élément par équipement DÉCLARÉ
 *     (`equipementsDeZone`), en ordre canonique ; les événements d'un équipement non déclaré sont
 *     ignorés.
 *
 * ── Ouverts, et rappel du soir ──────────────────────────────────────────────────────────────
 *
 *   abrisOuverts(zones, evenements, instant): { zoneId, nom, ouverts: EquipementAbri[] }[]
 *     Une zone est « ouverte » si au moins un de ses équipements DÉCLARÉS parmi ouvrants
 *     latéraux, ouvrants de faîtage et portes est actif à `instant` ; `ouverts` les liste (ordre
 *     canonique). Chauffage et voile n'ouvrent rien. État inconnu = fermé. Tri : nom (ordre
 *     naturel français, sans tenir compte de la casse), puis id.
 *
 *   rappelDuSoir({ zones, evenements, maintenant, fuseau }): RappelDuSoir | null
 *     RappelDuSoir = { nombre: number, phrase: string, zones: ReturnType<abrisOuverts> }
 *     `maintenant` : instant ISO ; `fuseau` : fuseau IANA de la ferme (« Europe/Paris »). Nul avant
 *     18 h 00 locale (18 h 00 comprise) ; nul sans abri ouvert ; sinon `phrase` = « 2 serres encore
 *     ouvertes » (« 1 serre encore ouverte » au singulier).
 */

export type TypeAbri = 'plein_champ' | 'tunnel' | 'serre' | 'hors_sol';
export type EquipementAbri = 'ouvrants_lateraux' | 'ouvrants_faitage' | 'portes' | 'chauffage' | 'voile';

export type Resultat<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly message: string };

export interface ZoneAbri {
  readonly id: string;
  readonly nom: string;
  readonly typeAbri: TypeAbri;
  readonly equipementsAbri: readonly EquipementAbri[] | null;
}

export interface EvenementEtatAbri {
  readonly id: string;
  readonly zoneId: string;
  readonly equipement: EquipementAbri;
  readonly actif: boolean;
  readonly horodatage: string;
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
}

export interface EtatEquipement {
  readonly actif: boolean;
  readonly depuis: string;
  readonly evenementId: string;
}

export interface AbriOuvert {
  readonly zoneId: string;
  readonly nom: string;
  readonly ouverts: readonly EquipementAbri[];
}

export interface RappelDuSoir {
  readonly nombre: number;
  readonly phrase: string;
  readonly zones: readonly AbriOuvert[];
}

export interface ModuleAbris {
  readonly EQUIPEMENTS_ABRI: readonly EquipementAbri[];
  equipementsParDefaut(typeAbri: TypeAbri): EquipementAbri[];
  equipementsDeZone(zone: Pick<ZoneAbri, 'typeAbri' | 'equipementsAbri'>): EquipementAbri[];
  validerEquipementsAbri(valeur: unknown): Resultat<EquipementAbri[]>;
  libelleEquipement(e: EquipementAbri): string;
  phraseEtat(e: EquipementAbri, actif: boolean): string;
  etatCourant(evenements: readonly EvenementEtatAbri[], zoneId: string, equipement: EquipementAbri, instant: string): EtatEquipement | null;
  etatsDeLaZone(evenements: readonly EvenementEtatAbri[], zone: ZoneAbri, instant: string): { equipement: EquipementAbri; etat: EtatEquipement | null }[];
  abrisOuverts(zones: readonly ZoneAbri[], evenements: readonly EvenementEtatAbri[], instant: string): AbriOuvert[];
  rappelDuSoir(entree: { zones: readonly ZoneAbri[]; evenements: readonly EvenementEtatAbri[]; maintenant: string; fuseau: string }): RappelDuSoir | null;
}

const CHEMIN = '../index.ts';

/** Charge le module des abris ; message clair tant qu'il n'existe pas ou n'exporte pas tout. */
export async function chargerAbris(): Promise<ModuleAbris> {
  let module: unknown;
  try {
    module = await import(/* @vite-ignore */ CHEMIN);
  } catch (e) {
    throw new Error("packages/core/src/abris/index.ts n'existe pas encore (T58)", { cause: e });
  }
  const m = module as Partial<Record<keyof ModuleAbris, unknown>>;
  for (const nom of ['EQUIPEMENTS_ABRI', 'equipementsParDefaut', 'equipementsDeZone', 'validerEquipementsAbri', 'libelleEquipement', 'phraseEtat', 'etatCourant', 'etatsDeLaZone', 'abrisOuverts', 'rappelDuSoir'] as const) {
    if (m[nom] === undefined) throw new Error(`@planif/core/abris n'exporte pas encore ${nom} (T58)`);
  }
  return module as ModuleAbris;
}
