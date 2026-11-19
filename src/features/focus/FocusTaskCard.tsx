import { useMemo, useRef, useState } from "react";
import { Check, Hash } from "lucide-react";
import { TimePicker } from "../../components/TimePicker";
import { Popover } from "../../components/Popover";
import { SearchSelect } from "../../components/SearchSelect";
import { api } from "../../lib/ipc";
import type { Category, Task } from "../../lib/types";
import { formatMinutes } from "../../lib/capacity";
import { channelLabel } from "../../lib/channelLabel";
import { useAppStore } from "../../lib/store";
import { useTimer, hms, isOverEstimate } from "../timer/useTimer";
import { CalendarEventCard, hasCalendarData } from "../calendar/EventoDelCalendario";
import { NotesEditor } from "../tasks/NotesEditor";
import { useAutosave } from "../tasks/useAutosave";
import { chipVars } from "../tasks/chipVars";
import { channelOptions } from "../tasks/channelOptions";

interface Props {
  task: Task;
  categories: Category[];
  /** Recarga lo que muestra Focus después de una edición. */
  reload: () => Promise<void>;
  /** Check: completa la tarea. Qué pasa después lo decide `FocusView`. */
  onComplete: (task: Task) => void | Promise<void>;
  /**
   * Los controles del timer de esta tarjeta. Los pone `FocusView` porque lo que
   * hace la pausa depende de cuántas columnas hay (§4.7), no de la tarjeta.
   */
  controls: React.ReactNode;
}

/**
 * Una tarea en Focus: canal, tiempos, controles del timer, check, título, aviso
 * de estimado excedido, la tarjeta del calendario y las notas.
 *
 * Es **la misma tarjeta** con una columna que con tres: con una se ve
 * exactamente como Focus antes de los timers en paralelo, y con varias cada
 * columna es una de estas. Va con `key={task.id}` desde afuera, así que los
 * popovers, el autosave y su `flush` al desmontar son de una sola tarea.
 */
export function FocusTaskCard({ task, categories, reload, onComplete, controls }: Props) {
  const timer = useTimer();
  const bumpData = useAppStore((s) => s.bumpData);
  const [picker, setPicker] = useState<null | "actual" | "planned" | "canal">(null);
  const actualRef = useRef<HTMLDivElement>(null);
  const plannedRef = useRef<HTMLDivElement>(null);
  const canalRef = useRef<HTMLDivElement>(null);
  const autosave = useAutosave(task.id, reload);
  const channelOpts = useMemo(() => channelOptions(categories), [categories]);

  const running = timer.isRunning(task.id);
  // Acumulado de la tarea + lo que va de la corrida: el mismo criterio que la
  // tarjeta y el modal. "Solo hoy" queda en el taxímetro.
  const elapsed = task.actualSeconds + timer.runTotalOf(task.id);
  // **Por tarea**, no `timer.overEstimate`: ese mira solo el primero de los que
  // corren, y con columnas cada una avisa por su propia promesa —la misma regla
  // que la campana (§4.6), que también suena por tarea—.
  const over = running && isOverEstimate(timer.elapsedById[task.id] ?? 0, task.estimatedMinutes);
  const planned = task.estimatedMinutes;
  const channel = task.categoryId != null ? categories.find((c) => c.id === task.categoryId) : null;

  return (
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
            {channel ? channelLabel(channel.name) : <Hash size={13} />}
          </button>
          {picker === "canal" && (
            <Popover anchorRef={canalRef} onClose={() => setPicker(null)}>
              <SearchSelect
                options={channelOpts}
                value={task.categoryId != null ? String(task.categoryId) : null}
                placeholder="Buscar canal…"
                clearLabel="Sin canal"
                onSelect={async (v) => {
                  setPicker(null);
                  await autosave.commit({ categoryId: v ? Number(v) : null });
                  await reload();
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
              <span className={`focus__time-value is-actual${over ? " is-over" : ""}`}>
                {hms(elapsed)}
              </span>
            </button>
            {picker === "actual" && (
              <Popover anchorRef={actualRef} align="right" onClose={() => setPicker(null)}>
                <TimePicker
                  value={Math.round(task.actualSeconds / 60)}
                  clearLabel="Sin tiempo"
                  onSelect={async (mins) => {
                    setPicker(null);
                    await api.setActualSeconds(task.id, (mins ?? 0) * 60);
                    bumpData();
                    await reload();
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
                    await api.updateTask(task.id, { estimatedMinutes: mins });
                    bumpData();
                    await reload();
                  }}
                />
              </Popover>
            )}
          </div>

          {controls}
        </div>
      </div>

      <div className="focus__head">
        <button
          className="focus__check"
          aria-label="Completar tarea"
          onClick={() => void onComplete(task)}
        >
          <Check size={18} strokeWidth={3} />
        </button>
        <h1 className="focus__title">{task.title}</h1>
      </div>

      {over && (
        <div className="focus__over">Pasaste el tiempo estimado — puedes seguir trabajando.</div>
      )}

      {/* El mismo detalle que el modal de la semana: hora, link de la reunión,
       * participantes y descripción. Es la vista en la que estás cuando
       * empieza la reunión, así que tener que abrir otra pantalla para saber
       * por dónde entrar no tiene sentido. */}
      <CalendarEventCard task={task} />

      {/* La línea de arriba solo cuando hay tarjeta del calendario que separar:
       * en una tarea escrita a mano dejaba dos líneas paralelas con nada en
       * medio. */}
      <div className={`focus__notas${hasCalendarData(task) ? " has-event" : ""}`}>
        <NotesEditor
          value={task.notes ?? ""}
          onDebounced={(v) => autosave.commitDebounced({ notes: v })}
          onBlurSave={(v) => void autosave.commit({ notes: v })}
        />
      </div>
    </div>
  );
}
