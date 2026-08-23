import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { PALETTE } from "../../lib/palette";
import type { AppUpdate, Category } from "../../lib/types";
import { formatMinutes, parseDuration } from "../../lib/capacity";
import { Popover } from "../../components/Popover";
import { Switch } from "../../components/Switch";
import { FeedsCard } from "../calendar/FeedsCard";
import { BackupCard } from "../backup/BackupCard";
import { DevToolsCard } from "../devtools/DevToolsCard";
import { TABS, type TabId, sectionIcon, visibleTabs } from "./secciones";
import {
  SettingKey,
  useCapacitySettings,
  useCollapsedWeekdays,
  useSettingsStore,
  useWorkHours,
} from "../../lib/settings";
import { isoWeekdayLabel } from "../../lib/date";
import { minutesFromTime } from "../calendar/railLayout";
import { PLAIN_INPUT } from "../../components/plainInput";
import { useProfile } from "../../lib/profile";
import {
  SHORTCUT_ACTIONS,
  type ShortcutId,
  comboFromEvent,
  displayCombo,
  findConflict,
  resolveShortcuts,
  shortcutKey,
} from "../../lib/shortcuts";


/** Cada sección es una card con su título y bajada. */
function Card({
  id,
  title,
  hint,
  children,
}: {
  id: TabId;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const Icono = sectionIcon(id);
  return (
    <section className="set-card" id={`set-${id}`} data-section={id}>
      <header className="set-card__head">
        <h2>
          <Icono size={16} aria-hidden /> {title}
        </h2>
        <p>{hint}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * Punto de color que abre la paleta en un popover.
 *
 * Antes las ocho muestras estaban siempre visibles en cada fila: con ocho
 * categorías eran 64 puntos compitiendo por atención con los nombres, que es lo
 * que uno viene a leer.
 */
function ColorDot({
  value,
  onChange,
  keepFocus,
}: {
  value: string;
  onChange: (c: string) => void;
  /**
   * No sacar el foco de donde está al abrir la paleta ni al elegir un color.
   *
   * Es opt-in y no el comportamiento por defecto porque las dos cosas dependen
   * del mismo blur: en las filas de renombre, el click en el punto es lo que
   * saca el foco del nombre y **por eso** se guarda; en la fila de alta, ese
   * mismo blur confirmaba el alta a medio camino (Mej.7).
   */
  keepFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // `mousedown` y no `click`: el foco se mueve antes de que llegue el click, así
  // que cancelarlo después no sirve de nada.
  const holdFocus = keepFocus ? (e: React.MouseEvent) => e.preventDefault() : undefined;

  return (
    <div className="chip-wrap" ref={ref}>
      <button
        className="color-dot"
        style={{ background: `var(--${value})` }}
        aria-label={`Color: ${value}`}
        onMouseDown={holdFocus}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} className="popover--pad">
          <div className="palette">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch${value === c ? " is-active" : ""}`}
                style={{ background: `var(--${c})` }}
                aria-label={`Color ${c}`}
                onMouseDown={holdFocus}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

/**
 * Capacidad diaria: el objetivo de minutos planificados con el que la vista
 * semana pinta su semáforo. Autosave al salir del campo (sin botón Guardar).
 */
function GeneralCard() {
  const { target } = useCapacitySettings();
  const setSetting = useSettingsStore((s) => s.set);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // Mientras no se esté editando, refleja el valor guardado.
  const value = draft ?? formatMinutes(target);

  async function commit() {
    if (draft == null) return;
    const mins = parseDuration(draft);
    if (mins == null) {
      setError(true);
      return;
    }
    setError(false);
    setDraft(null);
    await setSetting(SettingKey.DAILY_CAPACITY_MINUTES, String(mins));
  }

  return (
    <Card id="general" title="General" hint="Ajustes del día a día.">
      <div className="set-field">
        <label className="set-field__label" htmlFor="cap">
          Capacidad diaria
        </label>
        <input
          id="cap"
          className={`set-input${error ? " is-invalid" : ""}`}
          aria-label="Capacidad diaria"
          value={value}
          {...PLAIN_INPUT}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(null);
              setError(false);
            }
          }}
        />
        <span className={`set-note${error ? " is-error" : ""}`}>
          {error
            ? "No entendí esa duración. Prueba 8h, 7h30 o 480."
            : "Objetivo de minutos planificados por día; el semáforo de la semana se pinta contra este número. Acepta 8h, 7h30 o 480."}
        </span>
      </div>

      <JornadaFields />
      <CollapsedDaysField />
      <InicioAutomatico />
      <Actualizaciones />
    </Card>
  );
}

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Qué días se dibujan plegados en la vista semana.
 *
 * Siete botones y no siete switches: la pregunta es "cuáles", y una fila de días
 * se lee de un vistazo, mientras siete filas con su interruptor ocuparían la card
 * entera para un ajuste que se toca una vez.
 *
 * **Destildar los siete es una elección válida**, no un valor vacío que haya que
 * corregir: se guarda un string vacío y `collapsedWeekdays` lo distingue de la
 * clave ausente. Ahí está la razón de que la migración 9 siembre la fila.
 */
function CollapsedDaysField() {
  const collapsed = useCollapsedWeekdays();
  const setSetting = useSettingsStore((s) => s.set);

  const toggle = async (day: number) => {
    const next = collapsed.includes(day)
      ? collapsed.filter((d) => d !== day)
      : [...collapsed, day].sort((a, b) => a - b);
    await setSetting(SettingKey.COLLAPSED_WEEKDAYS, next.join(","));
  };

  return (
    <div className="set-field">
      <span className="set-field__label">Días plegados</span>
      <div className="set-weekdays" role="group" aria-label="Días plegados">
        {ISO_WEEKDAYS.map((day) => {
          const on = collapsed.includes(day);
          return (
            <button
              key={day}
              type="button"
              className={`set-weekday${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => void toggle(day)}
            >
              {isoWeekdayLabel(day)}
            </button>
          );
        })}
      </div>
      <span className="set-note">
        En la vista semana se dibujan como una tira angosta con el día en vertical, y
        no reciben tareas arrastradas. Si un día plegado tiene tareas se muestra
        cuántas, y un click lo abre. <strong>Hoy nunca se pliega</strong>, aunque esté
        marcado.
      </span>
    </div>
  );
}

/**
 * Inicio automático con el sistema.
 *
 * **No sale de `useSettingsStore`.** Este ajuste no vive en la tabla `settings`
 * sino en el sistema operativo, que lo puede apagar por su cuenta desde Ajustes
 * del sistema; se lee preguntándole a él en cada montaje (ver `commands.rs`). Eso
 * también es lo que lo mantiene fuera de los respaldos: describe la máquina, no
 * los datos.
 *
 * `null` mientras carga, y no `false`: mostrar el switch apagado para después
 * prenderlo solo se ve como si la app hubiera cambiado el ajuste al entrar.
 */
function InicioAutomatico() {
  const [active, setActive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .autostartEnabled()
      .then((v) => alive && setActive(v))
      .catch((err) => alive && setError(String(err)));
    return () => {
      alive = false;
    };
  }, []);

  async function cambiar(quiere: boolean) {
    // Optimista, y se revierte si falla: el switch tiene que responder al dedo.
    setActive(quiere);
    setError(null);
    try {
      await api.setAutostart(quiere);
    } catch (err) {
      setActive(!quiere);
      setError(String(err));
    }
  }

  return (
    <div className="set-field">
      <div className="set-field__row">
        <label className="set-field__label" htmlFor="autostart">
          Abrir sunrise al iniciar sesión
        </label>
        <Switch
          id="autostart"
          label="Abrir sunrise al iniciar sesión"
          checked={active === true}
          disabled={active === null}
          onChange={(v) => void cambiar(v)}
        />
      </div>
      <span className={`set-note${error ? " is-error" : ""}`}>
        {error
          ? `No se pudo cambiar el inicio automático: ${error}`
          : "El respaldo automático y el aviso de cerrar el día ocurren a una hora fija, y solo si sunrise está abierta."}
      </span>
    </div>
  );
}

/**
 * Estados de la búsqueda de actualización. Son seis y no un par de booleanos
 * porque "no pude preguntar" y "estás al día" se ven parecidos y significan lo
 * contrario: uno dice que no hay nada nuevo, el otro que no se sabe.
 */
type UpdateState =
  | { kind: "quieto" }
  | { kind: "buscando" }
  | { kind: "al-dia" }
  | { kind: "hay"; upd: AppUpdate }
  | { kind: "instalando" }
  | { kind: "sin-respuesta"; detalle: string };

/**
 * Actualizaciones: se buscan **cuando las pides**, nunca solas.
 *
 * La app ya interrumpe dos veces a una hora fija —el aviso de cerrar el día y el
 * respaldo automático— y una tercera cosa que aparece sola al arrancar es la que
 * sobra: lo primero que uno mira en la mañana es el día, no un diálogo. Por eso el
 * plugin queda registrado en `lib.rs` sin chequeo de arranque y todo empieza acá,
 * con un botón.
 *
 * El fallo se dice en gris y no en rojo. Mientras no exista el Release —o
 * trabajando sin conexión— la consulta al `latest.json` no llega, y eso es lo
 * normal, no una avería.
 */
function Actualizaciones() {
  const [status, setStatus] = useState<UpdateState>({ kind: "quieto" });
  const [version, setVersion] = useState("");

  useEffect(() => {
    let alive = true;
    void api.appVersion().then((v) => alive && setVersion(v));
    return () => {
      alive = false;
    };
  }, []);

  async function buscar() {
    setStatus({ kind: "buscando" });
    try {
      const upd = await api.checkForUpdate();
      setStatus(upd ? { kind: "hay", upd } : { kind: "al-dia" });
    } catch (err) {
      setStatus({ kind: "sin-respuesta", detalle: String(err) });
    }
  }

  async function instalar() {
    setStatus({ kind: "instalando" });
    try {
      // Si sale bien no vuelve: la app se reinicia sola en la versión nueva.
      await api.installUpdate();
    } catch (err) {
      setStatus({ kind: "sin-respuesta", detalle: String(err) });
    }
  }

  const busy = status.kind === "buscando" || status.kind === "instalando";
  const hay = status.kind === "hay" ? status.upd : null;

  return (
    <div className="set-field">
      <div className="set-field__row">
        <span className="set-field__label">Actualizaciones</span>
        <div className="upd-acciones">
          {hay && (
            <button type="button" className="resp-btn upd-btn--primario" onClick={() => void instalar()}>
              <Download size={13} aria-hidden />
              <span className="resp-btn__texto">Instalar {hay.version} y reiniciar</span>
            </button>
          )}
          <button type="button" className="resp-btn" onClick={() => void buscar()} disabled={busy}>
            <RotateCcw size={13} aria-hidden className={busy ? "is-spinning" : undefined} />
            <span className="resp-btn__texto">
              {status.kind === "buscando" ? "Buscando…" : "Buscar"}
            </span>
          </button>
        </div>
      </div>
      <span className="set-note">
        {status.kind === "instalando"
          ? "Descargando la versión nueva. La app se va a reiniciar sola al terminar."
          : status.kind === "hay"
            ? `Hay una versión nueva: ${hay!.version}${hay!.date ? `, publicada el ${hay!.date}` : ""}. Tienes la ${hay!.currentVersion}.`
            : status.kind === "al-dia"
              ? `Estás en la última versión${version ? ` (${version})` : ""}.`
              : status.kind === "sin-respuesta"
                ? `No se pudo preguntar por versiones nuevas; puede ser que estés sin conexión. ${status.detalle}`
                : `Estás usando la versión ${version || "…"}. Se busca solo cuando lo pides.`}
      </span>
      {/* Las notas del Release en crudo: es markdown escrito a mano y puede venir
        * largo, así que va en un bloque aparte y no en la bajada. */}
      {hay?.notes && <p className="upd-notas">{hay.notes}</p>}
    </div>
  );
}

/**
 * Inicio y fin de jornada. Es lo que dibuja la grilla del rail de calendario:
 * define el rango visible y desde dónde se proyectan las tareas sin hora.
 *
 * `workHours()` ya cae al default con basura o con un rango invertido, pero eso
 * es la defensa al **leer** la base. Acá hace falta validar al **escribir**: si
 * el campo se traga un `25:00` y el rail no cambia, nada explica por qué.
 */
function JornadaFields() {
  const workday = useWorkHours();
  const setSetting = useSettingsStore((s) => s.set);
  const [draft, setDraft] = useState<{ start?: string; end?: string }>({});
  const [error, setError] = useState<null | "start" | "end">(null);

  async function commit(cual: "start" | "end") {
    const raw = draft[cual];
    if (raw == null) return;
    const min = minutesFromTime(raw);
    if (min == null) {
      setError(cual);
      return;
    }
    // El otro extremo puede venir a medio editar; se compara contra lo guardado.
    const otro = cual === "start" ? workday.end : workday.start;
    const invertido = cual === "start" ? raw >= otro : raw <= otro;
    if (invertido) {
      setError(cual);
      return;
    }
    setError(null);
    setDraft((d) => ({ ...d, [cual]: undefined }));
    await setSetting(cual === "start" ? SettingKey.WORK_START : SettingKey.WORK_END, raw);
  }

  const field = (cual: "start" | "end", label: string, id: string) => (
    <div className="set-field set-field--inline">
      <label className="set-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`set-input set-input--hora${error === cual ? " is-invalid" : ""}`}
        aria-label={label}
        placeholder="09:00"
        value={draft[cual] ?? workday[cual]}
        {...PLAIN_INPUT}
        onChange={(e) => {
          setDraft((d) => ({ ...d, [cual]: e.target.value }));
          setError(null);
        }}
        onBlur={() => void commit(cual)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft((d) => ({ ...d, [cual]: undefined }));
            setError(null);
          }
        }}
      />
    </div>
  );

  return (
    <div className="set-field">
      <span className="set-field__label">Jornada</span>
      <div className="set-jornada">
        {field("start", "Inicio", "work-start")}
        {field("end", "Fin", "work-end")}
      </div>
      <span className={`set-note${error ? " is-error" : ""}`}>
        {error === "start"
          ? "Una hora en formato 24 h (09:00), y antes del fin de jornada."
          : error === "end"
            ? "Una hora en formato 24 h (18:00), y después del inicio."
            : "Define la grilla del rail de calendario en Today y desde dónde se proyectan las tareas sin hora. No recorta: una reunión fuera de la jornada se muestra igual."}
      </span>
    </div>
  );
}

/**
 * Atajos de teclado. Se capturan pulsando la combinación de verdad, no
 * escribiéndola: es lo que evita que alguien guarde `Comando+1` como texto.
 */
function ShortcutsCard() {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const resolved = useMemo(() => resolveShortcuts(values), [values]);
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCapturing(null);
        setError(null);
        return;
      }
      // Evita que la combinación dispare su propio atajo mientras se captura.
      e.preventDefault();
      e.stopPropagation();

      const combo = comboFromEvent(e);
      if (!combo) return; // todavía no soltó una combinación válida

      const clash = findConflict(resolved, combo, capturing);
      if (clash) {
        setError(`${displayCombo(combo)} ya lo usa "${clash.label}"`);
        return;
      }
      setCapturing(null);
      setError(null);
      void setSetting(shortcutKey(capturing) as SettingKey, combo);
    };
    // `capture` para ganarle al listener global de atajos.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, resolved, setSetting]);

  return (
    <Card
      id="atajos"
      title="Atajos"
      hint="Requieren ⌘ (o Ctrl). Se ignoran mientras escribes en un campo de texto."
    >
      <ul className="set-list">
        {SHORTCUT_ACTIONS.map((a) => {
          const esDefault = resolved[a.id] === a.fallback;
          return (
            <li className="set-row" key={a.id}>
              <span className="set-row__name">{a.label}</span>
              <button
                className={`hotkey${capturing === a.id ? " is-capturing" : ""}`}
                aria-label={`Cambiar atajo de ${a.label}`}
                onClick={() => {
                  setError(null);
                  setCapturing((c) => (c === a.id ? null : a.id));
                }}
              >
                {capturing === a.id ? "Presiona…" : displayCombo(resolved[a.id])}
              </button>
              <button
                className="set-row__icon"
                aria-label={`Restaurar atajo de ${a.label}`}
                disabled={esDefault}
                title={esDefault ? "Ya es el de fábrica" : "Restaurar el de fábrica"}
                onClick={() => void setSetting(shortcutKey(a.id) as SettingKey, "")}
              >
                <RotateCcw size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      {(error || capturing) && (
        <span className={`set-note${error ? " is-error" : ""}`}>
          {error ?? "Pulsa la combinación, o Escape para cancelar."}
        </span>
      )}
    </Card>
  );
}

/**
 * Campo inline para crear un contexto o un canal dentro de uno.
 *
 * **El alta se confirma con Enter o al salir de la fila completa**, nunca en el
 * blur de un campo suelto. Guardar en el blur del nombre destruía la fila a
 * mitad de camino: el click en el punto de color le saca el foco al input, el
 * alta se creaba sin color y la categoría reaparecía al final de su grupo con el
 * color a medio elegir (Mej.7). Es el mismo bug que tenía la fila de feeds al
 * pasar de Nombre a URL (SPECS §3.1).
 *
 * Son dos defensas y las dos hacen falta:
 *
 * - `keepFocus` en el punto de color, que es la que sostiene el caso real: si el
 *   click en el botón no lo enfoca —se reporta de WebKit y **no lo verificamos
 *   acá**— el foco se va al `body` y el blur llega con `relatedTarget` en `null`,
 *   indistinguible de irse de la fila. El `preventDefault` no depende de eso: en
 *   cualquier motor deja el foco donde está.
 * - El blur a nivel de la fila, que cubre el resto: Tab hacia afuera, o un click
 *   en cualquier otra parte de Configs.
 */
function AddRow({
  placeholder,
  child,
  onCreate,
  onCancel,
}: {
  placeholder: string;
  child?: boolean;
  onCreate: (name: string, color: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("lavender");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // La fila sigue montada mientras se espera el alta, así que un blur que llegue
  // en ese rato crearía la categoría dos veces.
  const creating = useRef(false);

  async function submit() {
    const n = name.trim();
    if (!n) return onCancel();
    if (creating.current) return;
    creating.current = true;
    try {
      await onCreate(n, color);
    } finally {
      // En un `finally` para que un alta que falló se pueda reintentar; sin esto
      // la fila queda muda y la única salida es Escape.
      creating.current = false;
    }
    setName("");
    onCancel();
  }

  /** Solo cuando el foco se fue de la fila entera; entre sus controles, no. */
  function onRowBlur(e: React.FocusEvent<HTMLLIElement>) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    void submit();
  }

  return (
    <li className={`set-row is-adding${child ? " is-child" : ""}`} onBlur={onRowBlur}>
      <ColorDot value={color} onChange={setColor} keepFocus />
      <input
        ref={ref}
        className="set-row__input"
        placeholder={placeholder}
        aria-label={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        {...PLAIN_INPUT}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
      />
    </li>
  );
}

/**
 * Contextos (nivel 1) y sus canales (nivel 2).
 *
 * No hay selector de "contexto padre": el `+` de cada contexto crea un canal
 * dentro de él, y el de arriba crea un contexto. La jerarquía se dice con el
 * lugar donde haces click, no eligiéndola en un combo aparte.
 */
function ChannelsCard() {
  const [categories, setCategories] = useState<Category[]>([]);
  /** `"root"` = creando contexto; un id = creando canal dentro de ese contexto. */
  const [adding, setAdding] = useState<number | "root" | null>(null);

  const load = useCallback(async () => {
    setCategories(await api.listCategories());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const parents = useMemo(() => categories.filter((c) => c.parentId === null), [categories]);
  const childrenOf = (id: number) => categories.filter((c) => c.parentId === id);

  const rename = async (c: Category, name: string) => {
    await api.updateCategory(c.id, name, c.color);
    await load();
  };
  const recolor = async (c: Category, color: string) => {
    await api.updateCategory(c.id, c.name, color);
    await load();
  };
  const remove = async (id: number) => {
    await api.deleteCategory(id);
    await load();
  };
  const create = async (parentId: number | null, name: string, color: string) => {
    await api.createCategory(parentId, name, color);
    await load();
  };

  return (
    <Card
      id="canales"
      title="Canales"
      hint="Los contextos son las carpetas del backlog; los canales son el #tag de las tarjetas. Una tarea puede ir en cualquiera de los dos niveles."
    >
      <ul className="set-list">
        {/* Agregar va arriba: es lo primero que se busca. */}
        {adding === "root" ? (
          <AddRow
            placeholder="Nombre del contexto"
            onCreate={(n, c) => create(null, n, c)}
            onCancel={() => setAdding(null)}
          />
        ) : (
          <li>
            <button className="set-add-btn" onClick={() => setAdding("root")}>
              <Plus size={14} /> Agregar contexto
            </button>
          </li>
        )}

        {parents.map((p) => (
          <li key={p.id} className="set-group">
            <ul className="set-list">
              <li className="set-row">
                <ColorDot value={p.color} onChange={(color) => recolor(p, color)} />
                <input
                  className="set-row__input"
                  defaultValue={p.name}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== p.name) {
                      rename(p, e.target.value.trim());
                    }
                  }}
                  aria-label={`Nombre de ${p.name}`}
                  {...PLAIN_INPUT}
                />
                <button
                  className="set-row__icon"
                  aria-label={`Agregar canal en ${p.name}`}
                  title="Agregar canal dentro"
                  onClick={() => setAdding(p.id)}
                >
                  <Plus size={14} />
                </button>
                <button
                  className="set-row__icon is-danger"
                  aria-label={`Eliminar ${p.name}`}
                  onClick={() => remove(p.id)}
                >
                  <Trash2 size={14} />
                </button>
              </li>

              {adding === p.id && (
                <AddRow
                  child
                  placeholder={`Nombre del canal en ${p.name}`}
                  onCreate={(n, c) => create(p.id, n, c)}
                  onCancel={() => setAdding(null)}
                />
              )}

              {childrenOf(p.id).map((ch) => (
                <li className="set-row is-child" key={ch.id}>
                  <ColorDot value={ch.color} onChange={(color) => recolor(ch, color)} />
                  <input
                    className="set-row__input"
                    defaultValue={ch.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== ch.name) {
                        rename(ch, e.target.value.trim());
                      }
                    }}
                    aria-label={`Nombre de ${ch.name}`}
                    {...PLAIN_INPUT}
                  />
                  <button
                    className="set-row__icon is-danger"
                    aria-label={`Eliminar ${ch.name}`}
                    onClick={() => remove(ch.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Los feeds viven en su propio módulo (`features/calendar`) porque el calendario
 * es un dominio aparte; acá solo se les pasan las categorías, que es lo que
 * necesitan para elegir la categoría por defecto de cada feed.
 */
function CalendariosCard() {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    api.listCategories().then(setCategories);
  }, []);
  return <FeedsCard categories={categories} />;
}

/** El ancestro que realmente hace scroll (en la app, `.app-main`). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Lleva la sección al tope con una animación propia.
 *
 * No se usa `scrollIntoView({ behavior: "smooth" })` porque el scroll suave
 * nativo no está disponible en todos los webviews —en el browser embebido
 * simplemente no hace nada, sin error—, y la animación es parte de lo pedido.
 * Con `prefers-reduced-motion` se salta el salto animado.
 */
function animarScrollHasta(target: HTMLElement, duration = 320) {
  const cont = scrollParent(target);
  if (!cont) {
    target.scrollIntoView({ block: "start" });
    return;
  }

  const margen = 16;
  const from = cont.scrollTop;
  const delta = target.getBoundingClientRect().top - cont.getBoundingClientRect().top - margen;
  const to = Math.max(0, Math.min(from + delta, cont.scrollHeight - cont.clientHeight));
  if (Math.abs(to - from) < 1) return;

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    cont.scrollTop = to;
    return;
  }

  const t0 = performance.now();
  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  const paso = (ahora: number) => {
    const t = Math.min(1, (ahora - t0) / duration);
    cont.scrollTop = from + (to - from) * easeInOut(t);
    if (t < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/**
 * Tabs verticales que llevan a su sección con scroll animado. No ocultan
 * contenido: las tres cards viven en la misma columna y la tab activa se
 * resuelve por lo que está a la vista, así el resaltado no miente si el usuario
 * baja con la rueda.
 */
function useActiveTab(): [TabId, (id: TabId) => void] {
  const [active, setActive] = useState<TabId>("general");

  useEffect(() => {
    // El resaltado automático es una mejora: sin `IntersectionObserver`
    // (jsdom) las tabs siguen navegando, solo no se resaltan solas al scrollear.
    if (typeof IntersectionObserver === "undefined") return;

    const secciones = TABS.map((t) => document.getElementById(`set-${t.id}`)).filter(
      (el): el is HTMLElement => el != null,
    );
    if (secciones.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = visible?.target.getAttribute("data-section");
        if (id) setActive(id as TabId);
      },
      // El margen inferior grande hace que "activa" sea la de más arriba en
      // pantalla, no cualquiera que asome por abajo.
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );
    secciones.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const goTo = (id: TabId) => {
    setActive(id);
    const el = document.getElementById(`set-${id}`);
    if (el) animarScrollHasta(el);
  };

  return [active, goTo];
}

export function SettingsView() {
  const [active, goTo] = useActiveTab();
  const profile = useProfile();
  const tabs = visibleTabs(profile?.dev === true);

  return (
    <div className="settings">
      <h1 className="settings__title">Configs</h1>

      <nav className="set-tabs" aria-label="Secciones de ajustes">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`set-tab${active === t.id ? " is-active" : ""}`}
            aria-current={active === t.id ? "true" : undefined}
            onClick={() => goTo(t.id)}
          >
            <t.icon size={14} aria-hidden /> {t.label}
          </button>
        ))}
      </nav>

      <div className="set-panels">
        <GeneralCard />
        <CalendariosCard />
        <ChannelsCard />
        <ShortcutsCard />
        <BackupCard />
        {/* Solo en dev, y con la misma condición que filtra su tab. */}
        {profile?.dev && <DevToolsCard />}
      </div>
    </div>
  );
}
