# §2 Arquitectura

Vuelve al [índice de SPECS](../SPECS.md).

## 2.1 Dos ventanas nativas

| Label | Entrypoint | Qué es |
|---|---|---|
| `main` | `index.html` → `src/main.tsx` | La app completa (sidebar + vistas) |
| `floating-timer` | `timer.html` → `src/timer.tsx` | Taxímetro flotante, 228×70, sin decoración, transparente, always-on-top, `skipTaskbar`, arranca invisible |

Declaradas en `src-tauri/tauri.conf.json`; sus permisos, en
`src-tauri/capabilities/default.json`. **Una API de ventana nueva sin su permiso
ahí falla en runtime, no en compilación.**

> **Son dos documentos y dos bundles de React**, o sea **dos instancias de cada
> store de Zustand**. No comparten memoria — ver [§5](sincronizacion.md).

## 2.2 Capas del backend

```
db/ (open, migrate)  →  repo.rs (todo el SQL, funciones puras sobre &Connection)
                     →  commands.rs (#[tauri::command], wrappers delgados)
                     →  lib.rs (registro del invoke_handler)
```

- `repo.rs` no conoce Tauri: recibe `&Connection`, y por eso es testeable con
  SQLite en memoria. **La lógica de negocio va acá, no en `commands.rs`.**
- Una sola `Connection` en `Mutex`, manejada por Tauri (`app.manage(Db(...))`) y
  compartida por ambas ventanas. La DB vive en `app_data_dir()/sunrise.sqlite`.
- `models.rs` usa `#[serde(rename_all = "camelCase")]` para espejar
  `src/lib/types.ts`. **Un campo nuevo se toca en los dos lados.**

**El puente tiene dos contratos que son strings a ambos lados**, así que no los
revisa ningún compilador: los **nombres de campo** (serde ↔ `types.ts`) y las
**claves de argumento** del `invoke`, que son el parámetro de Rust en camelCase
(`to_date` → `toDate`).

Los dos fallan **solo dentro de Tauri**: el mock recibe posicional, así que puede
estar de acuerdo con el front y los dos equivocados, con el browser y las dos
suites en verde. Un campo mal escrito llega `undefined`; una clave mal escrita
hace que Tauri **rechace la llamada entera** y la vista se queda cargando para
siempre. Ya pasaron los dos: `Rescue.from_date` (§4.14) y `daily_log` (§4.16).
Ahora los compara `src/lib/ipcContract.test.ts`.

## 2.3 Capas del frontend

```
src/lib/ipc.ts        → cliente tipado único. TODO el acceso a datos pasa por acá.
src/lib/mockDb.ts     → implementación in-memory para browser/tests
src/lib/types.ts      → espejo de models.rs
src/lib/enums.ts      → espejo de los enums de migrations.rs
src/features/<area>/  → vistas + hooks de cada área
src/components/       → primitivas compartidas (Popover, SearchSelect, TimePicker…)
```

`api.*` decide en cada llamada: dentro de Tauri hace `invoke`, fuera delega en
`mock`. Es lo que permite correr los tests en jsdom y ver la app en el browser.
**Todo comando nuevo necesita su entrada en `ipc.ts` y su gemelo en `mockDb.ts`**,
o los tests se caen.
