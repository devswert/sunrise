import { FloatingTimer } from "./features/timer/FloatingTimer";
import { ExternalChanges } from "./lib/useExternalChanges";

/**
 * La raíz de la ventana del taxímetro. Separada de `timer.tsx`, que monta React al
 * importarse, para que un test pueda renderizar exactamente lo mismo.
 */
export function TimerRoot() {
  return (
    <>
      {/* Lo que escribe el MCP desde otro proceso (§4.32): sin esto, un timer que
       * Claude abre o cierra no llega al taxímetro, que tiene su propio store. */}
      <ExternalChanges />
      <FloatingTimer />
    </>
  );
}
