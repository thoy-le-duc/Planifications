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

## Critères d'acceptation

- [ ] Un test par règle.
