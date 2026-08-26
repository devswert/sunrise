# §4.29 Objetivos semanales

Vuelve al [índice de SPECS](../SPECS.md).

Un objetivo es lo que uno se propone para una semana ISO. Vive en `objectives`
(`iso_week`, `title`, `position`, `completed`, `category_id`) y se opera desde
**Weekly planning**; la **weekly review** lo cierra y lo mide.

## Modelo

- **`iso_week` es `YYYY-Www` con la semana en dos dígitos.** El cero a la
  izquierda no es cosmético: `list_objectives_range` compara strings con un
  `BETWEEN`, y sin él `2026-W9` caería después de `2026-W10` y el histórico
  saldría barajado. Lo garantiza `isoWeekId` en el front.
- **El channel de un objetivo es el mismo de las tareas.** `objectives.category_id`
  apunta a `categories` (migración 13), no a una tabla propia: un objetivo y las
  tareas que cuelgan de él comparten contexto y color sin duplicar nada. Nace
  `NULL` para todo lo que ya existía — adivinarlo desde las tareas asociadas sería
  inventar un dato que nadie eligió.
- **`ObjectivePatch` distingue tres cosas, como `TaskPatch`**: ausente = no tocar ·
  `null` = poner a NULL · valor = escribir. Aplanado a `Option<i64>` no habría
  forma de **sacarle** el channel a un objetivo, y tildarlo le pisaría el título.
- **La relación con las tareas ya existía** (`tasks.objective_id`), así que ligar
  no necesitó migración. Es `ON DELETE SET NULL`: borrar un objetivo **desliga** sus
  tareas en vez de llevárselas, y `mockDb.deleteObjective` tiene que espejarlo — sin
  eso la tarea queda apuntando a un id que no existe y la card sigue mostrando la
  marca de objetivo de algo borrado.
- **Los tres estados necesitan `deserialize_with = "double_option"`.** Con el
  derive pelado un `null` entra por el visitor del `Option` de afuera, cae en
  `visit_none()` y llega como `None`, o sea indistinguible de un campo ausente.
  `TaskPatch` estaba así desde siempre: **"Sin canal" y "Sin objetivo" del detalle
  de tarea nunca borraron nada dentro de Tauri**, y fuera sí, porque `mockDb`
  recibe el objeto de JS donde `null` y `undefined` son distintos. Las dos suites
  estuvieron verdes todo ese tiempo. Lo vigila
  `el_patch_distingue_null_de_ausente_como_lo_manda_el_front`, que deserializa el
  JSON de verdad en vez de construir el patch en Rust.

## Weekly planning

- **El ancla se mueve**, igual que la de la review (`shiftWeeks` + "Esta semana").
  Antes era un `useMemo` con deps vacías —`new Date()` congelado— y los objetivos
  de cualquier otra semana no se podían ni ver ni corregir.
- **El título abre el detalle**, que es donde vive el reparto de horas.
- **Crear no pide el nombre: crea con uno genérico y abre el detalle.** Ponerle
  nombre es lo primero que se hace dentro del modal, y ahí además están el channel
  y el reparto de horas, así que un campo intermedio solo agregaba un paso para
  llegar al mismo lugar. El modal abre con el título **seleccionado**, para que la
  primera tecla lo reemplace. Y lleva `font-family: var(--font-title)` explícito:
  un `input` **no hereda** la tipografía, así que sin eso el título salía en la
  fuente por defecto del webview mientras el resto de la app usa Sora. El precio, asumido: un objetivo abandonado a medio
  crear queda llamándose "Nuevo objetivo" — visible y corregible, que es mejor que
  uno en blanco (el autosave exige texto, así que un campo vaciado no guarda nada).
- **Los objetivos son una lista de filas de una línea, plegadas por default.** El
  título, el channel, una barra de avance de ancho fijo y el contador entran en la
  fila; las tareas y los botones aparecen al desplegar. Se probaron dos columnas de
  cards y no funcionaron: son tres o cuatro objetivos por semana, así que las cards
  desperdiciaban ancho, obligaban a saltar de una a otra para comparar avances, y
  traían el problema de las alturas desiguales (que a su vez tuvo dos intentos
  fallidos, `align-items: start` y el ancla con `margin-top: auto`). En filas, las
  barras quedan una debajo de la otra —que es exactamente cómo se comparan— y todas
  miden lo mismo por construcción.
  - **La barra lleva ancho fijo**, no el que sobre en su fila: una que se estire
    con el largo del título haría ver distintos dos avances iguales, que es justo
    lo que la columna sirve para comparar.
  - **La lista no se dibuja vacía**: `.plan-lista` tiene borde propio, así que un
    contenedor sin filas dejaba una línea suelta bajo el texto del estado vacío.
- **La vista va centrada** (`margin-inline: auto` sobre el `max-width`): sin eso el
  ancho máximo la dejaba pegada al borde izquierdo con media pantalla vacía.
- **El `h1` lleva icono y va a 22px**, las mismas medidas que `.review__title` y
  `.daily-plan__title`: eran los encabezados de las tres vistas de ritual y éste era
  el único sin marca y con `font-size` inline. El icono es `CalendarRange`, el mismo
  del sidebar desde donde se llega; `Target` está tomado por las filas de objetivo y
  repetirlo diluiría las dos marcas.
- **La bajada trae el recordatorio de los tres objetivos**, fijo y no como aviso al
  pasarse: regañar después de que alguien escribió el cuarto llega tarde y se siente
  como un reto. Se lee **antes** de empezar, que es cuando todavía se puede elegir.
  Y está redactado como **sugerencia**, no como regla: nada en la app limita la
  cantidad, y un texto que suene a límite prometería una validación que no existe.
- **Las secciones llevan `<h2>`, no un micro-label numerado.** Eran
  `1 · OBJETIVOS DE LA SEMANA` en mayúsculas a 11px: a ese tamaño no se leía como
  encabezado sino como etiqueta de formulario, y los números prometían pasos de un
  asistente que no existe — las secciones no se recorren en orden. Mismas medidas
  que `.review__h2`, porque son las dos vistas semanales.
- **"Asignar existente" es un dropdown buscable**, igual que el picker de channel
  de una card. Era un `<select>` nativo, que con veinte tareas sin asignar obliga
  a leerlas todas y no busca.
- **Eliminar confirma en dos pasos, en la propia card.** No es un `Dialog`: el
  patrón del proyecto para borrar es la confirmación inline (lo dice el doc de
  `Dialog.tsx`), y acá borrar se lleva el reparto de la semana.
- **"Traer a la semana actual" aparece solo mirando una semana pasada**, que es
  donde uno se topa con el objetivo que quedó atrás. Es el mismo gesto que "traer a hoy"
  del ritual diario, y el mismo principio: la app no arrastra sola (DECISIONES
  §6), pero tiene que dar la manija.
  - **Mueve el objetivo y lo reposiciona al final de la semana destino.** Arrastrar
    el `position` viejo lo dejaría empatado con uno que ya está ahí, y el
    `ORDER BY position, id` lo metería en medio de la lista sin que nadie lo pida.
  - **Sus tareas no se mueven.** Reagendar lo que ya pasó es el error del
    carry-over otra vez: el objetivo llega a esta semana con su historia atrás.
  - **La vista se va con él.** El destino es la semana en curso, no la que se está
    mirando, así que sin el salto el objetivo desaparecería de la pantalla al
    apretar el botón y el gesto se leería como un borrado. La semana en curso sale
    de `useToday`, no de un `new Date()` congelado: una sesión abierta cruza la
    medianoche sin enterarse.
- **El histórico son las últimas 8 semanas**, contando la que se está viendo. Una
  semana sin objetivos **aparece igual**, en cero: saltearla haría ver como
  continua una racha que tuvo un hueco. La cuenta es pura y vive en
  `objectiveHistory.ts`.
- **La tira va arriba de los objetivos y siempre se dibuja.** Es el contexto con el
  que uno decide qué proponerse, no un resumen de cierre. Y abajo rebotaba: el estado
  vacío y la tira tienen alturas distintas, así que la vista saltaba según si las
  últimas semanas tenían objetivos. Ahora las semanas sin objetivos se dibujan huecas
  y no hay un segundo estado — una sola forma, una sola altura.
- **El tinte del cuadro va acotado a 12–40%, no 0–100%.** El número de la semana va
  **encima**, y a full el lavanda se lo come. El techo salió de medir el contraste en
  los dos temas y quedarse con el peor: en claro el texto es oscuro y más tinte lo
  ayuda, en oscuro el texto es claro y más tinte lo tapa, así que manda el oscuro.
  El rango conserva el orden, que es lo único que la tira promete.
- **El número de la semana va en `--ink`, nunca en `--muted`.** Contra `--muted` el
  contraste se cae en cuanto el cuadro se pinta: medido en oscuro con el tinte al
  techo daba 2.12:1. Con `--ink` el peor de los ocho casos (dos temas × cuatro
  estados) queda en 4.93:1. La semana actual se distingue por el `outline` y la
  negrita, no por tener otro color.
- **La tira son cuadros chicos tintados por proporción cumplida, no barras.** Ocho
  barras a lo ancho de la vista se veían vacías con razón: dos datos por semana no
  llenan esa superficie. A 26px la intensidad se lee de un vistazo; una barra de
  44px con 3px de relleno no. La caja va al ancho de su contenido
  (`align-self: flex-start`) y el detalle de cada semana vive en el tooltip y en el
  `aria-label` — ocho fracciones `done/total` bajo los cuadros eran ruido.
- **El titular es cuántas de las 8 tuvieron objetivos, no la racha.** La pregunta
  que trae acá es "¿le estoy poniendo objetivos a mis semanas?"; la racha baja a
  segunda línea y **solo cuando existe**, porque "0 semanas seguidas" no es un dato.
- **Una semana sin objetivos se dibuja hueca** (borde punteado), no en cero: es
  distinto de "me propuse cosas y no las cumplí", y la racha las trata distinto.
- **La ventana de 8 semanas cuelga de hoy, no de la semana que se está mirando.**
  Anclada al ancla, moverse una semana atrás la corría también: la tira dejaba de
  mostrar las semanas recientes y con eso se perdía la forma de volver clickeando.
  Anclada a hoy es un control de navegación **estable**: siempre las mismas ocho, y
  la que se está mirando se marca cuando cae adentro. Por eso
  `weekAnchorsBackFrom` devuelve fechas y no ids — la tira las usa para mover el
  ancla, y convertir un `YYYY-Www` de vuelta a un lunes es la conversión que no vale
  la pena escribir dos veces.
- **Cada cuadro es un botón que mueve el ancla**, y sin ninguna semana con
  objetivos la tira se reemplaza por una línea de texto. Las dos cosas son la misma
  corrección: cuadros que no llevan a ninguna parte no se ganan su espacio.
- **La racha cuenta semanas seguidas con todo cumplido, y una semana vacía la
  corta.** Con `total === 0` la condición "todos cumplidos" es verdadera por
  vacuidad, y eso le regalaría una racha perfecta a quien no se propuso nada.

## El reparto de horas (`ObjectiveModal`)

La fila de siete casillas Lun→Dom es la razón de ser del modal: **elegir minutos
en un día crea ahí una tarea colgada del objetivo**. Es cómo un objetivo semanal
baja a tareas diarias en un gesto, sin escribir el título siete veces.

Tres reglas de producto, no detalles de implementación:

- **La tarea generada se llama como el objetivo**, sin el día pegado atrás. El día
  ya lo dice la columna del tablero, y repetirlo en el título es ruido en el único
  lugar donde el título se lee.
- **Bajar los minutos nunca borra la tarea.** Mueve el estimado, y "sin tiempo" la
  **desliga** del objetivo dejándola viva en su día con su tiempo trackeado. Es el
  precedente de DECISIONES §6: borrar es barato de equivocarse y caro de deshacer,
  y acá la tarea puede tener horas que no están en ningún otro lado. El costo
  asumido es que un reparto deshecho deja una tarea suelta en el tablero.
- **Con varias tareas del objetivo en el mismo día se edita la primera**, y la
  casilla muestra el **total** del día más cuántas hay. El número no miente aunque
  el gesto toque una sola.

La tarea nace con el channel del objetivo, que es lo que hace que el reparto no
deje siete tareas sin clasificar.

## Weekly review

- **Se tildea desde la lista**, que es donde uno se acuerda de que cumplió algo.
  El título **no** se edita acá: se corrige en el planning, que es donde se
  escribe. El tilde corta el click para no filtrar de paso — son dos gestos
  distintos sobre la misma fila.
- **Los tres paneles van a un tercio cada uno.** Los objetivos iban angostos
  cuando eran una lista de texto corto; dejaron de serlo: la caja carga el corte de
  horas, el tiempo por objetivo y el click que filtra. Es un `grid` y no
  `flex-wrap`, porque con `flex: 1 1 340px` los tres solo entraban en una fila
  sobre 1020px y por debajo el tercero se iba solo a la línea siguiente, a lo
  ancho — justo el reparto que había que arreglar.
- **El filtro es uno solo para los dos controles.** La lista de objetivos
  clickeable y los dos dropdowns escriben el mismo `{objectiveIds, categoryIds}` y
  se leen entre sí; dos mecanismos separados es cómo terminan mostrando cosas
  distintas. La lógica es pura y vive en `reviewFilter.ts`.
  - **OR dentro de una dimensión, AND entre dimensiones.** Dos objetivos muestran
    los dos; un objetivo más un channel muestra lo que cumple ambas. Con AND
    dentro de una dimensión, el segundo click vaciaría la vista.
  - **Elegir un contexto incluye sus channels.** Las categorías son de dos niveles
    y una tarea apunta a cualquiera, así que comparar contra `categoryId` exacto
    haría que elegir un contexto no calzara con nada. Se resuelve `parentId ?? id`,
    igual que `work_by_day` y `groupBy`.
  - **Filtra las cards de "lo que se cerró", no los gráficos.** Los de arriba
    responden "en qué se me fue el tiempo", que no cambia porque uno esté mirando
    un objetivo. Y va con un contador de cuántas quedaron: filtrar hasta dejar la
    semana vacía sin decirlo se lee como un bug.
  - **Cambiar de semana lo limpia**: los ids de objetivo son de la semana que se
    estaba mirando y en otra no seleccionan nada, así que quedaría una vista vacía
    sin explicación.
- **El corte objetivos/resto** sale del rollup (`objectiveSeconds` y
  `byObjective`), calculado en la **misma pasada** que las celdas de
  `work_by_day`: escribir una segunda consulta del trabajo es cómo las reglas de
  atribución se terminan separando. `objective_id` va en las **dos** consultas de
  `work_by_day` — sin él en la de la Regla 3, una reunión de calendario ligada a un
  objetivo no contaría.
- **Cuenta cualquier objetivo, no solo los de esa semana.** Para el titular la
  pregunta es "¿este rato era parte de un objetivo?", no de cuál, y una tarea de
  esta semana puede colgar de un objetivo de la anterior. Consecuencia visible:
  puede haber horas en el corte con la lista de la semana vacía. La lista del modal
  de detalle, en cambio, **solo ve la semana cargada** y lo dice ("Tareas de la
  semana"): los dos números pueden no coincidir a propósito.

## Lo que sigue sin decidirse

**Qué pasa con un objetivo no cumplido al terminar la semana.** Hoy simplemente
queda ahí. Copiarlo a la semana siguiente es tentador y es exactamente el error
del carry-over de tareas (DECISIONES §6): decidir por el usuario antes de que
mire. Si se hace, que sea un gesto explícito desde el planning.
