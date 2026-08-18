import { describe, expect, it } from "vitest";
import { parseDuration } from "./capacity";

describe("parseDuration", () => {
  it("interpreta minutos sueltos", () => {
    expect(parseDuration("22")).toBe(22);
    expect(parseDuration("90")).toBe(90);
  });

  it("interpreta formato h:mm (incluido 00:mm)", () => {
    expect(parseDuration("00:22")).toBe(22);
    expect(parseDuration("0:45")).toBe(45);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("2:05")).toBe(125);
  });

  it("interpreta sufijos h/m", () => {
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("1h")).toBe(60);
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
  });

  it("rechaza entradas inválidas", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
  });
});
