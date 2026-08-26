import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task } from "../../lib/types";
import { isoWeekId, parseISODate, shiftWeeks, todayISO, weekDates } from "../../lib/date";
import { useToday } from "../../lib/day";
import { useAppStore } from "../../lib/store";
import { Popover } from "../../components/Popover";
import { SearchSelect } from "../../components/SearchSelect";
import { ObjectiveModal } from "../objectives/ObjectiveModal";
import {
  historyByWeek,
  streak,
  weekAnchorsBackFrom,
  type SemanaDeObjetivos,
} from "../objectives/objectiveHistory";

/** Cuántas semanas mira el histórico, contando la que se está viendo. */
const HISTORY_WEEKS = 8;

export function WeeklyPlanningView() {
  // Ancla movible, igual que la de la weekly review. Antes era un `useMemo` con
  // deps vacías, o sea `new Date()` congelado: los objetivos de cualquier otra
  // semana no se podían ni ver ni corregir.
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const isoWeek = isoWeekId(anchor);
  const esSemanaActual = dates.includes(todayISO());
  // `useToday` y no `new Date()` suelto: una sesión abierta cruza la medianoche
  // sin enterarse, y con la fecha congelada el botón de traer apuntaría a una
  // semana que ya pasó.
  const hoy = useToday();
  const semanaDeHoy = isoWeekId(parseISODate(hoy));

  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [historia, setHistoria] = useState<SemanaDeObjetivos[]>([]);
  /** Qué objetivo está en el segundo paso de "eliminar". */
  const [confirmando, setConfirmando] = useState<number | null>(null);
  /**
   * Qué filas están desplegadas. Plegadas por default: lo que se compara de un
   * vistazo es el avance, y las tareas son el detalle que se abre cuando toca
   * trabajar en uno.
   */
  const [desplegados, setDesplegados] = useState<Set<number>>(new Set());
  const alternar = (id: number) =>
    setDesplegados((previo) => {
      const next = new Set(previo);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const openCompose = useAppStore((s) => s.openCompose);
  const bumpData = useAppStore((s) => s.bumpData);
  const dataVersion = useAppStore((s) => s.dataVersion);

  /**
   * Las 8 semanas de la tira, ancladas a **hoy** y no a la semana que se está
   * mirando.
   *
   * Con la ventana colgada del ancla, moverse una semana atrás la corría también:
   * la tira dejaba de mostrar las semanas recientes —incluida la única con
   * objetivos— y con eso se perdía la forma de volver clickeando. Anclada a hoy es
   * un control de navegación estable: siempre las mismas ocho, y la que estás
   * mirando se marca cuando cae adentro.
   */
  const anclas = useMemo(() => weekAnchorsBackFrom(parseISODate(hoy), HISTORY_WEEKS), [hoy]);

  const load = useCallback(async () => {
    const semanas = anclas.map(isoWeekId);
    const [objs, list, cats, rango] = await Promise.all([
      api.listObjectives(isoWeek),
      api.listTasksForRange(dates[0], dates[6]),
      api.listCategories(),
      api.listObjectivesRange(semanas[0], semanas[semanas.length - 1]),
    ]);
    setObjectives(objs);
    setTasks(list);
    setCategories(cats);
    setHistoria(historyByWeek(semanas, rango));
  }, [anclas, isoWeek, dates]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Una confirmación de borrado colgada apuntaría a un objetivo que ya no está en
  // pantalla.
  useEffect(() => {
    setConfirmando(null);
    setDesplegados(new Set());
  }, [isoWeek]);

  const unassigned = tasks.filter((t) => t.objectiveId == null);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const objetivoAbierto = objectives.find((o) => o.id === abierto) ?? null;
  const racha = streak(historia);
  const conObjetivos = historia.filter((s) => s.total > 0).length;

  /**
   * Crea con un nombre genérico y abre el detalle de una.
   *
   * No hay campo intermedio a propósito: ponerle nombre es lo primero que se hace
   * dentro del modal, y ahí además está el channel y el reparto de horas, así que
   * un input aparte solo agregaba un paso para llegar al mismo lugar. El precio
   * es que un objetivo abandonado a medio crear queda llamándose "Nuevo objetivo"
   * — visible y corregible, que es mejor que uno en blanco.
   *
   * El `load()` va **antes** de abrir: el modal se resuelve buscando el objetivo
   * en `objectives`, así que sin recargar primero abriría sobre una lista que
   * todavía no lo tiene.
   */
  const addObjective = async () => {
    const o = await api.createObjective(isoWeek, "Nuevo objetivo");
    await load();
    setAbierto(o.id);
    bumpData();
  };
  const toggleObj = async (o: Objective) => {
    await api.updateObjective(o.id, { completed: !o.completed });
    bumpData();
  };
  const removeObj = async (id: number) => {
    await api.deleteObjective(id);
    setConfirmando(null);
    bumpData();
  };
  /**
   * Mueve el objetivo a la semana en curso. Sus tareas **no** se mueven (§4.29).
   *
   * Y **lleva la vista con él**: el destino es la semana actual, no la que se está
   * mirando, así que sin el salto el objetivo desaparecería de la pantalla al
   * apretar el botón y el gesto se leería como un borrado.
   */
  const traerAEstaSemana = async (o: Objective) => {
    await api.updateObjective(o.id, { isoWeek: semanaDeHoy });
    setAnchor(parseISODate(hoy));
    bumpData();
  };
  const toggleTask = async (t: Task) => {
    await api.setTaskStatus(t.id, t.status === "DONE" ? "TODO" : "DONE");
    bumpData();
  };
  const assign = async (taskId: number, objectiveId: number) => {
    await api.updateTask(taskId, { objectiveId });
    bumpData();
  };

  return (
    <div className="planning">
      <div className="planning__head">
        <div>
          {/* Con icono y a 22px, como los `h1` de la weekly review y del ritual
              diario. `CalendarRange` es el mismo del sidebar: se llega desde ahí y
              la marca tiene que ser la misma. `Target` está tomado por las filas
              de objetivo, y repetirlo diluiría las dos. */}
          <h1 className="planning__title">
            <CalendarRange size={20} aria-hidden /> Weekly planning
          </h1>
          <p className="planning__sub">
            Semana {isoWeek}. Define objetivos, asígnales tareas y sigue el progreso.
          </p>
          {/* El recordatorio del foco es fijo y no un aviso al pasarse de tres:
              regañar después de que alguien escribió el cuarto llega tarde y se
              siente como un reto. Acá se lee **antes** de empezar, que es cuando
              todavía se puede elegir.

              Y dice **sugerencia**, no regla: nada en la app limita la cantidad, y
              un texto que suene a límite prometería una validación que no existe. */}
          <p className="planning__foco">
            Como sugerencia, 3 como máximo, pero eres libre de setear los que quieras
          </p>
        </div>

        <div className="planning__acciones">
          <div className="planning__nav">
            <button
              className="btn-icon"
              aria-label="Semana anterior"
              onClick={() => setAnchor((a) => shiftWeeks(a, -1))}
            >
              <ChevronLeft size={15} aria-hidden />
            </button>
            <button
              className="steps__pill"
              disabled={esSemanaActual}
              onClick={() => setAnchor(new Date())}
            >
              Esta semana
            </button>
            <button
              className="btn-icon"
              aria-label="Semana siguiente"
              onClick={() => setAnchor((a) => shiftWeeks(a, 1))}
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
          <button className="btn-primary" onClick={addObjective}>
            <Plus size={14} aria-hidden /> Nuevo objetivo
          </button>
        </div>
      </div>

      {/* La tira de semanas va **arriba**: es el contexto con el que uno decide
          qué proponerse, no un resumen de cierre. Abajo, además, rebotaba — el
          estado vacío y la tira tienen alturas distintas, así que la vista saltaba
          según si las últimas semanas tenían objetivos. Por eso ahora **siempre se
          dibuja la tira**, con las semanas sin objetivos huecas: una sola forma,
          una sola altura. */}
      <section className="plan-racha">
        <div className="plan-racha__cifra">
          <strong>{conObjetivos}</strong>
          <span>
            de {HISTORY_WEEKS} semanas
            <br />
            con objetivos
          </span>
        </div>
        {racha > 0 && (
          <p className="plan-racha__streak">
            <Flame size={13} aria-hidden />
            {racha} {racha === 1 ? "semana seguida" : "semanas seguidas"} cumpliendo todo
          </p>
        )}
        {/* Cuadros chicos tintados por avance, no barras: a este tamaño la
            intensidad se lee de un vistazo y una barra de 44px con 3px de relleno
            no. Sin el `done/total` bajo cada uno — ocho fracciones son ruido, y el
            dato completo va en el `aria-label` y en el tooltip. */}
        <div className="plan-racha__tira">
          {historia.map((s, i) => {
            const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
            const detalle = s.total === 0 ? "sin objetivos" : `${s.done} de ${s.total} objetivos`;
            return (
              <button
                key={s.isoWeek}
                className={`plan-racha__semana${s.isoWeek === isoWeek ? " is-current" : ""}${
                  s.total === 0 ? " is-vacia" : ""
                }`}
                // Clickeable: es lo que le da un trabajo a la tira más allá de
                // decorar — es la forma rápida de ir a mirar una semana floja.
                aria-label={`Ir a ${s.isoWeek}: ${detalle}`}
                aria-current={s.isoWeek === isoWeek}
                title={`${s.isoWeek} · ${detalle}`}
                onClick={() => setAnchor(anclas[i])}
                style={{
                  // El tinte por proporción va inline porque es un valor continuo:
                  // una clase por escalón mentiría sobre el dato.
                  //
                  // Acotado a 12–40% y no 0–100: el número de la semana va
                  // **encima** del tinte, y a full el lavanda se lo come. El techo
                  // sale de medir el contraste en los dos temas y quedarse con el
                  // peor: en claro el texto es oscuro y más tinte lo ayuda, pero en
                  // oscuro el texto es claro y más tinte lo tapa — así que el que
                  // manda es el oscuro. El rango conserva el orden, que es lo único
                  // que la tira promete; el dato exacto está en el tooltip.
                  background:
                    pct > 0
                      ? `color-mix(in srgb, var(--lavender-ink) ${12 + pct * 0.28}%, transparent)`
                      : undefined,
                }}
              >
                <span className="plan-racha__id">{s.isoWeek.replace(/^\d+-/, "")}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="planning__seccion">Objetivos de la semana</h2>
        {/* Una fila de una línea por objetivo, y las tareas al desplegar.
            Se probaron dos columnas de cards y no convencieron: son tres o cuatro
            objetivos por semana, así que las cards desperdiciaban ancho y
            obligaban a comparar el avance saltando de una a otra. En filas caben
            todas sin scroll, los avances quedan uno debajo del otro —que es como
            se comparan— y el problema de alturas desiguales desaparece: todas las
            filas miden lo mismo. */}
        {objectives.length === 0 ? (
          // La lista **no se dibuja vacía**: `.plan-lista` tiene borde propio, así
          // que un contenedor sin filas dejaba una línea suelta bajo el texto.
          <p style={{ color: "var(--muted)" }}>Aún no hay objetivos esta semana.</p>
        ) : (
          <div className="plan-lista">
            {objectives.map((o) => {
              const objTasks = tasks.filter((t) => t.objectiveId === o.id);
              const doneCount = objTasks.filter((t) => t.status === "DONE").length;
              const pct = objTasks.length ? Math.round((doneCount / objTasks.length) * 100) : 0;
              const channel = o.categoryId != null ? catMap.get(o.categoryId) : null;
              const abiertoAqui = desplegados.has(o.id);
              return (
                <div key={o.id} className={`plan-fila${o.completed ? " is-done" : ""}`}>
                  <div className="plan-fila__head">
                    <button
                      className="plan-fila__caret"
                      aria-label={abiertoAqui ? `Plegar ${o.title}` : `Desplegar ${o.title}`}
                      aria-expanded={abiertoAqui}
                      onClick={() => alternar(o.id)}
                    >
                      <ChevronRight size={13} aria-hidden />
                    </button>
                    <Target size={14} aria-hidden style={{ color: "var(--apricot-ink)" }} />
                    {/* El título abre el detalle: es donde vive el reparto de horas. */}
                    <button className="plan-fila__title-btn" onClick={() => setAbierto(o.id)}>
                      {o.title}
                    </button>
                    {channel && <span className="plan-fila__channel">{`#${channel.name}`}</span>}
                    {/* La barra va en la fila y con ancho fijo: apiladas en la misma
                      columna, los avances se comparan sin leer un solo número. */}
                    <div
                      className="plan-fila__progress"
                      role="img"
                      aria-label={`${doneCount} de ${objTasks.length} tareas`}
                    >
                      <div className="plan-fila__bar" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="plan-fila__count">
                      {doneCount}/{objTasks.length}
                    </span>
                    {/* Traer a la semana actual: solo mirando una semana pasada, que
                      es donde uno se topa con el objetivo que quedó atrás. Mismo
                      gesto que "traer a hoy" del ritual diario. */}
                    {isoWeek < semanaDeHoy && (
                      <button
                        className="btn-icon"
                        aria-label={`Traer ${o.title} a la semana actual`}
                        title="Traer a la semana actual"
                        onClick={() => traerAEstaSemana(o)}
                      >
                        <ArrowRight size={14} aria-hidden />
                      </button>
                    )}
                    <button
                      className="obj-chip__check"
                      aria-label={o.completed ? "Reabrir objetivo" : "Completar objetivo"}
                      onClick={() => toggleObj(o)}
                      style={
                        o.completed
                          ? {
                              background: "var(--mint-ink)",
                              borderColor: "var(--mint-ink)",
                            }
                          : undefined
                      }
                    >
                      {o.completed && <Check size={11} strokeWidth={3} />}
                    </button>
                    <button
                      className="set-row__icon is-danger"
                      aria-label={`Eliminar ${o.title}`}
                      onClick={() => setConfirmando(o.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Confirmación en dos pasos en la propia fila, no un diálogo: es
                    el patrón del proyecto para borrar (ver `Dialog.tsx`), y borrar
                    un objetivo se lleva el reparto de la semana. */}
                  {confirmando === o.id && (
                    <div className="confirm plan-fila__confirm">
                      <span>¿Eliminar este objetivo?</span>
                      <button className="btn-ghost" onClick={() => setConfirmando(null)}>
                        Cancelar
                      </button>
                      <button className="btn-danger is-solid" onClick={() => removeObj(o.id)}>
                        Sí, eliminar
                      </button>
                    </div>
                  )}

                  {abiertoAqui && (
                    <div className="plan-fila__cuerpo">
                      {objTasks.length === 0 && (
                        <p className="plan-fila__vacio">Todavía no hay tareas acá.</p>
                      )}
                      {objTasks.map((t) => (
                        <div
                          key={t.id}
                          className={`plan-task${t.status === "DONE" ? " is-done" : ""}`}
                        >
                          <button
                            className={`task-card__check${t.status === "DONE" ? " is-checked" : ""}`}
                            aria-label="Completar"
                            onClick={() => toggleTask(t)}
                          >
                            {t.status === "DONE" && <Check size={11} strokeWidth={3} />}
                          </button>
                          {t.title}
                        </div>
                      ))}

                      <div className="plan-fila__acciones">
                        <button
                          className="btn-ghost"
                          onClick={() => openCompose({ objectiveId: o.id, date: todayISO() })}
                        >
                          <Plus size={13} /> Nueva task
                        </button>
                        <button className="btn-ghost" onClick={() => setAbierto(o.id)}>
                          Repartir horas
                        </button>
                        {unassigned.length > 0 && (
                          <AsignarExistente
                            objectiveTitle={o.title}
                            tasks={unassigned}
                            onPick={(taskId) => assign(taskId, o.id)}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {objetivoAbierto && (
        <ObjectiveModal
          objective={objetivoAbierto}
          dates={dates}
          tasks={tasks}
          categories={categories}
          onClose={() => setAbierto(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/**
 * "Asignar existente" como dropdown buscable, igual que el picker de channel o de
 * objetivo de una card. Era un `<select>` nativo: con veinte tareas sin asignar
 * hay que leerlas todas para encontrar una, y el nativo no busca.
 */
function AsignarExistente({
  objectiveTitle,
  tasks,
  onPick,
}: {
  objectiveTitle: string;
  tasks: Task[];
  onPick: (taskId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="chip-wrap" ref={ref}>
      <button
        className="btn-ghost"
        aria-label={`Asignar tarea existente a ${objectiveTitle}`}
        onClick={() => setOpen((v) => !v)}
      >
        Asignar existente…
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)}>
          <SearchSelect
            options={tasks.map((t) => ({
              value: String(t.id),
              label: t.title,
            }))}
            value={null}
            placeholder="Buscar tarea…"
            emptyLabel="No quedan tareas sin objetivo"
            onSelect={(v) => {
              setOpen(false);
              if (v) onPick(Number(v));
            }}
          />
        </Popover>
      )}
    </div>
  );
}
