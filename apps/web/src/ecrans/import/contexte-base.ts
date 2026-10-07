/**
 * Ce que la base locale sait déjà de la ferme (T14b), lu par la porte avant la préparation :
 * parcellaire, catalogue (ferme et bibliothèque commune), saisons, séries et assolements actifs
 * (pour les doublons contre la base). Lignes supprimées écartées ; jamais d'autre ferme.
 */
import type { PorteDonnees } from '@planif/sync';
import type { ContexteBase } from './types.ts';

type L = Readonly<Record<string, unknown>>;

const t = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const tn = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function lireContexte(porte: PorteDonnees, fermeId: string): Promise<ContexteBase> {
  const [zones, emplacements, especes, familles, varietes, itineraires, saisons, series, occupations, assolements] = await Promise.all([
    porte.lire<L>('SELECT id, nom, zone_parente_id FROM zone WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY id', [fermeId]),
    porte.lire<L>('SELECT id, code, sorte, longueur_m, nombre_places FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL AND actif_au IS NULL ORDER BY id', [fermeId]),
    porte.lire<L>('SELECT id, nom, famille_id FROM espece WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL ORDER BY ferme_id IS NULL, nom, id', [fermeId]),
    porte.lire<L>('SELECT id, nom FROM famille WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL ORDER BY ferme_id IS NULL, nom, id', [fermeId]),
    porte.lire<L>('SELECT id, espece_id, nom FROM variete WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL ORDER BY ferme_id IS NULL, id', [fermeId]),
    porte.lire<L>('SELECT id, espece_id, variete_id, ferme_id, nom, mode, parametres FROM itineraire WHERE (ferme_id = ? OR ferme_id IS NULL) AND supprime_le IS NULL ORDER BY id', [fermeId]),
    porte.lire<L>('SELECT id, nom, debut, fin FROM saison WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY debut, id', [fermeId]),
    porte.lire<L>("SELECT id, espece_id, prevu_mise_en_place FROM serie WHERE ferme_id = ? AND supprime_le IS NULL AND statut IN ('prevue', 'en_cours')", [fermeId]),
    porte.lire<L>('SELECT serie_id, emplacement_id FROM occupation WHERE ferme_id = ? AND supprime_le IS NULL AND serie_id IS NOT NULL', [fermeId]),
    porte.lire<L>('SELECT saison_id, zone_id, emplacement_id, famille_id, espece_id FROM assolement WHERE ferme_id = ? AND supprime_le IS NULL', [fermeId]),
  ]);
  const occupationsDe = new Map<string, string[]>();
  for (const o of occupations) {
    const s = t(o.serie_id);
    const liste = occupationsDe.get(s) ?? [];
    liste.push(t(o.emplacement_id));
    occupationsDe.set(s, liste);
  }
  return {
    fermeId,
    zones: zones.map((z) => ({ id: t(z.id), nom: t(z.nom), parenteId: tn(z.zone_parente_id) })),
    emplacements: emplacements.map((e) => ({ id: t(e.id), code: t(e.code), sorte: t(e.sorte), longueurM: n(e.longueur_m), nombrePlaces: n(e.nombre_places) })),
    especes: especes.map((e) => ({ id: t(e.id), nom: t(e.nom), familleId: tn(e.famille_id) })),
    familles: familles.map((f) => ({ id: t(f.id), nom: t(f.nom) })),
    varietes: varietes.map((v) => ({ id: t(v.id), especeId: t(v.espece_id), nom: t(v.nom) })),
    itineraires: itineraires.map((i) => ({
      id: t(i.id),
      especeId: t(i.espece_id),
      varieteId: tn(i.variete_id),
      deLaFerme: tn(i.ferme_id) !== null,
      nom: t(i.nom),
      mode: t(i.mode),
      parametres: t(i.parametres),
    })),
    saisons: saisons.map((s) => ({ id: t(s.id), nom: t(s.nom), debut: t(s.debut), fin: t(s.fin) })),
    series: series.map((s) => ({ especeId: t(s.espece_id), miseEnPlace: t(s.prevu_mise_en_place), emplacementIds: occupationsDe.get(t(s.id)) ?? [] })),
    assolements: assolements.map((a) => ({
      saisonId: t(a.saison_id),
      zoneId: tn(a.zone_id),
      emplacementId: tn(a.emplacement_id),
      familleId: t(a.famille_id),
      especeId: tn(a.espece_id),
    })),
  };
}
