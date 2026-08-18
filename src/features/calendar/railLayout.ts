import type { Task, TrabajoDelDia } from "../../lib/types";

/**
 * Cálculo del rail de calendario: dónde va cada bloque en la grilla de horas.
 *
 * Todo acá es puro —entra una lista de tareas, sale geometría en minutos— para
 * que la regla de solapamiento se pueda testear sin montar nada.
 *
 * **De dónde sale la hora.** Del `scheduledTime` (`"HH:mm"`, ya en hora local) y
 * de `estimatedMinutes`, y **nunca** de `eventStart`/`eventEnd`. No es un atajo:
 * el importador guarda esos dos en RFC 3339 **UTC** (`ics.rs`), así que cortarles
 * los caracteres para sacar la hora pondría una reunión de la tarde en el bloque
 * equivocado. Es el mismo error que ya se pagó dos veces (`completeAndAdvance` y
 * `tiempoPorDia`) y que SPECS §4.12 nombra explícitamente. `scheduled_time` sale
 * de `inicio_local` y `estimated_minutes` es la duración del evento, así que los
 * dos campos locales alcanzan y no hay conversión que hacer.
 */

/**
 * Alto que se le da a una tarea sin estimado, en minutos.
 *
 * Media hora porque es el bloque más corto que sigue siendo legible en la grilla
 * —cabe el título en una línea— y porque es la duración típica de una reunión, que
 * es de dónde vienen la mayoría de las tareas con hora. Más chico y el bloque se
 * vuelve una franja sin texto; más grande y una tarea sin estimar aparenta ocupar
 * la mañana.
 */
export const DURACION_POR_DEFECTO = 30;

/**
 * Lo mínimo que puede medir un tramo de una tarea partida. Un hueco más chico se
 * deja vacío: cinco minutos entre dos reuniones no son un rato de trabajo, y
 * varios así astillarían la tarea hasta volver ilegible el rail.
 */
export const TRAMO_MINIMO = 15;

const MINUTOS_DEL_DIA = 24 * 60;

/**
 * De dónde salió la hora de un bloque. El rail responde **dos** preguntas a la
 * vez —qué pasó y qué queda—, y mezclarlas sin distinguirlas las arruina las dos.
 *
 * - `REAL`: hay tiempo trackeado ese día. La hora y la duración son las del
 *   taxímetro. Es un registro: no se mueve, no se parte, no lo desplaza nada.
 * - `FIJO`: tiene `scheduled_time` y todavía no se trabajó. Es un compromiso.
 * - `PROYECTADO`: lo puso el rail. "Si sigues tu orden, acá cae."
 */
export type TipoBloque = "REAL" | "FIJO" | "PROYECTADO";

export interface BloqueRail {
  taskId: number;
  /** Minutos desde medianoche. */
  inicioMin: number;
  finMin: number;
  /** Columna dentro de su grupo de solapados, y cuántas hay en total. */
  carril: number;
  carriles: number;
  tipo: TipoBloque;
  /**
   * Qué tramo de su tarea es este bloque, y en cuántos quedó partida. `1 de 1`
   * es el caso normal. Una tarea partida deja dos bloques con el mismo título a
   * distinta hora, así que sin esto el rail se vuelve ilegible.
   */
  parte: number;
  partes: number;
}

export interface Rail {
  /** Rango visible de la grilla, en minutos desde medianoche: el día completo. */
  desdeMin: number;
  hastaMin: number;
  /**
   * Dónde van las dos líneas de la jornada. **No recortan nada**: son una marca
   * visual de que el tiempo se acaba, no un límite que bloquee.
   */
  jornadaDesdeMin: number;
  jornadaHastaMin: number;
  bloques: BloqueRail[];
  /**
   * Eventos de día completo: van en una franja arriba de la grilla y no dentro.
   * Un feriado no ocupa 24 horas del día (SPECS §4.12, "día completo = sin
   * reloj"), así que no tiene dónde colocarse en la escala de horas.
   */
  todoElDia: Task[];
}

/** Lo trabajado ese día, y lo que lleva la corrida en curso. */
export interface OpcionesRail {
  /**
   * Minutos desde medianoche. Mueve el arranque de la proyección: en el día de
   * hoy no tiene sentido proyectar hacia el pasado. Entra **por parámetro y no
   * leyendo el reloj**, para que el módulo siga siendo puro.
   */
  ahoraMin?: number | null;
  /** Una fila por tarea con tiempo trackeado ese día (`repo::trabajo_del_dia`). */
  trabajo?: TrabajoDelDia[];
  /**
   * Segundos de la corrida abierta, que todavía no están en `trabajo.seconds`.
   * Sin esto la tarea que estás trabajando ahora mismo saldría de alto cero.
   */
  segundosEnCurso?: number;
}

/** `"09:30"` → 570. `null` si no es una hora válida. */
export function minutosDeHora(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 570 → `"9:30 AM"`, el mismo formato que el detalle del evento. */
export function etiquetaHora(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const sufijo = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${sufijo}`;
}

/** Minutos desde la medianoche **local** de un timestamp RFC 3339 en UTC. */
export function minutosLocales(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Arma el rail de un día: lo que pasó y lo que queda, en la misma escala.
 *
 * `tasks` son las de ese día tal como las entrega el board (ya filtradas por
 * `source_state = 'ACTIVE'`). Los bloques salen en tres pasadas, y el orden
 * importa porque cada una ocupa espacio para la siguiente:
 *
 * 1. **Reales** — las que tienen tiempo trackeado ese día. Van donde y cuanto
 *    dice el taxímetro, **por encima de lo que dijera el calendario**: una
 *    reunión de 15 minutos que arrancó 46 tarde y duró 18 se dibuja a las 23:46
 *    durando 18. Lo que ocurrió no se estima.
 * 2. **Fijas** — con `scheduled_time` y sin trabajar todavía. Son compromisos.
 * 3. **Proyectadas** — el resto, en el **orden del tablero** (`position`, el que
 *    el usuario ya arregló a mano), calzadas en los huecos que dejan las dos
 *    anteriores y partidas si hace falta.
 *
 * **La proyección no escribe nada.** `scheduled_time` es un dato persistido —lo
 * escribe el import y ordena la cola de Focus—, así que una hora inventada por
 * el rail no puede terminar ahí: después no habría forma de distinguir la que
 * pusiste tú de la que adivinamos. Se calcula al dibujar y muere ahí.
 *
 * La grilla es **siempre el día completo**. La jornada solo aporta dos líneas y
 * el punto donde arranca la proyección: marca que el tiempo se acaba, no bloquea.
 */
export function armarRail(
  tasks: Task[],
  workStart: string,
  workEnd: string,
  opciones: OpcionesRail = {},
): Rail {
  const { ahoraMin = null, trabajo = [], segundosEnCurso = 0 } = opciones;

  const trabajoPorTarea = new Map(trabajo.map((w) => [w.taskId, w]));
  const todoElDia: Task[] = [];
  const reales: Tramo[] = [];
  const fijas: Tramo[] = [];
  const pendientes: Pendiente[] = [];

  for (const t of tasks) {
    const trabajados = minutosTrabajados(trabajoPorTarea.get(t.id), segundosEnCurso);

    if (trabajados > 0) {
      const inicio = minutosLocales(trabajoPorTarea.get(t.id)!.startedAt);
      if (inicio != null) {
        reales.push({
          taskId: t.id,
          inicioMin: inicio,
          finMin: Math.min(inicio + trabajados, MINUTOS_DEL_DIA),
        });
        // **Lo trabajado no agota la tarea.** Si el estimado es mayor que lo que
        // llevas, lo que falta se sigue proyectando como cualquier otra cosa
        // pendiente —y se parte alrededor de lo que venga—: si no, una tarea de
        // 45 minutos con 19 hechos desaparecía del resto del día en cuanto le
        // dabas play, que es justo cuando más importa saber si alcanza.
        const restante = restantePorHacer(t, trabajados);
        if (restante > 0) pendientes.push({ task: t, minutos: restante });
        continue;
      }
    }

    const inicio = minutosDeHora(t.scheduledTime);
    if (inicio == null) {
      // Un evento importado sin hora es de día completo (§4.12): no tiene dónde
      // caer en la escala de horas. Una tarea a mano sin hora sí se proyecta —
      // salvo que esté completada, que se filtra en `proyectar`.
      if (t.source === "CALENDAR") todoElDia.push(t);
      else pendientes.push({ task: t, minutos: duracionDe(t) });
      continue;
    }
    // Una reunión que cruza la medianoche se corta acá: el día siguiente es
    // otra columna, y estirar la grilla a más de 24 h la haría ilegible.
    fijas.push({
      taskId: t.id,
      inicioMin: inicio,
      finMin: Math.min(inicio + duracionDe(t), MINUTOS_DEL_DIA),
    });
  }

  let jornadaDesde = minutosDeHora(workStart);
  let jornadaHasta = minutosDeHora(workEnd);
  if (jornadaDesde == null || jornadaHasta == null || jornadaHasta <= jornadaDesde) {
    jornadaDesde = 9 * 60;
    jornadaHasta = 18 * 60;
  }

  // Reales y fijas comparten carriles: son las dos cosas que ya tienen hora, y
  // si se pisan hay que poder ver las dos.
  const conHora = [...reales, ...fijas];
  const tipoPorTarea = new Map<number, TipoBloque>(
    conHora.map((c) => [c.taskId, reales.includes(c) ? "REAL" : "FIJO"]),
  );
  const bloques = repartirCarriles(conHora).map((b) => ({
    ...b,
    tipo: tipoPorTarea.get(b.taskId) ?? "FIJO",
  }));

  // Lo ya trabajado también ocupa: sin esto una proyección se dibujaría encima
  // del rato que efectivamente pasaste en algo.
  // Lo pendiente arranca después de todo lo ya trabajado: no se puede planificar
  // hacia atrás de lo que ya hiciste. Sin esto, el resto de una tarea empezada a
  // las 14:20 se dibujaba a las 9:00, antes del rato que efectivamente le
  // dedicaste.
  const finDeLoTrabajado = reales.reduce((m, r) => Math.max(m, r.finMin), 0);
  const arranque = Math.max(jornadaDesde, ahoraMin ?? 0, finDeLoTrabajado);
  bloques.push(...proyectar(pendientes, conHora, arranque));

  return {
    desdeMin: 0,
    hastaMin: MINUTOS_DEL_DIA,
    jornadaDesdeMin: jornadaDesde,
    jornadaHastaMin: jornadaHasta,
    bloques,
    todoElDia,
  };
}

interface Tramo {
  taskId: number;
  inicioMin: number;
  finMin: number;
}

/** Algo por hacer y cuánto ocupa. La duración la decide quien lo arma: para una
 * tarea sin empezar es su estimado; para una empezada, lo que le falta. */
interface Pendiente {
  task: Task;
  minutos: number;
}

/**
 * Cuántos minutos lleva trabajados una tarea ese día. `0` si ninguno.
 *
 * La duración sale del taxímetro y no de `estimated_minutes`: en ejecución una
 * reunión dura más o menos de lo que decía el calendario, y el rail tiene que
 * mostrar lo segundo. La hora de inicio, igual: manda cuándo le diste play.
 */
function minutosTrabajados(w: TrabajoDelDia | undefined, segundosEnCurso: number): number {
  if (!w) return 0;
  const segundos = w.seconds + (w.running ? segundosEnCurso : 0);
  const minutos = Math.round(segundos / 60);
  // Con el taxímetro corriendo el bloque aparece de inmediato, aunque lleve
  // segundos: en cuanto le das play, el lugar de esa tarea en el día es la hora
  // real y no la que se había proyectado. Esperar al primer minuto la dejaría
  // saltando de un lado a otro de la grilla.
  if (w.running) return Math.max(1, minutos);
  // Un ajuste manual a cero deja una fila sin tiempo: no hay nada que dibujar.
  return Math.max(0, minutos);
}

/**
 * Lo que le falta a una tarea ya empezada, en minutos.
 *
 * **Solo con estimado propio.** Sin él, `duracionPorDefecto` es un número
 * inventado, y decir "te faltan 11 minutos" sobre algo que nunca estimaste es
 * peor que no decir nada. Y una completada no debe nada, por mucho que el
 * estimado fuera mayor: la terminaste.
 */
function restantePorHacer(t: Task, trabajados: number): number {
  if (t.status === "DONE") return 0;
  if (t.estimatedMinutes == null || t.estimatedMinutes <= 0) return 0;
  return Math.max(0, t.estimatedMinutes - trabajados);
}

/** Cuánto dura una tarea en el rail. Sin estimado, la duración por defecto. */
function duracionDe(t: Task): number {
  return t.estimatedMinutes != null && t.estimatedMinutes > 0
    ? t.estimatedMinutes
    : DURACION_POR_DEFECTO;
}

/**
 * Calza las tareas sin hora en los huecos que dejan las fijas, **partiéndolas si
 * hace falta**.
 *
 * Van en orden de tablero (`position`): ese orden ya lo arregló el usuario
 * arrastrando cards, así que es su prioridad declarada. Cada una empieza donde
 * terminó la anterior, y cuando se topa con una reunión **no salta entera al
 * otro lado**: llena lo que queda antes y sigue después. Media hora libre antes
 * de una reunión es media hora de trabajo real, y esconderla haría que el rail
 * proyectara un día más corto del que se tiene.
 *
 * **Las completadas no se proyectan**: el rail responde "qué me queda por
 * delante", y llenarlo con lo ya hecho tapa justamente eso. Una reunión
 * completada sí se queda, porque su hora fue un compromiso real.
 *
 * Como cada tramo se coloca solo en un hueco, nunca pisa a una fija y su carril
 * es siempre 0 — de ahí que no pase por `repartirCarriles`.
 */
function proyectar(
  tareas: Pendiente[],
  fijas: { inicioMin: number; finMin: number }[],
  desdeMin: number,
): BloqueRail[] {
  const pendientes = tareas
    .filter((p) => p.task.status !== "DONE")
    .sort((a, b) => a.task.position - b.task.position || a.task.id - b.task.id);
  if (pendientes.length === 0) return [];

  const ocupado = fusionar(fijas);
  const out: BloqueRail[] = [];
  let cursor = desdeMin;

  for (const { task: t, minutos } of pendientes) {
    const tramos = partir(minutos, cursor, ocupado);
    // Si no cabe entera antes de medianoche se descarta **completa**, no a
    // medias: dejar solo el primer tramo se leería como un error de ubicación y
    // no como "ya no te queda día". Y lo que sigue tampoco va a caber.
    if (tramos == null) break;

    tramos.forEach((tramo, i) => {
      out.push({
        taskId: t.id,
        inicioMin: tramo.inicioMin,
        finMin: tramo.finMin,
        carril: 0,
        carriles: 1,
        tipo: "PROYECTADO",
        parte: i + 1,
        partes: tramos.length,
      });
    });
    cursor = tramos[tramos.length - 1].finMin;
  }
  return out;
}

/**
 * Reparte `dura` minutos a partir de `desde`, esquivando lo ocupado.
 *
 * Devuelve `null` si no alcanza el día: el tope es medianoche, porque estirar la
 * grilla al día siguiente sería mentir sobre en qué día cae. Salirse de la
 * jornada sí está permitido —la grilla se estira y ese desborde es el aviso.
 */
function partir(
  dura: number,
  desde: number,
  ocupado: { inicioMin: number; finMin: number }[],
): { inicioMin: number; finMin: number }[] | null {
  const tramos: { inicioMin: number; finMin: number }[] = [];
  let restante = dura;
  let cursor = desde;

  while (restante > 0) {
    cursor = siguienteLibre(cursor, ocupado);
    if (cursor >= MINUTOS_DEL_DIA) return null;

    const finDelHueco = Math.min(proximoOcupado(cursor, ocupado), MINUTOS_DEL_DIA);
    const hueco = finDelHueco - cursor;
    const toma = Math.min(restante, hueco);

    // Un hueco que no da ni para el tramo mínimo se deja vacío en vez de
    // astillar la tarea: cinco minutos sueltos entre dos reuniones no son un
    // rato de trabajo, y varios así dejarían el rail ilegible.
    if (toma < restante && toma < TRAMO_MINIMO) {
      cursor = finDelHueco;
      continue;
    }

    tramos.push({ inicioMin: cursor, finMin: cursor + toma });
    restante -= toma;
    cursor += toma;
  }
  return tramos;
}

/** Une los intervalos que se tocan o se pisan, en orden. */
function fusionar(
  intervalos: { inicioMin: number; finMin: number }[],
): { inicioMin: number; finMin: number }[] {
  const orden = [...intervalos].sort((a, b) => a.inicioMin - b.inicioMin);
  const out: { inicioMin: number; finMin: number }[] = [];
  for (const i of orden) {
    const ultimo = out[out.length - 1];
    if (ultimo && i.inicioMin <= ultimo.finMin) {
      ultimo.finMin = Math.max(ultimo.finMin, i.finMin);
    } else {
      out.push({ ...i });
    }
  }
  return out;
}

/** El primer instante `>= desde` que no cae dentro de algo ocupado. */
function siguienteLibre(desde: number, ocupado: { inicioMin: number; finMin: number }[]): number {
  let cursor = desde;
  // Los intervalos vienen fusionados y ordenados, así que uno solo puede
  // empujar al siguiente y el recorrido termina.
  for (const o of ocupado) {
    if (cursor >= o.inicioMin && cursor < o.finMin) cursor = o.finMin;
  }
  return cursor;
}

/** Dónde empieza lo próximo ocupado después de `desde`, o el fin del día. */
function proximoOcupado(desde: number, ocupado: { inicioMin: number; finMin: number }[]): number {
  for (const o of ocupado) {
    if (o.inicioMin > desde) return o.inicioMin;
  }
  return MINUTOS_DEL_DIA;
}

/**
 * Reparte los bloques en carriles para que dos reuniones a la misma hora se
 * vean lado a lado en vez de una encima de la otra.
 *
 * El ancho se decide **por grupo de solapados** y no por el día entero: si a las
 * 10 hay tres reuniones juntas y a las 16 hay una sola, la de las 16 usa todo el
 * ancho. Contar el máximo del día dejaría dos tercios de la tarde en blanco.
 */
function repartirCarriles(
  crudos: { taskId: number; inicioMin: number; finMin: number }[],
): BloqueRail[] {
  const orden = [...crudos].sort(
    (a, b) => a.inicioMin - b.inicioMin || b.finMin - a.finMin || a.taskId - b.taskId,
  );

  const salida: BloqueRail[] = [];
  let grupo: BloqueRail[] = [];
  let finDelGrupo = -1;
  let finPorCarril: number[] = [];

  const cerrarGrupo = () => {
    for (const b of grupo) b.carriles = finPorCarril.length;
    salida.push(...grupo);
    grupo = [];
    finPorCarril = [];
    finDelGrupo = -1;
  };

  for (const c of orden) {
    // Empieza después de que terminó todo lo anterior ⇒ grupo nuevo.
    if (grupo.length > 0 && c.inicioMin >= finDelGrupo) cerrarGrupo();

    let carril = finPorCarril.findIndex((fin) => fin <= c.inicioMin);
    if (carril === -1) {
      carril = finPorCarril.length;
      finPorCarril.push(c.finMin);
    } else {
      finPorCarril[carril] = c.finMin;
    }

    grupo.push({ ...c, carril, carriles: 1, tipo: "FIJO", parte: 1, partes: 1 });
    finDelGrupo = Math.max(finDelGrupo, c.finMin);
  }
  if (grupo.length > 0) cerrarGrupo();

  return salida;
}
