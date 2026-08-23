import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND, SHUTDOWN_NOTICE } from "./notify";

/**
 * Que el aviso **lleve botón y sepa a dónde va** es la única decisión de este
 * módulo que se puede sostener en jsdom: mandarlo necesita Tauri. Y es la que
 * importa: el botón es lo que hace que macOS lo trate como alerta en vez de banner,
 * y el destino es lo único que le permite llevarte a alguna parte.
 */
describe("los avisos del sistema", () => {
  // El de la próxima reunión ya no se prueba acá: su texto vive en `notice::copy`
  // (Rust), porque el que lo manda es el vigilante y no el front. Sus tests están
  // en `notice.rs`.

  it("el del cierre del día lleva al shutdown", () => {
    // Antes era un banner sin botón, con el argumento de que si te lo pierdes el
    // shutdown sigue ahí. Cierto, pero tampoco llevaba a ninguna parte: había que
    // ir a buscar la vista a mano, que es el trabajo que el aviso viene a ahorrar.
    expect(SHUTDOWN_NOTICE.action).toBe("Ir al shutdown");
    expect(SHUTDOWN_NOTICE.target?.route).toBe("/daily-shutdown");
    // Sin tarea: el shutdown es del día, no de una.
    expect(SHUTDOWN_NOTICE.target?.taskId).toBeUndefined();
  });
});

/**
 * El sonido se pide por nombre y **un nombre que no existe no suena y no falla**,
 * así que un typo acá no lo atrapa nadie en runtime. `Blow` es de los catorce que
 * trae macOS de fábrica.
 */
describe("el sonido", () => {
  it("es Blow, un sonido del sistema", () => {
    expect(DEFAULT_SOUND).toBe("Blow");
  });
});
