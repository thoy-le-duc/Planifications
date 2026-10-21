/**
 * Recherche dans la base e-phy (T53) : quelques lettres, des suggestions, un tap remplit la fiche
 * produit (./EcranProduitsPhyto.tsx). Le catalogue n'est chargé qu'au premier usage du champ.
 * Puis le choix de l'usage, dont dépend le délai avant récolte. Contrat : ./test/contrat.ts.
 */
import { useId, useRef, useState, type ReactElement } from 'react';
import { chercherProduitsEphy, darPourCulture, type CatalogueEphy, type ProduitEphy, type UsageEphy } from '@planif/core/ephy';

export type ChargerCatalogue = () => Promise<CatalogueEphy>;

type Etat =
  | { readonly sorte: 'repos' }
  | { readonly sorte: 'chargement' }
  | { readonly sorte: 'pret'; readonly catalogue: CatalogueEphy }
  | { readonly sorte: 'erreur'; readonly message: string };

/** 'AAAA-MM-JJ' → 'JJ/MM/AAAA'. */
export const dateFr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const enFrancais = (n: number): string => String(n).replace('.', ',');

export const mentionRetrait = (p: ProduitEphy): string => (p.retireLe === null ? 'retiré' : `retiré le ${dateFr(p.retireLe)}`);

function detail(p: ProduitEphy): string {
  return [p.retire ? mentionRetrait(p) : null, p.amm === '' ? null : `AMM ${p.amm}`, p.substances.join(' + ') || null, p.bio ? 'bio' : null].filter((x) => x !== null).join(' · ');
}

export function RechercheEphy({ chargerCatalogue, surChoisir }: { readonly chargerCatalogue: ChargerCatalogue; readonly surChoisir: (p: ProduitEphy) => void }): ReactElement {
  const id = useId();
  const [texte, setTexte] = useState('');
  const [etat, setEtat] = useState<Etat>({ sorte: 'repos' });
  const demande = useRef(false);

  function charger(): void {
    if (demande.current) return;
    demande.current = true;
    setEtat({ sorte: 'chargement' });
    chargerCatalogue().then(
      (catalogue) => {
        setEtat({ sorte: 'pret', catalogue });
      },
      (e: unknown) => {
        console.error('Catalogue e-phy non chargé', e);
        demande.current = false;
        setEtat({ sorte: 'erreur', message: e instanceof Error ? e.message : 'Base e-phy indisponible.' });
      },
    );
  }

  const catalogue = etat.sorte === 'pret' ? etat.catalogue : null;
  const vide = catalogue !== null && (catalogue.dateBase === null || catalogue.produits.length === 0);
  const trouves = catalogue === null || vide ? [] : chercherProduitsEphy(catalogue, texte);

  return (
    <section className="parc-section" aria-label="Base e-phy">
      <label className="parc-etiquette" htmlFor={id}>
        Chercher dans e-phy
      </label>
      <input
        id={id}
        className="parc-champ"
        type="search"
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Nom, substance ou AMM"
        value={texte}
        onFocus={charger}
        onChange={(e) => {
          setTexte(e.target.value);
          charger();
        }}
      />
      {trouves.length > 0 && (
        <ul className="parc-liste" aria-label="Produits e-phy">
          {trouves.map((p) => (
            <li key={p.amm}>
              <button
                type="button"
                data-testid="suggestion-ephy"
                data-amm={p.amm}
                className={p.retire ? 'parc-ligne parc-ligne-hors' : 'parc-ligne'}
                onClick={() => {
                  setTexte('');
                  surChoisir(p);
                }}
              >
                <span className="parc-ligne-textes">
                  <strong>{p.nom}</strong>
                  <span>{detail(p)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="parc-aide" aria-live="polite">
        {etat.sorte === 'chargement'
          ? 'Chargement de la base e-phy…'
          : etat.sorte === 'erreur'
            ? etat.message
            : catalogue === null
              ? 'Base publique e-phy de l’Anses : tapez quelques lettres.'
              : vide
                ? 'La base e-phy n’est pas encore disponible sur ce serveur : saisissez le produit à la main.'
                : `Source : ${catalogue.source} · ${catalogue.licence} · base du ${dateFr(catalogue.dateBase ?? '')}.${texte.trim().length >= 2 && trouves.length === 0 ? ' Aucun produit trouvé.' : ''}`}
      </p>
    </section>
  );
}

export function libelleUsage(u: UsageEphy): string {
  const dose = u.dose === null ? 'dose non précisée' : `${enFrancais(u.dose.valeur)} ${u.dose.unite}`;
  const dar = u.dar === null ? 'DAR non précisé' : `DAR ${String(u.dar)} j`;
  return `${u.culture} · ${u.cible} · ${dose} · ${dar}`;
}

/** Après le tap : avertissement de retrait, puis l'usage (DAR proposé, ou à choisir). */
export function ChoixUsage({
  produit,
  usages,
  pourLaFerme,
  darPropose,
  horsCultures,
  choisi,
  surChoisir,
  surTous,
}: {
  readonly produit: ProduitEphy;
  readonly usages: readonly UsageEphy[];
  readonly pourLaFerme: boolean;
  readonly darPropose: boolean;
  /** La ferme a des cultures, mais aucun usage du produit ne les couvre. */
  readonly horsCultures: boolean;
  readonly choisi: number | null;
  readonly surChoisir: (i: number, u: UsageEphy) => void;
  readonly surTous: () => void;
}): ReactElement {
  const nom = useId();
  return (
    <section className="parc-section" aria-label="Usage e-phy">
      {produit.retire && (
        <p role="alert" className="parc-erreur">
          Produit {mentionRetrait(produit)} : son emploi n’est plus autorisé, sélection déconseillée. Vérifiez les délais d’écoulement des stocks.
        </p>
      )}
      {horsCultures && usages.length > 0 && (
        <p role="alert" className="parc-erreur">
          Aucun usage autorisé pour vos cultures dans e-phy : ce produit ne peut pas y être employé. Les usages ci-dessous sont ceux d’autres cultures.
        </p>
      )}
      <p className="parc-aide">
        {usages.length === 0
          ? 'Aucun usage dans e-phy : saisissez le délai avant récolte.'
          : darPropose
            ? 'Délai avant récolte repris de l’usage e-phy de vos cultures. Vous pouvez choisir un autre usage.'
            : 'Choisissez l’usage : le délai avant récolte en dépend.'}
      </p>
      {usages.length > 0 && (
        <div role="radiogroup" aria-label={pourLaFerme ? 'Usages pour vos cultures' : 'Usages e-phy'} className="parc-liste">
          {usages.map((u, i) => (
            <label key={`${String(i)}-${libelleUsage(u)}`} className="parc-bouton-secondaire" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
              <input
                type="radio"
                name={nom}
                checked={choisi === i}
                style={{ width: 24, height: 24, flex: 'none' }}
                onChange={() => {
                  surChoisir(i, u);
                }}
              />
              {libelleUsage(u)}
            </label>
          ))}
        </div>
      )}
      {pourLaFerme && produit.usages.length > usages.length && (
        <button type="button" className="parc-bouton-secondaire" onClick={surTous}>
          Voir tous les usages ({produit.usages.length})
        </button>
      )}
    </section>
  );
}

/**
 * Usages du produit pour chaque espèce cultivée par la ferme (T76, règle 1) : le DAR dépend de la
 * culture traitée, la fiche n'en fixe un que si toutes les cultures sont d'accord.
 */
export function UsagesParCulture({ produit, especes }: { readonly produit: ProduitEphy; readonly especes: readonly string[] }): ReactElement {
  return (
    <section className="parc-section" aria-label="Usages par culture" data-testid="usages-par-culture">
      <p className="parc-aide">Le délai avant récolte dépend de la culture traitée : il sera repris à la saisie du traitement.</p>
      <ul className="parc-liste">
        {[...especes]
          .sort((a, b) => a.localeCompare(b, 'fr'))
          .map((e) => {
            const r = darPourCulture(produit, e);
            return (
              <li key={e} data-testid="usage-culture" data-culture={e}>
                <strong>{e}</strong>
                {r.sorte === 'non_homologue' ? (
                  <span className="parc-erreur"> : non homologué sur cette culture</span>
                ) : (
                  <ul>
                    {r.usages.map((u, i) => (
                      <li key={`${String(i)}-${libelleUsage(u)}`}>{libelleUsage(u)}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
      </ul>
    </section>
  );
}
