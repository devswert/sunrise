---
name: sunrise-ship
description: Lleva una issue de sunrise desde QA confirmado hasta main sin intervención — cubre con tests lo que el QA reveló, sincroniza con main, corre gates, abre el PR, vigila CI, mezcla, mueve el board a Done y limpia la worktree. Úsala cuando el dev confirme el QA o diga "mándalo", "mezcla" o "abre el PR". No publica: "vamos pa prod" es sunrise-release.
---

# sunrise ship

Mezclar a `main` **no es publicar**. La app instalada solo cambia cuando se empuja
un tag (skill `sunrise-release`). Lo mezclado queda en `Done`, esperando versión;
por eso se pueden juntar varias issues en un mismo release.

Corre en la worktree de la issue, con el trabajo commiteado. El shell vuelve al
checkout principal después de cada comando, así que **todo comando de la worktree
empieza con `cd <worktree> && …`**: así lo lee el hook para saber qué rama y qué
sello de gates juzgar. Una vez iniciado, no
vuelvas a preguntar salvo en los **puntos de parada**.

## Condición de auto-merge

Se mezcla solo si **todo** se cumple:

1. El dev confirmó el QA en esta sesión ("mándalo", "mezcla"). Si antes pidió
   revisar el PR él mismo, pide un "ya revisé, mezcla" explícito.
2. `bin/gates` en verde.
3. El reviewer (corrido en `sunrise-lifecycle` paso 3) no dejó BLOCKING ni
   SPEC_DRIFT sin resolver.
4. CI en verde.

## Pasos

### 1. QA → tests

- Los tests ya existen (los gates los exigieron antes del QA). Agrega solo los que
  falten para lo que el QA reveló: un bug encontrado o un paso sin test.
- Lo que no se puede automatizar (ventana flotante real, notificación nativa,
  campana, DnD con el mouse, apariencia) va a "Validado a mano" en el PR, con el
  motivo.

### 2. Sincronizar con main

```bash
git fetch origin main
git rebase origin/main
```

Conflictos:

- **Resuélvelos tú** cuando son mecánicos: imports, líneas vecinas, listas o tablas
  donde ambos lados agregan, tests que crecieron en paralelo, `mockDb.ts` con dos
  comandos nuevos. Conserva la intención de ambos lados y corre los tests del área.
- **Punto de parada** cuando son semánticos: la misma lógica cambiada distinto, dos
  migraciones con el mismo número en `migrations.rs`, timer o `time_entries`, specs
  que se contradicen. Explica qué choca y pregunta.
- Nunca `git push --force` sobre `main`. En la rama de la issue, tras un rebase:
  `git push --force-with-lease`.

### 3. Gates

`bin/gates`. Si falla, arregla y repite. El hook bloquea `git push` y
`gh pr create|merge` si el código cambió desde el último verde, así que no lo corras
dos veces sobre el mismo estado.

### 4. Revisión (solo si hace falta)

Lanza un `reviewer` **nuevo** (ruta de la worktree, link de la issue y plan de QA;
nunca la conversación) solo si después del QA cambió lógica: arreglos por el QA o
conflictos no mecánicos del rebase. Máximo 2 rondas; BLOCKING persistente o
SPEC_DRIFT → **punto de parada**.

### 5. PR

```bash
git push -u origin HEAD
gh pr create --repo devswert/sunrise --base main --title "<tipo>(<área>): <resumen>" --body-file <scratchpad>/pr-N.md
```

Body (archivo temporal en el scratchpad, nunca en el repo): resumen, plan de QA con
el test que cubre cada paso, "Validado a mano", resultado del reviewer (NON_BLOCKING
incluidos) y `Closes #N`.

### 6. CI

```bash
gh pr checks <PR> --repo devswert/sunrise --watch
```

Córrelo en segundo plano y espera el aviso: esperar no gasta tokens, el polling sí.
Los runners son `macos-26` y tardan.

- Rojo → `gh run view <run> --repo devswert/sunrise --log-failed`, arregla,
  `bin/gates`, push. Máximo 3 intentos; después → **punto de parada** con el
  diagnóstico.
- CI corre en **UTC**: un rojo que en local pasa suele ser de zona horaria
  (`docs/DECISIONES.md` §10). `bin/gates` ya corre `TZ=UTC pnpm test:rust`.
- Si `main` avanzó y el PR quedó en conflicto → vuelve al paso 2.

### 7. Merge

Con la condición de auto-merge cumplida:

```bash
gh pr merge <PR> --repo devswert/sunrise --squash
```

Sin `--delete-branch`: desde una worktree, gh intenta cambiarse a `main`, que ya
está tomada por el checkout principal. La rama (local y remota) la borra
`bin/worktree --clean-merged` en el paso 8.

Si alguna condición falla → **punto de parada**.

### 8. Cerrar

1. Board → `Done` (ver `../sunrise-lifecycle/board.md`). `Closes #N` cierra la
   issue; si era el último hijo, cierra el padre. **No** le pongas milestone: eso
   lo hace `sunrise-release` al publicar.
2. Desde el checkout principal (nunca desde la worktree que se borra):

```bash
git -C <checkout principal> pull --ff-only
bin/worktree --clean-merged
```

Si queda algo sin limpiar (cambios sin commitear, PR abierto), repórtalo y pregunta
antes de `git worktree remove --force`.

### 9. Reporte

Primera línea: "En main: <qué funciona ahora>". Luego el PR y lo validado a mano. Y
cuántas issues quedan en `Done` esperando versión: si son varias o alguna es un bug
que molesta, ofrece "vamos pa prod".

## Puntos de parada

Conflicto semántico · SPEC_DRIFT · BLOCKING tras 2 rondas · CI rojo tras 3 intentos
· QA no confirmado · cambio de dependencias sin aprobación. En todos: explica en
español simple qué puede romperse, qué tan reversible es, y pregunta.
