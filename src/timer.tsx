import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource/sora/600.css";
import "@fontsource/manrope/400.css";

import "./styles/tokens.css";
import "./styles/global.css";
import "./features/timer/timer.css";
import { FloatingTimer } from "./features/timer/FloatingTimer";
import { applyTheme, resolveInitialTheme } from "./lib/theme";

// Comparte el tema con la ventana principal (y lo sigue si cambia allí).
applyTheme(resolveInitialTheme());
window.addEventListener("storage", (e) => {
  if (e.key === "sunrise-theme") applyTheme(resolveInitialTheme());
});

ReactDOM.createRoot(
  document.getElementById("timer-root") as HTMLElement,
).render(
  <React.StrictMode>
    <FloatingTimer />
  </React.StrictMode>,
);
