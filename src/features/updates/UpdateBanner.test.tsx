import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "./UpdateBanner";
import { WhatsNew } from "./WhatsNew";
import { useUpdateStore } from "./updateStore";
import { AL_DIA_MS, CLAVE_VISTA, POLL_MS, useUpdateRuntime } from "./useUpdateRuntime";
import { api } from "../../lib/ipc";

/** Lo que monta `Shell`: el sondeo, la franja y el modal, juntos. */
function Harness() {
  useUpdateRuntime();
  return (
    <>
      <UpdateBanner />
      <WhatsNew />
    </>
  );
}

function reset() {
  useUpdateStore.setState({
    available: null,
    installing: false,
    error: null,
    fake: false,
    updatedTo: null,
    bannerVisible: false,
    whatsNewOpen: false,
  });
  localStorage.clear();
}

describe("UpdateBanner · hay versión nueva", () => {
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("sin versión nueva no ocupa espacio en el sidebar", () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("invita a actualizar, y al apretarlo instala", async () => {
    const instalar = vi.spyOn(api, "installUpdate").mockResolvedValue(undefined);
    useUpdateStore.setState({
      available: { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null },
    });
    render(<UpdateBanner />);

    const b = screen.getByRole("button", { name: /Versión 0\.2\.0/ });
    expect(b).toHaveTextContent("Actualizar ahora");
    await userEvent.click(b);
    expect(instalar).toHaveBeenCalled();
  });

  /**
   * Si la instalación falla, el botón **tiene que volver**. La app no se reinició,
   * así que dejarlo en "Instalando…" para siempre es mentirle a alguien que está
   * mirando el sidebar esperando que algo pase.
   */
  it("si la instalación falla, lo dice y deja reintentar", async () => {
    vi.spyOn(api, "installUpdate").mockRejectedValue(new Error("no route to host"));
    useUpdateStore.setState({
      available: { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null },
    });
    render(<UpdateBanner />);

    await userEvent.click(screen.getByRole("button", { name: /Versión 0\.2\.0/ }));
    const b = await screen.findByRole("button", { name: /No se pudo\. Reintenta\./ });
    expect(b).toHaveTextContent("No se pudo. Reintenta.");
    expect(b).toBeEnabled();
  });
});

/**
 * El banco de pruebas de dev (`devFake.ts`) marca lo disponible como falso. Este
 * test fija lo único que de verdad importa de eso: **que no descargue nada**.
 * Llamar al updater real mientras se mira el componente reiniciaría la app.
 */
describe("UpdateBanner · update de prueba", () => {
  beforeEach(reset);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("un update falso no llama al updater y aterriza en 'Estás al día'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const instalar = vi.spyOn(api, "installUpdate");
    useUpdateStore.setState({
      available: { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null },
      fake: true,
    });
    render(<UpdateBanner />);

    await userEvent.click(screen.getByRole("button", { name: /Versión 0\.2\.0/ }));
    expect(instalar).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(2000));
    // Aterriza en 0.1.0 y no en 0.2.0: es la que tiene anuncio escrito, así que el
    // flujo de prueba llega hasta el modal en vez de morir en una franja muda.
    expect(screen.getByRole("button", { name: /Estás al día/ })).toHaveTextContent("0.1.0");
  });
});

describe("UpdateBanner · estás al día", () => {
  beforeEach(reset);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("aparece al volver de un update y abre lo nuevo al apretarlo", async () => {
    localStorage.setItem(CLAVE_VISTA, "0.0.9");
    vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    render(<Harness />);

    const b = await screen.findByRole("button", { name: /Estás al día/ });
    expect(b).toHaveTextContent("Estás al día");

    await userEvent.click(b);
    // Desaparece la franja y queda el modal con el anuncio.
    expect(screen.queryByRole("button", { name: /Estás al día/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("alertdialog", { name: "Lo nuevo en la 0.1.0" }),
    ).toHaveTextContent(/primera versión que se puede instalar/i);
  });

  /** A los 30 segundos se va solo, sin que nadie lo toque. */
  it("desaparece a los 30 segundos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem(CLAVE_VISTA, "0.0.9");
    vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    render(<Harness />);
    await screen.findByRole("button", { name: /Estás al día/ });

    act(() => vi.advanceTimersByTime(AL_DIA_MS));
    expect(screen.queryByRole("button", { name: /Estás al día/ })).not.toBeInTheDocument();
  });

  /**
   * La primera ejecución de una instalación nueva no avisa nada —no hay versión
   * anterior contra la que comparar— pero **sí deja la marca**, o el aviso saltaría
   * en la próxima apertura como si algo hubiera cambiado.
   */
  it("una instalación nueva no avisa, pero deja la marca", async () => {
    vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
    vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    render(<Harness />);
    await vi.waitFor(() => expect(localStorage.getItem(CLAVE_VISTA)).toBe("0.1.0"));
    expect(screen.queryByRole("button", { name: /Estás al día/ })).not.toBeInTheDocument();
  });
});

describe("useUpdateRuntime · el sondeo", () => {
  beforeEach(reset);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Sondea al arrancar **y** cada 4 horas. Lo primero contradice a 5.3 sólo en
   * apariencia: ahí el argumento era no interrumpir, y una franja en el sidebar no
   * interrumpe. Sin la consulta inicial, un intervalo de 4 h no dispararía nunca
   * para quien cierra la app todos los días.
   */
  it("pregunta al arrancar y otra vez a las 4 horas", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
    const mirar = vi.spyOn(api, "checkForUpdate").mockResolvedValue(null);
    render(<Harness />);
    await vi.waitFor(() => expect(mirar).toHaveBeenCalledTimes(1));

    act(() => vi.advanceTimersByTime(POLL_MS));
    expect(mirar).toHaveBeenCalledTimes(2);
  });

  /** Sin conexión —o sin Release todavía— no hay banner y no hay error a la vista. */
  it("un fallo del sondeo no muestra nada", async () => {
    vi.spyOn(api, "appVersion").mockResolvedValue("0.1.0");
    vi.spyOn(api, "checkForUpdate").mockRejectedValue(new Error("offline"));
    render(<Harness />);
    await vi.waitFor(() => expect(api.checkForUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
