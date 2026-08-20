import { describe, expect, it } from "vitest";
import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import { Popover } from "./Popover";
import { SearchSelect } from "./SearchSelect";

/**
 * Abrir un picker deja el foco en su buscador, así se puede escribir de una.
 *
 * **jsdom no puede reproducir la falla que arregló esto**, y conviene saberlo
 * antes de confiar en este test: el popover monta `visibility: hidden` mientras
 * mide su posición, y en un navegador de verdad un `focus()` ahí no hace nada
 * —por eso el foco se quedaba en el botón que abrió el picker—, pero jsdom no
 * implementa esa regla y acepta el foco igual. Lo que este test sostiene es que
 * **alguien** enfoque el campo; que sea el `Popover` y no el picker se verificó
 * en el webview, con el canal y con la duración.
 */
function Host() {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref}>Ancla</button>
      <Popover anchorRef={ref} onClose={() => {}}>
        <SearchSelect
          options={[{ value: "1", label: "Thinking" }]}
          value={null}
          onSelect={() => {}}
          placeholder="Buscar canal…"
        />
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("le da el foco al buscador al abrirse", async () => {
    render(<Host />);
    expect(await screen.findByPlaceholderText("Buscar canal…")).toHaveFocus();
  });
});
