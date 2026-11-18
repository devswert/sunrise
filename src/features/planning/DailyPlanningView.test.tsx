import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DailyPlanningView } from "./DailyPlanningView";
import { api } from "../../lib/ipc";
import { shortDate, toISODate, todayISO } from "../../lib/date";
import { SettingKey, useSettingsStore } from "../../lib/settings";
import { useTimerStore } from "../timer/timerStore";

// El canvas de jsdom no implementa `getContext`: la llamada real reventaría en
// cuanto un test aprete el botón del final. Por eso vive en su propio módulo.
const celebrate = vi.fn();
vi.mock("../../lib/confetti", () => ({ celebrate: () => celebrate() }));

function mount() {
  return render(
    <MemoryRouter initialEntries={["/daily-planning"]}>
      <Routes>
        <Route path="/daily-planning" element={<DailyPlanningView />} />
        <Route path="/" element={<div>La semana</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Hace `n` días. `toISODate` y no `toISOString`: cortar el UTC adelanta el día
 * varias horas antes de medianoche. */
function hace(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

const goToToday = () => userEvent.click(screen.getByRole("button", { name: /Qué hay para hoy/ }));

/**
 * El repaso del paso 1. Las tareas del día anterior salen ahí **y** en el rail,
 * que muestra ese mismo día: buscarlas en toda la pantalla da dos resultados.
 */
async function recap() {
  return within(
    await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".repaso");
      expect(el).not.toBeNull();
      return el!;
    }),
  );
}

/**
 * Mueve el reloj a `date` a las `hour:minute` hora local, corre `fn` y lo deja
 * en el real antes de salir: el resto del archivo corre con él.
 */
async function at(date: string, hour: number, minute: number, fn: () => Promise<unknown>) {
  const [y, m, d] = date.split("-").map(Number);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(y, m - 1, d, hour, minute));
    await fn();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Una corrida real del taxímetro desde las 10:00 hora local de `date`, de 40
 * minutos salvo que se diga otra cosa. Un ajuste a mano no sirve: no tiene hora
 * (`trackedAt` nulo) y no dibuja bloque trabajado.
 */
async function runTimerOn(date: string, taskId: number, seconds = 40 * 60) {
  await at(date, 10, 0, () => api.startTimer(taskId));
  await at(date, 10, 0, async () => {
    vi.setSystemTime(Date.now() + seconds * 1000);
    await api.stopTimer(taskId);
  });
}

/**
 * Los `title` de los bloques del rail —"10:00 AM – 10:40 AM · Tarea · trabajado"—,
 * que dicen hora, tarea y tipo en el texto que ve quien pasa el mouse. Sin el
 * " · sin channel" del aviso de #7: las tareas de estos tests no tienen channel, y
 * lo que se mira acá es el día y el tipo del bloque, no el aviso.
 */
function railBlockTitles(): string[] {
  const aside = screen.getByRole("complementary", { name: "Agenda del día" });
  return [...aside.querySelectorAll<HTMLElement>("button[title]")].map((b) =>
    b.title.replace(/ · sin channel$/, ""),
  );
}

/** Los bloques trabajados del rail, cuando ya llegaron. */
function railWorkedTitles() {
  return waitFor(() => {
    const titles = railBlockTitles().filter((t) => t.endsWith(" · trabajado"));
    expect(titles.length).toBeGreaterThan(0);
    return titles;
  });
}

/** La cifra "trabajado" de la portada del repaso. */
function workedFigure(): string {
  const label = screen.getByText("trabajado", { selector: ".cifra__label" });
  return label.previousElementSibling!.textContent!;
}

/** El rail de la vista. Se busca adentro para no confundirlo con el repaso ni con la columna del día. */
const rail = () => within(screen.getByRole("complementary", { name: "Agenda del día" }));

/**
 * Manda al backlog lo que la semilla del mock dejó en días pasados.
 *
 * **La semilla es data de preview, no una fixture**: fija sus fechas por día de la
 * semana (`weekDates`), así que cuáles caen en el pasado depende del día en que
 * corras los tests. Un caso que repasa "el último día con tareas" tiene que partir
 * de que el único día pasado con algo es el suyo, o el ritual repasa el de la
 * semilla y el conteo calza de casualidad. Pasó: estos tests pasaban los martes y
 * se caían de miércoles a domingo, y lo encontró CI corriendo en UTC.
 */
async function limpiarDiasPasados() {
  const previas = await api.listTasksForRange(hace(30), hace(1));
  for (const t of previas) await api.moveTask(t.id, null, 0);
}

/**
 * OJO con el orden de los casos, dos veces:
 *
 * 1. El mock guarda los ajustes en memoria del módulo, así que el caso que
 *    comprueba que no se escribe nada tiene que correr **antes** del que cierra
 *    el ritual.
 * 2. `useBoard` corre la degradación **una sola vez por archivo**, en el primer
 *    montaje. Los casos que dejan una tarea en un día pasado dependen de que ya
 *    haya corrido; aislarlos con `-t` los deja pasar en falso, porque ahí sí se
 *    ejecuta y les manda la tarea al backlog.
 *
 * Y una tercera, de los casos del rail: las corridas del taxímetro **no se
 * borran** al mandar su tarea al backlog, y el rail del paso 1 dibuja lo
 * trabajado ese día aunque la tarea ya no esté ahí. Un caso que corre el
 * taxímetro en `hace(2)` deja su bloque en el rail de los que vienen después;
 * por eso esos casos buscan su propia tarea y no comparan la lista entera.
 */
describe("DailyPlanningView", () => {
  beforeEach(() => {
    celebrate.mockClear();
    useSettingsStore.setState({ values: {}, loaded: true });
  });

  it("arranca en el repaso del día anterior", async () => {
    await limpiarDiasPasados();
    mount();
    await waitFor(() =>
      expect(screen.getByText(/No hay días anteriores con tareas/)).toBeInTheDocument(),
    );
  });

  it("repasa el último día con tareas, no 'ayer' a secas", async () => {
    // Un lunes, ayer es domingo y está vacío: lo que hay que revisar es el
    // viernes. La ventana mira varios días hacia atrás y elige el último.
    await limpiarDiasPasados();
    await api.createTask({ title: "Quedó abierta", scheduledDate: hace(3) });
    const hecha = await api.createTask({ title: "Se cerró", scheduledDate: hace(3) });
    await api.setTaskStatus(hecha.id, "DONE");
    mount();

    const figures = await waitFor(() => {
      const el = document.querySelector(".repaso__cifras");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(figures.textContent).toMatch(/1\/2\s*cerradas/);
    expect((await recap()).getByText("Quedó abierta")).toBeInTheDocument();
  });

  it("trae a hoy lo que quedó abierto, que es lo que el carry-over no toca", async () => {
    // Las de calendario se quedan en su día para siempre: `carry_over` solo
    // mueve las MANUAL. Sin este botón no había forma de rescatarlas.
    await api.createTask({ title: "Reunión del sábado", scheduledDate: hace(1) });
    mount();

    await userEvent.click(await screen.findByRole("button", { name: /Traer Reunión del sábado/ }));

    await goToToday();
    // En la columna del día, no en el rail (que también la dibuja).
    const columna = document.querySelector<HTMLElement>(".daily-plan__col")!;
    await waitFor(() =>
      expect(within(columna).getByText("Reunión del sábado")).toBeInTheDocument(),
    );
  });

  it("abre el detalle de una tarea del día anterior", async () => {
    // `useBoard` solo carga hoy: buscar ahí la tarea del paso 1 dejaba el click
    // sin efecto, que es peor que no ser clickeable.
    await limpiarDiasPasados();
    await api.createTask({ title: "Vengo de antes", scheduledDate: hace(2) });
    mount();

    await userEvent.click(await (await recap()).findByText("Vengo de antes"));

    expect(await screen.findByRole("dialog", { name: "Detalle de tarea" })).toBeInTheDocument();
  });

  it("borrar una tarea del día anterior la saca de la vista", async () => {
    // El paso 1 lee `previas`, que es estado propio de la vista: sin un aviso de
    // datos, borrar escribía en la base y dejaba la card en pantalla — el gesto
    // se sentía muerto y el siguiente click abría el detalle de algo que ya no
    // existía.
    await limpiarDiasPasados();
    await api.createTask({ title: "Se va a borrar", scheduledDate: hace(2) });
    mount();

    await userEvent.click(await (await recap()).findByText("Se va a borrar"));
    const detalle = await screen.findByRole("dialog", { name: "Detalle de tarea" });
    await userEvent.click(within(detalle).getByRole("button", { name: "Eliminar tarea" }));
    await userEvent.click(within(detalle).getByRole("button", { name: /Sí, eliminar/ }));

    await waitFor(() => expect(screen.queryByText("Se va a borrar")).toBeNull());
  });

  it("lo pendiente de días anteriores al repasado ya está en el backlog", async () => {
    // Ya no se arrastra nada a hoy: la degradación diaria lo baja al backlog en
    // primera posición, y el ritual repasa el último día, que queda intacto.
    await limpiarDiasPasados();
    await api.createTask({ title: "Del lunes lejano", scheduledDate: hace(6) });
    await api.createTask({ title: "Ancla de ayer", scheduledDate: hace(1) });
    // Explícito y no vía `useBoard`: su guarda corre una sola vez por archivo y
    // para este caso ya se gastó en un test anterior.
    await api.demotePending(todayISO());
    mount();
    await goToToday();

    const cols = document.querySelectorAll<HTMLElement>(".daily-plan__col");
    await waitFor(() => expect(within(cols[1]).getByText("Del lunes lejano")).toBeInTheDocument());
    // El rótulo del grupo lleva **la fecha del día del que se cayó**, una sola vez
    // para todas las de ese día (Mej.21). Se lee del `.col-grupo` y no con
    // `getByText` porque el icono parte el texto en dos nodos.
    const rotulos = [...cols[1].querySelectorAll(".col-grupo")].map((e) => e.textContent!.trim());
    expect(rotulos).toContain(`Desde el ${shortDate(hace(6))}`);
  });

  it("el peso del día se ve en los dos pasos, no en una card aparte", async () => {
    // La semilla del mock deja tareas de hoy: el medidor tiene que contarlas.
    mount();
    await waitFor(() => expect(document.querySelector(".cap-line")).not.toBeNull());
    expect(screen.getByText(/sin comprometer|lleno|pasaste|vac/i)).toBeInTheDocument();

    await goToToday();
    expect(document.querySelector(".cap-line")).not.toBeNull();
  });

  it("el backlog es una columna del paso 2, para arrastrar en los dos sentidos", async () => {
    // Sacar del día es soltar acá: por eso ya no hay botones que hagan lo mismo.
    await api.createTask({ title: "Algún día" });
    mount();
    await goToToday();

    expect(await screen.findByText("Backlog")).toBeInTheDocument();
    const col = document.querySelectorAll(".daily-plan__col");
    expect(col).toHaveLength(2);
    expect(within(col[1] as HTMLElement).getByText("Algún día")).toBeInTheDocument();
  });

  it("no guarda nada al entrar: el ritual no es un formulario", async () => {
    // Todo lo que se toca acá ya persiste solo. Si montar la vista escribiera
    // `planned_at`, el sello del final dejaría de significar algo.
    mount();
    await goToToday();
    await waitFor(() => expect(document.querySelector(".cap-line")).not.toBeNull());

    const pares = await api.listSettings();
    expect(pares.find(([k]) => k === SettingKey.PLANNED_AT)).toBeUndefined();
  });

  it("entrar a un día ya planificado avisa, y deja revisarlo igual", async () => {
    // El sello en la cabecera se leía como decoración. El ritual está para
    // hacerse una vez y volver a entrar suele ser sin querer.
    useSettingsStore.setState({ values: { planned_at: `${todayISO()}T00:20` }, loaded: true });
    mount();

    const notice = await screen.findByRole("alertdialog", { name: "Ya planificaste hoy" });
    await userEvent.click(within(notice).getByRole("button", { name: /Revisar igual/ }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("La semana")).toBeNull();
  });

  it("el aviso dice a qué hora planificaste, que es lo que lo hace desmentible", async () => {
    // La hora sale de la marca guardada, no del reloj de ahora: un diálogo que
    // muestre la hora actual se ve perfecto el día que lo pruebas.
    useSettingsStore.setState({ values: { planned_at: `${todayISO()}T00:20` }, loaded: true });
    mount();

    const notice = await screen.findByRole("alertdialog");
    expect(within(notice).getByText(/a las 00:20/)).toBeInTheDocument();
  });

  it("una marca sin hora avisa igual, sin inventarle una", async () => {
    // Una fecha pelada es lo que guardaba la versión anterior, y lo que puede
    // quedar de una edición a mano. Vale como "ese día" y nada más.
    useSettingsStore.setState({ values: { planned_at: todayISO() }, loaded: true });
    mount();

    const notice = await screen.findByRole("alertdialog");
    expect(within(notice).getByText(/no dice a qué hora/)).toBeInTheDocument();
    expect(within(notice).queryByText(/a las \d/)).toBeNull();
  });

  it("desmentir el aviso borra la marca y deja seguir el ritual", async () => {
    await useSettingsStore.getState().set(SettingKey.PLANNED_AT, `${todayISO()}T00:20`);
    mount();

    const notice = await screen.findByRole("alertdialog");
    await userEvent.click(within(notice).getByRole("button", { name: /Volver a planificar hoy/ }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("La semana")).toBeNull();
    await waitFor(() => expect(useSettingsStore.getState().values[SettingKey.PLANNED_AT]).toBe(""));
  });

  it("desde el aviso se puede salir a la semana", async () => {
    useSettingsStore.setState({ values: { planned_at: `${todayISO()}T09:00` }, loaded: true });
    mount();

    const notice = await screen.findByRole("alertdialog");
    await userEvent.click(within(notice).getByRole("button", { name: /Ir a la semana/ }));

    expect(await screen.findByText("La semana")).toBeInTheDocument();
  });

  it("una marca de otro día no avisa: la comparación es contra hoy", async () => {
    // Nadie limpia la marca al cambiar el día, y no hace falta: caduca sola
    // porque lo que se compara es su fecha contra `today`. Si esto se rompe, la
    // app avisa "ya planificaste hoy" con la marca de ayer y no hay forma de
    // notarlo mirando el código del aviso.
    useSettingsStore.setState({ values: { planned_at: `${hace(1)}T09:00` }, loaded: true });
    mount();
    await waitFor(() => expect(document.querySelector(".cap-line")).not.toBeNull());

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("un día sin planificar no avisa nada", async () => {
    mount();
    await waitFor(() => expect(document.querySelector(".cap-line")).not.toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  /**
   * El mismo toolbox del panel del backlog de la semana. Acá el backlog puede
   * traer decenas de tareas y hay que elegir un puñado, que es exactamente el
   * problema para el que se hizo el control.
   */
  it("el backlog del paso 2 se puede filtrar por prioridad", async () => {
    const arde = await api.createTask({ title: "Arde y es del backlog" });
    await api.updateTask(arde.id, { priority: "P1" });
    await api.createTask({ title: "Puede esperar y es del backlog" });
    mount();
    await goToToday();

    const backlogCol = await waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>(".day-col")].find((c) =>
        c.textContent?.includes("Agregar al backlog"),
      );
      expect(el).toBeDefined();
      return el!;
    });
    expect(within(backlogCol).getByText("Puede esperar y es del backlog")).toBeInTheDocument();

    await userEvent.click(within(backlogCol).getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "P1" }));

    expect(within(backlogCol).getByText("Arde y es del backlog")).toBeInTheDocument();
    expect(within(backlogCol).queryByText("Puede esperar y es del backlog")).toBeNull();
    // Y la cabecera dice cuántas de cuántas: el número a secas escondería que el
    // backlog tiene más.
    expect(backlogCol.querySelector(".day-col__date")!.textContent).toMatch(/ de /);
  });

  /** El agrupado no se ofrece acá: la columna es una lista plana. */
  it("el toolbox del ritual no trae el par Channel/Contexto", async () => {
    mount();
    await goToToday();

    const backlogCol = await waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>(".day-col")].find((c) =>
        c.textContent?.includes("Agregar al backlog"),
      );
      expect(el).toBeDefined();
      return el!;
    });
    await userEvent.click(within(backlogCol).getByLabelText("Filtrar y ordenar"));

    expect(screen.queryByRole("button", { name: "Contexto" })).toBeNull();
    expect(screen.getByRole("button", { name: "Prioridad" })).toBeInTheDocument();
  });

  it("el rail del paso 1 muestra el día que se repasa, y el del paso 2 muestra hoy", async () => {
    // Una tarea con hora hace de reunión: el mock no importa calendarios, y para
    // el rail las dos son lo mismo, un bloque fijo a su hora. Con un solo rail
    // de hoy para los dos pasos, el repaso de ayer se leía al lado de la agenda
    // de hoy.
    await limpiarDiasPasados();
    await api.createTask({
      title: "Reunión de antes",
      scheduledDate: hace(2),
      scheduledTime: "10:00",
      estimatedMinutes: 30,
    });
    await api.createTask({
      title: "Reunión de hoy",
      scheduledDate: todayISO(),
      scheduledTime: "11:00",
      estimatedMinutes: 30,
    });
    mount();

    await recap();
    await waitFor(() => expect(rail().getByText("Reunión de antes")).toBeInTheDocument());
    expect(rail().queryByText("Reunión de hoy")).toBeNull();
    // La línea de "ahora" es de hoy: en el día repasado mentiría.
    expect(document.querySelector(".rail__ahora")).toBeNull();

    await goToToday();
    await waitFor(() => expect(rail().getByText("Reunión de hoy")).toBeInTheDocument());
    expect(rail().queryByText("Reunión de antes")).toBeNull();
    // Y en hoy vuelve: la grilla es de 24 h, así que "ahora" siempre cae adentro.
    expect(document.querySelector(".rail__ahora")).not.toBeNull();
  });

  it("en el paso 1, los bloques trabajados del rail son los del día que se repasa", async () => {
    // Con lo trabajado de hoy, la tarea saldría proyectada y no trabajada.
    await limpiarDiasPasados();
    const task = await api.createTask({ title: "Trabajada antes", scheduledDate: hace(2) });
    await runTimerOn(hace(2), task.id);
    mount();

    await recap();
    expect(await railWorkedTitles()).toEqual(["10:00 AM – 10:40 AM · Trabajada antes · trabajado"]);
  });

  it("traer a hoy una tarea trabajada ese día la deja en el rail y no cambia lo trabajado", async () => {
    // El tiempo es del día en que corrió el taxímetro, no del día donde vive la
    // tarea. Sin esto, "Traer a hoy" borraba el bloque y la portada lo seguía
    // contando. Y en ese día solo se dibuja lo trabajado: lo que le falta es de hoy.
    await limpiarDiasPasados();
    await api.createTask({ title: "Ancla del día", scheduledDate: hace(2) });
    const task = await api.createTask({
      title: "Traída después",
      scheduledDate: hace(2),
      estimatedMinutes: 120,
    });
    await runTimerOn(hace(2), task.id);
    const view = mount();

    await recap();
    const block = "10:00 AM – 10:40 AM · Traída después · trabajado";
    // `toContain` y no la lista exacta: los casos anteriores dejaron corridas ese
    // mismo día, y sus tareas —ya en el backlog— también salen, por la misma regla.
    expect(await railWorkedTitles()).toContain(block);
    const before = workedFigure();

    await userEvent.click(screen.getByRole("button", { name: "Traer Traída después a hoy" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Traer Traída después a hoy" })).toBeNull(),
    );

    // Se vuelve a abrir el ritual: recién montado lee todo de la base, y sin eso
    // la aserción podía pasar en el frame anterior a la relectura.
    view.unmount();
    mount();
    await recap();
    await waitFor(() => expect(railBlockTitles()).toContain(block));
    expect(railBlockTitles().filter((t) => t.includes("Traída después"))).toEqual([block]);
    await waitFor(() => expect(workedFigure()).toBe(before));
  });

  it("una corrida de segundos no deja proyectada en el día repasado la tarea que se trajo a hoy", async () => {
    // El rail redondea a minutos: 20 s no dibujan bloque trabajado, y sin el
    // mismo umbral la tarea caía al camino normal y salía proyectada media hora.
    await limpiarDiasPasados();
    await api.createTask({ title: "Ancla breve", scheduledDate: hace(2) });
    const task = await api.createTask({ title: "Apenas tocada", scheduledDate: hace(2) });
    await runTimerOn(hace(2), task.id, 20);
    await api.moveTask(task.id, todayISO(), 0);
    mount();

    await recap();
    await waitFor(() =>
      expect(railBlockTitles().some((t) => t.includes("Ancla breve"))).toBe(true),
    );
    expect(railBlockTitles().filter((t) => t.includes("Apenas tocada"))).toEqual([]);
  });

  it("una corrida que arrancó el día repasado y sigue abierta no dibuja bloque trabajado ahí", async () => {
    // Sus segundos todavía no están escritos: sin esto salía un bloque de un
    // minuto a la hora del play, que además crecía con el taxímetro de hoy.
    await limpiarDiasPasados();
    const task = await api.createTask({ title: "Sigue corriendo", scheduledDate: hace(3) });
    await at(hace(3), 10, 0, () => api.startTimer(task.id));
    try {
      mount();

      await recap();
      await waitFor(() =>
        expect(railBlockTitles().some((t) => t.includes("Sigue corriendo"))).toBe(true),
      );
      expect(railBlockTitles().filter((t) => t.includes("Sigue corriendo · trabajado"))).toEqual(
        [],
      );
    } finally {
      // Se cierra ese mismo día: abierta, el próximo `startTimer` la cerraría
      // con días de segundos.
      await at(hace(3), 11, 0, () => api.stopTimer(task.id));
    }
  });

  it("con el taxímetro corriendo hoy, el rail del paso 1 no lo suma y el del paso 2 sí", async () => {
    // La misma tarea se trabajó el día repasado y sigue corriendo hoy. En el
    // repaso su bloque es lo de ese día; en el paso 2 crece con la corrida.
    await limpiarDiasPasados();
    await api.createTask({ title: "Ancla en curso", scheduledDate: hace(2) });
    const task = await api.createTask({ title: "En curso hoy", scheduledDate: hace(2) });
    await runTimerOn(hace(2), task.id);
    await api.moveTask(task.id, todayISO(), 0);
    const active = await api.startTimer(task.id);
    // Una hora corriendo: el store es el que alimenta `segundosEnCurso`.
    const corriendo = { ...active, startedAt: new Date(Date.now() - 3600 * 1000).toISOString() };
    useTimerStore.setState({ active: corriendo, actives: [corriendo] });
    try {
      mount();

      await recap();
      await waitFor(() =>
        expect(railBlockTitles().filter((t) => t.includes("En curso hoy"))).toEqual([
          "10:00 AM – 10:40 AM · En curso hoy · trabajado",
        ]),
      );

      await goToToday();
      await waitFor(() => {
        const today = railBlockTitles().filter((t) => t.includes("En curso hoy · trabajado"));
        expect(today).toHaveLength(1);
        expect(today[0]).not.toMatch(/^10:00 AM – 10:40 AM/);
      });
    } finally {
      useTimerStore.setState({ active: null, actives: [], elapsed: 0, elapsedById: {} });
      await api.stopTimer(task.id);
    }
  });

  it("sin día anterior, el rail del paso 1 muestra hoy", async () => {
    // Primer uso: no hay otro día que repasar, y un rail vacío no le sirve a nadie.
    await limpiarDiasPasados();
    await api.createTask({
      title: "Sola hoy",
      scheduledDate: todayISO(),
      scheduledTime: "12:00",
      estimatedMinutes: 30,
    });
    mount();

    await screen.findByText(/No hay días anteriores con tareas/);
    await waitFor(() => expect(rail().getByText("Sola hoy")).toBeInTheDocument());
  });

  it("un bloque del rail del día repasado abre su detalle", async () => {
    // `useBoard` solo carga hoy: el detalle tiene que buscar también en las
    // tareas de los días previos, o el click no hace nada.
    await limpiarDiasPasados();
    await api.createTask({
      title: "Reunión vieja",
      scheduledDate: hace(2),
      scheduledTime: "09:30",
      estimatedMinutes: 30,
    });
    mount();

    await recap();
    await userEvent.click(await rail().findByText("Reunión vieja"));

    const detail = await screen.findByRole("dialog", { name: "Detalle de tarea" });
    expect(within(detail).getByDisplayValue("Reunión vieja")).toBeInTheDocument();
  });

  it("terminar el ritual marca el día, tira confeti y vuelve a la semana", async () => {
    mount();
    await goToToday();

    await userEvent.click(await screen.findByRole("button", { name: "Empezar el día" }));

    expect(await screen.findByText("La semana")).toBeInTheDocument();
    expect(celebrate).toHaveBeenCalledTimes(1);
    const pares = await api.listSettings();
    // Fecha **y** hora, y el prefijo tiene que ser el día de hoy en hora local:
    // con la fecha en UTC, las últimas horas del día marcarían el día siguiente.
    const marca = pares.find(([k]) => k === SettingKey.PLANNED_AT)?.[1];
    expect(marca).toMatch(new RegExp(`^${todayISO()}T\\d{2}:\\d{2}$`));
  });
});
