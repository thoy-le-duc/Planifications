/**
 * Tests d'acceptation T58 (relecture) — non-régression : des événements `etat_abri` dans le
 * journal ne changent rien aux calculs qui lisent le même journal. Même résultat avec et sans eux :
 *   - la journée d'Aujourd'hui (tâches, récoltes en cours, dernières récoltes, historique) :
 *     banc de journal.test.ts / isolement.test.ts (ferme du jour avec travaux, base PowerSync) ;
 *   - les traitements qui interdisent une récolte (DAR, planches bloquées) : banc de dar.test.ts
 *     (jeu varié de traitements).
 * Les changements d'état sont de la ferme affichée, d'une autre ferme, d'aujourd'hui, d'hier et
 * d'il y a plus d'un an, avec corrections et annulations.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { calculerJournee, lireJournee, type Journee } from './calculs.ts';
import { lireTraitements, SQL_TRAITEMENTS, type TraitementsDar } from './dar.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { AUTRE_FERME as AUTRE_DAR, chargerJeuVarie, FERME as FERME_DAR, multiensemble } from './test/jeu-traitements-varies.ts';
import { ecrireFermeDuJour, FERME, UTILISATEUR } from './test/ferme-du-jour.ts';
import { ecrireEtat } from './test/contrat-etat-serres.ts';

const AUJOURDHUI = '2026-09-30';
const MAINTENANT = new Date('2026-09-30T10:00:00.000Z');
const ZONE = '0192f0c1-5858-7000-8000-0000000000a1';

let base: BasePowerSync | null = null;
afterEach(() => {
  base?.fermer();
  base = null;
});

/** Des changements d'état variés, dont des chaînes corrigées et annulées, pour deux fermes. */
function ajouterEtats(b: BasePowerSync, ferme: string, autre: string): void {
  const instants = ['2026-09-30T09:00:00.000Z', '2026-09-29T17:00:00.000Z', '2026-09-20T08:00:00.000Z', '2025-06-01T08:00:00.000Z'];
  for (const fermeId of [ferme, autre]) {
    for (const [i, horodatage] of instants.entries()) {
      const o = ecrireEtat(b, { fermeId, zoneId: ZONE, equipement: 'portes', actif: i % 2 === 0, horodatage, auteurId: UTILISATEUR });
      if (i === 1) ecrireEtat(b, { fermeId, zoneId: ZONE, equipement: 'portes', actif: true, horodatage: horodatage.replace('17:00', '17:30'), auteurId: UTILISATEUR, remplace: { sorte: 'correction', evenementId: o } });
      if (i === 2) ecrireEtat(b, { fermeId, zoneId: ZONE, equipement: 'portes', actif: true, horodatage: horodatage.replace('08:00', '08:05'), auteurId: UTILISATEUR, remplace: { sorte: 'annulation', evenementId: o } });
    }
  }
}

const enTexte = (j: Journee): string => JSON.stringify(j, (_cle, v: unknown) => (v instanceof Map ? [...(v as Map<unknown, unknown>).entries()] : v));

describe('T58 : la journée d’Aujourd’hui ignore les changements d’état', () => {
  it('mêmes tâches, récoltes en cours, dernières récoltes et historique avec et sans etat_abri', async () => {
    base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    await ecrireFermeDuJour(base, AUJOURDHUI, { travaux: true });
    const porte: PorteDonnees = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
    const sans = calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
    expect(sans.taches.length, 'la journée de départ n’est pas vide').toBeGreaterThan(0);
    ajouterEtats(base, FERME, '0192f0c1-5858-7000-8000-00000000eeee');
    expect(base.lireDirect<{ n: number }>(`SELECT count(*) AS n FROM evenement WHERE type = 'etat_abri'`)[0]?.n).toBeGreaterThan(10);
    const avec = calculerJournee(await lireJournee(porte, FERME, AUJOURDHUI, MAINTENANT), AUJOURDHUI);
    expect(enTexte(avec)).toBe(enTexte(sans));
  });
});

const texteDar = (t: TraitementsDar): string => JSON.stringify({ traitements: t.traitements, noms: [...t.noms.entries()].sort() });

describe('T58 : les délais avant récolte ignorent les changements d’état', () => {
  it('mêmes traitements lus (requête et lecture complète) avec et sans etat_abri, sur le jeu varié', async () => {
    base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    chargerJeuVarie(base, 68);
    const porte: PorteDonnees = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME_DAR as Id<'Ferme'> });
    const parametres = [FERME_DAR, '2025-09-29', FERME_DAR, '2025-09-29'];
    const lignesSans = multiensemble(base.lireDirect(SQL_TRAITEMENTS, parametres));
    const sans = texteDar(await lireTraitements(porte, FERME_DAR, AUJOURDHUI));
    expect(lignesSans.length, 'le jeu contient des traitements').toBeGreaterThan(0);
    ajouterEtats(base, FERME_DAR, AUTRE_DAR);
    expect(multiensemble(base.lireDirect(SQL_TRAITEMENTS, parametres))).toEqual(lignesSans);
    expect(texteDar(await lireTraitements(porte, FERME_DAR, AUJOURDHUI))).toBe(sans);
  });
});
