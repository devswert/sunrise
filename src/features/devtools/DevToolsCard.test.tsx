import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevToolsCard } from "./DevToolsCard";
import { SettingsView } from "../settings/SettingsView";
import { SettingKey, useSettingsStore } from "../../lib/settings";
import { todayISO } from "../../lib/date";

/**
 * **Acá no se puede probar que un aviso salga**: jsdom no tiene notificaciones
 * nativas, que es exactamente el motivo por el que existe esta sección. Lo que
 * sí se puede sostener son las dos cosas que no dependen del sistema: que fuera
 * de la app lo diga en vez de ofrecer botones que no hacen nada, y que la marca
 * del día se borre de verdad. Los avisos de verdad se vieron en la app.
 */
describe("Dev Tools · notificaciones", () => {
  beforeEach(async () => {
    await useSettingsStore.getState().set(SettingKey.SHUTDOWN_NOTIFIED_ON, "");
  });

  it("aparece dentro de Configs cuando la app corre en dev", async () => {
    // El mock de `profile` dice `dev: true`, que es lo correcto fuera de Tauri:
    // en el browser y en jsdom nunca hay una app instalada. Que en producción no
    // se dibuje lo sostiene `visibleTabs` en `secciones.test.ts`.
    render(<SettingsView />);
    expect(await screen.findByRole("heading", { name: "Dev Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dev Tools" })).toBeInTheDocument();
  });

  it("fuera de la app lo dice, en vez de ofrecer botones que no van a hacer nada", async () => {
    render(<DevToolsCard />);

    expect(await screen.findByText(/existen solo en la app/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cierre del día" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Próxima tarea" })).toBeDisabled();
  });

  it("sin marca del día no hay nada que borrar", async () => {
    render(<DevToolsCard />);

    expect(await screen.findByText(/todavía no se ha avisado/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a avisar hoy" })).toBeDisabled();
  });

  it("borra la marca del día para poder probar el camino real", async () => {
    await useSettingsStore.getState().set(SettingKey.SHUTDOWN_NOTIFIED_ON, todayISO());
    render(<DevToolsCard />);

    await userEvent.click(await screen.findByRole("button", { name: "Volver a avisar hoy" }));

    expect(useSettingsStore.getState().values[SettingKey.SHUTDOWN_NOTIFIED_ON]).toBe("");
    expect(await screen.findByText(/todavía no se ha avisado/)).toBeInTheDocument();
  });
});
