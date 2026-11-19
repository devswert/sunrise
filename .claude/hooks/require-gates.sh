#!/usr/bin/env bash
# PreToolUse(Bash): bloquea `git push`, `gh pr create` y `gh pr merge` si `bin/gates` no
# pasó sobre el árbol commiteado de ahora, y el push de un tag `v*` si no pasó sobre el
# commit que se taguea. Es el CI de sunrise: Actions ya no corre en PRs ni en main
# (docs/DECISIONES.md §12). Nunca corre los gates: así un estado ya verificado no se
# prueba dos veces. Su prueba es `bin/test-hook`, que corre dentro de los gates.
set -euo pipefail
# Para Claude Code solo el 2 bloquea: cualquier otro error inesperado del hook dejaría
# pasar el comando. Que todo error sea un bloqueo.
trap 'echo "Bloqueado: el hook require-gates.sh falló en la línea $LINENO." >&2; exit 2' ERR

input="$(cat)"
command="$(jq -r '.tool_input.command // ""' <<< "$input")"

# Cualquier `git … push` (para detectarlo; las formas válidas son menos, abajo): con
# opciones globales delante (`-C dir`, `-c k=v`, `--no-pager`),
# con ruta (`/usr/bin/git`) o dentro de comillas (`sh -c '…'`). Un `git commit -m "… push"`
# no calza: lo que sigue a `git` tiene que ser opción, no subcomando.
any_push='(^|[^[:alnum:]_.-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+push([^[:alnum:]_-]|$)'
gh_pr_re='(^|[^[:alnum:]_.-])gh[[:space:]]+pr[[:space:]]+(create|merge)([^[:alnum:]_-]|$)'
gh_merge_re='(^|[^[:alnum:]_.-])gh[[:space:]]+pr[[:space:]]+merge([^[:alnum:]_-]|$)'
if ! grep -Eq "$any_push|$gh_pr_re" <<< "$command"; then
  exit 0
fi

# Lista blanca: cada tramo del comando (separado por `;`, `&&`, `||`, `|`) que empuje tiene
# que ser una de estas formas, exacta. Lo demás se bloquea en vez de adivinarse: `-f`,
# refspecs con destino, comillas, `--tags`, `--all`, `--mirror`, `git -c … push`, una URL
# en vez de `origin`. Con el CI en local, una forma que el hook no reconoce era un camino
# a main o a un release sin gates (lo encontró la revisión de #25, tres veces).
dir_opt='([[:space:]]+-C[[:space:]]+[^[:space:];&|"'"'"']+)?'
branch_form="^git$dir_opt[[:space:]]+push([[:space:]]+(-u|--set-upstream|-q|--quiet|--force-with-lease))*([[:space:]]+origin([[:space:]]+(HEAD|issue-[A-Za-z0-9._-]+|release-v[0-9.]+))?)?\$"
tag_form="^git$dir_opt[[:space:]]+push([[:space:]]+(-q|--quiet))?[[:space:]]+origin[[:space:]]+:?(refs/tags/)?v[0-9]+\.[0-9]+\.[0-9]+\$"
nl=$'\n'
# Las redirecciones (`2>&1`, `>&2`) no son separadores: fuera antes de partir.
segments="$(sed -E 's/[0-9]*>&[0-9-]+//g; s/[0-9]*>>?[[:space:]]*[^[:space:];&|]+//g' <<< "$command")"
segments="${segments//&&/$nl}"; segments="${segments//||/$nl}"
segments="${segments//;/$nl}"; segments="${segments//|/$nl}"; segments="${segments//&/$nl}"
push_count=0; tag_count=0; tag_refs=""; dir_target=""; moves_head=""
while IFS= read -r seg; do
  seg="$(sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' <<< "$seg")"
  # Misma gramática que `any_push`: con opciones globales, ruta, `VAR=x` delante o dentro
  # de comillas. Anclado a `^git` se escapaba `git -c k=v commit`.
  if grep -Eq "(^|[^[:alnum:]_.-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+(commit|pull|merge|rebase|reset|checkout|switch|cherry-pick|am|revert|stash)([^[:alnum:]_-]|\$)" <<< "$seg"; then
    moves_head=1
  fi
  grep -Eq "$any_push" <<< "$seg" || continue
  push_count=$((push_count + 1))
  if grep -Eq "$tag_form" <<< "$seg"; then
    tag_count=$((tag_count + 1))
    tag_refs="$tag_refs $(grep -Eo ':?(refs/tags/)?v[0-9]+\.[0-9]+\.[0-9]+$' <<< "$seg")"
  elif ! grep -Eq "$branch_form" <<< "$seg"; then
    echo "Bloqueado: el hook no reconoce este push: \`$seg\`. Las formas válidas: \`git push [-u|--force-with-lease] origin HEAD\` (o la rama de la issue) y \`git push origin vX.Y.Z\` (o \`:refs/tags/vX.Y.Z\` para borrarlo)." >&2
    exit 2
  fi
  if [ -z "$dir_target" ]; then
    dir_target="$(awk '$2 == "-C" {print $3; exit}' <<< "$seg")"
  fi
done <<< "$segments"

# El hook juzga el HEAD de *antes* del comando. Un `pull`, `commit`, `reset`… en el mismo
# comando que un push o un merge lo movería después de juzgado, y lo publicado o
# mezclado no sería lo que pasó los gates (`git pull && git tag vX && git push origin vX`
# con otro merge entremedio, o `git commit -am … && git push && gh pr merge`).
if [ -n "$moves_head" ] && { [ "$push_count" -gt 0 ] || grep -Eq "$gh_merge_re" <<< "$command"; }; then
  echo "Bloqueado: lo que mueve HEAD (commit, pull, rebase, reset, checkout…) va en un comando aparte del push o el merge: el hook juzga el HEAD de antes del comando." >&2
  exit 2
fi

cd "$(jq -r '.cwd // empty' <<< "$input")" 2>/dev/null || cd "${CLAUDE_PROJECT_DIR:-.}"
# El shell vuelve al checkout principal después de cada comando, así que el trabajo en
# una worktree llega como `cd <worktree> && …` o `git -C <worktree> …`. Lo que se juzga
# es esa carpeta y no el cwd: si no, la rama sería siempre `main` y el sello de los
# gates se buscaría en la worktree equivocada.
target="$(sed -nE 's/^[[:space:]]*cd[[:space:]]+([^;&|[:space:]]+).*/\1/p' <<< "$command" | head -1)"
[ -n "$target" ] || target="$dir_target"
if [ -n "$target" ]; then
  target="${target/#\~/$HOME}"
  target="${target%[\"\']}"; target="${target#[\"\']}"
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
if [ -f "$stamp" ]; then sealed="$(cat "$stamp")"; fi

fetch_main() { # sin red no puede colgar el hook: corta si baja de 1 KB/s por 10 s
  GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=10 git fetch --quiet origin main 2>/dev/null || true
}

# Empujar un tag de versión es el paso de sunrise-release, y desde main es el único push
# permitido. Solo si **todo** push del comando es de un tag: `git push && git push origin
# v1.0.0` se juzga como un push normal. Borrar un tag (`:refs/tags/v…`, al retaguear) pasa
# libre; crearlo exige `bin/gates` en verde sobre el árbol del commit que se taguea, que
# es lo único que asegura que lo publicado pasó las suites: `release.yml` ya no las corre.
gh_pr=""
if grep -Eq "$gh_pr_re" <<< "$command"; then gh_pr=1; fi
# Un tag nuevo va en su propio comando. Mezclado con una rama o un `gh pr`, el comando
# caería en el camino de rama, que no mira a qué commit apunta el tag.
creates_tag=""
for ref in $tag_refs; do case "$ref" in :*) ;; *) creates_tag=1 ;; esac; done
if [ -n "$creates_tag" ] && { [ "$push_count" -ne "$tag_count" ] || [ -n "$gh_pr" ]; }; then
  echo "Bloqueado: empuja el tag en su propio comando (\`git push origin vX.Y.Z\`), no junto con una rama ni un \`gh pr\`." >&2
  exit 2
fi
if [ -z "$gh_pr" ] && [ "$push_count" -gt 0 ] && [ "$push_count" -eq "$tag_count" ]; then
  for ref in $tag_refs; do
    case "$ref" in :*) continue ;; esac
    tag="${ref#refs/tags/}"
    tag_re="${tag//./\\.}"
    # El hook corre antes que el comando: en `git tag vX && git push origin vX` lo que se
    # va a taguear es HEAD, exista o no un `vX` local. Mover un tag (`-f`, `--force`) o
    # taguear otro commit (`git tag vX <rev>`) no se adivina: comandos separados, como
    # dice sunrise-release (`git tag -d`, `bin/gates`, el tag nuevo).
    if grep -Eq "git$dir_opt[[:space:]]+tag[^;&|]*[[:space:]](-[a-zA-Z]*f[a-zA-Z]*|--force)([[:space:];&|]|\$)" <<< "$command" \
      || grep -Eq "git$dir_opt[[:space:]]+tag[[:space:]]+(-[^[:space:]]+[[:space:]]+)*$tag_re[[:space:]]+[^-[:space:];&|]" <<< "$command"; then
      echo "Bloqueado: crea (o mueve) el tag $tag en un comando y empújalo en otro, para que el hook vea a qué commit apunta." >&2
      exit 2
    fi
    if grep -Eq "git$dir_opt[[:space:]]+tag[^;&|]*[[:space:]]$tag_re([[:space:];&|]|\$)" <<< "$command"; then
      # El comando crea el tag sobre HEAD. Si ya existe uno local en otro commit y no se
      # borra antes (`git tag -d`), `git tag` fallaría y con `;` se empujaría el viejo.
      old="$(git rev-parse -q --verify "refs/tags/$tag^{commit}" || true)"
      if [ -n "$old" ] && [ "$old" != "$(git rev-parse HEAD)" ] \
        && ! grep -Eq "git$dir_opt[[:space:]]+tag[[:space:]]+-d[[:space:]]+$tag_re([[:space:];&|]|\$)" <<< "$command"; then
        echo "Bloqueado: ya hay un $tag local en otro commit. Bórralo antes (\`git tag -d $tag\`) en un comando aparte." >&2
        exit 2
      fi
      commit="$(git rev-parse HEAD)"
    elif ! commit="$(git rev-parse -q --verify "refs/tags/$tag^{commit}")"; then
      commit="$(git rev-parse HEAD)"
    fi
    if [ "$sealed" != "$(git rev-parse "$commit^{tree}")" ]; then
      echo "Bloqueado: $tag no tiene \`bin/gates\` en verde sobre su commit. Desde el checkout principal, en main al día y sin cambios, corre \`bin/gates\` y reintenta." >&2
      exit 2
    fi
    # Se publica lo que está en main, no el HEAD de una rama de issue.
    fetch_main
    if ! git merge-base --is-ancestor "$commit" origin/main; then
      echo "Bloqueado: $tag apunta a un commit que no está en origin/main. Se taguea main ya mezclado." >&2
      exit 2
    fi
  done
  exit 0
fi

# Un push desde main se salta el PR: main solo avanza con `gh pr merge`.
if [ "$push_count" -gt 0 ] && [ "$(git branch --show-current)" = "main" ]; then
  echo "Bloqueado: no se empuja desde main. Trabaja en la rama de la issue y mezcla con \`gh pr merge\`." >&2
  exit 2
fi

head_tree="$(git rev-parse "HEAD^{tree}")" || exit 2
if [ "$sealed" != "$head_tree" ]; then
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
if grep -Eq "$gh_merge_re" <<< "$command"; then
  # Lo juzgado es esta carpeta: el PR que se mezcla tiene que ser el suyo. Si no, desde el
  # checkout principal recién sellado (o desde la worktree de otra issue) se mezclaría
  # cualquier PR sin mirar su sello.
  selector=""; repo=""; skip=""
  read -r -a toks <<< "$(sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+merge([^;&|]*).*/\1/p' <<< "$command")" || true
  for tok in "${toks[@]+"${toks[@]}"}"; do
    case "$skip" in
      repo) repo="$tok"; skip=""; continue ;;
      value) skip=""; continue ;;
    esac
    case "$tok" in
      -R|--repo) skip=repo ;;
      --repo=*) repo="${tok#--repo=}" ;;
      # Flags que llevan valor: el valor no es el número del PR.
      -t|--subject|-b|--body|-F|--body-file|-A|--author-email|--match-head-commit) skip=value ;;
      -*) ;;
      *) [ -z "$selector" ] && selector="$tok" ;;
    esac
  done
  head_oid="$(gh pr view ${selector:+"$selector"} ${repo:+--repo "$repo"} --json headRefOid -q .headRefOid 2>/dev/null)" || head_oid=""
  if [ -z "$head_oid" ] || [ "$head_oid" != "$(git rev-parse HEAD)" ]; then
    echo "Bloqueado: el PR ${selector:-de esta rama} no tiene como head el HEAD de $(pwd). Mezcla desde su worktree: \`cd <worktree> && gh pr merge …\`." >&2
    exit 2
  fi
  fetch_main
  if ! git merge-base --is-ancestor origin/main HEAD; then
    echo "Bloqueado: main avanzó desde el último rebase. \`git rebase origin/main\`, \`bin/gates\`, push y reintenta." >&2
    exit 2
  fi
  upstream="$(git rev-parse -q --verify '@{upstream}' || true)"
  if [ -z "$upstream" ]; then
    echo "Bloqueado: la rama no tiene upstream. Empújala con \`git push -u origin HEAD\` y reintenta." >&2
    exit 2
  fi
  if [ "$upstream" != "$(git rev-parse HEAD)" ]; then
    echo "Bloqueado: la rama no está empujada tal cual (HEAD distinto de su upstream). Haz push y reintenta." >&2
    exit 2
  fi
fi

exit 0
