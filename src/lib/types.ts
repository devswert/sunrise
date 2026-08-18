import type { SourceState, TaskEventType, TaskSource, TaskStatus } from "./enums";

/** Categoría de 2 niveles. `parentId === null` => categoría padre (carpeta del backlog). */
export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  color: string; // token de la paleta, ej. "lavender"
  position: number;
  archived: boolean;
}

/** Objetivo/ritual semanal (isoWeek ej. "2026-W32"). */
export interface Objective {
  id: number;
  isoWeek: string;
  title: string;
  position: number;
  completed: boolean;
}

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  categoryId: number | null;
  objectiveId: number | null;
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
  attendees: Participante[];
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
 * Una tarea del backlog que **venía de un día**. Espejo de `models::Rescate`.
 * Sale del historial, así que cubre tanto la degradación diaria como los envíos
 * a mano: las dos cosas son "esto venía de un día".
 */
export interface Rescate {
  taskId: number;
  /** El día del que salió. */
  desde: string;
}

/**
 * Lo que una tarea trabajó en un día: cuándo empezó y cuánto sumó.
 * Espejo de `models::TrabajoDelDia`. Es lo que deja al rail dibujar lo que pasó
 * de verdad en vez de lo estimado por el calendario.
 */
export interface TrabajoDelDia {
  taskId: number;
  /** Primer `startedAt` del día, RFC 3339 en UTC. */
  startedAt: string;
  /** Segundos de las entradas **cerradas** de ese día. */
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
 * Cuánto se trabajó un día en una categoría. Espejo de `models::RollupCelda`.
 * Trae el contexto ya resuelto (`parentId ?? id`) para que el donut no tenga que
 * cruzar el árbol de categorías en cada render.
 */
export interface RollupCelda {
  date: string;
  categoryId: number | null;
  contextId: number | null;
  seconds: number;
}

/** Los totales de un día. Espejo de `models::RollupDia`. */
export interface RollupDia {
  date: string;
  /** Trabajado, atribuido por `startedAt` (Regla 2). */
  seconds: number;
  /** Planificado, por `scheduledDate`. La asimetría es deliberada (SPECS §4.15). */
  plannedMinutes: number;
  hechas: number;
  /** Tareas del día sin estimar: se avisan, no se rellenan con un número. */
  sinEstimar: number;
}

/** Un tramo del timeline de un día. Espejo de `models::TramoDelDia`. */
export interface TramoDelDia {
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
export interface HechaDelDia {
  task: Task;
  note: string | null;
}

/** Un día de la bitácora. Espejo de `models::DiaDeBitacora`. */
export interface DiaDeBitacora {
  date: string;
  /** El cierre "con mis palabras". */
  note: string | null;
  /** `null` ⇒ borrador: está en la bitácora, pero nadie lo cerró. */
  closedAt: string | null;
  /** Cómo estuvo el día, en un emoji. */
  mood: string | null;
  workedSeconds: number;
  plannedMinutes: number;
  sinEstimar: number;
  hechas: HechaDelDia[];
  timeline: TramoDelDia[];
  /** Lo trabajado por categoría, para el donut del día. */
  celdas: RollupCelda[];
}

/** El rollup de una semana. Espejo de `models::WeeklyRollup`. */
export interface WeeklyRollup {
  weekStart: string;
  /** Siempre 7, lunes→domingo. */
  dias: RollupDia[];
  celdas: RollupCelda[];
  completadas: Task[];
  totalSeconds: number;
  plannedMinutes: number;
  sinEstimar: number;
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
}

/** Un invitado a una reunión importada del calendario. Solo lectura. */
export interface Participante {
  nombre: string | null;
  email: string | null;
  /** `ACCEPTED` · `DECLINED` · `TENTATIVE` · `NEEDS-ACTION`, o `null`. */
  estado: string | null;
  organizador: boolean;
}

/**
 * Un archivo de respaldo en la carpeta configurada (espeja
 * `models::ArchivoDeBackup`).
 *
 * `createdAt` sale del **nombre** del archivo, no de su metadata: copiar o
 * sincronizar un respaldo le cambia la fecha al archivo pero no al nombre.
 */
export interface ArchivoDeBackup {
  /** `sunrise-20260817-200315.zip`. */
  name: string;
  path: string;
  bytes: number;
  /** `YYYY-MM-DDTHH:MM:SS` en hora local, sin zona. */
  createdAt: string;
}

/**
 * Resultado de restaurar un respaldo (espeja `models::Restauracion`).
 *
 * Trae lo justo para cerrar una acción irreversible: qué momento quedó vivo, con
 * qué datos, y cómo deshacerlo.
 */
export interface Restauracion {
  desde: string;
  /** Dónde quedó la copia de la base que se pisó. Es el deshacer. */
  copiaDeSeguridad: string;
  /** Momento del snapshot según el manifest, **con offset de zona**. */
  creadoEn: string | null;
  /** Versión de la app que escribió el respaldo, si el manifest la trae. */
  versionDelRespaldo: string | null;
  /** La de esta app. Solo se muestra cuando difiere de la del respaldo. */
  versionActual: string;
  /** Tareas vivas en la base restaurada. */
  tareas: number;
  /** Lo último trabajado según la base restaurada (RFC3339 en UTC). */
  ultimaActividad: string | null;
}

/**
 * Perfil de compilación de esta ventana. Espejo de `models::Perfil`.
 *
 * Dev y producción comparten el directorio de datos y se separan por el nombre del
 * archivo SQLite, así que las dos pueden estar abiertas a la vez con datos
 * distintos y el mismo aspecto. Ver `lib/perfil.ts` y SPECS §4.20.
 */
export interface Perfil {
  /** `true` en `pnpm tauri dev` (y en un `tauri build --debug`). */
  dev: boolean;
  /** Nombre del archivo SQLite en uso. */
  base: string;
}
