# T13n — Horodatages comparés comme des dates

**Objectif** : la « correction la plus récente » ne dépend jamais du format texte de l'horodatage.

**Dépend de** : T13l
**Périmètre** : `packages/sync/src/porte.ts`, `packages/sync/src/fait-unique.ts`, `apps/web/src/ecrans/aujourdhui/calculs.ts`, `apps/web/src/ecrans/aujourdhui/ecritures.ts`

## Constat (relecture T13l)

- Les lignes locales sont horodatées par `toISOString` ; celles reçues du serveur peuvent avoir un autre format (séparateur, fractions de seconde).
- Les règles comparent du texte ; `chaines` compare en plus `horodatage||'|'||id`, qui diffère de l'ordre (horodatage, id) quand un horodatage est le préfixe d'un autre.

## Règles

- Normaliser l'horodatage à l'écriture locale et à la réception, ou le comparer comme une date, partout de la même façon.

## Critères d'acceptation

- [ ] Test : deux corrections dont les horodatages diffèrent seulement par le format (fractions, `T`/espace, `Z`/`+00:00`) → la plus récente gagne partout.
