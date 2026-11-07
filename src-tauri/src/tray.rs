//! Linux 系统托盘：用纯 Rust 的 StatusNotifierItem 实现（ksni），
//! 绕开 libappindicator —— 那条路在本项目里无法注册到 Plasma 的
//! org.kde.StatusNotifierWatcher，导致托盘图标不显示。

use tauri::AppHandle;

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
        crate::app_runtime::reveal_main_window(&self.app);
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::{MenuItem, StandardItem};
        vec![
            StandardItem {
                label: "显示主窗口".into(),
                activate: Box::new(|tray: &mut Self| {
                    crate::app_runtime::reveal_main_window(&tray.app);
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "退出 Lycia".into(),
                activate: Box::new(|tray: &mut Self| {
                    tray.app.exit(0);
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

pub fn spawn(app: AppHandle<tauri::Wry>) {
    let service = ksni::TrayService::new(LyciaTray { app });
    // spawn() 会接管托盘生命周期，进程存活期间一直有效
    service.spawn();
}
