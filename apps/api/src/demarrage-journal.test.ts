/**
 * Tests d'acceptation T10m (relecture) — journal de preparerExpediteur (demarrage.ts).
 *
 * Contrat : quand la vérification du relais échoue par une erreur qui n'est PAS une
 * ErreurEnvoiCourriel (bug, erreur brute d'une bibliothèque : son message peut citer une adresse
 * ou la réponse du serveur), l'avertissement décrit l'erreur par `decrireErreur` (classe, code
 * sûr, positions de pile), jamais par son message, et passe par `ligneDeJournal` (une ligne).
 * Une ErreurEnvoiCourriel garde son message déjà nettoyé (contrat T09c, demarrage.test.ts).
 *
 * expediteurSmtp est remplacé (vi.mock) par un expéditeur dont verifier() rejette l'erreur voulue.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ExpediteurCourriel } from './auth/courriel.ts';

const verification: { erreur: unknown } = vi.hoisted(() => ({ erreur: undefined }));

vi.mock('./auth/index.ts', async (importer) => {
  const vrai = await importer<typeof import('./auth/index.ts')>();
  return {
    ...vrai,
    expediteurSmtp: (): ExpediteurCourriel & { verifier(): Promise<void> } => ({
      envoyer: () => Promise.resolve(),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- une valeur quelconque est le cas testé
      verifier: () => Promise.reject(verification.erreur),
    }),
  };
});

const { preparerExpediteur } = await import('./demarrage.ts');
const { ErreurEnvoiCourriel } = await import('./auth/courriel.ts');

const PIEGE = "550 <jean@exemple.fr> tomate\n[synchro] refus faux 'Jean Dupont'";

async function lignesPour(erreur: unknown): Promise<string[]> {
  verification.erreur = erreur;
  const lignes: string[] = [];
  await preparerExpediteur(
    { type: 'smtp', hote: 'smtp.exemple.test', port: 587, securite: 'starttls', expediteur: 'Planifications <connexion@planif.fr>' },
    (ligne) => {
      lignes.push(ligne);
    },
  );
  await vi.waitFor(() => {
    expect(lignes.length).toBeGreaterThan(0);
  });
  return lignes;
}

describe('T10m — preparerExpediteur : une erreur brute est décrite, pas recopiée', () => {
  it('Error brute (message piégé, code EENVELOPE) : SMTP, hôte, classe et code, ni adresse ni saisie, une ligne', async () => {
    const lignes = await lignesPour(Object.assign(new TypeError(PIEGE), { code: 'EENVELOPE', response: PIEGE }));
    const ligne = lignes.join(' ');
    expect(ligne).toContain('SMTP');
    expect(ligne).toContain('smtp.exemple.test:587');
    expect(ligne).toContain('TypeError');
    expect(ligne).toContain('EENVELOPE');
    for (const l of lignes) {
      expect(l).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
      expect(l.toLowerCase()).not.toContain('jean');
      expect(l).not.toContain('tomate');
      expect(l).not.toContain('[synchro]');
    }
  });

  it('valeur rejetée qui n’est pas une Error (chaîne piégée) : rien de la chaîne', async () => {
    const lignes = await lignesPour(PIEGE);
    for (const l of lignes) {
      expect(l).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
      expect(l.toLowerCase()).not.toContain('jean');
      expect(l).not.toContain('tomate');
    }
  });

  it('témoin : ErreurEnvoiCourriel garde son message nettoyé, sur une ligne', async () => {
    const lignes = await lignesPour(new ErreurEnvoiCourriel('Relais SMTP smtp.exemple.test:587 : injoignable (code ECONNECTION).\nfin'));
    const ligne = lignes.join(' ');
    expect(ligne).toContain('ECONNECTION');
    for (const l of lignes) expect(l).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u);
  });
});
