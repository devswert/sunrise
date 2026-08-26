//! sunrise — runtime de la app de escritorio (Tauri v2).

mod backup;
mod bell;
mod calendar;
mod commands;
mod db;
mod fonts;
mod models;
mod notice;
mod repo;
mod sound;

use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::db::Db;

/// Id del ítem de menú que reemplaza al Quit nativo (ver `setup`).
const QUIT_MENU_ID: &str = "sunrise-quit";
/// Evento que le pide al front abrir el diálogo de confirmación de salida.
const CLOSE_REQUESTED: &str = "sunrise://close-requested";
/// Aviso de que el poller de calendario escribió algo. Lo escuchan las dos
/// ventanas para invalidar sus vistas (ver `useCalendarListener` en el front).
pub const CALENDAR_SYNCED: &str = "sunrise://calendar-synced";
/// Aviso de que el respaldo automático corrió (haya salido bien o mal). Lo
/// escucha Configs para releer la lista de zips y el último error, que los acaba
/// de escribir Rust (ver `useBackupListener` en el front).
pub const BACKUP_RAN: &str = "sunrise://backup-ran";

/// Pide la confirmación de salida, **después** de asegurarse de que se pueda
/// ver.
///
/// El diálogo de ⌘Q (§4.10) vive dentro de la ventana `main`, así que si está
/// minimizada el usuario aprieta ⌘Q, no ve nada y la app parece colgada con el
/// timer corriendo. **macOS no la levanta solo**: comprobado con la ventana
/// minimizada y la app al frente, ⌘Q deja `AXMinimized` en true y el proceso
/// vivo — o sea el pedido llegó y la respuesta se dibujó donde nadie la ve.
///
/// Levantar la ventana desde acá y no convertir el diálogo en un `ask()` nativo
/// es deliberado: el diálogo propio es el mismo componente que el resto de la
/// app (Mej.17 se retiró por eso).
fn request_close(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit(CLOSE_REQUESTED, ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // Abre los links de reunión en el navegador del sistema. Sin esto, un
        // `<a target="_blank">` dentro del webview no hace absolutamente nada.
        .plugin(tauri_plugin_opener::init())
        // Selectores nativos de archivo y carpeta: la carpeta de respaldos y el
        // `.zip` a restaurar se eligen con el Finder, no escribiendo una ruta.
        .plugin(tauri_plugin_dialog::init())
        // Inicio automático con el sistema, apagado hasta que se prenda en
        // Configs. `LaunchAgent` en vez de `AppleScript`: escribe un plist en
        // `~/Library/LaunchAgents` sin pedir permiso de automatización, que es lo
        // que haría aparecer un diálogo del sistema al prender la casilla.
        //
        // Se abre la ventana como siempre, sin argumentos extra: la app es lo
        // primero que uno mira en la mañana, y sin un icono en la barra de menú
        // arrancar escondida sería arrancar invisible.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Actualizaciones desde el Release de GitHub. Solo se registra el plugin:
        // no hay chequeo al arrancar. La app ya interrumpe a una hora fija dos
        // veces (el aviso de cierre y el respaldo) y una tercera cosa que aparece
        // sola al abrir es la que sobra. Se busca cuando lo pides, en Configs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Base de datos en el directorio de datos de la app.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join(db::file_name());

            let conn = db::open(&db_path)?;
            db::migrate(&conn)?;
            app.manage(Db(Mutex::new(conn)));
            app.manage(bell::Armed::new());

            // En macOS el "Quit" del menú por defecto mapea a
            // `NSApplication terminate:`, que mata el proceso **sin pasar por
            // el event loop**: ni `ExitRequested` ni `CloseRequested` llegan a
            // dispararse, así que ⌘Q cerraba la app de una. Se reemplaza por un
            // ítem propio con el mismo acelerador, que sí llega como
            // `MenuEvent` y podemos convertir en el pedido de confirmación.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, MenuItemKind};

                let menu = Menu::default(app.handle())?;
                if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
                    // El Quit es el último ítem del submenú de la app
                    // (ver `Menu::default` en tauri). Si algún día deja de
                    // serlo, preferimos no tocar nada antes que borrar el ítem
                    // equivocado en silencio.
                    let items = app_menu.items()?;
                    match items.last() {
                        Some(MenuItemKind::Predefined(default_quit)) => {
                            app_menu.remove(default_quit)?;
                            let own = MenuItem::with_id(
                                app.handle(),
                                QUIT_MENU_ID,
                                format!("Quit {}", app.package_info().name),
                                true,
                                Some("CmdOrCtrl+Q"),
                            )?;
                            app_menu.append(&own)?;
                            app.set_menu(menu)?;
                        }
                        _ => eprintln!(
                            "[sunrise] el menú de la app no termina en el Quit esperado; \
                             ⌘Q va a cerrar sin confirmar"
                        ),
                    }
                }
            }

            // De quién son los avisos del sistema. Va **antes** de que se mande
            // ninguno: la librería lo fija con un `Once` de proceso y gana el
            // primero que llame (§4.25).
            #[cfg(target_os = "macos")]
            commands::claim_notification_identity(&app.config().identifier);

            // Poller de calendario. Va después de la DB porque la necesita.
            calendar::start_poller(app.handle().clone());

            // La campana del estimado. Va en Rust y no en una ventana porque un
            // webview que no se ve no corre sus timers (ver `bell.rs`), y también
            // necesita la DB.
            bell::start_watcher(app.handle().clone());

            // El respaldo automático, por la misma razón que la campana: vivía en
            // un `setInterval` de `main` y con la ventana tapada llegaba tarde.
            backup::start_watcher(app.handle().clone());

            // El aviso de próxima reunión, por lo mismo (I6): el caso que cubre es
            // justamente "estoy en otra ventana".
            notice::start_watcher(app.handle().clone());

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == QUIT_MENU_ID {
                request_close(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            // tasks
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::set_task_status,
            commands::move_task,
            commands::demote_pending,
            commands::list_tasks_for_range,
            commands::list_tasks_for_date,
            commands::list_backlog,
            commands::list_task_events,
            commands::rescued_from_backlog,
            // timer
            commands::start_timer,
            commands::stop_timer,
            commands::get_active_timer,
            commands::list_time_entries,
            commands::day_work,
            commands::weekly_rollup,
            commands::daily_log,
            commands::set_day_note,
            commands::set_day_task_note,
            commands::set_day_mood,
            commands::include_in_log,
            commands::remove_from_log,
            commands::close_day,
            commands::reopen_day,
            commands::focus_queue,
            commands::install_bell_file,
            commands::clear_bell_file,
            commands::play_bell,
            commands::preview_notice_sound,
            commands::system_fonts,
            commands::set_taximeter_visible,
            commands::get_task,
            commands::set_actual_seconds,
            // categories
            commands::list_categories,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            // objectives
            commands::list_objectives,
            commands::list_objectives_range,
            commands::create_objective,
            commands::update_objective,
            commands::delete_objective,
            // settings
            commands::list_settings,
            commands::set_setting,
            commands::autostart_enabled,
            commands::set_autostart,
            commands::check_for_update,
            commands::install_update,
            // respaldos
            commands::app_version,
            commands::profile,
            commands::create_backup,
            commands::test_backup_dir,
            commands::list_backups,
            commands::restore_backup,
            // calendario
            commands::list_calendar_feeds,
            commands::create_calendar_feed,
            commands::update_calendar_feed,
            commands::delete_calendar_feed,
            commands::sync_calendar_feed,
            commands::sync_calendar_feeds,
            // avisos del sistema con botón (el resto los manda el plugin)
            commands::notify_alert,
            commands::preview_meeting_notice,
            commands::preview_bell_notice,
            commands::notification_identity,
            commands::notice_sounds,
            commands::open_notification_settings,
            // ciclo de vida
            commands::confirm_quit,
        ])
        // Cerrar la ventana (botón rojo, ⌘W) no cierra la app de una: se le
        // pregunta al usuario. Solo `main`: el taxímetro no debe abrir este
        // diálogo si algún día se cierra por código.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    request_close(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error al iniciar sunrise")
        .run(|app, event| {
            // `code: None` = lo pidió el usuario (⌘Q, menú Quit) => preguntar.
            // `code: Some(_)` = salida programática, que es la que dispara
            // `confirm_quit` una vez confirmado => dejarla pasar.
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                if code.is_none() {
                    api.prevent_exit();
                    request_close(app);
                }
            }
        });
}
