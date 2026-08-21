'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// GDK keyvals that represent a modifier key on its own. A shortcut capture
// should keep waiting when one of these is pressed alone, not treat it as
// the finished combination.
const MODIFIER_KEYVALS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Caps_Lock, Gdk.KEY_Num_Lock,
    Gdk.KEY_ISO_Level3_Shift, Gdk.KEY_ISO_Level5_Shift,
]);

// Opens a small modal that listens for the next key combination the user
// presses and reports it back as a GTK accelerator string (e.g. "<Super>w"),
// the same format GSettings and Main.wm.addKeybinding expect. This mirrors
// how GNOME's own Settings > Keyboard Shortcuts captures shortcuts, rather
// than asking the user to type an accelerator string by hand.
function captureShortcut(parentWindow, onCaptured) {
    const dialog = new Adw.Window({
        modal: true,
        transient_for: parentWindow,
        default_width: 340,
        default_height: 160,
        resizable: false,
        title: 'Set Shortcut',
    });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
    });
    const promptLabel = new Gtk.Label({
        label: 'Press a key combination',
        css_classes: ['title-3'],
    });
    const hintLabel = new Gtk.Label({
        label: 'Esc to cancel',
        css_classes: ['dim-label'],
    });
    box.append(promptLabel);
    box.append(hintLabel);
    dialog.set_content(box);

    const controller = new Gtk.EventControllerKey();
    dialog.add_controller(controller);
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (MODIFIER_KEYVALS.has(keyval))
            return Gdk.EVENT_STOP;

        const mask = state & Gtk.accelerator_get_default_mod_mask();
        if (mask === 0) {
            hintLabel.label = 'Include a modifier, like Super or Ctrl';
            return Gdk.EVENT_STOP;
        }

        const accelerator = Gtk.accelerator_name(keyval, mask);
        if (!accelerator) {
            hintLabel.label = 'That combination cannot be used, try another';
            return Gdk.EVENT_STOP;
        }

        dialog.close();
        onCaptured(accelerator);
        return Gdk.EVENT_STOP;
    });

    dialog.present();
}

export default class WallDeckPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();

        const folderGroup = new Adw.PreferencesGroup({
            title: 'Folder and Shortcut',
            description: 'Set the folder that gets scanned and the shortcut that opens the carousel.',
        });
        page.add(folderGroup);

        const folderRow = new Adw.ActionRow({
            title: 'Wallpaper folder',
            subtitle: settings.get_string('wallpaper-folder') ||
                '~/Pictures/Wallpapers (default)',
        });
        const chooseButton = new Gtk.Button({
            label: 'Choose\u2026',
            valign: Gtk.Align.CENTER,
        });
        chooseButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: 'Choose wallpaper folder'});
            dialog.select_folder(window, null, (dlg, result) => {
                let folder;
                try {
                    folder = dlg.select_folder_finish(result);
                } catch (e) {
                    // Dialog was cancelled or dismissed. Nothing to save.
                    return;
                }
                if (!folder)
                    return;

                const path = folder.get_path();
                if (!path) {
                    // get_path() returns null for non-local locations (a
                    // network share or cloud mount through GVfs, for
                    // example). There is no plain filesystem path to save.
                    folderRow.subtitle = 'That location is not a local folder. Pick one under your home directory.';
                    console.error('Wall Deck prefs: selected folder has no local path (non-native GVfs mount)');
                    return;
                }

                settings.set_string('wallpaper-folder', path);
                folderRow.subtitle = path;
            });
        });
        folderRow.add_suffix(chooseButton);
        folderRow.activatable_widget = chooseButton;
        folderGroup.add(folderRow);

        const shortcutRow = new Adw.ActionRow({
            title: 'Toggle shortcut',
            subtitle: 'Click, then press the key combination you want.',
        });
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: settings.get_strv('toggle-shortcut')[0] || '<Super>w',
            valign: Gtk.Align.CENTER,
        });
        const shortcutButton = new Gtk.Button({
            child: shortcutLabel,
            valign: Gtk.Align.CENTER,
        });
        shortcutButton.connect('clicked', () => {
            captureShortcut(window, accelerator => {
                settings.set_strv('toggle-shortcut', [accelerator]);
                shortcutLabel.set_accelerator(accelerator);
            });
        });
        shortcutRow.add_suffix(shortcutButton);
        shortcutRow.activatable_widget = shortcutButton;
        folderGroup.add(shortcutRow);

        window.add(page);
    }
}
