/**
 * T07 — générateur déterministe d'une ferme réaliste, pour mesurer la base locale.
 *
 * Autonome : n'importe pas le moteur métier du dépôt (T01 pas encore livré). Le hasard vient d'un
 * PRNG amorcé par la graine (mulberry32) ; les dates sont calculées en jours entiers depuis
 * le 1970-01-01 et formatées à la main, sans objet Date ni heure courante.
 */

export type TypeEvenement = 'realise' | 'recolte' | 'intervention' | 'irrigation' | 'traitement' | 'observation';

export interface Famille {
  id: string;
  nom: string;
}
export interface Zone {
  id: string;
  nom: string;
}
export interface Emplacement {
  id: string;
  zone_id: string;
  code: string;
  longueur_m: number;
}
export interface Saison {
  id: string;
  nom: string;
  debut: string;
  fin: string;
}
export interface Serie {
  id: string;
  saison_id: string;
  famille_id: string;
  espece: string;
}
export interface Occupation {
  id: string;
  emplacement_id: string;
  serie_id: string;
  du: string;
  au: string;
}
export interface Evenement {
  id: string;
  type: TypeEvenement;
  date: string;
  serie_id: string | null;
  emplacement_id: string | null;
}

export interface FermeGeneree {
  familles: Famille[];
  zones: Zone[];
  emplacements: Emplacement[];
  saisons: Saison[];
  series: Serie[];
  occupations: Occupation[];
  evenements: Evenement[];
}

export const VOLUMES = {
  zones: 30,
  emplacements: 400,
  saisons: 5,
  series: 3000,
  evenements: 30_000,
} as const;

/** Première année civile du jeu : cinq saisons de 2022 à 2026. */
export const PREMIERE_ANNEE = 2022;

const FAMILLES: readonly { nom: string; especes: readonly string[] }[] = [
  { nom: 'Solanacées', especes: ['Tomate', 'Aubergine', 'Poivron', 'Pomme de terre'] },
  { nom: 'Cucurbitacées', especes: ['Courgette', 'Concombre', 'Melon', 'Courge'] },
  { nom: 'Brassicacées', especes: ['Chou', 'Brocoli', 'Radis', 'Navet'] },
  { nom: 'Astéracées', especes: ['Batavia', 'Laitue', 'Chicorée', 'Artichaut'] },
  { nom: 'Apiacées', especes: ['Carotte', 'Céleri', 'Persil', 'Fenouil'] },
  { nom: 'Fabacées', especes: ['Haricot', 'Pois', 'Fève'] },
  { nom: 'Amaranthacées', especes: ['Betterave', 'Épinard', 'Blette'] },
  { nom: 'Alliacées', especes: ['Oignon', 'Poireau', 'Ail'] },
  { nom: 'Rosacées', especes: ['Fraise'] },
];

const TYPES_SUR_SERIE: readonly TypeEvenement[] = ['realise', 'recolte', 'recolte', 'intervention', 'traitement', 'observation'];
const TYPES_SUR_EMPLACEMENT: readonly TypeEvenement[] = ['irrigation', 'irrigation', 'intervention', 'observation'];

/** mulberry32 : PRNG 32 bits, rapide et suffisant pour un jeu de test. Renvoie un flottant dans [0, 1). */
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

/** Jours depuis le 1970-01-01 (calendrier grégorien proleptique), algorithme de H. Hinnant. */
export function joursDepuisEpoque(annee: number, mois: number, jour: number): number {
  const a = mois <= 2 ? annee - 1 : annee;
  const ere = Math.floor(a / 400);
  const ane = a - ere * 400;
  const m = mois > 2 ? mois - 3 : mois + 9;
  const jda = Math.floor((153 * m + 2) / 5) + jour - 1;
  const jde = ane * 365 + Math.floor(ane / 4) - Math.floor(ane / 100) + jda;
  return ere * 146097 + jde - 719468;
}

/** Inverse de `joursDepuisEpoque`, formaté en `AAAA-MM-JJ`. */
export function formaterJour(jours: number): string {
  const z = jours + 719468;
  const ere = Math.floor(z / 146097);
  const jde = z - ere * 146097;
  const ane = Math.floor((jde - Math.floor(jde / 1460) + Math.floor(jde / 36524) - Math.floor(jde / 146096)) / 365);
  const jda = jde - (365 * ane + Math.floor(ane / 4) - Math.floor(ane / 100));
  const mp = Math.floor((5 * jda + 2) / 153);
  const jour = jda - Math.floor((153 * mp + 2) / 5) + 1;
  const mois = mp < 10 ? mp + 3 : mp - 9;
  const annee = ane + ere * 400 + (mois <= 2 ? 1 : 0);
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

function num(n: number, largeur: number): string {
  return String(n).padStart(largeur, '0');
}

export function genererFerme(graine: number): FermeGeneree {
  const alea = creerAlea(graine);
  const entier = (min: number, max: number): number => min + Math.floor(alea() * (max - min + 1));
  const choisir = <T>(liste: readonly T[]): T => {
    const valeur = liste[Math.floor(alea() * liste.length)];
    if (valeur === undefined) throw new Error('liste vide');
    return valeur;
  };

  const familles: Famille[] = FAMILLES.map((f, i) => ({ id: `fam-${num(i + 1, 2)}`, nom: f.nom }));

  const zones: Zone[] = [];
  for (let i = 1; i <= VOLUMES.zones; i++) {
    const nom = i <= 12 ? `Tunnel ${String(i)}` : i <= 24 ? `Îlot ${String(i - 12)}` : `Serre ${String(i - 24)}`;
    zones.push({ id: `zone-${num(i, 2)}`, nom });
  }

  // 400 emplacements répartis sur les 30 zones (13 ou 14 par zone), code unique `Z07-P03`.
  const emplacements: Emplacement[] = [];
  for (let i = 0; i < VOLUMES.emplacements; i++) {
    const z = i % VOLUMES.zones;
    const rang = Math.floor(i / VOLUMES.zones) + 1;
    const zone = zones[z];
    if (zone === undefined) throw new Error('zone manquante');
    emplacements.push({
      id: `empl-${num(i + 1, 3)}`,
      zone_id: zone.id,
      code: `Z${num(z + 1, 2)}-P${num(rang, 2)}`,
      longueur_m: choisir([15, 20, 25, 30, 30, 40, 50]),
    });
  }

  const saisons: Saison[] = [];
  for (let i = 0; i < VOLUMES.saisons; i++) {
    const annee = PREMIERE_ANNEE + i;
    saisons.push({ id: `saison-${String(annee)}`, nom: String(annee), debut: `${String(annee)}-01-01`, fin: `${String(annee)}-12-31` });
  }
  const dernierJour = joursDepuisEpoque(PREMIERE_ANNEE + VOLUMES.saisons - 1, 12, 31);

  // Séries : autant par saison (600), une occupation chacune, mise en place entre février et octobre.
  const series: Serie[] = [];
  const occupations: Occupation[] = [];
  const bornes: { debut: number; fin: number; emplacementId: string }[] = [];
  const parSaison = VOLUMES.series / VOLUMES.saisons;
  for (let i = 0; i < VOLUMES.series; i++) {
    const indexSaison = Math.floor(i / parSaison);
    const saison = saisons[indexSaison];
    if (saison === undefined) throw new Error('saison manquante');
    const indexFamille = entier(0, FAMILLES.length - 1);
    const famille = FAMILLES[indexFamille];
    const familleGeneree = familles[indexFamille];
    if (famille === undefined || familleGeneree === undefined) throw new Error('famille manquante');
    const id = `serie-${num(i + 1, 4)}`;
    series.push({ id, saison_id: saison.id, famille_id: familleGeneree.id, espece: choisir(famille.especes) });

    const annee = PREMIERE_ANNEE + indexSaison;
    const debut = joursDepuisEpoque(annee, 2, 1) + entier(0, 270);
    const fin = Math.min(debut + entier(30, 150), dernierJour);
    const emplacement = choisir(emplacements);
    occupations.push({ id: `occ-${num(i + 1, 4)}`, emplacement_id: emplacement.id, serie_id: id, du: formaterJour(debut), au: formaterJour(fin) });
    bornes.push({ debut, fin, emplacementId: emplacement.id });
  }

  // Événements : 80 % sur une série (pendant son occupation), 20 % sur un emplacement seul.
  const evenements: Evenement[] = [];
  const premierJour = joursDepuisEpoque(PREMIERE_ANNEE, 1, 1);
  for (let i = 0; i < VOLUMES.evenements; i++) {
    const id = `ev-${num(i + 1, 5)}`;
    if (alea() < 0.8) {
      const k = entier(0, VOLUMES.series - 1);
      const serie = series[k];
      const borne = bornes[k];
      if (serie === undefined || borne === undefined) throw new Error('série manquante');
      evenements.push({
        id,
        type: choisir(TYPES_SUR_SERIE),
        date: formaterJour(entier(borne.debut, borne.fin)),
        serie_id: serie.id,
        emplacement_id: alea() < 0.5 ? borne.emplacementId : null,
      });
    } else {
      evenements.push({
        id,
        type: choisir(TYPES_SUR_EMPLACEMENT),
        date: formaterJour(entier(premierJour, dernierJour)),
        serie_id: null,
        emplacement_id: choisir(emplacements).id,
      });
    }
  }

  return { familles, zones, emplacements, saisons, series, occupations, evenements };
}
