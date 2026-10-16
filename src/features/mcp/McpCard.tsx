import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Info, Plug, ShieldCheck } from "lucide-react";
import { api } from "../../lib/ipc";
import { ClaudeStatus } from "../../lib/enums";
import type { ClaudeDesktopInfo } from "../../lib/types";
import { Spinner } from "../../components/Spinner";
import { sectionIcon } from "../settings/secciones";
// Los avisos (`resp-ok`, `resp-alerta`, `resp-nota`) son los de Respaldo: el
// mismo aviso en el mismo lugar de la misma vista. Se importa acá para no
// depender de que Respaldo ya haya cargado su CSS.
import "../backup/backup.css";
import "./mcp.css";

const SectionIcon = sectionIcon("mcp");

/** Qué dice el estado, en una línea, para cada caso. */
function statusLine(info: ClaudeDesktopInfo): string {
  if (info.problem) return info.problem;
  switch (info.status) {
    case ClaudeStatus.NO_CLAUDE:
      return "No encontré Claude Desktop en este Mac. Si lo instalas, ábrelo una vez y vuelve acá.";
    case ClaudeStatus.NOT_CONNECTED:
      return "Sin conectar. El botón agrega sunrise a la configuración de Claude Desktop y guarda una copia de la anterior.";
    case ClaudeStatus.CONNECTED:
      return "Conectado: Claude Desktop ya tiene registrado este sunrise.";
    case ClaudeStatus.ELSEWHERE:
      return `Ya hay un «${info.serverName}» en Claude Desktop que apunta a ${
        info.currentCommand ?? "otro lado"
      }. No lo toco: si quieres cambiarlo, pega a mano el bloque de abajo.`;
    case ClaudeStatus.INVALID:
      return "La configuración de Claude Desktop no es JSON válido, así que no la toco. Arréglala o pega el bloque de abajo a mano.";
  }
}

/** Un bloque de texto para copiar: el JSON o el comando de Claude Code. */
function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin portapapeles el texto sigue en pantalla y se puede seleccionar.
      setCopied(false);
    }
  }

  return (
    <div className="mcp-code">
      <pre className="mcp-code__text">{text}</pre>
      <button
        type="button"
        className="mcp-code__copy"
        aria-label={`Copiar ${label}`}
        title="Copiar"
        onClick={() => void copy()}
      >
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </button>
    </div>
  );
}

/**
 * Configs → MCP (§4.32): conecta sunrise a Claude Desktop.
 *
 * El estado se lee de la configuración de Claude **cada vez que la ventana vuelve
 * al frente**: el archivo es de otra app y la persona puede editarlo a mano
 * mientras sunrise está abierta.
 */
export function McpCard() {
  const [info, setInfo] = useState<ClaudeDesktopInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api.claudeDesktopStatus());
      // Una lectura nueva reemplaza el error anterior: si la persona arregló el
      // archivo a mano y volvió, el aviso viejo ya no dice la verdad.
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      setInfo(await api.connectClaudeDesktop());
      setJustConnected(true);
    } catch (err) {
      setError(String(err));
      // El archivo pudo cambiar entre la lectura y el intento: se relee para que
      // el estado no mienta, pero sin `load`, que borraría el error recién puesto.
      api
        .claudeDesktopStatus()
        .then(setInfo)
        .catch(() => {});
    } finally {
      setConnecting(false);
    }
  }

  const connected = info?.status === ClaudeStatus.CONNECTED;
  const canConnect = info?.status === ClaudeStatus.NOT_CONNECTED && !info.problem;
  const trouble =
    !!info?.problem ||
    info?.status === ClaudeStatus.ELSEWHERE ||
    info?.status === ClaudeStatus.INVALID;

  return (
    <section className="set-card" id="set-mcp" data-section="mcp">
      <header className="set-card__head">
        <SectionIcon size={16} aria-hidden className="set-card__icon" />
        <div className="set-card__head-text">
          <h2>MCP</h2>
          <p>Conecta sunrise a Claude Desktop para que pueda leer tu día y crear tareas por ti.</p>
        </div>
        {!connected && (
          <div className="resp-acciones set-card__acciones">
            <button
              type="button"
              className="resp-btn"
              onClick={() => void connect()}
              disabled={!canConnect || connecting}
            >
              {connecting ? <Spinner size={13} /> : <Plug size={13} aria-hidden />}
              <span className="resp-btn__texto">
                {connecting ? "Conectando…" : "Conectar con Claude Desktop"}
              </span>
            </button>
          </div>
        )}
      </header>

      {/* Con un problema, el estado se dice una sola vez: en el aviso de abajo. */}
      {info && !trouble && (
        <div className="set-field set-field--stack">
          <div className="set-field__text">
            <span className="set-field__label">Claude Desktop</span>
            <span className="set-note">{statusLine(info)}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="resp-alerta" role="alert">
          <AlertTriangle size={14} aria-hidden />
          <span>{error}</span>
        </p>
      )}
      {trouble && !error && info && (
        <p className="resp-alerta" role="status">
          <AlertTriangle size={14} aria-hidden />
          <span>{statusLine(info)}</span>
        </p>
      )}
      {connected && (
        <p className="resp-ok" role="status">
          <ShieldCheck size={14} aria-hidden />
          <span>
            {justConnected ? "Listo. " : ""}Si Claude Desktop estaba abierto, ciérralo con ⌘Q y
            vuelve a abrirlo para que cargue sunrise.
          </span>
        </p>
      )}

      <div className="set-field set-field--stack">
        <div className="set-field__text">
          <span className="set-field__label">Qué puede hacer Claude</span>
          <span className="set-note">
            Ver tus tareas de un día o una semana, el backlog y los channels, y crear, editar o
            mover tareas. No las completa, no toca el timer, no borra nada, y las reuniones del
            calendario solo las lee.
          </span>
        </div>
      </div>

      <p className="resp-nota">
        <Info size={14} aria-hidden />
        <span>
          El servidor corre en tu Mac y no abre ningún puerto, pero lo que Claude lee de sunrise
          —títulos, notas, links de reuniones— viaja a Claude como cualquier mensaje.
        </span>
      </p>

      {info && (
        <>
          <div className="set-field set-field--stack">
            <div className="set-field__text">
              <span className="set-field__label">A mano</span>
              <span className="set-note">
                En Claude Desktop: Settings → Developer → Edit Config, y agrega esto dentro de{" "}
                <code>claude_desktop_config.json</code>.
              </span>
            </div>
            <div className="set-field__control">
              <CopyBlock label="configuración para Claude Desktop" text={info.snippet} />
            </div>
          </div>

          <div className="set-field set-field--stack">
            <div className="set-field__text">
              <span className="set-field__label">Claude Code</span>
              <span className="set-note">
                Desde una terminal, para tenerlo en todos tus proyectos.
              </span>
            </div>
            <div className="set-field__control">
              <CopyBlock label="comando para Claude Code" text={info.cliCommand} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
