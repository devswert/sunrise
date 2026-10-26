import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import type { DayWork } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { useTimer } from "../timer/useTimer";

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
 * trabajando ahora mismo saldría de alto cero.
 *
 * Las filas se guardan **con su fecha** y solo se devuelven si es la pedida: al
 * cambiar `date`, hasta que llega la lectura nueva, el rail dibujaba el día nuevo
 * con lo trabajado del anterior, y una tarea con el mismo id salía trabajada a
 * una hora que no era de ese día.
 */
/** Una sola instancia: un `[]` nuevo por render rompería los `useMemo` que dependen de `work`. */
const NO_WORK: DayWork[] = [];

export function useDayWork(date: string): {
  work: DayWork[];
  segundosEnCurso: number;
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
  return { work, segundosEnCurso: timer.runTotal };
}
