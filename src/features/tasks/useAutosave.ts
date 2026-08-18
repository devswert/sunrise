import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/ipc";
import type { TaskPatch } from "../../lib/types";
import { useAppStore } from "../../lib/store";

/**
 * Autosave de una tarea: guardado inmediato, con debounce, y `flush`.
 *
 * Vive en un hook y no copiado en cada vista porque la regla del `flush` es
 * sutil y se paga cara si diverge: con debounce, **cualquier cierre es una
 * carrera contra el temporizador**, y el cleanup del efecto lo *cancelaba*, así
 * que escribir y salir en el mismo gesto descartaba la edición sin decir nada.
 * Sin botón "Guardar", eso es pérdida de datos silenciosa. Lo usan el modal de
 * detalle y Focus.
 *
 * @param onSaved Se llama después de cada escritura, para que la vista recargue.
 */
export function useAutosave(taskId: number, onSaved: () => Promise<void> | void) {
  const [savedFlash, setSavedFlash] = useState(false);
  const bumpData = useAppStore((s) => s.bumpData);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  /** Lo que el debounce todavía no escribió, acumulado por campo. */
  const pendienteRef = useRef<TaskPatch | null>(null);

  const flash = useCallback(() => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  }, []);

  /** Guarda de inmediato: selects, checks, fechas — decisiones puntuales. */
  const commit = useCallback(
    async (patch: TaskPatch) => {
      await api.updateTask(taskId, patch);
      await onSaved();
      // Avisa al resto (taxímetro incluido) de que la tarea cambió.
      bumpData();
      flash();
    },
    [taskId, onSaved, flash, bumpData],
  );

  /** Guarda con 500 ms de debounce: campos de texto. */
  const commitDebounced = useCallback(
    (patch: TaskPatch) => {
      pendienteRef.current = { ...pendienteRef.current, ...patch };
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const p = pendienteRef.current;
        pendienteRef.current = null;
        if (p) void commit(p);
      }, 500);
    },
    [commit],
  );

  /** Escribe ya lo que estuviera esperando el debounce. */
  const flush = useCallback(async () => {
    clearTimeout(debounceRef.current);
    const p = pendienteRef.current;
    pendienteRef.current = null;
    if (p) await commit(p);
  }, [commit]);

  // Por ref para que el cleanup pueda ir con deps vacías (correr una sola vez,
  // al desmontar) y aun así usar el `flush` más reciente.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      void flushRef.current();
    },
    [],
  );

  return { commit, commitDebounced, flush, savedFlash };
}
