import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestionsCard } from "./SuggestionsCard";
import { SettingKey, useSettingsStore } from "../../lib/settings";
import { api } from "../../lib/ipc";
import { DEFAULT_TIME_RULES, parseTimeRules } from "./suggestRules";

describe("Configs → Sugerencias", () => {
  beforeEach(() => {
    useSettingsStore.setState({ values: {}, loaded: true });
  });

  it("sin ajuste guardado muestra el vocabulario de fábrica", async () => {
    render(<SuggestionsCard />);
    // Una pill por palabra, no una lista con comas.
    for (const w of DEFAULT_TIME_RULES[0].words) {
      expect(await screen.findByRole("button", { name: `Quitar ${w}` })).toBeInTheDocument();
    }
  });

  it("una palabra nueva se agrega con Enter y se guarda", async () => {
    const user = userEvent.setup();
    const setSetting = vi.spyOn(api, "setSetting");
    useSettingsStore.setState({
      values: {
        [SettingKey.SUGGEST_TIME_RULES]: JSON.stringify([{ minutes: 30, words: ["ver"] }]),
      },
      loaded: true,
    });
    render(<SuggestionsCard />);

    await user.type(await screen.findByLabelText(/Agregar palabra/), "review{Enter}");

    await waitFor(() => expect(setSetting).toHaveBeenCalled());
    const llamadas = setSetting.mock.calls;
    const [clave, valor] = llamadas[llamadas.length - 1] as [string, string];
    expect(clave).toBe(SettingKey.SUGGEST_TIME_RULES);
    expect(parseTimeRules(valor)).toEqual([{ minutes: 30, words: ["ver", "review"] }]);
  });

  // Pegar la lista entera tiene que dejar una pill por palabra, no una sola.
  it("varias palabras separadas por coma entran como varias pills", async () => {
    const user = userEvent.setup();
    const setSetting = vi.spyOn(api, "setSetting");
    useSettingsStore.setState({
      values: {
        [SettingKey.SUGGEST_TIME_RULES]: JSON.stringify([{ minutes: 30, words: ["ver"] }]),
      },
      loaded: true,
    });
    render(<SuggestionsCard />);

    const campo = await screen.findByLabelText(/Agregar palabra/);
    await user.click(campo);
    await user.paste("review, leer");
    await user.tab();

    await waitFor(() => expect(setSetting).toHaveBeenCalled());
    const llamadas = setSetting.mock.calls;
    const [, valor] = llamadas[llamadas.length - 1] as [string, string];
    expect(parseTimeRules(valor)).toEqual([{ minutes: 30, words: ["ver", "review", "leer"] }]);
  });

  it("una palabra se quita desde su pill, sin tocar las otras", async () => {
    const user = userEvent.setup();
    const setSetting = vi.spyOn(api, "setSetting");
    useSettingsStore.setState({
      values: {
        [SettingKey.SUGGEST_TIME_RULES]: JSON.stringify([
          { minutes: 30, words: ["ver", "review"] },
        ]),
      },
      loaded: true,
    });
    render(<SuggestionsCard />);

    await user.click(await screen.findByRole("button", { name: "Quitar ver" }));

    await waitFor(() => expect(setSetting).toHaveBeenCalled());
    const llamadas = setSetting.mock.calls;
    const [, valor] = llamadas[llamadas.length - 1] as [string, string];
    expect(parseTimeRules(valor)).toEqual([{ minutes: 30, words: ["review"] }]);
  });

  // La decisión de `collapsed_weekdays` aplicada acá: la lista vacía se guarda
  // como vacía. Si se guardara como "nada", el sugeridor volvería a los defaults
  // y el usuario tendría que borrarlos otra vez en cada arranque.
  it("borrar la última regla se guarda como lista vacía, no como ausencia", async () => {
    const user = userEvent.setup();
    const setSetting = vi.spyOn(api, "setSetting");
    useSettingsStore.setState({
      values: {
        [SettingKey.SUGGEST_TIME_RULES]: JSON.stringify([{ minutes: 30, words: ["ver"] }]),
      },
      loaded: true,
    });
    render(<SuggestionsCard />);

    await user.click(await screen.findByRole("button", { name: "Quitar la regla de ver" }));

    await waitFor(() => expect(setSetting).toHaveBeenCalled());
    const llamadas = setSetting.mock.calls;
    const [clave, valor] = llamadas[llamadas.length - 1] as [string, string];
    expect(clave).toBe(SettingKey.SUGGEST_TIME_RULES);
    expect(valor).toBe("[]");
    expect(parseTimeRules(valor)).toEqual([]);
  });

  // El botón dice "Agregar palabras": la fila que aparece tiene que estar lista
  // para recibirlas. Sin esto hay que volver a hacer click en el campo, que es lo
  // que se descubrió probando la card en la app.
  it("la fila recién agregada queda enfocada", async () => {
    const user = userEvent.setup();
    render(<SuggestionsCard />);

    const agregar = await screen.findAllByRole("button", { name: /Agregar palabras/ });
    await user.click(agregar[1]);

    const campo = await screen.findByPlaceholderText("issues");
    expect(document.activeElement).toBe(campo);
  });

  // El foco es de la fila nueva y de ninguna otra: vaciar a mano las palabras de
  // una regla que ya existe no puede robárselo mientras se edita.
  it("vaciar una regla existente no le roba el foco a nadie", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      values: {
        [SettingKey.SUGGEST_TIME_RULES]: JSON.stringify([{ minutes: 30, words: ["ver"] }]),
      },
      loaded: true,
    });
    render(<SuggestionsCard />);

    const campo = await screen.findByLabelText(/Agregar palabra/);
    await user.click(await screen.findByRole("button", { name: "Quitar ver" }));

    expect(document.activeElement).not.toBe(campo);
  });

  it("una palabra se puede mapear a un canal", async () => {
    const user = userEvent.setup();
    const setSetting = vi.spyOn(api, "setSetting");
    render(<SuggestionsCard />);

    // El segundo "Agregar palabras" es el de canales.
    const agregar = await screen.findAllByRole("button", { name: /Agregar palabras/ });
    await user.click(agregar[1]);

    const campo = await screen.findByPlaceholderText("issues");
    await user.type(campo, "issues, soporte{Enter}");

    await user.click(screen.getByRole("button", { name: /elegir canal/ }));
    await user.click(await screen.findByRole("option", { name: /Docs/ }));

    await waitFor(() => {
      const llamadas = setSetting.mock.calls;
      const ultima = llamadas[llamadas.length - 1] as [string, string];
      expect(ultima[0]).toBe(SettingKey.SUGGEST_CHANNEL_RULES);
      expect(JSON.parse(ultima[1])).toEqual([{ categoryId: 3, words: ["issues", "soporte"] }]);
    });
  });
});
