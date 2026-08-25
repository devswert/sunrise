# Cambios

Una entrada por versión publicada, de la más nueva a la más vieja. **Este archivo
no es decorativo: es la fuente de lo que se anuncia.** De cada sección salen dos
cosas, y por eso el formato es estricto:

- **El primer párrafo es el anuncio.** Es lo que la app muestra en el modal "Lo
  nuevo" después de actualizarse, y lo que se lee en Configs → Actualizaciones
  *antes* de actualizar. Escríbelo para alguien que solo quiere saber si le
  conviene: dos o tres frases.
- **La sección entera es el cuerpo del Release**, con el detalle: qué cambió, una
  línea por cosa. Ahí sí caben los tecnicismos.

El formato lo mantiene la skill `sunrise-release`, que además sube la versión en
los tres archivos y crea el tag. Hay un test que se pone rojo si la versión de
`package.json` no tiene sección acá.

## v0.4.0 — 2026-08-25

Planificar la semana ya no obliga a salir del tablero: el backlog se abre como
panel al lado de los días y las tareas se arrastran al día que les toca, y de
vuelta cuando decides que hoy no. La app también avisa cuando viene la próxima
reunión, y Configs estrena dos secciones: qué avisos llegan y con qué sonido, y
la campana y la tipografía.

Si vienes de la 0.3.0 hay dos arreglos que se sentían como datos malos: la weekly
review podía inventar horas cuando un timer cruzaba la medianoche, y en tema
oscuro había texto ilegible sobre los chips de color. El respaldo automático,
además, ya no espera a que despiertes la ventana.

### Detalle

- **El backlog es un panel de la vista semana**, arrastrable en los dos sentidos:
  al día y de vuelta. En el sidebar el ítem lleva su total en un badge y ya no
  lista los canales.
- **La vista Backlog es un tablero**: un contexto por columna, con buscador por
  título, el contador de cada columna, y la misma card que el resto de la app.
- **Avisa de la próxima reunión del calendario.** Dice la hora del evento y no los
  minutos que faltan, y no se pone al día: una reunión que ya empezó no avisa, así
  que un Mac recién despertado no manda seis avisos viejos.
- **Los avisos llevan al lugar que nombran.** Focus abre en la tarea del aviso y
  el del cierre del día abre el shutdown; se fue el botón "Cerrar", que no hacía
  nada que el gesto de siempre no hiciera.
- **Configs → Notificaciones**: qué avisos llegan y con qué sonido, con botón de
  probar (un nombre de sonido que no existe no suena y no falla, así que probar es
  la única forma de distinguirlo de un typo). El aviso de la campana viene apagado
  y el del cierre encendido.
- **Configs → Apariencia**: la campana puede ser un audio propio elegido con el
  Finder, y la tipografía son dos ajustes —títulos y cuerpo— porque son dos roles.
- **24 colores en tono medio** para contextos y canales, donde antes había 8 que
  se repetían. Elegidos midiendo distancia perceptual en los cuatro usos de cada
  color; **los nombres no cambian**, así que no hay categorías rotas.
- **El texto sobre color sigue al tema.** El badge del timer en curso y los chips
  de canal quedaban en contraste 1.1 en oscuro, o sea invisibles.
- **El botón de confirmar, el texto seleccionado y los botones deshabilitados eran
  ilegibles** (contraste 2.0 y menos). Ahora van sobre sólidos calibrados, y hay
  un test que lee todos los CSS para que no vuelva a pasar.
- **El canal se dibuja siempre como chip**, también en el modal de detalle.
- **Un recorte manual de tiempo se reparte entre los días trabajados.** Con un
  timer que cruzó la medianoche, bajar el total a mano dejaba el día de la tarea
  en negativo y el sobrante se descartaba en silencio: la weekly review mostraba
  15h de una tarea de 3.
- **El respaldo automático lo corre el proceso nativo.** Con la ventana tapada
  esperaba a que algo la despertara: con la hora en 00:22, el zip salía a las
  00:27. Se puede desmentir la marca del día ("Volver a respaldar hoy"), y ahora
  corre también en dev, con nombres separados de los de producción.
- **El aviso de la campana ya no trae sonido**: dos sonidos en el mismo instante
  se oían como uno reventado.

## v0.3.0 — 2026-08-22

Si tienes la 0.2.0 esta actualización es obligada: ahí el ritual diario se iba a
pantalla en blanco al entrar al paso 2, el Backlog no cargaba, y la campana del
estimado no sonaba mientras la ventana estuviera tapada. Las tres quedan
arregladas.

Lo nuevo es la vista semana: dibuja tres semanas con scroll horizontal y abre con
hoy al centro, así reprogramar una tarea a la semana que viene ya no obliga a
cambiar de vista.

### Detalle

- **El ritual diario y el Backlog volvieron a abrir.** Dos campos que viajaban
  con un nombre distinto del que declaraba el front (`fromDate` leído como
  `from`, la clave `to` mandada a un parámetro `to_date`) dejaban el paso 2 del
  planning en blanco, el Backlog roto, y la bitácora y el cierre de jornada sin
  datos. Ahora lo vigila un test del contrato de IPC.
- **La campana la toca Rust, no una ventana.** La decisión vivía en el tick del
  webview, y un webview tapado no corre sus timers: la campana esperaba a que
  algo despertara la ventana. Ahora duerme en el proceso nativo y vuelve a leer
  la base antes de sonar. De paso, subirle el estimado a una tarea ya no la deja
  muda para siempre.
- **La vista semana muestra tres semanas** —la anterior, la del ancla y la
  siguiente— con scroll horizontal, rótulo pegado y días plegables, y al abrir
  centra hoy en vez de alinear el lunes al borde.
- **El calendario dejó de bajar todos los feeds a cada cambio de ventana.**
  Volver a la app sincroniza, pero con un freno; antes cada `focus` golpeaba el
  feed entero.
- **⌘Q levanta la ventana antes de preguntar.** Minimizada, el diálogo de salida
  no se veía y la app parecía colgada con el timer corriendo.
- **La marca de "ya planificaste hoy" guarda la hora y se puede desmentir.**
- **Un ajuste manual de tiempo se acredita al día de la tarea**, no al día en que
  lo escribiste: corregir el lunes las horas del sábado ya no las cuenta en lunes
  ni las manda a otra semana en el rollup.
- **Borrar una tarea desde el modal saca la card de la vista.** Era la única
  mutación que no avisaba, y el gesto se sentía muerto.
- **El arrastre deja la card donde se suelta.** Reordenar dentro de un mismo día
  la dejaba un lugar antes.
- **La fecha de las tareas rescatadas va en el rótulo del grupo** ("Desde el
  18 ago"), una vez por día, en vez de repetida bajo cada card.
- **Configs:** dar de alta un canal, el corrector de los campos de texto y el
  foco de los selects con búsqueda; y una sección Dev Tools que dispara las
  notificaciones probables para poder verlas sin esperarlas.
- **El contenido sube a 32px del borde.** Sin barra de título, el respiro de
  arriba era aire, y el logo arrancaba 4px más abajo que el contenido.
- **La app distribuida se ve igual que la compilada acá.** CI compila en
  `macos-26`; con el runner viejo los botones de ventana salían de otro tamaño.

## v0.2.0 — 2026-08-18

Más espacio para trabajar: el sidebar se colapsa a una barra de iconos con un
click, y la ventana dejó de gastar alto en una barra de título. De paso las barras
de scroll siguen la paleta de la app en vez de verse como las del sistema.

### Detalle

- **Sidebar colapsable.** El botón vive arriba, junto a la marca. Colapsado queda
  un rail de 78px con los iconos más grandes; los nombres se van pero el aviso de
  versión nueva se queda, como icono. La elección se recuerda entre sesiones.
- **La ventana ya no tiene barra de título.** Los botones de macOS flotan sobre el
  contenido y la app se mueve arrastrando desde el borde superior.
- **Las barras de scroll se dibujan.** Antes eran las del sistema, que en tema
  oscuro se veían claras; ahora siguen la paleta. El sidebar es la excepción y no
  muestra la suya, porque reservarle ancho dejaba el rail descentrado.
- **Los controles nativos siguen el tema.** `color-scheme` va declarado en las tres
  ramas, así que los `<select>` y el caret dejaron de salir claros sobre el tema
  oscuro.

## v0.1.1 — 2026-08-18

Arregla la primera instalación. La 0.1.0 se bajaba y macOS decía que el paquete
estaba dañado, lo que no era cierto: le faltaba una firma. Si ya la tienes
instalada y andando, esta versión no te cambia nada — sirve para que la próxima
persona que baje el `.dmg` no tenga que adivinar.

### Detalle

- El bundle de macOS ahora se firma ad-hoc (`signingIdentity: "-"`). Sin eso solo
  quedaba firmado el binario, que el linker de Apple Silicon firma por su cuenta,
  y esa firma a medias prometía recursos sellados que nadie había sellado. Ante la
  contradicción macOS reportaba `"sunrise" is damaged`, no el aviso normal de
  desarrollador sin verificar.
- Firmar ad-hoc no es notarizar: la primera instalación sigue pidiendo
  `xattr -cr /Applications/sunrise.app`, y ahora eso está escrito en el README con
  los pasos completos.
- Documentado el modo de falla y por qué en SPECS §4.19.

## v0.1.0 — 2026-08-18

La primera versión que se puede instalar. Planificas el día, cronometras lo que
haces con una ventana flotante que se queda encima de todo, y cierras la jornada
con una bitácora que se arma sola. Tus reuniones entran solas desde el calendario
y todo vive en un SQLite en tu máquina.

### Detalle

- Semana de siete columnas con arrastrar y soltar, planificado contra real, y
  semáforo de capacidad.
- Taxímetro por tarea con ventana flotante y campana al pasar el estimado.
- Focus: una tarea a la vez, en la cola que decidiste.
- Calendario por ICS con sincronización automática, y reconciliación que no borra
  una reunión que ya trabajaste.
- Agenda del día con lo agendado, lo que ocurrió y las tareas sin hora
  proyectadas en los huecos.
- Weekly review y cierre del día, con horas por canal y avance de objetivos.
- Respaldos en `.zip` con manifest, a la hora y en la carpeta que elijas.
- Actualizaciones automáticas desde el Release: se avisan en el sidebar y se
  instalan cuando tú quieras.
