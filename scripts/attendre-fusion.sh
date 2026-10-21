#!/usr/bin/env bash
# Attend le job « CI verte » sur le dernier commit d'une branche de PR, puis fusionne (merge) si vert.
# Usage : scripts/attendre-fusion.sh <branche> <numero_pr>
# Garde-fous : la PR doit être ouverte, viser main et avoir <branche> pour tête ; refus si elle a avancé.
set -euo pipefail
[ $# -ne 2 ] && { echo "usage : scripts/attendre-fusion.sh <branche> <numero_pr>" >&2; exit 2; }
branche=$1; pr=$2; depot=thoy-le-duc/Planifications
tete=$(timeout 50 gh api "repos/$depot/pulls/$pr" --jq '"\(.state) \(.base.ref) \(.head.ref)"')
[ "$tete" != "open main $branche" ] && { echo "refus : PR #$pr pas « ouverte, vers main, tête $branche » ($tete)" >&2; exit 1; }
git fetch -q origin "$branche"; sha=$(git rev-parse "origin/$branche"); echo "$sha"
r=""; id=""
for _ in $(seq 1 60); do
  id=$(timeout 50 gh api "repos/$depot/actions/runs?head_sha=$sha" --jq '[.workflow_runs[]|select(.name=="CI")][0].id' || true)
  if [ -n "$id" ] && [ "$id" != "null" ]; then
    r=$(timeout 50 gh api "repos/$depot/actions/runs/$id/jobs?per_page=50" --jq '[.jobs[]|select(.name=="CI verte")][0]|"\(.status) \(.conclusion)"' || true)
    case "$r" in completed*) echo "$r"; break ;; esac
  fi
  sleep 45
done
if [ "$r" = "completed success" ]; then
  sha_pr=$(timeout 50 gh api "repos/$depot/pulls/$pr" --jq '.head.sha')
  [ "$sha_pr" != "$sha" ] && { echo "refus : la PR a avancé" >&2; exit 1; }
  timeout 50 gh api -X PUT "repos/$depot/pulls/$pr/merge" -f merge_method=merge -f sha="$sha" --jq '"merged=\(.merged) \(.sha)"'
else
  echo "pas de fusion (CI : ${r:-introuvable})"
  if [ -n "$id" ] && [ "$id" != "null" ]; then
    timeout 50 gh api "repos/$depot/actions/runs/$id/jobs?per_page=50" --jq '.jobs[]|select(.conclusion=="failure" or .conclusion=="cancelled")|"\(.id) \(.name) \(.conclusion)"'
  fi
  exit 1
fi
