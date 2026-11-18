/**
 * El contrato del store con **timers en paralelo** (#18), contra el `mockDb`
 * real y no contra dobles: un `vi.fn` estaría de acuerdo con cualquier cosa que
 * el store le pidiera, y lo que hay que probar es justamente que el store y el
 * gemelo de `repo.rs` digan lo mismo.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../lib/ipc";
import { todayISO } from "../../lib/date";
import { selectIsRunning, useTimerStore } from "./timerStore";

async function newTask(title: string): Promise<number> {
  const t = await api.createTask({ title, scheduledDate: todayISO() });
  return t.id;
}

const ids = () => useTimerStore.getState().actives.map((a) => a.taskId);

function reset() {
  localStorage.clear();
  useTimerStore.setState({
    actives: [],
    elapsedById: {},
    active: null,
    elapsed: 0,
    last: null,
    loaded: false,
  });
}

describe("timerStore con timers en paralelo", () => {
  beforeEach(async () => {
    await api.stopAllTimers();
    reset();
  });
  afterEach(async () => {
    await api.stopAllTimers();
  });

  it("start en paralelo suma el timer sin pausar el que corría", async () => {
    const a = await newTask("agente 1");
    const b = await newTask("agente 2");
    const { start } = useTimerStore.getState();

    await start(a);
    await start(b, { parallel: true });

    const s = useTimerStore.getState();
    expect(ids()).toEqual([a, b]);
    // Compat: `active` es el primero, y `elapsed` es el suyo.
    expect(s.active?.taskId).toBe(a);
    expect(s.elapsed).toBe(s.elapsedById[a]);
    expect(Object.keys(s.elapsedById).map(Number).sort()).toEqual([a, b].sort());
    expect(s.isRunning(a) && s.isRunning(b)).toBe(true);
    expect(selectIsRunning(b)(s)).toBe(true);
    // La base dice lo mismo que el store.
    expect((await api.getActiveTimers()).map((t) => t.taskId)).toEqual([a, b]);
  });

  it("el play clásico pausa todos los que corren y arranca esta", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const meeting = await newTask("reunión");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    await start(meeting);

    expect(ids()).toEqual([meeting]);
    expect((await api.getActiveTimers()).map((t) => t.taskId)).toEqual([meeting]);
  });

  it("darle play a la que ya corre no la reinicia ni pausa a las demás", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });
    const entry = useTimerStore.getState().actives[0].entryId;

    await useTimerStore.getState().start(a);

    expect(ids()).toEqual([a, b]);
    expect(useTimerStore.getState().actives[0].entryId).toBe(entry);
  });

  it("stop(taskId) pausa solo esa tarea y las demás siguen corriendo", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    const res = await useTimerStore.getState().stop(b);

    expect(res?.[0]).toBe(b);
    expect(ids()).toEqual([a]);
    expect(useTimerStore.getState().isRunning(b)).toBe(false);
    expect(useTimerStore.getState().last?.taskId).toBe(b);
    expect((await api.getActiveTimers()).map((t) => t.taskId)).toEqual([a]);
  });

  it("stop() sin id pausa el de `active` (el primero), como hacían las vistas", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    await useTimerStore.getState().stop();

    expect(ids()).toEqual([b]);
    expect(useTimerStore.getState().active?.taskId).toBe(b);
  });

  it("stop ignora un evento del mouse en vez de tomarlo por un id", async () => {
    const a = await newTask("a");
    await useTimerStore.getState().start(a);

    // Lo que llega si alguien pasa `stop` directo a un `onClick`.
    await useTimerStore.getState().stop({ type: "click" } as unknown as number);

    expect(ids()).toEqual([]);
  });

  it("stopAll pausa todos y deja en pausa la que se mostraba", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    const res = await useTimerStore.getState().stopAll();

    expect(res.map(([id]) => id)).toEqual([a, b]);
    expect(ids()).toEqual([]);
    expect(useTimerStore.getState().active).toBeNull();
    expect(useTimerStore.getState().last?.taskId).toBe(a);
    expect(await api.getActiveTimers()).toEqual([]);
  });

  it("toggle pausa solo la que corre, y sobre una detenida es el play clásico", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const c = await newTask("c");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    await useTimerStore.getState().toggle(b);
    expect(ids()).toEqual([a]);

    await start(b, { parallel: true });
    await useTimerStore.getState().toggle(c);
    expect(ids()).toEqual([c]);
  });

  it("el tick cuenta lo de hoy de cada timer por separado", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    // Diez minutos corridos en una y dos en la otra.
    const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    const [ta, tb] = useTimerStore.getState().actives;
    useTimerStore.setState({
      actives: [
        { ...ta, startedAt: ago(600) },
        { ...tb, startedAt: ago(120) },
      ],
    });
    useTimerStore.getState().tick();

    const s = useTimerStore.getState();
    expect(s.elapsedById[a]).toBeGreaterThanOrEqual(599);
    expect(s.elapsedById[a]).toBeLessThanOrEqual(601);
    expect(s.elapsedById[b]).toBeGreaterThanOrEqual(119);
    expect(s.elapsedById[b]).toBeLessThanOrEqual(121);
    expect(s.elapsed).toBe(s.elapsedById[a]);
  });

  it("completar la del taxímetro no pausa la que corre en paralelo", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    await useTimerStore.getState().completeAndAdvance();

    expect((await api.getTask(a))?.status).toBe("DONE");
    expect(ids()).toEqual([b]);
    expect(useTimerStore.getState().active?.taskId).toBe(b);
  });

  it("completar una tarea desde fuera detiene solo su timer (setTaskStatus)", async () => {
    const a = await newTask("a");
    const b = await newTask("b");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });

    await api.setTaskStatus(b, "DONE");
    await useTimerStore.getState().refresh();

    expect(ids()).toEqual([a]);
  });
});
