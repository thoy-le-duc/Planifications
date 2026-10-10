// @vitest-environment happy-dom
/**
 * T15e (suites de la relecture de T15d) — le téléchargement construit le Blob par tranches de
 * 256 Kio (`telechargerDansLeNavigateur`, lancer.ts) :
 *   - une archive dont la taille n'est pas un multiple de la tranche (600 Kio = 2 tranches
 *     pleines + une de 88 Kio) ressort octet pour octet identique, dans le bon ordre ;
 *   - une archive plus petite qu'une tranche, et une archive d'exactement 2 tranches, aussi ;
 *   - annulée au milieu de la construction (entre deux tranches) : l'appel rejette, aucun lien
 *     de téléchargement n'est cliqué, aucun Blob n'est publié (createObjectURL) ;
 *   - déjà annulée au départ : idem.
 * Régression de T15d (ces tests passent aujourd'hui) : ils verrouillent le découpage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telechargerDansLeNavigateur } from './lancer.ts';

const TRANCHE = 256 * 1024;

/** Octets reconnaissables : une erreur de découpage (trou, doublon, ordre) change le contenu. */
function archive(taille: number): Uint8Array {
  const octets = new Uint8Array(taille);
  for (let i = 0; i < taille; i++) octets[i] = (i * 31 + (i >>> 8) * 7 + (i >>> 16)) & 0xff;
  return octets;
}

let blobs: Blob[];
let clics: HTMLAnchorElement[];
const createObjectURLReel = URL.createObjectURL.bind(URL);
const revokeReel = URL.revokeObjectURL.bind(URL);

beforeEach(() => {
  blobs = [];
  clics = [];
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:planif-test';
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clics.push(this);
  });
});

afterEach(() => {
  URL.createObjectURL = createObjectURLReel;
  URL.revokeObjectURL = revokeReel;
  vi.restoreAllMocks();
});

async function octetsDuBlob(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

describe('T15e : Blob du téléchargement construit par tranches de 256 Kio', () => {
  it.each([
    ['600 Kio (non multiple de la tranche)', 600 * 1024],
    ['plus petite qu’une tranche (1 000 octets)', 1_000],
    ['exactement 2 tranches', 2 * TRANCHE],
    ['2 tranches et 1 octet', 2 * TRANCHE + 1],
  ])('archive de %s : octets du Blob identiques à l’entrée, un seul clic', async (_nom, taille) => {
    const entree = archive(taille);
    const copie = entree.slice();
    await telechargerDansLeNavigateur('planifications-test.zip', entree);

    expect(blobs, 'un seul Blob publié').toHaveLength(1);
    expect(clics, 'un seul clic de téléchargement').toHaveLength(1);
    expect(clics[0]?.getAttribute('download')).toBe('planifications-test.zip');
    const blob = blobs[0];
    expect(blob?.size).toBe(taille);
    expect(blob?.type).toBe('application/zip');
    const sortie = blob === undefined ? new Uint8Array(0) : await octetsDuBlob(blob);
    expect(sortie.length).toBe(taille);
    expect(Buffer.from(sortie).equals(Buffer.from(copie)), 'contenu identique octet pour octet').toBe(true);
    expect(Buffer.from(entree).equals(Buffer.from(copie)), 'l’entrée n’est pas modifiée').toBe(true);
  });

  it('archive de 600 Kio, vue sur un sous-tableau (décalage non nul) : seuls ses octets sortent', async () => {
    const grand = archive(600 * 1024 + 4_096);
    const vue = grand.subarray(1_000, 1_000 + 600 * 1024);
    const attendu = vue.slice();
    await telechargerDansLeNavigateur('vue.zip', vue);
    const blob = blobs[0];
    expect(blob?.size).toBe(600 * 1024);
    const sortie = blob === undefined ? new Uint8Array(0) : await octetsDuBlob(blob);
    expect(Buffer.from(sortie).equals(Buffer.from(attendu))).toBe(true);
  });

  it('annulation au milieu (entre deux tranches) : l’appel rejette, pas de clic, pas de Blob publié', async () => {
    const controleur = new AbortController();
    // Appel synchrone jusqu'à la première pause entre deux tranches, puis annulation.
    const appel = telechargerDansLeNavigateur('annule.zip', archive(600 * 1024), controleur.signal);
    controleur.abort();
    await expect(appel).rejects.toBeDefined();
    // Laisse passer toutes les pauses restantes : rien ne doit repartir.
    await new Promise((r) => setTimeout(r, 50));
    expect(clics, 'aucun clic de téléchargement').toHaveLength(0);
    expect(blobs, 'aucun Blob publié').toHaveLength(0);
    expect(document.querySelector('a[download]'), 'aucun lien laissé dans la page').toBeNull();
  });

  it('déjà annulée au départ : rien n’est téléchargé', async () => {
    const controleur = new AbortController();
    controleur.abort();
    await expect(telechargerDansLeNavigateur('annule.zip', archive(600 * 1024), controleur.signal)).rejects.toBeDefined();
    expect(clics).toHaveLength(0);
    expect(blobs).toHaveLength(0);
  });
});
