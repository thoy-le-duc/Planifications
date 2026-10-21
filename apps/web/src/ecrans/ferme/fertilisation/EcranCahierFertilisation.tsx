/**
 * Cahier de fertilisation (T54, règles 3, 4 et 6) : par planche, les unités N, P₂O₅, K₂O apportées
 * dans la saison (kg/ha) ; un tap sur une planche ouvre sa fiche « Fertilisation » (ses apports).
 * Option « zone vulnérable nitrates » (Q44, décochée par défaut) : cochée, le plan prévisionnel
 * (apports prévus par les travaux des séries) et l'alerte au-delà de 170 kg N/ha d'azote
 * organique sur l'année apparaissent ; décochée, rien de tout cela. Le calcul est celui du cœur
 * (`bilanFertilisation`, `alertesAzoteOrganique`), le même que cahier-fertilisation.csv de
 * l'export. On mesure ce qui a été apporté : aucune dose n'est conseillée.
 * Chargé à la demande depuis l'onglet Ferme ; reçoit la porte, marche hors ligne.
 */
import { PLAFOND_AZOTE_ORGANIQUE_KG_HA, type AlerteAzote, type ApportCalcule, type BilanEmplacement, type TotalFertilisation } from '@planif/core';
import { useEffect, useState, type ReactElement } from 'react';
import '../../parcellaire/parcellaire.css';
import { Feuille } from '../phyto/Feuille.tsx';
import { TEXTE_DENSITE_SUPPOSEE } from './avertissements.ts';
import { ecrireZoneVulnerable, lireCahier, periodeDuCahier, SQL_FERME, TABLES_CAHIER, type CahierLu } from './donnees.ts';
import type { ProprietesEcranFertilisation } from './test/contrat.ts';

const jourLocal = (): string => {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nombre = (x: number): string => FORMAT.format(x);
const jjmmaaaa = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function unites(t: TotalFertilisation): string {
  return `N ${nombre(t.n)} · P₂O₅ ${nombre(t.p2o5)} · K₂O ${nombre(t.k2o)} kg/ha`;
}

function texteAlerte(a: AlerteAzote, code: string): string {
  const plafond = `au-delà du plafond de ${nombre(PLAFOND_AZOTE_ORGANIQUE_KG_HA)} kg N/ha`;
  return a.sorte === 'realise'
    ? `${code} : ${nombre(a.realiseKgHa)} kg N/ha d’azote organique apportés en ${a.annee}, ${plafond}.`
    : `${code} : ${nombre(a.realiseKgHa)} kg N/ha apportés et ${nombre(a.prevuKgHa)} prévus en ${a.annee} : azote organique ${plafond} si tout est fait.`;
}

function LigneApport({ a }: { readonly a: ApportCalcule }): ReactElement {
  const u = a.kgParHa;
  const valeurs = u === null ? (a.kg === null ? 'sans teneur' : 'surface inconnue') : [u.n === null ? null : `N ${nombre(u.n)}`, u.p2o5 === null ? null : `P₂O₅ ${nombre(u.p2o5)}`, u.k2o === null ? null : `K₂O ${nombre(u.k2o)}`].filter((x) => x !== null).join(' · ') + ' kg/ha';
  return (
    <li data-testid="apport" className="parc-ligne">
      <span className="parc-ligne-textes">
        <strong>
          {jjmmaaaa(a.date)} · {a.produit}
        </strong>
        <span>
          {nombre(a.quantite)} {a.unite} · {valeurs}
        </span>
        {a.densiteSupposee && <span data-testid="densite-supposee">{TEXTE_DENSITE_SUPPOSEE}</span>}
      </span>
    </li>
  );
}

interface Periode {
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
}

function FichePlanche({
  code,
  emplacementId,
  cahier,
  periode,
  surFermer,
}: {
  readonly code: string;
  readonly emplacementId: string;
  readonly cahier: CahierLu;
  readonly periode: Periode;
  readonly surFermer: () => void;
}): ReactElement {
  const dans = (a: ApportCalcule) => a.date >= periode.debut && a.date <= periode.fin && a.emplacementIds.includes(emplacementId);
  const apports = cahier.bilan.apports.filter(dans);
  const prevus = cahier.bilan.prevus.filter(dans);
  const bilan = cahier.bilan.parEmplacement.find((b) => b.emplacementId === emplacementId && b.periode === periode.nom);
  const alertes = cahier.zoneVulnerable ? cahier.alertes.filter((a) => a.emplacementId === emplacementId && a.annee >= periode.debut.slice(0, 4) && a.annee <= periode.fin.slice(0, 4)) : [];
  return (
    <Feuille titre={`Fertilisation ${code}`} surtitre={periode.nom} surFermer={surFermer}>
      {alertes.map((a) => (
        <p key={a.annee} data-testid="alerte-azote" role="status" className="parc-erreur">
          {texteAlerte(a, code)}
        </p>
      ))}
      <section className="parc-section" aria-label="Apports réalisés">
        <h3>Apports réalisés</h3>
        {bilan !== undefined && <p className="parc-aide">Total : {unites(bilan.realise)}</p>}
        {apports.length === 0 ? (
          <p className="parc-aide">Aucun apport sur cette planche cette saison.</p>
        ) : (
          <ul className="parc-liste">
            {apports.map((a) => (
              <LigneApport key={a.evenementId ?? a.date} a={a} />
            ))}
          </ul>
        )}
      </section>
      {cahier.zoneVulnerable && (
        <section className="parc-section" aria-label="Plan prévisionnel" data-testid="plan-previsionnel">
          <h3>Plan prévisionnel</h3>
          {bilan !== undefined && bilan.prevu.apports > 0 && <p className="parc-aide">Prévu : {unites(bilan.prevu)}</p>}
          {prevus.length === 0 ? (
            <p className="parc-aide">Aucun apport prévu par les travaux des séries sur cette planche.</p>
          ) : (
            <ul className="parc-liste">
              {prevus.map((a, i) => (
                <LigneApport key={`${a.date}-${String(i)}`} a={a} />
              ))}
            </ul>
          )}
        </section>
      )}
    </Feuille>
  );
}

export function EcranCahierFertilisation({ porte, fermeId, surFermer, aujourdhui = jourLocal }: ProprietesEcranFertilisation): ReactElement {
  const [cahier, setCahier] = useState<CahierLu | null>(null);
  const [periode, setPeriode] = useState<Periode | null>(null);
  const [fiche, setFiche] = useState<{ readonly id: string; readonly code: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const jour = aujourdhui();

  useEffect(() => {
    let actif = true;
    periodeDuCahier(porte, fermeId, jour).then(
      (p) => {
        if (actif) setPeriode(p);
      },
      (e: unknown) => {
        console.error('Période du cahier illisible', e);
      },
    );
    // Relu à chaque changement des tables lues (apport saisi, produit modifié, option cochée…).
    const arreter = porte.surveiller<{ zone: number | null }>({ sql: SQL_FERME, parametres: [fermeId], tables: [...TABLES_CAHIER] }, () => {
      lireCahier(porte, fermeId).then(
        (c) => {
          if (actif) setCahier(c);
        },
        (e: unknown) => {
          console.error('Cahier de fertilisation illisible', e);
          if (actif) setErreur('Le cahier n’a pas pu se lire sur ce téléphone. Rechargez l’appli ; si cela recommence, signalez-le.');
        },
      );
    });
    return () => {
      actif = false;
      arreter();
    };
  }, [porte, fermeId, jour]);

  const pret = cahier !== null && periode !== null;
  const codeDe = (id: string): string => cahier?.codes.get(id.toLowerCase()) ?? '?';
  const lignes: BilanEmplacement[] = !pret
    ? []
    : cahier.bilan.parEmplacement
        .filter((b) => b.periode === periode.nom && (b.realise.apports > 0 || (cahier.zoneVulnerable && b.prevu.apports > 0)))
        .sort((a, b) => codeDe(a.emplacementId).localeCompare(codeDe(b.emplacementId), 'fr', { numeric: true }));
  const alertes = pret && cahier.zoneVulnerable ? cahier.alertes.filter((a) => a.annee >= periode.debut.slice(0, 4) && a.annee <= periode.fin.slice(0, 4)) : [];

  return (
    <Feuille titre="Cahier de fertilisation" surtitre={periode?.nom ?? 'Fertilisation'} surFermer={surFermer}>
      <section className="parc-section" aria-label="Zone vulnérable">
        <label className="parc-bouton-secondaire" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="checkbox"
            checked={cahier?.zoneVulnerable ?? false}
            disabled={cahier === null}
            style={{ width: 28, height: 28 }}
            onChange={(e) => {
              setErreur(null);
              ecrireZoneVulnerable({ porte, fermeId }, e.target.checked).catch((err: unknown) => {
                console.error('Option zone vulnérable non enregistrée', err);
                setErreur('L’option n’a pas pu s’enregistrer sur ce téléphone. Réessayez ; si cela recommence, signalez-le.');
              });
            }}
          />
          Zone vulnérable nitrates
        </label>
        <p className="parc-aide">Cochée : plan prévisionnel par planche et alerte au-delà de {nombre(PLAFOND_AZOTE_ORGANIQUE_KG_HA)} kg N/ha d’azote organique sur l’année.</p>
      </section>
      {alertes.map((a) => (
        <p key={`${a.emplacementId}-${a.annee}`} data-testid="alerte-azote" role="status" className="parc-erreur">
          {texteAlerte(a, codeDe(a.emplacementId))}
        </p>
      ))}
      <section className="parc-section" aria-label="Planches">
        <h3>{periode?.nom ?? ''}</h3>
        {!pret ? (
          <p className="parc-aide">Lecture du cahier…</p>
        ) : lignes.length === 0 ? (
          <p className="parc-aide">Aucun apport cette saison. Saisissez-les depuis Aujourd’hui (« Fertilisation ») ou en faisant les travaux prévus.</p>
        ) : (
          <ul className="parc-liste">
            {lignes.map((b) => {
              const code = codeDe(b.emplacementId);
              return (
                <li key={b.emplacementId} data-testid="bilan-planche" data-emplacement={b.emplacementId}>
                  <button
                    type="button"
                    aria-label={`Fertilisation ${code}`}
                    className="parc-ligne"
                    onClick={() => {
                      setFiche({ id: b.emplacementId, code });
                    }}
                  >
                    <span className="parc-ligne-textes">
                      <strong>{code}</strong>
                      <span>
                        {unites(b.realise)}
                        {b.realise.sansUnites > 0 ? ` · ${String(b.realise.sansUnites)} apport${b.realise.sansUnites > 1 ? 's' : ''} sans teneur` : ''}
                      </span>
                    </span>
                    <span aria-hidden="true" className="parc-chevron">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="parc-aide">Le cahier complet (un apport par ligne) est dans l’export : cahier-fertilisation.csv.</p>
      </section>
      {erreur !== null && (
        <p role="alert" className="parc-erreur">
          {erreur}
        </p>
      )}
      {fiche !== null && pret && (
        <FichePlanche
          code={fiche.code}
          emplacementId={fiche.id}
          cahier={cahier}
          periode={periode}
          surFermer={() => {
            setFiche(null);
          }}
        />
      )}
    </Feuille>
  );
}
