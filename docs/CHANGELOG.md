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
