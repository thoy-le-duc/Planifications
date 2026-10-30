// @vitest-environment happy-dom
/**
 * Tests d'acceptation T92 — retirer les anciens chemins de l'éditeur (docs/backlog/T92-nettoyage-anciens-chemins.md),
 * règles 1, 2, 4 et 5 (la règle 3 est dans ../parcellaire/abri-serre.test.tsx). Rendu pour de vrai (happy-dom), base mémoire,
 * vraie porte. Ferme : ./test/ferme-placement.ts ; « Tunnel 1 » est une zone tunnel (option `zoneTunnel`).
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { versLocal, type Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type ChangementPlacement, type PorteDonnees } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { attendre, bouton, champ, dialogues, liste, remplir, texte, toucher, unTour } from '../itineraires/test/outils.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleEditeur, type ProprietesEditeurPlacement } from './test/contrat.ts';
import { TESTID_CONTOURS as TC } from './test/contrat-contours.ts';
import { ecrireFermePlacement, FERME, HANGAR, POSITION, SERRE, UTILISATEUR, ZONE_CHAMP, ZONE_TUNNEL, type OptionsFermePlacement } from './test/ferme-placement.ts';
import { deverrouiller } from './test/deverrouiller.ts';

const CHEMIN = './index.ts';
const MAINTENANT = new Date('2026-10-30T08:00:00.000Z');
const CONTOUR_MANON = [
  { x: 94.8, y: 36.4 },
  { x: 111.6, y: 58.8 },
  { x: 105.8, y: 64.4 },
  { x: 87.8, y: 40.4 },
];
const ZONE_LIBRE = '0192f0c1-28b0-7000-8000-0000000000a1';
const ZONE_PRISE = '0192f0c1-28b0-7000-8000-0000000000a2';

let m: ModuleEditeur;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEditeur;
});

interface Banc {
  readonly base: BaseMemoire;
  readonly placements: (readonly ChangementPlacement[])[];
}
interface Options extends OptionsFermePlacement {
  readonly avant?: (b: BaseMemoire) => void;
}

let conteneur: HTMLDivElement;
let racine: Root;
let courant: Banc | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  courant?.base.fermer();
  courant = null;
});

const un = (testid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const tous = (testid: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const boutonsNommes = (motif: RegExp): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => motif.test((el.getAttribute('aria-label') ?? el.textContent).trim()));
const confirmation = (motif: RegExp): HTMLElement | undefined => dialogues().find((d) => d.getAttribute('data-testid') !== T.editeur && motif.test(texte(d)));
const ligne = (b: Banc, table: string, id: string): Readonly<Record<string, string | number | null>> | undefined =>
  b.base.lireDirect<Readonly<Record<string, string | number | null>>>(`SELECT * FROM ${table} WHERE id = ?`, [id])[0];

async function ouvrir(o: Options = {}): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermePlacement(base, { origine: true, zoneTunnel: true, ...o });
  o.avant?.(base);
  const reelle = creerPorte(base, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  const placements: (readonly ChangementPlacement[])[] = [];
  const porte: PorteDonnees = {
    ...reelle,
    placer: (changements) => {
      placements.push(structuredClone(changements));
      return reelle.placer(changements);
    },
  };
  const b = { base, placements };
  courant = b;
  const proprietes: ProprietesEditeurPlacement = { porte, fermeId: FERME, utilisateurId: UTILISATEUR, surFermer: () => undefined, ordinateur: true, enLigne: true };
  await act(async () => {
    racine.render(createElement(m.EditeurPlacement, proprietes));
    await Promise.resolve();
  });
  await attendre(() => (un(T.editeur)?.getAttribute('data-mode') ?? '') !== '', 'éditeur affiché');
  await deverrouiller();
  await attendre(() => un(TC.zoneChoix) !== null || tous(T.batiment).length > 0, 'plan affiché');
  return b;
}

const manon = (b: BaseMemoire): void => {
  b.recevoir('UPDATE zone SET contour = ? WHERE id = ?', [JSON.stringify(CONTOUR_MANON), ZONE_TUNNEL]);
};

async function choisirZone(id: string): Promise<void> {
  const z = document.querySelector<HTMLElement>(`[data-testid="${TC.zoneChoix}"][data-id="${id}"]`);
  if (z === null) throw new Error('zone absente');
  await toucher(z);
}
async function choisirBatiment(id: string): Promise<void> {
  const el = tous(T.batiment).find((e) => e.getAttribute('data-id') === id);
  if (el === undefined) throw new Error('bâtiment absent');
  await act(async () => {
    el.focus();
    el.dispatchEvent(new FocusEvent('focus'));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await Promise.resolve();
  });
  await unTour();
}
const options = (select: HTMLSelectElement): string[] => [...select.options].map((o) => o.textContent.trim());

// ── Règle 1 : « Placer la serre » remplace « Remplacer par une serre » ───────────────────────

describe('T92 règle 1 : zone tunnel avec un contour tracé', () => {
  it('propose « Placer la serre », plus « Remplacer par une serre »', async () => {
    await ouvrir({ avant: manon });
    await choisirZone(ZONE_TUNNEL);
    expect(boutonsNommes(/^Placer la serre$/)).toHaveLength(1);
    expect(boutonsNommes(/^Remplacer par une serre$/)).toHaveLength(0);
  });

  it('confirmation d’abord (le contour sera remplacé) ; refusée, ni fiche ni serre au plan', async () => {
    const b = await ouvrir({ avant: manon });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation');
    expect(un('fiche-serre')).toBeNull();
    const d = confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace));
    if (d !== undefined) await toucher(bouton('Annuler', d));
    await unTour();
    expect(un('fiche-serre')).toBeNull();
    expect(tous(T.batiment).map((e) => e.getAttribute('data-id')).sort()).toEqual([HANGAR, SERRE].sort());
    expect(b.placements).toEqual([]);
  });

  it('confirmée : la fiche T89 s’ouvre ; « Créer » puis « Enregistrer » efface le contour et rattache la serre, en un seul appel', async () => {
    const b = await ouvrir({ avant: manon });
    await choisirZone(ZONE_TUNNEL);
    await toucher(bouton('Placer la serre'));
    await attendre(() => confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace)) !== undefined, 'confirmation');
    const d = confirmation(new RegExp(MESSAGES_PLACEMENT.contourRemplace));
    if (d !== undefined) await toucher(bouton('Confirmer', d));
    await attendre(() => un('fiche-serre') !== null, 'fiche « Serre ou tunnel »');
    const f = un('fiche-serre') ?? document.body;
    await remplir(champ('Planches par zone', f), '0');
    await toucher(bouton('Créer', f));
    await toucher(bouton('Enregistrer'));
    await attendre(() => b.placements.length === 1, 'un appel à porte.placer');
    const appel = b.placements[0] ?? [];
    expect(appel).toContainEqual({ sorte: 'zone', id: ZONE_TUNNEL, contour: null });
    expect(appel.some((c) => c.sorte === 'batiment')).toBe(true);
    await attendre(() => b.base.lireDirect<{ id: string }>('SELECT id FROM batiment WHERE zone_id = ? AND supprime_le IS NULL', [ZONE_TUNNEL]).length === 1, 'serre rattachée');
    expect(ligne(b, 'zone', ZONE_TUNNEL)?.contour).toBeNull();
  });
});

// ── Règle 2 : « Zone abritée » réservée aux serres ───────────────────────────────────────────

describe('T92 règle 2 : la liste « Zone abritée » d’un bâtiment', () => {
  const avant = (base: BaseMemoire): void => {
    base.recevoir("INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Chapelle libre', NULL, 'serre', 100, NULL, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)", [ZONE_LIBRE, FERME]);
    base.recevoir("INSERT INTO zone (id, ferme_id, nom, zone_parente_id, type_abri, surface_m2, contour, cree_le, modifie_le, supprime_le) VALUES (?, ?, 'Tunnel pris', NULL, 'tunnel', 100, NULL, '2026-01-01T08:00:00.000Z', '2026-01-01T08:00:00.000Z', NULL)", [ZONE_PRISE, FERME]);
    base.recevoir('UPDATE batiment SET zone_id = ? WHERE id = ?', [ZONE_PRISE, HANGAR]);
  };

  it('un hangar : pas de liste « Zone abritée »', async () => {
    await ouvrir();
    await choisirBatiment(HANGAR);
    expect([...document.querySelectorAll('label')].some((l) => l.textContent.trim() === 'Zone abritée')).toBe(false);
  });

  it('une serre : seulement les zones tunnel ou serre sans bâtiment (ni plein champ, ni zone déjà abritée)', async () => {
    await ouvrir({ avant });
    await choisirBatiment(SERRE);
    const choix = options(liste('Zone abritée'));
    expect(choix).toContain('Aucune');
    expect(choix).toContain('Tunnel 1');
    expect(choix).toContain('Chapelle libre');
    expect(choix).not.toContain('Plein champ');
    expect(choix).not.toContain('Tunnel pris');
  });
});

// ── Règle 4 : les étapes du parcours guidé ───────────────────────────────────────────────────

describe('T92 règle 4 : le parcours guidé', () => {
  const aide = (): string => texte(un('aide-etape'));
  const etape = (n: number): HTMLElement => {
    const e = tous('etape-placement').find((x) => x.getAttribute('data-etape') === String(n));
    if (e === undefined) throw new Error('étape absente');
    return e;
  };

  it('étape 3 : « Ajouter une serre, une parcelle ou un bâtiment », la consigne cite « Ajouter »', async () => {
    await ouvrir();
    expect(texte(etape(3))).toContain('Ajouter une serre, une parcelle ou un bâtiment');
    await toucher(etape(3));
    expect(aide()).toContain('« Ajouter »');
    expect(aide()).not.toContain('Nouveau bâtiment');
  });

  it('étape 4 : la consigne cite « Dupliquer » et « Modifier le plan »', async () => {
    await ouvrir();
    expect(aide()).toContain('« Dupliquer »');
    expect(aide()).toContain('« Modifier le plan »');
  });
});

// ── Règle 5 : « Aller à » et « Toute la ferme » ──────────────────────────────────────────────

describe('T92 règle 5 : « Aller à » et « Toute la ferme »', () => {
  const centre = (): { x: number; y: number } => {
    const [lat, lon] = (un(T.editeur)?.getAttribute('data-centre') ?? '0,0').split(',').map(Number);
    return versLocal(POSITION, { latitude: lat ?? 0, longitude: lon ?? 0 });
  };
  async function aller(nom: string): Promise<void> {
    const s = liste('Aller à');
    const o = [...s.options].find((x) => x.textContent.trim() === nom);
    expect(o, `« Aller à » propose « ${nom} » (obtenu : ${options(s).join(' | ')})`).toBeDefined();
    await remplir(s, o?.value ?? '');
    await unTour();
  }

  it('propose les serres (même sans zone) et les zones abritées avec leurs sous-zones', async () => {
    await ouvrir({ triTunnel: true });
    const choix = options(liste('Aller à'));
    for (const nom of ['Plein champ', 'Serre M1', 'Tri-tunnel', 'Manon 1', 'Manon 2', 'Manon 3']) expect(choix).toContain(nom);
    expect(choix).not.toContain('Hangar');
  });

  it('« Serre M1 » cadre la serre (centre 40 ; 40)', async () => {
    await ouvrir({ triTunnel: true });
    await aller('Serre M1');
    expect(Math.abs(centre().x - 40)).toBeLessThan(1.5);
    expect(Math.abs(centre().y - 40)).toBeLessThan(1.5);
  });

  it('une sous-zone cadre la serre qui l’abrite (centre 200 ; 60)', async () => {
    await ouvrir({ triTunnel: true });
    await aller('Manon 2');
    expect(Math.abs(centre().x - 200)).toBeLessThan(1.5);
    expect(Math.abs(centre().y - 60)).toBeLessThan(1.5);
  });

  it('« Toute la ferme » englobe le plein champ et les deux serres : x de 36 à 214,4, y de 0 à 80 (centre 125,2 ; 40)', async () => {
    await ouvrir({ triTunnel: true });
    await toucher(bouton('Toute la ferme'));
    await unTour();
    expect(Math.abs(centre().x - 125.2)).toBeLessThan(1.5);
    expect(Math.abs(centre().y - 40)).toBeLessThan(1.5);
  });

  it('sans aucun contour, les serres suffisent : « Aller à » est proposé', async () => {
    await ouvrir({ avant: (b) => { b.recevoir('UPDATE zone SET contour = NULL WHERE id = ?', [ZONE_CHAMP]); } });
    expect(options(liste('Aller à'))).toContain('Serre M1');
  });
});
