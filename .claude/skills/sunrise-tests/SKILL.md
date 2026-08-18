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

Estado en el commit `1175035`: 39 tests front (11 archivos) y 24 Rust, verdes.

## Rust: la lógica va donde se puede testear

`repo.rs` son funciones puras sobre `&Connection` y no conocen Tauri —por eso se
pueden probar sin levantar la app. `commands.rs` son wrappers delgados y **no se
testean**. Si escribes lógica dentro de un comando, la estás poniendo fuera del
alcance de los tests: bájala a `repo.rs`.

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

## Front: qué y cómo

Vitest + React Testing Library. Los tests se agarran de **`aria-label` y roles**,
no de clases CSS — mantenlos al tocar componentes.

Cubierto hoy: `capacity` (semáforo y parseo de duraciones), `date`, `history`,
`useTimer`, `useDragOrClick`, `TaskCard`, `TaskModal`, `Sidebar`, `FocusView`,
`SettingsView`.

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

## El hueco conocido

**Nada cubre el cruce entre las dos ventanas**, que es exactamente donde está el
bug activo de sincronización (ver la skill `sunrise-sync-ventanas`). Un test que
simule el evento `storage` y verifique que la vista recarga cierra la clase
entera de bug. Si estás por ahí, es el test de mayor retorno que se puede
escribir en este repo.

## Notas de entorno

- `pnpm` v11 lee su configuración de `pnpm-workspace.yaml`, **no** del campo
  `pnpm` de `package.json`. Ahí está `onlyBuiltDependencies: [esbuild]`.
- Hay un warning de `act()` en el test del `Sidebar`: pasa, pero ensucia la
  salida. Si tocas ese componente, vale limpiarlo de paso.
