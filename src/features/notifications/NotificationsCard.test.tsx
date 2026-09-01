import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsCard } from "./NotificationsCard";
import { SettingKey, useSettingsStore } from "../../lib/settings";

/**
 * Lo que se prueba acá es **el estado de fábrica de los switches**, que es la parte
 * que puede mentir en silencio: un default mal leído no lanza nada, solo deja de
 * llegar un aviso (o llega uno que se pidió apagado).
 *
 * Mandar los avisos necesita Tauri, así que eso no se cubre desde jsdom.
 */
describe("NotificationsCard", () => {
  beforeEach(async () => {
    for (const k of [
      SettingKey.NOTICE_SHUTDOWN,
      SettingKey.NOTICE_BELL,
      SettingKey.NOTICE_MEETING_MINUTES,
      SettingKey.NOTICE_SOUND,
    ]) {
      await useSettingsStore.getState().set(k, "");
    }
  });

  it("de fábrica: reunión y cierre encendidos, la campana apagada", async () => {
    render(<NotificationsCard />);

    expect(await screen.findByRole("switch", { name: /evento del calendario/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /cerrar el día/i })).toBeChecked();
    // La notificación de la campana es opt-in (decisión de M2): el sonido alcanza.
    expect(screen.getByRole("switch", { name: /campana/i })).not.toBeChecked();
  });

  it("apagar el aviso de reunión guarda 0, que es cómo Rust lo lee como apagado", async () => {
    render(<NotificationsCard />);

    await userEvent.click(await screen.findByRole("switch", { name: /evento del calendario/i }));

    expect(useSettingsStore.getState().values[SettingKey.NOTICE_MEETING_MINUTES]).toBe("0");
    // Y con el aviso apagado no se ofrece el adelanto: un número de minutos para
    // un aviso que no va a salir es una decisión que no significa nada.
    expect(screen.queryByLabelText("Minutos antes")).toBeNull();
  });

  /**
   * El selector vivía en Dev Tools con `useState`, así que el sonido se elegía para
   * probar y se perdía al cerrar la sección: los avisos de verdad seguían con el de
   * fábrica. Lo que importa acá es que **quede guardado**, porque es lo que leen los
   * dos lados (el front y `commands::sound_or_default`).
   */
  it("elegir un sonido lo guarda, no se queda en el componente", async () => {
    render(<NotificationsCard />);

    // De fábrica muestra el de la app, con su nombre a la vista.
    const chip = await screen.findByLabelText("Elegir el sonido de los avisos");
    expect(chip).toHaveTextContent("Blow");

    await userEvent.click(chip);
    await userEvent.click(await screen.findByText("Submarine"));

    expect(useSettingsStore.getState().values[SettingKey.NOTICE_SOUND]).toBe("Submarine");
    expect(screen.getByLabelText("Elegir el sonido de los avisos")).toHaveTextContent("Submarine");
  });

  it("un adelanto imposible se rechaza y se dice, en vez de guardarse", async () => {
    render(<NotificationsCard />);
    const campo = await screen.findByLabelText("Minutos antes");

    await userEvent.clear(campo);
    await userEvent.type(campo, "0");
    await userEvent.tab();

    expect(campo).toHaveClass("is-invalid");
    expect(screen.getByText(/entre 1 y 120/)).toBeInTheDocument();
    expect(useSettingsStore.getState().values[SettingKey.NOTICE_MEETING_MINUTES]).toBe("");
  });
});
