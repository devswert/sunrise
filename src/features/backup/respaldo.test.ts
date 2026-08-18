import { describe, expect, it } from "vitest";
import { SettingKey, backupSettings } from "../../lib/settings";
import { fechaLegible, formatoBytes, hhmm, momentoLegible, tocaRespaldar } from "./respaldo";

const HOY = "2026-08-17";

/** Los ajustes mínimos para que el respaldo esté encendido. */
const encendido = (extra: Record<string, string> = {}) => ({
  [SettingKey.BACKUP_DIR]: "/Users/leo/Drive/sunrise",
  [SettingKey.BACKUP_TIME]: "20:00",
  ...extra,
});

describe("tocaRespaldar", () => {
  it("no respalda si no hay carpeta: es el estado de fábrica, no un error", () => {
    expect(tocaRespaldar({ nowHhmm: "23:00", values: {}, hoy: HOY, esDev: false })).toBe(false);
    // Una carpeta con solo espacios es lo mismo que ninguna.
    expect(
      tocaRespaldar({ nowHhmm: "23:00", values: { [SettingKey.BACKUP_DIR]: "   " }, hoy: HOY, esDev: false }),
    ).toBe(false);
  });

  it("espera la hora configurada", () => {
    expect(tocaRespaldar({ nowHhmm: "19:59", values: encendido(), hoy: HOY, esDev: false })).toBe(false);
    expect(tocaRespaldar({ nowHhmm: "20:00", values: encendido(), hoy: HOY, esDev: false })).toBe(true);
  });

  it("una vez al día: con la fecha de hoy ya marcada, no vuelve", () => {
    const values = encendido({ [SettingKey.BACKUP_RAN_ON]: HOY });
    expect(tocaRespaldar({ nowHhmm: "21:00", values, hoy: HOY, esDev: false })).toBe(false);
  });

  /**
   * En dev no corre, y este es el corte más importante de los cuatro. Dev y
   * producción tienen bases distintas, pero `backup_dir` es una ruta en el disco:
   * si restauras un zip de producción en dev —que es el puente entre las dos—, dev
   * hereda la carpeta, empieza a escribir zips de prueba ahí y **la retención
   * borra los respaldos de verdad** para conservar los de prueba.
   */
  it("en dev no respalda, aunque esté todo configurado y pasada la hora", () => {
    expect(tocaRespaldar({ nowHhmm: "23:00", values: encendido(), hoy: HOY, esDev: true })).toBe(
      false,
    );
    // Y el mismo caso en producción sí, para que quede claro que es el perfil y no
    // otra cosa lo que lo apagó.
    expect(tocaRespaldar({ nowHhmm: "23:00", values: encendido(), hoy: HOY, esDev: false })).toBe(
      true,
    );
  });

  /**
   * El caso que justifica guardar una fecha y no un booleano: una sesión abierta
   * que cruza la medianoche tiene que volver a respaldar.
   */
  it("con la marca de ayer sí respalda hoy", () => {
    const values = encendido({ [SettingKey.BACKUP_RAN_ON]: "2026-08-16" });
    expect(tocaRespaldar({ nowHhmm: "20:00", values, hoy: HOY, esDev: false })).toBe(true);
  });

  /** Se pone al día: la app cerrada a las 20:00 y abierta a las 23:00 respalda. */
  it("respalda al abrir la app si la hora ya pasó", () => {
    expect(tocaRespaldar({ nowHhmm: "23:47", values: encendido(), hoy: HOY, esDev: false })).toBe(true);
  });

  it("una hora con basura cae al default de las 20:00, no se apaga", () => {
    const values = encendido({ [SettingKey.BACKUP_TIME]: "las ocho" });
    expect(tocaRespaldar({ nowHhmm: "19:00", values, hoy: HOY, esDev: false })).toBe(false);
    expect(tocaRespaldar({ nowHhmm: "20:01", values, hoy: HOY, esDev: false })).toBe(true);
  });
});

describe("backupSettings", () => {
  it("un `conservar` de 0 o negativo no puede significar 'borra todo'", () => {
    for (const raw of ["0", "-3", "no", ""]) {
      expect(backupSettings(encendido({ [SettingKey.BACKUP_KEEP]: raw })).conservar).toBe(2);
    }
  });

  it("redondea hacia abajo un decimal", () => {
    expect(backupSettings(encendido({ [SettingKey.BACKUP_KEEP]: "7.9" })).conservar).toBe(7);
  });
});

describe("formatoBytes", () => {
  it("cambia de unidad donde se nota la diferencia", () => {
    expect(formatoBytes(512)).toBe("512 B");
    expect(formatoBytes(920 * 1024)).toBe("920 KB");
    expect(formatoBytes(1.42 * 1024 * 1024)).toBe("1.4 MB");
  });

  it("no inventa un número con basura", () => {
    expect(formatoBytes(NaN)).toBe("—");
    expect(formatoBytes(-1)).toBe("—");
  });
});

describe("fechaLegible", () => {
  /**
   * La cadena viene sin zona (el nombre del archivo no la guarda), así que se
   * parsea a mano: `new Date()` la leería como UTC en algunos motores y un
   * respaldo de las 20:03 se mostraría a las 16:03.
   */
  it("muestra la hora tal como está escrita, sin convertir zonas", () => {
    expect(fechaLegible("2026-08-17T20:03:15")).toBe("17 ago, 20:03");
    expect(fechaLegible("2026-01-05T08:00:00")).toBe("5 ene, 08:00");
  });

  it("una fecha que no entiende se muestra tal cual, no vacía", () => {
    expect(fechaLegible("cualquier cosa")).toBe("cualquier cosa");
  });
});

describe("momentoLegible", () => {
  /**
   * Al revés que `fechaLegible`: estas cadenas **declaran su zona** (el
   * `created_at` del manifest trae offset, los `started_at` traen `Z`), así que
   * convertirlas a hora local es lo correcto.
   */
  it("convierte a hora local e incluye el año", () => {
    // Se construye desde un `Date` para no depender de la zona de quien corre
    // los tests: lo que se verifica es el formato y el round-trip.
    const d = new Date(2026, 7, 17, 20, 3, 15);
    expect(momentoLegible(d.toISOString())).toBe("17 ago 2026, 20:03");
  });

  it("una marca ilegible se muestra tal cual", () => {
    expect(momentoLegible("nunca")).toBe("nunca");
  });
});

describe("hhmm", () => {
  it("rellena con ceros para que la comparación de texto sirva", () => {
    expect(hhmm(new Date(2026, 7, 17, 9, 5))).toBe("09:05");
    expect(hhmm(new Date(2026, 7, 17, 20, 0))).toBe("20:00");
  });
});
