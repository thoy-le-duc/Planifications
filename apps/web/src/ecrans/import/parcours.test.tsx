// @vitest-environment happy-dom
/**
 * Tests d'acceptation T14b — critère 1 : chaque fichier du jeu de T14
 * (packages/core/src/import/__fixtures__/) importé de bout en bout dans la ferme de l'import
 * (./test/ferme-import.ts), par le vrai écran rendu dans un DOM simulé, sur la base mémoire de
 * @planif/sync : déposer, dire ce que c'est, colonnes, valeurs, aperçu, importer. Puis ce qui
 * est écrit en base, table par table. Contrat : ./test/contrat.ts.
 *
 * Les fichiers passent DANS L'ORDRE, dans une seule ferme (les séries ont besoin des planches
 * du parcellaire, la seconde série retrouve en base ce que la première a écrit). Neuf fichiers
 * passent sans aucune correction (le ticket en demande quatre) : on ne touche que « Continuer »
 * et « Importer ». modele-a.csv demande quatre corrections (type, deux colonnes, une culture) ;
 * modele-b.csv, de même forme, passe ensuite sans correction grâce au modèle de la ferme.
 *
 * Le même parcours dans un vrai navigateur (Worker, lecteur Excel chargé à la demande, CPU ×4,
 * hors ligne) : apps/web/e2e/import.e2e.ts.
 */
import { describe, expect, it } from 'vitest';
import { validerItineraire, validerOccupation, validerSerie } from '@planif/core';
import { EMPLACEMENT, espece, ESPECE_CHOU, FAMILLE_PAR_NOM, FERME, ITINERAIRE, SAISON, ZONE } from './test/ferme-import.ts';
import {
  associer,
  champsChoisis,
  choisirType,
  continuer,
  decider,
  deposerEtLire,
  ecran,
  etape,
  fixture,
  harnais,
  importer,
  lignesImportees,
  lire,
  typeCoche,
  verifierLots,
  verifierOrdres,
  autreFichier,
  type Banc,
  type Ligne,
} from './test/harnais.ts';
import { LIBELLES_TYPES } from './test/contrat.ts';

const h = harnais();
const b = (): Banc => h.banc();

interface Corrections {
  readonly type?: keyof typeof LIBELLES_TYPES;
  readonly colonnes?: readonly (readonly [string, string])[];
  readonly valeurs?: readonly (readonly ['espece' | 'famille', string, string])[];
}

interface Passage {
  readonly statut: string;
  readonly corrections: number;
  /** Lignes nouvelles de chaque table (ids absents avant le passage). */
  readonly nouvelles: (table: string) => Ligne[];
}

/** Toutes les lignes d'une table, par id. */
const ids = (table: string): Set<string> => new Set(lire(b(), `SELECT id FROM "${table}"`).map((l) => String(l.id)));

const TABLES_SUIVIES = ['zone', 'emplacement', 'espece', 'famille', 'variete', 'itineraire', 'serie', 'occupation', 'saison', 'assolement', 'evenement', 'modification'];

/** Un fichier de bout en bout ; seules les corrections données sont faites (chacune compte). */
async function passer(nom: string, c: Corrections = {}): Promise<Passage> {
  const avant = Object.fromEntries(TABLES_SUIVIES.map((t) => [t, ids(t)]));
  b().remiseAZero();
  let corrections = 0;

  await deposerEtLire(nom, fixture(nom));
  expect(etape(), `${nom} : étape 2 après le dépôt`).toBe('type');
  if (c.type !== undefined) {
    await choisirType(c.type);
    corrections++;
  }
  await continuer();
  expect(etape(), `${nom} : étape 3`).toBe('colonnes');
  for (const [entete, champ] of c.colonnes ?? []) {
    await associer(entete, champ);
    corrections++;
  }
  await continuer();
  if (etape() === 'valeurs') {
    for (const [champ, valeur, choix] of c.valeurs ?? []) {
      await decider(champ, valeur, choix);
      corrections++;
    }
    await continuer();
  }
  expect(etape(), `${nom} : aperçu`).toBe('apercu');
  expect(b().transactions(), `${nom} : rien n’est écrit avant « Importer »`).toBe(0);
  const statut = await importer();
  // Moins de 500 écritures : un seul lot (une transaction, un seul envoi au serveur).
  expect(b().transactions(), `${nom} : « Importer » écrit en un seul lot`).toBe(1);
  verifierLots(b());
  verifierOrdres(b());
  const nouvelles = (table: string) => {
    const vus = avant[table] ?? new Set<string>();
    return lire(b(), `SELECT * FROM "${table}" ORDER BY id`).filter((l) => !vus.has(String(l.id)));
  };
  expect(nouvelles('evenement'), `${nom} : aucun événement`).toEqual([]);
  expect(nouvelles('modification'), `${nom} : rien dans modification`).toEqual([]);
  await autreFichier();
  return { statut, corrections, nouvelles };
}

const unique = (lignes: readonly Ligne[], message: string): Ligne => {
  expect(lignes, message).toHaveLength(1);
  const l = lignes[0];
  if (l === undefined) throw new Error(message);
  return l;
};

const emplacementDeCode = (code: string): Ligne =>
  unique(lire(b(), 'SELECT * FROM emplacement WHERE ferme_id = ? AND code = ? AND supprime_le IS NULL', [FERME, code]), `un emplacement actif « ${code} »`);
const zoneDeNom = (nom: string): Ligne => unique(lire(b(), 'SELECT * FROM zone WHERE ferme_id = ? AND nom = ? AND supprime_le IS NULL', [FERME, nom]), `une zone active « ${nom} »`);
const saisonDe = (annee: number): Ligne =>
  unique(lire(b(), 'SELECT * FROM saison WHERE ferme_id = ? AND nom = ? AND supprime_le IS NULL', [FERME, String(annee)]), `une saison ${String(annee)}`);

function typesIntervention(): { categorie: string; type: string }[] {
  return lire(b(), 'SELECT categorie, libelle FROM type_intervention WHERE supprime_le IS NULL').map((l) => ({ categorie: String(l.categorie), type: String(l.libelle) }));
}

function itineraireValide(l: Ligne): void {
  const r = validerItineraire({ ...l }, { typesIntervention: typesIntervention() });
  expect(r.ok, r.ok ? '' : `validerItineraire refuse ${String(l.id)} : ${r.erreur.message}`).toBe(true);
}

/** Série nouvelle valide (validerSerie), de la ferme, sur un itinéraire existant, avec son occupation valide. */
function serieValide(s: Ligne, occupations: readonly Ligne[]): void {
  const r = validerSerie({ ...s });
  expect(r.ok, r.ok ? '' : `validerSerie refuse ${String(s.id)} : ${r.erreur.message} (${String(r.erreur.champ)})`).toBe(true);
  if (!r.ok) return;
  expect(s.ferme_id).toBe(FERME);
  expect(s.statut).toBe('prevue');
  const it = lire(b(), 'SELECT * FROM itineraire WHERE id = ? AND (ferme_id = ? OR ferme_id IS NULL)', [s.itineraire_id, FERME]);
  expect(it, `itinéraire ${String(s.itineraire_id)} de la série`).toHaveLength(1);
  for (const o of occupations.filter((x) => x.serie_id === s.id)) {
    const ro = validerOccupation({ ...o }, r.valeur);
    expect(ro.ok, ro.ok ? '' : `validerOccupation refuse ${String(o.id)} : ${ro.erreur.message}`).toBe(true);
  }
}

interface SerieAttendue {
  readonly espece: string;
  readonly emplacement: string;
  readonly semis?: string;
  readonly plantation?: string;
  readonly debutRecolte?: string;
  readonly finRecolte?: string;
  readonly longueurM?: number;
}

/** La série nouvelle de cette espèce sur cet emplacement : dates du fichier, occupation, saison. */
function verifierSerie(p: Passage, a: SerieAttendue): void {
  const empl = emplacementDeCode(a.emplacement);
  const occupations = p.nouvelles('occupation').filter((o) => o.emplacement_id === empl.id);
  const series = p.nouvelles('serie').filter((s) => s.espece_id === a.espece && occupations.some((o) => o.serie_id === s.id));
  const s = unique(series, `une série nouvelle ${a.espece} sur ${a.emplacement}`);
  serieValide(s, occupations);
  const directe = a.plantation === undefined;
  if (a.semis !== undefined) expect(directe ? s.prevu_mise_en_place : s.prevu_semis_pepiniere, `${a.emplacement} : semis`).toBe(a.semis);
  if (a.plantation !== undefined) expect(s.prevu_mise_en_place, `${a.emplacement} : plantation`).toBe(a.plantation);
  if (directe) expect(s.prevu_semis_pepiniere, `${a.emplacement} : semis direct, pas de pépinière`).toBeNull();
  if (a.debutRecolte !== undefined) expect(s.prevu_debut_recolte, `${a.emplacement} : début de récolte`).toBe(a.debutRecolte);
  if (a.finRecolte !== undefined) expect(s.prevu_fin_recolte, `${a.emplacement} : fin de récolte`).toBe(a.finRecolte);
  if (a.longueurM !== undefined) expect(s.longueur_m, `${a.emplacement} : longueur`).toBe(a.longueurM);
  const annee = Number(String(s.prevu_mise_en_place).slice(0, 4));
  expect(s.saison_id, `${a.emplacement} : saison de la mise en place`).toBe(saisonDe(annee).id);
  const o = unique(
    occupations.filter((x) => x.serie_id === s.id),
    `une occupation de la série sur ${a.emplacement}`,
  );
  expect(o.ferme_id).toBe(FERME);
}

describe('T14b, critère 1 : le jeu de T14 importé de bout en bout', () => {
  it('dix fichiers dans l’ordre, dont neuf sans aucune correction ; ce qui est écrit, table par table', { timeout: 120_000 }, async () => {
    await h.ouvrir();
    const sansCorrection: string[] = [];

    // ── 1. parcellaire-anglais.csv : « North field » reprise, « Tunnel A » créée ─────────────
    {
      const p = await passer('parcellaire-anglais.csv');
      expect(lignesImportees(p.statut)).toBe(4);
      expect(zoneDeNom('North field').id, 'zone existante reprise, pas recréée').toBe(ZONE.north);
      const tunnel = zoneDeNom('Tunnel A');
      expect(tunnel.type_abri).toBe('tunnel');
      expect(p.nouvelles('zone').map((z) => z.nom)).toEqual(['Tunnel A']);
      for (const [code, zone, longueur, largeur] of [
        ['N1', ZONE.north, 30, 0.8],
        ['N2', ZONE.north, 30, 0.8],
        ['TA1', tunnel.id, 25.5, 1.2],
        ['TA2', tunnel.id, 25.5, 1.2],
      ] as const) {
        const e = emplacementDeCode(code);
        expect({ zone: e.zone_id, sorte: e.sorte, longueur: e.longueur_m, largeur: e.largeur_m, remplace: e.remplace }, code).toEqual({
          zone,
          sorte: 'planche',
          longueur,
          largeur,
          remplace: '[]',
        });
        expect(e.actif_du, `${code} : actif_du`).not.toBeNull();
      }
      expect(p.nouvelles('emplacement')).toHaveLength(4);
      if (p.corrections === 0) sansCorrection.push('parcellaire-anglais.csv');
    }

    // ── 2. parcellaire-3-niveaux-cp1252.csv : zone, chapelles, planches ─────────────────────
    {
      const p = await passer('parcellaire-3-niveaux-cp1252.csv');
      expect(lignesImportees(p.statut)).toBe(5);
      const serre = zoneDeNom('Serre multichapelle');
      const c1 = zoneDeNom('Chapelle 1');
      const c2 = zoneDeNom('Chapelle 2');
      const ilot = zoneDeNom('Îlot Pré-Clos');
      expect([serre.zone_parente_id, c1.zone_parente_id, c2.zone_parente_id, ilot.zone_parente_id]).toEqual([null, serre.id, serre.id, null]);
      expect(p.nouvelles('zone')).toHaveLength(4);
      for (const [code, zone, largeur] of [
        ['C1-P1', c1.id, 0.8],
        ['C1-P2', c1.id, 0.8],
        ['C2-P1', c2.id, 0.75],
        ['C2-P2', c2.id, 0.75],
        ['PC-01', ilot.id, 1.2],
      ] as const) {
        const e = emplacementDeCode(code);
        expect({ zone: e.zone_id, largeur: e.largeur_m }, code).toEqual({ zone, largeur });
      }
      expect(emplacementDeCode('PC-01').longueur_m).toBe(48);
      expect(emplacementDeCode('C1-P1').longueur_m).toBe(32.5);
      // Le type d'abri est sur la zone de la ligne ou sur sa parente.
      const abriDe = (zid: unknown): unknown[] => lire(b(), 'SELECT type_abri FROM zone WHERE id = ? OR id = (SELECT zone_parente_id FROM zone WHERE id = ?)', [zid, zid]).map((z) => z.type_abri);
      expect(abriDe(c1.id)).toContain('serre');
      expect(abriDe(ilot.id)).toContain('plein_champ');
      if (p.corrections === 0) sansCorrection.push('parcellaire-3-niveaux-cp1252.csv');
    }

    // ── 3. t15-emplacement.csv : l'export de T15 relu (planches et gouttière) ────────────────
    {
      const p = await passer('t15-emplacement.csv');
      expect(lignesImportees(p.statut)).toBe(3);
      expect(p.nouvelles('emplacement').map((e) => [e.code, e.sorte, e.longueur_m, e.nombre_places]).sort()).toEqual([
        ['HS-G01', 'gouttiere', 12, 96],
        ['T1-P01', 'planche', 30, null],
        ['T1-P02', 'planche', 25.5, null],
      ]);
      expect(p.nouvelles('zone'), 'deux zones (une par zone_id du fichier)').toHaveLength(2);
      expect(emplacementDeCode('T1-P01').zone_id).toBe(emplacementDeCode('T1-P02').zone_id);
      if (p.corrections === 0) sansCorrection.push('t15-emplacement.csv');
    }

    // ── 4. cultures-itineraires.csv : un itinéraire de la ferme par culture ─────────────────
    {
      const p = await passer('cultures-itineraires.csv');
      expect(lignesImportees(p.statut)).toBe(4);
      expect(p.nouvelles('espece'), 'les quatre cultures existent : aucune espèce créée').toEqual([]);
      const nouveaux = p.nouvelles('itineraire');
      expect(nouveaux).toHaveLength(4);
      for (const [nomEspece, mode, avantRecolte, fenetre] of [
        ['Laitue', 'plant_maison', 45, 21],
        ['Carotte', 'semis_direct', 90, 60],
        ['Tomate', 'plant_achete', 60, 90],
        ['Poireau', 'plant_maison', 120, 60],
      ] as const) {
        const it = unique(
          nouveaux.filter((i) => i.espece_id === espece(nomEspece)),
          `un itinéraire nouveau pour ${nomEspece}`,
        );
        expect(it.ferme_id).toBe(FERME);
        expect(it.mode).toBe(mode);
        const parametres = JSON.parse(String(it.parametres)) as Record<string, unknown>;
        expect({ a: parametres.dureeAvantRecolteJours, f: parametres.fenetreRecolteJours }, nomEspece).toEqual({ a: avantRecolte, f: fenetre });
        itineraireValide(it);
      }
      if (p.corrections === 0) sansCorrection.push('cultures-itineraires.csv');
    }

    // ── 5. assolement-passe.csv : saisons 2023 à 2025 créées, cibles = planches ─────────────
    {
      const p = await passer('assolement-passe.csv');
      expect(lignesImportees(p.statut)).toBe(4);
      expect(
        p
          .nouvelles('saison')
          .map((s) => [s.nom, s.debut, s.fin])
          .sort(),
      ).toEqual([
        ['2023', '2023-01-01', '2023-12-31'],
        ['2024', '2024-01-01', '2024-12-31'],
        ['2025', '2025-01-01', '2025-12-31'],
      ]);
      const lignes = p.nouvelles('assolement');
      expect(lignes).toHaveLength(4);
      const attendu = [
        [2024, 'TA1', 'Solanacées', espece('Tomate')],
        [2024, 'N1', 'Brassicacées', ESPECE_CHOU],
        [2025, 'N1', 'Astéracées', espece('Laitue')],
        [2023, 'N2', 'Cucurbitacées', espece('Courgette')],
      ] as const;
      for (const [annee, code, famille, esp] of attendu) {
        const a = unique(
          lignes.filter((l) => l.emplacement_id === emplacementDeCode(code).id && l.saison_id === saisonDe(annee).id),
          `assolement ${String(annee)} sur ${code}`,
        );
        expect({ ferme: a.ferme_id, zone: a.zone_id, famille: a.famille_id, espece: a.espece_id, nature: a.nature }).toEqual({
          ferme: FERME,
          zone: null,
          famille: FAMILLE_PAR_NOM[famille],
          espece: esp,
          nature: 'passe_importe',
        });
        expect(a.source_import, 'source_import renseignée').not.toBeNull();
      }
      if (p.corrections === 0) sansCorrection.push('assolement-passe.csv');
    }

    // ── 6. series-semaines.tsv : semaines 2027, erreurs et doublon du fichier non écrits ─────
    {
      const p = await passer('series-semaines.tsv');
      expect(lignesImportees(p.statut), 'lignes 2, 3 (Batavia blonde → Batavia proposé) et 4').toBe(3);
      verifierSerie(p, { espece: espece('Laitue'), emplacement: 'N1', semis: '2027-03-08', plantation: '2027-04-05', debutRecolte: '2027-05-17', longueurM: 30 });
      verifierSerie(p, { espece: espece('Batavia'), emplacement: 'N2', semis: '2027-03-22', plantation: '2027-04-19', debutRecolte: '2027-05-31', longueurM: 30 });
      verifierSerie(p, { espece: espece('Tomate'), emplacement: 'TA1', plantation: '2027-05-03', debutRecolte: '2027-07-12', longueurM: 25.5 });
      expect(p.nouvelles('serie'), 'ni la ligne 5 (longueur « abc »), ni le doublon, ni le poireau en S53').toHaveLength(3);
      for (const it of p.nouvelles('itineraire')) itineraireValide(it);
      if (p.corrections === 0) sansCorrection.push('series-semaines.tsv');
    }

    // ── 7. series-titre.xlsx : ligne de titre, dates Excel ───────────────────────────────────
    {
      const p = await passer('series-titre.xlsx');
      expect(lignesImportees(p.statut)).toBe(3);
      verifierSerie(p, { espece: espece('Radis'), emplacement: 'N3', semis: '2027-03-15', debutRecolte: '2027-04-19', finRecolte: '2027-05-10', longueurM: 30 });
      verifierSerie(p, { espece: espece('Épinard'), emplacement: 'N4', semis: '2027-03-15', debutRecolte: '2027-05-10', finRecolte: '2027-06-01', longueurM: 15 });
      verifierSerie(p, { espece: espece('Tomate'), emplacement: 'TA2', plantation: '2027-05-10', debutRecolte: '2027-07-15', longueurM: 25.5 });
      if (p.corrections === 0) sansCorrection.push('series-titre.xlsx');
    }

    // ── 8. series-anglais.csv : deux lignes déjà dans la ferme (doublons contre la base) ─────
    {
      const p = await passer('series-anglais.csv');
      expect(lignesImportees(p.statut), 'radis N3 et tomate TA2 sont déjà en base (series-titre.xlsx)').toBe(1);
      verifierSerie(p, { espece: espece('Laitue'), emplacement: 'N1', semis: '2027-03-01', plantation: '2027-03-29', debutRecolte: '2027-05-20', finRecolte: '2027-06-10' });
      expect(p.nouvelles('serie')).toHaveLength(1);
      if (p.corrections === 0) sansCorrection.push('series-anglais.csv');
    }

    // ── 9. modele-a.csv : type, deux colonnes et une culture à corriger ─────────────────────
    {
      const p = await passer('modele-a.csv', {
        type: 'series',
        colonnes: [
          ['Semaine de plantation', 'date_plantation'],
          ['Mètres', 'longueur_m'],
        ],
        valeurs: [['espece', 'Salade du jardin', espece('Laitue')]],
      });
      expect(p.corrections).toBe(4);
      expect(lignesImportees(p.statut)).toBe(2);
      verifierSerie(p, { espece: espece('Laitue'), emplacement: 'GP1', plantation: '2027-04-12', longueurM: 40 });
      verifierSerie(p, { espece: espece('Tomate'), emplacement: 'GP2', plantation: '2027-05-10', longueurM: 40 });
      // Sans date de récolte dans le fichier : les durées de l'itinéraire de l'espèce.
      const gp1 = p.nouvelles('serie').find((s) => s.prevu_mise_en_place === '2027-04-12');
      const laitue = JSON.parse(String(lire(b(), 'SELECT parametres FROM itineraire WHERE id = ?', [ITINERAIRE.laitue])[0]?.parametres)) as { dureeAvantRecolteJours: number };
      expect(laitue.dureeAvantRecolteJours).toBe(45);
      expect(gp1?.prevu_debut_recolte, 'GP1 : 45 jours après la plantation (itinéraire « Laitue »)').toBe('2027-05-27');
    }

    // ── 10. modele-b.csv : même forme, colonnes dans un autre ordre → le modèle s'applique ───
    {
      await deposerEtLire('modele-b.csv', fixture('modele-b.csv'));
      expect(typeCoche(), 'type repris du modèle de la ferme').toBe(LIBELLES_TYPES.series);
      await continuer();
      expect(ecran().querySelector('[data-testid="modele-applique"]'), 'modèle appliqué, signalé').not.toBeNull();
      expect(champsChoisis()).toEqual(['emplacement', '', 'espece', 'longueur_m', 'date_plantation']);
      // Fermer puis rouvrir l'écran : le modèle de la ferme survit, et le parcours reprend sans correction.
      await rouvrir();
      const p = await passer('modele-b.csv');
      expect(p.corrections).toBe(0);
      expect(lignesImportees(p.statut)).toBe(3);
      verifierSerie(p, { espece: espece('Laitue'), emplacement: 'GP3', plantation: '2027-04-26', longueurM: 35 });
      verifierSerie(p, { espece: espece('Poireau'), emplacement: 'GP4', plantation: '2027-05-31', longueurM: 40 });
      verifierSerie(p, { espece: espece('Laitue'), emplacement: 'GP5', plantation: '2027-07-26', longueurM: 20 });
      sansCorrection.push('modele-b.csv');
    }

    expect(sansCorrection, 'au moins quatre fichiers sans correction manuelle').toEqual([
      'parcellaire-anglais.csv',
      'parcellaire-3-niveaux-cp1252.csv',
      't15-emplacement.csv',
      'cultures-itineraires.csv',
      'assolement-passe.csv',
      'series-semaines.tsv',
      'series-titre.xlsx',
      'series-anglais.csv',
      'modele-b.csv',
    ]);
    // Les planches de la ferme d'avant n'ont pas bougé.
    expect(emplacementDeCode('GP1').id).toBe(EMPLACEMENT.gp1);
    expect(lire(b(), 'SELECT COUNT(*) AS n FROM saison WHERE ferme_id = ? AND nom = ?', [FERME, '2027'])[0]?.n, 'saison 2027 reprise, pas recréée').toBe(1);
    expect(saisonDe(2027).id).toBe(SAISON.a2027);
  });
});

/** Ferme l'écran sans importer (démonté) et le rouvre sur la même base : étape 1. */
async function rouvrir(): Promise<void> {
  h.demonter();
  await h.ouvrir();
}
