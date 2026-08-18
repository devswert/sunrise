import { describe, expect, it } from "vitest";
import { hms, isOverEstimate } from "./useTimer";
import { runSeconds } from "./timerStore";

describe("isOverEstimate", () => {
  it("es falso mientras no se alcance el estimado", () => {
    expect(isOverEstimate(29 * 60, 30)).toBe(false);
  });

  it("es verdadero al alcanzar exactamente el estimado (dispara la campana)", () => {
    expect(isOverEstimate(30 * 60, 30)).toBe(true);
  });

  it("sigue verdadero al pasarse (la tarea no se cierra sola)", () => {
    expect(isOverEstimate(90 * 60, 30)).toBe(true);
  });

  it("sin estimado nunca se considera excedido", () => {
    expect(isOverEstimate(9999, null)).toBe(false);
    expect(isOverEstimate(9999, undefined)).toBe(false);
    expect(isOverEstimate(9999, 0)).toBe(false);
  });
});

describe("hms", () => {
  it("formatea H:MM:SS", () => {
    expect(hms(0)).toBe("0:00:00");
    expect(hms(62)).toBe("0:01:02");
    expect(hms(3725)).toBe("1:02:05");
  });

  it("pone el signo una sola vez y adelante", () => {
    // Con `Math.floor` y `%` sobre un negativo cada componente salía negativo
    // por su cuenta y el taxímetro mostraba "-14:-17:-39" para -47799s, que
    // además de ilegible no es la hora que representa.
    expect(hms(-47799)).toBe("-13:16:39");
    expect(hms(-62)).toBe("-0:01:02");
  });
});

describe("runSeconds", () => {
  /** Un momento cualquiera de hoy, en hora local. */
  function hoyALas(h: number, m = 0): number {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  it("cuenta desde el inicio cuando la corrida empezó hoy", () => {
    const ahora = hoyALas(10);
    const start = new Date(hoyALas(9, 30)).toISOString();
    expect(runSeconds(start, ahora)).toBe(1800);
  });

  it("cuenta solo desde la medianoche si la corrida viene de ayer", () => {
    // El caso real: el timer quedó abierto toda la noche y a las 9 de la mañana
    // el taxímetro mostraba 15 horas. `base_seconds` es lo cerrado de HOY, así
    // que lo corrido tiene que medirse con la misma regla.
    const ahora = hoyALas(9);
    const anoche = new Date(hoyALas(0) - 2 * 3600 * 1000).toISOString();
    expect(runSeconds(anoche, ahora)).toBe(9 * 3600);
  });

  it("no devuelve negativos si el inicio quedó en el futuro", () => {
    const ahora = hoyALas(10);
    const futuro = new Date(hoyALas(11)).toISOString();
    expect(runSeconds(futuro, ahora)).toBe(0);
  });

  it("con un timestamp ilegible devuelve 0 en vez de NaN", () => {
    expect(runSeconds("no es una fecha", hoyALas(10))).toBe(0);
  });
});
