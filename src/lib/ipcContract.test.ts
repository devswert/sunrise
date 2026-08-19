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

/**
 * El texto **sin sus comentarios**. Se sacan a los dos lados: en `commands.rs`
 * hay comentarios entre los parámetros de una firma, y en `ipc.ts` uno con una
 * coma adentro se leería como una clave más. El `[^:]` deja pasar el `//` de una
 * URL, que en un comentario de doc sí aparece.
 */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const COMMANDS_RS = sinComentarios(commandsRs);
const LIB_RS = sinComentarios(libRs);
const IPC_TS = sinComentarios(ipcTs);

/** `to_date` → `toDate`. Es la conversión que hace Tauri con los argumentos. */
function camelCase(snake: string): string {
  const [primera, ...resto] = snake.split("_");
  return primera + resto.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

/**
 * Corta por las comas de **primer nivel**, ignorando las que van dentro de
 * `<>`, `()` o `{}`. Sin esto, `State<'_, Db>` se parte en dos y cada parámetro
 * queda inventado.
 */
function topLevelSplit(texto: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let actual = "";
  for (const ch of texto) {
    if ("<({[".includes(ch)) profundidad++;
    else if (">)}]".includes(ch)) profundidad--;
    if (ch === "," && profundidad === 0) {
      partes.push(actual);
      actual = "";
      continue;
    }
    actual += ch;
  }
  partes.push(actual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

/**
 * El bloque balanceado que arranca en el primer `apertura` desde `desde`, o
 * `null` si no hay ninguno. El cierre se deduce del que abre: el
 * `invoke_handler` usa `![...]` y no `{...}`, y buscar una llave ahí devolvía
 * un bloque de otra parte del archivo — con el test pasando por vacío.
 */
function bloque(texto: string, desde: number, apertura: "{" | "[" = "{"): string | null {
  const cierre = apertura === "{" ? "}" : "]";
  const abre = texto.indexOf(apertura, desde);
  if (abre === -1) return null;
  let profundidad = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === apertura) profundidad++;
    else if (texto[i] === cierre) {
      profundidad--;
      if (profundidad === 0) return texto.slice(abre + 1, i);
    }
  }
  return null;
}

/**
 * Los comandos de `commands.rs` con los parámetros que **viajan por el puente**.
 *
 * `State<'_, Db>`, `AppHandle` y `Window` los inyecta Tauri: no son argumentos
 * que mande el front, y contarlos daría un desacuerdo en los 59 comandos.
 */
function comandosDeRust(rs: string): Map<string, string[]> {
  const comandos = new Map<string, string[]>();
  const re = /#\[tauri::command\][^\n]*\s*pub (?:async )?fn (\w+)\s*\(/g;
  for (let m = re.exec(rs); m; m = re.exec(rs)) {
    const abre = rs.indexOf("(", m.index + m[0].length - 1);
    let profundidad = 0;
    let cierra = abre;
    for (let i = abre; i < rs.length; i++) {
      if (rs[i] === "(") profundidad++;
      else if (rs[i] === ")") {
        profundidad--;
        if (profundidad === 0) {
          cierra = i;
          break;
        }
      }
    }
    const params = topLevelSplit(rs.slice(abre + 1, cierra))
      .map((p) => {
        const dosPuntos = p.indexOf(":");
        return { nombre: p.slice(0, dosPuntos).trim(), tipo: p.slice(dosPuntos + 1) };
      })
      .filter(({ tipo }) => !/State<|AppHandle|Window/.test(tipo))
      .map(({ nombre }) => nombre);
    comandos.set(m[1], params);
  }
  return comandos;
}

/** Las llamadas de `ipc.ts`: nombre del comando y claves que le manda. */
function invocacionesDelFront(limpio: string): Map<string, string[]> {
  const llamadas = new Map<string, string[]>();
  const re = /invoke<[^>]*>\(\s*"(\w+)"\s*(,?)/g;
  for (let m = re.exec(limpio); m; m = re.exec(limpio)) {
    const [, comando, coma] = m;
    if (!coma) {
      llamadas.set(comando, []);
      continue;
    }
    const args = bloque(limpio, re.lastIndex);
    const claves = args
      ? topLevelSplit(args).map((p) => p.split(":")[0].trim())
      : [];
    llamadas.set(comando, claves);
  }
  return llamadas;
}

describe("el contrato del puente IPC", () => {
  const comandos = comandosDeRust(COMMANDS_RS);
  const llamadas = invocacionesDelFront(IPC_TS);

  // Si el parseo se rompe con un cambio de formato, el resto de los asserts
  // pasarían por vacíos en vez de fallar.
  it("encuentra comandos y llamadas en los archivos", () => {
    expect(comandos.size).toBeGreaterThan(40);
    expect(llamadas.size).toBeGreaterThan(40);
    expect(comandos.get("daily_log")).toEqual(["to_date", "days"]);
  });

  it("cada invoke le manda al comando las claves que Rust espera, en camelCase", () => {
    for (const [comando, claves] of llamadas) {
      const params = comandos.get(comando);
      expect(params, `ipc.ts llama "${comando}", que no existe en commands.rs`).toBeDefined();
      expect(
        [...claves].sort(),
        `las claves de "${comando}" no son los parámetros de Rust en camelCase`,
      ).toEqual(params!.map(camelCase).sort());
    }
  });

  it("todos los comandos están registrados en el invoke_handler de lib.rs", () => {
    const handler = bloque(LIB_RS, LIB_RS.indexOf("generate_handler!"), "[") ?? "";
    expect(handler, "no se encontró el invoke_handler![] en lib.rs").not.toBe("");
    const registrados = new Set(
      [...handler.matchAll(/commands::(\w+)/g)].map((m) => m[1]),
    );
    for (const comando of comandos.keys()) {
      expect(
        registrados.has(comando),
        `"${comando}" no está en el invoke_handler![] de lib.rs: falla en runtime, no al compilar`,
      ).toBe(true);
    }
  });
});
