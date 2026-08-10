'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WallpaperCarouselPreferences extends ExtensionPreferences {
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
                try {
                    const folder = dlg.select_folder_finish(result);
                    if (folder) {
                        const path = folder.get_path();
                        settings.set_string('wallpaper-folder', path);
                        folderRow.subtitle = path;
                    }
                } catch (e) {
                    // dialog was cancelled, ignore
                }
            });
        });
        folderRow.add_suffix(chooseButton);
        folderRow.activatable_widget = chooseButton;
        folderGroup.add(folderRow);

        const shortcutRow = new Adw.ActionRow({
            title: 'Toggle shortcut',
            subtitle: 'GTK accelerator format, e.g. <Super>w or <Super><Shift>w',
        });
        const shortcutEntry = new Gtk.Entry({
            text: settings.get_strv('toggle-shortcut')[0] || '<Super>w',
            valign: Gtk.Align.CENTER,
            width_chars: 16,
        });
        shortcutEntry.connect('changed', () => {
            const val = shortcutEntry.get_text().trim();
            if (val)
                settings.set_strv('toggle-shortcut', [val]);
        });
        shortcutRow.add_suffix(shortcutEntry);
        folderGroup.add(shortcutRow);

        // const sizeGroup = new Adw.PreferencesGroup({
        //     title: 'Card size',
        //     description: 'Adjust the size of the cards in the carousel (in pixels).',
        // });
        // page.add(sizeGroup);

        // const addSpin = (key, title, min, max) => {
        //     const row = new Adw.ActionRow({title});
        //     const adj = new Gtk.Adjustment({
        //         lower: min,
        //         upper: max,
        //         step_increment: 10,
        //         value: settings.get_int(key),
        //     });
        //     adj.connect('value-changed', () => {
        //         settings.set_int(key, Math.round(adj.get_value()));
        //     });
        //     const spin = new Gtk.SpinButton({adjustment: adj, valign: Gtk.Align.CENTER});
        //     row.add_suffix(spin);
        //     sizeGroup.add(row);
        // };

        // addSpin('card-narrow-width', 'Unfocused card width', 80, 400);
        // addSpin('card-expanded-width', 'Focused card width', 200, 900);
        // addSpin('card-height', 'Card height', 150, 900);

        window.add(page);
    }
}
