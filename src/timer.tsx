import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource/sora/600.css";
import "@fontsource/manrope/400.css";

import "./styles/tokens.css";
import "./styles/global.css";
import "./features/timer/timer.css";
import { FloatingTimer } from "./features/timer/FloatingTimer";
import { ExternalChanges } from "./lib/useExternalChanges";
import { applyTheme, resolveInitialTheme } from "./lib/theme";
import { followFonts } from "./lib/fonts";

// Comparte el tema con la ventana principal (y lo sigue si cambia allí).
applyTheme(resolveInitialTheme());
window.addEventListener("storage", (e) => {
  if (e.key === "sunrise-theme") applyTheme(resolveInitialTheme());
});
// Y la tipografía, por la misma vía y por la misma razón: esta ventana no monta el
// store de ajustes, y una app en la fuente del sistema con el taxímetro en Sora se
// ve partida.
followFonts();

ReactDOM.createRoot(document.getElementById("timer-root") as HTMLElement).render(
  <React.StrictMode>
    {/* Lo que escribe el MCP desde otro proceso (§4.32): sin esto, un timer que
     * Claude abre o cierra no llega al taxímetro, que tiene su propio store. */}
    <ExternalChanges />
    <FloatingTimer />
  </React.StrictMode>,
);
