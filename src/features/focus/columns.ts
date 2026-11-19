/**
 * Qué columnas muestra Focus, dado lo que corría antes y lo que corre ahora
 * (§4.7). Es una función pura para poder fijarla con tests sin montar la vista.
 *
 * - **Si sigue corriendo alguna de las que ya corrían**, las columnas se
 *   conservan en su lugar —también las que se acaban de pausar, que quedan como
 *   columna en pausa con su play— y las que arrancaron se suman al final. Así un
 *   play en paralelo agrega una columna y una pausa no la hace desaparecer.
 * - **Si no sigue ninguna y arrancó otra**, se empieza de cero con lo que corre
 *   ahora. Es lo que hace el play clásico —pausa todas y arranca una—, venga de
 *   una columna, de la cola o de otra vista: "deja solo esa".
 * - **Con todas en pausa, un play en paralelo** también reinicia, salvo que se
 *   sepa que fue en paralelo (`parallel`): eso solo lo sabe un gesto hecho en
 *   Focus. Desde otra vista o el taxímetro, deja solo esa.
 * - **Si solo hubo pausas** —ninguna arrancó—, las columnas se conservan, aunque
 *   ya no corra ninguna: pausar o completar la última que corría no se lleva a
 *   las que estaban en pausa. Las saca completarlas o un play clásico.
 *
 * El orden es el de llegada y no se reordena: que una columna salte de lugar al
 * retomarla obliga a buscarla de nuevo.
 */
export function nextColumns(
  prevOrder: number[],
  prevRunning: number[],
  running: number[],
  /**
   * El cambio vino de un play en paralelo apretado en Focus. Solo hace falta
   * para el caso que el estado no distingue: con todas en pausa, uno en paralelo
   * suma la columna en vez de dejar solo esa.
   */
  parallel = false,
): number[] {
  const stillRunning = prevRunning.some((id) => running.includes(id));
  const started = running.some((id) => !prevRunning.includes(id));
  if (!stillRunning && started && !parallel) return [...running];
  return [...prevOrder, ...running.filter((id) => !prevOrder.includes(id))];
}
