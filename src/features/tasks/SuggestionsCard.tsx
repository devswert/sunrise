import { useEffect, useRef, useState } from "react";
import { Clock, Hash, Plus, Trash2, X } from "lucide-react";
import { Popover } from "../../components/Popover";
import { SearchSelect } from "../../components/SearchSelect";
import { PLAIN_INPUT } from "../../components/plainInput";
import { TIME_PRESETS, formatMinutes } from "../../lib/capacity";
import { SettingKey, useSettingsStore } from "../../lib/settings";
import { api } from "../../lib/ipc";
import type { Category } from "../../lib/types";
import { sectionIcon } from "../settings/secciones";
import { channelOptions } from "./channelOptions";
import { chipVarsForColor } from "./chipVars";
import {
  type ChannelRule,
  type TimeRule,
  cleanWords,
  parseChannelRules,
  parseTimeRules,
  serializeRules,
  textToWords,
} from "./suggestRules";

/**
 * El vocabulario del sugeridor del modal de crear (§4.31): qué palabras valen
 * cuántos minutos y qué palabras apuntan a qué canal.
 *
 * Vive en `features/tasks` y no en `SettingsView` por lo mismo que `FeedsCard`:
 * la card es de esta función, Configs solo la hospeda.
 *
 * **Las filas se editan en el lugar y se guardan solas**, como el resto de
 * Configs: el texto al salir del campo, el resto al elegirlo. Sin botón Guardar.
 *
 * Una fila sin palabras no se guarda —no dice nada—, pero **la lista vacía sí**:
 * borrar todas las reglas de tiempo es "no me adivines el tiempo", y tiene que
 * sobrevivir al reinicio en vez de volver a los defaults.
 */

/** Fila en edición. El `key` es local: las reglas no tienen id en la base. */
interface Draft<T> {
  key: number;
  words: string[];
  value: T;
}

let seq = 0;
function draft<T>(words: string[], value: T): Draft<T> {
  seq += 1;
  return { key: seq, words, value };
}

export function SuggestionsCard() {
  const Icon = sectionIcon("sugerencias");
  const loaded = useSettingsStore((s) => s.loaded);
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);

  const [categories, setCategories] = useState<Category[]>([]);
  const [timeRows, setTiempos] = useState<Draft<number>[] | null>(null);
  const [channelRows, setCanales] = useState<Draft<number | null>[] | null>(null);
  /**
   * La fila recién agregada, que **se enfoca sola**: el botón dice "Agregar
   * palabras", y dejar una fila vacía en la que hay que volver a hacer click no es
   * lo que se pidió. Es la misma cortesía que el alta de un canal (`AddRow`).
   *
   * Es la `key` de esa fila y no "la última vacía": vaciar a mano las palabras de
   * una regla que ya existe la volvería la última vacía, y el foco saltaría solo
   * mientras se está editando otra cosa.
   */
  const [newRow, setNewRow] = useState<number | null>(null);

  useEffect(() => {
    api.listCategories().then(setCategories);
  }, []);

  // Se siembra **una vez**, cuando los ajustes terminaron de cargar. De ahí en
  // más la verdad es lo que está en pantalla: releer el ajuste en cada cambio
  // borraría lo que se está typing, porque cada guardado vuelve por acá.
  // El precio, asumido: un cambio hecho desde otra ventana no se refleja hasta
  // volver a entrar. Es un editor de ajustes, no una vista de datos vivos.
  useEffect(() => {
    if (!loaded || timeRows !== null) return;
    setTiempos(
      parseTimeRules(values[SettingKey.SUGGEST_TIME_RULES]).map((r) => draft(r.words, r.minutes)),
    );
    setCanales(
      parseChannelRules(values[SettingKey.SUGGEST_CHANNEL_RULES]).map((r) =>
        draft(r.words, r.categoryId as number | null),
      ),
    );
  }, [loaded, values, timeRows]);

  function saveTimeRules(rows: Draft<number>[]) {
    setTiempos(rows);
    const rules: TimeRule[] = rows.map((f) => ({ minutes: f.value, words: f.words }));
    void setSetting(SettingKey.SUGGEST_TIME_RULES, serializeRules(rules));
  }

  function saveChannelRules(rows: Draft<number | null>[]) {
    setCanales(rows);
    const rules: ChannelRule[] = rows
      .filter((f): f is Draft<number> => f.value != null)
      .map((f) => ({ categoryId: f.value, words: f.words }));
    void setSetting(SettingKey.SUGGEST_CHANNEL_RULES, serializeRules(rules));
  }

  return (
    <section className="set-card" id="set-sugerencias" data-section="sugerencias">
      <header className="set-card__head">
        <Icon size={16} aria-hidden className="set-card__icon" />
        <div className="set-card__head-text">
          <h2>Sugerencias</h2>
          <p>Al crear una tarea, los chips se llenan solos con lo que dice el título.</p>
        </div>
      </header>

      {/* **Una sola explicación para las dos listas**, y no una por lista: hacen lo
       * mismo —un grupo de palabras que significa algo— y repetirlo con otras
       * palabras obliga a leer dos veces para descubrir que dicen lo mismo. Lo
       * propio de cada una cabe en su rótulo. */}
      <div className="set-field set-field--ancho">
        <div className="set-field__text">
          <span className="set-note">
            Cada row junta las palabras que significan lo mismo. <b>Una por idea alcanza</b>: el
            plural y los typos se toman solos. Un número escrito en el título («30 min», «2h») o un
            «#canal» le ganan a todo. Si calzan varias rows, en tiempo gana la de menos minutos y en
            channelRows la primera de la lista.
          </span>
        </div>
      </div>

      <span className="set-field__label">Tiempo</span>

      <ul className="set-list">
        {(timeRows ?? []).map((row, i) => (
          <RuleRow
            key={row.key}
            words={row.words}
            autoFocus={row.key === newRow}
            placeholder="revisar"
            onWords={(w) =>
              saveTimeRules((timeRows ?? []).map((f, j) => (i === j ? { ...f, words: w } : f)))
            }
            onDelete={() => saveTimeRules((timeRows ?? []).filter((_, j) => j !== i))}
            control={
              <MinutesPicker
                value={row.value}
                onSelect={(m) =>
                  saveTimeRules((timeRows ?? []).map((f, j) => (i === j ? { ...f, value: m } : f)))
                }
              />
            }
          />
        ))}
        <li>
          <button
            type="button"
            className="set-add-btn"
            onClick={() => {
              const row = draft([], 30);
              setNewRow(row.key);
              saveTimeRules([...(timeRows ?? []), row]);
            }}
          >
            <Plus size={14} aria-hidden /> Agregar palabras
          </button>
        </li>
      </ul>

      <span className="set-field__label">Canal</span>

      <ul className="set-list">
        {(channelRows ?? []).map((row, i) => (
          <RuleRow
            key={row.key}
            words={row.words}
            autoFocus={row.key === newRow}
            placeholder="issues"
            onWords={(w) =>
              saveChannelRules(
                (channelRows ?? []).map((f, j) => (i === j ? { ...f, words: w } : f)),
              )
            }
            onDelete={() => saveChannelRules((channelRows ?? []).filter((_, j) => j !== i))}
            control={
              <ChannelPicker
                categories={categories}
                value={row.value}
                onSelect={(id) =>
                  saveChannelRules(
                    (channelRows ?? []).map((f, j) => (i === j ? { ...f, value: id } : f)),
                  )
                }
              />
            }
          />
        ))}
        <li>
          <button
            type="button"
            className="set-add-btn"
            onClick={() => {
              const row = draft([], null);
              setNewRow(row.key);
              saveChannelRules([...(channelRows ?? []), row]);
            }}
          >
            <Plus size={14} aria-hidden /> Agregar palabras
          </button>
        </li>
      </ul>
    </section>
  );
}

/**
 * Una fila: las palabras a la izquierda, a qué equivalen a la derecha.
 *
 * **Cada palabra es una pill, no un texto con comas.** Una lista separada por
 * comas se lee como una frase y hay que recorrerla entera para ver cuántas cosas
 * hay; en pills se cuentan de un vistazo y cada una se borra sola, sin editar el
 * texto de al lado. Es el mismo dibujo que el `#tag` de las tarjetas: acá también
 * cada palabra es una cosa, no una parte de una oración.
 *
 * El campo del final es donde se escribe la siguiente. **Enter o coma la
 * confirman**, y ahí recién se guarda: guardar por tecla mandaría un `setSetting`
 * por letra. Pegar `issues, soporte` de una vez deja dos pills, no una.
 */
function RuleRow({
  words,
  placeholder,
  control,
  autoFocus,
  onWords,
  onDelete,
}: {
  words: string[];
  placeholder: string;
  control: React.ReactNode;
  autoFocus?: boolean;
  onWords: (w: string[]) => void;
  onDelete: () => void;
}) {
  const [typing, setTyping] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Solo al montar: reenfocar en cada render le robaría el foco a quien esté
  // eligiendo el canal de la fila.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  /** Lo tecleado pasa a ser pills. Las repetidas las descarta `cleanWords`. */
  function commit() {
    const added = textToWords(typing);
    setTyping("");
    if (added.length === 0) return;
    onWords(cleanWords([...words, ...added]));
  }

  return (
    <li className="set-row set-row--pills">
      <div className="set-pills">
        {words.map((w) => (
          <span key={w} className="set-pill">
            {w}
            <button
              type="button"
              className="set-pill__del"
              aria-label={`Quitar ${w}`}
              onClick={() => onWords(words.filter((x) => x !== w))}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="set-pills__input"
          aria-label={`Agregar palabra (ej. ${placeholder})`}
          placeholder={words.length === 0 ? placeholder : "+ palabra"}
          value={typing}
          {...PLAIN_INPUT}
          onChange={(e) => setTyping(e.target.value)}
          // Al salir del campo también: lo tecleado y no confirmado se perdería
          // en silencio, que es el modo de falla que más cuesta descubrir.
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
            // Con el campo vacío, borrar saca la última pill: es lo que hace
            // cualquier campo de etiquetas y evita ir hasta su × con el mouse.
            if (e.key === "Backspace" && typing === "" && words.length > 0) {
              e.preventDefault();
              onWords(words.slice(0, -1));
            }
            if (e.key === "Escape") setTyping("");
          }}
        />
      </div>
      {control}
      <button
        type="button"
        className="set-row__icon is-danger"
        aria-label={`Quitar la regla de ${words.join(", ") || placeholder}`}
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function MinutesPicker({ value, onSelect }: { value: number; onSelect: (m: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="chip-wrap" ref={ref}>
      <button type="button" className="chip is-set" onClick={() => setOpen((v) => !v)}>
        <Clock size={13} /> {formatMinutes(value)}
      </button>
      {open && (
        <Popover anchorRef={ref} align="right" onClose={() => setOpen(false)}>
          <SearchSelect
            options={TIME_PRESETS.map((m) => ({
              value: String(m),
              label: formatMinutes(m),
              hint: `${m} min`,
            }))}
            value={String(value)}
            placeholder="Buscar tiempo…"
            onSelect={(v) => {
              if (v) onSelect(Number(v));
              setOpen(false);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function ChannelPicker({
  categories,
  value,
  onSelect,
}: {
  categories: Category[];
  value: number | null;
  onSelect: (id: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const cat = value != null ? categories.find((c) => c.id === value) : null;
  return (
    <div className="chip-wrap" ref={ref}>
      <button
        type="button"
        className={`chip${cat ? " is-set chip--canal" : ""}`}
        style={chipVarsForColor(cat?.color)}
        onClick={() => setOpen((v) => !v)}
      >
        <Hash size={13} />
        {cat ? (cat.parentId != null ? `#${cat.name}` : cat.name) : "elegir canal"}
      </button>
      {open && (
        <Popover anchorRef={ref} align="right" onClose={() => setOpen(false)}>
          <SearchSelect
            options={channelOptions(categories)}
            value={value != null ? String(value) : null}
            placeholder="Buscar canal…"
            clearLabel="Sin canal"
            onSelect={(v) => {
              onSelect(v ? Number(v) : null);
              setOpen(false);
            }}
          />
        </Popover>
      )}
    </div>
  );
}
