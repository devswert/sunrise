import type { Participante } from "../../lib/types";

/**
 * Color y significado del punto de cada invitado.
 *
 * Verde asiste, azul quizás, rojo no va, gris sin responder. El `title` y el
 * `aria-label` no son decorativos: cuatro estados distinguidos **solo** por color
 * son cuatro estados indistinguibles para quien no ve bien los colores, y "no va"
 * contra "no respondió" es justo la diferencia que importa antes de una reunión.
 */
function marca(estado: string | null): { clase: string; texto: string } {
  switch (estado) {
    case "ACCEPTED":
      return { clase: "is-si", texto: "Asiste" };
    case "TENTATIVE":
      return { clase: "is-quizas", texto: "Quizás" };
    case "DECLINED":
      return { clase: "is-no", texto: "No asiste" };
    default:
      return { clase: "is-pendiente", texto: "Sin responder" };
  }
}

/** Nombre si lo hay, si no el correo. */
function nombreDe(p: Participante): string {
  return p.nombre?.trim() || p.email || "(sin nombre)";
}

/**
 * Invitados de una reunión importada del calendario.
 *
 * Sin avatares ni iniciales: la app no tiene fotos y unas iniciales en un círculo
 * son ruido que compite con el nombre, que es lo que uno viene a leer. El punto
 * de color lleva toda la información de estado.
 *
 * No se renderiza si la lista está vacía, y eso pasa **siempre** con un
 * calendario compartido "ocultando los detalles": ahí el feed no trae invitados.
 */
export function Participantes({ gente }: { gente: Participante[] }) {
  if (gente.length === 0) return null;

  return (
    <ul className="gente">
      {gente.map((p) => {
        const m = marca(p.estado);
        return (
          <li key={p.email ?? nombreDe(p)} className="gente__fila">
            <span className={`gente__punto ${m.clase}`} title={m.texto} aria-label={m.texto} />
            <span className="gente__nombre">{nombreDe(p)}</span>
            {p.organizador && <span className="gente__org">organiza</span>}
          </li>
        );
      })}
    </ul>
  );
}
