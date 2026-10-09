/**
 * T14f — l'import reconnaît une planche par sa zone et son code (docs/backlog/T14f-import-codes-par-zone.md),
 * comme le serveur depuis T10t (Q27 : code unique par zone, `lower(trim(code))`, index
 * emplacement_zone_code_actif_idx de la migration 0029 ; planche retirée hors du compte).
 *
 * Moteur de l'écran (./preparation.ts, donc ./construction.ts), sans DOM ni base : un contexte de
 * ferme écrit à la main, des fichiers CSV courts, et les ordres d'écriture rendus par le moteur.
 *
 * Contrat fixé par le testeur :
 *   - `EmplacementConnu.zoneId` (zone de la planche, la plus basse : sous-zone s'il y en a une) ;
 *     les emplacements du contexte sont typés ici avec ce champ en plus, pour compiler avant et
 *     après son ajout à ./types.ts.
 *   - le contexte ne contient que les planches en service (`actif_au` nul, comme le serveur) :
 *     voir ./contexte-base.test.ts pour la planche retirée.
 *   - un fichier de séries peut avoir une colonne « Zone » (champ `zone` des séries, cœur).
 *   - messages : « Code ambigu : « P3 » existe dans plusieurs zones. Ajoutez la zone. » ; un code
 *     absent de la zone donnée est une erreur qui nomme la zone et le code.
 */
import { proposerCorrespondance, type TypeContenu } from '@planif/core';
import { describe, expect, it } from 'vitest';
import { COLONNES } from './construction.ts';
import { MoteurImport } from './preparation.ts';
import type { ContexteBase, DemandePreparation, EmplacementConnu, LigneApercu } from './types.ts';

const id = (n: number): string => `0192f0c1-14f0-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = id(1);

const ZONE = { tunnel1: id(0x10), tunnel2: id(0x11), champ: id(0x12) } as const;
/** P3 dans les deux tunnels ; P4 et P5 dans le Tunnel 1 seulement ; « p 3 » (espace au milieu) au champ. */
const PLANCHE = { p3t1: id(0x20), p3t2: id(0x21), p4t1: id(0x22), p5t1: id(0x23) } as const;
const FAMILLE_SOLANACEES = id(0x30);
const ESPECE = { laitue: id(0x40), tomate: id(0x41) } as const;

const planche = (pid: string, zoneId: string, code: string): EmplacementConnu & { readonly zoneId: string } => ({ id: pid, zoneId, code, sorte: 'planche', longueurM: 30, nombrePlaces: null });

const EMPLACEMENTS: readonly (EmplacementConnu & { readonly zoneId: string })[] = [
  planche(PLANCHE.p3t1, ZONE.tunnel1, 'P3'),
  planche(PLANCHE.p3t2, ZONE.tunnel2, 'P3'),
  planche(PLANCHE.p4t1, ZONE.tunnel1, 'P4'),
  // La nouvelle P5 : l'ancienne (retirée, actif_au renseigné) n'est pas dans le contexte, comme
  // côté serveur (T10t, décision D). Voir ./contexte-base.test.ts.
  planche(PLANCHE.p5t1, ZONE.tunnel1, 'P5'),
];

const CONTEXTE: ContexteBase = {
  fermeId: FERME,
  zones: [
    { id: ZONE.tunnel1, nom: 'Tunnel 1', parenteId: null },
    { id: ZONE.tunnel2, nom: 'Tunnel 2', parenteId: null },
    { id: ZONE.champ, nom: 'Plein champ', parenteId: null },
  ],
  emplacements: EMPLACEMENTS,
  especes: [
    { id: ESPECE.laitue, nom: 'Laitue', familleId: null },
    { id: ESPECE.tomate, nom: 'Tomate', familleId: FAMILLE_SOLANACEES },
  ],
  familles: [{ id: FAMILLE_SOLANACEES, nom: 'Solanacées' }],
  varietes: [],
  itineraires: [],
  saisons: [],
  series: [],
  assolements: [],
};

interface Resultat {
  readonly valides: number;
  readonly erreurs: number;
  readonly doublons: number;
  readonly lignes: readonly LigneApercu[];
  /** Lignes insérées, par table, colonne → valeur. */
  readonly inserees: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

function importer(type: TypeContenu, lignes: readonly (readonly string[])[]): Resultat {
  const moteur = new MoteurImport();
  const lu = moteur.lireOctets(`${type}.csv`, new TextEncoder().encode(lignes.map((l) => l.join(';')).join('\n')));
  if (!lu.ok) throw new Error(lu.message);
  const demande: DemandePreparation = {
    correspondance: proposerCorrespondance(lu.analyse.entetes, type),
    anneeSaison: 2027,
    choix: [],
    zoneParDefaut: null,
    contexte: CONTEXTE,
    maintenant: '2027-01-15T08:00:00.000Z',
    nomFichier: `${type}.csv`,
    attributsEspeces: {},
    plafondValeurs: 2000,
  };
  const r = moteur.preparer(demande);
  if (r.sorte !== 'apercu') throw new Error(`aperçu attendu, reçu ${r.sorte}`);
  const inserees: Record<string, Record<string, unknown>[]> = {};
  for (let i = 0; i < r.apercu.lots; i++) {
    for (const o of moteur.lot(i)) {
      const m = /^INSERT INTO (\w+) /.exec(o.sql);
      const table = m?.[1];
      if (table === undefined) continue;
      const colonnes = COLONNES[table] ?? [];
      (inserees[table] ??= []).push(Object.fromEntries(colonnes.map((c, k) => [c, o.parametres?.[k]])));
    }
  }
  return { valides: r.apercu.valides, erreurs: r.apercu.erreurs, doublons: r.apercu.doublons, lignes: r.apercu.lignes, inserees };
}

const ligne = (r: Resultat, n: number): LigneApercu | undefined => r.lignes.find((l) => l.ligne === n);
const messages = (r: Resultat, n: number): string => (ligne(r, n)?.erreurs ?? []).map((e) => e.message).join(' | ');
const detail = (r: Resultat): string => JSON.stringify(r.lignes);

const ENTETE_SERIES = ['Culture', 'Zone', 'Planche', 'Plantation', 'Début récolte', 'Fin récolte', 'Longueur (m)'];
const serie = (zone: string, code: string, plantation = '2027-04-05'): string[] => ['Laitue', zone, code, plantation, '2027-05-20', '2027-06-10', '20'];
const occupations = (r: Resultat): unknown[] => (r.inserees.occupation ?? []).map((o) => o.emplacement_id);

// ── Parcellaire ──────────────────────────────────────────────────────────────────────────────

describe('T14f : parcellaire, le code est comparé dans sa zone', () => {
  it('ferme avec « P3 » au Tunnel 1 et au Tunnel 2 : P3 / Tunnel 2 est déjà dans la ferme ; P3 / Plein champ et P4 / Tunnel 2 sont créées, sans fausse alerte', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 2', 'P3', '30'],
      ['Plein champ', 'P3', '30'],
      ['Tunnel 2', 'P4', '25'],
    ]);
    // P3 existe déjà dans le Tunnel 2 : doublon contre la base (même zone, même code).
    expect(ligne(r, 2)?.statut, detail(r)).toBe('doublon');
    // P3 au Plein champ et P4 au Tunnel 2 : codes repris d'autres zones, planches légitimes.
    expect(ligne(r, 3)?.statut, detail(r)).not.toBe('doublon');
    expect(ligne(r, 4)?.statut, detail(r)).not.toBe('doublon');
    expect(r.valides, detail(r)).toBe(2);
    const creees = (r.inserees.emplacement ?? []).map((e) => [e.zone_id, e.code]);
    expect(creees).toStrictEqual([
      [ZONE.champ, 'P3'],
      [ZONE.tunnel2, 'P4'],
    ]);
  });

  it('un même code dans deux zones du fichier : deux planches, sans doublon', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 3', 'P7', '30'],
      ['Tunnel 4', 'P7', '30'],
    ]);
    expect(r.doublons, detail(r)).toBe(0);
    expect(r.valides, detail(r)).toBe(2);
    expect(r.inserees.emplacement ?? []).toHaveLength(2);
  });

  it('« p8 » et « P8 » (espaces autour) dans la même zone du fichier → doublon de la première', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 3', 'p8', '30'],
      ['Tunnel 3', '  P8  ', '30'],
    ]);
    expect(ligne(r, 3)?.statut, detail(r)).toBe('doublon');
    expect(ligne(r, 3)?.doublonDe).toBe(2);
    expect(r.inserees.emplacement ?? []).toHaveLength(1);
  });

  it('« p3 » (casse) et espaces autour contre la base : même planche que « P3 » du Tunnel 1 → doublon', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 1', '  p3 ', '30'],
    ]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('doublon');
    expect(r.inserees.emplacement ?? []).toHaveLength(0);
  });

  it('normalisation de T10t (sans casse, sans espaces autour) : « P-3 » et « P 3 » sont deux codes distincts', () => {
    const r = importer('parcellaire', [
      ['Zone', 'Planche', 'Longueur (m)'],
      ['Tunnel 3', 'P-3', '30'],
      ['Tunnel 3', 'P 3', '30'],
      ['Tunnel 3', 'P.3', '30'],
    ]);
    expect(r.doublons, detail(r)).toBe(0);
    expect((r.inserees.emplacement ?? []).map((e) => e.code)).toStrictEqual(['P-3', 'P 3', 'P.3']);
  });
});

// ── Séries ───────────────────────────────────────────────────────────────────────────────────

describe('T14f : séries, la planche désignée est celle de la zone + code', () => {
  it('« P3 / Tunnel 2 » désigne la planche du Tunnel 2, jamais la première « P3 » trouvée', () => {
    const r = importer('series', [ENTETE_SERIES, serie('Tunnel 2', 'P3')]);
    expect(r.erreurs, detail(r)).toBe(0);
    expect(occupations(r)).toStrictEqual([PLANCHE.p3t2]);
  });

  it('la même série sur P3 / Tunnel 1 et P3 / Tunnel 2 : deux planches, pas un doublon', () => {
    const r = importer('series', [ENTETE_SERIES, serie('Tunnel 1', 'P3'), serie('Tunnel 2', 'P3')]);
    expect(r.doublons, detail(r)).toBe(0);
    expect(r.valides, detail(r)).toBe(2);
    expect(occupations(r)).toStrictEqual([PLANCHE.p3t1, PLANCHE.p3t2]);
  });

  it('zone et code sans casse ni espaces autour : « tunnel 2 » / « p3 » → la P3 du Tunnel 2', () => {
    const r = importer('series', [ENTETE_SERIES, serie(' tunnel 2 ', ' p3 ')]);
    expect(r.erreurs, detail(r)).toBe(0);
    expect(occupations(r)).toStrictEqual([PLANCHE.p3t2]);
  });

  it('code sans zone présent dans deux zones → ligne refusée « Code ambigu », qui nomme le code et propose d’ajouter la zone', () => {
    const r = importer('series', [ENTETE_SERIES, serie('', 'P3'), serie('', 'P4')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    const m = messages(r, 2);
    expect(m).toContain('Code ambigu');
    expect(m).toContain('« P3 »');
    expect(m).toMatch(/ajoutez la zone/i);
    expect(ligne(r, 2)?.erreurs[0]?.cellule).toBe('P3');
    // Jamais de choix silencieux : rien d'écrit pour la ligne 2.
    expect(occupations(r)).toStrictEqual([PLANCHE.p4t1]);
  });

  it('fichier sans colonne Zone : code présent dans une seule zone → désigné ; dans deux → « Code ambigu »', () => {
    const r = importer('series', [
      ['Culture', 'Planche', 'Plantation', 'Début récolte', 'Fin récolte', 'Longueur (m)'],
      ['Laitue', 'P4', '2027-04-05', '2027-05-20', '2027-06-10', '20'],
      ['Laitue', 'P3', '2027-04-05', '2027-05-20', '2027-06-10', '20'],
    ]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(ligne(r, 3)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 3)).toContain('Code ambigu');
    expect(messages(r, 3)).toContain('« P3 »');
    expect(occupations(r)).toStrictEqual([PLANCHE.p4t1]);
  });

  it('planche retirée remplacée par une nouvelle « P5 » dans la même zone : « P5 » sans zone désigne la nouvelle, sans ambiguïté', () => {
    const r = importer('series', [ENTETE_SERIES, serie('', 'P5'), serie('Tunnel 1', 'P5', '2027-04-12')]);
    expect(r.erreurs, detail(r)).toBe(0);
    expect(occupations(r)).toStrictEqual([PLANCHE.p5t1, PLANCHE.p5t1]);
  });

  it('zone + code absent de cette zone → erreur qui nomme la zone et le code (une série ne crée pas de planche)', () => {
    const r = importer('series', [ENTETE_SERIES, serie('Tunnel 2', 'P4')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    const m = messages(r, 2);
    expect(m).toContain('Tunnel 2');
    expect(m).toContain('P4');
    expect(occupations(r)).toStrictEqual([]);
  });

  it('zone inconnue de la ferme → erreur qui nomme la zone', () => {
    const r = importer('series', [ENTETE_SERIES, serie('Tunnel 9', 'P3')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toContain('Tunnel 9');
    expect(occupations(r)).toStrictEqual([]);
  });
});

// ── Assolement ───────────────────────────────────────────────────────────────────────────────

describe('T14f : assolement, la planche désignée est celle de la zone + code', () => {
  const ENTETE = ['Année', 'Zone', 'Planche', 'Famille botanique', 'Culture'];
  const emplacementsEcrits = (r: Resultat): unknown[] => (r.inserees.assolement ?? []).map((a) => a.emplacement_id);

  it('« 2025 / Tunnel 2 / P3 » → assolement sur la P3 du Tunnel 2 ; la même ligne au Tunnel 1 n’est pas un doublon', () => {
    const r = importer('assolement', [ENTETE, ['2025', 'Tunnel 2', 'P3', 'Solanacées', 'Tomate'], ['2025', 'Tunnel 1', 'P3', 'Solanacées', 'Tomate']]);
    expect(r.erreurs, detail(r)).toBe(0);
    expect(r.doublons, detail(r)).toBe(0);
    expect(emplacementsEcrits(r)).toStrictEqual([PLANCHE.p3t2, PLANCHE.p3t1]);
  });

  it('code sans zone présent dans deux zones → « Code ambigu » ; dans une seule → désigné', () => {
    const r = importer('assolement', [ENTETE, ['2025', '', 'P3', 'Solanacées', 'Tomate'], ['2025', '', 'P4', 'Solanacées', 'Tomate']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toContain('Code ambigu');
    expect(messages(r, 2)).toContain('« P3 »');
    expect(emplacementsEcrits(r)).toStrictEqual([PLANCHE.p4t1]);
  });

  it('zone + code absent de cette zone → erreur qui nomme la zone', () => {
    const r = importer('assolement', [ENTETE, ['2025', 'Tunnel 2', 'P5', 'Solanacées', 'Tomate']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toContain('Tunnel 2');
    expect(messages(r, 2)).toContain('P5');
    expect(r.inserees.assolement ?? []).toHaveLength(0);
  });
});
