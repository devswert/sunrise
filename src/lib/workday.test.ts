import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PARALLELISM_THRESHOLD,
  clockOnDay,
  formatParallelism,
  liveClock,
  parallelism,
} from "./workday";
import { mock } from "./mockDb";

const H = 3600;
/** Un instante a una hora local (de la máquina) de un día, en ms. */
const at = (date: string, hour: number, minute = 0) =>
  new Date(
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
  ).getTime();
const day = (date: string): [number, number] => {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
};

describe("clockOnDay (gemelo de repo::clock_on_day)", () => {
  const D = "2030-03-12";

  it("cuenta una sola vez lo que se solapa", () => {
    const r = clockOnDay(
      [
        [at(D, 9), at(D, 11)],
        [at(D, 10), at(D, 12)],
      ],
      ...day(D),
    );
    expect(r).toEqual({ span: 3 * H, clocked: 4 * H });
  });

  it("los tramos contiguos no son paralelos", () => {
    const r = clockOnDay(
      [
        [at(D, 10), at(D, 11)],
        [at(D, 9), at(D, 10)],
      ],
      ...day(D),
    );
    expect(r).toEqual({ span: 2 * H, clocked: 2 * H });
  });

  it("un tramo dentro de otro no estira la jornada", () => {
    const r = clockOnDay(
      [
        [at(D, 9), at(D, 13)],
        [at(D, 10), at(D, 11)],
      ],
      ...day(D),
    );
    expect(r).toEqual({ span: 4 * H, clocked: 5 * H });
  });

  it("los huecos no cuentan", () => {
    const r = clockOnDay(
      [
        [at(D, 9), at(D, 10)],
        [at(D, 15), at(D, 15, 30)],
      ],
      ...day(D),
    );
    expect(r).toEqual({ span: 1.5 * H, clocked: 1.5 * H });
  });

  it("un tramo que cruza la medianoche se reparte entre los dos días", () => {
    const tramo: Array<[number, number]> = [[at(D, 23), at("2030-03-13", 1)]];
    expect(clockOnDay(tramo, ...day(D)).span).toBe(H);
    expect(clockOnDay(tramo, ...day("2030-03-13")).span).toBe(H);
  });

  it("sin tramos la jornada es cero", () => {
    expect(clockOnDay([], ...day(D))).toEqual({ span: 0, clocked: 0 });
  });
});

describe("paralelismo", () => {
  it("solo aparece desde el umbral, que ya se lee como ×1,1", () => {
    expect(parallelism(1.04 * H, H)).toBeNull();
    expect(parallelism(PARALLELISM_THRESHOLD * H, H)).toBeCloseTo(1.05);
    expect(formatParallelism(PARALLELISM_THRESHOLD)).toBe("×1,1");
  });

  it("sin jornada no hay paralelismo, aunque haya reloj", () => {
    expect(parallelism(0, 0)).toBeNull();
    expect(parallelism(H, 0)).toBeNull();
  });

  it("sin solape es exactamente 1 y no se muestra", () => {
    expect(parallelism(5 * H, 5 * H)).toBeNull();
  });

  it("se escribe con coma decimal", () => {
    expect(formatParallelism(1.8)).toBe("×1,8");
    expect(formatParallelism(2)).toBe("×2,0");
  });
});

describe("liveClock", () => {
  it("sin timers abiertos la jornada no se mueve", () => {
    expect(liveClock({ spanSeconds: H, clockedSeconds: 2 * H }, 0, 600)).toEqual({
      span: H,
      clocked: 2 * H,
    });
  });

  it("con timers abiertos avanzan los dos lados", () => {
    // Uno solo haría crecer el paralelismo con el reloj sin que nada cambie.
    expect(liveClock({ spanSeconds: H, clockedSeconds: 2 * H }, 2, 60)).toEqual({
      span: H + 60,
      clocked: 2 * H + 120,
    });
  });

  it("un solo timer abierto no inventa paralelismo al pasar el tiempo", () => {
    const c = liveClock({ spanSeconds: 600, clockedSeconds: 600 }, 1, 3 * H);
    expect(parallelism(c.clocked, c.span)).toBeNull();
  });
});

describe("la jornada del mock espeja a Rust", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Fija el reloj a una hora local del día de prueba. */
  const now = (date: string, hour: number, minute = 0) => vi.setSystemTime(at(date, hour, minute));

  it("dos timers en paralelo suman en tareas y no en la jornada; los ajustes no cuentan", async () => {
    vi.useFakeTimers();
    const D = "2031-05-20";
    now(D, 9);
    const a = await mock.createTask({ title: "agente A", scheduledDate: D, estimatedMinutes: 60 });
    const b = await mock.createTask({ title: "agente B", scheduledDate: D, estimatedMinutes: 60 });
    const c = await mock.createTask({ title: "a mano", scheduledDate: D, estimatedMinutes: 60 });
    await mock.startTimer(a.id);
    now(D, 10);
    await mock.startTimer(b.id, true);
    now(D, 11);
    await mock.stopTimer(a.id);
    now(D, 12);
    await mock.stopAllTimers();
    // Un ajuste a mano: tiempo en tareas, pero sin hora.
    await mock.setActualSeconds(c.id, 3 * H);

    const [log] = await mock.dailyLog(D, 1);
    expect(log.workedSeconds).toBe(7 * H);
    expect(log.spanSeconds).toBe(3 * H);
    expect(log.clockedSeconds).toBe(4 * H);
  });

  it("un timer abierto desde anoche ocupa la jornada de hoy, pero su fila es de ayer", async () => {
    vi.useFakeTimers();
    const D = "2031-07-14";
    const D2 = "2031-07-15";
    now(D, 23);
    const t = await mock.createTask({ title: "se quedó", scheduledDate: D, estimatedMinutes: 60 });
    await mock.startTimer(t.id);
    now(D2, 2);

    const [today, yesterday] = await mock.dailyLog(D2, 2);
    expect(today.spanSeconds).toBe(2 * H);
    expect(yesterday.spanSeconds).toBe(H);
    expect(today.timeline).toEqual([]);
    expect(yesterday.timeline[0].running).toBe(true);
    await mock.stopAllTimers();
  });

  it("una corrida abierta cuenta hasta ahora, y la semana suma sus días", async () => {
    vi.useFakeTimers();
    const D = "2031-06-10";
    now(D, 9);
    const t = await mock.createTask({ title: "corriendo", scheduledDate: D, estimatedMinutes: 60 });
    await mock.startTimer(t.id);
    now(D, 11, 30);

    const [log] = await mock.dailyLog(D, 1);
    expect(log.spanSeconds).toBe(2.5 * H);
    expect(log.clockedSeconds).toBe(2.5 * H);
    const week = await mock.weeklyRollup(D);
    expect(week.days[0].spanSeconds).toBe(2.5 * H);
    expect(week.spanSeconds).toBe(2.5 * H);
    await mock.stopAllTimers();
  });
});
