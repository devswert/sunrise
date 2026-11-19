import { useEffect, useState } from "react";
import { isTauri } from "../../lib/ipc";

export interface Caja {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * ¿El punto cae dentro de la caja que envuelve a todas estas?
 *
 * Se usa la **envolvente**, no cada caja por separado, a propósito: entre el
 * botón de play y el panel de opciones hay 4px de separación visual, y con
 * cajas sueltas el puntero caería en tierra de nadie justo al cruzarlos. La
 * envolvente se traga ese hueco.
 *
 * Las cajas vacías (un elemento que no está en pantalla mide 0×0 en el origen)
 * se descartan: si no, arrastrarían la envolvente hasta la esquina superior
 * izquierda y medio taxímetro contaría como hover.
 */
export function insideEnvelope(x: number, y: number, cajas: Caja[]): boolean {
  const vivas = cajas.filter((c) => c.right > c.left && c.bottom > c.top);
  if (vivas.length === 0) return false;

  const left = Math.min(...vivas.map((c) => c.left));
  const right = Math.max(...vivas.map((c) => c.right));
  const top = Math.min(...vivas.map((c) => c.top));
  const bottom = Math.max(...vivas.map((c) => c.bottom));

  return x >= left && x <= right && y >= top && y <= bottom;
}

/** Cada cuánto se le pregunta al sistema dónde está el puntero. */
const INTERVALO_MS = 120;

/** El atributo con el que cada fila del taxímetro se identifica ante el sondeo. */
export const HOVER_KEY_ATTR = "data-hover-key";

/** Una fila para el hit-test: su clave y las cajas de su zona de hover. */
export interface HoverRow {
  key: string | null;
  boxes: Caja[];
}

/**
 * La clave de la fila cuya envolvente tiene el puntero, o `null`. La envolvente
 * es **por fila**: una sola sobre los botones de toda la pila se tragaría la
 * pila entera (#19).
 */
export function rowUnderCursor(x: number, y: number, rows: HoverRow[]): string | null {
  for (const row of rows) {
    if (insideEnvelope(x, y, row.boxes)) return row.key;
  }
  return null;
}

/**
 * Hover que funciona con la ventana **sin foco**, que para el taxímetro es lo
 * normal: vive encima de todo y casi nunca es la ventana activa.
 *
 * El `:hover` de CSS no sirve acá, y su modo de falla es peor que no tenerlo.
 * En macOS los eventos de mouse van a la ventana *key* (tao registra el hover
 * con el `addTrackingRect` legado, que es solo para ella), así que sin foco el
 * panel a veces se encendía y **no se apagaba nunca**: llegaba la entrada pero
 * no la salida y quedaba pegado. Por eso el `:hover` se quitó del CSS y este
 * sondeo es el único que manda — sabe prender y apagar.
 *
 * `cursorPosition()` lee la posición **global** del puntero y no depende del
 * foco. Requiere `core:window:allow-cursor-position` en las capabilities.
 *
 * Solo corre mientras hay algo que mostrar (`activo`): el webview del taxímetro
 * sigue vivo aunque la ventana esté oculta, y si no, esto sondearía para siempre
 * sin nada en pantalla.
 *
 * **Responde qué fila, no si hay hover** (#19). Con la pila de timers hay un
 * botón por fila, y una envolvente sobre todos los botones cubría la pila
 * entera: pasar por cualquier pausa abría el panel de todas las filas. Por eso
 * la envolvente se calcula **dentro de cada fila** (`rowSelector`, que llevan
 * `data-hover-key`) con los `selectores` de su zona, y se devuelve la clave de
 * la que tiene el puntero, o `null`. Sigue siendo **un** sondeo para toda la
 * pila: cada vuelta son cuatro llamadas a la ventana, y uno por fila las
 * multiplicaría.
 */
export function useCursorHover(
  active: boolean,
  rowSelector: string,
  selectores: string,
): string | null {
  const [dentro, setDentro] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !isTauri()) {
      setDentro(null);
      return;
    }

    let cancelled = false;
    let intervalo: ReturnType<typeof setInterval> | undefined;
    // Un aviso, no uno cada 120ms. Este sondeo ya falló callado una vez —
    // faltaba `core:window:allow-cursor-position` en las capabilities y el
    // `catch` se comía el rechazo, así que el hover sin foco simplemente no
    // funcionaba y no había ni una línea en la consola que lo dijera.
    let yaAvise = false;
    const notify = (err: unknown) => {
      if (yaAvise) return;
      yaAvise = true;
      console.error("[sunrise] taxímetro: no pude sondear el puntero:", err);
    };

    (async () => {
      try {
        const { cursorPosition, getCurrentWindow, primaryMonitor } = await import(
          "@tauri-apps/api/window"
        );
        const win = getCurrentWindow();
        if (cancelled) return;

        const medir = async () => {
          try {
            // Posición y escalas se re-leen cada vez en lugar de cachearse: a
            // esta ventana la mueve también Rust (al mostrarla), y cambiar de
            // monitor cambia el factor de escala. Son llamadas baratas.
            const [cursor, origen, escalaVentana, principal] = await Promise.all([
              cursorPosition(),
              win.outerPosition(),
              win.scaleFactor(),
              primaryMonitor(),
            ]);
            if (cancelled) return;

            // Las dos vienen "físicas", pero NO en la misma escala. Restarlas en
            // crudo fue el bug que dejó este sondeo sin acertar ni una vez:
            //
            //   - `cursorPosition()` multiplica por la escala del monitor
            //     PRINCIPAL (tao: `to_physical(primary_monitor().scale_factor())`).
            //   - `outerPosition()` multiplica por la de SU propia ventana
            //     (`backingScaleFactor`).
            //
            // Con un solo monitor da igual porque coinciden, y por eso pasa
            // desapercibido. Con dos de distinta densidad —un externo 1x junto
            // al Retina— quedan en unidades distintas y la resta no significa
            // nada: el puntero medía (-2845, 1446) para una zona de 118..220.
            // Cada una se pasa a lógicas con su propia escala, y recién ahí se
            // restan.
            const escalaCursor = principal?.scaleFactor ?? escalaVentana;
            const x = cursor.x / escalaCursor - origen.x / escalaVentana;
            const y = cursor.y / escalaCursor - origen.y / escalaVentana;

            const rows = Array.from(document.querySelectorAll(rowSelector)).map((el) => ({
              key: el.getAttribute(HOVER_KEY_ATTR),
              boxes: Array.from(el.querySelectorAll(selectores)).map((b) =>
                b.getBoundingClientRect(),
              ),
            }));
            const hit = rowUnderCursor(x, y, rows);
            setDentro(hit);
          } catch (err) {
            // Si el sondeo falla no dejamos el panel clavado abierto.
            if (cancelled) return;
            setDentro(null);
            notify(err);
          }
        };

        void medir();
        intervalo = setInterval(() => void medir(), INTERVALO_MS);
      } catch (err) {
        // Sin esto el taxímetro se queda sin hover del todo, porque el CSS ya no
        // tiene un `:hover` de respaldo. Que se sepa.
        notify(err);
      }
    })();

    return () => {
      cancelled = true;
      if (intervalo) clearInterval(intervalo);
    };
  }, [active, rowSelector, selectores]);

  return dentro;
}
