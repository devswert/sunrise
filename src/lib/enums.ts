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

/**
 * Prioridad de una tarea: **P1 es lo más urgente y P5 lo que puede esperar**.
 *
 * Cinco fijas y no configurables: una escala que se edita deja de ser una escala
 * —un P2 de hace tres meses ya no significa lo mismo que el de hoy— y el color
 * de cada nivel está calculado contra los otros cuatro (ver `--prio-*` en
 * `tokens.css`), así que agregar uno no es agregar una fila a una tabla.
 *
 * **La ausencia no está acá a propósito**: "sin prioridad" es `null`, no un
 * sexto valor. Es el estado de toda tarea recién creada, y un enum con un
 * `NONE` adentro haría que el filtro y el orden tuvieran que acordarse de
 * excluirlo en cada uso.
 *
 * Espeja la migración 16, que guarda el TEXT tal cual.
 */
export const Priority = {
  P1: "P1",
  P2: "P2",
  P3: "P3",
  P4: "P4",
  P5: "P5",
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/** Las cinco, de la más urgente a la que puede esperar. */
export const PRIORITIES: readonly Priority[] = [
  Priority.P1,
  Priority.P2,
  Priority.P3,
  Priority.P4,
  Priority.P5,
];

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
