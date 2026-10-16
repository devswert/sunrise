import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { McpCard } from "./McpCard";
import { api } from "../../lib/ipc";
import { ClaudeStatus } from "../../lib/enums";
import type { ClaudeDesktopInfo } from "../../lib/types";

const BIN = "/Applications/sunrise.app/Contents/MacOS/sunrise";

function info(over: Partial<ClaudeDesktopInfo> = {}): ClaudeDesktopInfo {
  return {
    status: ClaudeStatus.NOT_CONNECTED,
    serverName: "sunrise",
    command: BIN,
    configPath: "/Users/x/Library/Application Support/Claude/claude_desktop_config.json",
    snippet: `{"mcpServers":{"sunrise":{"command":"${BIN}","args":["--mcp"]}}}`,
    cliCommand: `claude mcp add --scope user sunrise -- ${BIN} --mcp`,
    currentCommand: null,
    problem: null,
    ...over,
  };
}

describe("McpCard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sin conectar, el botón conecta y después dice que hay que reiniciar Claude", async () => {
    vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(info());
    const connect = vi
      .spyOn(api, "connectClaudeDesktop")
      .mockResolvedValue(info({ status: ClaudeStatus.CONNECTED }));
    render(<McpCard />);

    const button = await screen.findByRole("button", { name: /Conectar con Claude Desktop/ });
    expect(button).toBeEnabled();
    await userEvent.click(button);

    expect(connect).toHaveBeenCalledOnce();
    expect(await screen.findByText(/ciérralo con ⌘Q/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Conectar con/ })).not.toBeInTheDocument();
  });

  /** La decisión del dev: una entrada que apunta a otro lado no se pisa. */
  it("si ya hay un sunrise apuntando a otro lado, avisa a dónde y no ofrece conectar", async () => {
    vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(
      info({ status: ClaudeStatus.ELSEWHERE, currentCommand: "/otra/ruta/sunrise" }),
    );
    const connect = vi.spyOn(api, "connectClaudeDesktop");
    render(<McpCard />);

    expect(await screen.findByText(/\/otra\/ruta\/sunrise/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conectar con Claude Desktop/ })).toBeDisabled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("con una configuración rota tampoco ofrece escribirla", async () => {
    vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(info({ status: ClaudeStatus.INVALID }));
    render(<McpCard />);

    expect(await screen.findByText(/no es JSON válido/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conectar con Claude Desktop/ })).toBeDisabled();
  });

  it("corriendo desde el instalador, dice por qué no conecta", async () => {
    vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(
      info({ problem: "sunrise está corriendo desde el instalador." }),
    );
    render(<McpCard />);

    expect(await screen.findByText(/desde el instalador/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conectar con Claude Desktop/ })).toBeDisabled();
  });

  it("un error al conectar se muestra, no se traga", async () => {
    vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(info());
    vi.spyOn(api, "connectClaudeDesktop").mockRejectedValue("No pude escribir la configuración");
    render(<McpCard />);

    await userEvent.click(await screen.findByRole("button", { name: /Conectar con Claude/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pude escribir");
    // La relectura de después del fallo no se lo lleva.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("al volver a la ventana, una lectura buena borra el error viejo", async () => {
    vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(info());
    vi.spyOn(api, "connectClaudeDesktop").mockRejectedValue("No pude escribir la configuración");
    render(<McpCard />);
    await userEvent.click(await screen.findByRole("button", { name: /Conectar con Claude/ }));
    await screen.findByRole("alert");

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("muestra la configuración y el comando de Claude Code para copiar", async () => {
    vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(info());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<McpCard />);

    expect(await screen.findByText(/claude mcp add --scope user sunrise/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Copiar configuración para Claude Desktop" }),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"--mcp"'));
  });

  it("relee el estado al volver a la ventana: el archivo es de otra app", async () => {
    const status = vi.spyOn(api, "claudeDesktopStatus").mockResolvedValue(info());
    render(<McpCard />);
    await screen.findByRole("button", { name: /Conectar con/ });

    window.dispatchEvent(new Event("focus"));
    expect(status).toHaveBeenCalledTimes(2);
  });
});
