import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";
import { api } from "../../lib/ipc";
import { SettingKey, useSettingsStore, workHours } from "../../lib/settings";

describe("SettingsView", () => {
  it("lista las categorías sembradas (mock)", async () => {
    render(<SettingsView />);
    // El mock provee las categorías padre por defecto.
    expect(await screen.findByDisplayValue("Thinking")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Meetings")).toBeInTheDocument();
  });
});

/**
 * `workHours()` ya cae al default con basura, pero esa es la defensa al leer la
 * base. El formulario tiene que rechazar **al escribir**: si se traga un valor
 * inválido, el rail no cambia y nada explica por qué.
 */
describe("SettingsView · jornada", () => {
  beforeEach(async () => {
    await useSettingsStore.getState().set(SettingKey.WORK_START, "09:00");
    await useSettingsStore.getState().set(SettingKey.WORK_END, "18:00");
  });

  const guardada = () => workHours(useSettingsStore.getState().values);

  it("guarda una jornada válida", async () => {
    render(<SettingsView />);
    const inicio = await screen.findByLabelText("Inicio");

    await userEvent.clear(inicio);
    await userEvent.type(inicio, "08:30");
    await userEvent.tab();

    expect(guardada().start).toBe("08:30");
  });

  it("rechaza una hora imposible y lo dice, en vez de guardar en silencio", async () => {
    render(<SettingsView />);
    const fin = await screen.findByLabelText("Fin");

    await userEvent.clear(fin);
    await userEvent.type(fin, "25:00");
    await userEvent.tab();

    expect(fin).toHaveClass("is-invalid");
    expect(guardada().end).toBe("18:00");
  });

  it("rechaza un fin anterior al inicio: el rail quedaría de altura cero", async () => {
    render(<SettingsView />);
    const fin = await screen.findByLabelText("Fin");

    await userEvent.clear(fin);
    await userEvent.type(fin, "07:00");
    await userEvent.tab();

    expect(fin).toHaveClass("is-invalid");
    expect(guardada().end).toBe("18:00");
  });
});

/**
 * Inicio automático. Lo que hay que proteger acá no es el switch —eso es un
 * botón— sino **dónde no está guardado**: si algún día alguien lo mueve a la
 * tabla `settings` "por consistencia", el ajuste empieza a viajar dentro de los
 * respaldos y restaurar un zip viejo prende o apaga el arranque de esta máquina.
 */
describe("SettingsView · inicio automático", () => {
  const claves = () => Object.keys(useSettingsStore.getState().values);

  it("refleja el estado del sistema y lo cambia, sin escribir en settings", async () => {
    await api.setAutostart(false);
    const antes = claves();

    render(<SettingsView />);
    const sw = await screen.findByRole("switch", {
      name: "Abrir sunrise al iniciar sesión",
    });
    // Arranca desactivado y, sobre todo, habilitado: `disabled` significaría que
    // la lectura inicial nunca llegó.
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toBeEnabled();

    await userEvent.click(sw);

    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(await api.autostartEnabled()).toBe(true);
    // Ni una clave nueva en la tabla.
    expect(claves()).toEqual(antes);

    // Y el texto de la etiqueta también lo cambia: el switch es un cuadradito de
    // 38px, y en una fila donde la etiqueta está a la otra punta uno le apunta a
    // las palabras. Funciona porque un `<button>` es un elemento etiquetable, que
    // no es obvio: si algún día esto pasa a ser un `<div role="switch">`, el
    // `htmlFor` deja de hacer nada y este caso se pone rojo.
    await userEvent.click(screen.getByText("Abrir sunrise al iniciar sesión"));
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  // `restoreAllMocks` y no un `mockRestore()` al final del test: si una
  // aserción de arriba explota, el spy que rechaza se filtra al resto del archivo.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("vuelve atrás y lo dice si el sistema rechaza el cambio", async () => {
    await api.setAutostart(false);
    vi.spyOn(api, "setAutostart").mockRejectedValue(
      new Error("no se pudo escribir el LaunchAgent"),
    );

    render(<SettingsView />);
    const sw = await screen.findByRole("switch", {
      name: "Abrir sunrise al iniciar sesión",
    });
    await userEvent.click(sw);

    // El switch no se queda mintiendo que quedó prendido.
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByText(/no se pudo escribir el LaunchAgent/)).toBeInTheDocument();
  });
});
