/**
 * T13 — `preparerSaisie` : la porte prépare un événement (id, ferme, horodatage, auteur) sans
 * l'écrire, pour l'écrire avec d'autres lignes en une transaction (`ecrireEnsemble`).
 */
import { creerGenerateurId, validerSaisie, type DateCalendaire, type Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';

const UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const EMPLACEMENT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b30' as Id<'Emplacement'>;
const SERIE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b40' as Id<'Serie'>;
const MAINTENANT = new Date('2026-10-01T06:00:00.000Z');

let base: BaseMemoire;
let transactions = 0;

beforeEach(() => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  transactions = 0;
});

afterEach(() => {
  base.fermer();
});

function porte() {
  return creerPorte(
    {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: (fn) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: (g, o) => base.onChange(g, o),
    },
    {
      utilisateurId: UTILISATEUR,
      fermeId: FERME,
      maintenant: () => MAINTENANT,
      nouvelId: creerGenerateurId({ horloge: () => MAINTENANT.getTime(), aleatoire: (n) => new Uint8Array(n).fill(7) }),
    },
  );
}

describe('T13 : porte.preparerSaisie', () => {
  it('complète l’événement comme saisirEvenement, sans rien écrire ; l’ordre l’écrit tel quel', async () => {
    const p = porte();
    const prepare = p.preparerSaisie({
      type: 'recolte',
      date: '2026-10-01' as DateCalendaire,
      source: 'tap',
      culture: { sorte: 'serie', serieId: SERIE },
      emplacementIds: [EMPLACEMENT],
      note: null,
      photos: [],
      remplaceEvenement: null,
      detail: { quantite: 12.5, unite: 'kg', categorie: null },
    });
    expect(transactions).toBe(0);
    expect(prepare.ligne).toMatchObject({
      id: prepare.id,
      ferme_id: FERME,
      auteur_id: UTILISATEUR,
      horodatage: MAINTENANT.toISOString(),
      serie_id: SERIE,
      campagne_id: null,
      emplacement_ids: JSON.stringify([EMPLACEMENT]),
      detail: JSON.stringify({ quantite: 12.5, unite: 'kg', categorie: null }),
    });
    expect(validerSaisie(prepare.ligne).ok).toBe(true);

    await p.ecrireEnsemble([prepare.ordre]);
    expect(transactions).toBe(1);
    const lignes = base.lireDirect<Record<string, unknown>>('SELECT * FROM evenement');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject(prepare.ligne);
  });

  it('deux préparations : deux identifiants distincts', () => {
    const p = porte();
    const saisie = {
      type: 'realise',
      date: '2026-10-01' as DateCalendaire,
      source: 'tap',
      culture: { sorte: 'serie', serieId: SERIE },
      emplacementIds: [],
      note: null,
      photos: [],
      remplaceEvenement: null,
      detail: { etape: 'plantation', quantiteReelle: null },
    } as const;
    expect(p.preparerSaisie(saisie).id).not.toBe(p.preparerSaisie(saisie).id);
  });
});
