/**
 * El contrato del puente IPC, leído de los archivos y no de los tipos.
 *
 * Hay dos formas de romper una llamada a Rust que **ningún compilador y ninguna
 * de las dos suites detecta**, porque a los dos lados el nombre es un string:
 *
 * 1. **La clave del `invoke` no es el parámetro de Rust en camelCase.** Tauri
 *    rechaza la llamada completa, así que la vista no recibe datos parciales:
 *    recibe una promesa rechazada. Fue el bug de `daily_log`, que mandaba `to`
 *    contra un `to_date`, y las dos suites quedaron verdes porque **corren contra
 *    `mockDb`, que recibe posicional** — el mock no puede estar en desacuerdo con
 *    el front.
 * 2. **El comando no está en el `invoke_handler![]` de `lib.rs`.** Compila igual
 *    y falla en runtime.
 *
 * Los dos aparecieron después de un renombre, y por eso el test lee los archivos
 * de Rust en crudo: es el único chequeo que compara los **dos** lados.
 */
import { describe, expect, it } from "vitest";
// `?raw` mete el archivo entero como string, igual que `changelog.ts` con el
// CHANGELOG. Es lo que permite leer los dos lados del puente sin `@types/node`.
import commandsRs from "../../src-tauri/src/commands.rs?raw";
import libRs from "../../src-tauri/src/lib.rs?raw";
import ipcTs from "./ipc.ts?raw";
import { api } from "./ipc";
import { mock } from "./mockDb";

/**
 * El texto **sin sus comentarios**. Se sacan a los dos lados: en `commands.rs`
 * hay comentarios entre los parámetros de una firma, y en `ipc.ts` uno con una
 * coma adentro se leería como una clave más. El `[^:]` deja pasar el `//` de una
 * URL, que en un comentario de doc sí aparece.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const COMMANDS_RS = stripComments(commandsRs);
const LIB_RS = stripComments(libRs);
const IPC_TS = stripComments(ipcTs);

/** `to_date` → `toDate`. Es la conversión que hace Tauri con los argumentos. */
function camelCase(snake: string): string {
  const [head, ...tail] = snake.split("_");
  return head + tail.map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

/**
 * Corta por las comas de **primer nivel**, ignorando las que van dentro de
 * `<>`, `()` o `{}`. Sin esto, `State<'_, Db>` se parte en dos y cada parámetro
 * queda inventado.
 */
function topLevelSplit(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = "";
  for (const char of source) {
    if ("<({[".includes(char)) depth++;
    else if (">)}]".includes(char)) depth--;
    if (char === "," && depth === 0) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  parts.push(buffer);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * El bloque balanceado que arranca en el primer `opener` desde `at`, o `null` si
 * no hay ninguno. El cierre se deduce del que abre: el `invoke_handler` usa
 * `![...]` y no `{...}`, y buscar una llave ahí devolvía un bloque de otra parte
 * del archivo — con el test pasando por vacío.
 */
function balancedBlock(source: string, at: number, opener: "{" | "[" = "{"): string | null {
  const closer = opener === "{" ? "}" : "]";
  const start = source.indexOf(opener, at);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === opener) depth++;
    else if (source[i] === closer) {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Los comandos de `commands.rs` con los parámetros que **viajan por el puente**.
 *
 * `State<'_, Db>`, `AppHandle` y `Window` los inyecta Tauri: no son argumentos
 * que mande el front, y contarlos daría un desacuerdo en cada comando.
 */
function rustCommands(source: string): Map<string, string[]> {
  const commands = new Map<string, string[]>();
  const re = /#\[tauri::command\][^\n]*\s*pub (?:async )?fn (\w+)\s*\(/g;
  for (let match = re.exec(source); match; match = re.exec(source)) {
    const open = source.indexOf("(", match.index + match[0].length - 1);
    let depth = 0;
    let close = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    const params = topLevelSplit(source.slice(open + 1, close))
      .map((param) => {
        const colon = param.indexOf(":");
        return { name: param.slice(0, colon).trim(), type: param.slice(colon + 1) };
      })
      .filter(({ type }) => !/State<|AppHandle|Window/.test(type))
      .map(({ name }) => name);
    commands.set(match[1], params);
  }
  return commands;
}

/**
 * Las llamadas de `ipc.ts`: nombre del comando y claves que le manda.
 *
 * **El genérico se cierra contando, no con un regex.** `invoke<[^>]*>` parece
 * suficiente y no lo es: se detiene en el primer `>`, así que uno anidado como
 * `invoke<Array<[string, string]>>("list_settings")` no matcheaba y ese comando
 * **no se chequeaba nunca**. Era inocuo porque no lleva argumentos, pero el mismo
 * agujero se tragaba un comando con genérico compuesto **y** argumentos, que es
 * exactamente la clase de bug por la que existe este archivo.
 */
function frontInvocations(source: string): Map<string, string[]> {
  const calls = new Map<string, string[]>();
  const re = /invoke\s*</g;
  for (let match = re.exec(source); match; match = re.exec(source)) {
    // Cerrar el `<…>` contando, para que los anidados no corten de más.
    let depth = 0;
    let cursor = match.index + match[0].length - 1;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === "<") depth++;
      else if (source[cursor] === ">") {
        depth--;
        if (depth === 0) break;
      }
    }
    const call = /^\(\s*"(\w+)"\s*(,?)/.exec(source.slice(cursor + 1));
    if (!call) continue;
    const [head, command, comma] = call;
    if (!comma) {
      calls.set(command, []);
      continue;
    }
    const args = balancedBlock(source, cursor + 1 + head.length);
    const keys = args ? topLevelSplit(args).map((part) => part.split(":")[0].trim()) : [];
    calls.set(command, keys);
  }
  return calls;
}

describe("el contrato del puente IPC", () => {
  const commands = rustCommands(COMMANDS_RS);
  const calls = frontInvocations(IPC_TS);

  // Si el parseo se rompe con un cambio de formato, el resto de los asserts
  // pasarían por vacíos en vez de fallar.
  it("encuentra comandos y llamadas en los archivos", () => {
    expect(commands.size).toBeGreaterThan(40);
    expect(calls.size).toBeGreaterThan(40);
    expect(commands.get("daily_log")).toEqual(["to_date", "days"]);
    // El ancla del genérico anidado: `invoke<Array<[string, string]>>(…)`. Con el
    // regex viejo este comando no entraba al mapa y nadie lo notaba.
    expect(calls.has("list_settings"), "el genérico anidado se está cortando").toBe(true);
  });

  it("cada invoke le manda al comando las claves que Rust espera, en camelCase", () => {
    for (const [command, keys] of calls) {
      const params = commands.get(command);
      expect(params, `ipc.ts llama "${command}", que no existe en commands.rs`).toBeDefined();
      expect(
        [...keys].sort(),
        `las claves de "${command}" no son los parámetros de Rust en camelCase`,
      ).toEqual(params!.map(camelCase).sort());
    }
  });

  // La dirección que faltaba. El test de arriba itera sobre las llamadas, así que
  // un comando de Rust sin cliente en `ipc.ts` era invisible: existe, está
  // registrado, y nadie lo puede llamar.
  it("todo comando de Rust tiene su cliente en ipc.ts", () => {
    const huerfanos = [...commands.keys()].filter((command) => !calls.has(command));
    expect(huerfanos, "comandos de Rust que ipc.ts no expone").toEqual([]);
  });

  it("todos los comandos están registrados en el invoke_handler de lib.rs", () => {
    const handler = balancedBlock(LIB_RS, LIB_RS.indexOf("generate_handler!"), "[") ?? "";
    expect(handler, "no se encontró el invoke_handler![] en lib.rs").not.toBe("");
    const registered = new Set([...handler.matchAll(/commands::(\w+)/g)].map((m) => m[1]));
    for (const command of commands.keys()) {
      expect(
        registered.has(command),
        `"${command}" no está en el invoke_handler![] de lib.rs: falla en runtime, no al compilar`,
      ).toBe(true);
    }
  });
});

/**
 * El tercer lado del puente, que hasta ahora no miraba nadie.
 *
 * `ipcContract` comparaba `ipc.ts` con Rust y **no mencionaba el mock**, que es
 * justamente contra quien corren todos los tests del front. Un método nuevo de
 * `api` sin gemelo solo se caía si algún test pisaba ese camino, y no lo veía el
 * typecheck porque cada método resuelve su rama con un ternario.
 *
 * Se comparan las claves en runtime y no como texto: `api` y `mock` son objetos
 * literales, así que preguntarles es más barato y más exacto que parsearlos.
 */
describe("el mock es gemelo de la api", () => {
  it("cada método de api tiene su implementación en mockDb", () => {
    const gemelos = new Set(Object.keys(mock));
    const faltan = Object.keys(api).filter((metodo) => !gemelos.has(metodo));
    expect(faltan, "métodos de api sin gemelo en mockDb: el front se cae en jsdom").toEqual([]);
  });

  it("mockDb no tiene métodos que api no exponga", () => {
    const expuestos = new Set(Object.keys(api));
    const sobran = Object.keys(mock).filter((metodo) => !expuestos.has(metodo));
    expect(sobran, "métodos de mockDb que ya no se usan: código muerto").toEqual([]);
  });
});
