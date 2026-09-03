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
    progress: null,
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
  it("si la instalación falla, lo dice y queda apretable", async () => {
    vi.spyOn(api, "installUpdate").mockRejectedValue(new Error("no route to host"));
    useUpdateStore.setState({
      available: { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null },
    });
    render(<UpdateBanner />);

    await userEvent.click(screen.getByRole("button", { name: /Versión 0\.2\.0/ }));
    const b = await screen.findByRole("button", { name: /No se pudo\. Mira el detalle\./ });
    expect(b).toBeEnabled();
  });

  /**
   * **Sin telemetría, el texto del updater es lo único que puede volver de una
   * máquina ajena.** Vivía en el `title` del aviso, así que había que dejar el
   * mouse quieto encima para verlo y el reporte que llegaba era "me dio error".
   * Ahora el click abre el detalle en vez de reintentar: reintentar vive adentro.
   */
  it("apretarlo con error abre el detalle en vez de reintentar", async () => {
    const install = vi
      .spyOn(api, "installUpdate")
      .mockRejectedValue(new Error("Permission denied (os error 13)"));
    useUpdateStore.setState({
      available: { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null },
    });
    render(<UpdateBanner />);

    await userEvent.click(screen.getByRole("button", { name: /Versión 0\.2\.0/ }));
    await screen.findByRole("button", { name: /No se pudo/ });
    install.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /No se pudo/ }));

    expect(useUpdateStore.getState().errorOpen).toBe(true);
    expect(install).not.toHaveBeenCalled();
  });
});

/**
 * El progreso de la descarga. Lo emite Rust y lo único que se prueba acá es la
 * traducción a palabras, que es donde están las tres formas de mentir: un 0 %
 * mientras todavía no llega nada, un porcentaje inventado cuando el servidor no
 * manda `Content-Length`, y un 100 % clavado durante el reemplazo del `.app` —que
 * es el tramo que no reporta avance—.
 */
describe("UpdateBanner · lo que baja", () => {
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  const nueva = { version: "0.2.0", currentVersion: "0.1.0", notes: null, date: null };

  it("sin el primer trozo todavía no promete ningún porcentaje", () => {
    useUpdateStore.setState({ available: nueva, installing: true, progress: null });
    render(<UpdateBanner />);
    expect(screen.getByRole("button")).toHaveTextContent("Preparando la descarga…");
  });

  it("con total, cuenta la fracción", () => {
    useUpdateStore.setState({
      available: nueva,
      installing: true,
      progress: { downloaded: 4_000_000, total: 10_000_000, installing: false },
    });
    render(<UpdateBanner />);
    expect(screen.getByRole("button")).toHaveTextContent("Bajando · 40 %");
  });

  it("sin total dice los MB, que es lo único cierto", () => {
    useUpdateStore.setState({
      available: nueva,
      installing: true,
      progress: { downloaded: 3_145_728, total: null, installing: false },
    });
    render(<UpdateBanner />);
    expect(screen.getByRole("button")).toHaveTextContent("Bajando · 3,0 MB");
  });

  it("mientras reemplaza la app lo dice, en vez de dejar la barra en el 100 %", () => {
    useUpdateStore.setState({
      available: nueva,
      installing: true,
      progress: { downloaded: 0, total: null, installing: true },
    });
    render(<UpdateBanner />);
    expect(screen.getByRole("button")).toHaveTextContent("Instalando y reiniciando…");
  });

  /**
   * El título es el nombre de la cosa, no su estado: durante la instalación sigue
   * diciendo qué versión es, y lo que cambia es la línea de abajo.
   */
  it("el título no se convierte en el estado a mitad de la instalación", () => {
    useUpdateStore.setState({
      available: nueva,
      installing: true,
      progress: { downloaded: 1, total: 2, installing: false },
    });
    render(<UpdateBanner />);
    expect(screen.getByRole("button")).toHaveTextContent("Versión 0.2.0");
  });

  /** Un intento nuevo no puede arrancar mostrando el avance del anterior. */
  it("volver a instalar parte el progreso de cero", async () => {
    vi.spyOn(api, "installUpdate").mockResolvedValue(undefined);
    useUpdateStore.setState({
      available: nueva,
      progress: { downloaded: 9, total: 10, installing: false },
    });
    render(<UpdateBanner />);
    await userEvent.click(screen.getByRole("button", { name: /Versión 0\.2\.0/ }));
    expect(useUpdateStore.getState().progress).toBeNull();
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
    expect(screen.getByRole("alertdialog", { name: "Lo nuevo en la 0.1.0" })).toHaveTextContent(
      /primera versión que se puede instalar/i,
    );
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
