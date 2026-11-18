import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import type { DayWork } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { useTimer } from "../timer/useTimer";
import type { RunningSeconds } from "../timer/runningSeconds";

/** Una sola instancia: un `[]` nuevo por render rompería los `useMemo` que dependen de `work`. */
const NO_WORK: DayWork[] = [];

/**
 * Lo que se trabajó en un día, para que el rail dibuje **lo que pasó** y no solo
 * lo planificado.
 *
 * Se relee con `dataVersion`, así que completar una tarea o parar el taxímetro
 * —incluso desde la ventana flotante— actualiza el rail por el mismo canal que
 * el resto de las vistas (SPECS §5).
 *
 * `segundosEnCurso` sale del taxímetro y no de la base: la corrida abierta
 * todavía no tiene segundos escritos, y sin esto el bloque de la tarea que estás
 * trabajando ahora mismo saldría de alto cero. Es **por tarea**
 * (`runTotalOf`): con timers en paralelo cada fila `running` suma la suya.
 *
 * Las filas se guardan **con su fecha** y solo se devuelven si es la pedida: al
 * cambiar `date`, hasta que llega la lectura nueva, el rail dibujaba el día nuevo
 * con lo trabajado del anterior, y una tarea con el mismo id salía trabajada a
 * una hora que no era de ese día. El costo es un frame sin nada trabajado: en
 * ese instante el rail —el de Week al cambiar de día, el de Today al pasar la
 * medianoche— dibuja todo como proyectado, y `useLateTasks` no ve lo trabajado.
 * Es mejor que dibujar trabajo de otro día, que es un dato falso.
 */
export function useDayWork(date: string): {
  work: DayWork[];
  segundosEnCurso: RunningSeconds;
} {
  const [loaded, setLoaded] = useState<{ date: string; rows: DayWork[] } | null>(null);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const timer = useTimer();

  useEffect(() => {
    let alive = true;
    void api.dayWork(date).then((rows) => {
      if (alive) setLoaded({ date, rows });
    });
    return () => {
      alive = false;
    };
  }, [date, dataVersion]);

  const work = loaded?.date === date ? loaded.rows : NO_WORK;
  return { work, segundosEnCurso: timer.runTotalOf };
}
