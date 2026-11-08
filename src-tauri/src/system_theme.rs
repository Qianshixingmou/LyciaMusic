//! Linux 上系统深浅色判断。
//!
//! Tauri 的 `window.theme()` 在 Linux 依赖 GTK 主题名推断，
//! 在 NixOS/Plasma/Wayland 下经常误判为 dark。
//! 改用 XDG 桌面门户的 `org.freedesktop.appearance color-scheme`：
//! 1 = 偏好深色，2 = 偏好浅色，0 = 无偏好。

#[cfg(target_os = "linux")]
fn read_portal_color_scheme() -> Option<u32> {
    use zbus::blocking::Connection;

    let connection = Connection::session().ok()?;
    let reply = connection
        .call_method(
            Some("org.freedesktop.portal.Desktop"),
            "/org/freedesktop/portal/desktop",
            Some("org.freedesktop.portal.Settings"),
            "Read",
            &("org.freedesktop.appearance", "color-scheme"),
        )
        .ok()?;

    // 返回类型是 v（variant 包 u32）
    let value: zbus::zvariant::OwnedValue = reply.body().deserialize().ok()?;
    let inner: u32 = value.try_into().ok()?;
    Some(inner)
}

/// 返回 "dark" / "light" / None（无偏好或读取失败）
#[tauri::command]
pub fn get_system_color_scheme() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        match read_portal_color_scheme() {
            Some(1) => return Some("dark".into()),
            Some(2) => return Some("light".into()),
            _ => return None,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}
