import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useDragOrClick } from "./useDragOrClick";

/** Componente mínimo para ejercitar el hook. */
function Widget({ onClick }: { onClick: () => void }) {
  const drag = useDragOrClick(onClick);
  return (
    <div data-testid="card" {...drag}>
      <span>título</span>
      <div className="tax__opts" data-testid="opts">
        <button>completar</button>
      </div>
      <button>pausa</button>
    </div>
  );
}

/** Dispara una secuencia de puntero sobre el elemento. */
function pointer(
  el: Element,
  seq: Array<["down" | "move" | "up", number, number]>,
  target?: Element,
) {
  for (const [type, clientX, clientY] of seq) {
    const map = { down: "pointerdown", move: "pointermove", up: "pointerup" } as const;
    const ev = new MouseEvent(map[type], { clientX, clientY, bubbles: true });
    (target ?? el).dispatchEvent(ev);
  }
}

describe("useDragOrClick", () => {
  it("un click sin movimiento dispara la acción", () => {
    const onClick = vi.fn();
    render(<Widget onClick={onClick} />);
    const card = screen.getByTestId("card");

    pointer(card, [
      ["down", 100, 30],
      ["up", 100, 30],
    ]);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("mantener pulsado y mover NO dispara la acción (es arrastre)", () => {
    const onClick = vi.fn();
    render(<Widget onClick={onClick} />);
    const card = screen.getByTestId("card");

    pointer(card, [
      ["down", 100, 30],
      ["move", 140, 30], // supera el umbral
      ["up", 140, 30],
    ]);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("un micro-movimiento por debajo del umbral sigue siendo click", () => {
    const onClick = vi.fn();
    render(<Widget onClick={onClick} />);
    const card = screen.getByTestId("card");

    pointer(card, [
      ["down", 100, 30],
      ["move", 102, 31], // < 4px
      ["up", 102, 31],
    ]);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ignora los clicks sobre los botones de control", () => {
    const onClick = vi.fn();
    render(<Widget onClick={onClick} />);
    const card = screen.getByTestId("card");
    const btn = screen.getByRole("button", { name: "pausa" });

    pointer(card, [
      ["down", 100, 30],
      ["up", 100, 30],
    ], btn);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("soltar sobre el panel de opciones no abre Focus", () => {
    // El panel se superpone al título y entra deslizándose bajo el cursor: un
    // click que empieza en el título puede terminar soltándose encima de él.
    const onClick = vi.fn();
    render(<Widget onClick={onClick} />);
    const card = screen.getByTestId("card");
    const opts = screen.getByTestId("opts");

    pointer(card, [["down", 100, 30]]);
    pointer(card, [["up", 100, 30]], opts);

    expect(onClick).not.toHaveBeenCalled();
  });
});
