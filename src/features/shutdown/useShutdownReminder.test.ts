import { describe, expect, it } from "vitest";
import { markAfter } from "./useShutdownReminder";

/**
 * Las tres salidas de `notify` tienen tres políticas distintas, y ninguna estaba
 * cubierta: `shouldRemindShutdown` decide si avisar, no qué hacer después. Si
 * las tres colapsaran en una, el modo de falla sería silencioso — un aviso que
 * falló por algo pasajero quedaría marcado como dado, y no llegaría nunca.
 */
describe("markAfter", () => {
  it("marca el día cuando el aviso salió", () => {
    expect(markAfter("sent")).toBe(true);
  });

  it("marca el día también sin permiso: reintentar cada minuto no cambia nada", () => {
    expect(markAfter("denied")).toBe(true);
  });

  it("no marca el día cuando falló, que puede ser pasajero", () => {
    expect(markAfter("failed")).toBe(false);
  });

  it("no marca el día fuera de la app, donde no hay avisos", () => {
    expect(markAfter("unavailable")).toBe(false);
  });
});
