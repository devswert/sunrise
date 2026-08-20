import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { Popover } from "../../components/Popover";
import { PLAIN_INPUT } from "../../components/plainInput";

/** Mismo piso que `POLL_MINIMO` en `repo.rs`. */
export const POLL_MINIMO = 2;
/** Default al crear un feed. Ver el comentario de `POLL_MINIMO` en `repo.rs`. */
export const POLL_DEFAULT = 5;

export interface DatosFeed {
  name: string;
  icsUrl: string;
  defaultCategoryId: number | null;
  pollMinutes: number;
}

/**
 * Alta de un calendario en un modal.
 *
 * Antes era una fila editable inline, y era mala por una razón concreta: la fila
 * tiene cuatro campos y con autosave al salir de cada uno, cualquier orden de
 * llenado disparaba un guardado a medias (el bug de "paso de Nombre a URL y la
 * fila desaparece"). Un modal con un botón explícito hace que el alta sea **una**
 * operación, con todos los datos, y deja el autosave para editar lo que ya
 * existe.
 */
export function AddFeedModal({
  categories,
  onSave,
  onClose,
}: {
  categories: SearchOption[];
  onSave: (d: DatosFeed) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [pollMinutes, setPollMinutes] = useState(String(POLL_DEFAULT));
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Escape en `window` y no en el div: los popovers viven en un portal sobre
  // `body`, así que con el selector de canal abierto la tecla no pasaría por acá.
  // Ver la regla en la skill `sunrise-ui`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (abierto) setAbierto(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, onClose]);

  const urlValida = icsUrl.trim().length > 0;
  const category = categories.find((o) => o.value === String(categoryId));

  async function save() {
    if (!urlValida || guardando) return;
    setGuardando(true);
    try {
      await onSave({
        name: name.trim() || "Calendario",
        icsUrl: icsUrl.trim(),
        defaultCategoryId: categoryId,
        // Un valor ilegible cae al default en vez de mandar NaN al backend.
        pollMinutes: Math.max(POLL_MINIMO, Number.parseInt(pollMinutes, 10) || POLL_DEFAULT),
      });
      onClose();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="feedmodal"
        role="dialog"
        aria-modal="true"
        aria-label="Agregar calendario"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="feedmodal__top">
          <h2>Agregar calendario</h2>
          <button className="tmodal__close" aria-label="Cerrar" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="feedmodal__body">
          <label className="feedfield">
            <span className="feedfield__label">Nombre</span>
            <input
              className="set-input"
              placeholder="Trabajo"
              aria-label="Nombre del calendario"
              value={name}
              autoFocus
              {...PLAIN_INPUT}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") urlRef.current?.focus();
              }}
            />
          </label>

          <label className="feedfield">
            <span className="feedfield__label">Dirección secreta en formato iCal</span>
            <input
              ref={urlRef}
              className="set-input feedfield__url"
              // `password` porque esta URL da acceso de lectura a todo el
              // calendario: es una credencial, y esta pantalla termina en
              // screenshots y en pantallas compartidas.
              type="password"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              aria-label="URL del calendario"
              value={icsUrl}
              {...PLAIN_INPUT}
              onChange={(e) => setIcsUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <span className="set-note">
              En Google Calendar: Configuración del calendario → Integrar calendario → la de
              abajo, la que dice que no la compartas.
            </span>
          </label>

          <div className="feedmodal__fila">
            <div className="feedfield feedfield--canal">
              <span className="feedfield__label">Canal por defecto</span>
              <div className="chip-wrap" ref={catRef}>
                <button
                  className={`chip${category ? " is-set" : ""}`}
                  aria-label="Canal por defecto del calendario"
                  onClick={() => setAbierto((v) => !v)}
                >
                  {category ? category.label : "sin canal"}
                </button>
                {abierto && (
                  <Popover anchorRef={catRef} onClose={() => setAbierto(false)}>
                    <SearchSelect
                      options={categories}
                      value={categoryId != null ? String(categoryId) : null}
                      placeholder="Buscar canal…"
                      clearLabel="Sin canal"
                      onSelect={(v) => {
                        setCategoryId(v ? Number(v) : null);
                        setAbierto(false);
                      }}
                    />
                  </Popover>
                )}
              </div>
            </div>

            <label className="feedfield feedfield--corto">
              <span className="feedfield__label">Cada (min)</span>
              <input
                className="set-input"
                aria-label="Minutos entre sincronizaciones"
                value={pollMinutes}
                {...PLAIN_INPUT}
                onChange={(e) => setPollMinutes(e.target.value)}
                onBlur={() =>
                  setPollMinutes(
                    String(
                      Math.max(
                        POLL_MINIMO,
                        Number.parseInt(pollMinutes, 10) || POLL_DEFAULT,
                      ),
                    ),
                  )
                }
              />
            </label>
          </div>
        </div>

        {/* Sin nota sobre el intervalo: el campo ya no deja escribir menos de
          * `POLL_MINIMO`, así que explicar el límite es decir dos veces algo que
          * el usuario no puede desobedecer. */}
        <footer className="feedmodal__foot feedmodal__foot--soloacciones">
          <div className="feedmodal__acciones">
            <button className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="btn-primary"
              disabled={!urlValida || guardando}
              onClick={() => void save()}
            >
              <Plus size={14} aria-hidden /> {guardando ? "Agregando…" : "Agregar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
