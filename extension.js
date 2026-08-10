'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const OVERLAP = 18;                // px cards overlap each other, mirrors the seam in the KDE original
const ANIM_DURATION_MS = 380;
const SCROLL_COOLDOWN_MS = 120;
const THUMB_LONG_EDGE = 960;       // max dimension for cached preview thumbnails (not the applied wallpaper)
const THUMB_CACHE_DIR = GLib.build_filenamev(
    [GLib.get_user_cache_dir(), 'wallpaper-carousel', 'thumbs']);

function resolveFolder(settings) {
    let folder = settings.get_string('wallpaper-folder');
    if (!folder)
        return GLib.build_filenamev([GLib.get_home_dir(), 'Pictures', 'Wallpapers']);
    if (folder.startsWith('~'))
        folder = GLib.build_filenamev([GLib.get_home_dir(), folder.slice(1)]);
    return folder;
}

function listWallpapers(folderPath) {
    const results = [];
    const dir = Gio.File.new_for_path(folderPath);
    let enumerator;
    try {
        enumerator = dir.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        return results;
    }
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_file_type() !== Gio.FileType.REGULAR)
            continue;
        const name = info.get_name();
        const lower = name.toLowerCase();
        if (VALID_EXTENSIONS.some(ext => lower.endsWith(ext)))
            results.push(GLib.build_filenamev([folderPath, name]));
    }
    try {
        enumerator.close(null);
    } catch (e) { /* ignore */ }
    results.sort();
    return results;
}

// Returns a path to a small, pre-scaled preview image for `path`, generating and
// disk-caching it on first use. The full-resolution original is only ever touched
// when the wallpaper is actually applied - the picker itself never decodes it.
function ensureThumbnail(path, thumbDir) {
    let info;
    try {
        const gfile = Gio.File.new_for_path(path);
        info = gfile.query_info(
            'standard::size,time::modified', Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        return path;
    }

    const size = info.get_size();
    const mtime = info.get_attribute_uint64('time::modified');
    const key = `${path}|${size}|${mtime}`;
    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, key, -1);
    const thumbPath = GLib.build_filenamev([thumbDir, `${hash}.jpg`]);

    if (GLib.file_test(thumbPath, GLib.FileTest.EXISTS))
        return thumbPath;

    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
            path, THUMB_LONG_EDGE, THUMB_LONG_EDGE, true);
        pixbuf.savev(thumbPath, 'jpeg', ['quality'], ['85']);
        return thumbPath;
    } catch (e) {
        return path;
    }
}

function easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Wallpaper Carousel', true /* dontCreateMenu */);
        this._extension = extension;
        this.reactive = true;
        this.add_child(new St.Icon({
            icon_name: 'preferences-desktop-wallpaper-symbolic',
            style_class: 'system-status-icon',
        }));
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            this._extension.togglePicker();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

class WallpaperCarousel {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension._settings;
        this._cards = [];
        this._paths = [];
        this._focus = 0;
        this._target = 0;
        this._animSourceId = 0;
        this._fileMonitor = null;
        this._refreshTimeoutId = 0;
        this._cardBuildSourceId = 0;
        this._lastStackFocus = NaN;
        this._pendingRebuild = true;
        this._grab = null;
        this._prevKeyFocus = null;
        this.isOpen = false;

        this._narrowW = this._settings.get_int('card-narrow-width');
        this._expandedW = this._settings.get_int('card-expanded-width');
        this._cardH = this._settings.get_int('card-height');

        this._folder = resolveFolder(this._settings);
        GLib.mkdir_with_parents(this._folder, 0o755);
        GLib.mkdir_with_parents(THUMB_CACHE_DIR, 0o755);

        this._buildContainer();
        this._watchFolder();
    }

    _buildContainer() {
        const monitor = Main.layoutManager.primaryMonitor;

        this._container = new St.Widget({
            reactive: true,
            can_focus: true,
            visible: false,
            width: monitor.width,
            height: monitor.height,
            x: monitor.x,
            y: monitor.y,
            style: 'background-color: rgba(20,20,28,0.88);',
        });

        this._hintRow = this._buildHintRow();
        this._container.add_child(this._hintRow);

        this._emptyLabel = new St.Label({
            style_class: 'wpc-empty',
            text: '',
            visible: false,
        });
        this._container.add_child(this._emptyLabel);

        Main.layoutManager.uiGroup.add_child(this._container);

        this._container.connect('key-press-event', this._onKeyPress.bind(this));
        this._container.connect('scroll-event', this._onScroll.bind(this));
    }

    _buildHintRow() {
        const row = new St.BoxLayout({style_class: 'wpc-hint-row'});

        const addGroup = (keys, text) => {
            const group = new St.BoxLayout({style_class: 'wpc-hint-group'});
            for (const key of keys) {
                group.add_child(new St.Label({style_class: 'wpc-keycap', text: key}));
            }
            group.add_child(new St.Label({style_class: 'wpc-hint-text', text}));
            row.add_child(group);
        };

        addGroup(['\u2190', '\u2192'], 'Navigate');
        addGroup(['Enter'], 'Apply');
        addGroup(['Esc'], 'Close');

        return row;
    }

    _watchFolder() {
        try {
            const gfile = Gio.File.new_for_path(this._folder);
            this._fileMonitor = gfile.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', () => {
                if (!this.isOpen) {
                    this._pendingRebuild = true;
                    return;
                }
                if (this._refreshTimeoutId)
                    GLib.source_remove(this._refreshTimeoutId);
                this._refreshTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    this._refreshTimeoutId = 0;
                    this._rebuildCards();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch (e) {
            this._fileMonitor = null;
        }
    }

    _rebuildCards() {
        const currentPath = this._paths[Math.round(this._focus)];

        if (this._cardBuildSourceId) {
            GLib.source_remove(this._cardBuildSourceId);
            this._cardBuildSourceId = 0;
        }

        this._cards.forEach(c => c.destroy());
        this._cards = [];
        this._paths = listWallpapers(this._folder);

        if (this._paths.length === 0) {
            this._emptyLabel.text =
                `No images (jpg/png/webp) found in:\n${this._folder}\n\n` +
                'Add some images to this folder, then reopen the carousel.';
            this._emptyLabel.visible = true;
            this._layoutStaticWidgets();
            return;
        }
        this._emptyLabel.visible = false;

        // Phase 1: create plain placeholder cards immediately (cheap - no image
        // decode at all), so the layout and overlay are visible right away.
        for (const path of this._paths) {
            const card = new St.Widget({
                style_class: 'wpc-card',
                reactive: true,
                width: this._narrowW,
                height: this._cardH,
            });
            card.connect('button-press-event', () => {
                this._applyWallpaper(path);
                return Clutter.EVENT_STOP;
            });
            this._container.add_child(card);
            this._cards.push(card);
        }

        let restoreIndex = currentPath ? this._paths.indexOf(currentPath) : -1;
        if (restoreIndex < 0)
            restoreIndex = Math.min(Math.round(this._focus), this._paths.length - 1);
        this._focus = restoreIndex;
        this._target = restoreIndex;

        // Pre-allocate scratch buffers sized to this card count once, instead of
        // letting _relayout() allocate fresh arrays on every one of the ~60
        // calls/sec it gets during an animation.
        this._widthsBuf = new Float64Array(this._cards.length);
        this._xPosBuf = new Float64Array(this._cards.length);
        this._orderBuf = new Int32Array(this._cards.length);

        this._layoutStaticWidgets();
        this._lastStackFocus = NaN;
        this._relayout();

        // Phase 2: fill in the real thumbnails a few at a time on the idle loop,
        // so a big wallpaper collection never blocks the carousel from opening.
        this._fillThumbnailsProgressively();
    }

    _fillThumbnailsProgressively() {
        const paths = this._paths;
        const cards = this._cards;
        let i = 0;

        this._cardBuildSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const batchEnd = Math.min(i + 3, paths.length);
            for (; i < batchEnd; i++) {
                const displayPath = ensureThumbnail(paths[i], THUMB_CACHE_DIR);
                try {
                    const uri = GLib.filename_to_uri(displayPath, null);
                    cards[i].set_style(
                        `background-image: url("${uri}"); ` +
                        'background-size: cover; background-position: center;');
                } catch (e) {
                    // path can't be turned into a URI - leave this card as a placeholder
                }
            }
            if (i >= paths.length) {
                this._cardBuildSourceId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _layoutStaticWidgets() {
        const monitor = Main.layoutManager.primaryMonitor;
        this._hintRow.set_position(
            Math.round(monitor.width / 2 - this._hintRow.width / 2),
            monitor.height - 64);
        this._emptyLabel.set_position(
            Math.round(monitor.width / 2 - this._emptyLabel.width / 2),
            Math.round(monitor.height / 2 - this._emptyLabel.height / 2));
    }

    _relayout() {
        const n = this._cards.length;
        if (n === 0)
            return;

        const monitor = Main.layoutManager.primaryMonitor;
        const widths = this._widthsBuf;
        const xPos = this._xPosBuf;

        for (let i = 0; i < n; i++) {
            const dist = Math.abs(i - this._focus);
            const progress = Math.max(0, 1 - dist);
            widths[i] = Math.round(this._narrowW + (this._expandedW - this._narrowW) * progress);
            xPos[i] = i > 0 ? xPos[i - 1] + widths[i - 1] - OVERLAP : 0;
        }

        const focalIndex = Math.min(Math.floor(this._focus), n - 1);
        const fraction = this._focus - focalIndex;
        const c1 = xPos[focalIndex] + widths[focalIndex] / 2;
        let focalX;
        if (focalIndex + 1 < n) {
            const c2 = xPos[focalIndex + 1] + widths[focalIndex + 1] / 2;
            focalX = c1 + (c2 - c1) * fraction;
        } else {
            focalX = c1;
        }

        const offsetX = monitor.width / 2 - focalX;
        const yPos = Math.round((monitor.height - this._cardH) / 2);

        for (let i = 0; i < n; i++) {
            const card = this._cards[i];
            const w = widths[i];
            const x = Math.round(xPos[i] + offsetX);

            if (card._wpcW !== w || card._wpcH !== this._cardH) {
                card.set_size(w, this._cardH);
                card._wpcW = w;
                card._wpcH = this._cardH;
            }
            if (card._wpcX !== x || card._wpcY !== yPos) {
                card.set_position(x, yPos);
                card._wpcX = x;
                card._wpcY = yPos;
            }
        }

        // Re-stacking only matters visually when the nearest card changes, so
        // skip the sort/reorder work on most of the ~60 relayouts/sec during an
        // animation - only redo it right when focus crosses a card boundary.
        const roundedFocus = Math.round(this._focus);
        if (roundedFocus !== this._lastStackFocus) {
            this._lastStackFocus = roundedFocus;
            const order = this._orderBuf;
            for (let i = 0; i < n; i++)
                order[i] = i;
            order.sort((a, b) => Math.abs(b - this._focus) - Math.abs(a - this._focus));
            for (let i = 0; i < n; i++)
                this._container.set_child_above_sibling(this._cards[order[i]], null);
        }
    }

    _animateTo(target) {
        target = Math.max(0, Math.min(target, this._cards.length - 1));
        if (target === this._target)
            return;
        this._target = target;

        if (this._animSourceId) {
            GLib.source_remove(this._animSourceId);
            this._animSourceId = 0;
        }

        const start = this._focus;
        const delta = this._target - start;
        const startTime = GLib.get_monotonic_time();

        // Driven by the GLib main loop timer (not Clutter's frame clock), so it
        // doesn't depend on this timeline being associated with any particular
        // actor/stage - it just needs the main loop to be running, which it
        // always is inside gnome-shell.
        this._animSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const elapsedMs = (GLib.get_monotonic_time() - startTime) / 1000;
            const p = Math.min(1, elapsedMs / ANIM_DURATION_MS);
            this._focus = start + delta * easeOutExpo(p);
            this._relayout();

            if (p >= 1) {
                this._focus = this._target;
                this._relayout();
                this._animSourceId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        switch (symbol) {
        case Clutter.KEY_Left:
        case Clutter.KEY_Up:
            this._animateTo(this._target - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
        case Clutter.KEY_Down:
            this._animateTo(this._target + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            if (this._paths[this._target])
                this._applyWallpaper(this._paths[this._target]);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onScroll(actor, event) {
        const now = GLib.get_monotonic_time() / 1000;
        if (this._lastScrollMs && now - this._lastScrollMs < SCROLL_COOLDOWN_MS)
            return Clutter.EVENT_STOP;
        this._lastScrollMs = now;

        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
            this._animateTo(this._target - 1);
        else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
            this._animateTo(this._target + 1);
        return Clutter.EVENT_STOP;
    }

    _applyWallpaper(path) {
        try {
            const uri = GLib.filename_to_uri(path, null);
            const bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            bg.set_string('picture-uri', uri);
            bg.set_string('picture-uri-dark', uri);
            bg.set_string('picture-options', 'zoom');
        } catch (e) {
            console.error('Wallpaper Carousel: failed to apply wallpaper', e);
        }
        this.close();
    }

    open() {
        if (this.isOpen)
            return;
        this.isOpen = true;

        this._prevKeyFocus = global.stage.get_key_focus();

        // Show the backdrop immediately so the shortcut/click feels instantly
        // responsive, then fade it in. Card rebuilding (if needed) happens
        // after this, and images fill in progressively in the background -
        // none of that blocks this from appearing right away.
        this._container.remove_all_transitions();
        this._container.reactive = true;
        this._container.opacity = 0;
        this._container.visible = true;
        this._container.ease({
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        if (this._pendingRebuild) {
            this._pendingRebuild = false;
            this._rebuildCards();
        }

        this._grab = Main.pushModal(this._container, {actionMode: Shell.ActionMode.NORMAL});
        global.stage.set_key_focus(this._container);
    }

    close() {
        if (!this.isOpen)
            return;
        this.isOpen = false;

        if (this._animSourceId) {
            GLib.source_remove(this._animSourceId);
            this._animSourceId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (this._prevKeyFocus)
            global.stage.set_key_focus(this._prevKeyFocus);

        // Stop intercepting clicks right away so the fade-out doesn't leave a
        // brief dead zone over the desktop, then fade the backdrop away.
        this._container.reactive = false;
        this._container.remove_all_transitions();
        this._container.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this._container.visible = false;
            },
        });
    }

    destroy() {
        this.close();
        if (this._refreshTimeoutId) {
            GLib.source_remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }
        if (this._cardBuildSourceId) {
            GLib.source_remove(this._cardBuildSourceId);
            this._cardBuildSourceId = 0;
        }
        if (this._fileMonitor) {
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
        this._container.destroy();
    }
}

export default class WallpaperCarouselExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Build the picker FIRST. It's cheap (no folder scan / image decode happens
        // here), and doing this before the keybinding/indicator exist means
        // togglePicker() can never be called while this._picker is still undefined.
        this._picker = new WallpaperCarousel(this);

        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this.togglePicker());

        // Quietly pre-generate cached thumbnails in the background so that even
        // the first real open reads from cache instead of decoding full-res images.
        this._prewarmSourceId = 0;
        this._prewarmThumbnails();
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');

        if (this._prewarmSourceId) {
            GLib.source_remove(this._prewarmSourceId);
            this._prewarmSourceId = 0;
        }
        if (this._picker) {
            this._picker.destroy();
            this._picker = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }

    togglePicker() {
        if (!this._picker)
            return;
        if (this._picker.isOpen)
            this._picker.close();
        else
            this._picker.open();
    }

    _prewarmThumbnails() {
        const folder = resolveFolder(this._settings);
        GLib.mkdir_with_parents(folder, 0o755);
        GLib.mkdir_with_parents(THUMB_CACHE_DIR, 0o755);
        const paths = listWallpapers(folder);
        let i = 0;

        this._prewarmSourceId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            if (!this._settings || i >= paths.length) {
                this._prewarmSourceId = 0;
                return GLib.SOURCE_REMOVE;
            }
            ensureThumbnail(paths[i], THUMB_CACHE_DIR);
            i++;
            return GLib.SOURCE_CONTINUE;
        });
    }
}
