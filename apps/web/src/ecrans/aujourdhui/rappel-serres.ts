/**
 * T58 — rappel du soir de l'écran Aujourd'hui (règle 4) : à partir de 18 h (heure de la ferme),
 * « 2 serres encore ouvertes » s'il y en a (`rappelDuSoir` du cœur). Chargé après l'affichage de
 * l'écran, à part de son morceau. Avant 18 h, seul le fuseau de la ferme est lu (une ligne) : le
 * journal des serres n'est lu et suivi qu'à partir de 18 h. L'heure est relue chaque minute ;
 * le rappel suit la base (refermer une serre le met à jour). Le calcul est mémorisé sur le
 * journal et les zones : la relecture de chaque minute ne refait rien tant qu'ils n'ont pas changé.
 */
import { HEURE_RAPPEL_SERRES, rappelDuSoir, type EvenementEtatAbri, type RappelDuSoir, type ZoneAbri } from '@planif/core/abris';
import type { PorteDonnees } from '@planif/sync';
import { surveillerEtatsAbri, surveillerZonesAbri } from './serres-commun.tsx';

/** Relecture de l'heure (ms) : le rappel apparaît à 18 h même si l'écran reste ouvert. */
const PERIODE_MS = 60_000;

/** Heure locale de la ferme (0 à 23), ou null si le fuseau est illisible. */
function heureDeLaFerme(instant: Date, fuseau: string): number | null {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: fuseau }).formatToParts(instant).find((p) => p.type === 'hour')?.value;
    const n = Number(h);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Suit le rappel du soir de la ferme : `rappel` reçoit le rappel, ou null (avant 18 h, rien
 * d'ouvert). Rend la fonction d'arrêt.
 */
export function suivreRappelSerres(porte: PorteDonnees, fermeId: string, maintenant: () => Date, rappel: (r: RappelDuSoir | null) => void): () => void {
  let fuseau: string | null = null;
  let zones: readonly ZoneAbri[] | null = null;
  let evenements: readonly EvenementEtatAbri[] | null = null;
  let arretsJournal: (() => void)[] = [];
  let suivi = false;
  let dernier: string | null = null;
  /** Dernier rappel calculé, et le journal et les zones dont il vient : la minute ne recalcule rien d'autre. */
  let memo: { readonly zones: readonly ZoneAbri[]; readonly evenements: readonly EvenementEtatAbri[]; readonly rappel: RappelDuSoir | null } | null = null;

  const rendre = (r: RappelDuSoir | null): void => {
    const cle = r === null ? '' : `${r.phrase}|${r.zones.map((z) => z.zoneId).join(',')}`;
    if (cle === dernier) return;
    dernier = cle;
    rappel(r);
  };

  const calculer = (): void => {
    if (fuseau === null) return;
    const instant = maintenant();
    const heure = heureDeLaFerme(instant, fuseau);
    if (heure === null || heure < HEURE_RAPPEL_SERRES) {
      // Le matin : rien à lire ni à suivre.
      for (const a of arretsJournal) a();
      arretsJournal = [];
      suivi = false;
      memo = null;
      zones = null;
      evenements = null;
      rendre(null);
      return;
    }
    if (!suivi) {
      // Marqué avant de s'abonner : un premier rappel synchrone ne s'abonne pas une seconde fois.
      suivi = true;
      arretsJournal = [
        surveillerZonesAbri(porte, fermeId, (z) => {
          zones = z;
          calculer();
        }),
        surveillerEtatsAbri(porte, fermeId, (e) => {
          evenements = e;
          calculer();
        }),
      ];
    }
    if (zones === null || evenements === null) return;
    // Le journal et les zones n'ont pas changé depuis le dernier calcul (après 18 h) : même rappel.
    if (memo?.zones !== zones || memo.evenements !== evenements) memo = { zones, evenements, rappel: rappelDuSoir({ zones, evenements, maintenant: instant.toISOString(), fuseau }) };
    rendre(memo.rappel);
  };

  const arretFerme = porte.surveiller<string>(
    {
      sql: 'SELECT fuseau_horaire FROM ferme WHERE id = ?',
      parametres: [fermeId],
      tables: ['ferme'],
      convertir: (l) => (typeof l.fuseau_horaire === 'string' ? l.fuseau_horaire : ''),
    },
    (lignes) => {
      const f = lignes[0];
      fuseau = f === undefined || f === '' ? null : f;
      calculer();
    },
  );
  const minuterie = setInterval(calculer, PERIODE_MS);
  return () => {
    clearInterval(minuterie);
    arretFerme();
    for (const a of arretsJournal) a();
    arretsJournal = [];
    suivi = false;
  };
}
