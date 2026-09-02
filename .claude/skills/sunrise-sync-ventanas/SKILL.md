---
name: sunrise-sync-ventanas
description: Cómo se sincroniza el estado en sunrise entre sus dos ventanas nativas (`main` y `floating-timer`) — `dataVersion`/`bumpData`, el canal de `localStorage`, y las trampas ya pagadas al mostrar la ventana flotante. Úsala siempre que un cambio no se refleje en otra vista o ventana ("marqué algo y no se actualizó"), cuando agregues una mutación de datos, cuando toques `src/lib/store.ts`, `timerStore`, `useFloatingWindow` o `App.tsx`, y cuando quieras hacer que la ventana flotante aparezca, se oculte o se posicione. El modo de falla típico es olvidar que cada ventana tiene su propio store.
---

# Sincronización de estado en sunrise

**Las reglas están en [`docs/specs/sincronizacion.md`](../../../docs/specs/sincronizacion.md) (§5)** —las tres capas de estado, la tabla de claves de `localStorage`, `useDataSync`,
`useDayWatcher` y las trampas del taxímetro, cada una con su detalle. Léelo antes
de diagnosticar cualquier "no se refresca".

Acá está lo que hay que tener en la cabeza **antes** de abrir ese documento, y
las trampas que no son reglas sino formas de perder una tarde.

## Lo primero que hay que entender

Hay **dos ventanas nativas**: `main` (`index.html` → `src/main.tsx`, la app
completa) y `floating-timer` (`timer.html` → `src/timer.tsx`, el taxímetro).

Son **dos documentos y dos bundles de React**, o sea **dos instancias separadas de
cada store de Zustand**. No comparten memoria: un `set()` en una no existe para la
otra. Casi todo error de "no se actualiza" sale de olvidar esto.

Lo único compartido de verdad es la **DB**: una sola `Connection` en un `Mutex`
que ambas ventanas alcanzan por IPC. La DB es la fuente de verdad, así que el
problema **siempre** es de invalidación de cache, nunca de datos.

De ahí sale la regla que se rompe seguido: **toda mutación llama `bumpData()`**
(invariante I11). No hay invalidación automática y Rust no emite eventos de datos.

## Las trampas

**Borrar también es mutar, y el callback de la vista no alcanza.** El `onChanged`
que recibe `TaskModal` recarga lo que esa vista considera suyo y nada más: en el
ritual diario es `useBoard` con el día de hoy, mientras el repaso del día anterior,
la columna del backlog y el mapa de rescates son estado aparte que solo se refresca
con el aviso. Sin `bumpData()`, borrar escribía en la base y dejaba la card en
pantalla — el gesto se sentía muerto y el click siguiente abría el detalle de algo
que ya no existía. Regla práctica: **si una vista tiene listas además de las del
board, cualquier mutación necesita el aviso, no el callback.**

**Completar una tarea puede detener el timer**, y eso pasa en Rust (I5). Después de
`setTaskStatus` hay que hacer `bumpData()` aunque tu vista ya se haya recargado
sola.

**El ciclo de recarga es para leer.** El efecto de `useBoard` depende de
`[reload, dataVersion]`, así que todo lo que pongas ahí corre con **cada** cambio
de datos, no una vez al montar. La limpieza diaria cayó en esa trampa:
`api.demotePending()` es una mutación y se ejecutaba en cada invalidación. Hoy pasa
por `degradarUnaVez(today)` (`src/features/tasks/useBoard.ts`), que la corre una vez
por día y por ventana y deduplica las llamadas concurrentes de dos vistas montadas a
la vez. Si necesitas disparar una mutación al abrir una vista, dale su propia
guarda — y que la guarda sea la **fecha** y no un booleano, o una sesión que cruza
la medianoche no vuelve a correr.

**Nunca llames `todayISO()` dentro del render.** Usa `useToday()` de
`src/lib/day.ts`. Esta app se queda abierta cruzando la medianoche —el Mac se
suspende a las 19:00 y despierta a las 9:00— y sin un cambio de estado la vista no
se vuelve a renderizar: Today mostraba ayer, con título y todo.

**Un store recién montado no sabe nada todavía, y "no sé" no es "no".** El
taxímetro decide si mostrarse a partir de `active || last`, y ahí hay una asimetría
que muerde: `last` sale de `localStorage` en el acto, pero **`active` vive en la
base** y llega asincrónico. Con el timer *corriendo* —que no deja `last`— el primer
render se ve idéntico a "no hay nada que mostrar", y la ventana **se escondía a sí
misma** antes de saber que sí había algo; después ya era tarde, porque un webview
oculto en macOS se estrangula y el `show()` posterior podía no correr nunca. Por eso
`timerStore.loaded`: mientras sea false **no se llama ni a mostrar ni a esconder**.
Si agregas otro controlador de visibilidad, dale el mismo guard — y si tu estado
inicial se puede confundir con una respuesta legítima, ponle su propia bandera.

**Una API de ventana nueva necesita su permiso** en
`src-tauri/capabilities/default.json`, **en el mismo cambio**. Si falta, falla en
runtime y no al compilar, y el síntoma es una ventana que no aparece sin ningún
error visible. Ya mordió dos veces. Las capabilities se compilan dentro de la app,
así que hay que reiniciar `pnpm tauri dev`: recargar el webview no las actualiza.

## Cómo se depura esto

**Para depurar el taxímetro, píntalo en el taxímetro.** No tiene consola alcanzable
en la práctica, así que los `console.error` se pierden y se diagnostica a ciegas. Un
bloque temporal detrás de `import.meta.env.DEV` que muestre los números en la propia
tarjeta resuelve en una captura lo que si no son cuatro rondas de conjeturas.

**Varias invalidaciones seguidas se coalescen.** El cleanup del efecto marca la
recarga anterior como abandonada, así que tres `bumpData()` en la misma vuelta
pueden terminar en una sola lectura. Importa al escribir un test que cuente
llamadas.

**Si tocas `useDataSync`, verifica que los tests se pongan rojos** al desactivar el
listener (`src/lib/store.test.tsx` y `src/features/today/TodayView.sync.test.tsx`).
Es la única forma de saber que siguen midiendo algo.

## Navegación entre ventanas

El taxímetro no navega: enfoca `main` y emite el evento `sunrise://goto` con un
path, que `useGotoListener` escucha del otro lado (los dos en
`src/features/timer/useFloatingWindow.ts`). Si necesitas otro salto
ventana→ventana, sigue ese patrón en vez de manipular el router de la otra ventana.
