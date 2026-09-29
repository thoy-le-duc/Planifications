/**
 * Écran de connexion, pensé pour des gants (Q9) : un seul champ par étape, cibles de 56 px,
 * focus déjà dans le champ, vérification qui part seule au 6e chiffre, adresse jamais redemandée.
 * Habillage (T16) : carte claire de la maquette « Connexion » ; le bandeau vert est dans App, les
 * styles dans ./connexion.css (chargée au démarrage par App).
 */
import { useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { BoutonPrincipal, BoutonSecondaire } from '../ui/elements.tsx';
import { LONGUEUR_CODE, normaliserEmail, type ClientConnexion } from './client.ts';
import type { SessionConnexion } from './session.ts';

export type EtapeConnexion = { etape: 'email' } | { etape: 'code'; email: string };

export interface ProprietesEcranConnexion {
  readonly client: ClientConnexion;
  readonly surConnexion: (session: SessionConnexion) => void;
  readonly etapeInitiale?: EtapeConnexion;
  /** Avertissements de l'appli (effacement en attente…), en tête de la carte. */
  readonly children?: ReactNode;
}

const MESSAGES = {
  email_invalide: 'Cette adresse ne semble pas valide.',
  trop_tot: 'Un code vient déjà d’être envoyé : utilisez-le, ou patientez une minute.',
  code_invalide: 'Code incorrect ou expiré. Vérifiez le dernier e-mail reçu.',
  hors_ligne: 'Pas de réseau. Réessayez quand le téléphone capte.',
  erreur: 'Le serveur ne répond pas correctement. Réessayez dans un instant.',
} as const;

export function EcranConnexion({ client, surConnexion, etapeInitiale = { etape: 'email' }, children }: ProprietesEcranConnexion) {
  const [etape, setEtape] = useState<EtapeConnexion>(etapeInitiale);
  const [email, setEmail] = useState(etapeInitiale.etape === 'code' ? etapeInitiale.email : '');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champCode = useRef<HTMLInputElement>(null);

  async function demander(e: SyntheticEvent) {
    e.preventDefault();
    if (enCours) return;
    setEnCours(true);
    setMessage(null);
    const r = await client.demanderCode(email);
    setEnCours(false);
    // « trop tôt » : un code est déjà parti, on passe quand même à sa saisie.
    if (r.ok || r.raison === 'trop_tot') {
      setEtape({ etape: 'code', email: normaliserEmail(email) });
      setCode('');
      if (!r.ok) setMessage(MESSAGES.trop_tot);
      return;
    }
    setMessage(MESSAGES[r.raison]);
  }

  async function verifier(adresse: string, saisi: string) {
    if (enCours || saisi.length !== LONGUEUR_CODE) return;
    setEnCours(true);
    setMessage(null);
    const r = await client.verifierCode(adresse, saisi);
    setEnCours(false);
    if (r.ok) {
      surConnexion(r.session);
      return;
    }
    setMessage(MESSAGES[r.raison]);
    if (r.raison === 'code_invalide') {
      setCode('');
      champCode.current?.focus();
    }
  }

  const alerte = message !== null && (
    <p role="alert" className="message-connexion">
      {message}
    </p>
  );

  let formulaire: ReactNode;
  if (etape.etape === 'email') {
    formulaire = (
      <form key="email" onSubmit={(e) => void demander(e)} noValidate>
        <p className="carte-connexion-titre">Connexion</p>
        <p className="carte-connexion-aide">Pas de mot de passe : un code arrive par e-mail.</p>
        <label className="champ-libelle">
          Adresse e-mail
          <input
            className="champ"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </label>
        {alerte}
        <BoutonPrincipal type="submit" disabled={enCours}>
          Recevoir un code
        </BoutonPrincipal>
      </form>
    );
  } else {
    const adresse = etape.email;
    formulaire = (
      <form
        key="code"
        onSubmit={(e) => {
          e.preventDefault();
          void verifier(adresse, code);
        }}
      >
        <label className="champ-libelle">
          <span className="carte-connexion-titre">Entre le code reçu</span>
          <span className="carte-connexion-aide">
            6 chiffres, envoyés à <strong>{adresse}</strong>
          </span>
          <span className="saisie-code">
            {Array.from({ length: LONGUEUR_CODE }, (_, i) => (
              <span key={i} data-testid="case-code" aria-hidden="true" className={i === code.length ? 'case-code case-code-active' : 'case-code'}>
                {code[i]}
              </span>
            ))}
            <input
              ref={champCode}
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={LONGUEUR_CODE}
              autoFocus
              value={code}
              onChange={(e) => {
                const chiffres = e.target.value.replace(/\D/g, '').slice(0, LONGUEUR_CODE);
                setCode(chiffres);
                // Les 6 chiffres saisis : la vérification part seule, sans toucher de bouton.
                if (chiffres.length === LONGUEUR_CODE) void verifier(adresse, chiffres);
              }}
            />
          </span>
        </label>
        {alerte}
        <BoutonPrincipal type="submit" disabled={enCours}>
          Valider
        </BoutonPrincipal>
        <BoutonSecondaire
          onClick={() => {
            setEtape({ etape: 'email' });
            setMessage(null);
          }}
        >
          Changer d’adresse
        </BoutonSecondaire>
      </form>
    );
  }

  return (
    <div data-testid="carte-connexion" className="carte-connexion">
      {children}
      {formulaire}
    </div>
  );
}
