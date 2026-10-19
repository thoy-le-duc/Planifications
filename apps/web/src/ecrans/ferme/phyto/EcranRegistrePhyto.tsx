/**
 * Registre phyto (T52, règle 6) : les traitements en vigueur de la saison, du plus récent au plus
 * ancien, avec un filtre bio / non bio utile au contrôle. « Annuler ce traitement » (confirmé)
 * écrit une annulation : la ligne quitte le registre, l'emplacement redevient libre. Le même
 * registre sort dans l'export (registre-phyto.csv) : une seule règle, `lignesRegistrePhyto` du
 * cœur. Chargé à la demande depuis l'onglet Ferme ; marche hors ligne. Contrat : ./test/contrat.ts.
 */
import { useEffect, useId, useState, type ReactElement } from 'react';
import { jourMois, type LigneLocaleRegistre, type LigneRegistre } from '@planif/core';
import { annulerTraitement, TraitementPlusEnVigueur } from '../../aujourdhui/traitement/donnees.ts';
import { lireRegistre, periodeDuRegistre, SQL_TRAITEMENTS } from './donnees.ts';
import { Feuille } from './Feuille.tsx';
import type { ProprietesEcranPhyto } from './test/contrat.ts';

type Filtre = 'tous' | 'bio' | 'non_bio';
const FILTRES: readonly { readonly id: Filtre; readonly libelle: string }[] = [
  { id: 'tous', libelle: 'Tous' },
  { id: 'bio', libelle: 'Bio uniquement' },
  { id: 'non_bio', libelle: 'Non bio' },
];

const deux = (n: number) => String(n).padStart(2, '0');
function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

const enFrancais = (n: number): string => String(n).replace('.', ',');

export function EcranRegistrePhyto({ porte, fermeId, surFermer, aujourdhui = jourDuTelephone }: ProprietesEcranPhyto): ReactElement {
  const nomFiltre = useId();
  const [jour] = useState(aujourdhui);
  const [periode, setPeriode] = useState<{ readonly nom: string; readonly debut: string; readonly fin: string } | null>(null);
  const [lignes, setLignes] = useState<readonly LigneRegistre[] | null>(null);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [aAnnuler, setAAnnuler] = useState<LigneRegistre | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    periodeDuRegistre(porte, fermeId, jour).then(
      (p) => {
        if (actif) setPeriode(p);
      },
      (e: unknown) => {
        console.error('Saison illisible', e);
        if (actif) setErreur('Le registre n’a pas pu se lire sur ce téléphone.');
      },
    );
    let numero = 0;
    const fin = porte.surveiller<LigneLocaleRegistre>({ sql: SQL_TRAITEMENTS, parametres: [fermeId], tables: ['evenement', 'produit_phyto'] }, (traitements) => {
      const n = ++numero;
      lireRegistre(porte, fermeId, traitements).then(
        (l) => {
          if (actif && n === numero) setLignes(l);
        },
        (e: unknown) => {
          console.error('Registre illisible', e);
          if (actif) setErreur('Le registre n’a pas pu se lire sur ce téléphone.');
        },
      );
    });
    return () => {
      actif = false;
      fin();
    };
  }, [porte, fermeId, jour]);

  const visibles =
    lignes === null || periode === null
      ? null
      : lignes
          .filter((l) => l.date >= periode.debut && l.date <= periode.fin)
          .filter((l) => filtre === 'tous' || (filtre === 'bio') === l.bio)
          .reverse();

  function annuler(l: LigneRegistre): void {
    setAAnnuler(null);
    setErreur(null);
    annulerTraitement(porte, fermeId, l.evenementId, jour).catch((e: unknown) => {
      console.error('Traitement non annulé', e);
      setErreur(e instanceof TraitementPlusEnVigueur ? 'Ce traitement a déjà été annulé ou corrigé.' : 'L’annulation n’a pas pu s’enregistrer sur ce téléphone. Réessayez.');
    });
  }

  return (
    <Feuille titre="Registre phyto" surtitre={periode === null ? 'Traitements phyto' : `Saison ${periode.nom}`} surFermer={surFermer}>
      <fieldset className="parc-section" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="parc-etiquette">Filtre</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {FILTRES.map((f) => (
            <label key={f.id} className="parc-bouton-secondaire" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                name={nomFiltre}
                checked={filtre === f.id}
                style={{ width: 24, height: 24 }}
                onChange={() => {
                  setFiltre(f.id);
                }}
              />
              {f.libelle}
            </label>
          ))}
        </div>
      </fieldset>
      {aAnnuler !== null && (
        // Confirmation en un tap (comme ui/confirmation.tsx, sans la partager avec le morceau Ferme).
        <div role="alertdialog" aria-label="Annuler ce traitement ?" className="parc-carte" style={{ border: '2px solid var(--couleur-orange)' }}>
          <strong style={{ fontSize: 21 }}>Annuler ce traitement ?</strong>
          <span>
            {aAnnuler.produit}, traité le {jourMois(aAnnuler.date)}. L’annulation est gardée dans le journal ; l’emplacement redevient libre pour la récolte.
          </span>
          <div className="parc-actions">
            <button
              type="button"
              className="parc-bouton-danger"
              onClick={() => {
                annuler(aAnnuler);
              }}
            >
              Annuler le traitement
            </button>
            <button
              type="button"
              className="parc-bouton-secondaire"
              onClick={() => {
                setAAnnuler(null);
              }}
            >
              Garder le traitement
            </button>
          </div>
        </div>
      )}
      {erreur !== null && (
        <p role="alert" className="parc-erreur">
          {erreur}
        </p>
      )}
      {visibles === null ? (
        <p className="parc-aide">Lecture du registre…</p>
      ) : visibles.length === 0 ? (
        <p className="parc-aide">Aucun traitement noté pour cette saison.</p>
      ) : (
        <ul className="parc-liste">
          {visibles.map((l) => (
            <li key={l.evenementId} data-testid="ligne-registre" data-evenement={l.evenementId} className="parc-carte">
              <strong style={{ fontSize: 18 }}>
                {jourMois(l.date)} · {l.produit}
              </strong>
              <span>
                {[l.amm === '' ? 'sans AMM' : `AMM ${l.amm}`, `${enFrancais(l.dose)} ${l.uniteDose}`, `${enFrancais(l.surfaceTraiteeM2)} m²`, l.emplacements, l.bio ? 'bio' : null]
                  .filter((x) => x !== null && x !== '')
                  .join(' · ')}
              </span>
              <span>{[l.culture, l.cible, l.operateur].filter((x) => x !== '').join(' · ')}</span>
              <span>Récolte autorisée le {jourMois(l.recolteAutoriseeLe)}</span>
              <button
                type="button"
                className="parc-bouton-danger"
                onClick={() => {
                  setAAnnuler(l);
                }}
              >
                Annuler ce traitement
              </button>
            </li>
          ))}
        </ul>
      )}
    </Feuille>
  );
}
