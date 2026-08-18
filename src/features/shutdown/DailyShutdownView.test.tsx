import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DailyShutdownView } from "./DailyShutdownView";
import { DailyHighlightsView } from "./DailyHighlightsView";
import { api } from "../../lib/ipc";
import { todayISO } from "../../lib/date";
import { useAppStore } from "../../lib/store";

// El canvas de jsdom no implementa `getContext`.
const celebrar = vi.fn();
vi.mock("../../lib/confetti", () => ({ celebrar: () => celebrar() }));

function montar(ruta = "/daily-shutdown") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/daily-shutdown" element={<DailyShutdownView />} />
        <Route path="/daily-highlights" element={<DailyHighlightsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Una tarea cerrada hoy. */
async function cerradaHoy(titulo: string) {
  const t = await api.createTask({
    title: titulo,
    scheduledDate: todayISO(),
    estimatedMinutes: 30,
  });
  await api.setTaskStatus(t.id, "DONE");
  return t;
}

/**
 * OJO con el orden: el mock guarda la bitácora en memoria del módulo, así que el
 * caso que comprueba que el día arranca **sin cerrar** tiene que correr antes del
 * que lo cierra, y varios casos se apoyan en lo que subió el anterior.
 */
describe("DailyShutdownView", () => {
  it("el día arranca sin cerrar, y cerrar no es obligatorio", async () => {
    montar();

    expect(await screen.findByRole("button", { name: /Cerrar el día/ })).toBeInTheDocument();
    expect(screen.getByText(/queda como borrador/i)).toBeInTheDocument();
  });

  it("incluir sube la tarea a highlights y abre su resumen", async () => {
    // Incluir y escribir son gestos distintos: primero se sube, después se
    // escribe. Antes de subirla no hay dónde escribir.
    const t = await cerradaHoy("revisar el rollup");
    montar();

    expect(await screen.findByText("Otras actividades")).toBeInTheDocument();
    expect(screen.queryByLabelText(`Resumen de ${t.title}`)).toBeNull();

    // Hay más cerradas hoy en la semilla del mock: se aprieta el "Incluir" de
    // la fila de esta tarea, no el primero que aparezca.
    const fila = screen.getByText(t.title).closest("li")!;
    await userEvent.click(within(fila).getByRole("button", { name: /Incluir/ }));

    const campo = await screen.findByLabelText(`Resumen de ${t.title}`);
    await userEvent.click(campo);
    await userEvent.paste("costó más de lo que parecía");
    await userEvent.tab();

    await waitFor(async () => {
      const [dia] = await api.bitacora(todayISO(), 1);
      expect(dia.hechas.find((h) => h.task.id === t.id)?.note).toBe("costó más de lo que parecía");
    });
  });

  it("vaciar el resumen no la baja de highlights; sacarla es aparte", async () => {
    const [previo] = await api.bitacora(todayISO(), 1);
    const subida = previo.hechas.find((h) => h.note != null)!;
    montar();

    const campo = await screen.findByLabelText(`Resumen de ${subida.task.title}`);
    await userEvent.clear(campo);
    await userEvent.tab();

    // Sigue arriba, con el resumen vacío.
    await waitFor(async () => {
      const [d] = await api.bitacora(todayISO(), 1);
      expect(d.hechas.find((h) => h.task.id === subida.task.id)?.note).toBe("");
    });

    await userEvent.click(
      screen.getByRole("button", { name: `Sacar ${subida.task.title} de los highlights` }),
    );

    await waitFor(async () => {
      const [d] = await api.bitacora(todayISO(), 1);
      expect(d.hechas.find((h) => h.task.id === subida.task.id)?.note).toBeNull();
    });
  });

  it("el ánimo se elige de la grilla, y volver a elegirlo lo borra", async () => {
    montar();

    await userEvent.click(await screen.findByRole("button", { name: /Elegir el ánimo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Ánimo 🙂" }));

    await waitFor(async () => {
      const [d] = await api.bitacora(todayISO(), 1);
      expect(d.mood).toBe("🙂");
    });

    // Es un toggle: el mismo emoji lo saca.
    await userEvent.click(screen.getByRole("button", { name: /Cambiar el ánimo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Ánimo 🙂" }));

    await waitFor(async () => {
      const [d] = await api.bitacora(todayISO(), 1);
      expect(d.mood).toBeNull();
    });
  });

  it("las pendientes se ven pero no se replanifican desde acá", async () => {
    // Mover una tarea es del daily planning: dos lugares para lo mismo obligan a
    // mantener la misma regla en dos sitios.
    await api.createTask({ title: "no alcancé", scheduledDate: todayISO() });
    montar();

    expect(await screen.findByText("no alcancé")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mandar no alcancé/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pasar no alcancé/ })).toBeNull();
  });

  it("recargar no pisa una nota a medio escribir", async () => {
    // `load` corre con **cada** invalidación —tildar una tarea, incluir otra, un
    // aviso de la otra ventana—, y sembrar los campos desde el servidor borraba
    // lo que estabas escribiendo. Se invalida a mano y no con un click para que
    // el caso no dependa de qué botón dispara la recarga: lo que se prueba es la
    // recarga, no el botón.
    montar();

    const campo = await screen.findByLabelText("Cómo estuvo el día");
    await userEvent.click(campo);
    await userEvent.paste("a medio escribir");
    await act(async () => {
      useAppStore.getState().bumpData();
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Cómo estuvo el día")).toHaveValue("a medio escribir"),
    );
  });

  it("cerrar el día lo sella, tira confeti y lleva a la bitácora", async () => {
    montar();

    const campo = await screen.findByLabelText("Cómo estuvo el día");
    await userEvent.click(campo);
    // El caso anterior dejó texto guardado (su click en el botón hizo blur, y el
    // blur guarda): sin limpiar, esto se concatena.
    await userEvent.clear(campo);
    await userEvent.paste("día largo pero salió");
    await userEvent.click(screen.getByRole("button", { name: /Cerrar el día/ }));

    await waitFor(() => expect(screen.getByText("Daily highlights")).toBeInTheDocument());
    expect(celebrar).toHaveBeenCalled();
    const [dia] = await api.bitacora(todayISO(), 1);
    expect(dia.closedAt).not.toBeNull();
    expect(dia.note).toBe("día largo pero salió");
  });

  it("un día ya cerrado ofrece reabrirlo en vez de volver a cerrarlo", async () => {
    // Lo cerró el caso anterior; el estado del mock es de módulo.
    montar();

    expect(await screen.findByText(/Cerraste este día/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cerrar el día/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Reabrir/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cerrar el día/ })).toBeInTheDocument(),
    );
  });
});

describe("DailyHighlightsView", () => {
  it("la bitácora muestra el día con lo cerrado y su timeline", async () => {
    const t = await cerradaHoy("algo con tiempo");
    await api.setActualSeconds(t.id, 1800);
    // Incluida, porque subir es lo que la vuelve un highlight (ver el caso
    // siguiente). Sin eso quedaría contada en "y N más".
    await api.incluirEnBitacora(todayISO(), t.id);

    montar("/daily-highlights");

    const hoy = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dia");
      expect(el).not.toBeNull();
      return el!;
    });
    // Sale dos veces a propósito: como highlight a la izquierda y como tramo del
    // timeline a la derecha. Son dos preguntas distintas sobre la misma tarea.
    await waitFor(() =>
      expect(
        within(hoy.querySelector<HTMLElement>(".dia__izq")!).getByText("algo con tiempo"),
      ).toBeInTheDocument(),
    );
    const tl = hoy.querySelector<HTMLElement>(".dia__tl")!;
    expect(within(tl).getByText("algo con tiempo")).toBeInTheDocument();
    expect(within(tl).getByText("0:30")).toBeInTheDocument();
  });

  it("solo salen las incluidas, y las demás se cuentan", async () => {
    // Incluir es curar: en un día de ocho cerradas puede que solo cinco valgan
    // una línea. Lo que queda afuera **se dice**, no se esconde.
    await cerradaHoy("ésta no la sube");

    montar("/daily-highlights");

    const izq = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dia__izq");
      expect(el).not.toBeNull();
      return el!;
    });
    await waitFor(() => expect(within(izq).getByText("algo con tiempo")).toBeInTheDocument());
    expect(within(izq).queryByText("ésta no la sube")).toBeNull();
    expect(within(izq).getByText(/más, sin resumen/)).toBeInTheDocument();
  });

  it("el donut de channels arranca plegado", async () => {
    montar("/daily-highlights");

    const toggle = await screen.findByRole("button", { name: /Channels/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".donut")).toBeNull();

    await userEvent.click(toggle);

    await waitFor(() => expect(document.querySelector(".donut")).not.toBeNull());
  });

  it("hacer click en un hito abre el detalle de la tarea", async () => {
    montar("/daily-highlights");

    await userEvent.click(await screen.findByRole("button", { name: /algo con tiempo/ }));

    expect(await screen.findByLabelText("Detalle de tarea")).toBeInTheDocument();
  });
});
