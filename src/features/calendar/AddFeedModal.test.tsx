import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AddFeedModal } from "./AddFeedModal";
import { ModalPresence } from "../../components/ModalPresence";

describe("AddFeedModal · la salida animada", () => {
  it("mientras sale, un segundo Escape no hace nada", async () => {
    const onClose = vi.fn();
    function Card() {
      const [open, setOpen] = useState(true);
      return (
        <ModalPresence value={open}>
          {() => (
            <AddFeedModal
              categories={[]}
              onSave={async () => {}}
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            />
          )}
        </ModalPresence>
      );
    }
    render(<Card />);

    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".modal-presence")).toHaveClass("is-leaving");
    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });
});
