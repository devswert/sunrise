import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  /** Alineación horizontal respecto del ancla. */
  align?: "left" | "right" | "center";
  className?: string;
  children: ReactNode;
}

/**
 * Popover renderizado en un portal con posición fija.
 *
 * Va al `body` a propósito: dentro de contenedores con `overflow: auto`
 * (columnas del board, cuerpo del modal) un popover absoluto se recorta.
 * Además se voltea hacia arriba si no cabe abajo y se ajusta al viewport.
 */
export function Popover({
  anchorRef,
  onClose,
  align = "left",
  className = "",
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const el = ref.current;
    if (!anchor || !el) return;

    const a = anchor.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const margin = 8;

    let left =
      align === "right"
        ? a.right - box.width
        : align === "center"
          ? a.left + a.width / 2 - box.width / 2
          : a.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));

    let top = a.bottom + 6;
    if (top + box.height > window.innerHeight - margin) {
      const above = a.top - box.height - 6;
      top = above > margin ? above : Math.max(margin, window.innerHeight - box.height - margin);
    }

    setPos({ top, left });
  }, [anchorRef, align]);

  /**
   * El foco al primer campo de búsqueda, cuando ya se puede.
   *
   * Lo hace el popover y no cada picker por una razón medida: el portal monta
   * `visibility: hidden` mientras mide su posición, y **`focus()` sobre un
   * elemento invisible no hace nada** (comprobado en el webview: el mismo input
   * toma el foco visible y lo rechaza oculto). Los `useEffect` de mount de
   * `SearchSelect` y `TimePicker` caían justo en ese hueco, así que el picker
   * abría con el foco todavía en el botón que lo abrió: había que hacer un click
   * más para poder escribir, y las flechas tampoco navegaban.
   *
   * Depende de `pos`, que es la señal de "ya soy visible". Si el popover no trae
   * campo —la paleta de colores, el selector de ánimo, el calendario— no hay a
   * quién enfocar y no pasa nada.
   */
  useEffect(() => {
    if (!pos) return;
    ref.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, [pos]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`popover popover--portal ${className}`}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
