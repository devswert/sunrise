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

## v0.7.0 — 2026-08-31

Configs se rediseñó entera. Cada ajuste ahora muestra a la izquierda qué es y para
qué sirve, y a la derecha lo que se edita, en vez de un párrafo a todo el ancho con
el control perdido al medio; y las explicaciones se acortaron a lo que no se
adivina mirando el control. La sección de Canales arranca plegada y cada canal dice
cuántas tareas lleva, que es lo que hacía falta para saber cuáles sobran.

### Detalle

- Cada ajuste es una fila de dos columnas: a la izquierda su nombre y su
  explicación, a la derecha el control, alineado con el de todas las demás
  secciones. Entre ajustes va una línea, así una sección de cinco campos deja de
  leerse como un bloque de texto.
- La vista quedó centrada, como el resto de las pantallas, y el título pasó a
  "Configuraciones", con su icono.
- **Canales arranca plegado.** Con dos contextos y catorce canales la lista abierta
  no entra en pantalla; cerrada, cada contexto dice cuántos canales tiene.
- **Cada canal muestra cuántas tareas lleva**, para poder decidir si sobra. Es el
  total histórico y no lo pendiente —contando solo lo pendiente, casi todos marcan
  cero— y no incluye los eventos del calendario marcados como ignorados: reservar
  hora no es usar el canal.
- El nombre de un canal se pinta con su color, y el canal elegido se muestra como
  su chip `#tag` en las tres pantallas donde se elige: la lista de calendarios, el
  alta de un calendario y el detalle de un objetivo.
- Canales, Atajos y los calendarios pierden las cajas y pasan a una lista con
  líneas de separación. Un calendario con error, que lo anunciaba con el borde de
  su caja, ahora lo dice con una banda roja a la izquierda.
- Los atajos se ven como los demás ajustes, con la combinación y su botón de
  restaurar unidos en un solo control.
- Dev Tools se distingue con borde discontinuo: es un banco de pruebas, no una
  sección de ajustes, y solo existe en dev.
- El menú lateral deja de rebotar al apretar una sección: la animación cruzaba las
  secciones intermedias y el resaltado marcaba cuatro antes de quedarse en la
  elegida.
- El icono de cada sección quedó a la izquierda de su nombre, y las cards se
  separan con más aire y una sombra más suave.

## v0.6.0 — 2026-08-28

Las tareas ahora tienen prioridad, de P1 —lo que arde— a P5 —lo que puede
esperar—: se ve como una marca de color en la card y el backlog se filtra por
ella, así que saber qué atacar deja de pedir leer la lista entera. Si prefieres
no verla, se apaga entera desde Configs → General sin perder lo que ya marcaste.

Además, un título largo dejó de romper las cards, el modal y las listas del
cierre; ⌘S esconde el sidebar cuando quieres la pantalla completa; y un link
pegado en el título de una tarea nueva se guarda solo en sus recursos. De los
arreglos, tres se notan a diario: un evento ignorado ya no aparece como pendiente
en el cierre del día, un ajuste de tiempo a mano ya no dibuja la tarea a mediodía
en el rail, y completar desde el taxímetro deja la siguiente esperando su play en
vez de arrancar sola.

### Detalle

- Prioridad P1–P5 en columna nueva (migración 16), con "Sin prioridad" como
  estado propio: marca en la card, selector en el detalle, filtro multiselección
  en Backlog y en el panel de la semana, e interruptor en Configs → General.
- Un link pegado en el título del modal de creación se saca de ahí y se escribe
  en las notas bajo `# Recursos:`.
- ⌘S muestra u oculta el sidebar; el colapso pasa a un store para que el botón y
  el atajo no se desincronicen.
- Los títulos largos: dos líneas con elipsis en la card, textarea que crece hasta
  cinco líneas en el detalle y en "Nueva tarea", y medida de lectura en los
  highlights.
- El cierre del día lee `tasksByDate`, así que un evento ignorado ya no aparece
  entre los pendientes.
- `day_work` devuelve `tracked_at` desde las corridas del taxímetro: un día con
  ajustes manuales ya no apila bloques a las 12:00 en el rail.
- Completar desde el taxímetro avanza a la siguiente pero no la arranca, y con la
  cola vacía Focus cierra el día con el resumen y el botón al shutdown.
- Sacarle la fecha a una tarea mueve el contador de Backlog en el sidebar.
- Focus: el encabezado pasa a dos filas para darle el ancho al título, el chip
  del canal usa su color configurado y la línea sobre las notas solo aparece en
  tareas del calendario.
- `docs/SPECS.md` queda como índice; el contenido vive en `docs/specs/`, con la
  numeración intacta.

## v0.5.0 — 2026-08-27

Los objetivos de la semana dejaron de ser una lista que se mira: ahora se abren
en detalle, reparten sus horas por día creando las tareas solas, y la weekly
review filtra por objetivo y canal para decir cuánto se fue en cada cosa. El
calendario también dejó de mentir: una reunión movida ya no alterna entre su
hora vieja y la nueva de una sincronización a otra, y lo que rechazaste no
aparece.

Si actualizas, el update se ve mientras baja —con barra y porcentaje— y la app
vuelve al frente al reiniciarse, en vez de quedar escondida detrás de lo que
tuvieras abierto.

### Detalle

**Objetivos**

- **La vista semanal navega entre semanas.** Antes anclaba en una fecha
  congelada al abrir, así que solo se veían los objetivos de la semana actual.
- **Modal de detalle con reparto Lun→Dom**: elegir minutos en un día crea la
  tarea colgada del objetivo. Nunca borra — a cero la desliga.
- **Los objetivos llevan canal propio**, de la misma tabla que usan las tareas
  (migración 13). No hay canales especiales de objetivos.
- **Weekly review**: los tres paneles a un tercio, filtros por objetivo y canal
  (OR dentro de una dimensión, AND entre dimensiones) y el corte de horas entre
  objetivos y el resto.
- **La card marca si la tarea cuelga de un objetivo**, con el icono y sin nombre.
- **La tira de las últimas semanas va arriba** de los objetivos —es el contexto
  con el que uno decide qué proponerse— y deja de rebotar entre estados.
- **"Sin canal" y "Sin objetivo" ahora sí borran.** Un patch con `null` no se
  distinguía de un campo ausente dentro de Tauri, así que esos dos botones del
  detalle de tarea no hacían nada en la app instalada.
- **Una reunión ligada a un objetivo cuenta sus horas.** Faltaba el
  `objective_id` en una de las dos consultas del reparto por día.

**Calendario**

- **Una reunión movida se queda donde la moviste.** Google manda el evento
  maestro y la instancia editada con la misma clave, y el orden entre las dos
  cambia entre descargas: la hora alternaba entre la vieja y la nueva de una
  sincronización a otra.
- **Editar una recurrente con "este evento y los siguientes" ya no duplica.**
  La serie partida cambiaba la clave de cada repetición futura y se perdían
  canal, notas y posición; la migración 15 alinea las filas que ya estaban así.
- **Lo que rechazaste no entra.** Se detecta con tu propio correo, que viene en
  el feed: no hay nada que configurar. Y el organizador conserva su respuesta al
  deduplicarse — se perdía en todos los eventos que organizas tú.
- **La columna del día ordena los eventos por hora**, pero un evento nunca
  desplaza una tarea tuya: la columna es el plan del día.
- **Eventos ignorados, por serie**: un focus time ocupa su hora en el rail y
  nada más — fuera del tablero, de la carga, de Focus, de los avisos y de la
  review.

**Actualizaciones**

- **El avance de la descarga se ve**: preparando, bajando con su porcentaje,
  instalando. Sin tamaño anunciado va indeterminada en vez de inventar un número.
- **Al reiniciar, la app vuelve al frente.** macOS no activaba la ventana nueva,
  y el síntoma era "apreté actualizar y nunca se reinició".
- **El aviso del sidebar es una tarjeta, no una fila**, y el fallo ahora se ve:
  antes vivía solo en el tooltip.
- **El anuncio "Lo nuevo" amanece**: cabecera con el sol saliendo por el
  portezuelo de la cordillera, título con la versión y su fecha.
- **"Ver lo nuevo" en Configs**, porque el aviso dura 30 s y después el anuncio
  quedaba inalcanzable. E instalar desde Configs ya no ofrece una segunda
  descarga del mismo paquete desde el sidebar.

**Interfaz**

- **Lo que está corriendo cambia de icono.** Los botones que esperaban giraban su
  propio icono —el de sync hacía dar vueltas un calendario, que rotando no
  significa nada—; ahora se reemplaza por el spinner, en los siete lugares que
  tenían estado de espera, incluidos tres que no mostraban nada: "Respaldar
  ahora", "Agregar" de un feed y "Elegir un audio".
- **El icono girando ya no late.** Un `<svg>` recorta por defecto y la tinta de
  las esquinas se salía dos veces por vuelta.
- **La vista semanal de objetivos estrena cabecera** con icono, como sus dos
  vistas hermanas.

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
