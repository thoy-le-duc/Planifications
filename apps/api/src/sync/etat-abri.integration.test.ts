/**
 * Tests d'acceptation T58 — POST /sync/upload accepte les changements d'état des serres écrits
 * par les téléphones, et la liste d'équipements d'une zone (docs/backlog/T58-etat-serres.md,
 * règles 1 et 2), contre un vrai Postgres (même amorçage que fertirrigation.integration.test.ts :
 * DATABASE_URL, base jetable `t58_etat_abri_…`).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * Événement `etat_abri` (PUT sur `evenement`, détail { zoneId, equipement, actif }, règles de
 * ligne : `validerSaisie` du cœur) :
 *   - tout MEMBRE ACTIF de la ferme peut l'écrire (équipier compris : on ferme la serre le soir
 *     sans être gérant) ; ferme dont l'utilisateur n'est pas membre actif → 'ferme_interdite' ;
 *   - `detail.zoneId` désigne une zone de LA ferme de l'événement (supprimée comprise : saisie
 *     hors ligne avant la suppression) ; zone d'une autre ferme (même une autre ferme du même
 *     utilisateur) ou inexistante → 'ecriture_invalide', rien d'écrit ;
 *   - `detail.equipement` est un équipement DÉCLARÉ de cette zone (`equipementsDeZone` du cœur :
 *     liste de la zone, sinon défaut du type d'abri) ; sinon 'ecriture_invalide' (plein champ :
 *     aucun équipement) ;
 *   - une annulation ou une correction désigne un événement etat_abri de la même ferme.
 * Zone (`zone.equipements_abri`, texte JSON en synchro) : PATCH par tout membre actif, validé par
 * `validerEquipementsAbri` du cœur (sinon 'ecriture_invalide'), zone de la ferme (sinon
 * introuvable : 'ecriture_invalide'). Un téléphone d'AVANT la mise à jour n'envoie pas la colonne :
 * ses PUT et PATCH de zone restent acceptés et ne l'effacent pas.
 */
import { creerGenerateurId } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import { emettreJetonAcces, genererCleSignature, type ExpediteurCourriel, type TrousseauCles } from '../auth/index.ts';
import { ajouterMembre, creerBaseJetable, creerFerme, creerUtilisateur, decrireAvecBase, type BaseJetable } from './test/base-jetable.ts';

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const MAINTENANT = new Date('2027-05-10T06:00:00Z');

interface EcritureEnvoyee {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly donnees?: Record<string, unknown>;
}

interface ReponseUpload {
  readonly refus: readonly { readonly table: string; readonly id: string; readonly motif: string }[];
}

const expediteurMuet: ExpediteurCourriel = { envoyer: () => Promise.resolve() };

let tic = MAINTENANT.getTime() - 60_000;
const nouvelId = creerGenerateurId({ horloge: () => tic++, aleatoire: (n) => crypto.getRandomValues(new Uint8Array(n)) });
let horloge = MAINTENANT.getTime();
const maintenant = (): Date => new Date(horloge++);

decrireAvecBase('T58')('T58 : état des serres écrit par les téléphones', { timeout: 30_000 }, () => {
  let base: BaseJetable;
  let cles: TrousseauCles;
  let app: ReturnType<typeof creerApp>;
  let gerant: { id: string; jeton: string };
  let equipier: { id: string; jeton: string };
  let voisin: { id: string; jeton: string };
  let retire: { id: string; jeton: string };
  let ferme: string;
  let secondeFerme: string;
  let autreFerme: string;
  let serre: string;
  let serreModifiee: string;
  let tunnel: string;
  let champ: string;
  let serreSupprimee: string;
  let serreSeconde: string;
  let serreVoisine: string;

  const jetonPour = (id: string) => emettreJetonAcces({ cles, emetteur: EMETTEUR, audience: AUDIENCE }, id, MAINTENANT);

  async function zoneEn(fermeId: string, typeAbri: string, equipements: readonly string[] | null = null, supprimee = false): Promise<string> {
    const id = randomUUID();
    await base.pool.query(`INSERT INTO zone (id, ferme_id, nom, type_abri, supprime_le) VALUES ($1, $2, $3, $4, $5)`, [id, fermeId, `Zone ${id.slice(0, 6)}`, typeAbri, supprimee ? MAINTENANT : null]);
    if (equipements !== null) {
      // La colonne n'existe pas avant la migration de T58 : le test échoue alors sur ses attentes, pas sur l'amorçage.
      await base.pool.query(`UPDATE zone SET equipements_abri = $2::jsonb WHERE id = $1`, [id, JSON.stringify(equipements)]).catch(() => undefined);
    }
    return id;
  }

  beforeAll(async () => {
    base = await creerBaseJetable('t58_etat_abri');
    cles = { active: await genererCleSignature('cle-t58'), precedentes: [] };
    app = creerApp({ db: drizzle(base.pool), expediteur: expediteurMuet, cles, emetteur: EMETTEUR, audience: AUDIENCE, maintenant, envoisMaxParMinute: 1_000_000 });
    ferme = await creerFerme(base.pool, 'Fraises de Garonne');
    secondeFerme = await creerFerme(base.pool, 'Second site');
    autreFerme = await creerFerme(base.pool, 'Ferme voisine');
    const g = await creerUtilisateur(base.pool);
    const e = await creerUtilisateur(base.pool);
    const v = await creerUtilisateur(base.pool);
    const r = await creerUtilisateur(base.pool);
    await ajouterMembre(base.pool, g.id, ferme, { role: 'gerant' });
    await ajouterMembre(base.pool, g.id, secondeFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, e.id, ferme, { role: 'equipier' });
    await ajouterMembre(base.pool, v.id, autreFerme, { role: 'gerant' });
    await ajouterMembre(base.pool, r.id, ferme, { role: 'equipier', retire: true });
    gerant = { id: g.id, jeton: await jetonPour(g.id) };
    equipier = { id: e.id, jeton: await jetonPour(e.id) };
    voisin = { id: v.id, jeton: await jetonPour(v.id) };
    retire = { id: r.id, jeton: await jetonPour(r.id) };
    serre = await zoneEn(ferme, 'serre');
    serreModifiee = await zoneEn(ferme, 'serre', ['ouvrants_lateraux', 'portes']);
    tunnel = await zoneEn(ferme, 'tunnel');
    champ = await zoneEn(ferme, 'plein_champ');
    serreSupprimee = await zoneEn(ferme, 'serre', null, true);
    serreSeconde = await zoneEn(secondeFerme, 'serre');
    serreVoisine = await zoneEn(autreFerme, 'serre');
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  async function lot(ecritures: readonly EcritureEnvoyee[], jeton: string = gerant.jeton): Promise<ReponseUpload> {
    const res = await app.request('/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ ecritures }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ReponseUpload;
  }

  const evenementEcrit = async (id: string) => (await base.pool.query(`SELECT 1 FROM evenement WHERE id = $1`, [id])).rowCount;
  const equipementsDe = async (id: string) => (await base.pool.query<{ equipements_abri: unknown }>(`SELECT equipements_abri FROM zone WHERE id = $1`, [id])).rows[0]?.equipements_abri;

  function putEtat(zoneId: string, equipement: string, actif: boolean, autres: Record<string, unknown> = {}, fermeId: string = ferme, auteur: string = equipier.id): EcritureEnvoyee {
    return {
      op: 'PUT',
      table: 'evenement',
      id: nouvelId<'Evenement'>(),
      donnees: {
        ferme_id: fermeId,
        type: 'etat_abri',
        date: '2027-05-10',
        horodatage: '2027-05-10T07:00:00.000Z',
        auteur_id: auteur,
        source: 'tap',
        serie_id: null,
        campagne_id: null,
        emplacement_ids: '[]',
        note: null,
        photos: '[]',
        remplace_sorte: null,
        remplace_evenement_id: null,
        detail: JSON.stringify({ zoneId, equipement, actif }),
        ...autres,
      },
    };
  }

  /** Témoin : le même geste, sur sa propre serre, est accepté (sinon un refus ne prouverait rien). */
  async function temoin(): Promise<void> {
    expect(await lot([putEtat(serre, 'portes', true)], equipier.jeton), 'le changement d’état valide doit d’abord passer').toEqual({ refus: [] });
  }

  async function refuse(e: EcritureEnvoyee, motif: string, jeton: string = equipier.jeton): Promise<void> {
    expect((await lot([e], jeton)).refus).toEqual([{ table: 'evenement', id: e.id, motif }]);
    expect(await evenementEcrit(e.id)).toBe(0);
  }

  // ── Changement d’état ───────────────────────────────────────────────────────────────────────

  it('un équipier ouvre les ouvrants latéraux de la serre : accepté, détail intact', async () => {
    const e = putEtat(serre, 'ouvrants_lateraux', true);
    expect(await lot([e], equipier.jeton)).toEqual({ refus: [] });
    expect(await evenementEcrit(e.id)).toBe(1);
    const r = await base.pool.query<{ type: string; detail: unknown; auteur_id: string }>(`SELECT type, detail, auteur_id FROM evenement WHERE id = $1`, [e.id]);
    expect(r.rows[0]).toMatchObject({ type: 'etat_abri', detail: { zoneId: serre, equipement: 'ouvrants_lateraux', actif: true }, auteur_id: equipier.id });
  });

  it('le gérant aussi ; renvoi identique : accepté sans doublon', async () => {
    const e = putEtat(serre, 'portes', false, {}, ferme, gerant.id);
    expect(await lot([e])).toEqual({ refus: [] });
    expect(await lot([e])).toEqual({ refus: [] });
    expect((await base.pool.query(`SELECT 1 FROM evenement WHERE id = $1`, [e.id])).rowCount).toBe(1);
  });

  it('isolement : la zone d’une autre ferme (voisin, ou autre ferme du même gérant) est refusée, rien d’écrit', async () => {
    await temoin();
    await refuse(putEtat(serreVoisine, 'portes', true), 'ecriture_invalide');
    await refuse(putEtat(serreSeconde, 'portes', true, {}, ferme, gerant.id), 'ecriture_invalide', gerant.jeton);
  });

  it('zone inexistante : refusée', async () => {
    await temoin();
    await refuse(putEtat(randomUUID(), 'portes', true), 'ecriture_invalide');
  });

  it('isolement : écrire dans la ferme d’un autre (voisin, membre retiré) : ferme_interdite', async () => {
    await temoin();
    await refuse(putEtat(serre, 'portes', true, {}, ferme, voisin.id), 'ferme_interdite', voisin.jeton);
    await refuse(putEtat(serre, 'portes', true, {}, ferme, retire.id), 'ferme_interdite', retire.jeton);
    // Et la zone du voisin dans la ferme du voisin, écrite par un membre de la ferme : interdit aussi.
    await refuse(putEtat(serreVoisine, 'portes', true, {}, autreFerme, equipier.id), 'ferme_interdite');
  });

  it('zone supprimée de la ferme : une saisie faite hors ligne avant la suppression reste acceptée', async () => {
    const e = putEtat(serreSupprimee, 'portes', true);
    expect(await lot([e], equipier.jeton)).toEqual({ refus: [] });
    expect(await evenementEcrit(e.id)).toBe(1);
  });

  it('équipement déclaré : défaut du type d’abri (serre : chauffage oui ; tunnel : chauffage non, voile oui ; plein champ : rien)', async () => {
    expect(await lot([putEtat(serre, 'chauffage', true), putEtat(tunnel, 'voile', true)], equipier.jeton)).toEqual({ refus: [] });
    await refuse(putEtat(tunnel, 'chauffage', true), 'ecriture_invalide');
    await refuse(putEtat(tunnel, 'ouvrants_faitage', true), 'ecriture_invalide');
    await refuse(putEtat(champ, 'portes', true), 'ecriture_invalide');
  });

  it('équipement déclaré : la liste modifiée de la zone remplace le défaut', async () => {
    expect(await lot([putEtat(serreModifiee, 'portes', true)], equipier.jeton)).toEqual({ refus: [] });
    await refuse(putEtat(serreModifiee, 'chauffage', true), 'ecriture_invalide');
    await refuse(putEtat(serreModifiee, 'voile', true), 'ecriture_invalide');
  });

  it('détail invalide (équipement inconnu, état « ouvert », clé en trop) : refusé', async () => {
    await temoin();
    await refuse(putEtat(serre, 'arrosage', true), 'ecriture_invalide');
    await refuse(putEtat(serre, 'portes', 'ouvert' as unknown as boolean), 'ecriture_invalide');
    await refuse(putEtat(serre, 'portes', true, { detail: JSON.stringify({ zoneId: serre, equipement: 'portes', actif: true, duree: 5 }) }), 'ecriture_invalide');
  });

  it('annulation et correction d’un changement d’état de la ferme : acceptées ; d’un événement d’une autre ferme : refusée', async () => {
    const origine = putEtat(serre, 'ouvrants_faitage', true);
    expect(await lot([origine], equipier.jeton)).toEqual({ refus: [] });
    const annulation = putEtat(serre, 'ouvrants_faitage', true, { remplace_sorte: 'annulation', remplace_evenement_id: origine.id });
    const correction = putEtat(serre, 'ouvrants_faitage', false, { remplace_sorte: 'correction', remplace_evenement_id: origine.id });
    expect(await lot([annulation, correction], equipier.jeton)).toEqual({ refus: [] });
    const voisinOrigine = putEtat(serreVoisine, 'portes', true, {}, autreFerme, voisin.id);
    expect(await lot([voisinOrigine], voisin.jeton)).toEqual({ refus: [] });
    await refuse(putEtat(serre, 'portes', true, { remplace_sorte: 'annulation', remplace_evenement_id: voisinOrigine.id }), 'ecriture_invalide');
  });

  it('tout ou rien : un lot dont un changement vise la zone d’un voisin n’écrit aucun des deux', async () => {
    await temoin();
    const bon = putEtat(serre, 'portes', false);
    const mauvais = putEtat(serreVoisine, 'portes', false);
    const r = await lot([bon, mauvais], equipier.jeton);
    expect(r.refus.map((x) => x.id)).toContain(mauvais.id);
    expect(await evenementEcrit(bon.id)).toBe(0);
    expect(await evenementEcrit(mauvais.id)).toBe(0);
  });

  // ── Liste d’équipements d’une zone ──────────────────────────────────────────────────────────

  const patchZone = (id: string, donnees: Record<string, unknown>): EcritureEnvoyee => ({ op: 'PATCH', table: 'zone', id, donnees });

  it('un équipier déclare les équipements du tunnel : ouvrants latéraux et chauffage ; l’état devient alors permis', async () => {
    expect(await lot([patchZone(tunnel, { equipements_abri: JSON.stringify(['ouvrants_lateraux', 'chauffage']) })], equipier.jeton)).toEqual({ refus: [] });
    expect(await equipementsDe(tunnel)).toEqual(['ouvrants_lateraux', 'chauffage']);
    expect(await lot([putEtat(tunnel, 'chauffage', true)], equipier.jeton)).toEqual({ refus: [] });
    // Et retour à la liste par défaut du type d’abri.
    expect(await lot([patchZone(tunnel, { equipements_abri: null })], equipier.jeton)).toEqual({ refus: [] });
    expect(await equipementsDe(tunnel)).toBeNull();
  });

  it('liste invalide (nom inconnu, doublon, pas un tableau, JSON illisible) : refusée, la zone ne change pas', async () => {
    for (const mauvaise of [JSON.stringify(['arrosage']), JSON.stringify(['portes', 'portes']), JSON.stringify({ portes: true }), '[portes']) {
      const avant = await equipementsDe(serreModifiee);
      expect((await lot([patchZone(serreModifiee, { equipements_abri: mauvaise })], equipier.jeton)).refus).toEqual([{ table: 'zone', id: serreModifiee, motif: 'ecriture_invalide' }]);
      expect(await equipementsDe(serreModifiee)).toEqual(avant);
    }
  });

  it('isolement : la zone d’une autre ferme ne se modifie pas ; un membre retiré non plus', async () => {
    expect((await lot([patchZone(serreVoisine, { equipements_abri: JSON.stringify(['portes']) })], equipier.jeton)).refus).toEqual([{ table: 'zone', id: serreVoisine, motif: 'ecriture_invalide' }]);
    expect(await equipementsDe(serreVoisine)).toBeNull();
    expect((await lot([patchZone(serre, { equipements_abri: JSON.stringify(['portes']) })], retire.jeton)).refus).toHaveLength(1);
    expect(await equipementsDe(serre)).toBeNull();
  });

  it('téléphone d’avant la mise à jour : un PUT de zone sans la colonne est accepté (liste nulle) ; un PATCH du nom garde la liste', async () => {
    const id = nouvelId<'Zone'>();
    const put: EcritureEnvoyee = { op: 'PUT', table: 'zone', id, donnees: { ferme_id: ferme, nom: 'Serre ancienne', zone_parente_id: null, type_abri: 'serre', surface_m2: 100 } };
    expect(await lot([put], equipier.jeton)).toEqual({ refus: [] });
    expect(await equipementsDe(id)).toBeNull();
    expect(await lot([patchZone(serreModifiee, { nom: 'Serre renommée' })], equipier.jeton)).toEqual({ refus: [] });
    expect(await equipementsDe(serreModifiee)).toEqual(['ouvrants_lateraux', 'portes']);
  });

  it('retirer un équipement de la liste n’efface pas les changements d’état déjà notés', async () => {
    const e = putEtat(serreModifiee, 'portes', true);
    expect(await lot([e], equipier.jeton)).toEqual({ refus: [] });
    expect(await lot([patchZone(serreModifiee, { equipements_abri: JSON.stringify(['ouvrants_lateraux']) })], equipier.jeton)).toEqual({ refus: [] });
    expect(await evenementEcrit(e.id)).toBe(1);
  });
});
