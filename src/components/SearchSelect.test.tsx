import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchSelect, type SearchOption } from "./SearchSelect";

const opciones: SearchOption[] = [
  { value: "1", label: "Trabajo", color: "sky" },
  { value: "2", label: "#Dev", hint: "Trabajo", color: "mint" },
  { value: "3", label: "#Soporte", hint: "Trabajo", color: "lavender" },
];

/** Las opciones marcadas, leídas del DOM como las ve un lector de pantalla. */
function marcadas(): string[] {
  return within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .filter((o) => o.getAttribute("aria-selected") === "true")
    .map((o) => o.textContent ?? "");
}

/**
 * Este componente lo usan cinco pickers (channel en tres lugares, objetivo,
 * tiempos y tareas) y no tenía tests propios: los de las vistas lo ejercitan de
 * paso pero ninguno mira el tilde. Al abrirle el modo multi eso pasó de deuda a
 * riesgo — un cambio ahí rompe los cinco a la vez.
 */
describe("SearchSelect", () => {
  it("en modo simple marca exactamente el valor elegido", () => {
    render(<SearchSelect options={opciones} value="2" onSelect={vi.fn()} />);
    expect(marcadas()).toEqual(["#DevTrabajo"]);
  });

  it("sin valor no marca ninguna", () => {
    render(<SearchSelect options={opciones} value={null} onSelect={vi.fn()} />);
    expect(marcadas()).toEqual([]);
  });

  it("en modo multi marca todas las de `selected` e ignora `value`", () => {
    render(
      <SearchSelect
        options={opciones}
        value={null}
        selected={new Set(["1", "3"])}
        onSelect={vi.fn()}
      />,
    );
    expect(marcadas()).toEqual(["Trabajo", "#SoporteTrabajo"]);
  });

  it("multi avisa de cada click y no decide nada solo", async () => {
    // El componente no guarda estado: prender o apagar es de quien lo monta, y
    // por eso el popover de los filtros puede quedarse abierto.
    const onSelect = vi.fn();
    render(
      <SearchSelect options={opciones} value={null} selected={new Set(["1"])} onSelect={onSelect} />,
    );

    // Incluso sobre una ya marcada: apagar es el mismo evento que prender.
    await userEvent.click(screen.getByRole("option", { name: "Trabajo" }));

    expect(onSelect).toHaveBeenCalledWith("1");
  });

  it("la búsqueda mira el label y también la pista", async () => {
    render(<SearchSelect options={opciones} value={null} onSelect={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox"), "soporte");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);

    await userEvent.clear(screen.getByRole("textbox"));
    // "Trabajo" es el `hint` de dos y el `label` de una: las tres calzan.
    await userEvent.type(screen.getByRole("textbox"), "trabajo");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(3);
  });
});
