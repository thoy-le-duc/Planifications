// @vitest-environment happy-dom
/**
 * Relecture de T14e (B1) : un refus PATCH reçu AVANT l'annulation (une modification d'une planche
 * de l'import refusée, restée dans « Saisies refusées ») n'est pas un refus d'annulation. Après
 * l'annulation, puis la réouverture de l'écran, l'import reste annulé et rien n'est montré.
 * Contrat : ./test/contrat-suites.ts. Vrai écran, DOM simulé, base mémoire (./test/harnais.ts).
 */
import { describe, expect, it } from 'vitest';
import { parametresRefus, SQL_INSERER_REFUS } from '../ferme/test/refus.ts';
import { FERME, UTILISATEUR } from './test/ferme-import.ts';
import { attendreDurant, autreFichier, bouton, continuer, deposerEtLire, ecran, etape, fixture, harnais, importer, lignesImportees, lire, texte, toucher, type Banc } from './test/harnais.ts';
import { ATTRIBUT_ANNULATION_REFUSEE, MESSAGE_PLANCHE_OCCUPEE } from './test/contrat-suites.ts';

const h = harnais();
const b = (): Banc => h.banc();

const importsPasses = (): HTMLElement[] => [...ecran().querySelectorAll<HTMLElement>('[data-testid="import-passe"]')];

describe('T14e, relecture B1 : un refus antérieur à l’annulation ne lui est pas attribué', () => {
  it('modification de N1 refusée, puis import annulé, puis écran rouvert : import annulé, aucun refus d’annulation', { timeout: 60_000 }, async () => {
    await h.ouvrir();
    await deposerEtLire('parcellaire-anglais.csv', fixture('parcellaire-anglais.csv'));
    expect(etape()).toBe('type');
    await continuer();
    await continuer();
    if (etape() === 'valeurs') await continuer();
    expect(etape()).toBe('apercu');
    expect(lignesImportees(await importer())).toBe(4);

    const n1 = String(lire(b(), "SELECT id FROM emplacement WHERE ferme_id = ? AND code = 'N1'", [FERME])[0]?.id);
    // Une modification de N1 refusée par le serveur, avant toute annulation.
    b().base.recevoir(
      SQL_INSERER_REFUS,
      parametresRefus({
        id: '0192f0c1-14b0-7000-9000-0000000000b1',
        utilisateur_id: UTILISATEUR,
        ferme_id: FERME,
        nom_table: 'emplacement',
        ligne_id: n1,
        operation: 'PATCH',
        motif: 'ecriture_invalide',
        message: MESSAGE_PLANCHE_OCCUPEE,
        cree_le: '2027-01-15T08:00:00.000Z',
      }),
    );

    await toucher(bouton('Annuler cet import', ecran()));
    await attendreDurant(() => /annulé/i.test(texte(ecran().querySelector('[role="status"]'))), 'annulé sur le téléphone');
    await autreFichier();
    const id = importsPasses()[0]?.dataset.import ?? '';
    expect(id).not.toBe('');

    h.demonter();
    await h.ouvrir();
    // Laisse le temps à la liste des refus d'arriver et d'être suivie.
    await new Promise((r) => setTimeout(r, 300));
    const ligne = importsPasses().find((x) => x.dataset.import === id);
    expect(ligne?.dataset.etat, 'l’import reste annulé').toBe('annule');
    expect(ligne?.querySelector(`[data-testid="${ATTRIBUT_ANNULATION_REFUSEE}"]`) ?? null, 'aucun refus d’annulation montré').toBeNull();
    expect(lire(b(), 'SELECT supprime_le FROM emplacement WHERE id = ?', [n1])[0]?.supprime_le, 'N1 bien retirée').not.toBeNull();
  });
});
