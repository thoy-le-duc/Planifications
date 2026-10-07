// @vitest-environment happy-dom
/**
 * Tests d'acceptation T14b — critère 2 : un import annulé depuis l'historique ne laisse aucune
 * trace ; le modèle d'import validé est enregistré pour la ferme et réutilisé sur un second
 * fichier de même forme. Vrai écran, DOM simulé, base mémoire (./test/harnais.ts). Contrat :
 * ./test/contrat.ts, « Annulation depuis l'historique » et « Modèle d'import de la ferme ».
 *
 * « Aucune trace » : pour chaque table du schéma local, les lignes actives (supprime_le nul)
 * sont exactement celles d'avant l'import (suppression douce : les lignes créées restent,
 * marquées supprimées, pour la synchro) ; aucune ligne nouvelle dans une table sans
 * supprime_le ; rien dans `modification`. Annuler s'écrit en lots comme l'import (au plus
 * 500 écritures et 5 Mio par lot, décision du chef) : un seul lot pour ces petits fichiers.
 */
import { describe, expect, it } from 'vitest';
import { AUTRE_FERME, espece } from './test/ferme-import.ts';
import {
  alertes,
  associer,
  attendreDurant,
  autreFichier,
  bouton,
  champsChoisis,
  choisirType,
  comptes,
  continuer,
  decider,
  deposerEtLire,
  desactive,
  ecran,
  etape,
  fixture,
  harnais,
  importer,
  ISO,
  lignesImportees,
  lire,
  photographie,
  texte,
  toucher,
  typeCoche,
  verifierLots,
  verifierOrdres,
  type Banc,
} from './test/harnais.ts';
import { LIBELLES_TYPES } from './test/contrat.ts';

const h = harnais();
const b = (): Banc => h.banc();

/** Parcours sans correction d'un fichier du jeu ; rend le statut final. */
async function importerSansCorrection(nom: string): Promise<string> {
  await deposerEtLire(nom, fixture(nom));
  expect(etape()).toBe('type');
  await continuer();
  await continuer();
  if (etape() === 'valeurs') await continuer();
  expect(etape()).toBe('apercu');
  return importer();
}

/** modele-a.csv avec ses quatre corrections (type, deux colonnes, « Salade du jardin » → Laitue). */
async function importerModeleA(): Promise<string> {
  await deposerEtLire('modele-a.csv', fixture('modele-a.csv'));
  expect(typeCoche(), 'modele-a.csv : aucun type proposé').toBeNull();
  await choisirType('series');
  await continuer();
  expect(ecran().querySelector('[data-testid="modele-applique"]'), 'pas encore de modèle').toBeNull();
  await associer('Semaine de plantation', 'date_plantation');
  await associer('Mètres', 'longueur_m');
  await continuer();
  expect(etape()).toBe('valeurs');
  await decider('espece', 'Salade du jardin', espece('Laitue'));
  await continuer();
  expect(etape()).toBe('apercu');
  return importer();
}

const importsPasses = (): HTMLElement[] => [...ecran().querySelectorAll<HTMLElement>('[data-testid="import-passe"]')];

/** Les lignes créées par un import : celles qui n'existaient pas dans la photographie (par id). */
function creees(avant: Record<string, readonly { readonly id?: unknown }[]>): { table: string; id: string; supprime_le: unknown }[] {
  const r: { table: string; id: string; supprime_le: unknown }[] = [];
  for (const table of Object.keys(avant)) {
    const vus = new Set((avant[table] ?? []).map((l) => String(l.id)));
    for (const l of lire(b(), `SELECT * FROM "${table}"`)) if (!vus.has(String(l.id))) r.push({ table, id: String(l.id), supprime_le: l.supprime_le ?? '(pas de colonne)' });
  }
  return r;
}

/** Toutes les lignes (supprimées comprises), pour retrouver les lignes créées après coup. */
function tout(): Record<string, readonly { readonly id?: unknown }[]> {
  return Object.fromEntries(Object.keys(photographie(b())).map((t) => [t, lire(b(), `SELECT id FROM "${t}"`)]));
}

describe('T14b, critère 2 : annuler un import ne laisse aucune trace', () => {
  it('« Annuler cet import » juste après l’import : une opération, chaque ligne créée supprimée, rien d’autre ne bouge', async () => {
    await h.ouvrir();
    const avant = photographie(b());
    const toutAvant = tout();
    const statut = await importerSansCorrection('parcellaire-3-niveaux-cp1252.csv');
    expect(lignesImportees(statut)).toBe(5);
    const nouvelles = creees(toutAvant);
    expect(nouvelles.filter((n) => n.table === 'emplacement')).toHaveLength(5);
    expect(nouvelles.filter((n) => n.table === 'zone')).toHaveLength(4);

    b().remiseAZero();
    await toucher(bouton('Annuler cet import', ecran()));
    await attendreDurant(() => /annulé/i.test(texte(ecran().querySelector('[role="status"]'))), 'statut « annulé »');
    expect(alertes()).toEqual([]);
    expect(b().transactions(), 'annuler moins de 500 lignes = un seul lot').toBe(1);
    verifierLots(b());
    verifierOrdres(b());
    expect([...ecran().querySelectorAll('button')].some((x) => texte(x) === 'Annuler cet import'), 'plus de bouton d’annulation').toBe(false);

    expect(photographie(b()), 'lignes actives identiques à avant l’import').toStrictEqual(avant);
    for (const n of creees(toutAvant)) expect(n.supprime_le, `${n.table} ${n.id} : supprimée (douce), à l’heure de l’annulation`).toBe(ISO);
  });

  it('depuis « Imports récents », après avoir fermé l’écran : deux imports annulés l’un après l’autre, la ferme revient à son état de départ', async () => {
    await h.ouvrir();
    const depart = photographie(b());
    expect(lignesImportees(await importerSansCorrection('parcellaire-anglais.csv'))).toBe(4);
    await autreFichier();
    const apresParcellaire = photographie(b());
    const toutApresParcellaire = tout();
    expect(lignesImportees(await importerSansCorrection('series-semaines.tsv'))).toBe(3);
    const nouvellesSeries = creees(toutApresParcellaire);
    expect(nouvellesSeries.filter((n) => n.table === 'serie')).toHaveLength(3);
    expect(nouvellesSeries.filter((n) => n.table === 'occupation')).toHaveLength(3);

    // Fermer, rouvrir : l'historique est toujours là, le plus récent d'abord.
    h.demonter();
    await h.ouvrir();
    const liste = importsPasses();
    expect(liste, 'deux imports dans « Imports récents »').toHaveLength(2);
    expect(texte(liste[0])).toContain('series-semaines.tsv');
    expect(texte(liste[0])).toMatch(/\b3\b/);
    expect(texte(liste[1])).toContain('parcellaire-anglais.csv');
    expect(texte(liste[1])).toMatch(/\b4\b/);
    expect(liste.map((l) => l.dataset.etat)).toEqual(['actif', 'actif']);

    // Annuler le plus récent : retour à l'état d'après le parcellaire.
    b().remiseAZero();
    const series = liste[0];
    if (series === undefined) return;
    await toucher(bouton('Annuler cet import', series));
    await attendreDurant(() => importsPasses()[0]?.dataset.etat === 'annule', 'import des séries marqué annulé');
    expect(b().transactions()).toBe(1);
    verifierLots(b());
    verifierOrdres(b());
    expect(texte(importsPasses()[0])).toMatch(/annulé/i);
    expect([...(importsPasses()[0]?.querySelectorAll('button') ?? [])].some((x) => texte(x) === 'Annuler cet import')).toBe(false);
    expect(photographie(b()), 'séries, occupations, itinéraires, variétés et saisons de l’import : plus aucune ligne active').toStrictEqual(apresParcellaire);

    // Puis le parcellaire : la zone « North field » reprise par l'import n'est PAS supprimée.
    const parcellaire = importsPasses()[1];
    if (parcellaire === undefined) return;
    await toucher(bouton('Annuler cet import', parcellaire));
    await attendreDurant(() => importsPasses()[1]?.dataset.etat === 'annule', 'import du parcellaire marqué annulé');
    expect(photographie(b()), 'la ferme est revenue à son état de départ').toStrictEqual(depart);
  });

  it('les imports d’une ferme ne sont ni listés ni annulables depuis une autre', async () => {
    await h.ouvrir();
    await importerSansCorrection('parcellaire-anglais.csv');
    h.demonter();
    await h.ouvrir(AUTRE_FERME);
    expect(importsPasses()).toEqual([]);
  });
});

describe('T14b, critère 2 : le modèle d’import de la ferme', () => {
  it('modele-a.csv corrigé, puis modele-b.csv (colonnes dans un autre ordre) : type, colonnes et culture repris, aucune correction', async () => {
    await h.ouvrir();
    expect(lignesImportees(await importerModeleA())).toBe(2);
    await autreFichier();
    await deposerEtLire('modele-b.csv', fixture('modele-b.csv'));
    expect(typeCoche(), 'type repris du modèle').toBe(LIBELLES_TYPES.series);
    await continuer();
    expect(ecran().querySelector('[data-testid="modele-applique"]'), 'correspondance reprise du modèle, signalée').not.toBeNull();
    expect(champsChoisis()).toEqual(['emplacement', '', 'espece', 'longueur_m', 'date_plantation']);
    await continuer();
    // « Salade du jardin » → Laitue est dans le modèle : plus rien à décider.
    expect(etape(), 'pas d’étape « valeurs » : le choix du modèle s’applique').toBe('apercu');
    expect(lignesImportees(await importer())).toBe(3);
    const laitues = lire(b(), "SELECT s.id FROM serie s JOIN occupation o ON o.serie_id = s.id JOIN emplacement e ON e.id = o.emplacement_id WHERE s.espece_id = ? AND e.code IN ('GP3', 'GP5') AND s.supprime_le IS NULL", [espece('Laitue')]);
    expect(laitues).toHaveLength(2);
  });

  it('le modèle survit à la fermeture de l’écran et à l’annulation de l’import qui l’a créé ; il est propre à la ferme', async () => {
    await h.ouvrir();
    await importerModeleA();
    await toucher(bouton('Annuler cet import', ecran()));
    await attendreDurant(() => /annulé/i.test(texte(ecran().querySelector('[role="status"]'))), 'import annulé');
    h.demonter();

    await h.ouvrir();
    await deposerEtLire('modele-b.csv', fixture('modele-b.csv'));
    expect(typeCoche()).toBe(LIBELLES_TYPES.series);
    await continuer();
    expect(ecran().querySelector('[data-testid="modele-applique"]')).not.toBeNull();
    h.demonter();

    await h.ouvrir(AUTRE_FERME);
    await deposerEtLire('modele-b.csv', fixture('modele-b.csv'));
    expect(typeCoche(), 'autre ferme : pas de modèle, pas de type proposé').toBeNull();
    expect(desactive(bouton('Continuer', ecran())), '« Continuer » désactivé tant qu’aucun type n’est choisi').toBe(true);
  });

  it('rien n’est écrit tant qu’on n’a pas touché « Importer » (fermer à l’aperçu n’écrit rien, ni modèle ni données)', async () => {
    await h.ouvrir();
    const avant = comptes(b());
    b().remiseAZero();
    await deposerEtLire('modele-a.csv', fixture('modele-a.csv'));
    await choisirType('series');
    await continuer();
    await associer('Semaine de plantation', 'date_plantation');
    await associer('Mètres', 'longueur_m');
    await continuer();
    await decider('espece', 'Salade du jardin', espece('Laitue'));
    await continuer();
    expect(etape()).toBe('apercu');
    await toucher(bouton('Fermer', ecran()));
    expect(h.fermetures()).toBe(1);
    expect(b().transactions()).toBe(0);
    expect(comptes(b())).toStrictEqual(avant);
    h.demonter();
    await h.ouvrir();
    await deposerEtLire('modele-b.csv', fixture('modele-b.csv'));
    expect(typeCoche(), 'aucun modèle enregistré sans « Importer »').toBeNull();
  });
});
