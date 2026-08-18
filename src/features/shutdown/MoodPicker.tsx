import { useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { Popover } from "../../components/Popover";

/**
 * Las caras, en una grilla como la de reacciones de WhatsApp.
 *
 * Es una lista curada y no el set completo de Unicode: el mood de un día es
 * "cómo me sentí", así que sobran las banderas y las frutas. Un picker completo
 * son cientos de KB de datos de emoji dentro de una app que tiene que andar
 * offline, y encima obliga a buscar entre miles para elegir una cara.
 */
const CARAS = [
  "🤩", "😄", "🙂", "😌", "😐", "😕",
  "😣", "😤", "😩", "🥱", "🤯", "😶‍🌫️",
  "🔥", "🚀", "💪", "🧠", "🐢", "🌧️",
];

interface Props {
  /** El emoji actual, o `null` si el día no tiene ninguno. */
  valor: string | null;
  /** `null` para borrarlo. */
  onElegir: (mood: string | null) => void;
}

/**
 * El ánimo del día: un botón redondo que abre una grilla de caras.
 *
 * El popover va en portal (`Popover`) como el resto de la app, así que no lo
 * recorta el `overflow` de la vista. Elegir el mismo que ya estaba lo borra —es
 * un toggle, no un formulario— y hay un "Quitar" explícito para cuando no se
 * recuerde cuál estaba puesto.
 */
export function MoodPicker({ valor, onElegir }: Props) {
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);

  const elegir = (m: string | null) => {
    setAbierto(false);
    onElegir(m);
  };

  return (
    <>
      <button
        ref={botonRef}
        className={`mood${valor ? " tiene-valor" : ""}`}
        aria-label={valor ? "Cambiar el ánimo del día" : "Elegir el ánimo del día"}
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        {valor ?? <SmilePlus size={15} aria-hidden />}
      </button>

      {abierto && (
        <Popover anchorRef={botonRef} align="center" onClose={() => setAbierto(false)}>
          <div className="mood-picker" role="group" aria-label="Cómo estuvo el día">
            <div className="mood-picker__grilla">
              {CARAS.map((m) => (
                <button
                  key={m}
                  className={valor === m ? "is-elegido" : undefined}
                  aria-label={`Ánimo ${m}`}
                  onClick={() => elegir(valor === m ? null : m)}
                >
                  {m}
                </button>
              ))}
            </div>
            {valor && (
              <button className="mood-picker__quitar" onClick={() => elegir(null)}>
                Quitar
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
