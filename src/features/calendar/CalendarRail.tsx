import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { Category, Task, DayWork } from "../../lib/types";
import { nowMinutes, weekdayLabel } from "../../lib/date";
import { buildRail, hourLabel, type BloqueRail } from "./railLayout";

/** Alto de una hora de grilla, en px. La geometría se calcula en minutos. */
const PX_POR_MINUTO = 1;

/** Lo mínimo que puede medir un bloque para seguir siendo legible y clickeable. */
const ALTO_MINIMO = 16;

/** Bajo este alto no cabe el título debajo de la hora: van en la misma línea. */
const ALTO_COMPACTO = 30;

interface Props {
  /** Día que muestra el rail, `"YYYY-MM-DD"`. */
  date: string;
  /** Hoy, para saber si corresponde dibujar la línea de la hora actual. */
  today: string;
  tasks: Task[];
  categoryMap: Map<number, Category>;
  workStart: string;
  workEnd: string;
  onOpen?: (task: Task) => void;
  /** Lo trabajado ese día, por tarea (`repo::day_work`). */
  work?: DayWork[];
  /** Segundos de la corrida en curso, para que su bloque crezca en vivo. */
  segundosEnCurso?: number;
  /** Modificador de la vista que lo monta (p. ej. `rail--overlay`). */
  className?: string;
  /**
   * Si viene, el rail es un panel que se puede cerrar y trae su botón.
   * También es lo que dice que necesita nombrar su día: montado fijo en Today la
   * fecha ya está en la cabecera de la vista, pero un panel que se abre sobre
   * siete columnas tiene que decir cuál está mostrando.
   */
  onClose?: () => void;
}

/**
 * Rail de calendario: la agenda del día al lado de la lista de tareas.
 *
 * Es una **columna de referencia, de solo lectura**: sirve para planificar
 * alrededor de las reuniones, no para reprogramarlas. Por eso no es zona de
 * drop —arrastrar acá tendría que escribir `scheduled_time`, y `boardCollision`
 * está afinada para el board— y por eso un bloque solo abre el detalle,
 * **también el de un evento ignorado** (§4.12): ese detalle es la única puerta
 * que le queda a una tarea sin tarjeta, y es donde vive el switch para dejar de
 * ignorarla. Hubo una versión con un popover propio para eso y se descartó:
 * agregaba un comportamiento que hay que aprender y le daba al rail un camino de
 * escritura, cuando el control de volver atrás ya estaba en el detalle.
 *
 * Recibe las tareas por props, las mismas que la columna del día, para que las
 * dos vistas del mismo día no puedan divergir. Daily planning (3.4) lo usa igual.
 */
export function CalendarRail({
  date,
  today,
  tasks,
  categoryMap,
  workStart,
  workEnd,
  onOpen,
  work,
  segundosEnCurso = 0,
  className,
  onClose,
}: Props) {
  const ahora = useMinutoActual();
  const esHoy = date === today;
  // En el día de hoy la proyección arranca en "ahora": lo que queda por delante
  // no empieza a las 9 de la mañana si ya son las 2 de la tarde.
  const rail = buildRail(tasks, workStart, workEnd, {
    ahoraMin: esHoy ? ahora : null,
    work,
    segundosEnCurso,
  });
  const porId = new Map(tasks.map((t) => [t.id, t]));

  const alto = (rail.hastaMin - rail.desdeMin) * PX_POR_MINUTO;
  const y = (min: number) => (min - rail.desdeMin) * PX_POR_MINUTO;

  const hours: number[] = [];
  for (let m = rail.desdeMin; m <= rail.hastaMin; m += 60) hours.push(m);

  // La grilla es de 24 h, así que al montar hay que llevarla a la jornada: si
  // no, el rail abre siempre en la medianoche y hay que bajar a mano.
  const scrollRef = useRef<HTMLDivElement>(null);
  // `jornadaDesdeMin` queda fuera de las dependencias **a propósito**: con él en
  // la lista, mover la hora de inicio en Configs le arrebataría el scroll a quien
  // esté leyendo el rail. Se lee el valor del momento en que corre el efecto.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al montar y al cambiar de día
  useEffect(() => {
    // En el frame siguiente: al correr el efecto el contenedor todavía puede no
    // tener alto —el flex de la vista no terminó de resolverse— y asignar
    // `scrollTop` sin overflow lo recorta a 0, dejando el rail en la medianoche.
    const id = requestAnimationFrame(() => {
      const cont = scrollRef.current;
      if (!cont) return;
      // Un poco antes del inicio de la jornada, para que se vea que hay día arriba.
      cont.scrollTop = Math.max(0, (rail.jornadaDesdeMin - 30) * PX_POR_MINUTO);
    });
    return () => cancelAnimationFrame(id);
    // Solo al montar y al cambiar de día: después manda el scroll del usuario.
  }, [date]);

  // Solo el día de hoy tiene "ahora"; en otro día la línea mentiría.
  const verAhora = esHoy && ahora >= rail.desdeMin && ahora <= rail.hastaMin;

  return (
    <aside className={`rail${className ? ` ${className}` : ""}`} aria-label="Agenda del día">
      {/* Dos cabeceras y no una, y la condición es la misma que decide si el rail
       * es un panel: montado fijo en Today la vista ya dice de qué día es y el
       * rótulo de una línea alcanza. Como panel usa `panel-head`, la cabecera
       * compartida con el backlog (`week.css`): los dos se abren en el mismo
       * lugar y se alternan, así que tienen que verse iguales. */}
      {onClose ? (
        <header className="panel-head">
          <div className="panel-head__row">
            <CalendarDays size={14} aria-hidden className="panel-head__icon" />
            <h2 className="panel-head__title">Agenda</h2>
            <button
              type="button"
              className="panel-head__close"
              onClick={onClose}
              aria-label="Cerrar la agenda"
            >
              <X size={15} />
            </button>
          </div>
          <p className="panel-head__sub">{weekdayLabel(date)}</p>
        </header>
      ) : (
        <div className="rail__head">
          <CalendarDays size={13} aria-hidden />
          <span>Agenda</span>
        </div>
      )}

      {rail.blocks.length === 0 && rail.todoElDia.length === 0 && (
        <p className="rail__vacio">El día está en blanco.</p>
      )}

      {rail.todoElDia.length > 0 && (
        <div className="rail__todoeldia">
          {rail.todoElDia.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`rail__chip${t.railOnly ? " is-ignorado" : ""}`}
              onClick={() => onOpen?.(t)}
              style={colorDe(t, categoryMap)}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      <div className="rail__scroll" ref={scrollRef}>
        <div className="rail__grid" style={{ height: `${alto}px` }}>
          {hours.map((m) => (
            <div key={m} className="rail__hora" style={{ top: `${y(m)}px` }}>
              <span className="rail__hora-label">{hourLabel(m)}</span>
              <span className="rail__hora-linea" />
            </div>
          ))}

          {/* Los bloques van en su propia pista y no sueltos en la grilla: un
           * absoluto se posiciona contra la **caja de padding** del ancestro,
           * así que el canal de las etiquetas de hora le es invisible y los
           * bloques se les montaban encima. La pista lo deja fuera. */}
          <div className="rail__pista">
            {rail.blocks.map((b) => {
              const t = porId.get(b.taskId);
              if (!t) return null;
              return (
                <button
                  // Compuesta: una tarea partida deja varios bloques, y con la
                  // sola `taskId` React descartaría todos menos el primero.
                  key={`${b.taskId}#${b.part}`}
                  type="button"
                  className={
                    "rail__bloque" +
                    (t.status === "DONE" ? " is-done" : "") +
                    (b.kind === "PROYECTADO" ? " is-proyectado" : "") +
                    (b.kind === "REAL" ? " is-real" : "") +
                    (t.railOnly ? " is-ignorado" : "") +
                    ((b.endMin - b.startMin) * PX_POR_MINUTO < ALTO_COMPACTO ? " is-corto" : "")
                  }
                  style={{ ...geometria(b, y), ...colorDe(t, categoryMap) }}
                  onClick={() => onOpen?.(t)}
                  title={
                    `${hourLabel(b.startMin)} – ${hourLabel(b.endMin)} · ${t.title}` +
                    (b.parts > 1 ? ` (tramo ${b.part} de ${b.parts})` : "") +
                    (b.kind === "PROYECTADO" ? " · proyectado" : "") +
                    (b.kind === "REAL" ? " · trabajado" : "") +
                    (t.railOnly ? " · ignorado" : "")
                  }
                >
                  <span className="rail__bloque-hora">
                    {hourLabel(b.startMin)}
                    {/* Sin esto, una tarea partida deja dos bloques idénticos a
                     * distinta hora y no hay cómo saber que son la misma. */}
                    {b.parts > 1 && (
                      <span className="rail__bloque-parte">
                        {b.part}/{b.parts}
                      </span>
                    )}
                  </span>
                  <span className="rail__bloque-titulo">{t.title}</span>
                </button>
              );
            })}

            {/* Las dos líneas de la jornada. No recortan nada: marcan que el
             * tiempo se acaba, y dejar el día completo visible es lo que
             * permite planificar fuera de horario sin pelear con la vista. */}
            <div
              className="rail__jornada"
              style={{ top: `${y(rail.jornadaDesdeMin)}px` }}
              aria-hidden
            />
            <div
              className="rail__jornada"
              style={{ top: `${y(rail.jornadaHastaMin)}px` }}
              aria-hidden
            />

            {verAhora && (
              <div className="rail__ahora" style={{ top: `${y(ahora)}px` }} aria-hidden>
                <span className="rail__ahora-punto" />
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

/**
 * Posición y ancho del bloque. Los carriles se reparten el ancho en porcentaje
 * para que el rail siga funcionando a cualquier ancho de ventana.
 */
function geometria(b: BloqueRail, y: (min: number) => number): React.CSSProperties {
  const ancho = 100 / b.lanes;
  return {
    top: `${y(b.startMin)}px`,
    // Altura mínima: una tarea de 10 minutos igual tiene que poder leerse y
    // clickearse. El solapamiento se calcula con los minutos reales, así que
    // esto es solo visual — y por eso el mínimo es bajo: cuanto más alto, más
    // se montan dos bloques cortos y consecutivos.
    height: `${Math.max((b.endMin - b.startMin) * PX_POR_MINUTO, ALTO_MINIMO)}px`,
    left: `calc(${b.carril * ancho}% + ${b.carril === 0 ? 0 : 2}px)`,
    width: `calc(${ancho}% - 2px)`,
  };
}

/**
 * El color del canal, o el neutro si la tarea no tiene.
 *
 * Solo tiñe el fondo y el borde; el texto se queda en `--ink`. Los tokens
 * `-ink` de la paleta están pensados para leerse sobre el pastel a fondo lleno,
 * y en tema oscuro un bloque chico con ese par queda ilegible.
 */
function colorDe(t: Task, categoryMap: Map<number, Category>): React.CSSProperties {
  const c = t.categoryId != null ? categoryMap.get(t.categoryId) : null;
  if (!c) return {};
  return {
    background: `color-mix(in srgb, var(--${c.color}) 18%, var(--surface-raised))`,
    borderLeftColor: `var(--${c.color})`,
  };
}

/**
 * Minutos desde medianoche, que avanzan solos.
 *
 * Se recalcula leyendo el reloj y no sumando: macOS agrupa los temporizadores
 * al suspender, así que el intervalo puede disparar tarde o no disparar; leer la
 * hora da el valor correcto se ejecute cuando se ejecute. Mismo criterio que
 * `checkDayChange` en `lib/day.ts`.
 */
function useMinutoActual(): number {
  const [min, setMin] = useState(nowMinutes);
  useEffect(() => {
    const id = setInterval(() => setMin(nowMinutes()), 30_000);
    return () => clearInterval(id);
  }, []);
  return min;
}
