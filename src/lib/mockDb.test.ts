import { describe, expect, it } from "vitest";
import { api } from "./ipc";
import { toISODate, todayISO } from "./date";

/**
 * El mock tiene que comportarse como Rust, o los tests pasan contra una realidad
 * que no es la de la app. Este archivo fija el caso que se equivocaba en los dos
 * lados: **reordenar dentro de un mismo día**.
 *
 * El gemelo en Rust es `reordenar_dentro_del_mismo_dia_respeta_el_indice_final`
 * (`repo.rs`). Si uno se cambia, el otro también.
 *
 * El estado del mock es de módulo y arranca sembrado, así que el día de prueba
 * es uno lejano y propio: apoyarse en la semilla haría que el orden esperado
 * dependiera del día en que se corran los tests.
 */
const DIA = "2031-04-07";

async function ordenDelDia(): Promise<string[]> {
  const tasks = await api.listTasksForDate(DIA);
  return tasks.map((t) => t.title);
}

describe("mockDb.moveTask", () => {
  it("reordenar dentro del mismo día deja la tarea en el índice final", async () => {
    const ids: Record<string, number> = {};
    for (const title of ["a", "b", "c", "d"]) {
      const t = await api.createTask({ title, scheduledDate: DIA });
      ids[title] = t.id;
    }
    expect(await ordenDelDia()).toEqual(["a", "b", "c", "d"]);

    // Hacia arriba: 'd' del índice 3 al 1.
    await api.moveTask(ids.d, DIA, 1);
    expect(await ordenDelDia()).toEqual(["a", "d", "b", "c"]);

    // Y hacia abajo, que es donde el índice significa otra cosa: la posición que
    // llega es la final, contando que la tarea ya salió de la lista.
    await api.moveTask(ids.d, DIA, 3);
    expect(await ordenDelDia()).toEqual(["a", "b", "c", "d"]);

    // Sin huecos ni empates: dos tareas con la misma posición ordenan por el
    // desempate y el arrastre siguiente vuelve a salir corrido.
    const posiciones = (await api.listTasksForDate(DIA)).map((t) => t.position);
    expect(posiciones).toEqual([0, 1, 2, 3]);
  });
});

/**
 * El otro punto donde el mock tiene que decir lo mismo que Rust: **a qué día se
 * acredita un ajuste manual de tiempo** (Mej.14). El gemelo es
 * `un_ajuste_manual_se_acredita_al_dia_de_la_tarea_y_no_a_hoy` en `repo.rs`.
 */
describe("mockDb.setActualSeconds", () => {
  it("el ajuste se acredita al día de la tarea, no al día en que se escribe", async () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const dia = toISODate(ayer);
    const hoy = todayISO();

    const antesHoy = (await api.dayWork(hoy)).length;
    const t = await api.createTask({ title: "reunión de ayer", scheduledDate: dia });
    await api.setActualSeconds(t.id, 1800);

    const deEseDia = (await api.dayWork(dia)).find((f) => f.taskId === t.id);
    expect(deEseDia?.seconds).toBe(1800);
    // Y el día en que se escribió no registra nada nuevo.
    expect((await api.dayWork(hoy)).length).toBe(antesHoy);
  });

  it("sin fecha se acredita a hoy, porque no hay otro día al que mandarlo", async () => {
    const hoy = todayISO();
    const t = await api.createTask({ title: "del backlog", scheduledDate: null });
    await api.setActualSeconds(t.id, 600);

    expect((await api.dayWork(hoy)).find((f) => f.taskId === t.id)?.seconds).toBe(600);
  });
});
