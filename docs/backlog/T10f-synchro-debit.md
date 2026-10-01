# T10f — Synchro : débit, délais et envois trop lourds

**Objectif** : aucun téléphone, même mal programmé ou malveillant, ne peut encombrer le serveur, et aucune saisie légitime ne bloque jamais la file d'envoi.

**Dépend de** : T10d
**Périmètre** : `apps/api/src/sync/**`, `apps/api/src/app.ts` (ou le serveur Node), `packages/sync/src/porte.ts`

## Règles (relectures de sécurité de T10d)

- **La porte refuse une transaction trop lourde** : au-delà de 5 Mio, avant d'écrire, en plus de la limite de 500 ordres. Une transaction légitime ne doit jamais atteindre le 413 du serveur (au-delà de 8 Mio), qui bloquerait la file.
- **Limite de débit par utilisateur** sur `/sync/upload`, par exemple N requêtes par minute. Au-delà, un 429 que la file reprend plus tard ; rien n'est perdu.
- **Délai court de lecture du corps** : un client qui annonce 1 000 octets et n'en envoie que 10 est coupé en quelques secondes, et non au bout des 300 s de Node.
- **Ligne récapitulative d'un lot trop gros** (`table: 'lot'`) : l'affichage des refus sur le téléphone la montre de façon compréhensible.

## Découpage (chef, 2026-10-01)

Aucun écran du téléphone n'affiche encore les refus de synchro (critère de T10 jamais coché). La règle « ligne récapitulative d'un lot trop gros » part dans T10i, qui crée cet affichage. T10f garde les trois règles côté serveur et porte.

## Décisions (chef, 2026-10-01)

- Taille : la porte refuse au-delà de 5 Mio (octets UTF-8 des ordres), sur toutes ses écritures ; le serveur accepte jusqu'à 6 Mio de corps envoyé (marge du format PowerSync, environ 230 Ko au pire mesuré), répond `lot_trop_gros` au-delà et 413 au-delà de 8 Mio.
- Débit : 120 envois par minute et par utilisateur sur `/sync/upload` (une file de 300 saisies au retour du réseau est ralentie, jamais perdue) ; les requêtes invalides comptent ; compteur en mémoire, par processus (v1).
- Délais : coupure après 10 s sans données pendant la lecture du corps (un téléphone lent mais régulier passe), en-têtes en 15 s au plus, durée totale de 300 s (EDGE dans une serre).
- Le délai de lecture s'appuie sur un mécanisme interne de Node 22 : la production tourne sur la version de `.node-version`, comme la CI.

## Critères d'acceptation

- [ ] Un test par règle.
