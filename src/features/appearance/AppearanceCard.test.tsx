import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceCard } from "./AppearanceCard";
import { api } from "../../lib/ipc";
import { SUNRISE_BELL } from "../../lib/enums";
import { SettingKey, useSettingsStore } from "../../lib/settings";

/**
 * Lo que se puede sostener desde jsdom es **qué se guarda y qué se dice**: el audio
 * no suena y el archivo no se copia sin Tauri. Que un audio ilegible se rechace lo
 * cubren los tests de `sound.rs`, que es donde vive la decisión.
 */
describe("AppearanceCard", () => {
  beforeEach(async () => {
    await useSettingsStore.getState().set(SettingKey.BELL_SOUND, SUNRISE_BELL);
    await useSettingsStore.getState().set(SettingKey.FONT_TITLE, "");
    await useSettingsStore.getState().set(SettingKey.FONT_BODY, "");
  });

  it("de fábrica suena la campana de la app, y no ofrece volver a ella", async () => {
    render(<AppearanceCard />);

    expect(await screen.findByText(/suena al llegar al tiempo estimado/)).toBeInTheDocument();
    // Volver a donde ya estás es un botón que no hace nada.
    expect(screen.queryByRole("button", { name: /Volver a la de sunrise/ })).toBeNull();
  });

  /**
   * El ajuste guarda el nombre que **devuelve Rust**, no el path que se eligió: el
   * archivo se copia a la carpeta de la app, así que el path original deja de valer
   * en cuanto alguien mueve el original de lugar.
   */
  it("elegir un audio guarda el nombre que devolvió la copia", async () => {
    vi.spyOn(api, "installBellFile").mockResolvedValue("cuenco.mp3");
    await useSettingsStore.getState().set(SettingKey.BELL_SOUND, "cuenco.mp3");
    render(<AppearanceCard />);

    expect(await screen.findByText(/Suena cuenco\.mp3/)).toBeInTheDocument();
    // Y con una propia sí aparece la vuelta atrás.
    await userEvent.click(screen.getByRole("button", { name: /Volver a la de sunrise/ }));
    expect(useSettingsStore.getState().values[SettingKey.BELL_SOUND]).toBe(SUNRISE_BELL);
  });

  /**
   * Si la copia falla, **el ajuste no se toca**: la campana que sonaba sigue sonando.
   * Lo contrario dejaría el ajuste apuntando a un archivo que no se copió, y eso cae
   * en la síntesis — o sea, el mismo síntoma que el error viene a explicar.
   */
  it("si el audio no sirve lo dice y no cambia la campana", async () => {
    vi.spyOn(api, "installBellFile").mockRejectedValue("no pude leer ese audio");
    render(<AppearanceCard />);

    expect(useSettingsStore.getState().values[SettingKey.BELL_SOUND]).toBe(SUNRISE_BELL);
    expect(await screen.findByText(/suena al llegar al tiempo estimado/)).toBeInTheDocument();
  });

  /**
   * Dos selectores y no uno: son dos roles distintos (`font_title`, `font_body`), y lo
   * que hay que sostener es que **el de títulos no pisa el de textos**. Con una sola
   * clave, elegir la fuente de los títulos cambiaría los dos y nadie diría por qué.
   */
  it("cada rol de tipografía se guarda por separado", async () => {
    render(<AppearanceCard />);

    // De fábrica, la de la app en los dos — con su nombre real a la vista, que es lo
    // único que responde "¿cuál es la de hoy?".
    const titulos = await screen.findByLabelText("Elegir la tipografía de los títulos");
    expect(titulos).toHaveTextContent("Sora — la de sunrise");
    expect(screen.getByLabelText("Elegir la tipografía de los textos")).toHaveTextContent(
      "Manrope — la de sunrise",
    );

    await userEvent.click(titulos);
    await userEvent.click(await screen.findByText("Optima"));

    expect(useSettingsStore.getState().values[SettingKey.FONT_TITLE]).toBe("Optima");
    // Y el cuerpo quedó donde estaba.
    expect(useSettingsStore.getState().values[SettingKey.FONT_BODY]).toBe("");
  });

  it("ofrece las instaladas, más las dos con nombre propio", async () => {
    render(<AppearanceCard />);

    await userEvent.click(await screen.findByLabelText("Elegir la tipografía de los textos"));

    expect(await screen.findByText("La que use el sistema")).toBeInTheDocument();
    // Del mock de `systemFonts`; en la app las da Core Text (`fonts.rs`).
    expect(screen.getByText("Helvetica Neue")).toBeInTheDocument();
  });

  /**
   * Volver a la campana de la app **borra la copia**, y por eso el orden importa: el
   * ajuste primero. Al revés, un borrado que anda seguido de un `set` que falla
   * dejaría el ajuste nombrando un archivo que ya no está — sonaría la síntesis y la
   * card seguiría diciendo que suena el archivo.
   */
  it("volver a la de sunrise descarta la copia que la app guardaba", async () => {
    const borrar = vi.spyOn(api, "clearBellFile").mockResolvedValue(undefined);
    await useSettingsStore.getState().set(SettingKey.BELL_SOUND, "cuenco.mp3");
    render(<AppearanceCard />);

    await userEvent.click(await screen.findByRole("button", { name: /Volver a la de sunrise/ }));

    expect(useSettingsStore.getState().values[SettingKey.BELL_SOUND]).toBe(SUNRISE_BELL);
    expect(borrar).toHaveBeenCalled();
  });
});
