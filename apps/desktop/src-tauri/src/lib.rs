use tauri::Manager;

/// Starts the desktop editor and its native file dialogs.
pub fn run() {
    let app = match tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(error) => {
            eprintln!("Unable to start JSON Editor: {error}");
            std::process::exit(1);
        }
    };

    app.run(|handle, event| {
        // Route application quit through the same unsaved-change guard as window close.
        if let tauri::RunEvent::ExitRequested { api, .. } = event
            && let Some(window) = handle.get_webview_window("main")
        {
            api.prevent_exit();
            if let Err(error) = window.close() {
                eprintln!("Unable to close JSON Editor: {error}");
            }
        }
    });
}
