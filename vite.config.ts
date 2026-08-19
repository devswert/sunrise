/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Tauri expects a fixed dev server. See https://tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  // Prevent Vite from obscuring Rust errors and set a fixed port for Tauri.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // Two windows: the main app and the always-on-top floating timer.
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        timer: resolve(__dirname, "timer.html"),
      },
    },
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // CSS apagado salvo `tokens.css`. Apagado es el default y conviene: con CSS
    // procesado, jsdom empieza a aplicar estilos y las consultas de RTL que miran
    // visibilidad cambian de resultado. La excepción existe porque `tokens.test.ts`
    // lee el archivo con `?raw`, y con CSS apagado Vitest devuelve string vacío.
    // La query va **dentro** del patrón, no es un descuido: `tokens.css` también lo
    // importa la app (`main.tsx`, `timer.tsx`), y un patrón sin `?raw` procesaría
    // esos imports en todos los tests que renderizan algo — jsdom pasaría a aplicar
    // estilos y las consultas de RTL que miran visibilidad cambiarían de resultado.
    // Anclar con `$` tampoco sirve: el id que se compara termina en la query.
    css: { include: [/tokens\.css\?raw/] },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
