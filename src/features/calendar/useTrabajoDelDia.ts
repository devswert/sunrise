import { useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import type { TrabajoDelDia } from "../../lib/types";
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
 */
export function useTrabajoDelDia(date: string): {
  trabajo: TrabajoDelDia[];
  segundosEnCurso: number;
} {
  const [trabajo, setTrabajo] = useState<TrabajoDelDia[]>([]);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const timer = useTimer();

  useEffect(() => {
    let vivo = true;
    void api.trabajoDelDia(date).then((filas) => {
      if (vivo) setTrabajo(filas);
    });
    return () => {
      vivo = false;
    };
  }, [date, dataVersion]);

  return { trabajo, segundosEnCurso: timer.runTotal };
}
