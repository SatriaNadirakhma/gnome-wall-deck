#!/bin/bash
set -e

UUID="wallpaper-carousel@lamex30-port.github.io"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "installing Wallpaper Carousel (GNOME port)..."

mkdir -p "$DEST_DIR"
cp -r "$SRC_DIR/extension.js" "$SRC_DIR/prefs.js" "$SRC_DIR/metadata.json" \
      "$SRC_DIR/stylesheet.css" "$DEST_DIR/"
mkdir -p "$DEST_DIR/schemas"
cp "$SRC_DIR/schemas/org.gnome.shell.extensions.wallpaper-carousel.gschema.xml" "$DEST_DIR/schemas/"

echo "compiling gsettings schema..."
glib-compile-schemas "$DEST_DIR/schemas"

echo ""
echo "done. files installed to:"
echo "  $DEST_DIR"
echo ""
echo "next steps:"
echo "  1. reload GNOME Shell - log out and log back in"
echo "       (GNOME 50 is Wayland-only, so the old Alt+F2 'r' restart trick no longer works)"
echo "  2. enable the extension:"
echo "       gnome-extensions enable $UUID"
echo "  3. open preferences to set your wallpaper folder (optional, defaults to ~/Pictures/Wallpapers):"
echo "       gnome-extensions prefs $UUID"
echo "  4. press Super+W to open the carousel (or click the icon in the top bar)."
