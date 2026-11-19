/**
 * Jornada y paralelismo (#22): las horas de reloj de un día y cuántas cosas
 * corrieron a la vez.
 *
 * Los dos números llegan hechos de Rust (`span_seconds` y `clocked_seconds`, de
 * `repo::work_by_day`); acá quedan la unión de tramos que usa el gemelo del mock,
 * la regla de cuándo se muestra el paralelismo y su formato.
 *
 * **El paralelismo es reloj sumado ÷ jornada, no tiempo en tareas ÷ jornada.** El
 * tiempo en tareas incluye los ajustes manuales, que no tienen hora: un día con una
 * hora de timer y tres de ajuste daría "×4" sin que nada haya corrido en paralelo,
 * y un día solo con ajustes dividiría por cero. Los dos números de la razón salen
 * de los mismos tramos (DECISIONES §1).
 */

/** Las horas de reloj de un día. Espeja `repo::ClockDay`. */
export interface ClockDay {
  /** La jornada: segundos con al menos un timer o una reunión, sin doble conteo. */
  span: number;
  /** Los mismos tramos sumados sin unir. */
  clocked: number;
}

/**
 * Espeja `repo::clock_on_day`: recorta cada tramo `[inicio, fin)` (epoch ms) al
 * día, los suma y los une. Tocarse no es solaparse. Las cuentas van en ms y se
 * pasan a segundos al final, igual que en Rust.
 */
export function clockOnDay(spans: Array<[number, number]>, start: number, end: number): ClockDay {
  const cut = spans
    .map(([a, b]) => [Math.max(a, start), Math.min(b, end)] as [number, number])
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const clocked = cut.reduce((acc, [a, b]) => acc + (b - a), 0);
  let span = 0;
  let current: [number, number] | null = null;
  for (const [a, b] of cut) {
    if (current && a <= current[1]) {
      current[1] = Math.max(current[1], b);
    } else {
      if (current) span += current[1] - current[0];
      current = [a, b];
    }
  }
  if (current) span += current[1] - current[0];
  return { span: Math.trunc(span / 1000), clocked: Math.trunc(clocked / 1000) };
}

/**
 * Desde qué razón se muestra el paralelismo: la que ya se lee como "×1,1".
 *
 * Por debajo no se dice nada —"todo se ve como hoy"—: un par de minutos de
 * solape al cambiar de tarea no es trabajo en paralelo, y un "×1,0" sería ruido.
 */
export const PARALLELISM_THRESHOLD = 1.05;

/** El paralelismo de un día (o una semana), o `null` si no hay que mostrarlo. */
export function parallelism(clocked: number, span: number): number | null {
  if (span <= 0) return null;
  const ratio = clocked / span;
  return ratio >= PARALLELISM_THRESHOLD ? ratio : null;
}

/** `1.8` → `"×1,8"`. Coma decimal: es texto para el usuario. */
export function formatParallelism(ratio: number): string {
  return `×${ratio.toFixed(1).replace(".", ",")}`;
}

/**
 * La jornada de **hoy** avanzada desde la carga, con los timers que siguen
 * abiertos.
 *
 * Rust la calcula hasta el momento de la consulta; después el tiempo en tareas
 * sigue subiendo con el taxímetro y la jornada se quedaría quieta. Con al menos un
 * timer abierto, cada segundo es un segundo más de jornada y `abiertos` segundos
 * más de reloj sumado. **Se avanzan los dos lados**: mover uno solo haría crecer o
 * achicarse el paralelismo con el reloj, sin que nada cambie.
 *
 * Borde aceptado: una reunión en curso ya cuenta entera en la jornada, así que
 * durante ella se suma de más el rato que se solapa con el timer. Se corrige solo
 * en la siguiente recarga (cada pausa, play o cambio de datos).
 */
export function liveClock(
  day: { spanSeconds: number; clockedSeconds: number },
  openTimers: number,
  secondsSinceLoad: number,
): ClockDay {
  const dt = openTimers > 0 ? Math.max(0, Math.floor(secondsSinceLoad)) : 0;
  return { span: day.spanSeconds + dt, clocked: day.clockedSeconds + openTimers * dt };
}
