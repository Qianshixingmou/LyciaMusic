# Linux 构建说明（社区维护分支）

上游 `Billy636/LyciaMusic` 只发布 Windows 版本，本分支添加 Linux 支持与相关修复。

## 本分支相比上游的改动

| 提交 | 说明 |
|---|---|
| `import V1.5.3` | 以官方 tag `V1.5.3` 为基线（注意：上游 tag 里版本号仍写 1.3.12，本分支已改为 1.5.3） |
| `fix(ui)` | 移除快捷键设置页 40 个按钮上的 `backdrop-blur`，规避 WebKitGTK 内存暴涨（实测单进程涨到 10 GB） |
| `fix(linux)` | 桌面歌词窗口在 GTK 尚未 realize 时调用 `setIgnoreCursorEvents` 会让 tao panic 崩溃，加入可见性判断 |
| `fix(linux)` | 扩大 `assetProtocol.scope`，否则 Linux 上封面图片（`asset://localhost/...`）无法加载 |
| `build` | 增加 `shell.nix`（NixOS）与 GitHub Actions 构建工作流 |

## NixOS 上编译

```bash
nix-shell shell.nix --run 'npm ci && npm run tauri build'
```

产物：

- `src-tauri/target/release/lycia_music`
- `src-tauri/target/release/bundle/deb/*.deb`
- `src-tauri/target/release/bundle/rpm/*.rpm`

AppImage 打包需要联网下载 `AppRun`，国内网络常失败，可忽略（deb/rpm 已生成）。

## 运行（NixOS）

Tauri 依赖系统的 WebKitGTK，直接用 `buildFHSEnv` 包一层最省事：

```nix
pkgs.buildFHSEnv {
  name = "lycia";
  targetPkgs = pkgs: with pkgs; [ webkitgtk_4_1 gtk3 libsoup_3 librsvg libayatana-appindicator alsa-lib dbus ];
  runScript = "/path/to/lycia_music";
}
```
