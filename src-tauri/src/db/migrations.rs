//! Migraciones versionadas de SQLite.
//!
//! Cada entrada es `(version, sql)`. El runner aplica en orden las versiones
//! mayores a la actual, dentro de una transacción. Los campos de texto que
//! actúan como enum se almacenan en MAYÚSCULAS (TODO/DONE, MANUAL/CALENDAR, …).

use rusqlite::{Connection, Result};

pub const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        r#"
        CREATE TABLE categories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            color       TEXT NOT NULL DEFAULT 'sky',
            position    INTEGER NOT NULL DEFAULT 0,
            archived    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE objectives (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            iso_week    TEXT NOT NULL,
            title       TEXT NOT NULL,
            position    INTEGER NOT NULL DEFAULT 0,
            completed   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_objectives_week ON objectives(iso_week);

        CREATE TABLE calendar_feeds (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT NOT NULL,
            ics_url             TEXT NOT NULL,
            default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            import_as_tasks     INTEGER NOT NULL DEFAULT 1,
            poll_minutes        INTEGER NOT NULL DEFAULT 15,
            last_synced_at      TEXT
        );

        CREATE TABLE tasks (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            title             TEXT NOT NULL,
            notes             TEXT,
            category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            objective_id      INTEGER REFERENCES objectives(id) ON DELETE SET NULL,
            scheduled_date    TEXT,
            scheduled_time    TEXT,
            position          INTEGER NOT NULL DEFAULT 0,
            estimated_minutes INTEGER,
            actual_seconds    INTEGER NOT NULL DEFAULT 0,
            status            TEXT NOT NULL DEFAULT 'TODO',
            completed_at      TEXT,
            source            TEXT NOT NULL DEFAULT 'MANUAL',
            source_state      TEXT NOT NULL DEFAULT 'ACTIVE',
            feed_id           INTEGER REFERENCES calendar_feeds(id) ON DELETE SET NULL,
            calendar_uid      TEXT,
            event_start       TEXT,
            event_end         TEXT,
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL,
            UNIQUE(feed_id, calendar_uid)
        );
        CREATE INDEX idx_tasks_scheduled_date ON tasks(scheduled_date);
        CREATE INDEX idx_tasks_status ON tasks(status);

        CREATE TABLE task_events (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            type      TEXT NOT NULL,
            from_date TEXT,
            to_date   TEXT,
            at        TEXT NOT NULL
        );
        CREATE INDEX idx_task_events_task ON task_events(task_id);

        CREATE TABLE time_entries (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            started_at TEXT NOT NULL,
            ended_at   TEXT,
            seconds    INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_time_entries_task ON time_entries(task_id);
        CREATE INDEX idx_time_entries_started ON time_entries(started_at);

        CREATE TABLE settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    ),
    (
        2,
        r#"
        INSERT INTO settings (key, value) VALUES
            ('daily_capacity_minutes', '480'),
            ('capacity_warn_ratio', '0.85'),
            ('bell_sound', 'bell'),
            ('work_start', '09:00'),
            ('work_end', '18:00');

        INSERT INTO categories (parent_id, name, color, position) VALUES
            (NULL, 'Thinking', 'lavender', 0),
            (NULL, 'Tooling',  'sky',      1),
            (NULL, 'Docs',     'mint',     2),
            (NULL, 'Projects', 'apricot',  3),
            (NULL, 'Selfcare', 'rose',     4),
            (NULL, 'Issues',   'butter',   5),
            (NULL, 'Meetings', 'sage',     6);
        "#,
    ),
    (
        3,
        r#"
        -- Por qué falló la última sincronización de este feed, o NULL si salió
        -- bien. Sin esta columna un feed roto —URL revocada, token vencido— se
        -- ve idéntico a uno que nunca se sincronizó: `last_synced_at` se queda
        -- en su valor viejo y la UI no tiene nada que mostrar. El error tiene
        -- que sobrevivir al reinicio, así que va en la tabla y no en memoria.
        ALTER TABLE calendar_feeds ADD COLUMN last_error TEXT;
        "#,
    ),
    (
        4,
        r#"
        -- Link para entrarle a la reunión (Meet, Zoom, Teams). Columna propia y
        -- no dentro de `notes` a propósito: las notas son del usuario y la
        -- sincronización las pisaría cada 15 minutos. Acá el dueño es el feed,
        -- así que se puede actualizar sin destruir nada escrito a mano.
        ALTER TABLE tasks ADD COLUMN meeting_url TEXT;
        "#,
    ),
    (
        5,
        r#"
        -- Descripción y participantes del evento. Igual que `meeting_url`: son
        -- del feed, no del usuario, así que van en columnas propias y la
        -- sincronización las puede refrescar sin pisar `notes`.
        --
        -- `attendees` guarda JSON y no una tabla aparte a propósito: es un dato
        -- de solo lectura que siempre se muestra completo junto a su tarea, así
        -- que no hay consulta que justifique normalizarlo. Si algún día se
        -- quiere buscar "meetings con X", ahí sí conviene la tabla.
        ALTER TABLE tasks ADD COLUMN event_description TEXT;
        ALTER TABLE tasks ADD COLUMN attendees TEXT;
        "#,
    ),
    (
        6,
        r#"
        -- Rescata las reuniones que quedaron `ORPHANED` **después de haberlas
        -- trabajado**. El reconciler ya no las marca así (las suelta del feed y
        -- las deja `ACTIVE`), pero ese cambio solo afecta a las sincronizaciones
        -- futuras: su propia consulta filtra `source_state = 'ACTIVE'`, así que
        -- nunca volvería a mirar las que ya están escondidas.
        --
        -- Se sueltan del feed igual que hace el reconciler ahora: dejaron de ser
        -- del calendario cuando les pusiste tiempo o las completaste.
        UPDATE tasks
           SET source_state = 'ACTIVE',
               feed_id      = NULL,
               calendar_uid = NULL
         WHERE source_state = 'ORPHANED'
           AND (status = 'DONE'
                OR EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = tasks.id));
        "#,
    ),
    (
        7,
        r#"
        -- La bitácora (M3.6). Una fila por día, **creada solo si hay algo que
        -- guardar**: el día se llena solo desde `time_entries` y `tasks`, así
        -- que sin nota ni cierre no hace falta la fila. La bitácora se arma
        -- igual, y por eso los días viejos —anteriores a esta migración—
        -- aparecen completos sin haber pasado nunca por el shutdown.
        --
        -- `closed_at` NULL significa **borrador**: el día está en la bitácora
        -- pero nadie lo cerró con sus palabras.
        CREATE TABLE day_entries (
            date      TEXT PRIMARY KEY,
            note      TEXT,
            closed_at TEXT
        );

        -- La reflexión sobre una tarea, del día en que se trabajó.
        --
        -- No es `tasks.notes`: esas son las notas de la tarea y las escribes
        -- mientras la haces. Esto es lo que pensaste de ella **ese día**, y va
        -- con la fecha adentro porque una tarea se puede trabajar varios días y
        -- cada uno merece su línea.
        CREATE TABLE day_task_notes (
            date    TEXT NOT NULL,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            note    TEXT NOT NULL,
            PRIMARY KEY (date, task_id)
        );
        "#,
    ),
    (
        8,
        r#"
        -- Cómo estuvo el día, en un emoji. Va en `day_entries` y no en `note`
        -- porque es un dato aparte: se elige de una lista corta y se muestra al
        -- lado del nombre del día, mientras la nota es texto libre.
        --
        -- Versión nueva y no un cambio a la 7 porque **las migraciones aplicadas
        -- son inmutables**: la 7 puede haber corrido ya en la base del dev, y
        -- editarla dejaría dos esquemas distintos sin que el runner lo note
        -- (compara solo `MAX(version)`).
        ALTER TABLE day_entries ADD COLUMN mood TEXT;
        "#,
    ),
    (
        9,
        r#"
        -- Qué días de la semana se dibujan colapsados en la vista semana, como
        -- números ISO (lunes = 1 … domingo = 7). El fin de semana por defecto:
        -- ocupa dos columnas de las que casi nunca cuelga trabajo.
        --
        -- **La fila se siembra a propósito, aunque toda lectura tenga fallback.**
        -- Es lo que hace expresable "ninguno colapsado": si la ausencia de la
        -- clave y una lista vacía significaran lo mismo, destildar los siete días
        -- volvería al default y no habría forma de tener la semana completa.
        -- Ausente ⇒ el default; presente ⇒ lo que diga, incluso vacío.
        INSERT INTO settings (key, value) VALUES ('collapsed_weekdays', '6,7');
        "#,
    ),
    (
        10,
        r#"
        -- La marca del ritual diario pasó de `planned_on` (una fecha pelada) a
        -- `planned_at` (fecha y hora locales, `YYYY-MM-DDTHH:mm`). La vieja se
        -- borra en vez de renombrarse a propósito: nadie sabe con qué gesto se
        -- escribió el valor que había, y moverlo a una clave que ahora promete
        -- una hora sería inventarle una procedencia. Perderlo es justamente el
        -- resultado de "no fui yo" que el aviso ya ofrece.
        --
        -- No siembra nada: sin marca, no planificaste. Igual que antes.
        DELETE FROM settings WHERE key = 'planned_on';
        "#,
    ),
    (
        11,
        r#"
        -- El aviso de "se viene tu próxima reunión" necesita recordar que ya
        -- avisó, y tiene que sobrevivir al reinicio.
        --
        -- **Guarda la hora sobre la que avisó, no un booleano**, y esa es toda la
        -- decisión: la promesa no es "avisé una vez por esta tarea", es "avisé que
        -- empezaba a ESTA hora". Si el calendario mueve la reunión de 15:00 a
        -- 16:00 es otra promesa y hay que volver a avisar; con un flag la tarea
        -- quedaría muda para siempre. Es la misma lección que la campana, que usa
        -- (entrada, estimado) como llave y no solo la entrada.
        --
        -- Va en `tasks` y no en `settings` porque es un hecho de la tarea: una
        -- lectura, sin join, y se va con ella al borrarla. `settings` guarda UNA
        -- marca (como `planned_at`) y acá haría falta un conjunto de ids.
        --
        -- Es dato nuestro, no del feed: la sincronización del calendario NO lo
        -- pisa, igual que `status` y `actual_seconds`.
        ALTER TABLE tasks ADD COLUMN notified_for TEXT;
        "#,
    ),
    (
        12,
        r#"
        -- `bell_sound` estrena consumidor (Mej.1) y el valor sembrado en la
        -- migración 2 no significa lo que va a significar ahora.
        --
        -- Sembraba `'bell'`, que era el **tronco de archivo** que la campana
        -- buscaba en el directorio de datos: si dejabas ahí un `bell.mp3` a mano,
        -- sonaba. Con el selector de Configs el archivo lo copia la app y la clave
        -- pasa a guardar su nombre completo, así que `'bell'` quedaría nombrando un
        -- archivo que nunca existió.
        --
        -- `SUNRISE` es la campana sintetizada, que es lo que suena hoy en la
        -- práctica, así que para casi todos esto no cambia nada. Lo que sí cambia:
        -- un archivo dejado a mano en esa carpeta **deja de sonar** hasta que se
        -- elija desde Configs. Es a propósito — pedirle a alguien que copie un
        -- archivo a una ruta escondida era el diseño provisorio de cuando no había
        -- picker, y ahora tener las dos vías haría imposible volver a la campana de
        -- la app sin borrar archivos.
        UPDATE settings SET value = 'SUNRISE' WHERE key = 'bell_sound';
        "#,
    ),
    (
        13,
        r#"
        -- Los objetivos estrenan channel (Mej.15). No es un channel especial de
        -- objetivos: es la **misma** tabla `categories` que usan las tareas, así
        -- que un objetivo y las tareas que cuelgan de él pueden compartir color y
        -- contexto sin duplicar nada.
        --
        -- Nace NULL para todos los objetivos existentes, que es "sin channel":
        -- adivinarlo desde las tareas asociadas sería inventar un dato que nadie
        -- eligió.
        ALTER TABLE objectives ADD COLUMN category_id INTEGER
            REFERENCES categories(id) ON DELETE SET NULL;
        "#,
    ),
    (
        14,
        r#"
        -- **Bloques que solo ocupan la agenda.** Un "focus time" del calendario
        -- —el almuerzo, un bloque de concentración— es un espacio reservado, no
        -- trabajo. Con la marca la app lo **ignora por completo**: no es tarjeta
        -- del tablero, no suma a la carga del día, no entra a la cola de Focus,
        -- no avisa antes de empezar y no cuenta en la review. Lo único que hace
        -- es ocupar su hora en el rail, que es para lo que sirve: planificar
        -- alrededor. Sin esto, hora y cuarto de almuerzo se leían como hora y
        -- cuarto de trabajo planificado y el semáforo de capacidad mentía todos
        -- los días.
        --
        -- **Columna propia y no un `source_state`.** `ORPHANED` ya significó a la
        -- vez "no la planifiques" y "no la muestres", y desenredar esas dos
        -- costó una migración (la 6): meter acá una tercera lectura repetiría
        -- exactamente ese error.
        --
        -- Es dato **nuestro**, no del feed: el ICS de Google no distingue un
        -- focus time de una reunión cualquiera (no emite `X-GOOGLE-EVENT-TYPE`,
        -- medido sobre un feed real), así que no hay nada que importar. Por lo
        -- mismo la sincronización no lo pisa, igual que `status` o `notes`.
        ALTER TABLE tasks ADD COLUMN rail_only INTEGER NOT NULL DEFAULT 0;

        -- La marca se guarda **por serie, no por instancia**. El almuerzo es un
        -- evento semanal: con la marca en la tarea habría que volver a ponerla
        -- cada vez que entra una repetición nueva, para siempre. La clave es el
        -- UID pelado —lo que va antes del `#` en `calendar_uid`—, que es el
        -- mismo para todas las repeticiones de una serie.
        CREATE TABLE calendar_series_prefs (
            feed_id    INTEGER NOT NULL REFERENCES calendar_feeds(id) ON DELETE CASCADE,
            series_uid TEXT    NOT NULL,
            rail_only  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (feed_id, series_uid)
        );

        -- **Las tareas con hora se ordenan entre sí por hora**, de una vez para
        -- lo que ya está importado. Las reuniones entraban al final de su día y
        -- el feed las entrega en el orden que se le antoja a Google, así que la
        -- semana mostraba la agenda desordenada mientras el rail —que ordena por
        -- hora— mostraba otra cosa. De acá en adelante lo mantiene
        -- `repo::place_by_time`, que corre al importar y cuando un evento cambia
        -- de día o de hora.
        --
        -- **Las que no tienen hora no se mueven**, y eso es la mitad del punto:
        -- la columna del día es el plan del día, y el lugar de una tarea a mano
        -- entre dos reuniones lo eliges arrastrando. Lo que se hace es tomar los
        -- lugares que hoy ocupan las tareas con hora y repartirlos entre ellas en
        -- orden de reloj; los lugares de las demás quedan intactos.
        WITH base AS (
            SELECT id,
                   scheduled_date,
                   scheduled_time,
                   ROW_NUMBER() OVER (
                       PARTITION BY scheduled_date ORDER BY position, id
                   ) AS lugar
              FROM tasks
             WHERE scheduled_date IS NOT NULL
        ),
        -- Los lugares que hoy ocupan las que tienen hora, en orden.
        lugares AS (
            SELECT scheduled_date, lugar,
                   ROW_NUMBER() OVER (
                       PARTITION BY scheduled_date ORDER BY lugar
                   ) AS k
              FROM base
             WHERE scheduled_time IS NOT NULL
        ),
        -- Las que tienen hora, en orden de reloj.
        con_hora AS (
            SELECT id, scheduled_date,
                   ROW_NUMBER() OVER (
                       PARTITION BY scheduled_date ORDER BY scheduled_time, lugar
                   ) AS k
              FROM base
             WHERE scheduled_time IS NOT NULL
        ),
        nueva AS (
            SELECT b.id,
                   CASE
                       WHEN b.scheduled_time IS NULL THEN b.lugar - 1
                       ELSE (
                           SELECT l.lugar - 1
                             FROM con_hora c
                             JOIN lugares l
                               ON l.scheduled_date = c.scheduled_date AND l.k = c.k
                            WHERE c.id = b.id
                       )
                   END AS pos
              FROM base b
        )
        UPDATE tasks
           SET position = (SELECT pos FROM nueva WHERE nueva.id = tasks.id)
         WHERE scheduled_date IS NOT NULL;

        -- Y los eventos de **día completo** suben al tope de su día. Son la
        -- franja de arriba del rail, no trabajo con un lugar en el plan, así que
        -- acá no hay nada del usuario que preservar — y sin esta pasada quedaban
        -- donde estuvieran, con lo que un evento nuevo podía entrar por encima y
        -- dejar el feriado colgado en la mitad de la columna. `place_by_time`
        -- ubica los nuevos igual: arriba.
        WITH orden AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY scheduled_date
                       ORDER BY CASE
                                    WHEN feed_id IS NOT NULL AND scheduled_time IS NULL THEN 0
                                    ELSE 1
                                END,
                                position,
                                id
                   ) - 1 AS pos
              FROM tasks
             WHERE scheduled_date IS NOT NULL
        )
        UPDATE tasks
           SET position = (SELECT pos FROM orden WHERE orden.id = tasks.id)
         WHERE scheduled_date IS NOT NULL;
        "#,
    ),
    (
        15,
        r#"
        -- **Series partidas: se recorta el `_R<instante>` del `calendar_uid`.**
        --
        -- Cuando alguien edita una recurrente con "este evento y los siguientes",
        -- Google parte la serie: la vieja queda con un `UNTIL` antes del corte y
        -- aparece un UID nuevo, el mismo con un `_R<instante>` metido antes del
        -- `@`. Para la app eso era una serie nueva, así que borraba las tareas
        -- futuras y creaba otras — perdiendo lo que hubieras tocado a mano, y
        -- dejando dos tarjetas de la misma reunión si alguna tenía tiempo
        -- trackeado. `ics::base_uid` ahora normaliza el UID al interpretar el
        -- feed; esto alinea lo que ya está en la base para que la primera
        -- sincronización actualice en su lugar en vez de borrar y volver a crear.
        --
        -- El `LIKE` no alcanza para reconocer la forma exacta (8 dígitos, `T`, 6
        -- dígitos), pero sí para no tocar nada que no la tenga: los `_` del LIKE
        -- son comodines de un carácter, y el rango de posiciones lo fija el resto
        -- del patrón. Un falso positivo acá solo cuesta una sincronización que
        -- borra y recrea, que es exactamente lo que pasaba antes.
        --
        -- **`UPDATE OR IGNORE`**: si la fila normalizada ya existe (quedaron las
        -- dos, la vieja y la nueva), el `UNIQUE(feed_id, calendar_uid)` rechazaría
        -- la escritura y con `OR IGNORE` esa fila se queda como está — la próxima
        -- pasada la resuelve con las reglas del reconciler.
        -- Tres sentencias y no una, porque el sello tiene tres largos: con `Z`,
        -- sin `Z`, y solo fecha (un evento de día completo, cuyo `RECURRENCE-ID`
        -- no tiene reloj). Los patrones son excluyentes entre sí, porque cada uno
        -- fija qué carácter viene pegado al `@`.
        UPDATE OR IGNORE tasks
           SET calendar_uid =
                   substr(calendar_uid, 1, instr(calendar_uid, '_R') - 1)
                || substr(calendar_uid, instr(calendar_uid, '_R') + 17)
         WHERE calendar_uid LIKE '%\_R________T______@%' ESCAPE '\';

        UPDATE OR IGNORE tasks
           SET calendar_uid =
                   substr(calendar_uid, 1, instr(calendar_uid, '_R') - 1)
                || substr(calendar_uid, instr(calendar_uid, '_R') + 18)
         WHERE calendar_uid LIKE '%\_R________T______Z@%' ESCAPE '\';

        UPDATE OR IGNORE tasks
           SET calendar_uid =
                   substr(calendar_uid, 1, instr(calendar_uid, '_R') - 1)
                || substr(calendar_uid, instr(calendar_uid, '_R') + 10)
         WHERE calendar_uid LIKE '%\_R________@%' ESCAPE '\';
        "#,
    ),
    (
        16,
        r#"
        -- **Prioridad de la tarea: P1 (lo más urgente) a P5, o NULL.**
        --
        -- NULL y no un 'P3' de fábrica: "sin prioridad" es un estado propio y es
        -- el que tienen todas las tareas que ya existen. Sembrar un valor medio
        -- sería inventar que alguien las priorizó, y dejaría el filtro por
        -- prioridad devolviendo el backlog entero en P3.
        --
        -- TEXT y no INTEGER porque es un enum, y los enum de esta base van en
        -- MAYÚSCULAS. Además ordena igual: con un solo dígito, el orden
        -- lexicográfico de 'P1'..'P5' es el numérico.
        ALTER TABLE tasks ADD COLUMN priority TEXT;
        "#,
    ),
];

/// Aplica todas las migraciones pendientes. Idempotente.
pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS _migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )?;

    let current: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM _migrations", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);

    for (version, sql) in MIGRATIONS {
        if *version > current {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO _migrations (version) VALUES (?1)",
                [version],
            )?;
        }
    }
    Ok(())
}
