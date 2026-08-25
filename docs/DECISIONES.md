# sunrise — Decisiones y lo aprendido

Este archivo guarda **por qué** las cosas son como son, cuando el motivo no cabe
en el código ni en una invariante. [SPECS.md](SPECS.md) dice qué existe y cómo
funciona; acá está lo que se descartó, lo que se midió y lo que se pagó caro.

Está organizado **por tema y no por ítem**, porque nadie busca una decisión por su
número. Salió de podar `ROADMAP.md`, que llegó a tener 2600 líneas de las cuales
2560 describían trabajo terminado; **el relato completo de cada ítem, con su
commit, sigue en `git log -p docs/ROADMAP.md`**.

Una advertencia de lectura: varias de estas decisiones se tomaron **después** de
que la alternativa obvia fallara. Si algo acá se ve retorcido, lo más probable es
que la versión derecha esté descrita justo al lado, con el motivo por el que no
sirvió.

---

## 1. Tiempo: cómo se atribuye y por qué duele

**El tiempo se atribuye por `started_at`, y mover una tarea de semana no cambia
sus horas.** Son dos preguntas distintas —cuándo lo planificaste y cuándo lo
trabajaste— y la asimetría es correcta, no un bug.

**Un ajuste manual se acredita al día de la tarea, no al día en que lo escribes.**
Si el lunes corriges las horas de una reunión del sábado, ese tiempo es del
sábado. Tres decisiones adentro:

- **Con la hora de la tarea si la tiene, mediodía si no.** Lo primero es por el
  caso que lo motiva —una reunión—: así el bloque cae en el rail donde ocurrió. Y
  **mediodía y no medianoche** porque en Chile, en el salto de primavera, la
  medianoche local **no existe** y la conversión se queda sin respuesta. El
  mediodía existe todos los días del año.
- **Una tarea futura se acredita a hoy.** Mañana no se trabajó, y fechar ahí
  dejaría horas "trabajadas" adelante del reloj sumando en un rollup futuro.
- **La consecuencia se aceptó en vez de esquivarla**: un ajuste fechado en otro
  día **sale del contador del taxímetro**, que mide solo hoy. Es lo correcto —ese
  contador es la sesión de hoy— pero antes aparecía ahí, así que hay un test que
  lo fija para que nadie lo "arregle" de vuelta.

**Un recorte de tiempo se reparte entre los días trabajados, no se descuenta de
uno solo.** El caso que lo destapó: un timer olvidado que cruzó la medianoche
dejó 14h el domingo y 10h el lunes; al bajar el total a 3 horas, la única fila de
−21h fechada el domingo dejaba ese día en −7h y el lunes seguía mostrando 10h. La
semana decía 15h 15m con una tarea de 3 horas adentro.

Lo peor no era el número: **nada fallaba**. El total de la tarea cuadraba, ningún
test estaba rojo, y el piso en 0 del lector dibujaba barras correctas mientras
escondía que el reparto estaba roto. **Un piso que corrige el síntoma en el lector
es un lugar cómodo para que se esconda un error de escritura.**

El orden del reparto no está en los datos —un timer olvidado no deja evidencia de
qué horas fueron reales—, así que se eligió con los números de las dos
alternativas a la vista: primero el día de la tarea (coherente con la regla de
arriba, deja la card y el rollup diciendo lo mismo), después del más reciente al
más viejo. Drenar al revés dejaba las 3 horas de la tarea en el día *anterior*,
con la card mostrando un tiempo que su propio día no reconocía.

**El sobrante se descarta.** Si el recorte supera todo lo repartido, escribirlo
igual "para que la suma cierre" es literalmente el bug de nuevo: una fila negativa
que ningún día puede respaldar.

**No hay migración para el historial ya torcido**, ni acá ni en el ajuste manual.
Se podría deducir qué filas viejas son ajustes (`started_at = ended_at`), pero
reescribir historial sobre una deducción es justo lo que se equivoca en silencio, y
el dato correcto —a qué día quisiste acreditarlo— no está en ninguna parte.

---

## 2. Lo que depende del reloj va en Rust

Es la invariante I6, y se aprendió dos veces con el mismo síntoma.

**La campana del estimado no sonaba con la ventana tapada.** La decisión vivía en
el `tick` de un webview, y **un webview que no se ve no corre sus timers**: macOS
los estrangula. Peor: la ventana con permiso para sonar era justamente la que se
tapa, y la que estaba a la vista contando bien era la que no podía.

Y los cinco minutos de retraso que reportó el dev tampoco eran casualidad: su feed
de calendario tiene `poll_minutes = 5`, y cada pulso el poller emite un evento
**desde afuera** del webview que despierta la página y deja correr el tick
congelado. La campana no esperó cinco minutos: esperó a que algo despertara la
ventana.

**El respaldo automático repitió el caso** —programado a las 00:22, el zip salió a
las 00:27— y fue el que dejó de convertir I6 en una anécdota. Con dos casos
medidos, lo que queda en el front por "necesita una ventana" hay que justificarlo,
no heredarlo.

Dos matices del arreglo que valen:

- **La campana duerme hasta el momento calculado, pero el momento no es la
  decisión.** Cada vuelta relee la base. Un `sleep` de una sola vez habría que
  invalidarlo al editar el estimado, al ajustar tiempo a mano, al pausar, al
  cambiar de tarea y al despertar la máquina — y olvidarse de uno deja la campana
  muda sin síntoma, o sea el mismo bug otra vez.
- **El respaldo usa pulso fijo de 60 s y no un sueño calculado.** Apunta a una hora
  de pared una vez al día y se pone al día por construcción; la precisión nunca fue
  el problema. Lo único que se compró fue que corra tapado.

**La llave de "ya sonó" es el par (entrada, estimado), no la entrada sola.** Salió
de un reporte: sonó a la hora, el dev le subió el tiempo, y no volvió a sonar. La
campana no promete "te avisé una vez por esta tarea" sino "te avisé que alcanzaste
**este** tiempo".

**Una hora se compara en minutos, no como texto.** El respaldo lo hacía
lexicográficamente y `hour()` acepta una hora de un dígito: con `9:05`,
`"9:05" >= "20:00"` es falso todo el día y el respaldo **no corría nunca**. Bug
latente que nadie había pisado.

---

## 3. Calendario (ICS): cuatro interpretaciones que definen la feature

1. **Las series se expanden**, en una ventana de una semana atrás y cinco
   adelante, con **una clave por instancia** (`UID#<instante>`). Sin expandir, un
   standup semanal se importa una sola vez y la feature queda inútil para el
   contenido más común de un calendario de trabajo; sin clave por instancia, el
   `UNIQUE` colapsa el mes entero en una fila.
2. **Los eventos de día completo entran sin reloj**: sin hora, sin estimado. Un
   feriado no son 24 horas trabajadas.
3. **`STATUS:CANCELLED` se descarta.** `PARTSTAT=DECLINED` no, porque necesita
   saber cuál de los invitados eres tú — o sea, un ajuste con tu email. Hoy una
   reunión rechazada se importa igual.
4. **Un feed con `import_as_tasks = 0` igual se baja, pero no escribe.** Así una
   URL revocada se sigue viendo como error en vez de quedar muda.

**El borrado es no destructivo, y solo se borran las futuras.** Esa condición no
estaba en el plan y resultó crítica: la ventana de import arranca hoy, así que
cada mañana las reuniones de ayer dejan de venir en el feed. Sin el filtro, la
primera sincronización del día habría borrado toda la historia de reuniones.

**`ORPHANED` significa "nunca se trabajó", y nada más.** Una reunión trabajada y
completada desaparecía del tablero al día siguiente por lo mismo de arriba. De las
tres salidas ganó reservar el estado: con tiempo o `DONE` la tarea **se libera del
feed** (`feed_id = NULL`) y sigue activa —dejó de ser del calendario y pasó a ser
tuya, con precedente en el borrado de un feed entero—; sin trabajar, sigue
`ORPHANED`, porque soltarla la haría reaparecer para siempre en su día.

**Tiempo real no es una opción, y se midió antes de descartarlo.** Un feed ICS es
solo polling: el formato no tiene push. Y contra el endpoint de Google no hay
margen para abaratarlo —no emite `ETag` ni `Last-Modified`, ignora un
`If-Modified-Since`, y no manda cabeceras de rate limit—, así que las peticiones
condicionales nunca fueron viables. La única palanca real era gzip (120 KB → 12
KB) y ya estaba puesta. Tiempo real de verdad necesita la API de Google con
webhooks, o sea un endpoint HTTPS público: un servidor, que este proyecto no tiene
ni quiere.

**El freno al sincronizar al volver a la ventana tiene tres reglas**: el botón no
lo mira (pedirla a mano es pedirla ahora), el reloj es el sello que escribe Rust en
el feed y no un contador de sesión (así el freno sobrevive a recargar y cuenta
también el botón), y **una marca ilegible o en el futuro no frena nada** — con
`NaN` toda comparación da false, y un freno que se equivoca al revés deja el
calendario mudo para siempre sin ningún síntoma.

**El link de la reunión va en columna propia, no en `notes`.** Las notas son del
usuario y la sync las pisaría cada 15 minutos. Y la lista de hosts de videollamada
conocidos existe porque la descripción de Google trae también links de ayuda y de
adjuntos: sin filtrar, el botón abriría cualquiera.

**El rail lee `scheduled_time`, no `event_start`.** Los timestamps del import están
en UTC: sacarles la hora movería de bloque una reunión de la tarde.

**La proyección del rail no escribe `scheduled_time`.** Esa columna la escribe el
import y ordena la cola de Focus; si el rail metiera ahí una hora inventada,
después no habría cómo distinguir la que pusiste tú de la que adivinamos. Se
calcula al dibujar y muere ahí.

**Una tarea partida alrededor de una reunión salta el hueco, nunca se achica.** Los
tramos siempre suman el estimado. Un hueco menor a 15 minutos se deja vacío porque
astillar ahí vuelve ilegible el rail.

**Trabajar algo no lo agota.** Una tarea de 45 minutos con 19 hechos deja su bloque
real y proyecta los 26 que faltan. En la primera versión lo trabajado reemplazaba a
la tarea entera, así que una tarea empezada desaparecía del resto del día justo
cuando más importa saber si el tiempo alcanza.

---

## 4. Datos y ajustes

**El inicio automático no vive en `settings`, y esa es la decisión del ítem.** La
verdad la tiene el sistema operativo, que lo puede apagar desde Ajustes sin pasar
por la app, así que una copia en la tabla mentiría la primera vez que eso pase. Y
peor: el respaldo se lleva la tabla entera, así que restaurar un zip de hace un mes
prendería o apagaría el arranque de **esta** máquina. Hay un test que se pone rojo
si alguien la mueve ahí "por consistencia".

**Los tres ajustes de respaldo cruzan la restauración.** Es el mismo problema
resuelto al revés: describen la máquina y no los datos, así que restaurar un zip
hecho antes de configurar la carpeta dejaba `backup_dir` vacío y el automático
dejaba de correr sin decir nada.

**Ausente y vacío no significan lo mismo** en las claves de lista (los días
plegados). Es lo que hace expresable "ningún día plegado", y la razón de que la
migración siembre la fila.

**Un parser de ajustes que falla cae del lado seguro.** Mismo criterio que el freno
de sincronización: el caso raro tiene que fallar hacia hacer algo, no hacia el
silencio.

**Dev y producción se separan por archivo, no por directorio.** El directorio lo
decide el identifier, y cambiarlo en dev se lleva a otro lado el permiso de
notificaciones y la ruta del LaunchAgent. El nombre del archivo no arrastra nada.

**El puente entre las dos bases ya existía: el respaldo.** Respaldas en producción,
restauras el zip en dev, y trabajas con datos reales sin tocarlos. Funciona porque
el nombre de la base *dentro* del zip no depende del perfil, y hay un test que lo
fija.

**El respaldo automático corre en dev, y el conflicto se resolvió por el nombre y
no por el interruptor.** Estaba apagado porque dev puede heredar `backup_dir` de
producción y la retención habría borrado los respaldos de verdad para dejar los de
prueba. Ahora dev escribe `sunrise-dev-…` y el permiso para borrar exige el prefijo
del propio perfil, así que los dos conjuntos son disjuntos aun apuntando a la misma
carpeta. Encenderlo importaba porque apagado no había forma de probarlo antes de
publicar una versión, que es exactamente cuando importa que funcione.

**Lo que costó del respaldo no fue respaldar: fue no borrar nada ajeno.** La
carpeta destino es la de sincronización del usuario, probablemente compartida con
el resto de su vida. La poda solo toca archivos cuyo nombre calza exactamente con
el patrón, lo comprueba dos veces y nunca toca un directorio; hay un test que se
pone rojo si el patrón se afloja a `*.zip`.

**La restauración extrae, valida y migra en un temporal antes de tocar nada.** La
versión ingenua —copiar y reabrir— deja la app sin base si el reabrir falla. Migrar
antes es además lo que hace que un respaldo de un build anterior sirva de verdad.

**El `rsync` al VPS quedó fuera a propósito.** Habrían sido credenciales SSH,
`shell-out` a un binario del sistema y cero tests posibles, para hacer lo que el
sistema operativo ya hace: apuntando la carpeta a un Drive, el respaldo sale de la
máquina sin que sunrise hable con ninguna nube.

**Una carpeta se valida escribiendo, al momento de elegirla.** Un volumen de solo
lectura es perfectamente legible, y un ajuste que se acepta y falla nueve horas
después no dice qué se escribió mal.

**Una `position` se renumera entera, y significa el índice final.** El atajo de
correr +1 todas las `>= position` vale mientras la tarea venga de otro día; dentro
del mismo, la tarea que se mueve deja libre su lugar. El índice final es
exactamente lo que dnd-kit dibuja mientras arrastras, que es con lo que el
resultado tiene que coincidir. Como son N escrituras, van en una transacción.

---

## 5. Sincronización entre ventanas

**Hay dos puertas y no una**: `bumpData()` invalida y avisa hacia afuera;
`markDataStale()` solo invalida. Responder a un aviso con `bumpData` genera un
ping-pong entre ventanas, así que todo lo que **entra** —el evento del poller de
Rust, el listener de `localStorage`— usa la segunda.

**El día también es estado.** Una sesión abierta cruzando la medianoche tiene que
rearrastrar, recentrar la semana y reanclar las vistas. Por eso la fecha se observa
en vez de leerse una vez al montar, y por eso las guardas de "una vez al día" son
condiciones sobre la fecha y no booleanos.

**"Hoy" se calcula con la fecha local, nunca con `toISOString()`.** Esa conversión
adelanta el día varias horas antes de medianoche. Y al leer, un string de fecha no
se pasa por `new Date()`: `new Date('2026-08-21')` es medianoche **UTC**, o sea acá
el día anterior a las 20:00.

**El taxímetro no monta el store de ajustes.** Lo que necesita —el tema, la
tipografía— se espeja en `localStorage` y sigue el evento `storage`. Sin eso, la
app en una fuente y el taxímetro en otra se ven partidos.

---

## 6. Producto: dónde la app decide y dónde no

**El carry-over automático se retiró.** Arrastrar todo a hoy decidía por el usuario
antes de que viera nada, y el repaso del día anterior tuvo que reconstruirse desde
el historial dos veces seguidas. Ahora la degradación diaria preserva el último día
con actividad —el que repasa el ritual— y baja al backlog lo anterior.

Es el precedente que gobierna varias decisiones abiertas: **la app avisa y no
actúa**. Un objetivo no cumplido no se copia solo a la semana siguiente; una tarea
que lleva tres días arrastrándose no se parte, ni se cierra, ni se manda al backlog
sola. Arrastrar tres días es a veces exactamente lo correcto, y una app que
"arregla" eso pelea con quien planifica.

**Borrar es barato de equivocarse y caro de deshacer.** Es la razón por la que la
restauración deja la base anterior al lado, por la que la poda de respaldos es
paranoica con el patrón del nombre, y por la que bajarle los minutos a un día que
ya tiene tiempo trackeado no puede resolverse borrando la tarea.

**Una reunión no se mueve de su día.** Ni el repaso del ritual ni la degradación
diaria la tocan: es el registro de algo que pasó ese día. El único camino de rescate
es explícito, y existe porque una reunión sin cerrar se quedaba en su día para
siempre sin que ninguna vista la volviera a mostrar — salió de un caso real, una
tarea del sábado que no aparecía en el planner.

**El ritual repasa el último día con tareas, no "ayer".** Un lunes, ayer es domingo
y lo que hay que cerrar es el viernes.

**El semáforo de capacidad pesa el día entero, no solo lo pendiente.** Completar
tareas no puede ir apagando la alarma de un día sobrecargado. Y las tareas sin
estimar se cuentan y se avisan en vez de rellenarse con un número.

**Escribir no es cerrar.** El autosave de la bitácora no toca el sello del día;
solo el botón sella. Si no, teclear una letra daría el día por terminado y no
habría forma de dejar una nota a medias. Y `closed_at` no se re-sella: "a qué hora
cerré" es el dato.

**Incluir y escribir son dos gestos.** Con dos estados en la nota, vaciar el
resumen bajaba la tarea de los highlights: borrar una palabra la hacía desaparecer.

**La bitácora no depende del ritual.** Sale del trabajo trackeado y de lo cerrado.
Un día que nunca cerraste aparece igual, como borrador. Si dependiera de la tabla,
arrancaría vacía y parecería rota.

**"Empezar el día" es un terminador de ritual, no un botón de guardar.** No hay
nada que guardar: todo lo que se toca ahí ya persiste. Está escrito así para que
nadie lo convierta en un save ni lo borre por inútil, y hay un test que exige que
montar la vista no escriba nada.

**Dos caminos para lo mismo obligan a mantener los dos.** Es el argumento que sacó
los botones de "mañana" y "al backlog" del ritual (el arrastre ya lleva la acción y
la intención), el que dejó el selector de día fuera del panel de agenda, y el que
descartó el punto en el ítem de Configs cuando la franja del sidebar ya era la
señal.

**La app no interrumpe al arrancar.** Ya interrumpe dos veces a hora fija —el aviso
de cerrar el día y el respaldo—; una tercera que aparece sola al abrir es la que
sobra. Por eso el updater sondea pero avisa con una franja en el sidebar, y por eso
el modal "Lo nuevo" dejó de abrirse solo.

**Un fallo no es rojo, y "estás al día" no es lo mismo que "no pude preguntar".** El
segundo disfrazado del primero deja a alguien tranquilo en una versión vieja.

---

## 7. UI: lo que se midió

**Los `-ink` de la paleta van en las tres ramas de tema.** Estaban declarados una
sola vez en `:root` pelado, así que el mismo hex servía a los dos temas: en oscuro
el chip quedaba en contraste 1.1–1.5, ilegible. La primera solución —chip a color
completo con un token de texto encima— se descartó **por los números**: seis de los
24 no llegan a 4.5 contra ningún extremo, ni negro ni blanco, porque el tono medio
tiene un valle de contraste.

**Un `-ink` no siempre es texto, y el corte no es "fondo sí, texto no".** Los fills
que llevan texto encima se fijan en los dos temas; los que no —el punto pulsante,
las barras— tienen que seguir al tema, porque un verde oscuro sobre fondo oscuro
desaparece. La pregunta es **¿lleva texto encima?**

**Los 24 colores se eligieron midiendo distancia perceptual, no a ojo.** Cada color
tiene que sobrevivir a cuatro usos —punto a saturación completa, chip al 35%,
bloque del rail al 18%, y su `-ink` encima— y **son los tintes los que
traicionan**: dos matices que se distinguen a full colapsan al 18%, así que mirar
las muestras del picker no alcanza.

Tres resultados que contradijeron la intuición:

- **Lo que hizo que cupieran 24 fue la luminosidad, no el matiz.** Ocho matices
  nuevos en la franja de los originales metía pares en ΔE 3.3, *bajo* el piso que
  ya existía. Abriendo el rango de luminosidad aparece sitio donde el círculo de
  matices ya estaba lleno. Hay margen medido hasta unos 32; pasado eso la salida es
  un segundo eje —una forma, una inicial—, no otro matiz.
- **Un anillo uniforme da peor resultado que la paleta pastel** (3.8 contra 4.2):
  15° de matiz no es un paso perceptual constante.
- **Optimizar sin restricciones llega a 13.8 rompiendo los nombres** (`sage` verde
  eléctrico, `amber` café).

**Lo pastel que la app necesita está en los tintes, y los tintes se calculan.** El
token puede ser saturado y los fondos siguen suaves; lo que gana es el punto, que
es lo que se sigue en una lista.

**El colapso del sidebar no se anima, y no por falta de ganas.** `transition` sobre
`grid-template-columns` con el valor viniendo de una custom property **no
interpola**: medido, el ancho se quedaba quieto casi un segundo y después saltaba.
Por eso el shell es flex y no grid — en flex el ancho es del elemento, que es el
caso normal de una transición.

**El ancho mínimo del rail lo fija la ventana, no la legibilidad de los iconos.**
Hay un piso duro donde llegan los botones nativos de macOS; más angosto y quedan
montados sobre el borde.

**La franja de arrastre no declara `z-index` a propósito.** Siendo `fixed` ya queda
sobre el contenido estático, y sin declararlo cualquier elemento posicionado
posterior le gana — que es lo que se quiere, porque las tabs `sticky` de Configs y
los modales se abren encima. Con un `z-index` propio les comía los clicks del borde
superior y se veía como un control que no responde.

**`focus()` sobre un elemento invisible no hace nada** — es la especificación, no
una rareza de un motor. Los popovers montan ocultos mientras miden su posición, así
que el efecto de foco al montar de cada campo no servía de nada. El foco es
responsabilidad de quien sabe cuándo ya es visible.

**Un alta se confirma con Enter o al salir de la fila completa, nunca en el blur de
un campo suelto.** Guardar en el blur del nombre destruye la fila a mitad de camino.
Y hacen falta **dos defensas**: mirar `relatedTarget` no alcanza sola, porque si un
click en un botón no lo enfoca el foco se va al `body` y llega `null`,
indistinguible de irse de la fila. El `preventDefault` en el `mousedown` no depende
de eso: en cualquier motor deja el foco donde está.

**dnd-kit ignora el `z-index`.** Un panel superpuesto a una columna no le quita a
esa columna su rectángulo de droppable, así que todo drop adentro produce al menos
dos colisiones y la de mayor cercanía al centro puede ser la columna escondida — la
tarea terminaba agendada en un día que no se ve. Se resuelve en la función de
colisión, y es la primera regla del proyecto que no es geometría.

**El `KeyboardSensor` no tiene coordenadas**, así que los fallbacks son el único
camino que le queda: excluir un panel de los fallbacks para que no capture drops
sobre espacio muerto lo deja inalcanzable por teclado. La exclusión va condicionada
a que haya puntero.

**Un reorden se dibuja optimista, en el mismo frame en que sueltas.** Si espera la
escritura, en el medio se ve el orden anterior y la card entra deslizándose desde
arriba: no es una animación de más, es la lista llegando tarde.

**El corrector ortográfico de macOS capitaliza al salir del campo**, y llegaba a
cambiar nombres de canales y de calendarios. Los tres atributos viven en una
constante que se spreadea: repetidos a mano, el cuarto campo se olvida y nadie lo
nota hasta que el corrector le cambia un nombre. El criterio para un campo nuevo no
es si molesta el subrayado, es **si alguien escribiría ahí una frase**.

**Las barras de scroll: `color-scheme` no cambia su forma.** Declararlo arregla el
color y de paso los `<select>` y el caret, pero WebKit en macOS dibuja barras
*overlay* y el navegador las clásicas — son dos implementaciones y no hay propiedad
que cambie de una a la otra. La que se quería había que dibujarla, y el costo
previsto se pagó: ocupa ancho permanente. Se aceptó porque una barra que aparece y
desaparece sobre las columnas de la semana tapa el borde de las cards justo cuando
las estás mirando.

Y trajo una consecuencia que el plan no anticipaba: `scrollbar-gutter: stable
both-edges` **se mide simétrico en el navegador y el webview de macOS no lo honra**.
Es el caso de manual de por qué esto se mira en la app: dos arreglos seguidos se
veían bien en el browser y solo uno lo estaba.

**Un diálogo de confirmación es un componente, no un `ask()` nativo.** Un `ask()` es
un título y un texto plano con dos botones: se perdería el nombre de la tarea con su
tiempo corriendo, el resumen de la restauración y el Enter/Escape propio. Antes de
que fuera componente, seis pantallas compartían las clases y cada una rearmaba el
overlay y su listener — dos se habían quedado **sin teclado**, así que la
confirmación de restaurar un respaldo no se cerraba con Escape.

**Un icono que no hace nada al apretarlo enseña que la barra no responde**, así que
solo se dibujan los botones que existen.

**El icono de la app: solo sol y horizonte, y el cielo oscuro aunque la app sea
clara.** Rayos o nubes son trazos finos que a 32px se vuelven suciedad, y 32px es el
tamaño en que un icono se usa. El cielo va oscuro porque el icono vive en el Dock
sobre el fondo de pantalla de cualquiera, y un sol pastel sobre un cielo pastel
desaparece: los colores siguen siendo los tokens, lo que cambia es la relación.

---

## 8. Notificaciones: lo que no está en nuestras manos

**Que un aviso se quede en pantalla no depende de una bandera: depende de que tenga
un botón.** Un aviso sin botón es un banner y se va solo; con botón de acción macOS
lo muestra como alerta.

**Pero el que decide de verdad es un switch del usuario** (`Notificaciones →
sunrise → Alert Style`). Comprobado: en `Persistent` se quedan las dos, alerta y
banner; en `Temporary` se van las dos. **No hay API para leerlo ni para cambiarlo**,
y macOS lo recuerda por identificador, así que reinstalar no lo reinicia. Lo único
que se puede hacer desde el código es **decirlo**: una feature que promete avisarte
y depende de un switch escondido no puede quedarse callada.

**El estilo lo decide el ajuste de la app a la que se atribuye el aviso**, y eso
depende de que la app esté instalada: si el sistema no conoce el identificador, se
cae a la Terminal.

**"Denegado" y "nunca se preguntó" no se pueden distinguir.** El plugin solo expone
un booleano, y averiguar la diferencia significa pedir el permiso — abrir el diálogo
de macOS al renderizar una card es exactamente lo que no se puede hacer.

**Un sonido que no existe no suena y no falla.** Por eso el selector necesita un
botón de probar: es lo único que distingue "elegí este sonido" de "elegí un nombre
que no está".

**El texto del aviso vive donde vive el que lo manda.** Si el botón de probar
escribiera su propia versión, la prueba diría una cosa y el aviso de verdad otra, y
no se notaría hasta que llegue el real. Es la misma razón por la que el changelog se
escribe una vez y se lee en tres lugares.

**El aviso de reunión no se pone al día.** Exige que la reunión todavía no haya
empezado: un "en 5 minutos" a las 09:30 para una reunión de 09:00 es basura, y ese
mismo borde evita que un Mac recién despertado mande seis avisos viejos de golpe. No
hizo falta un número de gracia arbitrario — la condición útil es "no empezó".

**La marca de "ya avisé" guarda la hora, no un booleano.** Si la sincronización
mueve la reunión de 15:00 a 16:00 es otra promesa y vuelve a avisar; con un flag la
tarea quedaba muda para siempre.

**El texto no dice los minutos que faltan.** El aviso puede salir en cualquier punto
de su ventana —app cerrada, máquina dormida, la sync moviendo la reunión—, así que
"en 5 min" es un número que se puede equivocar. La hora del evento no depende de
cuándo llegue el aviso.

**Se fue el botón "Cerrar" de la alerta.** La alerta ya se saca con el gesto de
siempre, y un botón para no hacer nada al lado del botón útil solo da una forma más
de ignorar el aviso.

**Un `notify` que devuelve `void` colapsa tres finales en uno.** Se marca el día
cuando el aviso salió y **también cuando el permiso está denegado** —reintentar cada
minuto no cambia nada—, pero **no** cuando falló, porque eso puede ser pasajero. Con
un retorno booleano, un aviso que falló queda marcado como dado y no llega nunca.

**Un esquema nuevo en las capabilities dejó la app sin avisos, y el mecanismo sigue
sin explicarse** (anotado como deuda en SPECS §9). El síntoma aparecía en la consola
del webview, lejos de lo que se había tocado. Se aisló revirtiendo los dos cambios
de esa tanda y probándolos de a uno. **La lección del método: dos cambios sin
verificar entremedio convierten una regresión de un minuto en una de veinte.**

---

## 9. Empaque, release y CI

**No se firma con Apple Developer.** Es una herramienta interna y no vale una cuenta
de US$99/año. La consecuencia es una sola: un `.dmg` descargado del navegador queda
en cuarentena.

**Le faltaba firma al bundle, no al binario**, y por eso la primera instalación
decía que la app estaba **dañada** y no "desarrollador no verificado". Sin
`signingIdentity`, Tauri no firma el `.app`; el único firmado queda siendo el
ejecutable, porque el linker de Apple Silicon lo firma solo. Esa firma a medias
promete recursos sellados que nadie selló, y ante la contradicción Gatekeeper
reporta daño. **Un estado a medias resultó peor que ninguno.** El arreglo es firma
ad-hoc, que no evita el bloqueo pero lo deja en el que sí se levanta con `xattr -cr`.

De regalo: **los docs afirmaban el síntoma equivocado**, en SPECS y en la skill de
release. Nadie lo había comprobado bajando el `.dmg`.

**El runner de CI es fijo y no `macos-latest`**, y por dos razones distintas que no
hay que copiar la una por la otra. En el release: **el SDK contra el que se enlaza
el binario decide la apariencia de la ventana**, así que lo publicado salía con los
botones de una versión vieja de macOS mientras en desarrollo se veían los actuales.
En los tests: `pnpm test:rust` compila el crate de Tauri entero, y en Linux eso
arrastra las dependencias de webkit2gtk.

**Los tests corren en cada push, en archivo aparte del release.** `release.yml`
necesita permiso de escritura y recibe la llave privada del updater por env; un
workflow que se dispara con cada PR es el último lugar donde se quiere cualquiera de
las dos.

**El workflow de release no se puede correr a mano.** Disparado desde una rama, el
nombre del tag valía `main` y habría publicado un Release "sunrise main".

**Las notas salen del archivo, no del mensaje del tag.** El checkout trae el archivo
siempre; la anotación de un tag puede no estar según el `fetch-depth`, y ese paso es
justo uno de los que no se pueden ensayar antes del primer tag.

**Todo el updater quedó en Rust**, sin el paquete npm: la API de JavaScript del
plugin habría dejado a `ipc.ts` de ser la única puerta a la app.

**Un tag no se mueve: se saca otro.** Por eso lo que se puede verificar antes de
taguear, se verifica antes.

**Si el primer Release sale sin la llave en los secrets, los artefactos van sin
firmar y la app los rechaza sin decir por qué.**

---

## 10. Método: cómo se verifica acá

**CI en UTC es una ventaja, no un estorbo.** Encontró dos bugs de fecha que en
Santiago pasaban por casualidad:

- Un `TZID` que se ignoraba desde el primer commit —el parámetro existía en la firma
  con guion bajo y el doc comment describía un comportamiento que nunca se
  implementó—. Una instancia editada de una serie recibía una clave distinta a la
  repetición que reemplaza, y la reunión movida habría aparecido **dos veces** en la
  semana de cualquiera cuyo Mac no estuviera en la zona del calendario. **Un test de
  zonas horarias con fixtures en tu propia zona no prueba nada.**
- Tres tests que pasaban solo los martes, porque la semilla del mock ancla items a
  días de la semana. Lo peor era cómo fallaba: uno comprobaba `1/2 cerradas` **y
  pasaba**, porque el día equivocado tenía justo una cerrada y una abierta. Un test
  que verifica el número correcto del día equivocado.

La regla quedó en la skill de tests: **si tocas fechas, corre también
`TZ=UTC pnpm test`.**

**El mock puede estar de acuerdo con el front y los dos equivocados.** Pasó dos
veces con nombres de campo, y la segunda dejó dos vistas rotas **días** dentro de
Tauri con las dos suites en verde: el mock recibe posicional, así que no puede estar
en desacuerdo con el front sobre un nombre. De ahí salieron dos tests que **no
prueban comportamiento sino el contrato**: uno que lee `ipc.ts`, `commands.rs` y
`lib.rs` como texto y verifica que cada clave de argumento sea el parámetro de Rust
en camelCase, y otro que serializa un struct y compara sus claves con las que lee el
front.

**Un dato que falta puede degradar lo que se ve; no puede apagar la pantalla.** Una
excepción al renderizar tumba el árbol entero — de ahí las pantallas en blanco.

**Un test se ve rojo antes de darlo por bueno.** Es lo que separa un test que cubre
el bug de uno que cubre el arreglo. Cuando el arreglo está en los dos lados (Rust y
el mock), los dos se verifican mutando el código de vuelta.

**`userEvent` y no `fireEvent` cuando lo que rompe es el foco.** `fireEvent.click`
no mueve el foco, así que el test pasaría igual con el bug puesto.

**Lo que jsdom no puede ver, se mira en el browser; lo que el browser no puede ver,
se mira en la app.** jsdom no implementa `scrollLeft`, no devuelve rectángulos, no
dibuja controles nativos y acepta el foco sobre elementos invisibles. El browser no
tiene barra de título nativa, ni eventos de cierre, ni sistema operativo al que
registrar un LaunchAgent, y dibuja scrollbars distintos al webview. Cuando un test
no puede fallar por la causa original, **eso se escribe en su comentario**.

Y un detalle que costó tiempo: **el panel del browser oculto devuelve rectángulos en
cero**, así que la primera medición de un centrado da números sin sentido.

**Una decisión de UI se toma midiendo cuando se puede medir.** El overlay del
arrastre, el contraste de la paleta, el ancho del rail, el ΔE de los colores: todos
salieron de números, y en varios casos el número contradijo lo que parecía obvio.
