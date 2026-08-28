# sunrise — Roadmap de lo que falta

**Solo lo que falta.** Lo que existe está en [SPECS.md](SPECS.md); el porqué, en
[DECISIONES.md](DECISIONES.md).

> Este archivo llegó a 2600 líneas, 2560 de ellas describiendo trabajo hecho. Se
> podó: las racionales se mudaron a `DECISIONES.md` y el texto original de cada
> ítem sigue en `git log -p docs/ROADMAP.md`.

## Estado de los milestones

| | Milestone | Estado |
|---|---|---|
| M0 | Scaffold (Tauri + React/TS + SQLite + tokens + tests) | ✅ `3832ebd` |
| M1 | Core de planificación (semana con DnD, tareas, objetivos, backlog) | ✅ `703fbbe` |
| M2 | Timer + Focus (taxímetro, `time_entries`, campana, Focus Mode) | ✅ `1175035` |
| M3 | Calendar + review + resúmenes | ✅ 3.1 a 3.6 |
| M4 | Durabilidad, branding, empaque | ✅ 4.1 a 4.3 |
| M5 | Compartir con el equipo | ✅ 5.1 a 5.9; hasta `v0.5.0` publicada |

Ninguno tiene fases abiertas.

## Mejoras

**Ninguna abierta.** Las cerradas se podan —lo aprendido va a `DECISIONES.md`— y
las retiradas también, una vez que sus partes vivas tienen dónde vivir.

Cuando haya, el marcador es `🔵` abierta o `⬛` retirada (fuera de alcance, con la
razón en una línea). Una retirada no es pendiente.

## Post-MVP (fuera de alcance)

- Recurrentes / rituales auto-generados.
- Sync multi-dispositivo (el modelo de datos queda listo; no se implementa).
- Email de resumen vía SMTP.
- Nada de IA ni integraciones.

## Verificación end-to-end

**Confirmado en la app instalada** (agosto 2026): el selector de carpeta del
respaldo, una restauración de verdad, el icono en el Dock, la instalación del
`.dmg`, el modal "Lo nuevo", y el respaldo automático a su hora con los zips de
producción intactos al lado — la separación de perfiles fuera de los tests.

Quedan **dos**, ninguna cubrible con tests:

- [ ] **El inicio automático registra el LaunchAgent** y la app abre al reiniciar
      sesión. En dev registra `target/debug/sunrise`: apágala antes de salir.
- [ ] **Al terminar un update, la ventana vuelve al frente** (§4.21). Necesita una
      versión instalada más vieja y otra publicada; con la `v0.5.0` ya está. Deja
      otra app adelante mientras baja. Si falla, `ps ax | grep -i sunrise` primero:
      dos procesos ⇒ lo roto es la salida del viejo, no la activación. Para probar
      solo el arranque sin publicar, `touch` a `pending-update-focus` en el
      directorio de datos y abre la app con otra adelante.

El zip en un Drive real salió de la lista: es del sistema de archivos. sunrise
escribe en la carpeta que le den.

<details><summary>Los diez pasos originales, todos verificados salvo los de arriba</summary>

1. `pnpm tauri dev` levanta app + flotante; `pnpm test:all` en verde.
2. Categorías de 2 niveles con su color; planned/actual; DnD; anidar en objetivo;
   modal con historial.
3. Tarea incompleta ayer aparece hoy (hoy: baja al backlog, §4.2).
4. Daily planning: las que vienen de un día arriba, rail con las meets, capacidad
   gris→amarillo→rojo; "Empezar el día" → confetti + semana. El almuerzo no es un
   bloque propio: si está en el calendario entra como cualquier evento.
5. El timer sube; campana al pasar el estimado; Focus avanza al check y deja
   continuar; `time_entries` correctas.
6. Feed ICS de prueba: importa meets con categoría; borrar un evento futuro lo saca
   del backlog; una meet trackeada queda liberada del feed (DECISIONES §3).
7. Weekly review: horas, barras y donut cuadran; mover una tarea a otra semana no
   cambia las horas pasadas.
8. Daily highlights: la bitácora trae los días solos, con WORKED/PLANNED y su
   timeline; el shutdown sella el día y el aviso llega a la hora de `work_end`.
9. Backup: snapshot y restore en perfil limpio.
10. Tipografías cargan offline; logo en la app y en el `.dmg`. El tray se descartó
    en M4.2.

</details>
