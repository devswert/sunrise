import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Moon, Pause, Play } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, LogDay, Task } from "../../lib/types";
import { nowHhmm, todayISO } from "../../lib/date";
import { formatMinutes, hours, hoursFromMinutes } from "../../lib/capacity";
import { celebrate } from "../../lib/confetti";
import { useTimer } from "../timer/useTimer";
import { SunriseMark } from "../../components/SunriseMark";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../lib/store";
import { FocusTaskCard } from "./FocusTaskCard";
import { nextColumns } from "./columns";

/**
 * Focus Mode: la tarea en la que estás trabajando, o **una columna por cada
 * timer** cuando corren varios (§4.7, #21).
 *
 * - Con un timer o ninguno es una sola tarea: el check la completa y pasa sola
 *   a la siguiente, y ↑/↓ mueven el foco entre las del día.
 * - Con varios, cada una es una columna con su tiempo, su pausa y su check.
 * - Al completar, la tarea se manda al final de la lista de su día.
 * - Nunca se cierra solo: pasado el estimado puedes seguir trabajando.
 */
export function FocusView() {
  const [queue, setQueue] = useState<Task[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const timer = useTimer();
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpData = useAppStore((s) => s.bumpData);
  const focusTaskId = useAppStore((s) => s.focusTaskId);
  const clearFocusTask = useAppStore((s) => s.clearFocusTask);
  const [categories, setCategories] = useState<Category[]>([]);
  /** Resumen del día, solo para la vista de "no queda nada". */
  const [dia, setDia] = useState<LogDay | null>(null);
  const navigate = useNavigate();

  /**
   * La tarea en foco, por id. Al recargar, Focus se queda **en esa tarea** aunque
   * la cola haya cambiado alrededor; si ya no está —la completaste—, el índice se
   * queda donde estaba y apunta a la siguiente. Con solo el índice, completar una
   * columna que iba antes en la cola corría el foco a otra tarea.
   */
  const focusedId = useRef<number | null>(null);
  const load = useCallback(async () => {
    const q = await api.focusQueue(todayISO(), nowHhmm());
    setQueue(q);
    const keep = q.findIndex((t) => t.id === focusedId.current);
    setIndex((i) => (keep >= 0 ? keep : Math.min(i, Math.max(0, q.length - 1))));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  useEffect(() => {
    api.listCategories().then(setCategories);
  }, [dataVersion]);

  // El resumen del día se pide solo cuando hay algo que resumir: con tareas
  // pendientes esta vista no lo muestra, y `daily_log` no es gratis.
  useEffect(() => {
    if (loading || queue.length > 0) return;
    let alive = true;
    void api.dailyLog(todayISO(), 1).then(([d]) => {
      if (alive) setDia(d ?? null);
    });
    return () => {
      alive = false;
    };
  }, [loading, queue.length, dataVersion]);

  // Al arrancar el timer en otra tarea, Focus salta a ella. El salto ocurre una
  // sola vez por tarea (incluso si la cola aún no había cargado al montar);
  // después las flechas mandan libremente.
  const activeTaskId = timer.active?.taskId ?? null;
  const syncedFor = useRef<number | null>(null);
  useEffect(() => {
    if (activeTaskId == null) {
      syncedFor.current = null;
      return;
    }
    if (syncedFor.current === activeTaskId) return;
    const found = queue.findIndex((t) => t.id === activeTaskId);
    if (found >= 0) {
      setIndex(found);
      syncedFor.current = activeTaskId;
    }
  }, [activeTaskId, queue]);

  /**
   * Abre en la tarea que pidió un aviso del sistema.
   *
   * **Va en su propio efecto y no dentro de `load`**, y esa es la parte que
   * importa: en dev React monta los efectos dos veces, así que consumir el id
   * dentro de la carga lo gastaba en la primera pasada y la segunda reseteaba el
   * índice. El síntoma era exacto: el aviso abría Focus sin mover la tarea.
   *
   * **Va declarado después del salto al timer, y por eso gana**: React corre los
   * efectos en orden, así que puesto antes el timer lo pisaba en el primer montaje.
   * Y tiene que ganar: un aviso que acabas de accionar es más explícito que el
   * timer que venía corriendo.
   *
   * Una tarea que no está en la cola se ignora en silencio —la completaste, la
   * borraron, era de otro día— pero la marca se limpia igual: el aviso ya cumplió y
   * dejarla puesta movería la vista en la próxima carga.
   */
  const [noticeId, setNoticeId] = useState<number | null>(null);
  useEffect(() => {
    if (focusTaskId == null || queue.length === 0) return;
    const i = queue.findIndex((t) => t.id === focusTaskId);
    if (i >= 0) setIndex(i);
    // Con columnas el índice no se dibuja: el aviso se guarda para la tira de
    // abajo —de donde se suma con el play en paralelo— y para cuando Focus
    // vuelva a una sola tarea (ver `noticeId` más abajo).
    if (i >= 0) setNoticeId(focusTaskId);
    clearFocusTask();
  }, [queue, focusTaskId, clearFocusTask]);

  // --- Columnas: una por timer (§4.7) ---
  // La clave en string para que el efecto corra cuando cambia **qué** corre, no
  // en cada tick: `actives` es un arreglo nuevo cada vez que el store relee.
  const runningKey = timer.actives.map((a) => a.taskId).join(",");
  const [columns, setColumns] = useState<number[]>([]);
  const prevRunning = useRef<number[]>([]);
  useEffect(() => {
    const running = runningKey ? runningKey.split(",").map(Number) : [];
    // Leído antes del `set`: el updater corre en el próximo render, cuando la
    // ref ya apunta a lo de ahora, y entonces todo parecería "seguir corriendo".
    const prevIds = prevRunning.current;
    prevRunning.current = running;
    setColumns((prev) => nextColumns(prev, prevIds, running));
  }, [runningKey]);

  /**
   * Las tareas de las columnas que **no** están en la cola de hoy: una de otro
   * día que se arrancó desde la semana, o una del backlog. La cola no las trae,
   * así que se piden una por una.
   */
  const [extra, setExtra] = useState<Record<number, Task | null>>({});
  const missingKey = columns.filter((id) => !queue.some((t) => t.id === id)).join(",");
  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    const ids = missingKey.split(",").map(Number);
    void Promise.all(ids.map((id) => api.getTask(id)))
      .then((ts) => {
        if (alive) setExtra(Object.fromEntries(ids.map((id, i) => [id, ts[i] ?? null])));
      })
      // Si no se pudo leer, no se marca como borrada: se podaría una columna
      // cuyo timer sigue corriendo. Queda su lugar vacío y se reintenta con el
      // próximo `dataVersion`.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [missingKey, dataVersion]);

  const taskOf = (id: number): Task | null | undefined =>
    queue.find((t) => t.id === id) ?? extra[id];
  // Una columna cuya tarea se completó o se borró en otro lado no se dibuja.
  // `undefined` es "todavía cargando": cuenta, para que la vista no salte a una
  // sola tarea y vuelva a columnas mientras llega.
  const isGone = (id: number) => {
    const t = taskOf(id);
    return t === null || t?.status === "DONE";
  };
  const visible = columns.filter((id) => !isGone(id));
  // Y se poda de `columns`: si no, se seguiría pidiendo con `get_task` en cada
  // `dataVersion`, y reabrirla en otra vista la haría reaparecer en pausa sin
  // que nadie la pidiera.
  const goneKey = columns.filter(isGone).join(",");
  useEffect(() => {
    if (!goneKey) return;
    const gone = goneKey.split(",").map(Number);
    setColumns((c) => c.filter((id) => !gone.includes(id)));
  }, [goneKey]);
  const multi = visible.length >= 2;

  // Al volver a una sola tarea —completaste una columna, o un play clásico dejó
  // una— Focus queda en la que sigue, no en la que mirabas antes de las
  // columnas. `syncedFor` se marca a mano: el salto de arriba no corre si esa
  // tarea ya era la más antigua. **Salvo que haya llegado un aviso** mientras
  // estaba en columnas: gana, por lo mismo que gana al timer en una sola tarea.
  const wasMulti = useRef(false);
  const visibleKey = visible.join(",");
  useEffect(() => {
    const ids = visibleKey ? visibleKey.split(",").map(Number) : [];
    if (wasMulti.current && ids.length < 2 && ids.length > 0) {
      const target = noticeId != null && queue.some((t) => t.id === noticeId) ? noticeId : ids[0];
      const i = queue.findIndex((t) => t.id === target);
      if (i >= 0) setIndex(i);
      syncedFor.current = ids[0];
    }
    wasMulti.current = ids.length >= 2;
  }, [visibleKey, queue, noticeId]);

  // El aviso pendiente se gasta al salir de columnas (arriba lo usó) o cuando su
  // tarea ya tiene columna. Declarado después: los efectos corren en orden.
  const noticeDone = !multi || (noticeId != null && visible.includes(noticeId));
  useEffect(() => {
    if (noticeDone) setNoticeId(null);
  }, [noticeDone]);

  const current = queue[index] ?? null;
  useEffect(() => {
    focusedId.current = current?.id ?? null;
  }, [current]);
  // Con columnas, la tira muestra el aviso pendiente si lo hay; si no, la
  // primera de la cola sin columna.
  const notice = multi ? (queue.find((t) => t.id === noticeId) ?? null) : null;
  const next = multi
    ? (notice ?? queue.find((t) => !visible.includes(t.id)) ?? null)
    : (queue[index + 1] ?? null);

  /**
   * Completa una tarea y la manda al final de su día. Con una sola tarea, la
   * cola avanza sola; con columnas, la de la tarea se cierra.
   */
  const complete = useCallback(
    async (task: Task) => {
      setColumns((c) => c.filter((id) => id !== task.id));
      if (timer.isRunning(task.id)) await timer.stop(task.id);

      const inQueue = queue.some((t) => t.id === task.id);
      const wasLast = inQueue && queue.length === 1;
      await api.setTaskStatus(task.id, "DONE");
      if (inQueue) {
        const lastPos = queue.reduce((m, t) => Math.max(m, t.position), 0);
        await api.moveTask(task.id, todayISO(), lastPos + 1);
      } else if (task.scheduledDate) {
        // Al final de SU día, no de hoy: es una columna de otro día, y
        // completarla no debe reprogramarla (lo mismo que el taxímetro).
        const sameDay = await api.listTasksForDate(task.scheduledDate);
        const lastPos = sameDay.reduce((m, t) => Math.max(m, t.position), 0);
        await api.moveTask(task.id, task.scheduledDate, lastPos + 1);
      }

      // `bumpData` no es cosmético acá: completar puede haber detenido el timer
      // (lo hace `set_task_status` en Rust), y sin el aviso el taxímetro de la
      // ventana flotante se quedaba ofreciendo retomar la tarea ya cerrada.
      bumpData();

      // La completada sale de la cola: el índice ya apunta a la siguiente.
      await load();

      // Solo al vaciar la cola, y solo desde acá: montar la vista con el día ya
      // terminado —volver a Focus más tarde— no vuelve a celebrarlo.
      if (wasLast) celebrate();
    },
    [queue, timer, load, bumpData],
  );

  /**
   * Los controles del timer de una tarjeta. **Corriendo, solo la pausa**: la
   * tarea ya está en marcha y no hay nada que sumar.
   *
   * #20: en pausa, este `<button>` se reemplaza por
   * `<PlayControls taskId={task.id} size="md" />` (play clásico + en paralelo).
   * El play en paralelo es el que suma columnas, y el clásico el que deja una
   * sola; las dos cosas las resuelve `nextColumns` mirando qué corre, así que el
   * componente se enchufa sin avisarle nada a Focus, **con una excepción**: con
   * todas las columnas en pausa, Focus no distingue un play en paralelo de uno
   * clásico —los dos arrancan una sin que siga ninguna— y deja solo esa (§4.7).
   */
  const controlsFor = (task: Task) => {
    if (timer.isRunning(task.id)) {
      return (
        <button
          className="focus__play is-running"
          aria-label="Pausar"
          onClick={() => void timer.stop(task.id)}
        >
          <Pause size={16} />
        </button>
      );
    }
    return (
      <button
        className="focus__play"
        aria-label="Iniciar"
        onClick={() => void timer.start(task.id)}
      >
        <Play size={16} />
      </button>
    );
  };

  // Navegación con flechas entre las tareas del día. Con columnas no hay "la"
  // tarea en foco que mover: cada columna es la de su timer.
  useEffect(() => {
    if (multi) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, queue.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue.length, multi]);

  if (loading) return <div className="focus" />;

  if (!multi && !current) {
    const completadas = dia?.done.length ?? 0;
    const trabajado = dia?.workedSeconds ?? 0;
    const planificado = dia?.plannedMinutes ?? 0;
    return (
      <div className="focus focus--empty">
        {/* El sol de la marca saliendo, no un check en un círculo: el check ya
         * está en cada tarea que cerraste, y acá lo que se celebra es el día
         * entero. Sube al entrar, que es lo único que hace la marca. */}
        <div className="focus__amanecer">
          <SunriseMark size={76} className="focus__sol" />
        </div>
        <h1>Listo por hoy</h1>

        {/* El resumen aparece cuando llega; no se reserva su espacio en blanco
         * porque un día sin nada trabajado tampoco tiene qué contar. */}
        {completadas > 0 && (
          <div className="focus__resumen">
            <div className="focus__dato">
              <strong>{completadas}</strong>
              <span>{completadas === 1 ? "tarea completada" : "tareas completadas"}</span>
            </div>
            <div className="focus__dato">
              <strong>{hours(trabajado)}</strong>
              <span>
                {planificado > 0
                  ? `de ${hoursFromMinutes(planificado)} planificadas`
                  : "trabajadas"}
              </span>
            </div>
          </div>
        )}

        {/* El cierre del día es el paso siguiente natural, y llegar hasta él por
         * el sidebar desde acá es un rodeo. No sella nada: solo lleva. */}
        <button className="btn-primary focus__cerrar" onClick={() => navigate("/daily-shutdown")}>
          {/* La luna es el icono del shutdown en el sidebar: el botón dice a
           * dónde lleva antes de leerse. La flecha rebota para empujar hacia
           * allá —es el único paso siguiente de esta pantalla— y se queda
           * quieta con `prefers-reduced-motion`. */}
          <Moon size={15} />
          Cerrar el día
          <ArrowRight size={15} className="focus__flecha" />
        </button>
      </div>
    );
  }

  return (
    <div className="focus">
      {multi ? (
        <div
          className="focus__columns"
          style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
        >
          {visible.map((id) => {
            const t = taskOf(id);
            // Todavía cargando: la columna guarda su lugar vacía.
            if (!t) return <div key={id} className="focus__column" />;
            return (
              <div key={id} className="focus__column">
                <FocusTaskCard
                  task={t}
                  categories={categories}
                  reload={load}
                  onComplete={complete}
                  controls={controlsFor(t)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        current && (
          <FocusTaskCard
            key={current.id}
            task={current}
            categories={categories}
            reload={load}
            onComplete={complete}
            controls={controlsFor(current)}
          />
        )
      )}

      {/* Solo la siguiente tarea, como referencia. Para moverte, ↑/↓. Con
       * columnas es la primera de la cola que no tiene columna.
       * #20: acá va `<PlayControls taskId={next.id} size="sm" />`: su play en
       * paralelo es el que suma una columna desde la cola. */}
      <div className="focus__next">
        {next ? (
          <>
            <span className="focus__next-label">{notice ? "Aviso" : "Siguiente"}</span>
            <span className="focus__next-title">{next.title}</span>
            {next.estimatedMinutes != null && (
              <span className="focus__next-time">{formatMinutes(next.estimatedMinutes)}</span>
            )}
          </>
        ) : (
          <span className="focus__next-label">
            {multi ? "No queda nada más en la cola" : "Es la última de hoy"}
          </span>
        )}
        {!multi && (
          <span className="focus__next-hint">
            <ChevronUp size={12} />
            <ChevronDown size={12} />
          </span>
        )}
      </div>
    </div>
  );
}
