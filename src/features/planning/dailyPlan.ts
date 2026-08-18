import type { Task } from "../../lib/types";
import { CapacityLevel } from "../../lib/enums";
import { computeCapacityLevel } from "../../lib/capacity";

/**
 * Las cuentas del ritual de planificación diaria, separadas del render por la
 * misma razón que `railLayout.ts`: son las que deciden qué dice la vista, y
 * probarlas a través del DOM sería probar otra cosa.
 *
 * Todo se mide en **minutos estimados**, no en tiempo trabajado: el ritual mira
 * hacia adelante. Lo que ya pasó lo cuenta el rail (§4.13) y lo contará la
 * review (M3.5).
 */

export interface ResumenDelDia {
  /** Suma de estimados de todas las tareas del día. Es lo que pesa el semáforo. */
  planificados: number;
  /** Solo lo que sigue en `TODO`: lo que de verdad queda por delante. */
  pendientes: number;
  /** Minutos comprometidos con hora (reuniones y cualquier tarea agendada). */
  comprometidos: number;
  /** Cuántas tareas pendientes **no** tienen estimado. */
  sinEstimado: number;
  /** Cuántas tareas tiene el día en total. */
  total: number;
  nivel: CapacityLevel;
  /**
   * Objetivo menos planificados. Negativo = te pasaste. Es `null` cuando no hay
   * objetivo configurado (`target <= 0`), que no es lo mismo que "te sobra 0".
   */
  holgura: number | null;
}

/**
 * Resume el día para el contador de capacidad.
 *
 * El semáforo pesa **todo** el día y no solo lo pendiente: completar tareas no
 * debería ir apagando la alarma de un día sobrecargado, porque el día siguió
 * siendo igual de largo. Lo pendiente se muestra aparte, que es la otra pregunta
 * ("¿alcanzo con lo que queda?").
 */
export function resumenDelDia(
  tasks: Task[],
  target: number,
  warnRatio: number,
): ResumenDelDia {
  let planificados = 0;
  let pendientes = 0;
  let comprometidos = 0;
  let sinEstimado = 0;

  for (const t of tasks) {
    const est = t.estimatedMinutes ?? 0;
    planificados += est;
    if (t.status !== "DONE") {
      pendientes += est;
      // Sin estimado el semáforo miente por abajo: hay que decirlo, no sumar un
      // número inventado (misma regla que el rail con `DURACION_POR_DEFECTO`).
      if (t.estimatedMinutes == null || t.estimatedMinutes <= 0) sinEstimado += 1;
    }
    if (t.scheduledTime) comprometidos += est;
  }

  return {
    planificados,
    pendientes,
    comprometidos,
    sinEstimado,
    total: tasks.length,
    nivel: computeCapacityLevel(planificados, target, warnRatio),
    holgura: target > 0 ? target - planificados : null,
  };
}

/**
 * El último día con tareas antes de `antesDe`, o `null` si no hay ninguno.
 *
 * El ritual repasa **ese** día y no "ayer" a secas: un lunes, ayer es domingo y
 * casi siempre está vacío, mientras que lo que hay que revisar es el viernes.
 * Recibe la ventana ya leída (los últimos días) y elige la fecha más reciente
 * con algo dentro. Es **el mismo día que preserva `degradar_pendientes`** en
 * Rust: si los dos criterios divergen, el ritual repasaría un día del que ya se
 * llevaron tareas.
 */
export function ultimoDiaConTareas(tasks: Task[], antesDe: string): string | null {
  let mejor: string | null = null;
  for (const t of tasks) {
    const d = t.scheduledDate;
    if (!d || d >= antesDe) continue;
    if (mejor == null || d > mejor) mejor = d;
  }
  return mejor;
}

/**
 * Minutos trabajados en un día, a partir de `repo::trabajo_del_dia`.
 *
 * Se lee aparte y no de `actual_seconds` porque ese campo es el total de la
 * tarea: una arrastrada de tres días lo trae todo junto, y el repaso pregunta
 * por **ese** día.
 */
export function minutosTrabajados(filas: Array<{ seconds: number }>): number {
  return Math.round(filas.reduce((s, f) => s + Math.max(0, f.seconds), 0) / 60);
}

export interface RepasoDelDia {
  /** Se cerraron ese día. */
  cerradas: Task[];
  /** Quedaron abiertas: hay que decidir si van a hoy o al backlog. */
  abiertas: Task[];
  total: number;
  /** Minutos estimados del día. */
  planificados: number;
}

/**
 * Cómo cerró un día.
 *
 * Es una cuenta directa sobre lo que hay en esa fecha, y puede serlo porque la
 * degradación diaria **preserva justamente este día** (`degradar_pendientes`):
 * nada se fue de acá sin que lo vieras. Cuando el carry-over arrastraba todo a
 * hoy había que reconstruirlo desde el historial, y el día se veía más corto y
 * más exitoso de lo que fue.
 */
export function repasoDelDia(delDia: Task[]): RepasoDelDia {
  return {
    cerradas: delDia.filter((t) => t.status === "DONE"),
    abiertas: delDia.filter((t) => t.status !== "DONE"),
    total: delDia.length,
    planificados: delDia.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
  };
}

/**
 * Cómo se lee el semáforo, en una línea. Vive acá y no en el componente porque
 * es una regla, no un texto suelto: el mismo `nivel` tiene que decir lo mismo
 * en todos lados.
 */
export function mensajeDeCapacidad(r: ResumenDelDia): string {
  if (r.total === 0) return "El día está vacío. Trae algo del backlog o crea una tarea.";
  if (r.holgura == null) return "Sin objetivo de capacidad configurado.";
  if (r.nivel === CapacityLevel.OVER) {
    return `Te pasaste por ${fmt(-r.holgura)}. Algo tiene que salir del día.`;
  }
  if (r.nivel === CapacityLevel.WARN) return `El día está lleno: queda ${fmt(r.holgura)} libre.`;
  return `Te quedan ${fmt(r.holgura)} sin comprometer.`;
}

function fmt(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} min`;
  if (rem === 0) return `${h} h`;
  return `${h} h ${rem} min`;
}
