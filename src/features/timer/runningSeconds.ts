/**
 * Lo corrido de las entradas abiertas, **por tarea**.
 *
 * Existe desde que puede haber varios timers a la vez (I4, #18). Antes era un
 * solo número —la corrida del único timer— y quien sumaba lo trabajado le
 * agregaba ese número a la fila `running`. Con dos timers abiertos eso le suma a
 * la segunda tarea la corrida de la primera, y al total del día una sola
 * corrida en vez de dos.
 *
 * Un número sigue valiendo y significa "lo mismo para cualquier tarea que
 * corra": es el caso de un solo timer, y el que usan los tests puros.
 */
export type RunningSeconds = number | ((taskId: number) => number);

/** Lo corrido de `taskId` según `r`. Nunca negativo. */
export function runningFor(r: RunningSeconds, taskId: number): number {
  return Math.max(0, typeof r === "number" ? r : r(taskId));
}
