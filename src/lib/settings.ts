import { useEffect } from "react";
import { create } from "zustand";
import { api } from "./ipc";
import { FontChoice, SUNRISE_BELL } from "./enums";
import { useAppStore } from "./store";
import { setZone } from "./date";

/**
 * Ajustes de la app, respaldados en la tabla `settings`.
 *
 * En SQLite son pares de TEXT: la interpretación (y el default) vive acá, no en
 * la DB. Los valores pueden faltar, venir vacíos o traer basura editada a mano,
 * así que **cada lectura pasa por un parser con fallback**. Un `NaN` suelto en
 * el semáforo de capacidad no falla ruidosamente: todas las comparaciones con
 * `NaN` dan false y el semáforo se quedaría en OK para siempre.
 */

export const SettingKey = {
  DAILY_CAPACITY_MINUTES: "daily_capacity_minutes",
  CAPACITY_WARN_RATIO: "capacity_warn_ratio",
  BELL_SOUND: "bell_sound",
  WORK_START: "work_start",
  WORK_END: "work_end",
  PLANNED_AT: "planned_at",
  COLLAPSED_WEEKDAYS: "collapsed_weekdays",
  SHUTDOWN_NOTIFIED_ON: "shutdown_notified_on",
  // Respaldo. `BACKUP_DIR` y `BACKUP_KEEP` los lee **también Rust**
  // (`commands.rs`): si cambian de nombre, cambian en los dos lados.
  BACKUP_DIR: "backup_dir",
  BACKUP_TIME: "backup_time",
  BACKUP_KEEP: "backup_keep",
  BACKUP_RAN_ON: "backup_ran_on",
  BACKUP_LAST_ERROR: "backup_last_error",
  // Notificaciones. `NOTICE_MEETING_MINUTES` la lee **también Rust**
  // (`notice.rs`), que es quien manda ese aviso.
  NOTICE_MEETING_MINUTES: "notice_meeting_minutes",
  NOTICE_BELL: "notice_bell",
  NOTICE_SHUTDOWN: "notice_shutdown",
  // Este también lo lee Rust (`commands::notice_sound`): los tres avisos que
  // manda —campana, reunión, cierre— tienen que sonar igual que el de prueba.
  NOTICE_SOUND: "notice_sound",
  // Apariencia. `BELL_SOUND` la lee **Rust** (`commands::bell_choice`), que es
  // quien toca la campana; acá solo se elige.
  FONT_TITLE: "font_title",
  FONT_BODY: "font_body",
  /** El interruptor general de prioridades. Solo lo lee el front. */
  PRIORITIES_ENABLED: "priorities_enabled",
  /**
   * La zona en la que se vive el día, como nombre IANA (`America/Santiago`).
   * **La lee también Rust** (`repo::zone`), que es quien decide dónde empieza y
   * termina cada día en la base. Vacía o ausente = la del sistema.
   */
  TIMEZONE: "timezone",
} as const;
export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

/**
 * Los cuatro primeros coinciden con los que siembra la migración 2. Los de
 * respaldo **no se siembran** —como `planned_at`— porque no hay valor de fábrica
 * razonable para una carpeta: mientras esté vacía, el respaldo está apagado.
 *
 * `backupKeep` espeja `BACKUP_KEEP_DEFAULT` en `commands.rs`: Rust es quien
 * poda, así que el número tiene que ser el mismo o la vista mentiría sobre
 * cuántos se conservan. Son **dos** por defecto: la base es chica y lo que
 * protege un respaldo es "ayer andaba", no tener un mes de historia.
 */
export const SETTING_DEFAULTS = {
  dailyCapacityMinutes: 480, // 8h
  capacityWarnRatio: 0.85,
  workStart: "09:00",
  workEnd: "18:00",
  backupTime: "20:00",
  backupKeep: 2,
  /** El fin de semana, en números ISO. Espeja la migración 9. */
  collapsedWeekdays: [6, 7] as readonly number[],
  /** Minutos de adelanto del aviso de próxima reunión. **0 apaga el aviso.**
   *  Espeja `notice::DEFAULT_LEAD`: Rust es quien manda ese aviso. */
  noticeMeetingMinutes: 5,
  /** El sonido de los avisos. Espeja `commands::DEFAULT_SOUND`, y es el mismo
   *  valor que `DEFAULT_SOUND` en `notify.ts` — de ahí lo toma el selector. */
  noticeSound: "Blow",
  /** La campana de la app. Espeja `sound::SUNRISE_BELL` y la migración 12. */
  bellSound: SUNRISE_BELL,
  /** Las fuentes empaquetadas, que es lo que se ve desde siempre. */
  font: FontChoice.SUNRISE,
} as const;

export type SettingsMap = Record<string, string>;

/**
 * La zona elegida, o `null` si no hay ninguna y manda la del sistema.
 *
 * **No la siembra ninguna migración, y es a propósito**: ausente significa "la del
 * sistema", así que el ajuste arranca siendo un no-op y no hay datos que convertir.
 * Un valor que `Intl` no reconoce también cae a `null` en vez de romper: un ajuste
 * corrupto no debe dejar la app sin "hoy".
 */
export function timezone(values: SettingsMap): string | null {
  const raw = values[SettingKey.TIMEZONE]?.trim();
  if (!raw) return null;
  // **Solo nombres IANA, y el motivo es la otra punta del puente.** `Intl` acepta
  // también un desplazamiento fijo (`-04:00`), pero `chrono_tz` en Rust no lo
  // parsea: aceptarlo acá dejaría al front leyendo el día en −04:00 y a la base
  // agrupándolo en la zona del sistema. Dos "hoy" distintos en la misma app es
  // exactamente el problema que este ajuste viene a cerrar.
  if (raw !== "UTC" && !raw.includes("/")) return null;
  try {
    // La forma barata de preguntarle a la plataforma si conoce la zona: construir
    // el formateador tira `RangeError` con un nombre inválido.
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

/** Número finito, o el default. Cubre clave ausente, vacía o no numérica. */
function num(values: SettingsMap, key: string, fallback: number): number {
  const raw = values[key];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Minutos de capacidad diaria. `<= 0` es válido: significa "sin objetivo". */
export function dailyCapacityMinutes(values: SettingsMap): number {
  return num(values, SettingKey.DAILY_CAPACITY_MINUTES, SETTING_DEFAULTS.dailyCapacityMinutes);
}

/**
 * Fracción del objetivo a partir de la cual el semáforo pasa a amarillo.
 * Se acota a (0, 1]: fuera de ese rango el semáforo dejaría de tener sentido
 * (con 0 todo sería WARN; con 2 nunca lo sería).
 */
export function capacityWarnRatio(values: SettingsMap): number {
  const n = num(values, SettingKey.CAPACITY_WARN_RATIO, SETTING_DEFAULTS.capacityWarnRatio);
  if (n <= 0 || n > 1) return SETTING_DEFAULTS.capacityWarnRatio;
  return n;
}

/** `"HH:mm"`, o el default. Cubre clave ausente, vacía o con basura. */
function hour(values: SettingsMap, key: string, fallback: string): string {
  const raw = values[key]?.trim();
  if (!raw) return fallback;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return fallback;
  return raw;
}

/**
 * La jornada, para la grilla del rail de calendario.
 *
 * Si el fin no es posterior al inicio se vuelve a los defaults: al revés el rail
 * tendría altura cero y se vería vacío sin explicar por qué. El rango no recorta
 * nada — una reunión a las 7:30 estira la grilla (ver `railLayout.ts`).
 */
export function workHours(values: SettingsMap): { start: string; end: string } {
  const start = hour(values, SettingKey.WORK_START, SETTING_DEFAULTS.workStart);
  const end = hour(values, SettingKey.WORK_END, SETTING_DEFAULTS.workEnd);
  if (end <= start) return { start: SETTING_DEFAULTS.workStart, end: SETTING_DEFAULTS.workEnd };
  return { start, end };
}

/** Cuándo se cerró el ritual. `time` en `null` = la marca no trae hora. */
export interface PlanMark {
  date: string;
  time: string | null;
}

/**
 * Cuándo se cerró el ritual de planificación diaria, según `planned_at`.
 *
 * `planned_at` **no la siembra ninguna migración**, y está bien: `set_setting`
 * es un upsert y toda lectura de esta tabla tiene fallback. Guarda **una** marca,
 * no un historial: la pregunta es "¿ya planifiqué hoy?", y llevar el registro de
 * qué días planificaste es materia de la review, no de un ajuste.
 *
 * Guarda fecha **y hora** (`'YYYY-MM-DDTHH:mm'`, hora local) porque con la fecha
 * pelada la app hacía una afirmación que no se podía desmentir: un ritual cerrado
 * a las 00:20 marca el día que recién empieza, y el aviso no tenía con qué
 * decirlo. Con la hora, el próximo reporte se diagnostica leyendo el diálogo.
 *
 * **La hora se parsea aparte y el string nunca va a `new Date()`.** Una fecha
 * pelada (`'2026-08-21'`) la interpreta como medianoche **UTC**, así que en
 * Santiago se leería como el día anterior a las 20:00 — justo el error que esto
 * viene a arreglar. Y por eso mismo la hora es opcional en la lectura: una marca
 * vieja o editada a mano sigue valiendo como "ese día", sin inventarle una hora.
 */
export function planMark(values: SettingsMap): PlanMark | null {
  const raw = values[SettingKey.PLANNED_AT]?.trim();
  if (!raw) return null;
  const [date, rest] = raw.split("T");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(rest ?? "");
  const valid = m != null && Number(m[1]) <= 23 && Number(m[2]) <= 59;
  return { date, time: valid ? `${m[1].padStart(2, "0")}:${m[2]}` : null };
}

/**
 * Qué días de la semana se dibujan colapsados, como números ISO (lunes = 1 …
 * domingo = 7).
 *
 * **La clave ausente y la lista vacía no significan lo mismo**, y es la única
 * lectura de este módulo donde eso pasa: ausente es "nunca se configuró" y toma
 * el default (el fin de semana), mientras un valor presente y vacío es
 * "ninguno colapsado", que es una elección legítima. Si las dos cayeran al
 * default, destildar los siete días rebotaría a sábado y domingo y la semana
 * completa sería inexpresable. Por eso la migración 9 siembra la fila.
 *
 * Basura tolerada como basura: se queda con los números 1..7 y descarta el
 * resto, sin volver al default. Un `"6,ocho"` editado a mano colapsa el sábado y
 * no promete nada sobre lo que no entendió.
 */
export function collapsedWeekdays(values: SettingsMap): number[] {
  const raw = values[SettingKey.COLLAPSED_WEEKDAYS];
  if (raw == null) return [...SETTING_DEFAULTS.collapsedWeekdays];
  const days = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Los ajustes de respaldo, ya interpretados. */
export interface AjustesDeRespaldo {
  /** Carpeta destino, o `""` si no hay: **carpeta vacía = respaldo apagado**. */
  dir: string;
  /** `HH:mm` local a la que corre el respaldo automático. */
  hour: string;
  /** Cuántos respaldos se conservan. Nunca menor que 1. */
  keep: number;
  /** Si hay carpeta configurada, y por lo tanto respaldo automático. */
  active: boolean;
}

/**
 * Lee la sección de respaldo con sus fallbacks.
 *
 * `conservar` se acota a `>= 1`: un 0 (o un negativo escrito a mano) significaría
 * "no conserves ninguno", y eso no puede ser una forma de pedir que se borren
 * todos los respaldos por un ajuste mal tipeado. Rust hace lo mismo del otro
 * lado — `purgar(dir, 0)` no borra nada.
 */
export function backupSettings(values: SettingsMap): AjustesDeRespaldo {
  const dir = values[SettingKey.BACKUP_DIR]?.trim() ?? "";
  const keep = Math.floor(num(values, SettingKey.BACKUP_KEEP, SETTING_DEFAULTS.backupKeep));
  return {
    dir,
    hour: hour(values, SettingKey.BACKUP_TIME, SETTING_DEFAULTS.backupTime),
    keep: keep >= 1 ? keep : SETTING_DEFAULTS.backupKeep,
    active: dir !== "",
  };
}

/**
 * Qué avisos vienen encendidos de fábrica, **y no todos**.
 *
 * El del cierre del día **sí**: ya estaba andando antes de que hubiera dónde
 * apagarlo, y leer "falta la clave" como apagado lo habría silenciado en la
 * actualización que trajo la sección de Notificaciones.
 *
 * La notificación de la campana **no**, y es la decisión de M2: la campana no
 * notifica —el sonido alcanza y una notificación por tarea se apila (SPECS §4.6)—,
 * así que es opt-in. Ojo con la lectura: lo que está apagado es la **notificación**,
 * no la campana; el sonido suena igual.
 */
const NOTICE_DEFAULT_ON: Record<string, boolean> = {
  [SettingKey.NOTICE_SHUTDOWN]: true,
  [SettingKey.NOTICE_BELL]: false,
};

/**
 * Un switch de aviso guardado como texto.
 *
 * `"1"` enciende, `"0"` apaga, y **cualquier otra cosa cae en el default de esa
 * clave** —ausente, vacío o basura editada a mano—. Es el mismo criterio que el
 * resto de `settings`: un valor que no se entiende no puede inventar una decisión.
 *
 * Espeja `bell::notice_enabled` en Rust para la campana. Si cambia un default,
 * cambia en los dos lados.
 */
export function noticeOn(values: SettingsMap, key: SettingKey): boolean {
  const raw = values[key]?.trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  return NOTICE_DEFAULT_ON[key] ?? true;
}

/**
 * Minutos de adelanto del aviso de próxima reunión, o **0 si está apagado**.
 *
 * Espeja `notice::lead_minutes` en Rust, que es quien decide de verdad; esto es
 * para dibujar el control. Un negativo se lee como apagado y no como "avisar
 * después de que empezó".
 */
/**
 * El sonido de los avisos, o el de la app si no eligieron uno.
 *
 * Espeja `commands::sound_or_default` en Rust, que es la que decide para los tres
 * avisos que manda el backend. **Un nombre que no existe no suena y no falla**, así
 * que un valor vacío o con espacios no puede pasar tal cual: dejaría los avisos
 * mudos sin ningún síntoma.
 */
export function noticeSound(values: SettingsMap): string {
  const raw = values[SettingKey.NOTICE_SOUND]?.trim();
  return raw ? raw : SETTING_DEFAULTS.noticeSound;
}

/**
 * La campana elegida: el centinela de la app, o el nombre de un archivo copiado.
 *
 * Espeja `sound::bell_file`, que es quien decide de verdad; esto es para dibujar el
 * control. **Un nombre que ya no está también cae en la de la app**, pero eso solo lo
 * sabe Rust —acá no hay disco—, así que la card muestra el nombre guardado y el botón
 * de probar es lo que revela que el archivo se fue.
 */
export function bellSound(values: SettingsMap): string {
  const raw = values[SettingKey.BELL_SOUND]?.trim();
  return raw ? raw : SETTING_DEFAULTS.bellSound;
}

/**
 * La tipografía elegida para los títulos o para el cuerpo.
 *
 * **No valida contra la lista de familias instaladas**, y es a propósito: la lista la
 * da el sistema y solo existe dentro de la app, así que validar acá dejaría al
 * browser y a los tests sin poder leer un valor perfectamente bueno. Una familia
 * desinstalada tampoco necesita defensa: el CSS la ignora y cae en la pila de
 * respaldo, que es exactamente lo que uno querría.
 */
export function fontChoice(
  values: SettingsMap,
  key: typeof SettingKey.FONT_TITLE | typeof SettingKey.FONT_BODY,
): string {
  const raw = values[key]?.trim();
  return raw ? raw : SETTING_DEFAULTS.font;
}

export function noticeMeetingMinutes(values: SettingsMap): number {
  const raw = values[SettingKey.NOTICE_MEETING_MINUTES]?.trim();
  if (raw == null || raw === "") return SETTING_DEFAULTS.noticeMeetingMinutes;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SETTING_DEFAULTS.noticeMeetingMinutes;
  return n >= 0 ? Math.floor(n) : 0;
}

interface SettingsState {
  values: SettingsMap;
  loaded: boolean;
  load: () => Promise<void>;
  /** Guarda un ajuste y avisa al resto de las vistas y a la otra ventana. */
  set: (key: SettingKey, value: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  values: {},
  loaded: false,

  load: async () => {
    const pairs = await api.listSettings();
    set({ values: Object.fromEntries(pairs), loaded: true });
  },

  set: async (key, value) => {
    await api.setSetting(key, value);
    set((s) => ({ values: { ...s.values, [key]: value } }));
    // Que se entere el resto de las vistas y la otra ventana.
    useAppStore.getState().bumpData();
  },
}));

/**
 * Carga los ajustes al montar y los relee cuando algo invalida los datos
 * (incluido un cambio hecho desde la otra ventana, vía `useDataSync`).
 * Se llama una vez por ventana, desde `Shell`.
 */
export function useSettingsRuntime() {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const values = useSettingsStore((st) => st.values);
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, [dataVersion]);
  // La zona se **empuja** a `date.ts`, que no puede preguntarla sin cerrar un ciclo
  // de imports (ver la nota de `setZone`). Va en un efecto y no dentro de `load`
  // para que valga igual cuando el cambio viene de la otra ventana, que llega como
  // un `dataVersion` nuevo y no como una escritura de esta pestaña.
  useEffect(() => {
    setZone(timezone(values));
  }, [values]);
}

/** Atajo para el rail: la jornada ya interpretada. */
export function useWorkHours(): { start: string; end: string } {
  const values = useSettingsStore((s) => s.values);
  return workHours(values);
}

/** Atajo para el board: los días colapsados, ya interpretados. */
export function useCollapsedWeekdays(): number[] {
  const values = useSettingsStore((s) => s.values);
  return collapsedWeekdays(values);
}

/**
 * Si las prioridades están encendidas. **De fábrica sí.**
 *
 * Es el único interruptor de esta función y apaga solo lo que se ve: el
 * indicador de la card, el selector del detalle, y los filtros y el orden por
 * prioridad del backlog. **Lo guardado no se toca** — apagar y volver a encender
 * devuelve cada tarea con el P que tenía, que es lo contrario de tener que
 * repriorizarlo todo por haber probado el switch.
 *
 * Mismo `"1"`/`"0"` que los avisos: cualquier otra cosa cae en el default.
 */
export function prioritiesOn(values: SettingsMap): boolean {
  const raw = values[SettingKey.PRIORITIES_ENABLED]?.trim();
  if (raw === "0") return false;
  return true;
}

/** Atajo para las vistas: si se dibujan las prioridades. */
export function usePrioritiesOn(): boolean {
  return prioritiesOn(useSettingsStore((s) => s.values));
}

/** Atajo para las vistas: capacidad y umbral ya interpretados. */
export function useCapacitySettings(): { target: number; warnRatio: number } {
  const values = useSettingsStore((s) => s.values);
  return {
    target: dailyCapacityMinutes(values),
    warnRatio: capacityWarnRatio(values),
  };
}
