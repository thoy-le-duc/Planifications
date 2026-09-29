/**
 * Lancement de l'export (T15) : lecture de la base locale par la porte, archive ZIP, téléchargement.
 * Aucun réseau : fonctionne hors ligne.
 */
import { exporterFerme, type ArchiveExport, type PorteDonnees } from '@planif/sync';

export interface OptionsLancerExport {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly maintenant: () => Date;
  readonly telecharger: (nomFichier: string, octets: Uint8Array) => void;
}

const deux = (n: number): string => String(n).padStart(2, '0');

/** 'AAAA-MM-JJ' à l'heure du téléphone (pas en UTC) : un export à 23 h 30 porte la date du jour. */
export function jourLocal(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Construit l'archive de la ferme et la donne à `telecharger`, une fois. */
export async function lancerExport(o: OptionsLancerExport): Promise<ArchiveExport> {
  const quand = o.maintenant();
  const archive = await exporterFerme(o.porte, { fermeId: o.fermeId, genereLe: quand.toISOString(), jour: jourLocal(quand) });
  o.telecharger(archive.nomFichier, archive.octets);
  return archive;
}

/** Téléchargement dans le navigateur : Blob ZIP et lien `download`, sans réseau. */
export function telechargerDansLeNavigateur(nomFichier: string, octets: Uint8Array): void {
  // creerZip écrit dans un ArrayBuffer ordinaire (jamais partagé) : la conversion de type est sûre.
  const url = URL.createObjectURL(new Blob([octets as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  lien.style.display = 'none';
  document.body.append(lien);
  lien.click();
  lien.remove();
  // Laisse au navigateur le temps de lire le Blob avant de le libérer.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
