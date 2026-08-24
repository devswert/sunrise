import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { todayISO } from "../../lib/date";

const demote = vi.fn(async () => 0);
const listObjectives = vi.fn(async () => []);
let rango: unknown[] = [];
const listTasksForRange = vi.fn(async () => rango);
/** Se resuelve a mano: es lo que deja mirar el board **antes** de la escritura. */
let soltarMove: (() => void) | null = null;
const moveTask = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      soltarMove = () => resolve();
    }),
);
let backlog: unknown[] = [];
const listBacklog = vi.fn(async () => backlog);
let rescates: unknown[] = [];
const rescuedFromBacklog = vi.fn(async () => rescates);

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    demotePending: (...a: unknown[]) => demote(...(a as [])),
    listTasksForRange: () => listTasksForRange(),
    listCategories: vi.fn(async () => []),
    listObjectives: (...a: unknown[]) => listObjectives(...(a as [])),
    moveTask: () => moveTask(),
    listBacklog: () => listBacklog(),
    rescuedFromBacklog: () => rescuedFromBacklog(),
  },
}));

/**
 * `useBoard` guarda en el módulo si ya arrastró hoy, así que cada test necesita
 * una instancia limpia: sin esto el segundo test heredaría el flag del primero.
 *
 * El store se importa del MISMO grafo recién creado: `resetModules` también
 * recrea `useAppStore`, y una referencia importada arriba apuntaría a otra
 * instancia, sobre la que el componente no está suscrito.
 */
async function freshBoard(range?: [string, string, string?], withBacklog = false) {
  vi.resetModules();
  const { useBoard } = await import("./useBoard");
  const { useAppStore } = await import("../../lib/store");
  let board: ReturnType<typeof useBoard> | null = null;
  function Probe() {
    const [start, end, weekOf] = range ?? [todayISO(), todayISO()];
    board = useBoard(start, end, weekOf, withBacklog);
    return null;
  }
  return { Probe, useAppStore, verBoard: () => board! };
}

describe("useBoard · degradación", () => {
  beforeEach(() => {
    demote.mockClear();
    listTasksForRange.mockClear();
  });

  it("corre una vez al montar, antes de la primera lectura", async () => {
    const { Probe } = await freshBoard();
    render(<Probe />);

    await waitFor(() => expect(listTasksForRange).toHaveBeenCalled());
    expect(demote).toHaveBeenCalledTimes(1);
    expect(demote).toHaveBeenCalledWith(todayISO());
  });

  it("NO vuelve a correr en cada invalidación de datos", async () => {
    const { Probe, useAppStore } = await freshBoard();
    render(<Probe />);
    await waitFor(() => expect(demote).toHaveBeenCalledTimes(1));

    // Tres mutaciones cualesquiera (o avisos de la otra ventana). Se esperan de
    // a una: varias seguidas se coalescen, porque el cleanup del efecto cancela
    // la recarga en vuelo de la anterior.
    for (let i = 0; i < 3; i++) {
      act(() => useAppStore.getState().markDataStale());
      // El board sí recarga con cada invalidación...
      await waitFor(() => expect(listTasksForRange).toHaveBeenCalledTimes(i + 2));
    }

    // ...pero el degradación, que es una mutación, no se repite.
    expect(demote).toHaveBeenCalledTimes(1);
  });

  it("dos vistas montadas a la vez comparten una sola corrida", async () => {
    const { Probe } = await freshBoard();
    render(
      <>
        <Probe />
        <Probe />
      </>,
    );

    await waitFor(() => expect(listTasksForRange).toHaveBeenCalledTimes(2));
    expect(demote).toHaveBeenCalledTimes(1);
  });
});

/**
 * La vista semana pide 21 días y **una** semana de objetivos. Si la semana se
 * dedujera del inicio del rango —como se hacía cuando el rango era la semana—,
 * la ventana de tres le daría los objetivos de dos semanas atrás, y con ellos el
 * selector de objetivo del modal, sin que nada se vea roto.
 */
describe("useBoard · la semana de los objetivos", () => {
  beforeEach(() => {
    demote.mockClear();
    listObjectives.mockClear();
    listTasksForRange.mockClear();
    rango = [];
  });

  it("pide la semana que le pasan, no la del inicio del rango", async () => {
    // Ventana de tres semanas alrededor del lunes 2026-08-10 (semana 33).
    const { Probe } = await freshBoard(["2026-08-03", "2026-08-23", "2026-08-10"]);
    render(<Probe />);

    await waitFor(() => expect(listObjectives).toHaveBeenCalled());
    expect(listObjectives).toHaveBeenCalledWith("2026-W33");
  });

  it("sin tercer argumento sigue siendo la del inicio del rango", async () => {
    const { Probe } = await freshBoard(["2026-08-03", "2026-08-09"]);
    render(<Probe />);

    await waitFor(() => expect(listObjectives).toHaveBeenCalled());
    expect(listObjectives).toHaveBeenCalledWith("2026-W32");
  });
});

/**
 * El reorden es **optimista**: el board se reordena antes de que la escritura
 * responda. Es lo que hace que la card se quede donde la soltaste en vez de
 * volver a su lugar viejo y entrar deslizándose cuando llegan los datos.
 */
describe("useBoard · reorden optimista", () => {
  const hoy = todayISO();
  const tarea = (id: number, position: number) => ({
    id,
    title: `t${id}`,
    status: "TODO",
    source: "MANUAL",
    sourceState: "ACTIVE",
    scheduledDate: hoy,
    position,
    actualSeconds: 0,
  });

  beforeEach(() => {
    demote.mockClear();
    listTasksForRange.mockClear();
    moveTask.mockClear();
    soltarMove = null;
    rango = [tarea(1, 0), tarea(2, 1), tarea(3, 2)];
  });

  it("la lista se reordena antes de que la escritura responda", async () => {
    const { Probe, verBoard } = await freshBoard();
    render(<Probe />);
    await waitFor(() => expect(verBoard().tasksByDate[hoy]?.length).toBe(3));

    // La primera al índice 2, que es el caso que se veía mal: hacia abajo.
    act(() => {
      void verBoard().moveTask(1, hoy, 2);
    });

    await waitFor(() =>
      expect(verBoard().tasksByDate[hoy].map((t) => t.id)).toEqual([2, 3, 1]),
    );
    // Todavía sin responder: el orden de arriba no vino de una recarga.
    expect(moveTask).toHaveBeenCalledTimes(1);
    expect(listTasksForRange).toHaveBeenCalledTimes(1);

    // Y al responder, la recarga trae lo mismo (el mock devuelve el orden viejo,
    // así que acá solo se comprueba que no se quede colgado).
    await act(async () => {
      soltarMove?.();
    });
  });
});

/**
 * El backlog dentro del board: es lo que hace posible el panel de la semana, y lo
 * que hay que vigilar es que **solo** llegue cuando se pide. Las otras tres
 * vistas que usan este hook (Today, planificación, cierre) no lo quieren, y sus
 * mocks no tienen esas funciones.
 */
describe("useBoard · el backlog opt-in", () => {
  const hoy = todayISO();
  const tarea = (id: number, scheduledDate: string | null, position = id) => ({
    id,
    title: `t${id}`,
    status: "TODO",
    source: "MANUAL",
    sourceState: "ACTIVE",
    scheduledDate,
    position,
    actualSeconds: 0,
  });

  beforeEach(() => {
    demote.mockClear();
    listBacklog.mockClear();
    rescuedFromBacklog.mockClear();
    moveTask.mockClear();
    soltarMove = null;
    rango = [tarea(1, hoy, 0)];
    backlog = [tarea(9, null, 1), tarea(8, null, 0)];
    rescates = [{ taskId: 9, fromDate: "2026-08-14" }];
  });

  it("sin el flag no se le pide el backlog a nadie", async () => {
    const { Probe, verBoard } = await freshBoard();
    render(<Probe />);
    await waitFor(() => expect(verBoard().tasks.length).toBe(1));

    expect(listBacklog).not.toHaveBeenCalled();
    expect(rescuedFromBacklog).not.toHaveBeenCalled();
    expect(verBoard().backlogTasks).toEqual([]);
  });

  it("con el flag las tareas sin fecha entran al mismo array, ordenadas por position", async () => {
    const { Probe, verBoard } = await freshBoard(undefined, true);
    render(<Probe />);
    await waitFor(() => expect(verBoard().backlogTasks.length).toBe(2));

    expect(verBoard().backlogTasks.map((t) => t.id)).toEqual([8, 9]);
    // En el mismo array: es lo que hace que el overlay y el modal las encuentren.
    expect(verBoard().tasks.map((t) => t.id)).toContain(9);
  });

  it("pero `tasksByDate` sigue sin verlas: las columnas de día no se enteran", async () => {
    const { Probe, verBoard } = await freshBoard(undefined, true);
    render(<Probe />);
    await waitFor(() => expect(verBoard().backlogTasks.length).toBe(2));

    expect(verBoard().tasksByDate[hoy].map((t) => t.id)).toEqual([1]);
    expect(Object.keys(verBoard().tasksByDate)).toEqual([hoy]);
  });

  it("los rescates llegan como mapa, salteando los que no traen día", async () => {
    rescates = [{ taskId: 9, fromDate: "2026-08-14" }, { taskId: 8, fromDate: "" }];
    const { Probe, verBoard } = await freshBoard(undefined, true);
    render(<Probe />);
    await waitFor(() => expect(verBoard().rescues.size).toBe(1));

    expect(verBoard().rescues.get(9)).toBe("2026-08-14");
  });
});

/**
 * Mover **desde o hacia** el backlog cambia lo que ven el sidebar (sus conteos
 * por contexto) y `BacklogView`, que se refrescan solo con `dataVersion`. Un
 * reordenamiento dentro de un día no cambia nada de eso, y despertar a la otra
 * ventana y al taxímetro por cada arrastre sería gratis para nadie.
 */
describe("useBoard · qué movimientos invalidan", () => {
  const hoy = todayISO();
  const tarea = (id: number, scheduledDate: string | null, position = id) => ({
    id,
    title: `t${id}`,
    status: "TODO",
    source: "MANUAL",
    sourceState: "ACTIVE",
    scheduledDate,
    position,
    actualSeconds: 0,
  });

  beforeEach(() => {
    demote.mockClear();
    moveTask.mockClear();
    soltarMove = null;
    rango = [tarea(1, hoy, 0), tarea(2, hoy, 1)];
    backlog = [tarea(9, null, 0)];
    rescates = [];
  });

  async function mover(id: number, date: string | null) {
    const { Probe, useAppStore, verBoard } = await freshBoard(undefined, true);
    render(<Probe />);
    await waitFor(() => expect(verBoard().tasks.length).toBe(3));
    const antes = useAppStore.getState().dataVersion;

    await act(async () => {
      const p = verBoard().moveTask(id, date, 0);
      soltarMove?.();
      await p;
    });

    return useAppStore.getState().dataVersion - antes;
  }

  it("mandar una tarea al backlog invalida", async () => {
    expect(await mover(1, null)).toBeGreaterThan(0);
  });

  it("sacar una tarea del backlog invalida", async () => {
    expect(await mover(9, hoy)).toBeGreaterThan(0);
  });

  it("reordenar dentro de un día no invalida", async () => {
    expect(await mover(1, hoy)).toBe(0);
  });
});
