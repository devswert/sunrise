/**
 * Las categorías aplanadas para un `SearchSelect`: primero el contexto, y debajo
 * sus channels con el contexto como pista.
 *
 * Vive acá porque la escriben tres pickers —el de crear tarea, el del detalle y
 * el del objetivo (Mej.15)— y estaba copiada en los dos primeros. Una tarea o un
 * objetivo pueden apuntar a cualquiera de los dos niveles, así que los dos entran
 * en la lista.
 */
import type { SearchOption } from "../../components/SearchSelect";
import type { Category } from "../../lib/types";
import { bareName, channelLabel } from "../../lib/channelLabel";

export function channelOptions(categories: Category[]): SearchOption[] {
  const out: SearchOption[] = [];
  for (const ctx of categories.filter((c) => c.parentId === null)) {
    out.push({ value: String(ctx.id), label: bareName(ctx.name), color: ctx.color });
    for (const ch of categories.filter((c) => c.parentId === ctx.id)) {
      out.push({
        value: String(ch.id),
        label: channelLabel(ch.name),
        hint: bareName(ctx.name),
        color: ch.color,
      });
    }
  }
  return out;
}
