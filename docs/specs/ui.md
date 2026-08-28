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

**El botón de confirmar es salvia, no naranjo** (`.btn-primary`, `--sage`/`--sage-ink`).
El damasco es **el mismo tono** que el semáforo de capacidad usa para "te pasaste"
(`--cap-over`), así que un aceptar en naranjo se lee como advertencia. El naranjo queda
para lo que avisa. Todo botón de acción lleva **su icono** además del texto.

**El canal se dibuja siempre como chip**, nunca como texto teñido: la card, el modal y
`CategoryTag` comparten `.cat-tag` y sacan sus variables de `chipVars`. El fondo es lo
que se reconoce de reojo en una lista; un texto de color con 24 colores en tono medio se
lee como texto raro.

## Componentes y patrones

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
