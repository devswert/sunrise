import { describe, expect, it } from "vitest";
import {
  SHORTCUT_ACTIONS,
  ariaKeyshortcuts,
  comboFromEvent,
  findConflict,
  formatCombo,
  matchesCombo,
  parseCombo,
  resolveShortcuts,
  shortcutKey,
} from "./shortcuts";

/** Evento de teclado mínimo, como el que llega al listener global. */
function key(
  k: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: k,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  });
}

describe("parseCombo", () => {
  it("entiende la forma canónica", () => {
    expect(parseCombo("Mod+1")).toEqual({ mod: true, shift: false, alt: false, key: "1" });
    expect(parseCombo("Mod+Shift+A")).toEqual({ mod: true, shift: true, alt: false, key: "A" });
  });

  it("normaliza mayúsculas y espacios", () => {
    expect(parseCombo(" mod + a ")).toEqual({ mod: true, shift: false, alt: false, key: "A" });
  });

  it("rechaza lo que no sirve como atajo", () => {
    expect(parseCombo(null)).toBeNull();
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("cualquier cosa")).toBeNull();
    expect(parseCombo("Mod+Enter")).toBeNull(); // solo letras y dígitos
    expect(parseCombo("Mod+Ctrl+A")).toBeNull(); // modificador desconocido
  });

  it("exige Mod: una tecla suelta chocaría con escribir", () => {
    expect(parseCombo("A")).toBeNull();
    expect(parseCombo("Shift+A")).toBeNull();
  });
});

describe("matchesCombo", () => {
  it("acepta ⌘ o Ctrl indistintamente", () => {
    expect(matchesCombo(key("1", { meta: true }), "Mod+1")).toBe(true);
    expect(matchesCombo(key("1", { ctrl: true }), "Mod+1")).toBe(true);
  });

  it("no dispara sin el modificador", () => {
    expect(matchesCombo(key("1"), "Mod+1")).toBe(false);
  });

  it("compara Shift y Alt exactos, para que ⌘⇧A no dispare ⌘A", () => {
    expect(matchesCombo(key("A", { meta: true, shift: true }), "Mod+A")).toBe(false);
    expect(matchesCombo(key("A", { meta: true, shift: true }), "Mod+Shift+A")).toBe(true);
    expect(matchesCombo(key("A", { meta: true, alt: true }), "Mod+A")).toBe(false);
  });

  it("es insensible a mayúsculas en la tecla", () => {
    expect(matchesCombo(key("a", { meta: true }), "Mod+A")).toBe(true);
  });

  it("una combinación ilegible no dispara nada", () => {
    expect(matchesCombo(key("A", { meta: true }), "basura")).toBe(false);
  });
});

describe("comboFromEvent", () => {
  it("captura la combinación pulsada", () => {
    expect(comboFromEvent(key("2", { meta: true }))).toBe("Mod+2");
    expect(comboFromEvent(key("k", { ctrl: true, shift: true }))).toBe("Mod+Shift+K");
  });

  it("ignora lo que no sirve: sin Mod, o solo modificadores", () => {
    expect(comboFromEvent(key("2"))).toBeNull();
    expect(comboFromEvent(key("Meta", { meta: true }))).toBeNull();
    expect(comboFromEvent(key("Shift", { meta: true, shift: true }))).toBeNull();
  });
});

describe("resolveShortcuts", () => {
  it("usa los de fábrica cuando no hay nada guardado", () => {
    const r = resolveShortcuts({});
    expect(r.goto_home).toBe("Mod+1");
    expect(r.goto_today).toBe("Mod+2");
    expect(r.goto_focus).toBe("Mod+3");
    expect(r.add_task).toBe("Mod+A");
  });

  it("respeta el override guardado", () => {
    const r = resolveShortcuts({ [shortcutKey("goto_home")]: "Mod+Shift+H" });
    expect(r.goto_home).toBe("Mod+Shift+H");
  });

  it("cae al de fábrica si el guardado es ilegible, en vez de dejar la acción sin atajo", () => {
    for (const basura of ["", "   ", "cmd+1", "Mod+Enter", "1"]) {
      const r = resolveShortcuts({ [shortcutKey("goto_home")]: basura });
      expect(r.goto_home).toBe("Mod+1");
    }
  });
});

describe("findConflict", () => {
  it("detecta que otra acción ya usa esa combinación", () => {
    const r = resolveShortcuts({});
    expect(findConflict(r, "Mod+2", "goto_home")?.id).toBe("goto_today");
  });

  it("no se reporta a sí misma", () => {
    const r = resolveShortcuts({});
    expect(findConflict(r, "Mod+1", "goto_home")).toBeNull();
  });

  it("una combinación libre no choca", () => {
    const r = resolveShortcuts({});
    expect(findConflict(r, "Mod+9", "goto_home")).toBeNull();
  });
});

describe("el registro", () => {
  it("no trae colisiones de fábrica", () => {
    const vistos = new Set<string>();
    for (const a of SHORTCUT_ACTIONS) {
      expect(vistos.has(a.fallback), `${a.fallback} duplicado`).toBe(false);
      vistos.add(a.fallback);
    }
  });

  it("todos los defaults son legibles", () => {
    for (const a of SHORTCUT_ACTIONS) {
      expect(parseCombo(a.fallback), a.id).not.toBeNull();
      expect(formatCombo(parseCombo(a.fallback)!)).toBe(a.fallback);
    }
  });

  it("las claves de settings siguen el patrón hotkey_<accion>", () => {
    expect(shortcutKey("add_task")).toBe("hotkey_add_task");
    expect(shortcutKey("goto_focus")).toBe("hotkey_goto_focus");
  });
});

describe("ariaKeyshortcuts", () => {
  it("emite las dos variantes, porque el atajo responde a ⌘ y a Ctrl", () => {
    expect(ariaKeyshortcuts("Mod+1")).toBe("Meta+1 Control+1");
    expect(ariaKeyshortcuts("Mod+Shift+F")).toBe("Meta+Shift+F Control+Shift+F");
  });

  it("no inventa nada si la combinación es ilegible", () => {
    expect(ariaKeyshortcuts("basura")).toBeUndefined();
  });
});
