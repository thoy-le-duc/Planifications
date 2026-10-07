/**
 * Moteur de l'écran d'import (T14b) : lecture du fichier, analyse, plan d'import et ce qu'il
 * écrirait. Le calcul est celui du moteur de T14 (`@planif/core` : lecture, en-tête, type,
 * correspondance, normalisation, rapprochement, doublons du fichier, avertissements) ; ce module
 * n'ajoute que ce qui demande la base (./construction.ts). Pur, sans PowerSync ni DOM : il tourne
 * dans le Web Worker de préparation (./preparation.worker.ts), ou sur le fil principal quand il
 * n'y a pas de Worker (tests sous happy-dom). Le lecteur Excel n'est JAMAIS chargé ici : la page
 * lit le classeur et envoie ses lignes (`lireFeuille`).
 */
import {
  detecterEntete,
  lireCsv,
  preparerImport,
  proposerType,
  type Cellule,
  type CleChamp,
  type LigneBrute,
  type SystemeDates,
} from '@planif/core';
import type { OrdreEcriture } from '@planif/sync';
import { construire } from './construction.ts';
import { normaliser } from './normaliser.ts';
import type { Analyse, DecisionAffichee, DemandePreparation, FeuilleLue, ResultatLecture, ResultatPreparation } from './types.ts';


const texteDe = (c: Cellule | undefined): string => (c === null || c === undefined ? '' : typeof c === 'number' ? String(c) : c.trim());

/** Deux ou trois valeurs d'exemple par colonne, prises dans les premières lignes de données. */
function exemples(lignes: readonly LigneBrute[], debut: number, largeur: number): string[][] {
  const r: string[][] = Array.from({ length: largeur }, () => []);
  const fin = Math.min(lignes.length, debut + 200);
  for (let i = debut; i < fin; i++) {
    const l = lignes[i] ?? [];
    for (let c = 0; c < largeur; c++) {
      const liste = r[c];
      if (liste === undefined || liste.length >= 3) continue;
      const t = texteDe(l[c]);
      if (t !== '' && !liste.includes(t)) liste.push(t.length > 40 ? `${t.slice(0, 39)}…` : t);
    }
  }
  return r;
}

export class MoteurImport {
  private feuille: { readonly lignes: readonly LigneBrute[]; readonly systemeDates: SystemeDates; readonly ligneEntete: number } | null = null;
  private lots: readonly (readonly OrdreEcriture[])[] = [];

  lireOctets(nomFichier: string, octets: Uint8Array): ResultatLecture {
    const lu = lireCsv(octets);
    if (lu.erreur !== null) return { ok: false, message: lu.erreur.message };
    return this.analyser(nomFichier, 'csv', { lignes: lu.lignes, systemeDates: 1900 });
  }

  lireFeuille(nomFichier: string, feuille: FeuilleLue): ResultatLecture {
    return this.analyser(nomFichier, 'xlsx', feuille);
  }

  private analyser(nomFichier: string, format: 'csv' | 'xlsx', feuille: FeuilleLue): ResultatLecture {
    this.feuille = null;
    this.lots = [];
    const ligneEntete = detecterEntete(feuille.lignes);
    if (ligneEntete === null) {
      return { ok: false, message: 'Aucune ligne d’en-tête trouvée dans ce fichier : la première ligne doit nommer les colonnes (Planche, Culture, Longueur…).' };
    }
    const brutes = feuille.lignes[ligneEntete] ?? [];
    let largeur = brutes.length;
    while (largeur > 0 && texteDe(brutes[largeur - 1]) === '') largeur--;
    const entetes = Array.from({ length: largeur }, (_, i) => texteDe(brutes[i]));
    this.feuille = { lignes: feuille.lignes, systemeDates: feuille.systemeDates, ligneEntete };
    const analyse: Analyse = {
      nomFichier,
      format,
      entetes,
      ligneEntete,
      typePropose: proposerType(brutes),
      lignesDonnees: Math.max(0, feuille.lignes.length - ligneEntete - 1),
      exemples: exemples(feuille.lignes, ligneEntete + 1, largeur),
    };
    return { ok: true, analyse };
  }

  preparer(d: DemandePreparation): ResultatPreparation {
    this.lots = [];
    const f = this.feuille;
    if (f === null) throw new Error('aucun fichier lu');
    const debut = f.ligneEntete + 1;

    // Plafond : au-delà, pas de rapprochement des valeurs (400 000 cultures prenaient 26 s).
    const colonnesReference = d.correspondance.colonnes.flatMap((c, i) => (c.champ === 'espece' || c.champ === 'famille' ? [{ i, champ: c.champ }] : []));
    if (colonnesReference.length > 0) {
      const vues = new Set<string>();
      for (let n = debut; n < f.lignes.length; n++) {
        const l = f.lignes[n] ?? [];
        for (const { i, champ } of colonnesReference) {
          const t = texteDe(l[i]);
          if (t !== '') vues.add(`${champ}\u0001${normaliser(t)}`);
        }
      }
      if (vues.size > d.plafondValeurs) return { sorte: 'plafond', nombre: vues.size };
    }

    // Parcellaire sans colonne de zone : une colonne « Zone » ajoutée au bout, remplie de la zone
    // par défaut sur chaque ligne non vide (le moteur garde toutes ses règles).
    let lignes = f.lignes;
    let correspondance = d.correspondance;
    const sansZone = correspondance.type === 'parcellaire' && !correspondance.colonnes.some((c) => c.champ === 'zone');
    if (sansZone && d.zoneParDefaut !== null && d.zoneParDefaut.trim() !== '') {
      const zone = d.zoneParDefaut.trim();
      let largeur = correspondance.colonnes.length;
      for (const l of f.lignes) largeur = Math.max(largeur, l.length);
      const remplir = (l: LigneBrute, valeur: Cellule): LigneBrute => {
        const copie: Cellule[] = [...l];
        while (copie.length < largeur) copie.push(null);
        copie.push(valeur);
        return copie;
      };
      lignes = f.lignes.map((l, n) => {
        if (n < f.ligneEntete) return l;
        if (n === f.ligneEntete) return remplir(l, 'Zone');
        return l.every((c) => texteDe(c) === '') ? l : remplir(l, zone);
      });
      const colonnes = [...correspondance.colonnes];
      while (colonnes.length < largeur) colonnes.push({ champ: null, unite: null });
      colonnes.push({ champ: 'zone', unite: null });
      correspondance = { type: correspondance.type, colonnes };
    }

    const bibliotheque = {
      especes: d.contexte.especes.map((e) => ({ id: e.id, nom: e.nom })),
      familles: d.contexte.familles.map((x) => ({ id: x.id, nom: x.nom })),
    };
    const plan = preparerImport({
      lignes,
      ligneEntete: f.ligneEntete,
      correspondance,
      bibliotheque,
      anneeSaison: d.anneeSaison,
      choix: d.choix,
      systemeDates: f.systemeDates,
    });
    if (plan.decisions.length > 0) {
      const decisions: DecisionAffichee[] = plan.decisions.map((x) => ({ champ: x.champ, valeur: x.valeur, lignes: x.lignes.length, propositions: x.propositions }));
      return { sorte: 'decisions', decisions };
    }

    // Un modèle garde « Créer » pour une culture qui n'existe pas (ou plus) dans la ferme, sans ses
    // catégorie, pérenne et unité : l'étape « Valeurs » est rouverte pour les demander.
    const connues = new Set(d.contexte.especes.map((x) => normaliser(x.nom)));
    const renseignees = new Set(Object.keys(d.attributsEspeces).map(normaliser));
    const aCreer = new Map<string, { valeur: string; lignes: number }>();
    for (const l of plan.lignes) {
      const v = l.valeurs.espece;
      if (typeof v !== 'object' || v?.sorte !== 'nouvelle') continue;
      const k = normaliser(v.nom);
      if (connues.has(k) || renseignees.has(k)) continue;
      const deja = aCreer.get(k);
      if (deja === undefined) aCreer.set(k, { valeur: v.nom, lignes: 1 });
      else deja.lignes++;
    }
    if (aCreer.size > 0) {
      return { sorte: 'decisions', decisions: [...aCreer.values()].map((x) => ({ champ: 'espece', valeur: x.valeur, lignes: x.lignes, propositions: [], creer: true })) };
    }

    const colonneDe = new Map<CleChamp, number>();
    correspondance.colonnes.forEach((c, i) => {
      if (c.champ !== null && !colonneDe.has(c.champ)) colonneDe.set(c.champ, i);
    });
    const { apercu, lots } = construire(plan, {
      demande: d,
      lignes,
      ligneEntete: f.ligneEntete,
      colonneDe,
    });
    this.lots = lots;
    return { sorte: 'apercu', apercu };
  }

  lot(indice: number): readonly OrdreEcriture[] {
    const l = this.lots[indice];
    if (l === undefined) throw new Error(`lot ${String(indice)} absent`);
    return l;
  }
}
