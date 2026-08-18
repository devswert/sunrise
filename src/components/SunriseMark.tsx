import { useId } from "react";

/**
 * La marca de sunrise para usar **dentro** de la app: el mismo sol saliendo
 * sobre el horizonte que el icono del Dock, pero sin el cielo.
 *
 * Es la versión que respira con el tema, y por eso existe aparte de
 * `public/app-icon.svg`:
 *
 * - El **horizonte** va en `currentColor`, así que hereda el color del texto que
 *   lo acompaña. En el sidebar eso lo deja del mismo tono que la palabra
 *   "sunrise", y en tema oscuro se aclara solo.
 * - El **sol** va en los tokens de la paleta (`--apricot` → `--butter`), que es
 *   lo mismo que pintaba el punto que había antes acá.
 *
 * El apricot queda **arriba** y el butter abajo, no al revés: el borde superior
 * es la única silueta que separa la marca del fondo, y butter (#fff1c7) sobre el
 * `--surface` claro no se ve. Abajo no importa porque ahí está la línea.
 *
 * Los ids del degradado se generan con `useId`: si dos marcas se montan a la vez
 * (el sidebar y cualquier otra), dos `<linearGradient id="sol">` colisionan y el
 * navegador resuelve todas las referencias al primero.
 */
export function SunriseMark({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const sol = `sunrise-sol-${useId()}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={sol} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--apricot)" />
          <stop offset="1" stopColor="var(--butter)" />
        </linearGradient>
      </defs>
      {/* Semidisco: centro en la línea, radio hacia arriba. */}
      <path d="M5.5 16.5a6.5 6.5 0 0 1 13 0Z" fill={`url(#${sol})`} />
      <path
        d="M2.5 16.5h19"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
