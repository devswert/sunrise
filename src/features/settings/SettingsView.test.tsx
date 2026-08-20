import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";
import { api } from "../../lib/ipc";
import {
  SettingKey,
  collapsedWeekdays,
  useSettingsStore,
  workHours,
} from "../../lib/settings";

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

  const saved = () => workHours(useSettingsStore.getState().values);

  it("guarda una jornada válida", async () => {
    render(<SettingsView />);
    const start = await screen.findByLabelText("Inicio");

    await userEvent.clear(start);
    await userEvent.type(start, "08:30");
    await userEvent.tab();

    expect(saved().start).toBe("08:30");
  });

  it("rechaza una hora imposible y lo dice, en vez de guardar en silencio", async () => {
    render(<SettingsView />);
    const end = await screen.findByLabelText("Fin");

    await userEvent.clear(end);
    await userEvent.type(end, "25:00");
    await userEvent.tab();

    expect(end).toHaveClass("is-invalid");
    expect(saved().end).toBe("18:00");
  });

  it("rechaza un fin anterior al inicio: el rail quedaría de altura cero", async () => {
    render(<SettingsView />);
    const end = await screen.findByLabelText("Fin");

    await userEvent.clear(end);
    await userEvent.type(end, "07:00");
    await userEvent.tab();

    expect(end).toHaveClass("is-invalid");
    expect(saved().end).toBe("18:00");
  });
});

/**
 * Inicio automático. Lo que hay que proteger acá no es el switch —eso es un
 * botón— sino **dónde no está guardado**: si algún día alguien lo mueve a la
 * tabla `settings` "por consistencia", el ajuste empieza a viajar dentro de los
 * respaldos y restaurar un zip viejo prende o apaga el arranque de esta máquina.
 */
/**
 * Los siete días del plegado. Lo que se prueba acá es el ida y vuelta del ajuste,
 * porque el string que se guarda tiene una regla propia: **vacío significa
 * ninguno**, no "sin configurar".
 */
describe("SettingsView · días plegados", () => {
  beforeEach(async () => {
    await useSettingsStore.getState().set(SettingKey.COLLAPSED_WEEKDAYS, "6,7");
  });

  const saved = () => collapsedWeekdays(useSettingsStore.getState().values);

  it("arranca con el fin de semana marcado", async () => {
    render(<SettingsView />);
    expect(await screen.findByRole("button", { name: "Sáb", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dom", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lun", pressed: false })).toBeInTheDocument();
  });

  it("marcar un día lo agrega a la lista, ordenada", async () => {
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole("button", { name: "Mié" }));
    expect(saved()).toEqual([3, 6, 7]);
  });

  it("destildar los siete guarda 'ninguno', no el default", async () => {
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole("button", { name: "Sáb" }));
    await userEvent.click(screen.getByRole("button", { name: "Dom" }));

    expect(saved()).toEqual([]);
    // La clave queda presente y vacía: es lo que distingue "ninguno" de "sin
    // configurar", y por eso la migración 9 siembra la fila.
    expect(useSettingsStore.getState().values[SettingKey.COLLAPSED_WEEKDAYS]).toBe("");
  });
});

describe("SettingsView · inicio automático", () => {
  const claves = () => Object.keys(useSettingsStore.getState().values);

  it("refleja el estado del sistema y lo cambia, sin escribir en settings", async () => {
    await api.setAutostart(false);
    const before = claves();

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
    expect(claves()).toEqual(before);

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

/**
 * Actualizaciones. Lo que se prueba acá es la distinción entre los tres finales
 * posibles de una búsqueda —hay, no hay, no se pudo preguntar—, porque los dos
 * últimos se parecen en pantalla y significan lo contrario: "estás al día" es una
 * respuesta y "sin conexión" es la falta de una. Confundirlos deja a alguien
 * tranquilo en una versión vieja.
 *
 * La descarga misma no se puede probar acá: reemplaza el `.app` instalado y
 * reinicia el proceso, y en jsdom no hay ni uno ni otro.
 */
describe("SettingsView · actualizaciones", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no busca nada hasta que se lo pides", async () => {
    const spy = vi.spyOn(api, "checkForUpdate");
    render(<SettingsView />);
    // Con la vista montada y estable: si hubiera un chequeo al arrancar, acá ya
    // habría corrido. No hay, y es a propósito (ver el comentario del componente).
    expect(await screen.findByText(/Se busca solo cuando lo pides/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("dice que estás al día cuando no hay versión nueva", async () => {
    render(<SettingsView />);
    await userEvent.click(await screen.findByRole("button", { name: /Buscar/ }));
    // El mock devuelve `null`, que es lo que corresponde fuera de Tauri.
    expect(await screen.findByText(/Estás en la última versión/)).toBeInTheDocument();
  });

  it("ofrece instalar la versión nueva y muestra las notas del Release", async () => {
    vi.spyOn(api, "checkForUpdate").mockResolvedValue({
      version: "0.2.0",
      currentVersion: "0.1.0",
      notes: "- El rail muestra los feriados",
      date: "2026-09-01",
    });

    render(<SettingsView />);
    await userEvent.click(await screen.findByRole("button", { name: /Buscar/ }));

    expect(await screen.findByText(/Hay una versión nueva: 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/publicada el 2026-09-01/)).toBeInTheDocument();
    expect(screen.getByText("- El rail muestra los feriados")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Instalar 0\.2\.0 y reiniciar/ }),
    ).toBeInTheDocument();
  });

  it("un fallo de red no se cuenta como 'estás al día'", async () => {
    vi.spyOn(api, "checkForUpdate").mockRejectedValue(new Error("no route to host"));

    render(<SettingsView />);
    await userEvent.click(await screen.findByRole("button", { name: /Buscar/ }));

    expect(await screen.findByText(/No se pudo preguntar por versiones nuevas/)).toBeInTheDocument();
    expect(screen.queryByText(/Estás en la última versión/)).not.toBeInTheDocument();
  });
});

/**
 * Guardar en el blur de un campo suelto destruye una fila que tiene varios
 * controles. Los dos tests van con `userEvent` y no con `fireEvent`: es el
 * movimiento del foco lo que rompía el alta, y `fireEvent.click` no mueve el
 * foco —el test pasaría igual con el bug puesto—.
 */
describe("SettingsView · alta de un canal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("elegir el color no confirma el alta a medio camino", async () => {
    const create = vi.spyOn(api, "createCategory");
    render(<SettingsView />);

    await userEvent.click(await screen.findByRole("button", { name: "Agregar contexto" }));
    const input = screen.getByLabelText("Nombre del contexto");
    await userEvent.type(input, "Investigación");

    // El punto abre la paleta sin sacarle el foco al nombre. Se busca dentro de
    // la fila: hay una categoría sembrada que también arranca en lavender.
    const row = within(input.closest("li")!);
    await userEvent.click(row.getByRole("button", { name: "Color: lavender" }));
    await userEvent.click(screen.getByRole("button", { name: "Color mint" }));
    expect(create).not.toHaveBeenCalled();

    await userEvent.keyboard("{Enter}");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(null, "Investigación", "mint");
  });

  it("salir de la fila entera lo confirma, igual que Enter", async () => {
    const create = vi.spyOn(api, "createCategory");
    render(<SettingsView />);

    await userEvent.click(await screen.findByRole("button", { name: "Agregar contexto" }));
    await userEvent.type(screen.getByLabelText("Nombre del contexto"), "Lecturas");
    await userEvent.tab();

    expect(create).toHaveBeenCalledWith(null, "Lecturas", "lavender");
  });
});

/**
 * El corrector del webview no solo subraya: capitaliza y cambia lo escrito al
 * salir del campo, y ninguno de estos campos es prosa (Mej.5).
 */
describe("SettingsView · campos que no son prosa", () => {
  it("apaga el corrector en los nombres y en los números", async () => {
    render(<SettingsView />);
    for (const campo of [
      await screen.findByDisplayValue("Thinking"),
      screen.getByLabelText("Capacidad diaria"),
      screen.getByLabelText("Inicio"),
    ]) {
      expect(campo).toHaveAttribute("spellcheck", "false");
      expect(campo).toHaveAttribute("autocorrect", "off");
    }
  });
});
