/**
 * Enchaînements du moteur exécutés DANS le fil isolé (./isole.ts, module `scenarios`) : les
 * entrées démesurées (une chaîne de 1 Mo partagée par 3 000 lignes, un million de lignes vides)
 * sont construites dans le fil, et seul un résumé en revient. Cloner ces entrées ou les plans
 * complets entre les fils coûterait plus que l'appel mesuré.
 */
import { chargerImport, chargerXlsx, type CleChamp, type LigneBrute, type PlanImport, type TexteDecode, type TypeContenu } from './contrat.ts';
import { BIBLIOTHEQUE } from './fixtures.ts';

/** Présent dans Node, absent des types du cœur (lib ES2023 seule). */
const { performance } = globalThis as unknown as { readonly performance: { now(): number } };

export interface ResumePlan {
  readonly champs: readonly (CleChamp | null)[];
  readonly nombreLignes: number;
  readonly resume: PlanImport['resume'];
  readonly nombreDecisions: number;
  /** Erreurs de la première et de la dernière ligne du plan : [code, champ, colonne], par colonne. */
  readonly erreursPremiere: readonly (readonly [string, CleChamp | null, number | null])[];
  readonly erreursDerniere: readonly (readonly [string, CleChamp | null, number | null])[];
  readonly messageLePlusLong: number;
  /** Durée de `preparerImport` seul (3e relecture : hors lecture du classeur). */
  readonly dureePlanMs: number;
}

function resumer(plan: PlanImport, champs: readonly (CleChamp | null)[], dureePlanMs: number): ResumePlan {
  // Triées par colonne : le contrat ne fixe pas l'ordre des erreurs d'une ligne.
  const erreurs = (i: number) =>
    (plan.lignes[i]?.erreurs ?? []).map((e) => [e.code, e.champ, e.colonne] as const).sort((a, b) => (a[2] ?? -1) - (b[2] ?? -1) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let messageLePlusLong = 0;
  for (const l of plan.lignes) for (const e of l.erreurs) messageLePlusLong = Math.max(messageLePlusLong, e.message.length);
  return {
    champs,
    nombreLignes: plan.lignes.length,
    resume: plan.resume,
    nombreDecisions: plan.decisions.length,
    erreursPremiere: erreurs(0),
    erreursDerniere: erreurs(plan.lignes.length - 1),
    messageLePlusLong,
    dureePlanMs,
  };
}

async function preparer(lignes: readonly LigneBrute[], ligneEntete: number, type: TypeContenu): Promise<ResumePlan> {
  const m = await chargerImport();
  const correspondance = m.proposerCorrespondance(lignes[ligneEntete] ?? [], type);
  const debut = performance.now();
  const plan = m.preparerImport({ lignes, ligneEntete, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: 2027 });
  const dureePlanMs = performance.now() - debut;
  return resumer(plan, correspondance.colonnes.map((c) => c.champ), dureePlanMs);
}

/** En-têtes puis `nombre` lignes dont chaque cellule est la MÊME chaîne de `taille` « a ». */
export async function planChaineLongue(type: TypeContenu, entetes: readonly string[], taille: number, nombre: number): Promise<ResumePlan> {
  const chaine = 'a'.repeat(taille);
  const ligne = entetes.map(() => chaine);
  const lignes: LigneBrute[] = [entetes];
  for (let i = 0; i < nombre; i++) lignes.push(ligne);
  return preparer(lignes, 0, type);
}

/** Classeur lu par le lecteur Excel, en-tête en première ligne de la première feuille, puis plan. */
export async function planClasseur(octets: Uint8Array, type: TypeContenu): Promise<ResumePlan | { readonly illisible: string }> {
  const r = await (await chargerXlsx()).lecteurXlsx.lire(octets);
  if (!r.ok) return { illisible: r.message };
  return preparer(r.feuilles[0]?.lignes ?? [], 0, type);
}

/** Parcellaire : une planche, `nombre` lignes vides, une planche, deux lignes de total. */
export async function planLignesVides(nombre: number): Promise<{ readonly ignorees: PlanImport['ignorees']; readonly resume: PlanImport['resume']; readonly lignes: readonly number[] }> {
  const m = await chargerImport();
  const vide: LigneBrute = ['', ''];
  const lignes: LigneBrute[] = [['Zone', 'Planche'], ['T1', 'P1']];
  for (let i = 0; i < nombre; i++) lignes.push(vide);
  lignes.push(['T1', 'P2'], ['Total', ''], ['Total', '']);
  const correspondance = m.proposerCorrespondance(lignes[0] ?? [], 'parcellaire');
  const plan = m.preparerImport({ lignes, ligneEntete: 0, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: 2027 });
  return { ignorees: plan.ignorees, resume: plan.resume, lignes: plan.lignes.map((l) => l.ligne) };
}

/** `lireCsv`, résumé : code d'erreur, encodage, nombre de lignes, les trois premières. */
export async function resumerCsv(octets: Uint8Array): Promise<{ readonly erreur: string | null; readonly nombreLignes: number; readonly debut: readonly (readonly string[])[] }> {
  const csv = (await chargerImport()).lireCsv(octets);
  return { erreur: csv.erreur?.code ?? null, nombreLignes: csv.lignes.length, debut: csv.lignes.slice(0, 3) };
}

/**
 * `decoderTexte` SANS décodeur natif (3e relecture, point 4) : `globalThis.TextDecoder` est retiré
 * avant de charger le module (ce fil n'a encore rien décodé), puis chaque entrée est décodée par le
 * repli écrit à la main. `natifAbsent` confirme que le retrait a bien eu lieu.
 */
export async function decoderSansNatif(entrees: readonly Uint8Array[]): Promise<{ readonly natifAbsent: boolean; readonly resultats: readonly TexteDecode[] }> {
  const g = globalThis as { TextDecoder?: unknown };
  delete g.TextDecoder;
  const m = await chargerImport();
  return { natifAbsent: g.TextDecoder === undefined, resultats: entrees.map((o) => m.decoderTexte(o)) };
}
