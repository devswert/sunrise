#!/usr/bin/env bash
# PreToolUse(Bash): bloquea `git push`, `gh pr create` y `gh pr merge` si `bin/gates` no
# pasó sobre el árbol commiteado de ahora, y el push de un tag `v*` si no pasó sobre el
# commit que se taguea. Es el CI de sunrise: Actions ya no corre en PRs ni en main
# (docs/DECISIONES.md §12). Nunca corre los gates: así un estado ya verificado no se
# prueba dos veces.
set -euo pipefail

input="$(cat)"
command="$(jq -r '.tool_input.command // ""' <<< "$input")"

push='git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push'
if ! grep -Eq "(^|[;&|[:space:]])($push|gh[[:space:]]+pr[[:space:]]+(create|merge))([[:space:]]|\$)" <<< "$command"; then
  exit 0
fi

cd "$(jq -r '.cwd // empty' <<< "$input")" 2>/dev/null || cd "${CLAUDE_PROJECT_DIR:-.}"
# El shell vuelve al checkout principal después de cada comando, así que el trabajo en
# una worktree llega como `cd <worktree> && …` o `git -C <worktree> …`. Lo que se juzga
# es esa carpeta y no el cwd: si no, la rama sería siempre `main` y el sello de los
# gates se buscaría en la worktree equivocada.
target="$(sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|[:space:]]+).*/\1/p' <<< "$command" | head -1)"
if [ -z "$target" ]; then
  # `|| true`: en un `gh pr …` el grep no encuentra push y, con pipefail, el `set -e`
  # sacaba al hook con 1, que para Claude Code **no bloquea**. Un `gh pr merge` sin
  # `cd` delante pasaba sin mirar el sello.
  target="$(grep -Eo "$push" <<< "$command" | awk '$2 == "-C" {print $3; exit}' || true)"
fi
if [ -n "$target" ]; then
  target="${target/#\~/$HOME}"
  target="${target%\"}"; target="${target#\"}"
  cd "$target" 2>/dev/null || { echo "Bloqueado: no encuentro la carpeta $target." >&2; exit 2; }
fi
root="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "Bloqueado: $(pwd) no es un checkout de sunrise; pon \`cd <worktree> &&\` delante." >&2; exit 2; }

# El sello es el hash del working tree que pasó `bin/gates`. Lo que viaja en un push o un
# merge es el commit, así que se exige que el sello sea el árbol **commiteado**: un archivo
# sin trackear o sin commitear con el que los gates pasaron no llega al remoto, y sin CI
# remoto nadie más lo notaría (docs/DECISIONES.md §12).
stamp="$(git rev-parse --path-format=absolute --git-path sunrise-gates-ok)"
sealed=""
[ -f "$stamp" ] && sealed="$(cat "$stamp")"

# Empujar un tag de versión es el paso de sunrise-release, y desde main es el único push
# permitido. Solo si **todo** push del comando es de un tag: `git push && git push origin
# v1.0.0` se juzga como un push normal. Borrar un tag (`:refs/tags/v…`, al retaguear) pasa
# libre; crearlo exige `bin/gates` en verde sobre el árbol del commit que se taguea, que
# es lo único que asegura que lo publicado pasó las suites: `release.yml` ya no las corre.
# El tag tiene que ser lo último del push: `git push origin v1.2.3 main` no es un push de tag.
tag_push="$push[[:space:]]+origin[[:space:]]+:?(refs/tags/)?v[0-9]+\.[0-9]+\.[0-9]+[[:space:]]*(\$|[;&|])"
if ! grep -Eq "gh[[:space:]]+pr[[:space:]]+(create|merge)" <<< "$command" \
  && [ "$(grep -Eo "$push" <<< "$command" | wc -l)" -eq "$(grep -Eo "$tag_push" <<< "$command" | wc -l)" ]; then
  for ref in $(grep -Eo "$tag_push" <<< "$command" | grep -Eo ':?(refs/tags/)?v[0-9]+\.[0-9]+\.[0-9]+'); do
    case "$ref" in :*) continue ;; esac
    tag="${ref#refs/tags/}"
    # En `git tag vX && git push origin vX` el hook corre antes que el comando y el tag
    # todavía no existe: lo que se va a taguear es HEAD.
    if commit="$(git rev-parse -q --verify "refs/tags/$tag^{commit}")"; then
      tree="$(git rev-parse "$commit^{tree}")"
    else
      tree="$(git rev-parse "HEAD^{tree}")"
    fi
    if [ "$sealed" != "$tree" ]; then
      echo "Bloqueado: $tag no tiene \`bin/gates\` en verde sobre su commit. Desde el checkout principal, en main al día y sin cambios, corre \`bin/gates\` y reintenta." >&2
      exit 2
    fi
  done
  exit 0
fi

# Un `git push` pelado desde main, o con destino main (`HEAD:main`), se salta el PR: main
# solo avanza con `gh pr merge`.
if grep -Eq "$push[^;&|]*:(refs/heads/)?main([[:space:];&|]|\$)" <<< "$command"; then
  echo "Bloqueado: no se empuja a main. Mezcla con \`gh pr merge\`." >&2
  exit 2
fi
if grep -Eq "(^|[;&|[:space:]])$push([[:space:]]|\$)" <<< "$command" && [ "$(git branch --show-current)" = "main" ]; then
  echo "Bloqueado: no se empuja desde main. Trabaja en la rama de la issue y mezcla con \`gh pr merge\`." >&2
  exit 2
fi

if [ "$sealed" != "$(git rev-parse "HEAD^{tree}")" ]; then
  if [ -n "$sealed" ] && [ "$sealed" = "$("$root/bin/tree-hash")" ]; then
    echo "Bloqueado: \`bin/gates\` pasó con cambios sin commitear o archivos sin trackear, y eso no viaja en el push. Commitea (o bórralos) y reintenta." >&2
  else
    echo "Bloqueado: el código cambió desde el último \`bin/gates\` en verde. Corre \`bin/gates\` y reintenta." >&2
  fi
  exit 2
fi

# Mezclar exige que los gates hayan corrido sobre lo que va a quedar en main: la rama
# contiene `origin/main` y está empujada tal cual. `main` no tiene protección de rama, así
# que GitHub squashearía igual un PR atrasado, y lo que quedaría en main sería una mezcla
# que nadie probó.
if grep -Eq "gh[[:space:]]+pr[[:space:]]+merge" <<< "$command"; then
  # Lo juzgado es esta carpeta: el PR que se mezcla tiene que ser el suyo. Si no, desde el
  # checkout principal recién sellado (o desde la worktree de otra issue) se mezclaría
  # cualquier PR sin mirar su sello.
  selector=""; repo=""; take_repo=""
  for tok in $(sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+merge([^;&|]*).*/\1/p' <<< "$command"); do
    if [ -n "$take_repo" ]; then repo="$tok"; take_repo=""; continue; fi
    case "$tok" in
      -R|--repo) take_repo=1 ;;
      --repo=*) repo="${tok#--repo=}" ;;
      -*) ;;
      *) [ -z "$selector" ] && selector="$tok" ;;
    esac
  done
  head_oid="$(gh pr view ${selector:+"$selector"} ${repo:+--repo "$repo"} --json headRefOid -q .headRefOid 2>/dev/null)" || head_oid=""
  if [ -z "$head_oid" ] || [ "$head_oid" != "$(git rev-parse HEAD)" ]; then
    echo "Bloqueado: el PR ${selector:-de esta rama} no tiene como head el HEAD de $(pwd). Mezcla desde su worktree: \`cd <worktree> && gh pr merge …\`." >&2
    exit 2
  fi
  # Sin red el fetch no puede colgar el hook: corta si baja de 1 KB/s por 10 s.
  GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=10 git fetch --quiet origin main 2>/dev/null || true
  if ! git merge-base --is-ancestor origin/main HEAD; then
    echo "Bloqueado: main avanzó desde el último rebase. \`git rebase origin/main\`, \`bin/gates\`, push y reintenta." >&2
    exit 2
  fi
  if [ "$(git rev-parse -q --verify '@{upstream}' || true)" != "$(git rev-parse HEAD)" ]; then
    echo "Bloqueado: la rama no está empujada tal cual (HEAD distinto de su upstream). Haz push y reintenta." >&2
    exit 2
  fi
fi

exit 0
