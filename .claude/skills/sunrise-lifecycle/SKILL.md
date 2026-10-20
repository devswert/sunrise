---
name: sunrise-lifecycle
description: "Elegir, tomar, planificar e implementar una issue de sunrise (GitHub Project 3) hasta entregar el plan de QA. Úsala cuando el dev pregunte \"¿qué viene?\", \"¿qué hacemos?\", qué falta, qué hay en el backlog, cuando quiera tomar una issue o diga \"implementa N\". Refinar ideas es sunrise-shaping; mezclar a main tras el QA es sunrise-ship; publicar una versión es sunrise-release."
---

# sunrise lifecycle

Issues de `devswert/sunrise` en el [Project 3](https://github.com/users/devswert/projects/3).
Estados: `Shaping` → `Backlog` → `In progress` → `Done` → `Released`. IDs y comandos
del board: [board.md](board.md).

**El board es la fuente de verdad de lo que falta, no tu memoria.** Se lee cada vez:
la lista cambia con cada tanda de trabajo.

## 1. Elegir ("¿qué viene?")

1. Lista el board. Candidatas: `Backlog`, sin hijos abiertos. Orden: P1 → P2 → P3 →
   sin prioridad; dentro de la misma prioridad, `bug` antes que `enhancement`.
2. Si el dev ya nombró la issue, sáltate esto. Si no, responde con el menú (abajo) y
   espera la elección. **No empieces a trabajar**: varias veces eligió algo distinto
   a lo recomendado.
3. Si la elegida no pasa el checklist de Backlog (en `sunrise-shaping`), dilo y
   propón refinarla en vez de implementar. Nunca implementes desde Shaping.
4. Claim: Status → `In progress` (nunca una que ya está In progress). Desde el
   checkout principal: `bin/worktree N slug` (crea `../sunrisesama-issue-N`, rama
   `issue-N-slug`, con dependencias y `target/` compartidos). Si ya existe
   (`git worktree list`), reutilízala. Todo el trabajo va ahí: las ediciones con
   rutas absolutas a la worktree, y cada comando como `cd <worktree> && …`, porque
   el shell vuelve al checkout principal después de cada uno.

### El menú

Una línea con el total y el criterio de orden, y una tabla por grupo, en este orden.
Un grupo vacío se omite.

| Grupo | Qué entra |
|---|---|
| **Toca datos** | migraciones, atribución de tiempo, estados: un dato mal guardado se acumula, va primero aunque sea chico |
| **Bugs y fricciones** | `bug`, o lo que ya molesta con arreglo acotado |
| **Features** | lo que todavía no existe |
| **En Shaping** | lo que falta refinar, aparte: no se puede tomar todavía |

Columnas: `#N`, prioridad, size y **una descripción que sirva para decidir** (qué se
ve roto, de qué depende, qué parte ya existe), no el título repetido. Cierra con
**una recomendación tuya** y su motivo, a lo más dos opciones. Si al leer una issue
te convences de que ya está resuelta, dilo como observación y ofrece cerrarla.

## 2. Plan

1. Lee la issue (`gh issue view N --repo devswert/sunrise --comments`), la spec del
   área (el label de área nombra el archivo de `docs/specs/`), la skill de dominio
   que corresponda y el código. `Explore` para búsquedas amplias. Antes de
   "arreglar" algo retorcido, `docs/DECISIONES.md`.
2. Según el size:
   - **XS / S** sin cambio de spec ni migración: escribe el plan en 3–5 líneas y
     sigue sin esperar.
   - **M o más**, o si cambia una spec, una migración, el timer o `time_entries`:
     entrega el plan (archivos, enfoque, tests por cada caso, cambios de spec) con
     todas las dudas juntas, y espera el ok.

## 3. Implementar

1. Sigue `CLAUDE.md` y las skills de dominio. Delega ediciones mecánicas a
   `implementer` y corridas largas a `test-runner` solo cuando ahorre contexto.
2. Tests a la par: `repo.rs` para la lógica de datos, Vitest + RTL por cada
   comportamiento visible (skill `sunrise-tests`).
3. `bin/gates` hasta verde.
4. Revisión: lanza un `reviewer` nuevo con solo la ruta de la worktree, el link de
   la issue y el plan de QA (nunca la conversación).
   - Verifica cada BLOCKING contra el código. Corrige los reales y vuelve a correr
     gates. Máximo 2 rondas; si sigue con BLOCKING, para y explica.
   - SPEC_DRIFT: para, muestra la línea de la spec y la del código, y pregunta qué
     se actualiza.
5. Commit (Conventional Commits, en español) en la rama de la issue. En la rama no
   hace falta pedir permiso para commitear.

## 4. Entregar para QA

El QA es de a una worktree a la vez: `pnpm tauri dev` usa el puerto 1420 y la misma
`sunrise-dev.sqlite` en todas. Antes de levantarla, confirma que no haya otra
corriendo (`lsof -i :1420`).

Un solo mensaje, en este orden:

- **Funciona**: qué se puede hacer y dónde (`pnpm tauri dev` desde la worktree, o
  `pnpm dev` en el browser con `mockDb` si basta).
- **Cambios**: 3–5 bullets.
- **Plan de QA**: pasos numerados con resultado esperado, marcando cuáles ya cubre
  un test (nombre) y cuáles son solo humanos (ventana flotante, notificaciones,
  campana, DnD real, apariencia).
- **Reviewer**: NON_BLOCKING y HUMAN_CHECKS relevantes.

Con QA ok ("mándalo", "mezcla") → skill `sunrise-ship`.

## Reglas

- 1 issue = 1 rama = 1 worktree.
- Issue nueva desde el chat: créala y agrégala al board en Shaping con `triage`
  (idea del dev) o `to-complete` (solo título).
- Al cerrar una issue, lo que se aprendió —lo descartado, lo medido, lo que costó—
  va a `docs/DECISIONES.md` en el mismo PR. La issue no lleva el relato.
