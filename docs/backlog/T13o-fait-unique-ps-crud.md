# T13o — « Fait » unique : contrôle d'après le journal d'envoi

**Objectif** : le contrôle « déjà fait » après écriture voit aussi un UPDATE qui transforme une ligne en « Fait » et ne dépend plus du rowid.

**Dépend de** : T13j
**Périmètre** : `packages/sync/src/porte.ts`, `docs/brief.md`

## Constat (relecture T13j)

- Le contrôle après écriture repère les lignes nouvelles par `rowid > max(rowid)`. Il ne voit pas un UPDATE qui transforme une ligne en « Fait » (`remplace_sorte` mis à NULL, `detail` modifié), ni un DELETE suivi d'un INSERT qui réutilise le rowid. Le serveur refuse UPDATE et DELETE sur `evenement` : le doublon resterait local et temporaire. Aucun chemin de l'appli ne le fait.
- Un « Fait » et sa correction écrits dans la même transaction sont refusés à tort (aucun chemin de l'appli).
- Un déclencheur qui écrirait dans `evenement` depuis une autre table échapperait au filtre préalable.

## Règles

- Contrôler d'après `ps_crud` (id AUTOINCREMENT, jamais réutilisé), opérations PUT et PATCH sur `evenement`, en relisant la ligne entière par son id.
- Écrire dans `docs/brief.md` (ou le ticket MCP) que l'agent et le serveur MCP ne reçoivent jamais d'accès SQL brut à la porte.

## Critères d'acceptation

- [x] Test : un UPDATE qui transforme une ligne en « Fait » déjà fait est refusé.
- [x] Test : DELETE puis INSERT dans la même transaction, rowid réutilisé → contrôlé.
- [x] Test : « Fait » + sa correction dans la même transaction → accepté.
