/**
 * Cliente IPC tipado. Dentro de Tauri llama a los comandos Rust vía `invoke`;
 * fuera de Tauri (preview en browser / tests) delega en el mock in-memory.
 */
import type {
  ActiveTimer,
  Rescue,
  CalendarFeed,
  Category,
  Objective,
  Task,
  TaskEvent,
  TimeEntry,
  DayWork,
  WeeklyRollup,
  LogDay,
  BackupFile,
  RestoreResult,
  AppUpdate,
  Profile,
  NewTaskInput,
  TaskPatch,
} from "./types";
import { mock } from "./mockDb";
import type { NoticeTarget } from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const api = {
  ping: () => (isTauri() ? invoke<string>("ping") : mock.ping()),

  // --- tasks ---
  createTask: (input: NewTaskInput) =>
    isTauri() ? invoke<Task>("create_task", { input }) : mock.createTask(input),

  updateTask: (id: number, patch: TaskPatch) =>
    isTauri() ? invoke<Task | null>("update_task", { id, patch }) : mock.updateTask(id, patch),

  deleteTask: (id: number) =>
    isTauri() ? invoke<void>("delete_task", { id }) : mock.deleteTask(id),

  setTaskStatus: (id: number, status: Task["status"]) =>
    isTauri()
      ? invoke<Task | null>("set_task_status", { id, status })
      : mock.setTaskStatus(id, status),

  moveTask: (id: number, date: string | null, position: number) =>
    isTauri()
      ? invoke<Task | null>("move_task", { id, date, position })
      : mock.moveTask(id, date, position),

  demotePending: (today: string) =>
    isTauri()
      ? invoke<number>("demote_pending", { today })
      : mock.demotePending(today),

  listTasksForRange: (start: string, end: string) =>
    isTauri()
      ? invoke<Task[]>("list_tasks_for_range", { start, end })
      : mock.listTasksForRange(start, end),

  listTasksForDate: (date: string) =>
    isTauri() ? invoke<Task[]>("list_tasks_for_date", { date }) : mock.listTasksForDate(date),

  listBacklog: () => (isTauri() ? invoke<Task[]>("list_backlog") : mock.listBacklog()),

  setActualSeconds: (taskId: number, seconds: number) =>
    isTauri()
      ? invoke<Task | null>("set_actual_seconds", { taskId, seconds })
      : mock.setActualSeconds(taskId, seconds),

  getTask: (id: number) => (isTauri() ? invoke<Task | null>("get_task", { id }) : mock.getTask(id)),

  /**
   * Copia el audio elegido a la carpeta de la app y devuelve su nombre, que es lo
   * que se guarda en `bell_sound`. **Falla si rodio no puede decodificarlo**, y ese
   * error es el punto: `play_bell` cae a la síntesis en silencio, así que un archivo
   * roto se viviría como "elegí mi mp3 y sigue sonando el de la app".
   *
   * La clave del argumento es el parámetro de Rust en camelCase (`path`).
   */
  installBellFile: (path: string) =>
    isTauri() ? invoke<string>("install_bell_file", { path }) : mock.installBellFile(path),

  /** Toca la campana que esté elegida (el botón de probar de Apariencia). */
  playBell: () => (isTauri() ? invoke<void>("play_bell") : mock.playBell()),

  /** Muestra/oculta el taxímetro (lo resuelve Rust). */
  setTaximeterVisible: (visible: boolean, pos?: { x: number; y: number } | null) =>
    isTauri()
      ? invoke<boolean>("set_taximeter_visible", {
          visible,
          x: pos?.x ?? null,
          y: pos?.y ?? null,
        })
      : Promise.resolve(false),

  listTaskEvents: (taskId: number) =>
    isTauri() ? invoke<TaskEvent[]>("list_task_events", { taskId }) : mock.listTaskEvents(taskId),

  rescuedFromBacklog: () =>
    isTauri() ? invoke<Rescue[]>("rescued_from_backlog") : mock.rescuedFromBacklog(),

  // --- timer / focus ---
  startTimer: (taskId: number) =>
    isTauri() ? invoke<ActiveTimer>("start_timer", { taskId }) : mock.startTimer(taskId),

  stopTimer: () => (isTauri() ? invoke<[number, number] | null>("stop_timer") : mock.stopTimer()),

  getActiveTimer: () =>
    isTauri() ? invoke<ActiveTimer | null>("get_active_timer") : mock.getActiveTimer(),

  listTimeEntries: (taskId: number) =>
    isTauri() ? invoke<TimeEntry[]>("list_time_entries", { taskId }) : mock.listTimeEntries(taskId),

  dayWork: (date: string) =>
    isTauri() ? invoke<DayWork[]>("day_work", { date }) : mock.dayWork(date),

  /** El rollup de la semana ISO que arranca en `weekStart` (lunes). */
  weeklyRollup: (weekStart: string) =>
    isTauri()
      ? invoke<WeeklyRollup>("weekly_rollup", { weekStart })
      : mock.weeklyRollup(weekStart),

  /**
   * Los `days` días que terminan en `toDate`, del más nuevo al más viejo.
   *
   * `toDate` y no `to`: la clave del `invoke` es el nombre del parámetro de Rust
   * en camelCase, no el del argumento de acá. Con la clave equivocada Tauri
   * rechaza la llamada entera, y ninguna de las dos suites lo ve porque las dos
   * corren contra `mockDb`, que recibe posicional.
   */
  dailyLog: (toDate: string, days: number) =>
    isTauri()
      ? invoke<LogDay[]>("daily_log", { toDate, days })
      : mock.dailyLog(toDate, days),

  /** Escribe (o borra) la reflexión del día. **No lo cierra.** */
  setDayNote: (date: string, note: string | null) =>
    isTauri() ? invoke<void>("set_day_note", { date, note }) : mock.setDayNote(date, note),

  setDayTaskNote: (date: string, taskId: number, note: string) =>
    isTauri()
      ? invoke<void>("set_day_task_note", { date, taskId, note })
      : mock.setDayTaskNote(date, taskId, note),

  /** Cómo estuvo el día, en un emoji. `null` lo borra. */
  setDayMood: (date: string, mood: string | null) =>
    isTauri() ? invoke<void>("set_day_mood", { date, mood }) : mock.setDayMood(date, mood),

  /** Sube una tarea a la bitácora del día, sin resumen todavía. */
  includeInLog: (date: string, taskId: number) =>
    isTauri()
      ? invoke<void>("include_in_log", { date, taskId })
      : mock.includeInLog(date, taskId),

  removeFromLog: (date: string, taskId: number) =>
    isTauri()
      ? invoke<void>("remove_from_log", { date, taskId })
      : mock.removeFromLog(date, taskId),

  /** Marca el día como cerrado por ti. Devuelve el `closedAt`. */
  closeDay: (date: string) =>
    isTauri() ? invoke<string>("close_day", { date }) : mock.closeDay(date),

  reopenDay: (date: string) =>
    isTauri() ? invoke<void>("reopen_day", { date }) : mock.reopenDay(date),

  focusQueue: (date: string, nowHhmm: string) =>
    isTauri() ? invoke<Task[]>("focus_queue", { date, nowHhmm }) : mock.focusQueue(date, nowHhmm),


  /**
   * Un aviso del sistema **con botón**, que en macOS es lo que lo vuelve una
   * alerta: queda en pantalla hasta que la saques o la acciones. No devuelve qué
   * apretó el usuario —esperarlo bloquearía— : eso llega por el evento
   * `sunrise://notification-action`. El resto de los avisos los manda el plugin
   * de notificaciones desde el front (`features/notifications/notify.ts`).
   */
  notifyAlert: (
    title: string,
    body: string,
    action: string,
    /** `null` = alerta muda (la de la campana). Ver `NoticeCopy.silent`. */
    sound: string | null,
    target: NoticeTarget | null = null,
  ) =>
    isTauri()
      ? invoke<void>("notify_alert", { title, body, action, sound, target })
      : mock.notifyAlert(title, body, action, sound, target),

  /**
   * El texto del aviso de próxima reunión, tal como lo manda Rust.
   *
   * Existe para que el botón de prueba de Dev Tools mande **el de verdad**: el
   * texto vive en `notice::copy` porque el que lo manda es el vigilante, y una
   * copia en el front acabaría probando un aviso que no existe.
   */
  previewMeetingNotice: (title: string, time: string) =>
    isTauri()
      ? invoke<{ title: string; body: string; action: string; silent: boolean }>("preview_meeting_notice", {
          title,
          time,
        })
      : mock.previewMeetingNotice(title, time),

  /** Lo mismo para el de la campana, que también lo manda Rust (`bell::copy`). */
  previewBellNotice: (title: string, minutes: number) =>
    isTauri()
      ? invoke<{ title: string; body: string; action: string; silent: boolean }>("preview_bell_notice", {
          title,
          minutes,
        })
      : mock.previewBellNotice(title, minutes),

  /** Los sonidos que macOS puede tocar, del sistema y de `~/Library/Sounds`. */
  noticeSounds: () => (isTauri() ? invoke<string[]>("notice_sounds") : mock.noticeSounds()),

  /**
   * Toca un sonido de aviso para oírlo antes de elegirlo. Va por `afplay` en Rust:
   * los del sistema son `.aiff` y rodio no los decodifica.
   */
  previewNoticeSound: (name: string) =>
    isTauri() ? invoke<void>("preview_notice_sound", { name }) : mock.previewNoticeSound(name),

  /** Las tipografías instaladas en el sistema, ya filtradas (`fonts.rs`). */
  systemFonts: () => (isTauri() ? invoke<string[]>("system_fonts") : mock.systemFonts()),

  /** Borra la copia de la campana propia (al volver a la de sunrise). */
  clearBellFile: () => (isTauri() ? invoke<void>("clear_bell_file") : mock.clearBellFile()),

  /**
   * Con qué identidad salen los avisos (`app.sunrise.desktop`, o la Terminal si
   * la app no está instalada). En dev explica por qué un aviso se queda o no: los
   * ajustes de notificación que manda son los de **esa** app.
   */
  notificationIdentity: () =>
    isTauri() ? invoke<string>("notification_identity") : mock.notificationIdentity(),

  /**
   * Abre el panel de Notificaciones de Ajustes del sistema, que es el único lugar
   * donde se decide si un aviso se queda en pantalla. Va por Rust y no por el
   * plugin `opener` del front: sumarle el esquema `x-apple.systempreferences:` a
   * las capabilities dejó la app sin avisos (SPECS §4.25).
   */
  openNotificationSettings: () =>
    isTauri()
      ? invoke<void>("open_notification_settings")
      : mock.openNotificationSettings(),

  // --- categories ---
  listCategories: () => (isTauri() ? invoke<Category[]>("list_categories") : mock.listCategories()),

  createCategory: (parentId: number | null, name: string, color: string) =>
    isTauri()
      ? invoke<Category>("create_category", { parentId, name, color })
      : mock.createCategory(parentId, name, color),

  updateCategory: (id: number, name: string, color: string) =>
    isTauri()
      ? invoke<void>("update_category", { id, name, color })
      : mock.updateCategory(id, name, color),

  deleteCategory: (id: number) =>
    isTauri() ? invoke<void>("delete_category", { id }) : mock.deleteCategory(id),

  // --- objectives ---
  listObjectives: (isoWeek: string) =>
    isTauri() ? invoke<Objective[]>("list_objectives", { isoWeek }) : mock.listObjectives(isoWeek),

  createObjective: (isoWeek: string, title: string) =>
    isTauri()
      ? invoke<Objective>("create_objective", { isoWeek, title })
      : mock.createObjective(isoWeek, title),

  updateObjective: (id: number, title?: string, completed?: boolean) =>
    isTauri()
      ? invoke<void>("update_objective", { id, title, completed })
      : mock.updateObjective(id, title, completed),

  deleteObjective: (id: number) =>
    isTauri() ? invoke<void>("delete_objective", { id }) : mock.deleteObjective(id),

  // --- settings ---
  listSettings: () =>
    isTauri() ? invoke<Array<[string, string]>>("list_settings") : mock.listSettings(),

  setSetting: (key: string, value: string) =>
    isTauri() ? invoke<void>("set_setting", { key, value }) : mock.setSetting(key, value),

  /**
   * Inicio automático con el sistema. **No pasa por la tabla `settings`**: la
   * verdad la tiene el sistema operativo, que lo puede apagar por su cuenta
   * (ver el comentario en `commands.rs`). Por eso se lee preguntándole a él y no
   * desde `useSettingsStore`.
   */
  autostartEnabled: () =>
    isTauri() ? invoke<boolean>("autostart_enabled") : mock.autostartEnabled(),

  setAutostart: (enabled: boolean) =>
    isTauri() ? invoke<void>("set_autostart", { enabled }) : mock.setAutostart(enabled),

  // --- respaldos ---

  /** Versión de la app, fijada al compilar (la misma del `.dmg`). */
  appVersion: () => (isTauri() ? invoke<string>("app_version") : mock.appVersion()),

  /**
   * Profile de esta ventana y el archivo de base que usa. No se llama directo
   * desde los componentes: pasa por `useProfile()`, que lo cachea por sesión.
   */
  profile: () => (isTauri() ? invoke<Profile>("profile") : mock.profile()),

  createBackup: () =>
    isTauri() ? invoke<BackupFile>("create_backup") : mock.createBackup(),

  /** Falla si no se puede escribir ahí. Se llama al guardar la carpeta. */
  testBackupDir: (dir: string) =>
    isTauri() ? invoke<void>("test_backup_dir", { dir }) : mock.testBackupDir(dir),

  listBackups: () =>
    isTauri() ? invoke<BackupFile[]>("list_backups") : mock.listBackups(),

  restoreBackup: (zipPath: string) =>
    isTauri()
      ? invoke<RestoreResult>("restore_backup", { zipPath })
      : mock.restoreBackup(zipPath),

  // --- feeds de calendario ---
  listCalendarFeeds: () =>
    isTauri() ? invoke<CalendarFeed[]>("list_calendar_feeds") : mock.listCalendarFeeds(),

  createCalendarFeed: (
    name: string,
    icsUrl: string,
    defaultCategoryId: number | null,
    pollMinutes: number,
  ) =>
    isTauri()
      ? invoke<CalendarFeed>("create_calendar_feed", {
          name,
          icsUrl,
          defaultCategoryId,
          pollMinutes,
        })
      : mock.createCalendarFeed(name, icsUrl, defaultCategoryId, pollMinutes),

  updateCalendarFeed: (
    id: number,
    name: string,
    icsUrl: string,
    defaultCategoryId: number | null,
    importAsTasks: boolean,
    pollMinutes: number,
  ) =>
    isTauri()
      ? invoke<CalendarFeed | null>("update_calendar_feed", {
          id,
          name,
          icsUrl,
          defaultCategoryId,
          importAsTasks,
          pollMinutes,
        })
      : mock.updateCalendarFeed(id, name, icsUrl, defaultCategoryId, importAsTasks, pollMinutes),

  deleteCalendarFeed: (id: number) =>
    isTauri() ? invoke<void>("delete_calendar_feed", { id }) : mock.deleteCalendarFeed(id),

  /** Sincroniza un feed ahora. Devuelve cuántos eventos entraron. */
  syncCalendarFeed: (id: number) =>
    isTauri() ? invoke<number>("sync_calendar_feed", { id }) : mock.syncCalendarFeed(id),

  /** Sincroniza todos; con `forzar` sin mirar el intervalo de cada uno. */
  syncCalendarFeeds: (force = false) =>
    isTauri() ? invoke<number>("sync_calendar_feeds", { force }) : mock.syncCalendarFeeds(force),

  // --- actualizaciones ---
  /**
   * Busca versión nueva. `null` = estás al día. Fuera de Tauri nunca hay: el
   * updater actualiza un `.app` instalado, y en el browser no existe tal cosa.
   *
   * **Puede fallar** sin que nada esté roto: sin red, o antes de que exista el
   * primer Release, la consulta al `latest.json` no llega. Quien la llame tiene
   * que decirlo como información, no como error.
   */
  checkForUpdate: () =>
    isTauri() ? invoke<AppUpdate | null>("check_for_update") : mock.checkForUpdate(),

  /** Descarga, instala y **reinicia la app**. No devuelve si sale bien. */
  installUpdate: () =>
    isTauri() ? invoke<void>("install_update") : mock.installUpdate(),

  // --- ciclo de vida ---
  /** Detiene el timer y cierra la app. Fuera de Tauri no hay nada que cerrar. */
  confirmQuit: () => (isTauri() ? invoke<void>("confirm_quit") : mock.confirmQuit()),
};

export type Api = typeof api;
