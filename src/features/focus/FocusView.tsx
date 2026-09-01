import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, ChevronUp, Moon, Pause, Play } from "lucide-react";
import { useRef } from "react";
import { TimePicker } from "../../components/TimePicker";
import { Popover } from "../../components/Popover";
import { api } from "../../lib/ipc";
import type { LogDay, Task } from "../../lib/types";
import { nowHhmm, todayISO } from "../../lib/date";
import { formatMinutes, hours, hoursFromMinutes } from "../../lib/capacity";
import { celebrate } from "../../lib/confetti";
import { useTimer, hms } from "../timer/useTimer";
import { CalendarEventCard, hasCalendarData } from "../calendar/EventoDelCalendario";
import { NotesEditor } from "../tasks/NotesEditor";
import { useAutosave } from "../tasks/useAutosave";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { SunriseMark } from "../../components/SunriseMark";
import type { Category } from "../../lib/types";
import { Hash } from "lucide-react";
import { chipVars } from "../tasks/chipVars";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../lib/store";

/**
 * Focus Mode: solo la tarea actual.
 *
 * - Marcar el check la completa y pasa sola a la siguiente.
 * - Las flechas ↑/↓ mueven el foco entre las tareas del día.
 * - Al completar, la tarea se manda al final de la lista del día.
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
  const [picker, setPicker] = useState<null | "actual" | "planned" | "canal">(null);
  const actualRef = useRef<HTMLDivElement>(null);
  const plannedRef = useRef<HTMLDivElement>(null);
  const canalRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  /** Resumen del día, solo para la vista de "no queda nada". */
  const [dia, setDia] = useState<LogDay | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const q = await api.focusQueue(todayISO(), nowHhmm());
    setQueue(q);
    setIndex((i) => Math.min(i, Math.max(0, q.length - 1)));
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

  const opcionesCanal = useMemo<SearchOption[]>(() => {
    const out: SearchOption[] = [];
    for (const ctx of categories.filter((c) => c.parentId === null)) {
      out.push({ value: String(ctx.id), label: ctx.name, color: ctx.color });
      for (const ch of categories.filter((c) => c.parentId === ctx.id)) {
        out.push({ value: String(ch.id), label: `#${ch.name}`, hint: ctx.name, color: ch.color });
      }
    }
    return out;
  }, [categories]);

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
  useEffect(() => {
    if (focusTaskId == null || queue.length === 0) return;
    const i = queue.findIndex((t) => t.id === focusTaskId);
    if (i >= 0) setIndex(i);
    clearFocusTask();
  }, [queue, focusTaskId, clearFocusTask]);

  const current = queue[index] ?? null;

  // Antes de los returns tempranos: los hooks no pueden ser condicionales. Con
  // la cola vacía el id es 0 y no se guarda nada, porque no hay qué editar.
  const autosave = useAutosave(current?.id ?? 0, load);
  const next = queue[index + 1] ?? null;

  /** Completa la actual, la manda al final del día y avanza. */
  const complete = useCallback(async () => {
    if (!current) return;
    if (timer.active?.taskId === current.id) await timer.stop();

    const eraLaUltima = queue.length === 1;
    const lastPos = queue.reduce((m, t) => Math.max(m, t.position), 0);
    await api.setTaskStatus(current.id, "DONE");
    await api.moveTask(current.id, todayISO(), lastPos + 1);

    // `bumpData` no es cosmético acá: completar puede haber detenido el timer
    // (lo hace `set_task_status` en Rust), y sin el aviso el taxímetro de la
    // ventana flotante se quedaba ofreciendo retomar la tarea ya cerrada.
    bumpData();

    // La completada sale de la cola: el índice ya apunta a la siguiente.
    await load();

    // Solo al vaciar la cola, y solo desde acá: montar la vista con el día ya
    // terminado —volver a Focus más tarde— no vuelve a celebrarlo.
    if (eraLaUltima) celebrate();
  }, [current, queue, timer, load, bumpData]);

  // Navegación con flechas entre las tareas del día.
  useEffect(() => {
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
  }, [queue.length]);

  if (loading) return <div className="focus" />;

  if (!current) {
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

  const running = timer.active?.taskId === current.id;
  // Acumulado de la tarea + lo que va de la corrida: el mismo criterio que la
  // tarjeta y el modal. "Solo hoy" queda en el taxímetro.
  const elapsed = current.actualSeconds + (running ? timer.runTotal : 0);
  const planned = current.estimatedMinutes;
  const channel =
    current.categoryId != null ? categories.find((c) => c.id === current.categoryId) : null;

  return (
    <div className="focus">
      <div className="focus__card">
        {/* Dos filas y no una: el título es lo que se lee primero y con el canal
         * y los tiempos al lado quedaba estrangulado en una columna angosta,
         * peor mientras más largo. Arriba van los metadatos —canal a la
         * izquierda, tiempos y play a la derecha—; abajo el título, con todo el
         * ancho para él. */}
        <div className="focus__meta">
          {/* Canal editable: replanificar en Focus es normal —te sientas a
           * trabajar y te das cuenta de que la tarea era de otro contexto—.
           * Lo que NO está acá es eliminar: Focus es para trabajar, y un botón
           * de borrar al lado del play es un accidente esperando. */}
          <div className="chip-wrap" ref={canalRef}>
            {/* El mismo chip que la card y el modal —`.cat-tag` + `chipVars`—, no
             * una píldora con el color fijo de la app: el fondo teñido es por lo
             * que se reconoce el canal de reojo en el resto de las vistas. */}
            <button
              type="button"
              className={`cat-tag focus__canal${channel ? "" : " is-empty"}`}
              style={chipVars(channel)}
              aria-label="Cambiar canal"
              onClick={() => setPicker((p) => (p === "canal" ? null : "canal"))}
            >
              {channel ? `#${channel.name}` : <Hash size={13} />}
            </button>
            {picker === "canal" && (
              <Popover anchorRef={canalRef} onClose={() => setPicker(null)}>
                <SearchSelect
                  options={opcionesCanal}
                  value={current.categoryId != null ? String(current.categoryId) : null}
                  placeholder="Buscar canal…"
                  clearLabel="Sin canal"
                  onSelect={async (v) => {
                    setPicker(null);
                    await autosave.commit({ categoryId: v ? Number(v) : null });
                    await load();
                  }}
                />
              </Popover>
            )}
          </div>

          {/* Tiempos y play, alineados a la derecha en la misma fila */}
          <div className="focus__times">
            <div className="chip-wrap focus__time" ref={actualRef}>
              <button
                className="focus__time-btn"
                aria-label="Ajustar tiempo real"
                onClick={() => setPicker((p) => (p === "actual" ? null : "actual"))}
              >
                <span className="focus__time-label">Real</span>
                <span
                  className={`focus__time-value is-actual${
                    timer.overEstimate && running ? " is-over" : ""
                  }`}
                >
                  {hms(elapsed)}
                </span>
              </button>
              {picker === "actual" && (
                <Popover anchorRef={actualRef} align="right" onClose={() => setPicker(null)}>
                  <TimePicker
                    value={Math.round(current.actualSeconds / 60)}
                    clearLabel="Sin tiempo"
                    onSelect={async (mins) => {
                      setPicker(null);
                      await api.setActualSeconds(current.id, (mins ?? 0) * 60);
                      bumpData();
                      await load();
                    }}
                  />
                </Popover>
              )}
            </div>

            <div className="chip-wrap focus__time" ref={plannedRef}>
              <button
                className="focus__time-btn"
                aria-label="Ajustar tiempo estimado"
                onClick={() => setPicker((p) => (p === "planned" ? null : "planned"))}
              >
                <span className="focus__time-label">Estimado</span>
                <span className="focus__time-value">
                  {planned != null ? formatMinutes(planned) : "--:--"}
                </span>
              </button>
              {picker === "planned" && (
                <Popover anchorRef={plannedRef} align="right" onClose={() => setPicker(null)}>
                  <TimePicker
                    value={planned}
                    onSelect={async (mins) => {
                      setPicker(null);
                      await api.updateTask(current.id, { estimatedMinutes: mins });
                      bumpData();
                      await load();
                    }}
                  />
                </Popover>
              )}
            </div>

            <button
              className={`focus__play${running ? " is-running" : ""}`}
              aria-label={running ? "Pausar" : "Iniciar"}
              onClick={() => (running ? timer.stop() : timer.start(current.id))}
            >
              {running ? <Pause size={16} /> : <Play size={16} />}
            </button>
          </div>
        </div>

        <div className="focus__head">
          <button className="focus__check" aria-label="Completar tarea" onClick={complete}>
            <Check size={18} strokeWidth={3} />
          </button>
          <h1 className="focus__title">{current.title}</h1>
        </div>

        {timer.overEstimate && running && (
          <div className="focus__over">Pasaste el tiempo estimado — puedes seguir trabajando.</div>
        )}

        {/* El mismo detalle que el modal de la semana: hora, link de la reunión,
         * participantes y descripción. Es la vista en la que estás cuando
         * empieza la reunión, así que tener que abrir otra pantalla para saber
         * por dónde entrar no tiene sentido. */}
        <CalendarEventCard task={current} />

        {/* La línea de arriba solo cuando hay tarjeta del calendario que separar:
         * en una tarea escrita a mano dejaba dos líneas paralelas con nada en
         * medio. */}
        <div className={`focus__notas${hasCalendarData(current) ? " has-event" : ""}`}>
          <NotesEditor
            value={current.notes ?? ""}
            onDebounced={(v) => autosave.commitDebounced({ notes: v })}
            onBlurSave={(v) => void autosave.commit({ notes: v })}
          />
        </div>
      </div>

      {/* Solo la siguiente tarea, como referencia. Para moverte, ↑/↓. */}
      <div className="focus__next">
        {next ? (
          <>
            <span className="focus__next-label">Siguiente</span>
            <span className="focus__next-title">{next.title}</span>
            {next.estimatedMinutes != null && (
              <span className="focus__next-time">{formatMinutes(next.estimatedMinutes)}</span>
            )}
          </>
        ) : (
          <span className="focus__next-label">Es la última de hoy</span>
        )}
        <span className="focus__next-hint">
          <ChevronUp size={12} />
          <ChevronDown size={12} />
        </span>
      </div>
    </div>
  );
}
