/**
 * Tests d'acceptation T13o — « Fait » unique : contrôle d'après le journal d'envoi (`ps_crud`).
 *
 * Constat (relecture T13j) : le contrôle « déjà fait » d'après écriture (porte.ts,
 * `ecrireControle`) repère les lignes nouvelles par `rowid > max(rowid)` de `ps_data__evenement`.
 * Il ne voit donc pas :
 *   - un UPDATE qui transforme une ligne existante en « Fait » déjà fait (`remplace_sorte` mis à
 *     NULL, `detail` ou culture modifiés) : aucune ligne nouvelle ;
 *   - un DELETE de la dernière ligne suivi d'un INSERT dans la même transaction : SQLite réutilise
 *     le rowid, la ligne insérée n'est pas « au-delà » du maximum d'avant ;
 * et il refuse à tort un « Fait » et sa correction écrits dans la même transaction.
 *
 * Contrat attendu (règles du ticket) : la porte contrôle d'après `ps_crud` (id AUTOINCREMENT,
 * jamais réutilisé) : chaque opération PUT ou PATCH sur `evenement` ajoutée par la transaction,
 * ligne relue en entier par son id ; un « Fait » (faitDeLigne) qui en sort doit être unique en
 * vigueur, sinon DejaFait et rien n'est écrit (ni le journal, ni la file d'envoi). Un « Fait »
 * dont la transaction écrit aussi la correction n'est pas un doublon de sa propre correction.
 *
 * Banc : la base locale telle que PowerSync la range, AVEC sa file d'envoi
 * (./test/base-powersync-crud.ts : tables JSON `ps_data__*`, vues, index, déclencheurs qui
 * écrivent dans `ps_crud`), vraie porte, horloge qui avance d'une seconde à chaque lecture.
 *
 *   C0  banc : une écriture par la vue ajoute PUT / PATCH / DELETE à ps_crud ; l'id n'est jamais
 *       réutilisé, le rowid de ps_data__evenement l'est (le trou que T13o ferme) ;
 *   U1  UPDATE qui met remplace_sorte à NULL (une correction devient un original déjà fait),
 *       par porte.ecrire → DejaFait, rien n'est écrit ;
 *   U2  UPDATE du detail (semis → plantation déjà faite), par porte.ecrire → DejaFait ;
 *   U3  UPDATE de la culture (série B → série A, plantation déjà faite) → DejaFait ;
 *   U4  UPDATE du detail par ecrireEnsemble (avec un vérificateur quelconque) → DejaFait ;
 *   U5  UPDATE du detail d'une intervention : elle solde un travail déjà soldé → DejaFait ;
 *   R1  DELETE de la dernière ligne + INSERT d'un « Fait » déjà fait, même transaction, rowid
 *       réutilisé (nouvel id) → DejaFait, rien n'est écrit ;
 *   R2  même chose, l'INSERT reprenant l'id de la ligne supprimée ;
 *   K1  « Fait » + sa correction de date dans la même transaction (ecrireEnsemble) → écrits ;
 *       le travail reste fait ensuite ;
 *   K2  même chose en un seul INSERT de deux lignes par porte.ecrire → écrits ;
 *   K3  témoin : « Fait » déjà fait + sa correction dans la même transaction → DejaFait ;
 *   N1  restent permis en SQL brut : récolte, observation, UPDATE de note (y compris sur un
 *       « Fait » unique) ;
 *   N2  chemins de l'écran (marquerFait, noterRecolte, changerDate) : écrits, et le second
 *       marquerFait rend DejaFait ;
 *   N3  INSERT direct dans ps_data__evenement d'un « Fait » déjà fait (aucune ligne ps_crud) :
 *       toujours refusé (fait-unique-ps-data.test.ts, PS2) ;
 *   F1  isolement : un UPDATE qui fait d'une ligne un « Fait » identique à celui d'une AUTRE
 *       ferme est accepté, dans les deux sens.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, DejaFait, SCHEMA_LOCAL, type PorteDonnees, type SaisieEvenement, type VerificationEcriture } from '@planif/sync';
import type { DateCalendaire, Id } from '@planif/core';
import { changerDate, marquerFait, noterRecolte, type ContexteEcriture } from './ecritures.ts';
import type { Culture, EvenementLu } from './calculs.ts';
import { creerBasePowerSyncCrud, type BasePowerSyncCrud } from './test/base-powersync-crud.ts';
import type { SchemaJson } from './test/base-powersync.ts';

const UTILISATEUR = '0192f0c1-13e0-7000-8000-000000000001' as Id<'Utilisateur'>;
const FERME = '0192f0c1-13e0-7000-8000-000000000002' as Id<'Ferme'>;
const AUTRE_FERME = '0192f0c1-13e0-7000-8000-000000000003' as Id<'Ferme'>;
const SERIE_A = '0192f0c1-13e0-7000-8000-000000000020' as Id<'Serie'>;
const SERIE_B = '0192f0c1-13e0-7000-8000-000000000021' as Id<'Serie'>;
const ESPECE = '0192f0c1-13e0-7000-8000-000000000030';
const AUJOURDHUI = '2026-10-01' as DateCalendaire;
const OCCURRENCE = '2026-09-28' as DateCalendaire;
const AUTRE_OCCURRENCE = '2026-10-12' as DateCalendaire;
const NOUVEL_ID = '0192f0c1-13e0-7000-8000-0000000000e0';

const SCHEMA = SCHEMA_LOCAL.toJSON() as SchemaJson;

let base: BasePowerSyncCrud;
let instant: number;
let porte: PorteDonnees;

const maintenant = (): Date => new Date((instant += 1_000));
const porteDe = (fermeId: Id<'Ferme'>): PorteDonnees => creerPorte(base, { utilisateurId: UTILISATEUR, fermeId, maintenant });

beforeEach(() => {
  base = creerBasePowerSyncCrud(SCHEMA);
  instant = Date.parse('2026-10-01T06:00:00.000Z');
  porte = porteDe(FERME);
});

afterEach(() => {
  base.fermer();
});

type Etape = 'semis_pepiniere' | 'plantation';

const commun = (serieId: Id<'Serie'>, date: DateCalendaire = AUJOURDHUI) => ({
  date,
  source: 'agent' as const,
  culture: { sorte: 'serie' as const, serieId },
  emplacementIds: [],
  note: null,
  photos: [],
  remplaceEvenement: null,
});

const realise = (serieId: Id<'Serie'>, etape: Etape): SaisieEvenement => ({ ...commun(serieId), type: 'realise', detail: { etape, quantiteReelle: null } });
const desherbage = (serieId: Id<'Serie'>, occurrenceVisee: DateCalendaire): SaisieEvenement => ({
  ...commun(serieId),
  type: 'intervention',
  detail: { categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee },
});
const observation = (serieId: Id<'Serie'>): SaisieEvenement => ({ ...commun(serieId), type: 'observation', detail: { nature: 'ravageur', gravite: 'faible' } });
const correction = (s: SaisieEvenement, evenementId: Id<'Evenement'>, date: DateCalendaire): SaisieEvenement => ({
  ...s,
  date,
  remplaceEvenement: { sorte: 'correction', evenementId },
});

/** Vérificateur qui ne vérifie rien (le contrôle d'après écriture protège seul). */
const VERIFICATEUR_VIDE: VerificationEcriture = () => Promise.resolve();

const nombreEvenements = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM evenement')[0]?.n ?? -1;
const nombreCrud = (): number => base.crud().length;
const ligne = (id: string): Readonly<Record<string, unknown>> | undefined =>
  base.lireDirect<Readonly<Record<string, unknown>>>('SELECT * FROM evenement WHERE id = ?', [id])[0];
const rowid = (id: string): number | undefined => base.lireDirect<{ r: number }>('SELECT rowid AS r FROM ps_data__evenement WHERE id = ?', [id])[0]?.r;

/** Photo de ce qui compte pour « rien n'est écrit » : le journal entier et la file d'envoi. */
const etat = () => ({
  journal: base.lireDirect<Readonly<Record<string, unknown>>>('SELECT * FROM evenement ORDER BY id'),
  crud: nombreCrud(),
});

async function attendreDejaFait(p: Promise<unknown>, message: string): Promise<void> {
  let resultat: unknown;
  try {
    resultat = await p;
  } catch (e) {
    expect(e, `${message} : rejet DejaFait (reçu : ${String(e)})`).toBeInstanceOf(DejaFait);
    return;
  }
  expect.fail(`${message} : rejet DejaFait attendu, l’écriture a réussi (rendu : ${String(resultat)})`);
}

/** Refus DejaFait, et ni le journal ni la file d'envoi n'ont bougé. */
async function refuseSansRienEcrire(p: () => Promise<unknown>, message: string): Promise<void> {
  const avant = etat();
  await attendreDejaFait(p(), message);
  expect(etat(), `${message} : rien n’est écrit (journal et ps_crud inchangés)`).toEqual(avant);
}

const DETAIL_PLANTATION = JSON.stringify({ etape: 'plantation', quantiteReelle: null });

// ── Banc ─────────────────────────────────────────────────────────────────────────────────────

describe('T13o, banc : la file d’envoi ps_crud du double', () => {
  it('C0 : PUT, PATCH (colonnes changées), DELETE ; id de ps_crud jamais réutilisé, rowid de ps_data__evenement réutilisé', async () => {
    const id = await porte.saisirEvenement(observation(SERIE_A));
    const r = rowid(id);
    await porte.ecrire('UPDATE evenement SET note = ? WHERE id = ?', ['vue au champ', id]);
    await porte.ecrire('DELETE FROM evenement WHERE id = ?', [id]);
    const id2 = await porte.saisirEvenement(observation(SERIE_A));
    const crud = base.crud();
    expect(crud.map((c) => [c.op, c.type, c.ligneId])).toEqual([
      ['PUT', 'evenement', id],
      ['PATCH', 'evenement', id],
      ['DELETE', 'evenement', id],
      ['PUT', 'evenement', id2],
    ]);
    expect(crud[1]?.data, 'PATCH : la colonne changée seulement').toEqual({ note: 'vue au champ' });
    expect(new Set(crud.map((c) => c.id)).size, 'ids de ps_crud distincts').toBe(4);
    expect(new Set(crud.map((c) => c.txId)).size, 'une transaction par écriture').toBe(4);
    expect(rowid(id2), 'rowid de la ligne supprimée réutilisé').toBe(r);
  });
});

// ── 1. UPDATE qui transforme une ligne en « Fait » déjà fait ─────────────────────────────────

describe('T13o : un UPDATE qui transforme une ligne en « Fait » déjà fait est refusé', () => {
  it('U1 : correction de date d’une plantation, remplace_sorte mis à NULL par porte.ecrire → DejaFait, rien n’est écrit', async () => {
    const original = await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const corr = await porte.saisirEvenement(correction(realise(SERIE_A, 'plantation'), original, '2026-09-30' as DateCalendaire));
    await refuseSansRienEcrire(
      () => porte.ecrire('UPDATE evenement SET remplace_sorte = NULL, remplace_evenement_id = NULL WHERE id = ?', [corr]),
      'correction devenue original',
    );
    expect(ligne(corr)?.remplace_sorte).toBe('correction');
  });

  it('U2 : réalisé « semis » dont le detail devient « plantation » déjà faite, par porte.ecrire → DejaFait', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const semis = await porte.saisirEvenement(realise(SERIE_A, 'semis_pepiniere'));
    await refuseSansRienEcrire(() => porte.ecrire('UPDATE evenement SET detail = ? WHERE id = ?', [DETAIL_PLANTATION, semis]), 'detail modifié');
  });

  it('U3 : plantation de la série B déplacée sur la série A, déjà plantée → DejaFait', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const b = await porte.saisirEvenement(realise(SERIE_B, 'plantation'));
    await refuseSansRienEcrire(() => porte.ecrire('UPDATE evenement SET serie_id = ? WHERE id = ?', [SERIE_A, b]), 'culture modifiée');
  });

  it('U4 : même UPDATE du detail par ecrireEnsemble (vérificateur quelconque, à côté d’une récolte) → DejaFait, aucun ordre écrit', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const semis = await porte.saisirEvenement(realise(SERIE_A, 'semis_pepiniere'));
    const recolte = porte.preparerSaisie({ ...commun(SERIE_B), type: 'recolte', detail: { quantite: 3, unite: 'kg', categorie: null } });
    await refuseSansRienEcrire(
      () => porte.ecrireEnsemble([recolte.ordre, { sql: 'UPDATE evenement SET detail = ? WHERE id = ?', parametres: [DETAIL_PLANTATION, semis] }], VERIFICATEUR_VIDE),
      'UPDATE dans un ensemble',
    );
  });

  it('U5 : intervention qui soldait le 12/10, modifiée pour solder le 28/09 déjà soldé → DejaFait', async () => {
    await porte.saisirEvenement(desherbage(SERIE_A, OCCURRENCE));
    const autre = await porte.saisirEvenement(desherbage(SERIE_A, AUTRE_OCCURRENCE));
    const detail = JSON.stringify({ categorie: 'entretien', type: 'désherbage', outil: null, occurrenceVisee: OCCURRENCE });
    await refuseSansRienEcrire(() => porte.ecrire('UPDATE evenement SET detail = ? WHERE id = ?', [detail, autre]), 'occurrence visée modifiée');
  });
});

// ── 2. DELETE puis INSERT, rowid réutilisé ───────────────────────────────────────────────────

describe('T13o : DELETE puis INSERT dans la même transaction, rowid réutilisé → contrôlé', () => {
  /** Plantation de la série A faite, puis une observation : la dernière ligne, que l'on supprime. */
  async function banc(): Promise<{ readonly derniere: Id<'Evenement'>; readonly rowidDerniere: number | undefined }> {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const derniere = await porte.saisirEvenement(observation(SERIE_A));
    return { derniere, rowidDerniere: rowid(derniere) };
  }

  /** Ordre INSERT d'une plantation de la série A (déjà faite) sous l'id voulu. */
  function insertPlantation(id: string): { readonly sql: string; readonly parametres: readonly unknown[] } {
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    return { sql: p.ordre.sql, parametres: [id, ...(p.ordre.parametres ?? []).slice(1)] };
  }

  it('R1 : DELETE de la dernière ligne, INSERT d’une plantation déjà faite (nouvel id) → DejaFait, rien n’est écrit', async () => {
    const { derniere, rowidDerniere } = await banc();
    expect(rowidDerniere, 'banc : la ligne supprimée porte le plus grand rowid').toBe(base.lireDirect<{ m: number }>('SELECT max(rowid) AS m FROM ps_data__evenement')[0]?.m);
    await refuseSansRienEcrire(
      () => porte.ecrireEnsemble([{ sql: 'DELETE FROM evenement WHERE id = ?', parametres: [derniere] }, insertPlantation(NOUVEL_ID)], VERIFICATEUR_VIDE),
      'DELETE + INSERT, rowid réutilisé',
    );
    expect(ligne(derniere), 'la ligne supprimée est toujours là').toBeDefined();
    expect(ligne(NOUVEL_ID), 'le doublon n’est pas écrit').toBeUndefined();
  });

  it('R2 : même chose, l’INSERT reprenant l’id de la ligne supprimée → DejaFait, rien n’est écrit', async () => {
    const { derniere } = await banc();
    await refuseSansRienEcrire(
      () => porte.ecrireEnsemble([{ sql: 'DELETE FROM evenement WHERE id = ?', parametres: [derniere] }, insertPlantation(derniere)], VERIFICATEUR_VIDE),
      'DELETE + INSERT du même id',
    );
    expect(ligne(derniere)?.type, 'la ligne supprimée est intacte').toBe('observation');
  });
});

// ── 3. « Fait » et sa correction dans la même transaction ────────────────────────────────────

describe('T13o : un « Fait » et sa correction écrits ensemble sont acceptés', () => {
  it('K1 : plantation + sa correction de date par ecrireEnsemble (vérification rendue) → écrits ; la plantation reste faite', async () => {
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    const c = porte.preparerSaisie(correction(realise(SERIE_A, 'plantation'), p.id, '2026-09-30' as DateCalendaire));
    const avant = nombreEvenements();
    await expect(porte.ecrireEnsemble([p.ordre, c.ordre], p.verification), 'Fait + correction').resolves.toBeUndefined();
    expect(nombreEvenements()).toBe(avant + 2);
    expect(base.crud().slice(-2).map((o) => [o.op, o.ligneId]), 'deux PUT dans la file d’envoi').toEqual([
      ['PUT', p.id],
      ['PUT', c.id],
    ]);
    await attendreDejaFait(porte.saisirEvenement(realise(SERIE_A, 'plantation')), 'plantation ressaisie ensuite');
  });

  it('K2 : plantation + sa correction en un seul INSERT de deux lignes par porte.ecrire → écrits', async () => {
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    const c = porte.preparerSaisie(correction(realise(SERIE_A, 'plantation'), p.id, '2026-09-30' as DateCalendaire));
    const valeurs = p.ordre.sql.slice(p.ordre.sql.indexOf('VALUES') + 'VALUES'.length).trim();
    const sql = `${p.ordre.sql}, ${valeurs}`;
    await expect(porte.ecrire(sql, [...(p.ordre.parametres ?? []), ...(c.ordre.parametres ?? [])]), 'deux lignes, un ordre').resolves.toBeUndefined();
    expect(ligne(p.id)).toBeDefined();
    expect(ligne(c.id)?.remplace_evenement_id).toBe(p.id);
  });

  it('K3 (témoin) : plantation déjà faite, puis une nouvelle plantation + sa correction ensemble → DejaFait, rien n’est écrit', async () => {
    await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const p = porte.preparerSaisie(realise(SERIE_A, 'plantation'));
    const c = porte.preparerSaisie(correction(realise(SERIE_A, 'plantation'), p.id, '2026-09-30' as DateCalendaire));
    await refuseSansRienEcrire(() => porte.ecrireEnsemble([p.ordre, c.ordre], VERIFICATEUR_VIDE), 'doublon + correction');
  });
});

// ── 4. Non-régression ────────────────────────────────────────────────────────────────────────

const CULTURE_A: Culture = {
  cible: { sorte: 'serie', serieId: SERIE_A },
  cibleId: SERIE_A,
  especeId: ESPECE,
  varieteId: null,
  espece: 'Chou pointu',
  variete: null,
  unite: 'kg',
  famille: null,
  emplacements: [],
};

describe('T13o : le reste n’est pas touché', () => {
  it('N1 : restent permis en SQL brut : récolte, observation, UPDATE de note (sur une récolte et sur un « Fait » unique)', async () => {
    const plantation = await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const recolteId = '0192f0c1-13e0-7000-8000-0000000000f0';
    await expect(
      porte.ecrire(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, serie_id, campagne_id,
           emplacement_ids, note, photos, remplace_sorte, remplace_evenement_id, detail)
         VALUES (?, ?, 'recolte', ?, ?, ?, 'tap', NULL, NULL, '[]', NULL, '[]', NULL, NULL, ?)`,
        [recolteId, FERME, AUJOURDHUI, '2026-10-01T09:00:00.000Z', UTILISATEUR, JSON.stringify({ quantite: 99, unite: 'kg', categorie: null })],
      ),
      'récolte brute',
    ).resolves.toBeUndefined();
    await expect(
      porte.ecrire(`INSERT INTO evenement (id, ferme_id, type) VALUES (?, ?, 'observation')`, ['0192f0c1-13e0-7000-8000-0000000000f2', FERME]),
      'observation brute',
    ).resolves.toBeUndefined();
    await expect(porte.ecrire('UPDATE evenement SET note = ? WHERE id = ?', ['modifiée sur place', recolteId]), 'UPDATE de note, récolte').resolves.toBeUndefined();
    await expect(porte.ecrire('UPDATE evenement SET note = ? WHERE id = ?', ['bien reprise', plantation]), 'UPDATE de note, « Fait » unique').resolves.toBeUndefined();
    expect(nombreEvenements()).toBe(3);
    expect(ligne(plantation)?.note).toBe('bien reprise');
  });

  it('N2 : chemins de l’écran : marquerFait, noterRecolte, changerDate écrits ; le second marquerFait → DejaFait', async () => {
    const ctx: ContexteEcriture = { porte, fermeId: FERME, aujourdhui: AUJOURDHUI };
    const id = await marquerFait(ctx, CULTURE_A, 'plantation');
    await noterRecolte(ctx, CULTURE_A, 4.5, 'kg');
    const l = ligne(id);
    const ev: EvenementLu = {
      id,
      date: String(l?.date),
      horodatage: String(l?.horodatage),
      serieId: SERIE_A,
      campagneId: null,
      remplaceSorte: null,
      remplaceEvenementId: null,
      detail: { type: 'realise', etape: 'plantation', quantiteReelle: null },
    };
    await changerDate(ctx, ev, '2026-09-30');
    expect(nombreEvenements(), 'plantation, récolte, correction').toBe(3);
    await attendreDejaFait(marquerFait(ctx, CULTURE_A, 'plantation'), 'second « Fait » de l’écran');
  });

  it('N3 : INSERT direct dans ps_data__evenement d’un « Fait » déjà fait (sans ligne ps_crud) → toujours DejaFait', async () => {
    const id = await porte.saisirEvenement(realise(SERIE_A, 'plantation'));
    const copie = Object.fromEntries(Object.entries(ligne(id) ?? {}).filter(([c]) => c !== 'id'));
    await refuseSansRienEcrire(
      () => porte.ecrire('INSERT INTO ps_data__evenement (id, data) VALUES (?, ?)', [NOUVEL_ID, JSON.stringify({ ...copie, horodatage: '2026-10-01T09:00:00.000Z' })]),
      'INSERT dans ps_data__evenement',
    );
  });

  it('F1 : UPDATE qui fait d’une ligne un « Fait » identique à celui d’une AUTRE ferme → accepté, dans les deux sens', async () => {
    const autre = porteDe(AUTRE_FERME);
    await autre.saisirEvenement(realise(SERIE_A, 'plantation'));
    const semis = await porte.saisirEvenement(realise(SERIE_A, 'semis_pepiniere'));
    await expect(porte.ecrire('UPDATE evenement SET detail = ? WHERE id = ?', [DETAIL_PLANTATION, semis]), 'notre ferme').resolves.toBeUndefined();
    const semisAutre = await autre.saisirEvenement(realise(SERIE_B, 'semis_pepiniere'));
    await porte.saisirEvenement(realise(SERIE_B, 'plantation'));
    await expect(autre.ecrire('UPDATE evenement SET detail = ? WHERE id = ?', [DETAIL_PLANTATION, semisAutre]), 'l’autre ferme').resolves.toBeUndefined();
  });
});
