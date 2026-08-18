import React from "react";
import ReactDOM from "react-dom/client";

// Fuentes auto-hospedadas (sin CDN): Sora para títulos, Manrope para cuerpo.
import "@fontsource/sora/400.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";

import "./styles/tokens.css";
import "./styles/global.css";
import App from "./App";
import { applyTheme, resolveInitialTheme } from "./lib/theme";

// Aplica el tema antes del render para evitar flash.
applyTheme(resolveInitialTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
