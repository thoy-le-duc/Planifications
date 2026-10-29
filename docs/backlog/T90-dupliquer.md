# T90 — Dupliquer une serre ou une parcelle, avec ses zones et ses planches

**Objectif** : demande de Théophane (2026-10-28) : « il faudrait que je puisse dupliquer ». Une ferme a souvent plusieurs tunnels ou parcelles identiques : on ne doit en saisir qu'un.

**Dépend de** : T89
**Périmètre** : `apps/web/src/ecrans/placement/**`, `packages/core/src/placement/**` (noms et positions des copies, calcul pur), tests
**Priorité** : haute (chantier du plan). **Domaine critique** : non (mêmes portes d'écriture que T89).

## Règles

1. En modification, un élément choisi (serre avec sa zone abritée, ou zone de plein champ avec contour) propose **« Dupliquer »** : champs « Nombre de copies » (1 par défaut, 1 à 20) et « Écart (m) » (1,5 m par défaut), copies alignées **à côté**, dans le sens de la largeur, du côté x positif de l'original (dans son repère, même orientation).
2. Une copie reprend tout : dimensions, grille (T88), sous-zones, emplacements et leurs placements dans la zone. Aucune culture, série ni historique n'est copié.
3. **Noms** : le dernier nombre du nom est incrémenté, en évitant les noms déjà pris sur la ferme (« Tunnel 1 » → « Tunnel 2 », « Tunnel 3 » ; « Manon 1 » → « Manon 4 » si 2 et 3 existent) ; sans nombre, « Serre » → « Serre 2 ». Les sous-zones suivent la même règle avec leur propre préfixe. Les codes de planches (P1…) restent les mêmes : ils sont uniques par zone.
4. Un seul « Enregistrer », « Annuler » retire toutes les copies.

## Critères d'acceptation

- [ ] Test cœur : noms (cas de la règle 3), positions de 3 copies d'une serre de 9,6 m de large avec écart 1,5 m (centres à +11,1 ; +22,2 ; +33,3 m dans le repère de l'original), avec orientation de 30°.
- [ ] Test d'écran : dupliquer un tunnel découpé en 3 zones avec 8 planches chacune → une copie avec 3 sous-zones et 24 emplacements placés, un seul enregistrement.
- [ ] Test d'écran : dupliquer une parcelle de plein champ → contour et planches copiés.
- [ ] Budgets respectés ; `pnpm verif` passe.

## Hors périmètre

Copier les séries et cultures d'une zone vers une autre.
