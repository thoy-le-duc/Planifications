/**
 * Tests d'acceptation T35a — import et export de la disposition des rangs (alignés ou en
 * quinconce) d'un itinéraire (docs/backlog/T35a-schema-rangs.md).
 *
 * ── API attendue ─────────────────────────────────────────────────────────────────────────────
 *
 * Import (T14), contenu « cultures » : un nouveau champ facultatif `disposition` (CleChamp de
 *   ./types.ts), libellé « Disposition des rangs » dans CHAMPS_IMPORT.cultures.
 *   - En-têtes reconnus : au moins « Disposition » et « Disposition des rangs ».
 *   - Valeurs (champ à choix, casse et accents ignorés comme les autres) : « quinconce »,
 *     « en quinconce » → 'quinconce' ; « alignés », « aligné », « alignée », « alignées »,
 *     « alignee » → 'alignee'. Cellule vide → null (la densité restera sans disposition,
 *     c'est-à-dire alignée). Toute autre valeur → erreur 'valeur_inconnue' sur le champ
 *     'disposition', message en français qui cite les valeurs attendues.
 *
 * Export (T15) : la disposition vit dans `parametres.densite` de l'itinéraire (jsonb) ; elle
 *   sort donc dans la colonne `parametres` d'itineraire.csv et serie.csv (JSON) et dans
 *   ferme.json (JSON décodé), sans colonne nouvelle. Ces tests sont des garde-fous : ils
 *   passent déjà si l'export recopie bien le JSON, et doivent continuer de passer.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { preparerExport } from '../export/index.ts';
import { lireCsv, objetsCsv } from '../export/test/csv.ts';
import { chargerImport, type EntreeImport, type LignePlan, type ModuleImport, type PlanImport } from './test/contrat.ts';
import { BIBLIOTHEQUE } from './test/fixtures.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

/** Lignes d'un petit CSV écrit dans le test (';', UTF-8). */
function csv(texte: string): readonly (readonly string[])[] {
  return texte.split('\n').map((l) => l.split(';'));
}

function plan(texte: string): PlanImport {
  const lignes = csv(texte);
  const ligneEntete = m.detecterEntete(lignes);
  if (ligneEntete === null) throw new Error('en-tête introuvable');
  const correspondance = m.proposerCorrespondance(lignes[ligneEntete] ?? [], 'cultures');
  const entree: EntreeImport = { lignes, ligneEntete, correspondance, bibliotheque: BIBLIOTHEQUE, anneeSaison: null };
  return m.preparerImport(entree);
}

function ligne(p: PlanImport, numero: number): LignePlan {
  const l = p.lignes.find((x) => x.ligne === numero);
  if (l === undefined) throw new Error(`ligne ${String(numero)} absente du plan`);
  return l;
}

describe('T35a : import de la disposition des rangs (contenu « cultures »)', () => {
  it('champ « Disposition des rangs » proposé pour les cultures, facultatif', () => {
    const d = m.CHAMPS_IMPORT.cultures.find((c) => c.cle === 'disposition');
    expect(d, 'champ disposition dans CHAMPS_IMPORT.cultures').toBeDefined();
    expect(d?.libelle).toBe('Disposition des rangs');
    expect(d?.obligatoire).toBe(false);
  });

  it.each(['Disposition', 'Disposition des rangs'])('en-tête « %s » reconnu et associé au champ disposition', (entete) => {
    const c = m.proposerCorrespondance(['Culture', 'Rangs', entete], 'cultures');
    expect(c.colonnes[2]?.champ).toBe('disposition');
  });

  it('« quinconce », « En quinconce », « alignés », « Alignée », vide : lus ; la culture garde ses rangs', () => {
    const p = plan('Culture;Rangs;Écartement (cm);Disposition\nTomate;2;50;quinconce\nPoireau;3;15;En quinconce\nLaitue;3;30;alignés\nChou;2;40;Alignée\nCarotte;4;5;');
    expect(p.resume.erreurs).toBe(0);
    expect([2, 3, 4, 5, 6].map((n) => ligne(p, n).valeurs.disposition)).toStrictEqual(['quinconce', 'quinconce', 'alignee', 'alignee', null]);
    expect(ligne(p, 2).valeurs).toMatchObject({ rangs_par_planche: 2, ecartement_cm: 50, disposition: 'quinconce' });
  });

  it('valeur inconnue (« zigzag ») : erreur valeur_inconnue sur la disposition, message en français', () => {
    const p = plan('Culture;Rangs;Disposition\nTomate;2;zigzag');
    const l = ligne(p, 2);
    expect(l.statut).toBe('erreur');
    expect(l.erreurs.map((e) => [e.code, e.champ])).toStrictEqual([['valeur_inconnue', 'disposition']]);
    expect(l.erreurs[0]?.message).toMatch(/quinconce/i);
    expect(l.erreurs[0]?.message).toMatch(/align/i);
  });

  it('jamais une propriété héritée : « constructor » → valeur_inconnue', () => {
    const l = ligne(plan('Culture;Disposition\nTomate;constructor'), 2);
    expect(l.erreurs.map((e) => [e.code, e.champ])).toStrictEqual([['valeur_inconnue', 'disposition']]);
  });
});

describe('T35a : export de la disposition (aller-retour du JSON des paramètres)', () => {
  const FERME = '0192f0c1-7a6e-7cc3-a000-000000000000';
  const h = { cree_le: '2026-10-09T06:00:00.000Z', modifie_le: '2026-10-09T06:00:00.000Z', supprime_le: null };
  const base = { mode: 'plant_achete', dureeAvantRecolteJours: 60, fenetreRecolteJours: 90, margeSecurite: 10 };
  const densites = [
    { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50, disposition: 'quinconce' },
    { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50, disposition: 'alignee' },
    { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50 },
  ];
  const itineraires = densites.map((densite, k) => ({
    id: `0192f0c1-7a6e-7cc3-a000-00000000010${String(k)}`,
    ferme_id: FERME,
    espece_id: '0192f0c1-7a6e-7cc3-a000-000000000201',
    variete_id: null,
    nom: `Tomate ${String(k)}`,
    mode: 'plant_achete',
    parametres: JSON.stringify({ ...base, densite }),
    ...h,
  }));
  const fichiers = (): { chemin: string; contenu: string }[] => preparerExport({ fermeId: FERME, genereLe: '2026-10-09T07:00:00.000Z', tables: { itineraire: itineraires } }).fichiers;

  it('itineraire.csv : la colonne parametres relue rend la densité exacte (quinconce, alignee, sans disposition)', () => {
    const texte = fichiers().find((f) => f.chemin === 'itineraire.csv')?.contenu ?? '';
    const lues = objetsCsv(lireCsv(texte));
    expect(lues).toHaveLength(3);
    expect(lues.map((l) => (JSON.parse(l.parametres ?? '{}') as { densite?: unknown }).densite)).toStrictEqual(densites);
  });

  it('ferme.json : la densité décodée garde la disposition', () => {
    const texte = fichiers().find((f) => f.chemin === 'ferme.json')?.contenu ?? '';
    expect(texte).toContain('"disposition":"quinconce"');
    expect(texte).toContain('"disposition":"alignee"');
    const occurrences = texte.split('"disposition"').length - 1;
    expect(occurrences, 'aucune disposition ajoutée à la densité qui n’en a pas').toBe(2);
  });
});
