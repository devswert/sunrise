#!/usr/bin/env bash
# PreToolUse(Bash): bloquea `git push`, `gh pr create` y `gh pr merge` si `bin/gates` no
# pasó sobre el working tree exacto de ahora. Nunca corre los gates: así un estado ya
# verificado no se prueba dos veces.
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
  target="$(grep -Eo "$push" <<< "$command" | awk '$2 == "-C" {print $3; exit}')"
fi
if [ -n "$target" ]; then
  target="${target/#\~/$HOME}"
  target="${target%\"}"; target="${target#\"}"
  cd "$target" 2>/dev/null || { echo "Bloqueado: no encuentro la carpeta $target." >&2; exit 2; }
fi
root="$(git rev-parse --show-toplevel)"

# Empujar un tag de versión (o borrarlo, al retaguear) es el paso de sunrise-release:
# el código ya pasó los gates en el PR de versión, y desde main es el único push permitido.
# Solo si **todo** push del comando es de un tag: `git push && git push origin v1.0.0` no pasa.
tag_push="$push[[:space:]]+origin[[:space:]]+:?(refs/tags/)?v[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|\$)"
if ! grep -Eq "gh[[:space:]]+pr[[:space:]]+(create|merge)" <<< "$command" \
  && [ "$(grep -Eo "$push" <<< "$command" | wc -l)" -eq "$(grep -Eo "$tag_push" <<< "$command" | wc -l)" ]; then
  exit 0
fi

# Un `git push` pelado desde main se salta el PR: main solo avanza con `gh pr merge`.
if grep -Eq "(^|[;&|[:space:]])$push([[:space:]]|\$)" <<< "$command" && [ "$(git branch --show-current)" = "main" ]; then
  echo "Bloqueado: no se empuja desde main. Trabaja en la rama de la issue y mezcla con \`gh pr merge\`." >&2
  exit 2
fi

stamp="$(git rev-parse --path-format=absolute --git-path sunrise-gates-ok)"
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$("$root/bin/tree-hash")" ]; then
  exit 0
fi

echo "Bloqueado: el código cambió desde el último \`bin/gates\` en verde. Corre \`bin/gates\` y reintenta." >&2
exit 2
