import { describe, expect, it } from "vitest";
import { computeCapacityLevel, formatMinutes } from "./capacity";
import { CapacityLevel } from "./enums";

describe("computeCapacityLevel", () => {
  const target = 480; // 8h

  it("es OK holgadamente bajo el objetivo", () => {
    expect(computeCapacityLevel(300, target)).toBe(CapacityLevel.OK);
  });

  it("es WARN al acercarse al objetivo (>= 85%)", () => {
    expect(computeCapacityLevel(408, target)).toBe(CapacityLevel.WARN); // 85%
    expect(computeCapacityLevel(480, target)).toBe(CapacityLevel.WARN); // 100%
  });

  it("es OVER al superar el objetivo", () => {
    expect(computeCapacityLevel(481, target)).toBe(CapacityLevel.OVER);
  });

  it("sin objetivo (<=0) siempre es OK", () => {
    expect(computeCapacityLevel(999, 0)).toBe(CapacityLevel.OK);
  });
});

describe("formatMinutes", () => {
  it("formatea H:MM", () => {
    expect(formatMinutes(0)).toBe("0:00");
    expect(formatMinutes(75)).toBe("1:15");
    expect(formatMinutes(135)).toBe("2:15");
  });
});
