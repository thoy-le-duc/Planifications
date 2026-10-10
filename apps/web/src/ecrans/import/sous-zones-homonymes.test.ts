/**
 * T14g — sous-zones homonymes sous deux zones différentes (docs/backlog/T14g-sous-zones-homonymes.md).
 *
 * Un nom de zone ou de sous-zone donné seul, qui désigne plusieurs zones de la ferme, refuse la
 * ligne : « Zone ambiguë : « Chapelle A » existe dans Tunnel 1 et Tunnel 2. Ajoutez la zone
 * parente. » Jamais de choix silencieux, même règle que « Code ambigu » (T14f).
 *
 * Contrat fixé par le testeur :
 *   - parentes énumérées dans l'ordre du contexte : « A et B », « A, B et C » ;
 *   - une zone de premier niveau du même nom qu'une sous-zone reste désignée par la colonne
 *     « Zone » seule (correspondance exacte : la colonne Zone nomme une zone de premier niveau ;
 *     la sous-zone se désigne par « parente / sous-zone ») — sans quoi la zone de premier niveau
 *     ne pourrait plus du tout être désignée ;
 *   - deux zones de premier niveau du même nom, ou deux sous-zones du même nom sous la même
 *     parente : refus aussi (« plusieurs zones de premier niveau », « plusieurs sous-zones de … »).
 */
import { proposerCorrespondance, type TypeContenu } from '@planif/core';
import { describe, expect, it } from 'vitest';
import { COLONNES } from './construction.ts';
import { MoteurImport } from './preparation.ts';
import type { ContexteBase, DemandePreparation, LigneApercu } from './types.ts';

const id = (n: number): string => `0192f0c1-14f7-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = id(1);
const ZONE = {
  tunnel1: id(0x10),
  tunnel2: id(0x11),
  tunnel3: id(0x12),
  chapelleAt1: id(0x13),
  chapelleAt2: id(0x14),
  chapelleBt1: id(0x15),
  chapelleBt2: id(0x16),
  chapelleBt3: id(0x17),
  chapelleC: id(0x18),
  serreNord: id(0x19),
  serreNordT1: id(0x1a),
  abri1: id(0x1b),
  abri2: id(0x1c),
  chapelleD1: id(0x1d),
  chapelleD2: id(0x1e),
} as const;
const PLANCHE = { p7a: id(0x20), p7b: id(0x21), p8a: id(0x22), p8b: id(0x23) } as const;
const FAMILLE_SOLANACEES = id(0x30);
const ESPECE_TOMATE = id(0x40);

const CONTEXTE: ContexteBase = {
  fermeId: FERME,
  zones: [
    { id: ZONE.tunnel1, nom: 'Tunnel 1', parenteId: null },
    { id: ZONE.tunnel2, nom: 'Tunnel 2', parenteId: null },
    { id: ZONE.tunnel3, nom: 'Tunnel 3', parenteId: null },
    { id: ZONE.chapelleAt1, nom: 'Chapelle A', parenteId: ZONE.tunnel1 },
    { id: ZONE.chapelleAt2, nom: 'Chapelle A', parenteId: ZONE.tunnel2 },
    { id: ZONE.chapelleBt1, nom: 'Chapelle B', parenteId: ZONE.tunnel1 },
    { id: ZONE.chapelleBt2, nom: 'chapelle b', parenteId: ZONE.tunnel2 },
    { id: ZONE.chapelleBt3, nom: ' Chapelle B ', parenteId: ZONE.tunnel3 },
    { id: ZONE.chapelleC, nom: 'Chapelle C', parenteId: ZONE.tunnel3 },
    { id: ZONE.serreNord, nom: 'Serre Nord', parenteId: null },
    { id: ZONE.serreNordT1, nom: 'Serre Nord', parenteId: ZONE.tunnel1 },
    { id: ZONE.abri1, nom: 'Abri', parenteId: null },
    { id: ZONE.abri2, nom: 'Abri', parenteId: null },
    // Deux « Chapelle D » sous le même Tunnel 3 (aucun index du serveur ne l'interdit).
    { id: ZONE.chapelleD1, nom: 'Chapelle D', parenteId: ZONE.tunnel3 },
    { id: ZONE.chapelleD2, nom: 'Chapelle D', parenteId: ZONE.tunnel3 },
  ],
  emplacements: [
    // P7 dans les deux « Chapelle A » (homonymes) ; P8 dans deux sous-zones du Tunnel 1.
    { id: PLANCHE.p7a, zoneId: ZONE.chapelleAt1, code: 'P7', sorte: 'planche', longueurM: 30, nombrePlaces: null },
    { id: PLANCHE.p7b, zoneId: ZONE.chapelleAt2, code: 'P7', sorte: 'planche', longueurM: 30, nombrePlaces: null },
    { id: PLANCHE.p8a, zoneId: ZONE.chapelleAt1, code: 'P8', sorte: 'planche', longueurM: 30, nombrePlaces: null },
    { id: PLANCHE.p8b, zoneId: ZONE.chapelleBt1, code: 'P8', sorte: 'planche', longueurM: 30, nombrePlaces: null },
  ],
  especes: [{ id: ESPECE_TOMATE, nom: 'Tomate', familleId: FAMILLE_SOLANACEES }],
  familles: [{ id: FAMILLE_SOLANACEES, nom: 'Solanacées' }],
  varietes: [],
  itineraires: [],
  saisons: [],
  series: [],
  assolements: [],
};

interface Resultat {
  readonly lignes: readonly LigneApercu[];
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
      const table = /^INSERT INTO (\w+) /.exec(o.sql)?.[1];
      if (table === undefined) continue;
      const colonnes = COLONNES[table] ?? [];
      (inserees[table] ??= []).push(Object.fromEntries(colonnes.map((c, k) => [c, o.parametres?.[k]])));
    }
  }
  return { lignes: r.apercu.lignes, inserees };
}

const ligne = (r: Resultat, n: number): LigneApercu | undefined => r.lignes.find((l) => l.ligne === n);
const messages = (r: Resultat, n: number): string => (ligne(r, n)?.erreurs ?? []).map((e) => e.message).join(' | ');
const detail = (r: Resultat): string => JSON.stringify(r.lignes);
const PARCELLAIRE = ['Zone', 'Sous-zone', 'Planche', 'Longueur (m)'];
const zonesEcrites = (r: Resultat): unknown[] => (r.inserees.emplacement ?? []).map((e) => e.zone_id);

describe('T14g : parcellaire, sous-zone homonyme donnée seule', () => {
  it('« Chapelle A / – / P9 », Chapelle A sous Tunnel 1 et Tunnel 2 → refusée, message qui nomme les deux parentes', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Chapelle A', '', 'P9', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « Chapelle A » existe dans Tunnel 1 et Tunnel 2. Ajoutez la zone parente.');
    expect(r.inserees.emplacement ?? []).toHaveLength(0);
    expect(r.inserees.zone ?? []).toHaveLength(0);
  });

  it('même normalisation qu’aujourd’hui : « chapelle a » en minuscules est aussi refusée, avec le nom tel qu’écrit', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['  chapelle a ', '', 'P9', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « chapelle a » existe dans Tunnel 1 et Tunnel 2. Ajoutez la zone parente.');
  });

  it('ligne de zone sans planche (« Chapelle A / – / – ») : refusée aussi, jamais comptée comme doublon', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Chapelle A', '', '', '']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « Chapelle A » existe dans Tunnel 1 et Tunnel 2. Ajoutez la zone parente.');
  });

  it('trois parentes : énumération « Tunnel 1, Tunnel 2 et Tunnel 3 »', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Chapelle B', '', 'P1', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « Chapelle B » existe dans Tunnel 1, Tunnel 2 et Tunnel 3. Ajoutez la zone parente.');
    expect(r.inserees.emplacement ?? []).toHaveLength(0);
  });

  it('deux sous-zones du même nom sous la même parente : refus qui ne répète pas la parente', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Chapelle D', '', 'P1', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « Chapelle D » désigne plusieurs sous-zones de Tunnel 3. Renommez l’une d’elles dans le parcellaire.');
  });

  it('« Tunnel 2 / Chapelle A / P9 » → désignée dans la Chapelle A du Tunnel 2, aucune zone créée', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Tunnel 2', 'Chapelle A', 'P9', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(zonesEcrites(r)).toStrictEqual([ZONE.chapelleAt2]);
    expect(r.inserees.zone ?? []).toHaveLength(0);
  });

  it('« Tunnel 1 / Chapelle A / P9 » et « Tunnel 2 / Chapelle A / P9 » : deux planches distinctes, pas de doublon', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Tunnel 1', 'Chapelle A', 'P9', '30'], ['Tunnel 2', 'Chapelle A', 'P9', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(ligne(r, 3)?.statut, detail(r)).toBe('valide');
    expect(zonesEcrites(r)).toStrictEqual([ZONE.chapelleAt1, ZONE.chapelleAt2]);
  });

  it('nom unique : « Chapelle C / – / P9 » → désignée dans la Chapelle C du Tunnel 3, comme avant', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Chapelle C', '', 'P9', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(zonesEcrites(r)).toStrictEqual([ZONE.chapelleC]);
    expect(r.inserees.zone ?? []).toHaveLength(0);
  });
});

describe('T14g : zone de premier niveau homonyme d’une sous-zone', () => {
  it('« Serre Nord / – / P1 » → la zone de premier niveau Serre Nord (correspondance exacte), comme avant', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Serre Nord', '', 'P1', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(zonesEcrites(r)).toStrictEqual([ZONE.serreNord]);
  });

  it('« Tunnel 1 / Serre Nord / P1 » → la sous-zone Serre Nord du Tunnel 1', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Tunnel 1', 'Serre Nord', 'P1', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(zonesEcrites(r)).toStrictEqual([ZONE.serreNordT1]);
  });

  it('deux zones de premier niveau du même nom : refus, jamais la première prise', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Abri', '', 'P1', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « Abri » désigne plusieurs zones de premier niveau. Renommez l’une d’elles dans le parcellaire.');
    expect(r.inserees.emplacement ?? []).toHaveLength(0);
  });
});

describe('T14g : assolement par zone, même règle', () => {
  const ENTETE = ['Année', 'Zone', 'Planche', 'Famille botanique', 'Culture'];
  const zonesAssolees = (r: Resultat): unknown[] => (r.inserees.assolement ?? []).map((a) => a.zone_id);

  it('« 2025 / Chapelle A / – » → refusée, message qui nomme les deux parentes', () => {
    const r = importer('assolement', [ENTETE, ['2025', 'Chapelle A', '', 'Solanacées', 'Tomate']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « Chapelle A » existe dans Tunnel 1 et Tunnel 2. Ajoutez la zone parente.');
    expect(r.inserees.assolement ?? []).toHaveLength(0);
  });

  it('nom unique « Chapelle C » → assolement sur la Chapelle C ; « Serre Nord » → la zone de premier niveau', () => {
    const r = importer('assolement', [ENTETE, ['2025', 'Chapelle C', '', 'Solanacées', 'Tomate'], ['2025', 'Serre Nord', '', 'Solanacées', 'Tomate']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(ligne(r, 3)?.statut, detail(r)).toBe('valide');
    expect(zonesAssolees(r)).toStrictEqual([ZONE.chapelleC, ZONE.serreNord]);
  });
});

describe('T14g, relecture : deux sous-zones du même nom sous la même parente, parente donnée', () => {
  const MESSAGE = 'Zone ambiguë : « Chapelle D » existe plusieurs fois dans Tunnel 3. Renommez l’une d’elles dans le parcellaire.';

  it('« Tunnel 3 / Chapelle D / P1 » → refusée (colonne Zone), jamais la dernière prise', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Tunnel 3', 'Chapelle D', 'P1', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe(MESSAGE);
    expect(ligne(r, 2)?.erreurs[0]?.cellule).toBe('Tunnel 3');
    expect(r.inserees.emplacement ?? []).toHaveLength(0);
  });

  it('« Tunnel 3 / chapelle d / – » (ligne de zone) → refusée aussi, pas un doublon', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Tunnel 3', 'chapelle d', '', '']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Zone ambiguë : « chapelle d » existe plusieurs fois dans Tunnel 3. Renommez l’une d’elles dans le parcellaire.');
  });

  it('pas de faux refus quand l’import crée lui-même la sous-zone : deux lignes « Tunnel 3 / Chapelle E » → une zone, deux planches', () => {
    const r = importer('parcellaire', [PARCELLAIRE, ['Tunnel 3', 'Chapelle E', 'P1', '30'], ['Tunnel 3', 'chapelle e', 'P2', '30'], ['Tunnel 9', 'Chapelle E', 'P1', '30']]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect(ligne(r, 3)?.statut, detail(r)).toBe('valide');
    expect(ligne(r, 4)?.statut, detail(r)).toBe('valide');
    expect((r.inserees.zone ?? []).map((z) => String(z.nom)).sort()).toStrictEqual(['Chapelle E', 'Chapelle E', 'Tunnel 9']);
    expect(r.inserees.emplacement ?? []).toHaveLength(3);
  });
});

describe('T14g, relecture : « Code ambigu » aux séries quand la zone donnée a des homonymes', () => {
  const SERIE = ['Culture', 'Zone', 'Planche', 'Plantation', 'Début récolte', 'Fin récolte', 'Longueur (m)'];
  const serie = (zone: string, code: string): string[] => ['Tomate', zone, code, '2027-04-05', '2027-05-20', '2027-06-10', '20'];

  it('« Chapelle A / P7 », P7 dans les deux Chapelle A → refus qui parle de zones homonymes, pas de sous-zones', () => {
    const r = importer('series', [SERIE, serie('Chapelle A', 'P7')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Code ambigu : « P7 » existe dans plusieurs zones nommées « Chapelle A ». Indiquez plutôt la zone parente dans la colonne Zone.');
    expect(r.inserees.occupation ?? []).toHaveLength(0);
  });

  it('« Tunnel 2 / P7 » → la P7 de la Chapelle A du Tunnel 2', () => {
    const r = importer('series', [SERIE, serie('Tunnel 2', 'P7')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('valide');
    expect((r.inserees.occupation ?? []).map((o) => o.emplacement_id)).toStrictEqual([PLANCHE.p7b]);
  });

  it('« Tunnel 1 / P8 », P8 dans deux sous-zones du Tunnel 1 → le message des sous-zones reste', () => {
    const r = importer('series', [SERIE, serie('Tunnel 1', 'P8')]);
    expect(ligne(r, 2)?.statut, detail(r)).toBe('erreur');
    expect(messages(r, 2)).toBe('Code ambigu : « P8 » existe dans plusieurs sous-zones de « Tunnel 1 ». Précisez la sous-zone dans la colonne Zone.');
  });
});
