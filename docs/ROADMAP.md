# sunrise — Roadmap de lo que falta

Este documento es la **fuente de verdad de lo que falta**, y solo eso. Lo que ya
existe y cómo funciona está en [SPECS.md](SPECS.md); **por qué es así** —lo
descartado, lo medido y lo que se pagó caro— está en
[DECISIONES.md](DECISIONES.md).

> **Dónde quedó la historia.** Este archivo llegó a tener 2600 líneas, de las
> cuales 2560 describían trabajo terminado: cada milestone y cada mejora con su
> relato completo. Eso se podó. Las racionales que no vivían en ningún otro lado
> se mudaron a `DECISIONES.md`, y **el texto original de cada ítem, con su commit,
> sigue disponible en `git log -p docs/ROADMAP.md`**. Si buscas el relato de una
> `Mej.N` cerrada, está ahí.

## Estado de los milestones

| | Milestone | Estado |
|---|---|---|
| M0 | Scaffold (Tauri + React/TS + SQLite + tokens + tests) | ✅ `3832ebd` |
| M1 | Core de planificación (semana con DnD, tareas, objetivos, backlog) | ✅ `703fbbe` |
| M2 | Timer + Focus (taxímetro, `time_entries`, campana, Focus Mode) | ✅ `1175035` |
| M3 | Calendar + review + resúmenes | ✅ 3.1 a 3.6 hechos |
| M4 | Durabilidad, branding, empaque | ✅ 4.1 a 4.3 hechos |
| M5 | Compartir con el equipo | ✅ 5.1 a 5.9 hechos; hasta `v0.4.0` publicada |

**Ninguno tiene fases abiertas.** Con eso, todo lo que queda son mejoras y
verificaciones.

---

## Mejoras (no bloqueantes)

Cosas que valen la pena pero que no bloquean ningún milestone. Se pueden tomar en
cualquier momento, idealmente cuando se esté trabajando cerca.

Los marcadores: **`🔵` abierto**, **`⬛` retirada** (decidida fuera de alcance).
Los cerrados no se listan — están en `git log`.

### Mej.3 ⬛ Avisar cuándo una tarea lleva días arrastrándose — retirada

Se cae con la retirada del carry-over: ya no hay cadena de arrastres que contar.
Una tarea que no se termina baja al backlog al día siguiente, y ahí **sí** se ve de
dónde viene, con el grupo "venían de un día" y su fecha de origen. Lo que quedaba
del pedido original —que se note antes de abrir el detalle— está cubierto.

### Mej.17 ⬛ ¿Usar `plugin-dialog` en otros lados? — retirada

Se cerró leyéndola: su propio texto ya respondía la pregunta. **No**, los diálogos
de confirmación no se convierten a nativos (el motivo está en DECISIONES §7). Las
tres cosas que quedaban vivas se mudaron a donde se iban a mirar: ⌘Q con la ventana
no visible salió como Mej.25, el error de reemplazo en la restauración quedó como
deuda D9 en SPECS §9, y el picker para el archivo de la campana se hizo dentro de
Mej.1.

---

## Post-MVP (decidido: fuera de alcance)

- Recurrentes / rituales auto-generados.
- Sync multi-dispositivo (el modelo de datos queda listo, pero no se implementa).
- Email de resumen vía SMTP.
- Nada de IA ni integraciones.

---

## Verificación end-to-end (del plan original)

**Confirmado por el dev en la app instalada** (agosto 2026): el selector de carpeta
del respaldo, una restauración de verdad, el icono en el Dock, la instalación del
`.dmg`, el modal "Lo nuevo" al actualizar y el respaldo automático disparándose a
su hora (dos zips a la hora configurada, y los de producción intactos al lado — la
separación de perfiles funcionando fuera de los tests).

Quedan **dos** sin comprobar:

- [ ] **La casilla de inicio automático registra el LaunchAgent** y la app se abre
      al reiniciar sesión. Ojo que en dev registra `target/debug/sunrise`, así que
      hay que apagarla antes de salir. El mock no tiene sistema operativo al que
      registrarse, así que esto no se puede cubrir con tests.
- [ ] **Al terminar un update, la ventana vuelve al frente** (§4.21). Solo se ve con
      un Release de verdad: hace falta una versión instalada más vieja y otra
      publicada. Deja otra app adelante mientras baja; la de sunrise tiene que
      quedar encima al reiniciar. Si no pasa, la pregunta antes de tocar el foco es
      **cuántos procesos hay** (`ps ax | grep -i sunrise`): si son dos, lo que falla
      es la salida del proceso viejo y no la activación. Para probar solo el tramo
      del arranque sin publicar nada, `touch` el archivo de marca en el directorio
      de datos (`pending-update-focus`) y abre la app con otra adelante.

El zip en un Drive real se sacó de la lista: es del sistema de archivos, no de la
app — sunrise escribe en la carpeta que le den y quién la sincroniza no es asunto
suyo.

<details><summary>Los diez pasos originales, todos verificados salvo el de arriba</summary>

1. `pnpm tauri dev` levanta app + flotante; `pnpm test:all` en verde.
2. Categorías de 2 niveles con su color de la paleta; planned/actual; DnD; anidar
   en objetivo; modal con historial.
3. Tarea incompleta ayer aparece hoy (hoy: baja al backlog, ver SPECS §4.2).
4. Daily planning: las que vienen de un día arriba, rail con las meets, capacidad
   gris→amarillo→rojo; "Empezar el día" → confetti + semana. (El almuerzo no es un
   bloque propio: si está en el calendario entra como cualquier evento.)
5. El timer sube; campana al pasar el estimado; Focus avanza al check y deja
   continuar; `time_entries` correctas.
6. Feed ICS de prueba: importa meets con categoría; borrar evento futuro lo saca
   del backlog; meet trackeada queda liberada del feed (ver DECISIONES §3).
7. Weekly review: horas, barras y donut cuadran; mover una tarea a otra semana no
   cambia las horas pasadas.
8. Daily highlights: la bitácora trae los días solos, con WORKED/PLANNED y su
   timeline; el shutdown sella el día y el aviso llega a la hora de `work_end`.
9. Backup: snapshot y restore en perfil limpio ok.
10. Tipografías cargan offline; logo presente en la app y en el `.dmg`. (El punto
    original decía "app, tray y dmg"; el tray se descartó en M4.2.)

</details>
