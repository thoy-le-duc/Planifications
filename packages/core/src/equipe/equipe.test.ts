/**
 * Tests d'acceptation T60 — l'équipe et l'attribution des travaux du jour, dans le cœur
 * (docs/backlog/T60-consignes-par-ouvrier.md, règles 1, 2 et 4 ; critère « Tests cœur :
 * attribution à deux personnes ; « Mes travaux » filtre bien ; travail non attribué visible de
 * tous »). Contrat : ./test/contrat.ts. Aucune base, aucun réseau, aucune horloge.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerEquipe, type AttributionLue, type ModuleEquipe } from './test/contrat.ts';

let m: ModuleEquipe;

beforeAll(async () => {
  m = await chargerEquipe();
});

const uuid = (n: number): string => `0192f0c1-6060-7000-8000-${n.toString(16).padStart(12, '0')}`;
const FERME = uuid(1);
const PAUL = uuid(0x10);
const MARIE = uuid(0x11);
const LUCAS = uuid(0x12);
const MEMBRE = uuid(0x20);

/** Clés de tâches telles que l'écran Aujourd'hui les forme. */
const GRELINETTE = `${uuid(0x30)}:travail:0:2026-09-18`;
const PLANTER_CHOU = `${uuid(0x31)}:plantation`;
const SEMER_RADIS = `${uuid(0x32)}:semis_direct`;
const PESER_FRAISE = `${uuid(0x33)}:debut_recolte`;

const attribution = (n: number, cleTache: string, personneId: string, supprimee = false): AttributionLue => ({ id: uuid(0x100 + n), cleTache, personneId, supprimee });

/** Applique un plan sur des lignes lues, comme le ferait la base (ids créés à la suite). */
function appliquer(lignes: readonly AttributionLue[], plan: ReturnType<ModuleEquipe['planAttribution']>): AttributionLue[] {
  const retablir = new Set(plan.retablir);
  const retirer = new Set(plan.retirer);
  const apres = lignes.map((l) => (retablir.has(l.id) ? { ...l, supprimee: false } : retirer.has(l.id) ? { ...l, supprimee: true } : l));
  plan.creer.forEach((c, i) => apres.push(attribution(0x900 + lignes.length + i, c.cleTache, c.personneId)));
  return apres;
}

const taches = [GRELINETTE, PLANTER_CHOU, SEMER_RADIS, PESER_FRAISE].map((cle) => ({ cle }));

describe('T60 : attribuer un travail à une ou plusieurs personnes (règle 2)', () => {
  it('attribution à deux personnes : deux attributions créées, la tâche est à Paul ET à Marie', () => {
    const plan = m.planAttribution([], new Map([[GRELINETTE, [PAUL, MARIE]]]));
    expect(plan.creer).toEqual([
      { cleTache: GRELINETTE, personneId: PAUL },
      { cleTache: GRELINETTE, personneId: MARIE },
    ]);
    expect(plan.retablir).toEqual([]);
    expect(plan.retirer).toEqual([]);
    const parTache = m.personnesParTache(appliquer([], plan));
    expect(parTache.get(GRELINETTE)).toEqual([PAUL, MARIE].sort());
    expect(m.estPourPersonne(parTache, GRELINETTE, PAUL)).toBe(true);
    expect(m.estPourPersonne(parTache, GRELINETTE, MARIE)).toBe(true);
    expect(m.estPourPersonne(parTache, GRELINETTE, LUCAS)).toBe(false);
  });

  it('changer d’avis : Marie retirée (suppression douce), Lucas ajouté, Paul inchangé', () => {
    const lignes = [attribution(1, GRELINETTE, PAUL), attribution(2, GRELINETTE, MARIE)];
    const plan = m.planAttribution(lignes, new Map([[GRELINETTE, [PAUL, LUCAS]]]));
    expect(plan).toEqual({ creer: [{ cleTache: GRELINETTE, personneId: LUCAS }], retablir: [], retirer: [uuid(0x102)] });
  });

  it('liste vide : tout est retiré, la tâche redevient non attribuée (visible de tous)', () => {
    const lignes = [attribution(1, GRELINETTE, PAUL), attribution(2, GRELINETTE, MARIE)];
    const plan = m.planAttribution(lignes, new Map([[GRELINETTE, []]]));
    expect(plan.creer).toEqual([]);
    expect([...plan.retirer].sort()).toEqual([uuid(0x101), uuid(0x102)]);
    const parTache = m.personnesParTache(appliquer(lignes, plan));
    expect(parTache.has(GRELINETTE)).toBe(false);
    expect(m.estPourPersonne(parTache, GRELINETTE, LUCAS)).toBe(true);
  });

  it('réattribuer : une attribution retirée est rétablie plutôt que recréée (rien ne s’efface)', () => {
    const lignes = [attribution(3, GRELINETTE, PAUL, true), attribution(1, GRELINETTE, PAUL, true)];
    const plan = m.planAttribution(lignes, new Map([[GRELINETTE, [PAUL]]]));
    expect(plan).toEqual({ creer: [], retablir: [uuid(0x101)], retirer: [] });
  });

  it('déjà comme voulu : aucune écriture ; les clés absentes de « voulues » ne bougent pas', () => {
    const lignes = [attribution(1, GRELINETTE, PAUL), attribution(2, PLANTER_CHOU, MARIE)];
    expect(m.planAttribution(lignes, new Map([[GRELINETTE, [PAUL]]]))).toEqual({ creer: [], retablir: [], retirer: [] });
  });

  it('en lot (toute une zone) : chaque clé reçoit les mêmes personnes, dans l’ordre des clés', () => {
    const plan = m.planAttribution([attribution(1, SEMER_RADIS, MARIE)], new Map([
      [PLANTER_CHOU, [PAUL]],
      [SEMER_RADIS, [PAUL]],
    ]));
    expect(plan.creer).toEqual([
      { cleTache: PLANTER_CHOU, personneId: PAUL },
      { cleTache: SEMER_RADIS, personneId: PAUL },
    ]);
    expect(plan.retirer).toEqual([uuid(0x101)]);
  });

  it('annuler = revenir à l’état d’avant : les personnes de chaque clé sont celles d’avant', () => {
    const avant = [attribution(1, GRELINETTE, MARIE), attribution(2, PLANTER_CHOU, LUCAS, true)];
    const parTacheAvant = m.personnesParTache(avant);
    const cles = [GRELINETTE, PLANTER_CHOU];
    const apres = appliquer(avant, m.planAttribution(avant, new Map(cles.map((c) => [c, [PAUL]]))));
    const retour = appliquer(apres, m.planAttribution(apres, new Map(cles.map((c) => [c, parTacheAvant.get(c) ?? []]))));
    const parTacheRetour = m.personnesParTache(retour);
    expect(parTacheRetour.get(GRELINETTE)).toEqual([MARIE]);
    expect(parTacheRetour.has(PLANTER_CHOU)).toBe(false);
  });
});

describe('T60 : « Mes travaux » (règle 4)', () => {
  const parTache = (): ReadonlyMap<string, readonly string[]> =>
    m.personnesParTache([
      attribution(1, GRELINETTE, PAUL),
      attribution(2, GRELINETTE, MARIE),
      attribution(3, PLANTER_CHOU, MARIE),
      attribution(4, SEMER_RADIS, PAUL, true),
    ]);

  it('filtre bien : à Paul la grelinette (à deux), le radis (attribution retirée) et la fraise (personne) ; pas le chou de Marie', () => {
    expect(m.travauxDe(taches, parTache(), PAUL).map((t) => t.cle)).toEqual([GRELINETTE, SEMER_RADIS, PESER_FRAISE]);
    expect(m.travauxDe(taches, parTache(), MARIE).map((t) => t.cle)).toEqual([GRELINETTE, PLANTER_CHOU, SEMER_RADIS, PESER_FRAISE]);
  });

  it('travail non attribué visible de tous, même d’une personne qui n’a rien', () => {
    expect(m.travauxDe(taches, parTache(), LUCAS).map((t) => t.cle)).toEqual([SEMER_RADIS, PESER_FRAISE]);
    expect(m.travauxDe(taches, new Map(), LUCAS)).toEqual(taches);
  });

  it('casse des ids ignorée ; doublons d’attribution comptés une fois', () => {
    const p = m.personnesParTache([attribution(1, GRELINETTE, PAUL.toUpperCase()), attribution(2, GRELINETTE, PAUL)]);
    expect(p.get(GRELINETTE)).toEqual([PAUL]);
    expect(m.estPourPersonne(p, GRELINETTE, PAUL.toUpperCase())).toBe(true);
  });
});

describe('T60 : lignes de l’équipe (règle 1 : un ouvrier sans compte, prénom seul)', () => {
  const personne = { id: PAUL, ferme_id: FERME, prenom: '  Paul ', membre_id: null, cree_le: '2026-10-20T06:00:00.000Z', modifie_le: '2026-10-20T06:00:00.000Z', supprime_le: null };

  it('personne sans compte : prénom seul, membre nul', () => {
    expect(m.validerPersonne(personne)).toEqual({ ok: true, valeur: { id: PAUL, fermeId: FERME, prenom: 'Paul', membreId: null, supprimeLe: null } });
  });

  it('personne liée à un membre (compte), retirée en douceur', () => {
    const r = m.validerPersonne({ ...personne, membre_id: MEMBRE.toUpperCase(), supprime_le: '2026-10-21T06:00:00.000Z' });
    expect(r.ok && r.valeur.membreId).toBe(MEMBRE);
    expect(r.ok && r.valeur.supprimeLe).toBe(Date.parse('2026-10-21T06:00:00.000Z'));
  });

  it.each([
    ['prénom vide', { prenom: '   ' }, 'prenom'],
    ['prénom trop long', { prenom: 'x'.repeat(61) }, 'prenom'],
    ['membre qui n’est pas un id', { membre_id: 'paul' }, 'membre_id'],
    ['ferme manquante', { ferme_id: null }, 'ferme_id'],
  ])('personne refusée : %s', (_, changement, champ) => {
    const r = m.validerPersonne({ ...personne, ...changement });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur.champ).toBe(champ);
  });

  it('colonne inconnue refusée', () => {
    const r = m.validerPersonne({ ...personne, role: 'gerant' });
    expect(!r.ok && r.erreur.code).toBe('colonne_inconnue');
  });

  const ligne = { id: uuid(0x101), ferme_id: FERME, personne_id: PAUL, cle_tache: GRELINETTE, cree_le: '2026-10-20T06:00:00.000Z', modifie_le: '2026-10-20T06:00:00.000Z', supprime_le: null };

  it('attribution valide', () => {
    expect(m.validerAttribution(ligne)).toEqual({ ok: true, valeur: { id: uuid(0x101), fermeId: FERME, personneId: PAUL, cleTache: GRELINETTE, supprimeLe: null } });
  });

  it.each([
    ['clé vide', { cle_tache: '' }, 'cle_tache'],
    ['clé trop longue', { cle_tache: 'x'.repeat(201) }, 'cle_tache'],
    ['clé avec espace de bord', { cle_tache: ` ${GRELINETTE}` }, 'cle_tache'],
    ['personne manquante', { personne_id: undefined }, 'personne_id'],
    ['suppression illisible', { supprime_le: 'hier' }, 'supprime_le'],
  ])('attribution refusée : %s', (_, changement, champ) => {
    const r = m.validerAttribution({ ...ligne, ...changement });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur.champ).toBe(champ);
  });

  it('limites publiées : 60 caractères de prénom, 200 de clé', () => {
    expect(m.LIMITES_EQUIPE).toEqual({ prenomCaracteres: 60, cleTacheCaracteres: 200 });
  });
});
