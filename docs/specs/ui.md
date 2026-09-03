# §7 Convenciones de UI

Vuelve al [índice de SPECS](../SPECS.md).

Varias de estas se decidieron después de que la alternativa obvia fallara. Antes de
resolver un problema de layout por tu cuenta, búscalo acá.

## Idioma y voz

**Todo el texto de la app va en español**: labels, placeholders, `aria-label`,
`title`, errores, historial, días y meses. Dos excepciones, ambas por ser nombres
propios y no etiquetas traducibles: el **sidebar completo** (Home, Today, Focus,
Backlog, "Daily rituals" / "Weekly rituals" — "Daily shutdown" es el nombre del
ritual) y los **títulos de vista que espejan una entrada del sidebar**, que
traducidos dejarían la página diciendo algo distinto del link que lleva a ella. La
única entrada traducida es **Settings → Configs**. Los formatos numéricos (`hms`,
`formatMinutes`, `shortDuration`) no tienen idioma. El menú nativo de macOS queda en
inglés: lo genera `Menu::default`, y traducir solo nuestro Quit dejaría el submenú a
medias.

**El español es de Chile, no del Río de la Plata.** La app trata de **tú**: "puedes",
"quieres", "sube", "mira" — nunca "podés", "querés", "subí", "mirá". Vale para la
pantalla, los `aria-label` y las notificaciones. El voseo ya se coló dos veces, así
que relee todo texto nuevo buscando imperativos y segundas personas. Sí se usa: "acá",
"recién", "de una". No: el "che", los diminutivos de relleno, y el "ojo que" en la UI
(en comentarios de código está bien).

**Las fechas se formatean con los helpers de `src/lib/date.ts`**, que llevan el locale
`es` por llamada — no con `setDefaultOptions`, que además movería los límites de
semana. No es traducir tokens: en español el día va antes del mes ("10 de agosto") y
date-fns devuelve los días en minúscula, así que `weekdayLabel` capitaliza. Los
componentes de terceros traen su propio texto: `<DayPicker>` necesita `locale={es}` en
cada uso.

## El marco de la ventana

**No hay barra de título, y eso reparte responsabilidades.** `titleBarStyle: "Overlay"`
deja los botones nativos de macOS flotando sobre el contenido, así que **el hueco de
arriba lo tiene que dejar el CSS**: el token `--titlebar-h` (28px) lo reservan el
padding del sidebar y el de `.app-main`. Bajarlo en un solo lado deja el título de una
vista debajo de los botones. Tauri avisa que **el alto real cambia entre versiones de
macOS**: si algún día se ven pegados o sobrados, se ajusta acá y las dos columnas se
corrigen juntas.

**Las dos columnas reservan el mismo alto por razones distintas**, y por eso el respiro
extra es el mínimo (`--space-1`) en ambas: en el sidebar es por los botones nativos,
que **obligan** a no bajar de `--titlebar-h` —menos que eso mete la marca abajo del
semáforo—; en `.app-main` los botones no llegan y lo que hay que despejar es la zona de
arrastre, que es `fixed` y se comería los clicks de lo que quedara debajo.

Tauri documenta una limitación del modo `Overlay` que no tiene arreglo desde acá: **con
la ventana sin foco, arrastrarla no funciona** al primer click.

Sin barra de título tampoco hay de dónde tomar la ventana: eso lo da `.app-dragbar`, un
`div` fijo con `data-tauri-drag-region`. **No declara `z-index` a propósito** — siendo
`fixed` ya queda sobre el contenido estático, y sin declararlo cualquier elemento
posicionado posterior le gana. Importa porque las tabs de Configs son `sticky` y los
modales se abren encima: con `z-index` propio, la franja les comería los clicks del
borde superior y se vería como un control que no responde.

**El sidebar se colapsa a un rail de 84px.** El número tiene piso en 68px, que es hasta
dónde llegan los botones nativos; por encima de ese piso manda el aire. Los botones son
**cuadrados de 44px centrados**, no cajas estiradas: estiradas, el recuadro de hover
llegaba a los dos bordes y se leía torcido aunque midiera simétrico. El estado vive en
`localStorage` (`sunrise-sidebar-collapsed`), se estampa como `data-sidebar` en `<html>`
y dibuja con `is-collapsed`.

**Los dos anchos son literales en `global.css`, no tokens**, y el shell es flex y no
grid: el ancho se anima, y en grid vivía en la pista, que no interpola — medido, la
columna se quedaba quieta casi un segundo y después saltaba. En flex el ancho es del
elemento, que es el caso normal de una transición; a cambio hay que darle
`min-width: 0` a `.app-main` o las columnas de la semana dejan de encoger. Por lo mismo,
**el colapso no se anima**.

Colapsado se esconde el texto por CSS, con dos excepciones que sí cambian el render:
**los contextos del backlog no se dibujan** (un punto de color sin su nombre no dice
cuál es) y **el aviso del updater se mantiene**, como icono, porque es la única señal de
que hay una versión nueva (§4.23).

El **botón de colapsar vive arriba**, al lado de la marca; abajo se leía como un item de
navegación más. El **tamaño de los iconos lo pone el CSS** y no el prop `size` de lucide
(19px expandido, 22px colapsado): el prop es un atributo del `<svg>` y no sabe en qué
estado está el sidebar. Lo mismo vale para `SunriseMark` (21/26px), que va un pelo más
grande por ser la marca — y hay que acordarse de ella al cambiar tamaños, porque tiene
su propio prop.

La ventana flotante **se sale del `color-scheme`** (`normal` en `.timer-body`): es
`transparent: true` y un esquema declarado le pinta el canvas raíz, que es justo lo que
no puede tener. No pierde nada: ahí no hay scrollbars ni controles nativos.

## Barras de scroll

**Se dibujan a mano, y `color-scheme` no reemplaza eso.** `color-scheme` pinta la barra
nativa del color del tema y arregla los `<select>` y el caret, pero **no cambia su
forma**: WebKit en macOS dibuja barras *overlay* —finas, superpuestas, que se esconden
solas— y el navegador dibuja las clásicas. Son dos implementaciones sin propiedad que
salte de una a la otra, así que la que se quería hubo que dibujarla con
`::-webkit-scrollbar` (pulgar de 6px con zona de agarre de 12, vía `border` transparente
más `background-clip: content-box`).

**El precio es 12px permanentes** en cada contenedor que hace scroll: una barra dibujada
deja de ser overlay. Se aceptó porque una que aparece y desaparece sobre las columnas de
la semana tapa el borde de las cards justo cuando las estás mirando. Dos consecuencias
al agregar un contenedor con scroll: si su ancho está calzado a mano, ahora le faltan
12px; y **si su contenido tiene que quedar centrado, la barra lo corre**, porque ocupa
de un solo lado.

**El sidebar es la excepción: no muestra barra.** Sin eso el rail colapsado se ve
torcido. El primer intento fue `scrollbar-gutter: stable both-edges`, que **en el
navegador funciona** —medido, simétrico— pero **el webview de macOS no lo honra**:
reserva solo a la derecha y el rail queda corrido igual. Es el caso de manual de por qué
esto se verifica en la app y no en el browser.

## Color

**La paleta de categorías son 24 colores en tono medio, elegidos midiendo.** Cada color
son **tres** tokens: el color (`--rose`), su `-ink` para el texto encima, y para el
verde además dos sólidos (`--mint-solid`, `--sage-solid`). Tiene que sobrevivir a cuatro
usos: el punto a saturación completa (`SearchSelect`, sidebar, donut), el chip al 35%
(`.cat-tag`), el bloque del rail al 18% y el `-ink` como texto **y como punto sólido**.
Son los tintes los que traicionan: **dos matices que se distinguen a full colapsan al
18%**, así que mirar las muestras del picker no sirve para decidir.

El criterio fue distancia perceptual (ΔE en Lab) contra todos los demás en los tres
fondos, tomando el mínimo. Quedó en **ΔE mínimo 8.1**; la paleta pastel anterior estaba
en 4.2, y el síntoma era el reportado: una lista de canales difícil de seguir.

> **Tres caminos medidos y descartados**, porque los dos primeros parecen la respuesta
> obvia. **Un anillo uniforme** (misma L, mismo croma, matiz cada 15°) da **3.8, peor que
> la pastel** — 15° no es un paso perceptual constante y en los verdes y azules casi no
> se ve. **Optimizar sin restricciones** llega a 13.8 pero rompe los nombres (`sage` sale
> verde eléctrico, `amber` café): un ΔE mejor con una paleta incoherente es peor
> producto. Y **croma alto dentro de la caja pastel** (L 80–95) topa en 5.3 — la caja era
> el límite, no el matiz. Lo que quedó es diseño a mano, con **la luminosidad siguiendo
> al matiz** como una rueda de pigmentos (los amarillos claros, los azules y violetas más
> oscuros: a luminosidad constante el amarillo se ve café), y el optimizador gastando el
> presupuesto solo en los pares que chocaban.

**Los `-ink` cambian por tema; el color no.** El chip pinta el `-ink` sobre el color al
35% de un fondo que **sí** cambia, así que un solo hex tiene que fallar en un tema: con
el hex único, en oscuro el chip quedaba en contraste 1.1–1.5. Los 24 están calculados
para llegar a **4.6** contra el peor de sus fondos en cada tema — el mínimo AA para texto
chico es 4.5. Van en **las tres ramas** de tema, y hay un test que lo exige: darle
variante a uno solo deja el chip de un canal legible y el del canal de al lado no.

Cuatro reglas con test propio:

- **El color en sí no se redefine por tema.** El punto de un canal siendo de dos colores
  según el tema rompe lo único que sirve para reconocerlo.
- **Un fondo sólido con texto blanco encima no puede salir del `-ink`.** Nueve bloques
  hacen `background: var(--mint-ink)` con `color: #fff` (el play de Focus y del modal,
  los cuatro checks): con el ink claro en oscuro, blanco sobre claro no se lee. Usan
  **`--mint-solid`**, fijo en los dos temas. Los fills **sin** texto —el punto pulsante,
  las barras— sí siguen al tema, porque un verde oscuro sobre fondo oscuro desaparece. La
  pregunta al agregar uno es "¿lleva texto encima?", no "¿es un fondo?".
- **El 35% es parte de la calibración: el `-ink` no sirve sobre el color entero.** Sobre
  el color a full llegan a **1.2–2.0**, o sea texto invisible. Costó tres lugares a la vez
  —`.btn-primary` con diez llamadores, el icono del diálogo de ritual y `::selection`— y
  en los dos temas por igual, que es lo que lo delató. **La salida no es oscurecer el
  color**: es uno de los 24 y mover su hex corre los ΔE de toda la familia. Va un sólido:
  `--sage-solid` (mismo tono a L 38%, aguanta blanco en 5.5) y `--selection-ink`.
- **Un botón relleno no se apaga con `opacity`.** Bajarla acerca el fondo **y** el texto a
  la superficie a la vez, así que el contraste se derrumba (2.3 en claro). El `:disabled`
  de `.btn-primary` declara su par: fondo aguado al 22% —donde el `-ink` sí está
  calibrado— con el `-ink` encima (4.8 y 7.7). Los botones fantasma sí pueden usar
  `opacity`: ahí solo se atenúa el texto contra una superficie que no se mueve.

**El chip de canal no lleva punto adentro.** El chip ya viene teñido —fondo del
color al 35% con su `-ink` encima—, así que el punto decía lo mismo dos veces en
60px de ancho, y en una card con la marca de prioridad al lado eran dos puntos
compitiendo. El punto se queda donde el color **no** está en ningún otro lado: las
opciones del select (`.ss__dot`) y los rótulos de columna del backlog
(`.backlog__dot`). Los tres lugares que dibujan el chip —card, detalle y
`CategoryTag`— cambian juntos: es el mismo chip, y separarlos es lo que hace que
la misma cosa se vea de dos formas.

**Los `--prio-*` son la segunda familia de color, y no viven bajo estas reglas**
(§4.30). Cinco tokens, `--prio-p1`…`--prio-p5`, que son una **rampa interpolada en
OKLCH** entre el rojo de P1 y el celeste de P5 —no colores elegidos uno por uno—,
con ΔE mínimo 11.0 entre ellos. Tres cosas que los separan de los 24:

- **No están en `PALETTE`.** No son colores de canal, no se eligen desde ningún
  picker, y renombrar uno rompe `Priority` en `enums.ts` y no un punto de
  categoría. Un punto de prioridad que se pudiera confundir con un punto de canal
  sería peor que dos familias.
- **No llevan `-ink`, y agregárselos es el error a evitar.** La marca es siempre
  punto de color + etiqueta al lado (`PriorityTag`), nunca texto encima del color,
  así que ningún nivel tiene que sostener un contraste calibrado. Un `-ink` sería
  la invitación a escribir encima — justo el par que persigue `tokens.test.ts`.
- **No cambian por tema**, por lo mismo que los de canal: el color **es** la
  identidad del nivel.

**El botón de confirmar es salvia, no naranjo** (`.btn-primary`, `--sage`/`--sage-ink`).
El damasco es **el mismo tono** que el semáforo de capacidad usa para "te pasaste"
(`--cap-over`), así que un aceptar en naranjo se lee como advertencia. El naranjo queda
para lo que avisa. Todo botón de acción lleva **su icono** además del texto.

**El canal se dibuja siempre como chip**, nunca como texto teñido: la card, el modal y
`CategoryTag` comparten `.cat-tag` y sacan sus variables de `chipVars`. El fondo es lo
que se reconoce de reojo en una lista; un texto de color con 24 colores en tono medio se
lee como texto raro.

## Componentes y patrones

**Los links salen al navegador del sistema, siempre.** Dentro del webview un
`<a href>` **navega la propia ventana de la app**: sunrise se convierte en una
pestaña de Google sin barra de direcciones ni botón de volver, y la única salida es
cerrar. No es un link roto, es la app que desaparece. Dos piezas y ninguna opcional:

- **`components/Markdown.tsx`** dibuja todo el markdown de la app —notas de una
  tarea, anuncio de una versión—. Conserva el `href` (menú contextual, copiar
  dirección, lectores de pantalla) y le pone al click un `preventDefault` +
  `abrirExterno`. También `stopPropagation`, porque las notas viven dentro de un
  contenedor que abre el editor al click: sin eso, entrar a un link te devolvía del
  navegador a un textarea abierto.
- **`abrirExterno`** (`features/calendar/MeetingLink.tsx`) es el único camino de
  salida: plugin `opener` dentro de Tauri, `window.open` fuera. Un link que no está
  en markdown se dibuja como `<button>` que lo llama —`MeetingLink`, los recursos
  del detalle—, no como anchor.

- **La distribución no se rediseña sobre la marcha.** Ante una duda de layout, la
  respuesta sale de lo que ya existe —la vista hermana, la card equivalente, el modal que
  resuelve el mismo problema— y no de una variante inventada para el caso. Es una app de
  uso diario: la consistencia vale más que la mejor idea suelta, porque la mano ya
  aprendió dónde está todo.
- **Autosave siempre. Nada de formularios planos con botón "Guardar".**
- **El título de una tarea se lee entero en el detalle y recortado en la lista.** En
  `TaskModal` el campo es un `textarea` que crece con el texto —el alto lo escribe un
  efecto sobre `scrollHeight`, reseteando a `auto` antes de medir o el campo nunca
  achica— hasta un tope de cinco líneas, y de ahí scrollea: más que eso empuja el resto
  del detalle fuera de la vista. Sigue siendo un dato de una línea, así que Enter sin
  modificadores se come con `preventDefault` y un pegado multilínea se aplana en el
  `onChange`; el `preventDefault` **no** puede venir con `stopPropagation`, porque ⌘Enter
  cierra el modal desde un handler en `window`. En la card (`.tc__title`) el título se
  corta en **dos líneas con elipsis** (`-webkit-line-clamp`) y el texto completo va en el
  `title` nativo: una columna de ancho fijo no absorbe un título arbitrario sin desarmar
  el ritmo de las filas, y de paso la card queda de alto acotado, que es lo que el
  `DragOverlay` necesita para no cambiar de tamaño al levantarla. **El `word-break` se
  queda junto al clamp**: sin él un token sin espacios —una URL pegada— se sale de ancho
  en vez de recortarse, que era justo el caso que rompía la card. El campo de
  `AddTaskModal` (`.compose__title`) es el mismo textarea con las mismas reglas, salvo
  que ahí Enter **crea la tarea**.
- **Un `flex-basis` no acota un flex item: lo acota su `min-width`.** El mínimo automático
  de un flex item es `min-width: auto`, o sea el ancho mínimo de su contenido, y gana por
  sobre el `flex-basis`. La ficha del día (`.dia__der`, `flex: 0 0 250px`) se estiraba al
  doble con un título largo en el timeline —que va en `nowrap`— y le comía el ancho a la
  columna de la izquierda, en shutdown y en la bitácora a la vez. Con `min-width: 0` los
  250px se respetan y el `text-overflow` del título recién ahí puede recortar. Si pones un
  ancho en un flex item y no se respeta, la causa es esta, no la regla del ancho.
- **Una lista de texto lleva medida de lectura, no el ancho de la columna.** `.hitos` —los
  highlights del shutdown y de la bitácora— corta en 520px (~70 caracteres a 13px). Sin el
  tope, un título largo cruzaba los 626px de punta a punta: la serie dejaba de leerse como
  serie —el ojo perdía la columna de puntos al volver— y el botón de la derecha quedaba
  lejos de la fila a la que pertenece.
- **Pero una fila con varios controles no se guarda en el blur de un campo.** El blur del
  primero confirma la operación y desmonta la fila a mitad de camino. Pasó dos veces: la
  fila de feeds al pasar de Nombre a URL y la de alta de canales al ir a elegir el color.
  El patrón es `AddRow`: el `onBlur` va **en la fila** y solo cuenta si `relatedTarget`
  cayó afuera, y el control que abre el popover hace `preventDefault` en el `mousedown`
  (`keepFocus` en `ColorDot`). La segunda defensa sostiene el caso real —si el click en el
  botón no lo enfoca, el foco se va al `body` y el blur llega con `relatedTarget` en
  `null`, indistinguible de irse de la fila— y va **opt-in**, porque las filas de renombre
  dependen del blur contrario. Se testea con `userEvent`: `fireEvent.click` no mueve el
  foco y el test pasaría con el bug puesto.
- **Los diálogos chicos son un componente** (`src/components/Dialog.tsx`): confirmar
  salida (⌘Q), "ya planificaste", "Lo nuevo", y los dos de Respaldo. Es dueño del overlay,
  de `role="alertdialog"` + `aria-modal`, del `stopPropagation`, del foco inicial y —lo
  que importa— **de las teclas en `window` con `capture`**. Estaba copiado cinco veces y
  **faltaba en dos**: la confirmación de restaurar, la acción más destructiva de la app,
  no se cerraba con Escape.
  - `onClose` ausente = no se cierra ni con Escape ni con click afuera, que es lo que
    necesita un diálogo a mitad de una operación irreversible.
  - **`onEnter` va aparte del botón primario a propósito.** En la confirmación de restaurar
    no se pasa, **y el botón destructivo tampoco lleva `autoFocus`**: un botón enfocado se
    activa con Enter, así que el `autoFocus` que estaba ahí alcanzaba para reemplazar la
    base con una tecla. Ahí Escape cancela y confirmar es un click.
  - No lo usan `TaskModal` ni `AddFeedModal`: no son confirmaciones sino una vista y un
    formulario, con su propio teclado. Comparten `.modal-overlay` y nada más. Las
    confirmaciones **en línea** de dos pasos tampoco: no son modales.
- **Popovers en portal con posición fija** (`Popover.tsx`). Si no, los recorta el
  `overflow` de columnas y modales, y el ancho queda limitado por el contenedor del chip.
  **El foco inicial lo da el `Popover`, no el picker**: monta `visibility: hidden` mientras
  mide, y un `focus()` sobre un elemento invisible **no hace nada** — los efectos de mount
  de `SearchSelect` y `TimePicker` caían justo en ese hueco, así que el picker abría con el
  foco en el botón que lo abrió. Enfoca el primer `input`/`textarea` cuando ya hay
  posición; el que no trae campo (paleta, ánimo, calendario) no cambia el foco.
- **Selects con búsqueda local** vía `SearchSelect.tsx`. Duraciones vía `TimePicker.tsx`.
- **Slots de altura fija** en vez de renderizar condicionalmente algo que empuje el
  contenido: mantiene las columnas alineadas.
- **Los controles que aparecen al hover no pueden tener huecos muertos.** Si el panel se
  separa de su disparador, la zona sensible tiene que cubrir la separación (envolviendo
  ambos, o con un `::after` que la puentee) o el puntero pierde el hover al cruzar y el
  panel se cierra en la cara. Se superponen al contenido en vez de empujarlo —si empujan,
  la caja se reacomoda al pasar el mouse— y entran con `transform` además de `opacity`:
  solo el fundido se siente pegado. Referencia: `.tax__opts`.
- **Un panel superpuesto que además es zona de drop necesita ganar la colisión a mano.**
  dnd-kit no sabe nada del `z-index`: lo que el panel tapa sigue teniendo su rectángulo y
  sigue compitiendo, así que el `z-index` alcanza para verse encima y no para *recibir* el
  drop. Y como `closestCorners` nunca devuelve vacío, el panel también hay que sacarlo de
  los fallbacks — pero solo cuando hay puntero, porque sin él (teclado) los fallbacks son
  el único camino. Referencia: `boardCollision`.
- **Los paneles de la tira se abren de a uno.** Se montan todos en el mismo lugar
  (`right: 44px`, 300px), así que dos abiertos se apilan. Es un solo estado con el nombre
  del panel, no un booleano por panel.
- **El corrector ortográfico va solo donde hay prosa.** En macOS el webview corrige,
  subraya y **capitaliza al salir del campo** todos los `input`, y llega a cambiar lo
  escrito. Un campo que no es prosa spreadea `PLAIN_INPUT` (`plainInput.ts`), que apaga
  `spellCheck`, `autoCorrect` y `autoCapitalize`. Queda encendido en el **título y las
  notas de una tarea**. Para un campo nuevo la pregunta no es si molesta el subrayado, es
  si alguien escribiría ahí una frase.
- **Lo que está corriendo cambia de icono, no gira el suyo.** Un botón que espera reemplaza
  su icono por `<Spinner>`. Rotar el icono propio se leía como un chiste: el botón de sync
  hacía dar vueltas un calendario, que rotando no significa nada. `.is-spinning` lleva
  `overflow: visible`, y no es cosmético: **un `<svg>` recorta por defecto**, así que la
  tinta que en reposo cabe en el viewBox de 24 se sale al girar y el borde se la come y se
  la devuelve dos veces por vuelta. Medido en `RefreshCw`, con las puntas a 13.7 unidades
  del centro contra las 12 del medio viewBox: **8.6% de variación de tinta**, que se lee
  como que el icono late. La animación se apaga con `prefers-reduced-motion`, así que el
  estado tiene que estar también en palabras: el texto del botón ("Sincronizando…"), y en
  los que no tienen texto, `aria-busy` más un `title`. La excepción es el updater, que
  **no** lleva spinner: ahí manda la barra de progreso, que dice cuánto queda (§4.23).

## Clases compartidas entre features

Es intencional. `shutdown.css` usa `.review__panel`, `.review__h2`, `.review__head`,
`.review__cifras`, `.chip-cifra` y `.cifra` de la weekly review, y `.repaso__row` /
`.repaso__acciones` del ritual diario. Son la misma familia de vistas —mirar hacia atrás—
y duplicar los estilos garantizaba que se separaran con el primer retoque.
**Consecuencia: restilar la review toca la bitácora.** Si vas a cambiar una de esas
clases, mira las tres vistas.

El otro caso es `.sync-btn` / `.resp-btn` en `week.css`: **una definición con dos
nombres**. El botón del sync y las acciones de Respaldo tienen que verse idénticos, y dos
reglas separadas se habrían separado en el primer ajuste. El icono va en 13px en los dos.

## Configs

**Las secciones salen de una lista, no de cada card.** `settings/secciones.ts` define
orden, nombre e icono, y de ahí lo toman la tab del menú y el título de la card. Vive en
su propio módulo porque dos cards (`FeedsCard`, `BackupCard`) son de otros módulos y
también necesitan su icono — importarlo desde `SettingsView` sería un ciclo. **El orden
de las cards tiene que seguir al de la lista**: el resaltado lo decide un
`IntersectionObserver`, así que si divergen el menú marca una y se ve otra.

**El título va centrado sobre las dos columnas, con el icono del sidebar.** Es lo
único en que se aparta de los `h1` de sus vistas hermanas (mismo icono de 20px, mismo
cuerpo de 22px, pero ahí alineados a la izquierda): acá el título corona un menú y un
panel, y pegado al borde izquierdo se lee como el rótulo del menú.

**El icono de cada sección va en una pastilla neutra a la izquierda del nombre**, no
suelto: a 16px sobre el fondo de la card mide lo mismo que una letra del nombre y se lee
como parte de él. El fondo es `--surface-sunken` y no un tinte por sección — acá el icono
identifica, no clasifica, y en esta app el color siempre significa algo. La medida sale de
los atributos del SVG, así que la regla necesita `box-sizing: content-box` para que el
padding no infle el glifo.

**El icono es hermano del texto, no hijo del `h2`**, aunque termine alineado con él: como
hijo quedaba atado a la línea del título y no se podía mover respecto del bloque. El
encabezado es `flex` con `align-items: flex-start` sobre `.set-card__icon` y
`.set-card__head-text`, así el icono queda arriba, a la altura del nombre, y no baila con
el largo de la bajada —hay secciones de una línea y de tres—. Las acciones de sección —el
sync de calendarios, los botones de respaldo— se van a la derecha con `margin-left: auto`
sobre `.set-card__acciones`, no con un `justify-content`: con tres hijos, repartirlos
separaría el icono de su título.

**Las bajadas y las notas explican, no narran.** Una o dos líneas, con el dato que no se
adivina mirando el control —que hoy nunca se pliega, que un sonido inexistente llega mudo,
que el Alert Style no lo decide la app— y sin el párrafo alrededor. El motivo largo, cuando
existe, va en el doc comment del componente, que es donde lo busca quien lo va a tocar.

**Se probó de marca de agua y no funcionó, por dos motivos distintos.** Grande y
translúcida detrás del título, se lee como suciedad sobre el nombre a cualquier opacidad
en que se distinga. Movida a la esquina superior derecha resuelve eso, pero Calendarios y
Respaldo llevan sus acciones justo ahí y los botones tienen fondo opaco, así que el glifo
asoma en pedazos alrededor de ellos — con y sin `overflow: hidden` en la card, y sacarla
por la esquina agrega que un glifo cortado se lee como un error de recorte.

**La fila de un ajuste son dos columnas: qué es, y qué se edita.** `.set-field` es una
grilla de `minmax(0, 1fr)` y una columna derecha de **ancho fijo** (220px). A la izquierda
va `.set-field__text` —la etiqueta y su explicación, una debajo de la otra—; a la derecha
`.set-field__control`. El ancho de la derecha es fijo a propósito: ajustado al contenido,
cada campo tendría el suyo y los controles quedarían escalonados bajando la página. Y va
con `align-items: start`, no `center`: con una explicación de dos o tres líneas, centrar
arrastra el control hasta la mitad del párrafo y lo despega de su etiqueta.

Antes la explicación se llevaba la línea completa **por debajo** del control (`.set-note`
tenía `flex: 1 1 100%`). Con eso cada ajuste medía dos filas de alto completo y una
sección de cinco campos se leía como un solo bloque de texto. Lo que la corta ahora es la
divisoria de `.set-field + .set-field`, con 16px de aire a cada lado —la mitad la pone el
`gap` de la card y la otra el `padding-top` de la regla, así la línea queda centrada en el
aire y no pegada al campo de arriba.

Dos escapatorias, y son excepciones: `.set-field--wide` sube la columna a 288px para los
pares de campo corto con etiqueta (inicio/fin de jornada, hora/conservar del respaldo), y
`.set-field--stack` manda el campo entero a una sola columna cuando el control no entra en
220px —un grupo de tres botones, una ruta absoluta de iCloud—. En modo apilado el texto
lleva `max-width: 58ch` para no leerse con una medida distinta al resto.

**Un interruptor se centra contra el bloque de texto entero**, no contra su primera
línea: es la excepción al `align-items: start` de la fila, y la pone
`.set-field__control:has(> .switch)`. Un control ancho —botones, la fila de días— tiene
que arrancar a la altura de la etiqueta; un switch mide 20px y arriba del todo se lee
como si colgara. Va con `:has` y no con una clase aparte a propósito: así vale para
cualquier switch que se agregue después, y el que la olvidaría no ve ningún error.

**En una lista con divisorias, el `gap` del contenedor tiene que ser cero.** La divisoria
es el `border-top` de la fila de abajo, así que el gap cae **antes** de la línea y suma de
un solo lado: con 6px de gap y 7 de padding quedaban 27px del texto a la línea y 10 de la
línea al texto siguiente. Sin gap —y lo mismo con el `margin-top` entre grupos— el aire lo
pone solo el padding de la fila y sale parejo por construcción, también en el cruce de un
contexto al siguiente.

**Las secciones de lista no llevan la fila dibujada como caja.** Seis u ocho cajas
apiladas dentro de una card son una lista dentro de una lista, y el borde de cada fila
compite con el de la card que las contiene. Vale para las tres: Canales usa
`.set-list--plana`, Atajos son campos, y los calendarios (`.feed`) siguen la misma regla.
Sin borde ni fondo, separadas por la misma divisoria de 1px que separa los campos en el
resto de Configs.

Dos excepciones, y las dos por la misma razón —lo que la caja decía hay que decirlo de otra
forma—: la fila de alta de un canal **conserva** su caja punteada, porque es la única que
todavía no existe y sin ella no se distingue de las guardadas; y un feed roto, que antes lo
anunciaba con el borde de su recuadro, ahora lo dice con una banda de 2px a la izquierda.

**Atajos no es una lista, son campos.** Cada atajo es un `.set-field` con su nombre a la
izquierda y su combinación a la derecha, igual que "Abrir sunrise al iniciar sesión". Van
más compactos que un campo de General —8px de padding en vez de los 16 de la divisoria
general, que la regla pisa— porque un atajo es una línea sola, nombre y tecla, y no un
ajuste con su explicación.

**El aire de la card tiene que igualar el de sus filas**, y eso se arregla en la card
(`.set-card:has(.set-list--campos)`), no con un margen negativo en la lista, que es la
misma cuenta escrita al revés. El espacio sobre el primer atajo no lo pone su padding sino
el `gap` de la card, así que con filas de 8 y `gap` de 16 el primero quedaba a 24 de la
divisoria del encabezado y el resto a 8 de la suya — se leía como si estuviera hundido.
Con `gap: 0` queda a 8, igual que todos. **El `padding-bottom` sí se conserva en 8 y no
baja a cero**: el aire de arriba no es solo el `gap` —el encabezado suma su propio
`padding-bottom` antes de la divisoria— así que en cero el último atajo queda pegado al
borde. La
combinación y su restaurar van **unidos como un solo control** (`.hotkey-grupo`): comparten
borde y solo redondean los cantos de afuera. Separados, el restaurar se leía como una
acción de la fila al mismo nivel que la combinación, y no como el deshacer de ese campo.

Dos trampas del contenedor, las dos pagadas:

- **`.set-field__control--fila` tiene que quedar después de `.set-field__control`** en la
  hoja. Misma especificidad, gana la última, y desde antes el `flex-direction: column`
  seguía mandando: el restaurar caía debajo de la combinación.
- **Al pasar a fila hace falta `justify-content: flex-end`.** El `align-items: flex-end` de
  la columna deja de alinear a la derecha y pasa a gobernar el eje vertical, así que el
  grupo quedaba flotando a media columna en vez de pegado al borde.
- **El `gap: 0` del grupo va con las dos clases** (`.set-field__control.hotkey-grupo`): con
  `.hotkey-grupo` sola pierde por orden contra el `gap` de `.set-field__control`, y los dos
  botones quedan separados por 8px en vez de unidos.

Y un atajo no tiene bajada, así que su fila va con `align-items: center` en vez del `start`
del resto: si no, el nombre cuelga 6px más arriba que su tecla.

**El aire de una card es 24 arriba y 16 abajo, y no es asimetría por descuido.** El espacio
sobre el contenido no lo pone el padding sino el `gap` de la card (16), así que con 24
abajo la sección quedaba descentrada — medido: 16 contra 25. Arriba se conservan los 24,
que son el aire del encabezado.

**Dev Tools se marca como lo que es**: borde discontinuo y un tinte apricot al 4%, sin
sombra. Es el mismo apricot de la marca `DEV` del sidebar, así que las dos señales de "esto
no es producción" son la misma señal.

**Los contextos de Canales arrancan plegados, y cada uno dice qué esconde.** Con dos
contextos y catorce canales —que es la forma real de los datos, no una hipótesis— la lista
abierta mide más que la sección General entera y no entra en pantalla; cerrada son dos
filas. Pliega el chevron y no la fila completa: la fila lleva el input del renombre, y ese
click no puede además plegar. Un contexto sin canales no muestra chevron —no hay nada que
abrir— pero conserva su hueco, o los nombres no arrancan en la misma columna.

**Un canal elegido se muestra como su chip teñido, en todas las pantallas.** El selector
de Calendarios (la lista y el modal de alta) y el del modal de objetivos usaban un chip
gris o el apricot genérico de `.chip.is-set`; es el mismo dato que el `#tag` de las
tarjetas, y verlo en dos colores distintos según la pantalla lo desconecta de su canal. Los
tokens salen de `chipVars` —o de `chipVarsForColor` cuando solo se tiene el token y no la
`Category`, que es el caso de los selectores que trabajan sobre `SearchOption`—.

**El contador es histórico, no pendientes.** La pregunta de esta sección es "¿este canal
sirve para algo?", y "¿qué me falta?" ya la responde el Backlog. Medido sobre los datos
reales: contando solo lo pendiente, catorce de dieciséis canales marcan cero y la columna
no distingue nada. Con el histórico, los que nunca se usaron se ven de una pasada, que es
lo que hace falta para decidir si borrar. **No cuenta los eventos ignorados**
(`rail_only`): sin ese filtro el canal del feed sale como el más usado de todos por
reservas de hora — en la base real son 18 de 67.

Y va en su propio comando (`category_usage`), no como un campo de `Category`:
`list_categories` se lee en cada picker de canal de la app y no tiene por qué pagar un
`COUNT` sobre `tasks` cada vez.

**Las ocho cards se separan con sombra difusa, no con el borde solo.** Con
`--shadow-sm` (1px) la columna de secciones se leía como una tabla; van con
`--shadow-md` y radio `--radius-lg`, a 32px unas de otras. La sombra lleva además un
`inset 0 1px 0` blanco al 5%: no se ve en claro, y en oscuro es lo único que despega el
canto superior de la card del fondo, donde el borde y la sombra casi no tienen contraste.

**El resaltado automático se calla mientras dura un viaje por click.** Apretar una tab
anima el scroll hasta su sección, y esa animación cruza todas las intermedias: el
`IntersectionObserver` emitía por cada una y el menú marcaba cuatro secciones en 320 ms
antes de quedarse en la que se apretó. Un `ref` con el destino hace que el observer se
ignore mientras el viaje corre, y se suelta un frame **después** del último paso —soltarlo
en el mismo tick deja pasar la emisión de la última intermedia, que es justo el rebote—.
Hay además un `setTimeout` de respaldo: la animación avanza por `requestAnimationFrame`,
que no corre con la ventana oculta, y sin esa red un click seguido de esconder la ventana
dejaba el candado puesto para siempre.

**La sección abierta del menú se marca con la misma regla que `.set-weekday.is-on`**
(apricot al 22% con `--apricot-ink`, contraste ya medido). El fondo que usaba antes,
`--surface-raised`, es exactamente el de las cards que la tab tiene al lado, y por eso el
diseño viejo necesitaba además una barrita apricot a la izquierda para que se notara.

## La marca

**Un sol saliendo sobre el horizonte, y un solo archivo.** `public/app-icon.svg` es la
fuente: de ahí salen el icon set del `.app` y del `.dmg` (`pnpm iconos`, que reescribe
todo `src-tauri/icons/`) y el favicon de las dos ventanas. **No editar los PNG a mano.**

Dos formas macizas y nada más, sol y horizonte. Rayos, nubes o reflejos son trazos finos
que a 32px se vuelven suciedad, y 32px es el tamaño en que un icono se usa de verdad. El
cielo es oscuro aunque la app sea clara: vive en el Dock sobre el fondo de pantalla de
cualquiera, y un sol pastel sobre cielo pastel desaparece.

Dentro de la app la marca es `SunriseMark.tsx`, la misma figura **sin el cielo**: el
horizonte va en `currentColor` y el sol en los tokens. El apricot queda arriba y el butter
abajo, no al revés: el borde superior es la única silueta que la separa del fondo, y
butter sobre el `--surface` claro no se ve. Los ids de los degradados salen de `useId()`,
porque dos marcas montadas a la vez con el mismo id hacen que el navegador resuelva ambas
referencias al primer `<defs>`, y una deja de responder a su propio degradado sin que nada
falle.

**`pnpm iconos` deja `icon.icns` modificado aunque el dibujo sea idéntico**: el generador
escribe las entradas del contenedor en orden distinto cada vez, así que difiere el 99% de
los bytes con el mismo tamaño exacto. Si regeneras y **solo** cambia ese archivo,
descártalo con `git checkout src-tauri/icons/icon.icns`; los PNG, que sí son
deterministas, son la señal de si el dibujo cambió.

Ojo con el SVG: **es XML**, así que un comentario no puede contener dos guiones seguidos.
Nombrar un token como `--ink` ahí lo vuelve ilegal y `tauri icon` falla con un error de
parseo que no menciona el logo. Hay un test que lo agarra ([§8](tests.md)).

## Tipografía

**Sora** (títulos) + **Manrope** (cuerpo), auto-hospedadas (`@fontsource`) para funcionar
offline. Paleta en tokens CSS con tema claro/oscuro.
