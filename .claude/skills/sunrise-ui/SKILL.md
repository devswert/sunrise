---
name: sunrise-ui
description: Convenciones de UI de sunrise — autosave sin botón "Guardar", popovers en portal, selects con búsqueda, slots de altura fija, paleta pastel por tokens y el DnD del board. Úsala siempre que agregues o modifiques una vista, un modal, un popover, un select, una card, un formulario o estilos, y cuando algo se recorte, se desalinee entre columnas o no quepa en su contenedor. Varias de estas decisiones se tomaron después de que la alternativa obvia fallara, así que revísalas antes de resolver un problema de layout por tu cuenta.
---

# Convenciones de UI de sunrise

**Las reglas están escritas en dos lugares y este archivo no las repite:**

- **[`docs/specs/ui.md`](../../../docs/specs/ui.md) (§7)** — el marco de la ventana (sin barra de título,
  `--titlebar-h`, el rail colapsable y sus dos anchos), la paleta y sus tokens, las
  barras de scroll dibujadas a mano, la marca, las clases compartidas entre
  features, y el resumen de cada convención.
- **`docs/specs/tareas-y-tablero.md` §4.3** — el DnD del board completo: la cascada
  de colisión, `resolveDrop`, el reorden optimista, el `DragOverlay`, la estrategia
  del `SortableContext`, los días plegados y el posicionamiento del scroll.
- **`docs/DECISIONES.md` §7** — por qué cada una es así, con los números de las
  que se midieron y las alternativas que se descartaron.

Acá está la **postura**, el inventario de lo que ya existe, y las trampas que no
están escritas en ningún otro lado.

## La postura

**La distribución ya está decidida y no se rediseña sobre la marcha.** Ante una
duda de layout, la respuesta sale de lo que ya existe —la vista hermana, la card
equivalente, el modal que resuelve el mismo problema— y no de una variante
"mejorada" inventada para el caso. Es una app de uso diario: la consistencia entre
vistas vale más que la mejor idea suelta, porque la mano ya aprendió dónde está
todo. **El usuario insiste en esto de forma consistente.**

- **Densidad alta y cromo bajo.** Nada de cajas dentro de cajas: las columnas se
  separan con una línea de 1px, no con tarjetas. Los controles aparecen al hover en
  vez de ocupar espacio permanente.
- **El texto es el contenido.** El título de una tarea manda sobre todo lo que lo
  rodea; los números van en tabulares y en 11–12px, al costado, sin competir.
  **Dónde se lee entero depende del lugar**: en el detalle sí, siempre —el campo
  crece con el texto hasta cinco líneas y después scrollea—; en una card de lista
  se corta en **dos líneas con elipsis**, con el texto completo en el `title`
  nativo. Una columna de ancho fijo no puede absorber un título arbitrario sin
  desarmar el ritmo de las filas, y el largo es información del detalle, no de la
  lista. Al recortar, el `word-break` se queda junto al clamp: sin él un token sin
  espacios se sale de ancho en vez de recortarse.
- **El color clasifica, nunca decora.** Dice a qué canal pertenece algo o cómo va la
  capacidad. Un color sin significado no va.
- **Nada pide confirmación salvo lo irreversible.** Todo se autoguarda y todo se
  puede deshacer moviendo la tarea de vuelta.
- **Cada vista responde una pregunta.** Si una vista necesita un párrafo para
  explicarse, está haciendo dos cosas.
- **Dos caminos para lo mismo obligan a mantener los dos.** Es el argumento que ha
  sacado botones que ya funcionaban. Antes de agregar un atajo a algo que ya se
  puede hacer, mira si no estás duplicando el gesto.

**El texto va en español de Chile: de tú, nunca de vos.** Se colaron formas de
voseo dos veces, así que al escribir un texto nuevo, releelo buscando imperativos y
segundas personas. Las excepciones —los nombres del sidebar, que se quedan en
inglés— están en `docs/specs/ui.md` (§7). Para fechas usa los helpers de `src/lib/date.ts`: el
locale de `date-fns` va **por llamada** y es fácil olvidarlo, y
`react-day-picker` necesita su `locale={es}` en cada `<DayPicker>`.

## Componentes que ya existen — úsalos, no los reimplementes

| Componente | Para qué |
|---|---|
| `src/components/Dialog.tsx` | todo diálogo chico de confirmar o avisar |
| `src/components/Popover.tsx` | todo popover flotante |
| `src/components/SearchSelect.tsx` | todo select con búsqueda (channel, objetivo), simple o **multi** con `selected` |
| `src/components/TimePicker.tsx` | elegir duraciones (planned / actual) |
| `src/components/ThemeToggle.tsx` | switch de tema (solo ese: tiene sol y luna dibujados) |
| `src/components/Switch.tsx` | cualquier otro interruptor on/off |
| `src/components/Spinner.tsx` | el icono de "esto está corriendo" |
| `src/components/SunriseMark.tsx` | la marca dentro de la app |
| `src/components/plainInput.ts` | `PLAIN_INPUT`, para un campo que no es prosa |
| `src/features/week/DayColumn.tsx` | columna de un día (la reusa Today) |
| `src/features/week/TaskCardContent.tsx` | contenido de la card |

`Dialog` existe porque el patrón estaba copiado cinco veces **y faltaba en dos**:
la confirmación de restaurar un respaldo, la acción más destructiva de la app, no
se cerraba con Escape. Eso es lo que pasa con un patrón que se copia en vez de
compartirse. **No lo uses para un modal que no es una confirmación** — `TaskModal`
es una vista y `AddFeedModal` un formulario: tienen su propio teclado y solo
comparten el `.modal-overlay`.

**Si un diálogo tiene que verse distinto, va una variante y no un panel nuevo.**
`Dialog` acepta `variant`, que solo agrega `dialog--<variant>`; los estilos los pone
la feature en su propio CSS (el amanecer del modal "Lo nuevo" vive en
`updates.css`). Copiar el componente para cambiarle el aspecto es volver a la
trampa de arriba. Y ojo con el orden: `Dialog` dibuja el `<h2>` **antes** que sus
hijos, así que un bloque que va arriba del título se sube con `order: -1` —el
diálogo es un flex en columna— y no metiéndolo dentro del encabezado.

**Lo que está corriendo cambia de icono, no gira el suyo.** `<Spinner>` va
**reemplazando** el icono en reposo del botón:

```tsx
{sincronizando ? <Spinner size={13} /> : <CalendarSync size={13} aria-hidden />}
```

Antes cada botón giraba su propio icono y se leía como un chiste — el sync hacía
dar vueltas un calendario, que rotando no significa nada. El anillo abierto sí es
la forma que todo el mundo lee como "espera".

**`.is-spinning` lleva `overflow: visible`, y sacarlo devuelve un bug sutil.**
Un `<svg>` recorta por defecto. En reposo no se nota, porque los iconos de lucide
caben en su viewBox de 24 — pero **girando, la tinta que estaba en las esquinas
sale por los lados**, y el borde se la come y se la devuelve dos veces por
vuelta. En `RefreshCw` las puntas de flecha quedan a 13.7 unidades del centro
contra las 12 que mide el medio viewBox: medido, 8.6% de variación de tinta a lo
largo del giro. Se lee como que el icono late.

**Y hay algo que el CSS no arregla, así que no lo busques ahí.** Una marca
asimétrica que gira lleva su centro de masa fuera del centro de rotación, y la
mancha orbita aunque la caja no se mueva un píxel —está medido: la caja del
`<svg>` rotada 45° tiene exactamente el mismo centro que en reposo—. En el
`Loader2` esa órbita es del **21% del ancho del icono**, igual a 13px que a 96px,
igual con recorte que sin él. Si el spinner se ve "bailar" al lado del texto
quieto del botón, esa es la razón, y la salida es cambiar la forma (una marca
simétrica a 180°, como `RefreshCw`), no seguir tocando estilos.

La animación se apaga con `prefers-reduced-motion`, así que **el estado tiene que
estar también en palabras**: el texto del botón ("Sincronizando…", "Respaldando…",
"Agregando…") y, en los botones que no tienen texto, `aria-busy` más un `title`
que lo diga. Un icono quieto y nada más no cuenta nada.

La excepción es el updater, que **no** lleva spinner a propósito: ahí manda la
barra de progreso, que además dice cuánto queda.

**Para pisar algo del componente compartido, la variante necesita dos clases**
(`.dialog.dialog--loquesea`): el CSS de la feature se importa **antes** que
`dialog.css`, así que con una sola clase gana el `.dialog` de allá por orden de
carga. El síntoma es sutil —un padding que reaparece, un radio que no se aplica— y
no se parece a un problema de especificidad.

## Autosave: la mecánica

Los modales de detalle guardan solos, y `TaskModal` es el patrón de referencia:

- **`commit(patch)`** guarda de inmediato: selects, checks, fechas — todo lo que se
  percibe como una decisión puntual.
- **`commitDebounced(patch)`** guarda con **500 ms** de debounce: los campos de
  texto.
- **`flush()`** escribe ya lo que el debounce tuviera pendiente, y lo llama todo lo
  que cierra el modal (⌘Enter explícitamente, y el cleanup al desmontar para
  Escape / click afuera / la X).

**La trampa está en `flush`.** Con debounce, cualquier cierre es una carrera contra
el temporizador: el cleanup **cancelaba** el `setTimeout`, así que escribir y cerrar
en el mismo gesto descartaba la edición sin decir nada. Si agregas otro campo con
debounce, **acumula su patch en `pendienteRef`** en vez de cerrarlo dentro del
`setTimeout`, o `flush` no va a tener qué escribir.

El feedback es el flash "Guardado" más el texto fijo del footer. **No agregues un
botón Guardar**: el usuario lo ha pedido explícitamente más de una vez. Y después de
guardar, `bumpData()` (ver la skill `sunrise-sync-ventanas`).

**Un ritual puede terminar con un botón, pero ese botón no guarda: cierra el
ritual.** "Empezar el día" sella la marca, tira confeti y navega. Si te encuentras
uno, no lo conviertas en un save ni lo borres por inútil — nómbralo como lo que hace.

## Trampas que solo están acá

**Los atajos de un modal van en `window`, no en su `onKeyDown`.** Un `onKeyDown` en
el div del modal solo se dispara si el `target` está **dentro**, y en esta app eso
falla por tres caminos, los tres normales:

1. abrir con el mouse deja el foco en la tarjeta de atrás, que no es descendiente
   del modal;
2. los popovers viven en un portal sobre `body`, así que con un picker abierto la
   tecla no pasa por el modal;
3. un click en cualquier zona no enfocable del modal manda el foco al `body`.

En los tres, Escape y ⌘Enter quedaban muertos sin ningún síntoma que apuntara al
foco. Cuélgalos de `window` en un `useEffect`, en **fase de burbuja** para que un
control interno pueda quedarse con la tecla antes (`SearchSelect` corta el Enter con
`stopPropagation`), y saltea el handler si el diálogo de salida está arriba.

**Una lista corta de cosas comparables va en filas, no en cards en grilla.** Los
objetivos de la semana pasaron por dos columnas de cards y no funcionó: con tres o
cuatro ítems las cards desperdician ancho, obligan a saltar de una a otra para
comparar el avance, y traen el problema de las alturas desiguales (que se intentó
resolver dos veces: `align-items: start` deja el borde dentado, y el `stretch` con
`margin-top: auto` mejora pero no convence). En filas de una línea, las barras
quedan **una debajo de la otra** —que es cómo se comparan— y todas miden lo mismo
por construcción. El detalle se despliega. Y **la barra lleva ancho fijo**: una que
se estire con el largo del título haría ver distintos dos avances iguales.

**El token del texto es `--ink`, no `--text`.** `--text` no existe, y escribirlo no
deja síntoma: `color` es heredada, así que un `var()` inválido cae en "hereda del
padre" y casi siempre se ve bien. Sobrevive hasta que alguien pone ese texto sobre
un fondo distinto del de su contenedor. Los tres del texto son `--ink`, `--muted` y
`--faint`.

**Texto sobre un fondo tintado va en `--ink`, no en `--muted`.** `--muted` está
pensado para el fondo de la superficie; sobre un pastel se cae. En la tira de
semanas del planning, medido en oscuro con el tinte al techo, daba 2.12:1 contra
4.93:1 con `--ink`. Y si el tinte es un valor continuo, **acótalo**: el techo lo
manda el tema oscuro, donde más tinte tapa el texto claro en vez de ayudarlo.

**Un `input` no hereda la tipografía.** Todo campo de texto necesita su
`font-family: var(--font-title)` o `var(--font-body)` explícito, o sale en la
fuente por defecto del webview mientras el resto de la app usa Sora/Manrope. Se
pagó en el título del modal de objetivo, que es lo primero que se ve al abrirlo.

**Para un select de varios, `SearchSelect` recibe `selected: Set<string>` y quien
lo monta deja el popover abierto** (los filtros de la weekly review, §4.29). No
escribas un dropdown multi aparte: duplicaría la búsqueda, el teclado y el foco
dentro del portal, que es donde están las trampas. El componente no guarda estado
— manda `onSelect` por cada click y quien lo usa prende o apaga.

**Y enfoca el modal al abrirlo** (`tabIndex={-1}` + `focus()` en un efecto con deps
vacías). No es solo accesibilidad: las cards del board llevan los `listeners` de
`useSortable`, y el `KeyboardSensor` de dnd-kit arranca un arrastre con Enter o
Espacio **sin mirar los modificadores**. Con el foco en una card, ⌘Enter levantaba
la tarjeta en vez de cerrar el modal. Cualquier overlay que se abra encima del board
tiene el mismo problema.

**No le pongas su propio efecto de foco a un picker nuevo.** `Popover` monta con
`visibility: hidden` mientras mide, y `focus()` sobre un elemento invisible no hace
nada; el `Popover` enfoca el primer `input`/`textarea` cuando ya tiene posición. Lo
peligroso es que **parece que funciona**: jsdom acepta el foco en un elemento oculto,
así que el test pasa.

**Una fila con varios controles no se guarda en el blur de un campo**, y hacen falta
**dos defensas** — `onBlur` en la fila mirando `relatedTarget`, y `preventDefault` en
el `mousedown` del control que abre un popover (`keepFocus` en `ColorDot`). Con solo
la primera el bug puede seguir vivo con la suite en verde. Va como **opt-in**: las
filas de *renombre* dependen del blur contrario. Y si la fila espera un `await` para
crearse, guarda un `ref` que impida el alta doble.

**Testea eso con `userEvent`, nunca con `fireEvent`.** Lo que rompe el alta es el
movimiento del foco, y `fireEvent.click` no mueve el foco: el test pasa igual con el
bug puesto. Míralo rojo antes de arreglarlo.

**Un aviso que afirma algo tiene que poder desmentirse.** El de "ya planificaste
hoy" decía el día y solo se podía cerrar, y la marca se escribe con gestos que el
usuario no reconoce como planificar. Dos cosas lo arreglan y son barajables a
cualquier aviso parecido: que diga **cuándo** —con la hora sacada de lo guardado, no
del reloj de ahora— y que ofrezca borrar la marca. El desmentido va como texto
(`.dialog__deny`), debajo del cuerpo y arriba de los botones: corrige la frase que
afirma en vez de sumar una tercera acción.

**Un `flex-basis` no acota un flex item: lo acota su `min-width`.** El mínimo automático
de un flex item es `min-width: auto` —el ancho mínimo de su contenido— y le gana al
`flex-basis`. La ficha del día (`.dia__der`, `flex: 0 0 250px`) se estiraba al doble con
un título largo en el timeline, que va en `nowrap`, y le comía el ancho a la columna de al
lado. Si pusiste un ancho en un flex item y no se respeta, la causa es esa. Y una lista de
texto lleva **medida de lectura**, no el ancho de la columna: `.hitos` corta en 520px.

**Un slot de altura fija en vez de un render condicional**, cuando algo aparece solo
en algunas columnas de una fila de elementos comparables. Si no, esa columna empuja
su contenido y las listas quedan desalineadas.

**Un destino de drop no se ilumina si va a rechazar el drop**, y eso aplica a cada
guard nuevo. Misma familia: una columna no se ilumina si la card ya está en ella.

**Los controles al hover no pueden tener huecos muertos** entre el disparador y el
panel, entran con `transform` y `position: absolute` (si empujan, la caja se
reacomoda al pasar el mouse), y necesitan `:focus-within` en el selector que los
revela o quedan botones alcanzables con Tab estando invisibles. En el taxímetro **no
se usa `:hover` de CSS** — el porqué está en la skill `sunrise-sync-ventanas`.

**No pongas todas las opciones a la vista.** Muestra la elegida y deja el resto en un
popover. El caso real: cada categoría en Settings mostraba las ocho muestras de
color, y con ocho categorías eran 64 puntos compitiendo con los nombres, que es lo
que uno va a leer ahí. Con 24 colores serían 192.

**Un atajo junto a un ítem clicable va `aria-hidden`**, con el atajo real en
`aria-keyshortcuts`. Si lo dejas como texto dentro del link, el nombre accesible pasa
a ser "Focus ⌘ 3" en vez de "Focus": molesta a un lector de pantalla y rompe los
tests que buscan por nombre.

## Antes de tocar la paleta o un token

Las reglas completas están en `docs/specs/ui.md` (§7) y los números en DECISIONES §7. Lo que hay
que saber antes de abrirlos:

- **Colores por token CSS, nunca hex en el componente.** La lista vive en
  `src/lib/palette.ts` y son **24, en tono medio, no pastel**.
- **Renombrar o quitar un color rompe las categorías guardadas** — `categories.color`
  guarda el nombre del token, así que queda un `var(--loquesea)` inexistente: un punto
  transparente, sin un error en consola. Agregar sí es compatible.
- **No elijas un color a ojo.** Tiene que sobrevivir a cuatro usos y son los tintes
  los que traicionan: dos matices que se distinguen a full colapsan al 18%.
- **La pregunta para un fill es "¿lleva texto encima?"**, no "¿es un fondo?". Con
  texto va un `-solid` fijo; sin texto sigue al tema.
- **Un botón relleno no se apaga con `opacity`**: acerca el fondo y el texto a la
  superficie a la vez y el contraste se derrumba. El `:disabled` declara su par.
- **Confirmar es salvia, nunca naranjo.** El damasco es el mismo tono que "te
  pasaste", así que un aceptar en naranjo se lee como error.
- **Los gráficos se dibujan con CSS, no con una librería.** `recharts` está instalado
  y sin uso. En SVG el color va en `style` y nunca como atributo: los atributos de
  presentación no resuelven `var()`.
- **Al tocar layout, acuérdate de que la barra de scroll ocupa 12px permanentes y de
  un solo lado**, y que `scrollbar-gutter: stable both-edges` no es la salida — el
  webview de macOS no lo honra, aunque el navegador sí. Ya se probó.

## Tests de UI

Vitest + RTL. Los tests se apoyan en `aria-label` y roles, **no en clases CSS**.
Mantén los `aria-label` de los controles (`"Completar tarea"`, `"Pausar"`, `"Cambiar
channel"`…): son el punto de agarre de los tests y además lo correcto para
accesibilidad.

El idioma de código e identificadores lo fija CLAUDE.md; no se repite acá.
