/**
 * Produits fertilisants de la ferme (T54, règle 1) : nom, forme, unité, teneurs N, P₂O₅, K₂O (en %,
 * facultatives), azote d'origine organique, bio, source. Créer, modifier, archiver, rétablir ; une
 * ferme sans aucun produit peut ajouter la liste de départ (teneurs moyennes de sources publiques)
 * en un tap. Chargé à la demande depuis l'onglet Ferme ; reçoit la porte, marche hors ligne.
 * Contrat : ./test/contrat.ts.
 */
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { UNITES_FERTILISANT, type FormeFertilisant, type UniteFertilisant } from '@planif/core';
import '../../parcellaire/parcellaire.css';
import { Feuille } from '../phyto/Feuille.tsx';
import {
  ajouterListeDeDepart,
  archiverProduit,
  creerProduit,
  modifierProduit,
  ProduitRefuse,
  retablirProduit,
  SQL_PRODUITS_FERME,
  type ContexteFertilisation,
  type LigneProduit,
  type ValeursProduit,
} from './donnees.ts';
import type { ProprietesEcranFertilisation } from './test/contrat.ts';

interface Produit extends ValeursProduit {
  readonly id: string;
  readonly archive: boolean;
}

const nombreOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function produitDe(l: LigneProduit): Produit {
  const forme: FormeFertilisant = l.forme === 'liquide' ? 'liquide' : 'solide';
  const unite = (UNITES_FERTILISANT as readonly string[]).includes(String(l.unite)) ? (String(l.unite) as UniteFertilisant) : 'kg';
  return {
    id: String(l.id),
    nom: String(l.nom ?? ''),
    forme,
    unite,
    teneurN: nombreOuNul(l.teneur_n),
    teneurP2o5: nombreOuNul(l.teneur_p2o5),
    teneurK2o: nombreOuNul(l.teneur_k2o),
    organique: l.organique === 1,
    utilisableEnBio: l.utilisable_en_bio === 1,
    source: String(l.source ?? ''),
    archive: l.supprime_le !== null,
  };
}

const enFrancais = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

/** « 1,2 » ou « 1.2 » → 1.2 ; vide → null ; illisible → undefined. */
function lireTeneur(texte: string): number | null | undefined {
  const t = texte.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : undefined;
}

function messageEchec(e: unknown): string {
  return e instanceof ProduitRefuse ? `Produit refusé : ${e.message}` : 'Le produit n’a pas pu s’enregistrer sur ce téléphone. Réessayez ; si cela recommence, signalez-le.';
}

function Saisie({ titre, surFermer, children }: { readonly titre: string; readonly surFermer: () => void; readonly children: ReactNode }): ReactElement {
  const id = useId();
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus();
  }, []);
  return (
    <div className="parc-voile-saisie">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="parc-saisie"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <h3 id={id} ref={h} tabIndex={-1}>
          {titre}
        </h3>
        {children}
      </div>
    </div>
  );
}

const UNITES: readonly { readonly valeur: UniteFertilisant; readonly libelle: string }[] = [
  { valeur: 'kg', libelle: 'kg' },
  { valeur: 't', libelle: 't' },
  { valeur: 'L', libelle: 'L' },
  { valeur: 'm3', libelle: 'm³' },
];

function Formulaire({ ctx, produit, surFermer }: { readonly ctx: ContexteFertilisation; readonly produit: Produit | null; readonly surFermer: () => void }): ReactElement {
  const id = useId();
  const [nom, setNom] = useState(produit?.nom ?? '');
  const [forme, setForme] = useState<FormeFertilisant>(produit?.forme ?? 'solide');
  const [unite, setUnite] = useState<UniteFertilisant>(produit?.unite ?? 'kg');
  const [n, setN] = useState(enFrancais(produit?.teneurN ?? null));
  const [p, setP] = useState(enFrancais(produit?.teneurP2o5 ?? null));
  const [k, setK] = useState(enFrancais(produit?.teneurK2o ?? null));
  const [organique, setOrganique] = useState(produit?.organique ?? false);
  const [bio, setBio] = useState(produit?.utilisableEnBio ?? false);
  const [source, setSource] = useState(produit?.source ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function faire(action: () => Promise<unknown>): Promise<void> {
    setOccupe(true);
    try {
      await action();
      surFermer();
    } catch (e) {
      console.error('Produit fertilisant non enregistré', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    const teneurs = [lireTeneur(n), lireTeneur(p), lireTeneur(k)] as const;
    if (teneurs.some((t) => t === undefined)) {
      setMessage('Teneurs : un nombre en % (virgule acceptée), ou rien si vous ne la connaissez pas.');
      return;
    }
    const v: ValeursProduit = {
      nom,
      forme,
      unite,
      teneurN: teneurs[0] ?? null,
      teneurP2o5: teneurs[1] ?? null,
      teneurK2o: teneurs[2] ?? null,
      organique,
      utilisableEnBio: bio,
      source,
    };
    void faire(() => (produit === null ? creerProduit(ctx, v) : modifierProduit(ctx, produit.id, v)));
  }

  const texte = (libelle: string, valeur: string, changer: (v: string) => void, o: { readonly mode?: 'decimal'; readonly large?: boolean } = {}) => {
    const cle = `${id}-${libelle}`;
    return (
      <div className={o.large === true ? 'parc-champ-bloc parc-large' : 'parc-champ-bloc'}>
        <label className="parc-etiquette" htmlFor={cle}>
          {libelle}
        </label>
        <input id={cle} className="parc-champ" autoComplete="off" inputMode={o.mode} value={valeur} onChange={(e) => { changer(e.target.value); }} />
      </div>
    );
  };
  const caseACocher = (libelle: string, valeur: boolean, changer: (v: boolean) => void) => (
    <label className="parc-bouton-secondaire parc-large" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input type="checkbox" checked={valeur} style={{ width: 28, height: 28 }} onChange={(e) => { changer(e.target.checked); }} />
      {libelle}
    </label>
  );

  return (
    <Saisie titre={produit === null ? 'Nouveau produit' : 'Modifier le produit'} surFermer={surFermer}>
      <div className="parc-grille">
        {texte('Nom', nom, setNom, { large: true })}
        <div className="parc-champ-bloc">
          <label className="parc-etiquette" htmlFor={`${id}-forme`}>
            Forme
          </label>
          <select id={`${id}-forme`} className="parc-champ" value={forme} onChange={(e) => { setForme(e.target.value === 'liquide' ? 'liquide' : 'solide'); }}>
            <option value="solide">solide</option>
            <option value="liquide">liquide</option>
          </select>
        </div>
        <div className="parc-champ-bloc">
          <label className="parc-etiquette" htmlFor={`${id}-unite`}>
            Unité
          </label>
          <select
            id={`${id}-unite`}
            className="parc-champ"
            value={unite}
            onChange={(e) => {
              const u = UNITES.find((x) => x.valeur === e.target.value);
              if (u !== undefined) setUnite(u.valeur);
            }}
          >
            {UNITES.map((u) => (
              <option key={u.valeur} value={u.valeur}>
                {u.libelle}
              </option>
            ))}
          </select>
        </div>
        {texte('Azote N (%)', n, setN, { mode: 'decimal' })}
        {texte('Phosphore P₂O₅ (%)', p, setP, { mode: 'decimal' })}
        {texte('Potasse K₂O (%)', k, setK, { mode: 'decimal' })}
        {caseACocher('Azote d’origine organique', organique, setOrganique)}
        {caseACocher('Utilisable en bio', bio, setBio)}
        {texte('Source', source, setSource, { large: true })}
      </div>
      <p className="parc-aide">Teneur en % du produit tel qu’apporté ; pour un liquide compté en L ou m³, en kg pour 100 L. Un solide se compte en kg ou en t : compté en L ou m³, il n’a pas d’unités calculées. Laissez vide ce que vous ne connaissez pas.</p>
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
        {produit !== null && (
          <button type="button" className="parc-bouton-danger" disabled={occupe} onClick={() => void faire(() => archiverProduit(ctx, produit.id))}>
            Archiver le produit
          </button>
        )}
      </div>
    </Saisie>
  );
}

const tiret = (x: number | null): string => (x === null ? '–' : `${enFrancais(x)} %`);

function detailProduit(p: Produit): string {
  return [`N ${tiret(p.teneurN)}`, `P₂O₅ ${tiret(p.teneurP2o5)}`, `K₂O ${tiret(p.teneurK2o)}`, `en ${p.unite === 'm3' ? 'm³' : p.unite}`, p.organique ? 'organique' : null, p.utilisableEnBio ? 'bio' : null]
    .filter((x) => x !== null)
    .join(' · ');
}

export function EcranProduitsFertilisants({ porte, fermeId, surFermer, maintenant = () => new Date() }: ProprietesEcranFertilisation): ReactElement {
  const [produits, setProduits] = useState<readonly Produit[] | null>(null);
  const [edition, setEdition] = useState<{ readonly produit: Produit | null } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const ctx: ContexteFertilisation = { porte, fermeId, maintenant };

  useEffect(
    () =>
      porte.surveiller<LigneProduit>({ sql: SQL_PRODUITS_FERME, parametres: [fermeId], tables: ['produit_fertilisant'] }, (l) => {
        setProduits(l.map(produitDe));
      }),
    [porte, fermeId],
  );

  const actifs = produits?.filter((p) => !p.archive) ?? [];
  const archives = produits?.filter((p) => p.archive) ?? [];

  return (
    <Feuille titre="Produits fertilisants" surtitre="Fertilisation" surFermer={surFermer}>
      <section className="parc-section" aria-label="Produits de la ferme">
        <p className="parc-aide">Composts, fumiers et engrais que vous apportez, avec leur teneur : le cahier de fertilisation en calcule les unités.</p>
        <button
          type="button"
          className="parc-bouton-principal"
          onClick={() => {
            setEdition({ produit: null });
          }}
        >
          Nouveau produit
        </button>
        {produits !== null && produits.length === 0 && (
          <>
            <p className="parc-aide">Pour démarrer : compost, fumiers, corne, sang, plumes, vinasse… avec des teneurs moyennes de sources publiques (modifiables, à remplacer par vos analyses).</p>
            <button
              type="button"
              className="parc-bouton-secondaire"
              disabled={occupe}
              onClick={() => {
                setErreur(null);
                setOccupe(true);
                ajouterListeDeDepart(ctx)
                  .catch((e: unknown) => {
                    console.error('Liste de départ non ajoutée', e);
                    setErreur(messageEchec(e));
                  })
                  .finally(() => {
                    setOccupe(false);
                  });
              }}
            >
              Ajouter la liste de départ
            </button>
          </>
        )}
        {produits === null ? (
          <p className="parc-aide">Lecture des produits…</p>
        ) : actifs.length === 0 ? (
          <p className="parc-aide">Aucun produit pour l’instant.</p>
        ) : (
          <ul className="parc-liste">
            {actifs.map((p) => (
              <li key={p.id} data-testid="produit-fertilisant" data-produit={p.id}>
                <button
                  type="button"
                  aria-label={`Modifier ${p.nom}`}
                  className="parc-ligne"
                  onClick={() => {
                    setEdition({ produit: p });
                  }}
                >
                  <span className="parc-ligne-textes">
                    <strong>{p.nom}</strong>
                    <span>{detailProduit(p)}</span>
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
      {archives.length > 0 && (
        <section className="parc-section" aria-label="Archivés">
          <h3>Archivés</h3>
          <ul className="parc-liste">
            {archives.map((p) => (
              <li key={p.id} className="parc-ligne parc-ligne-hors">
                <span className="parc-ligne-textes">
                  <strong>{p.nom}</strong>
                  <span>{detailProduit(p)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Rétablir ${p.nom}`}
                  className="parc-bouton-secondaire"
                  onClick={() => {
                    setErreur(null);
                    retablirProduit(ctx, p.id).catch((e: unknown) => {
                      console.error('Produit non rétabli', e);
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
      {edition !== null && (
        <Formulaire
          ctx={ctx}
          produit={edition.produit}
          surFermer={() => {
            setEdition(null);
          }}
        />
      )}
    </Feuille>
  );
}
