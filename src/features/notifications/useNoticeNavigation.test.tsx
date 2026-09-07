import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useNoticeNavigation } from "./useNoticeNavigation";
import type { NoticeResponse } from "./useNotificationActions";
import { useAppStore } from "../../lib/store";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

/** Se guarda el callback que registra el hook para dispararlo a mano. */
let onAction: ((r: NoticeResponse) => void) | null = null;
vi.mock("./useNotificationActions", () => ({
  useNotificationActions: (cb: (r: NoticeResponse) => void) => {
    onAction = cb;
  },
}));

function responder(r: Partial<NoticeResponse>) {
  const Probe = () => {
    useNoticeNavigation();
    return null;
  };
  render(<Probe />);
  onAction?.({ action: "action", route: null, taskId: null, ...r });
}

describe("useNoticeNavigation", () => {
  beforeEach(() => {
    navigate.mockClear();
    useAppStore.setState({ focusTaskId: null });
  });

  it("el botón del aviso lleva a su vista", () => {
    responder({ action: "action", route: "/daily-shutdown" });
    expect(navigate).toHaveBeenCalledWith("/daily-shutdown");
  });

  it("hacerle click al aviso entero hace lo mismo que el botón", () => {
    responder({ action: "click", route: "/daily-shutdown" });
    expect(navigate).toHaveBeenCalledWith("/daily-shutdown");
  });

  it("con tarea, además deja Focus abierto en ella", () => {
    responder({ action: "action", route: "/focus", taskId: 42 });
    expect(navigate).toHaveBeenCalledWith("/focus");
    expect(useAppStore.getState().focusTaskId).toBe(42);
  });

  it("descartar el aviso no te mueve de vista", () => {
    responder({ action: "close", route: "/focus" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("un aviso sin destino no navega a ninguna parte", () => {
    responder({ action: "action", route: null });
    expect(navigate).not.toHaveBeenCalled();
  });
});
