/**
 * La tipografía de la app, y **cómo llega a las dos ventanas**.
 *
 * Son dos ajustes y no uno —`font_title` y `font_body`—, porque son dos roles: los
 * títulos aguantan una fuente con carácter y el cuerpo necesita una que se lea en 12
 * px. De fábrica, Sora y Manrope.
 *
 * Cada uno guarda un centinela (`SUNRISE` / `SYSTEM`) o **el nombre de una familia
 * instalada**, que enumera Rust con Core Text (`fonts.rs`).
 *
 * El valor vive en `settings`, o sea en la base, que es donde va un ajuste. Pero el
 * taxímetro es otra ventana con su propio documento y **no monta el store de
 * ajustes**: es una ventana chica que solo muestra el timer. Si dependiera de la base
 * habría que darle store, invalidación y todo el aparato para leer dos claves.
 *
 * Así que se hace lo mismo que el tema, que tiene exactamente el mismo problema: la
 * ventana principal manda y **espeja los valores en `localStorage`**, y el taxímetro
 * los aplica al arrancar y sigue el evento `storage`. La base sigue siendo la fuente
 * de verdad; el espejo es solo el canal entre ventanas.
 *
 * Se aplica sobreescribiendo los **tokens** en `<html>` y no tocando componentes:
 * `--font-title` y `--font-body` ya los usa todo el CSS, así que un solo lugar cambia
 * la app entera.
 */
import { useEffect } from "react";
import { FontChoice } from "./enums";
import { SettingKey, fontChoice, useSettingsStore } from "./settings";

const STORAGE_KEY = { title: "sunrise-font-title", body: "sunrise-font-body" } as const;

/**
 * La pila de respaldo, que va **detrás de cualquier elección**.
 *
 * No es decoración: una familia que se desinstala deja de resolver y sin la pila la
 * app se quedaría con la fuente por defecto del webview, que en macOS es una serif.
 * Un cambio de tipografía no puede convertirse en "la app se ve rota".
 */
const FALLBACK = "ui-sans-serif, system-ui, -apple-system, sans-serif";

/** El `font-family` de CSS para una elección. `null` = dejar el token como está. */
export function cssStack(choice: string): string | null {
  if (choice === FontChoice.SUNRISE) return null;
  // Sin nombrar familia: `system-ui` ya es "la del sistema", y es la única forma de
  // pedirla que sigue funcionando si Apple le cambia el nombre.
  if (choice === FontChoice.SYSTEM) return FALLBACK;
  // Entre comillas: los nombres de familia traen espacios (`Helvetica Neue`).
  return `"${choice}", ${FALLBACK}`;
}

/** Los valores espejados, o los de fábrica. Los usa el taxímetro al arrancar. */
export function storedFonts(): { title: string; body: string } {
  try {
    return {
      title: localStorage.getItem(STORAGE_KEY.title) || FontChoice.SUNRISE,
      body: localStorage.getItem(STORAGE_KEY.body) || FontChoice.SUNRISE,
    };
  } catch {
    return { title: FontChoice.SUNRISE, body: FontChoice.SUNRISE };
  }
}

/**
 * Estampa las tipografías en `<html>` y las espeja para la otra ventana.
 *
 * Con `SUNRISE` **borra** la propiedad en vez de escribir la fuente: así el valor
 * vuelve a salir de `tokens.css`, que es donde está declarado. Escribirla a mano
 * dejaría dos lugares diciendo cuál es la fuente de la app.
 */
export function applyFonts(fonts: { title: string; body: string }) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  for (const rol of ["title", "body"] as const) {
    const stack = cssStack(fonts[rol]);
    if (stack) el.style.setProperty(`--font-${rol}`, stack);
    else el.style.removeProperty(`--font-${rol}`);
    try {
      localStorage.setItem(STORAGE_KEY[rol], fonts[rol]);
    } catch {
      /* modo privado o cuota: la ventana principal igual quedó bien */
    }
  }
}

/** Aplica las tipografías guardadas, y las vuelve a aplicar cuando cambian. */
export function useFontRuntime() {
  const values = useSettingsStore((s) => s.values);
  const title = fontChoice(values, SettingKey.FONT_TITLE);
  const body = fontChoice(values, SettingKey.FONT_BODY);
  useEffect(() => {
    applyFonts({ title, body });
  }, [title, body]);
}

/**
 * Sigue lo que eligió la ventana principal. Para el taxímetro, que no tiene store.
 *
 * `storage` **no** se dispara en la ventana que escribió, así que no hay eco.
 */
export function followFonts() {
  applyFonts(storedFonts());
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY.title || e.key === STORAGE_KEY.body) {
      applyFonts(storedFonts());
    }
  });
}
