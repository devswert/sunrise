# sunrise

Planner diario personal y liviano. App de escritorio, datos locales, un solo
usuario en una sola máquina. Tauri v2 (Rust) + React 18 + TS + Vite + SQLite.

## Dónde están las reglas

Las reglas del proyecto están en **skills** (`.claude/skills/`), que se cargan
solas cuando el tema aparece — no hace falta leerlas todas por adelantado:

| Skill | Cúbre |
|---|---|
| `sunrise-timer-y-tiempo` | timer, `time_entries`, actual/planned, campana, rollup |
| `sunrise-sync-ventanas` | las dos ventanas, `dataVersion`/`bumpData`, taxímetro |
| `sunrise-capa-de-datos` | migraciones, `repo.rs`, comandos, `ipc.ts` + `mockDb.ts` |
| `sunrise-ui` | autosave, popovers, slots, paleta, DnD |
| `sunrise-tests` | Vitest/RTL, `cargo test`, por qué el mock es obligatorio |

**Si tu cambio no cae limpio en ninguna de esas cinco, lee `docs/SPECS.md` antes
de tocar código** — las skills cubren los dominios más frágiles, no todo el
proyecto (por ejemplo el reconciler ICS de M3 no tiene skill todavía).

- **[docs/SPECS.md](docs/SPECS.md)** — todo lo que existe hoy y cómo funciona,
  con las invariantes (§6), la sincronización (§5) y la deuda conocida (§9).
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — qué falta, en orden.

Si cambias una invariante o una regla, actualiza `docs/SPECS.md` **y la skill
correspondiente** en el mismo commit.

## Comandos

```bash
pnpm tauri dev    # app + ventana flotante
pnpm test         # Vitest + RTL
pnpm test:rust    # cargo test (SQLite en memoria)
pnpm test:all     # ambos
pnpm dmg          # build de release + .app y .dmg (SPECS §4.19)
pnpm iconos       # regenera el icon set desde public/app-icon.svg
```

**Subir la versión son tres archivos** —`Cargo.toml`, `tauri.conf.json` y
`package.json`— y hay un test que se pone rojo si divergen: la versión va escrita
en el manifest de cada respaldo.

## Reglas de trabajo

- **No commitear sin confirmación.** Deja los cambios en el working tree y
  muestra qué se tocó; el commit lo autoriza el dev cada vez. Autorizar un
  commit no autoriza el siguiente: si terminas otra tanda de trabajo en el mismo
  turno, vuelve a preguntar. Vale igual para `git push`, ramas y `git reset`.
- **Enums en MAYÚSCULAS** en la DB y en TS, espejados entre
  `src-tauri/src/db/migrations.rs` y `src/lib/enums.ts`.
- **Tests obligatorios por milestone.** Cada milestone entrega con sus tests en
  verde. La lógica de datos va en `repo.rs` (funciones puras sobre
  `&Connection`), que es lo que hace posible testearla.
- **Todo acceso a datos pasa por `src/lib/ipc.ts`**, y cada comando nuevo
  necesita también su implementación en `src/lib/mockDb.ts` (es lo que permite
  correr los tests en jsdom y ver la app en el browser).
- **Migraciones aplicadas son inmutables**: agrega una versión nueva.
- **No se nombran productos de terceros como referencia de diseño**, ni en código,
  ni en comentarios, ni en docs. Una regla del tipo "que se vea como X" no sirve
  igual: hay que decir **qué es** la cosa y por qué. Si te encuentras escribiendo
  "como lo hace <producto>", eso es la señal de que falta la razón.
- **Dev y producción usan bases distintas** (`sunrise-dev.sqlite` vs
  `sunrise.sqlite`). El sidebar muestra `dev` cuando corresponde. Detalle en
  SPECS §4.20.
- **UI: la distribución no se rediseña sobre la marcha** (ante una duda, mira la
  vista hermana), autosave sin botón "Guardar", popovers en
  portal (`Popover.tsx`), selects con búsqueda (`SearchSelect.tsx`), slots de
  altura fija para no desalinear columnas. Detalle en SPECS §7.
