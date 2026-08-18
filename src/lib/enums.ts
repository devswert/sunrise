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
