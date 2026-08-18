import { describe, expect, it } from "vitest";
import type { Task } from "../../lib/types";
import {
  armarRail,
  etiquetaHora,
  minutosDeHora,
  DURACION_POR_DEFECTO,
  TRAMO_MINIMO,
} from "./railLayout";

const DIA = "2026-08-17";

function task(over: Partial<Task> & { id: number }): Task {
  return {
    title: `Tarea ${over.id}`,
    notes: null,
    categoryId: null,
    objectiveId: null,
    scheduledDate: DIA,
    scheduledTime: null,
    position: 0,
    estimatedMinutes: 30,
    actualSeconds: 0,
    status: "TODO",
    completedAt: null,
    source: "MANUAL",
    sourceState: "ACTIVE",
    feedId: null,
    calendarUid: null,
    eventStart: null,
    eventEnd: null,
    meetingUrl: null,
    eventDescription: null,
    attendees: [],
    createdAt: `${DIA}T09:00:00Z`,
    updatedAt: `${DIA}T09:00:00Z`,
    ...over,
  };
}

/** Evento importado: hora local + duración, como los deja `import_eventos`. */
function evento(id: number, hora: string | null, minutos: number | null): Task {
  return task({
    id,
    source: "CALENDAR",
    feedId: 1,
    calendarUid: `uid-${id}`,
    scheduledTime: hora,
    estimatedMinutes: minutos,
    // A propósito en UTC y a una hora que cae en otro día local: si el layout
    // los mirara, los bloques se irían de lugar.
    eventStart: hora ? `${DIA}T23:30:00+00:00` : null,
    eventEnd: hora ? `${DIA}T23:45:00+00:00` : null,
  });
}

const bloqueDe = (r: ReturnType<typeof armarRail>, id: number) =>
  r.bloques.find((b) => b.taskId === id)!;

/** Todos los tramos de una tarea, en orden. Una partida deja más de uno. */
const bloquesDe = (r: ReturnType<typeof armarRail>, id: number) =>
  r.bloques.filter((b) => b.taskId === id).sort((a, b) => a.inicioMin - b.inicioMin);

/** `[inicio, fin]` de cada tramo, que es lo que se quiere leer en los asserts. */
const tramosDe = (r: ReturnType<typeof armarRail>, id: number) =>
  bloquesDe(r, id).map((b) => [b.inicioMin, b.finMin]);

describe("minutosDeHora", () => {
  it("convierte y rechaza lo que no es una hora", () => {
    expect(minutosDeHora("09:30")).toBe(570);
    expect(minutosDeHora("00:00")).toBe(0);
    expect(minutosDeHora("9:05")).toBe(545);
    expect(minutosDeHora(null)).toBeNull();
    expect(minutosDeHora("")).toBeNull();
    expect(minutosDeHora("24:00")).toBeNull();
    expect(minutosDeHora("10:75")).toBeNull();
    expect(minutosDeHora("mañana")).toBeNull();
  });
});

describe("etiquetaHora", () => {
  it("usa el mismo formato de 12 horas que el detalle del evento", () => {
    expect(etiquetaHora(0)).toBe("12:00 AM");
    expect(etiquetaHora(9 * 60)).toBe("9:00 AM");
    expect(etiquetaHora(12 * 60)).toBe("12:00 PM");
    expect(etiquetaHora(16 * 60 + 30)).toBe("4:30 PM");
  });
});

describe("armarRail", () => {
  it("coloca la tarea con hora y deja fuera la que no tiene", () => {
    const r = armarRail(
      [task({ id: 1, scheduledTime: "10:00", estimatedMinutes: 60 }), task({ id: 2 })],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 1)).toMatchObject({ inicioMin: 600, finMin: 660, tipo: "FIJO" });
    expect(r.todoElDia).toEqual([]);
  });

  it("no lee event_start: la hora sale del campo local", () => {
    // `event_start` está en UTC y apunta a las 23:30Z. Si el layout lo usara,
    // el bloque no caería a las 4 de la tarde. Es el error que SPECS §4.12
    // nombra y que ya se pagó en `completeAndAdvance` y en `tiempoPorDia`.
    const r = armarRail([evento(1, "16:00", 30)], "09:00", "18:00");
    expect(bloqueDe(r, 1).inicioMin).toBe(16 * 60);
  });

  it("un evento de día completo va a la franja, no a la grilla", () => {
    // Sin hora y sin estimado: un feriado no ocupa 24 h del día.
    const r = armarRail([evento(1, null, null)], "09:00", "18:00");
    expect(r.bloques).toEqual([]);
    expect(r.todoElDia.map((t) => t.id)).toEqual([1]);
  });

  it("sin estimado usa una duración por defecto", () => {
    const r = armarRail(
      [task({ id: 1, scheduledTime: "10:00", estimatedMinutes: null })],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 1).finMin).toBe(600 + DURACION_POR_DEFECTO);
  });

  it("dos reuniones a la misma hora quedan lado a lado", () => {
    const r = armarRail([evento(1, "10:00", 60), evento(2, "10:30", 60)], "09:00", "18:00");
    expect(bloqueDe(r, 1)).toMatchObject({ carril: 0, carriles: 2 });
    expect(bloqueDe(r, 2)).toMatchObject({ carril: 1, carriles: 2 });
  });

  it("el ancho se decide por grupo, no por el día entero", () => {
    // Tres juntas a las 10, una sola a las 16: la de las 16 usa todo el ancho.
    const r = armarRail(
      [
        evento(1, "10:00", 60),
        evento(2, "10:00", 60),
        evento(3, "10:00", 60),
        evento(4, "16:00", 30),
      ],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 1).carriles).toBe(3);
    expect(bloqueDe(r, 4)).toMatchObject({ carril: 0, carriles: 1 });
  });

  it("una que termina justo cuando empieza la otra no se considera solapada", () => {
    const r = armarRail([evento(1, "10:00", 60), evento(2, "11:00", 60)], "09:00", "18:00");
    expect(bloqueDe(r, 1).carriles).toBe(1);
    expect(bloqueDe(r, 2)).toMatchObject({ carril: 0, carriles: 1 });
  });

  it("reusa el carril que quedó libre en vez de abrir uno nuevo", () => {
    // 1 va de 10 a 12; 2 y 3 son cortas y consecutivas dentro de ese rango:
    // las tres forman un solo grupo, pero alcanzan dos carriles.
    const r = armarRail(
      [evento(1, "10:00", 120), evento(2, "10:00", 30), evento(3, "10:30", 30)],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 2).carril).toBe(1);
    expect(bloqueDe(r, 3).carril).toBe(1);
    expect(bloqueDe(r, 1).carriles).toBe(2);
  });

  it("la grilla es siempre el día completo; la jornada solo deja dos marcas", () => {
    // Mostrar las 24 h y marcar la jornada avisa que el tiempo se acaba sin
    // bloquear nada fuera de ella.
    const r = armarRail([], "09:00", "18:00");
    expect([r.desdeMin, r.hastaMin]).toEqual([0, 24 * 60]);
    expect([r.jornadaDesdeMin, r.jornadaHastaMin]).toEqual([9 * 60, 18 * 60]);
  });

  it("una reunión fuera de la jornada cae en su hora, sin mover las marcas", () => {
    const r = armarRail([evento(1, "07:30", 30), evento(2, "19:15", 60)], "09:00", "18:00");
    expect(bloqueDe(r, 1).inicioMin).toBe(7 * 60 + 30);
    expect(bloqueDe(r, 2).inicioMin).toBe(19 * 60 + 15);
    expect([r.jornadaDesdeMin, r.jornadaHastaMin]).toEqual([9 * 60, 18 * 60]);
  });

  it("una jornada mal configurada no deja las marcas al revés", () => {
    // Con `work_end <= work_start` las dos líneas se cruzarían.
    const r = armarRail([], "18:00", "09:00");
    expect(r.jornadaHastaMin).toBeGreaterThan(r.jornadaDesdeMin);
    expect(armarRail([], "", "").jornadaHastaMin).toBeGreaterThan(0);
  });

  it("una reunión que cruza la medianoche se corta en el fin del día", () => {
    const r = armarRail([evento(1, "23:30", 120)], "09:00", "18:00");
    expect(bloqueDe(r, 1).finMin).toBe(24 * 60);
  });

  it("una tarea a mano sin hora se proyecta, no se cuenta como día completo", () => {
    const r = armarRail([task({ id: 1 }), task({ id: 2 })], "09:00", "18:00");
    expect(r.todoElDia).toEqual([]);
    expect(r.bloques.every((b) => b.tipo === "PROYECTADO")).toBe(true);
  });
});

/**
 * Lo trabajado manda sobre lo estimado: una reunión de 15 minutos que arrancó
 * tarde y duró 18 tiene que dibujarse donde ocurrió, no donde decía el
 * calendario. El rail muestra el día, no el plan del día.
 */
describe("armarRail · lo que ya se trabajó", () => {
  /** Una fila de `trabajo_del_dia` que arranca a la hora local indicada. */
  function trabajo(taskId: number, hora: string, minutos: number, running = false) {
    const [h, m] = hora.split(":").map(Number);
    const d = new Date(`${DIA}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return { taskId, startedAt: d.toISOString(), seconds: minutos * 60, running };
  }

  it("la reunión se dibuja donde arrancó el taxímetro y cuanto duró", () => {
    // El caso del pantallazo: la meet era a las 23:00 por 15', se partió a las
    // 23:46 y se marcaron 18'.
    const r = armarRail([evento(1, "22:00", 15)], "09:00", "18:00", {
      trabajo: [trabajo(1, "22:46", 18)],
    });
    expect(bloqueDe(r, 1)).toMatchObject({
      inicioMin: 22 * 60 + 46,
      finMin: 23 * 60 + 4,
      tipo: "REAL",
    });
  });

  it("lo trabajado se corta en la medianoche, como todo lo demás", () => {
    const r = armarRail([task({ id: 1 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "23:50", 30)],
    });
    expect(bloqueDe(r, 1).finMin).toBe(24 * 60);
  });

  it("lo trabajado va a su hora real y lo que falta se sigue proyectando", () => {
    // 60 estimados con 25 hechos: el rato trabajado va donde ocurrió y los 35
    // que faltan siguen ocupando lugar en el día. Si desaparecieran, una tarea
    // empezada se esfumaría del resto del rail justo cuando más importa saber
    // si alcanza el tiempo.
    const r = armarRail([task({ id: 1, estimatedMinutes: 60 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "14:20", 25)],
    });
    const [real, resto] = bloquesDe(r, 1);
    expect(real).toMatchObject({ inicioMin: 14 * 60 + 20, finMin: 14 * 60 + 45, tipo: "REAL" });
    expect(resto).toMatchObject({ tipo: "PROYECTADO" });
    expect(resto.finMin - resto.inicioMin).toBe(35);
  });

  it("lo que falta se parte alrededor de lo que viene", () => {
    // Es el caso completo: empezaste algo, tienes una reunión encima, y lo que
    // te queda tiene que repartirse antes y después.
    const r = armarRail(
      [task({ id: 1, position: 0, estimatedMinutes: 90 }), evento(9, "10:00", 60)],
      "09:00",
      "18:00",
      { trabajo: [trabajo(1, "09:00", 30)] },
    );
    const tramos = bloquesDe(r, 1);
    expect(tramos[0]).toMatchObject({ inicioMin: 9 * 60, finMin: 9 * 60 + 30, tipo: "REAL" });
    // Quedan 60': media hora antes de la reunión y media después.
    expect(tramos.slice(1).map((b) => [b.inicioMin, b.finMin])).toEqual([
      [9 * 60 + 30, 10 * 60],
      [11 * 60, 11 * 60 + 30],
    ]);
  });

  it("una completada no debe nada, aunque el estimado fuera mayor", () => {
    const r = armarRail([task({ id: 1, status: "DONE", estimatedMinutes: 90 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "09:00", 20)],
    });
    expect(bloquesDe(r, 1)).toHaveLength(1);
    expect(bloqueDe(r, 1).tipo).toBe("REAL");
  });

  it("si ya trabajaste más que el estimado no queda nada por proyectar", () => {
    const r = armarRail([task({ id: 1, estimatedMinutes: 30 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "09:00", 45)],
    });
    expect(bloquesDe(r, 1)).toHaveLength(1);
  });

  it("nada pendiente se proyecta antes de lo que ya trabajaste", () => {
    // Planificar hacia atrás de lo hecho no significa nada: si trabajaste hasta
    // las 14:45, lo que queda del día empieza ahí.
    const r = armarRail(
      [
        task({ id: 1, position: 0, estimatedMinutes: 60 }),
        task({ id: 2, position: 1, estimatedMinutes: 30 }),
      ],
      "09:00",
      "18:00",
      { trabajo: [trabajo(1, "14:20", 25)] },
    );
    for (const b of r.bloques.filter((x) => x.tipo === "PROYECTADO")) {
      expect(b.inicioMin).toBeGreaterThanOrEqual(14 * 60 + 45);
    }
  });

  it("sin estimado propio no se inventa un resto", () => {
    // `DURACION_POR_DEFECTO` es un número puesto por el rail: decir "te faltan
    // 11 minutos" sobre algo que nunca estimaste es peor que no decir nada.
    const r = armarRail([task({ id: 1, estimatedMinutes: null })], "09:00", "18:00", {
      trabajo: [trabajo(1, "09:00", 19)],
    });
    expect(bloquesDe(r, 1)).toHaveLength(1);
    expect(bloqueDe(r, 1).tipo).toBe("REAL");
  });

  it("una completada se muestra igual: el rail también dice qué hiciste", () => {
    const r = armarRail([task({ id: 1, status: "DONE", estimatedMinutes: 60 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "10:00", 40)],
    });
    expect(bloqueDe(r, 1)).toMatchObject({ inicioMin: 600, finMin: 640, tipo: "REAL" });
  });

  it("lo trabajado ocupa: una proyección no se dibuja encima", () => {
    const r = armarRail(
      [
        task({ id: 1, position: 0, estimatedMinutes: 30 }),
        task({ id: 2, position: 1, estimatedMinutes: 60 }),
      ],
      "09:00",
      "18:00",
      { trabajo: [trabajo(1, "09:00", 120)] },
    );
    // 1 ocupó de 9 a 11, así que 2 no puede empezar antes de las 11.
    expect(bloqueDe(r, 2).inicioMin).toBeGreaterThanOrEqual(11 * 60);
  });

  it("con el taxímetro recién arrancado el bloque ya aparece en su hora real", () => {
    // Sin piso, los primeros 30 segundos redondean a 0 y la tarea se quedaría
    // en su hueco proyectado hasta saltar de golpe al otro lado de la grilla.
    const r = armarRail([task({ id: 1, estimatedMinutes: 60 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "10:07", 0, true)],
      segundosEnCurso: 8,
    });
    expect(bloqueDe(r, 1)).toMatchObject({ inicioMin: 10 * 60 + 7, tipo: "REAL" });
  });

  it("la corrida en curso crece con lo que lleva el taxímetro", () => {
    const r = armarRail([task({ id: 1 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "09:00", 0, true)],
      segundosEnCurso: 25 * 60,
    });
    expect(bloqueDe(r, 1)).toMatchObject({ inicioMin: 540, finMin: 565, tipo: "REAL" });
  });

  it("sin corrida en curso, los segundos en vivo no se le suman a nadie", () => {
    const r = armarRail([task({ id: 1 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "09:00", 30)],
      segundosEnCurso: 25 * 60,
    });
    expect(bloqueDe(r, 1).finMin).toBe(570);
  });

  it("una fila sin tiempo no dibuja nada y la tarea vuelve a proyectarse", () => {
    // Un ajuste manual a cero deja la fila sin segundos: no hay qué mostrar.
    const r = armarRail([task({ id: 1, estimatedMinutes: 45 })], "09:00", "18:00", {
      trabajo: [trabajo(1, "10:00", 0)],
    });
    expect(bloqueDe(r, 1).tipo).toBe("PROYECTADO");
  });
});

/**
 * La proyección responde "si sigo mi orden, ¿dónde cae cada cosa?". Nunca
 * escribe `scheduled_time`: esa hora es un dato del usuario (o del import) y
 * ensuciarla haría imposible distinguir lo comprometido de lo estimado.
 */
describe("armarRail · proyección de las tareas sin hora", () => {
  it("las encadena desde el inicio de la jornada, en orden de tablero", () => {
    const r = armarRail(
      [
        task({ id: 2, position: 1, estimatedMinutes: 30 }),
        task({ id: 1, position: 0, estimatedMinutes: 60 }),
      ],
      "09:00",
      "18:00",
    );
    // El orden lo da `position`, que es el que el usuario arregló arrastrando.
    expect(bloqueDe(r, 1)).toMatchObject({ inicioMin: 540, finMin: 600, tipo: "PROYECTADO" });
    expect(bloqueDe(r, 2)).toMatchObject({ inicioMin: 600, finMin: 630 });
  });

  it("se parte alrededor de la reunión: media hora antes y el resto después", () => {
    // El caso que motivó la feature: 30' libres hasta la reunión y una tarea de
    // 1 h. Saltarla entera al otro lado tiraría a la basura esa media hora.
    const r = armarRail(
      [evento(9, "09:30", 60), task({ id: 1, position: 0, estimatedMinutes: 60 })],
      "09:00",
      "18:00",
    );
    expect(tramosDe(r, 1)).toEqual([
      [9 * 60, 9 * 60 + 30],
      [10 * 60 + 30, 11 * 60],
    ]);
    expect(bloquesDe(r, 1).map((b) => [b.parte, b.partes])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("si cabe entera en el hueco no se parte", () => {
    const r = armarRail(
      [evento(9, "10:00", 60), task({ id: 1, position: 0, estimatedMinutes: 60 })],
      "09:00",
      "18:00",
    );
    expect(tramosDe(r, 1)).toEqual([[9 * 60, 10 * 60]]);
    expect(bloqueDe(r, 1)).toMatchObject({ parte: 1, partes: 1 });
  });

  it("una tarea larga se reparte entre todos los huecos que haga falta", () => {
    const r = armarRail(
      [
        evento(8, "09:30", 30),
        evento(9, "11:00", 60),
        task({ id: 1, position: 0, estimatedMinutes: 150 }),
      ],
      "09:00",
      "18:00",
    );
    // 30' antes de la primera, 60' entre las dos, y los 60' que faltan después.
    expect(tramosDe(r, 1)).toEqual([
      [9 * 60, 9 * 60 + 30],
      [10 * 60, 11 * 60],
      [12 * 60, 13 * 60],
    ]);
    const total = bloquesDe(r, 1).reduce((s, b) => s + (b.finMin - b.inicioMin), 0);
    expect(total).toBe(150);
  });

  it("un hueco más chico que el tramo mínimo se deja vacío", () => {
    // 10' entre el arranque y la reunión: astillar ahí no ayuda a nadie.
    const r = armarRail(
      [evento(9, "09:10", 60), task({ id: 1, position: 0, estimatedMinutes: 60 })],
      "09:00",
      "18:00",
    );
    expect(tramosDe(r, 1)).toEqual([[10 * 60 + 10, 11 * 60 + 10]]);
  });

  it("el tramo mínimo sí se usa cuando el hueco da justo", () => {
    // Contraparte del anterior: con TRAMO_MINIMO exacto, se parte.
    const r = armarRail(
      [evento(9, `09:${TRAMO_MINIMO}`, 60), task({ id: 1, position: 0, estimatedMinutes: 60 })],
      "09:00",
      "18:00",
    );
    expect(tramosDe(r, 1)).toHaveLength(2);
    expect(tramosDe(r, 1)[0]).toEqual([9 * 60, 9 * 60 + TRAMO_MINIMO]);
  });

  it("dos reuniones pegadas se saltan de una, sin quedar a medio camino", () => {
    const r = armarRail(
      [
        evento(8, "09:00", 60),
        evento(9, "10:00", 60),
        task({ id: 1, position: 0, estimatedMinutes: 30 }),
      ],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 1).inicioMin).toBe(11 * 60);
  });

  it("aprovecha el hueco entre dos reuniones si la tarea cabe", () => {
    const r = armarRail(
      [
        evento(8, "09:00", 30),
        evento(9, "11:00", 60),
        task({ id: 1, position: 0, estimatedMinutes: 30 }),
      ],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 1).inicioMin).toBe(9 * 60 + 30);
  });

  it("una proyectada nunca se pone en otro carril: no pisa nada", () => {
    const r = armarRail(
      [evento(9, "10:00", 60), task({ id: 1, position: 0, estimatedMinutes: 60 })],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 1)).toMatchObject({ carril: 0, carriles: 1 });
  });

  it("en el día de hoy no proyecta hacia el pasado", () => {
    // 14:00: lo que queda del día empieza ahí, no a las 9 de la mañana.
    const r = armarRail([task({ id: 1, estimatedMinutes: 60 })], "09:00", "18:00", {
      ahoraMin: 14 * 60,
    });
    expect(bloqueDe(r, 1).inicioMin).toBe(14 * 60);
  });

  it("sin 'ahora' (otro día) proyecta desde el inicio de la jornada", () => {
    const r = armarRail([task({ id: 1, estimatedMinutes: 60 })], "09:00", "18:00");
    expect(bloqueDe(r, 1).inicioMin).toBe(9 * 60);
  });

  it("no proyecta lo ya completado: el rail es lo que queda por delante", () => {
    const r = armarRail(
      [
        task({ id: 1, position: 0, status: "DONE", estimatedMinutes: 60 }),
        task({ id: 2, position: 1, estimatedMinutes: 30 }),
      ],
      "09:00",
      "18:00",
    );
    expect(r.bloques.map((b) => b.taskId)).toEqual([2]);
    // Y la siguiente no queda con el hueco de la completada por delante.
    expect(bloqueDe(r, 2).inicioMin).toBe(9 * 60);
  });

  it("una reunión completada sí se queda: su hora fue un compromiso real", () => {
    const r = armarRail([evento(1, "10:00", 60)], "09:00", "18:00");
    const conDone = armarRail(
      [{ ...evento(1, "10:00", 60), status: "DONE" as const }],
      "09:00",
      "18:00",
    );
    expect(conDone.bloques).toEqual(r.bloques);
  });

  it("si el día no cabe, la proyección se sale de la jornada y la grilla lo muestra", () => {
    // Es justamente el aviso que uno quiere ver: no entra todo.
    const r = armarRail(
      [
        task({ id: 1, position: 0, estimatedMinutes: 300 }),
        task({ id: 2, position: 1, estimatedMinutes: 300 }),
      ],
      "09:00",
      "18:00",
    );
    expect(bloqueDe(r, 2).finMin).toBe(19 * 60);
  });

  it("lo que no cabe antes de medianoche se descarta entero, no a medias", () => {
    // Estirar la grilla al día siguiente sería mentir sobre en qué día cae. Y
    // dejar solo el primer tramo se leería como un bug de ubicación, no como
    // "ya no te queda día".
    const r = armarRail(
      [
        task({ id: 1, position: 0, estimatedMinutes: 600 }),
        task({ id: 2, position: 1, estimatedMinutes: 600 }),
      ],
      "09:00",
      "18:00",
    );
    expect(r.bloques.map((b) => b.taskId)).toEqual([1]);
  });
});
