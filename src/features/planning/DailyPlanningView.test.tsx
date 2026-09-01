import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DailyPlanningView } from "./DailyPlanningView";
import { api } from "../../lib/ipc";
import { shortDate, toISODate, todayISO } from "../../lib/date";
import { SettingKey, useSettingsStore } from "../../lib/settings";

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
    expect(screen.getByText("Quedó abierta")).toBeInTheDocument();
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

    await userEvent.click(await screen.findByText("Vengo de antes"));

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

    await userEvent.click(await screen.findByText("Se va a borrar"));
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
