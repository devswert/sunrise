import type { Attendee } from "../../lib/types";

/**
 * Color y significado del punto de cada invitado.
 *
 * Verde asiste, azul quizás, rojo no va, gris sin responder. El `title` y el
 * `aria-label` no son decorativos: cuatro estados distinguidos **solo** por color
 * son cuatro estados indistinguibles para quien no ve bien los colores, y "no va"
 * contra "no respondió" es justo la diferencia que importa antes de una reunión.
 */
function stamp(status: string | null): { clase: string; text: string } {
  switch (status) {
    case "ACCEPTED":
      return { clase: "is-si", text: "Asiste" };
    case "TENTATIVE":
      return { clase: "is-quizas", text: "Quizás" };
    case "DECLINED":
      return { clase: "is-no", text: "No asiste" };
    default:
      return { clase: "is-pendiente", text: "Sin responder" };
  }
}

/** Nombre si lo hay, si no el correo. */
function nombreDe(p: Attendee): string {
  return p.name?.trim() || p.email || "(sin nombre)";
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
export function AttendeeList({ gente }: { gente: Attendee[] }) {
  if (gente.length === 0) return null;

  return (
    <ul className="gente">
      {gente.map((p) => {
        const m = stamp(p.status);
        return (
          <li key={p.email ?? nombreDe(p)} className="gente__fila">
            <span className={`gente__punto ${m.clase}`} title={m.text} aria-label={m.text} />
            <span className="gente__nombre">{nombreDe(p)}</span>
            {p.isOrganizer && <span className="gente__org">organiza</span>}
          </li>
        );
      })}
    </ul>
  );
}
