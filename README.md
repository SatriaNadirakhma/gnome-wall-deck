# Wallpaper Carousel (GNOME port of lamex30/wall-picker)

A GNOME Shell extension inspired by [wall-picker](https://github.com/lamex30/wall-picker)
(KDE Plasma): wallpaper cards that expand when focused, navigated with arrow keys/scroll,
click to apply instantly. Rewritten from scratch with St + Clutter (GJS) to run natively in
GNOME Shell — a real extension that shows up in `gnome-extensions` and the Extensions app,
not a separate standalone tool.

## Install (Fedora GNOME)

```bash
unzip wallpaper-carousel-gnome.zip -d wallpaper-carousel-gnome
cd wallpaper-carousel-gnome
./install.sh
```

Then:
1. **Reload GNOME Shell** — Xorg: `Alt+F2`, type `r`, Enter. Wayland: log out and back in
   (Wayland can't reload the shell without a full logout).
2. **Enable the extension:**
   ```bash
   gnome-extensions enable wallpaper-carousel@lamex30-port.github.io
   ```
3. **Set your wallpaper folder** (optional, defaults to `~/Pictures/Wallpapers`):
   ```bash
   gnome-extensions prefs wallpaper-carousel@lamex30-port.github.io
   ```
4. Open the carousel with **Super+W**, or click the icon in the top bar.

## Usage

- **Left/Right arrows or scroll** — move focus between wallpapers
- **Click a card / Enter** — apply that wallpaper and close
- **Esc** — close without changing anything
- **Drop new images into the wallpaper folder** — they're picked up automatically. If the
  carousel is open when you add a file, the deck refreshes live via `Gio.FileMonitor`.

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`.

## Performance notes

Two things made the first build feel slow, both fixed:

- **Card `box-shadow` recomputed every frame.** Cards resize continuously during the focus
  animation (narrow → expanded), and St regenerates a shadow's blurred texture whenever the
  actor's size changes. Recalculating that blur for every card, every frame, was the main
  cause of visible lag. The shadow is gone from cards entirely now — only the static keycap
  hints keep a (cheap, blur-free) drop shadow, since those never resize.
- **Full-resolution decoding.** Every open used to decode the original wallpaper file (often
  several MB / 4K+) just to show a small on-screen card. Now each image is scaled down once
  via `GdkPixbuf` and cached as a small JPEG thumbnail under
  `~/.cache/wallpaper-carousel/thumbs/`, keyed by file path + size + modification time. The
  actual wallpaper you apply is still the full-resolution original — only the on-screen
  preview is downscaled.
- **The picker no longer rebuilds itself on every open/close.** It's constructed once when
  the extension loads and simply hidden/shown afterward; the card list is only rebuilt when
  the wallpaper folder actually changes. A low-priority background pass also pre-generates
  thumbnails right after the extension enables, so by the time you first press the shortcut,
  the cache is usually already warm.

## Differences from the original KDE version

- **Card shape**: the KDE version uses parallelogram (slanted) cards via a custom
  `QPainterPath`. GNOME Shell's St toolkit has no safe, stable way to clip to an arbitrary
  shape without raw Cairo pixel manipulation, so this port uses rounded rectangular cards
  with a thin border instead. The expand/contract animation and position math are ported
  directly from `update_layout()` in the original Python script.
- **Applying the wallpaper**: the KDE version shells out to `plasma-apply-wallpaperimage`
  (a Plasma-only CLI tool). This port uses `Gio.Settings` against the
  `org.gnome.desktop.background` schema — the standard GNOME way — with no subprocess spawn
  at all.
- **Trigger**: the KDE version is launched via an app launcher/krunner plus a custom shortcut
  in System Settings. This port ships a default `Super+W` shortcut (editable in preferences)
  plus a top-bar icon as an alternative.

## Known limitation

This code targets the GNOME Shell 45–48 API (ESM extensions, the `Extension` base class,
grab-based `Main.pushModal`), and has been syntax-checked, but has not been run inside a
live GNOME Shell session — there was no GUI environment available to test it in while
building it. The API most likely to need a patch across shell versions is
`Main.pushModal`/`Main.popModal`, which changed its return type in GNOME 46. If `enable()`
throws, run `journalctl -f -o cat /usr/bin/gnome-shell` while enabling the extension and
share the error — it's usually a quick fix.

## Uninstall

```bash
gnome-extensions disable wallpaper-carousel@lamex30-port.github.io
rm -rf ~/.local/share/gnome-shell/extensions/wallpaper-carousel@lamex30-port.github.io
rm -rf ~/.cache/wallpaper-carousel
```
