# T10s — Serveur : accepter le parcellaire et le catalogue de la ferme

**Objectif** : ce qu'un téléphone crée ou modifie dans le parcellaire (zones, emplacements, saisons, assolements) et dans le catalogue propre à la ferme (familles, espèces, variétés) arrive au serveur au lieu d'être refusé, pour que l'import (T14b) et les écrans de structure tiennent après la synchro.

**Dépend de** : T10 à T10r (envoi, refus, règles de synchro)
**Périmètre** : `apps/api/src/sync/**` (nouveau module `structure.ts`, `upload.ts`), `powersync/sync-config.yaml` si nécessaire, `docs/modele-donnees.md` (règles d'écriture)

## Constat (testeur T14b)

`upload.ts` n'accepte que `evenement`, le stock, les séries et les itinéraires : toute écriture sur `zone`, `emplacement`, `famille`, `espece`, `variete`, `saison` ou `assolement` est refusée (`table_interdite`). Un import fait hors ligne serait annulé à la première synchro.

## Règles

- Tables acceptées : `zone`, `emplacement`, `saison`, `assolement` (toujours d'une ferme) ; `famille`, `espece`, `variete` seulement pour les lignes **de la ferme** (`ferme_id` non nul) — une ligne de la bibliothèque commune (`ferme_id` nul) n'est jamais créée, modifiée ni supprimée par un téléphone.
- **Isolement** : `ferme_id` de la ligne = une ferme dont l'utilisateur est membre avec un rôle qui peut écrire ; jamais de changement de `ferme_id` ; toute référence (zone d'un emplacement, espèce d'une variété, famille d'une espèce, saison d'un assolement…) pointe vers une ligne de la même ferme ou de la bibliothèque commune.
- **Validation** par les mêmes règles que le moteur (`@planif/core`), avec les plafonds existants ; message de refus en français (comme T10k).
- **Tout ou rien** pour un lot de structure (un import) : comme les séries, si une ligne est refusée, rien du lot n'est écrit.
- Suppression : seulement en douceur (`supprime_le`), refusée si la ligne sert encore (emplacement occupé par une série active, espèce utilisée…), avec un refus explicite.

## Critères d'acceptation

- [ ] Test d'intégration (e2e:synchro, reporté) : un import hors ligne (zones + emplacements + espèces de la ferme) arrive intact au serveur et redescend sur un second téléphone.
- [x] Tests d'isolement : écrire dans une autre ferme, viser une référence d'une autre ferme, modifier une ligne de la bibliothèque commune, changer `ferme_id` → refusés.
- [x] Test : un lot dont une ligne est invalide n'écrit rien.
- [x] Test : suppression d'un emplacement occupé refusée avec un message clair.
