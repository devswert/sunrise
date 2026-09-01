import { describe, expect, it } from "vitest";
import {
  SETTING_DEFAULTS,
  SettingKey,
  capacityWarnRatio,
  collapsedWeekdays,
  dailyCapacityMinutes,
  noticeMeetingMinutes,
  noticeSound,
  noticeOn,
  planMark,
  workHours,
  timezone,
} from "./settings";
import { computeCapacityLevel } from "./capacity";
import { CapacityLevel } from "./enums";

/**
 * Los ajustes son TEXT en SQLite y pueden faltar, venir vacíos o traer basura
 * editada a mano. Si un parser devolviera `NaN`, el semáforo de capacidad se
 * quedaría en OK para siempre —todas las comparaciones con `NaN` dan false— sin
 * ningún error visible. De ahí que estos casos sean el corazón del módulo.
 */

describe("dailyCapacityMinutes", () => {
  it("lee el valor guardado", () => {
    expect(dailyCapacityMinutes({ [SettingKey.DAILY_CAPACITY_MINUTES]: "300" })).toBe(300);
  });

  it("cae al default si la clave falta", () => {
    expect(dailyCapacityMinutes({})).toBe(SETTING_DEFAULTS.dailyCapacityMinutes);
  });

  it("cae al default con valores vacíos o no numéricos", () => {
    for (const raw of ["", "   ", "ocho horas", "8h", "NaN"]) {
      expect(dailyCapacityMinutes({ [SettingKey.DAILY_CAPACITY_MINUTES]: raw })).toBe(
        SETTING_DEFAULTS.dailyCapacityMinutes,
      );
    }
  });

  it("respeta 0 como 'sin objetivo'", () => {
    expect(dailyCapacityMinutes({ [SettingKey.DAILY_CAPACITY_MINUTES]: "0" })).toBe(0);
  });
});

describe("capacityWarnRatio", () => {
  it("lee el valor guardado", () => {
    expect(capacityWarnRatio({ [SettingKey.CAPACITY_WARN_RATIO]: "0.5" })).toBe(0.5);
  });

  it("cae al default si falta o no es numérico", () => {
    expect(capacityWarnRatio({})).toBe(SETTING_DEFAULTS.capacityWarnRatio);
    expect(capacityWarnRatio({ [SettingKey.CAPACITY_WARN_RATIO]: "casi" })).toBe(
      SETTING_DEFAULTS.capacityWarnRatio,
    );
  });

  it("descarta valores fuera de (0, 1], donde el semáforo no tendría sentido", () => {
    // Con 0 todo sería WARN; con 2 nunca lo sería.
    for (const raw of ["0", "-1", "2", "100"]) {
      expect(capacityWarnRatio({ [SettingKey.CAPACITY_WARN_RATIO]: raw })).toBe(
        SETTING_DEFAULTS.capacityWarnRatio,
      );
    }
    expect(capacityWarnRatio({ [SettingKey.CAPACITY_WARN_RATIO]: "1" })).toBe(1);
  });
});

describe("workHours", () => {
  it("lee la jornada guardada", () => {
    expect(
      workHours({
        [SettingKey.WORK_START]: "08:30",
        [SettingKey.WORK_END]: "17:00",
      }),
    ).toEqual({ start: "08:30", end: "17:00" });
  });

  it("cae al default si falta o no es una hora", () => {
    expect(workHours({})).toEqual({
      start: SETTING_DEFAULTS.workStart,
      end: SETTING_DEFAULTS.workEnd,
    });
    expect(workHours({ [SettingKey.WORK_START]: "temprano" }).start).toBe(
      SETTING_DEFAULTS.workStart,
    );
    expect(workHours({ [SettingKey.WORK_END]: "25:00" }).end).toBe(SETTING_DEFAULTS.workEnd);
  });

  it("una jornada invertida vuelve al default: si no, el rail sale de altura cero", () => {
    expect(
      workHours({
        [SettingKey.WORK_START]: "18:00",
        [SettingKey.WORK_END]: "09:00",
      }),
    ).toEqual({
      start: SETTING_DEFAULTS.workStart,
      end: SETTING_DEFAULTS.workEnd,
    });
  });
});

/**
 * El único parser del módulo donde **clave ausente y valor vacío no significan
 * lo mismo**. Si los dos cayeran al default, destildar los siete días en Configs
 * rebotaría a sábado y domingo y la semana completa sería inexpresable.
 */
describe("collapsedWeekdays", () => {
  it("sin la clave, el fin de semana", () => {
    expect(collapsedWeekdays({})).toEqual([6, 7]);
  });

  it("vacío significa ninguno, y NO el default", () => {
    expect(collapsedWeekdays({ [SettingKey.COLLAPSED_WEEKDAYS]: "" })).toEqual([]);
    expect(collapsedWeekdays({ [SettingKey.COLLAPSED_WEEKDAYS]: "   " })).toEqual([]);
  });

  it("lee la lista guardada, ordenada y sin repetidos", () => {
    expect(collapsedWeekdays({ [SettingKey.COLLAPSED_WEEKDAYS]: "7, 3 ,3" })).toEqual([3, 7]);
  });

  it("descarta lo que no entiende sin volver al default", () => {
    // Un valor editado a mano pliega lo que se pudo leer y no promete nada más.
    expect(collapsedWeekdays({ [SettingKey.COLLAPSED_WEEKDAYS]: "6,ocho,0,9,-2,3.5" })).toEqual([
      6,
    ]);
  });
});

/**
 * La marca del ritual diario. Guarda fecha y hora locales porque la versión con
 * la fecha pelada hacía una afirmación que no se podía desmentir: un ritual
 * cerrado a las 00:20 marcaba el día que recién empezaba y el aviso no tenía con
 * qué decirlo.
 */
describe("planMark", () => {
  const marca = (raw: string) => planMark({ [SettingKey.PLANNED_AT]: raw });

  it("sin la clave no hay marca", () => {
    expect(planMark({})).toBeNull();
  });

  it("vacío tampoco: es cómo se borra la marca desde el aviso", () => {
    expect(marca("")).toBeNull();
    expect(marca("   ")).toBeNull();
  });

  it("lee la fecha y la hora de la marca", () => {
    expect(marca("2026-08-21T00:20")).toEqual({ date: "2026-08-21", time: "00:20" });
  });

  it("una fecha pelada vale como ese día, sin inventarle hora", () => {
    // Es lo que guardaba la versión anterior y lo que puede dejar una edición a
    // mano. La hora en `null` es lo que el aviso muestra como "no dice a qué hora".
    expect(marca("2026-08-21")).toEqual({ date: "2026-08-21", time: null });
  });

  it("la fecha no pasa por `new Date()`: el día es el que dice el string", () => {
    // `new Date("2026-08-21")` es medianoche **UTC**, que en Santiago es el día
    // anterior a las 20:00. Ese es el error que esta marca viene a arreglar, así
    // que la lectura no puede reintroducirlo.
    expect(marca("2026-08-21")?.date).toBe("2026-08-21");
    expect(marca("2026-08-21T23:59")?.date).toBe("2026-08-21");
  });

  it("descarta la hora que no entiende y se queda con el día", () => {
    expect(marca("2026-08-21T99:99")).toEqual({ date: "2026-08-21", time: null });
    expect(marca("2026-08-21Tayer")).toEqual({ date: "2026-08-21", time: null });
  });

  it("sin una fecha reconocible no hay marca", () => {
    expect(marca("ayer")).toBeNull();
    expect(marca("21-08-2026")).toBeNull();
  });
});

describe("el semáforo con ajustes rotos", () => {
  it("no se queda mudo: un valor basura usa el default en vez de NaN", () => {
    const values = {
      [SettingKey.DAILY_CAPACITY_MINUTES]: "ocho",
      [SettingKey.CAPACITY_WARN_RATIO]: "mucho",
    };
    const target = dailyCapacityMinutes(values);
    const ratio = capacityWarnRatio(values);

    // Con NaN esto daría OK y el semáforo nunca se encendería.
    expect(computeCapacityLevel(600, target, ratio)).toBe(CapacityLevel.OVER);
    expect(computeCapacityLevel(420, target, ratio)).toBe(CapacityLevel.WARN);
    expect(computeCapacityLevel(60, target, ratio)).toBe(CapacityLevel.OK);
  });

  it("el umbral configurado sí cambia el semáforo", () => {
    const values = {
      [SettingKey.DAILY_CAPACITY_MINUTES]: "480",
      [SettingKey.CAPACITY_WARN_RATIO]: "0.5",
    };
    const target = dailyCapacityMinutes(values);
    const ratio = capacityWarnRatio(values);

    // 300/480 = 62%: con el default (85%) sería OK; con 50% es WARN.
    expect(computeCapacityLevel(300, target)).toBe(CapacityLevel.OK);
    expect(computeCapacityLevel(300, target, ratio)).toBe(CapacityLevel.WARN);
  });
});

describe("useSettingsStore · round-trip por ipc/mockDb", () => {
  it("carga los valores sembrados y persiste los cambios", async () => {
    const { useSettingsStore } = await import("./settings");

    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().loaded).toBe(true);
    // La semilla del mock espeja la de la migración 2.
    expect(dailyCapacityMinutes(useSettingsStore.getState().values)).toBe(480);

    await useSettingsStore.getState().set(SettingKey.DAILY_CAPACITY_MINUTES, "300");
    expect(dailyCapacityMinutes(useSettingsStore.getState().values)).toBe(300);

    // Y sobrevive a una recarga: quedó escrito, no solo en memoria del store.
    useSettingsStore.setState({ values: {}, loaded: false });
    await useSettingsStore.getState().load();
    expect(dailyCapacityMinutes(useSettingsStore.getState().values)).toBe(300);
  });
});

/**
 * Los ajustes de Notificaciones. **Una clave ausente es encendida**, y eso no es
 * un default cualquiera: los tres avisos ya andaban antes de que hubiera dónde
 * apagarlos, así que leer "falta la clave" como apagado los habría silenciado a
 * todos en la actualización que trajo la sección.
 */
describe("avisos", () => {
  it("el del cierre viene encendido: ya andaba antes de que hubiera dónde apagarlo", () => {
    expect(noticeOn({}, SettingKey.NOTICE_SHUTDOWN)).toBe(true);
    expect(noticeOn({ [SettingKey.NOTICE_SHUTDOWN]: "0" }, SettingKey.NOTICE_SHUTDOWN)).toBe(false);
  });

  it("la notificación de la campana viene apagada: es opt-in por la decisión de M2", () => {
    expect(noticeOn({}, SettingKey.NOTICE_BELL)).toBe(false);
    expect(noticeOn({ [SettingKey.NOTICE_BELL]: "1" }, SettingKey.NOTICE_BELL)).toBe(true);
  });

  it("un valor que no se entiende cae en el default de su clave, no en uno solo", () => {
    // Con basura, inventar una decisión es peor que quedarse en lo de fábrica — y
    // "lo de fábrica" no es lo mismo para los dos.
    for (const raw of ["", "sí", "true"]) {
      expect(noticeOn({ [SettingKey.NOTICE_SHUTDOWN]: raw }, SettingKey.NOTICE_SHUTDOWN)).toBe(
        true,
      );
      expect(noticeOn({ [SettingKey.NOTICE_BELL]: raw }, SettingKey.NOTICE_BELL)).toBe(false);
    }
  });

  it("los minutos del aviso de reunión caen al default y 0 es apagado", () => {
    expect(noticeMeetingMinutes({})).toBe(5);
    expect(noticeMeetingMinutes({ [SettingKey.NOTICE_MEETING_MINUTES]: "basura" })).toBe(5);
    expect(noticeMeetingMinutes({ [SettingKey.NOTICE_MEETING_MINUTES]: "10" })).toBe(10);
    expect(noticeMeetingMinutes({ [SettingKey.NOTICE_MEETING_MINUTES]: "0" })).toBe(0);
    // Un negativo es "apagado", no "avisar después de que empezó".
    expect(noticeMeetingMinutes({ [SettingKey.NOTICE_MEETING_MINUTES]: "-3" })).toBe(0);
  });

  it("el sonido cae al de la app si no hay nada útil guardado", () => {
    // Importa más que los otros parsers: un nombre que no existe **no suena y no
    // falla**, así que dejar pasar un vacío deja los avisos mudos sin síntoma.
    expect(noticeSound({})).toBe("Blow");
    expect(noticeSound({ [SettingKey.NOTICE_SOUND]: "" })).toBe("Blow");
    expect(noticeSound({ [SettingKey.NOTICE_SOUND]: "   " })).toBe("Blow");
    expect(noticeSound({ [SettingKey.NOTICE_SOUND]: " Submarine " })).toBe("Submarine");
  });
});

describe("la zona horaria", () => {
  const leer = (raw: string) => timezone({ [SettingKey.TIMEZONE]: raw });

  it("acepta un nombre IANA que la plataforma conoce", () => {
    expect(leer("America/Santiago")).toBe("America/Santiago");
    expect(leer("  Asia/Tokyo  ")).toBe("Asia/Tokyo");
  });

  it("la clave ausente o vacía significa «la del sistema»", () => {
    expect(timezone({})).toBeNull();
    expect(leer("")).toBeNull();
    expect(leer("   ")).toBeNull();
  });

  it("un valor que no es una zona cae a la del sistema en vez de romper", () => {
    // El ajuste se puede editar a mano (es una fila de `settings`), y una zona
    // ilegible no debe dejar la app sin «hoy».
    expect(leer("No/Existe")).toBeNull();
    expect(leer("<script>")).toBeNull();
    // Un desplazamiento fijo lo acepta `Intl` pero **no** `chrono_tz`, y si el
    // front lo tomara los dos lados agruparían el día distinto. Se rechaza acá.
    expect(leer("-04:00")).toBeNull();
    // `UTC` es la única sin barra que sí vale, y vale en los dos lados.
    expect(leer("UTC")).toBe("UTC");
  });
});
