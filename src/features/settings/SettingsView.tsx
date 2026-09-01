import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  Globe,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { api, isTauri } from "../../lib/ipc";
import { PALETTE } from "../../lib/palette";
import type { AppUpdate, Category } from "../../lib/types";
import { formatMinutes, parseDuration } from "../../lib/capacity";
import { Popover } from "../../components/Popover";
import { Switch } from "../../components/Switch";
import { Spinner } from "../../components/Spinner";
import { FeedsCard } from "../calendar/FeedsCard";
import { AppearanceCard } from "../appearance/AppearanceCard";
import { NotificationsCard } from "../notifications/NotificationsCard";
import { BackupCard } from "../backup/BackupCard";
import { DevToolsCard } from "../devtools/DevToolsCard";
import { TABS, type TabId, sectionIcon, visibleTabs } from "./secciones";
import {
  SettingKey,
  prioritiesOn,
  timezone,
  useCapacitySettings,
  useCollapsedWeekdays,
  useSettingsStore,
  useWorkHours,
} from "../../lib/settings";
import { isoWeekdayLabel, systemZone } from "../../lib/date";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { announcementFor } from "../../lib/changelog";
import { useUpdateStore } from "../updates/updateStore";
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
        <Icono size={16} aria-hidden className="set-card__icon" />
        <div className="set-card__head-text">
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
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
        <div className="set-field__text">
          <label className="set-field__label" htmlFor="cap">
            Capacidad diaria
          </label>
          <span className={`set-note${error ? " is-error" : ""}`}>
            {error
              ? "No entendí esa duración. Prueba 8h, 7h30 o 480."
              : "Contra este número se pinta el semáforo de la semana. Acepta 8h, 7h30 o 480."}
          </span>
        </div>
        <div className="set-field__control">
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
        </div>
      </div>

      <ZonaField />
      <JornadaFields />
      <CollapsedDaysField />
      <Prioridades />
      <InicioAutomatico />
      <Actualizaciones />
    </Card>
  );
}

/**
 * El interruptor general de prioridades.
 *
 * Es lo único configurable de la función, y a propósito: los cinco niveles y sus
 * colores son fijos (ver `Priority` en `enums.ts`). Una escala que se edita deja
 * de comparar — un P2 de hace tres meses ya no significaría lo mismo que el de
 * hoy — así que lo único que tiene sentido preguntar es si la usas o no.
 *
 * Apagarlo **no borra nada**: esconde el indicador de las cards, el selector del
 * detalle y los filtros del backlog, y las tareas conservan su nivel. Volver a
 * encenderlo devuelve todo como estaba, que es lo contrario de tener que
 * repriorizar el backlog entero por haber probado el switch.
 */
function Prioridades() {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const on = prioritiesOn(values);

  return (
    <div className="set-field">
      <div className="set-field__text">
        <label className="set-field__label" htmlFor="prioridades">
          Prioridades
        </label>
        <span className="set-note">
          Cinco niveles fijos, de P1 a P5. Apagarlo los esconde sin borrarlos.
        </span>
      </div>
      <div className="set-field__control">
        <Switch
          id="prioridades"
          label="Prioridades"
          checked={on}
          onChange={(v) => void setSetting(SettingKey.PRIORITIES_ENABLED, v ? "1" : "0")}
        />
      </div>
    </div>
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
    <div className="set-field set-field--stack">
      <div className="set-field__text">
        <span className="set-field__label">Días plegados</span>
        <span className="set-note">
          Se dibujan como una tira angosta y no reciben tareas arrastradas; un click los abre.{" "}
          <strong>Hoy nunca se pliega</strong>, aunque esté marcado.
        </span>
      </div>
      <div className="set-field__control">
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
      </div>
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
      <div className="set-field__text">
        <label className="set-field__label" htmlFor="autostart">
          Abrir sunrise al iniciar sesión
        </label>
        {/* Solo el fallo. El ajuste se explica solo, y la nota que estaba acá
         * hablaba del respaldo y del cierre del día, que son otras secciones. */}
        {error && (
          <span className="set-note is-error">
            No se pudo cambiar el inicio automático: {error}
          </span>
        )}
      </div>
      <div className="set-field__control">
        <Switch
          id="autostart"
          label="Abrir sunrise al iniciar sesión"
          checked={active === true}
          disabled={active === null}
          onChange={(v) => void cambiar(v)}
        />
      </div>
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
 * Actualizaciones: el botón para preguntar **ahora**, y el anuncio de la versión
 * que estás usando.
 *
 * El sondeo automático vive en `useUpdateRuntime` (§4.23): pregunta al abrir y cada
 * 4 horas, y lo que aparece es una franja en el sidebar que espera. Este botón es
 * para el resto de las veces —acabo de publicar y no quiero esperar el intervalo—,
 * y sigue siendo el único lugar donde se ven las notas completas antes de instalar.
 *
 * **"Ver lo nuevo" está acá porque el aviso del sidebar dura 30 segundos.** Después
 * de eso el anuncio de la versión quedaba inalcanzable para siempre, aunque el
 * changelog viaje en el bundle y no cueste nada volver a mostrarlo.
 *
 * El fallo se dice en gris y no en rojo. Mientras no exista el Release —o
 * trabajando sin conexión— la consulta al `latest.json` no llega, y eso es lo
 * normal, no una avería.
 */
function Actualizaciones() {
  const [status, setStatus] = useState<UpdateState>({ kind: "quieto" });
  const [version, setVersion] = useState("");
  const showWhatsNew = useUpdateStore((s) => s.showWhatsNew);
  // El mismo progreso que dibuja el aviso del sidebar: lo emite Rust, así que las
  // dos vistas cuentan lo mismo sin que ninguna tenga que preguntar.
  const progress = useUpdateStore((s) => s.progress);
  const setInstalling = useUpdateStore((s) => s.setInstalling);
  const setUpdateError = useUpdateStore((s) => s.setError);

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
    // **También se avisa al store**, y no solo al estado local: es lo que mira el
    // aviso del sidebar, que está a la vista al lado de esta sección. Sin esto
    // seguía diciendo "Actualizar ahora" mientras acá bajaba, y apretarlo lanzaba
    // una segunda descarga del mismo paquete.
    setInstalling(true);
    setUpdateError(null);
    try {
      // Si sale bien no vuelve: la app se reinicia sola en la versión nueva.
      await api.installUpdate();
    } catch (err) {
      setStatus({ kind: "sin-respuesta", detalle: String(err) });
      setUpdateError(String(err));
      setInstalling(false);
    }
  }

  const busy = status.kind === "buscando" || status.kind === "instalando";
  const hay = status.kind === "hay" ? status.upd : null;
  // Sin sección escrita el modal no abre, así que el botón tampoco se ofrece: una
  // build local puede tener una versión que nadie publicó.
  const hayAnuncio = version !== "" && announcementFor(version) !== null;

  return (
    <div className="set-field">
      <div className="set-field__text">
        <span className="set-field__label">Actualizaciones</span>
        <span className="set-note">
          {status.kind === "instalando"
            ? progress?.installing
              ? "Instalando. La app se reinicia sola y vuelve al frente."
              : progress?.total
                ? `Descargando: ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))} %. Se reinicia sola al terminar.`
                : "Descargando. Se reinicia sola al terminar."
            : status.kind === "hay"
              ? `Hay una versión nueva: ${hay!.version}${hay!.date ? `, del ${hay!.date}` : ""}. Tienes la ${hay!.currentVersion}.`
              : status.kind === "al-dia"
                ? `Estás en la última versión${version ? ` (${version})` : ""}.`
                : status.kind === "sin-respuesta"
                  ? `No se pudo preguntar; puede que estés sin conexión. ${status.detalle}`
                  : `Versión ${version || "…"}. Se busca sola al abrir y cada 4 horas.`}
        </span>
      </div>
      <div className="set-field__control">
        {hay && (
          <button
            type="button"
            className="resp-btn upd-btn--primario"
            onClick={() => void instalar()}
          >
            <Download size={13} aria-hidden />
            <span className="resp-btn__texto">Instalar {hay.version} y reiniciar</span>
          </button>
        )}
        <button type="button" className="resp-btn" onClick={() => void buscar()} disabled={busy}>
          {status.kind === "buscando" ? <Spinner size={13} /> : <RotateCcw size={13} aria-hidden />}
          <span className="resp-btn__texto">
            {status.kind === "buscando" ? "Buscando…" : "Buscar"}
          </span>
        </button>
        {/* Un link y no un tercer botón: el único que hace algo acá es "Buscar" —
         * el resto es abrir un modal de lectura, y dos botones del mismo peso
         * hacían dudar cuál era la acción de la sección. */}
        {hayAnuncio && (
          <button type="button" className="set-note__link" onClick={() => showWhatsNew(version)}>
            Ver lo nuevo de la {version}
          </button>
        )}
      </div>
      {/* Las notas del Release en crudo: es markdown escrito a mano y puede venir
       * largo, así que va en un bloque aparte, a lo ancho del campo. */}
      {hay?.notes && <p className="upd-notas">{hay.notes}</p>}
    </div>
  );
}

/**
 * La zona en la que se vive el día.
 *
 * **Qué mueve y qué no.** Mueve toda frontera de día: dónde empieza "hoy" para el
 * taxímetro, qué entra en el rail, cómo se reparte el rollup semanal y la bitácora.
 * No mueve las horas de reloj que escribiste tú: una tarea puesta a las 09:00 sigue
 * a las 09:00, porque "a las nueve de la mañana" es una intención y no un instante.
 * Sí mueven las reuniones importadas, que son instantes reales y traen su propia
 * zona en el feed — por eso al cambiar esto se vuelven a sincronizar los feeds.
 *
 * **Los rollups pasados cambian**, y es lo correcto: los instantes están guardados
 * en UTC y la zona es solo el lente con el que se agrupan por día.
 *
 * Vacía = la del sistema, y por eso el ajuste arranca sin efecto.
 */
function ZonaField() {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const elegida = timezone(values);
  const delSistema = systemZone();

  const options = useMemo<SearchOption[]>(() => {
    // `supportedValuesOf` es lo que sabe la plataforma; si falta, queda al menos la
    // del sistema para que el selector no aparezca vacío.
    // El tipo se ensancha acá y no en `tsconfig`: `supportedValuesOf` no está en
    // la lib de este target, y subir la lib entera por una función traería un
    // montón de APIs que la app no puede asumir.
    const conZonas = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] };
    let zonas: string[] = [];
    try {
      zonas = conZonas.supportedValuesOf?.("timeZone") ?? [];
    } catch {
      zonas = [];
    }
    if (!zonas.length) zonas = [delSistema];
    return zonas.map((z) => ({ value: z, label: z.replace(/_/g, " "), hint: z.split("/")[0] }));
  }, [delSistema]);

  const guardar = async (v: string | null) => {
    await setSetting(SettingKey.TIMEZONE, v ?? "");
    setOpen(false);
    // Las reuniones importadas quedaron con la hora de reloj de la zona vieja: se
    // derivó al importar. Volver a sincronizar es lo que las corrige, y reusa el
    // camino que ya existe en vez de duplicar la derivación de `ics.rs`.
    if (isTauri()) void api.syncCalendarFeeds();
  };

  return (
    <div className="set-field set-field--wide">
      <div className="set-field__text">
        <span className="set-field__label">Zona horaria</span>
        <span className="set-note">
          Dónde empieza y termina cada día. Las horas que escribiste tú no se mueven;{" "}
          <strong>los totales por día sí se recalculan</strong>, incluidos los de semanas pasadas.
        </span>
      </div>
      <div className="set-field__control">
        <div className="chip-wrap" ref={ref}>
          <button
            type="button"
            className={`chip${open ? " is-open" : ""}${elegida ? " is-set" : ""}`}
            onClick={() => setOpen((v) => !v)}
          >
            <Globe size={14} /> {(elegida ?? delSistema).replace(/_/g, " ")}
          </button>
          {open && (
            <Popover anchorRef={ref} onClose={() => setOpen(false)}>
              <SearchSelect
                options={options}
                value={elegida}
                placeholder="Buscar zona…"
                clearLabel={`La del sistema (${delSistema.replace(/_/g, " ")})`}
                onSelect={(v) => void guardar(v)}
              />
            </Popover>
          )}
        </div>
      </div>
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
    <div className="set-pair">
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
    <div className="set-field set-field--wide">
      <div className="set-field__text">
        <span className="set-field__label">Jornada</span>
        <span className={`set-note${error ? " is-error" : ""}`}>
          {error === "start"
            ? "Una hora en formato 24 h (09:00), y antes del fin de jornada."
            : error === "end"
              ? "Una hora en formato 24 h (18:00), y después del inicio."
              : "La grilla del rail en Today. No recorta: una reunión fuera se ve igual."}
        </span>
      </div>
      <div className="set-field__control">
        <div className="set-jornada">
          {field("start", "Inicio", "work-start")}
          {field("end", "Fin", "work-end")}
        </div>
      </div>
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
    <Card id="atajos" title="Atajos" hint="Requieren ⌘ (o Ctrl). Se ignoran mientras escribes.">
      {/* Cada atajo es un campo como los de General: nombre a la izquierda, su
       * control a la derecha, separados por la misma divisoria. Antes eran cajas
       * apiladas, y seis cajas dentro de una card es una lista dentro de una
       * lista. */}
      <ul className="set-list set-list--campos">
        {SHORTCUT_ACTIONS.map((a) => {
          const esDefault = resolved[a.id] === a.fallback;
          return (
            <li className="set-field" key={a.id}>
              <div className="set-field__text">
                <span className="set-field__label">{a.label}</span>
              </div>
              <div className="set-field__control set-field__control--fila hotkey-grupo">
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
              </div>
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
        style={{ color: `var(--${color}-ink)` }}
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
  const [usage, setUsage] = useState<Map<number, number>>(new Map());
  /** `"root"` = creando contexto; un id = creando canal dentro de ese contexto. */
  const [adding, setAdding] = useState<number | "root" | null>(null);
  /**
   * Los contextos abiertos. **Arranca vacío: todos cerrados.**
   *
   * Con dos contextos y catorce canales, la lista abierta mide más que la sección
   * General entera y no entra en pantalla; cerrada son dos filas. Se viene acá a
   * tocar un canal puntual, no a leer los dieciséis, así que el estado que sirve
   * de entrada es el plegado.
   */
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    // En paralelo: son dos lecturas independientes y la lista no tiene por qué
    // esperar al conteo para dibujarse.
    const [cats, uso] = await Promise.all([api.listCategories(), api.categoryUsage()]);
    setCategories(cats);
    setUsage(new Map(uso.map((u) => [u.categoryId, u.tasks])));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const parents = useMemo(() => categories.filter((c) => c.parentId === null), [categories]);
  const childrenOf = useCallback(
    (id: number) => categories.filter((c) => c.parentId === id),
    [categories],
  );

  /**
   * Lo que muestra un contexto: sus canales y las tareas de todos ellos juntas.
   *
   * El propio contexto puede tener tareas colgando —una tarea puede ir en
   * cualquiera de los dos niveles—, así que se suma él también y no solo sus
   * hijos.
   */
  const totalDe = (p: Category) =>
    childrenOf(p.id).reduce((n, ch) => n + (usage.get(ch.id) ?? 0), usage.get(p.id) ?? 0);

  const toggle = (id: number) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Abre el contexto donde se va a crear: si no, la fila nueva nace escondida. */
  const addInto = (id: number) => {
    setAbiertos((prev) => new Set(prev).add(id));
    setAdding(id);
  };

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
      hint="Los contextos son las carpetas del backlog; los canales, el #tag de las tarjetas."
    >
      <ul className="set-list set-list--plana">
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

        {parents.map((p) => {
          const hijos = childrenOf(p.id);
          const abierto = abiertos.has(p.id);
          return (
            <li key={p.id} className="set-group">
              <ul className="set-list">
                <li className="set-row set-row--contexto">
                  {/* El chevron y no la fila entera: la fila lleva un input que se
                   * edita con un click, y ese click no puede además plegar.
                   *
                   * Sin canales no hay chevron —no hay nada que abrir—, pero el
                   * hueco se conserva para que los nombres de todos los contextos
                   * arranquen en la misma columna. */}
                  {hijos.length > 0 ? (
                    <button
                      className="set-row__chevron"
                      aria-expanded={abierto}
                      aria-label={`${abierto ? "Cerrar" : "Abrir"} ${p.name}`}
                      onClick={() => toggle(p.id)}
                    >
                      <ChevronRight size={14} aria-hidden />
                    </button>
                  ) : (
                    <span className="set-row__chevron is-empty" aria-hidden />
                  )}
                  <ColorDot value={p.color} onChange={(color) => recolor(p, color)} />
                  <input
                    className="set-row__input"
                    /* El nombre lleva el color de su canal, como el chip `#tag` de
                     las tarjetas: es la misma cosa nombrada en dos lugares, y con
                     el punto solo había que cruzar la vista para asociarlos. El
                     token `-ink` y no el plano — es el que tiene contraste medido
                     sobre el fondo de la fila. */
                    style={{ color: `var(--${p.color}-ink)` }}
                    defaultValue={p.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== p.name) {
                        rename(p, e.target.value.trim());
                      }
                    }}
                    aria-label={`Nombre de ${p.name}`}
                    {...PLAIN_INPUT}
                  />
                  {/* Cuántos canales tiene y cuánto se usan, sin abrirlo. Es lo que
                   * hace útil el estado cerrado: sin esto, un contexto plegado no
                   * dice nada y hay que abrirlo para saber qué hay dentro. */}
                  <span className="set-row__uso">
                    {/* Un contexto sin canales no dice "0 canales": es la mitad de la
                     * frase ocupada por un cero, y lo único que informa es cuánto se
                     * usa él mismo. */}
                    {hijos.length > 0 &&
                      `${hijos.length} ${hijos.length === 1 ? "canal" : "canales"} · `}
                    {totalDe(p)} {totalDe(p) === 1 ? "tarea" : "tareas"}
                  </span>
                  <button
                    className="set-row__icon"
                    aria-label={`Agregar canal en ${p.name}`}
                    title="Agregar canal dentro"
                    onClick={() => addInto(p.id)}
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

                {abierto && adding === p.id && (
                  <AddRow
                    child
                    placeholder={`Nombre del canal en ${p.name}`}
                    onCreate={(n, c) => create(p.id, n, c)}
                    onCancel={() => setAdding(null)}
                  />
                )}

                {abierto &&
                  hijos.map((ch) => (
                    <li className="set-row is-child" key={ch.id}>
                      <ColorDot value={ch.color} onChange={(color) => recolor(ch, color)} />
                      <input
                        className="set-row__input"
                        style={{ color: `var(--${ch.color}-ink)` }}
                        defaultValue={ch.name}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== ch.name) {
                            rename(ch, e.target.value.trim());
                          }
                        }}
                        aria-label={`Nombre de ${ch.name}`}
                        {...PLAIN_INPUT}
                      />
                      {/* Sin tareas nunca: es lo que dice que se puede borrar sin
                       * pensarlo, que es la pregunta que uno trae a esta sección. */}
                      <span className="set-row__uso">
                        {usage.get(ch.id) ?? 0} {(usage.get(ch.id) ?? 0) === 1 ? "tarea" : "tareas"}
                      </span>
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
          );
        })}
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
function animarScrollHasta(target: HTMLElement, alTerminar: () => void, duration = 320) {
  const cont = scrollParent(target);
  if (!cont) {
    target.scrollIntoView({ block: "start" });
    alTerminar();
    return;
  }

  const margen = 16;
  const from = cont.scrollTop;
  const delta = target.getBoundingClientRect().top - cont.getBoundingClientRect().top - margen;
  const to = Math.max(0, Math.min(from + delta, cont.scrollHeight - cont.clientHeight));
  if (Math.abs(to - from) < 1) {
    alTerminar();
    return;
  }

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    cont.scrollTop = to;
    alTerminar();
    return;
  }

  const t0 = performance.now();
  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  const paso = (ahora: number) => {
    const t = Math.min(1, (ahora - t0) / duration);
    cont.scrollTop = from + (to - from) * easeInOut(t);
    if (t < 1) requestAnimationFrame(paso);
    // Un frame después del último: el observer emite al final del frame en que
    // se movió el scroll, así que soltar el candado en el mismo tick deja pasar
    // justo la emisión de la sección de llegada... y también la de la última
    // intermedia, que es el rebote que se ve.
    else requestAnimationFrame(alTerminar);
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
  /**
   * La sección a la que se está viajando por click, o `null` si el scroll es del
   * usuario.
   *
   * **El resaltado automático tiene que callarse durante el viaje.** Sin esto, la
   * animación cruza cada sección intermedia, el observer emite por todas, y el
   * menú marca cuatro secciones en 320 ms antes de quedarse en la que se apretó:
   * se ve como un rebote y contradice al click, que es la orden más explícita que
   * puede dar el usuario. Es un `ref` y no estado porque lo lee el callback del
   * observer, que se registra una sola vez.
   */
  const viajandoA = useRef<TabId | null>(null);

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
        // Mientras dura el viaje por click manda el destino, no lo que se cruza.
        if (viajandoA.current) return;
        const id = visible?.target.getAttribute("data-section");
        if (id) setActive(id as TabId);
      },
      // El margen inferior grande hace que "activa" sea la de más arriba en
      // pantalla, no cualquiera que asome por abajo.
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 },
    );
    for (const s of secciones) io.observe(s);
    return () => io.disconnect();
  }, []);

  const goTo = (id: TabId) => {
    setActive(id);
    const el = document.getElementById(`set-${id}`);
    if (!el) return;
    viajandoA.current = id;
    // Solo si nadie apretó otra tab mientras tanto: el viaje viejo termina
    // después que el nuevo empezó y le soltaría el candado en la cara.
    const soltar = () => {
      if (viajandoA.current === id) viajandoA.current = null;
    };
    animarScrollHasta(el, soltar);
    // Red de seguridad, y no redundancia: la animación avanza por
    // `requestAnimationFrame`, que **no corre con la ventana oculta**. Si alguien
    // aprieta una tab y esconde la ventana en el mismo segundo, sin esto el
    // candado queda puesto y el menú deja de seguir al scroll al volver. Los
    // timers sí corren en ese estado. Soltar de más no rompe nada: el peor caso
    // es un resaltado que vuelve a seguir al scroll un pelo antes de tiempo.
    window.setTimeout(soltar, 600);
  };

  return [active, goTo];
}

export function SettingsView() {
  const [active, goTo] = useActiveTab();
  const profile = useProfile();
  const tabs = visibleTabs(profile?.dev === true);

  return (
    <div className="settings">
      {/* Con icono y a 22px, como los `h1` de weekly planning y de la review. El
          icono es `Settings`, el mismo del sidebar: se llega desde ahí y la marca
          tiene que ser la misma. Centrado, que es lo único en que se aparta de sus
          hermanas: acá el título corona dos columnas, no encabeza una. */}
      <h1 className="settings__title">
        <SettingsIcon size={20} aria-hidden /> Configuraciones
      </h1>

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
        <AppearanceCard />
        <CalendariosCard />
        <ChannelsCard />
        <ShortcutsCard />
        <NotificationsCard />
        <BackupCard />
        {/* Solo en dev, y con la misma condición que filtra su tab. */}
        {profile?.dev && <DevToolsCard />}
      </div>
    </div>
  );
}
