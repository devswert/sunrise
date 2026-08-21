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
