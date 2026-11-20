import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ObjectiveModal } from "./ObjectiveModal";
import { ModalPresence } from "../../components/ModalPresence";
import { api } from "../../lib/ipc";
import type { Objective } from "../../lib/types";

const base: Objective = {
  id: 1,
  isoWeek: "2026-W33",
  title: "Cerrar el trimestre",
  position: 0,
  completed: false,
  categoryId: null,
};

/** Montado como en el weekly planning: lo abre un id y lo cierra ponerlo en `null`. */
function Planning({ onClose = () => {} }: { onClose?: () => void }) {
  const [saved, setSaved] = useState<Objective>(base);
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Reabrir</button>
      <ModalPresence value={open ? saved : null}>
        {(objective) => (
          <ObjectiveModal
            objective={objective}
            dates={[]}
            tasks={[]}
            categories={[]}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            // Lo que haría el `load` de la vista: el objetivo vuelve con lo guardado.
            onChanged={() => {
              const patch = vi.mocked(api.updateObjective).mock.lastCall?.[1];
              if (patch?.title) setSaved((o) => ({ ...o, title: patch.title as string }));
            }}
          />
        )}
      </ModalPresence>
    </>
  );
}

const presence = () => document.querySelector(".modal-presence");

describe("ObjectiveModal · la salida animada", () => {
  afterEach(() => vi.restoreAllMocks());

  it("mientras sale, un segundo Escape no hace nada", async () => {
    const onClose = vi.fn();
    render(<Planning onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(presence()).toHaveClass("is-leaving");
    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  /**
   * El título pendiente del debounce se escribe al empezar a salir: reabrir el
   * mismo objetivo durante la salida monta uno nuevo, que lee lo guardado.
   */
  it("editar el título, cerrar y reabrir el mismo objetivo muestra el título nuevo", async () => {
    vi.spyOn(api, "updateObjective").mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<Planning />);

    const title = screen.getByLabelText("Título del objetivo");
    await user.clear(title);
    await user.type(title, "Cerrar el trimestre a tiempo");
    await user.keyboard("{Escape}");

    expect(presence()).toHaveClass("is-leaving");
    await waitFor(() =>
      expect(api.updateObjective).toHaveBeenCalledWith(1, {
        title: "Cerrar el trimestre a tiempo",
      }),
    );
    expect(presence()).toHaveClass("is-leaving");

    await user.click(screen.getByRole("button", { name: "Reabrir" }));
    expect(screen.getByLabelText("Título del objetivo")).toHaveValue(
      "Cerrar el trimestre a tiempo",
    );
  });
});
