/**
 * T35a — la disposition des rangs lue à l'import d'un fichier de cultures arrive dans la densité
 * de l'itinéraire créé (docs/backlog/T35a-schema-rangs.md). Quinconce → `disposition:
 * 'quinconce'` ; alignés ou cellule vide → densité sans clé `disposition` (alignée par défaut).
 * Moteur de l'écran (./preparation.ts, donc ./construction.ts), sans DOM ni base.
 */
import { proposerCorrespondance } from '@planif/core';
import { describe, expect, it } from 'vitest';
import { COLONNES } from './construction.ts';
import { MoteurImport } from './preparation.ts';
import type { ContexteBase, DemandePreparation } from './types.ts';

const id = (n: number): string => `0192f0c1-35a0-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = id(1);

const CONTEXTE: ContexteBase = {
  fermeId: FERME,
  zones: [],
  emplacements: [],
  especes: [
    { id: id(10), nom: 'Tomate', familleId: null },
    { id: id(11), nom: 'Poireau', familleId: null },
    { id: id(12), nom: 'Laitue', familleId: null },
  ],
  familles: [],
  varietes: [],
  itineraires: [],
  saisons: [],
  series: [],
  assolements: [],
};

function densitesImportees(csv: string): Readonly<Record<string, unknown>> {
  const moteur = new MoteurImport();
  const lu = moteur.lireOctets('cultures.csv', new TextEncoder().encode(csv));
  if (!lu.ok) throw new Error(lu.message);
  const demande: DemandePreparation = {
    correspondance: proposerCorrespondance(lu.analyse.entetes, 'cultures'),
    anneeSaison: null,
    choix: [],
    zoneParDefaut: null,
    contexte: CONTEXTE,
    maintenant: '2026-10-09T08:00:00.000Z',
    nomFichier: 'cultures.csv',
    attributsEspeces: {},
    plafondValeurs: 2000,
  };
  const r = moteur.preparer(demande);
  if (r.sorte !== 'apercu') throw new Error(`aperçu attendu, reçu ${r.sorte}`);
  expect(r.apercu.erreurs, JSON.stringify(r.apercu.lignes)).toBe(0);
  const colonnes = COLONNES.itineraire ?? [];
  const densites: Record<string, unknown> = {};
  for (let i = 0; i < r.apercu.lots; i++) {
    for (const o of moteur.lot(i)) {
      if (!o.sql.startsWith('INSERT INTO itineraire ')) continue;
      const valeur = (c: string): unknown => o.parametres?.[colonnes.indexOf(c)];
      const espece = CONTEXTE.especes.find((e) => e.id === valeur('espece_id'))?.nom ?? '?';
      densites[espece] = (JSON.parse(String(valeur('parametres'))) as { densite?: unknown }).densite;
    }
  }
  return densites;
}

describe('T35a : import des cultures, disposition des rangs dans l’itinéraire créé', () => {
  it('quinconce écrit ; alignés et vide → densité sans clé disposition', () => {
    const d = densitesImportees(
      [
        'Culture;Mode;Jours avant récolte;Fenêtre de récolte;Rangs;Écartement (cm);Disposition des rangs',
        'Tomate;plant acheté;60;90;2;50;En quinconce',
        'Poireau;plant acheté;120;60;3;15;alignés',
        'Laitue;plant acheté;45;21;3;30;',
      ].join('\n'),
    );
    expect(d.Tomate).toStrictEqual({ facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 50, disposition: 'quinconce' });
    expect(d.Poireau).toStrictEqual({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 15 });
    expect(d.Laitue).toStrictEqual({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 });
  });
});
