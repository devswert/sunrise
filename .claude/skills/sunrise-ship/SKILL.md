---
name: sunrise-ship
description: Lleva una issue de sunrise desde QA confirmado hasta main sin intervención — cubre con tests lo que el QA reveló, sincroniza con main, corre gates (el CI es local), revisa con un reviewer sin contexto, abre el PR, mezcla, mueve el board a Done y limpia la worktree. Úsala cuando el dev confirme el QA o diga "mándalo", "mezcla" o "abre el PR". No publica: "vamos pa prod" es sunrise-release.
---

# sunrise ship

Mezclar a `main` **no es publicar**. La app instalada solo cambia cuando se empuja
un tag (skill `sunrise-release`). Lo mezclado queda en `Done`, esperando versión;
por eso se pueden juntar varias issues en un mismo release.

**El CI es local.** Actions ya no corre en PRs ni al mezclar (`docs/DECISIONES.md`
§12): lo que decide es `bin/gates`, y el hook lo exige sobre el árbol **commiteado**
antes de `git push` y `gh pr create`, y además, antes de `gh pr merge`, que la rama
contenga `origin/main` y esté empujada tal cual. No hay CI que esperar: el PR se
abre ya en verde y se mezcla en la misma ronda.

Corre en la worktree de la issue, con el trabajo commiteado. El shell vuelve al
checkout principal después de cada comando, así que **todo comando de la worktree
empieza con `cd <worktree> && …`**: así lo lee el hook para saber qué rama y qué
sello de gates juzgar. Una vez iniciado, no
vuelvas a preguntar salvo en los **puntos de parada**.

## Condición de auto-merge

Se mezcla solo si **todo** se cumple:

1. El dev confirmó el QA en esta sesión ("mándalo", "mezcla"). Si antes pidió
   revisar el PR él mismo, pide un "ya revisé, mezcla" explícito.
2. `bin/gates` en verde sobre el estado **ya rebaseado** en `origin/main` y
   commiteado (el hook lo comprueba; no lo saltes).
3. Un `reviewer` sin contexto dio OK —sin BLOCKING ni SPEC_DRIFT sin resolver—
   sobre el diff final. **Obligatorio siempre**: es la única segunda mirada que
   queda sin CI remoto. Si después de esa revisión cambió algo que no sea mecánico,
   va un reviewer nuevo (paso 4).

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

Commitea primero y `bin/gates` después, sobre el estado rebaseado: es el CI. Si
falla, arregla y repite. El hook bloquea `git push` y `gh pr create|merge` si el
árbol commiteado no es el que pasó (cambios sin commitear o archivos sin trackear
también bloquean: no viajarían en el push), así que no lo corras dos veces sobre el
mismo estado. Commit y push en comandos **separados**: el hook corre antes del
comando entero, y en `git commit && git push` todavía ve el HEAD anterior.

### 4. Revisión

El OK del reviewer de `sunrise-lifecycle` paso 3 vale si desde entonces solo hubo
rebase mecánico y tests nuevos. Si cambió lógica —arreglos por el QA o conflictos
no mecánicos del rebase—, lanza un `reviewer` **nuevo** (ruta de la worktree, link
de la issue y plan de QA; nunca la conversación). Máximo 2 rondas; BLOCKING
persistente o SPEC_DRIFT → **punto de parada**. Sin un OK sobre el diff final no se
mezcla.

### 5. PR

```bash
git push -u origin HEAD
gh pr create --repo devswert/sunrise --base main --title "<tipo>(<área>): <resumen>" --body-file <scratchpad>/pr-N.md
```

Body (archivo temporal en el scratchpad, nunca en el repo): resumen, plan de QA con
el test que cubre cada paso, "Validado a mano", `bin/gates` en verde (el hash corto
que imprime), resultado del reviewer (NON_BLOCKING incluidos) y `Closes #N`.

### 6. Sin CI remoto que esperar

No hay checks que vigilar: `tests.yml` solo corre a mano. Si `main` avanzó desde el
rebase (otra issue se mezcló entremedio), el hook bloquea el merge → vuelve al
paso 2: rebase, gates, push. Si el rebase solo fue mecánico, el OK del reviewer
sigue valiendo.

Si sospechas que algo pasa solo en tu máquina (cambio de toolchain, de
dependencias), `gh workflow run tests.yml --repo devswert/sunrise --ref <rama>` corre
las suites en macOS limpio. Cuesta ~10 minutos de runner: no es parte del flujo.

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

Conflicto semántico · SPEC_DRIFT · BLOCKING tras 2 rondas · gates rojos tras 3
intentos · QA no confirmado · cambio de dependencias sin aprobación. En todos: explica en
español simple qué puede romperse, qué tan reversible es, y pregunta.
