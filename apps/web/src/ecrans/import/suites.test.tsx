// @vitest-environment happy-dom
/**
 * Tests d'acceptation T14e — import : suites de T14b (docs/backlog/T14e-import-series.md).
 * Contrat : ./test/contrat-suites.ts. Vrai écran, DOM simulé, base mémoire (./test/harnais.ts).
 *
 *   - critère 1 : une annulation refusée par le serveur (refus PATCH redescendu dans
 *     refus_synchro, lignes revenues actives) est montrée sur la ligne de l'import dans
 *     « Imports récents », en clair ; l'import redevient annulable, et l'annuler retire vraiment ;
 *   - critère 2 (décision du chef : l'historique reste en localStorage) : navigateur plein au
 *     moment de noter l'import → l'import est écrit et l'écran le dit ;
 *   - critère 3 : `actif_du` des emplacements créés et bornes des saisons créées, à l'aperçu,
 *     en dates françaises.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parametresRefus, SQL_INSERER_REFUS, type LigneRefusLocale } from '../ferme/test/refus.ts';
import { EMPLACEMENT, FERME, UTILISATEUR } from './test/ferme-import.ts';
import {
  alertes,
  attendreDurant,
  autreFichier,
  bouton,
  continuer,
  deposerEtLire,
  ecran,
  etape,
  fixture,
  harnais,
  importer,
  lignesImportees,
  lire,
  photographie,
  texte,
  toucher,
  utf8,
  type Banc,
} from './test/harnais.ts';
import { ATTRIBUT_ANNULATION_REFUSEE, ATTRIBUT_DATE_DEDUITE, MESSAGE_AUTRE_PARTIE_REFUSEE, MESSAGE_PLANCHE_OCCUPEE } from './test/contrat-suites.ts';

const h = harnais();
const b = (): Banc => h.banc();

afterEach(() => {
  vi.unstubAllGlobals();
});

const csv = (lignes: readonly (readonly string[])[]): Uint8Array => utf8(`${lignes.map((l) => l.join(';')).join('\n')}\n`);

/** Jusqu'à l'aperçu sans correction (types, colonnes et valeurs proposés). */
async function jusquApercu(nom: string, octets: Uint8Array): Promise<void> {
  await deposerEtLire(nom, octets);
  expect(etape(), `${nom} : étape 2`).toBe('type');
  await continuer();
  await continuer();
  if (etape() === 'valeurs') await continuer();
  expect(etape(), `${nom} : aperçu`).toBe('apercu');
}

async function importerSansCorrection(nom: string, octets: Uint8Array = fixture(nom)): Promise<string> {
  await jusquApercu(nom, octets);
  return importer();
}

const importsPasses = (): HTMLElement[] => [...ecran().querySelectorAll<HTMLElement>('[data-testid="import-passe"]')];
const passe = (id: string): HTMLElement | undefined => importsPasses().find((x) => x.dataset.import === id);
const refusAffiche = (id: string): Element | null => passe(id)?.querySelector(`[data-testid="${ATTRIBUT_ANNULATION_REFUSEE}"]`) ?? null;

const MOTIF_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ── Critère 1 ────────────────────────────────────────────────────────────────────────────────

/** Ce que le serveur renvoie quand il refuse l'annulation du parcellaire (planche N1 occupée). */
interface Scene {
  /** Id de l'import dans « Imports récents ». */
  readonly importId: string;
  /** Lignes créées par l'import, « table » → ids. */
  readonly creees: readonly { readonly table: 'emplacement' | 'zone'; readonly id: string }[];
  /** Photographie des lignes actives avant l'import. */
  readonly depart: ReturnType<typeof photographie>;
}

/** parcellaire-anglais.csv importé (N1, N2, TA1, TA2 et la zone « Tunnel A » créés), puis annulé sur le téléphone. */
async function importerPuisAnnuler(): Promise<Scene> {
  await h.ouvrir();
  const depart = photographie(b());
  expect(lignesImportees(await importerSansCorrection('parcellaire-anglais.csv'))).toBe(4);
  await toucher(bouton('Annuler cet import', ecran()));
  await attendreDurant(() => /annulé/i.test(texte(ecran().querySelector('[role="status"]'))), 'annulé sur le téléphone');
  await autreFichier();
  const ligne = importsPasses()[0];
  const importId = ligne?.dataset.import ?? '';
  expect(importId, 'import dans « Imports récents »').not.toBe('');
  expect(ligne?.dataset.etat).toBe('annule');
  const emplacements = lire(b(), "SELECT id, code FROM emplacement WHERE ferme_id = ? AND code IN ('N1', 'N2', 'TA1', 'TA2') ORDER BY code", [FERME]);
  expect(emplacements.map((e) => e.code)).toEqual(['N1', 'N2', 'TA1', 'TA2']);
  const zones = lire(b(), "SELECT id FROM zone WHERE ferme_id = ? AND nom = 'Tunnel A'", [FERME]);
  expect(zones).toHaveLength(1);
  return {
    importId,
    depart,
    creees: [...emplacements.map((e) => ({ table: 'emplacement' as const, id: String(e.id) })), ...zones.map((z) => ({ table: 'zone' as const, id: String(z.id) }))],
  };
}

let numeroRefus = 0;
function refus(table: string, ligneId: string, message: string): LigneRefusLocale {
  numeroRefus++;
  return {
    id: `0192f0c1-14b0-7000-9000-${numeroRefus.toString(16).padStart(12, '0')}`,
    utilisateur_id: UTILISATEUR,
    ferme_id: FERME,
    nom_table: table,
    ligne_id: ligneId,
    operation: 'PATCH',
    motif: 'ecriture_invalide',
    message,
    cree_le: '2027-01-15T08:05:00.000Z',
  };
}

/**
 * La synchro redescend la réponse du serveur : le lot d'annulation est refusé en entier (N1
 * occupée, les autres « une autre partie de cette saisie est refusée »), et les lignes, gardées
 * par le serveur, reviennent actives sur le téléphone.
 */
function serveurRefuseLAnnulation(s: Scene): void {
  for (const l of s.creees) b().base.recevoir(`UPDATE ${l.table} SET supprime_le = NULL WHERE id = ?`, [l.id]);
  const n1 = lire(b(), "SELECT id FROM emplacement WHERE ferme_id = ? AND code = 'N1'", [FERME])[0]?.id;
  for (const l of s.creees) {
    const r = refus(l.table, l.id, l.id === n1 ? MESSAGE_PLANCHE_OCCUPEE : MESSAGE_AUTRE_PARTIE_REFUSEE);
    b().base.recevoir(SQL_INSERER_REFUS, parametresRefus(r));
  }
}

describe('T14e, critère 1 : une annulation refusée par le serveur est montrée dans l’historique de l’import', () => {
  it('le refus arrive écran ouvert : la ligne de l’import le dit en clair (pourquoi, quelle planche), sans jargon ; il reste après avoir rouvert l’écran', { timeout: 60_000 }, async () => {
    const s = await importerPuisAnnuler();
    serveurRefuseLAnnulation(s);
    await attendreDurant(() => refusAffiche(s.importId) !== null, `data-testid="${ATTRIBUT_ANNULATION_REFUSEE}" sur la ligne de l’import`, 5_000);

    const verifier = (): void => {
      const t = texte(refusAffiche(s.importId));
      expect(t, 'dit le refus').toMatch(/refus/i);
      expect(t, 'dit pourquoi : la raison du serveur pour la ligne fautive').toMatch(/occupé par une culture/i);
      expect(t, 'nomme la planche comme le maraîcher la connaît').toMatch(/\bN1\b/);
      expect(t, 'pas de code de motif').not.toMatch(/ecriture_invalide/);
      expect(t, 'pas d’opération').not.toMatch(/PATCH/);
      expect(t, 'pas d’identifiant').not.toMatch(MOTIF_UUID);
      const ligne = passe(s.importId);
      expect(ligne?.dataset.etat, 'plus présenté comme annulé : le serveur a gardé les lignes').not.toBe('annule');
      expect(
        [...(ligne?.querySelectorAll('button') ?? [])].some((x) => texte(x) === 'Annuler cet import'),
        '« Annuler cet import » de nouveau proposé',
      ).toBe(true);
    };
    verifier();

    h.demonter();
    await h.ouvrir();
    expect(refusAffiche(s.importId), 'refus toujours montré après avoir rouvert l’écran').not.toBeNull();
    verifier();
  });

  it('« Annuler cet import » à nouveau, la planche libérée : les lignes revenues sont vraiment retirées', { timeout: 60_000 }, async () => {
    const s = await importerPuisAnnuler();
    serveurRefuseLAnnulation(s);
    h.demonter();
    await h.ouvrir();
    const ligne = passe(s.importId);
    if (ligne === undefined) throw new Error('import absent de « Imports récents »');
    expect(refusAffiche(s.importId)).not.toBeNull();
    b().remiseAZero();
    await toucher(bouton('Annuler cet import', ligne));
    await attendreDurant(() => passe(s.importId)?.dataset.etat === 'annule' || alertes().length > 0, 'nouvelle annulation traitée');
    expect(alertes()).toEqual([]);
    expect(b().transactions(), 'de nouvelles suppressions douces sont écrites (le lot avait déjà été annulé une fois)').toBeGreaterThanOrEqual(1);
    for (const l of s.creees) expect(lire(b(), `SELECT supprime_le FROM ${l.table} WHERE id = ?`, [l.id])[0]?.supprime_le, `${l.table} ${l.id} retirée`).not.toBeNull();
    // Les refus insérés par le test (le serveur simulé) restent dans refus_synchro : le téléphone
    // n'y écrit que `archive_le`. On compare donc la ferme hors de cette table.
    expect({ ...photographie(b()), refus_synchro: [] }, 'la ferme revient à son état d’avant l’import').toStrictEqual({ ...s.depart, refus_synchro: [] });
  });

  it('rien sur un import jamais annulé, ni pour un refus qui vise une ligne hors de l’import', { timeout: 60_000 }, async () => {
    await h.ouvrir();
    expect(lignesImportees(await importerSansCorrection('parcellaire-anglais.csv'))).toBe(4);
    await autreFichier();
    const actif = importsPasses()[0]?.dataset.import ?? '';
    expect(actif).not.toBe('');
    const n1 = String(lire(b(), "SELECT id FROM emplacement WHERE ferme_id = ? AND code = 'N1'", [FERME])[0]?.id);
    // Une modification de N1 refusée (pas une annulation : l'import n'a jamais été annulé).
    b().base.recevoir(SQL_INSERER_REFUS, parametresRefus(refus('emplacement', n1, MESSAGE_PLANCHE_OCCUPEE)));

    // Un second import, annulé ; refus d'une planche qui existait avant (pas de cet import).
    expect(lignesImportees(await importerSansCorrection('parcellaire-3-niveaux-cp1252.csv'))).toBe(5);
    await toucher(bouton('Annuler cet import', ecran()));
    await attendreDurant(() => /annulé/i.test(texte(ecran().querySelector('[role="status"]'))), 'second import annulé');
    await autreFichier();
    const annule = importsPasses()[0]?.dataset.import ?? '';
    expect(annule).not.toBe(actif);
    b().base.recevoir(SQL_INSERER_REFUS, parametresRefus(refus('emplacement', EMPLACEMENT.n3, MESSAGE_PLANCHE_OCCUPEE)));

    h.demonter();
    await h.ouvrir();
    expect(importsPasses()).toHaveLength(2);
    expect(refusAffiche(actif), 'import jamais annulé : pas de refus d’annulation').toBeNull();
    expect(refusAffiche(annule), 'refus d’une ligne hors de l’import : rien sur cet import').toBeNull();
    expect(passe(annule)?.dataset.etat).toBe('annule');
  });
});

// ── Critère 2 ────────────────────────────────────────────────────────────────────────────────

/** localStorage dont l'historique d'import est plein (setItem lève QuotaExceededError) ; le reste marche. */
function stockagePleinPourLHistorique(): Storage {
  const valeurs = new Map<string, string>();
  return {
    get length() {
      return valeurs.size;
    },
    key: (i: number) => [...valeurs.keys()][i] ?? null,
    getItem: (c: string) => valeurs.get(c) ?? null,
    setItem: (c: string, v: string) => {
      if (c.startsWith('planif:import:historique')) throw new DOMException('Quota dépassé', 'QuotaExceededError');
      valeurs.set(c, v);
    },
    removeItem: (c: string) => {
      valeurs.delete(c);
    },
    clear: () => {
      valeurs.clear();
    },
  };
}

describe('T14e, critère 2 : historique en localStorage, navigateur plein', () => {
  it('l’historique ne peut pas être noté : l’import est écrit quand même et l’écran le dit clairement', { timeout: 60_000 }, async () => {
    vi.stubGlobal('localStorage', stockagePleinPourLHistorique());
    await h.ouvrir();
    await jusquApercu('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    const imp = [...ecran().querySelectorAll<HTMLElement>('button')].find((x) => texte(x).startsWith('Importer') && texte(x) !== 'Importer un autre fichier');
    if (imp === undefined) throw new Error('bouton « Importer » absent');
    await toucher(imp);
    await attendreDurant(() => etape() === 'fini', 'import terminé malgré le stockage plein');
    expect(lignesImportees(texte(ecran().querySelector('[role="status"]'))), 'l’import est fait').toBe(4);
    expect(alertes().join(' '), 'l’écran dit que le stockage est plein').toMatch(/plein/i);
    expect(alertes().join(' '), 'et que l’import, lui, est fait').toMatch(/import/i);
    expect(lire(b(), "SELECT COUNT(*) AS n FROM emplacement WHERE ferme_id = ? AND code IN ('N1', 'N2', 'TA1', 'TA2') AND supprime_le IS NULL", [FERME])[0]?.n, 'les 4 planches sont en base').toBe(4);
  });
});

// ── Critère 3 ────────────────────────────────────────────────────────────────────────────────

const ESPACE = '[\\s\\u00a0\\u202f]+';
/** « 1 janv. 2027 », « 1er janvier 2027 ». */
const premierJanvier = (annee: number): RegExp => new RegExp(`\\b1(er)?${ESPACE}janv(\\.|ier)${ESPACE}${String(annee)}\\b`, 'i');
/** « 31 déc. 2027 », « 31 décembre 2027 ». */
const trenteEtUnDecembre = (annee: number): RegExp => new RegExp(`\\b31${ESPACE}déc(\\.|embre)${ESPACE}${String(annee)}\\b`, 'i');
const ISO_JOUR = /\b\d{4}-\d{2}-\d{2}\b/;

const datesDeduites = (sorte: 'actif-du' | 'saison'): HTMLElement[] => [
  ...ecran().querySelectorAll<HTMLElement>(`[data-testid="${ATTRIBUT_DATE_DEDUITE}"][data-deduite="${sorte}"]`),
];

describe('T14e, critère 3 : dates déduites montrées à l’aperçu', () => {
  it('parcellaire : « actif du 1 janv. 2027 » pour les 4 emplacements créés, en français ; pas de saison', { timeout: 60_000 }, async () => {
    await h.ouvrir();
    await jusquApercu('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    const actifs = datesDeduites('actif-du');
    expect(actifs, 'une seule date actif_du pour les 4 emplacements').toHaveLength(1);
    const t = texte(actifs[0]);
    expect(t, 'date en français').toMatch(premierJanvier(2027));
    expect(t, 'pas de date AAAA-MM-JJ').not.toMatch(ISO_JOUR);
    expect(t, 'nombre d’emplacements créés avec cette date').toMatch(/\b4\b/);
    expect(datesDeduites('saison'), 'parcellaire : aucune saison créée').toEqual([]);
    expect(lignesImportees(await importer())).toBe(4);
    const ecrites = lire(b(), "SELECT DISTINCT actif_du FROM emplacement WHERE ferme_id = ? AND code IN ('N1', 'N2', 'TA1', 'TA2')", [FERME]);
    expect(ecrites.map((e) => e.actif_du), 'la date montrée est celle écrite').toEqual(['2027-01-01']);
  });

  it('parcellaire préparé en octobre (saison suivante) : la date montrée suit l’année écrite (1 janv. 2028)', { timeout: 60_000 }, async () => {
    await h.ouvrir(FERME, new Date('2027-10-01T08:00:00.000Z'));
    await jusquApercu('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    const actifs = datesDeduites('actif-du');
    expect(actifs).toHaveLength(1);
    expect(texte(actifs[0])).toMatch(premierJanvier(2028));
    expect(lignesImportees(await importer())).toBe(4);
    const ecrites = lire(b(), "SELECT DISTINCT actif_du FROM emplacement WHERE ferme_id = ? AND code IN ('N1', 'N2', 'TA1', 'TA2')", [FERME]);
    expect(ecrites.map((e) => e.actif_du)).toEqual(['2028-01-01']);
  });

  it('séries : la saison 2028 créée montrée avec son début et sa fin ; 2027, déjà dans la ferme, pas montrée', { timeout: 60_000 }, async () => {
    await h.ouvrir();
    await jusquApercu(
      'hiver.csv',
      csv([
        ['Culture', 'Semis', 'Plantation', 'Début récolte', 'Longueur (m)'],
        ['Tomate', 'S40', 'S2', 'S20', '20'],
        ['Laitue', 'S10', 'S14', 'S20', '20'],
      ]),
    );
    const saisons = datesDeduites('saison');
    expect(saisons.map((s) => s.dataset.saison), 'seule la saison créée').toEqual(['2028']);
    const t = texte(saisons[0]);
    expect(t).toContain('2028');
    expect(t, 'début en français').toMatch(premierJanvier(2028));
    expect(t, 'fin en français').toMatch(trenteEtUnDecembre(2028));
    expect(t, 'pas de date AAAA-MM-JJ').not.toMatch(ISO_JOUR);
    expect(datesDeduites('actif-du'), 'aucun emplacement créé').toEqual([]);
    expect(lignesImportees(await importer())).toBe(2);
    expect(lire(b(), 'SELECT debut, fin FROM saison WHERE ferme_id = ? AND nom = ?', [FERME, '2028']), 'bornes montrées = bornes écrites').toEqual([{ debut: '2028-01-01', fin: '2028-12-31' }]);
  });

  it('assolement passé : chaque saison créée (2023, 2024, 2025) avec ses bornes', { timeout: 60_000 }, async () => {
    await h.ouvrir();
    expect(lignesImportees(await importerSansCorrection('parcellaire-anglais.csv'))).toBe(4);
    await autreFichier();
    await jusquApercu('assolement-passe.csv', fixture('assolement-passe.csv'));
    const saisons = datesDeduites('saison');
    expect(saisons.map((s) => s.dataset.saison).sort()).toEqual(['2023', '2024', '2025']);
    for (const s of saisons) {
      const annee = Number(s.dataset.saison);
      const t = texte(s);
      expect(t, `saison ${String(annee)} : début`).toMatch(premierJanvier(annee));
      expect(t, `saison ${String(annee)} : fin`).toMatch(trenteEtUnDecembre(annee));
      expect(t).not.toMatch(ISO_JOUR);
    }
  });

  it('rien de déduit (série de 2027 sans planche) : aucune date déduite montrée', { timeout: 60_000 }, async () => {
    await h.ouvrir();
    await jusquApercu(
      'printemps.csv',
      csv([
        ['Culture', 'Semis', 'Plantation', 'Début récolte', 'Longueur (m)'],
        ['Laitue', 'S10', 'S14', 'S20', '20'],
      ]),
    );
    expect(ecran().querySelectorAll(`[data-testid="${ATTRIBUT_DATE_DEDUITE}"]`)).toHaveLength(0);
  });
});
