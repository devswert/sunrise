# sunrise — SPECS §4: Durabilidad y distribución

Respaldo y restauración, inicio automático, empaque `.dmg`, la convivencia de dev y producción, el updater y el changelog.

> Es una parte de [SPECS.md](../SPECS.md), partido por área. **La numeración de
> secciones no cambia**: un `§4.12` en un comentario del código sigue apuntando
> acá. El índice completo está en el [§4 de SPECS.md](../SPECS.md#4-funcionalidades-por-área).

---

### 4.17 Respaldo y restauración (`BackupCard`)

Un respaldo es **un `.zip` en una carpeta que el usuario elige**. La app no habla
con ninguna nube y no sabe qué es esa carpeta: si es de Drive, Dropbox o iCloud,
el respaldo sale de la máquina porque el cliente de esa nube lo sube; si es local,
el usuario puede mandarla por `scp` a un VPS. Esa fue la decisión de alcance —el
`rsync` integrado que planteaba M4 habría sido credenciales SSH, `shell-out` y
ningún test posible, para hacer lo que el sistema operativo ya hace.

**Dentro del zip van dos archivos**: `sunrise.sqlite` y un `manifest.yml` con
`app`, `version`, `schema_version`, `created_at`, `db_file` y `db_bytes`. El
manifest existe para el **import futuro**, que no está hecho: sin la versión de la
app y del esquema, un zip de hace seis meses es un archivo del que no se sabe si
se puede leer. `version` sale de `APP_VERSION` (`env!("CARGO_PKG_VERSION")`), que
es la misma que Tauri le pone al `.dmg`, y **tiene que ser semver**: un test lo
exige y además exige que `Cargo.toml`, `tauri.conf.json` y `package.json` no
divergan, porque si divergen el manifest miente sobre de qué build salió.

**`VACUUM INTO`, no copiar el archivo.** La base corre en WAL, así que
`sunrise.sqlite` no es la base: lo último escrito está en `sunrise.sqlite-wal`
hasta que alguien hace checkpoint. Copiar solo el archivo principal da un respaldo
con horas de trabajo faltantes y sin ningún error a la vista.

**El zip se escribe con nombre temporal y se renombra al final.** Con el nombre
definitivo desde el principio, el cliente de la nube sube un archivo a medio
escribir que se ve como un respaldo válido.

**El nombre es `sunrise-YYYYMMDD-HHMMSS.zip`**, en hora local, con segundos para
que dos del mismo minuto no se pisen. Su orden alfabético es el cronológico, y de
ahí sale también la fecha que muestra la lista: la del sistema de archivos cambia
con cualquier copia o sincronización.

**Respaldar y podar son un solo paso** (`create_and_prune`), y por eso da lo mismo si
el respaldo lo pidió el reloj o el botón: siete clicks seguidos dejan `conservar`
archivos, no siete. Estaba bien desde el principio, pero era una propiedad del
comando y no del módulo; ahora no hay forma de respaldar sin podar, y hay un test
que lo fija.

> **La retención es la operación más peligrosa de la app.** `purgar` solo borra
> archivos cuyo nombre calza **exactamente** con ese patrón, y lo comprueba dos
> veces: una al listar y otra justo antes del `remove_file`. No hay recursión y no
> se borra ningún directorio. La carpeta es del usuario y lo más probable es que
> esté compartida con el resto de su vida: un glob suelto ahí es pérdida de datos.
> `purgar(dir, 0)` no borra nada — un 0 por un ajuste mal tipeado no puede
> significar "borra todos mis respaldos". Hay un test que se pone rojo si el
> patrón se afloja a `*.zip`.

**El automático corre a `backup_time`, una vez al día, y lo corre Rust**
(`backup::start_watcher`, pulso de 60 s). La decisión vive en
`backup::should_backup`, pura y testeada, con tres cortes: sin carpeta no corre,
una vez al día (`backup_ran_on`) y recién pasada la hora. **Corre igual en dev**
— ver §4.20. La
marca es una **fecha local**, y el efecto es que **se pone al día**: si la app
estaba cerrada a las 20:00 y se abre a las 23:00, respalda ahí; si se abre al otro
día, la fecha ya no es hoy y también respalda. Lo único que no cubre es un día en
que la app no se abrió nunca.

> **Vivía en el front y se movió por I6.** Era un `setInterval` de 60 s en el
> webview de `main` (`useBackupRuntime`), y un webview que no se ve no corre sus
> timers: con la ventana tapada el respaldo esperaba a que algo despertara la
> página. **Medido en la app instalada: con la hora en 00:22, el zip salió a las
> 00:27.** Es el segundo caso de la misma clase después de la campana (§4.6), y
> por eso I6 dejó de ser una anécdota. Al moverlo desaparece además una
> invariante que había que mantener a mano —el hook vivía en `Shell` **solo** para
> que el taxímetro no hiciera su propio zip al mismo minuto—: con un proceso no
> hay ventana que elegir.
>
> Es un **pulso simple y no un sueño calculado** como el de la campana, a
> propósito: el respaldo apunta a una hora de pared una vez al día y se pone al
> día por construcción, así que la precisión no era lo que estaba roto. Lo único
> que se compró es que corra con la ventana tapada.
>
> La hora se compara **en minutos y no como texto**. El front lo hacía
> lexicográficamente y `hour()` acepta una hora de un dígito: con `9:05`,
> `"9:05" >= "20:00"` es falso todo el día y el respaldo no corría nunca.

**Configs se entera por evento.** Lo que escribe el vigilante —la marca del día y,
si falló, el error— no pasa por `setSetting`, que es lo que antes hacía redibujar
la sección. Rust emite `sunrise://backup-ran`, `useBackupListener` relee los
ajustes y `BackupCard` relista los zips cuando la marca cambia. Sin ese hilo el
síntoma es el silencioso de siempre: Configs diciendo que hoy no pasó nada.

**Y la marca del día se puede desmentir** ("Volver a respaldar hoy", la misma
regla que §4.24). No es una comodidad: con el de hoy hecho, cambiarle la hora no
dispara nada —la regla es una vez al día— y eso se ve **exactamente igual que un
automático roto**. Fue lo que pasó al probarlo.

**Carpeta vacía = respaldo apagado.** Es el estado de fábrica: los ajustes de
respaldo no los siembra ninguna migración, como `planned_at`. Y **la carpeta se
valida al guardarla** con una prueba de escritura real (`test_backup_dir`), no a
la hora del respaldo: un volumen de solo lectura o un Drive sin sesión es
perfectamente legible, y un ajuste que se acepta y falla nueve horas después no da
forma de saber qué se escribió mal (mismo criterio que §4.13 con la jornada).

**El fracaso queda escrito.** `backup_ran_on` se marca solo si salió bien; si
falló se guarda `backup_last_error` y la card lo muestra. Un respaldo que dejó de
correr en silencio es peor que no tener respaldo, porque se cuenta con él. La
fecha **sí** se marca cuando falla, por lo mismo que el aviso de cierre: un error
por minuto hasta la medianoche no arregla un disco desconectado.

#### La restauración

Reemplaza **todo**: no mezcla nada. Pasa por un `alertdialog` que lo dice, y de
paso dice las otras dos cosas que no son obvias — que la app guarda antes una
copia de la base que va a pisar (`antes-de-restaurar-…`, con nombre que la
retención **nunca** borra), y que un timer corriendo va a quedar apuntando a la
base nueva. El botón de confirmar queda en spinner (`.is-spinning`, el mismo del
sync) mientras corre.

**Al terminar se abre un segundo diálogo, no un aviso que se va solo.** Es la
única acción de la app que no se puede deshacer desde la app, así que el resultado
tiene que quedar en pantalla hasta que se lea. Muestra tres cosas, y el criterio
de qué **no** mostrar es igual de importante — el manifest trae también el tamaño
y el número de esquema, y con ninguno de los dos se puede decidir nada:

| Qué | Por qué |
|---|---|
| El momento del snapshot, con su antigüedad al lado | La pregunta real después de restaurar es "¿cuánto perdí?". Sale del **manifest**, con zona, que es más preciso que la fecha del nombre del archivo |
| Tareas y último trabajo de la base restaurada | Es lo que delata haber abierto el zip equivocado, que es el error que de verdad ocurre |
| La ruta de la copia de seguridad | Es el deshacer, y con la app corriendo no hay otra forma de volver |

La versión aparece **solo si difiere** de la actual: "0.1.0 → 0.1.0" es ruido, pero
venir de otra versión explica por qué hubo migración. Un respaldo sin manifest lo
dice en vez de mostrar la fecha del archivo como si fuera la del snapshot.

> Ojo con los dos formateadores de fecha, que hacen lo contrario a propósito:
> `readableDate` **no** convierte zonas (su entrada sale del nombre del archivo y
> no la declara), y `readableMoment` **sí** (el `created_at` del manifest trae
> offset y los `started_at` traen `Z`). Usar el primero para lo segundo mostraría
> un respaldo de las 20:03 a las 16:03.

El orden de `restore_backup` está puesto para que **ningún fallo deje la app sin
base**, y es lo único que importa de ese comando:

1. Se toma el lock del `Mutex` y no se suelta: nadie más escribe mientras corre.
2. La base del zip se extrae, se valida **y se migra** en un temporal. Todo lo que
   puede fallar por culpa del respaldo falla acá, con la base viva intacta.
3. Se guarda la copia de seguridad.
4. Recién entonces se cierra la conexión, se copia encima, se borran los `-wal` y
   `-shm` de la base anterior —abrir con ellos ahí sería pedirle a SQLite que
   recupere cambios de otra base— y se reabre.

**Los ajustes de respaldo sobreviven al reemplazo.** `backup_dir`, `backup_time` y
`backup_keep` se releen antes del swap y se vuelven a escribir después: describen
**esta máquina**, no los datos. Sin eso, restaurar un zip hecho antes de configurar
la carpeta dejaría `backup_dir` vacío y el respaldo automático se apagaría solo —
justo el fallo silencioso que `backup_last_error` existe para evitar. Es la única
excepción al "se reemplaza todo".

Si el paso 4 falla igual, se intenta volver a la copia; y si eso también falla, el
error nombra el archivo para poder recuperarlo a mano. **La conexión se reemplaza
en caliente** dentro del `Mutex` en vez de reiniciar la app: `app.restart()`
dispararía el propio `ExitRequested` (§4.10) y abriría el diálogo de salida. Lo
que hace que alcance con el swap es que `repo.rs` no guarda estado; el front se
entera con un `bumpData()`.

**Migrar antes del reemplazo no es la validación de versión que quedó fuera de
alcance**, es lo que hace la restauración usable: un zip de un build anterior trae
un esquema viejo y sin migrar la app consultaría columnas que no existen. Al
revés no se puede y se rechaza con un mensaje claro: un respaldo con
`schema_version` mayor que el máximo de esta app trae tablas que no conoce.

Se rechaza también un zip sin ningún `.sqlite` adentro y uno cuya base no tenga
`tasks`, `settings` y `_migrations`. Eso no es validar versiones: es no reemplazar
la base con el zip equivocado.

> **La restauración no se puede verificar fuera de Tauri**: el mock no tiene base
> que reemplazar. Lo que está cubierto en Rust es todo el camino de archivos
> (crear, listar, purgar, extraer, validar, la copia de seguridad), y en jsdom la
> UI y sus confirmaciones.

### 4.18 Inicio automático (`autostart`)

Casilla en Configs → General: **abrir sunrise al iniciar sesión**. Apagada de
fábrica.

**Por qué existe.** Tres cosas de la app pasan a una hora y las tres necesitan
que esté abierta: el aviso de cerrar el día (`work_end`, §4.16), el respaldo
automático (`backup_time`, §4.17) y el poller de calendario (§4.12). Un respaldo
configurado a las 20:00 no ocurre nunca el día que te olvidaste de abrir la app,
y no hay forma de que se entere.

**Arranca con la ventana visible**, sin argumentos extra. No hay icono en la barra
de menú (se descartó el tray a propósito), así que arrancar escondida sería
arrancar invisible: la app estaría corriendo y nada lo diría.

> **I** — **El estado no vive en `settings`, y eso no es una omisión.** La verdad
> la tiene el sistema operativo: en macOS, un plist en `~/Library/LaunchAgents`
> que el usuario puede borrar desde Ajustes del sistema sin pasar por acá. Una
> copia en la tabla mentiría la primera vez que eso pase. Y peor: cruzaría los
> respaldos, porque el zip se lleva la tabla entera —restaurar un zip de hace un
> mes prendería o apagaría el arranque de **esta** máquina. Es la misma razón por
> la que las tres claves de respaldo se reescriben después de restaurar (§4.17),
> resuelta al revés: en vez de proteger la clave, no tenerla.
>
> Se lee preguntándole al sistema en cada montaje del componente
> (`api.autostartEnabled()`), no desde `useSettingsStore`.

Se usa `MacosLauncher::LaunchAgent` y no `AppleScript`: escribe el plist sin pedir
permiso de automatización, que es lo que haría aparecer un diálogo del sistema al
prender la casilla.

El switch es **optimista y se revierte**: cambia al toque y vuelve atrás con el
error a la vista si el sistema rechaza el cambio. Un switch que espera al disco
antes de moverse se siente roto, y uno que se queda prendido después de fallar
miente sobre lo que va a pasar mañana.

> **En `pnpm tauri dev` lo que se registra es la ruta del binario que corre**, o
> sea `target/debug/sunrise`. Prenderlo en dev deja un LaunchAgent apuntando a un
> binario que puede desaparecer con un `cargo clean`. Se permite igual —es el
> único modo de probar el camino— pero hay que apagarlo antes de salir de dev.

### 4.19 Empaque (`.dmg`)

`pnpm dmg` (alias de `pnpm tauri build`). Deja dos cosas en
`src-tauri/target/release/bundle/`: `macos/sunrise.app` (~24 MB) y
`dmg/sunrise_<versión>_aarch64.dmg` (~8,5 MB). El build de release toma unos tres
minutos desde cero.

Verificado en el paquete que sale: versión `0.1.0`, identifier
`app.sunrise.desktop`, `LSMinimumSystemVersion` 11.0 (el build es
`aarch64-apple-darwin`, así que no hay macOS anterior donde correrlo),
`public.app-category.productivity`, y el `.icns` con la marca.

**La versión se toca en tres archivos y hay un test que lo vigila**:
`Cargo.toml` (de donde sale `APP_VERSION`, que va en el manifest de cada respaldo,
§4.17), `tauri.conf.json` (con la que Tauri nombra el `.dmg`) y `package.json`.
Subir una y olvidar otra deja los respaldos mintiendo sobre de qué build salieron.

> **I** — **Probar el `.app` de release toca tus datos de verdad, no una copia.**
> El identifier es el mismo en los dos, así que `app_data_dir()` resuelve a la
> misma carpeta (`~/Library/Application Support/app.sunrise.desktop`); lo que ya
> **no** comparten es el archivo, desde que dev y producción tienen bases separadas
> (§4.20): `db::file_name()` decide por `debug_assertions`, así que un `tauri build`
> abre `sunrise.sqlite` —la real— y `tauri dev` abre `sunrise-dev.sqlite`.
>
> La consecuencia práctica no cambió: **un build de release compilado para mirar
> algo escribe en tus datos**. Para probar sin riesgo, respalda antes desde la app;
> y ojo con que `tauri build --debug` cae del lado de dev, que a veces es lo que se
> quiere y a veces no.

**Sin firma de desarrollador, pero el bundle sí se firma ad-hoc.**
`bundle.macOS.signingIdentity` vale `"-"`, y eso **no es cosmético**: sin esa
clave, Tauri no firma el bundle, y el único que queda firmado es el binario
Mach-O, porque en Apple Silicon el linker lo firma solo —un ejecutable sin firma
no corre—. Ese estado a medias es peor que no tener firma: la firma del binario
promete recursos sellados que nadie selló (`Sealed Resources=none`,
`Info.plist=not bound`), y ante la contradicción macOS no dice "desarrollador no
verificado" sino **`"sunrise" is damaged and can't be opened`**, que manda a
botar el `.dmg`. Pasó con la 0.1.0.

Firmar ad-hoc no evita el bloqueo de Gatekeeper —ad-hoc no es notarizado, y
`spctl` sigue rechazando— pero lo convierte en el bloqueo que sí se puede
levantar. Un `.dmg` construido localmente no queda en cuarentena, así que
instalarlo acá funciona sin trámite; **el que baja del navegador sí**, y la
primera instalación pide

```bash
xattr -cr /Applications/sunrise.app
```

Está escrito en el README. **Las actualizaciones no vuelven a pasar por esto**:
el `.tar.gz` lo baja Rust y lo verifica con la llave del updater (§4.21), no el
navegador, y la cuarentena la pone quien descarga. Firmar y notarizar de verdad
necesita cuenta de Apple Developer (99 USD al año) y dos secrets más; mientras la
app la instale su autor, no hace falta.

**El fondo del `.dmg` y las posiciones de los iconos son un par, no dos ajustes.**
`src-tauri/dmg/background.svg` está dibujado para 660×400 con el resplandor puesto
en (180, 170), que es exactamente donde el bundler deja caer el icono de la app: el
sol del logo no está dibujado en el fondo porque **el sol es el icono**, saliendo
sobre la línea del horizonte. Por eso `windowSize`, `appPosition` y
`applicationFolderPosition` están **explícitos** en `tauri.conf.json` aunque hoy
coincidan con los defaults de Tauri — si un default cambiara, el resplandor
quedaría en el lugar equivocado y nada fallaría.

El fondo no lleva texto: la tipografía del proyecto es Sora y viene de
`@fontsource`, no del sistema, así que al rasterizar caería a una sans genérica.
El PNG va commiteado porque el bundler no lee SVG; se regenera con

```bash
rsvg-convert -w 660 -h 400 src-tauri/dmg/background.svg -o src-tauri/dmg/background.png
```

`bundle.targets` es `["app", "dmg"]` y no `"all"`: los targets de Linux y Windows
no aplican, y pedirlos solo hace que el bundler avise que no puede.

#### El Release lo publica CI

`.github/workflows/release.yml` se dispara **al empujar un tag `v*`** —no en cada
push— y publica el `.dmg` en un GitHub Release. Sacar una versión son dos pasos:
subir el número en los tres archivos y `git push --tags`.

El workflow corre en un runner **fijo** (`macos-26`) y no en `macos-latest`, y hay
dos razones que no son la misma. La primera es la arquitectura: el proyecto compila
solo arm64 y `macos-13` es Intel, así que ahí saldría un `.dmg` que no corre en
ningún Mac del equipo.

La segunda se descubrió comparando la app instalada con una compilada localmente:
**el SDK contra el que se enlaza el binario decide la apariencia de la ventana**.
macOS le da a cada app el marco de su SDK, así que con `macos-14` (SDK 14.5) lo
publicado salía con los botones de ventana de macOS 14 mientras en la máquina del
dev (SDK 26.5) se veían los actuales — misma configuración, mismo commit, distinto
marco. Se ve en el binario con `otool -l | grep -A5 LC_BUILD_VERSION`.

`macos-latest` arreglaría lo segundo, pero **moviéndose solo**: la apariencia de lo
que publicas cambiaría un día sin que nadie tocara nada, y el `minimumSystemVersion`
seguiría en 11.0 sin que nadie lo hubiera revisado contra el SDK nuevo. Por eso el
runner se sube a mano.

Tiene un paso propio que **compara el tag con los tres archivos** y falla si no
coinciden. Es el único lugar donde eso se puede pillar: el test de Rust comprueba
que los tres archivos coincidan **entre sí**, pero no sabe nada del tag, así que un
`v0.2.0` sobre un repo en `0.1.0` publicaría un `.dmg` llamado `0.1.0`. Y corre
`pnpm test:all` antes de empaquetar: un `.dmg` publicado con tests rojos es peor
que no publicar, porque alguien lo instala.

Está ejercitado desde la `v0.1.0`, y las tres versiones publicadas salieron por
ahí. La primera corrida falló, y no por el workflow: encontró un bug de zona
horaria que en Santiago pasaba por casualidad (ROADMAP 5.5).

#### Los tests corren en cada push

`.github/workflows/tests.yml` corre `pnpm test:all` **en cada push a `main` y en
cada pull request**. Es un archivo aparte y no un job más de `release.yml`, por
dos razones: ese workflow necesita `contents: write` para crear el Release y toca
la llave del updater, y ninguna de las dos cosas tiene por qué estar al alcance de
un PR. Éste corre con `contents: read` y no publica nada.

**Lo que agrega es el reloj, no la suite.** `pnpm test:all` ya corría antes de
empaquetar, así que un tag nunca publicó tests rojos. Lo que faltaba es que
corrieran **antes**: CI trabaja en UTC y la máquina del dev no, y esa diferencia
ya encontró dos bugs de fecha (ROADMAP 5.5 y 5.7) —las dos veces al empujar el
tag, con el número de versión ya commiteado y el release a medio camino. Ahora el
mismo hallazgo llega en el push que lo introdujo.

Corre en `macos-26` como el de release, pero **por otro motivo**: allá manda el
SDK, que decide la apariencia de la ventana; acá es que `pnpm test:rust` compila
el crate de Tauri entero, y en Linux eso arrastra las dependencias de sistema de
webkit2gtk. Además es la plataforma donde la app corre.

Tiene `concurrency` con `cancel-in-progress`: un push encima de otro cancela la
corrida anterior, porque los runners de macOS son lentos y una fila de rojos ya
superados no le sirve a nadie.

### 4.20 Dev y producción conviviendo

`pnpm tauri dev` y el `.dmg` instalado **pueden estar abiertos a la vez y no
comparten datos**. La base se separa por nombre de archivo dentro del mismo
directorio: `sunrise-dev.sqlite` en debug, `sunrise.sqlite` en release
(`db::file_name()`).

**Por qué existe.** El identifier es el mismo en los dos perfiles, así que
`app_data_dir()` resuelve al mismo lugar. Antes de esto, abrir `pnpm tauri dev` para
probar un cambio escribía en los datos de verdad: sellar un día, correr una
migración a medio escribir, arrastrar tareas de prueba. Sin ninguna señal de que
estaba pasando.

> **I** — **La separación es por archivo, no por directorio.** El directorio lo
> decide el identifier, y cambiar el identifier en dev se lleva a otro lado el
> permiso de notificaciones y la ruta del LaunchAgent del inicio automático
> (§4.18). El nombre del archivo no arrastra nada. La condición es
> `debug_assertions`, que es exactamente la que separa `tauri dev` de `tauri build`;
> un `tauri build --debug` cae en dev, y está bien: es un artefacto de desarrollo.

**El puente entre las dos bases es el respaldo.** Respaldas en producción y
restauras ese zip en dev, y trabajas contra datos reales sin tocarlos. Funciona
porque **el nombre de la base dentro del zip no depende del perfil**: siempre es
`sunrise.sqlite` (`backup::DB_IN_ZIP`). Hay un test que lo fija — si el zip llevara
el nombre del perfil, un respaldo tomado en dev no se podría restaurar en
producción, y el puente no existiría.

> **I** — **El respaldo automático corre también en dev, y lo que lo hace seguro
> son los nombres.** Producción escribe `sunrise-…` y dev escribe `sunrise-dev-…`
> (`backup::prefix`), y `is_backup_name` —que es **el único permiso para borrar**—
> exige el prefijo de su propio perfil. Con eso los dos conjuntos son **disjuntos**:
> apuntando los dos a la misma carpeta, ninguna retención puede alcanzar lo que
> escribió la otra. Cada perfil lista solo lo suyo, y el puente sigue existiendo
> porque restaurar toma la ruta del selector de archivos, no de la lista.
>
> **Antes estaba apagado**, y la razón era real: las bases están separadas pero
> `backup_dir` es una ruta en el disco, así que si restauras un zip de producción
> en dev —o sea, si usas el puente— dev hereda la carpeta, empieza a escribir zips
> de prueba ahí y con un nombre compartido **la retención borra los respaldos de
> verdad** para conservar los de prueba. Lo que cambió no es la evaluación del
> riesgo, es que el riesgo desapareció: separar los nombres es más barato que
> apagar la función. Y apagado **no había forma de probar el automático antes de
> publicar una versión**, que es exactamente cuando importa que funcione.
>
> Tres tests lo sostienen: que ningún perfil reconozca el nombre del otro, que la
> retención de dev no toque los de producción en la misma carpeta, y que cada uno
> liste solo lo suyo.

**El `localStorage` tampoco se cruza, pero por otra razón.** La base no es el único
almacén de la app: el canal entre ventanas (`sunrise-data`, §5.2), el tema y la
última tarea del taxímetro viven en `localStorage`. El store del webview **sí** es
compartido —está en `~/Library/WebKit/sunrise`, con el nombre del producto, que es
el mismo en los dos perfiles— pero adentro está **particionado por origen**, y los
dos perfiles tienen orígenes distintos: dev sirve el front desde
`http://localhost:1420` y el release lo carga por el protocolo `tauri://`. Así que
un `bumpData()` en dev no invalida las vistas de producción, y la tarea que el
taxímetro recuerda no se filtra apuntando a un id que en la otra base no existe.

> **Ojo: eso es un efecto secundario, no una decisión.** El aislamiento del
> `localStorage` depende de que dev use un servidor de desarrollo. Si algún día
> `devUrl` apuntara al protocolo propio, o dev se armara con el front empaquetado,
> los dos perfiles caerían en el mismo origen y compartirían las cuatro claves.
> Verificado hasta donde se puede sin instalar el `.app`: en el disco hay un solo
> directorio de origen (`http://localhost`) con `sunrise-data`, `sunrise-timer`,
> `sunrise-theme` y `sunrise-tax-pos`.

**En pantalla se ve cuál es cuál.** El sidebar muestra un distintivo `dev` al lado
de la marca, con el archivo de base en su `title`. No es decoración: dos ventanas
idénticas con datos distintos son indistinguibles, y el error natural es editar en
la equivocada. Sale de `useProfile()` (`src/lib/profile.ts`), que pregunta **una vez
por sesión** y cachea la promesa —es un dato del binario, no puede cambiar— y
devuelve `null` mientras no llega. Ese `null` significa "todavía no sé", **no** "es
producción": asumir producción por un instante alcanza para que el respaldo
automático corra una vez.

### 4.21 Actualizaciones (`updater`)

La app se actualiza sola desde el mismo Release de GitHub que publica el `.dmg`
(§4.19), con `tauri-plugin-updater`. Configuración en `tauri.conf.json`:

```json
"plugins": { "updater": { "endpoints": ["…/releases/latest/download/latest.json"], "pubkey": "…" } },
"bundle":  { "createUpdaterArtifacts": true }
```

**El updater no usa el `.dmg`.** Con `createUpdaterArtifacts` el build produce
además un `.app.tar.gz` con su firma al lado, y `tauri-action` escribe el
`latest.json` que la app consulta. El `.dmg` sigue siendo solo para la primera
instalación.

**La firma del updater no tiene nada que ver con la de Apple.** Es un par de
llaves propio (`pnpm tauri signer generate`): la pública va versionada en
`tauri.conf.json`, la privada vive en los secrets del repo y el workflow la pasa
como `TAURI_SIGNING_PRIVATE_KEY`. Es lo que impide que alguien sirva una
actualización falsa desde esa URL. Se generó **sin contraseña**: guardarla en el
mismo almacén de secrets que la llave no protege de nada, pero la variable
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` va igual porque el firmador la exige aunque
esté vacía.

> **I** — **El repo tiene que ser público.** La URL del `latest.json` se pide sin
> credenciales; en un repo privado devuelve 404 a todos, y el síntoma es "nunca hay
> actualizaciones", que es indistinguible de estar al día. Si algún día se cierra,
> el updater deja de funcionar en silencio y hay que cambiar la forma del endpoint
> (uno con token, o un repo público aparte solo para los Releases).

> **I** — **La llave privada no entra al repo.** Ni como archivo suelto (hay
> `*.key` en `.gitignore`) ni pegada en un YAML. Si se pierde, no se puede firmar
> una actualización que las apps ya instaladas acepten: hay que repartir un `.dmg`
> nuevo con la llave pública nueva.

> **I** — **Faltar una pieza de config no rompe nada visible.** Sin `pubkey` el
> plugin no arranca, sin `endpoints` no hay a quién preguntar, sin
> `createUpdaterArtifacts` el Release sale con `.dmg` pero sin manifiesto, y sin
> `TAURI_SIGNING_PRIVATE_KEY` los artefactos salen sin firmar y la app los rechaza.
> Las cuatro dan el mismo síntoma —"nunca hay actualizaciones"— que es
> indistinguible de estar al día. El test `la_config_del_updater_esta_completa`
> cubre las tres primeras; la cuarta solo se ve en el primer tag.

**Todo el updater vive en Rust**, en `commands.rs`: `check_for_update` (que
devuelve `Option<AppUpdate>`, donde `None` es "estás al día") e
`install_update` (que descarga, instala y llama a `app.restart()`, así que
no retorna). Lo que no es un comando —el progreso y el foco de después— está en
`update.rs`. El plugin también tiene API de JavaScript, y no se usa: obligaría a
un paquete npm más y a abrirle permisos en `capabilities/default.json`, y dejaría a
`ipc.ts` de ser la única puerta a la app. `install_update` vuelve a
preguntar en vez de guardarse el `Update` de la búsqueda anterior — mantenerlo vivo
entre dos comandos obliga a un `State` con media operación de red adentro, y el
costo real es una petición HTTP.

**Cuándo se busca.** Al abrir la app y después **cada 4 horas** (`useUpdateRuntime`,
§4.23), más el botón de Configs → General → Actualizaciones cuando quieras
preguntar ahora.

**El avance de la descarga viaja por evento, no por comando.** `install_update` no
vuelve nunca cuando sale bien, así que el que tiene que hablar primero es Rust:
`update::emit_progress` manda `sunrise://update-progress` con `{ downloaded, total,
installing }` a cada trozo que llega, y el aviso del sidebar dibuja la barra
(§4.23). El acumulado lo cuenta Rust: el callback del plugin entrega el tamaño de
**cada trozo**, no el total bajado.

> **I** — **`total` es `Option` y hay que aguantar que falte.** Sale del
> `Content-Length` de la respuesta, que el servidor puede no mandar. Sin total no
> hay fracción, y ahí la barra va indeterminada: un 0 % dibujado es una mentira
> sobre algo que sí está avanzando. Lo mismo en el tramo final, el que reemplaza el
> `.app`: no reporta avance, así que `installing: true` saca a la barra de medir en
> vez de dejarla clavada en el 100 %.

**Al reiniciar, la app vuelve al frente.** `app.restart()` lanza el proceso nuevo y
mata el viejo, y macOS no activa a nadie por eso: la ventana nueva aparece **detrás**
de la app que quedó adelante, y el síntoma exacto es "apreté actualizar y la app
nunca se reinició". `install_update` deja un archivo de marca en el directorio de
datos (`pending-update-focus`) y el `setup` del arranque siguiente lo consume y
levanta `main`.

> **I** — **La marca se escribe con la instalación ya hecha, y se consume al
> leerla.** Escrita antes de descargar, una descarga fallida la dejaría colgada, y
> el siguiente arranque —que es el del inicio automático (§4.18), el que
> deliberadamente no interrumpe— le robaría el foco a lo que estés haciendo.
> Borrarla antes de intentar el foco y no después es por lo mismo: un fallo en el
> medio no puede dejarla armada.

> **I** — **Levantar la ventana son cuatro intentos, no uno.** El proceso viejo
> todavía está muriendo cuando el nuevo dibuja, así que el primer `set_focus`
> compite con una app que sigue al frente y se pierde. Cada intento comprueba
> **antes** si el anterior funcionó y corta ahí; comprobarlo justo después de pedir
> el foco no sirve, porque `set_focus` en macOS despacha al hilo principal y vuelve
> antes de que la activación haya pasado —siempre diría "todavía no", y el último
> intento, a casi tres segundos, le arrebataría el foco a quien ya se cambió de app.
> Solo se levanta `main`: el taxímetro no aparece por su cuenta. Y el orden
> `unminimize` → `show` → `set_focus` importa —`set_focus` no hace nada sobre una
> ventana escondida o minimizada—, igual que en el diálogo de ⌘Q (§4.10).

> **I** — **Nada de esto interrumpe.** La decisión original de 5.3 fue no buscar al
> arrancar, con el argumento de que la app ya interrumpe dos veces a una hora fija
> (el aviso de cerrar el día y el respaldo). El sondeo automático **no la
> contradice**: lo que aparece es una franja en el sidebar que espera, no un modal.
> Lo que sigue prohibido es que algo se ponga adelante del día sin que lo pidas. Y
> sin la consulta al arrancar, un intervalo de 4 horas no dispararía nunca para
> quien cierra la app todos los días.

**El fallo se dice en gris, no en rojo.** Sin conexión, o antes de que exista el
primer Release, la consulta al `latest.json` no llega. La vista distingue los tres
finales —hay versión nueva, no hay, no se pudo preguntar— porque los dos últimos se
ven parecidos y significan lo contrario: "estás al día" es una respuesta, "sin
conexión" es la falta de una.

### 4.22 Changelog y el aviso "Lo nuevo"

`docs/CHANGELOG.md` es **la fuente única de lo que se anuncia**, y de cada sección
salen tres textos:

| Dónde se lee | Qué parte |
|---|---|
| Modal "Lo nuevo en la vX.Y.Z", al abrir después de actualizar | el primer párrafo, **y la fecha del encabezado** |
| Configs → Actualizaciones, **antes** de instalar (`AppUpdate.notes`) | la sección entera |
| El cuerpo del Release en GitHub | la sección entera |

> **I** — **El aviso previo y el modal salen del mismo texto.** Es la razón del
> diseño: si fueran dos, se prometería una cosa en Configs y se anunciaría otra al
> reiniciar, y nadie lo notaría hasta que ya está publicado.

**La fecha del encabezado se dibuja.** `releaseDateFor` la saca del `## vX.Y.Z —
fecha` y el modal la muestra bajo la versión, así que dejó de ser decorativa. Sigue
siendo opcional en el formato —una build local puede no tenerla— y quien la muestre
tiene que aguantar que falte, no rellenarla con hoy.

**El formato es estricto porque lo leen dos cosas distintas.** `## vX.Y.Z — fecha`
abre la sección; los párrafos que siguen son el anuncio; `### Detalle` empieza lo
que **no** llega al modal (el detalle técnico). En el front lo parsea
`src/lib/changelog.ts` (`announcementFor` / `sectionFor`); en CI, un `awk` de tres
líneas en `release.yml`. No son dos parsers del mismo dato: uno quiere el primer
párrafo y el otro la sección completa.

**El changelog viaja en el bundle** (`import ... from "../../docs/CHANGELOG.md?raw"`).
Cuesta unas decenas de líneas por versión y compra lo que importa: el modal aparece
justo después de que el updater reinició la app, y ahí no es momento de depender de
una petición HTTP.

> **I** — **La versión que se compila tiene que tener su sección.** Si no, el modal
> queda vacío **y** las notas del Release también, sin que nada se ponga rojo. Lo
> cubre un test en `src/lib/changelog.test.ts` que lee la versión de `package.json`
> — el equivalente del que compara los tres archivos de versión en Rust.

**El modal `WhatsNew` no se abre solo.** Lo levanta el aviso del sidebar, que es lo
que aparece al volver de un update (§4.23), o el botón "Ver lo nuevo" de Configs
cuando ese aviso ya se fue.

**El modal es el `Dialog` compartido con una variante, no un panel propio.**
`variant="announcement"` agrega la clase y nada más; los estilos —la cabecera de
amanecer a sangre, la versión grande, el ancho de 440px— viven en `updates.css`,
que es de la feature. Forkear el componente "porque este se ve distinto" es volver
a la trampa que lo creó: estaba copiado seis veces y una de las copias se había
quedado sin teclado.

> La cabecera va como **hijo** del diálogo y sube sobre el título con `order: -1`.
> `Dialog` dibuja el `<h2>` antes que sus hijos, y meter un bloque dentro de un
> encabezado para ganarle al orden es peor que esa línea de CSS.

**Lo que la cabecera dibuja es el amanecer de la marca**: el mismo sol del icono de
la app saliendo por detrás de la cordillera, con su halo. No es adorno por adorno
—llegar a una versión nueva se tiene que sentir como algo y no como un aviso del
sistema— y se queda quieto bajo `prefers-reduced-motion`, donde el degradado, los
cerros y el sol siguen estando.

> **I** — **El sol tarda casi tres segundos en salir, y eso es el punto.** A poco más
> de un segundo el disco pegaba un salto y quedaba quieto: un despegue, no un amanecer.
> La curva suelta la mayor parte del recorrido al principio y después se arrastra, que
> es lo que se lee como *subir*. El halo entra con él —si no, aparece entero antes de
> que el disco asome— y empieza a latir cuando el sol ya llegó.

**El cielo aclara con el sol**, y no es un adorno de más: el disco solo, subiendo en un
cielo quieto, no se nota si no sabes que está. La cabecera arranca en el cielo de antes
del amanecer —malva profundo, un asomo de naranja en el horizonte, los cerros sin luz—
y termina en el cielo aclarado. Las caras al sol de las cumbres se encienden en el mismo
compás: dos caras naranjas prendidas antes de que el sol asome cuentan otra historia.

> **I** — **Son dos cielos apilados cruzándose, no un degradado que cambia de color.**
> Un `linear-gradient` no se interpola: animar `background-image` no hace nada. El de
> antes va en el `background` de `.nuevo__cielo` y el aclarado en su `::before`, al que
> se le anima la opacidad. De paso los dos estados quedan escritos como lo que son en
> vez de repartidos entre keyframes. El cielo va 400ms más largo que el sol y sin
> espera: empieza a cambiar antes de que el disco asome y sigue después de que llegó,
> que es el orden real.

> **I** — **El cielo de antes va bien cargado de malva.** Mezclado suave contra la
> superficie quedaba lavanda pálido en tema claro, o sea casi igual al cielo aclarado, y
> ahí la animación del cielo no se notaba — que es justo lo que se vino a arreglar. El
> asomo del horizonte mezcla dos colores de la paleta y ninguna superficie, así que es
> el mismo en los dos temas.

> **I** — **Bajo `prefers-reduced-motion` hay que *poner* el estado final, no solo
> apagar la animación.** El cielo aclarado y las caras al sol son capas que **empiezan
> invisibles**: con un `animation: none` a secas se quedaría el cielo de antes del
> amanecer para siempre. Es la excepción al resto del bloque, donde apagar alcanza.

**Los cerros van en SVG y son dos cadenas**, no una: la de atrás en un tono más
claro —la bruma de la distancia—, la de adelante oscura y dominante, desfasada para
que la de atrás asome por los portezuelos. Las dos van con **aristas rectas**: las
curvas suaves que se probaron primero se leían como dunas, y una cordillera es piedra
quebrada. Lo que las salva de parecer un gráfico de triángulos no es curvarlas sino
que **ninguna cumbre sea simétrica ni mida lo mismo**: dos cumbres altas desiguales, en
cada una una falda larga y tendida contra una caída corta y empinada, y repisas a media
ladera que quiebran la recta. El sol se dibuja **antes** que ellas para que lo tapen;
de ahí sale que *salga* de atrás de los cerros en vez de flotar sobre una banda de
color.

**El único detalle que llevan es la cara al sol**, un triángulo en tono más claro por
la vertical de cada cumbre alta. Nada de nieve: se probó y sobra. Como el sol sale en
el portezuelo del medio, la cumbre de la izquierda tiene iluminada su cara derecha y la
de la derecha su cara izquierda —las dos miran al centro—, y eso es lo que hace que la
luz se lea como *de ese sol* y no como un degradado decorativo.

> **I** — **La cara al sol mezcla con `--peach`, no con la superficie.** Mezclado con
> la superficie el tono queda más claro en tema claro y más **oscuro** en tema oscuro,
> o sea que la cara iluminada se veía como sombra en uno de los dos. El damasco es fijo
> en los dos temas, así que la luz siempre queda más cálida que la sombra. Es la misma
> trampa que el ink de la selección (§ paleta en `tokens.css`).

> **I** — **Se ve medio sol, y la fracción sale de una resta.** Entre las dos cumbres
> altas hay un **portezuelo casi plano y no un pico** —cortado por una punta el disco se
> ve mordido—, que pasa por `y=58` de un `viewBox` de 118 pegado al borde, o sea 60px
> sobre el pie de la cabecera; con un disco de 78, el `bottom` del sol es
> `60 − 78/2 = 21px`. El portezuelo está centrado, así que el sol sale al medio **y**
> entre dos cumbres. Mover el portezuelo sin mover el `bottom` cambia cuánto sol se
> tapa.

> **I** — **Las siluetas cierran en `x=440`, el ancho del `viewBox`.** Escritas con
> deltas relativas la suma no llegaba al borde, y por el hueco de la derecha se
> colaba el cielo por debajo de los cerros: una línea horizontal de dos píxeles
> justo donde la cabecera se junta con el texto. Se estiran con
> `preserveAspectRatio="none"`, que es deliberado —un cerro estirado sigue siendo un
> cerro—, y por eso el ancho del `viewBox` no puede quedar corto.

> **I** — **La variante se selecciona con dos clases: `.dialog.dialog--announcement`.**
> `updates.css` se importa **antes** que `dialog.css` (ver `App.tsx`), así que con
> una sola clase el `padding` del `.dialog` de allá gana por orden de carga y
> reaparece una franja de superficie sobre la cabecera. Cualquier variante nueva de
> `Dialog` que sobreescriba algo del componente compartido tiene el mismo problema.

**El borde entre la cabecera y el cuerpo tiene forma, no un desvanecido.** La primera
versión intentaba borrarlo con un degradado a `--surface-raised`, y no funciona: un
degradado que quiere hacer desaparecer un borde deja siempre una banda turbia donde el
corte se nota igual. Lo que hay ahora es **la hoja del cuerpo subiendo por encima de
los cerros**, y es asimétrica: **baja a la izquierda y sube a la derecha**, en una
sola curva. El título se apoya en la parte baja. No esconde el borde, lo declara: la
hoja de papel se apoya sobre la foto y se ve que se apoya. Por eso los cerros van de
**relleno plano**: para que un borde recorte una silueta, la silueta tiene que existir.

> **I** — **La hoja es un `path` del mismo SVG, no un `border-radius`.** Un radio hunde
> las dos esquinas por igual, y acá los dos lados tienen que hacer cosas distintas.
> Va pintada del color del diálogo (`--surface-raised`) y **última**, después de los
> cerros.

> **I** — **Un solo `C`, no tramos pegados.** La versión anterior era una esquinita
> redondeada, después un tramo a nivel y después la subida: tres gestos discutiendo en
> 440px, con un quiebre visible en cada junta. Es un cubic con la **tangente horizontal
> en el borde izquierdo**, así arranca a nivel sin hacer ángulo contra el costado de la
> caja, y suelta hacia arriba a la derecha.

El título **se mete dentro de la cabecera** con un margen negativo, apoyado en esa
hoja: es lo que hace que las dos partes se lean como una sola cosa en vez de dos
bloques apilados, y el texto queda sobre superficie plana, así que no pierde
contraste. Lleva `z-index` porque en un flex el orden de pintado lo manda `order`, y
la cabecera va con `order: -1`.

**El botón va al centro y no hay línea de teclas.** Es el único botón y el diálogo
solo se cierra: alineado a un costado sugiere que del otro lado había otra opción, y
un "Enter o Escape para cerrar" es ruido en un anuncio —está para los diálogos donde
la tecla decide algo—.

---

### 4.23 El aviso del updater en el sidebar

Una **tarjeta** arriba del switch de tema, con **dos estados y ninguno interrumpe**.
`UpdateBanner` la dibuja; `useUpdateRuntime` decide cuál va.

| Estado | Cuándo | Al apretarlo | Cuánto dura |
|---|---|---|---|
| **Versión X disponible** | el sondeo encontró algo | descarga, instala y **reinicia la app** | hasta que lo aprietes |
| **Estás al día** | esta sesión viene de un cambio de versión | abre el modal "Lo nuevo" | **30 segundos** |

**Es una tarjeta y no una fila.** Nació con el alto de un ítem de navegación, y lo
que ofrece —reemplazar la app y reiniciarla— no se lee en una franja de ese tamaño.
Gana un icono en cuadrado redondeado, la fecha de publicación a la derecha y el
espacio donde va la barra de descarga; conserva el radio y la tipografía del sidebar
para seguir siendo parte de él y no un cartel pegado encima.

**Lo que baja se dice en palabras y en barra.** El progreso llega por evento desde
Rust (§4.21) y el aviso lo traduce a cuatro estados: *Preparando la descarga…* (sin
el primer trozo), *Bajando · 42 %* (con total), *Bajando · 3,0 MB* (sin total) e
*Instalando y reiniciando…* (reemplazando el `.app`). La barra solo aparece mientras
baja: el resto del tiempo no hay un hueco vacío reservado.

> **I** — **El título no se convierte en el estado.** Sigue diciendo *Versión 0.5.0*
> durante toda la instalación y lo que cambia es la línea de abajo. El nombre de la
> cosa que estás mirando no puede volverse su estado a mitad de la operación.

> **I** — **Cada pieza nueva de la tarjeta hay que esconderla en el rail
> colapsado.** La lista está en `global.css` (`.sidebar.is-collapsed .upd-banner__…`)
> y en el rail sobrevive solo el icono. Una pieza que se olvide se desborda de una
> columna de 38px sin que nada se queje, y es la falla que se nota más tarde.

> **I** — **Se monta una sola vez, en `Shell`** (ventana `main`). Dos ventanas
> sondeando serían dos consultas por intervalo, por lo mismo que el aviso de
> cierre (I6). La campana y el respaldo automático **ya no** son ejemplos de esto:
> se fueron a Rust justamente porque depender de una ventana los dejaba muda al
> uno y tarde al otro (§4.6 y §4.17).

**El aviso reemplazó al modal automático**, que fue la primera versión de esto. Un
modal encima de la app al abrirla es la interrupción que §4.21 descartó: el aviso
espera en el sidebar y tú decides si lo lees. Y como se va solo a los 30 segundos,
no deja basura en pantalla para quien no le interesa.

**Cómo se detecta "vengo de un update".** Se compara `app_version` contra
`sunrise-seen-version` en `localStorage`:

- **Sin marca** (instalación nueva) no avisa nada y solo la deja. Abrir la app por
  primera vez con un aviso encima es la peor bienvenida posible.
- **Marca distinta** ⇒ avisa, si además hay anuncio escrito para esa versión: sin
  texto, el aviso llevaría a un modal vacío.
- **La marca se escribe siempre**, incluso cuando no se avisa. Si no, una versión
  sin anuncio dejaría la marca vieja y el aviso saltaría en la siguiente mostrando
  el texto equivocado.

> **I** — **La marca vive en `localStorage`, no en `settings`.** Por lo mismo que el
> inicio automático (§4.18): describe esta instalación, no tus datos. En `settings`
> viajaría dentro de los respaldos, y restaurar un zip viejo haría reaparecer el
> aviso de una versión ya leída. Depende de que el store de WebKit
> —`~/Library/WebKit/sunrise`, con el nombre del producto (§4.20)— **sobreviva a que
> el updater reemplace el `.app`**, y sobrevive porque no está indexado por el
> bundle. Si eso cambiara, el aviso aparecería en cada arranque.

**Dispara con cualquier cambio de versión**, no solo con una actualización
automática: reinstalar el `.dmg` a mano también cuenta. Lo que importa para el aviso
es que la versión cambió desde la última vez que miraste, no de dónde vino.

> La marca de Rust (`pending-update-focus`, §4.21) es **otra cosa y no reemplaza a
> esta**: sirve para levantar la ventana y se consume en el arranque. El aviso sigue
> saliendo de comparar versiones, que es lo que lo hace funcionar también con un
> `.dmg` instalado a mano.

**`updatedTo` y `bannerVisible` son dos campos y no uno.** Apretar el aviso lo
apaga, pero el modal todavía necesita saber **qué** versión mostrar; con un solo
campo, el click se llevaría el dato junto con el aviso.

**Si la instalación falla, el botón vuelve.** La app no se reinició, así que dejarlo
en "Instalando…" para siempre es mentirle a alguien que está mirando el sidebar
esperando que algo pase. El fallo se ve en la tarjeta —"No se pudo. Reintenta."— y
el error completo va en el `title`; **no se pone roja**, por lo mismo que el fallo de
la búsqueda se dice en gris (§4.21). Un intento nuevo parte el progreso de cero.

> **I** — **Instalar desde Configs tiene que avisarle al store.** Los dos caminos
> —el aviso del sidebar y el botón de Configs— llaman al mismo comando, pero el
> aviso lee `installing` del store. Con Configs manejando solo su estado local, la
> tarjeta del sidebar seguía diciendo "Actualizar ahora" y habilitada mientras la
> descarga corría, y un click ahí lanzaba una segunda descarga del mismo paquete.
> Configs muestra además el porcentaje, que sale del mismo evento.

**El anuncio se puede volver a leer.** El aviso dura 30 segundos y después el modal
quedaba inalcanzable para siempre; Configs → Actualizaciones tiene un botón "Ver lo
nuevo" que lo abre con la versión que está corriendo. Solo aparece si esa versión
tiene sección escrita, porque sin texto el modal no abre.

**Las animaciones tienen que poder apagarse.** El brillo que cruza la tarjeta, la
flecha que sube, la chispa, la línea que consume los 30 segundos y el paseo de la
barra indeterminada se anulan bajo `prefers-reduced-motion`, y ahí no se pierde
información: el color, el icono y el texto dicen lo mismo. Los 30 segundos los
cuenta el store y no el CSS, así que el aviso se va igual.

> **I** — **La excepción es el ancho de la barra determinada**, que sigue
> moviéndose: ahí el movimiento *es* el dato, no un adorno. Se le quita la
> transición para que no haya interpolación, y nada más. Y toda animación nueva hay
> que agregarla a ese bloque a mano: enumera por nombre, no por prefijo.

**Cómo se prueban las dos franjas antes de publicar.** No se puede esperar a tener
dos versiones: `devFake.ts` deja un banco de pruebas en la consola del webview, con
`sunriseDev.flujoCompleto()`, `.hayUpdate()`, `.alDia()` y `.limpiar()`. La
instalación simulada **también finge el progreso**: es la mitad de lo que la tarjeta
muestra, y sin eso el banco de pruebas no sirve para mirar justamente lo que se vino
a hacer. Trabaja sobre el store y no sobre `mockDb`, que es lo que lo hace servir
**dentro de `pnpm tauri dev`**: ahí el front habla con Rust y el mock no participa.

> **I** — **El banco de pruebas no llega a producción.** Todo cuelga de
> `import.meta.env.DEV`, que en el build es una constante falsa. Y la instalación
> simulada **no llama a `installUpdate`**: descargaría un paquete real y reiniciaría
> la app. Aterriza en la versión que está corriendo y no en la falsa, porque es la
> única con anuncio escrito — sin eso el flujo de prueba muere en una franja muda.

> **I** — **Los 28 s del desvanecido y los 30 del store van juntos.** La animación
> de salida arranca a los 28 y dura 2; el store desmonta a los 30. Si alguien mueve
> uno sin el otro, el aviso desaparece de golpe o se queda invisible ocupando lugar.
