import { describe, expect, it } from "vitest";
import { DEFAULT_SOUND, SHUTDOWN_NOTICE, nextTaskNotice } from "./notify";

/**
 * **Cuál de los dos avisos es alerta** es la única decisión de este módulo que se
 * puede sostener en jsdom: mandarlos necesita Tauri. Y es la que importa, porque
 * el `action` no es decoración — es lo que hace que macOS deje el aviso pegado en
 * pantalla en vez de pasarlo como banner.
 */
describe("los avisos del sistema", () => {
  it("el de la próxima tarea es una alerta: lleva botón", () => {
    const notice = nextTaskNotice("Weekly de equipo", 5);
    expect(notice.action).toBe("Ir a Focus");
    expect(notice.title).toBe("En 5 min: Weekly de equipo");
  });

  it("el del cierre del día no lleva botón, y está bien", () => {
    // Si te lo pierdes, el shutdown sigue ahí. La reunión, no.
    expect(SHUTDOWN_NOTICE.action).toBeUndefined();
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
