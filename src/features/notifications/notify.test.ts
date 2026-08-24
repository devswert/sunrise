import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND, SHUTDOWN_NOTICE, soundFor } from "./notify";

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
 * **El aviso de la campana llega mudo, y eso viaja en la copia.** No es una decisión
 * de quien lo manda: si cada llamador la tomara, el botón de probar de Dev Tools
 * sonaría distinto al aviso real — el mismo desacuerdo que el texto ya tuvo.
 *
 * `null` y no un nombre vacío: un nombre que no existe deja el aviso mudo **por
 * accidente**, y eso es indistinguible de un typo en el sonido elegido.
 */
describe("el aviso mudo", () => {
  it("la campana avisa sin sonido; los demás con el elegido", () => {
    const campana = { title: "t", body: "b", action: "Ir a Focus", silent: true };

    // `null` y no `""`: ver el doc de `soundFor`.
    expect(soundFor(campana)).toBeNull();
    // Ni siquiera con un sonido pasado a mano — mudo es mudo.
    expect(soundFor(campana, "Submarine")).toBeNull();

    expect(soundFor({ ...campana, silent: false })).toBe(DEFAULT_SOUND);
    expect(soundFor({ ...campana, silent: false }, "Submarine")).toBe("Submarine");
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
