---
name: sunrise-sync-ventanas
description: Cómo se sincroniza el estado en sunrise entre sus dos ventanas nativas (`main` y `floating-timer`) — `dataVersion`/`bumpData`, el canal de `localStorage`, y las trampas ya pagadas al mostrar la ventana flotante. Úsala siempre que un cambio no se refleje en otra vista o ventana ("marqué algo y no se actualizó"), cuando agregues una mutación de datos, cuando toques `src/lib/store.ts`, `timerStore`, `useFloatingWindow` o `App.tsx`, y cuando quieras hacer que la ventana flotante aparezca, se oculte o se posicione. Explica el circuito completo de invalidación (`useDataSync`) y por qué está armado así: revísalo antes de diagnosticar cualquier problema de "no se refresca", porque el modo de falla típico es olvidar que cada ventana tiene su propio store.
---

# Sincronización de estado en sunrise

## Lo primero que hay que entender

Hay **dos ventanas nativas** declaradas en `src-tauri/tauri.conf.json`:

| Label | Entrypoint | Qué es |
|---|---|---|
| `main` | `index.html` → `src/main.tsx` | la app completa |
| `floating-timer` | `timer.html` → `src/timer.tsx` | el taxímetro |

Son **dos documentos y dos bundles de React**, por lo tanto **dos instancias
separadas de cada store de Zustand**. No comparten memoria. Un `set()` en una no
existe para la otra. Casi todo error de "no se actualiza" sale de olvidar esto.

Lo único compartido de verdad es la **DB**: una sola `Connection` en un `Mutex`
manejada por Tauri, que ambas ventanas alcanzan por IPC. La DB es la fuente de
verdad; el problema siempre es de invalidación de cache, no de datos.

## Las tres capas de estado

| Capa | Contenido | Alcance |
|---|---|---|
| `useAppStore` (`src/lib/store.ts`) | modal de compose, `dataVersion` | **por ventana** |
| `useTimerStore` (`timerStore.ts`) | timer (respaldado en DB), `last` | **por ventana** |
| `useBoard` (`useBoard.ts`) | tasks/categories/objectives + acciones | **por componente** |

No hay store global único ni cache normalizado. El patrón es **invalidación
manual por contador**.

## El patrón: `dataVersion`

`dataVersion` es un contador en `useAppStore`. Las vistas lo observan y recargan
cuando cambia: `useBoard`, `FocusView`, `BacklogView`, `WeeklyPlanningView`,
`Sidebar`.

**Toda mutación tiene que llamar `bumpData()`.** No hay invalidación automática y
Rust no emite eventos de datos. Si agregas una acción que escribe y no llamas
`bumpData()`, las otras vistas quedan mostrando datos viejos y el usuario lo lee
como un bug de guardado.

Ojo con el caso menos obvio: **completar una tarea puede detener el timer**
(pasa en Rust, ver la skill `sunrise-timer-y-tiempo`), así que después de
`setTaskStatus` hay que hacer `bumpData()` aunque tu vista ya se haya recargado
sola.

**"Toda mutación" incluye borrar, y ahí el callback de la vista no alcanza.** El
`onChanged` que recibe `TaskModal` recarga lo que esa vista considera suyo y nada
más: en el ritual diario es `useBoard` con el día de hoy, mientras el repaso del
día anterior, la columna del backlog y el mapa de rescates son estado aparte que
solo se refresca con el aviso. Sin `bumpData()`, borrar escribía en la base y
dejaba la card en pantalla —el gesto se sentía muerto y el click siguiente abría
el detalle de algo que ya no existía—. Regla práctica: **si una vista tiene listas
además de las del board, cualquier mutación necesita el aviso, no el callback.**

## El canal entre ventanas: `localStorage`

Los eventos `storage` **no se disparan en el documento que los origina**. Por eso
el timer es un store compartido por ventana y no estado local por componente:
un hook por componente nunca se enteraría de los cambios locales.

| Clave | Quién escribe | Quién escucha |
|---|---|---|
| `sunrise-timer` | `timerStore` (start/stop/dismiss) | `useTimerRuntime`, ambas ventanas |
| `sunrise-last-task` | `timerStore` | `useTimerRuntime` |
| `sunrise-data` | `bumpData()` | `useDataSync` en `main` (invalida las vistas) + `useTimerRuntime` (refresca el timer) |
| `sunrise-theme` | `src/lib/theme.ts` | `src/timer.tsx` |
| `sunrise-tax-pos` | la propia ventana flotante | `useFloatingWindow` al mostrarla |

## El cruce de ventanas: `useDataSync`

`bumpData()` solo incrementa el `dataVersion` **de su propia ventana** y escribe
en el canal. Quien cierra el circuito del otro lado es **`useDataSync()`**
(en `src/lib/store.ts`, montado por `Shell` en `App.tsx`): escucha el `storage`
de `sunrise-data` e invalida las vistas de `main`. Sin ese eslabón, completar una
tarea desde el taxímetro quedaba bien guardado en la DB pero dejaba la semana,
Today, el backlog y el sidebar mostrando lo viejo — el bug que se reportaba como
*"marqué la tarea como hecha en el taxímetro y no se actualizó en el weekly"*.

Dos decisiones de ese hook que conviene no deshacer:

**Usa `markDataStale()`, no `bumpData()`.** El store expone las dos acciones a
propósito: `bumpData` = invalidar local + avisar; `markDataStale` = invalidar
local y nada más. Los eventos `storage` no se disparan en el documento que los
origina, así que quien escribe nunca se escucha a sí mismo; el riesgo real es
**responder**. Si al recibir el aviso se volviera a escribir en el canal, la otra
ventana recibiría ese eco, respondería a su vez, y las dos quedarían
recargándose en ping-pong para siempre.

**Va en `Shell`, no en `useTimerRuntime`.** Ese hook corre en las dos ventanas, y
el taxímetro no tiene vistas que dependan de `dataVersion`: ponerlo ahí lo haría
invalidar de más y acoplaría la invalidación de datos al timer. El listener
además se registra con dependencias vacías, para no re-suscribirse en cada
cambio de `dataVersion` (que es justo lo que él mismo provoca).

Cuando M3 traiga el poller de ICS mutando datos desde Rust, el evento de Tauri
puede entrar por esta misma puerta llamando a `markDataStale`, sin depender de
que alguna ventana escriba en `localStorage`.

Cubierto por `src/lib/store.test.tsx` y
`src/features/today/TodayView.sync.test.tsx`. Si tocas esto, verifica que los
tests se pongan **rojos** al desactivar el listener: es la única forma de saber
que siguen midiendo algo.

## Trampas de la ventana flotante (ya pagadas, no las repitas)

Están en `src/features/timer/useFloatingWindow.ts` con su comentario:

1. **`show()` va primero y aislado.** Si antes se llama algo no soportado en la
   plataforma o versión (por ejemplo `setVisibleOnAllWorkspaces`), lanza y la
   ventana simplemente no aparece. Los ajustes best-effort van después, cada uno
   envuelto en `attempt()` para que su fallo no arrastre al resto.
2. **El valor de `visible` tiene que ser estable.** Si se le pasa el objeto
   `display` (cuya identidad cambia con cada tick del reloj), el efecto corre
   `show()` una vez por segundo y la ventana **roba el foco continuamente**. Por
   eso `App.tsx` pasa `!!(s.active || s.last)`, un booleano.
3. **Hay dos controladores de visibilidad para la misma ventana**:
   `useFloatingWindow` en `Shell` (desde `main`) y `useSelfVisibility` en
   `FloatingTimer` (la ventana decidiendo sobre sí misma). Es redundancia
   deliberada —resultó más confiable— pero si tocas una, considera la otra.
4. El camino principal para mostrarla/ocultarla es el comando de Rust
   `set_taximeter_visible`, que además la mantiene dentro de la pantalla y deja
   rastro en el log. No dependas solo de las APIs del webview.

**Permisos:** cualquier API de ventana nueva necesita su permiso en
`src-tauri/capabilities/default.json`. Si falta, falla en runtime, no al
compilar — y el síntoma es una ventana que no aparece sin error visible. Ya
mordió dos veces; la segunda fue `cursorPosition()` sin
`core:window:allow-cursor-position`: la promesa se rechazaba, un `catch`
defensivo se comía el error y la función simplemente no hacía nada. Si agregas
una API de ventana, agrega el permiso **en el mismo cambio**, no atrapes el
error sin al menos loguearlo, y reinicia `pnpm tauri dev`: las capabilities se
compilan dentro de la app y recargar el webview no las actualiza.

**No pongas `:hover` de CSS en el taxímetro.** Esa ventana casi nunca tiene el
foco y en macOS los eventos de mouse van a la ventana *key* (tao usa el
`addTrackingRect` legado). Ojo con el modo de falla, que es contraintuitivo: no
es que no encienda, es que **enciende y no apaga** —llega la entrada, no la
salida— y el control queda pegado. Para que algo reaccione al mouse con otra app
en primer plano hay que sondear `cursorPosition()` (posición global, ajena al
foco) y hacer el hit-test a mano: `useCursorHover`. Para el **click** sin foco
el equivalente ya está resuelto con `acceptFirstMouse: true` en
`tauri.conf.json`.

**Cuidado al mezclar coordenadas de dos APIs de ventana.** `cursorPosition()`
devuelve "físicas" usando la escala del monitor **principal**;
`outerPosition()`, la de **su propia ventana**. Con un solo monitor coinciden y
restarlas en crudo funciona; con un externo 1x junto al Retina no significa
nada, y el bug es invisible en la máquina del que lo escribió. Pasa cada una a
lógicas con **su** escala antes de restar.

**Para depurar el taxímetro, píntalo en el taxímetro.** No tiene consola
alcanzable en la práctica, así que los `console.error` se pierden y se diagnostica
a ciegas. Un bloque temporal detrás de `import.meta.env.DEV` que muestre los
números en la propia tarjeta resuelve en una captura lo que si no son cuatro
rondas de conjeturas.

## El día es estado, no un cálculo al renderizar

Nunca llames `todayISO()` dentro del render de una vista. Esta app se queda
abierta cruzando la medianoche —el Mac se suspende a las 19:00 y despierta a las
9:00— y sin un cambio de estado la vista no se vuelve a renderizar: Today
mostraba ayer con título y todo. Usa **`useToday()`** de `src/lib/day.ts`.

`useDayWatcher()` (montado una vez en `Shell`) revisa en `focus`,
`visibilitychange` y un intervalo de 60s, y al detectar el salto llama
`markDataStale()`. Hacen falta los tres disparadores: si la ventana nunca se
ocultó ni perdió el foco, que es justo el caso de la suspensión, los dos
primeros no se disparan nunca. Y compara **fechas de reloj**, jamás tiempo
transcurrido: macOS agrupa y suspende los temporizadores al dormir, así que el
intervalo puede disparar tarde, una vez o ninguna.

Si agregas una vista anclada a una fecha, mira `anchorAfterDayChange` en
`src/features/week/anchor.ts` antes de hacerla "seguir al día": no hay que
mover la vista si el usuario navegó a otro rango a propósito.

## Navegación entre ventanas

El taxímetro no navega: enfoca `main` y emite el evento `sunrise://goto` con un
path. `useGotoListener` en `main` lo escucha y hace el `navigate`. Si necesitas
otro salto ventana→ventana, sigue ese patrón en vez de manipular el router de la
otra ventana.

## Cuidado con colgar mutaciones del ciclo de recarga

El efecto de `useBoard` depende de `[reload, dataVersion]`, así que **todo lo que
pongas ahí corre con cada cambio de datos**, no una vez al montar. La limpieza
diaria cayó en esa trampa: `api.demotePending()` es una mutación y se
ejecutaba en cada invalidación. Hoy pasa por `degradarUnaVez(today)`, que la
corre una vez por día y por ventana y deduplica las llamadas concurrentes de dos
vistas montadas a la vez.

Si necesitas disparar una mutación al abrir una vista, dale su propia guarda: el
ciclo de recarga es para **leer**.

Dato útil al escribir tests o al depurar: varias invalidaciones seguidas se
**coalescen**. El cleanup del efecto marca la recarga anterior como abandonada,
así que tres `bumpData()` en la misma vuelta pueden terminar en una sola lectura.
