/**
 * Jeu de données de T15 : la ferme d'exemple de T07 (apps/web/src/mesures/generateur.ts) au
 * volume réel — 30 zones, 400 emplacements, 5 saisons, 3 000 séries et autant d'occupations,
 * 30 000 événements — mais au format du schéma local de @planif/sync (toutes les colonnes,
 * UUID, detail et paramètres en texte JSON), que le générateur de T07 ne connaît pas.
 * S'y ajoutent ce qu'une vraie ferme a aussi : bibliothèque de référence, 60 vannes, stocks,
 * plantations, journal des modifications. Déterministe (mulberry32 amorcé).
 *
 * Une seconde ferme, plus petite, partage la base (un utilisateur membre de deux fermes) : ses
 * identifiants ne doivent jamais sortir dans l'export de la première.
 */
import { TABLES_LOCALES, type NomTableLocale } from '../schema.ts';
import type { BaseMemoire } from './base-memoire.ts';

type Valeur = string | number | null;
type Ligne = Record<string, Valeur>;

export const VOLUMES_T07 = {
  zones: 30,
  emplacements: 400,
  saisons: 5,
  series: 3000,
  evenements: 30_000,
} as const;

function creerAlea(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const deux = (n: number) => String(n).padStart(2, '0');

/** Jour 'AAAA-MM-JJ' à partir d'une année et d'un rang de jour dans l'année (0..364), sans Date. */
function jourDe(annee: number, rang: number): string {
  const mois = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let r = rang;
  for (let m = 0; m < 12; m++) {
    const n = mois[m] ?? 30;
    if (r < n) return `${String(annee)}-${deux(m + 1)}-${deux(r + 1)}`;
    r -= n;
  }
  return `${String(annee)}-12-31`;
}

export interface FermeGeneree {
  readonly fermeId: string;
  readonly nom: string;
  /** Tous les identifiants de lignes de cette ferme (hors bibliothèque de référence). */
  readonly ids: readonly string[];
}

export interface JeuT07 {
  readonly principale: FermeGeneree;
  readonly voisine: FermeGeneree;
  readonly utilisateurId: string;
  /** Refus de synchro de la ferme principale : jamais dans l'export. */
  readonly refusId: string;
  /** Lignes insérées, par table (toutes fermes et référence confondues). */
  readonly lignes: Readonly<Partial<Record<NomTableLocale, number>>>;
}

const NOTES = [
  null,
  null,
  null,
  'RAS',
  'Pucerons sur la planche ; traiter demain',
  'Récolte « extra », calibre 2',
  'Arrosage coupé\npar l’orage',
  'Voir "note" du tunnel',
  // T15b : des notes qu'Excel prendrait pour des formules (neutralisées dans les CSV).
  '=SOMME(A1:A3)',
  '-3 plants gelés',
  '+2 caisses',
  '@Théo : à voir',
];

/** Remplit `base` (créée depuis SCHEMA_LOCAL) : ferme principale au volume de T07, ferme voisine réduite. */
export async function remplirJeuT07(base: BaseMemoire, graine = 7): Promise<JeuT07> {
  const alea = creerAlea(graine);
  const entier = (min: number, max: number) => min + Math.floor(alea() * (max - min + 1));
  const choisir = <T>(liste: readonly T[]): T => {
    const v = liste[Math.floor(alea() * liste.length)];
    if (v === undefined) throw new Error('liste vide');
    return v;
  };
  let compteur = 0;
  const uuid = (espace: string) => `0192f0c1-7a6e-7cc3-${espace}-${(++compteur).toString(16).padStart(12, '0')}`;

  const lignes: Partial<Record<NomTableLocale, Ligne[]>> = {};
  const idsParFerme = new Map<string, string[]>();
  const ajouter = (table: NomTableLocale, l: Ligne): string => {
    (lignes[table] ??= []).push(l);
    const ferme = table === 'ferme' ? l.id : l.ferme_id;
    const id = l.id;
    if (typeof ferme === 'string' && typeof id === 'string') {
      const liste = idsParFerme.get(ferme) ?? [];
      liste.push(id);
      idsParFerme.set(ferme, liste);
    }
    if (typeof id !== 'string') throw new Error('ligne sans id');
    return id;
  };
  const CREE = '2026-01-15T08:00:00.000Z';
  const horo = { cree_le: CREE, modifie_le: CREE, supprime_le: null };

  // ── Bibliothèque de référence (ferme_id nul), commune aux deux fermes ─────────────────────
  const FAMILLES = ['Solanacées', 'Cucurbitacées', 'Brassicacées', 'Astéracées', 'Apiacées', 'Fabacées', 'Amaranthacées', 'Alliacées', 'Rosacées'];
  const familles = FAMILLES.map((nom) => ajouter('famille', { id: uuid('c000'), ferme_id: null, nom, delai_retour_minimal_ans: entier(2, 4), delai_retour_conseille_ans: entier(4, 6), ...horo }));
  const especes: string[] = [];
  for (let i = 0; i < 36; i++) {
    especes.push(
      ajouter('espece', {
        id: uuid('c000'),
        ferme_id: null,
        famille_id: choisir(familles),
        nom: `Espèce ${String(i + 1)}`,
        categorie: choisir(['legume', 'petit_fruit', 'fleur', 'aromatique']),
        perenne: alea() < 0.15 ? 1 : 0,
        unite_recolte: choisir(['kg', 'botte', 'piece', 'barquette']),
        delai_retour_minimal_ans: null,
        delai_retour_conseille_ans: null,
        ...horo,
      }),
    );
  }
  const varietes = especes.flatMap((espece_id, i) =>
    [0, 1].map((k) =>
      ajouter('variete', { id: uuid('c000'), ferme_id: null, espece_id, nom: `Variété ${String(i + 1)}-${String(k + 1)}`, fournisseur: 'Graines « Bio » ; lot A', poids_mille_graines_g: 2.35 + k, taux_germination: 85, ...horo }),
    ),
  );
  const PARAMETRES = JSON.stringify({ densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30.5 }, dureePepiniereJours: 35, dureeAvantRecolteJours: 60, fenetreRecolteJours: 21, margeSecuritePct: 10, rendementAttendu: { quantite: 2.5, unite: 'kg', par: 'metre' } });
  const itineraires = especes.map((espece_id) => ajouter('itineraire', { id: uuid('c000'), ferme_id: null, espece_id, variete_id: null, nom: 'Plant maison, tunnel', mode: 'plant_maison', parametres: PARAMETRES, ...horo }));
  for (let i = 0; i < 12; i++) {
    ajouter('produit_phyto', { id: uuid('c000'), ferme_id: null, nom_commercial: `Produit ${String(i + 1)}`, numero_amm: String(2_000_000 + i), substance_active: 'soufre', delai_avant_recolte_jours: entier(3, 21), utilisable_en_bio: 1, dose_maximale: '{"valeur":7.5,"unite":"kg/ha"}', ...horo });
  }

  const utilisateurId = uuid('d000');
  ajouter('utilisateur', { id: utilisateurId, nom: 'Théophane', ...horo });

  function genererFerme(nom: string, espace: string, echelle: number): FermeGeneree {
    const n = (v: number) => Math.max(1, Math.round(v * echelle));
    const fermeId = uuid(espace);
    ajouter('ferme', { id: fermeId, nom, fuseau_horaire: 'Europe/Paris', position: '{"latitude":44.35,"longitude":2.57}', unites: '{"longueur":"m","masse":"kg"}', ...horo });
    ajouter('membre', { id: uuid(espace), utilisateur_id: utilisateurId, ferme_id: fermeId, role: 'proprietaire', etat: 'accepte', invite_par: null, invite_le: null, ...horo });

    // Réglages propres à la ferme dans la bibliothèque.
    const famillesFerme = [0, 1, 2].map((k) => ajouter('famille', { id: uuid(espace), ferme_id: fermeId, nom: `Famille locale ${String(k + 1)}`, delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6, ...horo }));
    const especeFerme = ajouter('espece', { id: uuid(espace), ferme_id: fermeId, famille_id: choisir(famillesFerme), nom: 'Chou « maison »', categorie: 'legume', perenne: 0, unite_recolte: 'piece', delai_retour_minimal_ans: 4, delai_retour_conseille_ans: 6, ...horo });
    ajouter('variete', { id: uuid(espace), ferme_id: fermeId, espece_id: especeFerme, nom: 'Cœur de bœuf', fournisseur: null, poids_mille_graines_g: 3.2, taux_germination: 90, ...horo });
    ajouter('itineraire', { id: uuid(espace), ferme_id: fermeId, espece_id: especeFerme, variete_id: null, nom: 'Chou d’automne', mode: 'plant_achete', parametres: PARAMETRES, ...horo });
    ajouter('produit_phyto', { id: uuid(espace), ferme_id: fermeId, nom_commercial: 'Purin d’ortie', numero_amm: null, substance_active: 'ortie', delai_avant_recolte_jours: 0, utilisable_en_bio: 1, dose_maximale: null, ...horo });

    const zones: string[] = [];
    for (let i = 0; i < n(VOLUMES_T07.zones); i++) {
      zones.push(ajouter('zone', { id: uuid(espace), ferme_id: fermeId, nom: i < 12 ? `Tunnel ${String(i + 1)}` : `Îlot ${String(i - 11)}`, zone_parente_id: null, type_abri: choisir(['plein_champ', 'tunnel', 'serre', 'hors_sol']), surface_m2: entier(200, 3000) + 0.5, ...horo }));
    }
    const emplacements: string[] = [];
    for (let i = 0; i < n(VOLUMES_T07.emplacements); i++) {
      const z = i % zones.length;
      emplacements.push(
        ajouter('emplacement', {
          id: uuid(espace),
          ferme_id: fermeId,
          zone_id: zones[z] ?? null,
          code: `Z${deux(z + 1)}-P${deux(Math.floor(i / zones.length) + 1)}`,
          sorte: 'planche',
          longueur_m: choisir([15, 20, 25, 30, 30, 40, 50]),
          largeur_m: 0.8,
          nombre_places: null,
          actif_du: '2022-01-01',
          actif_au: null,
          remplace: '[]',
          ...horo,
        }),
      );
    }
    const secteurs: string[] = [];
    for (let i = 0; i < n(60); i++) {
      secteurs.push(ajouter('secteur_irrigation', { id: uuid(espace), ferme_id: fermeId, numero_vanne: i + 1, nom: `Vanne ${String(i + 1)}`, debit_litres_heure: 850.5, adresse_modbus: null, ...horo }));
    }
    for (const emplacement_id of emplacements) {
      ajouter('secteur_emplacement', { id: uuid(espace), ferme_id: fermeId, secteur_irrigation_id: choisir(secteurs), emplacement_id, du: '2022-01-01', au: null, ...horo });
    }
    const saisons: { id: string; annee: number }[] = [];
    for (let i = 0; i < VOLUMES_T07.saisons; i++) {
      const annee = 2022 + i;
      saisons.push({ id: ajouter('saison', { id: uuid(espace), ferme_id: fermeId, nom: String(annee), debut: `${String(annee)}-01-01`, fin: `${String(annee)}-12-31`, ...horo }), annee });
    }

    const series: { id: string; emplacement: string; annee: number; debut: number; fin: number }[] = [];
    const parSaison = Math.ceil(n(VOLUMES_T07.series) / saisons.length);
    for (let i = 0; i < n(VOLUMES_T07.series); i++) {
      const saison = saisons[Math.floor(i / parSaison)] ?? saisons[0];
      if (saison === undefined) throw new Error('saison manquante');
      const debut = entier(31, 300);
      const fin = Math.min(debut + entier(30, 150), 364);
      const k = entier(0, especes.length - 1);
      const id = ajouter('serie', {
        id: uuid(espace),
        ferme_id: fermeId,
        saison_id: saison.id,
        espece_id: especes[k] ?? null,
        variete_id: varietes[2 * k] ?? null,
        itineraire_id: itineraires[k] ?? null,
        parametres: PARAMETRES,
        ancre_type: 'plantation',
        ancre_date: jourDe(saison.annee, debut),
        prevu_semis_pepiniere: jourDe(saison.annee, Math.max(0, debut - 35)),
        prevu_mise_en_place: jourDe(saison.annee, debut),
        prevu_debut_recolte: jourDe(saison.annee, Math.min(364, debut + 60)),
        prevu_fin_recolte: jourDe(saison.annee, fin),
        longueur_m: choisir([15, 30, 45.5]),
        nombre_plants: null,
        statut: 'prevue',
        ...horo,
      });
      const emplacement = choisir(emplacements);
      ajouter('occupation', {
        id: uuid(espace),
        ferme_id: fermeId,
        emplacement_id: emplacement,
        serie_id: id,
        plantation_id: null,
        evenement_id: null,
        longueur_m: 15,
        nombre_places: null,
        position_m: alea() < 0.5 ? 0 : 15,
        prevu_du: jourDe(saison.annee, debut),
        prevu_au: jourDe(saison.annee, fin),
        reel_du: alea() < 0.6 ? jourDe(saison.annee, debut) : null,
        reel_au: null,
        ...horo,
      });
      ajouter('modification', { id: uuid(espace), ferme_id: fermeId, nom_table: 'serie', ligne_id: id, auteur_id: utilisateurId, horodatage: CREE, operation: 'creation', avant: null, apres: `{"id":"${id}","statut":"prevue"}`, proposition_id: null, ...horo });
      series.push({ id, emplacement, annee: saison.annee, debut, fin });
    }

    const plantations: string[] = [];
    for (let i = 0; i < n(20); i++) {
      plantations.push(ajouter('plantation', { id: uuid(espace), ferme_id: fermeId, espece_id: choisir(especes), variete_id: null, date_plantation: '2020-03-15', nombre_plants: entier(50, 900), date_arrachage: null, ...horo }));
    }
    for (const plantation_id of plantations) {
      for (let annee = 2022; annee <= 2026; annee++) {
        ajouter('campagne', { id: uuid(espace), ferme_id: fermeId, plantation_id, annee, debut_recolte_prevu: `${String(annee)}-05-01`, fin_recolte_prevue: `${String(annee)}-06-30`, rendement_prevu: '{"quantite":1.25,"unite":"kg"}', ...horo });
      }
    }
    for (let i = 0; i < n(200); i++) {
      ajouter('assolement', { id: uuid(espace), ferme_id: fermeId, saison_id: choisir(saisons).id, zone_id: choisir(zones), emplacement_id: null, famille_id: choisir(familles), espece_id: null, nature: 'passe_saisi', source_import: null, ...horo });
    }

    const TYPES = ['realise', 'recolte', 'recolte', 'intervention', 'irrigation', 'traitement', 'observation'] as const;
    const DETAILS: Record<(typeof TYPES)[number], () => string> = {
      realise: () => '{"etape":"plantation","quantiteReelle":null}',
      recolte: () => JSON.stringify({ quantite: entier(1, 400) / 4, unite: 'kg', categorie: null }),
      intervention: () => '{"categorie":"entretien","type":"désherbage","outil":"houe"}',
      irrigation: () => JSON.stringify({ secteurIrrigationId: choisir(secteurs), dureeMinutes: entier(10, 90) }),
      traitement: () => '{"produitPhytoId":null,"dose":{"valeur":2.5,"unite":"L/ha"},"surfaceTraiteeM2":120,"cible":"mildiou","operateur":"Théo"}',
      observation: () => '{"nature":"ravageur","gravite":"forte"}',
    };
    const articles: string[] = [];
    for (let i = 0; i < n(30); i++) {
      articles.push(ajouter('article_stock', { id: uuid(espace), ferme_id: fermeId, espece_id: choisir(especes), variete_id: null, unite: 'kg', categorie: null, ...horo }));
    }
    for (let i = 0; i < n(VOLUMES_T07.evenements); i++) {
      const s = choisir(series);
      const type = choisir(TYPES);
      const date = jourDe(s.annee, entier(s.debut, s.fin));
      const id = ajouter('evenement', {
        id: uuid(espace),
        ferme_id: fermeId,
        type,
        date,
        horodatage: `${date}T07:${deux(i % 60)}:00.000Z`,
        auteur_id: utilisateurId,
        source: choisir(['tap', 'tap', 'voix']),
        serie_id: s.id,
        campagne_id: null,
        emplacement_ids: `["${s.emplacement}"]`,
        note: choisir(NOTES),
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: DETAILS[type](),
        cree_le: CREE,
      });
      if (type === 'recolte' && i % 10 === 0) {
        ajouter('mouvement_stock', { id: uuid(espace), ferme_id: fermeId, article_stock_id: choisir(articles), date, quantite: entier(1, 400) / 4, motif: 'recolte', recolte_id: id, cree_le: CREE });
      }
    }
    return { fermeId, nom, ids: idsParFerme.get(fermeId) ?? [] };
  }

  const principale = genererFerme('Ferme de Benoît', 'a000', 1);
  const voisine = genererFerme('Ferme voisine', 'b000', 0.02);

  // Refus de synchro : existe dans la base locale, jamais dans l'export.
  const refusId = ajouter('refus_synchro', { id: uuid('e000'), utilisateur_id: utilisateurId, ferme_id: principale.fermeId, nom_table: 'zone', ligne_id: uuid('b000'), operation: 'PUT', motif: 'ferme_interdite', message: 'Écriture refusée', cree_le: CREE });

  // Insertion : une transaction par table, colonnes du schéma local.
  const compte: Partial<Record<NomTableLocale, number>> = {};
  for (const [table, liste] of Object.entries(lignes) as [NomTableLocale, Ligne[]][]) {
    const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
    for (const l of liste) {
      for (const cle of Object.keys(l)) if (!colonnes.includes(cle)) throw new Error(`${table}.${cle} absente du schéma local`);
    }
    const sql = `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`;
    await base.writeTransaction(async (tx) => {
      for (const l of liste) await tx.execute(sql, colonnes.map((c) => l[c] ?? null));
    });
    compte[table] = liste.length;
  }
  return { principale, voisine, utilisateurId, refusId, lignes: compte };
}
