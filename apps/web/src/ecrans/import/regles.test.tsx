// @vitest-environment happy-dom
/**
 * Tests d'acceptation T14b — une règle par test (docs/backlog/T14b-import-ecrans.md, « Règles »
 * et « Suites de la relecture de T14c »), sur le vrai écran rendu dans un DOM simulé et la base
 * mémoire de la ferme de l'import. Contrat : ./test/contrat.ts.
 *
 *   - « Importer » écrit en lots d'au plus 500 écritures et 5 Mio (limites de la porte et du
 *     serveur), une série toujours avec ses occupations ; l'annulation aussi, en lots ;
 *   - zone par défaut proposée quand le parcellaire n'a pas de colonne de zone ;
 *   - doublons cherchés aussi contre la base (parcellaire et séries) ; planche inconnue en erreur ;
 *   - l'aperçu montre la cellule fautive à côté du message, y compris une zone reprise de la
 *     ligne du dessus ;
 *   - avertissements de T14d (« plantation en 2028 ») sur la ligne, compteur à côté des valides ;
 *   - plafond du rapprochement des cultures (400 000 cultures différentes : alerte, pas de gel) ;
 *   - correspondance refusée par creerModele : alerte, « Continuer » désactivé ;
 *   - docs/import/ explique en une page comment importer.
 * Ailleurs : lecteur Excel et Worker (./empaquetage.test.ts, e2e), garde sur un modèle relu
 * (./modeles.test.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparerExport, validerSerie } from '@planif/core';
import { ECRITURES_MAX_PAR_LOT } from '@planif/sync';
import { fermeComplete, VOLUMES } from '../../../../../packages/core/src/import/test/jeu-ferme.ts';
import { PLAFOND_VALEURS_A_RAPPROCHER_ATTENDU } from './test/contrat.ts';
import { EMPLACEMENT, espece, FERME, ZONE } from './test/ferme-import.ts';
import {
  alertes,
  associer,
  attendreDurant,
  autreFichier,
  bouton,
  champ,
  compteur,
  continuer,
  deposerEtLire,
  desactive,
  ecran,
  etape,
  fixture,
  harnais,
  importer,
  lignesImportees,
  ligneApercu,
  lire,
  nomAccessible,
  photographie,
  toucher,
  verifierLots,
  verifierOrdres,
  remplir,
  texte,
  utf8,
  type Banc,
} from './test/harnais.ts';

const h = harnais();
const b = (): Banc => h.banc();

/** Va jusqu'à l'aperçu sans correction (types et valeurs proposés). */
async function jusquApercu(nom: string, octets: Uint8Array): Promise<void> {
  await deposerEtLire(nom, octets);
  expect(etape(), `${nom} : étape 2`).toBe('type');
  await continuer();
  await continuer();
  if (etape() === 'valeurs') await continuer();
  expect(etape(), `${nom} : aperçu`).toBe('apercu');
}

const csv = (lignes: readonly (readonly string[])[]): Uint8Array => utf8(`${lignes.map((l) => l.join(';')).join('\n')}\n`);

const boutonImporter = (): HTMLElement | undefined => [...ecran().querySelectorAll<HTMLElement>('button')].find((x) => texte(x).startsWith('Importer') && texte(x) !== 'Importer un autre fichier');

/** Écritures (ordres) de tous les lots depuis le dernier `remiseAZero()`. */
const ecritures = (): number => b().lots().reduce((n, l) => n + l.ordres, 0);

describe('« Importer » : des lots d’au plus 500 écritures et 5 Mio (limites de la porte et du serveur)', () => {
  it('ferme complète (jeu de T07 exporté par T15) : emplacement.csv en un lot, serie.csv en ⌈écritures / 500⌉ lots', { timeout: 180_000 }, async () => {
    const ferme = fermeComplete();
    const fichiers = preparerExport({ fermeId: ferme.fermeId, genereLe: '2026-09-29T06:30:00.000Z', tables: ferme.tables }).fichiers;
    const octetsDe = (chemin: string) => utf8(fichiers.find((f) => f.chemin === chemin)?.contenu ?? '');
    await h.ouvrir();

    b().remiseAZero();
    await jusquApercu('emplacement.csv', octetsDe('emplacement.csv'));
    expect(compteur('valides')).toBe(VOLUMES.emplacements);
    expect(b().transactions()).toBe(0);
    expect(lignesImportees(await importer())).toBe(VOLUMES.emplacements);
    // 400 emplacements + 30 zones = 430 écritures : un seul lot.
    expect(b().transactions(), 'emplacement.csv : un lot').toBe(1);
    verifierLots(b());
    expect(lire(b(), 'SELECT COUNT(*) AS n FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL', [FERME])[0]?.n).toBe(VOLUMES.emplacements + 7);
    expect(lire(b(), 'SELECT COUNT(*) AS n FROM zone WHERE ferme_id = ? AND supprime_le IS NULL', [FERME])[0]?.n).toBe(VOLUMES.zones + 3);

    await autreFichier();
    b().remiseAZero();
    await jusquApercu('serie.csv', octetsDe('serie.csv'));
    const valides = compteur('valides');
    expect(valides + compteur('doublons')).toBe(VOLUMES.series);
    expect(compteur('erreurs')).toBe(0);
    expect(lignesImportees(await importer())).toBe(valides);
    expect(ecritures(), 'au moins une écriture par série').toBeGreaterThanOrEqual(valides);
    expect(b().transactions(), `serie.csv : ⌈${String(ecritures())} / ${String(ECRITURES_MAX_PAR_LOT)}⌉ lots`).toBe(Math.ceil(ecritures() / ECRITURES_MAX_PAR_LOT));
    verifierLots(b());
    const series = lire(b(), 'SELECT * FROM serie WHERE ferme_id = ? AND supprime_le IS NULL', [FERME]);
    expect(series).toHaveLength(valides);
    const refusees = series.map((s) => validerSerie({ ...s })).filter((r) => !r.ok);
    expect(refusees.length, 'chaque série écrite est acceptée par validerSerie').toBe(0);
    expect(
      lire(b(), "SELECT nom FROM saison WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY nom", [FERME]).map((s) => s.nom),
      'saisons 2023 à 2027 (2026 et 2027 reprises)',
    ).toEqual(['2023', '2024', '2025', '2026', '2027']);
  });

  it('700 séries sur des planches : aucun lot au-delà de 500 écritures ni de 5 Mio, une série jamais séparée de ses occupations ; l’annulation, en lots aussi, nettoie tout', { timeout: 120_000 }, async () => {
    const lignes = [['Culture', 'Planche', 'Plantation', 'Début récolte', 'Longueur (m)']];
    for (const culture of ['Laitue', 'Poireau']) {
      for (const planche of ['GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'N3', 'N4']) {
        for (let s = 1; s <= 50; s++) lignes.push([culture, planche, `S${String(s)}`, `S${String(Math.min(52, s + 2))}`, '10']);
      }
    }
    await h.ouvrir();
    const avant = photographie(b());
    b().remiseAZero();
    await jusquApercu('series-nombreuses.csv', csv(lignes));
    expect(compteur('valides')).toBe(700);
    expect(lignesImportees(await importer())).toBe(700);
    const lots = b().lots();
    expect(lots.length, 'au moins 1 400 écritures (séries et occupations) : plusieurs lots').toBeGreaterThanOrEqual(3);
    expect(lots.length).toBe(Math.ceil(ecritures() / ECRITURES_MAX_PAR_LOT));
    verifierLots(b());
    expect(lots.reduce((n, l) => n + l.series.size, 0)).toBe(700);
    expect(lots.reduce((n, l) => n + l.occupations.size, 0)).toBe(700);
    verifierOrdres(b());

    b().remiseAZero();
    await toucher(bouton('Annuler cet import', ecran()));
    await attendreDurant(() => /annulé/i.test(texte(ecran().querySelector('[role="status"]'))), 'import annulé', 60_000);
    expect(b().transactions(), 'annulation en lots').toBe(Math.ceil(ecritures() / ECRITURES_MAX_PAR_LOT));
    verifierLots(b());
    verifierOrdres(b());
    expect(photographie(b()), '« Annuler cet import » nettoie tous les lots').toStrictEqual(avant);
  });
});

describe('année de la saison proposée (décision du chef)', () => {
  for (const [instant, attendue] of [
    ['2027-01-15T08:00:00.000Z', '2027'],
    ['2027-08-31T08:00:00.000Z', '2027'],
    ['2027-09-01T08:00:00.000Z', '2028'],
    ['2027-12-20T08:00:00.000Z', '2028'],
  ] as const) {
    it(`le ${instant.slice(0, 10)} : ${attendue} (l’année suivante à partir de septembre)`, async () => {
      await h.ouvrir(FERME, new Date(instant));
      await deposerEtLire('series-semaines.tsv', fixture('series-semaines.tsv'));
      expect(champ('Année de la saison', ecran()).value).toBe(attendue);
    });
  }
});

describe('zone par défaut quand le parcellaire n’a pas de colonne de zone', () => {
  const FICHIER = csv([
    ['Planche', 'Longueur (m)'],
    ['P1', '30'],
    ['P2', '25'],
  ]);

  it('un champ « Zone par défaut », prérempli : les deux planches y sont rangées', async () => {
    await h.ouvrir();
    await deposerEtLire('planches.csv', FICHIER);
    await continuer();
    expect(etape()).toBe('colonnes');
    const zone = champ('Zone par défaut', ecran());
    const proposee = zone.value.trim();
    expect(proposee, 'nom proposé, non vide').not.toBe('');
    await continuer();
    expect(etape()).toBe('apercu');
    expect(compteur('valides')).toBe(2);
    expect(compteur('erreurs')).toBe(0);
    expect(lignesImportees(await importer())).toBe(2);
    const z = lire(b(), 'SELECT * FROM zone WHERE ferme_id = ? AND nom = ? AND supprime_le IS NULL', [FERME, proposee]);
    expect(z).toHaveLength(1);
    const codes = lire(b(), 'SELECT code FROM emplacement WHERE zone_id = ? AND supprime_le IS NULL ORDER BY code', [z[0]?.id]).map((e) => e.code);
    expect(codes).toEqual(['P1', 'P2']);
  });

  it('une zone existante de la ferme, nommée à la main, est reprise ; vide : « Continuer » désactivé ; une colonne « Zone » retire le champ', async () => {
    await h.ouvrir();
    await deposerEtLire('planches.csv', FICHIER);
    await continuer();
    const zone = champ('Zone par défaut', ecran());
    await remplir(zone, '');
    expect(desactive(bouton('Continuer', ecran())), 'zone vide : « Continuer » désactivé').toBe(true);
    await remplir(zone, 'les grands prés');
    await continuer();
    expect(lignesImportees(await importer())).toBe(2);
    expect(lire(b(), "SELECT code FROM emplacement WHERE zone_id = ? AND code IN ('P1', 'P2')", [ZONE.grandsPres]).map((e) => e.code).sort()).toEqual(['P1', 'P2']);
    expect(lire(b(), 'SELECT COUNT(*) AS n FROM zone WHERE ferme_id = ?', [FERME])[0]?.n, 'aucune zone créée').toBe(3);

    await autreFichier();
    await deposerEtLire('planches.csv', FICHIER);
    await continuer();
    await associer('Planche', 'zone');
    expect([...ecran().querySelectorAll('input')].some((c) => nomAccessible(c) === 'Zone par défaut'), 'champ retiré').toBe(false);
  });
});

describe('doublons cherchés aussi contre la base', () => {
  it('parcellaire : une planche déjà dans la ferme est un doublon, pas écrite ; les autres passent', async () => {
    await h.ouvrir();
    await jusquApercu(
      'grands-pres.csv',
      csv([
        ['Zone', 'Planche', 'Longueur (m)'],
        ['Les Grands Prés', 'GP1', '42'],
        ['Les Grands Prés', 'gp9', '30'],
      ]),
    );
    expect(compteur('doublons')).toBe(1);
    expect(compteur('valides')).toBe(1);
    const l2 = ligneApercu(2);
    expect(l2?.dataset.statut).toBe('doublon');
    expect(texte(l2)).toMatch(/déjà dans la ferme/i);
    expect(lignesImportees(await importer())).toBe(1);
    const gp1 = lire(b(), "SELECT * FROM emplacement WHERE ferme_id = ? AND upper(code) = 'GP1'", [FERME]);
    expect(gp1, 'GP1 ni recréée ni modifiée').toHaveLength(1);
    expect(gp1[0]?.id).toBe(EMPLACEMENT.gp1);
    expect(gp1[0]?.longueur_m).toBe(30);
  });

  it('séries : le même fichier importé deux fois — la seconde fois, tout est doublon et « Importer » est désactivé', async () => {
    const fichier = csv([
      ['Culture', 'Planche', 'Plantation', 'Début récolte', 'Longueur (m)'],
      ['Laitue', 'GP1', 'S14', 'S20', '30'],
      ['Poireau', 'GP2', 'S20', 'S38', '30'],
    ]);
    await h.ouvrir();
    await jusquApercu('series.csv', fichier);
    expect(lignesImportees(await importer())).toBe(2);
    await autreFichier();
    await jusquApercu('series.csv', fichier);
    expect(compteur('doublons')).toBe(2);
    expect(compteur('valides')).toBe(0);
    for (const n of [2, 3]) expect(texte(ligneApercu(n)), `ligne ${String(n)}`).toMatch(/déjà dans la ferme/i);
    const imp = boutonImporter();
    expect(imp === undefined || desactive(imp), '« Importer » désactivé : rien à écrire').toBe(true);
    expect(lire(b(), 'SELECT COUNT(*) AS n FROM serie WHERE ferme_id = ? AND espece_id = ?', [FERME, espece('Poireau')])[0]?.n).toBe(1);
  });

  it('séries : une planche inconnue de la ferme met la ligne en erreur (« inconnu »), avec la cellule', async () => {
    await h.ouvrir();
    await jusquApercu(
      'series.csv',
      csv([
        ['Culture', 'Planche', 'Plantation', 'Début récolte'],
        ['Laitue', 'ZZ9', 'S14', 'S20'],
        ['Laitue', 'GP3', 'S14', 'S20'],
      ]),
    );
    expect(compteur('erreurs')).toBe(1);
    const l2 = ligneApercu(2);
    expect(l2?.dataset.statut).toBe('erreur');
    expect(texte(l2?.querySelector('[data-testid="erreur-import"]'))).toMatch(/inconnu/i);
    expect(texte(l2?.querySelector('[data-testid="cellule-fautive"]'))).toBe('ZZ9');
    expect(lignesImportees(await importer())).toBe(1);
  });
});

describe('l’aperçu montre la cellule fautive à côté du message', () => {
  it('series-semaines.tsv : « abc » (longueur) et « S53 » (semis), à côté du message du moteur', async () => {
    await h.ouvrir();
    // Les planches N1, N2 et TA1 viennent du parcellaire (comme dans parcours.test.tsx) : sans lui,
    // elles sont inconnues de la ferme neuve et leurs lignes seraient aussi en erreur.
    await jusquApercu('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    expect(lignesImportees(await importer())).toBe(4);
    await autreFichier();
    await jusquApercu('series-semaines.tsv', fixture('series-semaines.tsv'));
    expect(compteur('erreurs')).toBe(2);
    expect(compteur('doublons')).toBe(1);
    for (const [ligne, message, cellule] of [
      [5, 'Longueur : la valeur n’est pas un nombre.', 'abc'],
      [7, 'Date de semis : la valeur n’est pas une date valide', 'S53'],
    ] as const) {
      const l = ligneApercu(ligne);
      expect(l?.dataset.statut, `ligne ${String(ligne)}`).toBe('erreur');
      expect(texte(l?.querySelector('[data-testid="erreur-import"]'))).toContain(message);
      expect(texte(l?.querySelector('[data-testid="cellule-fautive"]')), `ligne ${String(ligne)} : cellule`).toBe(cellule);
    }
    expect(ligneApercu(6)?.dataset.statut).toBe('doublon');
  });

  it('zone trop longue reprise de la ligne du dessus : la cellule montrée est celle où la zone est écrite', async () => {
    const z = 'Z'.repeat(250);
    await h.ouvrir();
    await jusquApercu(
      'zone-longue.csv',
      csv([
        ['Zone', 'Planche', 'Longueur (m)'],
        [z, 'P1', '30'],
        ['', 'P2', '30'],
      ]),
    );
    for (const n of [2, 3]) {
      const l = ligneApercu(n);
      expect(l?.dataset.statut).toBe('erreur');
      expect(texte(l?.querySelector('[data-testid="cellule-fautive"]')), `ligne ${String(n)} : la zone écrite ligne 2`).toMatch(/^Z{20}/);
    }
    const imp = boutonImporter();
    expect(imp === undefined || desactive(imp)).toBe(true);
  });
});

describe('avertissements de l’aperçu (T14d)', () => {
  it('« plantation en 2028 » montré sur la ligne, compteur à côté des valides ; la ligne s’importe', async () => {
    await h.ouvrir();
    await jusquApercu(
      'hiver.csv',
      // Longueur donnée (relecture B1) : sans elle, la série de 1 m par défaut serait aussi un
      // avertissement « à vérifier », sur les deux lignes.
      csv([
        ['Culture', 'Semis', 'Plantation', 'Début récolte', 'Longueur (m)'],
        ['Tomate', 'S40', 'S2', 'S20', '20'],
        ['Laitue', 'S10', 'S14', 'S20', '20'],
      ]),
    );
    expect(compteur('valides')).toBe(2);
    expect(compteur('avertissements')).toBe(1);
    const l2 = ligneApercu(2);
    expect(l2?.dataset.statut).toBe('valide');
    expect(texte(l2?.querySelector('[data-testid="avertissement-import"]'))).toContain('plantation en 2028');
    expect(ligneApercu(3)?.querySelector('[data-testid="avertissement-import"]') ?? null).toBeNull();
    expect(lignesImportees(await importer())).toBe(2);
    const tomate = lire(b(), 'SELECT * FROM serie WHERE ferme_id = ? AND espece_id = ? AND supprime_le IS NULL', [FERME, espece('Tomate')]);
    expect(tomate.map((s) => [s.prevu_semis_pepiniere, s.prevu_mise_en_place])).toEqual([['2027-10-04', '2028-01-10']]);
    expect(lire(b(), 'SELECT id FROM saison WHERE ferme_id = ? AND nom = ?', [FERME, '2028']), 'saison 2028 (mise en place) créée').toHaveLength(1);
  });

  it('pas d’avertissement : pas de compteur d’avertissements', async () => {
    await h.ouvrir();
    // Un fichier où rien n'est deviné : ni année suivante (T14d), ni valeur par défaut (relecture
    // B1). series-anglais.csv ne convient plus : dans la ferme neuve, le Radis n'a pas
    // d'itinéraire, l'import en crée un avec densité et marge par défaut, montrées « à vérifier ».
    await jusquApercu('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    expect(compteur('valides')).toBe(4);
    expect(ecran().querySelector('[data-testid="compteur-avertissements"]')).toBeNull();
  });
});

/** « Continuer » aux étapes 2 et 3 (sans correction) jusqu'à l'alerte du plafond. */
async function jusquAlerte(): Promise<void> {
  for (let k = 0; k < 3 && alertes().length === 0 && (etape() === 'type' || etape() === 'colonnes'); k++) await continuer();
  await attendreDurant(() => alertes().length > 0, 'alerte du plafond', 20_000);
}

describe('plafond du rapprochement des cultures (relecture de T14c)', () => {
  it('le plafond est de 2 000 valeurs distinctes', () => {
    expect(h.module().PLAFOND_VALEURS_A_RAPPROCHER).toBe(PLAFOND_VALEURS_A_RAPPROCHER_ATTENDU);
  });

  it('400 000 cultures toutes différentes : alerte avec le nombre en moins de 20 s, pas d’aperçu, rien d’écrit', { timeout: 60_000 }, async () => {
    const lignes = ['Culture;Planche;Plantation'];
    for (let i = 0; i < 400_000; i++) lignes.push(`Plante ${String(i).padStart(6, '0')};GP1;S14`);
    const octets = utf8(`${lignes.join('\n')}\n`);
    await h.ouvrir();
    b().remiseAZero();
    const debut = Date.now();
    await deposerEtLire('cultures.csv', octets);
    await jusquAlerte();
    const duree = Date.now() - debut;
    expect(alertes().join(' ')).toMatch(/400[\s\u202f\u00a0]?000/);
    expect(etape(), 'ni valeurs ni aperçu').not.toMatch(/^(valeurs|apercu)$/);
    expect(duree, `alerte en ${String(duree)} ms`).toBeLessThan(20_000);
    expect(b().transactions()).toBe(0);
  });

  it('2 001 cultures différentes (une de plus que le plafond) : alerte « 2 001 »', { timeout: 30_000 }, async () => {
    const lignes = ['Culture;Planche;Plantation'];
    for (let i = 0; i < 2_001; i++) lignes.push(`Plante ${String(i)};GP1;S14`);
    await h.ouvrir();
    await deposerEtLire('cultures.csv', utf8(`${lignes.join('\n')}\n`));
    await jusquAlerte();
    expect(alertes().join(' ')).toMatch(/2[\s\u202f\u00a0]?001/);
    expect(etape()).not.toMatch(/^(valeurs|apercu)$/);
  });
});

describe('correspondance refusée par creerModele', () => {
  it('deux colonnes sur le même champ : alerte avec le message du moteur, « Continuer » désactivé', async () => {
    await h.ouvrir();
    await deposerEtLire('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    await continuer();
    await associer('Width (m)', 'longueur_m');
    expect(alertes().join(' ')).toMatch(/plusieurs colonnes/);
    expect(desactive(bouton('Continuer', ecran()))).toBe(true);
  });
});

describe('docs/import/ : comment importer, en une page', () => {
  // Chemin sur le disque : sous happy-dom, Vite réécrit `new URL('<littéral>', import.meta.url)` en http://…
  const DOSSIER = join(import.meta.dirname, '../../../../../docs/import');

  it('une page Markdown, pour un maraîcher, qui couvre le parcours', () => {
    const pages = readdirSync(DOSSIER).filter((f) => f.endsWith('.md'));
    expect(pages.length, 'au moins une page .md dans docs/import/').toBeGreaterThan(0);
    const texteDoc = pages.map((p) => readFileSync(join(DOSSIER, p), 'utf8')).join('\n');
    for (const mot of [/CSV/, /\.xlsx|Excel/i, /parcellaire/i, /séries/i, /assolement/i, /colonnes?/i, /aperçu/i, /modèle/i, /annuler/i, /Importer un tableur/]) {
      expect(texteDoc, `la page parle de ${String(mot)}`).toMatch(mot);
    }
    const mots = texteDoc.split(/\s+/).filter((m) => m !== '').length;
    expect(mots, `une page : ${String(mots)} mots`).toBeLessThanOrEqual(900);
  });
});
