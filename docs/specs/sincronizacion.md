# §5 Sincronización de estado — LEER ANTES DE TOCAR

Vuelve al [índice de SPECS](../SPECS.md).

Hay **tres** capas de estado, y ninguna es un store global único:

| Capa | Contenido | Alcance |
|---|---|---|
| `useAppStore` (`src/lib/store.ts`) | modal de compose, `dataVersion` | **por ventana** |
| `useTimerStore` (`timerStore.ts`) | timer (respaldado en DB), `last` | **por ventana** |
| `useBoard` (`useBoard.ts`) | tasks/categories/objectives + acciones | **por componente** |

## 5.1 El patrón: invalidación manual por contador

`dataVersion` es un contador que cada vista observa para recargar: `useBoard`,
`FocusView`, `BacklogView`, `WeeklyPlanningView`, `Sidebar`. **Toda mutación llama
`bumpData()`** o las otras vistas quedan obsoletas. No hay invalidación automática
ni eventos de datos desde Rust.

## 5.2 El canal entre ventanas: `localStorage`

`main` ↔ `floating-timer` se comunican por `localStorage` + eventos `storage`, que
**no se disparan en el documento que los origina** — de ahí que el timer sea un
store y no estado local.

| Clave | Escribe | Escucha |
|---|---|---|
| `sunrise-timer` | `timerStore` (start/stop/dismiss) | `useTimerRuntime` (ambas ventanas) |
| `sunrise-last-task` | `timerStore` | `useTimerRuntime` |
| `sunrise-data` | `bumpData()` | `useDataSync` en `main` + `useTimerRuntime` |
| `sunrise-theme` | `theme.ts` | `timer.tsx` |
| `sunrise-tax-pos` | la ventana flotante | `useFloatingWindow` al mostrarla |

## 5.3 El cruce de ventanas: `useDataSync`

`bumpData()` incrementa `dataVersion` **en su propia ventana** y escribe
`sunrise-data`. Del otro lado, `useDataSync()` (en `store.ts`, montado por `Shell`)
escucha ese `storage` e invalida las vistas de `main`. Sin ese eslabón, completar
una tarea desde el taxímetro quedaba bien guardado pero dejaba la semana, Today, el
backlog y el sidebar mostrando lo viejo.

Dos detalles a respetar:

- **`useDataSync` llama `markDataStale()`, no `bumpData()`.** Quien escribe nunca
  se escucha a sí mismo; el riesgo es **responder**: si al recibir el aviso se
  volviera a escribir en el canal, la otra ventana recibiría el eco, respondería, y
  las dos quedarían recargándose en ping-pong para siempre.
- **Va en `Shell`, no en `useTimerRuntime`.** Ese hook corre en las dos ventanas, y
  el taxímetro no tiene vistas que dependan de `dataVersion`.

Un evento de Tauri puede entrar por esta misma puerta llamando a `markDataStale`.

## 5.3.1 El día también es estado (`useDayWatcher`)

Una app de escritorio cruza la medianoche abierta. El caso real: el Mac se suspende
a las 19:00 y despierta a las 9:00 del día siguiente. Nada le avisaba, así que Today
seguía mostrando ayer, la semana se quedaba en la anterior si el salto cruzó un
domingo, y la limpieza de días viejos no corría hasta el primer click.

**`src/lib/day.ts`** es la única fuente de "qué día es hoy":

- `useToday()` (sobre `useSyncExternalStore`) devuelve el día y **re-renderiza al
  cambiar**. Las vistas ya no llaman `todayISO()` al renderizar.
- `useDayWatcher()`, montado una vez en `Shell`, revisa en `focus`,
  `visibilitychange` y un intervalo de 60s. Los tres hacen falta: si la ventana
  nunca se ocultó ni perdió el foco —justo el caso de la suspensión— los dos
  primeros no se disparan nunca.
- Al detectar el salto llama **`markDataStale()`**. Con eso `useBoard` recarga y **la
  degradación corre sola** (§4.2), porque su guarda ya es por fecha.

La comparación es de **fechas de reloj**, nunca de tiempo transcurrido: macOS agrupa
los temporizadores al dormir, así que el intervalo puede disparar tarde, una vez o
ninguna. Una comparación pura acierta se ejecute cuando se ejecute; con lógica de
"pasaron N ms" habría que adivinar cuánto durmió la máquina.

**`WeekView` necesita más que invalidar**: hay que mover su `anchor`, y solo si
corresponde. `anchorAfterDayChange` (`src/features/week/anchor.ts`) devuelve `null`
—dejar la vista quieta— en dos casos: si la semana visible no contenía el día
anterior (el usuario navegó a otra semana a propósito), y si el día nuevo ya cae en
la semana visible (dormir el viernes y despertar el domingo: mismas siete fechas).

## 5.4 Trampas del taxímetro (documentadas a golpes)

En `useFloatingWindow.ts`, ya pagadas:

1. **`show()` va primero y aislado.** Si antes se llama algo no soportado en la
   plataforma (`setVisibleOnAllWorkspaces`), lanza y la ventana no aparece. Los
   ajustes best-effort van después, cada uno en su `attempt()`.
2. **`visible` tiene que ser estable.** Con el objeto `display` (cuya identidad
   cambia cada tick) `show()` corre una vez por segundo y la ventana roba el foco
   sin parar. `App.tsx` pasa `!!(s.active || s.last)`, un booleano.
3. **Dos controladores para la misma ventana**: `useFloatingWindow` en `Shell` y
   `useSelfVisibility` en `FloatingTimer`. Redundancia deliberada, pero si tocas
   una considera la otra.
4. **Todo lo que se superponga a la tarjeta cuenta como control para
   `useDragOrClick`.** El hook decide click-vs-arrastre y descarta los eventos que
   caen en `button, .tax__opts`. El panel de opciones aparece deslizándose *bajo el
   cursor*, así que un click que empieza en el título puede soltarse encima de él:
   sin esa lista, ese `pointerup` abriría Focus y la ventana principal saltaría
   sola. Si agregas otra capa flotante, súmala al selector.
5. **Nada de `:hover` de CSS en el taxímetro.** La ventana casi nunca tiene el foco
   y en macOS los eventos de mouse van a la ventana *key*. El modo de falla no es
   que no encienda: es que **enciende y no apaga**, porque llega la entrada y no la
   salida — el panel quedaba pegado hasta volver a pasarle el mouse.

   Manda `useCursorHover`: sondea `cursorPosition()` —global, independiente del
   foco— cada 120ms y prende `is-hover-controls` con hit-test contra la
   **envolvente** de los rects del botón y del panel (la envolvente, para que el
   hueco de 4px entre ambos no cuente como afuera). Solo corre mientras hay algo que
   mostrar: el webview sigue vivo con la ventana oculta.

   **Las dos coordenadas no vienen en la misma escala.** `cursorPosition()`
   multiplica por la escala del monitor **principal**; `outerPosition()`, por la de
   **su propia ventana**. Con un monitor coinciden y restarlas en crudo parece
   correcto; con dos de distinta densidad quedan en unidades distintas y la resta no
   significa nada. Hay que pasar cada una a lógicas con su propia escala antes de
   restar. Este bug dejó el sondeo sin acertar una sola vez y no se veía con un solo
   monitor. `acceptFirstMouse: true` es lo que además hace que el click funcione a la
   primera sin activar la ventana.

   **Necesita `core:window:allow-cursor-position` en las capabilities.** Sin ese
   permiso la llamada se rechaza, y como el sondeo atrapa el error para no dejar el
   panel clavado, el síntoma es que el hover sin foco no funciona, sin una línea en
   consola. Ya pasó una vez; por eso el `catch` avisa una vez y no cada 120ms. Y las
   capabilities se compilan dentro de la app: tocarlas obliga a reiniciar
   `pnpm tauri dev`, recargar el webview no basta.
