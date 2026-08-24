---
name: sunrise-ui
description: Convenciones de UI de sunrise — autosave sin botón "Guardar", popovers en portal, selects con búsqueda, slots de altura fija, paleta pastel por tokens y el DnD del board. Úsala siempre que agregues o modifiques una vista, un modal, un popover, un select, una card, un formulario o estilos, y cuando algo se recorte, se desalinee entre columnas o no quepa en su contenedor. Varias de estas decisiones se tomaron después de que la alternativa obvia fallara, así que revísalas antes de resolver un problema de layout por tu cuenta.
---

# Convenciones de UI de sunrise

**La distribución ya está decidida y no se rediseña sobre la marcha.** Ante una
duda de layout, la respuesta sale de lo que ya existe en el proyecto —la vista
hermana, la card equivalente, el modal que resuelve el mismo problema— y no de una
variante "mejorada" inventada para el caso. Es una app de uso diario: la
consistencia entre vistas vale más que la mejor idea suelta, porque la mano ya
aprendió dónde está todo. El usuario insiste en esto de forma consistente.

En concreto, el estilo de la app es:

- **Densidad alta y cromo bajo.** Nada de cajas dentro de cajas: las columnas se
  separan con una línea de 1px, no con tarjetas. Los controles aparecen al hover
  en vez de ocupar espacio permanente.
- **El texto es el contenido.** Los títulos de tarea se leen enteros; los números
  (tiempos, capacidad) van en tabulares y en 11-12px, al costado, sin competir.
- **Pastel para clasificar, nunca para decorar.** El color dice a qué canal
  pertenece algo o cómo va la capacidad. Un color sin significado no va.
- **Nada pide confirmación salvo lo irreversible.** Todo se autoguarda, todo se
  puede deshacer moviendo la tarea de vuelta.
- **Cada vista responde una pregunta.** Si una vista necesita un párrafo para
  explicarse, está haciendo dos cosas.

## La app le habla al usuario en español **de Chile**

**Todo texto que se muestre va en español**: labels, placeholders, `aria-label`,
`title`, mensajes de error, el historial de tareas, los nombres de los días y de
los meses. Estuvo mezclado durante Fase 0 y se unificó de una vez.

Las excepciones son deliberadas y son pocas:

- **El sidebar completo** — Home, Today, Focus, los tres ítems de Daily, los dos
  de Weekly, Backlog y los rótulos "Daily rituals" / "Weekly rituals". Son los
  nombres propios de la app, no etiquetas traducibles: "Daily shutdown" es el
  nombre del ritual, igual que "Focus". La única
  que sí se traduce es **Settings → Configs**, y el `<h1>` de esa vista dice lo
  mismo que el link: un sidebar y un título que no coinciden se leen como dos
  pantallas distintas.
- **Los títulos de vista que espejan una entrada del sidebar** (`Placeholder`,
  el `<h1>` de Backlog y de Weekly planning). Si el sidebar dice "Weekly
  planning" y la página dice "Planificación semanal", se lee roto.
- **Los formatos numéricos** (`hms`, `formatMinutes`, `shortDuration`) no tienen
  idioma; no los toques.
- **El menú nativo de macOS** sigue en inglés porque lo genera
  `Menu::default` de Tauri: traducir solo nuestro ítem de Quit lo dejaría peor
  que dejarlo entero.

**Y es español de Chile: se habla de tú, nunca de vos.** "puedes", "quieres",
"incluye", "sube", "mira", "cierras" — no "podés", "querés", "incluí", "subí",
"mirá", "cerrás". Vale para la pantalla, los `aria-label` y el texto de las
notificaciones nativas. Se colaron formas de voseo dos veces (M3.6 las dos), así
que **al escribir un texto nuevo, releelo buscando imperativos y segundas
personas** antes de darlo por hecho. "Acá", "recién" y "de una" sí son de la casa.

Para las fechas usa los helpers de `src/lib/date.ts`, que ya llevan el locale.
No formatees con `date-fns` a mano en una vista: el locale va **por llamada** y
es fácil olvidarlo. Y ojo con los componentes de terceros que traen su propio
texto — `react-day-picker` necesita `locale={es}` en cada `<DayPicker>`.

## Componentes que ya existen — úsalos, no los reimplementes

| Componente | Para qué |
|---|---|
| `src/components/Dialog.tsx` | todo diálogo chico de confirmar o avisar |
| `src/components/Popover.tsx` | todo popover flotante |
| `src/components/SearchSelect.tsx` | todo select con búsqueda (channel, objetivo) |
| `src/components/TimePicker.tsx` | elegir duraciones (planned / actual) |
| `src/components/ThemeToggle.tsx` | switch de tema (solo ese: tiene sol y luna dibujados) |
| `src/components/Switch.tsx` | cualquier otro interruptor on/off |
| `src/components/SunriseMark.tsx` | la marca dentro de la app |
| `src/features/week/DayColumn.tsx` | columna de un día (la reusa Today) |
| `src/features/week/TaskCardContent.tsx` | contenido de la card |

## Autosave, nunca un botón "Guardar"

Los modales de detalle guardan solos. `TaskModal` es el patrón de referencia:

- **`commit(patch)`** guarda de inmediato: selects, checks, fechas — todo lo que
  el usuario percibe como una decisión puntual.
- **`commitDebounced(patch)`** guarda con **500 ms** de debounce: campos de texto
  (título, notas).
- **`flush()`** escribe ya lo que el debounce tuviera pendiente, y lo llama todo
  lo que cierra el modal (⌘Enter explícitamente, y el cleanup al desmontar para
  Escape / click afuera / la X). Con debounce, cualquier cierre es una carrera
  contra el temporizador: el cleanup **cancelaba** el `setTimeout`, así que
  escribir y cerrar en el mismo gesto descartaba la edición sin decir nada. Si
  agregas otro campo con debounce, acumula su patch en `pendienteRef` en vez de
  cerrarlo dentro del `setTimeout`, o `flush` no tendrá qué escribir.
- El feedback es el flash **"Guardado"**, más el texto fijo "Los cambios se
  guardan automáticamente" en el footer.
- El footer solo tiene **Eliminar**, con confirmación en dos pasos.

No agregues un botón Guardar ni un formulario plano: el usuario lo ha pedido
explícitamente más de una vez. Si un cambio necesita confirmación, es porque es
destructivo, y el patrón para eso es el de Eliminar.

**Color de los botones**: confirmar es **salvia** (`.btn-primary`, `--sage-solid`
con texto blanco — **no** `--sage` con `--sage-ink`, que da 2.0 de contraste),
nunca naranjo. El damasco de la paleta es el mismo tono que
`--cap-over` ("te pasaste"), así que un aceptar en naranjo se lee como error. El
naranjo queda para lo que avisa. Todo botón de acción lleva su icono de
`lucide-react` además del texto.

**La única excepción no es una excepción**: un ritual puede terminar con un
botón, pero ese botón **no guarda** —cierra el ritual—. "Empezar el día" en
`DailyPlanningView` sella `planned_at`, tira confeti y navega a la semana; todo
lo que se editó ya se había guardado solo. Si te encuentras uno de estos, no lo
conviertas en un save ni lo borres por inútil: nómbralo como lo que hace (SPECS
§4.14).

Después de guardar, llama **`bumpData()`** para que el resto de la app (incluido
el taxímetro) se entere. Ver la skill `sunrise-sync-ventanas`.

### Una fila con varios controles no se guarda en el blur de un campo

El autosave por `onBlur` es correcto para un campo suelto, y **destruye una fila
que tiene varios controles**: al pasar del nombre al segundo control, el blur del
primero confirma el alta y desmonta la fila a mitad de camino. Pasó dos veces —la
fila de feeds al pasar de Nombre a URL (SPECS §3.1) y la de alta de canales al ir
a elegir el color (Mej.7)—, y el síntoma no se lee como un bug de foco: la fila
"salta" y lo que estabas eligiendo se pierde.

El patrón, en `AddRow` de `SettingsView.tsx`, son **dos defensas**:

1. **`onBlur` en la fila, no en el campo**, y solo si el foco se fue de verdad:
   `if (e.currentTarget.contains(e.relatedTarget)) return;`. Cubre Tab hacia
   afuera y el click en otra parte.
2. **`preventDefault` en el `mousedown`** del control que abre un popover
   (`keepFocus` en `ColorDot`), que es la que sostiene el caso real: **si el click
   en el botón no lo enfoca** —se reporta de WebKit y no está verificado acá— el
   foco se va al `body` y el blur llega con `relatedTarget` en `null`,
   indistinguible de irse de la fila. El `preventDefault` no depende del motor: en
   cualquiera deja el foco donde está, y con solo la defensa 1 el bug puede seguir
   vivo con la suite en verde.

Va como **opt-in**, no por defecto: las filas de *renombre* dependen del blur
contrario —el click en el punto de color es lo que saca el foco del nombre, y por
eso se guarda—.

Y si la fila puede esperar un `await` para crearse, guarda un `ref` que impida el
alta doble: sigue montada mientras espera.

**Testéalo con `userEvent`, nunca con `fireEvent`.** Lo que rompe el alta es el
movimiento del foco, y `fireEvent.click` no mueve el foco: el test pasa igual con
el bug puesto. Míralo rojo antes de arreglarlo.

### El corrector ortográfico va solo donde hay prosa

En macOS el webview corrige, subraya en rojo y **capitaliza al salir del campo**
todos los `input`, y llega a cambiar lo escrito. Un campo que no es prosa spreadea
`PLAIN_INPUT` (`src/components/plainInput.ts`), que apaga los tres:
`spellCheck`, `autoCorrect`, `autoCapitalize`.

Se deja el corrector **solo en el título y las notas de una tarea**. Para un campo
nuevo, la pregunta no es si molesta el subrayado: es si alguien escribiría ahí una
frase. Nombres, horas, números, URLs y los buscadores de los dropdowns no.

## El diálogo chico es `Dialog`, no un patrón para copiar

`Dialog.tsx` es dueño del overlay, de `role="alertdialog"` + `aria-modal`, del
`stopPropagation`, del foco inicial y **de las teclas** (en `window`, con
`capture`, por lo que dice la sección de acá abajo). Le pasas `title`, `label`,
`actions`, el cuerpo como children, y opcionalmente `hint` e `icon` —con `icon`
sale la variante hero, centrada, de los avisos de ritual—.

Existe porque estaba copiado cinco veces **y faltaba en dos**: la confirmación de
restaurar un respaldo, la acción más destructiva de la app, no se cerraba con
Escape. Eso es lo que pasa con un patrón que se copia en vez de compartirse.

Dos props que son decisiones, no configuración:

- **`onClose` ausente = no se puede cerrar**, ni con Escape ni con el click
  afuera. Es lo que necesita un diálogo a mitad de algo irreversible.
- **`onEnter` va aparte del botón primario.** En un diálogo destructivo no se pasa
  —y el botón destructivo **tampoco lleva `autoFocus`**, porque un botón enfocado
  se activa con Enter y eso alcanzaba para reemplazar la base de datos con una
  tecla—. Ahí Escape cancela y confirmar es un click.

**Un aviso que afirma algo tiene que poder desmentirse.** El de "ya planificaste
hoy" decía el día y solo se podía cerrar, y la marca se escribe con gestos que el
usuario no reconoce como planificar: la app quedaba afirmando algo indiscutible.
Dos cosas lo arreglan, y las dos son barajables a cualquier aviso parecido — que
diga **cuándo** (con la hora sacada de lo guardado, no del reloj de ahora) y que
ofrezca borrar la marca. El desmentido va como children, **debajo del cuerpo y
arriba de la fila de botones**, y **se ve como texto y no como botón**
(`.dialog__deny`): corrige la frase que afirma en vez de sumar una tercera acción,
y un botón más en la fila competiría con las dos decisiones de verdad — además de
no caber en 380px sin apilarse.

**No lo uses para un modal que no es una confirmación.** `TaskModal` es una vista
y `AddFeedModal` un formulario: tienen su propio teclado (⌘Enter, Enter por campo)
y solo comparten el `.modal-overlay`. Las confirmaciones **en línea** de dos pasos
—borrar una tarea, quitar un feed— no son modales y se quedan como están.

## Los atajos de un modal van en `window`, no en su `onKeyDown`

Un `onKeyDown` en el div del modal solo se dispara si el `target` del evento está
**dentro** del modal, y en esta app eso falla en tres caminos, los tres normales:

1. **Abrir con el mouse deja el foco en la tarjeta de atrás**, que no es
   descendiente del modal.
2. **Los popovers viven en un portal sobre `body`** (ver más abajo), así que con
   un picker abierto y el foco en su input, la tecla tampoco pasa por el modal.
3. **Un click en cualquier zona no enfocable** del modal manda el foco al `body`.

En los tres, Escape y ⌘Enter quedaban muertos sin ningún síntoma que apuntara al
foco. Cuélgalos de `window` en un `useEffect`, en **fase de burbuja** para que un
control interno pueda quedarse con la tecla antes (`SearchSelect` corta el Enter
con `stopPropagation`), y saltea el handler si `quitOpen` está arriba — mismo
criterio que `useShortcuts`.

Y **enfoca el modal al abrirlo** (`tabIndex={-1}` + `focus()` en un efecto con
deps vacías). No es solo accesibilidad: las tarjetas del board llevan los
`listeners` de `useSortable`, y el `KeyboardSensor` de dnd-kit arranca un
arrastre con Enter o Espacio **sin mirar los modificadores**. Con el foco en una
tarjeta, ⌘Enter levantaba la tarjeta en vez de cerrar el modal. Cualquier
overlay que se abra encima del board tiene el mismo problema.

## Popovers en portal con posición fija

`Popover.tsx` renderiza en un portal con posición fija **a propósito**. Si lo
resuelves con posicionamiento relativo dentro de la card o del modal:

- el `overflow` de las columnas y del modal **recorta** el popover, y
- el ancho queda limitado por el contenedor del chip que lo ancla.

Ambas cosas ya pasaron. Pásale el `anchorRef` y usa `align="right"` cuando el
ancla esté pegada al borde derecho.

**El foco inicial lo da el `Popover`, no el picker.** El portal monta
`visibility: hidden` mientras mide su posición, y **`focus()` sobre un elemento
invisible no hace nada**: los `useEffect` de mount de `SearchSelect` y
`TimePicker` corrían exactamente en ese hueco, así que cualquier picker con
búsqueda abría con el foco en el botón que lo abrió —un click más para escribir, y
las flechas sin efecto—. `Popover` enfoca el primer `input`/`textarea` que tenga
adentro cuando ya tiene posición; si no trae campo, no toca el foco. Si escribes
un picker nuevo, **no le pongas su propio efecto de foco**: no va a funcionar y
parece que sí (jsdom acepta el foco en un elemento oculto, así que el test pasa).

## Slots de altura fija para no desalinear columnas

Cuando algo aparece solo en algunas columnas —el caso real es la barra de
progreso, que solo se pinta en el día de hoy— **reserva su espacio en todas** con
un slot de altura fija (`day-progress-slot`) en vez de renderizarlo
condicionalmente. Si no, la columna de hoy empuja su contenido y las listas
quedan desalineadas entre días — que es exactamente el defecto que el slot existe
para evitar.

Aplica el mismo criterio a cualquier elemento condicional dentro de una fila de
elementos comparables.

## No pongas todas las opciones a la vista

Si una fila ofrece un puñado de opciones, muestra **la elegida** y deja el resto
en un popover. El caso real: cada categoría en Settings mostraba las ocho
muestras de color, y con ocho categorías eran 64 puntos compitiendo con los
nombres, que es lo que uno va a leer ahí. Hoy es un `ColorDot` que abre la
paleta — y con 24 colores serían 192, así que dejó de ser una preferencia. Mismo criterio que los chips del modal de tarea.

## Controles que aparecen al hover

Cuatro reglas, las cuatro pagadas con el panel de opciones del taxímetro:

1. **Nada de huecos muertos entre el disparador y el panel.** Había 4px de
   `margin` entre el botón y las opciones: al cruzarlos el puntero no estaba
   sobre ninguno de los dos y el panel se cerraba justo cuando ibas llegando. La
   zona sensible tiene que envolver a los dos (o puentear el hueco con un
   `::after`).
2. **Entran con `transform`, no solo con `opacity`**, y en `position: absolute`
   superpuestos al contenido: si empujan, la caja se reacomoda al pasar el
   mouse. Deja el recorrido corto (6–10px) cuando el contenedor tiene
   `overflow: hidden`, o se ve recortado.
3. **`:focus-within` en el selector que los revela.** Sin eso quedan botones
   alcanzables con Tab estando invisibles.
4. **En el taxímetro no se usa `:hover` de CSS.** Esa ventana casi nunca tiene
   el foco y sin foco el hover nativo enciende pero no apaga: el control queda
   pegado. Manda `useCursorHover`, que sondea la posición global del puntero y
   prende una clase. Si agregas otro control al hover ahí, súmalo a `ZONA_HOVER`
   en `FloatingTimer.tsx`. El porqué está en la skill `sunrise-sync-ventanas`.

El tamaño del disparador es decisión de producto, no técnica: hoy las opciones
del taxímetro salen solo desde el botón de play, a pedido explícito, aunque un
disparador chico siempre cuesta más de acertar.

## Atajos visibles en la navegación

Cuando muestres un atajo junto a un ítem clicable, el texto va **`aria-hidden`**
y el atajo real como **`aria-keyshortcuts`** en el elemento. Si lo dejas como
texto dentro del link, el nombre accesible pasa a ser "Focus ⌘ 3" en vez de
"Focus": molesta a un lector de pantalla y rompe los tests que buscan por nombre.

## Clases compartidas entre features

`shutdown.css` (bitácora y cierre del día) usa `.review__panel`, `.review__h2`,
`.review__head`, `.review__cifras`, `.chip-cifra` y `.cifra` de la weekly review,
más `.repaso__row` / `.repaso__acciones` del ritual diario. Es a propósito: son la
misma familia de vistas y duplicarlas las habría separado con el primer retoque.

**Consecuencia práctica: restilar la review toca la bitácora.** Antes de cambiar
una de esas clases, abrí las tres vistas.

El formato de duraciones vive en **`src/lib/capacity.ts`** (`formatMinutes` para
las cards, `horas`/`hoursFromMinutes` para las cifras de cabecera).
`weeklyReview.ts` las re-exporta por comodidad, pero la casa es `capacity.ts`.

## Paleta y tema

Colores por **token CSS**, nunca hex en el componente: `var(--lavender)`,
`var(--lavender-ink)` para el texto encima. Tokens en `src/styles/tokens.css`. La
lista de colores de categoría vive en `src/lib/palette.ts` (`PALETTE`) — **son 24,
en orden de matiz y en tono medio, no pastel**.

**Si vas a agregar un color, no lo elijas a ojo.** Tiene que sobrevivir a cuatro
usos y son los tintes los que traicionan: dos matices que se distinguen a
saturación completa **colapsan al 18%**, que es el bloque del rail. Los cuatro: el
punto a full, el chip al 35% (`.cat-tag`), el rail al 18%, y el `-ink` como texto
encima **y como punto sólido** (los highlights del shutdown). El criterio con el
que se eligieron los 24 fue ΔE en Lab contra todos los demás en los tres fondos,
tomando el mínimo; quedó en 8.1. Los números y los tres caminos descartados están
en el comentario de `tokens.css` y en SPECS §7.

Cuatro cosas que se rompen fácil:

- **Renombrar o quitar un color rompe las categorías guardadas.** `categories.color`
  guarda el **nombre** del token, así que queda un `var(--loquesea)` inexistente:
  un punto transparente, sin un error en consola. Agregar sí es compatible.
- **El `-ink` sigue al tema; el color no.** Los 24 `-ink` están declarados en las
  tres ramas de tema y hay un test que los exige en las tres (Mej.28: con un solo
  hex, el chip de canal quedaba en contraste 1.1–1.5 en oscuro). El color en sí
  **no** se redefine por tema, y eso también tiene test.
- **Un fondo sólido con texto blanco encima no sale del `-ink`**, sale de
  `--mint-solid`, que es fijo. Con el ink claro en oscuro, blanco sobre claro no se
  lee. Pero los fills **sin** texto —el punto pulsante, las barras— sí siguen al
  tema, porque un verde oscuro sobre fondo oscuro desaparece. La pregunta es
  **¿lleva texto encima?**, no "¿es un fondo?".
- **El 35% es parte de la calibración del `-ink`.** Están calculados contra el chip
  al 35% y las superficies del tema; sobre el color **entero** llegan a 1.2–2.0, o
  sea texto invisible, y en los dos temas por igual. Si necesitas el color a full
  con algo encima va un sólido (`--sage-solid`, `--selection-ink`), y **no** se
  arregla oscureciendo el color: es uno de los 24 y su hex mueve los ΔE de la
  familia. Un test lee **todos** los CSS buscando ese par.
- **Un botón relleno no se apaga con `opacity`**: acerca el fondo y el texto a la
  superficie a la vez y el contraste se derrumba (2.3). El `:disabled` declara su
  par —fondo al 22% con el `-ink` encima—. Los botones fantasma sí pueden, ahí solo
  se atenúa texto contra una superficie quieta.
- **El canal se dibuja siempre como chip**, nunca como texto teñido. La card, el
  modal de detalle y `CategoryTag` comparten `.cat-tag` y sacan sus variables de
  `chipVars`. Si escribes las variables a mano en un cuarto lugar, ese chip se va a
  separar de los otros tres con el primer ajuste.

**La tipografía se cambia sobreescribiendo los tokens en `<html>`**, nunca tocando
componentes: `--font-title` y `--font-body` ya los usa todo el CSS. Son **dos ajustes**
(`font_title`, `font_body`), y cada uno guarda `SUNRISE`, `SYSTEM` o el nombre de una
familia instalada. Tres cosas que se rompen fácil:

- Con `SUNRISE` la propiedad se **borra** en vez de reescribirse, para que el valor siga
  saliendo de `tokens.css` y no haya dos declaraciones de la misma cosa.
- **Toda elección arrastra la pila de respaldo** (`ui-sans-serif, system-ui, …`): una
  familia desinstalada no resuelve, y sin la pila la app cae en la serif por defecto del
  webview. Un cambio de tipografía no puede verse como "se rompió".
- El taxímetro no monta el store de ajustes, así que se entera por el espejo en
  `localStorage`, igual que el tema (`lib/fonts.ts`).

Y la lista de familias **se filtra** (`fonts.rs`): sin sacar las de símbolos y dingbats,
el selector ofrece fuentes que dejan cada letra de la app como un cuadrito, y volver
atrás se hace a ciegas.

Fuentes de fábrica **Sora** (títulos) y **Manrope** (cuerpo), auto-hospedadas vía
`@fontsource` para que la app funcione offline. No agregues fuentes por CDN.

El tema se persiste en `localStorage` (`sunrise-theme`) y la ventana flotante lo
sigue escuchando ese `storage`.

**Cada rama de tema declara también `color-scheme`.** Son tres: `:root`, el
`@media (prefers-color-scheme: dark)` y `:root[data-theme="dark"]`. No es
redundante con los tokens: `data-theme` es una convención **nuestra** y el webview
no la entiende, así que sin `color-scheme` dibuja sus controles nativos
—scrollbars, `<select>`, el caret— siempre en variante clara, y sobre el tema
oscuro desafinan. Si agregas una rama de tema, declárala ahí también; hay un test
(`tokens.test.ts`) que cuenta las ramas oscuras y exige las dos.

**Las barras de scroll se dibujan a mano** (`::-webkit-scrollbar` en
`global.css`), y `color-scheme` **no** es una alternativa a eso: pinta la barra
nativa del color del tema pero no cambia su forma. WebKit en macOS dibuja barras
*overlay* —finas, superpuestas, que se esconden solas— y el navegador dibuja las
clásicas; son dos implementaciones y ninguna propiedad salta de una a la otra. Se
probó en ese orden y no alcanzó.

Consecuencia que hay que tener presente al tocar layout: **la barra dibujada ocupa
12px permanentes y de un solo lado**. Si un contenedor nuevo hace scroll y su ancho
está calzado a mano, le faltan esos 12px; y si su contenido tiene que quedar
centrado, la barra lo corre.

**`scrollbar-gutter` no es la salida**, aunque lo parezca: `stable both-edges`
reserva a los dos lados y en el navegador funciona, pero el webview de macOS no lo
honra y reserva solo a la derecha. Se probó. La salida cuando el centrado importa
es esconder la barra de ese contenedor (`.sidebar::-webkit-scrollbar { width: 0 }`),
y decidir a conciencia que se puede vivir sin ella.

**Los gráficos se dibujan con CSS, no con una librería** (weekly review, §4.15:
divs para las barras, un `<svg>` con `stroke-dasharray` para el donut).
`recharts` está instalado y sin uso: el color de un channel es un token de la
paleta, y pasarlo como prop a un chart obliga a resolverlo a hex —y a volver a
resolverlo al cambiar de tema—. Con CSS los dos temas salen gratis y los tests
pueden mirar el DOM en vez de un SVG que en jsdom mide 0×0. En SVG el color va en
`style`, nunca como atributo: los atributos de presentación no resuelven `var()`.

## La marca

Un sol saliendo sobre el horizonte. **Un solo archivo es la fuente**:
`public/app-icon.svg`, del que salen el icon set del `.app` y del `.dmg`
(`pnpm tauri icon public/app-icon.svg`, que reescribe `src-tauri/icons/`) y el
favicon de las dos ventanas. Los PNG **no se editan a mano**: se regeneran.

Dentro de la app se usa `SunriseMark.tsx`, que es la misma figura sin el cielo:
horizonte en `currentColor` (hereda el color del texto que lo acompaña, así que se
aclara solo en tema oscuro) y sol en tokens de la paleta. Ids de degradado con
`useId()` — dos marcas con el mismo id hacen que el navegador resuelva las dos
referencias al primer `<defs>`, y una deja de responder a su degradado sin fallar.

Si tocas el dibujo, dos cosas:

- **Se juzga a 32px, no a 1024.** Rayos, nubes y reflejos son trazos finos que a
  ese tamaño se vuelven suciedad. El primer intento hubo que agrandarlo dos veces.
- **El SVG del icono es XML**, así que sus comentarios no pueden contener dos
  guiones seguidos: escribir un token como `--ink` ahí lo vuelve ilegal y
  `tauri icon` falla con un error de parseo que no menciona el logo. Hay un test.

## DnD del board

`WeekView` y `TodayView` usan `@dnd-kit` con una detección de colisión custom en
`src/features/week/collision.ts`: `pointerWithin` → `rectIntersection` →
`closestCorners`. Esa cascada existe para que **toda la columna** acepte el drop
—incluida la mitad superior, donde están el header y "Agregar tarea"— y para que la
card no se pierda al arrastrarla entre columnas. No la simplifiques a un solo
detector.

**La decisión de destino no vive en el handler**: está en `resolveDrop`
(`src/features/week/destino.ts`), pura y testeada, porque jsdom no devuelve
rectángulos — el gesto se verifica en el browser, pero los guards se fijan con
tests. Si agregas una regla al drop, va ahí.

Detalles que ya están resueltos y conviene mantener:

- **Un panel superpuesto que además es zona de drop tiene que ganar la colisión a
  mano.** dnd-kit **ignora el `z-index`**: lo que el panel tapa conserva su
  rectángulo y sigue compitiendo, así que el `z-index` alcanza para dibujarse
  encima y no para *recibir* el drop. Con el panel de backlog (300px) sobre una
  columna (236px), `pointerWithin` devolvía las dos ordenadas por distancia al
  centro y la columna escondida ganaba en buena parte del área: la tarea se
  agendaba en un día que no se ve. Si montas otro panel droppable, esa prioridad
  hay que decidirla explícitamente.
- **Y si lo sacas de los fallbacks, hazlo solo cuando haya puntero.**
  `closestCorners` nunca devuelve vacío, así que un destino que no debería
  alcanzarse por descarte hay que excluirlo — pero el `KeyboardSensor` **no tiene
  coordenadas**, `pointerWithin` le devuelve `[]` y los fallbacks son el único
  camino que le queda. Con la exclusión siempre puesta, ese destino queda
  inalcanzable arrastrando con el teclado, y nada se ve roto.
- **Un `SortableContext` que no reordena va sin estrategia**
  (`strategy={() => null}`). `useSortable` necesita el contexto para funcionar,
  pero `verticalListSortingStrategy` hace que las cards abran un hueco de
  inserción al pasar por encima — prometiendo un reordenamiento que después no
  pasa. Uno por grupo es peor: el desplazamiento entre grupos no hace nada
  mientras el drop sí se dispara.
- **Un destino no se ilumina si va a rechazar el drop.** Es la misma regla que
  "una columna no se ilumina si la card ya está en ella", y aplica a cada guard
  nuevo: el panel de backlog no se enciende para una card completada, porque
  `list_backlog` filtra `TODO` y el drop es no-op.

- `PointerSensor` con `activationConstraint: { distance: 4 }`, para que un click
  en la card no se interprete como arrastre.
- Los controles dentro de la card llaman `stopPropagation` en `onPointerDown` y
  `onClick`, para que tocar el check o un chip no arranque un drag.
- La card seleccionada se deriva de los datos frescos del board
  (`board.tasks.find(...)`), no de una copia en estado local: así el modal
  refleja al instante lo que se guardó.
- **El reorden es optimista.** `useBoard.moveTask` reordena su estado con
  `reorderLocal` antes de escribir, porque el overlay desaparece al instante:
  esperar la escritura deja ver el orden viejo y después la transición de
  `useSortable` mete la card deslizándose desde arriba. `reorderLocal` copia la
  aritmética de `repo::move_task` a propósito —si se separan, la recarga corrige
  la lista a la vista y se ve un salto—, y hay un test a cada lado. Si una vista
  tiene su propia lista además del board (el backlog del ritual), tiene que
  actualizarla igual.
- **El preview del `DragOverlay` no lleva `width`**: ya se dimensiona con el rect
  medido de la card. Un ancho fijo hace que el título se reacomode en otra
  cantidad de líneas al levantarla y la caja cambie de alto. La inclinación de 3°
  sí es querida.
- **Una columna no se ilumina si la card ya está en ella.** La cascada de colisión
  resuelve la columna en vez de una card al pasar por el header o los márgenes, y
  eso hacía parpadear el marco anunciando un cambio de día que no pasaba. El mismo
  caso tenía debajo un bug real: soltar sobre la columna significaba "al final",
  así que soltar en uno de esos momentos mandaba la tarea al fondo del día.
- **Los días anteriores a hoy sí reciben drops**, y el atenuado de la columna
  (`.day-col.is-past`) es solo información. Se probó bloquearlos —una pendiente con
  fecha pasada se va al backlog con la degradación diaria, así que se ve aterrizar
  y al día siguiente no está— y **se revirtió**: el gesto ya se podía hacer
  navegando a la semana anterior, y la regla era más gruesa que el problema (una
  cerrada no se degrada nunca, y cuando se degrada una pendiente aparece en el
  backlog con su fecha de origen). Si vuelves a considerarlo, la lección es esa:
  antes de apagar un droppable por un efecto indeseado, mira si el efecto ya es
  visible en otra parte de la app.
- **`MeasuringStrategy` se queda en su default.** Con el contenedor scrolleando
  bajo el arrastre, el reflejo es subirlo a `Always`; está verificado que no hace
  falta —el auto-scroll de dnd-kit ajusta sus rects y la card cae donde quedó el
  puntero— y remedir en cada movimiento del puntero con 21 columnas y todas sus
  cards se paga en la fluidez, que ya costó una tanda entera de arreglos.
- **El scroll del board se posiciona a mano** (`scrollDelta` en `anchor.ts`), sin
  `scrollIntoView` ni scroll suave: el nativo no está en todos los webviews (ya
  pasó con las tabs de Configs). La columna se busca por `data-date`, no con un
  ref, porque la `<section>` ya tiene el del droppable de dnd-kit y componer dos
  refs sobre el mismo nodo se rompe en silencio. Deja **hoy al centro**, pero solo
  si hoy está en la semana del ancla: con las 21 fechas como condición, la flecha
  de "semana siguiente" no hacía nada, porque hoy seguía en la ventana y el scroll
  volvía a centrarlo. Y corre solo al montar, al cambiar de semana y al cambiar el
  día — nunca con una invalidación de datos, o la vista se recolocaría sola cada
  vez que guardas algo.
- **Una semana es un bloque, no siete columnas sueltas** (`.board__wk`). Eso es lo
  que le da al rótulo de la semana un contenedor donde pegarse —`sticky left: 0` +
  `align-self: flex-start`, con fondo opaco para que el que entra tape al que
  sale— y lo que pone el corte de semana en un solo lugar. Si agrupas o desagrupas
  columnas, ojo con `.board__wk:first-child .day-col:first-child`: la sangría
  izquierda es solo de la primera columna de la **ventana**, no de cada bloque.
- **Los días plegados no reciben drops y hoy nunca se pliega.** El ajuste
  (`collapsed_weekdays`) dice qué días suelen estar vacíos, no que hoy no importe:
  plegar hoy esconde el día en el que se está trabajando. Y un día plegado con
  tareas **dibuja su cuenta** y se abre con un click por la sesión, con su botón
  para volver a plegarlo — plegar no puede ser una forma de esconder trabajo sin
  salida, ni abrir una puerta de un solo sentido. Ese botón va **solo** en un día
  plegable abierto a mano: en los otros seis no hay nada que plegar.

## Interacciones ya definidas

- El **play del modal de detalle** cierra el modal y navega a `/focus`: arrancar
  el timer desde el detalle significa "me pongo a trabajar".
- En el **taxímetro**, click simple abre Focus y mantener + mover arrastra la
  ventana. Lo distingue `useDragOrClick`, que descarta los eventos que caen en
  `button, .tax__opts`. Si agregas otra capa flotante encima de la tarjeta,
  súmala a ese selector: el panel de opciones entra deslizándose *bajo el
  cursor*, así que un click iniciado en el título puede soltarse encima suyo y
  abriría Focus sin que nadie lo pidiera.
- En **Focus**, ↑/↓ mueven entre tareas del día, y se ignoran si el foco está en
  un input, textarea o contenteditable.
- Los **atajos globales** viven en un registro central (`src/lib/shortcuts.ts`)
  con un solo listener: no agregues un hook suelto por atajo, agrega una fila a
  `SHORTCUT_ACTIONS`. Se ignoran dentro de campos de texto por la misma razón que
  las flechas de Focus — ⌘A pisaría "seleccionar todo". Son configurables desde
  Settings; el detalle está en SPECS §4.9.
- Notas en markdown con `react-markdown` + `remark-gfm`; los links se extraen del
  texto con `extractLinks` y se listan aparte.

## Tests de UI

Vitest + RTL. Los tests existentes se apoyan en `aria-label` y roles, no en
clases CSS. Mantén los `aria-label` de los controles (`"Completar tarea"`,
`"Pausar"`, `"Cambiar channel"`…): son el punto de agarre de los tests y además
lo correcto para accesibilidad.

## Idioma: código en inglés, texto en español

Convención del proyecto (CLAUDE.md). Identificadores —variables, funciones,
tipos, campos, archivos, comandos IPC— en **inglés**. Comentarios, texto de la
app, descripciones de tests y documentación en **español**. El nombre de un
`#[test]` de Rust es su descripción, así que va en español.
