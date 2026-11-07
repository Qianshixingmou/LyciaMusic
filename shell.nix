{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  name = "lycia-dev";
  nativeBuildInputs = with pkgs; [
    pkg-config
    nodejs_22
    rustc
    cargo
    # Tauri v2 Linux 依赖
    webkitgtk_4_1
    gtk3
    libsoup_3
    glib
    pango
    cairo
    gdk-pixbuf
    atk
    harfbuzz
    openssl
    librsvg
    libayatana-appindicator
    alsa-lib
    dbus
    xdotool

    file
    curl
    wget
  ];
  buildInputs = with pkgs; [ glibc ];
  shellHook = ''
    export RUST_BACKTRACE=1
    echo "Lycia dev shell: node $(node -v), rust $(rustc --version | cut -d' ' -f2)"
  '';
}
