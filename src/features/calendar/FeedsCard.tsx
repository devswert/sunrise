import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { api } from "../../lib/ipc";
import type { CalendarFeed, Category } from "../../lib/types";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { Popover } from "../../components/Popover";
import { relativeTime } from "../../lib/date";
import { useCalendarSync } from "../../lib/calendarSync";
import { sectionIcon } from "../settings/secciones";
import { AddFeedModal, POLL_DEFAULT, POLL_MINIMO } from "./AddFeedModal";
import { SyncButton } from "./SyncButton";
import { PLAIN_INPUT } from "../../components/plainInput";

interface Props {
  categories: Category[];
}

const SectionIcon = sectionIcon("calendarios");

/**
 * Calendarios configurados: alta en modal, edición inline y borrado.
 *
 * La URL nunca se muestra en claro —es una credencial— y el estado de
 * sincronización sale del store compartido, así que este botón y el de la vista
 * semana son el mismo botón.
 */
export function FeedsCard({ categories }: Props) {
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [agregando, setAgregando] = useState(false);
  const sincronizando = useCalendarSync((s) => s.sincronizando);
  const sync = useCalendarSync((s) => s.sync);
  const refrescarSync = useCalendarSync((s) => s.refresh);

  const load = useCallback(async () => {
    setFeeds(await api.listCalendarFeeds());
    await refrescarSync();
  }, [refrescarSync]);
  useEffect(() => {
    load();
  }, [load]);

  // Cuando termina una sync (venga de acá o del botón de la semana), la lista
  // tiene marcas nuevas que mostrar.
  useEffect(() => {
    if (!sincronizando) void load();
  }, [sincronizando, load]);

  const opcionesCanal = useMemo<SearchOption[]>(() => {
    const out: SearchOption[] = [];
    for (const ctx of categories.filter((c) => c.parentId === null)) {
      out.push({ value: String(ctx.id), label: ctx.name, color: ctx.color });
      for (const ch of categories.filter((c) => c.parentId === ctx.id)) {
        out.push({ value: String(ch.id), label: `#${ch.name}`, hint: ctx.name, color: ch.color });
      }
    }
    return out;
  }, [categories]);

  return (
    <section className="set-card" id="set-calendarios" data-section="calendarios">
      <header className="set-card__head set-card__head--conaccion">
        <div>
          <h2>
            {/* El mismo icono que su tab: sale de `TABS` para que no se separen. */}
            <SectionIcon size={16} aria-hidden /> Calendarios
          </h2>
          <p>
            Los eventos entran como tareas normales: les puedes poner el taxímetro, completarlas
            y moverlas. Se traen las <strong>próximas tres semanas</strong>, sin los cancelados.
          </p>
        </div>
        {/* Alineado a la derecha en la fila del título, y compartiendo estado con
          * el botón de la vista semana. */}
        <SyncButton />
      </header>

      {feeds.length === 0 ? (
        <div className="feeds__vacio">
          <p>Todavía no hay ningún calendario.</p>
          <button className="btn-primary" onClick={() => setAgregando(true)}>
            <Plus size={14} /> Agregar calendario
          </button>
        </div>
      ) : (
        <>
          <ul className="feeds">
            {feeds.map((f) => (
              <FeedItem
                key={f.id}
                feed={f}
                channels={opcionesCanal}
                sincronizando={sincronizando}
                onSync={() => void sync(f.id)}
                onSave={async (patch) => {
                  await api.updateCalendarFeed(
                    f.id,
                    patch.name ?? f.name,
                    f.icsUrl,
                    patch.defaultCategoryId !== undefined
                      ? patch.defaultCategoryId
                      : f.defaultCategoryId,
                    patch.importAsTasks ?? f.importAsTasks,
                    patch.pollMinutes ?? f.pollMinutes,
                  );
                  await load();
                }}
                onDelete={async () => {
                  await api.deleteCalendarFeed(f.id);
                  await load();
                }}
              />
            ))}
          </ul>
          <button className="set-add-btn" onClick={() => setAgregando(true)}>
            <Plus size={14} /> Agregar calendario
          </button>
        </>
      )}

      {agregando && (
        <AddFeedModal
          categories={opcionesCanal}
          onClose={() => setAgregando(false)}
          onSave={async (d) => {
            await api.createCalendarFeed(d.name, d.icsUrl, d.defaultCategoryId, d.pollMinutes);
            await load();
            // Recién creado: traer sus eventos de inmediato en vez de esperar al
            // poller, que puede tardar hasta un minuto en despertar.
            await sync();
          }}
        />
      )}
    </section>
  );
}

/** Lo que una fila puede cambiar. Ausente = no tocar. */
interface PatchFeed {
  name?: string;
  defaultCategoryId?: number | null;
  importAsTasks?: boolean;
  pollMinutes?: number;
}

/**
 * Un calendario en la lista: nombre editable, canal, intervalo y estado.
 *
 * La URL **no se puede editar** acá a propósito: es el dato que identifica al
 * feed, y cambiarla en un campo con autosave —password, así que no se ve lo que
 * hay— es la receta para apuntar a un calendario equivocado sin darse cuenta.
 * Para cambiarla, se quita y se agrega de nuevo.
 */
function FeedItem({
  feed,
  channels,
  sincronizando,
  onSave,
  onSync,
  onDelete,
}: {
  feed: CalendarFeed;
  channels: SearchOption[];
  sincronizando: boolean;
  onSave: (p: PatchFeed) => Promise<void>;
  onSync: () => void;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(feed.name);
  const [poll, setPoll] = useState(String(feed.pollMinutes));
  const [abierto, setAbierto] = useState(false);
  const [confirmar, setConfirm] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);

  // El feed llega fresco desde el padre después de cada guardado.
  useEffect(() => {
    setName(feed.name);
    setPoll(String(feed.pollMinutes));
  }, [feed.name, feed.pollMinutes]);

  const channel = channels.find((o) => o.value === String(feed.defaultCategoryId));

  return (
    <li className={`feed${feed.lastError ? " is-roto" : ""}`}>
      <div className="feed__linea">
        <input
          className="feed__nombre"
          aria-label={`Nombre de ${feed.name}`}
          value={name}
          {...PLAIN_INPUT}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const v = name.trim();
            if (v && v !== feed.name) void onSave({ name: v });
            else setName(feed.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />

        <div className="feed__acciones">
          <button
            className="set-row__icon"
            aria-label={`Sincronizar ${feed.name}`}
            title="Sincronizar solo este calendario"
            disabled={sincronizando}
            onClick={onSync}
          >
            <RefreshCw size={14} className={sincronizando ? "is-spinning" : undefined} />
          </button>
          {confirmar ? (
            <span className="confirm">
              <button className="btn-ghost" onClick={() => setConfirm(false)}>
                Cancelar
              </button>
              <button className="btn-danger is-solid" onClick={onDelete}>
                Sí, quitar
              </button>
            </span>
          ) : (
            <button
              className="set-row__icon is-danger"
              aria-label={`Quitar ${feed.name}`}
              title="Quitar el calendario (las tareas ya importadas se quedan)"
              onClick={() => setConfirm(true)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="feed__meta">
        <div className="chip-wrap" ref={catRef}>
          <button
            className={`chip${channel ? " is-set" : ""}`}
            aria-label={`Canal por defecto de ${feed.name}`}
            onClick={() => setAbierto((v) => !v)}
          >
            {channel ? channel.label : "sin canal"}
          </button>
          {abierto && (
            <Popover anchorRef={catRef} onClose={() => setAbierto(false)}>
              <SearchSelect
                options={channels}
                value={feed.defaultCategoryId != null ? String(feed.defaultCategoryId) : null}
                placeholder="Buscar canal…"
                clearLabel="Sin canal"
                onSelect={(v) => {
                  setAbierto(false);
                  void onSave({ defaultCategoryId: v ? Number(v) : null });
                }}
              />
            </Popover>
          )}
        </div>

        <label className="feed__poll">
          cada
          <input
            className="feed__poll-input"
            aria-label={`Minutos entre sincronizaciones de ${feed.name}`}
            value={poll}
            {...PLAIN_INPUT}
            onChange={(e) => setPoll(e.target.value)}
            onBlur={() => {
              const v = Math.max(POLL_MINIMO, Number.parseInt(poll, 10) || POLL_DEFAULT);
              setPoll(String(v));
              if (v !== feed.pollMinutes) void onSave({ pollMinutes: v });
            }}
          />
          min
        </label>

        <label className="feed__toggle">
          <input
            type="checkbox"
            checked={feed.importAsTasks}
            onChange={(e) => void onSave({ importAsTasks: e.target.checked })}
          />
          Importar como tasks
        </label>
      </div>

      <Estado feed={feed} />
    </li>
  );
}

/** Cuándo se sincronizó por última vez, o por qué falló. */
function Estado({ feed }: { feed: CalendarFeed }) {
  if (feed.lastError) {
    return (
      <span className="feed__estado is-error">
        <TriangleAlert size={12} aria-hidden /> {feed.lastError}
        {feed.lastSyncedAt && <> · se intentó {relativeTime(feed.lastSyncedAt)}</>}
      </span>
    );
  }
  if (!feed.lastSyncedAt) {
    return <span className="feed__estado">Todavía no se ha sincronizado.</span>;
  }
  if (!feed.importAsTasks) {
    return (
      <span className="feed__estado">
        Sincronizado {relativeTime(feed.lastSyncedAt)}, sin importar tareas.
      </span>
    );
  }
  return <span className="feed__estado">Sincronizado {relativeTime(feed.lastSyncedAt)}.</span>;
}
