//! Linux 系统托盘：纯 Rust 的 StatusNotifierItem 实现（ksni）。
//!
//! 菜单项与 Windows 版的自绘托盘菜单（src/components/layout/TrayMenuWindow.vue）
//! 保持一致：通过 `app:tray-menu` 事件把动作发给主窗口处理。

use tauri::{AppHandle, Emitter, Manager};

const TRAY_MENU_EVENT: &str = "app:tray-menu";

struct LyciaTray {
    app: AppHandle<tauri::Wry>,
}

fn icon_argb() -> Vec<ksni::Icon> {
    let bytes = include_bytes!("../icons/128x128.png");
    let Ok(img) = image::load_from_memory(bytes) else {
        return Vec::new();
    };
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut data = Vec::with_capacity((w * h * 4) as usize);
    for px in rgba.pixels() {
        // SNI 要求 ARGB32（大端）
        data.extend_from_slice(&[px[3], px[0], px[1], px[2]]);
    }
    vec![ksni::Icon {
        width: w as i32,
        height: h as i32,
        data,
    }]
}


fn reveal_on_main_thread(app: &AppHandle<tauri::Wry>) {
    eprintln!("[tray] reveal requested");
    let app = app.clone();
    // GTK 的窗口操作必须在主线程执行，ksni 回调在独立线程里，直接调用会静默失败
    let r = app.clone().run_on_main_thread(move || {
        eprintln!("[tray] on main thread, revealing");
        crate::app_runtime::reveal_main_window(&app);
        if let Some(w) = app.get_webview_window("main") {
            eprintln!("[tray] after reveal: visible={:?} minimized={:?}",
                w.is_visible(), w.is_minimized());
        }
    });
    eprintln!("[tray] run_on_main_thread -> {:?}", r);
}

impl LyciaTray {
    fn dispatch(&self, action: &str) {
        let _ = self.app.emit_to("main", TRAY_MENU_EVENT, action.to_string());
    }
}

impl ksni::Tray for LyciaTray {
    fn id(&self) -> String {
        "lycia-player".into()
    }

    fn title(&self) -> String {
        "Lycia Player".into()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        icon_argb()
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        reveal_on_main_thread(&self.app);
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::{MenuItem, StandardItem, SubMenu};
        let item = |label: &str, action: &'static str| -> MenuItem<Self> {
            StandardItem {
                label: label.into(),
                activate: Box::new(move |tray: &mut Self| tray.dispatch(action)),
                ..Default::default()
            }
            .into()
        };
        let reveal = StandardItem {
            label: "显示主窗口".into(),
            activate: Box::new(|tray: &mut Self| {
                reveal_on_main_thread(&tray.app);
            }),
            ..Default::default()
        };
        let quit = StandardItem {
            label: "退出 Lycia".into(),
            activate: Box::new(|tray: &mut Self| {
                tray.dispatch("quit");
                tray.app.exit(0);
            }),
            ..Default::default()
        };
        let play_mode = SubMenu {
            label: "播放模式".into(),
            submenu: vec![
                item("列表循环", "play-mode-list-loop"),
                item("单曲循环", "play-mode-single-loop"),
                item("随机播放", "play-mode-shuffle"),
            ],
            ..Default::default()
        };

        vec![
            reveal.into(),
            MenuItem::Separator,
            item("上一首", "prev-song"),
            item("播放 / 暂停", "toggle-play"),
            item("下一首", "next-song"),
            MenuItem::Separator,
            play_mode.into(),
            MenuItem::Separator,
            item("mini 窗口", "toggle-mini-player"),
            item("桌面歌词", "toggle-desktop-lyrics"),
            StandardItem {
                label: "设置…".into(),
                activate: Box::new(|tray: &mut Self| {
                    tray.dispatch("open-settings");
                    reveal_on_main_thread(&tray.app);
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            quit.into(),
        ]
    }
}

pub fn spawn(app: AppHandle<tauri::Wry>) {
    let service = ksni::TrayService::new(LyciaTray { app });
    service.spawn();
}
