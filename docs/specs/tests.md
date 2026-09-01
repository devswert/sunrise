# §8 Tests

Vuelve al [índice de SPECS](../SPECS.md).

Obligatorios por milestone. Cuántos hay lo dice el runner, no este documento.

```bash
pnpm test        # Vitest + RTL
pnpm test:rust   # cargo test (SQLite en memoria)
pnpm test:all    # ambos
TZ=UTC pnpm test:rust   # como corre CI
```

**CI corre en UTC y eso es una ventaja.** El primer tag de la 0.1.0 falló ahí por un
bug de zona que llevaba desde el primer commit (§4.12, `RECURRENCE-ID`): en Santiago
pasaba por casualidad. Si un test toca zonas, córrelo con `TZ=UTC` antes de empujar, y
escríbelo con una zona **distinta** a la tuya — un caso con fixtures en tu propia zona
no puede detectar el error.

> `pnpm` v11 lee su configuración de `pnpm-workspace.yaml`, no del campo `pnpm` de
> `package.json` (ahí está `onlyBuiltDependencies: [esbuild]`).

## Dónde está cada cosa

La lista de casos vive en los propios archivos y no se duplica acá; esto es el mapa.

| Área | Archivos |
|---|---|
| Datos y reglas de negocio | `repo.rs`, `models.rs`, `db/mod.rs`, `mockDb.test.ts` |
| Tareas y tablero | `useBoard.test.tsx`, `TaskCard.test.tsx`, `TaskModal.test.tsx`, `reorder.test.ts`, `history.test.ts` |
| Backlog | `BacklogView.test.tsx`, `BacklogPanel.test.tsx`, `BacklogColumn.test.tsx`, `grouping.test.ts` |
| Tiempo y taxímetro | `repo.rs`, `useTimer.test.ts`, `timerStore.test.ts`, `useDragOrClick.test.tsx`, `useCursorHover.test.ts`, `timeByDay.test.ts` |
| Focus | `FocusView.test.tsx` |
| Weekly review y rollup | `repo.rs`, `weeklyReview.test.tsx`, `reviewFilter.test.ts`, `WeeklyReviewView.test.tsx` |
| Bitácora y cierre | `repo.rs`, `dailyLog.test.ts`, `DailyShutdownView.test.tsx`, `useShutdownReminder.test.ts` |
| Planificación diaria | `dailyPlan.test.ts`, `DailyPlanningView.test.tsx`, `repo.rs` (`demote_pending`) |
| Objetivos | `repo.rs`, `WeeklyPlanningView.test.tsx`, `objectiveHistory.test.ts` |
| Calendario y rail | `calendar/ics.rs`, `calendar/mod.rs`, `railLayout.test.ts`, `CalendarRail.test.tsx`, `calendarSync.test.ts`, `descripcion.test.ts`, `FeedsCard.test.tsx`, `MeetingLink.test.tsx`, `Participantes.test.tsx` |
| DnD del board | `collision.test.ts`, `dropTarget.test.ts` |
| Vista semana | `date.test.ts` (`threeWeeks`), `WeekView.test.tsx`, `anchor.test.ts` |
| El día como estado | `day.test.ts` |
| Capacidad | `capacity.test.ts`, `capacity.parse.test.ts` |
| Settings y atajos | `settings.test.ts`, `secciones.test.ts`, `shortcuts.test.ts`, `useShortcuts.test.tsx`, `SettingsView.test.tsx`, `DevToolsCard.test.tsx` |
| Notificaciones | `notice.rs`, `notify.test.ts`, `NotificationsCard.test.tsx` |
| Sonido y tipografía | `sound.rs`, `bell.rs`, `fonts.rs`, `fonts.test.ts`, `AppearanceCard.test.tsx` |
| Respaldo | `backup.rs`, `backup.test.ts`, `BackupCard.test.tsx` |
| Updater y changelog | `update.rs`, `UpdateBanner.test.tsx`, `changelog.test.ts`, `WhatsNew.test.tsx` |
| Paleta y contraste | `tokens.test.ts` |
| Primitivas | `Dialog.test.tsx`, `Popover.test.tsx`, `SearchSelect.test.tsx`, `QuitConfirm.test.tsx`, `Sidebar.test.tsx`, `SunriseMark.test.tsx` |
| Cruce entre ventanas | `store.test.tsx`, `TodayView.sync.test.tsx` |
| Contrato IPC | `ipcContract.test.ts` |

## Los tests que protegen una decisión, no un código

Se ponen rojos si alguien "simplifica" en la dirección obvia. Antes de tocarlos, lee
qué defienden.

- **`ipcContract.test.ts`** lee `ipc.ts`, `commands.rs` y `lib.rs` **como texto** y
  compara los dos lados: que la clave de cada argumento del `invoke` sea el parámetro
  de Rust en camelCase, y que todo comando esté en el `invoke_handler![]`. Es el único
  que no prueba comportamiento sino el contrato, y existe porque las dos suites corren
  contra `mockDb` y por definición no pueden ver un desacuerdo con Rust
  ([§2.2](arquitectura.md)).
- **`tokens.test.ts`**: el que **lee todos los CSS** exige que ninguna regla
  pinte un color a full con su propio `-ink`: es el par que da 2.0 de contraste, y el
  modo de falla es que compila, se ve "verde sobre verde" y hay que medirlo para
  descubrirlo. Lo acompaña uno que exige que el glob **haya leído algo** — con el CSS
  apagado Vitest devuelve string vacío sin avisar, y el test pasaría para siempre sin
  vigilar nada, por eso `vite.config.ts` procesa todo `*.css?raw`. Los demás protegen
  que los 24 `-ink` estén en las tres ramas, que el color **no** se redefina por tema, y
  que los sólidos no lo sigan. El primero cubre el fallo que ningún otro ve: sin el
  token, `var(--x)` no resuelve y el punto sale **transparente, sin error en consola**.
- **Dev y producción conviviendo** (§4.20): `db::file_name()` no puede devolver lo mismo
  que `PROD_FILE` —si los dos perfiles abren el mismo archivo, probar un cambio escribe
  en la base de verdad—, `DB_IN_ZIP` **sí** tiene que ser el de producción para que el
  respaldo cruce, y **ningún perfil reconoce el nombre de respaldo del otro**. Y en
  `Sidebar.test.tsx`, que el distintivo `dev` diga qué base usa: es **toda** la
  protección del lado del usuario.
- **La retención del respaldo** se pone roja si el patrón de borrado se afloja a
  `*.zip`. Verificado a mano.
- **Inicio automático**: el switch cambia el estado del sistema **sin agregar una clave
  a `settings`**. Protege la decisión de §4.18, no el botón: si alguien mueve el ajuste a
  la tabla "por consistencia", empieza a viajar dentro de los respaldos.
- **El orden de Configs**: `SettingsView.test.tsx` compara los `data-section` dibujados
  contra `visibleTabs(true)`. El resaltado lo decide un `IntersectionObserver`, así que
  una sección de más, de menos o corrida marca una y muestra otra, sin error y sin nada
  roto a la vista.
- **`changelog.test.ts`** exige que la versión de `package.json` **tenga su sección
  escrita**: sin eso el modal y las notas del Release quedan vacíos en silencio.
- **La marca**: dos instancias no repiten el id del degradado, y `app-icon.svg` es XML
  válido. Cubren fallos que ningún otro test ve — el id duplicado no lanza nada, solo
  apaga un degradado; y el SVG no lo renderiza React, así que un error ahí aparece recién
  al empaquetar.
- **`useDataSync`**: `store.test.tsx` y `TodayView.sync.test.tsx` se ponen rojos si se
  desactiva.
- **Un fallo de red del updater no cuenta como estar al día.** Los dos estados se ven
  parecidos y significan lo contrario.
- **Una clave de notificación ausente es encendido**, que es lo que evita silenciar los
  tres avisos al actualizar.

## Lo que ningún test cubre

Necesita Tauri corriendo, o un sistema operativo de verdad. **Se verifica a mano**; el
pendiente vivo está en el [ROADMAP](../ROADMAP.md).

- El camino real de **⌘Q**, el **aviso nativo de `work_end`** y el **registro del
  LaunchAgent** del inicio automático.
- La **restauración real**: el mock no tiene base que reemplazar.
- La **descarga del update**: reemplaza el `.app` instalado y reinicia el proceso.
- **El gesto del DnD**, el **scroll** y el **`position: sticky`**: jsdom no devuelve
  rectángulos, no implementa `scrollLeft` y no resuelve sticky, así que un assert sobre
  la posición pasaría o fallaría por el motivo equivocado.
- **Los gráficos no se asertan por su SVG**, salvo la geometría del donut, que sí es
  nuestra: porciones contiguas que cubren la vuelta.

## Dos trampas al escribir tests

- **`userEvent`, no `fireEvent.click`**, cuando lo que se prueba depende del foco:
  `fireEvent` no lo mueve y el test pasaría con el bug puesto.
- **Tres archivos dependen del orden** y están anotados: los ajustes del mock y la
  bitácora viven en memoria de módulo, y la degradación corre **una sola vez por
  archivo** — aislar un caso con `-t` lo puede dejar pasar en falso.
- Los timers falsos con `shouldAdvanceTime` van instalados **antes** de montar: el
  intervalo se crea en el efecto y uno instalado después no lo controla.
