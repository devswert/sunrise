---
name: sunrise-shaping
description: "Refinar (shaping) issues de sunrise en el GitHub Project 3 hasta dejarlas listas en Backlog: descripción, labels, size, prioridad y sub-issues. Úsala cuando el dev diga \"iteremos N\", \"afinemos\", \"shaping\", o quiera anotar una idea o crear una issue nueva."
---

# sunrise shaping

IDs y comandos del board: [../sunrise-lifecycle/board.md](../sunrise-lifecycle/board.md).

## Pasos

1. Si el dev no nombró la issue, lista lo que está en Shaping: por prioridad y
   luego `triage` antes de `to-complete`.
   - `triage`: el dev escribió la idea; complétala **respetándola**.
   - `to-complete`: solo un título; propón el alcance desde las specs y el código.
2. Lee la issue, comentarios, padre e hijos, la spec del área (`docs/specs/`), la
   skill de dominio que corresponda y el código. Antes de proponer algo que se ve
   obvio, busca el tema en `docs/DECISIONES.md`: puede estar descartado con motivo.
3. En **un solo mensaje**: el borrador completo (plantilla abajo, labels, Size,
   Priority, sub-issues si es más grande que L, cambio de spec si define una regla
   nueva o contradice `docs/specs/`) y las dudas que falten, cada una con tu
   recomendación.
4. Con la aprobación explícita: aplica todo, verifica el checklist y mueve a Backlog.

## Plantilla de descripción (español, corta)

```markdown
## Objetivo
1–2 frases: qué problema resuelve y en qué momento del día se nota.

## Comportamiento esperado
- Vista, qué se ve, qué pasa al actuar, estados vacíos y errores.
- Qué pasa en la otra ventana (flotante) si aplica.

## Fuera de alcance
- Lo que no entra (o "- nada relevante").

## Criterios de aceptación
- [ ] Verificables por una persona o un test.
- [ ] Lógica de datos con test en `repo.rs`; UI con test en Vitest + RTL.

Specs: `docs/specs/…` · Parent: #N (si es sub-issue)
```

## Checklist para mover a Backlog

- [ ] Descripción con la plantilla (no un placeholder).
- [ ] Un label de área (los de `board.md`) + exactamente un tipo (`enhancement` o `bug`).
- [ ] Size y Priority.
- [ ] Sin `triage` / `to-complete`.
- [ ] Si tiene hijos: todos pasan este checklist (hijos primero, padre al final).
      Se toman los hijos, no el padre.

No inventes labels; si falta uno, pregunta antes de `gh label create`. Prefiere
issues reales sobre draft items del Project. El repo es **público**: nada de links
internos, datos personales ni nombres de terceros en el cuerpo.
