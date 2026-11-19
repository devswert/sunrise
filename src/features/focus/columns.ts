/**
 * Qué columnas muestra Focus, dado lo que corría antes y lo que corre ahora
 * (§4.7). Es una función pura para poder fijarla con tests sin montar la vista.
 *
 * - **Si sigue corriendo alguna de las que ya corrían**, las columnas se
 *   conservan en su lugar —también las que se acaban de pausar, que quedan como
 *   columna en pausa con su play— y las que arrancaron se suman al final. Así un
 *   play en paralelo agrega una columna y una pausa no la hace desaparecer.
 * - **Si no sigue ninguna**, se empieza de cero con lo que corre ahora. Es lo que
 *   hace el play clásico —pausa todas y arranca una—, venga de una columna, de la
 *   cola o de otra vista: "deja solo esa". Y pausar la última que corría
 *   devuelve Focus a una sola tarea.
 *
 * El orden es el de llegada y no se reordena: que una columna salte de lugar al
 * retomarla obliga a buscarla de nuevo.
 */
export function nextColumns(
  prevOrder: number[],
  prevRunning: number[],
  running: number[],
): number[] {
  const stillRunning = prevRunning.some((id) => running.includes(id));
  if (!stillRunning) return [...running];
  return [...prevOrder, ...running.filter((id) => !prevOrder.includes(id))];
}
