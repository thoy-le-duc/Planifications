/**
 * « Vannes d'irrigation » (T57, règle 1) : onglet Ferme → « Saisons, zones et planches » →
 * « Vannes ». Chargé à la demande depuis l'écran du parcellaire ; reçoit la porte (ni PowerSync,
 * ni src/donnees). Contrat : ../test/contrat-vannes.ts.
 *
 * Les 60 vannes de la ferme se déclarent d'un geste (« 60 vannes, V1 à V60 »), puis chaque vanne
 * dit ce qu'elle arrose : une case par planche, groupées par zone (une vanne peut arroser plusieurs
 * zones). Le lien est daté : décocher une planche ferme son lien la veille, l'historique reste.
 * Règles : `@planif/core/irrigation` ; écritures (une transaction par geste, annulable 10 s) :
 * ./ecritures.ts.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { emplacementsArroses, nomDeVanne, validerVanne, vannesDuLot, type LienVanne } from '@planif/core/irrigation';
import type { PorteDonnees } from '@planif/sync';
import '../parcellaire.css';
import './vannes.css';
import type { ContexteParcellaire, Enregistrement } from '../ecritures.ts';
import { creerVannes, EcritureRefusee, enregistrerVanne, supprimerVanne } from './ecritures.ts';

/** Durée du bandeau « Annuler » (comme le parcellaire). */
export const DELAI_ANNULATION_MS = 10_000;

export interface ProprietesEcranVannes {
  readonly porte: PorteDonnees;
  readonly fermeId: string;
  readonly surFermer: () => void;
  /** Jour du téléphone, 'AAAA-MM-JJ'. */
  readonly aujourdhui?: () => string;
  readonly maintenant?: () => Date;
}

interface VanneLue {
  readonly id: string;
  readonly numero: number;
  readonly nom: string;
  readonly debit: number | null;
}
interface PlancheLue {
  readonly id: string;
  readonly code: string;
  readonly zoneId: string;
  readonly zone: string;
  readonly enService: boolean;
}

type L = Readonly<Record<string, unknown>>;
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const nbOuNul = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const deux = (n: number) => String(n).padStart(2, '0');
function jourDuTelephone(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}
const maintenantParDefaut = () => new Date();
const comparerCodes = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
const messageEchec = (e: unknown): string => (e instanceof EcritureRefusee ? `Rien n’a été enregistré : ${e.message}.` : 'Rien n’a été enregistré : la base du téléphone a refusé l’écriture.');
/** Nombre tapé (virgule ou point décimal), comme le parcellaire (../regles.ts) ; null s'il est illisible. */
function lireNombre(texte: string): number | null {
  const t = texte.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const nombreFr = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));
const planches = (n: number): string => (n === 0 ? 'aucune planche' : `${String(n)} ${n > 1 ? 'planches' : 'planche'}`);

const CROIX = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

function Champ({ etiquette, valeur, surChange, mode }: { etiquette: string; valeur: string; surChange: (v: string) => void; mode?: 'decimal' | 'numeric' }) {
  const id = useId();
  return (
    <div className="parc-champ-bloc">
      <label htmlFor={id} className="parc-etiquette">
        {etiquette}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        {...(mode === undefined ? {} : { inputMode: mode })}
        className="parc-champ"
        value={valeur}
        onChange={(e) => {
          surChange(e.target.value);
        }}
      />
    </div>
  );
}

// ── Fiche d'une vanne ────────────────────────────────────────────────────────────────────────

function FicheVanne({
  ctx,
  vanne,
  numerosPris,
  planchesFerme,
  arrosees,
  surFermer,
  surEnregistre,
}: {
  readonly ctx: ContexteParcellaire;
  readonly vanne: VanneLue;
  readonly numerosPris: readonly number[];
  readonly planchesFerme: readonly PlancheLue[];
  readonly arrosees: readonly string[];
  readonly surFermer: () => void;
  readonly surEnregistre: (e: Enregistrement | null) => void;
}) {
  const idTitre = useId();
  const h = useRef<HTMLHeadingElement>(null);
  const [numero, setNumero] = useState(String(vanne.numero));
  const [nom, setNom] = useState(vanne.nom);
  const [debit, setDebit] = useState(nombreFr(vanne.debit));
  const [cochees, setCochees] = useState<ReadonlySet<string>>(() => new Set(arrosees));
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    h.current?.focus();
  }, []);

  // Planches en service, et celles que la vanne arrose encore (même hors service), groupées par zone.
  const zones = useMemo(() => {
    const visibles = planchesFerme.filter((p) => p.enService || arrosees.includes(p.id));
    const m = new Map<string, { readonly nom: string; readonly planches: PlancheLue[] }>();
    for (const p of visibles) {
      const z = m.get(p.zoneId);
      if (z === undefined) m.set(p.zoneId, { nom: p.zone, planches: [p] });
      else z.planches.push(p);
    }
    return [...m.entries()].sort(([, a], [, b]) => comparerCodes(a.nom, b.nom));
  }, [planchesFerme, arrosees]);

  async function faire(action: () => Promise<Enregistrement | null>): Promise<void> {
    setOccupe(true);
    try {
      surEnregistre(await action());
      surFermer();
    } catch (e) {
      console.error('Vanne non enregistrée', e);
      setMessage(messageEchec(e));
      setOccupe(false);
    }
  }

  function enregistrer(): void {
    const n = lireNombre(numero);
    const d = debit.trim() === '' ? null : lireNombre(debit);
    if (n === null) {
      setMessage('Indiquez le numéro de la vanne.');
      return;
    }
    if (debit.trim() !== '' && d === null) {
      setMessage('Débit : un nombre de litres par heure.');
      return;
    }
    const v = validerVanne({ numeroVanne: n, nom, debitLitresHeure: d }, numerosPris);
    if (!v.ok) {
      setMessage(`${v.message.charAt(0).toUpperCase()}${v.message.slice(1)}.`);
      return;
    }
    const voulus = planchesFerme.filter((p) => cochees.has(p.id)).map((p) => p.id);
    void faire(() => enregistrerVanne(ctx, vanne.id, v.valeur, voulus));
  }

  function basculer(id: string): void {
    setCochees((prev) => {
      const s = new Set(prev);
      if (!s.delete(id)) s.add(id);
      return s;
    });
    setMessage(null);
  }

  const changer = (f: (v: string) => void) => (v: string) => {
    f(v);
    setMessage(null);
  };
  return (
    <div className="parc-voile-saisie">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        className="parc-saisie"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            surFermer();
          }
        }}
      >
        <h3 id={idTitre} ref={h} tabIndex={-1}>
          {vanne.nom}
        </h3>
        <div className="parc-grille">
          <Champ etiquette="Numéro" mode="numeric" valeur={numero} surChange={changer(setNumero)} />
          <Champ etiquette="Nom" valeur={nom} surChange={changer(setNom)} />
          <Champ etiquette="Débit (L/h)" mode="decimal" valeur={debit} surChange={changer(setDebit)} />
        </div>
        <p className="parc-aide">Planches arrosées à partir d’aujourd’hui ; ce qu’elle arrosait avant reste dans l’historique.</p>
        {zones.length === 0 && <p className="parc-aide">Aucune planche dans la ferme pour l’instant.</p>}
        {zones.map(([zoneId, z]) => (
          <fieldset key={zoneId} className="van-zone">
            <legend className="parc-etiquette">{z.nom}</legend>
            <div className="van-cases">
              {z.planches.map((p) => (
                <label key={p.id} className={cochees.has(p.id) ? 'van-case van-case-cochee' : 'van-case'}>
                  <input
                    type="checkbox"
                    data-testid="planche-arrosee"
                    data-emplacement={p.id}
                    aria-label={`${z.nom} ${p.code}`}
                    checked={cochees.has(p.id)}
                    onChange={() => {
                      basculer(p.id);
                    }}
                  />
                  <span>{p.code}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {message !== null && (
          <p role="alert" className="parc-erreur">
            {message}
          </p>
        )}
        <div className="parc-actions">
          <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={enregistrer}>
            Enregistrer
          </button>
          <button type="button" className="parc-bouton-danger" disabled={occupe} onClick={() => void faire(() => supprimerVanne(ctx, vanne.id))}>
            Supprimer la vanne
          </button>
          <button type="button" className="parc-bouton-secondaire" onClick={surFermer}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Écran ────────────────────────────────────────────────────────────────────────────────────

interface Bandeau extends Enregistrement {
  readonly numero: number;
}

export function EcranVannes({ porte, fermeId, surFermer, aujourdhui = jourDuTelephone, maintenant = maintenantParDefaut }: ProprietesEcranVannes): ReactElement {
  const [jour] = useState(aujourdhui);
  const ctx = useMemo<ContexteParcellaire>(() => ({ porte, fermeId, maintenant, aujourdhui: jour }), [porte, fermeId, maintenant, jour]);
  const [vannes, setVannes] = useState<VanneLue[] | null>(null);
  const [liens, setLiens] = useState<LienVanne[] | null>(null);
  const [planchesFerme, setPlanches] = useState<PlancheLue[] | null>(null);
  const [nombre, setNombre] = useState('');
  const [prefixe, setPrefixe] = useState('V');
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [ouverte, setOuverte] = useState<{ readonly id: string; readonly numero: number } | null>(null);
  const [bandeau, setBandeau] = useState<Bandeau | null>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const compteur = useRef(0);
  const idTitre = useId();
  const titre = useRef<HTMLHeadingElement>(null);

  useEffect(
    () =>
      porte.surveiller<VanneLue>(
        {
          sql: 'SELECT id, numero_vanne, nom, debit_litres_heure FROM secteur_irrigation WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY numero_vanne, id',
          parametres: [fermeId],
          tables: ['secteur_irrigation'],
          convertir: (l: L) => ({ id: txt(l.id), numero: nbOuNul(l.numero_vanne) ?? 0, nom: txt(l.nom), debit: nbOuNul(l.debit_litres_heure) }),
        },
        setVannes,
      ),
    [porte, fermeId],
  );
  useEffect(
    () =>
      porte.surveiller<LienVanne>(
        {
          sql: 'SELECT id, secteur_irrigation_id, emplacement_id, du, au FROM secteur_emplacement WHERE ferme_id = ? AND supprime_le IS NULL',
          parametres: [fermeId],
          tables: ['secteur_emplacement'],
          convertir: (l: L) => ({ id: txt(l.id), secteurId: txt(l.secteur_irrigation_id), emplacementId: txt(l.emplacement_id), du: txt(l.du), au: typeof l.au === 'string' ? l.au : null }),
        },
        setLiens,
      ),
    [porte, fermeId],
  );
  useEffect(
    () =>
      porte.surveiller<PlancheLue>(
        {
          sql: `SELECT e.id, e.code, e.zone_id, z.nom AS zone, e.actif_au FROM emplacement e JOIN zone z ON z.id = e.zone_id
                WHERE e.ferme_id = ? AND e.supprime_le IS NULL AND z.supprime_le IS NULL`,
          parametres: [fermeId],
          tables: ['emplacement', 'zone'],
          convertir: (l: L) => ({ id: txt(l.id), code: txt(l.code), zoneId: txt(l.zone_id), zone: txt(l.zone), enService: l.actif_au === null || txt(l.actif_au) >= jour }),
        },
        (l) => {
          setPlanches(l.sort((a, b) => comparerCodes(a.zone, b.zone) || comparerCodes(a.code, b.code) || (a.id < b.id ? -1 : 1)));
        },
      ),
    [porte, fermeId, jour],
  );

  const pret = vannes !== null && liens !== null && planchesFerme !== null;
  useEffect(() => {
    titre.current?.focus();
  }, []);

  useEffect(() => {
    if (bandeau === null) return undefined;
    const minuterie = setTimeout(() => {
      setBandeau((b) => (b?.numero === bandeau.numero ? null : b));
    }, DELAI_ANNULATION_MS);
    return () => {
      clearTimeout(minuterie);
    };
  }, [bandeau]);

  function enregistre(e: Enregistrement | null): void {
    if (e === null) return;
    compteur.current += 1;
    setEchec(null);
    setBandeau({ ...e, numero: compteur.current });
  }

  function annuler(b: Bandeau): void {
    setBandeau(null);
    b.annuler().catch((e: unknown) => {
      console.error('Annulation impossible', e);
      setEchec(`« ${b.texte} » reste tel quel : ${e instanceof EcritureRefusee ? e.message : 'la base du téléphone a refusé l’écriture'}.`);
    });
  }

  const numerosPris = useMemo(() => (vannes ?? []).map((v) => v.numero), [vannes]);
  const n = lireNombre(nombre);
  const apercu = n !== null && Number.isInteger(n) ? vannesDuLot({ nombre: n, prefixe }, numerosPris) : null;

  async function ajouter(): Promise<void> {
    if (occupe) return;
    const lu = lireNombre(nombre);
    const lot = vannesDuLot({ nombre: lu ?? Number.NaN, prefixe }, numerosPris);
    if (!lot.ok) {
      setMessage(`${lot.message.charAt(0).toUpperCase()}${lot.message.slice(1)}.`);
      return;
    }
    setOccupe(true);
    try {
      enregistre(await creerVannes(ctx, lot.valeur));
      setNombre('');
      setMessage(null);
    } catch (e) {
      console.error('Vannes non ajoutées', e);
      setMessage(messageEchec(e));
    } finally {
      setOccupe(false);
    }
  }

  const arroseesPar = (id: string): string[] => emplacementsArroses(liens ?? [], id, jour);
  const vanneOuverte = ouverte === null ? undefined : vannes?.find((v) => v.id === ouverte.id);

  return (
    <>
      <div className="parc-voile van-voile">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitre}
          data-testid="ecran-vannes"
          className="parc-feuille"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && ouverte === null) {
              e.stopPropagation();
              surFermer();
            }
          }}
        >
          <div className="parc-tete">
            <div className="parc-tete-textes">
              <span className="parc-surtitre">Saisons, zones et planches</span>
              <h2 id={idTitre} ref={titre} tabIndex={-1}>
                Vannes d’irrigation
              </h2>
            </div>
            <button type="button" aria-label="Fermer" className="parc-fermer" onClick={surFermer}>
              {CROIX}
            </button>
          </div>
          <div className="parc-corps" {...(pret ? { 'data-testid': 'vannes-pret' } : {})}>
            {!pret ? (
              <p className="parc-aide">Lecture de la ferme…</p>
            ) : (
              <>
                <section className="parc-carte" aria-label="Ajouter des vannes">
                  <h3 className="parc-etiquette">Ajouter des vannes</h3>
                  <div className="parc-grille">
                    <Champ
                      etiquette="Nombre de vannes"
                      mode="numeric"
                      valeur={nombre}
                      surChange={(v) => {
                        setNombre(v);
                        setMessage(null);
                      }}
                    />
                    <Champ
                      etiquette="Préfixe du nom"
                      valeur={prefixe}
                      surChange={(v) => {
                        setPrefixe(v);
                        setMessage(null);
                      }}
                    />
                  </div>
                  <p className="parc-aide" aria-live="polite">
                    {apercu?.ok === true
                      ? apercu.valeur.length === 1
                        ? `Vanne ${apercu.valeur[0]?.nom ?? ''}`
                        : `Vannes : ${apercu.valeur[0]?.nom ?? ''} à ${apercu.valeur[apercu.valeur.length - 1]?.nom ?? ''}`
                      : `Les numéros se suivent : ${nomDeVanne(prefixe, 1)}, ${nomDeVanne(prefixe, 2)}, ${nomDeVanne(prefixe, 3)}…`}
                  </p>
                  {message !== null && (
                    <p role="alert" className="parc-erreur">
                      {message}
                    </p>
                  )}
                  <button type="button" className="parc-bouton-principal" disabled={occupe} onClick={() => void ajouter()}>
                    Ajouter les vannes
                  </button>
                </section>
                {vannes.length === 0 ? (
                  <p className="parc-aide">Aucune vanne pour l’instant. Ajoutez-les d’un coup (« 60 vannes »), puis cochez ce que chacune arrose.</p>
                ) : (
                  <ul className="parc-liste" aria-label="Vannes de la ferme">
                    {vannes.map((v) => (
                      <li key={v.id} data-testid="vanne" data-vanne={v.id} data-numero={v.numero}>
                        <button
                          type="button"
                          aria-label={`Modifier ${v.nom}`}
                          className="parc-ligne"
                          onClick={() => {
                            compteur.current += 1;
                            setOuverte({ id: v.id, numero: compteur.current });
                          }}
                        >
                          <span className="parc-ligne-textes">
                            <strong>{v.nom}</strong>
                            <span>
                              {planches(arroseesPar(v.id).length)}
                              {v.debit === null ? '' : ` · ${nombreFr(v.debit)} L/h`}
                            </span>
                          </span>
                          <span aria-hidden="true" className="parc-chevron">
                            ›
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {vanneOuverte !== undefined && ouverte !== null && planchesFerme !== null && (
        <FicheVanne
          key={ouverte.numero}
          ctx={ctx}
          vanne={vanneOuverte}
          numerosPris={numerosPris.filter((x) => x !== vanneOuverte.numero)}
          planchesFerme={planchesFerme}
          arrosees={arroseesPar(vanneOuverte.id)}
          surFermer={() => {
            setOuverte(null);
          }}
          surEnregistre={enregistre}
        />
      )}

      {bandeau !== null && (
        <div key={bandeau.numero} data-testid="saisie-annulable" role="status" className="parc-bandeau">
          <span className="parc-bandeau-texte">
            <strong>Enregistré</strong>
            <span>{bandeau.texte}</span>
          </span>
          <button
            type="button"
            className="parc-bandeau-annuler"
            onClick={() => {
              annuler(bandeau);
            }}
          >
            Annuler
          </button>
        </div>
      )}
      {echec !== null && bandeau === null && (
        <div role="alert" className="parc-bandeau parc-bandeau-echec">
          <span className="parc-bandeau-texte">
            <strong>Annulation impossible</strong>
            <span>{echec}</span>
          </span>
          <button
            type="button"
            className="parc-bandeau-annuler"
            onClick={() => {
              setEchec(null);
            }}
          >
            OK
          </button>
        </div>
      )}
    </>
  );
}

export default EcranVannes;
