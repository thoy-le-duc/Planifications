/**
 * Ferme de test de T49 (« ferme neuve ») : une ferme qui vient d'être créée (T39), sans saison,
 * sans zone, sans planche, sans itinéraire à elle, sans série. Écrite à la main, format du schéma
 * local de @planif/sync (snake_case, texte JSON).
 *
 * Utilisée par :
 *   - ../ecran.test.tsx, ../../demarrer/*.test.tsx (base mémoire) ;
 *   - la page /diagnostic/amorcer.html?jeu=ferme-neuve (src/donnees/amorcer.ts), lue par
 *     e2e/demarrer-ferme.e2e.ts.
 *
 * Ferme « Ferme neuve (tests) ». UTILISATEUR : gérant actif (ou équipier, option `role`).
 * Bibliothèque commune (ferme_id nul, lecture seule, comme la bibliothèque de départ de T41) :
 *   - famille Astéracées, espèce Batavia ;
 *   - itinéraire « Batavia » (ITINERAIRE_BIBLIOTHEQUE) : plant maison, toute l'année, pépinière
 *     21 j, avant récolte 28 j, fenêtre 14 j, 3 rangs à 30 cm, sans travaux.
 */
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';

type Valeur = string | number | null;
export type LigneLocale = Readonly<Record<string, Valeur>>;

const id = (n: number) => `0192f0c1-4949-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Utilisateur de TEST (jamais un vrai compte) : sa base locale est celle que l'amorçage remplit. */
export const UTILISATEUR = id(0x1);
export const FERME = id(0x2);
const MEMBRE = id(0x3);
export const FAMILLE_BIBLIOTHEQUE = id(0x30);
export const ESPECE_BIBLIOTHEQUE = id(0x40);
export const ITINERAIRE_BIBLIOTHEQUE = id(0x60);
export const CREE_LE = '2026-01-01T08:00:00.000Z';

export const PARAMETRES_BIBLIOTHEQUE: Readonly<Record<string, unknown>> = {
  mode: 'plant_maison',
  periodeUsage: null,
  typeAbri: null,
  dureePepiniereJours: 21,
  dureeAvantRecolteJours: 28,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 5,
  alveolesParPlaque: 104,
};

export interface OptionsFermeNeuve {
  /** Rôle de UTILISATEUR. Défaut : 'gerant'. */
  readonly role?: 'gerant' | 'equipier';
}

export interface FermeNeuve {
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: Readonly<Partial<Record<NomTableLocale, readonly LigneLocale[]>>>;
  readonly total: number;
}

export function fermeNeuve(options: OptionsFermeNeuve = {}): FermeNeuve {
  const horo = { cree_le: CREE_LE, modifie_le: CREE_LE, supprime_le: null };
  const lignes: Partial<Record<NomTableLocale, LigneLocale[]>> = {};
  const ajouter = (table: NomTableLocale, l: LigneLocale) => {
    (lignes[table] ??= []).push(l);
  };
  ajouter('utilisateur', { id: UTILISATEUR, nom: 'Théophane (test ferme neuve)', ...horo });
  ajouter('ferme', { id: FERME, nom: 'Ferme neuve (tests)', fuseau_horaire: 'Europe/Paris', position: null, origine_plan: null, unites: '{"longueur":"m","masse":"kg"}', ...horo });
  ajouter('membre', { id: MEMBRE, utilisateur_id: UTILISATEUR, ferme_id: FERME, role: options.role ?? 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  ajouter('famille', { id: FAMILLE_BIBLIOTHEQUE, ferme_id: null, nom: 'Astéracées', delai_retour_minimal_ans: 2, delai_retour_conseille_ans: 3, ...horo });
  ajouter('espece', {
    id: ESPECE_BIBLIOTHEQUE,
    ferme_id: null,
    famille_id: FAMILLE_BIBLIOTHEQUE,
    nom: 'Batavia',
    categorie: 'legume',
    perenne: 0,
    unite_recolte: 'piece',
    delai_retour_minimal_ans: null,
    delai_retour_conseille_ans: null,
    profil_croissance: null,
    ...horo,
  });
  ajouter('itineraire', {
    id: ITINERAIRE_BIBLIOTHEQUE,
    ferme_id: null,
    espece_id: ESPECE_BIBLIOTHEQUE,
    variete_id: null,
    nom: 'Batavia',
    mode: 'plant_maison',
    parametres: JSON.stringify(PARAMETRES_BIBLIOTHEQUE),
    ...horo,
  });
  const total = Object.values(lignes).reduce((n, l) => n + l.length, 0);
  return { utilisateurId: UTILISATEUR, fermeId: FERME, lignes, total };
}

export async function ecrireFermeNeuve(base: Pick<BaseLocale, 'writeTransaction'>, options: OptionsFermeNeuve = {}): Promise<FermeNeuve> {
  const ferme = fermeNeuve(options);
  for (const [table, liste] of Object.entries(ferme.lignes) as [NomTableLocale, readonly LigneLocale[]][]) {
    const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
    for (const l of liste) {
      for (const cle of Object.keys(l)) if (!colonnes.includes(cle)) throw new Error(`${table}.${cle} absente du schéma local`);
    }
    const sql = `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`;
    await base.writeTransaction(async (tx) => {
      for (const l of liste) await tx.execute(sql, colonnes.map((c) => l[c] ?? null));
    });
  }
  return ferme;
}
