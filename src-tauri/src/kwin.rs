//! KWin 侧的歌词窗口设置（Wayland 下 GTK 无法设置 keep-above，
//! 只能通过 KWin 脚本 + 脚本配置来实现“始终置顶”）。

use std::path::PathBuf;

const SCRIPT_GROUP: &str = "Script-lycia-lyrics-skip-taskbar";

fn kwinrc_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config/kwinrc"))
}

/// 修改 kwinrc 里 `[Script-lycia-lyrics-skip-taskbar]` 段的某个键
fn write_script_setting(key: &str, value: &str) -> Result<(), String> {
    let path = kwinrc_path().ok_or_else(|| "无法定位 HOME".to_string())?;
    let content = std::fs::read_to_string(&path).unwrap_or_default();

    let mut output = String::new();
    let mut in_section = false;
    let mut section_seen = false;
    let mut key_written = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if in_section && !key_written {
                output.push_str(&format!("{key}={value}\n"));
                key_written = true;
            }
            in_section = trimmed == format!("[{SCRIPT_GROUP}]");
            if in_section {
                section_seen = true;
            }
            output.push_str(line);
            output.push('\n');
            continue;
        }

        if in_section && trimmed.starts_with(&format!("{key}=")) {
            output.push_str(&format!("{key}={value}\n"));
            key_written = true;
            continue;
        }

        output.push_str(line);
        output.push('\n');
    }

    if in_section && !key_written {
        output.push_str(&format!("{key}={value}\n"));
        key_written = true;
    }

    if !section_seen {
        if !output.ends_with('\n') && !output.is_empty() {
            output.push('\n');
        }
        output.push_str(&format!("\n[{SCRIPT_GROUP}]\n{key}={value}\n"));
    }

    std::fs::write(&path, output).map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
fn reconfigure_kwin() -> Result<(), String> {
    let connection =
        zbus::blocking::Connection::session().map_err(|error| error.to_string())?;
    connection
        .call_method(
            Some("org.kde.KWin"),
            "/KWin",
            Some("org.kde.KWin"),
            "reconfigure",
            &(),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// 同步“始终置顶”设置到 KWin 脚本（Wayland 下唯一生效的途径）
#[tauri::command]
pub fn set_lyrics_keep_above(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        write_script_setting("keepAbove", if enabled { "true" } else { "false" })?;
        reconfigure_kwin()?;
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = enabled;
    }
    Ok(())
}

/// 同步“锁定（鼠标穿透）”到 KWin：GTK 的 input region 在 Wayland 下切换后常失效，
/// 改由合成器直接关闭窗口的输入接收（acceptsInput = false）。
#[tauri::command]
pub fn set_lyrics_ignore_input(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        write_script_setting("ignoreInput", if enabled { "true" } else { "false" })?;
        reconfigure_kwin()?;
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = enabled;
    }
    Ok(())
}
