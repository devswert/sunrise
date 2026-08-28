# §6 Invariantes · §9 Deuda conocida

Vuelve al [índice de SPECS](../SPECS.md).

Decisiones deliberadas, no accidentes. Varias tienen su comentario en el código; si
cambias una, actualiza este archivo en el mismo commit.

## §6 Invariantes — no romper

- **I1. `actual_seconds` ACUMULA; nunca se recalcula desde `time_entries`.**
  `stop_timer` hace `actual_seconds + seconds`. Recalcular desde las entradas
  pisaría los ajustes manuales.
- **I2. Los ajustes manuales pasan por `set_actual_seconds`**, que además inserta
  una **entrada cerrada con el delta** para que el rollup siga cuadrando. Por eso
  `update_task` desvía `actual_seconds` a esa función en vez de escribir la
  columna. **Subir es una entrada; recortar pueden ser varias** —una por día,
  topada a su saldo (`spread_cut`, §4.15)—, porque el trabajo puede estar repartido
  en varios días y una sola fila negativa deja alguno bajo cero.
- **I3. `base_seconds` es `seconds_today`, no el total histórico.** Una tarea
  arrastrada al día siguiente arranca en 0 aunque su acumulado sea mayor.

  Tres reglas la sostienen, las tres pagadas con un contador que mostraba
  `-14:-17:-39`:

  1. **`seconds_today` tiene piso en 0** (`MAX(0, …)`). El delta negativo de un
     ajuste (I2) puede superar lo trackeado hoy, y un tiempo negativo nunca es
     correcto.
  2. **Lo corrido se mide desde la medianoche**, no desde `started_at` (`runSeconds`).
     Si no, un timer abierto toda la noche muestra 15 horas a las 9 AM.
  3. **`stop_timer` parte la corrida por día local** al cruzar medianoche
     (`segments_by_local_day`). El tiempo se atribuye por `started_at`, así que una
     fila de 15h le acreditaría todo al día en que empezó. El rollup diario agrupa
     por día leyendo esta tabla, y con filas que cruzan días esa regla es
     inimplementable sin aritmética de solapamiento en cada consulta: se corrigió en
     la escritura, una vez, en vez de en cada lector. El último tramo absorbe el
     resto de la división para que la suma siga dando el total (I1).
- **I4. Un solo timer activo.** Una sola fila con `ended_at IS NULL`; `start_timer`
  llama a `stop_timer` primero.
- **I5. Estado y timer se mueven juntos, y eso vive en Rust.** `set_task_status(DONE)`
  **detiene** el timer si la tarea era la activa, y `start_timer` **reabre** la tarea
  si estaba `DONE` — volver a trabajar en algo es decir que no estaba terminado. Están
  en `repo.rs` y no en cada vista para que valgan desde los cinco lugares con botón de
  play. **Corolario: quien llame `setTaskStatus` debe hacer `bumpData()` después**,
  porque el estado del timer pudo cambiar (`start` ya lo hace solo).
- **I6. Lo que depende del reloj y tiene que pasar aunque no mires, va en Rust.** La
  campana lo aprendió a la mala (§4.6): estaba en el `tick` de un webview, y un webview
  que no se ve no corre sus timers. Vive en `bell.rs`. En el front puede quedar lo que
  solo importa mirando —el dibujo del taxímetro— y lo que necesita una ventana; eso
  último va en `Shell`, que solo existe en `main`, para que no ocurra dos veces. **El
  respaldo automático siguió el mismo camino** (§4.17): llegaba cinco minutos tarde por
  lo mismo, y ahora lo corre `backup.rs`. Con dos casos medidos, lo que quede en el
  front por "necesita una ventana" hay que justificarlo, no heredarlo.
- **I7. Los listados filtran `source_state = 'ACTIVE'`.** Las `ORPHANED` existen solo
  para el historial y la review. **La única excepción es el rollup compartido**
  (`work_by_day`, §4.15 y §4.16), que las cuenta a propósito: filtrarlas borraría horas
  reales de semanas pasadas.
- **I8. Enums en MAYÚSCULAS**, espejados `migrations.rs` ↔ `enums.ts`.
- **I9. Las migraciones aplicadas son inmutables**: se agrega una versión nueva.
- **I10. Todo acceso a datos pasa por `src/lib/ipc.ts`**, con su gemelo en `mockDb.ts`.
  Ningún componente llama `invoke` directo.
- **I11. Toda mutación llama `bumpData()`** ([§5.3](sincronizacion.md)). Para invalidar
  **sin** avisar hacia afuera está `markDataStale()`, que existe solo para el listener
  que recibe esos avisos.

## §9 Deuda técnica conocida

Las resueltas se podan; su relato está en `git log -p docs/SPECS.md`.

- **D6. `SettingsView` no observa `dataVersion`**: solo recarga con su propio `load`.
- **D7. Warning de `act()`** en el test del `Sidebar` (pasa, pero ensucia).
- **D9. El error de reemplazo en la restauración se muestra en un webview que quizá ya
  no puede leer su base.** Si `db::open` falla después de copiar (§4.17), el mensaje va
  a la card de Configs como cualquier otro; un `message()` nativo llegaría igual. Es el
  peor caso de un camino que además tiene vuelta atrás (el archivo previo queda al
  lado), así que es de baja prioridad. Queda anotado porque es el único lugar donde lo
  nativo le gana a nuestro estilo.
