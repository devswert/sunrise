import { describe, expect, it } from "vitest";
import { bareName, categoryLabel, channelLabel } from "./channelLabel";

describe("channelLabel · un channel se muestra con un solo #", () => {
  it('"foo" y "#foo" se muestran como #foo', () => {
    expect(channelLabel("foo")).toBe("#foo");
    expect(channelLabel("#foo")).toBe("#foo");
    expect(channelLabel(" ##foo ")).toBe("#foo");
  });

  it("el nombre sin numeral no toca un # que no está al comienzo", () => {
    expect(bareName("#c#")).toBe("c#");
  });

  it("los contextos van sin numeral y los channels con uno", () => {
    expect(categoryLabel({ name: "#Trabajo", parentId: null })).toBe("Trabajo");
    expect(categoryLabel({ name: "#dev", parentId: 1 })).toBe("#dev");
  });
});
