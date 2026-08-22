import { describe, expect, it } from "vitest";
import { SettingKey, backupSettings } from "../../lib/settings";
import { readableDate, formatBytes, readableMoment } from "./backup";

/** Los ajustes mínimos para que el respaldo esté encendido. */
const encendido = (extra: Record<string, string> = {}) => ({
  [SettingKey.BACKUP_DIR]: "/Users/leo/Drive/sunrise",
  [SettingKey.BACKUP_TIME]: "20:00",
  ...extra,
});

describe("backupSettings", () => {
  it("un `conservar` de 0 o negativo no puede significar 'borra todo'", () => {
    for (const raw of ["0", "-3", "no", ""]) {
      expect(backupSettings(encendido({ [SettingKey.BACKUP_KEEP]: raw })).keep).toBe(2);
    }
  });

  it("redondea hacia abajo un decimal", () => {
    expect(backupSettings(encendido({ [SettingKey.BACKUP_KEEP]: "7.9" })).keep).toBe(7);
  });
});

describe("formatoBytes", () => {
  it("cambia de unidad donde se nota la diferencia", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(920 * 1024)).toBe("920 KB");
    expect(formatBytes(1.42 * 1024 * 1024)).toBe("1.4 MB");
  });

  it("no inventa un número con basura", () => {
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("fechaLegible", () => {
  /**
   * La cadena viene sin zona (el nombre del archivo no la guarda), así que se
   * parsea a mano: `new Date()` la leería como UTC en algunos motores y un
   * respaldo de las 20:03 se mostraría a las 16:03.
   */
  it("muestra la hora tal como está escrita, sin convertir zonas", () => {
    expect(readableDate("2026-08-17T20:03:15")).toBe("17 ago, 20:03");
    expect(readableDate("2026-01-05T08:00:00")).toBe("5 ene, 08:00");
  });

  it("una fecha que no entiende se muestra tal cual, no vacía", () => {
    expect(readableDate("cualquier cosa")).toBe("cualquier cosa");
  });
});

describe("momentoLegible", () => {
  /**
   * Al revés que `readableDate`: estas cadenas **declaran su zona** (el
   * `created_at` del manifest trae offset, los `started_at` traen `Z`), así que
   * convertirlas a hora local es lo correcto.
   */
  it("convierte a hora local e incluye el año", () => {
    // Se construye desde un `Date` para no depender de la zona de quien corre
    // los tests: lo que se verifica es el formato y el round-trip.
    const d = new Date(2026, 7, 17, 20, 3, 15);
    expect(readableMoment(d.toISOString())).toBe("17 ago 2026, 20:03");
  });

  it("una marca ilegible se muestra tal cual", () => {
    expect(readableMoment("nunca")).toBe("nunca");
  });
});

