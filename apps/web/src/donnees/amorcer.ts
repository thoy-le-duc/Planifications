/**
 * T11 — page `/diagnostic/amorcer.html`, pour les tests de bout en bout (e2e/plan.e2e.ts, contrat
 * en tête) : remplit la base locale PowerSync de l'utilisateur de TEST du jeu de T07 (ferme
 * d'exemple, 400 emplacements), sans serveur. Hors navigation, hors service worker et hors
 * précache, jamais liée depuis l'appli, comme /diagnostic/synchro.html.
 *
 * Garde-fous : seule la base de l'utilisateur du jeu (identifiant de test, jamais un vrai compte)
 * est ouverte, sans session ; la synchro n'est jamais branchée (aucun appel à connect()), et la
 * file d'envoi est vidée : rien de ce jeu ne partira vers un serveur.
 */
import type { BaseLocale } from '@planif/sync';
import { remplirJeuT07, type JeuT07 } from '../../../../packages/sync/src/test/jeu-t07.ts';
import { ouvrirBaseLocale } from './ouvrir.ts';

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

function publier(a: Amorcage): void {
  (window as unknown as { __amorcage?: Amorcage }).__amorcage = a;
  const etat = document.getElementById('etat');
  if (etat !== null) etat.textContent = a.erreur === undefined ? `Base remplie : ${String(a.lignes ?? 0)} lignes.` : `Échec : ${a.erreur}`;
}

/** Le jeu calculé sans rien écrire : ses identifiants (graine 7) et le nombre de lignes. */
async function jeuSansEcrire(): Promise<JeuT07> {
  const nulle: Pick<BaseLocale, 'writeTransaction'> = {
    writeTransaction: (fn) => fn({ getAll: () => Promise.resolve([]), execute: () => Promise.resolve(undefined) }),
  };
  return remplirJeuT07(nulle);
}

async function amorcer(): Promise<Amorcage> {
  const jeu = await jeuSansEcrire();
  const { base, fermer } = ouvrirBaseLocale(jeu.utilisateurId);
  try {
    const deja = await base.getAll<{ id: string }>('SELECT id FROM ferme WHERE id = ?', [jeu.principale.fermeId]);
    if (deja.length === 0) await remplirJeuT07(base);
    // Rien de ce jeu ne doit partir vers un serveur, ni compter comme saisie en attente.
    await base.writeTransaction(async (tx) => {
      await tx.execute('DELETE FROM ps_crud');
    });
  } finally {
    await fermer();
  }
  const lignes = Object.values(jeu.lignes).reduce((total, n) => total + n, 0);
  return { utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId, lignes };
}

amorcer().then(publier, (erreur: unknown) => {
  console.error('Amorçage impossible', erreur);
  publier({ erreur: erreur instanceof Error ? erreur.message : String(erreur) });
});
