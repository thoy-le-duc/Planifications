/**
 * Catalogue e-phy (T53), en ligne de commande :
 *
 *   node packages/db/src/ephy/cli.ts <dossier décompressé> <sortie.json> [--date AAAA-MM-JJ] [--minimum N]
 *
 * `--date` : date de la base publiée (défaut : aujourd'hui, UTC). `--minimum` : nombre de produits
 * en dessous duquel on refuse d'écrire (garde-fou du workflow : un format mal lu ne remplace pas
 * le catalogue par un catalogue vide). Ni réseau, ni secret : le téléchargement est fait avant.
 */
import { renameSync, rmSync } from 'node:fs';
import { ecrireCatalogue, ErreurFormatEphy } from './extraire.ts';

function option(args: readonly string[], nom: string): string | undefined {
  const i = args.indexOf(nom);
  return i < 0 ? undefined : args[i + 1];
}

function principal(args: readonly string[]): number {
  const positionnels = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && (args[i - 1] ?? '').startsWith('--')));
  const [dossier, sortie] = positionnels;
  if (dossier === undefined || sortie === undefined) {
    console.error('Usage : node packages/db/src/ephy/cli.ts <dossier> <sortie.json> [--date AAAA-MM-JJ] [--minimum N]');
    return 2;
  }
  const date = option(args, '--date') ?? new Date().toISOString().slice(0, 10);
  const minimum = Number(option(args, '--minimum') ?? '0');
  if (!Number.isInteger(minimum) || minimum < 0) {
    console.error('--minimum : un entier positif.');
    return 2;
  }
  try {
    const temporaire = `${sortie}.tmp`;
    const r = ecrireCatalogue(dossier, temporaire, date);
    if (r.produits < minimum) {
      rmSync(temporaire, { force: true });
      console.error(`Seulement ${String(r.produits)} produits lus (minimum ${String(minimum)}) : catalogue non remplacé. Vérifier le format publié.`);
      return 1;
    }
    renameSync(temporaire, sortie);
    console.log(`Catalogue e-phy du ${date} : ${String(r.produits)} produits, ${String(r.usages)} usages, ${(r.octets / 1024).toFixed(0)} Kio → ${sortie}`);
    return 0;
  } catch (e) {
    if (e instanceof ErreurFormatEphy) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
}

process.exitCode = principal(process.argv.slice(2));
