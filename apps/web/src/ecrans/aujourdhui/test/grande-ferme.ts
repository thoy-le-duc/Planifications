/**
 * T13b — « grande ferme » d'Aujourd'hui : 3 000 séries en cours ou prévues, des itinéraires
 * valides (modes et travaux prévus) qui donnent des milliers de tâches, environ 50 000
 * événements avec des chaînes de corrections et d'annulations. Datée RELATIVEMENT au jour donné,
 * comme la ferme du jour (./ferme-du-jour.ts) : mêmes tâches quel que soit le jour du test.
 * Déterministe : aucune part de hasard, tout découle de l'indice de la série.
 *
 * Utilisée par :
 *   - ../grande-ferme.test.ts (node:sqlite, stockage de PowerSync : ./base-powersync.ts) ;
 *   - la page /diagnostic/amorcer.html?jeu=aujourdhui-grande-ferme&date=AAAA-MM-JJ (e2e) ;
 *   - apps/web/e2e/aujourdhui-grande-ferme.e2e.ts.
 *
 * Contenu (k = indice de la série active, 0 … 2 999 ; J = aujourd'hui) :
 *   - mise en place à J + ((7k mod 150) − 90), soit de J−90 à J+59 ; semis en pépinière 30 jours
 *     avant (plant maison) ; récolte de mise en place +50 à +100 ; mode selon k mod 3 ;
 *   - travaux prévus de l'itinéraire, recopiés dans l'instantané : désherbage tous les 14 jours
 *     dès mise en place +14 (45 min par planche), grelinette à mise en place −12 (20 min / 100 m) ;
 *   - réalisés : semis en pépinière (sauf k mod 11 = 0), mise en place (sauf k mod 7 = 0 : tâche
 *     en retard) ; récoltes chaque semaine depuis le début de récolte ; désherbages faits avec
 *     leur occurrence visée (le dernier oublié si k mod 5 = 0 : tâche en retard) ; observations ;
 *   - chaînes : corrections reçues du serveur (`origine_id`), corrections locales sans
 *     `origine_id`, corrections de corrections, annulations de récoltes, de réalisés et
 *     d'interventions, certaines dans la fenêtre de l'historique ;
 *   - 1 000 séries terminées de l'an passé, avec tout leur journal (≈ 26 lignes chacune) ;
 *   - 40 plantations pérennes et leurs campagnes, avec récoltes ;
 *   - un mouvement de stock par récolte (`recolte_id`).
 * Aucune culture n'a deux récoltes en vigueur le même jour (la dernière récolte n'en dépend pas
 * de l'ordre de lecture).
 */
import { ajouterJours, type DateCalendaire } from '@planif/core';
import { TABLES_LOCALES, type BaseLocale, type NomTableLocale } from '@planif/sync';

type Valeur = string | number | null;
export type LigneLocale = Readonly<Record<string, Valeur>>;

const id = (n: number) => `0192f0c1-13b0-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Utilisateur de TEST (jamais un vrai compte), distinct de celui de la ferme du jour. */
export const UTILISATEUR_GRANDE = id(0x1);
export const FERME_GRANDE = id(0x2);
const MEMBRE = id(0x3);
const SAISON = id(0x4);
const SAISON_PASSEE = id(0x5);

export const SERIES_ACTIVES = 3_000;
export const SERIES_TERMINEES = 1_000;
const ZONES = 12;
const EMPLACEMENTS = 1_200;
/** 31 : deux séries qui partagent un emplacement (k, k + 1 200, k + 2 400) n'ont jamais la même espèce. */
const ESPECES = 31;
const PLANTATIONS = 40;

const MODES = ['semis_direct', 'plant_maison', 'plant_achete'] as const;
type Mode = (typeof MODES)[number];
const UNITES = ['kg', 'piece', 'botte', 'barquette'] as const;
const FAMILLES = ['Brassicacées', 'Astéracées', 'Apiacées', 'Solanacées', 'Rosacées', 'Asparagacées', 'Alliacées', 'Cucurbitacées'] as const;

/** Plages d'identifiants, par sorte de ligne. */
const BASE = {
  zone: 0x100,
  emplacement: 0x1000,
  famille: 0x2000,
  espece: 0x2100,
  variete: 0x2200,
  itineraire: 0x2300,
  article: 0x2400,
  plantation: 0x3000,
  campagne: 0x3100,
  serie: 0x10000,
  occupation: 0x20000,
  evenement: 0x100000,
  mouvement: 0x200000,
} as const;

export const idSerie = (k: number) => id(BASE.serie + k);

const PARAMETRES_COMMUNS = {
  periodeUsage: null,
  typeAbri: null,
  dureeAvantRecolteJours: 50,
  fenetreRecolteJours: 50,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};
const DENSITE = { sorte: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 };

const DESHERBAGE = {
  categorie: 'entretien',
  type: 'désherbage',
  repere: 'mise_en_place',
  decalageJours: 14,
  repetition: { tousLesJours: 14, repereFin: 'fin_recolte' },
  outil: null,
  produit: null,
  tempsEstime: { minutes: 45, par: 'planche' },
} as const;
const GRELINETTE = {
  categorie: 'travail_sol',
  type: 'grelinette',
  repere: 'mise_en_place',
  decalageJours: -12,
  repetition: null,
  outil: 'grelinette',
  produit: null,
  tempsEstime: { minutes: 20, par: 'cent_metres' },
} as const;

function parametres(mode: Mode): string {
  const travauxPrevus = [DESHERBAGE, GRELINETTE];
  switch (mode) {
    case 'semis_direct':
      return JSON.stringify({ ...PARAMETRES_COMMUNS, mode, densite: DENSITE, grainesParPoquet: 1, travauxPrevus });
    case 'plant_maison':
      return JSON.stringify({
        ...PARAMETRES_COMMUNS,
        mode,
        densite: DENSITE,
        dureePepiniereJours: 30,
        grainesParMotte: 1,
        plantsParMotte: 1,
        pertePepiniere: 5,
        alveolesParPlaque: 104,
        travauxPrevus,
      });
    case 'plant_achete':
      return JSON.stringify({ ...PARAMETRES_COMMUNS, mode, densite: DENSITE, travauxPrevus });
  }
}

export interface GrandeFerme {
  readonly aujourdhui: string;
  readonly utilisateurId: string;
  readonly fermeId: string;
  readonly lignes: Readonly<Partial<Record<NomTableLocale, readonly LigneLocale[]>>>;
  /** Total des lignes (ce que la page d'amorçage annonce). */
  readonly total: number;
  /** Lignes du journal (table evenement). */
  readonly evenements: number;
}

/** Construit la grande ferme, sans rien écrire. `aujourdhui` : 'AAAA-MM-JJ'. */
export function grandeFerme(aujourdhui: string): GrandeFerme {
  const J = aujourdhui as DateCalendaire;
  const j = (n: number): string => ajouterJours(J, n);
  const annee = Number(aujourdhui.slice(0, 4));
  const C = `${j(-500)}T08:00:00.000Z`;
  const horo = { cree_le: C, modifie_le: C, supprime_le: null };
  const lignes: Partial<Record<NomTableLocale, LigneLocale[]>> = {};
  const ajouter = (table: NomTableLocale, l: LigneLocale) => {
    (lignes[table] ??= []).push(l);
  };

  ajouter('utilisateur', { id: UTILISATEUR_GRANDE, nom: 'Théophane (test, grande ferme)', ...horo });
  ajouter('ferme', {
    id: FERME_GRANDE,
    nom: 'Grande ferme (tests)',
    fuseau_horaire: 'Europe/Paris',
    position: '{"latitude":44.35,"longitude":2.57}',
    unites: '{"longueur":"m","masse":"kg"}',
    ...horo,
  });
  ajouter('membre', { id: MEMBRE, utilisateur_id: UTILISATEUR_GRANDE, ferme_id: FERME_GRANDE, role: 'gerant', etat: 'accepte', invite_par: null, invite_le: null, ...horo });
  ajouter('saison', { id: SAISON, ferme_id: FERME_GRANDE, nom: String(annee), debut: `${String(annee)}-01-01`, fin: `${String(annee)}-12-31`, ...horo });
  ajouter('saison', { id: SAISON_PASSEE, ferme_id: FERME_GRANDE, nom: String(annee - 1), debut: `${String(annee - 1)}-01-01`, fin: `${String(annee - 1)}-12-31`, ...horo });

  for (let z = 0; z < ZONES; z++) {
    ajouter('zone', { id: id(BASE.zone + z), ferme_id: FERME_GRANDE, nom: `Zone ${String(z + 1)}`, zone_parente_id: null, type_abri: z % 3 === 0 ? 'tunnel' : 'plein_champ', surface_m2: 2000, ...horo });
  }
  const emplacement = (n: number) => id(BASE.emplacement + n);
  for (let n = 0; n < EMPLACEMENTS; n++) {
    const z = n % ZONES;
    ajouter('emplacement', {
      id: emplacement(n),
      ferme_id: FERME_GRANDE,
      zone_id: id(BASE.zone + z),
      code: `Z${String(z + 1)}-P${String(Math.floor(n / ZONES) + 1).padStart(3, '0')}`,
      sorte: 'planche',
      longueur_m: 30,
      largeur_m: 0.8,
      nombre_places: null,
      actif_du: j(-900),
      actif_au: null,
      remplace: '[]',
      ...horo,
    });
  }
  for (const [f, nom] of FAMILLES.entries()) {
    ajouter('famille', { id: id(BASE.famille + f), ferme_id: FERME_GRANDE, nom, delai_retour_minimal_ans: 3, delai_retour_conseille_ans: 4, ...horo });
  }
  for (let e = 0; e < ESPECES; e++) {
    ajouter('espece', {
      id: id(BASE.espece + e),
      ferme_id: FERME_GRANDE,
      famille_id: id(BASE.famille + (e % FAMILLES.length)),
      nom: `Espèce ${String(e + 1).padStart(2, '0')}`,
      categorie: 'legume',
      perenne: e < 4 ? 1 : 0,
      unite_recolte: UNITES[e % UNITES.length] ?? 'kg',
      delai_retour_minimal_ans: null,
      delai_retour_conseille_ans: null,
      ...horo,
    });
    for (let v = 0; v < 2; v++) {
      ajouter('variete', { id: id(BASE.variete + e * 2 + v), ferme_id: FERME_GRANDE, espece_id: id(BASE.espece + e), nom: `Variété ${String(e + 1)}-${String(v + 1)}`, fournisseur: null, poids_mille_graines_g: 3, taux_germination: 90, ...horo });
    }
    ajouter('article_stock', { id: id(BASE.article + e), ferme_id: FERME_GRANDE, espece_id: id(BASE.espece + e), variete_id: null, unite: UNITES[e % UNITES.length] ?? 'kg', categorie: null, ...horo });
    for (const [m, mode] of MODES.entries()) {
      ajouter('itineraire', { id: id(BASE.itineraire + e * 3 + m), ferme_id: FERME_GRANDE, espece_id: id(BASE.espece + e), variete_id: null, nom: `Itinéraire ${mode}`, mode, parametres: parametres(mode), ...horo });
    }
  }

  let prochainEvenement = BASE.evenement;
  let prochainMouvement = BASE.mouvement;
  let prochaineOccupation = BASE.occupation;
  let evenements = 0;

  interface Saisie {
    readonly type: string;
    readonly date: string;
    readonly serieId?: string | null;
    readonly campagneId?: string | null;
    readonly emplacementId: string;
    readonly detail: Record<string, unknown>;
    /** Heure de saisie (instant ISO) ; par défaut le jour même à 07:30. */
    readonly horodatage?: string;
    readonly remplace?: { readonly sorte: 'correction' | 'annulation'; readonly de: string } | null;
    /** Ligne reçue du serveur : origine de sa chaîne (T10h). */
    readonly origineId?: string | null;
  }
  const evenement = (s: Saisie): string => {
    const eid = id(prochainEvenement++);
    const horodatage = s.horodatage ?? `${s.date}T07:30:00.000Z`;
    evenements++;
    ajouter('evenement', {
      id: eid,
      ferme_id: FERME_GRANDE,
      type: s.type,
      date: s.date,
      horodatage,
      auteur_id: UTILISATEUR_GRANDE,
      source: 'tap',
      serie_id: s.serieId ?? null,
      campagne_id: s.campagneId ?? null,
      emplacement_ids: JSON.stringify([s.emplacementId]),
      note: null,
      photos: '[]',
      remplace_sorte: s.remplace?.sorte ?? null,
      remplace_evenement_id: s.remplace?.de ?? null,
      detail: JSON.stringify(s.detail),
      cree_le: horodatage,
      origine_id: s.origineId === undefined ? null : s.origineId,
    });
    if (s.type === 'recolte' && s.remplace?.sorte !== 'annulation') {
      const e = Number.parseInt((s.serieId ?? s.campagneId ?? '0').slice(-4), 16) % ESPECES;
      ajouter('mouvement_stock', {
        id: id(prochainMouvement++),
        ferme_id: FERME_GRANDE,
        article_stock_id: id(BASE.article + e),
        date: s.date,
        quantite: Number(s.detail.quantite ?? 0),
        motif: 'recolte',
        recolte_id: eid,
        cree_le: horodatage,
      });
    }
    return eid;
  };
  /** Instant ISO `jours` après le début du jour `date`, à `hhmm`. */
  const instant = (date: string, jours: number, hhmm: string) => `${ajouterJours(date as DateCalendaire, jours)}T${hhmm}:00.000Z`;

  const occupation = (serieId: string | null, plantationId: string | null, emp: string, du: string, au: string) => {
    ajouter('occupation', {
      id: id(prochaineOccupation++),
      ferme_id: FERME_GRANDE,
      emplacement_id: emp,
      serie_id: serieId,
      plantation_id: plantationId,
      evenement_id: null,
      longueur_m: serieId === null ? null : 30,
      nombre_places: serieId === null ? 400 : null,
      position_m: serieId === null ? null : 0,
      prevu_du: du,
      prevu_au: au,
      reel_du: null,
      reel_au: null,
      ...horo,
    });
  };

  const serie = (k: number, sid: string, saison: string, mode: Mode, dates: { semis: string | null; mep: string; debut: string; fin: string }, statut: string, emp: string) => {
    const e = k % ESPECES;
    const m = MODES.indexOf(mode);
    ajouter('serie', {
      id: sid,
      ferme_id: FERME_GRANDE,
      saison_id: saison,
      espece_id: id(BASE.espece + e),
      variete_id: k % 4 === 0 ? null : id(BASE.variete + e * 2 + (k % 2)),
      itineraire_id: id(BASE.itineraire + e * 3 + m),
      parametres: parametres(mode),
      ancre_type: 'plantation',
      ancre_date: dates.mep,
      prevu_semis_pepiniere: dates.semis,
      prevu_mise_en_place: dates.mep,
      prevu_debut_recolte: dates.debut,
      prevu_fin_recolte: dates.fin,
      longueur_m: 30,
      nombre_plants: null,
      statut,
      ...horo,
    });
    occupation(sid, null, emp, dates.mep, dates.fin);
  };

  /** Une chaîne de corrections / annulations sur `origine` (même date, même culture). */
  const chaine = (k: number, origine: string, s: Saisie, serveur: boolean) => {
    const origineId = serveur ? origine : null;
    const base = s.horodatage ?? `${s.date}T07:30:00.000Z`;
    const plus = (h: number) => new Date(Date.parse(base) + h * 3_600_000).toISOString();
    const corrige = (de: string, h: number, detail: Record<string, unknown>) => evenement({ ...s, horodatage: plus(h), remplace: { sorte: 'correction', de }, origineId, detail });
    const annule = (de: string, h: number) => evenement({ ...s, horodatage: plus(h), remplace: { sorte: 'annulation', de }, origineId });
    const avecQuantite = (q: number) => (s.type === 'recolte' ? { ...s.detail, quantite: q } : s.detail);
    switch (k % 4) {
      case 0: // une correction
        corrige(origine, 2, avecQuantite(11));
        break;
      case 1: {
        // correction de correction (la plus récente l'emporte)
        const c1 = corrige(origine, 1, avecQuantite(12));
        corrige(c1, 3, avecQuantite(13));
        break;
      }
      case 2: {
        // chaîne ramifiée dont une branche est annulée : plus rien en vigueur
        const c1 = corrige(origine, 1, avecQuantite(14));
        corrige(origine, 2, avecQuantite(15));
        annule(c1, 4);
        break;
      }
      default:
        annule(origine, 5);
    }
  };

  // ── Séries actives ──
  for (let k = 0; k < SERIES_ACTIVES; k++) {
    const sid = idSerie(k);
    const mode = MODES[k % 3] ?? 'semis_direct';
    const o = ((7 * k) % 150) - 90;
    const mep = j(o);
    const semis = mode === 'plant_maison' ? j(o - 30) : null;
    const debut = j(o + 50);
    const fin = j(o + 100);
    const emp = emplacement(k % EMPLACEMENTS);
    serie(k, sid, SAISON, mode, { semis, mep, debut, fin }, o <= 0 ? 'en_cours' : 'prevue', emp);
    const serveur = k % 2 === 0;
    const origineServeur = (eid: string) => (serveur ? eid : null);
    const base = { serieId: sid, emplacementId: emp };

    if (semis !== null && o - 30 < 0 && k % 11 !== 0) {
      const s: Saisie = { ...base, type: 'realise', date: semis, detail: { etape: 'semis_pepiniere', quantiteReelle: null } };
      evenement(s);
    }
    if (o < -3 && k % 7 !== 0) {
      const date = j(o + (k % 3));
      const s: Saisie = { ...base, type: 'realise', date, detail: { etape: mode === 'semis_direct' ? 'semis_direct' : 'plantation', quantiteReelle: null } };
      if (k % 13 === 0) {
        // Réalisé corrigé ou annulé (une annulation remet la tâche au semainier).
        const sid0 = id(prochainEvenement);
        evenement({ ...s, origineId: origineServeur(sid0) });
        chaine(k, sid0, { ...s }, serveur);
      } else evenement(s);
    }
    // Désherbages faits (occurrence visée), le dernier oublié si k mod 5 = 0.
    if (o < -3 && k % 7 !== 0) {
      const occurrences: number[] = [];
      for (let d = o + 14; d < 0 && d <= o + 100; d += 14) occurrences.push(d);
      const faites = k % 5 === 0 ? occurrences.slice(0, -1) : occurrences;
      for (const [n, d] of faites.entries()) {
        const date = j(Math.min(-1, d + (k % 2)));
        const s: Saisie = { ...base, type: 'intervention', date, detail: { categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: n % 3 === 2 ? null : j(d) } };
        if (k % 17 === 0 && n === faites.length - 1) {
          const sid0 = id(prochainEvenement);
          evenement({ ...s, origineId: origineServeur(sid0) });
          chaine(k + 3, sid0, s, serveur);
        } else evenement(s);
      }
      const g = o - 12;
      if (k % 3 !== 0) evenement({ ...base, type: 'intervention', date: j(g), detail: { categorie: 'travail_sol', type: 'grelinette', outil: 'grelinette', occurrenceVisee: j(g) } });
    }
    // Récoltes chaque semaine depuis le début de récolte (jusqu'à hier, au plus tard la fin).
    for (let d = o + 50, n = 0; d < 0 && d <= o + 100; d += 7, n++) {
      const date = j(d);
      const s: Saisie = { ...base, type: 'recolte', date, detail: { quantite: 1 + ((k * 13 + n) % 40), unite: UNITES[(k % ESPECES) % UNITES.length] ?? 'kg', categorie: null } };
      if ((k + n) % 9 === 0) {
        const sid0 = id(prochainEvenement);
        evenement({ ...s, origineId: origineServeur(sid0) });
        chaine(k + n, sid0, s, serveur);
      } else evenement(s);
    }
    // Observations (hors des requêtes de la journée, mais dans le journal).
    for (let d = Math.max(o - 30, -120); d < -7; d += 9) {
      evenement({ ...base, type: 'observation', date: j(d), detail: { nature: 'stade', gravite: null } });
    }
  }

  // ── Séries terminées de l'an passé (journal complet) ──
  for (let t = 0; t < SERIES_TERMINEES; t++) {
    const k = SERIES_ACTIVES + t;
    const sid = idSerie(k);
    const mode = MODES[t % 3] ?? 'semis_direct';
    const o = -420 + (t % 200);
    const emp = emplacement(t % EMPLACEMENTS);
    const semis = mode === 'plant_maison' ? j(o - 30) : null;
    serie(k, sid, SAISON_PASSEE, mode, { semis, mep: j(o), debut: j(o + 50), fin: j(o + 100) }, 'terminee', emp);
    const base = { serieId: sid, emplacementId: emp };
    if (semis !== null) evenement({ ...base, type: 'realise', date: semis, detail: { etape: 'semis_pepiniere', quantiteReelle: null } });
    evenement({ ...base, type: 'realise', date: j(o), detail: { etape: mode === 'semis_direct' ? 'semis_direct' : 'plantation', quantiteReelle: null } });
    for (let d = o + 14; d <= o + 100; d += 14) evenement({ ...base, type: 'intervention', date: j(d), detail: { categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: j(d) } });
    for (let d = o + 50, n = 0; d <= o + 100; d += 4, n++) {
      const s: Saisie = { ...base, type: 'recolte', date: j(d), detail: { quantite: 2 + ((t + n) % 30), unite: 'kg', categorie: null } };
      if ((t + n) % 11 === 0) {
        const sid0 = id(prochainEvenement);
        evenement({ ...s, origineId: sid0 });
        chaine(t + n, sid0, s, true);
      } else evenement(s);
    }
    evenement({ ...base, type: 'realise', date: j(o + 101), detail: { etape: 'arrachage', quantiteReelle: null } });
  }

  // ── Plantations pérennes et campagnes ──
  for (let p = 0; p < PLANTATIONS; p++) {
    const pid = id(BASE.plantation + p);
    const cid = id(BASE.campagne + p);
    const e = p % 4;
    const emp = emplacement(EMPLACEMENTS - 1 - p);
    const debut = -40 + (p % 20) * 3;
    const fin = debut + 60;
    ajouter('plantation', { id: pid, ferme_id: FERME_GRANDE, espece_id: id(BASE.espece + e), variete_id: null, date_plantation: j(-700), nombre_plants: 400, date_arrachage: null, ...horo });
    ajouter('campagne', { id: cid, ferme_id: FERME_GRANDE, plantation_id: pid, annee: annee, debut_recolte_prevu: j(debut), fin_recolte_prevue: j(fin), rendement_prevu: null, ...horo });
    occupation(null, pid, emp, j(-700), '9999-12-31');
    for (let d = debut + 1, n = 0; d < 0; d += 2, n++) {
      const s: Saisie = { campagneId: cid, emplacementId: emp, type: 'recolte', date: j(d), detail: { quantite: 3 + ((p + n) % 20), unite: UNITES[e % UNITES.length] ?? 'kg', categorie: null } };
      if ((p + n) % 7 === 0) {
        const sid0 = id(prochainEvenement);
        evenement({ ...s, origineId: sid0 });
        chaine(p + n, sid0, s, true);
      } else evenement(s);
    }
  }

  // Une saisie locale du jour, pas encore synchronisée (dans l'historique).
  const k0 = 7;
  evenement({ serieId: idSerie(k0), emplacementId: emplacement(k0), type: 'observation', date: aujourdhui, horodatage: instant(aujourdhui, 0, '06:00'), detail: { nature: 'autre', gravite: null } });

  const total = Object.values(lignes).reduce((n, l) => n + l.length, 0);
  return { aujourdhui, utilisateurId: UTILISATEUR_GRANDE, fermeId: FERME_GRANDE, lignes, total, evenements };
}

/** Lignes par ordre INSERT (plusieurs lignes par ordre : l'amorçage dans le navigateur va plus vite). */
const LIGNES_PAR_ORDRE = 50;

/**
 * Écrit la grande ferme dans `base` (base de test, ou PowerSync dans la page d'amorçage), une
 * transaction par table, colonnes du schéma local. Rend la ferme construite.
 */
export async function ecrireGrandeFerme(base: Pick<BaseLocale, 'writeTransaction'>, aujourdhui: string): Promise<GrandeFerme> {
  const ferme = grandeFerme(aujourdhui);
  for (const [table, liste] of Object.entries(ferme.lignes) as [NomTableLocale, readonly LigneLocale[]][]) {
    const colonnes = ['id', ...Object.keys(TABLES_LOCALES[table])];
    for (const l of liste) {
      for (const cle of Object.keys(l)) if (!colonnes.includes(cle)) throw new Error(`${table}.${cle} absente du schéma local`);
    }
    const tuple = `(${colonnes.map(() => '?').join(', ')})`;
    await base.writeTransaction(async (tx) => {
      for (let debut = 0; debut < liste.length; debut += LIGNES_PAR_ORDRE) {
        const lot = liste.slice(debut, debut + LIGNES_PAR_ORDRE);
        const sql = `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES ${lot.map(() => tuple).join(', ')}`;
        await tx.execute(
          sql,
          lot.flatMap((l) => colonnes.map((c) => l[c] ?? null)),
        );
      }
    });
  }
  return ferme;
}
