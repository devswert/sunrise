import { useEffect, useRef, useState } from "react";
import { Bell, Play, Type, Upload } from "lucide-react";
import { api, isTauri } from "../../lib/ipc";
import { FontChoice, SUNRISE_BELL } from "../../lib/enums";
import { SettingKey, bellSound, fontChoice, useSettingsStore } from "../../lib/settings";
import { Popover } from "../../components/Popover";
import { SearchSelect } from "../../components/SearchSelect";
import { Spinner } from "../../components/Spinner";
import { sectionIcon } from "../settings/secciones";

const SectionIcon = sectionIcon("apariencia");

/**
 * Las extensiones que ofrece el diálogo. **Espeja `AUDIO_EXTS` de `sound.rs`**, que
 * es quien decodifica: filtrar por menos esconde formatos que sí funcionan, y por
 * más deja elegir uno que va a ser rechazado al copiarlo.
 */
const AUDIO_EXTS = ["wav", "mp3", "ogg", "flac", "m4a"];

/** Abre el selector nativo. `null` si cancelan o si no estamos en la app. */
async function elegirAudio(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const elegido = await open({
    multiple: false,
    title: "Elegir la campana",
    filters: [{ name: "Audio", extensions: AUDIO_EXTS }],
  });
  return typeof elegido === "string" ? elegido : null;
}

/**
 * Cómo se ve y cómo suena sunrise: la campana del taxímetro y la tipografía.
 *
 * **Son dos cosas y una sección**, y la razón es que ninguna de las dos es un ajuste
 * de comportamiento: no cambian qué hace la app ni cuándo, solo cómo se presenta. El
 * sonido de los *avisos* no está acá sino en Notificaciones, y eso no es una
 * inconsistencia: ese sonido es parte de un aviso que se puede apagar, y esta campana
 * suena siempre que corras un timer.
 */
export function AppearanceCard() {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const [error, setError] = useState<string | null>(null);
  const [instalando, setInstalando] = useState(false);
  const [familias, setFamilias] = useState<string[]>([]);

  useEffect(() => {
    void api.systemFonts().then(setFamilias);
  }, []);

  const campana = bellSound(values);
  const propia = campana !== SUNRISE_BELL;
  const outsideApp = !isTauri();

  async function elegirCampana() {
    setError(null);
    const path = await elegirAudio();
    if (path == null) return;
    setInstalando(true);
    try {
      // Rust copia el archivo y **devuelve su nombre**; recién con eso se guarda el
      // ajuste. Si falla —un audio que no se puede decodificar— el ajuste no se
      // toca, así que la campana que sonaba sigue sonando.
      const nombre = await api.installBellFile(path);
      await setSetting(SettingKey.BELL_SOUND, nombre);
    } catch (err) {
      setError(String(err));
    } finally {
      setInstalando(false);
    }
  }

  async function volverALaDeSunrise() {
    setError(null);
    // El ajuste primero: si el borrado falla, lo peor que pasa es que quede una copia
    // huérfana. Al revés —borrar y que falle el ajuste— la campana apuntaría a un
    // archivo que ya no está, y sonaría la síntesis sin que la card lo diga.
    await setSetting(SettingKey.BELL_SOUND, SUNRISE_BELL);
    try {
      await api.clearBellFile();
    } catch (err) {
      console.error("[sunrise] no pude borrar la copia de la campana", err);
    }
  }

  return (
    <section className="set-card" id="set-apariencia" data-section="apariencia">
      <header className="set-card__head">
        <h2>
          <SectionIcon size={16} aria-hidden /> Apariencia
        </h2>
        <p>Cómo se ve y cómo suena sunrise.</p>
      </header>

      <div className="set-field">
        <div className="set-field__row">
          <span className="set-field__label">Campana del taxímetro</span>
          <div className="upd-acciones">
            <button
              type="button"
              className="resp-btn"
              disabled={outsideApp}
              onClick={() => void api.playBell()}
            >
              <Play size={13} aria-hidden />
              <span className="resp-btn__texto">Probar</span>
            </button>
            <button
              type="button"
              className="resp-btn"
              disabled={outsideApp || instalando}
              aria-busy={instalando}
              onClick={() => void elegirCampana()}
            >
              {instalando ? <Spinner size={13} /> : <Upload size={13} aria-hidden />}
              <span className="resp-btn__texto">
                {instalando ? "Instalando…" : "Elegir un audio"}
              </span>
            </button>
            {propia && (
              <button
                type="button"
                className="resp-btn"
                onClick={() => void volverALaDeSunrise()}
              >
                <Bell size={13} aria-hidden />
                <span className="resp-btn__texto">Volver a la de sunrise</span>
              </button>
            )}
          </div>
        </div>
        <span className={`set-note${error ? " is-error" : ""}`}>
          {error
            ? error
            : propia
              ? `Suena ${campana}, que la app copió a su carpeta. Pruébala: si el archivo se borró por fuera, vas a oír la de sunrise. Volver a la de sunrise descarta la copia — tu archivo original queda donde está.`
              : "Suena la campana de sunrise, sintetizada. Puedes elegir un audio propio y la app se queda con una copia."}
        </span>
      </div>

      <FontPicker
        rol="title"
        etiqueta="Tipografía de los títulos"
        deFabrica="Sora"
        clave={SettingKey.FONT_TITLE}
        familias={familias}
      />
      <FontPicker
        rol="body"
        etiqueta="Tipografía de los textos"
        deFabrica="Manrope"
        clave={SettingKey.FONT_BODY}
        familias={familias}
      />
    </section>
  );
}

/**
 * Un selector de tipografía: las de sunrise, la del sistema, y las instaladas.
 *
 * Con búsqueda y no una lista desplegable pelada, porque son ~180 familias: un
 * `<select>` con eso adentro es una lista que se recorre a mano.
 *
 * `deFabrica` se muestra al lado de "La de sunrise" y no se calcula: los nombres
 * están en `tokens.css` y desde acá no hay forma de leerlos sin resolver estilos.
 * Si alguna cambia allá, cambia acá.
 */
function FontPicker({
  rol,
  etiqueta,
  deFabrica,
  clave,
  familias,
}: {
  rol: "title" | "body";
  etiqueta: string;
  deFabrica: string;
  clave: typeof SettingKey.FONT_TITLE | typeof SettingKey.FONT_BODY;
  familias: string[];
}) {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLDivElement>(null);

  const elegida = fontChoice(values, clave);
  const opciones = [
    { value: FontChoice.SUNRISE, label: `${deFabrica} — la de sunrise` },
    { value: FontChoice.SYSTEM, label: "La que use el sistema" },
    ...familias.map((f) => ({ value: f, label: f })),
  ];
  const rotulo = opciones.find((o) => o.value === elegida)?.label ?? elegida;

  return (
    <div className="set-field">
      <div className="set-field__row">
        <span className="set-field__label">{etiqueta}</span>
        <div className="chip-wrap" ref={ancla}>
          <button
            className="chip is-set"
            aria-label={`Elegir la ${etiqueta.toLowerCase()}`}
            onClick={() => setAbierto((v) => !v)}
          >
            <Type size={12} aria-hidden /> {rotulo}
          </button>
          {abierto && (
            <Popover anchorRef={ancla} align="right" onClose={() => setAbierto(false)}>
              <SearchSelect
                options={opciones}
                value={elegida}
                placeholder="Buscar tipografía…"
                onSelect={(v) => {
                  void setSetting(clave, v ?? FontChoice.SUNRISE);
                  setAbierto(false);
                }}
              />
            </Popover>
          )}
        </div>
      </div>
      {/* La muestra usa la fuente elegida: es lo único que responde "¿cómo se ve?"
          sin tener que cerrar Configs. Y va con el tamaño de su rol. */}
      <span
        className="set-note"
        style={{
          fontFamily: `var(--font-${rol})`,
          fontSize: rol === "title" ? 17 : 13,
        }}
      >
        Lunes 7 — revisar la semana y cerrar el día.
      </span>
    </div>
  );
}
