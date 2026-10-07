// @vitest-environment happy-dom
/**
 * Tests d'acceptation T14b — suites de la relecture (contrat : ./test/contrat.ts, « Relecture »).
 *
 * B1, rien d'inventé en douce : chaque valeur par défaut que l'import ÉCRIT est montrée à
 * l'aperçu, sur sa ligne (avertissement, compté « à vérifier ») et dans l'encart récapitulatif
 * data-testid="valeurs-par-defaut". Une culture créée demande sa catégorie, son caractère pérenne
 * et son unité de récolte à l'étape « Valeurs » (plus de legume / non pérenne / kg imposés).
 *
 * B2, annulation honnête : lot par lot, dans l'ordre inverse de l'import ; un lot refusé ne bloque
 * que sa propre annulation ; une ligne importée qui sert depuis (série posée sur une planche
 * importée) fait refuser l'annulation en clair, sans rien retirer ni afficher « annulé ».
 *
 * Mineurs : pas de fermeture silencieuse pendant l'écriture ; la déconnexion efface
 * planif:import:* ; l'annulation ne touche que des lignes de la ferme ; import interrompu noté
 * dans l'historique avec le nombre d'envois.
 */
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { deconnecter } from '../../connexion/deconnexion.ts';
import { CLE_SESSION, type SessionConnexion } from '../../connexion/session.ts';
import { AUTRE_FERME, CREE_LE, espece, FERME, UTILISATEUR, ZONE } from './test/ferme-import.ts';
import {
  alertes,
  attendreDurant,
  autreFichier,
  bouton,
  compteur,
  continuer,
  decider,
  deposerEtLire,
  desactive,
  ecran,
  etape,
  fixture,
  harnais,
  importer,
  lignesImportees,
  ligneApercu,
  liste,
  lire,
  photographie,
  porteEnveloppee,
  remplir,
  texte,
  toucher,
  utf8,
  type Banc,
} from './test/harnais.ts';
import { NOM_ECRAN } from './test/contrat.ts';
import { dialogue } from '../itineraires/test/outils.ts';

const h = harnais();
const b = (): Banc => h.banc();

const csv = (lignes: readonly (readonly string[])[]): Uint8Array => utf8(`${lignes.map((l) => l.join(';')).join('\n')}\n`);

async function jusquApercu(nom: string, octets: Uint8Array): Promise<void> {
  await deposerEtLire(nom, octets);
  await continuer();
  await continuer();
  if (etape() === 'valeurs') await continuer();
  expect(etape(), `${nom} : aperçu`).toBe('apercu');
}

/** L'encart des valeurs par défaut et son élément `data-defaut="<sorte>"`. */
function defaut(sorte: string): HTMLElement | null {
  return ecran().querySelector<HTMLElement>(`[data-testid="valeurs-par-defaut"] [data-testid="defaut-import"][data-defaut="${sorte}"]`);
}

const avertissementsDe = (ligne: number): string => [...(ligneApercu(ligne)?.querySelectorAll('[data-testid="avertissement-import"]') ?? [])].map((a) => texte(a)).join(' | ');

/** Ligne valide avertie, comptée « à vérifier ». */
function avertie(ligne: number, motif: RegExp): void {
  const l = ligneApercu(ligne);
  expect(l?.dataset.statut, `ligne ${String(ligne)} valide`).toBe('valide');
  expect(avertissementsDe(ligne), `ligne ${String(ligne)} : avertissement`).toMatch(motif);
  expect(texte(ecran().querySelector('[data-testid="compteur-avertissements"]')), 'compteur « à vérifier »').toMatch(/à vérifier/i);
  expect(compteur('avertissements')).toBeGreaterThanOrEqual(1);
}

// ── B1 ───────────────────────────────────────────────────────────────────────────────────────

describe('B1 : chaque valeur par défaut écrite est montrée à l’aperçu', () => {
  it('itinéraire créé sans densité : 1 rang × 30 cm et marge de 10 %, sur la ligne et dans l’encart', async () => {
    await h.ouvrir();
    await jusquApercu(
      'carottes.csv',
      csv([
        ['Culture', 'Famille', 'Mode', 'Jours avant récolte', 'Fenêtre de récolte (j)'],
        ['Carotte', 'Apiacées', 'semis direct', '90', '60'],
      ]),
    );
    avertie(2, /1 rang/);
    expect(avertissementsDe(2)).toMatch(/30 cm/);
    expect(avertissementsDe(2)).toMatch(/10 %/);
    expect(texte(defaut('densite'))).toMatch(/1 rang.*30 cm/);
    expect(texte(defaut('marge'))).toMatch(/10 %/);
  });

  it('famille créée hors bibliothèque : délais de retour 3 et 4 ans montrés', async () => {
    await h.ouvrir();
    await deposerEtLire(
      'gingembre.csv',
      csv([
        ['Culture', 'Famille', 'Mode', 'Jours avant récolte', 'Fenêtre de récolte (j)', 'Rangs/planche', 'Ecartement (cm)'],
        ['Gingembre', 'Zingibéracées', 'plant acheté', '200', '30', '2', '30'],
      ]),
    );
    await continuer();
    await continuer();
    expect(etape()).toBe('valeurs');
    await decider('famille', 'Zingibéracées', 'nouvelle');
    await decider('espece', 'Gingembre', 'nouvelle');
    await choisirNouvelleCulture('Gingembre', 'legume', 'non', 'kg');
    await continuer();
    expect(etape()).toBe('apercu');
    avertie(2, /3 ans/);
    expect(avertissementsDe(2)).toMatch(/4 ans/);
    expect(texte(defaut('delais-famille'))).toMatch(/Zingibéracées/);
  });

  it('zone créée sans type d’abri : « plein champ » montré', async () => {
    await h.ouvrir();
    await jusquApercu(
      'verger.csv',
      csv([
        ['Zone', 'Planche', 'Longueur (m)'],
        ['Verger', 'V1', '20'],
        ['Verger', 'V2', '20'],
      ]),
    );
    avertie(2, /plein champ/i);
    expect(texte(defaut('abri'))).toMatch(/Verger/);
  });

  it('série sans longueur, ni plants, ni planche : 1 m montré', async () => {
    await h.ouvrir();
    await jusquApercu(
      'sans-taille.csv',
      csv([
        ['Culture', 'Plantation', 'Début récolte'],
        ['Laitue', 'S14', 'S20'],
      ]),
    );
    avertie(2, /1 m\b/);
    expect(texte(defaut('longueur-serie'))).toMatch(/1 m\b/);
  });

  it('variété donnée par un identifiant inconnu : montrée (la série s’écrit sans variété)', async () => {
    await h.ouvrir();
    await jusquApercu(
      'variete.csv',
      csv([
        ['Culture', 'Variété', 'Planche', 'Plantation', 'Début récolte'],
        ['Laitue', '0192f0c1-0000-7000-8000-00000000dead', 'GP1', 'S14', 'S20'],
      ]),
    );
    avertie(2, /variété/i);
    expect(avertissementsDe(2)).toMatch(/inconnu/i);
    expect(defaut('variete-inconnue')).not.toBeNull();
  });

  it('aucune valeur inventée : pas d’encart', async () => {
    await h.ouvrir();
    await jusquApercu('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    expect(ecran().querySelector('[data-testid="valeurs-par-defaut"]')).toBeNull();
  });
});

/** Les trois choix d'une culture créée, à l'étape « Valeurs ». */
async function choisirNouvelleCulture(nom: string, categorie: string, perenne: 'oui' | 'non', unite: string): Promise<void> {
  await remplir(liste(`Catégorie pour « ${nom} »`, ecran()), categorie);
  await remplir(liste(`Culture pérenne pour « ${nom} »`, ecran()), perenne);
  await remplir(liste(`Unité de récolte pour « ${nom} »`, ecran()), unite);
}

describe('B1 : une culture créée demande sa catégorie, son caractère pérenne et son unité', () => {
  it('créer « Asperge verte » oblige à choisir les trois ; le choix est écrit', async () => {
    await h.ouvrir();
    await deposerEtLire(
      'asperge.csv',
      csv([
        ['Culture', 'Famille', 'Mode', 'Jours avant récolte', 'Fenêtre de récolte (j)', 'Rangs/planche', 'Ecartement (cm)'],
        ['Asperge verte', 'Asparagacées', 'plant acheté', '300', '60', '1', '40'],
      ]),
    );
    await continuer();
    await continuer();
    expect(etape()).toBe('valeurs');
    await decider('espece', 'Asperge verte', 'nouvelle');
    const nom = 'Asperge verte';
    for (const champ of [`Catégorie pour « ${nom} »`, `Culture pérenne pour « ${nom} »`, `Unité de récolte pour « ${nom} »`]) {
      expect(liste(champ, ecran()).value, `${champ} : rien de choisi d’office`).toBe('');
    }
    expect(desactive(bouton('Continuer', ecran())), 'rien choisi : « Continuer » désactivé').toBe(true);
    await remplir(liste(`Catégorie pour « ${nom} »`, ecran()), 'legume');
    await remplir(liste(`Culture pérenne pour « ${nom} »`, ecran()), 'oui');
    expect(desactive(bouton('Continuer', ecran())), 'unité pas choisie : « Continuer » désactivé').toBe(true);
    await remplir(liste(`Unité de récolte pour « ${nom} »`, ecran()), 'botte');
    await continuer();
    expect(etape()).toBe('apercu');
    expect(lignesImportees(await importer())).toBe(1);
    const e = lire(b(), 'SELECT * FROM espece WHERE ferme_id = ? AND nom = ?', [FERME, nom]);
    expect(e.map((x) => [x.categorie, x.perenne, x.unite_recolte])).toEqual([['legume', 1, 'botte']]);
  });
});

// ── B2 ───────────────────────────────────────────────────────────────────────────────────────

/** 700 séries sur les planches de la ferme : au moins trois lots. */
const SERIES_NOMBREUSES = ((): Uint8Array => {
  const lignes = [['Culture', 'Planche', 'Plantation', 'Début récolte', 'Longueur (m)']];
  for (const culture of ['Laitue', 'Poireau']) {
    for (const planche of ['GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'N3', 'N4']) {
      for (let s = 1; s <= 50; s++) lignes.push([culture, planche, `S${String(s)}`, `S${String(Math.min(52, s + 2))}`, '10']);
    }
  }
  return csv(lignes);
})();

const importsPasses = (): HTMLElement[] => [...ecran().querySelectorAll<HTMLElement>('[data-testid="import-passe"]')];

describe('B2 : annulation honnête', () => {
  it('lot par lot, dans l’ordre inverse de l’import : le 1er lot d’annulation retire exactement le dernier lot importé', { timeout: 120_000 }, async () => {
    await h.ouvrir();
    const avant = photographie(b());
    b().remiseAZero();
    await jusquApercu('series.csv', SERIES_NOMBREUSES);
    await importer();
    const lotsImport = b().lots().map((l) => l.creees);
    expect(lotsImport.length).toBeGreaterThanOrEqual(3);
    b().remiseAZero();
    await toucher(bouton('Annuler cet import', ecran()));
    await attendreDurant(() => /annulé/i.test(texte(ecran().querySelector('[role="status"]'))), 'import annulé', 60_000);
    const lotsAnnulation = b().lots().map((l) => [...l.supprimees].sort());
    expect(lotsAnnulation, 'un lot d’annulation par lot importé, dans l’ordre inverse').toEqual([...lotsImport].reverse().map((s) => [...s].sort()));
    expect(photographie(b())).toStrictEqual(avant);
  });

  it('un lot d’annulation refusé ne bloque que sa propre annulation ; « Annuler » à nouveau finit le travail', { timeout: 120_000 }, async () => {
    let refuser = false;
    let appels = 0;
    const porte = porteEnveloppee(b(), () => {
      if (!refuser) return;
      appels++;
      // Le 3e lot d'annulation (= 1er lot importé) est refusé par la base locale, une fois.
      if (appels === 3) throw new Error('base locale : écriture refusée');
    });
    await h.ouvrir(FERME, undefined, porte);
    const avant = photographie(b());
    b().remiseAZero();
    await jusquApercu('series.csv', SERIES_NOMBREUSES);
    await importer();
    const lotsImport = b().lots().map((l) => l.creees);
    expect(lotsImport).toHaveLength(3);
    refuser = true;
    b().remiseAZero();
    await toucher(bouton('Annuler cet import', ecran()));
    await attendreDurant(() => alertes().length > 0, 'alerte : annulation incomplète', 60_000);
    const supprimees = new Set(b().lots().flatMap((l) => [...l.supprimees]));
    for (const k of [...(lotsImport[1] ?? []), ...(lotsImport[2] ?? [])]) expect(supprimees.has(k), `${k} : son lot a été annulé`).toBe(true);
    for (const k of lotsImport[0] ?? []) expect(supprimees.has(k), `${k} : son lot (refusé) reste`).toBe(false);
    expect(texte(ecran().querySelector('[role="status"]')), 'pas « annulé »').not.toMatch(/annulé/i);

    // Retour à l'historique : toujours annulable, puis annulé pour de bon.
    h.demonter();
    await h.ouvrir(FERME, undefined, porte);
    const passe = importsPasses()[0];
    expect(passe?.dataset.etat).not.toBe('annule');
    if (passe === undefined) return;
    await toucher(bouton('Annuler cet import', passe));
    await attendreDurant(() => importsPasses()[0]?.dataset.etat === 'annule', 'annulé après la reprise', 60_000);
    expect(photographie(b())).toStrictEqual(avant);
  });

  it('une ligne importée qui sert depuis (série sur une planche importée) : annulation refusée en clair, rien de retiré, pas « annulé »', { timeout: 60_000 }, async () => {
    await h.ouvrir();
    expect(lignesImportees(await importerSansCorrection('parcellaire-anglais.csv'))).toBe(4);
    await autreFichier();
    expect(lignesImportees(await importerSansCorrection('series-semaines.tsv'))).toBe(3);
    h.demonter();
    await h.ouvrir();
    const avant = photographie(b());
    const parcellaire = importsPasses().find((x) => texte(x).includes('parcellaire-anglais.csv'));
    expect(parcellaire).toBeDefined();
    if (parcellaire === undefined) return;
    b().remiseAZero();
    await toucher(bouton('Annuler cet import', parcellaire));
    await attendreDurant(() => alertes().length > 0, 'refus en clair');
    expect(alertes().join(' '), 'le refus dit pourquoi (une planche sert)').toMatch(/N1|N2|TA1|sert|utilis/i);
    expect(b().transactions(), 'rien n’est retiré').toBe(0);
    expect(photographie(b())).toStrictEqual(avant);
    const apres = importsPasses().find((x) => texte(x).includes('parcellaire-anglais.csv'));
    expect(apres?.dataset.etat).toBe('actif');
    expect(texte(apres)).not.toMatch(/annulé/i);
  });
});

async function importerSansCorrection(nom: string): Promise<string> {
  await jusquApercu(nom, fixture(nom));
  return importer();
}

// ── Mineurs ──────────────────────────────────────────────────────────────────────────────────

describe('mineurs de la relecture', () => {
  it('pendant l’écriture, ni Échap ni « Fermer » ne ferment l’écran sans confirmation', { timeout: 60_000 }, async () => {
    let liberer: () => void = () => undefined;
    const retenue = new Promise<void>((r) => {
      liberer = r;
    });
    await h.ouvrir(FERME, undefined, porteEnveloppee(b(), () => retenue));
    await jusquApercu('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    const imp = [...ecran().querySelectorAll<HTMLElement>('button')].find((x) => texte(x).startsWith('Importer') && texte(x) !== 'Importer un autre fichier');
    if (imp === undefined) throw new Error('bouton « Importer » absent');
    await toucher(imp);
    // Écriture en cours (retenue).
    await act(async () => {
      ecran().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    const fermer = [...ecran().querySelectorAll<HTMLButtonElement>('button')].filter((x) => (x.getAttribute('aria-label') ?? x.textContent).trim() === 'Fermer');
    for (const f of fermer) if (!f.disabled) await toucher(f);
    const confirmation = [...document.querySelectorAll('[role="alertdialog"]')].length > 0;
    expect(h.fermetures() === 0 || confirmation, 'écran pas fermé en silence pendant l’écriture').toBe(true);
    expect(h.fermetures(), 'pas fermé sans confirmation').toBe(0);
    liberer();
    await attendreDurant(() => etape() === 'fini', 'écriture terminée');
    expect(dialogue(NOM_ECRAN)).toBeDefined();
  });

  it('la déconnexion efface planif:import:* (historique et modèles de toutes les fermes du téléphone)', async () => {
    const session: SessionConnexion = { utilisateurId: UTILISATEUR, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) };
    const valeurs = new Map<string, string>([
      [CLE_SESSION, JSON.stringify(session)],
      [`planif:import:historique:${FERME}`, '[]'],
      [`planif:import:modeles:${FERME}`, '[]'],
      [`planif:import:modeles:${AUTRE_FERME}`, '[]'],
      ['planif.theme', 'sombre'],
    ]);
    const stockage = {
      get length() {
        return valeurs.size;
      },
      key: (i: number) => [...valeurs.keys()][i] ?? null,
      getItem: (c: string) => valeurs.get(c) ?? null,
      setItem: (c: string, v: string) => {
        valeurs.set(c, v);
      },
      removeItem: (c: string) => {
        valeurs.delete(c);
      },
      clear: () => {
        valeurs.clear();
      },
    };
    await deconnecter(session, { urlApi: 'https://api', fetch: () => Promise.resolve(new Response(null, { status: 204 })), stockage, effacerBaseLocale: () => Promise.resolve() });
    expect([...valeurs.keys()].filter((c) => c.startsWith('planif:import:'))).toEqual([]);
    expect(valeurs.get('planif.theme'), 'le reste n’est pas touché').toBe('sombre');
  });

  it('l’annulation ne touche que des lignes de la ferme (historique trafiqué : ligne de la bibliothèque, d’une autre ferme)', { timeout: 60_000 }, async () => {
    const autreZone = '0192f0c1-14b0-7000-8000-0000000000aa';
    await b().base.execute('INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, cree_le, modifie_le, supprime_le) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, NULL)', [
      autreZone,
      AUTRE_FERME,
      'Zone d’une autre ferme',
      'tunnel',
      CREE_LE,
      CREE_LE,
    ]);
    await h.ouvrir();
    await importerSansCorrection('parcellaire-anglais.csv');
    // Historique rangé par l'écran (format de historique.ts : `creees` par table), complété à la main.
    const cle = `planif:import:historique:${FERME}`;
    const liste = JSON.parse(localStorage.getItem(cle) ?? '[]') as { creees: Record<string, string[]> }[];
    const entree = liste[0];
    expect(entree).toBeDefined();
    if (entree === undefined) return;
    entree.creees.zone = [...(entree.creees.zone ?? []), autreZone];
    entree.creees.espece = [...(entree.creees.espece ?? []), espece('Laitue')];
    localStorage.setItem(cle, JSON.stringify(liste));
    h.demonter();
    await h.ouvrir();
    const passe = importsPasses()[0];
    if (passe === undefined) throw new Error('import absent de l’historique');
    await toucher(bouton('Annuler cet import', passe));
    await attendreDurant(() => importsPasses()[0]?.dataset.etat === 'annule' || alertes().length > 0, 'annulation traitée');
    expect(importsPasses()[0]?.dataset.etat, 'les vraies lignes de l’import sont annulées').toBe('annule');
    expect(lire(b(), "SELECT COUNT(*) AS n FROM emplacement WHERE code IN ('N1', 'N2', 'TA1', 'TA2') AND supprime_le IS NULL")[0]?.n).toBe(0);
    expect(lire(b(), 'SELECT supprime_le FROM zone WHERE id = ?', [ZONE.north])[0]?.supprime_le, 'zone reprise, pas créée : intacte').toBeNull();
    expect(lire(b(), 'SELECT supprime_le FROM zone WHERE id = ?', [autreZone])[0]?.supprime_le, 'zone d’une autre ferme intacte').toBeNull();
    expect(lire(b(), 'SELECT supprime_le FROM espece WHERE id = ?', [espece('Laitue')])[0]?.supprime_le, 'espèce de la bibliothèque intacte').toBeNull();
    expect(
      b().ordres().filter((sql) => /^\s*UPDATE\b/i.test(sql) && !/\bferme_id\s*=\s*\?/i.test(sql)),
      'chaque UPDATE de l’annulation filtre sur ferme_id',
    ).toEqual([]);
  });

  it('écriture arrêtée en route : l’historique note « interrompu » et le nombre d’envois ; « Annuler » retire ce qui est écrit', { timeout: 120_000 }, async () => {
    const porte = porteEnveloppee(b(), (n) => {
      if (n === 2) throw new Error('base locale : écriture refusée');
    });
    await h.ouvrir(FERME, undefined, porte);
    const avant = photographie(b());
    await jusquApercu('series.csv', SERIES_NOMBREUSES);
    const imp = [...ecran().querySelectorAll<HTMLElement>('button')].find((x) => texte(x).startsWith('Importer') && texte(x) !== 'Importer un autre fichier');
    if (imp === undefined) throw new Error('bouton « Importer » absent');
    await toucher(imp);
    await attendreDurant(() => alertes().length > 0, 'import interrompu', 60_000);
    h.demonter();
    await h.ouvrir(FERME, undefined, porte);
    const passe = importsPasses()[0];
    expect(texte(passe)).toMatch(/interrompu/i);
    expect(texte(passe), '1 envoi sur 3').toMatch(/\b1\b[^\d]*\b3\b/);
    if (passe === undefined) return;
    await toucher(bouton('Annuler cet import', passe));
    await attendreDurant(() => importsPasses()[0]?.dataset.etat === 'annule', 'annulé', 60_000);
    expect(photographie(b())).toStrictEqual(avant);
  });
});
