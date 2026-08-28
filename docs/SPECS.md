# sunrise — Especificación funcional y reglas

**Qué existe y qué no se debe romper.** Lo que falta está en
[ROADMAP.md](ROADMAP.md); **por qué es así** —lo descartado, lo medido y lo que se
pagó caro— en [DECISIONES.md](DECISIONES.md).

Este archivo es solo el índice. El contenido vive en [`specs/`](specs/), un archivo
por dominio. **La numeración de secciones no cambia al partirlo**: un `§4.12` en un
comentario del código sigue siendo válido, y esta tabla dice dónde cayó.

## Qué es sunrise

Planner diario personal y liviano, para una persona en una máquina. Datos 100%
locales en SQLite. Sin cuentas, sin servidor, sin IA.

Objetivo: **exactamente las features que se usan y ninguna más**. Es lo que explica
casi todas las decisiones que siguen: entre una función más y algo que se entienda de
una mirada, gana lo segundo.

**Stack:** Tauri v2 (Rust) + React 18 + TS + Vite, `pnpm`. SQLite vía `rusqlite`
(bundled), `rodio` para el sonido. `@dnd-kit`, `date-fns`, `zustand`,
`react-router-dom` (HashRouter), `react-markdown` + `remark-gfm`, `react-day-picker`,
`lucide-react`.

## Índice

### Cómo está armada

| Archivo | Qué responde |
|---|---|
| [§2 Arquitectura](specs/arquitectura.md) | Las dos ventanas nativas, las capas de Rust y de React, y los dos contratos del puente IPC que ningún compilador revisa. |
| [§3 Modelo de datos](specs/modelo-de-datos.md) | Las tablas, los enums, la semántica de cada campo de `tasks` y qué son los "channels". |
| [§5 Sincronización de estado](specs/sincronizacion.md) | Por qué cada ventana tiene su propio store y cómo se enteran una de otra: `dataVersion`, `localStorage` y las trampas del taxímetro. |
| [§6 Invariantes · §9 Deuda](specs/invariantes.md) | Las once reglas que no se rompen, y los tres lugares donde hoy se rompen a propósito. |

### Qué hace

| Archivo | Qué responde |
|---|---|
| [§4.1–4.5, 4.30 Tareas y tablero](specs/tareas-y-tablero.md) | El CRUD de tareas, la degradación diaria al backlog, la vista semana, Today, el modal de detalle, el backlog y las prioridades. |
| [§4.6–4.7, 4.15 Tiempo](specs/tiempo.md) | El timer y el taxímetro, Focus Mode y la weekly review — todo lo que cuenta, atribuye o agrega tiempo trabajado. |
| [§4.29 Objetivos semanales](specs/objetivos.md) | Qué es un objetivo, el reparto de horas por día y el histórico entre semanas. |
| [§4.12–4.13 Calendario](specs/calendario.md) | Los feeds ICS, el reconciler y el rail de la jornada. |
| [§4.14, 4.16 Rituales del día](specs/rituales.md) | La planificación diaria y la bitácora con el cierre del día. |
| [§4.8–4.11, 4.24, 4.28 App y ajustes](specs/app-y-ajustes.md) | Settings, atajos, cierre de la app, tema, Dev Tools y Apariencia. |
| [§4.25–4.27 Notificaciones](specs/notificaciones.md) | Las alertas, el aviso de próxima reunión y qué se configura de ellas. |
| [§4.17–4.23 Durabilidad y distribución](specs/distribucion.md) | Respaldo y restauración, inicio automático, el `.dmg`, dev vs producción, actualizaciones y el modal "Lo nuevo". |

### Cómo se ve y cómo se prueba

| Archivo | Qué responde |
|---|---|
| [§7 Convenciones de UI](specs/ui.md) | El idioma y la voz, el marco sin barra de título, la paleta medida en ΔE, y los patrones de componentes que ya fallaron de otra forma. |
| [§8 Tests](specs/tests.md) | Cómo se corren, dónde está cada área, los tests que protegen una decisión y lo que ningún test puede cubrir. |

El reparto sigue el mismo corte que la tabla de skills de `CLAUDE.md`, para que las
dos no digan cosas distintas sobre dónde vive cada dominio.

> **Los `Mej.N` que aparecen ahí adentro** son ítems del roadmap cerrados y podados.
> Su relato está en `git log -p docs/ROADMAP.md`; lo aprendido, en
> [DECISIONES.md](DECISIONES.md).
