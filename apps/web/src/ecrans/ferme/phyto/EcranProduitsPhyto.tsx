/**
 * Produits phyto de la ferme (T52, règle 1) : nom commercial, AMM, substance active, délai avant
 * récolte, bio, dose maximale. Créer, modifier, archiver, rétablir ; saisie à la main, ou remplie
 * d'un tap depuis la base e-phy (T53, ./RechercheEphy.tsx). Chargé à la demande depuis l'onglet
 * Ferme ; reçoit la porte, marche hors ligne. Contrat : ./test/contrat.ts.
 */
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import '../../parcellaire/parcellaire.css';
import { archiverProduit, creerProduit, modifierProduit, ProduitRefuse, retablirProduit, SQL_PRODUITS_FERME, type ContextePhyto, type LigneProduit, type ValeursProduit } from './donnees.ts';
import type { ProprietesEcranPhyto } from './test/contrat.ts';
import { Feuille } from './Feuille.tsx';
import { chargerCatalogueEphy } from './catalogue.ts';
import { ChoixUsage, RechercheEphy, UsagesParCulture, type ChargerCatalogue } from './RechercheEphy.tsx';
import { propositionUsage, type ProduitEphy, type UsageEphy } from '@planif/core/ephy';

interface Produit {
  readonly id: string;
  readonly nomCommercial: string;
  readonly numeroAmm: string;
  readonly substanceActive: string;
  readonly dar: number;
  readonly bio: boolean;
  readonly doseMaximale: { readonly valeur: number; readonly unite: string } | null;
  readonly archive: boolean;
}

function dose(v: unknown): Produit['doseMaximale'] {
  if (typeof v !== 'string') return null;
  try {
    const d = JSON.parse(v) as { valeur?: unknown; unite?: unknown } | null;
    return d !== null && typeof d.valeur === 'number' && typeof d.unite === 'string' ? { valeur: d.valeur, unite: d.unite } : null;
  } catch {
    return null;
  }
}

function produitDe(l: LigneProduit): Produit {
  return {
    id: String(l.id),
    nomCommercial: String(l.nom_commercial ?? ''),
    numeroAmm: String(l.numero_amm ?? ''),
    substanceActive: String(l.substance_active ?? ''),
    dar: Number(l.delai_avant_recolte_jours ?? 0),
    bio: l.utilisable_en_bio === 1,
    doseMaximale: dose(l.dose_maximale),
    archive: l.supprime_le !== null,
  };
}

const enFrancais = (n: number): string => String(n).replace('.', ',');

/** « 2,5 » ou « 2.5 » → 2.5 ; illisible → null. */
function lireNombre(texte: string): number | null {
  const t = texte.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
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

/** Espèces cultivées par la ferme (séries et plantations en cours) : le DAR proposé en dépend (T53). */
const SQL_ESPECES_CULTIVEES = `SELECT DISTINCT e.nom AS nom FROM espece e
  WHERE e.supprime_le IS NULL AND (e.ferme_id = ? OR e.ferme_id IS NULL)
    AND e.id IN (SELECT espece_id FROM serie WHERE ferme_id = ? AND supprime_le IS NULL
                 UNION SELECT espece_id FROM plantation WHERE ferme_id = ? AND supprime_le IS NULL)
  ORDER BY e.nom`;

/** Produit e-phy choisi : ses usages proposés (ceux des cultures de la ferme, ou tous). */
interface ChoixEphy {
  readonly produit: ProduitEphy;
  readonly usages: readonly UsageEphy[];
  readonly pourLaFerme: boolean;
  readonly darPropose: boolean;
  readonly horsCultures: boolean;
}

function Formulaire({ ctx, produit, chargerCatalogue, surFermer }: { readonly ctx: ContextePhyto; readonly produit: Produit | null; readonly chargerCatalogue: ChargerCatalogue; readonly surFermer: () => void }): ReactElement {
  const id = useId();
  const [nom, setNom] = useState(produit?.nomCommercial ?? '');
  const [amm, setAmm] = useState(produit?.numeroAmm ?? '');
  const [substance, setSubstance] = useState(produit?.substanceActive ?? '');
  const [dar, setDar] = useState(produit === null ? '' : String(produit.dar));
  const [bio, setBio] = useState(produit?.bio ?? false);
  const [doseMax, setDoseMax] = useState(produit?.doseMaximale == null ? '' : enFrancais(produit.doseMaximale.valeur));
  const [unite, setUnite] = useState(produit?.doseMaximale?.unite ?? 'L/ha');
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [especes, setEspeces] = useState<readonly string[]>([]);
  const [choix, setChoix] = useState<ChoixEphy | null>(null);
  const [usageChoisi, setUsageChoisi] = useState<number | null>(null);

  useEffect(() => {
    let vivant = true;
    ctx.porte.lire<{ nom: string }>(SQL_ESPECES_CULTIVEES, [ctx.fermeId, ctx.fermeId, ctx.fermeId]).then(
      (l) => {
        if (vivant) setEspeces(l.map((x) => x.nom));
      },
      (e: unknown) => {
        console.error('Espèces de la ferme illisibles', e);
      },
    );
    return () => {
      vivant = false;
    };
  }, [ctx.porte, ctx.fermeId]);

  function remplirDose(d: UsageEphy['dose']): void {
    setDoseMax(d === null ? '' : enFrancais(d.valeur));
    if (d !== null) setUnite(d.unite);
  }

  /** Un tap sur une suggestion e-phy : la fiche est remplie, rien n'est écrit, tout reste modifiable. */
  function choisirEphy(p: ProduitEphy): void {
    setNom(p.nom);
    setAmm(p.amm);
    setSubstance(p.substances.join(' + ').slice(0, 200));
    setBio(p.bio);
    setMessage(null);
    const prop = propositionUsage(p, especes);
    setDar(prop.dar === null ? '' : String(prop.dar));
    remplirDose(prop.dose);
    setUsageChoisi(null);
    const pourLaFerme = prop.candidats.length > 0;
    setChoix({ produit: p, usages: pourLaFerme ? prop.candidats : p.usages, pourLaFerme, darPropose: prop.dar !== null, horsCultures: !pourLaFerme && especes.length > 0 });
  }

  function choisirUsage(i: number, u: UsageEphy): void {
    setUsageChoisi(i);
    setDar(u.dar === null ? '' : String(u.dar));
    remplirDose(u.dose);
  }

  async function faire(action: () => Promise<unknown>): Promise<void> {
    setOccupe(true);
    try {
      await action();
      surFermer();
    } catch (e) {
      console.error('Produit phyto non enregistré', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    const jours = dar.trim();
    if (!/^\d+$/.test(jours)) {
      setMessage('Délai avant récolte : un nombre entier de jours (0 si aucun).');
      return;
    }
    let dose: ValeursProduit['doseMaximale'] = null;
    if (doseMax.trim() !== '') {
      const valeur = lireNombre(doseMax);
      if (valeur === null) {
        setMessage('Dose maximale : un nombre (virgule acceptée), ou rien.');
        return;
      }
      dose = { valeur, unite };
    }
    const v: ValeursProduit = { nomCommercial: nom, numeroAmm: amm, substanceActive: substance, delaiAvantRecolteJours: Number(jours), utilisableEnBio: bio, doseMaximale: dose };
    void faire(() => (produit === null ? creerProduit(ctx, v) : modifierProduit(ctx, produit.id, v)));
  }

  const texte = (libelle: string, valeur: string, changer: (v: string) => void, o: { readonly mode?: 'decimal' | 'numeric'; readonly large?: boolean } = {}) => {
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

  return (
    <Saisie titre={produit === null ? 'Nouveau produit' : 'Modifier le produit'} surFermer={surFermer}>
      <RechercheEphy chargerCatalogue={chargerCatalogue} surChoisir={choisirEphy} />
      {choix !== null && (
        <ChoixUsage
          produit={choix.produit}
          usages={choix.usages}
          pourLaFerme={choix.pourLaFerme}
          darPropose={choix.darPropose}
          horsCultures={choix.horsCultures}
          choisi={usageChoisi}
          surChoisir={choisirUsage}
          surTous={() => {
            setUsageChoisi(null);
            setChoix({ ...choix, usages: choix.produit.usages, pourLaFerme: false });
          }}
        />
      )}
      {choix !== null && especes.length > 0 && <UsagesParCulture produit={choix.produit} especes={especes} />}
      <div className="parc-grille">
        {texte('Nom commercial', nom, setNom, { large: true })}
        {texte('N° AMM', amm, setAmm)}
        {texte('Délai avant récolte (jours)', dar, setDar, { mode: 'numeric' })}
        {texte('Substance active', substance, setSubstance, { large: true })}
        {texte('Dose maximale', doseMax, setDoseMax, { mode: 'decimal' })}
        {texte('Unité de la dose', unite, setUnite)}
        <label className="parc-bouton-secondaire parc-large" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={bio} style={{ width: 28, height: 28 }} onChange={(e) => { setBio(e.target.checked); }} />
          Utilisable en bio
        </label>
      </div>
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

function detailProduit(p: Produit): string {
  return [p.numeroAmm === '' ? 'sans AMM' : `AMM ${p.numeroAmm}`, `DAR ${String(p.dar)} j`, p.bio ? 'bio' : null, p.substanceActive === '' ? null : p.substanceActive]
    .filter((x) => x !== null)
    .join(' · ');
}

export function EcranProduitsPhyto({ porte, fermeId, surFermer, maintenant = () => new Date(), chargerCatalogue = chargerCatalogueEphy }: ProprietesEcranPhyto): ReactElement {
  const [produits, setProduits] = useState<readonly Produit[] | null>(null);
  const [edition, setEdition] = useState<{ readonly produit: Produit | null } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const ctx: ContextePhyto = { porte, fermeId, maintenant };

  useEffect(
    () =>
      porte.surveiller<LigneProduit>({ sql: SQL_PRODUITS_FERME, parametres: [fermeId], tables: ['produit_phyto'] }, (l) => {
        setProduits(l.map(produitDe));
      }),
    [porte, fermeId],
  );

  const actifs = produits?.filter((p) => !p.archive) ?? [];
  const archives = produits?.filter((p) => p.archive) ?? [];

  return (
    <Feuille titre="Produits phyto" surtitre="Traitements phyto" surFermer={surFermer}>
      <section className="parc-section" aria-label="Produits de la ferme">
        <p className="parc-aide">Les produits que vous utilisez, avec leur délai avant récolte : il est repris à chaque traitement.</p>
        <button
          type="button"
          className="parc-bouton-principal"
          onClick={() => {
            setEdition({ produit: null });
          }}
        >
          Nouveau produit
        </button>
        {produits === null ? (
          <p className="parc-aide">Lecture des produits…</p>
        ) : actifs.length === 0 ? (
          <p className="parc-aide">Aucun produit pour l’instant.</p>
        ) : (
          <ul className="parc-liste">
            {actifs.map((p) => (
              <li key={p.id} data-testid="produit-phyto" data-produit={p.id}>
                <button
                  type="button"
                  aria-label={`Modifier ${p.nomCommercial}`}
                  className="parc-ligne"
                  onClick={() => {
                    setEdition({ produit: p });
                  }}
                >
                  <span className="parc-ligne-textes">
                    <strong>{p.nomCommercial}</strong>
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
                  <strong>{p.nomCommercial}</strong>
                  <span>{detailProduit(p)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Rétablir ${p.nomCommercial}`}
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
          chargerCatalogue={chargerCatalogue}
          surFermer={() => {
            setEdition(null);
          }}
        />
      )}
    </Feuille>
  );
}
