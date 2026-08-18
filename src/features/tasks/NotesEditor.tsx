import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Notas de una tarea: markdown renderizado que se vuelve editable al hacer click.
 *
 * Compartido por el modal de detalle y Focus. Estaba solo en el modal, y cuando
 * Focus necesitó lo mismo, copiarlo habría duplicado el par
 * `commitDebounced`/`commit` — que es justo donde vive la regla del `flush`.
 */
export function NotesEditor({
  value,
  onDebounced,
  onBlurSave,
  placeholder = "Notas…",
}: {
  value: string;
  /** Cada tecla, con debounce. */
  onDebounced: (v: string) => void;
  /** Al salir del campo, para no depender del temporizador. */
  onBlurSave: (v: string) => void;
  placeholder?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [text, setTexto] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  // La tarea llega fresca desde el board; mientras no se esté editando, refleja
  // lo guardado.
  useEffect(() => {
    if (!editando) setTexto(value);
  }, [value, editando]);

  useEffect(() => {
    if (editando) ref.current?.focus();
  }, [editando]);

  if (editando) {
    return (
      <textarea
        ref={ref}
        className="tmodal__notes-input"
        value={text}
        placeholder={`${placeholder} (soporta markdown)`}
        onChange={(e) => {
          setTexto(e.target.value);
          onDebounced(e.target.value);
        }}
        onBlur={() => {
          setEditando(false);
          onBlurSave(text);
        }}
      />
    );
  }

  return (
    <div
      className="tmodal__notes-view md"
      onClick={() => setEditando(true)}
      role="button"
      tabIndex={0}
      aria-label="Notas"
      onKeyDown={(e) => {
        if (e.key === "Enter") setEditando(true);
      }}
    >
      {text.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      ) : (
        <span className="tmodal__notes-placeholder">{placeholder}</span>
      )}
    </div>
  );
}
