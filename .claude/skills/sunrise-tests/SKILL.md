---
name: sunrise-tests
description: Cómo se testea sunrise — Vitest + RTL en el front, `cargo test` con SQLite en memoria en Rust, y por qué `mockDb.ts` es obligatorio para que los tests corran en jsdom. Úsala cuando vayas a escribir o arreglar tests, cuando cierres un milestone (cada uno entrega con sus tests en verde), cuando un test falle por un comando que "no existe" fuera de Tauri, y cuando quieras saber dónde poner la lógica para que sea testeable.
---

# Tests en sunrise

Regla del proyecto: **cada milestone entrega con sus tests en verde.** El motivo
que dio el usuario es asegurar las funcionalidades ante cambios futuros, así que
un test que no muerde no sirve: si cambias una regla, su test debería ponerse
rojo.

```bash
pnpm test        # Vitest + RTL
pnpm test:rust   # cargo test (SQLite en memoria)
pnpm test:all    # ambos
```

## Rust: la lógica va donde se puede testear

`repo.rs` son funciones puras sobre `&Connection` y no conocen Tauri —por eso se
pueden probar sin levantar la app. `commands.rs` son wrappers delgados, y por eso
casi no tiene tests: los pocos que hay no prueban wrappers sino helpers puros
(`sound_or_default`) y la config del updater. Si escribes lógica dentro de un
comando, la estás poniendo fuera del alcance de los tests: bájala a `repo.rs`.

Los tests viven en el `mod tests` del propio archivo:

```rust
fn conn() -> Connection {
    let c = db::open_in_memory().unwrap();
    db::migrate(&c).unwrap();
    c
}
```

Cada test arranca de una DB limpia y migrada, así que también sirve de
verificación de que las migraciones aplican desde cero.

Nombres en español y descriptivos de la regla, no del método
(`completar_una_tarea_detiene_su_timer`, no `test_set_status`). Lo que ya está
cubierto: eventos de creación y movimiento, degradación selectiva al backlog,
acumulación
del timer, supervivencia del ajuste manual, contador del día que ignora ayer, un
solo timer activo, completar detiene el timer y no detiene el de otra tarea,
`focus_queue`, backlog, síntesis del sonido.

## Front: `mockDb.ts` no es opcional

Los tests corren en **jsdom**, donde no existe Tauri. `src/lib/ipc.ts` detecta
eso y delega en `src/lib/mockDb.ts`. **Todo comando nuevo necesita su
implementación en el mock**, o cualquier test que toque ese camino se cae — y la
app deja de verse en el browser, que es la otra razón por la que el mock existe.

Cuando agregues al mock, respeta la misma semántica que Rust (posiciones,
filtros por `source_state`, eventos de historial). Un mock que se comporta
distinto hace que los tests pasen con una realidad que no es la de la app.

**Y hay un modo de falla peor que el mock desalineado: el mock de acuerdo con el
front, los dos equivocados.** El mock recibe posicional y no revisa nombres, así
que un campo o una clave de argumento mal escrita se ve perfecta en jsdom y en el
browser, y **falla solo dentro de Tauri**, que es el único lado donde el nombre lo
pone serde. Ya pasó dos veces —`Rescue.from_date` y `daily_log`— y ninguna la
detectó una suite. Por eso hay un test que **no prueba comportamiento sino el
contrato**: `src/lib/ipcContract.test.ts` lee `ipc.ts`, `commands.rs` y `lib.rs`
como texto y compara los dos lados. Si escribes un test nuevo para un camino que
cruza el puente, ten claro que **no** te está cubriendo esa parte.

**La semilla del mock es data de preview, no una fixture.** Existe para que la app
se vea con contenido en el browser, y varios de sus items se anclan a **días de la
semana** (`weekDates`), no a hoy. O sea: **cuáles de sus tareas caen en el pasado
depende del día en que corras los tests.** Un caso que dependa de eso —"el último
día con tareas", "hubo tiempo trabajado hoy"— tiene que neutralizarla primero:
manda sus días pasados al backlog (`limpiarDiasPasados` en
`DailyPlanningView.test.tsx`) o créate tu propia fixture en vez de apoyarte en la
suya (`DailyShutdownView.test.tsx`, el caso del donut).

No es teórico: tres casos pasaban **los martes** y se caían de miércoles a domingo,
y lo encontró CI. Un test que se apoya en la semilla no falla al escribirlo, falla
un día cualquiera al que nadie va a asociar el cambio.

## Front: qué y cómo

Vitest + React Testing Library. Los tests se agarran de **`aria-label` y roles**,
no de clases CSS — mantenlos al tocar componentes.

Qué está cubierto lo dice el árbol, no esta skill: `ls src/**/*.test.ts*`. Lo que
**no** está cubierto y conviene saber: la ventana flotante (`FloatingTimer`,
`useFloatingWindow`), `useAutosave` y el runtime del updater.

Para lógica pura (fechas, capacidad, formato, historial) prefiere un test de
unidad sobre `src/lib/*` antes que uno de componente: es más rápido y falla más
claro.

**Los gráficos no se asertan por su SVG.** La matemática de la weekly review está
probada en `repo.rs` (`weekly_rollup`) y en `weeklyReview.ts`; el test de la
vista mira las cifras y las columnas que el usuario lee. Un test que cuente
`<rect>` se rompe con cada retoque de estilo sin haber protegido nada.

**El estado del mock es de módulo, y eso ordena los casos.** La bitácora, los
ajustes y la degradación se guardan en memoria del módulo, así que un archivo
puede depender del orden de sus `it`. Cuando pase, **anotalo arriba del
`describe`** (`DailyPlanningView.test.tsx` y `DailyShutdownView.test.tsx` lo
hacen): aislar un caso con `-t` lo puede dejar pasar en falso.

**El mock arranca sembrado.** Un test que asegure "las horas de la semana son
1h 30m" cuenta también la semilla y falla apenas alguien la toque: pide el total
a `api.weeklyRollup(...)` y compara contra eso, o mide el delta antes y después.

## El cruce entre ventanas ya está cubierto

**No lo vuelvas a escribir.** `src/lib/store.test.tsx` dispara un
`new StorageEvent("storage", …)` y verifica que `dataVersion` avanza;
`src/features/today/TodayView.sync.test.tsx` verifica que la vista recarga con eso.
Los dos se ponen rojos si alguien desactiva `useDataSync`. Si vas a tocar la
sincronización, esos son los tests que tienen que seguir verdes — el detalle del
mecanismo está en la skill `sunrise-sync-ventanas`.

## Notas de entorno

- `pnpm` v11 lee su configuración de `pnpm-workspace.yaml`, **no** del campo
  `pnpm` de `package.json`. Ahí está `onlyBuiltDependencies: [esbuild]`.
- **Corre `TZ=UTC pnpm test` además del normal si tocas algo con fechas.** CI corre
  en UTC y tu máquina no, así que entre las 20:00 y medianoche de Santiago el "hoy"
  de CI ya es el día siguiente. Dos veces seguidas eso encontró bugs de fecha que
  en local pasaban por casualidad; los dos están contados en `docs/DECISIONES.md`
  §10, y el segundo pasaba **solo los martes**.
- **CI ya no es solo cosa de los tags.** `.github/workflows/tests.yml` corre
  `pnpm test:all` en cada push a `main` y en cada PR, así que un rojo aparece en el
  push que lo introdujo y no cuando alguien va a publicar. `release.yml` sigue
  corriendo las suites antes de empaquetar —eso no se toca— pero ya no es el primer
  lugar donde se entera nadie. Detalle en `docs/specs/distribucion.md` §4.19.

## Idioma: código en inglés, texto en español

Convención del proyecto (CLAUDE.md). Identificadores —variables, funciones,
tipos, campos, archivos, comandos IPC— en **inglés**. Comentarios, texto de la
app, descripciones de tests y documentación en **español**. El nombre de un
`#[test]` de Rust es su descripción, así que va en español.
