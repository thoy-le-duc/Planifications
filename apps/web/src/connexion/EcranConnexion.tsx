/**
 * Écran de connexion, pensé pour des gants (Q9) : un seul champ par étape, cibles de 56 px,
 * focus déjà dans le champ, vérification qui part seule au 6e chiffre, adresse jamais redemandée.
 */
import { useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { LONGUEUR_CODE, normaliserEmail, type ClientConnexion } from './client.ts';
import type { SessionConnexion } from './session.ts';

export type EtapeConnexion = { etape: 'email' } | { etape: 'code'; email: string };

export interface ProprietesEcranConnexion {
  readonly client: ClientConnexion;
  readonly surConnexion: (session: SessionConnexion) => void;
  readonly etapeInitiale?: EtapeConnexion;
}

const CIBLE: CSSProperties = {
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
  minHeight: 56,
  fontSize: 20,
  borderRadius: 10,
  padding: '0 16px',
};
const CHAMP: CSSProperties = { ...CIBLE, border: '2px solid #5c6b5e', background: '#fff', color: '#1d2a1f' };
const BOUTON: CSSProperties = { ...CIBLE, border: 'none', background: '#2f6b3a', color: '#fff', fontWeight: 600 };
const BOUTON_SECONDAIRE: CSSProperties = { ...BOUTON, background: 'transparent', color: '#2f6b3a', border: '2px solid #2f6b3a' };
const PILE: CSSProperties = { display: 'grid', gap: 16, maxWidth: 420, margin: '24px auto', padding: '0 16px' };
const LIBELLE: CSSProperties = { display: 'grid', gap: 8, fontSize: 18, fontWeight: 600 };

const MESSAGES = {
  email_invalide: 'Cette adresse ne semble pas valide.',
  trop_tot: 'Un code vient déjà d’être envoyé : utilisez-le, ou patientez une minute.',
  code_invalide: 'Code incorrect ou expiré. Vérifiez le dernier e-mail reçu.',
  hors_ligne: 'Pas de réseau. Réessayez quand le téléphone capte.',
  erreur: 'Le serveur ne répond pas correctement. Réessayez dans un instant.',
} as const;

export function EcranConnexion({ client, surConnexion, etapeInitiale = { etape: 'email' } }: ProprietesEcranConnexion) {
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

  if (etape.etape === 'email') {
    return (
      <form key="email" style={PILE} onSubmit={(e) => void demander(e)} noValidate>
        <label style={LIBELLE}>
          Adresse e-mail
          <input
            style={CHAMP}
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
        {message !== null && <p role="alert">{message}</p>}
        <button style={BOUTON} type="submit" disabled={enCours}>
          Recevoir un code
        </button>
      </form>
    );
  }

  const adresse = etape.email;
  return (
    <form
      key="code"
      style={PILE}
      onSubmit={(e) => {
        e.preventDefault();
        void verifier(adresse, code);
      }}
    >
      <p style={{ margin: 0, fontSize: 18 }}>
        Code envoyé à <strong>{adresse}</strong>
      </p>
      <label style={LIBELLE}>
        Code reçu par e-mail (6 chiffres)
        <input
          ref={champCode}
          style={{ ...CHAMP, letterSpacing: '0.4em', fontSize: 28, textAlign: 'center' }}
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
      </label>
      {message !== null && <p role="alert">{message}</p>}
      <button style={BOUTON} type="submit" disabled={enCours}>
        Valider
      </button>
      <button
        style={BOUTON_SECONDAIRE}
        type="button"
        onClick={() => {
          setEtape({ etape: 'email' });
          setMessage(null);
        }}
      >
        Changer d’adresse
      </button>
    </form>
  );
}
