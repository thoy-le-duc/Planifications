/**
 * Tests d'acceptation T32c — le profil réglé par la ferme apparaît dans l'export complet
 * (docs/backlog/T32c-reglage-profils.md, critère « Export »). De bout en bout côté téléphone :
 * le gérant règle le profil par la porte (./test/contrat-profil.ts), puis `exporterFerme` (T15)
 * relit la base locale : espece.csv (texte JSON) et ferme.json (objet) portent le profil réglé,
 * champ `fougereApresRecolte` de l'asperge compris ; « Rétablir » le ramène à vide / null.
 * La colonne elle-même est posée par T32a (packages/core/src/export/croissance.test.ts).
 */
import type { Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lireCsv, objetsCsv } from '../../core/src/export/test/csv.ts';
import { creerPorte, exporterFerme, SCHEMA_LOCAL } from './index.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { exigerReglerProfil } from './test/contrat-profil.ts';
import { compresseurNode, lireZip, texteZip } from './test/zip.ts';

const GERANT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c7b10';
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c7b20';
const FAMILLE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c7b30';
const TOMATE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c7b40';
const ASPERGE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c7b41';
const LAITUE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c7b42';
const CREE = '2026-10-01T08:00:00.000Z';
const INSTANT = new Date('2026-10-10T06:00:00.000Z');
const JOUR = '2026-10-10';

const TOMATE_1_8 = {
  forme: 'erige-tuteure',
  hauteurMaxM: 1.8,
  duree: { en: 'jours', jours: 90 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: null,
} as const;

const ASPERGE_REGLEE = {
  forme: 'touffe',
  hauteurMaxM: 1.3,
  duree: { en: 'jours', jours: 100 },
  allure: 'en-s',
  finDeCycle: 'conservee',
  cycleAnnuel: { debourrement: '04-01', repos: '11-15' },
  fougereApresRecolte: true,
} as const;

describe('T32c : le profil réglé par la ferme est dans l’export complet', () => {
  let base: BaseMemoire;

  beforeEach(() => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    const r = (sql: string, p: readonly unknown[]) => {
      base.recevoir(sql, p);
    };
    r(`INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, modifie_le) VALUES (?, 'Jardins de Garonne', 'Europe/Paris', ?, ?)`, [FERME, CREE, CREE]);
    r(`INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, supprime_le) VALUES ('m1', ?, ?, 'gerant', 'accepte', NULL)`, [GERANT, FERME]);
    r(`INSERT INTO famille (id, ferme_id, nom, cree_le, modifie_le) VALUES (?, ?, 'Solanacées', ?, ?)`, [FAMILLE, FERME, CREE, CREE]);
    for (const [id, nom] of [
      [TOMATE, 'Tomate'],
      [ASPERGE, 'Asperge'],
      [LAITUE, 'Laitue'],
    ] as const) {
      r(
        `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, profil_croissance, cree_le, modifie_le, supprime_le)
         VALUES (?, ?, ?, ?, 'legume', 0, 'kg', NULL, ?, ?, NULL)`,
        [id, FERME, FAMILLE, nom, CREE, CREE],
      );
    }
  });

  afterEach(() => {
    base.fermer();
  });

  const porte = () => creerPorte(base, { utilisateurId: GERANT as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => INSTANT });

  async function exporter(): Promise<{ csv: Record<string, string>[]; json: Record<string, unknown>[] }> {
    const archive = await exporterFerme(porte(), { fermeId: FERME, genereLe: INSTANT.toISOString(), jour: JOUR, compresseur: compresseurNode });
    const entrees = lireZip(archive.octets);
    const csv = objetsCsv(lireCsv(texteZip(entrees, 'espece.csv')));
    const json = (JSON.parse(texteZip(entrees, 'ferme.json')) as { tables: Record<string, Record<string, unknown>[]> }).tables.espece ?? [];
    return { csv, json };
  }

  it('tomate réglée à 1,8 m et asperge réglée (champ de la fougère) : dans espece.csv et ferme.json ; la laitue non réglée reste vide', async () => {
    const regler = exigerReglerProfil(porte());
    await regler(TOMATE, TOMATE_1_8);
    await regler(ASPERGE, ASPERGE_REGLEE);
    const { csv, json } = await exporter();

    const ligneCsv = (id: string) => csv.find((l) => l.id === id);
    expect(JSON.parse(ligneCsv(TOMATE)?.profil_croissance ?? 'null')).toEqual(TOMATE_1_8);
    expect(JSON.parse(ligneCsv(ASPERGE)?.profil_croissance ?? 'null')).toEqual(ASPERGE_REGLEE);
    expect(ligneCsv(LAITUE)?.profil_croissance).toBe('');

    const ligneJson = (id: string) => json.find((l) => l.id === id);
    expect(ligneJson(TOMATE)?.profil_croissance).toEqual(TOMATE_1_8);
    expect(ligneJson(ASPERGE)?.profil_croissance).toEqual(ASPERGE_REGLEE);
    expect(ligneJson(LAITUE)?.profil_croissance).toBeNull();
  });

  it('« Rétablir la valeur par défaut » : l’export ne porte plus de profil pour l’espèce', async () => {
    const regler = exigerReglerProfil(porte());
    await regler(TOMATE, TOMATE_1_8);
    await regler(TOMATE, null);
    const { csv, json } = await exporter();
    expect(csv.find((l) => l.id === TOMATE)?.profil_croissance).toBe('');
    expect(json.find((l) => l.id === TOMATE)?.profil_croissance).toBeNull();
  });
});
