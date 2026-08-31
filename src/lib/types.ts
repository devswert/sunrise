import type { Priority, SourceState, TaskEventType, TaskSource, TaskStatus } from "./enums";

/** Categoría de 2 niveles. `parentId === null` => categoría padre (carpeta del backlog). */
export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  color: string; // token de la paleta, ej. "lavender"
  position: number;
  archived: boolean;
}

/**
 * Cuántas tareas lleva un canal. Solo vienen los que tienen al menos una, así que
 * un canal ausente de la lista es un canal que nunca se usó.
 *
 * **No incluye los eventos ignorados** (`railOnly`): un almuerzo del calendario
 * ocupa la agenda pero no es trabajo, y sin ese filtro el canal del feed sale como
 * el más usado de todos por reservas de hora.
 */
export interface CategoryUsage {
  categoryId: number;
  tasks: number;
}

/** Objetivo/ritual semanal (isoWeek ej. "2026-W32"). */
export interface Objective {
  id: number;
  isoWeek: string;
  title: string;
  position: number;
  completed: boolean;
  /** El mismo channel de las tareas (`categories`), no uno propio. */
  categoryId: number | null;
}

/**
 * Patch de edición de un objetivo (espeja `repo::ObjectivePatch`), con la misma
 * semántica de tres estados que `TaskPatch`: ausente = no tocar · `null` = poner
 * a NULL · valor = escribir.
 */
export interface ObjectivePatch {
  title?: string;
  /** Mover el objetivo a otra semana ISO. Lo reposiciona al final de la destino. */
  isoWeek?: string;
  completed?: boolean;
  categoryId?: number | null;
}

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  categoryId: number | null;
  objectiveId: number | null;
  /** `P1` (lo más urgente) a `P5`. `null` es "sin prioridad", el estado inicial. */
  priority: Priority | null;
  scheduledDate: string | null; // "YYYY-MM-DD" | null (=> backlog)
  scheduledTime: string | null; // "HH:mm" | null (=> aparece en el rail)
  position: number;
  estimatedMinutes: number | null; // "planned"
  actualSeconds: number; // acumulado por timer + edición manual
  status: TaskStatus;
  completedAt: string | null;
  source: TaskSource;
  sourceState: SourceState;
  feedId: number | null;
  calendarUid: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  /** Link de la videollamada, si el evento del calendario traía uno. */
  meetingUrl: string | null;
  /** Descripción del evento, separada de `notes` (que son del usuario). */
  eventDescription: string | null;
  /** Organizador e invitados. Vacío si el feed no los trae. */
  attendees: Attendee[];
  /**
   * **Solo ocupa la agenda**: se dibuja en el rail para planificar alrededor,
   * pero no es una tarjeta del tablero y no suma a la carga del día. Es la forma
   * de un "focus time" del calendario (el almuerzo, un bloque de concentración).
   * La marca es de la **serie**, no de la repetición.
   */
  railOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: number;
  taskId: number;
  type: TaskEventType;
  fromDate: string | null;
  toDate: string | null;
  at: string;
}

/**
 * Una tarea del backlog que **venía de un día**. Espejo de `models::Rescue`.
 * Sale del historial, así que cubre tanto la degradación diaria como los envíos
 * a mano: las dos cosas son "esto venía de un día".
 */
export interface Rescue {
  taskId: number;
  /**
   * El día del que salió.
   *
   * Se llama `fromDate` porque así lo serializa `models::Rescue` (`from_date` en
   * camelCase). Se llamó `from` un tiempo, y como el campo que llega es otro, el
   * valor era `undefined` **dentro de Tauri nada más**: el mock devolvía `from`
   * y en el browser y en los tests se veía bien.
   */
  fromDate: string;
}

/**
 * Lo que una tarea trabajó en un día: cuándo empezó y cuánto sumó.
 * Espejo de `models::DayWork`. Es lo que deja al rail dibujar lo que pasó
 * de verdad en vez de lo estimado por el calendario.
 */
export interface DayWork {
  taskId: number;
  /**
   * Cuándo corrió el taxímetro por primera vez ese día, RFC 3339 en UTC.
   *
   * `null` cuando el único tiempo del día vino de un ajuste a mano: ahí no hubo
   * hora, hubo un número. Ver `models::DayWork`.
   */
  trackedAt: string | null;
  /** Segundos del día, ajustes a mano incluidos. */
  seconds: number;
  /** Hay una corrida abierta de ese día; sus segundos no están en `seconds`. */
  running: boolean;
}

export interface TimeEntry {
  id: number;
  taskId: number;
  startedAt: string;
  endedAt: string | null;
  seconds: number;
}

/**
 * Cuánto se trabajó un día en una categoría. Espejo de `models::RollupCell`.
 * Trae el contexto ya resuelto (`parentId ?? id`) para que el donut no tenga que
 * cruzar el árbol de categorías en cada render.
 */
export interface RollupCell {
  date: string;
  categoryId: number | null;
  contextId: number | null;
  seconds: number;
}

/** Los totales de un día. Espejo de `models::RollupDay`. */
export interface RollupDay {
  date: string;
  /** Trabajado, atribuido por `startedAt` (Regla 2). */
  seconds: number;
  /** Planificado, por `scheduledDate`. La asimetría es deliberada (SPECS §4.15). */
  plannedMinutes: number;
  done: number;
  /** Tareas del día sin estimar: se avisan, no se rellenan con un número. */
  unestimated: number;
}

/** Un tramo del timeline de un día. Espejo de `models::DaySegment`. */
export interface DaySegment {
  taskId: number;
  title: string;
  seconds: number;
  /** La corrida sigue abierta: el front le suma lo del taxímetro, como el rail. */
  running: boolean;
}

/**
 * Una tarea cerrada ese día.
 *
 * `note` distingue **tres** cosas: `null` = no la incluiste en la bitácora;
 * `""` = incluida y sin resumen todavía; texto = incluida y con tus palabras.
 */
export interface DoneTask {
  task: Task;
  note: string | null;
}

/** Un día de la bitácora. Espejo de `models::LogDay`. */
export interface LogDay {
  date: string;
  /** El cierre "con mis palabras". */
  note: string | null;
  /** `null` ⇒ borrador: está en la bitácora, pero nadie lo cerró. */
  closedAt: string | null;
  /** Cómo estuvo el día, en un emoji. */
  mood: string | null;
  workedSeconds: number;
  plannedMinutes: number;
  unestimated: number;
  done: DoneTask[];
  timeline: DaySegment[];
  /** Lo trabajado por categoría, para el donut del día. */
  cells: RollupCell[];
}

/** El rollup de una semana. Espejo de `models::WeeklyRollup`. */
export interface WeeklyRollup {
  weekStart: string;
  /** Siempre 7, lunes→domingo. */
  days: RollupDay[];
  cells: RollupCell[];
  completedTasks: Task[];
  totalSeconds: number;
  plannedMinutes: number;
  unestimated: number;
  /** Del total, lo trabajado en tareas colgadas de **algún** objetivo. */
  objectiveSeconds: number;
  /** El desglose de `objectiveSeconds`, un renglón por objetivo. */
  byObjective: ObjectiveWork[];
}

/** Espeja `models::ObjectiveWork`. El objetivo puede ser de otra semana. */
export interface ObjectiveWork {
  objectiveId: number;
  seconds: number;
}

export interface CalendarFeed {
  id: number;
  name: string;
  icsUrl: string;
  defaultCategoryId: number | null;
  importAsTasks: boolean;
  pollMinutes: number;
  /** Cuándo se **intentó** la última sync, salga bien o mal. */
  lastSyncedAt: string | null;
  /** Por qué falló la última sync, o `null` si salió bien. */
  lastError: string | null;
}

/** Timer en curso (espeja models::ActiveTimer en Rust). */
export interface ActiveTimer {
  entryId: number;
  taskId: number;
  title: string;
  startedAt: string;
  /** Segundos acumulados en entradas cerradas (sin la actual). */
  baseSeconds: number;
  estimatedMinutes: number | null;
}

/** Input para crear una tarea (espeja repo::NewTask en Rust). */
export interface NewTaskInput {
  title: string;
  categoryId?: number | null;
  objectiveId?: number | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  estimatedMinutes?: number | null;
  notes?: string | null;
  priority?: Priority | null;
}

/**
 * Patch de edición (espeja repo::TaskPatch). Los campos anidados `null`
 * significan "poner a NULL"; ausencia significa "no tocar".
 */
export interface TaskPatch {
  title?: string;
  notes?: string;
  categoryId?: number | null;
  objectiveId?: number | null;
  scheduledTime?: string | null;
  estimatedMinutes?: number | null;
  actualSeconds?: number;
  priority?: Priority | null;
}

/** Un invitado a una reunión importada del calendario. Solo lectura. */
export interface Attendee {
  name: string | null;
  email: string | null;
  /** `ACCEPTED` · `DECLINED` · `TENTATIVE` · `NEEDS-ACTION`, o `null`. */
  status: string | null;
  isOrganizer: boolean;
}

/**
 * Un archivo de respaldo en la carpeta configurada (espeja
 * `models::BackupFile`).
 *
 * `createdAt` sale del **nombre** del archivo, no de su metadata: copiar o
 * sincronizar un respaldo le cambia la fecha al archivo pero no al nombre.
 */
export interface BackupFile {
  /** `sunrise-20260817-200315.zip`. */
  name: string;
  path: string;
  bytes: number;
  /** `YYYY-MM-DDTHH:MM:SS` en hora local, sin zona. */
  createdAt: string;
}

/**
 * Resultado de restaurar un respaldo (espeja `models::RestoreResult`).
 *
 * Trae lo justo para cerrar una acción irreversible: qué momento quedó vivo, con
 * qué datos, y cómo deshacerlo.
 */
export interface RestoreResult {
  from: string;
  /** Dónde quedó la copia de la base que se pisó. Es el deshacer. */
  backupCopy: string;
  /** Momento del snapshot según el manifest, **con offset de zona**. */
  createdAt: string | null;
  /** Versión de la app que escribió el respaldo, si el manifest la trae. */
  backupVersion: string | null;
  /** La de esta app. Solo se muestra cuando difiere de la del respaldo. */
  currentVersion: string;
  /** Tareas vivas en la base restaurada. */
  tasks: number;
  /** Lo último trabajado según la base restaurada (RFC3339 en UTC). */
  lastActivity: string | null;
}

/**
 * Profile de compilación de esta ventana. Espejo de `models::Profile`.
 *
 * Dev y producción comparten el directorio de datos y se separan por el nombre del
 * archivo SQLite, así que las dos pueden estar abiertas a la vez con datos
 * distintos y el mismo aspecto. Ver `lib/perfil.ts` y SPECS §4.20.
 */
export interface Profile {
  /** `true` en `pnpm tauri dev` (y en un `tauri build --debug`). */
  dev: boolean;
  /** Nombre del archivo SQLite en uso. */
  dbFile: string;
}

/**
 * Una versión nueva disponible. Espejo de `models::AppUpdate`.
 *
 * `null` en vez de esta interfaz significa "estás al día", que es el caso normal.
 */
export interface AppUpdate {
  /** La versión publicada (`0.2.0`). */
  version: string;
  /** La que está corriendo ahora, para poder mostrar las dos juntas. */
  currentVersion: string;
  /** Cuerpo del Release. Es markdown escrito a mano por quien publicó. */
  notes: string | null;
  /** Día de publicación (`2026-08-17`), o `null` si el `latest.json` no lo trae. */
  date: string | null;
}

/**
 * Avance de la descarga del paquete de actualización. Espejo de
 * `update::UpdateProgress`, y llega por el evento `sunrise://update-progress`, no
 * por un comando: es Rust el que habla primero.
 */
export interface UpdateProgress {
  /** Bytes bajados hasta ahora. */
  downloaded: number;
  /**
   * Tamaño total, o `null` si el servidor no manda `Content-Length`. Sin total la
   * barra va indeterminada: no hay porcentaje que mostrar y un cero sería mentira.
   */
  total: number | null;
  /**
   * La descarga terminó y está reemplazando el `.app`. Ese tramo no reporta
   * avance, así que la barra deja de medir y el texto lo dice.
   */
  installing: boolean;
}

/**
 * A dónde lleva un aviso del sistema al accionarlo. Espeja `NoticeTarget` en
 * `commands.rs`.
 *
 * Es una ruta y no solo un id porque los tres avisos van a lugares distintos: la
 * reunión y la campana a Focus con su tarea, el cierre del día al shutdown, que no
 * tiene tarea.
 */
export interface NoticeTarget {
  route: string;
  taskId?: number | null;
}
