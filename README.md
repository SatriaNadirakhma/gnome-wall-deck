# Wall Deck (GNOME port of lamex30/wall-picker)

A GNOME Shell extension inspired by [wall-picker](https://github.com/lamex30/wall-picker)
(KDE Plasma): wallpaper cards that expand when focused, navigated with arrow keys or a
scroll wheel, click to apply instantly. Built from scratch with St and Clutter (GJS) to
run natively in GNOME Shell. It shows up in `gnome-extensions` and the Extensions app like
any other extension, not as a separate standalone tool.

## Install (Fedora GNOME)

```bash
unzip gnome-wall-deck.zip -d gnome-wall-deck
cd gnome-wall-deck
make
```

Then:
1. **Reload GNOME Shell.** On GNOME 46 and older running Xorg, press `Alt+F2`, type `r`,
   Enter. Everywhere else (Wayland, or GNOME 50+, which dropped X11), log out and back in.
   Wayland has no in-place shell restart.
2. **Enable the extension:**
   ```bash
   gnome-extensions enable gnome-wall-deck@github.io
   ```
3. **Set your wallpaper folder** (optional, defaults to `~/Pictures/Wallpapers`):
   ```bash
   gnome-extensions prefs gnome-wall-deck@github.io
   ```
4. Open the carousel with **Super+W**, or click the icon in the top bar.

## Usage

- **Left/Right arrows or scroll**: move focus between wallpapers
- **Click a card / Enter**: apply that wallpaper and close
- **Esc**: close without changing anything
- **Drop new images into the wallpaper folder**: they're picked up automatically. If the
  carousel is open when you add a file, the deck refreshes live via `Gio.FileMonitor`.
- **Card size is automatic**: dimensions come from your monitor's resolution, so the
  carousel looks proportionate on a laptop panel or a 4K display. There's no size setting
  in preferences.

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`.

## Performance notes

Several rounds of testing on a live GNOME Shell session turned up concrete problems. Each
one is fixed in the code below.

- **Card `box-shadow` recomputed every frame.** Cards resize continuously during the focus
  animation (narrow to expanded), and St regenerates a shadow's blurred texture whenever an
  actor's size changes. Recalculating that blur for every card, every frame, caused the
  visible lag. Cards have no shadow now. Only the static keycap hints keep a blur-free drop
  shadow, since those never resize.
- **Full-resolution decoding.** Every open used to decode the original wallpaper file,
  often several MB at 4K or higher, just to show a small on-screen card. Each image is now
  scaled down once via `GdkPixbuf` and cached as a small JPEG thumbnail under
  `~/.cache/gnome-wall-deck/thumbs/`, keyed by file path, size, and modification time. The
  wallpaper you apply is still the full-resolution original. Only the on-screen preview is
  downscaled, and it fills in a few cards at a time on the idle loop, so a large collection
  never blocks the UI.
- **The picker no longer rebuilds on every open and close.** It's constructed once when the
  extension loads, then hidden and shown with a fade via `actor.ease()`. The card list
  rebuilds only when the wallpaper folder changes. A low-priority background pass also
  pre-generates thumbnails right after the extension enables, so the cache is usually warm
  by the time you press the shortcut.
- **Left/right navigation wasn't moving at all.** The original animation used a bare
  `Clutter.Timeline` with no actor or stage association, and it never ticked. A
  `GLib.timeout_add`-driven interpolation loop replaced it. That loop depends only on the
  GLib main loop, with no frame-clock ambiguity.
- **Intermittent stutter during navigation.** The per-frame layout function allocated two
  fresh arrays roughly 60 times a second. That garbage-collector pressure caused visible
  micro-stutters. The fix reuses pre-allocated `Float64Array`/`Int32Array` buffers across
  frames instead of allocating new ones, and calls `set_size`, `set_position`, and
  `set_child_above_sibling` only when a value changes, not every frame.

## Differences from the original KDE version

- **Card shape**: the KDE version uses parallelogram (slanted) cards via a custom
  `QPainterPath`. GNOME Shell's St toolkit has no stable way to clip to an arbitrary shape
  without raw Cairo pixel manipulation, so this port uses rounded rectangular cards with a
  thin border. The expand/contract animation and position math are ported directly from
  `update_layout()` in the original Python script.
- **Card sizing**: the KDE version uses fixed pixel widths. This port derives card
  dimensions from the monitor's resolution at open time, so it adjusts across different
  screens without a manual size setting.
- **Applying the wallpaper**: the KDE version shells out to `plasma-apply-wallpaperimage`,
  a Plasma-only CLI tool. This port uses `Gio.Settings` against the
  `org.gnome.desktop.background` schema, the standard GNOME approach, with no subprocess
  spawn.
- **Trigger**: the KDE version launches via an app launcher or krunner plus a custom
  shortcut in System Settings. This port ships a default `Super+W` shortcut (editable in
  preferences) plus a top-bar icon as an alternative.

## Contributing

Read `AGENTS.md` before opening a PR. It covers this project's policy on AI-assisted
contributions, following [GNOME's Extension Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#extensions-must-not-be-ai-generated).

## Uninstall

```bash
gnome-extensions disable gnome-wall-deck@github.io
rm -rf ~/.local/share/gnome-shell/extensions/gnome-wall-deck@github.io
rm -rf ~/.cache/gnome-wall-deck
```
