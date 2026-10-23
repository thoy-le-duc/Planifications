/**
 * Recherche dans la base e-phy (T53) : quelques lettres, des suggestions, un tap remplit la fiche
 * produit (./EcranProduitsPhyto.tsx). Le catalogue n'est chargé qu'au premier usage du champ.
 * Puis le choix de l'usage, dont dépend le délai avant récolte. Contrat : ./test/contrat.ts.
 */
import { useId, useRef, useState, type ReactElement } from 'react';
import { preparerRechercheEphy, rechercherEphy, type CatalogueEphy, type ProduitEphy, type UsageEphy } from '@planif/core/ephy';

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
        preparerRechercheEphy(catalogue);
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
  const { resultats: trouves, autres } = catalogue === null || vide ? { resultats: [], autres: 0 } : rechercherEphy(catalogue, texte);

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
        placeholder="Nom, substance, AMM, culture ou cible"
        value={texte}
        onFocus={charger}
        onChange={(e) => {
          setTexte(e.target.value);
          charger();
        }}
      />
      {trouves.length > 0 && (
        <ul className="parc-liste" aria-label="Produits e-phy">
          {trouves.map(({ produit: p, usage, usagesEnPlus }) => (
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
                  {usage !== null && (
                    <span data-testid="usage-trouve">{`${libelleUsageCourt(usage)}${usagesEnPlus > 0 ? ` + ${String(usagesEnPlus)} usage${usagesEnPlus > 1 ? 's' : ''}` : ''}`}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {autres > 0 && (
        <p className="parc-aide" data-testid="autres-ephy">
          {`${String(autres)} ${autres > 1 ? 'autres produits' : 'autre produit'} : précisez la recherche`}
        </p>
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

/** Ligne d'un résultat de recherche : culture, cible, DAR. */
function libelleUsageCourt(u: UsageEphy): string {
  return `${u.culture} · ${u.cible} · ${u.dar === null ? 'DAR non précisé' : `DAR ${String(u.dar)} j`}`;
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
  parEspece = [],
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
  /**
   * T76 : usages par culture de la ferme. Le DAR d'une culture ne vaut pas pour une autre : la
   * fiche ne fixe un DAR que si toutes les cultures sont couvertes et d'accord.
   */
  readonly parEspece?: readonly { readonly espece: string; readonly usages: readonly UsageEphy[] }[];
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
      {parEspece.length > 0 && (
        <ul className="parc-liste" aria-label="Usages par culture de la ferme">
          {parEspece.map((x) => (
            <li key={x.espece} data-testid="usages-culture" data-culture={x.espece} className={x.usages.length === 0 ? 'parc-erreur' : 'parc-aide'}>
              <strong>{x.espece}</strong> :{' '}
              {x.usages.length === 0 ? 'non homologué dans e-phy, ne pas employer sur cette culture' : x.usages.map(libelleUsage).join(' ; ')}
            </li>
          ))}
        </ul>
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
