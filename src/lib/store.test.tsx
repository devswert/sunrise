import { describe, expect, it, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { DATA_CHANNEL, useAppStore, useDataSync } from "./store";

/** Componente mínimo cuyo único trabajo es montar el listener. */
function Probe() {
  useDataSync();
  return null;
}

/** Simula el aviso que manda la OTRA ventana al mutar datos. */
function avisoDeLaOtraVentana(key: string = DATA_CHANNEL) {
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue: String(Date.now()) }),
  );
}

describe("useDataSync", () => {
  beforeEach(() => {
    // El store es un singleton de módulo: sin esto el contador se arrastra
    // entre tests y el segundo falla por un valor viejo, no por el listener.
    useAppStore.setState({ dataVersion: 0 });
  });

  it("invalida las vistas al recibir el aviso de la otra ventana", () => {
    render(<Probe />);
    expect(useAppStore.getState().dataVersion).toBe(0);

    avisoDeLaOtraVentana();

    expect(useAppStore.getState().dataVersion).toBe(1);
  });

  it("no responde al aviso reescribiendo el canal (evita el ping-pong)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<Probe />);

    avisoDeLaOtraVentana();

    // Si respondiera con `bumpData`, la otra ventana recibiría el eco y las dos
    // quedarían recargándose para siempre.
    expect(setItem).not.toHaveBeenCalledWith(DATA_CHANNEL, expect.anything());
    setItem.mockRestore();
  });

  it("ignora las claves de otras cosas que viven en localStorage", () => {
    render(<Probe />);

    avisoDeLaOtraVentana("sunrise-theme");
    avisoDeLaOtraVentana("sunrise-tax-pos");

    expect(useAppStore.getState().dataVersion).toBe(0);
  });

  it("deja de escuchar al desmontarse", () => {
    const { unmount } = render(<Probe />);
    unmount();

    avisoDeLaOtraVentana();

    expect(useAppStore.getState().dataVersion).toBe(0);
  });
});

describe("bumpData", () => {
  beforeEach(() => {
    useAppStore.setState({ dataVersion: 0 });
  });

  it("invalida esta ventana y avisa por el canal", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    useAppStore.getState().bumpData();

    expect(useAppStore.getState().dataVersion).toBe(1);
    expect(setItem).toHaveBeenCalledWith(DATA_CHANNEL, expect.any(String));
    setItem.mockRestore();
  });
});
