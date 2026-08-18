import { useEffect, useState } from "react";
import { api } from "./ipc";
import type { Profile } from "./types";

/**
 * En qué perfil corre esta ventana, y sobre qué archivo de base.
 *
 * **Por qué hace falta saberlo en el front.** `pnpm tauri dev` y el `.dmg`
 * instalado comparten el directorio de datos, así que la base se separa por
 * nombre de archivo (`db::archivo()` en Rust). El resultado es que las dos
 * versiones pueden estar abiertas al mismo tiempo, se ven **exactamente iguales**
 * y muestran datos distintos. Sin una señal en pantalla, no hay forma de saber
 * cuál de las dos ventanas está tocando tus datos de verdad.
 *
 * Se pide **una vez por sesión** y se cachea a nivel de módulo: es un dato del
 * binario, no puede cambiar mientras la app corre. La promesa se guarda —no el
 * resultado— para que dos componentes montándose a la vez compartan la misma
 * llamada en vez de disparar dos.
 */
let pendiente: Promise<Profile> | null = null;

function pedir(): Promise<Profile> {
  pendiente ??= api.profile();
  return pendiente;
}

/**
 * `null` mientras no llega la respuesta. Los consumidores tienen que tratar ese
 * `null` como "todavía no sé", **no** como "no es dev": el respaldo automático se
 * apaga en dev, y asumir producción por un instante alcanza para que corra.
 */
export function useProfile(): Profile | null {
  const [profile, setPerfil] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    void pedir().then((p) => {
      if (alive) setPerfil(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  return profile;
}
