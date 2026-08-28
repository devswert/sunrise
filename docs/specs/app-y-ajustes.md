# §4.8–4.11, 4.24, 4.28 El marco de la app y sus ajustes

Settings, atajos de teclado, el cierre de la app, el tema, Dev Tools y Apariencia.

Vuelve al [índice de SPECS](../SPECS.md).
---

### 4.8 Settings

Seis secciones, cada una con título y bajada propia (`Card` en
`SettingsView.tsx`), en este orden: **General**, **Apariencia** (§4.28),
**Calendarios** (§4.12), **Canales**, **Atajos de teclado** (§4.9),
**Notificaciones** (§4.27) y **Respaldo** (§4.17). En dev hay una séptima al final,
**Dev Tools** (§4.24), que la app instalada no muestra. El orden de la
lista lateral y el de las cards **tienen que coincidir**: el resaltado lo decide
un `IntersectionObserver` sobre las secciones, así que si divergen la lista marca
una y se ve otra. Las dos salen de la misma lista, `settings/secciones.ts`, que es
también de donde sale el icono de cada una (§7) — y desde Mej.1 lo vigila un test
(§8), porque hasta entonces era una regla escrita sin nada que la sostuviera.

- Capacidad diaria: autosave al salir del foco, acepta `8h`/`7h30`/`480`.
- **Jornada** (`work_start`/`work_end`): dos horas en formato 24 h, autosave al
  salir del foco. Es lo que dibuja la grilla del rail (§4.13). El formulario
  **valida al escribir** —hora imposible o rango invertido se rechazan y se
  avisan— aunque `workHours()` ya caiga al default: ese fallback protege la
  lectura de la base, pero si el campo se tragara un `25:00` en silencio, el rail
  no cambiaría y nada explicaría por qué.
- **Días plegados** (`collapsed_weekdays`): siete botones con los días de la
  semana, marcados los que se dibujan como tira angosta en la vista semana (§4.3).
  Por defecto sábado y domingo. Siete botones y no siete interruptores porque la
  pregunta es "cuáles", y una fila se lee de un vistazo. Se guarda como números
  ISO separados por coma (`"6,7"`).
- **Prioridades** (`priorities_enabled`, encendido de fábrica): el único ajuste de
  §4.30, y es un interruptor y no una tabla de niveles a propósito — la escala es
  fija. Apagarlo esconde el indicador de las cards, el selector del detalle y los
  filtros del backlog; **el nivel de cada tarea se conserva**, así que probar el
  switch no cuesta repriorizar nada.
- **Abrir sunrise al iniciar sesión** (§4.18): el único control de Configs que
  **no** lee ni escribe la tabla `settings`.
- **El alta de un contexto o canal se confirma con Enter o al salir de la fila**,
  no en el blur del nombre: elegir el color primero perdía el alta a medio camino
  (la regla completa, en §7).
- Contextos/channels: renombrar en línea, borrar, y el color se elige con un
  **punto que abre la paleta en un popover** (grilla de 6×4). Las muestras solían
  estar visibles en cada fila: con ocho categorías eran 64 puntos compitiendo con
  los nombres, que es lo que uno viene a leer — con veinticuatro colores serían
  192, así que el popover pasó de conveniencia a requisito.

Los ajustes viven en la tabla `settings` (TEXT/TEXT) y se leen vía
`src/lib/settings.ts`: `useSettingsStore` los carga desde `Shell` y los relee con
cada invalidación, así un cambio en una ventana llega a la otra.
**Toda lectura pasa por un parser con fallback** (`dailyCapacityMinutes`,
`capacityWarnRatio`, `workHours`, `planMark`, `collapsedWeekdays`, `noticeSound`,
`bellSound`, `fontFamily`): la clave puede faltar, venir vacía o traer basura editada a
mano, y un `NaN` suelto dejaría el semáforo en OK para siempre sin error visible,
porque toda comparación con `NaN` es false.

`planned_at` (§4.14) es la primera clave que **no siembra ninguna migración**, y
está bien: `set_setting` es un upsert y la lectura ya tiene fallback. Guarda una
sola marca, no un historial — la pregunta es "¿ya planifiqué hoy?"; llevar la
cuenta de qué días planificaste es materia de la review.

**Guarda fecha y hora** (`'YYYY-MM-DDTHH:mm'`, hora local), y no la fecha pelada
con la que nació. Con la fecha sola la app afirmaba algo que no se podía
desmentir: un ritual cerrado a las 00:20 marca el día que recién empieza, y el
aviso no tenía con qué decir cuándo fue. Dos reglas que van juntas y se rompen en
silencio si se separan:

- **Se escribe con `toISOTimestamp`, nunca con `toISOString()`.** Los primeros
  diez caracteres tienen que ser el mismo día que devolvería `todayISO()` en ese
  instante, porque es contra ese prefijo que se compara al leer. `toISOString()`
  da la fecha **en UTC**: en Santiago, las últimas cuatro horas de cada día
  quedarían marcadas como el día siguiente — el mismo error de medianoche que la
  hora vino a hacer visible, movido de lugar.
- **Al leer, el string no pasa por `new Date()`.** `planMark` corta en la `T`:
  `new Date('2026-08-21')` es medianoche **UTC**, que acá se lee como el día
  anterior a las 20:00. La hora es opcional en la lectura —una marca sin hora
  vale como "ese día" y el aviso lo dice así—, porque una fecha pelada es lo que
  puede quedar de una edición a mano.

La migración 10 **borra** la clave vieja (`planned_on`) en vez de renombrarla:
nadie sabe con qué gesto se escribió el valor que había (Mej.23 lo dejó anotado
sin afirmarlo), y moverlo a una clave que ahora promete una hora sería inventarle
una procedencia.

**`collapsed_weekdays` es el caso contrario, y es la única clave donde la ausencia
y el vacío no significan lo mismo**: ausente es "nunca se configuró" y toma el
default (el fin de semana); presente y vacío es "ningún día plegado", que es una
elección legítima. Si las dos cayeran al default, destildar los siete días en
Configs rebotaría a sábado y domingo y la semana completa sería inexpresable. **Por
eso la migración 9 siembra la fila**, al revés que `planned_at`. La basura se
tolera como basura: se queda con los números 1..7 y descarta el resto sin volver
al default, así un `"6,ocho"` editado a mano pliega el sábado y no promete nada
sobre lo que no entendió.

### 4.9 Atajos de teclado

Registro central en `src/lib/shortcuts.ts` (`SHORTCUT_ACTIONS`) y **un solo
listener** (`useShortcuts`, montado por `Shell`), en vez de un hook por atajo:
agregar un atajo es agregar una fila, y la detección de colisiones tiene todo a
la vista.

| Acción | De fábrica |
|---|---|
| Nueva tarea | `Mod+A` |
| Ir a Home | `Mod+1` |
| Ir a Today | `Mod+2` |
| Ir a Focus | `Mod+3` |
| Ir a Configs | `Mod+,` |
| Mostrar u ocultar el sidebar | `Mod+S` |

- Se guardan en `settings`, **una fila por atajo**: `hotkey_<accion>`.
- El valor es **normalizado y portable**: `Mod+Shift+F`, nunca `cmd+F`. `Mod` es
  ⌘ en macOS y Ctrl en el resto. La plataforma solo importa al **mostrar**
  (`displayCombo`), nunca al comparar: `matchesCombo` acepta ⌘ **o** Ctrl.
- Shift y Alt se comparan **exactos**, para que ⌘⇧A no dispare el atajo de ⌘A.
- Un valor guardado que no se entiende cae al de fábrica (`resolveShortcuts`),
  igual que el resto de `settings`. Un valor vacío también: así "restaurar" es
  escribir `""` y no hace falta un comando para borrar filas.
- **Los atajos se ignoran si el foco está en un `input`, `textarea` o
  `contenteditable`** (`isEditingText`), para no pisar "seleccionar todo" y
  equivalentes. Mismo criterio que las flechas de Focus.
- En Settings se reasignan **pulsando la combinación**, no escribiéndola; la
  captura usa `capture: true` para ganarle al listener global, y avisa si la
  combinación ya la usa otra acción en vez de dejar un atajo muerto.
- El **sidebar muestra el atajo** junto a los ítems que tienen uno, en texto
  apagado. Va con `aria-hidden` más un `aria-keyshortcuts` en el link: si el
  texto quedara dentro del link, el nombre accesible pasaría a ser "Focus ⌘ 3"
  en vez de "Focus" (y los tests que buscan el link por nombre se caen, que fue
  justo como se detectó).

### 4.10 Cierre de la app

Cerrar con ⌘Q, el menú Quit o el botón de la ventana **pide confirmación**.
Rust cancela el cierre y emite `sunrise://close-requested`; el front abre el
diálogo (`QuitConfirm`) y solo al confirmar llama a `confirm_quit`, que cierra.
No protege datos —todo se autoguarda—: evita que un ⌘Q accidental baje la app.

- **En macOS hay que reemplazar el ítem Quit del menú.** El predefinido mapea a
  `NSApplication terminate:`, que mata el proceso **sin pasar por el event
  loop**: ni `ExitRequested` ni `CloseRequested` llegan, y ⌘Q cierra de una. En
  `setup` se cambia por un `MenuItem` propio (`sunrise-quit`) con el mismo
  acelerador, que llega como `MenuEvent`. Si el menú por defecto de Tauri deja
  de terminar en el Quit esperado, se deja tal cual y se avisa por log en vez de
  borrar el ítem equivocado.
- `WindowEvent::CloseRequested` se atiende **solo para `main`**: el taxímetro no
  debe abrir este diálogo.
- En `RunEvent::ExitRequested`, `code: None` significa que lo pidió el usuario
  (⌘Q, menú) ⇒ se cancela y se pregunta. `code: Some(_)` es una salida
  programática —la de `confirm_quit`— ⇒ pasa sin volver a preguntar. Ese
  contraste evita necesitar un flag global de "ya confirmó".
- El diálogo se cierra con Escape y confirma con Enter, y **suspende los atajos
  globales** mientras está abierto para que no se navegue por debajo.
- **Los tres caminos pasan por `request_close`, que levanta `main` antes de
  preguntar** (`unminimize` + `show` + `set_focus`). El diálogo vive **dentro** de
  esa ventana, así que con la ventana minimizada el usuario apretaba ⌘Q, no veía
  nada y la app parecía colgada con el timer corriendo. **macOS no la levanta
  solo**: con la ventana minimizada y la app al frente, ⌘Q dejaba `AXMinimized` en
  true y el proceso vivo — o sea el pedido llegaba y la respuesta se dibujaba
  donde nadie la ve. La alternativa —un `ask()` nativo— se descartó en Mej.17: el
  diálogo propio es el mismo componente que el resto de la app.

> **Cómo se comprueba esto, que no lo cubre ningún test** (no hay ⌘Q en jsdom ni
> en el browser). Con `pnpm tauri dev` arriba, desde AppleScript: minimizar
> `window "sunrise"` del proceso, dejar la app al frente, mandar `keystroke "q"
> using command down` **al proceso** —nunca a System Events global, que se lo
> come la app que esté adelante— y leer `AXMinimized` después. `true` es el bug;
> `false` con el proceso vivo es el arreglo. Un `screencapture` sería la prueba
> directa, pero necesita permiso de Grabación de pantalla, que no se pide.

**El timer no se detiene al cerrar.** Dejar el taxímetro corriendo entre
sesiones es el comportamiento esperado: la entrada queda abierta y sigue
contando. El diálogo lo dice cuando hay uno activo, para que no sorprenda al
volver.

### 4.11 Tema

Claro/oscuro en `src/lib/theme.ts`, persistido en `localStorage` bajo
`sunrise-theme`. El taxímetro escucha ese `storage` y sigue el tema de `main`.

### 4.24 Configs → Dev Tools (solo en dev)

La última sección de Configs, y **la única que depende del binario**: se dibuja
solo cuando `profile.dev` es `true` (§4.20). No son ajustes — nadie que use la app
instalada tiene por qué ver un botón que dispara un aviso de mentira—, así que va
después de Respaldo y con su propio criterio de existencia.

> **I** — **La lista y las cards se filtran con el mismo booleano.** El resaltado
> de las tabs lo decide un `IntersectionObserver` sobre las secciones (§4.8), así
> que una tab sin su card marca una y muestra otra. `visibleTabs(dev)` en
> `settings/secciones.ts` es el único lugar donde se decide, y la card se dibuja
> con la misma condición. Fuera de Tauri el mock dice `dev: true`, que es lo
> correcto: en el browser y en jsdom no hay ninguna app instalada.

**Probar las notificaciones** es la primera herramienta que vive ahí (Mej.16).
Los avisos nativos son el único camino de la app que **no se puede ver ni en el
browser ni en jsdom** y encima dependen del reloj (§4.16), así que antes cada
cambio en esa maquinaria se verificaba esperando. Tres controles:

- **Probar cada aviso**, con **el texto de verdad**. Los textos viven en
  `features/notifications/notify.ts` (`SHUTDOWN_NOTICE`, `nextTaskNotice`) y de
  ahí los toman los dos consumidores. Es la misma razón que el changelog: si el
  botón escribiera su propia versión, la prueba diría una cosa y el aviso real
  otra, y no se notaría hasta que llegue el real.
- **El estado del permiso a la vista.** Sin permiso el aviso simplemente no llega
  y nada en pantalla lo dice; peor, el aviso del cierre marca el día igual a
  propósito. El plugin solo expone `isPermissionGranted()`, un booleano, así que
  **"denegado" y "nunca se preguntó" no se pueden distinguir** sin pedirlo — y
  pedirlo al renderizar abriría el diálogo de macOS sin que nadie lo pidiera. Por
  eso el estado es `granted | unknown | unavailable` y el texto de `unknown` dice
  las dos posibilidades, con la ruta de Ajustes del sistema para el caso denegado,
  que ya no se puede volver a pedir desde la app.
- **Volver a avisar hoy**, que borra `shutdown_notified_on` para probar el camino
  real sin esperar al día siguiente. Toca **solo** esa clave: `planned_at` se
  parece pero es de otro ritual, y el suyo se borra desde su propio aviso
  (§4.14).

**El botón lo único que hace es mandar**: no escribe `shutdown_notified_on`. Si lo
escribiera, probar un aviso con el permiso denegado apagaría el aviso real de ese
día.

**El aviso de "próxima tarea" existe acá antes que su disparador** (Mej.4 todavía
no está): hoy el botón es lo único que lo muestra. Cuando se haga, tiene que
consumir `nextTaskNotice` en vez de escribir su propio texto.

#### Dos cosas de los avisos nativos que no son nuestras

**En dev, el aviso lleva el icono de la Terminal, no el de sunrise.** No es un
bug de la app ni le falta nada al icon set: el plugin lo hace a propósito, en
`desktop.rs`, `set_application("com.apple.Terminal")` cuando `tauri::is_dev()`, y
usa el identificador del bundle (`app.sunrise.desktop`) solo en producción. Un
proceso sin `.app` no tiene identidad que macOS pueda atribuir. **Se ve bien en la
app instalada y no hay nada que arreglar en dev.**

**Los avisos suenan, y el de sunrise es `Blow`** (`DEFAULT_SOUND`, probado en la
app). El sonido se elige por **nombre de archivo sin extensión**, y macOS lo busca
en las carpetas `Sounds`: las del sistema (los catorce de fábrica — Basso, Blow, Bottle,
Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink) y
**`~/Library/Sounds`**, que es dónde va uno propio. `SYSTEM_SOUND` es la
alternativa que no es un archivo: el literal `NSUserNotificationDefaultSoundName`,
o sea "el que use el sistema". `notice_sounds()` lista las dos carpetas, así que un `.aiff` dejado ahí aparece en el selector de Dev Tools con el
nombre del archivo, sin extensión. La trampa: **un nombre que no existe no suena y
no falla**, así que un typo deja los avisos mudos sin decir nada.

El selector de Dev Tools **no persiste** la elección: es para escuchar los sonidos.
Elegir el de verdad es un ajuste, y va con Mej.1.

### 4.28 Configs → Apariencia (Mej.1)

Cómo se **ve** y cómo **suena** sunrise: la campana del timer y la tipografía. Son
dos cosas y una sección porque ninguna cambia qué hace la app ni cuándo, solo cómo se
presenta.

**La campana.** `bell_sound` tenía valor sembrado desde la migración 2 y ningún
consumidor (era la deuda D4). Ahora manda:

| Valor | Qué suena |
|---|---|
| `SUNRISE` | la síntesis interna (un cuenco tibetano aproximado) |
| un nombre de archivo | ese audio, de la carpeta `sounds` del directorio de datos |
| ausente, vacío, o un archivo que ya no está | la síntesis |

> **I** — **Manda el ajuste, no la presencia del archivo.** Antes bastaba con dejar
> un audio en el directorio de datos y sonaba; con eso no había forma de volver a la
> campana de la app sin ir a borrarlo. La migración 12 reescribe el valor sembrado
> (`'bell'`, que era un tronco de nombre) a `SUNRISE`, y el efecto que hay que
> nombrar es que **un archivo dejado a mano deja de sonar** hasta elegirlo desde
> Configs. Es a propósito: la copia a mano era el diseño provisorio de cuando no
> había picker.

> **I** — **El audio se valida decodificándolo, no por su extensión.** `play_bell`
> cae a la síntesis cuando el decoder falla, **y en silencio**, porque una campana
> que revienta no puede tumbar el timer. Sin validar al copiar, elegir un archivo que
> rodio no entiende se vive como "elegí mi mp3 y sigue sonando el de la app".
> `install_bell` lo abre con `Decoder::new` y devuelve el error mientras la persona
> mira el diálogo. Y el ajuste se escribe **con el nombre que devuelve Rust**: si la
> copia falla, la campana que sonaba sigue sonando.

Queda **una sola** campana propia: al instalar una, los audios que había en la
carpeta se borran. Y es una subcarpeta (`sounds/`) y no el directorio de datos a
secas justamente por eso — borrar audios en la carpeta que además tiene la base de
datos es pedir un accidente.

**Volver a la campana de sunrise borra la copia.** No se guarda "por si acaso"
porque no habría por si acaso: `bell_sound` guarda un nombre solo, así que al volver a
`SUNRISE` ese nombre se pierde y el archivo queda sin nadie que lo nombre. Lo que se
borra es la copia; el original sigue donde lo eligieron, y la nota de la card lo dice
antes de que lo aprieten. **El ajuste se escribe primero y el borrado después**: al
revés, un borrado exitoso con un `set` que falla dejaría el ajuste nombrando un
archivo que ya no está — sonaría la síntesis y la card seguiría diciendo otra cosa.

**La tipografía son dos ajustes, no uno**: `font_title` y `font_body`. Son dos roles —
los títulos aguantan una fuente con carácter y el cuerpo necesita una que se lea en 12
px— y con una sola clave elegir la de los títulos cambiaría las dos sin decir por qué.
Cada una guarda uno de dos centinelas o **el nombre de una familia instalada**:

| Valor | Qué se usa |
|---|---|
| `SUNRISE` | la de fábrica: **Sora** en títulos, **Manrope** en el cuerpo |
| `SYSTEM` | `system-ui`, sin nombrar familia — la única forma de pedir la del sistema que sigue andando si le cambian el nombre |
| una familia | esa, entre comillas, **más la pila de respaldo detrás** |

Los centinelas van en MAYÚSCULAS para no poder chocar con un nombre de familia real,
que siempre viene capitalizado normal.

**La lista de familias la da Core Text, no la carpeta de fuentes** (`fonts.rs`, con la
crate `core-text`): el nombre que necesita el CSS es el de la **familia** (`Helvetica
Neue`) y el del archivo no lo es (`HelveticaNeue.ttc`), así que sacarlo del nombre de
archivo obligaría a parsear las tablas de cada fuente para llegar a lo que el sistema
ya sabe. Son ~180 familias, así que el selector tiene búsqueda.

> **I** — **La lista se filtra, y no por prolijidad.** Se van las de puntito
> (`.AppleSystemUIFont`, internas de macOS, que CSS no puede pedir por nombre) y **las
> de símbolos y dingbats** (`Symbol`, `Wingdings 2`, `Zapf Dingbats`). Esas sí se
> pueden pedir, y ese es el problema: con una puesta, cada letra de la app sale como un
> cuadrito, y volver atrás habría que hacerlo a ciegas. Las numeradas se filtran por
> palabra y no por nombre exacto, o la lista se queda corta con la próxima versión de
> macOS.

> **I** — **Toda elección arrastra la pila de respaldo.** Una familia desinstalada no
> resuelve, y sin la pila la app se quedaría con la fuente por defecto del webview —una
> serif—: un cambio de tipografía no puede verse como "la app se rompió". Por eso el
> parser **no** valida contra la lista de instaladas: la lista solo existe dentro de la
> app, y el CSS ya hace lo correcto solo.

Se aplica **sobreescribiendo los tokens** `--font-title` / `--font-body` en `<html>`,
no tocando componentes: todo el CSS ya los usa. Con `SUNRISE` la propiedad se **borra**
en vez de reescribirse, para que el valor vuelva a salir de `tokens.css` y no haya dos
lugares diciendo cuál es la fuente de la app. Cada selector muestra debajo una frase de
ejemplo con la fuente puesta y en el tamaño de su rol: es lo único que responde "¿cómo
se ve?" sin cerrar Configs.

> **I** — **La tipografía llega al taxímetro por `localStorage`, igual que el tema.**
> Los valores viven en `settings` —son ajustes—, pero el taxímetro es otra ventana con
> su propio documento y **no monta el store de ajustes**: es una ventana chica que
> solo muestra el timer. La ventana principal manda y espeja el valor; el taxímetro
> lo aplica al arrancar y sigue el evento `storage` (§5.2). La base sigue siendo la
> fuente de verdad; el espejo es el canal. Sin esto, la app en la fuente del sistema
> con el taxímetro en Sora se ve partida.
