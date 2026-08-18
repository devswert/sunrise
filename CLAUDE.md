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
| `sunrise-release` | publicar: changelog, versión en tres archivos, tag |

**Si tu cambio no cae limpio en ninguna de esas seis, lee `docs/SPECS.md` antes
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

**Publicar una versión la maneja la skill `sunrise-release`.** Son cuatro cosas
—los tres archivos de versión (`Cargo.toml`, `tauri.conf.json`, `package.json`) y
la entrada en `docs/CHANGELOG.md`— y el que se olvida siempre es el changelog: de
ahí salen el cuerpo del Release, el aviso de Configs y el modal "Lo nuevo". Hay dos
tests que se ponen rojos si algo de eso divergió.

## Reglas de trabajo

- **No commitear sin confirmación.** Deja los cambios en el working tree y
  muestra qué se tocó; el commit lo autoriza el dev cada vez. Autorizar un
  commit no autoriza el siguiente: si terminas otra tanda de trabajo en el mismo
  turno, vuelve a preguntar. Vale igual para `git push`, ramas y `git reset`.
- **El código en inglés, el texto en español.** No es gusto: mezclar los dos
  idiomas en la misma línea obliga a traducir mentalmente en cada lectura, y el
  daño es visual antes que técnico. La línea es exacta:

  | En inglés | En español |
  |---|---|
  | variables, funciones, tipos, campos, parámetros | comentarios y doc comments |
  | nombres de archivo y de módulo | todo el texto que ve el usuario |
  | comandos IPC, claves de `settings`, valores de enum | descripciones de tests (`it("…")` y los `fn` de `#[test]`) |
  | tablas y columnas de la DB | esta documentación y los mensajes de commit |

  Dos precisiones que ya se discutieron: **el nombre de un test de Rust es su
  descripción**, no un identificador que alguien llame, así que se queda en
  español igual que el `it("…")` de Vitest. Y **los términos del sidebar**
  (`Weekly review`, `Focus`, `Backlog`, `Daily rituals`) se quedan en inglés: son
  los nombres propios de las vistas, no texto traducible.

  **Las clases CSS quedan fuera**, y no por descuido: son strings a los dos lados
  y no las revisa ningún compilador, así que un renombre ahí se paga con estilos
  que desaparecen en silencio. Las que están en español (`.rail__bloque-parte`,
  `.set-input--hora`) se quedan como están; una clase nueva puede nacer en inglés.

  Al renombrar, ojo con los tres lugares donde una palabra en español **no** es
  prosa y hay que cambiarla: las interpolaciones (`format!("{x}")`, `${x}`), los
  nombres de método escritos como string (`vi.spyOn(api, "x")`) y los alias de
  SQL. Y con los dos donde parece código y **no** lo es: el texto JSX y los
  literales de expresión regular de los tests.
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
- **La llave privada del updater no entra al repo**, ni como archivo suelto ni
  pegada en un YAML: vive en los secrets de GitHub. La pública sí va versionada,
  en `tauri.conf.json`. Si se pierde la privada no se puede firmar una
  actualización que las apps instaladas acepten. Detalle en SPECS §4.21.
- **Dev y producción usan bases distintas** (`sunrise-dev.sqlite` vs
  `sunrise.sqlite`). El sidebar muestra `dev` cuando corresponde. Detalle en
  SPECS §4.20.
- **UI: la distribución no se rediseña sobre la marcha** (ante una duda, mira la
  vista hermana), autosave sin botón "Guardar", popovers en
  portal (`Popover.tsx`), selects con búsqueda (`SearchSelect.tsx`), slots de
  altura fija para no desalinear columnas. Detalle en SPECS §7.
