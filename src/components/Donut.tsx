import type { Segmento } from "../lib/segmentos";
import { horas } from "../lib/capacity";

interface Props {
  segmentos: Segmento[];
  total: number;
}

const RADIO = 42;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;

/**
 * Donut de un `<svg>` y nada más.
 *
 * Cada porción es un círculo completo con `stroke-dasharray` recortado y
 * `stroke-dashoffset` corrido: es la forma estándar de hacer un donut sin
 * calcular arcos, y deja el color como **CSS** (`stroke: var(--mint)`), que es
 * lo que permite usar los tokens de la paleta y que el tema oscuro funcione
 * solo. Como atributo `stroke="var(--mint)"` no funcionaría: los atributos de
 * presentación de SVG no resuelven variables.
 */
export function Donut({ segmentos, total }: Props) {
  if (total <= 0) return null;

  let acumulado = 0;
  return (
    <svg className="donut" viewBox="0 0 100 100" role="img" aria-label="Tiempo por contexto">
      {segmentos.map((s) => {
        const fraccion = s.seconds / total;
        const largo = fraccion * CIRCUNFERENCIA;
        // El -90° del `transform` pone el inicio arriba en vez de a las 3.
        const offset = -acumulado * CIRCUNFERENCIA;
        acumulado += fraccion;
        return (
          <circle
            key={s.key}
            className="donut__seg"
            cx="50"
            cy="50"
            r={RADIO}
            style={{ stroke: s.color }}
            strokeDasharray={`${largo} ${CIRCUNFERENCIA - largo}`}
            strokeDashoffset={offset}
          >
            <title>{`${s.nombre}: ${horas(s.seconds)}`}</title>
          </circle>
        );
      })}
      <text className="donut__centro" x="50" y="52" textAnchor="middle">
        {horas(total)}
      </text>
    </svg>
  );
}
