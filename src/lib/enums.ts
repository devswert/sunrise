/**
 * Enums de sunrise. Convención: los valores van en MAYÚSCULAS y espejan
 * exactamente los strings almacenados en SQLite (ver src-tauri/src/db/migrations.rs).
 */

export const TaskStatus = {
  TODO: "TODO",
  DONE: "DONE",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskSource = {
  MANUAL: "MANUAL",
  CALENDAR: "CALENDAR",
} as const;
export type TaskSource = (typeof TaskSource)[keyof typeof TaskSource];

export const SourceState = {
  ACTIVE: "ACTIVE",
  ORPHANED: "ORPHANED",
} as const;
export type SourceState = (typeof SourceState)[keyof typeof SourceState];

export const TaskEventType = {
  CREATED: "CREATED",
  MOVED: "MOVED",
  START_DATE_SET: "START_DATE_SET",
  /** Movida por el carry-over, no por el usuario. */
  CARRIED_OVER: "CARRIED_OVER",
} as const;
export type TaskEventType = (typeof TaskEventType)[keyof typeof TaskEventType];

/** Estado del semáforo del contador de capacidad diaria. */
export const CapacityLevel = {
  OK: "OK", // gris — bajo el objetivo
  WARN: "WARN", // amarillo — cerca del objetivo
  OVER: "OVER", // rojo — sobre el objetivo
} as const;
export type CapacityLevel = (typeof CapacityLevel)[keyof typeof CapacityLevel];

/**
 * El valor de `bell_sound` que significa **la campana sintetizada de la app**.
 *
 * No es un enum de verdad —esa clave guarda el nombre del archivo cuando elegiste
 * uno propio—, pero este valor sí es un centinela y va en MAYÚSCULAS como el resto.
 * Espeja `sound::SUNRISE_BELL` en Rust, que es quien la toca, y la migración 12.
 * Un vacío **no** sirve para lo mismo: no distingue "elegí la de sunrise" de "nunca
 * elegí nada", y solo una de las dos es una decisión.
 */
export const SUNRISE_BELL = "SUNRISE";

/**
 * Los dos valores centinela de la tipografía (Configs → Apariencia).
 *
 * Las claves `font_title` y `font_body` guardan **uno de estos dos, o el nombre de
 * una familia instalada** (`"Helvetica Neue"`). Van en MAYÚSCULAS justamente para no
 * poder chocar con un nombre de familia real, que siempre viene capitalizado normal.
 */
export const FontChoice = {
  /** Las que viajan dentro de la app: Sora en los títulos, Manrope en el cuerpo. */
  SUNRISE: "SUNRISE",
  /** La que el sistema use como suya (`system-ui`), sin nombrar ninguna familia. */
  SYSTEM: "SYSTEM",
} as const;
export type FontChoice = (typeof FontChoice)[keyof typeof FontChoice];
