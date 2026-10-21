/**
 * Recettes de fertirrigation de la ferme (T56, règle 1) : nom, engrais solubles et leur quantité
 * (pour 1 000 L de solution mère injectée à un taux, ou par m³ d'eau sans taux), EC et pH cibles.
 * Créer, modifier, archiver, rétablir. Les engrais sont les produits fertilisants de la ferme (leurs
 * teneurs font le cahier). Chargé à la demande depuis l'onglet Ferme ; reçoit la porte, marche hors
 * ligne. Contrat : ./test/contrat.ts.
 */
import { useEffect, useId, useState, type ReactElement } from 'react';
import type { EngraisRecette, Id, UniteEngrais } from '@planif/core';
import '../../parcellaire/parcellaire.css';
import { Feuille } from '../phyto/Feuille.tsx';
import { Saisie } from './EcranProduitsFertilisants.tsx';
import { ProduitRefuse, SQL_PRODUITS_FERME, type ContexteFertilisation, type LigneProduit } from './donnees.ts';
import { archiverRecette, creerRecette, modifierRecette, retablirRecette, SQL_RECETTES_FERME, type LigneRecette, type ValeursRecette } from './recettes.ts';
import type { ProprietesEcranFertilisation } from './test/contrat.ts';

interface Recette extends ValeursRecette {
  readonly id: string;
  readonly archive: boolean;
}

interface ProduitLu {
  readonly id: string;
  readonly nom: string;
  readonly archive: boolean;
}

type Valeur = string | number | null;

const nombreOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function engraisDe(v: Valeur): EngraisRecette[] {
  try {
    const t = JSON.parse(String(v)) as unknown;
    if (!Array.isArray(t)) return [];
    return (t as unknown[]).flatMap((e) => {
      if (typeof e !== 'object' || e === null) return [];
      const o = e as { produitFertilisantId?: unknown; quantite?: { valeur?: unknown; unite?: unknown } };
      const valeur = o.quantite?.valeur;
      if (typeof o.produitFertilisantId !== 'string' || typeof valeur !== 'number') return [];
      const unite: UniteEngrais = o.quantite?.unite === 'L' ? 'L' : 'kg';
      return [{ produitFertilisantId: o.produitFertilisantId as Id<'ProduitFertilisant'>, quantite: { valeur, unite } }];
    });
  } catch {
    return [];
  }
}
function recetteDe(l: LigneRecette): Recette {
  return {
    id: String(l.id),
    nom: String(l.nom ?? ''),
    tauxInjection: nombreOuNul(l.taux_injection),
    engrais: engraisDe(l.engrais ?? null),
    ecCible: nombreOuNul(l.ec_cible),
    phCible: nombreOuNul(l.ph_cible),
    archive: l.supprime_le !== null,
  };
}

const enFrancais = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

/** « 1,5 » ou « 1.5 » → 1.5 ; vide → null ; illisible → undefined. */
function lireNombre(texte: string): number | null | undefined {
  const t = texte.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : undefined;
}

function messageEchec(e: unknown): string {
  return e instanceof ProduitRefuse ? `Recette refusée : ${e.message}` : 'La recette n’a pas pu s’enregistrer sur ce téléphone. Réessayez ; si cela recommence, signalez-le.';
}

interface LigneEngrais {
  readonly produitId: string;
  readonly quantite: string;
  readonly unite: UniteEngrais;
}

function Formulaire({ ctx, recette, produits, surFermer }: { readonly ctx: ContexteFertilisation; readonly recette: Recette | null; readonly produits: readonly ProduitLu[]; readonly surFermer: () => void }): ReactElement {
  const id = useId();
  const [nom, setNom] = useState(recette?.nom ?? '');
  const [taux, setTaux] = useState(enFrancais(recette?.tauxInjection ?? null));
  const [ec, setEc] = useState(enFrancais(recette?.ecCible ?? null));
  const [ph, setPh] = useState(enFrancais(recette?.phCible ?? null));
  const [engrais, setEngrais] = useState<readonly LigneEngrais[]>(
    recette === null || recette.engrais.length === 0
      ? [{ produitId: produits.find((p) => !p.archive)?.id ?? '', quantite: '', unite: 'kg' }]
      : recette.engrais.map((e) => ({ produitId: e.produitFertilisantId, quantite: enFrancais(e.quantite.valeur), unite: e.quantite.unite })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  // Produits proposés : ceux de la ferme non archivés, plus ceux déjà dans la recette.
  const proposes = produits.filter((p) => !p.archive || engrais.some((e) => e.produitId === p.id));

  async function faire(action: () => Promise<unknown>): Promise<void> {
    setOccupe(true);
    try {
      await action();
      surFermer();
    } catch (e) {
      console.error('Recette de fertirrigation non enregistrée', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    const nombres = [lireNombre(taux), lireNombre(ec), lireNombre(ph)] as const;
    if (nombres.some((n) => n === undefined)) {
      setMessage('Taux, EC et pH : un nombre (virgule acceptée), ou rien.');
      return;
    }
    const lus: EngraisRecette[] = [];
    for (const e of engrais) {
      const q = lireNombre(e.quantite);
      if (q === undefined || q === null || e.produitId === '') {
        setMessage('Pour chaque engrais : choisissez le produit et indiquez la quantité (un nombre, virgule acceptée).');
        return;
      }
      lus.push({ produitFertilisantId: e.produitId as Id<'ProduitFertilisant'>, quantite: { valeur: q, unite: e.unite } });
    }
    const v: ValeursRecette = { nom, tauxInjection: nombres[0] ?? null, engrais: lus, ecCible: nombres[1] ?? null, phCible: nombres[2] ?? null };
    void faire(() => (recette === null ? creerRecette(ctx, v) : modifierRecette(ctx, recette.id, v)));
  }

  const champ = (libelle: string, valeur: string, changer: (v: string) => void, o: { readonly mode?: 'decimal'; readonly large?: boolean } = {}) => {
    const cle = `${id}-${libelle}`;
    return (
      <div className={o.large === true ? 'parc-champ-bloc parc-large' : 'parc-champ-bloc'}>
        <label className="parc-etiquette" htmlFor={cle}>
          {libelle}
        </label>
        <input
          id={cle}
          className="parc-champ"
          autoComplete="off"
          inputMode={o.mode}
          value={valeur}
          onChange={(e) => {
            changer(e.target.value);
            setMessage(null);
          }}
        />
      </div>
    );
  };
  const changerEngrais = (i: number, c: Partial<LigneEngrais>): void => {
    setEngrais((l) => l.map((e, j) => (j === i ? { ...e, ...c } : e)));
    setMessage(null);
  };
  const parMere = lireNombre(taux) !== null;

  return (
    <Saisie titre={recette === null ? 'Nouvelle recette' : 'Modifier la recette'} surFermer={surFermer}>
      <div className="parc-grille">
        {champ('Nom', nom, setNom, { large: true })}
        {champ('Taux d’injection (%)', taux, setTaux, { mode: 'decimal' })}
        {champ('EC cible (mS/cm)', ec, setEc, { mode: 'decimal' })}
        {champ('pH cible', ph, setPh, { mode: 'decimal' })}
      </div>
      <p className="parc-aide">{parMere ? 'Quantités pour 1 000 L de solution mère, injectée à ce taux dans l’eau (1 % = 10 L de mère par m³).' : 'Sans taux : quantités par m³ d’eau d’irrigation.'}</p>
      {engrais.map((e, i) => {
        const n = String(i + 1);
        return (
          <div key={n} className="parc-grille">
            <div className="parc-champ-bloc parc-large">
              <label className="parc-etiquette" htmlFor={`${id}-engrais-${n}`}>
                Engrais {n}
              </label>
              <select
                id={`${id}-engrais-${n}`}
                className="parc-champ"
                value={e.produitId}
                onChange={(ev) => {
                  changerEngrais(i, { produitId: ev.target.value });
                }}
              >
                <option value="">Choisir…</option>
                {proposes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom}
                  </option>
                ))}
              </select>
            </div>
            {champ(`Quantité ${n}`, e.quantite, (v) => {
              changerEngrais(i, { quantite: v });
            }, { mode: 'decimal' })}
            <div className="parc-champ-bloc">
              <label className="parc-etiquette" htmlFor={`${id}-unite-${n}`}>
                Unité {n}
              </label>
              <select
                id={`${id}-unite-${n}`}
                className="parc-champ"
                value={e.unite}
                onChange={(ev) => {
                  changerEngrais(i, { unite: ev.target.value === 'L' ? 'L' : 'kg' });
                }}
              >
                <option value="kg">kg</option>
                <option value="L">L</option>
              </select>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="parc-bouton-secondaire"
        onClick={() => {
          setEngrais((l) => [...l, { produitId: '', quantite: '', unite: 'kg' }]);
        }}
      >
        Ajouter un engrais
      </button>
      {message !== null && (
        <p role="alert" className="parc-erreur">
          {message}
        </p>
      )}
      <div className="parc-actions">
        <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={enregistrer}>
          Enregistrer
        </button>
        <button type="button" className="parc-bouton-secondaire" onClick={surFermer}>
          Fermer
        </button>
        {recette !== null && (
          <button type="button" className="parc-bouton-danger" disabled={occupe} onClick={() => void faire(() => archiverRecette(ctx, recette.id))}>
            Archiver la recette
          </button>
        )}
      </div>
    </Saisie>
  );
}

function detailRecette(r: Recette, noms: ReadonlyMap<string, string>): string {
  const dosage = r.tauxInjection === null ? 'par m³ d’eau' : `injection ${enFrancais(r.tauxInjection)} %`;
  const engrais = r.engrais.map((e) => `${noms.get(e.produitFertilisantId) ?? 'produit inconnu'} ${enFrancais(e.quantite.valeur)} ${e.quantite.unite}`);
  return [dosage, ...engrais, r.ecCible === null ? null : `EC ${enFrancais(r.ecCible)}`, r.phCible === null ? null : `pH ${enFrancais(r.phCible)}`].filter((x) => x !== null).join(' · ');
}

export function EcranRecettesFertirrigation({ porte, fermeId, surFermer, maintenant = () => new Date() }: ProprietesEcranFertilisation): ReactElement {
  const [recettes, setRecettes] = useState<readonly Recette[] | null>(null);
  const [produits, setProduits] = useState<readonly ProduitLu[] | null>(null);
  const [edition, setEdition] = useState<{ readonly recette: Recette | null } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const ctx: ContexteFertilisation = { porte, fermeId, maintenant };

  useEffect(
    () =>
      porte.surveiller<LigneRecette>({ sql: SQL_RECETTES_FERME, parametres: [fermeId], tables: ['recette_fertirrigation'] }, (l) => {
        setRecettes(l.map(recetteDe));
      }),
    [porte, fermeId],
  );
  useEffect(
    () =>
      porte.surveiller<LigneProduit>({ sql: SQL_PRODUITS_FERME, parametres: [fermeId], tables: ['produit_fertilisant'] }, (l) => {
        setProduits(l.map((p) => ({ id: String(p.id), nom: String(p.nom ?? ''), archive: p.supprime_le !== null })));
      }),
    [porte, fermeId],
  );

  const noms = new Map((produits ?? []).map((p) => [p.id.toLowerCase(), p.nom]));
  const actives = recettes?.filter((r) => !r.archive) ?? [];
  const archivees = recettes?.filter((r) => r.archive) ?? [];
  const sansProduit = produits !== null && !produits.some((p) => !p.archive);

  return (
    <Feuille titre="Recettes de fertirrigation" surtitre="Fertilisation" surFermer={surFermer}>
      <section className="parc-section" aria-label="Recettes de la ferme">
        <p className="parc-aide">La solution nutritive passée par les vannes, en hors-sol comme en pleine terre. Chaque fertirrigation notée au champ entre au cahier de fertilisation.</p>
        {sansProduit ? (
          <p className="parc-aide">Ajoutez d’abord vos engrais solubles dans « Produits fertilisants » (avec leurs teneurs) : une recette les reprend.</p>
        ) : (
          produits !== null && (
            <button
              type="button"
              className="parc-bouton-principal"
              onClick={() => {
                setEdition({ recette: null });
              }}
            >
              Nouvelle recette
            </button>
          )
        )}
        {recettes === null ? (
          <p className="parc-aide">Lecture des recettes…</p>
        ) : actives.length === 0 ? (
          <p className="parc-aide">Aucune recette pour l’instant.</p>
        ) : (
          <ul className="parc-liste">
            {actives.map((r) => (
              <li key={r.id} data-testid="recette-fertirrigation" data-recette={r.id}>
                <button
                  type="button"
                  aria-label={`Modifier ${r.nom}`}
                  className="parc-ligne"
                  onClick={() => {
                    setEdition({ recette: r });
                  }}
                >
                  <span className="parc-ligne-textes">
                    <strong>{r.nom}</strong>
                    <span>{detailRecette(r, noms)}</span>
                  </span>
                  <span aria-hidden="true" className="parc-chevron">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {archivees.length > 0 && (
        <section className="parc-section" aria-label="Archivées">
          <h3>Archivées</h3>
          <ul className="parc-liste">
            {archivees.map((r) => (
              <li key={r.id} className="parc-ligne parc-ligne-hors">
                <span className="parc-ligne-textes">
                  <strong>{r.nom}</strong>
                  <span>{detailRecette(r, noms)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Rétablir ${r.nom}`}
                  className="parc-bouton-secondaire"
                  onClick={() => {
                    setErreur(null);
                    retablirRecette(ctx, r.id).catch((e: unknown) => {
                      console.error('Recette non rétablie', e);
                      setErreur(messageEchec(e));
                    });
                  }}
                >
                  Rétablir
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {erreur !== null && (
        <p role="alert" className="parc-erreur">
          {erreur}
        </p>
      )}
      {edition !== null && produits !== null && (
        <Formulaire
          ctx={ctx}
          recette={edition.recette}
          produits={produits}
          surFermer={() => {
            setEdition(null);
          }}
        />
      )}
    </Feuille>
  );
}
