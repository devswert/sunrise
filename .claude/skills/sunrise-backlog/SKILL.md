---
name: sunrise-backlog
description: Responde qué queda por hacer en sunrise — lee docs/ROADMAP.md y devuelve los ítems abiertos en tablas por categoría, ordenados por lo que conviene tomar primero, con una recomendación al final. Úsala cuando el dev pregunte qué falta, qué sigue, qué hay en el backlog, cuál es el próximo ítem del roadmap, o cuando termine una tanda de trabajo y haya que elegir la siguiente. También sirve como paso previo a "vamos con el siguiente punto": es el menú del que se elige.
---

# Qué queda por hacer en sunrise

**El ROADMAP es la fuente de verdad, no tu memoria.** Este archivo describe cómo
armar la respuesta; el contenido se lee cada vez de `docs/ROADMAP.md`, porque la
lista cambia con cada tanda de trabajo y un inventario recordado envejece en
horas.

## Los pasos

1. **Lee el estado de los milestones** (la tabla del principio de
   `docs/ROADMAP.md`). Si alguno tiene fases abiertas, esas van **primero y
   aparte**: son trabajo comprometido, no mejoras opcionales. Con todos en ✅, el
   roadmap se reduce a las mejoras y a las verificaciones pendientes.
2. **Saca los ítems abiertos**, que son los `🔵`:

   ```bash
   grep -oE "^### Mej\.[0-9]+ 🔵.*" docs/ROADMAP.md
   ```

   Los tres marcadores significan cosas distintas y confundirlos hace mentir a la
   respuesta: **`🔵` abierto**, **`✅` hecho** (esos ya tienen su relato escrito
   abajo), **`⬛` retirada** — decidida como fuera de alcance, con el texto
   original guardado en un `<details>`. Una retirada **no** es pendiente.
3. **Lee cada ítem abierto entero**, no su título. El título dice el qué; el
   cuerpo dice por qué importa, qué lo bloquea, cuánto hay hecho ya y qué se
   decidió al respecto. Eso es lo que hace útil la tabla.
4. **Cuenta cuántos son** en el momento de responder. No arrastres un número de
   una conversación anterior.
5. **Revisa la sección de verificación end-to-end** (al final del archivo): lo que
   sigue marcado como sin comprobar dentro de la app instalada va en su propio
   bloque. No son ítems de mejora, pero son pendientes reales.

## La forma de la respuesta

Un encabezado, una línea con el total y el criterio de orden, y **una tabla por
categoría**. Dos columnas: el ítem en negrita y su descripción.

```markdown
# Lo que queda en el backlog

Trece ítems, ninguno bloqueante. Los ordeno por lo que yo tomaría primero, no por
número.

## Toca datos — el único de esta clase

| | Qué |
|---|---|
| **Mej.14** | **Un ajuste manual de tiempo se acredita al día en que lo escribes.** … |
```

### Las categorías, en este orden

| Categoría | Qué entra | Por qué va donde va |
|---|---|---|
| **Toca datos** | lo que escribe o corrige la base: migraciones, atribución de tiempo, estados | Un dato mal guardado se acumula: cada día que pasa hay más historial que corregir. Va primero aunque sea chico. |
| **Bugs y fricciones chicas** | lo que ya molesta, con arreglo acotado | Se pagan solas: cuestan poco y se sienten en cada uso. |
| **Features** | lo que todavía no existe | Ordenadas entre sí por cuánto hay hecho y qué desbloquean. |
| **Herramientas, no producto** | lo que sirve para desarrollar o probar, no para usar la app | Se separan porque compiten mal contra una feature: parecen postergables y a veces desbloquean otra cosa. |
| **Fuera de la lista, pero pendiente** | verificaciones sin hacer, deuda sin ítem propio | Si no se nombran, no existen. |

Si una categoría queda vacía, **se omite** — no dejes una tabla con un guion.
Si una tiene un solo ítem, dilo en el título (como *"el único de esta clase"*):
que sea el único es información.

### Dentro de cada tabla

- **Ordena por lo que conviene tomar primero**, y dilo explícitamente en la línea
  del total. Por número es tentador y no significa nada: la numeración es el orden
  en que se anotaron.
- **Una descripción que sirva para decidir**, no el título repetido. Lo que la
  hace útil: qué se ve roto, qué parte ya está hecha (*"media hecha:
  `BacklogColumn` ya existe"*), de qué depende (*"depende de Mej.2"*), y el
  efecto lateral que habría que decidir. Si un ítem **se puede cerrar leyéndolo**
  —porque su pregunta ya está respondida en su propio texto—, dilo: es el más
  barato de todos.
- **Negrita solo en lo que cambia la decisión.** Si todo va en negrita, no hay
  jerarquía.

### El cierre

Termina con **una recomendación tuya**, con su motivo, y a lo más dos opciones.
Un menú de trece ítems sin recomendación devuelve el trabajo de decidir. El
motivo suele ser uno de estos: están en el mismo archivo, cierra el que ensucia
datos, o desbloquea otro.

## Lo que no hace esta skill

- **No empieza a trabajar.** Devuelve el menú y espera. La elección es del dev, y
  varias veces eligió algo distinto a lo recomendado.
- **No reordena el ROADMAP** ni cambia marcadores. Si al leer un ítem te
  convences de que ya está resuelto por trabajo posterior, **dilo en la respuesta
  como observación** y ofrece cerrarlo; editar el archivo es otra tanda, con su
  commit.
- **No inventa ítems.** Si algo que falta no está en el ROADMAP, la respuesta lo
  puede mencionar en el último bloque, pero anotarlo como ítem se pide aparte.
