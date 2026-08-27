import { Loader2 } from "lucide-react";

/**
 * El icono de "esto está corriendo".
 *
 * Se usa **reemplazando** el icono en reposo del botón, no girándolo: hacer dar
 * vueltas al calendario del botón de sync se leía como un chiste, porque un
 * calendario que rota no significa nada. Un anillo abierto girando sí: es la
 * forma que todo el mundo ya sabe leer como "espera".
 *
 * La animación vive en `.is-spinning` (week.css), que además la apaga para quien
 * pidió menos movimiento. Por eso los botones que no tienen texto —el sync de un
 * feed suelto— llevan también `aria-busy` y un `title` que lo diga: sin
 * animación, el icono solo es una imagen quieta.
 */
export function Spinner({ size = 13 }: { size?: number }) {
  return <Loader2 size={size} className="is-spinning" aria-hidden />;
}
