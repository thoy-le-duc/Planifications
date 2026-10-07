# T14e — Import : suites

**Objectif** : fermer les points laissés ouverts par T14b.

**Dépend de** : T14b
**Périmètre** : `apps/web/src/ecrans/import/**`, `packages/sync/src/import*`

## Constat (T14b)

L'écriture des séries, le refus d'annuler un import dont une ligne sert encore et l'annulation par lots ont été faits dans T14b. Restent :

- La vérification « sert encore » ne voit que le téléphone : une série posée depuis un autre appareil et pas encore reçue fera refuser l'annulation par le serveur (le message le signale, le refus apparaît dans « Saisies refusées »).
- Au-delà de 500 écritures, l'import part en plusieurs envois et n'est plus tout ou rien côté serveur ; un lot refusé laisse les autres (« Annuler cet import » nettoie tout).
- Modèles et historique d'import sont propres au téléphone (`localStorage`), effacés à la déconnexion ; un historique plein n'est plus rangé (l'écran prévient).
- `actif_du` d'un emplacement et bornes d'une saison créée sont déduits de la date : à montrer à l'aperçu.

## Critères d'acceptation

- [ ] Test : une annulation refusée par le serveur est montrée dans l'historique de l'import, pas seulement dans « Saisies refusées ».
- [ ] Historique d'import rangé en IndexedDB (taille), ou décision écrite de le garder en `localStorage`.
- [ ] `actif_du` et bornes de saison affichés à l'aperçu.
