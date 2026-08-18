import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Lock, Moon, PieChart, Plus, Timer, Unlock, X } from "lucide-react";
import { api } from "../../lib/ipc";
import type { LogDay } from "../../lib/types";
import { dateLabel, weekdayLabel } from "../../lib/date";
import { formatMinutes } from "../../lib/capacity";
import { groupBy } from "../../lib/segmentos";
import { useToday } from "../../lib/day";
import { useAppStore } from "../../lib/store";
import { useBoard } from "../tasks/useBoard";
import { useTimer } from "../timer/useTimer";
import { Donut } from "../../components/Donut";
import { TaskCardStatic } from "../week/TaskCard";
import { TaskModal } from "../tasks/TaskModal";
import { celebrate } from "../../lib/confetti";
import { MoodPicker } from "./MoodPicker";
import { highlights, segmentSeconds, workedWithRunning } from "./dailyLog";
import "./shutdown.css";

/** `5400` → `'1:30'`. Mismo formato de contador que las cards del tablero. */
function reloj(seconds: number): string {
  return formatMinutes(Math.max(0, seconds) / 60);
}

/**
 * El cierre del día: mirar qué hice, elegir qué vale la pena contar, y darlo por
 * terminado.
 *
 * **No es obligatorio.** La bitácora (§4.16) se llena sola con o sin este paso;
 * lo que agrega el shutdown es lo que no puede salir de la base: tus palabras y
 * qué merece mención. Por eso el botón del final no guarda nada —todo se
 * autoguarda al salir del campo— sino que **sella** el día (`closed_at`).
 *
 * Los highlights son las tareas que **subiste** con "Incluir"; el resto queda en
 * "otras actividades", visible pero sin resumen. Incluir y escribir son gestos
 * distintos: una tarea recién incluida no tiene texto todavía, y borrar el texto
 * no la baja.
 */
export function DailyShutdownView() {
  const today = useToday();
  const navigate = useNavigate();
  const board = useBoard(today, today);
  const bumpData = useAppStore((s) => s.bumpData);
  const { runTotal } = useTimer();

  const [day, setDia] = useState<LogDay | null>(null);
  const [nota, setNota] = useState("");
  const [notasTarea, setNotasTarea] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const dataVersion = useAppStore((s) => s.dataVersion);
  /**
   * Los campos con texto sin guardar (`"dia"` o `"t:<id>"`).
   *
   * `load` corre con **cada** invalidación —incluir una tarea, tildar otra, mover
   * una pendiente, un aviso de la otra ventana—, y sembrar los campos desde el
   * servidor pisaba lo que estabas escribiendo. Es el precio de tener texto libre
   * en una vista que se recarga sola: los campos sucios no se tocan hasta que se
   * guardan.
   */
  const sucios = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [d] = await api.dailyLog(today, 1);
    if (!d) return;
    setDia(d);
    if (!sucios.current.has("dia")) setNota(d.note ?? "");
    setNotasTarea((previas) => {
      const delServidor: Record<number, string> = Object.fromEntries(
        d.done.filter((h) => h.note != null).map(({ task, note }) => [task.id, note ?? ""]),
      );
      for (const id of Object.keys(previas)) {
        if (sucios.current.has(`t:${id}`)) delServidor[Number(id)] = previas[Number(id)];
      }
      return delServidor;
    });
  }, [today]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const catMap = board.categoryMap;
  const pending = useMemo(
    () => board.tasks.filter((t) => t.status === "TODO" && t.scheduledDate === today),
    [board.tasks, today],
  );
  // `destacadas` devuelve **todas** en `mostradas` cuando no hay ninguna incluida,
  // para que la bitácora no se vea vacía. Acá hace falta lo contrario: si todavía
  // no subiste nada, los highlights están vacíos y todo va a "otras actividades".
  const hayIncluidas = day?.done.some((h) => h.note != null) ?? false;
  const { shown, others } = useMemo(
    () => (day ? highlights(day) : { shown: [], others: [] }),
    [day],
  );
  const incluidas = hayIncluidas ? shown : [];
  const sinIncluir = hayIncluidas ? others : (day?.done ?? []);
  const channels = useMemo(() => (day ? groupBy(day.cells, catMap, false) : []), [day, catMap]);

  const guardarNota = async () => {
    sucios.current.delete("dia");
    if ((day?.note ?? "") === nota.trim()) return;
    await api.setDayNote(today, nota);
    bumpData();
  };

  const guardarNotaTarea = async (taskId: number) => {
    sucios.current.delete(`t:${taskId}`);
    const previo = day?.done.find((h) => h.task.id === taskId)?.note ?? "";
    const actual = notasTarea[taskId] ?? "";
    if (previo === actual.trim()) return;
    await api.setDayTaskNote(today, taskId, actual);
    bumpData();
  };

  const guardarMood = async (m: string | null) => {
    await api.setDayMood(today, m);
    bumpData();
  };

  const incluir = async (taskId: number) => {
    await api.includeInLog(today, taskId);
    bumpData();
  };

  const remove = async (taskId: number) => {
    await api.removeFromLog(today, taskId);
    bumpData();
  };

  const close = async () => {
    // La nota primero: cerrar sin guardarla perdería lo último que se escribió
    // si el foco todavía estaba en el campo.
    await api.setDayNote(today, nota);
    await api.closeDay(today);
    bumpData();
    celebrate();
    navigate("/daily-highlights");
  };

  const reabrir = async () => {
    await api.reopenDay(today);
    bumpData();
  };

  const isClosed = day?.closedAt != null;
  const worked = day ? workedWithRunning(day, runTotal) : 0;
  const selectedTask = board.tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="shutdown">
      {/* Los chips a la derecha: son la ficha del día, no su encabezado. */}
      <header className="shutdown__head">
        {day && (
          <div className="review__cifras shutdown__chips">
            <span className="chip-cifra">
              <span className="chip-cifra__punto" style={{ background: "var(--sage-ink)" }} />
              <strong>{reloj(worked)}</strong> worked
            </span>
            <span className="chip-cifra">
              <span className="chip-cifra__punto" style={{ background: "var(--faint)" }} />
              <strong>{formatMinutes(day.plannedMinutes)}</strong> planned
            </span>
            <span className="chip-cifra">
              <span className="chip-cifra__punto" style={{ background: "var(--mint-ink)" }} />
              <strong>{day.done.length}</strong> cerradas
            </span>
          </div>
        )}
      </header>

      <div className="shutdown__cuerpo">
        <div className="shutdown__centro">
          {/* El día es el título, y el resumen se escribe acá mismo. */}
          <div className="entrada__cabecera">
            <h1 className="entrada__dia">
              {weekdayLabel(today)}
              <span className="entrada__fecha">{dateLabel(today)}</span>
              <MoodPicker value={day?.mood ?? null} onElegir={guardarMood} />
            </h1>
            <textarea
              className="entrada__resumen"
              rows={2}
              placeholder="El día estuvo…"
              aria-label="Cómo estuvo el día"
              value={nota}
              onChange={(e) => {
                sucios.current.add("dia");
                setNota(e.target.value);
              }}
              onBlur={guardarNota}
            />
          </div>

          {/* Highlights: lo que elegiste contar. */}
          <section className="entrada__bloque">
            <h2 className="entrada__h2">Highlights</h2>
            <p className="entrada__lema">De todo lo de hoy, ¿qué vale la pena recordar?</p>
            {incluidas.length === 0 ? (
              <p className="review__vacio">
                Nada subido todavía. Incluye abajo lo que quieras contar.
              </p>
            ) : (
              <ul className="hitos hitos--edit">
                {incluidas.map(({ task }) => {
                  const ch = task.categoryId != null ? catMap.get(task.categoryId) : undefined;
                  return (
                    <li key={task.id}>
                      <span
                        className="hitos__punto"
                        style={ch ? { background: `var(--${ch.color}-ink)` } : undefined}
                      />
                      <div className="hitos__caja">
                        <div className="hitos__fila">
                          <div className="hitos__cuerpo">
                            {ch && <span className="hitos__channel">#{ch.name}</span>}
                            <button
                              className="hitos__titulo hitos__link"
                              onClick={() => setSelectedId(task.id)}
                            >
                              {task.title}
                            </button>
                          </div>
                          <button
                            className="btn-icon"
                            title="Sacar de los highlights"
                            aria-label={`Sacar ${task.title} de los highlights`}
                            onClick={() => remove(task.id)}
                          >
                            <X size={13} aria-hidden />
                          </button>
                        </div>
                        <textarea
                          className="hitos__resumen"
                          rows={1}
                          placeholder="Resumen…"
                          aria-label={`Resumen de ${task.title}`}
                          value={notasTarea[task.id] ?? ""}
                          onChange={(e) => {
                            sucios.current.add(`t:${task.id}`);
                            setNotasTarea((n) => ({ ...n, [task.id]: e.target.value }));
                          }}
                          onBlur={() => guardarNotaTarea(task.id)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Otras actividades: el resto del día, con la puerta para subirlo. */}
          <section className="entrada__bloque">
            <h2 className="entrada__h2">Otras actividades</h2>
            <p className="entrada__lema">Lo demás que cerraste hoy. Sube lo que quieras.</p>
            {sinIncluir.length === 0 ? (
              <p className="review__vacio">
                {day?.done.length ? "Ya subiste todo." : "Todavía no cerraste nada hoy."}
              </p>
            ) : (
              <ul className="hitos">
                {sinIncluir.map(({ task }) => {
                  const ch = task.categoryId != null ? catMap.get(task.categoryId) : undefined;
                  return (
                    <li key={task.id}>
                      <span
                        className="hitos__punto is-tenue"
                        style={ch ? { background: `var(--${ch.color})` } : undefined}
                      />
                      <div className="hitos__fila">
                        <div className="hitos__cuerpo">
                          {ch && <span className="hitos__channel">#{ch.name}</span>}
                          <button
                            className="hitos__titulo hitos__link"
                            onClick={() => setSelectedId(task.id)}
                          >
                            {task.title}
                          </button>
                        </div>
                        <button className="incluir" onClick={() => incluir(task.id)}>
                          <Plus size={12} aria-hidden /> Incluir
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Qué quedó, y a dónde va. */}
          <section className="entrada__bloque">
            <h2 className="entrada__h2">Qué quedó pendiente</h2>
            <p className="entrada__lema">
              Se replanifica en el daily planning; acá solo se mira.
            </p>
            {pending.length === 0 ? (
              <p className="review__vacio">No quedó nada abierto. Buen día.</p>
            ) : (
              <div className="shutdown__pendientes">
                {pending.map((t) => (
                  <div key={t.id} className="repaso__row">
                    <TaskCardStatic
                      task={t}
                      category={t.categoryId != null ? catMap.get(t.categoryId) : null}
                      categories={board.categories}
                      onToggle={board.toggleTask}
                      onOpen={(x) => setSelectedId(x.id)}
                      onPatch={board.patchTask}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="shutdown__pie">
            {isClosed ? (
              <>
                <span className="shutdown__sello">
                  <Lock size={13} aria-hidden /> Cerraste este día
                </span>
                <button className="steps__pill" onClick={reabrir}>
                  <Unlock size={13} aria-hidden /> Reabrir
                </button>
              </>
            ) : (
              <>
                <span className="shutdown__hint">
                  Si no lo cierras, el día queda como borrador en la bitácora.
                </span>
                <button className="btn-primary" onClick={close}>
                  <Moon size={14} aria-hidden /> Cerrar el día
                </button>
              </>
            )}
          </div>
        </div>

        {/* La ficha del día, igual que en la bitácora. */}
        {day && (
          <aside className="dia__der">
            <div className="dia__tl">
              <span className="dia__rotulo">
                <Clock size={10} aria-hidden /> Timeline
              </span>
              {day.timeline.length === 0 ? (
                <p className="review__vacio">Sin tiempo trackeado.</p>
              ) : (
                <ul>
                  {day.timeline.map((t) => (
                    <li key={t.taskId} className={t.running ? "is-running" : ""}>
                      <span className="dia__tlTitle">{t.title}</span>
                      <span className="dia__tlDur">
                        {t.running && <Timer size={9} aria-hidden />}
                        {reloj(segmentSeconds(t, runTotal))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Acá el donut va **siempre abierto**, al revés que en la bitácora:
                el shutdown es el momento de mirar cómo se repartió el día, y la
                bitácora es un archivo que se hojea. */}
            {channels.length > 0 && (
              <div className="dia__analytics">
                <span className="dia__rotulo">
                  <PieChart size={10} aria-hidden /> Channels
                </span>
                <div className="dia__donut">
                  <Donut segments={channels} total={day.workedSeconds} />
                  <ul className="leyenda">
                    {channels.map((c) => (
                      <li key={c.key}>
                        <span className="leyenda__punto" style={{ background: c.color }} />
                        <span className="leyenda__nombre">{c.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          categories={board.categories}
          objectives={board.objectives}
          onClose={() => setSelectedId(null)}
          onChanged={board.reload}
        />
      )}
    </div>
  );
}
