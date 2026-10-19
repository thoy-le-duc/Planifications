/**
 * Tests d'acceptation T41b — suites de T41 (docs/backlog/T41b-bibliotheque-suites.md) : la
 * migration de la bibliothèque de départ est figée, et toute correction de
 * `packages/db/bibliotheque/depart.json` passe par une NOUVELLE migration de bibliothèque.
 *
 * ── API attendue (packages/db/src/bibliotheque.ts, exportée par @planif/db) ─────────────────
 *
 * Sources : `nomInitial` facultatif sur une famille, une espèce ou un itinéraire du JSON : le nom
 *   sous lequel la ligne est entrée dans la bibliothèque. L'identifiant fixe en dérive (md5 de
 *   `famille:<nomInitial ?? nom>`, `espece:…`, `itineraire:<espèce>:<nomInitial ?? nom>`) :
 *   renommer ne change pas l'identifiant, les séries et copies qui le référencent restent justes.
 *
 * États : `packages/db/bibliotheque/etats/<migration>.json`, un par migration de bibliothèque,
 *   { migration, familles, especes, itineraires } = les lignes actives de la bibliothèque après
 *   cette migration (format de convertirBibliotheque). lireEtatsBibliotheque() les rend triés.
 *
 * changementsBibliotheque(avant, apres): ChangementBibliotheque[]
 *   { table: 'famille' | 'espece' | 'itineraire', id, nom, sorte: 'ajoutee' | 'modifiee' | 'retiree' },
 *   familles puis espèces puis itinéraires. Comparaison par identifiant, l'ordre du JSON ne compte pas.
 *
 * sqlMiseAJourBibliotheque(migration, avant, apres): string | null
 *   null si rien ne change. Sinon, par table (familles, espèces, itinéraires) un
 *   `INSERT … ON CONFLICT (id) DO UPDATE SET … WHERE <table>.ferme_id IS NULL AND (…) IS DISTINCT FROM (…)`
 *   des lignes ajoutées ou modifiées (une ligne retirée puis remise retrouve supprime_le nul),
 *   puis un `UPDATE <table> SET supprime_le = now(), modifie_le = now() WHERE ferme_id IS NULL
 *   AND supprime_le IS NULL AND id IN (…)` des lignes retirées (jamais supprimées : des séries
 *   peuvent les référencer). Jamais de DELETE ; jamais d'écriture sur une ligne de ferme ;
 *   rejouable sans effet. Commentaires d'en-tête : une ligne par changement,
 *   `-- « nom » (table) : ajoutée | modifiée | retirée`.
 *
 * depotBibliotheque(): DepotBibliotheque — ce que le dépôt contient : { journal (meta/_journal.json
 *   de drizzle), etats, sqlDe(migration) → texte ou null, instantaneDe(idx) → texte ou null,
 *   courant (conversion de depart.json) }.
 *
 * verifierBibliotheque(depot): string[]  (vide = à jour)
 *   Erreurs explicites : premier état ≠ 0032 ; migration absente du journal ou de migrations/ ;
 *   0032 ≠ sqlBibliotheque(état 0032) ; migration k ≠ sqlMiseAJourBibliotheque(k, état k-1, état k) ;
 *   et surtout « depart.json a changé … sans nouvelle migration » quand le JSON courant diffère du
 *   dernier état.
 *
 * preparerMigrationBibliotheque(migration, depot, { maintenant, nouvelId })
 *   → { ok: true, fichiers: { chemin (relatif à packages/db), contenu }[] } | { ok: false, erreur }
 *   Ce qu'écrit `pnpm --filter @planif/db bibliotheque <migration>` : le SQL, l'état, et pour une
 *   migration nouvelle l'entrée du journal drizzle et l'instantané (copie du précédent, comme
 *   `drizzle-kit generate --custom`). Refus : 0032 (figée), nom mal formé, numéro qui ne suit pas
 *   le journal, migration existante qui n'est pas la dernière de bibliothèque, rien à écrire.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as db from './index.ts';

const DOSSIER = new URL('../', import.meta.url);
const lire = (chemin: string): string => readFileSync(new URL(chemin, DOSSIER), 'utf8');

/** Empreinte (sha256, celle que drizzle range dans __drizzle_migrations) de 0032 telle que fusionnée par T41. */
const EMPREINTE_0032 = '473c21e7777c7cbcfe1f5755efddda673b329bb8f476a97c1f24a410a46d95fc';

const MIGRATION_MELON = '0033_bibliotheque_melon_plein_champ';
const MELON_AVANT = 'Melon sous chenille, plant maison';
const MELON_APRES = 'Melon, plein champ (chenille conseillée)';
const ID_MELON = db.idBibliotheque('itineraire', `melon:${MELON_AVANT}`);

const source = db.lireBibliothequeDepart();
const courant = db.convertirBibliotheque(source);
const depot = db.depotBibliotheque();
const etats = db.lireEtatsBibliotheque();
const etat = (migration: string): db.LignesBibliotheque => {
  const e = etats.find((x) => x.migration === migration);
  if (e === undefined) throw new Error(`état ${migration} absent de bibliotheque/etats/`);
  return e.lignes;
};

/**
 * T42 : la dernière migration de bibliothèque et le numéro libre suivant, lus dans le dépôt (0033
 * n'est plus la dernière depuis 0034_bibliotheque_travaux) ; les tests de la mécanique ne
 * dépendent plus du nombre de migrations de bibliothèque déjà fusionnées.
 */
const DERNIERE = etats.at(-1)?.migration ?? '';
const IDX_DERNIER_JOURNAL = Math.max(...depot.journal.entries.map((e) => e.idx));
const SUIVANT = String(IDX_DERNIER_JOURNAL + 1).padStart(4, '0');
const APRES_SUIVANT = String(IDX_DERNIER_JOURNAL + 2).padStart(4, '0');

/** Instructions SQL sans commentaires, comme drizzle les découpe. */
const instructions = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s !== '');

/** Le JSON du dépôt avec une valeur changée sur l'itinéraire `nom`. */
function sourceModifiee(nom: string, changer: (i: db.SourceItineraire) => db.SourceItineraire): db.SourceBibliotheque {
  const s = structuredClone(source);
  return { ...s, itineraires: s.itineraires.map((i) => (i.nom === nom ? changer(i) : i)) };
}

describe('T41b : 0032 est figée', () => {
  it('empreinte de 0032_bibliotheque_depart.sql inchangée', () => {
    const sql = lire(`migrations/${db.MIGRATION_BIBLIOTHEQUE_DEPART}.sql`);
    expect(createHash('sha256').update(sql).digest('hex')).toBe(EMPREINTE_0032);
  });

  it('son texte est celui de son état figé (bibliotheque/etats/0032_bibliotheque_depart.json), plus celui du JSON courant', () => {
    expect(etats[0]?.migration).toBe(db.MIGRATION_BIBLIOTHEQUE_DEPART);
    expect(lire(`migrations/${db.MIGRATION_BIBLIOTHEQUE_DEPART}.sql`)).toBe(db.sqlBibliotheque(etat(db.MIGRATION_BIBLIOTHEQUE_DEPART)));
  });

  it('l’état 0032 : 10 familles, 35 espèces, 46 itinéraires, le melon sous son nom de T41', () => {
    const e = etat(db.MIGRATION_BIBLIOTHEQUE_DEPART);
    expect([e.familles.length, e.especes.length, e.itineraires.length]).toEqual([10, 35, 46]);
    expect(e.itineraires.find((i) => i.id === ID_MELON)?.nom).toBe(MELON_AVANT);
  });
});

describe('T41b : le JSON courant = 0032 + migrations de bibliothèque suivantes', () => {
  it('dépôt à jour : aucune erreur', () => {
    expect(db.verifierBibliotheque(depot)).toEqual([]);
  });

  it('les migrations de bibliothèque commencent par 0032 puis 0033 (melon), toutes au journal', () => {
    expect(etats.map((e) => e.migration).slice(0, 2)).toEqual([db.MIGRATION_BIBLIOTHEQUE_DEPART, MIGRATION_MELON]);
    const journal = (JSON.parse(lire('migrations/meta/_journal.json')) as { entries: { idx: number; tag: string }[] }).entries;
    expect(journal.find((e) => e.tag === MIGRATION_MELON)?.idx).toBe(33);
    for (const e of etats) expect(journal.some((x) => x.tag === e.migration), e.migration).toBe(true);
  });

  it('le dernier état est exactement la conversion du JSON courant', () => {
    const tri = <T extends { id: string }>(l: readonly T[]): T[] => [...l].sort((a, b) => (a.id < b.id ? -1 : 1));
    const dernier = etats.at(-1)?.lignes;
    expect(tri(dernier?.familles ?? [])).toEqual(tri(courant.familles));
    expect(tri(dernier?.especes ?? [])).toEqual(tri(courant.especes));
    expect(tri(dernier?.itineraires ?? [])).toEqual(tri(courant.itineraires));
  });

  it('JSON modifié sans migration → échec explicite, qui nomme la ligne et la commande', () => {
    const modifie = db.convertirBibliotheque(
      sourceModifiee('Carotte de conservation, semis direct', (i) => ({ ...i, dureeAvantRecolteJours: i.dureeAvantRecolteJours + 7 })),
    );
    const erreurs = db.verifierBibliotheque({ ...depot, courant: modifie });
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toMatch(/depart\.json a changé/);
    expect(erreurs[0]).toMatch(/sans nouvelle migration/);
    expect(erreurs[0]).toContain('Carotte de conservation, semis direct');
    expect(erreurs[0]).toContain('pnpm --filter @planif/db bibliotheque');
  });

  it('JSON avec un itinéraire retiré ou ajouté sans migration → échec aussi', () => {
    const retire = { ...courant, itineraires: courant.itineraires.filter((i) => i.id !== ID_MELON) };
    expect(db.verifierBibliotheque({ ...depot, courant: retire }).join('\n')).toMatch(/sans nouvelle migration[\s\S]*retirée/);
    const s = structuredClone(source);
    const carotte = s.itineraires.find((i) => i.nom === 'Carotte de conservation, semis direct');
    if (carotte === undefined) throw new Error('carotte absente');
    const ajoute = db.convertirBibliotheque({ ...s, itineraires: [...s.itineraires, { ...carotte, nom: 'Carotte primeur, semis direct' }] });
    expect(db.verifierBibliotheque({ ...depot, courant: ajoute }).join('\n')).toMatch(/sans nouvelle migration[\s\S]*Carotte primeur, semis direct[\s\S]*ajoutée/);
  });

  it('état retouché à la main sans son SQL → échec explicite sur la migration', () => {
    const modifie = db.convertirBibliotheque(sourceModifiee(MELON_APRES, (i) => ({ ...i, fenetreRecolteJours: 40 })));
    const faux = depot.etats.map((e) => (e.migration === MIGRATION_MELON ? { ...e, lignes: modifie } : e));
    const erreurs = db.verifierBibliotheque({ ...depot, etats: faux, courant: modifie });
    expect(erreurs.join('\n')).toContain(MIGRATION_MELON);
    expect(erreurs.join('\n')).toMatch(/SQL/);
  });

  it('0032 réécrite → échec explicite', () => {
    const erreurs = db.verifierBibliotheque({
      ...depot,
      sqlDe: (m) => (m === db.MIGRATION_BIBLIOTHEQUE_DEPART ? `${depot.sqlDe(m) ?? ''}-- retouche\n` : depot.sqlDe(m)),
    });
    expect(erreurs.join('\n')).toContain(db.MIGRATION_BIBLIOTHEQUE_DEPART);
  });

  it('migration d’un état absente du journal ou de migrations/ → échec explicite', () => {
    const journal = { ...depot.journal, entries: depot.journal.entries.filter((e) => e.tag !== MIGRATION_MELON) };
    expect(db.verifierBibliotheque({ ...depot, journal }).join('\n')).toMatch(
      new RegExp(`${MIGRATION_MELON}[\\s\\S]*journal`),
    );
    expect(db.verifierBibliotheque({ ...depot, sqlDe: (m) => (m === MIGRATION_MELON ? null : depot.sqlDe(m)) }).join('\n')).toContain(MIGRATION_MELON);
  });
});

describe('T41b : le melon, renommé par la migration 0033', () => {
  it('JSON : nouveau nom, nom initial gardé, plein champ, et la chenille dite dans « à vérifier »', () => {
    const melon = source.itineraires.find((i) => i.espece === 'melon');
    expect(melon?.nom).toBe(MELON_APRES);
    expect(melon?.nomInitial).toBe(MELON_AVANT);
    expect(melon?.typeAbri).toBe('plein_champ');
    expect(melon?.aVerifier.toLowerCase()).toContain('chenille');
  });

  it('identifiant inchangé (dérivé du nom initial), nouveau nom en base', () => {
    const l = courant.itineraires.find((i) => i.id === ID_MELON);
    expect(l?.nom).toBe(MELON_APRES);
    expect(courant.itineraires.filter((i) => i.espece_id === db.idBibliotheque('espece', 'melon'))).toHaveLength(1);
  });

  it('0033 ne change que cette ligne : une modification, rien d’ajouté ni de retiré', () => {
    expect(db.changementsBibliotheque(etat(db.MIGRATION_BIBLIOTHEQUE_DEPART), etat(MIGRATION_MELON))).toEqual([
      { table: 'itineraire', id: ID_MELON, nom: MELON_APRES, sorte: 'modifiee' },
    ]);
  });

  it('son SQL est celui de la mécanique (état 0032 → état 0033)', () => {
    expect(lire(`migrations/${MIGRATION_MELON}.sql`)).toBe(
      db.sqlMiseAJourBibliotheque(MIGRATION_MELON, etat(db.MIGRATION_BIBLIOTHEQUE_DEPART), etat(MIGRATION_MELON)),
    );
  });
});

describe('T41b : sqlMiseAJourBibliotheque', () => {
  const e32 = (): db.LignesBibliotheque => etat(db.MIGRATION_BIBLIOTHEQUE_DEPART);
  const e33 = (): db.LignesBibliotheque => etat(MIGRATION_MELON);

  it('rien ne change → null', () => {
    expect(db.sqlMiseAJourBibliotheque('0034_rien', e33(), e33())).toBeNull();
    expect(db.sqlMiseAJourBibliotheque('0034_rien', e33(), { familles: [...e33().familles].reverse(), especes: e33().especes, itineraires: e33().itineraires })).toBeNull();
  });

  it('ligne modifiée : un INSERT … ON CONFLICT (id) DO UPDATE réservé aux lignes à ferme_id nul, qui ne réécrit pas une ligne déjà juste', () => {
    const sql = db.sqlMiseAJourBibliotheque(MIGRATION_MELON, e32(), e33()) ?? '';
    const inst = instructions(sql);
    expect(inst).toHaveLength(1);
    const s = inst[0] ?? '';
    expect(s).toMatch(/^INSERT INTO itineraire \(id, ferme_id, espece_id, variete_id, nom, mode, parametres\) VALUES/);
    expect(s).toContain(`'${ID_MELON}'::uuid`);
    expect(s).toContain(`'${MELON_APRES}'`);
    expect(s).toMatch(/ON CONFLICT \(id\) DO UPDATE SET/);
    expect(s).toMatch(/supprime_le = NULL/);
    expect(s).toMatch(/modifie_le = now\(\)/);
    expect(s).toMatch(/WHERE itineraire\.ferme_id IS NULL AND \(.*\) IS DISTINCT FROM \(.*\);$/s);
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|DROP|ALTER)\b/);
    expect(sql).toMatch(new RegExp(`^-- .*${MIGRATION_MELON}`, 'm'));
    expect(sql).toContain(`-- « ${MELON_APRES} » (itineraire) : modifiée`);
  });

  it('ligne retirée du JSON : marquée supprimée (supprime_le), jamais effacée, jamais une ligne de ferme', () => {
    const apres = { ...e33(), itineraires: e33().itineraires.filter((i) => i.id !== ID_MELON) };
    const sql = db.sqlMiseAJourBibliotheque('0034_retrait', e33(), apres) ?? '';
    const inst = instructions(sql);
    expect(inst).toEqual([
      `UPDATE itineraire SET supprime_le = now(), modifie_le = now() WHERE ferme_id IS NULL AND supprime_le IS NULL AND id IN ('${ID_MELON}'::uuid);`,
    ]);
    expect(sql).toContain(`-- « ${MELON_APRES} » (itineraire) : retirée`);
  });

  it('ligne ajoutée : insérée par le même INSERT … DO UPDATE ; familles, espèces puis itinéraires, retraits à la fin', () => {
    const s = structuredClone(source);
    const nouvelle = {
      familles: [...s.familles, { nom: 'Polygonacées', delaiRetourMinAnnees: 3, delaiRetourConseilleAnnees: 4 }],
      especes: [...s.especes, { nom: 'oseille', famille: 'Polygonacées', categorie: 'aromatique' as const, uniteRecolte: 'botte' as const }],
      itineraires: s.itineraires.filter((i) => i.nom !== MELON_APRES),
    };
    const apres = db.convertirBibliotheque({ ...s, ...nouvelle });
    // T42 : depuis le dernier état (le JSON courant), pas depuis 0033 : seuls l'ajout et le retrait changent.
    const inst = instructions(db.sqlMiseAJourBibliotheque('0034_ajout', etat(DERNIERE), apres) ?? '');
    expect(inst.map((x) => /^(INSERT INTO|UPDATE) (\w+)/.exec(x)?.slice(1).join(' '))).toEqual(['INSERT INTO famille', 'INSERT INTO espece', 'UPDATE itineraire']);
    expect(inst[0]).toMatch(/WHERE famille\.ferme_id IS NULL/);
    expect(inst[1]).toMatch(/WHERE espece\.ferme_id IS NULL/);
  });

  it('toute instruction UPDATE ou DO UPDATE est gardée par ferme_id IS NULL', () => {
    const vide = { familles: [], especes: [], itineraires: [] };
    for (const sql of [db.sqlMiseAJourBibliotheque('0034_x', vide, e33()), db.sqlMiseAJourBibliotheque('0034_x', e33(), vide)]) {
      for (const s of instructions(sql ?? '')) expect(s).toMatch(/ferme_id IS NULL/);
    }
  });

  it('déterministe', () => {
    expect(db.sqlMiseAJourBibliotheque(MIGRATION_MELON, e32(), e33())).toBe(db.sqlMiseAJourBibliotheque(MIGRATION_MELON, e32(), e33()));
  });
});

describe('T41b : préparer une migration de bibliothèque (le script `bibliotheque <migration>`)', () => {
  const options = { maintenant: 1_800_000_000_000, nouvelId: () => '11111111-2222-4333-8444-555555555555' };
  const modifie = db.convertirBibliotheque(sourceModifiee(MELON_APRES, (i) => ({ ...i, fenetreRecolteJours: 40 })));

  it('0032 : refusé, elle est figée', () => {
    const r = db.preparerMigrationBibliotheque(db.MIGRATION_BIBLIOTHEQUE_DEPART, { ...depot, courant: modifie }, options);
    expect(r.ok ? '' : r.erreur).toMatch(/figée/);
  });

  it('nom mal formé ou numéro qui ne suit pas le journal : refusé', () => {
    for (const nom of ['melon', '34_melon', `${SUIVANT}-melon`, `${SUIVANT}_Melon`, `${APRES_SUIVANT}_melon`, '0034_melon']) {
      expect(db.preparerMigrationBibliotheque(nom, { ...depot, courant: modifie }, options).ok, nom).toBe(false);
    }
  });

  it('une migration existante qui n’est pas de bibliothèque : refusé', () => {
    expect(db.preparerMigrationBibliotheque('0031_debit_synchro', { ...depot, courant: modifie }, options).ok).toBe(false);
  });

  it('rien à écrire (JSON = dernier état) : refusé', () => {
    const r = db.preparerMigrationBibliotheque(`${SUIVANT}_rien`, depot, options);
    expect(r.ok ? '' : r.erreur).toMatch(/rien/i);
  });

  it('nouvelle migration : SQL, état, entrée du journal et instantané chaîné', () => {
    const r = db.preparerMigrationBibliotheque(`${SUIVANT}_bibliotheque_melon_fenetre`, { ...depot, courant: modifie }, options);
    if (!r.ok) throw new Error(r.erreur);
    const fichiers = new Map(r.fichiers.map((f) => [f.chemin, f.contenu]));
    expect([...fichiers.keys()].sort()).toEqual([
      `bibliotheque/etats/${SUIVANT}_bibliotheque_melon_fenetre.json`,
      `migrations/${SUIVANT}_bibliotheque_melon_fenetre.sql`,
      `migrations/meta/${SUIVANT}_snapshot.json`,
      'migrations/meta/_journal.json',
    ]);
    expect(fichiers.get(`migrations/${SUIVANT}_bibliotheque_melon_fenetre.sql`)).toBe(
      db.sqlMiseAJourBibliotheque(`${SUIVANT}_bibliotheque_melon_fenetre`, etat(DERNIERE), modifie),
    );
    const etatEcrit = JSON.parse(fichiers.get(`bibliotheque/etats/${SUIVANT}_bibliotheque_melon_fenetre.json`) ?? '') as { migration: string } & db.LignesBibliotheque;
    expect(etatEcrit).toEqual({ migration: `${SUIVANT}_bibliotheque_melon_fenetre`, ...modifie });
    const journal = JSON.parse(fichiers.get('migrations/meta/_journal.json') ?? '') as { entries: { idx: number; tag: string; when: number; version: string; breakpoints: boolean }[] };
    expect(journal.entries.at(-1)).toEqual({ idx: IDX_DERNIER_JOURNAL + 1, version: '7', when: options.maintenant, tag: `${SUIVANT}_bibliotheque_melon_fenetre`, breakpoints: true });
    expect(journal.entries.slice(0, -1)).toEqual((JSON.parse(lire('migrations/meta/_journal.json')) as typeof journal).entries);
    const precedent = JSON.parse(lire(`migrations/meta/${String(IDX_DERNIER_JOURNAL).padStart(4, '0')}_snapshot.json`)) as Record<string, unknown>;
    const instantane = JSON.parse(fichiers.get(`migrations/meta/${SUIVANT}_snapshot.json`) ?? '') as Record<string, unknown>;
    expect(instantane).toEqual({ ...precedent, id: options.nouvelId(), prevId: precedent.id });
  });

  it('la dernière migration de bibliothèque, pas encore fusionnée : réécrite depuis l’état précédent ; sur le dépôt, les mêmes fichiers', () => {
    const r = db.preparerMigrationBibliotheque(DERNIERE, depot, options);
    if (!r.ok) throw new Error(r.erreur);
    expect(r.fichiers.map((f) => f.chemin).sort()).toEqual([`bibliotheque/etats/${DERNIERE}.json`, `migrations/${DERNIERE}.sql`]);
    for (const f of r.fichiers) expect(f.contenu, f.chemin).toBe(lire(f.chemin));
  });
});

describe('T41b : le paquet a son script de tests', () => {
  it('`pnpm --filter @planif/db test` lance vitest', () => {
    const paquet = JSON.parse(lire('package.json')) as { scripts?: Record<string, string> };
    expect(paquet.scripts?.test).toMatch(/^vitest run\b/);
  });
});
