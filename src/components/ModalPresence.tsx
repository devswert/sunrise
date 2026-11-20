import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PRESENCE_MS, prefersReducedMotion, usePresence } from "../lib/presence";
import "./modal-presence.css";

/** Lo que un modal necesita saber de su propia salida. */
interface ModalExit {
  /**
   * Se está yendo: la animación de salida corre y el modal ya no es de nadie.
   * Quien cuelga teclas de `window` tiene que soltarlas mientras esto vale `true`.
   */
  leaving: boolean;
  /**
   * Deja una copia del modal saliendo encima de todo, para cuando lo que viene
   * después **desmonta la vista entera** (navegar). Ver `exitAbove` abajo.
   */
  exitAbove: () => void;
}

const ExitContext = createContext<ModalExit>({ leaving: false, exitAbove: () => {} });

/** Si el modal en el que se está se está yendo. Fuera de un `ModalPresence`, nunca. */
export function useModalLeaving(): boolean {
  return useContext(ExitContext).leaving;
}

/** `exitAbove` del `ModalPresence` más cercano (no hace nada fuera de uno). */
export function useModalExitAbove(): () => void {
  return useContext(ExitContext).exitAbove;
}

/**
 * Monta un modal con animación de entrada **y de salida** (§7, "Modales").
 *
 * Un modal dibujado con `{x && <Modal/>}` desaparece de golpe: al cerrarse React
 * lo desmonta en el mismo frame y no queda nada sobre lo que correr la salida.
 * Esto lo mantiene montado mientras se va, con `usePresence` —el mismo mecanismo
 * de los paneles de la tira—, y le agrega dos cosas que un panel no necesita:
 *
 * - **Se queda con el último valor.** Lo que abre un modal suele ser un dato —la
 *   tarea elegida, el respaldo restaurado— y al cerrar ese dato pasa a `null`, o
 *   directamente deja de existir: borrar una tarea la saca del board antes de que
 *   el modal termine de irse. Sin el último valor no habría qué dibujar durante
 *   la salida.
 * - **Cada apertura es una instancia nueva.** Si se vuelve a abrir mientras el
 *   anterior todavía sale —otra tarjeta, cliqueada en esos 240 ms—, el modal
 *   nuevo se monta de cero en vez de heredar el estado del que se iba: el
 *   detalle inicializa título y notas una sola vez, al montarse, y el de crear
 *   guarda lo escrito hasta que se desmonta.
 *
 * Mientras sale, el envoltorio lleva `is-leaving` (dispara `modal-out` y le quita
 * el puntero) e `inert`, y los modales sueltan sus teclas leyendo
 * `useModalLeaving()`: un segundo Escape no lo vuelve a cerrar, ⌘Enter no guarda
 * dos veces y nada le roba teclas a la vista de abajo.
 *
 * El envoltorio es un `display: contents`: no ocupa lugar, y el overlay sigue
 * siendo `position: fixed` contra la ventana.
 */
export function ModalPresence<T>({
  value,
  children,
}: {
  /** Abierto mientras no sea `null`, `undefined` ni `false`. */
  value: T | null | undefined | false;
  children: (value: T, exit: ModalExit) => ReactNode;
}) {
  const open = value != null && value !== false;
  const last = useRef<T | null>(null);
  if (open) last.current = value as T;

  // Cada apertura suma una, y es la `key` del contenido. Es el patrón de "estado
  // derivado del render anterior" y no un efecto: con un efecto, la instancia
  // vieja recibiría un render con los datos nuevos antes de reemplazarse.
  const [prevOpen, setPrevOpen] = useState(open);
  const [generation, setGeneration] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGeneration((g) => g + 1);
  }

  const { mounted } = usePresence(open);
  // Derivado y no el `leaving` del hook: ese llega un render tarde, y en ese
  // render el modal ya cerrado volvería a colgar sus teclas.
  const leaving = !open && mounted;

  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // React 18 no conoce `inert` como prop; va por el DOM.
    el.toggleAttribute("inert", leaving);
    // Un campo enfocado dentro seguiría recibiendo lo que se escribe mientras el
    // modal sale. El `blur` además dispara el guardado del campo, como siempre.
    if (
      leaving &&
      document.activeElement instanceof HTMLElement &&
      el.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
  }, [leaving]);

  /**
   * Una copia del modal que termina de salir **encima de lo que venga**.
   *
   * Hace falta cuando cerrar viene con navegar —el play del detalle lleva a
   * Focus—: la vista que monta el modal se desmonta entera y se lo lleva puesto,
   * y ahí ya no hay presencia que lo sostenga. La copia es DOM suelto, sin React:
   * va a `body` marcada `is-leaving`, `inert` y `aria-hidden`, y se borra sola
   * cuando termina la animación. Se llama **antes** de navegar, mientras el
   * modal todavía está en pantalla.
   *
   * Con `prefers-reduced-motion` no hace nada: no hay salida que mostrar.
   */
  const exitAbove = useCallback(() => {
    const el = wrap.current;
    if (!el || prefersReducedMotion()) return;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("is-leaving", "is-ghost");
    ghost.setAttribute("inert", "");
    ghost.setAttribute("aria-hidden", "true");
    // `cloneNode` copia el árbol, no lo vivo: lo escrito o marcado en un campo controlado
    // por React y el scroll del panel se pasan a mano, o la copia saldría con
    // otro texto o arriba de todo. Los dos árboles tienen la misma forma, así que
    // se emparejan por orden.
    const fields = "input, textarea, select";
    const from = el.querySelectorAll<HTMLInputElement>(fields);
    const to = ghost.querySelectorAll<HTMLInputElement>(fields);
    from.forEach((f, i) => {
      if (!to[i] || f.type === "file") return;
      to[i].value = f.value;
      if (f instanceof HTMLInputElement) to[i].checked = f.checked;
    });
    const scrolled = Array.from(el.querySelectorAll<HTMLElement>("*")).flatMap((n, i) =>
      n.scrollTop > 0 ? [[i, n.scrollTop] as const] : [],
    );
    // Un radio de la copia con el mismo `name` que el original formaría un solo
    // grupo con él, y marcar uno desmarcaría el otro: el original perdería su
    // valor justo antes de que React lo lea o lo desmonte. La copia no lo necesita.
    for (const radio of ghost.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      radio.removeAttribute("name");
    }
    document.body.appendChild(ghost);
    // El `scrollTop` solo se puede poner con la copia ya en el documento.
    const all = ghost.querySelectorAll<HTMLElement>("*");
    for (const [i, top] of scrolled) if (all[i]) all[i].scrollTop = top;
    setTimeout(() => ghost.remove(), PRESENCE_MS);
  }, []);

  if (!(open || mounted) || last.current === null) return null;
  const exit = { leaving, exitAbove };

  return (
    <ExitContext.Provider value={exit}>
      <div ref={wrap} className={`modal-presence${leaving ? " is-leaving" : ""}`}>
        <Fragment key={generation}>{children(last.current, exit)}</Fragment>
      </div>
    </ExitContext.Provider>
  );
}
