#!/usr/bin/env bash
# Verrou machine : un seul jeu e2e à la fois, pour tous les worktrees du dépôt.
#
# Usage : bash scripts/verrou-e2e.sh CMD [ARGS...]
#
# Prend un verrou flock sur ${TMPDIR:-/tmp}/planifications-e2e.lock (le même pour
# toutes les copies du dépôt), lance CMD sans ce verrou hérité, puis renvoie son
# code de sortie tel quel. Le verrou tombe à la fin de ce processus.
#
# Linux uniquement : flock n'est pas fourni par macOS.

set -u

# Délai maximal d'attente du verrou, en secondes (30 minutes).
DELAI_MAX_S=1800
# Variable de test : remplace le délai maximal (en secondes).
DELAI_S="${VERROU_E2E_DELAI_S:-$DELAI_MAX_S}"

FICHIER="${TMPDIR:-/tmp}/planifications-e2e.lock"

if [ "$#" -eq 0 ]; then
  echo "usage : bash scripts/verrou-e2e.sh CMD [ARGS...]" >&2
  exit 2
fi

case "$DELAI_S" in
  ''|*[!0-9]*)
    echo "verrou-e2e : délai invalide (« $DELAI_S » : des secondes entières sont attendues)." >&2
    exit 2
    ;;
esac

if ! command -v flock >/dev/null 2>&1; then
  echo "verrou-e2e : la commande flock est introuvable. Ce verrou ne fonctionne que sous Linux (macOS ne fournit pas flock). Le jeu e2e n'est pas lancé." >&2
  exit 1
fi

# Descripteur 9 ouvert sur le fichier de verrou : le verrou reste pris tant que ce processus vit.
if ! exec 9>"$FICHIER"; then
  echo "verrou-e2e : impossible d'ouvrir le fichier de verrou $FICHIER. Le jeu e2e n'est pas lancé." >&2
  exit 1
fi

# Essai non bloquant d'abord : si le verrou est libre, on ne dit rien.
if ! flock -n 9; then
  echo "verrou-e2e : en attente d'un autre jeu e2e sur cette machine (verrou : $FICHIER)"
  if ! flock -w "$DELAI_S" 9; then
    echo "verrou-e2e : délai de ${DELAI_S} s dépassé sans que le verrou se libère. Le jeu e2e n'est pas lancé." >&2
    exit 1
  fi
  echo "verrou-e2e : verrou obtenu, lancement du jeu e2e."
fi

# La commande tourne sans le descripteur 9 : seul ce script garde le verrou.
"$@" 9>&-
exit $?
