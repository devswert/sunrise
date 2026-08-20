import { useEffect } from "react";
import { create } from "zustand";
import { api } from "./ipc";
import { useAppStore } from "./store";

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
  PLANNED_ON: "planned_on",
  COLLAPSED_WEEKDAYS: "collapsed_weekdays",
  SHUTDOWN_NOTIFIED_ON: "shutdown_notified_on",
  // Respaldo. `BACKUP_DIR` y `BACKUP_KEEP` los lee **también Rust**
  // (`commands.rs`): si cambian de nombre, cambian en los dos lados.
  BACKUP_DIR: "backup_dir",
  BACKUP_TIME: "backup_time",
  BACKUP_KEEP: "backup_keep",
  BACKUP_RAN_ON: "backup_ran_on",
  BACKUP_LAST_ERROR: "backup_last_error",
} as const;
export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey];

/**
 * Los cuatro primeros coinciden con los que siembra la migración 2. Los de
 * respaldo **no se siembran** —como `planned_on`— porque no hay valor de fábrica
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
} as const;

export type SettingsMap = Record<string, string>;

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

/**
 * Si el ritual de planificación diaria ya se cerró para `date`.
 *
 * `planned_on` **no la siembra ninguna migración**, y está bien: `set_setting`
 * es un upsert y toda lectura de esta tabla tiene fallback. Guarda una sola
 * fecha, no un historial: la pregunta es "¿ya planifiqué hoy?", y llevar el
 * registro de qué días planificaste es materia de la review, no de un ajuste.
 */
export function alreadyPlanned(values: SettingsMap, date: string): boolean {
  return values[SettingKey.PLANNED_ON]?.trim() === date;
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
  const keep = Math.floor(
    num(values, SettingKey.BACKUP_KEEP, SETTING_DEFAULTS.backupKeep),
  );
  return {
    dir,
    hour: hour(values, SettingKey.BACKUP_TIME, SETTING_DEFAULTS.backupTime),
    keep: keep >= 1 ? keep : SETTING_DEFAULTS.backupKeep,
    active: dir !== "",
  };
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
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, [dataVersion]);
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

/** Atajo para las vistas: capacidad y umbral ya interpretados. */
export function useCapacitySettings(): { target: number; warnRatio: number } {
  const values = useSettingsStore((s) => s.values);
  return {
    target: dailyCapacityMinutes(values),
    warnRatio: capacityWarnRatio(values),
  };
}
